// ============================================================================
//  api/shared/pendientes-cruce.js  ·  Citas de Walmart que todavía no cruzan
//
//  EL PROBLEMA, MEDIDO. El reporte de Walmart trae citas que no tienen ninguna
//  transferencia en Redlink. No es un problema de ventana de fechas: el 10-nov
//  se buscaron 8 de esas citas contra 26.390 operaciones de 45 días, por número
//  de cita y dentro de las observaciones, y las 8 dieron cero. En octubre ya
//  habían dado cero 15 citas contra 47.745 operaciones de tres meses.
//
//  La hipótesis es que el cliente todavía no emitió la transferencia. Pero si
//  una cita es "todavía no" o "nunca" NO SE PUEDE SABER MIRÁNDOLA UN DÍA. Hay
//  que volver a mirarla mañana, y para eso tiene que quedar escrita en alguna
//  parte: el archivo de mañana ya no la trae.
//
//  Y no es papeleo: esas 8 citas sumaban 70 pallets que Walmart declara haber
//  recibido y que no tienen transferencia que los respalde.
//
//  QUÉ SE GUARDA: las FILAS ORIGINALES del reporte, no un resumen. Así volver
//  a cruzarlas mañana es llamar al mismo cruzar() que ya está probado, con las
//  mismas reglas, en vez de una segunda lógica de calce que se separaría de la
//  primera el día que alguien arregle una de las dos.
//
//  APPEND-ONLY con reductor, igual que la bitácora del andén. Una cita no se
//  edita: se le escribe encima otro evento y el estado vigente es el último de
//  la cadena. Eventos: 'vista' (apareció sin cruzar en un reporte), 'cruzo'
//  (por fin encontró su transferencia) y 'cerrada' (alguien la dio por
//  resuelta a mano).
//
//  Blob:  contenedor PENDIENTES_CONTAINER (def. 'redtec-confirmaciones')
//         pendientes/YYYY-MM.jsonl
//  Conexión: la misma que ya usan el historial, clientes-store y el andén.
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.PENDIENTES_STORAGE_CONN
          || process.env.CONFIRMACIONES_STORAGE_CONN
          || process.env.BLOB_CONNECTION_STRING
          || process.env.OS_STORAGE_CONN
          || process.env.ANDEN_STORAGE_CONN;
const CONTAINER = process.env.PENDIENTES_CONTAINER || 'redtec-confirmaciones';

// Cuántos días una cita es "todavía no cruza" antes de pasar a "hay que
// preguntar". Decidido con logística el 10-nov-2026: una semana da tiempo a
// que el cliente emita la transferencia sin que la lista se llene de casos
// viejos. No archiva nada — sólo cambia de qué lado de la lista aparece.
const DIAS_PARA_PREGUNTAR = Math.max(1, parseInt(process.env.PENDIENTES_DIAS || '7', 10) || 7);

// Cuántos meses hacia atrás se leen para reconstruir el estado. Una cita
// abierta hace más de esto deja de aparecer, y eso es deliberado: a los seis
// meses no es una pendiente, es una abandonada, y seguir leyéndola cada vez
// sólo haría la consulta más lenta cada mes que pasa.
const MESES_ATRAS = Math.max(1, parseInt(process.env.PENDIENTES_MESES || '6', 10) || 6);

const ACCIONES = ['vista', 'cruzo', 'cerrada'];

function contenedor() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes) { return 'pendientes/' + mes + '.jsonl'; }
function hayStorage() { return !!CONN; }

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
function esNoExiste(e) {
  const cod = String((e && (e.code || e.errorCode)) || '');
  const msg = String((e && e.message) || '');
  return !!e && (e.statusCode === 404
    || /BlobNotFound|ContainerNotFound/i.test(cod)
    || /BlobNotFound|ContainerNotFound|does not exist|not found/i.test(msg));
}

/* ------------------------------------------------- armar eventos --------- */

