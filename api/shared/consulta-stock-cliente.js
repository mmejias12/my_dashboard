// ============================================================================
//  shared/consulta-stock-cliente.js  ·  Stock POR CLIENTE/RETAIL (asistente)
//
//  Responde "¿cuánto stock tiene <cliente> al cierre de <mes>?" y la serie de
//  stock de un cliente mes a mes. Es el ÚNICO corte de stock POR CONTRAPARTE:
//  el cuadre de RDTOut que usan consultar_stock / consultar_stock_mensual viene
//  AGREGADO (clientes/retail como un todo), sin desglose por cliente.
//
//  FUENTE: SAP B1 vía el proxy ya desplegado  /api/sap-stock-proxy
//  (vista STOCKHISTCLIENTE, proyecto M3DATA). Es una fuente DISTINTA del cuadre
//  RDTOut, así que el agregado por cliente de aquí puede no cuadrar al pallet
//  con el stock agregado de consultar_stock. Por eso la respuesta se marca con
//  `fuente: SAP`, para que el asistente lo diga y no mezcle las dos fuentes.
//
//  Estrategia: pide al proxy la serie mensual acumulada (stock al cierre de cada
//  mes) y empareja el nombre por subcadena (como las otras herramientas). SAP
//  filtra por nombre EXACTO; por eso se intenta primero con el nombre tal cual
//  (rápido) y, si no calza, se pide sin filtro y se empareja en memoria.
// ============================================================================

const SITE = (process.env.OS_SITE_BASE || 'https://black-river-0b5a28810.7.azurestaticapps.net').replace(/\/+$/, '');
const TIMEOUT_MS = 90000;   // SAP en vivo: puede tardar. Tope duro para no colgar el chat.

function normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L\.?|CHILE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
const esMes = s => /^\d{4}-\d{2}$/.test(String(s || ''));
const mesDe = s => String(s || '').slice(0, 7);

function restaMeses(mes, n) {
  let y = +mes.slice(0, 4), m = +mes.slice(5, 7) - n;
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function mesesEntre(desde, hasta) {
  const out = [];
  let y = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const yf = +hasta.slice(0, 4), mf = +hasta.slice(5, 7);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

// Pide al proxy sap-stock-proxy la serie mensual acumulada (stock al cierre de
// cada mes). `cliente` es el filtro EXACTO de SAP (SL1Code); null = sin filtro.
async function serieMensual(cliente, desde) {
  const q = ['modo=stockxfecha', 'granularidad=mensual', 'stockTipo=acumulado'];
  if (cliente) q.push('cliente=' + encodeURIComponent(cliente));
  if (desde) q.push('desde=' + encodeURIComponent(desde));
  const url = SITE + '/api/sap-stock-proxy?' + q.join('&');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) {
      throw new Error('sap-stock-proxy ' + r.status + (j && j.error ? ': ' + j.error : ''));
    }
    return j.items || [];
  } finally { clearTimeout(t); }
}

// items del proxy: { cliente:WhsCode('CLIENTES'|'RETAIL'), nombre:SL1Code,
//                    periodo:'YYYY-MM', entradas, salidas, stock:acumulado al cierre }
// Arma, para las entidades que calzan, el stock al cierre de cada mes del rango,
// arrastrando el último acumulado conocido cuando un mes no tuvo movimiento.
function armar(items, q, win) {
  const matched = items.filter(x => normalizar(x.nombre).indexOf(q) >= 0);
  if (!matched.length) return null;

  // Un acumulado por (tipo|nombre) y mes.
  const grupos = {};
  let minMes = '9999-99', maxMes = '0000-00';
  for (const it of matched) {
    const k = it.cliente + '|' + it.nombre;
    (grupos[k] || (grupos[k] = { tipo: it.cliente, nombre: it.nombre, map: {} })).map[it.periodo] = it.stock;
    if (it.periodo < minMes) minMes = it.periodo;
    if (it.periodo > maxMes) maxMes = it.periodo;
  }

  const hasta = esMes(win.hasta) ? win.hasta : maxMes;
  let desde = esMes(win.desde) ? win.desde : restaMeses(hasta, 11);   // 12 meses por defecto
  if (desde < minMes) desde = minMes;
  if (desde > hasta) desde = hasta;
  const meses = mesesEntre(desde, hasta);

  // Forward-fill por grupo y suma por mes.
  const porGrupo = Object.values(grupos).map(g => {
    const serie = {}; let ult = 0;
    for (const m of meses) {
      if (g.map[m] != null) ult = g.map[m];
      serie[m] = ult;
    }
    return { tipo: g.tipo, nombre: g.nombre, serie };
  });

  const por_mes = meses.map(m => ({
    mes: m,
    stock: porGrupo.reduce((a, g) => a + (g.serie[m] || 0), 0)
  }));

  return {
    nombres_sap: porGrupo.map(g => g.nombre + ' (' + g.tipo + ')'),
    desde_mes: desde, hasta_mes: hasta,
    stock_al_cierre: por_mes.length ? por_mes[por_mes.length - 1] : null,
    por_mes
  };
}

