// ─── TALANA PROXY ───────────────────────────────────────────────────────────
// Azure Function: /api/talana-proxy
// URL de producción confirmada: talana.com (del correo Postman de Talana)
// Empresa REDTEC id: 2921
//
// El dashboard llama a:
//   GET /api/talana-proxy?endpoint=/es/api/persona/&page=1
//   GET /api/talana-proxy?endpoint=/es/api/persona/&empresa=2921&page=1
// ────────────────────────────────────────────────────────────────────────────

const https = require('https');
const http  = require('http');

const TALANA_TOKEN   = '44655ede473bde96d38dd1f25926cc3603db5c70';
const EMPRESA_ID     = '2921'; // REDTEC en Talana
const TALANA_HOST    = process.env.TALANA_HOST || 'talana.com';
const TALANA_PROTO   = process.env.TALANA_PROTO || 'https'; // usa https por defecto

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: corsHeaders, body: '' };
    return;
  }

  const endpoint = req.query.endpoint;
  if (!endpoint) {
    context.res = {
      status: 400, headers: corsHeaders,
      body: JSON.stringify({
        error: 'Parámetro "endpoint" requerido.',
        ejemplo: '/api/talana-proxy?endpoint=/es/api/persona/',
        empresa_id: EMPRESA_ID
      })
    };
    return;
  }

  // Construir query string: reenviar params + agregar empresa si no viene
  const params = Object.entries(req.query).filter(([k]) => k !== 'endpoint');
  // Algunos endpoints de Talana requieren filtro por empresa
  // Lo inyectamos si el endpoint lo acepta y no viene ya en params
  const needsEmpresa = ['/es/api/persona/', '/es/api/contrato', '/es/api/vacaciones']
    .some(p => endpoint.startsWith(p));
  if (needsEmpresa && !params.find(([k]) => k === 'empresa')) {
    params.push(['empresa', EMPRESA_ID]);
  }

  const qs   = params.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const path = qs ? `${endpoint}?${qs}` : endpoint;

  try {
    const result = await callTalana(TALANA_HOST, path, TALANA_PROTO);

    // Si https falla con conexión, intentar http (el correo usaba http)
    if (result.status === 0 && TALANA_PROTO === 'https') {
      const fallback = await callTalana(TALANA_HOST, path, 'http');
      if (fallback.status !== 0) {
        context.res = {
          status:  fallback.status,
          headers: { ...corsHeaders, 'X-Talana-Host': TALANA_HOST, 'X-Talana-Proto': 'http' },
          body:    fallback.body
        };
        return;
      }
    }

    if (result.status !== 0) {
      context.res = {
        status:  result.status,
        headers: { ...corsHeaders, 'X-Talana-Host': TALANA_HOST },
        body:    result.body
      };
      return;
    }

    // No se pudo conectar
    context.res = {
      status: 502, headers: corsHeaders,
      body: JSON.stringify({
        error: `No se pudo conectar con ${TALANA_PROTO}://${TALANA_HOST}`,
        detalle: result.error,
        host_usado: TALANA_HOST,
        empresa_id: EMPRESA_ID,
        endpoint_solicitado: path
      })
    };

  } catch (err) {
    context.res = {
      status: 500, headers: corsHeaders,
      body: JSON.stringify({ error: 'Error interno proxy: ' + err.message })
    };
  }
};

function callTalana(hostname, path, proto) {
  const lib = proto === 'https' ? https : http;
  return new Promise((resolve) => {
    const options = {
      hostname,
      path,
      method:  'GET',
      headers: {
        'Authorization': `Token ${TALANA_TOKEN}`,
        'Accept':        'application/json',
        'Content-Type':  'application/json'
      }
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body, error: null }));
    });

    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.setTimeout(12000, () => {
      req.destroy();
      resolve({ status: 0, body: '', error: 'Timeout 12s en ' + hostname });
    });
    req.end();
  });
}
