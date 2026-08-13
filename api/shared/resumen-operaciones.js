// ============================================================================
//  shared/resumen-operaciones.js  ·  Resumen histórico PRECARGADO (contexto)
//
//  Carga el rollup mensual/anual (resumen/operaciones.json en redtec-os-hist,
//  generado por scripts/rollup-operaciones.js) y arma un bloque compacto para
//  inyectar en el system prompt. Así el agente compara años y describe el mes a
//  mes SIN leer cientos de blobs diarios. Cacheado por instancia (TTL 60 min).
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const BLOB      = 'resumen/operaciones.json';

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function cargarRollup() {
  if (!CONN) return null;
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  try {
    const dl = await c.getBlobClient(BLOB).download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound/.test(e.message)) return null;
    throw e;
  }
}

const milesCL = n => Math.round(Number(n) || 0).toLocaleString('es-CL');

// Arma el bloque de texto compacto (o null si no hay rollup).
function formato(roll) {
  if (!roll || !roll.anual || !Object.keys(roll.anual).length) return null;
  const anios = Object.keys(roll.anual).sort();
  const ultimo = anios[anios.length - 1];
  const anioAct = parseInt(ultimo, 10);
  const desdeAnio = anioAct - 2;                       // últimos 3 años para el mes a mes

  const emiAnual = anios.map(a => `${a}: ${milesCL(roll.anual[a].emisiones.total)}`).join(' · ');
  const retAnual = anios.map(a => `${a}: ${milesCL(roll.anual[a].retiros.total)}`).join(' · ');
  const pl = roll.anual[ultimo].emisiones;
  const plantaLinea = `Emisiones ${ultimo} por planta: Santiago ${milesCL(pl.santiago)}, Talca ${milesCL(pl.talca)}, Coquimbo ${milesCL(pl.coquimbo)}.`;

  const meses = Object.keys(roll.mensual || {})
    .filter(m => parseInt(m.slice(0, 4), 10) >= desdeAnio).sort();
  const emiMes = meses.map(m => `${m} ${milesCL(roll.mensual[m].emisiones.total)}`).join(' · ');
  const retMes = meses.map(m => `${m} ${milesCL(roll.mensual[m].retiros.total)}`).join(' · ');

  return `[HISTÓRICO OPERACIONES · resumen precargado (${roll.desde}→${roll.hasta}; el año/mes en curso es parcial)]\n` +
    `Emisiones por año (pallets): ${emiAnual}.\n` +
    `Retiros por año: ${retAnual}.\n` +
    `${plantaLinea}\n` +
    `Emisiones por mes ${desdeAnio}–${anioAct}: ${emiMes}.\n` +
    `Retiros por mes ${desdeAnio}–${anioAct}: ${retMes}.\n` +
    `Usa estos totales para comparaciones anuales/mensuales y análisis de tendencia SIN llamar herramientas. ` +
    `Recurre a consultar_operacion solo para rangos puntuales que no estén aquí o para el detalle por cliente/bodega.`;
}

// Cache por instancia (incluye el caso "sin rollup" para no releer el blob).
let _cache = { txt: null, ts: 0 };
async function bloqueContexto(context) {
  try {
    if (_cache.txt !== null && (Date.now() - _cache.ts) < 60 * 60 * 1000) return _cache.txt || null;
    const roll = await cargarRollup();
    const txt = formato(roll);
    _cache = { txt: txt || '', ts: Date.now() };
    return txt || null;
  } catch (e) {
    if (context && context.log) context.log.warn('resumen ops: ' + e.message);
    return null;
  }
}

module.exports = { bloqueContexto, cargarRollup, formato };