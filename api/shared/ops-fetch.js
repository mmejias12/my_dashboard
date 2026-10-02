// ============================================================================
//  shared/ops-fetch.js  ·  Llamada al movimiento de pallets por rango
//
//  Fuente única para el LADO SERVIDOR: la usan la ingesta, el backfill, el
//  rollup de transferencias y el tool use del asistente. Las VISTAS no pasan
//  por acá — ellas llaman a /proxy/ops, que tiene su propio interruptor en
//  api/ops/index.js. Los dos leen la MISMA Application Setting, así que el
//  origen se conmuta de una sola vez para todo:
//
//      OPS_ORIGEN = rdt       (por defecto) el API del proveedor, apirdt1
//      OPS_ORIGEN = redlink   la API directa del portal (Holux)
//
//  Devuelve SIEMPRE el contrato de RDT, venga de donde venga, para que ningún
//  consumidor tenga que saber qué origen está activo.
// ============================================================================

const RL = require('./redlink-fetch.js');

const OPS_HOST = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const OPS_PATH = process.env.OS_OPS_PATH || '/api/RDTOut/opsxrangofechas';
// Mismo pendiente que en api/ops: la llave sigue como respaldo hasta confirmar
// que REDTEC_API_KEY está en Application Settings. Rotarla.
const RDT_KEY  = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';

function origenActivo() {
  return String(process.env.OPS_ORIGEN || 'rdt').toLowerCase() === 'redlink' ? 'redlink' : 'rdt';
}

async function desdeRdt(desde, hasta) {
  const url = `${OPS_HOST}${OPS_PATH}?desde=${desde}&hasta=${hasta}`;
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Api-Key': RDT_KEY } });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`RDTOut ${r.status} (${desde}..${hasta}) ${cuerpo.slice(0, 120)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [data];
}

// Devuelve SIEMPRE un arreglo de filas en el contrato de RDT.
async function consultarOps(desde, hasta) {
  if (origenActivo() === 'redlink') {
    // Sin presupuesto de tiempo: acá no hay un request HTTP esperando del otro
    // lado como en la Function, y la ingesta corre de madrugada.
    const r = await RL.consultarRedlink(desde, hasta, {});
    return r.filas;
  }
  return desdeRdt(desde, hasta);
}

module.exports = { consultarOps, origenActivo, OPS_HOST, OPS_PATH };
