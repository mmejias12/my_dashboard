#!/usr/bin/env node
// ============================================================================
//  scripts/confirmar-redlink.js
//
//  CONFIRMA UNA transferencia en Redlink PRODUCTIVO. Escribe de verdad, y esa
//  escritura dispara un ajuste de inventario en SAP que no se deshace.
//
//  Cómo se confirma de verdad
//  --------------------------
//  Son DOS pasos, y el orden importa:
//
//    1. GET  /api/FormHeader/ConfirmarTransferencia/Folio/{folio}/recibido/{n}
//            /original/{marca}/usuarioconfirma/{usersiD}
//       El servidor arma el documento confirmado y lo devuelve.
//    2. PATCH /api/FormHeader  con ESE cuerpo, tal cual vino.
//
//  Durante ocho intentos armamos el cuerpo nosotros y el servidor devolvió 400
//  las ocho veces. No era el avanzaEtapa ni la firma ni el entorno: era que a
//  ese PATCH hay que devolverle el cuerpo que él mismo preparó. La ruta salió
//  de la macro Confirmacion_Ver2.xlsm que el proveedor mandó usar cuando dejó
//  de contestar por la API (10-nov-2026).
//
//  Por qué es de a una
//  -------------------
//  Toma UN folio y UNA cantidad. Sin lotes, sin archivos, sin bucles. La
//  escritura dispara un ajuste de inventario en SAP que no se deshace, así que
//  la primera prueba se hace sobre una transferencia que YA correspondía
//  confirmar por esa misma cantidad: si funciona, se hizo lo correcto; si
//  falla, no pasó nada. Cuando el contrato esté probado, el lote se construye
//  aparte y a conciencia.
//
//  La firma
//  --------
//  La confirmación queda escrita con el usuario que la ejecuta, y esa firma es
//  la trazabilidad que alguien va a mirar en la pantalla de transacciones. Por
//  eso exige las credenciales de M3LinkSystem y se niega a usar el usuario de
//  lectura: confirmar con el usuario equivocado no se corrige después.
//
//  Uso
//  ---
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --preparar
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si
//    node scripts/confirmar-redlink.js --productivo --usuario=M3LinkSystem
//
//  Sin --productivo no hace nada: la bandera está para que nadie llegue acá
//  por inercia. Sin --si ni --preparar muestra el plan y se detiene sin tocar
//  el servidor. Con --preparar pide el documento y lo muestra, sin mandarlo.
//
//  Variables de entorno:
//    REDLINK_CLIENT_SECRET        (el mismo cliente apiportalredtec)
//    REDLINK_M3LINK_USER          (M3LinkSystem)
//    REDLINK_M3LINK_PASS
//    REDLINK_USER                 (sólo para comprobar que no son el mismo)
//    REDLINK_M3LINK_USERSID       (983; se coteja con la API antes de escribir)
//    REDLINK_ORIGEN               (la marca de procedencia; M3LINK)
// ============================================================================
'use strict';

const path = require('path');
const sonda = require(path.join(__dirname, 'sonda-escritura-redlink.js'));

const HOST = 'api.portalredtec.cl';
const API  = 'https://' + HOST;
const TOKEN_URL = 'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const CLIENT_ID = 'apiportalredtec';
const BP_REDTEC = '433';
let PLAZO = 60000;
function fijarPlazo(seg) { const n = parseInt(seg, 10); if (Number.isFinite(n) && n > 0) PLAZO = n * 1000; }

/* ------------------------------------------------- credenciales ---------- */

// Confirmar con el usuario de lectura dejaría la traza a nombre de quien no
// confirmó. Es un error que no se ve hasta que alguien audita, y para entonces
// ya no se puede corregir.
function revisarCredenciales(env) {
  env = env || process.env;
  const problemas = [];
  // Se LEE con el usuario de lectura y se ESCRIBE con M3LinkSystem. Son dos
  // alcances distintos y no hay razón para suponer que el de escritura puede
  // leer el histórico: suponerlo fue lo que hizo fallar la primera corrida.
  ['REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS',
   'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'].forEach(function (k) {
    const v = env[k];
    if (!v || !String(v).trim()) problemas.push('falta ' + k);
    else if (/[<>]/.test(String(v))) problemas.push(k + ' quedó con un marcador pegado literal');
  });
  const u = String(env.REDLINK_M3LINK_USER || '').trim();
  const lectura = String(env.REDLINK_USER || '').trim();
  if (u && lectura && u.toLowerCase() === lectura.toLowerCase()) {
    problemas.push('REDLINK_M3LINK_USER es el MISMO usuario de lectura: la confirmación ' +
                   'quedaría firmada por quien no confirmó');
  }
  return problemas;
}

/* ------------------------------------------------- el plan --------------- */

// El circuito es 37 -> 43 (Pendiente Adjuntar Respaldo) -> 44 (Pendiente de
// Confirmación) -> 46 (Confirmada). La tabla FormMetapa marca con
// Confirmar=true solo la 44, y durante dias se trabajo suponiendo que la 43
// habia que respetarla.
//
// RESUELTO el 9-nov-2026 por Marcelo: en las confirmaciones MASIVAS de Walmart
// no corresponde adjuntar respaldo. Ese paso existe para que la gente de
// logistica no tenga que ir documento por documento; por el camino masivo se
// confirma de una. O sea la 43 TAMBIEN es confirmable en este circuito.
//
// Esto no es "cualquier etapa": la lista es explicita y corta. La 46 y la 49
// ya estan confirmadas y la 47 esta anulada; ninguna de esas se toca.
const ETAPAS_CONFIRMABLES = [/pendiente\s+de\s+confirmaci/i, /pendiente\s+adjuntar\s+respaldo/i];
const etapaDe = (doc) => String((doc && doc.formMetapa && doc.formMetapa.nombre) || '');
const etapaConfirmable = (doc) => ETAPAS_CONFIRMABLES.some(re => re.test(etapaDe(doc)));

