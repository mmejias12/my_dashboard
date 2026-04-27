/**
 * Proxy: HistorialXNroPedido
 * Reenvía la consulta del historial del pedido a la API interna.
 * Mismo patrón que cartola-proxy / gps-stops-proxy.
 *
 * Uso desde el cliente:
 *   GET /api/historial-proxy?nroPedido=4023804
 */
module.exports = async function (context, req) {
  const nroPedido = (req.query && req.query.nroPedido) || '';

  if (!nroPedido) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Falta parámetro nroPedido' }
    };
    return;
  }

  const upstream = 'https://apirdt1.azurewebsites.net/api/'
    + 'rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/HistorialXNroPedido'
    + '?nroPedido=' + encodeURIComponent(nroPedido);

  try {
    // En Node 18+ fetch es global. Si la Function App corre Node 16, ver nota más abajo.
    const r = await fetch(upstream, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!r.ok) {
      context.res = {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Upstream HTTP ' + r.status }
      };
      return;
    }

    const data = await r.json();

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: data
    };
  } catch (err) {
    context.log.error('historial-proxy error:', err && err.message);
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Error consultando historial', detail: String(err && err.message || err) }
    };
  }
};
