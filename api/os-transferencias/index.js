// ============================================================================
//  api/os-transferencias  ·  Despachado vs confirmado, y quién le transfirió
//
//    GET /api/os-transferencias
//        → serie mensual del total, desglose por etapa y ranking de retails
//
//    GET /api/os-transferencias?destino=walmart&desde=2025-09&hasta=2026-08
//        → ese retail: serie mensual + LOS CLIENTES QUE LE TRANSFIRIERON
//
//  POR QUÉ EXISTE. El resto de la plataforma cuenta lo confirmado. Eso deja dos
//  preguntas sin responder que sí se hacen en las reuniones: cuánto salió, y
//  cuánto falta por confirmar. El 17-09-2026 esa ambigüedad llegó a gerencia:
//  logística mostró 405.315 y el tablero 394.742 para el mismo Walmart y el
//  mismo período. Ninguno estaba malo — el primero era el despachado por un
//  factor estimado de 94%, el segundo el confirmado de verdad. Con este
//  endpoint los dos números salen del mismo lugar y ya no hay que estimar: la
//  tasa real de Walmart en esos 12 meses fue 92,33%, no 94%.
//
//  El índice lo arma scripts/rollup-transferencias.js leyendo RDTOut directo,
//  NO los blobs diarios: ésos se congelan a los 45 días y pierden las
//  confirmaciones tardías (3.374 pallets sólo en Walmart a 12 meses).
//
//  Formato del índice: cada mes es la tripleta [despachado, confirmado, movs].
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const BLOB      = 'resumen/transferencias.json';
const TTL_MS    = 30 * 60 * 1000;   // el blob cambia una vez al día

const CORS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, max-age=900',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let memo = { datos: null, expira: 0 };

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function indice() {
  if (memo.datos && Date.now() < memo.expira) return memo.datos;
  if (!CONN) throw Object.assign(new Error('Falta OS_STORAGE_CONN'), { status: 503 });
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  const dl = await c.getBlobClient(BLOB).download();
  const datos = JSON.parse(await streamToString(dl.readableStreamBody));
  memo = { datos, expira: Date.now() + TTL_MS };
  return datos;
}

/** Misma normalización que os-resumen: "walmart" tiene que hallar la razón social. */
function normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L\.?|CHILE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const mesDe = s => String(s || '').slice(0, 7);
const esMes = s => /^\d{4}-\d{2}$/.test(s);

/** Suma las tripletas de un mapa mes→[d,c,n] dentro del rango. */
function sumar(mapa, desde, hasta) {
  let d = 0, c = 0, n = 0;
  for (const m in mapa) {
    if (m < desde || m > hasta) continue;
    d += mapa[m][0]; c += mapa[m][1]; n += mapa[m][2];
  }
  return { despachado: d, confirmado: c, por_confirmar: d - c, movimientos: n,
           tasa: d ? +(c / d).toFixed(4) : null };
}
function serie(mapa, desde, hasta) {
  return Object.keys(mapa).filter(m => m >= desde && m <= hasta).sort()
    .map(m => ({ mes: m, despachado: mapa[m][0], confirmado: mapa[m][1],
                 por_confirmar: mapa[m][0] - mapa[m][1] }));
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }
  const p = req.query || {};
  try {
    const d = await indice();
    const meses = d.meses || [];
    const desde = esMes(mesDe(p.desde)) ? mesDe(p.desde) : (meses[0] || '0000-00');
    const hasta = esMes(mesDe(p.hasta)) ? mesDe(p.hasta) : (meses[meses.length - 1] || '9999-99');
    const base = { generado: d.generado, desde, hasta };

    // ── Un retail: la serie y QUIÉN le transfirió ───────────────────────────
    if (p.destino) {
      const q = normalizar(p.destino);
      // Se devuelven TODAS las coincidencias sumadas, no la primera: si un
      // retail está cargado con dos razones sociales, quedarse con una da un
      // número más chico sin avisarle a nadie.
      const nombres = Object.keys(d.destinos || {}).filter(x => normalizar(x).indexOf(q) >= 0);
      if (!nombres.length) {
        context.res = { status: 200, headers: CORS, body: JSON.stringify({
          ...base, destino: p.destino, encontrado: false,
          mensaje: 'Ningún retail calza con "' + p.destino + '".' }) };
        return;
      }

      const mesTot = {}, orig = {};
      for (const nombre of nombres) {
        const dst = d.destinos[nombre];
        for (const m in dst.mes) {
          const t = mesTot[m] || (mesTot[m] = [0, 0, 0]);
          t[0] += dst.mes[m][0]; t[1] += dst.mes[m][1]; t[2] += dst.mes[m][2];
        }
        for (const o in dst.origenes) {
          const acc = orig[o] || (orig[o] = {});
          for (const m in dst.origenes[o]) {
            const t = acc[m] || (acc[m] = [0, 0, 0]);
            t[0] += dst.origenes[o][m][0]; t[1] += dst.origenes[o][m][1]; t[2] += dst.origenes[o][m][2];
          }
        }
      }

      const clientes = Object.keys(orig)
        .map(o => ({ cliente: o, ...sumar(orig[o], desde, hasta) }))
        .filter(x => x.movimientos > 0)
        .sort((a, b) => b.despachado - a.despachado);

      context.res = { status: 200, headers: CORS, body: JSON.stringify({
        ...base, destino: p.destino, encontrado: true, nombres_sumados: nombres,
        totales: sumar(mesTot, desde, hasta),
        por_mes: serie(mesTot, desde, hasta),
        clientes }) };
      return;
    }

    // ── Vista general ──────────────────────────────────────────────────────
    const retails = Object.keys(d.destinos || {})
      .map(nombre => ({ retail: nombre, ...sumar(d.destinos[nombre].mes, desde, hasta) }))
      .filter(x => x.movimientos > 0)
      .sort((a, b) => b.despachado - a.despachado);

    const etapas = Object.keys(d.etapas || {})
      .map(e => ({ etapa: e, ...sumar(d.etapas[e], desde, hasta) }))
      .filter(x => x.movimientos > 0)
      .sort((a, b) => b.despachado - a.despachado);

    // La serie diaria va en la respuesta general: pesa ~40 KB y es lo que le
    // permite al tablero cortar el despachado con la misma libertad que el
    // resto de los conceptos, sin pedir nada más.
    const dias = {};
    for (const f in (d.dias || {})) {
      const m = f.slice(0, 7);
      if (m >= desde && m <= hasta) dias[f] = d.dias[f];
    }

    context.res = { status: 200, headers: CORS, body: JSON.stringify({
      ...base, meses,
      totales: sumar(d.total || {}, desde, hasta),
      por_mes: serie(d.total || {}, desde, hasta),
      dias, etapas, retails }) };
  } catch (e) {
    context.log.error('os-transferencias', e);
    // Azure dice "The specified blob does not exist", no "BlobNotFound".
    const falta = e.statusCode === 404 || e.code === 'BlobNotFound' ||
                  /BlobNotFound|does not exist|not found/i.test(e.message || '');
    context.res = { status: e.status || (falta ? 404 : 502),
      headers: { ...CORS, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: e.message,
        pista: falta
          ? 'El índice de transferencias (' + BLOB + ') todavía no existe. Se genera '
            + 'corriendo scripts/rollup-transferencias.js — en GitHub, pestaña Actions '
            + '→ "Datos diarios REDTEC OS" → Run workflow.'
          : undefined }) };
  }
};
