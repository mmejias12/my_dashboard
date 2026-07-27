// ============================================================================
//  shared/ingesta-core.js  ·  ESCRITURA del read model  (lógica compartida)
//
//  NO es una Function: no tiene function.json, así que Azure la ignora como
//  función y la trata como librería. La usan: (incluye coquimbo y talca)
//    - api/os-ingesta-http/       (trigger HTTP, va en Static Web Apps)
//    - os-ingesta/ del Function App (trigger timer, va en redtecagente)
//
//  Estrategia PATCH (no overwrite): lee el snapshot actual, refresca solo las
//  galaxias que logra traer, y conserva el último valor de las demás. Así el
//  sistema "va agarrando forma" galaxia por galaxia sin perder lo ya guardado.
// ============================================================================
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
// Azure exige 3-63 caracteres para el nombre de contenedor: 'os' es inválido.
const CONTAINER = process.env.OS_CONTAINER || 'redtec-os';
const BLOB      = process.env.OS_BLOB || 'os-snapshot.json';
// Base del sitio para llamar a los proxies que YA existen (stock, facturación, gps, workera).
const SITE      = process.env.OS_SITE_BASE || 'https://black-river-0b5a28810.7.azurestaticapps.net';

// Semilla mínima si el blob todavía no existe (primera corrida).
const DEFAULT_SNAPSHOT = require('./default-snapshot.json');
const rangos = require('./rangos.js'); // troceo <=180d y acumulación incremental

// --- helpers ---------------------------------------------------------------
// Valida el nombre de contenedor antes de llamar a Azure, para dar un error
// entendible en vez del críptico "resource name length is not within limits".
function validarContenedor(nombre) {
  if (!/^[a-z0-9]([a-z0-9-]{1,61})[a-z0-9]$/.test(nombre || '')) {
    throw new Error(
      `OS_CONTAINER inválido: "${nombre}". Azure exige 3-63 caracteres, ` +
      `minúsculas, números o guiones, empezando y terminando en alfanumérico.`
    );
  }
}

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}


// ── Movimientos: /api/ops -> pbi/OpsXRangoFechas ────────────────────────────
// Cada fila trae (confirmado en mapa-retiros.html):
//   { operacion, cantidadConfirmada, bodegaOrigenStr, ... }
// 'operacion' viene como texto legible ("retiro", "Emisión", ...), así que se
// compara normalizado (sin tildes, minúsculas) en vez de por código: resiste
// cambios de mayúsculas y acentos en el origen.
// Llama DIRECTO a RDTOut, no al proxy /api/ops de la SWA: la ingesta corre en
// el servidor y no tiene la sesión Entra ID del portal, así que /api/* le
// respondería con el login. La API remota usa X-Api-Key y ?desde=&hasta=.
const OPS_HOST = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const OPS_PATH = process.env.OS_OPS_PATH || '/api/RDTOut/opsxrangofechas';
const RDT_KEY  = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                 .trim().toLowerCase();

// Orden importa: se toma la primera coincidencia por substring.
const CONCEPTOS = [
  ['transferencias', ['transferencia']],
  ['devoluciones',   ['devolucion']],
  ['recogida',       ['recogida', 'recoleccion']],
  ['emisiones',      ['emision']],
  ['retiros',        ['retiro']]
];

function conceptoDe(operacion) {
  const o = norm(operacion);
  if (!o) return null;
  for (const [concepto, claves] of CONCEPTOS) {
    if (claves.some(k => o.includes(k))) return concepto;
  }
  return null;   // operación no mapeada: se ignora, nunca se adivina
}

