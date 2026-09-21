// ============================================================================
//  api/ops  ·  Proxy a RDTOut (OpsXRangoFechas) CON snapshot histórico
//
//  Dos correcciones sobre la versión anterior:
//
//  1. NOMBRES DE PARÁMETRO. La función leía fechaInicio/fechaFin, pero el
//     informe de Transportes manda desde/hasta. Resultado: nunca se le envió un
//     rango real al API, siempre respondía su ventana por omisión y por eso
//     parecía que "ignoraba las fechas". Ahora se aceptan las dos formas.
//
//  2. RETENCIÓN. El API entrega una ventana móvil: lo que sale de ella no se
//     puede volver a pedir. Cada consulta guarda ahora un snapshot de los días
//     ya cerrados, y los días que el API ya no alcanza se sirven desde ese
//     snapshot. La historia se acumula sola con el uso normal del informe.
// ============================================================================

const https = require('https');
const cacheOps = require('../shared/cache-ops.js');

const API_HOST = 'apirdt1.azurewebsites.net';
const API_PATH = '/api/RDTOut/opsxrangofechas';

// La API Key se lee desde Application Settings de Azure Static Web Apps.
// Portal: Configuration -> Application settings -> REDTEC_API_KEY = m2s_live_...
//
// OJO: acá SÍ se deja el respaldo escrito, al revés que en el proxy del GPS.
// Este endpoint lo consumen varias páginas del portal, así que quitarlo antes
// de confirmar que la App Setting está cargada las rompería todas a la vez.
// Con ?diag=1 se puede comprobar de dónde viene la clave sin exponerla; una
// vez confirmada, se borra el literal de acá y queda como el del GPS.
// La clave estuvo en el repositorio, así que conviene rotarla igualmente.
const API_KEY_FALLBACK = 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';
const API_KEY = process.env.REDTEC_API_KEY || API_KEY_FALLBACK;
const CLAVE_DE_SETTINGS = !!process.env.REDTEC_API_KEY;

