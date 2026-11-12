// ============================================================================
//  api/pf-relocalizacion
//
//  El endpoint que reemplaza al de M2LINK para las relocalizaciones de PF.
//  Acepta el MISMO cuerpo que PF manda hoy y lo traduce al formHeader nativo
//  de Redlink. Para PF cambia la URL y la autenticación, nada más.
//
//  AUTENTICACIÓN. Clave de API por cabecera (`X-API-Key`, o `Authorization:
//  Bearer`). La clave no identifica a una persona: identifica al CLIENTE, y de
//  ahí salen el bpId y el usuario que firma en Redlink. La ruta es anónima para
//  Entra a propósito —PF es una máquina, no un usuario del portal— y el permiso
//  lo decide esta función.
//
//  LO QUE DEVUELVE. JSON con `nroPedido`, que es el folio: el mismo número que
//  devolvía el API viejo. Medido en DEMO el 12-nov: el POST de Redlink devuelve
//  el formHeaderiD y NO el folio, así que el folio sale de releer el documento.
//
//  La clave NUNCA se registra ni viaja de vuelta. Al log va el nombre del
//  cliente que resolvió.
// ============================================================================
'use strict';

const llaves = require('../shared/pf-llaves.js');
const escritura = require('../shared/pf-escritura.js');

// Un cuerpo de relocalización son unos pocos campos: cualquier cosa más grande
// no es un pedido, es otra cosa.
const MAX_CUERPO = 8 * 1024;

function tamanoDe(req) {
  const h = (req && req.headers) || {};
  const n = parseInt(h['content-length'] || h['Content-Length'] || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

module.exports = async function (context, req) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cab, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');
  if (req.method !== 'POST') {
    return salir(405, { estado: 'rechazado', dice: 'esta ruta sólo acepta POST' });
  }

  const identidad = llaves.identificar(llaves.claveDe(req));
  if (!identidad) {
    // Sin detalles: decir "la clave existe pero está vencida" ayuda a adivinar.
    context.log.warn('pf-relocalizacion: clave no reconocida');
    return salir(401, { estado: 'rechazado', dice: 'clave de API no reconocida' });
  }

  if (tamanoDe(req) > MAX_CUERPO) {
    return salir(413, { estado: 'rechazado', dice: 'el cuerpo es demasiado grande' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return salir(400, { estado: 'rechazado', dice: 'se esperaba un objeto JSON con la relocalización' });
  }

  const falta = escritura.faltantes();
  if (falta.length) {
    context.log.error('pf-relocalizacion: faltan credenciales (' + falta.join(', ') + ')');
    return salir(503, { estado: 'no-disponible',
      dice: 'el servicio no tiene cargadas sus credenciales contra Redlink' });
  }

  try {
    const r = await escritura.procesar(req.body, identidad);
    // Queda quién pidió qué: en Redlink la firma dice AAAA_PF_Relocalizaciones
    // para todas, así que esta línea es la única traza de la llamada.
    context.log('pf-relocalizacion: ' + identidad.nombre + ' doc ' +
                (req.body.documentoNumero || req.body.DocumentoNumero) + ' -> ' +
                r.estado + ' (' + (r.nroPedido || '-') + ')');
    const cuerpo = Object.assign({}, r);
    delete cuerpo.http;
    return salir(r.http, cuerpo);
  } catch (e) {
    // El detalle puede traer la respuesta de Redlink y ahí va cualquier cosa.
    context.log.error('pf-relocalizacion: ' + ((e && e.message) || e));
    return salir(500, { estado: 'no-disponible',
      dice: 'la solicitud falló de forma inesperada; revisar el log de la función' });
  }
};

module.exports.MAX_CUERPO = MAX_CUERPO;
module.exports.tamanoDe = tamanoDe;
