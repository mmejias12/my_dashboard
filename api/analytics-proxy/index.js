// ============================================================================
//  analytics-proxy/index.js  ·  Datos del panel de administración (SOLO admin)
//
//  Devuelve el resumen de uso de REDTEC OS (consultas, usuarios, tokens, costo,
//  preguntas frecuentes, tendencia) para un rango. Protegido por ROL: solo
//  usuarios con rol 'admin' (verificado con el header x-ms-client-principal que
//  inyecta Static Web Apps). Lo consume la página admin-uso.html.
//
//    GET /api/analytics-proxy?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// ============================================================================

const analytics = require('../shared/analytics.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Roles autorizados a ver administración.
const ADMIN_ROLES = (process.env.ADMIN_ROLES || 'admin')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function rolesDe(req) {
  try {
    const h = req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
    if (!h) return [];
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return (p.userRoles || []).map(r => String(r).toLowerCase());
  } catch (e) { return []; }
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  const roles = rolesDe(req);
  if (!roles.some(r => ADMIN_ROLES.includes(r))) {
    context.res = {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'solo administradores' })
    };
    return;
  }

  try {
    const desde = (req.query.desde || '').trim();
    const hasta = (req.query.hasta || '').trim();
    const data = await analytics.agregar(desde, hasta);
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    context.log.error('analytics-proxy:', err.message);
    context.res = {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'no se pudo obtener el uso', detail: err.message })
    };
  }
};