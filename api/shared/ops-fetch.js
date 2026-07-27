// ============================================================================
//  shared/ops-fetch.js  ·  Llamada a RDTOut (OpsXRangoFechas)
//
//  Fuente única para consultar movimiento de pallets por rango. La usan la
//  carga inicial, la ingesta y el tool use, para que todos peguen igual.
//  Llama DIRECTO a la API remota (X-Api-Key), no al proxy /api/ops de la SWA,
//  que exige sesión de portal.
// ============================================================================

const OPS_HOST = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const OPS_PATH = process.env.OS_OPS_PATH || '/api/RDTOut/opsxrangofechas';
const RDT_KEY  = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';

// Devuelve SIEMPRE un arreglo de filas (aunque la API mande un objeto suelto).
async function consultarOps(desde, hasta) {
  const url = `${OPS_HOST}${OPS_PATH}?desde=${desde}&hasta=${hasta}`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Api-Key': RDT_KEY }
  });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`RDTOut ${r.status} (${desde}..${hasta}) ${cuerpo.slice(0, 120)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [data];
}

module.exports = { consultarOps, OPS_HOST, OPS_PATH };
