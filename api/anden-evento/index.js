// ============================================================================
//  anden-evento/index.js  ·  Bitácora del monitor de andén
//
//    GET  /api/anden-evento?fecha=YYYY-MM-DD
//         Devuelve lo registrado para ese día y el estado vigente por carga,
//         para que el monitor abra ya sabiendo qué se clasificó y qué se
//         atendió — aunque haya sido en otro computador o en el turno anterior.
//
//    POST /api/anden-evento
//         { carga_id, accion, patente?, fecha_carga?, pallets_camara?,
//           bultos?, detalle?, no_sale?, estado_previo?, motivo? }
//
//  La identidad NO viene del cuerpo: la inyecta Static Web Apps en el header
//  x-ms-client-principal a partir del login de Entra. Un cliente no puede
//  firmar una confirmación con el nombre de otro.
//
//  REGLA DE NEGOCIO, VALIDADA ACÁ Y NO SÓLO EN LA PANTALLA: una
//  RELOCALIZACIÓN INTERNA sólo se acepta con la confirmación expresa de que el
//  vehículo no saldrá de las instalaciones (no_sale === true). Sin eso, 400.
//  Si la regla viviera únicamente en el HTML, bastaría un POST a mano para
//  cerrar una alerta crítica sin dejar esa constancia.
// ============================================================================

const reg = require('../shared/anden-registro.js');

const CORS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BUILTIN = new Set(['anonymous', 'authenticated']);

function principal(req) {
  try {
    const h = req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
    if (!h) return null;
    return JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
  } catch (e) { return null; }
}

const hoySantiago = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  try {
    // ── LECTURA ────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const fecha = req.query.fecha || hoySantiago();
      if (!reg.hayStorage()) {
        // Se responde 200 igual: el monitor tiene que poder abrir y operar
        // aunque la bitácora no esté configurada. El campo `registro` le dice
        // que lo que confirme quedará sólo en su equipo, y la pantalla lo
        // advierte en vez de fingir que quedó guardado.
        context.res = {
          status: 200, headers: CORS,
          body: JSON.stringify({ fecha, registro: 'sin-storage', estado: {}, eventos: [] }),
        };
        return;
      }
      const d = await reg.delDia(fecha);
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ...d, registro: 'blob' }) };
      return;
    }

    if (req.method !== 'POST') {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: 'método no permitido' }) };
      return;
    }

    // ── ESCRITURA ──────────────────────────────────────────────────────────
    const p = principal(req);
    if (!p || !p.userDetails) {
      // Sin identidad no hay registro que valga: la regla pide "usuario que
      // confirma". Con la ruta cerrada a authenticated esto no debería pasar.
      context.res = {
        status: 401, headers: CORS,
        body: JSON.stringify({ error: 'sin sesión identificada: no se puede firmar la confirmación' }),
      };
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const accion = String(body.accion || '').trim();
    if (!reg.ACCIONES.has(accion)) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'acción desconocida: ' + accion }) };
      return;
    }
    const cargaId = txt(body.carga_id, 80);
    if (!cargaId) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'falta carga_id' }) };
      return;
    }
    if (accion === 'relocalizacion_interna' && body.no_sale !== true) {
      context.res = {
        status: 400, headers: CORS,
        body: JSON.stringify({
          error: 'la relocalización interna exige la confirmación expresa de que el vehículo '
               + 'no saldrá de las instalaciones (no_sale)',
        }),
      };
      return;
    }

    const ev = {
      ts: new Date().toISOString(),
      accion,
      carga_id: cargaId,
      patente: txt(body.patente, 12),
      // Día del PASO, que es a qué jornada pertenece el evento. Si no viene,
      // cae al día en curso en Santiago (no a UTC: pasadas las 21:00 sería
      // mañana y la confirmación se archivaría en el día equivocado).
      fecha_carga: txt(body.fecha_carga, 40) || hoySantiago(),
      usuario: p.userDetails,
      roles: (p.userRoles || []).map((r) => String(r).toLowerCase()).filter((r) => !BUILTIN.has(r)),
      pallets_camara: Number.isFinite(Number(body.pallets_camara)) ? Number(body.pallets_camara) : null,
      bultos: Number.isFinite(Number(body.bultos)) ? Number(body.bultos) : null,
      detalle: txt(body.detalle, 180),
      motivo: txt(body.motivo, 180),
      // El estado que traía el evento antes de la clasificación: es lo que
      // permite deshacer sin volver a consultar a RDTOut.
      estado_previo: txt(body.estado_previo, 40),
      no_sale: body.no_sale === true,
      // Constancia textual de lo que se firmó, guardada junto al evento para
      // que la bitácora se lea sola dentro de diez meses.
      declaracion: accion === 'relocalizacion_interna'
        ? 'Relocalización Interna: movimiento de pallets entre dependencias de REDTEC. '
          + 'El Supervisor de Despacho confirma expresamente que el vehículo no saldrá de las '
          + 'instalaciones como consecuencia de este movimiento. No constituye autorización de '
          + 'salida ni excepción a la regla de Diferencia Cero, dado que el movimiento no '
          + 'corresponde a un despacho.'
        : null,
      ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 160),
    };

    await reg.registrar(ev);
    context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, evento: ev }) };
  } catch (e) {
    context.log.error('anden-evento', e);
    context.res = {
      status: e.status && e.status < 600 ? e.status : 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
