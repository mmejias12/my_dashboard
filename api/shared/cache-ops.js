// ============================================================================
//  shared/cache-ops.js  ·  Snapshot histórico de OPERACIONES RDTOut en Blob
//
//  Por qué existe
//  ──────────────
//  El API de RDTOut entrega una ventana móvil. Lo que sale de esa ventana no se
//  puede volver a pedir: se pierde. Cada día que pasa sin guardar, se pierde un
//  día de historia de forma irreversible. Este módulo la conserva.
//
//  A diferencia del GPS, acá el problema no es la velocidad (el API responde en
//  una sola llamada, sin límite de frecuencia) sino la RETENCIÓN. Por eso el
//  snapshot se graba de forma oportunista en cada consulta: mientras alguien
//  use el informe, la historia se va guardando sola.
//
//  Un blob por día:  ops/YYYY-MM-DD.json
//  Un día se guarda sólo cuando ya está cerrado (ver DIAS_VIVOS): una operación
//  del día en curso todavía puede cambiar de etapa o de cantidad confirmada.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_OPS_CONTAINER || process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const PREFIJO   = 'ops/';

// Una operación del día en curso puede cambiar (se confirma, se anula), así que
// no se congela hasta que pasen estos días.
const DIAS_VIVOS = Math.max(1, parseInt(process.env.OS_OPS_DIAS_VIVOS || '2', 10));

const hoyIso = () => new Date().toISOString().slice(0, 10);
const claveBlob = fecha => `${PREFIJO}${fecha}.json`;

function desdeVivo() {
  const d = new Date(hoyIso() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (DIAS_VIVOS - 1));
  return d.toISOString().slice(0, 10);
}
function diaCerrado(fecha) { return fecha < desdeVivo(); }

function rangoDias(desde, hasta) {
  const out = [];
  let d = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (d <= fin) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

function hayStorage() { return !!CONN; }

let _container = null;
function getContainer() {
  if (!CONN) return null;
  if (!_container) _container = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  return _container;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/** Días que toca una operación, según las tres fechas que trae RDTOut. */
function diasDeOp(o) {
  return [o.fechaConfirmacion, o.fechaDespacho, o.fechaRequerida]
    .map(f => String(f || '').slice(0, 10)).filter(Boolean);
}

async function leerDia(container, fecha) {
  if (!container) return null;
  try {
    const dl = await container.getBlobClient(claveBlob(fecha)).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound|AuthenticationFailed/.test(e.message)) return null;
    throw e;
  }
}

async function guardarDia(container, fecha, ops) {
  if (!container) return null;
  if (!diaCerrado(fecha)) return null;
  const dia = { fecha, ops: ops || [], _guardado: new Date().toISOString(), _origen: 'rdtout' };
  const body = JSON.stringify(dia);
  await container.getBlockBlobClient(claveBlob(fecha)).upload(
    body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
  return dia;
}

/** Lee del caché los días de un rango. Devuelve ops y las fechas que faltaban. */
async function leerRango(container, desde, hasta) {
  const fechas = rangoDias(desde, hasta);
  const ops = [], faltantes = [];
  if (!container) return { ops, faltantes: fechas, dias_cache: 0, sin_storage: true };
  const LOTE = 24;
  let leidos = 0;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const res = await Promise.all(grupo.map(f =>
      leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of res) {
      if (d) { ops.push(...(d.ops || [])); leidos++; } else faltantes.push(f);
    }
  }
  return { ops, faltantes, dias_cache: leidos, sin_storage: false };
}

/**
 * Graba como snapshot los días CERRADOS presentes en un lote de operaciones.
 * Sólo escribe los días que aún no estén guardados: así el uso normal del
 * informe va acumulando historia sin costo perceptible.
 * Devuelve {guardados:[fechas], yaEstaban:[fechas]}.
 */
async function sembrar(container, ops, opciones) {
  const o = opciones || {};
  if (!container) return { guardados: [], yaEstaban: [] };
  const porDia = {};
  (ops || []).forEach(op => {
    [...new Set(diasDeOp(op))].forEach(f => {
      if (!diaCerrado(f)) return;
      (porDia[f] = porDia[f] || []).push(op);
    });
  });
  const fechas = Object.keys(porDia).sort();
  const guardados = [], yaEstaban = [];
  for (const f of fechas) {
    if (o.alcanzaTiempo && !o.alcanzaTiempo()) break;
    if (!o.regrabar) {
      const ya = await leerDia(container, f).catch(() => null);
      if (ya) { yaEstaban.push(f); continue; }
    }
    try { await guardarDia(container, f, porDia[f]); guardados.push(f); } catch (e) { /* best-effort */ }
  }
  return { guardados, yaEstaban };
}

/** Quita duplicados por número de pedido, conservando el primero visto. */
function dedup(ops) {
  const vistos = new Set(), out = [];
  (ops || []).forEach(o => {
    const k = String(o.nroPedido != null ? o.nroPedido : JSON.stringify(o));
    if (vistos.has(k)) return;
    vistos.add(k); out.push(o);
  });
  return out;
}

module.exports = {
  getContainer, hayStorage, leerDia, guardarDia, leerRango, sembrar, dedup,
  diasDeOp, rangoDias, diaCerrado, desdeVivo, claveBlob, CONTAINER, DIAS_VIVOS, PREFIJO
};
