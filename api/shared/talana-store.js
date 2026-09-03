// ============================================================================
//  shared/talana-store.js  ·  Snapshot de asistencia en Azure Blob
//
//  Por qué existe: Talana bloquea 10 minutos si se pasan las ~50 req/min, y el
//  reporte necesita un mes entero de marcas al abrirse. Consultar en vivo en
//  cada carga es la forma más rápida de quedar bloqueados. Así que se guarda un
//  snapshot y el reporte lee de ahí.
//
//  Estructura del contenedor (OS_TALANA_CONTAINER, por defecto redtec-talana):
//
//    talana/maestros.json          personas, sucursales, centros de costo,
//                                  turnos y asignaciones. TTL en horas.
//    talana/marcas/YYYY-MM-DD.json marcas de ese día. Un día pasado y fuera de
//                                  la ventana de gracia se considera CERRADO y
//                                  no se vuelve a pedir.
//    talana/ausencias/YYYY-MM.json ausencias resumidas del mes.
//    talana/estado.json            cursor del sincronizador.
//
//  Reusa la misma cadena de conexión que el resto del ecosistema
//  (OS_STORAGE_CONN) para no multiplicar secretos.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_TALANA_CONTAINER || 'redtec-talana';

// Días hacia atrás que se vuelven a pedir en cada sync, porque una marca puede
// subir tarde (reloj sin red, corrección de RR.HH. sobre un día ya pasado).
const VENTANA_GRACIA_DIAS = Number(process.env.TALANA_GRACIA_DIAS || 5);

// Vida útil de los maestros: cambian poco (altas, cambios de turno).
const TTL_MAESTROS_MIN = Number(process.env.TALANA_TTL_MAESTROS_MIN || 720); // 12 h

const K_MAESTROS = 'talana/maestros.json';
const K_ESTADO   = 'talana/estado.json';
// Traída de ausencias a medio camino: se guarda para poder reanudarla en la
// siguiente invocación en vez de empezar de cero.
const K_AUS_PARCIAL = 'talana/ausencias-parcial.json';
const kMarcas    = fecha => `talana/marcas/${fecha}.json`;
const kAusencias = mes   => `talana/ausencias/${mes}.json`;

const hoyIso = () => {
  // El negocio es chileno: el "hoy" del snapshot debe ser el de Santiago,
  // no el UTC del contenedor donde corre la Function.
  const tz = process.env.TALANA_TZ || 'America/Santiago';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};

function getContainer() {
  if (!CONN) throw new Error('OS_STORAGE_CONN no configurada en la Function App');
  return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
}

async function asegurarContenedor(container) {
  // Devuelve null si quedó listo, o el motivo si no se pudo crear. Callar un
  // fallo aquí deja al sync escribiendo contra un contenedor inexistente y el
  // error aparece después, lejos de su causa.
  try {
    await container.createIfNotExists();
    return null;
  } catch (e) {
    if (/already exists|ContainerAlreadyExists/i.test(e.message || '')) return null;
    return `No se pudo crear el contenedor "${CONTAINER}": ${(e.message || '').slice(0, 200)}`;
  }
}

async function streamAString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * "Todavía no existe" es un estado normal aquí: antes del primer sync no hay
 * contenedor ni blobs, y eso debe leerse como "sin snapshot", no como avería.
 *
 * Se mira el código de error del SDK y no el texto del mensaje: Azure responde
 * "The specified container does not exist." sin nombrar ContainerNotFound en la
 * frase, así que una comparación por texto deja pasar el error y el reporte
 * termina mostrando un 502 en vez de decir que falta sincronizar.
 */
function esNoEncontrado(e) {
  if (!e) return false;
  const codigo = e.code || (e.details && e.details.errorCode) || '';
  if (codigo === 'BlobNotFound' || codigo === 'ContainerNotFound') return true;
  if (e.statusCode === 404) return true;
  return /BlobNotFound|ContainerNotFound|does not exist|no existe/i.test(e.message || '');
}

async function leer(container, clave) {
  try {
    const dl = await container.getBlobClient(clave).download();
    return JSON.parse(await streamAString(dl.readableStreamBody));
  } catch (e) {
    if (esNoEncontrado(e)) return null;
    throw e;
  }
}