// Planta del movimiento. Orden de preferencia:
//   1) campo 'planta' que ya entrega el proxy
//   2) bodega de origen  (correcta para EMISIONES: sale de la planta REDTEC)
//   3) bodega de destino (correcta para RETIROS: el pallet vuelve a la planta)
// En retiros la bodega de origen es el cliente/retail, no la planta; por eso
// no se puede depender solo de origen. Si nada resuelve, devuelve null y el
// desglose no se inventa: el total igual queda correcto.
// Misma regla que calendario-retiro-pallets.html: Talca / Coquimbo por nombre,
// y TODO lo demás cae en Santiago (planta por defecto de la operación).
// El campo real es 'bodegaDestino' (el pallet vuelve a la planta en un retiro).
function plantaDeTexto(texto) {
  const b = String(texto || '').toUpperCase();
  if (b.indexOf('COQUIMBO') !== -1) return 'coquimbo';
  if (b.indexOf('TALCA') !== -1) return 'talca';
  return 'santiago';
}
function plantaDe(fila) {
  // Prioridad: destino (planta de retorno en retiros) > campo planta > origen.
  const ref = fila.bodegaDestino || fila.bodegaDestinoStr || fila.planta || fila.bodegaOrigenStr;
  return plantaDeTexto(ref);   // siempre resuelve: nunca deja el desglose en 0
}

// Suma las filas del API al shape que consume el asistente.
function agregarMovimientos(filas) {
  const z = () => ({ total: 0, santiago: 0, talca: 0, coquimbo: 0 });
  const acc = { emisiones: z(), retiros: z(), recogida: 0, devoluciones: 0,
                transferencias: 0, _sinMapear: {} };

  for (const f of filas) {
    const concepto = conceptoDe(f.operacion);
    const v = Number(f.cantidadConfirmada) || 0;
    if (!concepto) {
      const k = norm(f.operacion) || '(vacío)';
      acc._sinMapear[k] = (acc._sinMapear[k] || 0) + v;   // queda visible en el log
      continue;
    }
    if (concepto === 'emisiones' || concepto === 'retiros') {
      acc[concepto].total += v;
      acc[concepto][plantaDe(f)] += v;
    } else {
      acc[concepto] += v;
    }
  }
  return acc;
}

// Número de semana ISO-8601 a partir de una fecha 'YYYY-MM-DD'.
function numeroSemanaISO(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);            // jueves de esa semana
  const yStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yStart) / 86400000) + 1) / 7);
}

// Semana en curso, lunes a sábado (igual que el modelo de KPIs del Excel).
function semanaEnCurso(hoyIso) {
  const d = new Date(hoyIso + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  const lun = new Date(d); lun.setUTCDate(d.getUTCDate() - (dow - 1));
  const sab = new Date(lun); sab.setUTCDate(lun.getUTCDate() + 5);
  const iso = x => x.toISOString().slice(0, 10);
  return { desde: iso(lun), hasta: iso(sab) };
}

// --- REFRESCADORES POR GALAXIA ---------------------------------------------
// Cada uno devuelve el objeto de su galaxia YA agregado, o null para conservar
// el valor previo. A medida que conectemos cada fuente, se completa el cuerpo.

async function refreshPool(prev, ctx) {
  // FUENTE: Stock SAP  ->  ${SITE}/api/sap-stock-proxy  (o stocks-clientes)
  // TODO: mapear la respuesta real al shape del pool.
  // Ejemplo de patrón (ajustar al JSON real del proxy):
  //   const d = await fetchJson(`${SITE}/api/sap-stock-proxy`);
  //   return { ...prev, foto: new Date().toISOString().slice(0,10),
  //            disponibles: d.disponibles, total: d.total, ... };
  return null; // conservar previo hasta cablear
}

async function refreshPallet(prev, ctx) {
  // OpsXRangoFechas se cuelga con rangos > 180 días: rangos.js trocea siempre.
  const url = (d, h) => `${OPS_HOST}${OPS_PATH}?desde=${d}&hasta=${h}`;
  const pedir = async (d, h) => {
    const r = await fetchJson(url(d, h), { headers: { 'X-Api-Key': RDT_KEY } });
    return agregarMovimientos(Array.isArray(r) ? r : [r]);
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const { desde, hasta } = semanaEnCurso(hoy);

  // 1) Semana en curso: ventana corta, una sola consulta.
  const semana = await pedir(desde, hasta);
  const sm = Object.entries(semana._sinMapear || {});
  if (sm.length) ctx.log.warn('operaciones sin mapear: ' + sm.map(([k, v]) => `${k}=${v}`).join(', '));
  delete semana._sinMapear;

  // 2) Acumulado del año: incremental; solo pide los días nuevos.
  const sumaTrozo = async ({ desde, hasta }) => {
    const a = await pedir(desde, hasta);
    return { emisiones: a.emisiones.total, retiros: a.retiros.total,
             transferencias: a.transferencias, recogidas: a.recogida,
             devoluciones: a.devoluciones, reparaciones: 0 };
  };
  const combinar = (a, b) => ({
    emisiones: a.emisiones + b.emisiones, retiros: a.retiros + b.retiros,
    transferencias: a.transferencias + b.transferencias,
    recogidas: a.recogidas + b.recogidas, devoluciones: a.devoluciones + b.devoluciones,
    reparaciones: (a.reparaciones || 0) + (b.reparaciones || 0)
  });
  const acum = await rangos.acumularIncremental(
    (prev && prev._acum) || null, hoy, `${new Date().getUTCFullYear()}-01-01`,
    sumaTrozo, combinar
  );
  ctx.log(`pallet: acumulado ${acum.modo} (consolidado al ${acum.consolidado_hasta})`);

  return {
    ...prev,
    estado: 'conectado',
    fuente: ['RDTOut · OpsXRangoFechas'],
    periodo_semana: { desde, hasta },
    semana,
    acumulado_2026: acum.valor,
    _acum: { valor: acum.valor, consolidado_hasta: acum.consolidado_hasta }
  };
}

async function refreshTransporte(prev, ctx) {
  // FUENTE: GPS Condor  ->  ${SITE}/api/gps-stops-proxy  (11 camiones)
  //   const flota = await fetchJson(`${SITE}/api/gps-stops-proxy`);
  //   return { ...prev, estado:'conectado', flota:{ total:.., en_ruta:.., sin_gps:[..] } };
  return null;
}

async function refreshColaborador(prev, ctx) {
  // FUENTE: Workera  ->  ${SITE}/api/workera-*  (dotación + asistencia del día)
  return null;
}

async function refreshCliente(prev, ctx) {
  // FUENTE: RDTOut facturacionconguias  (crecimiento del mes por cliente)
  return null;
}

// registro { clave_galaxia: refrescador }
const REFRESHERS = {
  pool: refreshPool,
  pallet: refreshPallet,
  transporte: refreshTransporte,
  colaborador: refreshColaborador,
  cliente: refreshCliente
};

// --- núcleo ----------------------------------------------------------------
async function loadCurrent(container) {
  try {
    const dl = await container.getBlobClient(BLOB).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT)); // primera vez
  }
}

