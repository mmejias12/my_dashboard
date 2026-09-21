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
  const trfAnual = anios.map(a => `${a}: ${milesCL(roll.anual[a].transferencias)}`).join(' · ');
  const devAnual = anios.map(a => `${a}: ${milesCL(roll.anual[a].devoluciones)}`).join(' · ');
  const trfMes = meses.map(m => `${m} ${milesCL(roll.mensual[m].transferencias)}`).join(' · ');

  return `[HISTÓRICO OPERACIONES · resumen precargado (${roll.desde}→${roll.hasta}; el año/mes en curso es parcial)]\n` +
    `Emisiones por año (pallets): ${emiAnual}.\n` +
    `Retiros por año: ${retAnual}.\n` +
    `Transferencias por año: ${trfAnual}.\n` +
    `Devoluciones por año: ${devAnual}.\n` +
    `${plantaLinea}\n` +
    `Emisiones por mes ${desdeAnio}–${anioAct}: ${emiMes}.\n` +
    `Retiros por mes ${desdeAnio}–${anioAct}: ${retMes}.\n` +
    `Transferencias por mes ${desdeAnio}–${anioAct}: ${trfMes}.\n` +
    `Usa estos TOTALES para comparaciones anuales/mensuales y tendencia SIN llamar herramientas. ` +
    `Para el desglose de un concepto POR CLIENTE en un período (ej. "transferencias a Walmart mes a mes"), usa la herramienta consultar_movimiento_cliente (es instantánea). ` +
    `Recurre a consultar_operacion solo para rangos puntuales que no estén aquí.`;
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

// Cache del rollup COMPLETO (objeto), para la herramienta por cliente (TTL 60 min).
let _roll = { data: undefined, ts: 0 };
async function rollupCache() {
  if (_roll.data !== undefined && (Date.now() - _roll.ts) < 60 * 60 * 1000) return _roll.data;
  const data = await cargarRollup();
  _roll = { data: data || null, ts: Date.now() };
  return _roll.data;
}

// ── Herramienta: movimiento de un concepto POR CLIENTE (instantánea) ─────────
const reISO = /^\d{4}-\d{2}-\d{2}$/;
const hoyIso = () => new Date().toISOString().slice(0, 10);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

function normConcepto(s) {
  const x = String(s || '').toLowerCase();
  if (x.includes('emis')) return 'emisiones';
  if (x.includes('retir')) return 'retiros';
  if (x.includes('transf')) return 'transferencias';
  if (x.includes('devol')) return 'devoluciones';
  return null;
}
// Lista de meses 'YYYY-MM' entre dos fechas ISO, inclusive.
function mesesEntre(desde, hasta) {
  const out = [];
  let y = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const fy = +hasta.slice(0, 4), fm = +hasta.slice(5, 7);
  while (y < fy || (y === fy && m <= fm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

async function consultarClienteConcepto({ concepto, entidad, desde, hasta }, context) {
  const c = normConcepto(concepto);
  if (!c) throw new Error('concepto inválido: usa emisiones, retiros, transferencias o devoluciones');
  if (!entidad || !String(entidad).trim()) throw new Error('falta el cliente (entidad)');
  const hoy = hoyIso();
  hasta = reISO.test(hasta || '') ? (hasta > hoy ? hoy : hasta) : hoy;
  desde = reISO.test(desde || '') ? desde : (hasta.slice(0, 4) - 1) + hasta.slice(4) ; // ~12 meses por defecto
  if (desde > hasta) throw new Error('desde > hasta');

  const roll = await rollupCache();
  if (!roll || !roll.mensual_cliente) {
    return { concepto: c, entidad, desde, hasta, disponible: false,
      nota: 'El resumen por cliente aún no está generado (corre el rollup). Mientras tanto usa consultar_operacion.' };
  }

  const term = norm(entidad);
  const meses = mesesEntre(desde, hasta);
  const porMes = [];
  const nombres = new Set();
  let total = 0;
  for (const mes of meses) {
    const mapa = (roll.mensual_cliente[mes] && roll.mensual_cliente[mes][c]) || {};
    let sub = 0;
    for (const nombre in mapa) {
      if (norm(nombre).includes(term)) { sub += mapa[nombre]; nombres.add(nombre); }
    }
    porMes.push({ mes, cantidad: sub });
    total += sub;
  }

  if (context && context.log) context.log(`mov_cliente ${c} "${entidad}" ${desde}..${hasta}: total ${total}`);

  return {
    concepto: c, entidad, desde, hasta,
    total,
    por_mes: porMes,
    clientes_incluidos: Array.from(nombres),
    hasta_datos: roll.hasta,
    nota: hasta > roll.hasta ? `Los datos llegan hasta ${roll.hasta}; los días posteriores no están en el resumen aún.` : undefined
  };
}

const TOOL_SCHEMA = {
  name: 'consultar_movimiento_cliente',
  description:
    'Devuelve, AL INSTANTE (desde el resumen precalculado), el movimiento de un ' +
    'concepto para UN CLIENTE, mes a mes y total, en un período — incluso 12 ' +
    'meses o varios años. Conceptos: emisiones, retiros, transferencias, ' +
    'devoluciones. "a/para el cliente" usa el destino (emisiones, transferencias); ' +
    '"del cliente" usa el origen (retiros, devoluciones). Úsala SIEMPRE para ' +
    'preguntas del tipo "transferencias a Walmart mes a mes / últimos 12 meses", ' +
    '"cuántas emisiones le hicimos a <cliente> este año", "retiros de <retail> por ' +
    'mes". NO leas el histórico día por día para esto: esta herramienta ya lo tiene ' +
    'agregado. Pasa el cliente/retail en `entidad` (basta una parte del nombre).',
  input_schema: {
    type: 'object',
    properties: {
      concepto: { type: 'string', description: 'emisiones | retiros | transferencias | devoluciones' },
      entidad:  { type: 'string', description: 'Cliente o retail (o parte del nombre), ej. "Walmart"' },
      desde:    { type: 'string', description: 'Inicio del período, YYYY-MM-DD' },
      hasta:    { type: 'string', description: 'Fin del período, YYYY-MM-DD' }
    },
    required: ['concepto', 'entidad', 'desde', 'hasta']
  }
};

module.exports = { bloqueContexto, cargarRollup, formato, consultarClienteConcepto, TOOL_SCHEMA };