const LARGO = 120;
function texto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, LARGO);
}
function entero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && !v.trim()) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
// Una cita de Walmart es de OCHO dígitos. Cualquier otra cosa no entra: el
// campo es libre en el reporte y trae de todo.
const esCita = (v) => /^\d{8}$/.test(String(v == null ? '' : v).trim());

// Las filas del reporte, acotadas a los campos que cruzar() necesita. Guardar
// la fila entera dejaría entrar cualquier cosa que venga en el .xlsx.
const CAMPOS_FILA = ['cita', 'po', 'rut', 'cliente', 'cd', 'recepcion', 'fecha'];
const CAMPOS_NUM = ['total', 'malos', 'canje'];
function filaLimpia(f) {
  const out = {};
  CAMPOS_FILA.forEach(function (k) { out[k] = texto((f || {})[k]); });
  CAMPOS_NUM.forEach(function (k) { out[k] = entero((f || {})[k]) || 0; });
  return out;
}

function armarEvento(ev) {
  const e = ev || {};
  const ts = e.ts || new Date().toISOString();
  const accion = ACCIONES.indexOf(e.accion) >= 0 ? e.accion : 'vista';
  const filas = (Array.isArray(e.filas) ? e.filas : []).slice(0, 40).map(filaLimpia);
  return {
    ts: ts, dia: String(ts).slice(0, 10), accion: accion,
    cita: texto(e.cita),
    rut: texto(e.rut), cliente: texto(e.cliente),
    pallets: entero(e.pallets) || 0,
    fechaReporte: texto(e.fechaReporte),
    archivo: texto(e.archivo),
    quien: texto(e.quien),
    folio: entero(e.folio),
    motivo: texto(e.motivo),
    filas: filas
  };
}

/* ------------------------------------------------- reductor -------------- */

// El estado VIGENTE de cada cita. El orden es por `ts`, no por el orden del
// archivo: dos personas cruzando en dos computadores escriben en el mismo blob
// y el append no garantiza orden cronológico.
function estadoVigente(eventos, hoy) {
  const dia = hoy || new Date().toISOString().slice(0, 10);
  const orden = (eventos || []).slice().filter(function (e) { return e && esCita(e.cita); })
    .sort(function (a, b) { return String(a.ts || '').localeCompare(String(b.ts || '')); });
  const ix = Object.create(null);
  orden.forEach(function (e) {
    const c = String(e.cita);
    if (!ix[c]) {
      ix[c] = { cita: c, estado: 'abierta', desde: e.dia, visto: 0, ultimaVez: e.dia,
                rut: '', cliente: '', pallets: 0, fechaReporte: '', filas: [], folio: null, motivo: '' };
    }
    const x = ix[c];
    x.ultimaVez = e.dia;
    if (e.accion === 'vista') {
      x.visto++;
      x.estado = 'abierta';
      // Los datos del reporte MÁS RECIENTE ganan: Walmart corrige cantidades
      // de un día para otro y el informe tiene que decir la última.
      if (e.rut) x.rut = e.rut;
      if (e.cliente) x.cliente = e.cliente;
      if (e.pallets) x.pallets = e.pallets;
      if (e.fechaReporte) x.fechaReporte = e.fechaReporte;
      if (e.filas && e.filas.length) x.filas = e.filas;
      x.motivo = e.motivo || x.motivo;
    } else if (e.accion === 'cruzo') {
      x.estado = 'cruzo';
      x.folio = e.folio;
      x.resueltaEl = e.dia;
    } else if (e.accion === 'cerrada') {
      x.estado = 'cerrada';
      x.motivo = e.motivo || x.motivo;
      x.resueltaEl = e.dia;
    }
  });
  return Object.keys(ix).map(function (k) {
    const x = ix[k];
    x.dias = diasEntre(x.desde, dia);
    x.urgente = x.estado === 'abierta' && x.dias >= DIAS_PARA_PREGUNTAR;
    return x;
  });
}

