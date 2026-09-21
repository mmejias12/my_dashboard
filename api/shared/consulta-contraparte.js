// ============================================================================
//  shared/consulta-contraparte.js  ·  Movimiento por CLIENTE/RETAIL (asistente)
//
//  Herramienta del asistente para responder al INSTANTE "cuántas transferencias
//  / emisiones / retiros / devoluciones a <cliente> en los últimos N meses",
//  mes a mes. NO lee el dato crudo (que a 12 meses se cuelga): consulta los
//  índices que el job nocturno ya genera —los MISMOS que alimentan el dashboard—
//  así el asistente y el tablero dan el mismo número.
//
//    · transferencias → resumen/transferencias.json  (rollup-transferencias.js,
//        RDTOut directo: despachado vs confirmado, tasa, quién le transfirió).
//    · emisiones/retiros/devoluciones → resumen/contrapartes.json
//        (rollup-contrapartes.js, desglose por contraparte de los blobs diarios).
//
//  Es un COMPLEMENTO: no reemplaza consultar_operacion (rango de fechas) ni
//  consultar_cliente (en vivo hoy). Solo la búsqueda histórica por contraparte.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const TTL_MS    = 30 * 60 * 1000;   // los índices cambian una vez al día

// Lado relevante por concepto: "a/para el cliente" = destino; "del cliente" = origen.
const LADO = { emisiones: 'destino', retiros: 'origen', devoluciones: 'origen', transferencias: 'destino' };

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// Cargador de índices con caché por instancia (uno por blob).
const _cache = {};   // blob -> { datos, expira }
async function cargarIndice(blob) {
  if (_cache[blob] && Date.now() < _cache[blob].expira) return _cache[blob].datos;
  if (!CONN) throw Object.assign(new Error('Falta OS_STORAGE_CONN'), { status: 503 });
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  const dl = await c.getBlobClient(blob).download();
  const datos = JSON.parse(await streamToString(dl.readableStreamBody));
  _cache[blob] = { datos, expira: Date.now() + TTL_MS };
  return datos;
}
function esNoExiste(e) {
  return e && (e.statusCode === 404 || e.code === 'BlobNotFound' ||
    /BlobNotFound|does not exist|not found/i.test(String(e.message || '')));
}

// Misma normalización que os-resumen/os-transferencias: "walmart" halla la razón social.
function normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L\.?|CHILE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function normConcepto(s) {
  const x = String(s || '').toLowerCase();
  if (x.includes('emis')) return 'emisiones';
  if (x.includes('retir')) return 'retiros';
  if (x.includes('transf')) return 'transferencias';
  if (x.includes('devol')) return 'devoluciones';
  return null;
}

const mesDe = s => String(s || '').slice(0, 7);
const esMes = s => /^\d{4}-\d{2}$/.test(s);

