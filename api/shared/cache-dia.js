// ============================================================================
//  shared/cache-dia.js  ·  Caché histórico por DÍA en Azure Blob
//
//  Un blob por día:  hist/YYYY-MM-DD.json  con los conceptos ESTABLES ya
//  sumados (emisiones, retiros, devoluciones, recogida). Cualquier rango se
//  arma sumando días. Transferencias NO viven aquí (van en vivo).
//
//  Reglas de congelado:
//   - Día < hoy  → cerrado, se guarda para siempre.
//   - Día = hoy  → se puede regrabar (aún suma movimientos).
//  (El congelado de TRANSFERENCIAS por antigüedad es de la capa de arriba,
//   no de este caché: aquí solo viven conceptos estables.)
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const mov = require('./movimientos.js');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const PREFIJO   = 'hist/';

// ── helpers de fecha ────────────────────────────────────────────────────────
const hoyIso = () => new Date().toISOString().slice(0, 10);
const claveBlob = fecha => `${PREFIJO}${fecha}.json`;

function diaCerrado(fecha) { return fecha < hoyIso(); }   // < hoy = ya no cambia

// ¿Las transferencias de este día aún pueden subir? (dentro de la ventana de gracia)
function transferenciaProvisional(fecha) {
  const edad = (Date.parse(hoyIso()) - Date.parse(fecha)) / 86400000;
  return edad <= mov.VENTANA_TRANSFER_DIAS;
}

// Lista de fechas 'YYYY-MM-DD' entre desde y hasta, inclusive.
function rangoDias(desde, hasta) {
  const out = [];
  let d = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (d <= fin) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// ── acceso a Blob (inyectable para tests) ───────────────────────────────────
function getContainer() {
  return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
}
async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// ── leer un día ─────────────────────────────────────────────────────────────
async function leerDia(container, fecha) {
  try {
    const dl = await container.getBlobClient(claveBlob(fecha)).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound/.test(e.message)) return null;
    throw e;
  }
}

// ── guardar un día (solo conceptos estables) ────────────────────────────────
// acc = acumulador de movimientos.agregarPorDia()[fecha]
async function guardarDia(container, fecha, acc) {
  const dia = {
    fecha,
    ...mov.paraCache(acc),
    _guardado: new Date().toISOString(),
    _cerrado: diaCerrado(fecha)
  };
  const body = JSON.stringify(dia);
  await container.getBlockBlobClient(claveBlob(fecha)).upload(
    body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
  return dia;
}

// ── leer un rango: suma los días del caché y reporta los que faltan ──────────
// Devuelve { estables, faltantes, dias_leidos }.
//  - estables : suma de emisiones/retiros/devoluciones/recogida del rango.
//  - faltantes: fechas sin blob (el llamador decide si consultarlas en vivo).
async function leerRango(container, desde, hasta) {
  const fechas = rangoDias(desde, hasta);
  const leidos = [];
  const faltantes = [];
  // Lectura EN PARALELO por lotes: un rango largo (un año) ya no se lee día a
  // día en serie, evitando timeouts en comparaciones anuales.
  const LOTE = 24;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const dias = await Promise.all(grupo.map(f =>
      leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of dias) { if (d) leidos.push(d); else faltantes.push(f); }
  }
  return {
    movimiento: mov.combinarDias(leidos),
    faltantes,
    dias_leidos: leidos.length,
    dias_total: fechas.length,
    // true si algún día del rango cae en la ventana de gracia: sus transferencias
    // pueden estar incompletas y la capa de arriba debería refrescarlas en vivo.
    transferencias_provisional: fechas.some(transferenciaProvisional)
  };
}

module.exports = {
  getContainer, leerDia, guardarDia, leerRango,
  rangoDias, diaCerrado, transferenciaProvisional, claveBlob, CONTAINER
};