function diasEntre(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b))) return 0;
  const d = Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  return d < 0 ? 0 : d;
}

const abiertas = (estados) => (estados || []).filter(function (e) { return e.estado === 'abierta'; });

// Por cliente, para que logística pueda ir a buscar la transferencia que falta.
// El que más pallets tiene en juego va primero: es plata, no papeleo.
function porCliente(estados) {
  const ix = Object.create(null);
  abiertas(estados).forEach(function (e) {
    const c = e.cliente || '(sin cliente)';
    if (!ix[c]) ix[c] = { cliente: c, rut: e.rut, citas: 0, pallets: 0, urgentes: 0,
                          masVieja: e.desde, filas: [] };
    const x = ix[c];
    x.citas++;
    x.pallets += e.pallets || 0;
    if (e.urgente) x.urgentes++;
    if (e.desde < x.masVieja) x.masVieja = e.desde;
    if (!x.rut) x.rut = e.rut;
    x.filas.push(e);
  });
  return Object.keys(ix).map(function (k) { return ix[k]; }).sort(function (a, b) {
    return b.pallets - a.pallets || b.urgentes - a.urgentes || a.cliente.localeCompare(b.cliente);
  });
}

/* ------------------------------------------------- blob ------------------ */

function mesesRecientes(hoy, cuantos) {
  const base = String(hoy || new Date().toISOString().slice(0, 10)).slice(0, 7);
  let y = Number(base.slice(0, 4)), m = Number(base.slice(5, 7));
  const out = [];
  for (let i = 0; i < Math.max(1, cuantos || MESES_ATRAS); i++) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m--; if (m < 1) { m = 12; y--; }
  }
  return out.reverse();
}

async function leerMes(mes) {
  if (!CONN) return [];
  try {
    const dl = await contenedor().getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean)
      .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];
    throw e;
  }
}

async function leerEstado(hoy, leer) {
  const traer = leer || leerMes;
  let ev = [];
  for (const m of mesesRecientes(hoy, MESES_ATRAS)) ev = ev.concat(await traer(m));
  return estadoVigente(ev, hoy);
}

// Escribir no puede tumbar nada: cuando esto corre, el cruce ya se mostró en
// pantalla y la persona ya está mirando sus confirmaciones. Que el registro de
// pendientes falle es un problema del registro, no del cruce.
async function registrar(eventos) {
  const evs = (Array.isArray(eventos) ? eventos : [eventos]).map(armarEvento)
    .filter(function (e) { return esCita(e.cita); });
  if (!evs.length) return { ok: true, escritos: 0, motivo: '' };
  if (!CONN) {
    return { ok: false, escritos: 0,
             motivo: 'no hay almacenamiento configurado (falta PENDIENTES_STORAGE_CONN o BLOB_CONNECTION_STRING)' };
  }
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const porMes = Object.create(null);
    evs.forEach(function (e) {
      const m = String(e.ts).slice(0, 7);
      (porMes[m] = porMes[m] || []).push(JSON.stringify(e));
    });
    for (const m of Object.keys(porMes)) {
      const ab = c.getAppendBlobClient(blobMes(m));
      await ab.createIfNotExists();
      const bloque = porMes[m].join('\n') + '\n';
      await ab.appendBlock(bloque, Buffer.byteLength(bloque));
    }
    return { ok: true, escritos: evs.length, motivo: '' };
  } catch (e) {
    return { ok: false, escritos: 0, motivo: (e && e.message) ? e.message : String(e) };
  }
}

module.exports = { registrar, leerMes, leerEstado, estadoVigente, armarEvento, filaLimpia,
                   abiertas, porCliente, diasEntre, mesesRecientes, esCita, texto, entero,
                   hayStorage, blobMes, esNoExiste, ACCIONES, CAMPOS_FILA,
                   DIAS_PARA_PREGUNTAR, MESES_ATRAS, CONTAINER };