async function escribir(container, clave, objeto) {
  const cuerpo = JSON.stringify(objeto);
  await container.getBlockBlobClient(clave).upload(
    cuerpo, Buffer.byteLength(cuerpo),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
  return objeto;
}

// ── maestros ────────────────────────────────────────────────────────────────
const leerMaestros    = c => leer(c, K_MAESTROS);
const guardarMaestros = (c, m) => escribir(c, K_MAESTROS, { ...m, _guardado: new Date().toISOString() });

function maestrosVencidos(maestros) {
  if (!maestros || !maestros._guardado) return true;
  // Migración de esquema: si el snapshot fue generado antes de que las
  // sucursales trajeran la ubicación del recinto (lat/lng/rango, para la
  // validación GPS del marcaje), se fuerza una regeneración aunque no haya
  // vencido por tiempo. `rango` ausente = esquema viejo; null = valor real.
  const sucs = (maestros.sucursales || []);
  if (sucs.length && sucs.every(s => s.rango === undefined)) return true;
  const edadMin = (Date.now() - Date.parse(maestros._guardado)) / 60000;
  return edadMin > TTL_MAESTROS_MIN;
}

// ── marcas por día ──────────────────────────────────────────────────────────
const leerMarcasDia = (c, fecha) => leer(c, kMarcas(fecha));

function guardarMarcasDia(c, fecha, marcas, extra = {}) {
  return escribir(c, kMarcas(fecha), {
    fecha,
    marcas,
    total: marcas.length,
    _guardado: new Date().toISOString(),
    _cerrado: diaCerrado(fecha),
    ...extra
  });
}

// Un día queda cerrado cuando ya pasó la ventana de gracia: no se vuelve a pedir.
function diaCerrado(fecha) {
  const edad = (Date.parse(hoyIso()) - Date.parse(fecha)) / 86400000;
  return edad > VENTANA_GRACIA_DIAS;
}

/**
 * ¿Qué días del rango hay que ir a buscar a Talana?
 * Se reconsulta un día si no está guardado, o si está guardado pero todavía
 * dentro de la ventana de gracia (pueden haber subido marcas atrasadas).
 */
async function diasPendientes(container, fechas) {
  const pendientes = [];
  const LOTE = 24;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const leidos = await Promise.all(grupo.map(f =>
      leerMarcasDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))
    ));
    for (const { f, d } of leidos) {
      if (!d) { pendientes.push(f); continue; }
      if (!d._cerrado && !diaCerrado(f)) { pendientes.push(f); continue; }
      // Guardado como abierto pero el día ya cerró: una última pasada y listo.
      if (!d._cerrado && diaCerrado(f)) pendientes.push(f);
    }
  }
  return pendientes;
}

/** Lee las marcas de un rango, en paralelo por lotes. */
async function leerMarcasRango(container, fechas) {
  const marcas = [];
  const faltantes = [];
  const LOTE = 24;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const dias = await Promise.all(grupo.map(f =>
      leerMarcasDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))
    ));
    for (const { f, d } of dias) {
      if (d && Array.isArray(d.marcas)) marcas.push(...d.marcas);
      else faltantes.push(f);
    }
  }
  return { marcas, faltantes };
}

// ── ausencias por mes ───────────────────────────────────────────────────────
const mesDe = fecha => String(fecha).slice(0, 7);

function mesesDelRango(desde, hasta) {
  const out = [];
  let d = new Date(desde.slice(0, 7) + '-01T00:00:00');
  const fin = new Date(hasta.slice(0, 7) + '-01T00:00:00');
  while (d <= fin) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

const leerAusenciasMes = (c, mes) => leer(c, kAusencias(mes));

const guardarAusenciasMes = (c, mes, ausencias, extra = {}) =>
  escribir(c, kAusencias(mes), {
    mes, ausencias, total: ausencias.length,
    _guardado: new Date().toISOString(), ...extra
  });

// Las ausencias del mes en curso y del anterior siguen moviéndose (aprobaciones
// retroactivas); los meses más viejos se refrescan sólo si faltan.
function ausenciasVencidas(bloque, mes) {
  if (!bloque || !bloque._guardado) return true;
  const mesActual = hoyIso().slice(0, 7);
  const reciente = mes >= mesesAtras(mesActual, 1);
  const edadMin = (Date.now() - Date.parse(bloque._guardado)) / 60000;
  return reciente ? edadMin > TTL_MAESTROS_MIN : false;
}

function mesesAtras(mes, n) {
  const d = new Date(mes + '-01T00:00:00');
  d.setMonth(d.getMonth() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const leerAvanceAusencias    = c => leer(c, K_AUS_PARCIAL);
const guardarAvanceAusencias = (c, a) =>
  escribir(c, K_AUS_PARCIAL, { ...a, _guardado: new Date().toISOString() });
// Terminada la traída, el parcial deja de tener sentido. No se borra el blob
// (haría falta permiso de borrado): se vacía, que para el caso es lo mismo.
const limpiarAvanceAusencias = c => escribir(c, K_AUS_PARCIAL, { data: [], cursores: {}, fallos: [], _cerrado: true });

// ── estado del sincronizador ────────────────────────────────────────────────
const leerEstado = c => leer(c, K_ESTADO);

const guardarEstado = (c, e) =>
  escribir(c, K_ESTADO, { ...e, _guardado: new Date().toISOString() });

module.exports = {
  getContainer, asegurarContenedor, leer, escribir, esNoEncontrado,
  leerMaestros, guardarMaestros, maestrosVencidos,
  leerMarcasDia, guardarMarcasDia, diasPendientes, leerMarcasRango, diaCerrado,
  leerAusenciasMes, guardarAusenciasMes, ausenciasVencidas, mesesDelRango, mesDe,
  leerAvanceAusencias, guardarAvanceAusencias, limpiarAvanceAusencias,
  leerEstado, guardarEstado,
  hoyIso, CONTAINER, VENTANA_GRACIA_DIAS, TTL_MAESTROS_MIN
};
