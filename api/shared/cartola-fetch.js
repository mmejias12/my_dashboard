// ============================================================================
//  shared/cartola-fetch.js  ·  Llamada a la Cartola Diaria (facturación)
//
//  Fuente única de la galaxia FINANZAS. Llama DIRECTO al endpoint PBI de RDT
//  (CartolaDiariasXRangoFechas), que se autentica con un token embebido en la
//  ruta (NO usa X-Api-Key como operaciones). Server-side no hay sesión de
//  portal, por eso vamos directo, igual que ops-fetch.
//
//  App settings (opcionales; hay default):
//    OS_OPS_HOST        (host de RDT; default apirdt1)
//    CARTOLA_PBI_TOKEN  (token de la ruta PBI de la cartola)
// ============================================================================

const HOST  = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const TOKEN = process.env.CARTOLA_PBI_TOKEN || 'rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt';

// Devuelve SIEMPRE un arreglo de filas de la cartola para el rango dado.
async function consultarCartola(desde, hasta) {
  const url = `${HOST}/api/${TOKEN}/pbi/CartolaDiariasXRangoFechas` +
              `?fechainicial=${desde}&fechafinal=${hasta}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`Cartola ${r.status} (${desde}..${hasta}) ${cuerpo.slice(0, 120)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

module.exports = { consultarCartola, HOST };