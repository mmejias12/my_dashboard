// ============================================================================
//  uso-registro/index.js  ·  Registra un evento de uso del m3link
//
//  Lo llama el propio m3link (beacon) al abrir la app, cambiar de vista o abrir
//  una pestaña de módulo. La identidad la inyecta Static Web Apps en el header
//  x-ms-client-principal (correo + roles del login). Best-effort: siempre 204.
//
//    POST /api/uso-registro   body: { vista, area? }
// ============================================================================

const uso = require('../shared/uso-plataforma.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const BUILTIN = new Set(['anonymous', 'authenticated']);

function principal(req){
  try {
    const h = req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
    if (!h) return null;
    return JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
  } catch (e) { return null; }
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  try {
    const p = principal(req);
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const roles = p ? (p.userRoles || []).map(r => String(r).toLowerCase()).filter(r => !BUILTIN.has(r)) : [];
    const ev = {
      ts:     new Date().toISOString(),
      email:  p ? (p.userDetails || '(anónimo)') : '(anónimo)',
      roles:  roles,
      vista:  String(body.vista || '(sin vista)').slice(0, 80),
      area:   body.area ? String(body.area).slice(0, 40) : '',
      ua:     String((req.headers && req.headers['user-agent']) || '').slice(0, 160)
    };
    await uso.registrar(ev);
  } catch (e) { /* best-effort */ }

  context.res = { status: 204, headers: CORS };
};
