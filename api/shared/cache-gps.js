// ============================================================================
//  shared/cache-gps.js  ·  Caché histórico de PARADAS DEL GPS en Azure Blob
//
//  Por qué existe
//  ──────────────
//  El proveedor del GPS (WideTech/ShareService) rechaza consultas separadas por
//  menos de 20 segundos. Con 11 patentes, consultar una semana en vivo son unos
//  4 minutos de espera cada vez que alguien abre el informe. Pero una parada ya
//  TERMINADA de una semana vencida no va a cambiar nunca: se puede guardar una
//  vez y no volver a preguntarla jamás.
//
//  Qué se guarda
//  ─────────────
//  Un blob por patente y día:  gps/<PATENTE>/<YYYY-MM-DD>.json
//  Se guarda el día completo, incluso si no tuvo paradas: un día vacío GUARDADO
//  ("el camión no se movió") es un dato distinto de un día NO CONSULTADO, y
//  confundirlos fue justamente el error que este informe arrastró por meses.
//  Por eso el blob lleva 'paradas: []' y no se omite.
//
//  Cuándo un día está cerrado
//  ──────────────────────────
//  No basta con "ayer ya pasó". El API sólo reporta paradas TERMINADAS, así que
//  una parada que empezó anoche y terminó esta mañana recién aparece hoy. Por
//  eso se deja una ventana de gracia (DIAS_VIVOS, 2 por omisión): los últimos
//  días siempre se consultan en vivo y no se congelan.
//
//  Convenciones tomadas de shared/cache-dia.js: mismo OS_STORAGE_CONN, misma
//  lectura en lotes paralelos, mismo contrato de "faltantes" para que quien
//  llama decida si consulta en vivo lo que no está.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_GPS_CONTAINER || process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const PREFIJO   = 'gps/';

// Días que NUNCA se congelan: se consultan siempre en vivo.
const DIAS_VIVOS = Math.max(1, parseInt(process.env.OS_GPS_DIAS_VIVOS || '2', 10));

const hoyIso = () => new Date().toISOString().slice(0, 10);

function claveBlob(placa, fecha) {
  return `${PREFIJO}${String(placa).toUpperCase()}/${fecha}.json`;
}

/** Primer día que todavía se considera "vivo" (no cacheable). */
function desdeVivo() {
  const d = new Date(hoyIso() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (DIAS_VIVOS - 1));
  return d.toISOString().slice(0, 10);
}

/** Un día cerrado ya no cambia: se puede leer del caché sin preguntar. */
function diaCerrado(fecha) { return fecha < desdeVivo(); }

function rangoDias(desde, hasta) {
  const out = [];
  let d = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (d <= fin) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/** true si hay storage configurado. Sin esto el caché se desactiva solo. */
function hayStorage() { return !!CONN; }

let _container = null;
function getContainer() {
  if (!CONN) return null;
  if (!_container) {
    _container = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  }
  return _container;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// ── leer un día de una patente ──────────────────────────────────────────────
// Devuelve {placa, fecha, paradas:[...]} o null si no está cacheado.
async function leerDia(container, placa, fecha) {
  if (!container) return null;
  try {
    const dl = await container.getBlobClient(claveBlob(placa, fecha)).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound|AuthenticationFailed/.test(e.message)) return null;
    throw e;
  }
}

// ── guardar un día ──────────────────────────────────────────────────────────
// Se niega a guardar un día que todavía está vivo: congelarlo antes de tiempo
// dejaría el dato incompleto para siempre, que es peor que no tenerlo.
async function guardarDia(container, placa, fecha, paradas, chofer) {
  if (!container) return null;
  if (!diaCerrado(fecha)) return null;
  const dia = {
    placa: String(placa).toUpperCase(),
    fecha,
    chofer: chofer || null,
    paradas: paradas || [],          // [] es un dato: el camión no se movió
    _guardado: new Date().toISOString(),
    _origen: 'gps-condor'
  };
  const body = JSON.stringify(dia);
  await container.getBlockBlobClient(claveBlob(placa, fecha)).upload(
    body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
  return dia;
}

/**
 * Lee del caché todo lo que haya para esas patentes en ese rango.
 * Devuelve:
 *   items      — paradas encontradas, ya aplanadas
 *   faltantes  — [{placa, fecha}] de días CERRADOS que no estaban cacheados
 *   vivos      — [{placa, fecha}] de días dentro de la ventana viva
 * Quien llama decide qué hacer con faltantes y vivos: este módulo no consulta
 * al proveedor, sólo administra lo guardado.
 */
async function leerRango(container, placas, desde, hasta) {
  const fechas = rangoDias(desde, hasta);
  const items = [], faltantes = [], vivos = [];
  const diasCacheados = [];

  if (!container) {
    // Sin storage: todo se resuelve en vivo, sin romper nada.
    placas.forEach(p => fechas.forEach(f => (diaCerrado(f) ? faltantes : vivos).push({ placa: p, fecha: f })));
    return { items, faltantes, vivos, dias_cache: 0, sin_storage: true };
  }

  const pares = [];
  placas.forEach(p => fechas.forEach(f => {
    if (diaCerrado(f)) pares.push({ placa: p, fecha: f });
    else vivos.push({ placa: p, fecha: f });
  }));

  // Lectura EN PARALELO por lotes. Un mes de 11 patentes son ~340 blobs; en
  // serie eso se pasa del presupuesto de la función, en lotes no.
  const LOTE = 32;
  for (let i = 0; i < pares.length; i += LOTE) {
    const grupo = pares.slice(i, i + LOTE);
    const res = await Promise.all(grupo.map(x =>
      leerDia(container, x.placa, x.fecha).then(d => ({ x, d })).catch(() => ({ x, d: null }))));
    for (const { x, d } of res) {
      if (d) { items.push(...(d.paradas || [])); diasCacheados.push(x); }
      else faltantes.push(x);
    }
  }
  return { items, faltantes, vivos, dias_cache: diasCacheados.length, sin_storage: false };
}

/** Agrupa paradas sueltas por patente y día, para poder guardarlas. */
function agruparPorDia(items) {
  const out = {};
  (items || []).forEach(it => {
    const placa = String(it.plate || it.placa || '').toUpperCase();
    const fecha = String(it.start || '').slice(0, 10).replace(/\//g, '-');
    if (!placa || !fecha) return;
    const k = placa + '|' + fecha;
    if (!out[k]) out[k] = { placa, fecha, chofer: it.name || null, paradas: [] };
    out[k].paradas.push(it);
  });
  return Object.values(out);
}

module.exports = {
  getContainer, hayStorage, leerDia, guardarDia, leerRango, agruparPorDia,
  rangoDias, diaCerrado, desdeVivo, claveBlob, CONTAINER, DIAS_VIVOS, PREFIJO
};