const esConfirmada = (doc) => {
  const det = (doc && doc.formDdetalles && doc.formDdetalles[0]) || {};
  const n = Number(det.recepcion) || 0;
  return n > 0 && !/^\s*pendiente/i.test(String((doc && doc.formMetapa && doc.formMetapa.nombre) || ''));
};

// Todo lo que tiene que ser cierto ANTES de escribir, junto y nombrado. Un
// solo problema detiene la operación: acá no hay "seguir con lo que se pueda".
//
// Lo que este plan YA NO hace es armar el cuerpo del PATCH. Lo armó durante
// ocho intentos y el servidor devolvió 400 las ocho veces: ese cuerpo lo arma
// el servidor en ConfirmarTransferencia y nosotros se lo devolvemos tal cual.
// Acá sólo se decide si corresponde pedirlo, y con qué número de usuario.
function planDeConfirmacion(doc, cantidad, usersId) {
  const firma = (usersId === undefined || usersId === null) ? USERSID_M3LINK : Number(usersId);
  const problemas = [];
  if (!doc || typeof doc !== 'object') return { ok: false, problemas: ['no se pudo leer el documento'] };

  const det = (doc.formDdetalles || []).filter(d => d && typeof d === 'object');
  const desp = det.length ? Number(det[0].despachado) || 0 : 0;
  const n = Number(cantidad);

  // El número de usuario viaja en la URL: es lo que el servidor usa para saber
  // a nombre de quién preparar la confirmación. Sin él no hay nada que pedir.
  if (!(firma > 0)) problemas.push('no hay usersiD de ' + NOMBRE_M3LINK +
    ': sin ese número el servidor no sabe a nombre de quién preparar la confirmación');
  if (Number(doc.formId) !== 6) problemas.push('no es una transferencia (formId ' + doc.formId + ')');
  const destino = String(doc.bpDestinoNombre || '');
  if (!/walmart/i.test(destino)) problemas.push('el destino no es Walmart: ' + (destino || '(vacío)'));
  if (det.length !== 1) problemas.push('el documento tiene ' + det.length + ' líneas de detalle; esta versión confirma una');
  if (esConfirmada(doc)) problemas.push('la transferencia YA está confirmada');
  else if (!etapaConfirmable(doc)) problemas.push('la etapa es "' + (etapaDe(doc) || '(vacía)') +
    '" y las confirmables son "Pendiente de Confirmación" y "Pendiente Adjuntar Respaldo"');
  if (!Number.isFinite(n) || n <= 0) problemas.push('la cantidad a confirmar tiene que ser un número mayor que cero');
  else if (!desp) problemas.push('la línea no tiene cantidad despachada: no hay contra qué confirmar');
  else if (n > desp) problemas.push('se pide confirmar ' + n + ' y sólo se despacharon ' + desp);

  if (problemas.length) return { ok: false, problemas: problemas };

  // urlConfirmar vuelve a validar los tres números por su cuenta. Que una
  // excepción de armado de URL salga como problema del plan y no como un
  // reventón a mitad de camino.
  let url;
  try { url = urlConfirmar(doc.folio, n, firma, ORIGEN); }
  catch (e) { return { ok: false, problemas: [(e && e.message) || String(e)] }; }

  return {
    ok: true,
    problemas: [],
    usersId: firma,
    resumen: {
      folio: doc.folio, id: doc.formHeaderiD,
      cliente: doc.bpOrigenNombre, destino: doc.bpDestinoNombre,
      bodega: doc.bodegaDestinoNombre, etapa: (doc.formMetapa || {}).nombre,
      despachado: desp, aConfirmar: n, porAvisar: 0
    },
    url: url
  };
}

const CAMPOS_ESTADO = ['formMetapaId', 'avanzaEtapa', 'fechaConfirmacion', 'confirmacionVeces', 'usuarioConfirmaId'];

// Un 200 no prueba nada: lo que prueba es el documento releído. Se comparan
// los campos de estado y los de la línea, y se muestran los que cambiaron.
function comparar(antes, despues) {
  const out = [];
  const det = (d) => ((d && d.formDdetalles && d.formDdetalles[0]) || {});
  CAMPOS_ESTADO.forEach(function (k) {
    const a = antes ? antes[k] : undefined, b = despues ? despues[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: k, antes: a, despues: b });
  });
  ['despachado', 'recepcion'].forEach(function (k) {
    const a = det(antes)[k], b = det(despues)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: 'detalle.' + k, antes: a, despues: b });
  });
  const ea = (antes && antes.formMetapa || {}).nombre, ed = (despues && despues.formMetapa || {}).nombre;
  if (ea !== ed) out.push({ campo: 'etapa', antes: ea, despues: ed });
  return out;
}

function leerArgs(argv) {
  const a = { productivo: false, folio: null, cantidad: null, si: false, dias: '30', quien: null,
              usuario: null, preparar: false, tramo: '7', timeout: null };
  for (const x of (argv || [])) {
    if (x === '--productivo') a.productivo = true;
    else if (x === '--si') a.si = true;
    else if (x.indexOf('--folio=') === 0) a.folio = x.slice(8);
    else if (x.indexOf('--cantidad=') === 0) a.cantidad = x.slice(11);
    else if (x.indexOf('--dias=') === 0) a.dias = x.slice(7);
    else if (x.indexOf('--tramo=') === 0) a.tramo = x.slice(8);
    else if (x.indexOf('--timeout=') === 0) a.timeout = x.slice(10);
    else if (x.indexOf('--quien=') === 0) { a.quien = x.slice(8); a.folio = a.folio || a.quien; }
    else if (x.indexOf('--usuario=') === 0) a.usuario = x.slice(10);
    // --preparar pide el documento al servidor y se detiene antes del PATCH.
    // Es el único paso que permite MIRAR el cuerpo que se va a mandar antes de
    // mandarlo, y por eso es el primer disparo recomendado sobre un folio real.
    else if (x === '--preparar') a.preparar = true;
  }
  return a;
}