// Presupuesto: Static Web Apps corta la función a los 45 s.
const BUDGET_MS = 36000;
let _t0 = 0;
const alcanzaTiempo = () => (BUDGET_MS - (Date.now() - _t0)) > 4000;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 200, headers: CORS, body: '' }; return; }

  _t0 = Date.now();
  const q = req.query || {};

  // Diagnóstico: confirma de dónde sale la clave y si hay storage, sin exponer
  // ningún valor.
  if (q.diag === '1' || q.diag === 'true') {
    context.res = { status: 200, headers: Object.assign({'Content-Type':'application/json'}, CORS),
      body: JSON.stringify({
        ok: true,
        clave: CLAVE_DE_SETTINGS ? 'desde Application Settings' : 'RESPALDO ESCRITO EN EL CÓDIGO — cargar REDTEC_API_KEY y borrar el literal',
        clave_largo: API_KEY.length,
        storage_historico: cacheOps.hayStorage(),
        contenedor: cacheOps.CONTAINER,
        dias_vivos: cacheOps.DIAS_VIVOS,
        primer_dia_vivo: cacheOps.desdeVivo()
      }) };
    return;
  }

  // Se aceptan las dos convenciones: la del informe (desde/hasta) y la antigua.
  const d1 = q.desde || q.fechaInicio || '';
  const d2 = q.hasta || q.fechaFin    || '';

  const fDesde = String(d1).slice(0, 10);
  const fHasta = String(d2).slice(0, 10);
  const rangoValido = /^\d{4}-\d{2}-\d{2}$/.test(fDesde) && /^\d{4}-\d{2}-\d{2}$/.test(fHasta) && fDesde <= fHasta;

  // ── Cómo se comporta RDTOut, MEDIDO EN PRODUCCIÓN el 21-09-2026 ─────────
  //   · Respeta 'desde': pedirle junio trae desde junio.
  //   · IGNORA 'hasta': devuelve todo desde 'desde' hasta hoy.
  //   · Rechaza rangos de más de 180 días con RANGE_TOO_LARGE.
  // Por eso acá se trocea el rango y se filtra la respuesta: si no, pedir un
  // año devuelve 400 y pedir un mes devuelve cuatro.
  const MAX_DIAS_API = 170;   // margen bajo el tope de 180 del proveedor

  let vivas = [], errorApi = null, tramos = 0;
  try {
    const trozos = trocear(fDesde, fHasta, rangoValido, MAX_DIAS_API);
    for (const [ta, tb] of trozos) {
      if (tramos && !alcanzaTiempo()) break;
      const cuerpo = await fetchData(API_HOST, API_PATH + '?desde=' + encodeURIComponent(ta) + '&hasta=' + encodeURIComponent(tb));
      const j = JSON.parse(cuerpo);
      const filas = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : (j ? [j] : []));
      vivas = vivas.concat(filas);
      tramos++;
    }
    vivas = cacheOps.dedup(vivas);
  } catch (err) {
    errorApi = err.message;
  }

  // ── Qué cubrió realmente el API ──────────────────────────────────────────
  // No damos por hecho que respetó el rango: se mira qué fechas volvieron.
  // Si pedimos marzo y devolvió septiembre, hay que saberlo, no suponerlo.
  const fechasVivas = [];
  vivas.forEach(o => cacheOps.diasDeOp(o).forEach(f => fechasVivas.push(f)));
  fechasVivas.sort();
  // Dos preguntas distintas, que antes estaban mezcladas en una:
  //   · ¿devolvió SÓLO lo pedido?  (sin_datos_fuera_de_rango)
  //   · ¿devolvió TODO lo pedido?  (cubrio_todo_el_rango)
  // La segunda es la que delata una ventana móvil: pedimos 20 días y entrega
  // los últimos 10. Confundirlas hacía que el informe pareciera completo.
  const cobertura = {
    filas_api: vivas.length,
    primer_dia_api: fechasVivas[0] || null,
    ultimo_dia_api: fechasVivas[fechasVivas.length - 1] || null,
    rango_pedido: rangoValido ? (fDesde + '..' + fHasta) : null,
    sin_datos_fuera_de_rango: null,
    cubrio_todo_el_rango: null,
    dias_no_cubiertos: null
  };
  if (rangoValido && fechasVivas.length) {
    cobertura.sin_datos_fuera_de_rango =
      cobertura.primer_dia_api >= fDesde && cobertura.ultimo_dia_api <= fHasta;
    cobertura.cubrio_todo_el_rango =
      cobertura.primer_dia_api <= fDesde && cobertura.ultimo_dia_api >= fHasta;
    if (!cobertura.cubrio_todo_el_rango) {
      cobertura.dias_no_cubiertos =
        (cobertura.primer_dia_api > fDesde ? fDesde + '..' + restarDia(cobertura.primer_dia_api) : '') ||
        (cobertura.ultimo_dia_api < fHasta ? cobertura.ultimo_dia_api + '..' + fHasta : '');
    }
  }

  // ── Snapshot de los días cerrados que llegaron ───────────────────────────
  let sembrado = { guardados: [], yaEstaban: [] };
  if (cacheOps.hayStorage() && vivas.length) {
    try {
      sembrado = await cacheOps.sembrar(cacheOps.getContainer(), vivas, { alcanzaTiempo });
    } catch (e) { sembrado.error = e.message; }
  }

  // ── Completar con el histórico lo que el API ya no alcanza ───────────────
  let delCache = [], diasCache = 0;
  if (rangoValido && cacheOps.hayStorage()) {
    try {
      // Sólo se buscan en el caché los días cerrados que el API no cubrió.
      const faltaDesde = fDesde;
      const faltaHasta = (cobertura.primer_dia_api && cobertura.primer_dia_api > fDesde)
        ? restarDia(cobertura.primer_dia_api) : null;
      if (faltaHasta && faltaHasta >= faltaDesde) {
        const lect = await cacheOps.leerRango(cacheOps.getContainer(), faltaDesde, faltaHasta);
        delCache = lect.ops; diasCache = lect.dias_cache;
      }
    } catch (e) { /* el caché nunca rompe la respuesta */ }
  }

  let todas = cacheOps.dedup(delCache.concat(vivas));

  // El API ignora 'hasta', así que el recorte al rango pedido se hace acá.
  // Una operación entra si CUALQUIERA de sus fechas cae dentro: es el mismo
  // criterio con que el informe la cruza contra una parada.
  let recortadas = 0;
  if (rangoValido) {
    const antes = todas.length;
    todas = todas.filter(o => cacheOps.diasDeOp(o).some(f => f >= fDesde && f <= fHasta));
    recortadas = antes - todas.length;
  }

  if (errorApi && !todas.length) {
    context.res = { status: 502, headers: Object.assign({'Content-Type':'application/json'}, CORS),
      body: JSON.stringify({ ok:false, error:'Proxy error', detail: errorApi }) };
    return;
  }

  // COMPATIBILIDAD: por omisión se devuelve el MISMO arreglo suelto de antes.
  // Otras páginas del portal consumen este endpoint y algunas hacen j.map(...)
  // directo; cambiarles la forma de la respuesta las rompería en silencio.
  // El detalle del histórico va en cabeceras, y con ?meta=1 en el cuerpo.
  const meta = {
    ok: true,
    total: todas.length,
    cobertura,
    tramos_api: tramos,
    filas_fuera_de_rango_descartadas: recortadas,
    historico: {
      dias_desde_cache: diasCache,
      filas_desde_cache: delCache.length,
      dias_guardados: sembrado.guardados.length,
      dias_ya_guardados: sembrado.yaEstaban.length,
      storage: cacheOps.hayStorage()
    },
    error_api: errorApi
  };
  const quiereMeta = q.meta === '1' || q.meta === 'true';

  context.res = {
    status: 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Ops-Total': String(todas.length),
      'X-Ops-Desde-Cache': String(delCache.length),
      'X-Ops-Dias-Guardados': String(sembrado.guardados.length),
      'X-Ops-Api-Cubrio-Rango': String(cobertura.cubrio_todo_el_rango)
    }, CORS),
    body: JSON.stringify(quiereMeta ? Object.assign({ data: todas }, meta) : todas)
  };
};

/* Parte un rango en tramos que el proveedor acepte. Sin rango válido, un solo
   tramo con lo que venga (el API aplicará su ventana por omisión). */
function trocear(desde, hasta, valido, maxDias) {
  if (!valido) return [[desde, hasta]];
  const out = [];
  let ini = desde;
  while (ini <= hasta) {
    const d = new Date(ini + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + maxDias - 1);
    let fin = d.toISOString().slice(0, 10);
    if (fin > hasta) fin = hasta;
    out.push([ini, fin]);
    const sig = new Date(fin + 'T00:00:00Z');
    sig.setUTCDate(sig.getUTCDate() + 1);
    ini = sig.toISOString().slice(0, 10);
  }
  return out;
}

function restarDia(f) {
  const d = new Date(f + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fetchData(host, path) {
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: host, port: 443, path, method: 'GET',
      headers: { Accept: 'application/json', 'X-Api-Key': API_KEY }
    }, function (res) {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error('API ' + res.statusCode + ': ' + body.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, function () { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
