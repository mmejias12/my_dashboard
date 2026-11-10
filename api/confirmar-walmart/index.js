// ============================================================================
//  api/confirmar-walmart  ·  POST { folio, cantidad, id? }
//
//  Confirma UNA transferencia de Walmart en Redlink. Es la única escritura del
//  m3link que mueve inventario en SAP, y no se deshace.
//
//  Quién puede llamarla
//  --------------------
//  authLevel "anonymous" acá NO significa abierto: el control está en
//  staticwebapp.config.json, que es donde Static Web Apps lo aplica —
//  allowedRoles ['admin','logistica','jefatura'] para esta ruta. Igual se
//  verifica acá que venga un principal con uno de esos roles: si algún día
//  alguien agrega una regla más arriba que tape la de esta ruta, la función no
//  se queda escribiendo para cualquiera.
//
//  Y se registra QUIÉN la llamó
//  ----------------------------
//  En Redlink toda confirmación queda firmada por M3LinkSystem, así que la
//  firma del portal ya no alcanza para saber quién la hizo. El nombre de la
//  persona sale de x-ms-client-principal y queda en el log de la función. Sin
//  eso, "lo confirmó el m3link" es todo lo que se podría averiguar.
// ============================================================================
'use strict';

const escritura = require('../shared/confirmar-escritura.js');

const ROLES = ['admin', 'logistica', 'jefatura'];

function quien(req) {
  const b64 = (req.headers && (req.headers['x-ms-client-principal'] ||
                               req.headers['X-MS-CLIENT-PRINCIPAL'])) || '';
  if (!b64) return { nombre: '', roles: [] };
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return { nombre: String(p.userDetails || p.userId || ''),
             roles: Array.isArray(p.userRoles) ? p.userRoles.map(String) : [] };
  } catch (e) { return { nombre: '', roles: [] }; }
}

const entero = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Los campos del reporte de Walmart que la página adjunta. NO deciden nada: el
// api sigue leyendo el documento por su cuenta. Van al historial como etiqueta,
// y por eso se acotan acá — vienen del navegador y terminan en un archivo que
// después alguien lee como si fuera verdad.
//
// La CITA es el único de estos datos que no existe en Redlink, y el informe al
// cliente se organiza por cita. Es el motivo de que esto viaje.
const CAMPOS_REPORTE = ['cita', 'po', 'rut', 'razonSocial', 'cd', 'servicio',
                        'recepcionWM', 'aceptados', 'rechazados', 'cuando'];
function reporteDe(cuerpo) {
  const r = (cuerpo && cuerpo.reporte) || {};
  const out = {};
  CAMPOS_REPORTE.forEach(function (k) {
    const v = r[k];
    if (v === null || v === undefined) return;
    out[k] = (typeof v === 'object') ? '' : String(v).slice(0, 200);
  });
  return out;
}

module.exports = async function (context, req) {
  const cors = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cors, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');

  const q = quien(req);
  if (!q.roles.some(r => ROLES.indexOf(r) >= 0)) {
    context.log.warn('confirmar-walmart: rechazado, roles=' + JSON.stringify(q.roles));
    return salir(403, { estado: 'detener', dice: 'no tienes permiso para confirmar transferencias' });
  }

  const cuerpo = req.body || {};
  const folio = entero(cuerpo.folio);
  const cantidad = entero(cuerpo.cantidad);
  const id = cuerpo.id ? entero(cuerpo.id) : null;
  if (!folio || !cantidad) {
    return salir(400, { estado: 'detener',
      dice: 'hacen falta folio y cantidad, los dos enteros mayores que cero' });
  }

  try {
    const r = await escritura.confirmarUna(folio, cantidad, {
      id: id, quien: q.nombre, via: 'pagina', reporte: reporteDe(cuerpo)
    });
    // El log es la única traza de quién lo pidió: en Redlink dice M3LinkSystem.
    context.log('confirmar-walmart: ' + q.nombre + ' -> folio ' + folio + ' x' + cantidad +
                ' = ' + r.estado + ' (' + r.dice + ')');
    return salir(r.estado === 'detener' ? 409 : 200, Object.assign({}, r, { pedidoPor: q.nombre }));
  } catch (e) {
    context.log.error('confirmar-walmart: ' + ((e && e.message) || e));
    // El detalle del error no viaja al navegador: puede traer la respuesta de
    // Redlink y ahí adentro va cualquier cosa.
    return salir(502, { estado: 'detener', folio: folio, cantidad: cantidad,
      dice: 'la confirmación falló antes de completarse; revisar el log de la función' });
  }
};
