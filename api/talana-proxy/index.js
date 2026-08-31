// ─── TALANA PROXY (genérico) ────────────────────────────────────────────────
// Azure Function: /api/talana-proxy
//
// Pasarela directa a la API REST de Talana para consultas puntuales
// (rrhh-dashboard.html y pruebas manuales). El reporte de asistencia NO usa
// esta ruta: va por /api/talana-asistencia, que lee el snapshot en Blob y por
// eso no puede gatillar el bloqueo por exceso de peticiones.
//
//   GET /api/talana-proxy?endpoint=/es/api/persona/&page=1
//   GET /api/talana-proxy?endpoint=/es/api/sucursal/
//
// El token va en la variable de aplicación TALANA_TOKEN. Antes estaba escrito
// en este archivo, es decir publicado en el repositorio: ese token debe
// considerarse comprometido y rotarse en Talana.
//
// Como el proxy queda expuesto a cualquier usuario autenticado del portal, sólo
// deja pasar recursos de LECTURA de una lista blanca; todo lo demás se rechaza.
//
// Las llamadas salen por shared/talana-client.js, que las serializa con una
// separación mínima entre peticiones. Esto importa: rrhh-dashboard.html pide
// el saldo de vacaciones de hasta 50 personas una tras otra, y sin freno eso
// supera las 50 req/min y hace que Talana bloquee la URL 10 minutos — lo que
// dejaría caído también el reporte de asistencia.
// ────────────────────────────────────────────────────────────────────────────

const cliente = require('../shared/talana-client.js');

const HOST       = cliente.HOST;
const BASE       = cliente.BASE;
const EMPRESA_ID = process.env.TALANA_EMPRESA_ID || '';

// Recursos de sólo lectura que este proxy permite reenviar.
const PERMITIDOS = [
  '/persona/', '/personas-paginadas/',
  '/contrato-paginado/', '/contracts-resumed-paginated/',
  '/sucursal/', '/centroCosto/', '/centroCosto-paginado/',
  '/unidadOrganizacional/', '/job-title/',
  '/mark/', '/workShift/', '/workShift-paginado/', '/workShiftPersonRange/',
  '/rotativeDay/', '/rotativeDay-paginado/', '/specialRotativeDay/',
  '/specificDay/', '/specificDay-paginado/', '/workedDays', '/jornadaLaboral/',
  '/absentism-resumed/', '/vacations-resumed/', '/administrative-leaves-resumed/',
  '/personaAusencia-paginado/', '/vacacionesSolicitud/',
  '/diaAdministrativoSolicitud/', '/saldo-vacaciones-empresa/'
];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  if (!cliente.tieneToken()) {
    context.res = {
      status: 500, headers: CORS,
      body: JSON.stringify({
        error: 'TALANA_TOKEN no configurado',
        detalle: 'Azure → Static Web App → Configuración → Variables de aplicación → TALANA_TOKEN'
      })
    };
    return;
  }

  const bruto = req.query.endpoint;
  if (!bruto) {
    context.res = {
      status: 400, headers: CORS,
      body: JSON.stringify({
        error: 'Parámetro "endpoint" requerido.',
        ejemplo: '/api/talana-proxy?endpoint=/es/api/persona/',
        permitidos: PERMITIDOS
      })
    };
    return;
  }

  // Acepta '/es/api/persona/' o 'persona/'; normaliza a un recurso bajo BASE.
  let recurso = String(bruto);
  if (recurso.startsWith(BASE)) recurso = recurso.slice(BASE.length);
  if (!recurso.startsWith('/')) recurso = '/' + recurso;
  if (recurso.includes('..')) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'endpoint inválido' }) };
    return;
  }

  const permitido = PERMITIDOS.some(p => recurso === p || recurso.startsWith(p));
  if (!permitido) {
    context.res = {
      status: 403, headers: CORS,
      body: JSON.stringify({ error: `Recurso no permitido por el proxy: ${recurso}`, permitidos: PERMITIDOS })
    };
    return;
  }

  const params = {};
  for (const [k, v] of Object.entries(req.query)) if (k !== 'endpoint') params[k] = v;

  // Algunos recursos filtran por empresa; se inyecta sólo si está configurada
  // y el llamador no la mandó.
  const necesitaEmpresa = ['/persona/', '/personas-paginadas/', '/contrato', '/vacaciones']
    .some(p => recurso.startsWith(p));
  if (EMPRESA_ID && necesitaEmpresa && params.empresa === undefined) params.empresa = EMPRESA_ID;

  try {
    const presupuesto = cliente.crearPresupuesto(35000);
    const r = await cliente.get(recurso, params, { presupuesto });

    if (r.agotado) {
      context.res = {
        status: 503,
        headers: { ...CORS, 'Retry-After': '30' },
        body: JSON.stringify({
          error: 'Talana está limitando el uso (429) o la cola no alcanzó a despachar',
          detalle: 'Reintenta en unos segundos. El proxy espacía las peticiones a propósito.',
          recurso
        })
      };
      return;
    }

    context.res = {
      status: r.status || 502,
      headers: { ...CORS, 'X-Talana-Host': HOST },
      body: r.cuerpo || JSON.stringify({ error: 'Respuesta vacía de Talana', _path: r.path })
    };
  } catch (err) {
    context.res = {
      status: 502, headers: CORS,
      body: JSON.stringify({ error: 'Error conectando con Talana', detalle: err.message, host: HOST })
    };
  }
};