// El usersiD numérico de M3LinkSystem en PRODUCCIÓN, que Marcelo confirmó el
// 9-nov-2026. Es lo que se escribe en `usuarioIngresoId` para que la
// confirmación quede firmada por el usuario de sistema del m3link.
//
// OJO: este número es de PRODUCCIÓN. DEMO es otra base y su id puede ser otro;
// escribir el de DEMO acá firmaría con el usuario equivocado.
// Patrón de control: M2LinkSystem, el usuario del módulo viejo, es 951.
const USERSID_M3LINK = Math.max(0, parseInt(process.env.REDLINK_M3LINK_USERSID || '983', 10) || 0);
const NOMBRE_M3LINK = 'M3LinkSystem';

// LA RUTA QUE FALTABA. Sacada de la macro Confirmacion_Ver2.xlsm que el
// proveedor mandó usar como reemplazo (10-nov-2026). El servidor ARMA el
// documento a confirmar y lo devuelve; nosotros sólo se lo devolvemos tal cual
// por PATCH. Durante ocho intentos armamos el cuerpo a mano, que es por lo que
// siempre dio 400: le mandábamos a ese endpoint un cuerpo que no era el suyo.
//
// El segmento `original/` es una marca de procedencia que queda del lado del
// servidor: la planilla manda CONFIRMAVER2, nosotros mandamos M3LINK para que
// en el portal se distinga quién confirmó qué.
const ORIGEN = String(process.env.REDLINK_ORIGEN || 'M3LINK').trim() || 'M3LINK';

function urlConfirmar(folio, cantidad, usersId, origen) {
  const f = String(folio == null ? '' : folio).trim();
  const c = String(cantidad == null ? '' : cantidad).trim();
  const u = String(usersId == null ? '' : usersId).trim();
  const o = String(origen || ORIGEN).trim();
  if (!/^\d+$/.test(f)) throw new Error('el folio tiene que ser un número: ' + JSON.stringify(folio));
  if (!/^\d+$/.test(c)) throw new Error('la cantidad tiene que ser un número: ' + JSON.stringify(cantidad));
  if (!/^\d+$/.test(u)) throw new Error('el usersiD tiene que ser un número: ' + JSON.stringify(usersId));
  if (!/^[A-Za-z0-9_-]+$/.test(o)) throw new Error('la marca de origen sólo admite letras, números, guion y guion bajo: ' + JSON.stringify(o));
  return '/api/FormHeader/ConfirmarTransferencia/Folio/' + f +
         '/recibido/' + c + '/original/' + o + '/usuarioconfirma/' + u;
}

// Lo que devuelve esa ruta antes de mandarlo de vuelta. Un 200 con la palabra
// "error" adentro NO es un documento: la macro hace esta misma comprobación.
function revisarPreparado(texto, folio, cantidad) {
  const crudo = String(texto == null ? '' : texto);
  const problemas = [];
  if (!crudo.trim()) return { ok: false, problemas: ['el servidor devolvió el cuerpo vacío'], doc: null };
  let doc = null;
  try { doc = JSON.parse(crudo); }
  catch (e) { return { ok: false, problemas: ['la respuesta no es JSON: ' + sonda.enmascarar(crudo).slice(0, 200)], doc: null }; }
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && doc.error) {
    return { ok: false, problemas: ['el servidor contestó un error: ' + String(doc.error).slice(0, 200)], doc: doc };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, problemas: ['la respuesta no es un documento'], doc: doc };
  }
  // Que el documento que volvió sea el que pedimos: un folio cruzado acá
  // confirmaría la transferencia equivocada.
  if (String(doc.folio) !== String(folio)) {
    problemas.push('el documento que volvió es del folio ' + doc.folio + ' y pedimos el ' + folio);
  }
  const det = (doc.formDdetalles || []).filter(d => d && typeof d === 'object');
  if (det.length !== 1) problemas.push('el documento trae ' + det.length + ' líneas de detalle; esta versión confirma una');
  else if (Number(det[0].recepcion) !== Number(cantidad)) {
    problemas.push('el documento viene con recepción ' + det[0].recepcion + ' y pedimos ' + cantidad);
  }
  return { ok: !problemas.length, problemas: problemas, doc: doc,
           etapa: String((doc.formMetapa || {}).nombre || ''), firma: firmaDe(doc) };
}

// ---- a quién firmar, preguntado por nombre --------------------------------
//
// La macro no lleva el número escrito: pregunta por el nombre y usa lo que el
// servidor contesta. Es mejor que un número a mano por una razón concreta: el
// nombre es lo que una persona puede verificar mirando el portal, el número no.
//
// El servidor busca por coincidencia, así que pedir "M3Link" puede traer otro
// usuario cuyo nombre lo contenga. Si el nombre que vuelve no es exactamente
// el que se pidió, el número no es el que se cree que es.
function interpretarUsuario(texto, nombre) {
  const crudo = String(texto == null ? '' : texto);
  const nada = { ok: false, id: null, nombre: '' };
  if (!crudo.trim()) return Object.assign({ problemas: ['el servidor devolvió el cuerpo vacío'] }, nada);
  let j;
  try { j = JSON.parse(crudo); }
  catch (e) {
    return Object.assign({ problemas: ['la respuesta no es JSON: ' + sonda.enmascarar(crudo).slice(0, 200)] }, nada);
  }
  const lista = (Array.isArray(j) ? j : [j]).filter(x => x && typeof x === 'object');
  const conId = lista.filter(x => Number(x.usersiD) > 0);
  if (!conId.length) {
    return Object.assign({ problemas: ['no vino ningún usersiD para "' + nombre + '"'] }, nada);
  }
  const pedido = String(nombre || '').trim().toLowerCase();
  const exactos = conId.filter(x => String(x.userName || '').trim().toLowerCase() === pedido);
  const elegidos = exactos.length ? exactos : conId;
  if (elegidos.length > 1) {
    return Object.assign({ problemas: ['el nombre "' + nombre + '" devolvió ' + elegidos.length +
      ' usuarios (' + elegidos.map(x => String(x.userName || '?') + '=' + x.usersiD).join(', ') +
      '): no se elige uno'] }, nada);
  }
  const u = elegidos[0];
  const encontrado = String(u.userName || '').trim();
  const problemas = [];
  if (pedido && encontrado.toLowerCase() !== pedido) {
    problemas.push('se pidió "' + nombre + '" y el servidor devolvió "' + (encontrado || '(sin nombre)') + '"');
  }
  return { ok: !problemas.length, problemas: problemas, id: Number(u.usersiD), nombre: encontrado };
}