async function runIngesta(ctx) {
  validarContenedor(CONTAINER);
  const svc = BlobServiceClient.fromConnectionString(CONN);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();

  const snap = await loadCurrent(container);
  snap.galaxias = snap.galaxias || {};

  const refreshed = [];
  for (const [clave, fn] of Object.entries(REFRESHERS)) {
    try {
      const nuevo = await fn(snap.galaxias[clave] || {}, ctx);
      if (nuevo) { snap.galaxias[clave] = nuevo; refreshed.push(clave); }
    } catch (e) {
      ctx.log.warn(`galaxia ${clave} no refrescada: ${e.message}`); // conserva previo
    }
  }

  // timestamp del refresco
  snap.meta = snap.meta || {};
  snap.meta.generado = new Date().toISOString();
  snap.meta.zona_horaria = 'America/Santiago';
  snap.meta.refrescadas = refreshed;

  // El periodo vigente lo manda la galaxia pallet (el movimiento define la
  // semana en curso). Se sube a meta para que buildCtx calcule bien la
  // antigüedad; si pallet aún no refrescó, se conserva el que hubiera.
  const perPallet = snap.galaxias.pallet && snap.galaxias.pallet.periodo_semana;
  if (perPallet && perPallet.desde && perPallet.hasta) {
    snap.meta.periodo_semana = {
      numero: numeroSemanaISO(perPallet.desde),
      desde: perPallet.desde,
      hasta: perPallet.hasta
    };
  }

  const body = JSON.stringify(snap, null, 2);
  const blockBlob = container.getBlockBlobClient(BLOB);
  await blockBlob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
  });
  ctx.log(`snapshot escrito. galaxias refrescadas: [${refreshed.join(', ') || 'ninguna (solo timestamp)'}]`);
  return snap;
}

// La lógica queda expuesta para que cada trigger (HTTP o timer) la invoque.
module.exports = { runIngesta, rangos };
