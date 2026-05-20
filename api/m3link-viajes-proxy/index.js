// api/m3link-viajes-proxy/index.js
// Proxy para consultar la API de M3Link de REDTEC (apirdt1)
// Evita CORS llamando server-side desde Azure Function

const M3LINK_URL = 'https://apirdt1.azurewebsites.net/api/rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/OpsXRangoFechas';

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  const fechaDesde = (req.query.fechaDesde || '').trim();
  const fechaHasta = (req.query.fechaHasta || '').trim();

  if (!fechaDesde || !fechaHasta) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { ok: false, error: 'Faltan parámetros fechaDesde y fechaHasta (formato YYYY-MM-DD)' }
    };
    return;
  }

  // Construir URL con los parámetros - probamos primero los nombres más comunes
  // Si M3Link espera otros nombres, se ajustan aquí
  const url = `${M3LINK_URL}?fechaDesde=${encodeURIComponent(fechaDesde)}&fechaHasta=${encodeURIComponent(fechaHasta)}`;

  context.log(`[m3link-proxy] GET ${url}`);

  try {
    let lastError = null;
    let data = null;

    // Reintento simple: hasta 2 intentos ante 5xx
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const r = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!r.ok) {
          // Si es 4xx, no reintentamos
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

    // M3Link puede devolver array directo o un wrapper {items:[...]}
    // Lo devolvemos tal cual, el frontend lo normaliza
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
