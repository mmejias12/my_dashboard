// ============================================================================
//  api/os-resumen  ·  Responde por contraparte SIN leer el dato crudo
//
//    GET /api/os-resumen?contraparte=walmart&concepto=transferencias&meses=12
//    GET /api/os-resumen?contraparte=walmart            (todos los conceptos)
//    GET /api/os-resumen?top=transferencias&meses=12    (ranking del período)
//    GET /api/os-resumen?listar=clientes&q=wal          (buscar el nombre exacto)
//
//  POR QUÉ EXISTE. Preguntar "cuántas transferencias se emitieron a Walmart en
//  los últimos 12 meses" contra RDTOut significa bajar ~155 MB y 233 mil filas
//  para después contar. Medido el 17-09-2026: a los 90 días la consulta ya
//  responde 502 por timeout, y a los 365 RDTOut devuelve 400 — rechaza el rango.
//  Acá la misma pregunta es una búsqueda en un índice precalculado.
//
//  El índice lo arma scripts/rollup-contrapartes.js en el job nocturno, a
//  partir de los blobs diarios que YA guardan el desglose por cliente.
//
//  Se cachea en memoria: el blob cambia una vez al día, así que releerlo en
//  cada pregunta sería gastar medio segundo por gusto.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const BLOB      = 'resumen/contrapartes.json';
const TTL_MS    = 30 * 60 * 1000;

const CORS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let cache = { datos: null, expira: 0 };

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function indice() {
  if (cache.datos && Date.now() < cache.expira) return cache.datos;
  if (!CONN) throw Object.assign(new Error('Falta OS_STORAGE_CONN'), { status: 503 });
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  const dl = await c.getBlobClient(BLOB).download();
  const datos = JSON.parse(await streamToString(dl.readableStreamBody));
  cache = { datos, expira: Date.now() + TTL_MS };
  return datos;
}

function normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L\.?|CHILE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Los N meses más recientes del índice, en orden. */
function ultimosMeses(d, n) {
  const ms = (d.meses || []).slice().sort();
  return n > 0 ? ms.slice(-n) : ms;
}

/**
 * Busca la contraparte. "walmart" tiene que encontrar "WALMART CHILE S.A." sin
 * que nadie sepa la razón social exacta, así que se compara normalizado y por
 * contención — y se devuelven TODAS las coincidencias, no la primera: si un
 * cliente está cargado con dos razones sociales, sumar sólo una daría un
 * número más chico que el real sin avisar.
 */
function buscar(d, grupo, q) {
  const n = normalizar(q);
  if (!n) return [];
  return Object.keys(d[grupo] || {}).filter(nombre => normalizar(nombre).indexOf(n) >= 0);
}

function sumar(d, grupo, nombres, meses, concepto) {
  const total = {};        // concepto -> {mes -> n}
  for (const nombre of nombres) {
    for (const cara of ['destino', 'origen']) {
      const porConcepto = ((d[grupo][nombre] || {})[cara]) || {};
      for (const c in porConcepto) {
        if (concepto && c !== concepto) continue;
        const clave = c + '/' + cara;
        const dst = total[clave] || (total[clave] = { concepto: c, lado: cara, por_mes: {}, total: 0 });
        for (const m of meses) {
          const v = porConcepto[c][m] || 0;
          if (!v) continue;
          dst.por_mes[m] = (dst.por_mes[m] || 0) + v;
          dst.total += v;
        }
      }
    }
  }
  return Object.values(total).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }
  const p = req.query || {};
  try {
    const d = await indice();
    const meses = ultimosMeses(d, parseInt(p.meses, 10) || 0);
    const grupo = p.grupo === 'bodegas' ? 'bodegas' : 'clientes';
    const base = { generado: d.generado, hasta: d.hasta, meses_considerados: meses.length,
                   desde_mes: meses[0], hasta_mes: meses[meses.length - 1] };

    // ── Buscar el nombre exacto de una contraparte ──────────────────────────
    if (p.listar) {
      const g = p.listar === 'bodegas' ? 'bodegas' : 'clientes';
      const nombres = p.q ? buscar(d, g, p.q) : Object.keys(d[g] || {});
      context.res = { status: 200, headers: CORS,
        body: JSON.stringify({ ...base, grupo: g, total: nombres.length, nombres: nombres.slice(0, 200) }) };
      return;
    }

    // ── Ranking de un concepto en el período ────────────────────────────────
    if (p.top) {
      const filas = Object.keys(d[grupo] || {}).map(nombre => {
        const r = sumar(d, grupo, [nombre], meses, p.top);
        return { nombre, total: r.reduce((s, x) => s + x.total, 0) };
      }).filter(x => x.total > 0).sort((a, b) => b.total - a.total).slice(0, parseInt(p.n, 10) || 20);
      context.res = { status: 200, headers: CORS,
        body: JSON.stringify({ ...base, concepto: p.top, grupo, ranking: filas }) };
      return;
    }

    // ── La pregunta de la reunión ───────────────────────────────────────────
    if (p.contraparte) {
      const nombres = buscar(d, grupo, p.contraparte);
      if (!nombres.length) {
        context.res = { status: 200, headers: CORS, body: JSON.stringify({
          ...base, contraparte: p.contraparte, encontrado: false,
          mensaje: 'Ninguna contraparte calza con "' + p.contraparte + '". '
                 + 'Probar con ?listar=clientes&q=... para ver los nombres cargados.' }) };
        return;
      }
      context.res = { status: 200, headers: CORS, body: JSON.stringify({
        ...base, contraparte: p.contraparte, encontrado: true,
        // Se dice con qué nombres se sumó: si son dos razones sociales, quien
        // lee tiene que poder verlo y no descubrirlo por un total raro.
        nombres_sumados: nombres,
        resultados: sumar(d, grupo, nombres, meses, p.concepto || null) }) };
      return;
    }

    // ── Sin parámetros: qué hay en el índice ────────────────────────────────
    context.res = { status: 200, headers: CORS, body: JSON.stringify({
      ...base, dias_leidos: d.dias_leidos, dias_sin_detalle: d.dias_sin_detalle,
      clientes: Object.keys(d.clientes || {}).length,
      bodegas: Object.keys(d.bodegas || {}).length,
      uso: ['?contraparte=walmart&concepto=transferencias&meses=12',
            '?top=transferencias&meses=12', '?listar=clientes&q=wal'] }) };
  } catch (e) {
    context.log.error('os-resumen', e);
    const falta = /BlobNotFound|not found/i.test(e.message || '');
    context.res = { status: e.status || (falta ? 404 : 502), headers: CORS,
      body: JSON.stringify({ error: e.message,
        pista: falta ? 'Todavía no se ha corrido scripts/rollup-contrapartes.js' : undefined }) };
  }
};
