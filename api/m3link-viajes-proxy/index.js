// api/m3link-viajes-proxy/index.js
// Proxy para consultar la API de M3Link de REDTEC (apirdt1)
// Evita CORS llamando server-side desde Azure Function
//
// IMPORTANTE: M3Link espera los parámetros `fechaInicial` y `fechaFinal`
// (NO fechaDesde/fechaHasta). Si se pasan nombres incorrectos, la API
// ignora silenciosamente y devuelve un rango default.

const M3LINK_URL = 'https://apirdt1.azurewebsites.net/api/rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/OpsXRangoFechas';

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Aceptamos varios alias desde el frontend, pero al backend siempre le mandamos
  // los nombres oficiales que espera (fechaInicial / fechaFinal)
  const fechaInicial = (req.query.fechaInicial || req.query.fechaDesde || req.query.desde || '').trim();
  const fechaFinal   = (req.query.fechaFinal   || req.query.fechaHasta || req.query.hasta || '').trim();

  if (!fechaInicial || !fechaFinal) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { ok: false, error: 'Faltan parámetros fechaInicial y fechaFinal (formato YYYY-MM-DD)' }
    };
    return;
  }

  const url = `${M3LINK_URL}?fechaInicial=${encodeURIComponent(fechaInicial)}&fechaFinal=${encodeURIComponent(fechaFinal)}`;

  context.log(`[m3link-proxy] GET ${url}`);

  try {
    let lastError = null;
    let data = null;

    for (let intento = 1; intento <= 2; intento++) {
      try {
        const r = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!r.ok) {
          if (r.status >= 400 && r.status < 500) {
            const txt = await r.text();
            context.log.error(`[m3link-proxy] HTTP ${r.status}: ${txt.slice(0, 500)}`);
            context.res = {
              status: r.status,
              headers: corsHeaders,
              body: { ok: false, error: `M3Link respondió ${r.status}`, detalle: txt.slice(0, 500) }
            };
            return;
          }
          lastError = `HTTP ${r.status}`;
          context.log.warn(`[m3link-proxy] Intento ${intento}: ${lastError}`);
          continue;
        }

        data = await r.json();
        break;
      } catch (e) {
        lastError = e.message;
        context.log.warn(`[m3link-proxy] Intento ${intento} falló: ${e.message}`);
      }
    }

    if (data === null) {
      context.res = {
        status: 502,
        headers: corsHeaders,
        body: { ok: false, error: 'No se pudo conectar con M3Link', detalle: lastError }
      };
      return;
    }

    context.log(`[m3link-proxy] OK · ${Array.isArray(data) ? data.length : 'objeto'} registros`);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: data
    };
  } catch (err) {
    context.log.error(`[m3link-proxy] error: ${err.message}`);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: err.message }
    };
  }
};