// El nombre entra a una URL, así que se valida ANTES y de forma sincrónica:
// una validación adentro de una async se convierte en una promesa rechazada y
// se la puede tragar quien no la espere.
const RE_NOMBRE_USUARIO = /^[A-Za-z0-9_.-]+$/;
function rutaDeUsuario(nombre) {
  const n = String(nombre == null ? '' : nombre).trim();
  if (!n) throw new Error('falta el nombre de usuario');
  if (!RE_NOMBRE_USUARIO.test(n)) {
    throw new Error('el nombre de usuario sólo admite letras, números, punto, guion y guion bajo: ' + JSON.stringify(nombre));
  }
  return '/api/User/nombreusuario/' + encodeURIComponent(n);
}

async function idDeUsuario(nombre, pedirFn) {
  const p = pedirFn || pedir;
  const ruta = rutaDeUsuario(nombre);
  const n = String(nombre).trim();
  const r = await p(ruta, { method: 'GET' }, 'escritura');
  if (r.status !== 200) {
    return { ok: false, id: null, nombre: '', problemas: ['HTTP ' + r.status + ' al resolver "' + n + '"' +
      (r.texto ? ' · ' + sonda.enmascarar(String(r.texto)).slice(0, 200) : '')] };
  }
  return interpretarUsuario(r.texto, n);
}

// Qué decir cuando la API y el número configurado no coinciden. No se elige
// uno: un número de usuario equivocado firma a otra persona y no da error.
function cotejarFirma(resuelto, configurado) {
  if (!resuelto || !resuelto.ok) {
    return { ok: true, usar: configurado, verificado: false,
             dice: 'no se pudo verificar por API (' + (((resuelto || {}).problemas || ['sin detalle'])[0]) +
                   '); se usa el ' + configurado + ' configurado' };
  }
  if (Number(resuelto.id) !== Number(configurado)) {
    return { ok: false, usar: null, verificado: true,
             dice: 'la API dice que ' + NOMBRE_M3LINK + ' es ' + resuelto.id + ' y acá está configurado ' +
                   configurado + '. No se elige uno de los dos: hay que resolver cuál es antes de firmar' };
  }
  return { ok: true, usar: configurado, verificado: true,
           dice: 'verificado: ' + (resuelto.nombre || NOMBRE_M3LINK) + ' es ' + configurado };
}

// Quien firma un documento. Es `usuarioIngresoId`, no `usuarioConfirmaId`:
// medido el 9-nov-2026, una confirmacion manual real dejo usuarioConfirmaId en
// null y sobrescribio usuarioIngresoId con el usuario que actuo. El servidor
// NO lo deduce del token, guarda lo que se le manda.
//
// Para que esto sirva hay que leer un documento que el usuario HAYA TOCADO:
// el nombre confirma de quien es el numero, y sin el nombre el numero no
// prueba nada.
function firmaDe(doc) {
  if (!doc || typeof doc !== 'object') return { id: null, nombre: '', confirmaId: null };
  const n = Number(doc.usuarioIngresoId);
  return {
    id: Number.isFinite(n) && n > 0 ? n : null,
    nombre: String(doc.usuarioIngresoNombre || '').trim(),
    confirmaId: (doc.usuarioConfirmaId === null || doc.usuarioConfirmaId === undefined)
      ? null : Number(doc.usuarioConfirmaId)
  };
}

/* ------------------------------------------------- red ------------------- */

const USUARIOS = {
  lectura:   { u: 'REDLINK_USER',        p: 'REDLINK_PASS',        quien: 'el usuario de lectura' },
  escritura: { u: 'REDLINK_M3LINK_USER', p: 'REDLINK_M3LINK_PASS', quien: 'M3LinkSystem' }
};
const _tok = {};
async function token(tipo) {
  const cfg = USUARIOS[tipo];
  if (!cfg) throw new Error('tipo de usuario desconocido: ' + tipo);
  if (_tok[tipo]) return _tok[tipo];
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: process.env.REDLINK_CLIENT_SECRET,
      grant_type: 'password', username: process.env[cfg.u],
      password: process.env[cfg.p], scope: 'openid'
    }),
    signal: AbortSignal.timeout(PLAZO)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('No se pudo autenticar como ' + cfg.quien + ' (HTTP ' + r.status + ') ' +
      sonda.leerErrorToken(r.status, t).dice);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('El token de ' + cfg.quien + ' vino sin access_token');
  _tok[tipo] = j.access_token;
  return _tok[tipo];
}

async function pedir(ruta, opciones, tipo) {
  const url = API + ruta;
  const o = Object.assign({}, opciones || {});
  o.headers = Object.assign({ Authorization: 'Bearer ' + (await token(tipo || 'lectura')), Accept: 'application/json' }, o.headers || {});
  if (!o.signal) o.signal = AbortSignal.timeout(PLAZO);
  let r;
  try { r = await fetch(url, o); }
  catch (e) { throw sonda.conHost(e, url); }
  return Object.assign({ status: r.status }, await leerCuerpo(r));
}

