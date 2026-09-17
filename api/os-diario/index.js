// ============================================================================
//  api/os-diario  ·  La serie diaria de operaciones, lista para el tablero
//
//    GET /api/os-diario                       → toda la serie (<400 KB, gzip aparte)
//    GET /api/os-diario?desde=2026-01-01&hasta=2026-09-17
//
//  Son seis números por día: medido, 0,29 KB diarios. Tres años y medio caben
//  en un archivo que el navegador baja una vez y después corta como quiera:
//  día, semana, mes, año,
//  o el período que arme el gerente. Preguntar de nuevo por cada corte sería
//  gastar red para recalcular lo mismo.
//
//  La alternativa — pedirle el crudo a RDTOut — está medida y no sirve: 30 días
//  son 12,8 MB, a los 90 responde 502 por timeout y a los 365 RDTOut devuelve
//  400 rechazando el rango. Ése es exactamente el muro contra el que se chocó
//  la consulta de los 12 meses.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const BLOB      = 'resumen/diario.json';
const TTL_MS    = 30 * 60 * 1000;   // el blob cambia una vez al día

const CORS = {
  'Content-Type': 'application/json',
  // Se puede cachear un rato en el navegador: es un archivo que cambia de
  // madrugada, no un dato vivo.
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

async function leer() {
  if (memo.datos && Date.now() < memo.expira) return memo.datos;
  if (!CONN) throw Object.assign(new Error('Falta OS_STORAGE_CONN'), { status: 503 });
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  const dl = await c.getBlobClient(BLOB).download();
  const datos = JSON.parse(await streamToString(dl.readableStreamBody));
  memo = { datos, expira: Date.now() + TTL_MS };
  return datos;
}

const reISO = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }
  try {
    const d = await leer();
    const p = req.query || {};
    let dias = d.dias;

    // El recorte es opcional. Por defecto va todo, porque el tablero compara
    // años y pedir cada año por separado sería tres viajes en vez de uno.
    if (reISO.test(p.desde || '') || reISO.test(p.hasta || '')) {
      const desde = reISO.test(p.desde || '') ? p.desde : '0000-00-00';
      const hasta = reISO.test(p.hasta || '') ? p.hasta : '9999-99-99';
      dias = {};
      for (const f in d.dias) if (f >= desde && f <= hasta) dias[f] = d.dias[f];
    }

    context.res = { status: 200, headers: CORS, body: JSON.stringify({
      generado: d.generado, desde: d.desde, hasta: d.hasta,
      conceptos: d.conceptos, plantas: d.plantas,
      dias_con_datos: Object.keys(dias).length, dias }) };
  } catch (e) {
    context.log.error('os-diario', e);
    const falta = /BlobNotFound|not found/i.test(e.message || '');
    context.res = { status: e.status || (falta ? 404 : 502),
      headers: { ...CORS, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: e.message,
        pista: falta ? 'Todavía no se ha corrido scripts/rollup-diario.js' : undefined }) };
  }
};
