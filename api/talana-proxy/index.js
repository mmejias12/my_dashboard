// ─── TALANA PROXY ───────────────────────────────────────────────────────────
// Azure Function: /api/talana-proxy
// Reenvía peticiones a app.talana.com con el token de producción en el header.
// El dashboard RRHH llama a /api/talana-proxy?endpoint=/es/api/persona/&page=1
// ────────────────────────────────────────────────────────────────────────────

const https = require('https');

const TALANA_TOKEN = '44655ede473bde96d38dd1f25926cc3603db5c70';
const TALANA_BASE  = 'app.talana.com';

module.exports = async function (context, req) {
  // ── CORS preflight ──────────────────────────────────────────────────────
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

  // ── Parámetros ──────────────────────────────────────────────────────────
  // endpoint: ruta relativa de Talana, ej: /es/api/persona/
  // Todos los demás query params se reenvían tal cual a Talana
  const endpoint = req.query.endpoint;
  if (!endpoint) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Parámetro "endpoint" requerido' })
    };
    return;
  }

  // Construir query string sin el parámetro "endpoint"
  const fwdParams = Object.entries(req.query)
    .filter(([k]) => k !== 'endpoint')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const path = fwdParams ? `${endpoint}?${fwdParams}` : endpoint;

  // ── Llamada a Talana ────────────────────────────────────────────────────
  try {
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: TALANA_BASE,
        path:     path,
        method:   'GET',
        headers: {
          'Authorization': `Token ${TALANA_TOKEN}`,
          'Accept':        'application/json',
          'Content-Type':  'application/json'
        }
      };

      const reqTalana = https.request(options, (resTalana) => {
        let body = '';
        resTalana.on('data', chunk => body += chunk);
        resTalana.on('end', () => {
          resolve({ status: resTalana.statusCode, body });
        });
      });

      reqTalana.on('error', reject);
      reqTalana.setTimeout(15000, () => {
        reqTalana.destroy();
        reject(new Error('Timeout al conectar con Talana'));
      });
      reqTalana.end();
    });

    context.res = {
      status:  data.status,
      headers: corsHeaders,
      body:    data.body
    };

  } catch (err) {
    context.res = {
      status:  502,
      headers: corsHeaders,
      body:    JSON.stringify({ error: 'Error proxy: ' + err.message })
    };
  }
};