// El cuerpo se lee aparte y su falla NO se tapa. Un `.catch(() => '')` acá
// convierte un corte a mitad de descarga en "respondió vacío", que es una
// afirmación distinta y manda a buscar el problema al lado equivocado.
async function leerCuerpo(r) {
  const cab = (n) => (r && r.headers && r.headers.get) ? r.headers.get(n) : null;
  let texto = '', falloCuerpo = null;
  try { texto = await r.text(); }
  catch (e) { falloCuerpo = (e && e.message) ? e.message : String(e); }
  return { texto: texto, falloCuerpo: falloCuerpo,
           largoDeclarado: cab('content-length'), tipo: cab('content-type') };
}

// Después de escribir, lo único que prueba que el número era el correcto es el
// NOMBRE que devolvió el servidor. Un id equivocado no da error: graba otro
// usuario y queda igual de callado.
function veredictoDeFirma(docDespues, esperado) {
  const esp = (esperado === undefined || esperado === null) ? USERSID_M3LINK : Number(esperado);
  const f = firmaDe(docDespues);
  if (f.id === esp && f.nombre.toLowerCase() === NOMBRE_M3LINK.toLowerCase()) {
    return { ok: true, dice: 'firmada por ' + f.nombre + ' (' + f.id + ')' };
  }
  if (f.id === esp) {
    return { ok: false, dice: 'el id ' + f.id + ' quedó grabado pero el nombre es "' +
      (f.nombre || '(vacío)') + '", no ' + NOMBRE_M3LINK + ': el número NO es de ese usuario' };
  }
  return { ok: false, dice: 'se mandó ' + esp + ' y quedó ' +
    (f.id === null ? '(vacío)' : f.id) + ' / "' + (f.nombre || '(vacío)') +
    '": la confirmación NO quedó firmada por ' + NOMBRE_M3LINK };
}

// Qué decir cuando el histórico no trae un JSON utilizable. Separa las tres
// cosas que hasta ahora se contaban como una sola: se cortó la descarga, el
// servidor contestó vacío de verdad, o contestó algo que no es JSON.
function porQueNoHayJson(r) {
  if (r.falloCuerpo) {
    return ['la descarga se CORTÓ a mitad de camino: ' + r.falloCuerpo,
            'no es que no haya datos — no se alcanzó a leer la respuesta',
            'probá con --dias menor (una ventana más chica baja el tamaño)'];
  }
  const declarado = r.largoDeclarado;
  if (!String(r.texto || '').length) {
    const out = ['el servidor contestó HTTP ' + r.status + ' con el cuerpo vacío'];
    if (declarado && declarado !== '0') {
      out.push('pero declaró content-length ' + declarado + ': el cuerpo se perdió, no vino vacío');
    } else {
      out.push('y declaró content-length ' + (declarado === null ? '(sin dato)' : declarado));
      out.push('suele ser que el usuario de lectura no alcanza a ese BP, o que no hay datos en la ventana');
    }
    return out;
  }
  return ['la respuesta no es JSON (content-type ' + (r.tipo || '(sin dato)') + ')',
          'primeros bytes: ' + sonda.enmascarar(String(r.texto)).slice(0, 200)];
}

const atras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const dos = (n) => String(n).padStart(2, '0');
function aUS(iso) { const p = iso.split('-'); return p[1] + '-' + p[2] + '-' + p[0]; }

// El folio es el número del área; el id del documento es interno. Para escribir
// hace falta el id, así que primero se busca el folio en el histórico.
// Los tramos, del MÁS NUEVO al más viejo. Un folio que se está confirmando hoy
// suele ser de los últimos días, así que buscando desde el presente se encuentra
// en el primer o segundo tramo y no hace falta bajar el resto.
//
// Por qué por tramos y no de una: 31 días del BP 433 son ~17.500 operaciones con
// el registro crudo completo, y esa descarga se corta por timeout. Medido el
// 9-nov-2026: 31 días cortaban, 7 días (4.746 operaciones) entraban sin
// problema. El código del m3link que sí funciona también trocea, en 31 días,
// pero corre dentro de Azure y no sobre la conexión de una oficina.
function tramosHaciaAtras(dias, paso) {
  const total = Math.max(1, parseInt(dias, 10) || 30);
  const p = Math.max(1, parseInt(paso, 10) || 7);
  const out = [];
  for (let fin = 0; fin < total; fin += p) {
    const ini = Math.min(fin + p - 1, total - 1);
    out.push({ desde: atras(ini), hasta: atras(fin) });
  }
  return out;
}

// Un corte por tiempo, venga por donde venga: la petición puede abortar al
// conectar (fetch tira) o a mitad de la descarga del cuerpo (falloCuerpo).
const RE_TIEMPO = /abort|timeout|tiempo|ETIMEDOUT|ECONNRESET|terminated/i;
const esCorteDeTiempo = (x) => RE_TIEMPO.test(String((x && x.message) || x || ''));

// Partir un tramo al medio. Devuelve null si ya es de un día: ahí no hay nada
// más que partir y el problema es otro.
function partirTramo(t) {
  const dia = 86400000;
  const d0 = new Date(t.desde + 'T12:00:00'), d1 = new Date(t.hasta + 'T12:00:00');
  const largo = Math.round((d1 - d0) / dia) + 1;
  if (largo <= 1) return null;
  const mitad = Math.floor(largo / 2);
  const corte = new Date(d0.getTime() + (mitad - 1) * dia).toISOString().slice(0, 10);
  const sig = new Date(d0.getTime() + mitad * dia).toISOString().slice(0, 10);
  return [{ desde: t.desde, hasta: corte }, { desde: sig, hasta: t.hasta }];
}

