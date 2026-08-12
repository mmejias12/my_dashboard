// ============================================================================
//  shared/consulta-finanzas.js  ·  Galaxia FINANZAS (facturación / cartola)
//
//  Vista EN VIVO de la facturación de REDTEC desde la Cartola Diaria. Agrega
//  los montos netos en CLP y UF por concepto (arriendo días pallet, emisión,
//  transferencia, transferencia Walmart, traspaso, relocalización, otros) y por
//  cliente. No usa caché/backfill: es en vivo, para preguntas por período/cliente.
//
//  Dato sensible: la exposición de esta herramienta se controla por ROL en
//  api/chat (solo usuarios autorizados). Este módulo solo consulta y agrega.
// ============================================================================

const cartola = require('./cartola-fetch.js');

const num  = x => Number(x) || 0;
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

// Clasificación de la 'operacion' de la cartola en conceptos de facturación
// (réplica de cartola-financiera.html).
function conceptoFin(op) {
  const o = norm(op);
  if (o === 'ARRIENDO DIAS PALLET')   return 'arriendo';
  if (o === 'EMISION')                return 'emision';
  if (o === 'TRANSFERENCIA WALMART')  return 'transferencia_walmart';
  if (o === 'TRANSFERENCIA')          return 'transferencia';
  if (o === 'TRASPASO')               return 'traspaso';
  if (o === 'RELOCALIZA')             return 'relocaliza';
  return 'otros';
}

function nuevoResumen() { return { operaciones: 0, clp: 0, uf: 0, cantidad: 0, porConcepto: {} }; }
function sumar(acc, r) {
  const c = conceptoFin(r.operacion);
  const clp = num(r.netoCLP), uf = num(r.netoUF), cant = num(r.cantidad);
  acc.operaciones += 1; acc.clp += clp; acc.uf += uf; acc.cantidad += cant;
  if (!acc.porConcepto[c]) acc.porConcepto[c] = { clp: 0, uf: 0, cantidad: 0, operaciones: 0 };
  const p = acc.porConcepto[c]; p.clp += clp; p.uf += uf; p.cantidad += cant; p.operaciones += 1;
}

const reISO = /^\d{4}-\d{2}-\d{2}$/;
const hoyIso = () => new Date().toISOString().slice(0, 10);

// ── Herramienta: consultar_finanzas ─────────────────────────────────────────
async function consultarFinanzas({ desde, hasta, entidad }, ctx) {
  if (!reISO.test(desde || '') || !reISO.test(hasta || '')) throw new Error('fechas inválidas: YYYY-MM-DD');
  const hoy = hoyIso();
  if (hasta > hoy) hasta = hoy;
  if (desde > hasta) throw new Error('desde > hasta');

  const term = entidad ? norm(entidad) : null;
  const rows = await cartola.consultarCartola(desde, hasta);

  const total = nuevoResumen();
  const porCliente = {};
  for (const r of rows) {
    if (term) {
      const cn = norm(r.cardName), cc = norm(r.cardCode);
      if (cn.indexOf(term) === -1 && cc.indexOf(term) === -1) continue;
    }
    sumar(total, r);
    const key = (r.cardName || r.cardCode || '(sin cliente)').trim();
    if (!porCliente[key]) porCliente[key] = { cliente: key, cardCode: r.cardCode || '', clp: 0, uf: 0, operaciones: 0 };
    const pc = porCliente[key]; pc.clp += num(r.netoCLP); pc.uf += num(r.netoUF); pc.operaciones += 1;
  }
  const clientes = Object.values(porCliente).sort((a, b) => b.clp - a.clp);

  if (ctx && ctx.log) ctx.log(`finanzas ${desde}..${hasta}${entidad ? ' ["' + entidad + '"]' : ''}: ${rows.length} filas, ${clientes.length} clientes`);

  const out = {
    desde, hasta, entidad: entidad || null,
    total_facturado: { clp: Math.round(total.clp), uf: +total.uf.toFixed(2), operaciones: total.operaciones },
    por_concepto: total.porConcepto
  };
  if (term) out.clientes = clientes.slice(0, 50);      // el/los que matchean
  else out.top_clientes = clientes.slice(0, 12);        // ranking del período
  return out;
}

// ── Resumen del mes en curso (para inyectar en el contexto) ──────────────────
async function resumenMensual(hoy) {
  hoy = reISO.test(hoy || '') ? hoy : hoyIso();
  const desde = hoy.slice(0, 8) + '01';
  const rows = await cartola.consultarCartola(desde, hoy);
  const total = nuevoResumen();
  for (const r of rows) sumar(total, r);
  return { desde, hasta: hoy, total_clp: Math.round(total.clp), total_uf: +total.uf.toFixed(2), por_concepto: total.porConcepto };
}

// Texto compacto para el system prompt (solo usuarios autorizados).
const NOMBRE_CONCEPTO = {
  arriendo: 'arriendo', emision: 'emisión', transferencia: 'transferencia',
  transferencia_walmart: 'transf. Walmart', traspaso: 'traspaso',
  relocaliza: 'relocalización', otros: 'otros'
};
function milesCL(n) { return Math.round(n).toLocaleString('es-CL'); }
function formatoContextoMes(r) {
  const partes = Object.keys(r.por_concepto)
    .sort((a, b) => r.por_concepto[b].clp - r.por_concepto[a].clp)
    .map(k => `${NOMBRE_CONCEPTO[k] || k} $${milesCL(r.por_concepto[k].clp)}`);
  return `[FINANZAS · facturación mes en curso ${r.desde}→${r.hasta}] ` +
    `Total facturado: $${milesCL(r.total_clp)} CLP · ${r.total_uf.toLocaleString('es-CL')} UF. ` +
    `Por concepto: ${partes.join(', ')}. ` +
    `Para otros períodos o por cliente usa la herramienta consultar_finanzas. ` +
    `Cuando uses datos financieros, incluye 'finanzas' en la línea [FUENTES].`;
}

const TOOL_SCHEMA = {
  name: 'consultar_finanzas',
  description:
    'Consulta la FACTURACIÓN de REDTEC (cartola financiera) EN VIVO para un ' +
    'rango: montos netos en CLP y UF por concepto (arriendo días pallet, ' +
    'emisión, transferencia, transferencia Walmart, traspaso, relocalización, ' +
    'otros) y por cliente. Úsala para "cuánto facturamos", "facturación del ' +
    'cliente X", "ingresos por arriendo", "monto en UF del período", "top ' +
    'clientes por facturación". Si nombran un cliente, pásalo en `entidad`. NO ' +
    'la uses para la facturación del mes en curso: eso ya viene en el contexto. ' +
    'Al usar estos datos, incluye \'finanzas\' en la línea [FUENTES].',
  input_schema: {
    type: 'object',
    properties: {
      desde:   { type: 'string', description: 'Inicio del rango, YYYY-MM-DD' },
      hasta:   { type: 'string', description: 'Fin del rango, YYYY-MM-DD' },
      entidad: { type: 'string', description: 'Nombre (o parte) del cliente, opcional' }
    },
    required: ['desde', 'hasta']
  }
};

module.exports = { consultarFinanzas, resumenMensual, formatoContextoMes, conceptoFin, TOOL_SCHEMA };