async function consultarStockCliente({ entidad, fecha, desde, hasta }, ctx) {
  if (!entidad || !String(entidad).trim()) throw new Error('falta la entidad (cliente/retail)');
  const q = normalizar(entidad);
  const win = { desde: mesDe(desde || ''), hasta: mesDe(hasta || fecha || '') };
  // Para 'acumulado' el proxy parte en 2026 salvo que mandemos desde; si piden
  // un rango que empieza antes, se lo pasamos para que acumule desde ahí.
  const desdeProxy = esMes(win.desde) ? win.desde + '-01' : null;

  // 1) intento rápido: nombre tal cual (SAP filtra exacto).
  let items = [];
  try { items = await serieMensual(entidad, desdeProxy); } catch (e) {
    if (ctx && ctx.log) ctx.log.warn('stock-cliente (filtro exacto): ' + e.message);
  }
  let out = armar(items, q, win);
  // 2) si no calzó, pido sin filtro y emparejo por subcadena.
  if (!out) {
    const todos = await serieMensual(null, desdeProxy);
    out = armar(todos, q, win);
  }

  if (!out) {
    return { entidad, encontrado: false, fuente: 'SAP · STOCKHISTCLIENTE (M3DATA)',
      mensaje: `Ningún cliente/retail de SAP calza con "${entidad}".` };
  }
  if (ctx && ctx.log) ctx.log(`stock-cliente "${entidad}" ${out.desde_mes}..${out.hasta_mes}: cierre ${out.stock_al_cierre && out.stock_al_cierre.stock}`);
  return Object.assign({
    entidad, encontrado: true,
    fuente: 'SAP · STOCKHISTCLIENTE (M3DATA) — distinta del cuadre RDTOut que usa consultar_stock; no mezclar.'
  }, out);
}

const TOOL_SCHEMA = {
  name: 'consultar_stock_cliente',
  description: 'Stock (existencias de pallet rojo) de UN cliente o retail PUNTUAL, al cierre de un mes y mes a mes. ÚSALA cuando pregunten "¿cuánto stock tiene <cliente> al cierre de <mes>?" o "stock de <cliente> mes a mes". Es el único corte de stock POR CONTRAPARTE: consultar_stock y consultar_stock_mensual dan el pool AGREGADO (clientes/retail como un todo), sin desglose por cliente. FUENTE: SAP (proyecto M3DATA), distinta del cuadre RDTOut del stock agregado; al informar el número, dilo ("según SAP/M3DATA") y NO lo sumes ni lo cuadres con el stock agregado. Puede tardar unos segundos (SAP en vivo). Devuelve por_mes[] (stock al cierre de cada mes) y stock_al_cierre (último del rango). Pasa el nombre en `entidad` (basta una parte, ej. "walmart").',
  input_schema: {
    type: 'object',
    properties: {
      entidad: { type: 'string', description: 'Cliente o retail (o parte del nombre), ej. "Walmart"' },
      fecha:   { type: 'string', description: 'Opcional. Mes/fecha de cierre a resaltar (YYYY-MM o YYYY-MM-DD). El stock de ese mes queda en stock_al_cierre.' },
      desde:   { type: 'string', description: 'Opcional. Mes/fecha de inicio del rango (YYYY-MM o YYYY-MM-DD). Default: 12 meses hacia atrás.' },
      hasta:   { type: 'string', description: 'Opcional. Mes/fecha de fin del rango (YYYY-MM o YYYY-MM-DD).' }
    },
    required: ['entidad']
  }
};

module.exports = { consultarStockCliente, TOOL_SCHEMA };
