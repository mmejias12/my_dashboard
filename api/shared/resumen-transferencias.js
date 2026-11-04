// ============================================================================
//  shared/resumen-transferencias.js  ·  Transferencias GLOBALES mes a mes
//  (bloque PRECARGADO al contexto del agente)
//
//  Lee resumen/transferencias.json (el MISMO índice exacto que alimenta el
//  dashboard y consultar_contraparte: RDTOut directo, con confirmaciones
//  tardías) y arma un bloque compacto con la serie mensual del TOTAL
//  despachado/confirmado. Así el agente responde "transferencias mes a mes /
//  año a año" (globales, sin cliente) al instante y con el número exacto, sin
//  iterar herramientas ni usar el de los blobs diarios (que sub-cuenta).
//
//  Cacheado por instancia (TTL 60 min); el blob cambia una vez al día.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const BLOB      = 'resumen/transferencias.json';

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function cargar() {
  if (!CONN) return null;
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  try {
    const dl = await c.getBlobClient(BLOB).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound|does not exist|not found/i.test(e.message)) return null;
    throw e;
  }
}

const milesCL = n => Math.round(Number(n) || 0).toLocaleString('es-CL');

// total: { 'YYYY-MM': [despachado, confirmado, movs] }
function formato(d) {
  if (!d || !d.total || !Object.keys(d.total).length) return null;
  const meses = Object.keys(d.total).sort();
  const anioAct = parseInt(meses[meses.length - 1].slice(0, 4), 10);
  const desdeAnio = anioAct - 2;

  // Acumulado anual (confirmado y despachado) para comparaciones año a año.
  const anual = {};
  for (const m of meses) {
    const y = m.slice(0, 4);
    const [dsp, cnf] = d.total[m];
    const a = anual[y] || (anual[y] = { dsp: 0, cnf: 0 });
    a.dsp += dsp || 0; a.cnf += cnf || 0;
  }
  const confAnual = Object.keys(anual).sort()
    .map(y => `${y}: ${milesCL(anual[y].cnf)}`).join(' · ');

  const recientes = meses.filter(m => parseInt(m.slice(0, 4), 10) >= desdeAnio);
  const confMes = recientes.map(m => `${m} ${milesCL(d.total[m][1])}`).join(' · ');
  const dspMes  = recientes.map(m => `${m} ${milesCL(d.total[m][0])}`).join(' · ');

  return `[TRANSFERENCIAS GLOBALES · resumen precargado (fuente exacta transferencias.json, con confirmaciones tardías; hasta ${d.hasta || d.generado || 's/f'}; el mes en curso es parcial)]\n` +
    `Transferencias CONFIRMADAS por año (pallets): ${confAnual}.\n` +
    `Confirmadas por mes ${desdeAnio}–${anioAct}: ${confMes}.\n` +
    `Despachadas por mes ${desdeAnio}–${anioAct}: ${dspMes}.\n` +
    `Estas son las transferencias TOTALES (todos los retails juntos). Para el detalle por cliente/retail usa consultar_contraparte. ` +
    `"Confirmado" es el dato firme; "despachado" es lo que salió (parte aún por confirmar).`;
}

let _cache = { txt: null, ts: 0 };
async function bloqueContexto(context) {
  try {
    if (_cache.txt !== null && (Date.now() - _cache.ts) < 60 * 60 * 1000) return _cache.txt || null;
    const d = await cargar();
    const txt = formato(d);
    _cache = { txt: txt || '', ts: Date.now() };
    return txt || null;
  } catch (e) {
    if (context && context.log) context.log.warn('resumen transferencias: ' + e.message);
    return null;
  }
}

module.exports = { bloqueContexto, cargar, formato };