// Un tramo del histórico, ya parseado. Separado para que buscarPorFolio se
// pueda probar sin red.
//
// Si se corta POR TIEMPO, el tramo se parte al medio y se reintenta cada mitad.
// Medido el 9-nov-2026: 31 días cortaban; 7 días entraban a las 15:30 y se
// cortaban a las 17:00 con el mismo tamaño. O sea el umbral no es fijo y
// pedirle al usuario que adivine el --tramo es hacerle perder vueltas. Partir
// sólo ante un corte de TIEMPO, nunca ante un 400 o un 500: ahí el problema no
// se arregla pidiendo menos.
async function traerTramo(t, avisarCorte) {
  const ruta = '/api/FormHeader/historico/' + BP_REDTEC +
               '?fechainicio=' + aUS(t.desde) + '&fechafin=' + aUS(t.hasta);
  let r;
  try { r = await pedir(ruta, { method: 'GET' }, 'lectura'); }
  catch (e) {
    if (!esCorteDeTiempo(e)) throw e;
    return await partirYReintentar(t, (e && e.message) || String(e), avisarCorte, traerTramo);
  }
  if (r.falloCuerpo && esCorteDeTiempo(r.falloCuerpo)) {
    return await partirYReintentar(t, r.falloCuerpo, avisarCorte, traerTramo);
  }
  if (r.status !== 200) throw new Error('No se pudo leer el histórico: HTTP ' + r.status +
    ' · ' + sonda.enmascarar(String(r.texto || '')).slice(0, 200));
  let j;
  try { j = JSON.parse(r.texto); }
  catch (e) {
    throw new Error('El histórico no vino como JSON.\n  ruta: ' + ruta + '\n  ' +
      porQueNoHayJson(r).join('\n  '));
  }
  return Array.isArray(j) ? j : [];
}

async function partirYReintentar(t, motivo, avisarCorte, bajar) {
  const mitades = partirTramo(t);
  if (!mitades) {
    throw new Error('El histórico se cortó por tiempo y el tramo ya es de UN día (' +
      t.desde + ').\n  ' + motivo +
      '\n  Partirlo más no se puede: un solo día no entra en el plazo.' +
      '\n  Subí el plazo con --timeout=120 o probá desde otra conexión.');
  }
  if (avisarCorte) avisarCorte({ tramo: t, motivo: motivo, mitades: mitades });
  let out = [];
  const traer = bajar || traerTramo;
  for (const m of mitades) out = out.concat(await traer(m, avisarCorte));
  return out;
}

async function buscarPorFolio(folio, dias, paso, alTramo, traer, alCorte) {
  const lista = tramosHaciaAtras(dias, paso);
  const bajar = traer || traerTramo;
  let total = 0;
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    const arr = await bajar(t, alCorte);
    total += arr.length;
    const filas = arr.filter(x => String(x && x.folio) === String(folio));
    if (alTramo) alTramo({ i: i + 1, de: lista.length, desde: t.desde, hasta: t.hasta,
                           registros: arr.length, encontrado: filas.length });
    // En cuanto aparece se corta: bajar los tramos viejos no agrega nada.
    if (filas.length) return { filas: filas, desde: t.desde, hasta: t.hasta,
                               total: total, tramos: i + 1, deTramos: lista.length };
  }
  const ultimo = lista[lista.length - 1] || { desde: '', hasta: '' };
  return { filas: [], desde: ultimo.desde, hasta: (lista[0] || ultimo).hasta,
           total: total, tramos: lista.length, deTramos: lista.length };
}

// El GET que arma el documento. La macro corre todo con una sola sesión, la
// del usuario que confirma, así que esta llamada va con M3LinkSystem: es parte
// de la escritura, no de la lectura del histórico (ese alcance es el otro).
// Si el servidor la rechaza por permisos se reintenta con el usuario de lectura
// y se dice, porque la firma la lleva la URL y no el token — eso está medido.
async function prepararConfirmacion(ruta, pedirFn) {
  const p = pedirFn || pedir;
  const r = await p(ruta, { method: 'GET' }, 'escritura');
  if (r.status !== 401 && r.status !== 403) return Object.assign({}, r, { conLectura: false });
  const otra = await p(ruta, { method: 'GET' }, 'lectura');
  return Object.assign({}, otra, { conLectura: true, statusEscritura: r.status });
}

async function leerDocumento(id) {
  const r = await pedir('/api/FormHeader/' + encodeURIComponent(id), { method: 'GET' }, 'lectura');
  if (r.status !== 200) throw new Error('No se pudo leer el documento ' + id + ': HTTP ' + r.status);
  return JSON.parse(r.texto);
}

/* ------------------------------------------------- principal ------------- */