// Resta n-1 meses a un 'YYYY-MM'.
function restaMeses(mes, n) {
  let y = +mes.slice(0, 4), m = +mes.slice(5, 7) - (n - 1);
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Resuelve la ventana [desdeMes, hastaMes] a partir de meses / desde / hasta y
// la lista de meses disponibles en el índice.
function ventana({ meses, desde, hasta }, mesesIdx) {
  const idx = (mesesIdx || []).slice().sort();
  const ultimo = idx[idx.length - 1] || mesDe(new Date().toISOString());
  const hastaMes = esMes(mesDe(hasta)) ? mesDe(hasta) : ultimo;
  let desdeMes;
  if (esMes(mesDe(desde))) desdeMes = mesDe(desde);
  else desdeMes = restaMeses(hastaMes, parseInt(meses, 10) > 0 ? parseInt(meses, 10) : 12);
  return { desdeMes, hastaMes };
}

// ── Transferencias: desde el índice exacto (despachado/confirmado/tasa) ───────
async function porTransferencias(entidad, win) {
  const d = await cargarIndice('resumen/transferencias.json');
  const { desdeMes, hastaMes } = ventana(win, d.meses);
  const q = normalizar(entidad);
  const nombres = Object.keys(d.destinos || {}).filter(x => normalizar(x).indexOf(q) >= 0);
  if (!nombres.length) {
    return { concepto: 'transferencias', entidad, encontrado: false, desde_mes: desdeMes, hasta_mes: hastaMes,
      mensaje: `Ningún retail/cliente calza con "${entidad}" en el índice de transferencias.` };
  }
  const enRango = m => m >= desdeMes && m <= hastaMes;
  const mesTot = {}, orig = {};
  for (const nombre of nombres) {
    const dst = d.destinos[nombre];
    for (const m in dst.mes) { if (!enRango(m)) continue; const t = mesTot[m] || (mesTot[m] = [0, 0, 0]); const s = dst.mes[m]; t[0] += s[0]; t[1] += s[1]; t[2] += s[2]; }
    for (const o in (dst.origenes || {})) {
      for (const m in dst.origenes[o]) { if (!enRango(m)) continue; const a = orig[o] || (orig[o] = [0, 0, 0]); const s = dst.origenes[o][m]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; }
    }
  }
  let D = 0, C = 0, N = 0;
  const por_mes = Object.keys(mesTot).sort().map(m => {
    const [d0, c0, n0] = mesTot[m]; D += d0; C += c0; N += n0;
    return { mes: m, despachado: d0, confirmado: c0, por_confirmar: d0 - c0 };
  });
  const top_clientes_origen = Object.keys(orig).map(o => {
    const [d0, c0, n0] = orig[o];
    return { cliente: o, despachado: d0, confirmado: c0, por_confirmar: d0 - c0, tasa: d0 ? +(c0 / d0).toFixed(4) : null };
  }).filter(x => x.despachado > 0).sort((a, b) => b.despachado - a.despachado).slice(0, 15);

  return {
    fuente: 'transferencias.json (RDTOut directo; incluye confirmaciones tardías)',
    concepto: 'transferencias', entidad, encontrado: true, nombres_sumados: nombres,
    desde_mes: desdeMes, hasta_mes: hastaMes, hasta_datos: d.hasta || d.generado,
    despachado: D, confirmado: C, por_confirmar: D - C, movimientos: N, tasa: D ? +(C / D).toFixed(4) : null,
    por_mes, top_clientes_origen
  };
}

// ── Otros conceptos: desde el índice por contraparte (blobs) ─────────────────
async function porContraparte(concepto, entidad, win) {
  const d = await cargarIndice('resumen/contrapartes.json');
  const { desdeMes, hastaMes } = ventana(win, d.meses);
  const q = normalizar(entidad);
  const clientes = d.clientes || {};
  const nombres = Object.keys(clientes).filter(x => normalizar(x).indexOf(q) >= 0);
  if (!nombres.length) {
    return { concepto, entidad, encontrado: false, desde_mes: desdeMes, hasta_mes: hastaMes,
      mensaje: `Ningún cliente calza con "${entidad}" en el índice por contraparte.` };
  }
  const lado = LADO[concepto] || 'destino';
  const enRango = m => m >= desdeMes && m <= hastaMes;
  const mm = {};
  let total = 0;
  for (const nombre of nombres) {
    const porConcepto = ((clientes[nombre] || {})[lado] || {})[concepto] || {};
    for (const m in porConcepto) { if (!enRango(m)) continue; const v = porConcepto[m] || 0; if (!v) continue; mm[m] = (mm[m] || 0) + v; total += v; }
  }
  const por_mes = Object.keys(mm).sort().map(m => ({ mes: m, cantidad: mm[m] }));
  return {
    fuente: 'contrapartes.json (histórico por contraparte)',
    concepto, entidad, lado, encontrado: true, nombres_sumados: nombres,
    desde_mes: desdeMes, hasta_mes: hastaMes, hasta_datos: d.hasta || d.generado,
    total, por_mes
  };
}

async function consultarContraparte({ concepto, entidad, meses, desde, hasta }, ctx) {
  const c = normConcepto(concepto);
  if (!c) throw new Error('concepto inválido: usa emisiones, retiros, transferencias o devoluciones');
  if (!entidad || !String(entidad).trim()) throw new Error('falta la contraparte (entidad)');
  const win = { meses, desde, hasta };
  try {
    const out = (c === 'transferencias') ? await porTransferencias(entidad, win)
                                         : await porContraparte(c, entidad, win);
    if (ctx && ctx.log) ctx.log(`contraparte ${c} "${entidad}" ${out.desde_mes}..${out.hasta_mes}: ` +
      (c === 'transferencias' ? `desp ${out.despachado} conf ${out.confirmado}` : `total ${out.total}`));
    return out;
  } catch (e) {
    if (esNoExiste(e)) return { concepto: c, entidad, encontrado: false,
      mensaje: 'El índice aún no existe; corre el job "Datos diarios REDTEC OS" (Actions → Run workflow) para generarlo.' };
    throw e;
  }
}

const TOOL_SCHEMA = {
  name: 'consultar_contraparte',
  description:
    'Movimiento de un concepto POR CLIENTE/RETAIL, histórico y AL INSTANTE, ' +
    'mes a mes — incluso 12 meses o varios años. Conceptos: emisiones, retiros, ' +
    'transferencias, devoluciones. Úsala SIEMPRE para preguntas tipo ' +
    '"transferencias a Walmart mes a mes / últimos 12 meses", "emisiones a ' +
    '<cliente> este año", "retiros de <retail> por mes". Para TRANSFERENCIAS ' +
    'devuelve despachado, confirmado, por confirmar y la tasa de confirmación ' +
    '(dato exacto, con confirmaciones tardías), además de qué clientes le ' +
    'transfirieron. NO uses consultar_operacion para esto (se cuelga a rangos ' +
    'largos): esta herramienta ya tiene el dato agregado. Pasa el cliente/retail ' +
    'en `entidad` (basta una parte del nombre, ej. "walmart"). Es dato operativo ' +
    'de pallets, disponible para todos.',
  input_schema: {
    type: 'object',
    properties: {
      concepto: { type: 'string', description: 'emisiones | retiros | transferencias | devoluciones' },
      entidad:  { type: 'string', description: 'Cliente o retail (o parte del nombre), ej. "Walmart", "Cambiaso"' },
      meses:    { type: 'integer', description: 'Cuántos meses hacia atrás (por defecto 12). Ignóralo si pasas desde/hasta.' },
      desde:    { type: 'string', description: 'Opcional. Mes o fecha de inicio (YYYY-MM o YYYY-MM-DD).' },
      hasta:    { type: 'string', description: 'Opcional. Mes o fecha de fin (YYYY-MM o YYYY-MM-DD).' }
    },
    required: ['concepto', 'entidad']
  }
};

module.exports = { consultarContraparte, TOOL_SCHEMA };
