// ─── WORKERA PROXY ──────────────────────────────────────────────────────────
// Azure Function: /api/workera-proxy
//
// Reenvía peticiones a la API de Workera (api.workera.com/apiClient/v1/...)
// Credenciales: leídas desde variables de entorno de Azure Functions:
//   WORKERA_USER  = correo electrónico del usuario API
//   WORKERA_KEY   = API key alfanumérica de 32 caracteres
//
// El dashboard llama a:
//   GET /api/workera-proxy?endpoint=/employee&branchOffice=SURTEC&department=D001&page=1
//   GET /api/workera-proxy?endpoint=/attendanceData&start=2026-04-01&end=2026-04-16&page=1
//   GET /api/workera-proxy?endpoint=/branchOffice
// ────────────────────────────────────────────────────────────────────────────

const https = require('https');

const WORKERA_HOST = 'api.workera.com';
const WORKERA_BASE = '/apiClient/v1';

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, API_USER, API_KEY',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: corsHeaders, body: '' };
    return;
  }

  // Leer credenciales de variables de entorno
  const API_USER = process.env.WORKERA_USER;
  const API_KEY  = process.env.WORKERA_KEY;

  if (!API_USER || !API_KEY) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Credenciales Workera no configuradas',
        detalle: 'Configure WORKERA_USER y WORKERA_KEY en Azure → Function App → Configuration → Application Settings',
        falta_user: !API_USER,
        falta_key:  !API_KEY
      })
    };
    return;
  }

  // Validar parámetro endpoint
  const endpoint = req.query.endpoint;
  if (!endpoint) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Parámetro "endpoint" requerido',
        ejemplos: [
          '/api/workera-proxy?endpoint=/branchOffice',
          '/api/workera-proxy?endpoint=/employee&branchOffice=SURTEC&department=D001&page=1',
          '/api/workera-proxy?endpoint=/attendanceData&start=2026-04-01&end=2026-04-16&page=1'
        ]
      })
    };
    return;
  }

  // Construir path con query params (excluyendo "endpoint")
  const fwdParams = Object.entries(req.query)
    .filter(([k]) => k !== 'endpoint')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const path = WORKERA_BASE + endpoint + (fwdParams ? `?${fwdParams}` : '');

  try {
    const result = await callWorkera(path, req.method, req.body, API_USER, API_KEY);

    context.res = {
      status:  result.status,
      headers: {
        ...corsHeaders,
        'X-Workera-Host':     WORKERA_HOST,
        'X-Workera-Endpoint': endpoint
      },
      body: result.body
    };
  } catch (err) {
    context.res = {
      status: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Error conectando con Workera',
        detalle: err.message,
        host: WORKERA_HOST,
        path: path
      })
    };
  }
};

function callWorkera(path, method, body, apiUser, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: WORKERA_HOST,
      path:     path,
      method:   method || 'GET',
      headers: {
        'API_USER':     apiUser,
        'API_KEY':      apiKey,
        'Accept':       'application/json',
        'Content-Type': 'application/json'
      }
    };

    const reqOut = https.request(options, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end',  () => resolve({ status: res.statusCode, body: chunks }));
    });

    reqOut.on('error', err => reject(err));
    reqOut.setTimeout(30000, () => {
      reqOut.destroy();
      reject(new Error('Timeout 30s — algunos endpoints (attendanceData) tardan varios minutos; prueba con rangos más cortos'));
    });

    if (body && method !== 'GET') {
      reqOut.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    reqOut.end();
  });
}