async function main() {
  const a = leerArgs(process.argv.slice(2));
  if (a.timeout) fijarPlazo(a.timeout);
  console.log('CONFIRMAR EN REDLINK · ' + HOST + ' · PRODUCTIVO');
  // Cuando un tramo se corta por tiempo y se parte, se dice: si no, el usuario
  // ve una pausa larga sin explicación y cree que se colgó.
  const alCorte = (c) => console.log('  · el tramo ' + c.tramo.desde + ' a ' + c.tramo.hasta +
    ' se cortó por tiempo; lo parto en ' + c.mitades.map(m => m.desde + '..' + m.hasta).join(' y '));
  // Cada tramo se canta mientras baja: si uno se corta, se ve cuál y dónde iba.
  const eco = (t) => console.log('  tramo ' + t.i + '/' + t.de + '  ' + t.desde + ' a ' + t.hasta +
    ': ' + t.registros.toLocaleString('es-CL') + ' operaciones' + (t.encontrado ? '  <- acá está' : ''));


  if (!a.productivo) {
    console.log('\nEste script escribe en producción y dispara un ajuste de inventario en SAP.');
    console.log('Para usarlo hay que pedirlo explícitamente con --productivo.');
    console.log('');
    console.log('  1) mirar el documento que el servidor prepara, SIN mandarlo:');
    console.log('     node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --preparar');
    console.log('  2) confirmar de verdad:');
    console.log('     node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si');
    console.log('');
    console.log('Para sólo MIRAR, sin escribir nada:');
    console.log('  --quien=N        quién firmó el documento de ese folio');
    console.log('  --usuario=NOMBRE qué usersiD tiene ese usuario según la API');
    console.log('\nSi el histórico se corta por tiempo se parte solo; --timeout=120 le da más plazo.\n');
    return 2;
  }

  // --usuario SOLO PREGUNTA un nombre. Es la forma de comprobar el número de
  // la firma sin tocar ninguna transferencia.
  if (a.usuario) {
    // Pregunta con el usuario de escritura, así que pide SÓLO esas credenciales:
    // bloquear una consulta de lectura por una variable que no usa manda a
    // buscar el problema al lado equivocado.
    const faltan = ['REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS']
      .filter(k => !String(process.env[k] || '').trim());
    if (faltan.length) {
      console.log('\nPara preguntar por un usuario falta: ' + faltan.join(', ') + '\n');
      return 2;
    }
    const u = await idDeUsuario(a.usuario);
    console.log('');
    console.log('  GET /api/User/nombreusuario/' + a.usuario);
    if (!u.ok && u.id === null) {
      u.problemas.forEach(x => console.log('  · ' + x));
      console.log('');
      return 2;
    }
    console.log('  usersiD   ' + u.id);
    console.log('  userName  ' + (u.nombre || '(sin nombre)'));
    u.problemas.forEach(x => console.log('  · ' + x));
    if (String(a.usuario).trim().toLowerCase() === NOMBRE_M3LINK.toLowerCase()) {
      console.log('  configurado acá: ' + USERSID_M3LINK +
                  (Number(u.id) === USERSID_M3LINK ? '  (coinciden)' : '  <- NO COINCIDE'));
    }
    console.log('\n  Sólo pregunté. No mandé nada.\n');
    return u.ok ? 0 : 1;
  }
  // --quien SOLO LEE: ni pide la cantidad ni exige las credenciales de
  // escritura, porque no va a escribir nada.
  if (a.quien) {
    const b0 = await buscarPorFolio(a.quien, a.dias, a.tramo, eco, null, alCorte);
    console.log('  histórico: ' + b0.total.toLocaleString('es-CL') + ' operaciones en ' +
                b0.tramos + ' de ' + b0.deTramos + ' tramos');
    if (!b0.filas.length) { console.log('\nEl folio ' + a.quien + ' no aparece en ' + a.dias + ' días. Prueba --dias mayor.\n'); return 2; }
    if (b0.filas.length > 1) { console.log('\nEl folio ' + a.quien + ' cae en ' + b0.filas.length + ' operaciones.\n'); return 2; }
    const id0 = b0.filas[0].formHeaderiD;
    if (!id0) { console.log('\nEl registro no trae formHeaderiD.\n'); return 2; }
    const doc0 = await leerDocumento(id0);
    const f = firmaDe(doc0);
    console.log('');
    console.log('  folio ' + a.quien + '  (documento ' + id0 + ')');
    console.log('  etapa                  ' + ((doc0.formMetapa || {}).nombre || '(vacía)'));
    console.log('  usuarioIngresoNombre   ' + (f.nombre || '(vacío)'));
    console.log('  usuarioIngresoId       ' + (f.id === null ? '(vacío)' : f.id) + '   <- el número que se firma');
    console.log('  usuarioConfirmaId      ' + (f.confirmaId === null ? '(null)' : f.confirmaId) +
                '   (no se usa: una confirmación real lo deja en null)');
    console.log('\n  Sólo leí. No mandé nada.\n');
    return 0;
  }

  if (!a.folio || !a.cantidad) { console.log('\nFaltan --folio=N y --cantidad=K\n'); return 2; }

  const mal = revisarCredenciales();
  if (mal.length) {
    console.log('\nNo se puede confirmar:');
    mal.forEach(m => console.log('  · ' + m));
    console.log('\nLa confirmación tiene que quedar firmada por M3LinkSystem.\n');
    return 2;
  }

  const b = await buscarPorFolio(a.folio, a.dias, a.tramo, eco, null, alCorte);
  console.log('  histórico: ' + b.total.toLocaleString('es-CL') + ' operaciones en ' +
              b.tramos + ' de ' + b.deTramos + ' tramos');
  if (!b.filas.length) { console.log('\nEl folio ' + a.folio + ' no aparece en ' + a.dias + ' días. Prueba --dias mayor.\n'); return 2; }
  if (b.filas.length > 1) { console.log('\nEl folio ' + a.folio + ' cae en ' + b.filas.length + ' operaciones. No se elige una.\n'); return 2; }

  const id = b.filas[0].formHeaderiD;
  if (!id) { console.log('\nEl registro no trae formHeaderiD: sin el id no se puede escribir.\n'); return 2; }

  const antes = await leerDocumento(id);

  // El número de la firma se pregunta por nombre antes de armar nada. Si la
  // API contesta otro número que el configurado, no se escribe: elegir uno de
  // los dos a ojo firma a nombre de quien no confirmó y eso no se corrige.
  const resuelto = await idDeUsuario(NOMBRE_M3LINK).catch(e => ({ ok: false, id: null, nombre: '',
    problemas: [(e && e.message) || String(e)] }));
  const cotejo = cotejarFirma(resuelto, USERSID_M3LINK);
  console.log('  firma: ' + cotejo.dice);
  if (!cotejo.ok) { console.log(''); return 2; }

  const plan = planDeConfirmacion(antes, a.cantidad, cotejo.usar);
  if (!plan.ok) {
    console.log('\nNo se puede confirmar el folio ' + a.folio + ':');
    plan.problemas.forEach(p => console.log('  · ' + p));
    console.log('');
    return 2;
  }

  const R = plan.resumen;
  console.log('');
  console.log('  folio ' + R.folio + '  (documento ' + R.id + ')');
  console.log('  cliente   ' + R.cliente);
  console.log('  destino   ' + R.destino + ' · ' + R.bodega);
  console.log('  etapa     ' + R.etapa);
  console.log('  despachado ' + R.despachado + '  ->  a confirmar ' + R.aConfirmar);
  console.log('');
  console.log('  El cuerpo del PATCH lo arma el servidor. Se le pide con:');
  console.log('    GET ' + plan.url);

  if (!a.si && !a.preparar) {
    console.log('\n  No mandé nada.');
    console.log('  --preparar  pide ese documento y lo muestra, sin confirmar.');
    console.log('  --si        pide ese documento y lo devuelve por PATCH: eso confirma.\n');
    return 0;
  }

  // Hasta no haberla visto funcionar una vez, esta ruta no se llama sin que
  // alguien lo pida: se llama ConfirmarTransferencia y nadie midió todavía si
  // sólo prepara o si además deja algo escrito. Por eso --preparar es un paso
  // aparte y no parte del plan.
  const prep = await prepararConfirmacion(plan.url);
  console.log('');
  console.log('  GET preparado  ->  HTTP ' + prep.status +
              (prep.conLectura ? '  (con el usuario de lectura: escritura dio ' + prep.statusEscritura + ')' : ''));
  if (prep.falloCuerpo) {
    console.log('  la descarga se cortó: ' + prep.falloCuerpo);
    console.log('');
    return 2;
  }
  if (prep.status !== 200) {
    console.log('  ' + sonda.enmascarar(String(prep.texto || '(cuerpo vacío)')).slice(0, 300).replace(/\s+/g, ' '));
    console.log('');
    return 2;
  }

  const rev = revisarPreparado(prep.texto, antes.folio, R.aConfirmar);
  console.log('  cuerpo: ' + String(prep.texto || '').length.toLocaleString('es-CL') + ' bytes');
  if (rev.doc) {
    console.log('  trae etapa      ' + (rev.etapa || '(vacía)'));
    console.log('  trae recepción  ' + JSON.stringify(((rev.doc.formDdetalles || [])[0] || {}).recepcion));
    console.log('  trae firma      ' + (rev.firma.id === null ? '(vacío)' : rev.firma.id) +
                ' / "' + (rev.firma.nombre || '(vacío)') + '"');
  }
  if (!rev.ok) {
    console.log('');
    console.log('  El documento preparado no sirve para mandarlo:');
    rev.problemas.forEach(x => console.log('    · ' + x));
    console.log('');
    return 2;
  }

  if (!a.si) {
    console.log('');
    console.log('  No mandé el PATCH. Este es el cuerpo que se devolvería tal cual.');
    console.log('  Agrega --si para confirmar de verdad.\n');
    return 0;
  }

  // El cuerpo va EXACTO como vino. Ni reserializado ni retocado: ocho intentos
  // con el cuerpo armado a mano dieron 400, y la diferencia entre el que falla
  // y el que sirve puede ser un campo que no sabemos leer.
  const res = await pedir('/api/FormHeader', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: prep.texto
  }, 'escritura');       // la escritura SI va firmada por M3LinkSystem
  const cl = sonda.clasificar(res.status, res.texto);
  console.log('\n  PATCH /api/FormHeader  ->  HTTP ' + res.status + '  ·  ' + cl.dice);
  const cuerpo = sonda.enmascarar(res.texto || '').trim();
  if (cuerpo) console.log('  respuesta: ' + cuerpo.slice(0, 300).replace(/\s+/g, ' '));

  const despues = await leerDocumento(id);
  const cambios = comparar(antes, despues);
  console.log('');
  if (!cambios.length) {
    console.log('  El documento NO cambió. Un 200 sin cambios no es una confirmación.');
  } else {
    console.log('  Qué cambió en el documento:');
    cambios.forEach(c => console.log('    ' + c.campo + ': ' + JSON.stringify(c.antes) + '  ->  ' + JSON.stringify(c.despues)));
    const etapa = (despues.formMetapa || {}).nombre || '';
    console.log('');
    console.log(/confirmada/i.test(etapa)
      ? '  CONFIRMADA. Verificar en el portal y revisar que el ajuste en SAP se haya generado.'
      : '  Cambió, pero la etapa quedó en "' + etapa + '". Revisar antes de repetir.');
  }

  // La firma se revisa SIEMPRE, haya cambiado el documento o no: un id
  // equivocado no da error, graba otro usuario y se queda callado.
  const v = veredictoDeFirma(despues, cotejo.usar);
  console.log('');
  console.log(v.ok ? '  Firma: ' + v.dice : '  FIRMA MAL: ' + v.dice);
  console.log('');
  return v.ok ? 0 : 1;
}

module.exports = { revisarCredenciales, USUARIOS, ETAPAS_CONFIRMABLES, etapaConfirmable, etapaDe, firmaDe, porQueNoHayJson, leerCuerpo,
  USERSID_M3LINK, NOMBRE_M3LINK, veredictoDeFirma, tramosHaciaAtras, buscarPorFolio,
  partirTramo, esCorteDeTiempo, partirYReintentar, ORIGEN, urlConfirmar, revisarPreparado,
  interpretarUsuario, idDeUsuario, rutaDeUsuario, cotejarFirma, prepararConfirmacion, RE_NOMBRE_USUARIO,
  planDeConfirmacion, comparar, leerArgs, esConfirmada, CAMPOS_ESTADO, aUS };

if (require.main === module) {
  main().then(c => { process.exitCode = c || 0; }).catch(e => {
    console.error('\n' + sonda.enmascarar(sonda.describirError(e)) + '\n');
    process.exitCode = 2;
  });
}
