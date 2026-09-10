// ============================================================================
//  uso-plataforma/index.js  ·  Resumen de uso del m3link (SOLO admin)
//
//  Devuelve usuarios activos, vistas más usadas y actividad por usuario/área/día
//  para un rango. Protegido por rol admin (header x-ms-client-principal de SWA).
//  Lo consume la página uso-plataforma.html.
//
//    GET /api/uso-plataforma?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// ============================================================================

const uso = require('../shared/uso-plataforma.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const ADMIN_ROLES = (process.env.ADMIN_ROLES || 'admin')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function rolesDe(req){
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
    context.res = { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'solo administradores' }) };
    return;
  }

  try {
    const desde = (req.query.desde || '').trim();
    const hasta = (req.query.hasta || '').trim();
    const data = await uso.agregar(desde, hasta);
    context.res = { status: 200, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
  } catch (err) {
    context.log.error('uso-plataforma:', err.message);
    context.res = { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no se pudo obtener el uso', detail: err.message }) };
  }
};
