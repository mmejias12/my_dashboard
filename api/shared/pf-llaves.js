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

// La forma simple, para el caso de UN cliente: tres variables sueltas, sin JSON
// de por medio. Existe porque meter un JSON en una variable de entorno es una
// fuente de errores que no aporta nada cuando hay un solo cliente — y porque
// equivocarse ahí se ve exactamente igual que mandar la clave equivocada.
function simple(env) {
  const e = env || process.env;
  const clave = String(e.PF_CLAVE || '').trim();
  const bpId = Number(e.PF_BP_ID);
  const usuarioIngresoId = Number(e.PF_USUARIO_ID);
  if (clave.length < 24 || !(bpId > 0) || !(usuarioIngresoId > 0)) return [];
  return [{ clave: clave, bpId: bpId, usuarioIngresoId: usuarioIngresoId,
            nombre: String(e.PF_NOMBRE || 'PF') }];
}

function deLista(env) {
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

// La lista manda cuando sirve; si no, la forma simple. Así una PF_CLAVES rota
// no deja el servicio muerto si las tres variables sueltas están bien puestas.
function configuradas(env) {
  const lista = deLista(env);
  return lista.length ? lista : simple(env);
}

function fuenteDe(env) {
  if (deLista(env).length) return 'PF_CLAVES';
  if (simple(env).length) return 'PF_CLAVE';
  return '';
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

// Por qué una entrada de PF_CLAVES no quedó activa. configuradas() descarta en
// silencio —que es lo correcto para servir pedidos— pero entonces una clave mal
// puesta se ve igual que una clave equivocada: 401 y nada más. Esto lo explica,
// sin mostrar ninguna clave.
//
// La HUELLA son los primeros 12 caracteres del sha256 de la clave. Permite
// comparar "la que mando" con "la que está configurada" sin que ninguna de las
// dos viaje ni quede escrita en ningún lado.
function huella(clave) {
  return crypto.createHash('sha256').update(String(clave || ''), 'utf8').digest('hex').slice(0, 12);
}

// La FORMA del valor crudo, sin su contenido. Cuando el JSON no parsea, saber
// con qué empieza y termina, si trae saltos de línea o comillas curvas resuelve
// el problema al instante. La clave vive en el medio y nunca se muestra.
function forma(crudo) {
  const t = String(crudo == null ? '' : crudo);
  // Los extremos sólo se muestran si el valor PARECE un contenedor JSON. Si no
  // lo parece, lo más probable es que alguien haya pegado la clave sola — y
  // entonces esos caracteres son parte del secreto, no de la sintaxis.
  const pareceJson = /^\s*[\[{]/.test(t);
  return {
    largo: t.length,
    pareceJson: pareceJson,
    empieza: pareceJson ? t.slice(0, 2) : '',
    termina: pareceJson ? t.slice(-2) : '',
    saltosDeLinea: /[\r\n]/.test(t),
    // Las comillas curvas son el culpable más común: pasan por Word, Outlook o
    // cualquier editor con autocorrección y a ojo se ven iguales a las rectas.
    comillasCurvas: /[\u201C\u201D\u2018\u2019]/.test(t),
    espaciosAlBorde: t !== t.trim(),
    comillasRectas: (t.match(/"/g) || []).length
  };
}

function clientesDe(buenas) {
  return buenas.map(function (x) {
    return { nombre: x.nombre, bpId: x.bpId, usuarioIngresoId: x.usuarioIngresoId,
             largoClave: x.clave.length, huella: huella(x.clave) };
  });
}

function diagnostico(env) {
  const e = env || process.env;

  // La forma simple se revisa primero para poder contestar derecho cuando es la
  // que está en uso, en vez de hablar de un JSON que nadie puso.
  const sim = simple(e);
  if (!e.PF_CLAVES && sim.length) {
    return { ok: true, fuente: 'PF_CLAVE', entradas: 1, activas: 1,
             clientes: clientesDe(sim), descartadas: [], motivo: '' };
  }

  const crudo = e.PF_CLAVES;
  if (!crudo) {
    const p = [];
    if (e.PF_CLAVE !== undefined && String(e.PF_CLAVE).trim().length < 24) {
      p.push('PF_CLAVE tiene ' + String(e.PF_CLAVE).trim().length + ' caracteres y el mínimo son 24');
    }
    if (e.PF_CLAVE !== undefined && !(Number(e.PF_BP_ID) > 0)) p.push('falta PF_BP_ID');
    if (e.PF_CLAVE !== undefined && !(Number(e.PF_USUARIO_ID) > 0)) p.push('falta PF_USUARIO_ID');
    return { ok: false, fuente: '', entradas: 0, activas: 0, clientes: [], descartadas: [],
             pistas: p,
             motivo: 'no hay claves: pon PF_CLAVE + PF_BP_ID + PF_USUARIO_ID (lo más simple), ' +
                     'o PF_CLAVES con la lista completa en JSON' };
  }
  let lista;
  try { lista = JSON.parse(crudo); }
  catch (err) {
    const f = forma(crudo);
    const pistas = [];
    if (f.comillasCurvas) pistas.push('tiene comillas CURVAS (" ") en vez de rectas (")');
    if (f.saltosDeLinea) pistas.push('tiene saltos de línea; va todo en una sola línea');
    if (f.espaciosAlBorde) pistas.push('tiene espacios al principio o al final');
    if (!f.pareceJson) {
      pistas.push('el valor no parece JSON: no empieza con "[" ni con "{"');
    } else {
      if (f.empieza !== '[{') pistas.push('empieza con ' + JSON.stringify(f.empieza) + ' y debería empezar con "[{"');
      if (f.termina !== '}]') pistas.push('termina con ' + JSON.stringify(f.termina) + ' y debería terminar con "}]"');
    }
    if (f.comillasRectas < 8) pistas.push('tiene ' + f.comillasRectas + ' comillas rectas y hacen falta al menos 8');
    if (sim.length) {
      return { ok: true, fuente: 'PF_CLAVE', entradas: 1, activas: 1,
               clientes: clientesDe(sim), descartadas: [], forma: f, pistas: pistas,
               motivo: 'PF_CLAVES está mal armada y se ignoró; se están usando PF_CLAVE/PF_BP_ID/PF_USUARIO_ID' };
    }
    pistas.push('PF_CLAVES lleva la LISTA COMPLETA en JSON, no la clave sola: ' +
                '[{"clave":"…","bpId":…,"usuarioIngresoId":…}]');
    return { ok: false, fuente: '', entradas: 0, activas: 0, clientes: [], descartadas: [],
             motivo: 'PF_CLAVES no es JSON válido; tiene que ser una lista en una sola línea',
             forma: f, pistas: pistas };
  }
  if (!Array.isArray(lista)) {
    return { ok: false, entradas: 0, activas: 0, clientes: [], descartadas: [],
             motivo: 'PF_CLAVES tiene que ser una LISTA: [{"clave":"…","bpId":…,"usuarioIngresoId":…}]',
             forma: forma(crudo) };
  }
  const descartadas = [];
  lista.forEach(function (x, i) {
    const p = [];
    if (!x || typeof x !== 'object' || Array.isArray(x)) p.push('la entrada no es un objeto');
    else {
      if (typeof x.clave !== 'string') p.push('falta "clave", o no es texto');
      else if (x.clave.length < 24) {
        p.push('la clave tiene ' + x.clave.length + ' caracteres y el mínimo son 24');
      }
      if (!(Number(x.bpId) > 0)) p.push('falta "bpId", o no es un número mayor que cero');
      if (!(Number(x.usuarioIngresoId) > 0)) p.push('falta "usuarioIngresoId", o no es un número mayor que cero');
    }
    if (p.length) descartadas.push({ entrada: i + 1, problemas: p });
  });
  const buenas = configuradas(e);
  return {
    ok: buenas.length > 0,
    fuente: fuenteDe(e),
    entradas: lista.length,
    activas: buenas.length,
    clientes: clientesDe(buenas),
    descartadas: descartadas,
    motivo: buenas.length ? '' : 'ninguna entrada de PF_CLAVES quedó activa'
  };
}

module.exports = { configuradas, deLista, simple, fuenteDe, comparar, identificar,
                   claveDe, huella, diagnostico, forma };
