// ============================================================================
//  api/shared/pf-llaves.js  ·  Quién es quien llama
//
//  PF autentica con una clave por cabecera. Esa clave no identifica a una
//  persona: identifica a un CLIENTE, y de ahí salen el bpId, el usuario que
//  firma en Redlink y el nombre que va a los registros. Nada de eso se le cree
//  al mensaje, justamente porque sale de acá.
//
//  Se configura con la variable PF_CLAVES, un JSON así:
//    [{"clave":"...","bpId":499,"usuarioIngresoId":740,"nombre":"PF"}]
//
//  La comparación es de tiempo constante: comparar claves con === filtra, por
//  lo que tarda, en qué carácter dejaron de coincidir.
// ============================================================================
'use strict';

const crypto = require('crypto');

function configuradas(env) {
  const crudo = (env || process.env).PF_CLAVES;
  if (!crudo) return [];
  let lista;
  try { lista = JSON.parse(crudo); } catch (e) { return []; }
  if (!Array.isArray(lista)) return [];
  return lista.filter(function (x) {
    return x && typeof x.clave === 'string' && x.clave.length >= 24 &&
           Number(x.bpId) > 0 && Number(x.usuarioIngresoId) > 0;
  }).map(function (x) {
    return { clave: String(x.clave), bpId: Number(x.bpId),
             usuarioIngresoId: Number(x.usuarioIngresoId),
             nombre: String(x.nombre || ('bp' + x.bpId)) };
  });
}

// Una clave corta no se acepta ni aunque esté configurada: 24 caracteres es el
// piso para que adivinarla no sea realista.
function comparar(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual exige largos iguales, y el largo en sí ya se filtra. Se
  // normaliza con un hash para que la comparación no dependa del largo.
  const hx = crypto.createHash('sha256').update(x).digest();
  const hy = crypto.createHash('sha256').update(y).digest();
  return crypto.timingSafeEqual(hx, hy);
}

function identificar(clave, env) {
  const c = String(clave || '').trim();
  if (c.length < 24) return null;
  const lista = configuradas(env);
  let hallada = null;
  // Se recorre ENTERA aunque ya haya coincidencia: cortar al primer acierto
  // haría que el tiempo de respuesta delate la posición de la clave.
  lista.forEach(function (x) { if (comparar(x.clave, c)) hallada = x; });
  if (!hallada) return null;
  return { bpId: hallada.bpId, usuarioIngresoId: hallada.usuarioIngresoId, nombre: hallada.nombre };
}

// La clave puede venir en una cabecera propia o como Bearer. Nunca por query:
// ahí quedaría en los registros del servidor y en el historial del navegador.
function claveDe(req) {
  const h = (req && req.headers) || {};
  // Se busca sin importar las mayúsculas. Azure normaliza a minúsculas, pero
  // depender de eso haría que la clave "no exista" si algún día deja de hacerlo.
  const get = function (n) {
    const quiero = String(n).toLowerCase();
    const k = Object.keys(h).find(function (x) { return String(x).toLowerCase() === quiero; });
    return k === undefined ? '' : (h[k] || '');
  };
  const propia = get('x-api-key');
  if (propia) return String(propia).trim();
  const auth = String(get('authorization') || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

module.exports = { configuradas, comparar, identificar, claveDe };
