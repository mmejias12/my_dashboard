// ============================================================================
//  shared/ingesta-core.js  ·  ESCRITURA del read model  (lógica compartida)
//
//  NO es una Function: no tiene function.json, así que Azure la ignora como
//  función y la trata como librería. La usan:
//    - api/os-ingesta-http/       (trigger HTTP, va en Static Web Apps)
//    - os-ingesta/ del Function App (trigger timer, va en redtecagente)
//
//  Estrategia PATCH (no overwrite): lee el snapshot actual, refresca solo las
//  galaxias que logra traer, y conserva el último valor de las demás. Así el
//  sistema "va agarrando forma" galaxia por galaxia sin perder lo ya guardado.
// ============================================================================
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_CONTAINER || 'os';
const BLOB      = process.env.OS_BLOB || 'os-snapshot.json';
// Base del sitio para llamar a los proxies que YA existen (stock, facturación, gps, workera).
const SITE      = process.env.OS_SITE_BASE || 'https://black-river-0b5a28810.7.azurestaticapps.net';

// Semilla mínima si el blob todavía no existe (primera corrida).
const DEFAULT_SNAPSHOT = require('./default-snapshot.json');
const rangos = require('./rangos.js'); // troceo <=180d y acumulación incremental

// --- helpers ---------------------------------------------------------------
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
  // FUENTE: RDTOut facturación/movimientos  ->  ${SITE}/api/facturacion-guias-proxy
  //         (semana en curso: emisiones/retiros/recogida/devoluciones)
  return null;
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
