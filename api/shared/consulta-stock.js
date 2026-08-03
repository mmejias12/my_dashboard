// api/shared/consulta-stock.js
// Wrapper para el tool use de api/chat: responde el stock del pool para una
// fecha o rango desde el read model diario. Freeze total (cierres al 23:59 del
// día anterior): todo día pasado es definitivo; el día tope consultable es ayer.
// Auto-sana huecos de caché acotados (<=MAX_AUTOHEAL) contra RDTOut.
const { leerRango, obtenerDia } = require('./stock-dia');

const MAX_AUTOHEAL = 60;

function ayerIso() {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function p2(n) { return n < 10 ? '0' + n : '' + n; }
function menor(a, b) { return a < b ? a : b; }

async function unUniverso(desde, hasta, universo) {
  let r = await leerRango(desde, hasta, universo);
  if (r.faltantes.length && r.faltantes.length <= MAX_AUTOHEAL) {
    for (const f of r.faltantes) { try { await obtenerDia(f); } catch (e) {} }
    r = await leerRango(desde, hasta, universo);
  }
  return r;
}

// desde/hasta ISO (YYYY-MM-DD); universo: 'clientes' | 'retail' | 'ambos'.
async function consultarStock(args) {
  let desde = args.desde;
  let hasta = menor(args.hasta, ayerIso());      // hoy aún no cierra
  const universo = args.universo || 'ambos';
  if (desde > hasta) desde = hasta;

  const out = { desde: desde, hasta: hasta };
  const nota = [];
  if (universo === 'clientes' || universo === 'ambos') {
    const r = await unUniverso(desde, hasta, 'clientes');
    out.clientes = r.resumen;
    if (r.faltantes.length) nota.push('clientes: ' + r.faltantes.length + ' día(s) sin dato');
  }
  if (universo === 'retail' || universo === 'ambos') {
    const r = await unUniverso(desde, hasta, 'retail');
    out.retail = r.resumen;
    if (r.faltantes.length) nota.push('retail: ' + r.faltantes.length + ' día(s) sin dato');
  }
  if (nota.length) out.advertencia = nota.join('; ');
  return out;
}

const TOOL_SCHEMA = {
  name: 'consultar_stock',
  description: 'Stock del pool de pallets ROJOS (existencias en poder de clientes y/o retail) para una fecha o un rango. Devuelve saldoFinal (= STOCK al cierre del rango), saldoInicial (apertura), variacion (saldoFinal - saldoInicial) y el desglose de flujos. Para el STOCK ACTUAL usa el último día cerrado (ayer): desde = hasta = ayer. Todo día pasado es definitivo. universo: "clientes", "retail" o "ambos" (default ambos).',
  input_schema: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD (un solo día: igual a desde)' },
      universo: { type: 'string', enum: ['clientes', 'retail', 'ambos'], description: 'Universo del pool. Default ambos.' }
    },
    required: ['desde', 'hasta']
  }
};

module.exports = { consultarStock, TOOL_SCHEMA };
