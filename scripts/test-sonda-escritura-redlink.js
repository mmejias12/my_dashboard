#!/usr/bin/env node
// ============================================================================
//  scripts/test-sonda-escritura-redlink.js
//
//  Pruebas de scripts/sonda-escritura-redlink.js, más un arnés de mutaciones:
//  cada mutación rompe el código a propósito y tiene que matar al menos una
//  prueba. Una mutación que sobrevive es una prueba que no estaba mirando.
//
//    node scripts/test-sonda-escritura-redlink.js
//    node scripts/test-sonda-escritura-redlink.js --mutaciones
// ============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, 'sonda-escritura-redlink.js');

function cargar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
function prueba(nombre, fn) {
  try { fn(); ok++; }
  catch (e) { fallos.push(nombre + ' -> ' + (e && e.message ? e.message : String(e))); }
}
function igual(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || '') + ' esperaba ' + sb + ' y vino ' + sa);
}
function cierto(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
function falso(v, msg)  { if (v)  throw new Error(msg || 'esperaba falso'); }

function correr(S) {
  ok = 0; fallos = [];

  /* ---- la guarda de host ------------------------------------------------ */

  prueba('T01 acepta el host de DEMO', () => {
    cierto(S.esDemo('https://apidemo.portalredtec.cl/api/FormHeader'));
  });
  prueba('T02 rechaza productivo', () => {
    falso(S.esDemo('https://api.portalredtec.cl/api/FormHeader'));
  });
  prueba('T03 rechaza http sin cifrar aunque el host sea el de DEMO', () => {
    falso(S.esDemo('http://apidemo.portalredtec.cl/api/FormHeader'));
  });
  prueba('T04 rechaza un host que sólo TERMINA en el de DEMO', () => {
    // El caso que importa: un host que un endsWith daría por bueno.
    falso(S.esDemo('https://evil-apidemo.portalredtec.cl/api/FormHeader'));
    falso(S.esDemo('https://apidemo.portalredtec.cl.ejemplo.com/api'));
  });
  prueba('T05 rechaza basura que no es URL', () => {
    falso(S.esDemo('apidemo.portalredtec.cl'));
    falso(S.esDemo(''));
    falso(S.esDemo(null));
  });

  /* ---- marcadores pegados literal --------------------------------------- */

  prueba('T06 detecta un marcador con corchetes', () => {
    cierto(S.pintaDeMarcador('<el secreto de demo>'));
  });
  prueba('T07 detecta "tu usuario" y los puntos suspensivos', () => {
    cierto(S.pintaDeMarcador('tu-usuario'));
    cierto(S.pintaDeMarcador('abc...def'));
  });
  prueba('T08 un valor normal no es marcador', () => {
    falso(S.pintaDeMarcador('mmesias'));
    falso(S.pintaDeMarcador('a1b2-c3d4-e5f6'));
  });

  /* ---- variables de entorno --------------------------------------------- */

  prueba('T09 nombra las tres variables cuando no hay ninguna', () => {
    const f = S.faltantes({});
    igual(f.length, 3, 'cantidad de faltantes:');
    for (const v of S.VARS) cierto(f.some(x => x.indexOf(v) === 0), 'falta nombrar ' + v);
  });
  prueba('T10 no reclama cuando están las tres', () => {
    igual(S.faltantes({ REDLINK_DEMO_CLIENT_SECRET: 'x', REDLINK_DEMO_USER: 'y', REDLINK_DEMO_PASS: 'z' }), []);
  });
  prueba('T11 una variable con marcador se cuenta como faltante y lo dice', () => {
    const f = S.faltantes({ REDLINK_DEMO_CLIENT_SECRET: '<secreto>', REDLINK_DEMO_USER: 'y', REDLINK_DEMO_PASS: 'z' });
    igual(f.length, 1);
    cierto(/marcador/.test(f[0]), 'tiene que decir que parece un marcador');
  });
  prueba('T12 una variable con sólo espacios no vale', () => {
    const f = S.faltantes({ REDLINK_DEMO_CLIENT_SECRET: '   ', REDLINK_DEMO_USER: 'y', REDLINK_DEMO_PASS: 'z' });
    igual(f.length, 1);
  });

  /* ---- enmascarado ------------------------------------------------------ */

  prueba('T13 enmascara un Bearer', () => {
    igual(S.enmascarar('Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.abc'), 'Authorization: Bearer ***');
  });
  prueba('T14 enmascara access_token y client_secret en JSON', () => {
    const s = S.enmascarar('{"access_token":"eyJabc","client_secret":"s3cr3t","expires_in":60}');
    falso(/eyJabc/.test(s), 'no puede quedar el token');
    falso(/s3cr3t/.test(s), 'no puede quedar el secreto');
    cierto(/expires_in/.test(s), 'lo que no es secreto se conserva');
  });
  prueba('T15 enmascara password en un cuerpo de formulario', () => {
    falso(/hunter2/.test(S.enmascarar('username=x&password=hunter2&scope=openid')));
  });
  prueba('T16 un texto sin secretos pasa igual', () => {
    igual(S.enmascarar('HTTP 405 Method Not Allowed'), 'HTTP 405 Method Not Allowed');
  });

  /* ---- clasificación de respuestas -------------------------------------- */

  prueba('T17 200 y 204 dicen que el verbo sirve', () => {
    igual(S.clasificar(200).clave, 'sirve');
    igual(S.clasificar(204).clave, 'sirve');
  });
  prueba('T18 un 400 PRUEBA que el verbo existe', () => {
    const c = S.clasificar(400);
    igual(c.clave, 'cuerpo-malo');
    igual(c.verbo, true, 'un 400 no es un no:');
  });
  prueba('T19 un 405 prueba que el verbo NO existe', () => {
    const c = S.clasificar(405);
    igual(c.clave, 'no-permitido');
    igual(c.verbo, false);
  });
  prueba('T20 401 y 404 no dicen nada del verbo', () => {
    igual(S.clasificar(401).verbo, null);
    igual(S.clasificar(404).verbo, null);
  });
  prueba('T21 un 403 dice que el verbo existe y falta permiso', () => {
    igual(S.clasificar(403).verbo, true);
    igual(S.clasificar(403).clave, 'sin-permiso');
  });
  prueba('T22 un 415 dice que el verbo existe y el Content-Type no', () => {
    igual(S.clasificar(415).verbo, true);
    igual(S.clasificar(415).clave, 'tipo-malo');
  });
  prueba('T23 un 500 no concluye nada', () => {
    igual(S.clasificar(503).verbo, null);
    igual(S.clasificar(503).clave, 'error-servidor');
  });
  prueba('T24 el status llega como texto y se entiende igual', () => {
    igual(S.clasificar('405').clave, 'no-permitido');
  });

  /* ---- descripción de un error de red ----------------------------------- */

  prueba('T54 sigue la cadena de causas, no sólo el mensaje de arriba', () => {
    const hondo = new Error('getaddrinfo ENOTFOUND apidemo.portalredtec.cl');
    hondo.code = 'ENOTFOUND';
    const medio = new Error('fetch failed'); medio.cause = hondo;
    const d = S.describirError(medio);
    cierto(/fetch failed/.test(d), 'tiene que estar el de arriba');
    cierto(/ENOTFOUND/.test(d), 'y sobre todo el de abajo');
  });
  prueba('T55 muestra el code cuando lo hay', () => {
    const e = new Error('socket hang up'); e.code = 'ECONNRESET';
    cierto(/\[ECONNRESET\]/.test(S.describirError(e)));
  });
  prueba('T56 un error sin causa no se rompe', () => {
    igual(S.describirError(new Error('seco')), 'seco');
  });
  prueba('T57 una cadena circular no lo deja dando vueltas', () => {
    const a = new Error('a'), b = new Error('b');
    a.cause = b; b.cause = a;
    const d = S.describirError(a);
    cierto(d.split('causa:').length <= 7, 'tiene que cortar la cadena');
  });
  prueba('T58 aguanta algo que no es Error', () => {
    cierto(/ENOTFOUND/.test(S.describirError({ message: 'ENOTFOUND', code: null })));
    cierto(S.describirError('texto pelado').length > 0);
  });
  prueba('T59 conHost nombra el host y conserva la causa', () => {
    const raiz = new Error('fetch failed');
    const e = S.conHost(raiz, 'https://accounts.portalredtec.cl/x');
    cierto(/accounts\.portalredtec\.cl/.test(e.message), 'tiene que nombrar el host');
    igual(e.cause === raiz, true, 'no puede perder la causa');
  });

  /* ---- lectura de un fallo de red --------------------------------------- */

  prueba('T60 un timeout de encabezados NO se confunde con host caído', () => {
    const e = new Error('fetch failed'); e.cause = Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    const l = S.leerFalloRed(e);
    cierto(/no contestó dentro del plazo/.test(l), 'tiene que decir que el servidor no contestó');
    falso(/DNS/.test(l), 'no es DNS');
  });
  prueba('T61 y propone la salida concreta', () => {
    const e = Object.assign(new Error('x'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    cierto(/--id/.test(S.leerFalloRed(e)), 'tiene que proponer pedir un documento puntual');
  });
  prueba('T62 ENOTFOUND se lee como DNS y descarta credenciales', () => {
    const e = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    cierto(/DNS/.test(S.leerFalloRed(e)));
    cierto(/no credenciales/.test(S.leerFalloRed(e)));
  });
  prueba('T63 un certificado se lee como proxy que intercepta', () => {
    const e = Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    cierto(/proxy/.test(S.leerFalloRed(e)));
  });
  prueba('T64 ECONNREFUSED y ECONNRESET se leen, y distinto', () => {
    const a = S.leerFalloRed(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    const b = S.leerFalloRed(Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    cierto(a, 'una conexión rechazada tiene que tener lectura');
    cierto(b, 'una conexión cortada también');
    cierto(a !== b, 'rechazar la conexión y cortarla a mitad no son lo mismo');
  });
  prueba('T65 un error que no es de red no inventa lectura', () => {
    igual(S.leerFalloRed(new Error('cualquier cosa')), null);
  });

  /* ---- fechas de Redlink ------------------------------------------------- */

  prueba('T66 la fecha sale en MM-dd-yyyy, no en ISO', () => {
    igual(S.aUS(new Date(Date.UTC(2026, 10, 9))), '11-09-2026');
  });
  prueba('T67 rellena con cero el mes y el día de un dígito', () => {
    igual(S.aUS(new Date(Date.UTC(2026, 0, 5))), '01-05-2026');
  });
  prueba('T68 la ventana cubre los días pedidos, extremos incluidos', () => {
    const v = S.ventana(1);
    igual(v.desde, v.hasta, 'un día es un solo día');
  });
  prueba('T69 una ventana inválida cae a la de por omisión, no a cero ni al revés', () => {
    const porOmision = S.ventana(7);
    igual(S.ventana('abc'), porOmision, 'texto basura:');
    igual(S.ventana(0), porOmision, 'cero cae a la de por omisión:');
    igual(S.ventana(-5), S.ventana(1), 'negativo se recorta a un día, nunca a una ventana al revés:');
  });

  /* ---- lectura del error del token -------------------------------------- */

  prueba('T47 unauthorized_client apunta al cliente, no al usuario', () => {
    const e = S.leerErrorToken(401, '{"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"}');
    igual(e.causa, 'cliente');
    cierto(/client_secret/.test(e.dice), 'tiene que nombrar el client_secret');
  });
  prueba('T48 invalid_client también apunta al cliente', () => {
    igual(S.leerErrorToken(401, '{"error":"invalid_client"}').causa, 'cliente');
  });
  prueba('T49 invalid_grant apunta al usuario', () => {
    igual(S.leerErrorToken(401, '{"error":"invalid_grant","error_description":"Invalid user credentials"}').causa, 'usuario');
  });
  prueba('T50 un 401 de cliente no se confunde con uno de usuario', () => {
    const a = S.leerErrorToken(401, '{"error":"unauthorized_client"}');
    const b = S.leerErrorToken(401, '{"error":"invalid_grant"}');
    cierto(a.causa !== b.causa, 'mismo status, causas distintas');
  });
  prueba('T51 unsupported_grant_type dice que falta el flujo', () => {
    igual(S.leerErrorToken(400, '{"error":"unsupported_grant_type"}').causa, 'flujo');
  });
  prueba('T52 un 503 no acusa a nadie', () => {
    igual(S.leerErrorToken(503, 'Service Unavailable').causa, 'servidor');
  });
  prueba('T53 un cuerpo vacío no inventa una causa', () => {
    igual(S.leerErrorToken(401, '').causa, 'otra');
    igual(S.leerErrorToken(401, null).causa, 'otra');
  });

  /* ---- el 404 que sí concluye ------------------------------------------- */

  prueba('T73 un 404 que nombra el recurso prueba que el verbo corrió', () => {
    const c = S.clasificar(404, '{"error":"FormHeader (0) is not found"}');
    igual(c.clave, 'documento-no-esta');
    igual(c.verbo, true, 'el verbo enlazó el cuerpo y fue a buscar:');
  });
  prueba('T74 un 404 sin cuerpo no concluye nada', () => {
    igual(S.clasificar(404, '').verbo, null);
    igual(S.clasificar(404).verbo, null, 'sin el cuerpo tampoco:');
  });
  prueba('T75 el 404 con HTML genérico tampoco concluye', () => {
    // La página de error del servidor dice "Not Found" en el cuerpo: si no se
    // la descarta por ser HTML, pasa por mensaje propio de la aplicación.
    const pagina = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>Not Found</body></html>';
    igual(S.clasificar(404, pagina).verbo, null);
    falso(S.hablaDelRecurso(pagina));
  });
  prueba('T76 un "Not Found" pelado no alcanza como prueba', () => {
    igual(S.clasificar(404, '{"title":"Not Found"}').verbo, null, 'el genérico de ASP.NET no dice nada:');
  });
  prueba('T77 hablaDelRecurso distingue el mensaje propio del genérico', () => {
    cierto(S.hablaDelRecurso('{"error":"FormHeader (0) is not found"}'));
    cierto(S.hablaDelRecurso('{"message":"No se encontró el documento 123"}'));
    falso(S.hablaDelRecurso(''));
    falso(S.hablaDelRecurso('{"title":"Not Found"}'));
  });
  prueba('T78 un cuerpo que no es JSON igual puede nombrar el recurso', () => {
    cierto(S.hablaDelRecurso('FormHeader 0 is not found'));
  });

  /* ---- la identidad que sale del propio token ---------------------------- */

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (o) => 'cabecera.' + b64(o) + '.firma';

  prueba('T93 el token se pide con el scope minimo, no con los del portal', () => {
    // Pedir usersiD/bpid/cardname devuelve invalid_scope y deja SIN token:
    // esos scopes son del cliente portalredtecapp, no del de la API.
    const fuente = require('fs').readFileSync(require('path').join(__dirname, 'sonda-escritura-redlink.js'), 'utf8');
    cierto(/scope: 'openid'/.test(fuente), 'el scope tiene que quedar en openid');
    falso(/scope: 'openid [a-z]/i.test(fuente), 'pedir de mas rompe el token entero');
  });

  prueba('T88 saca el usersiD del token, que es con lo que se firma', () => {
    igual(S.identidadDeToken(jwt({ usersiD: 42, preferred_username: 'M3LinkSystem' })),
      { usersiD: 42, preferred_username: 'M3LinkSystem' });
  });
  prueba('T89 NO muestra la firma ni los tiempos de sesión del token', () => {
    const i = S.identidadDeToken(jwt({ usersiD: 42, exp: 1, iat: 2, jti: 'x', sid: 'y', at_hash: 'z' }));
    igual(Object.keys(i), ['usersiD'], 'del token sale mucho mas de lo que hace falta mostrar');
  });
  prueba('T90 un token ilegible no revienta ni inventa identidad', () => {
    igual(S.identidadDeToken('no-es-un-jwt'), null);
    igual(S.identidadDeToken(''), null);
    igual(S.identidadDeToken(null), null);
    igual(S.identidadDeToken('a.no-es-base64-valido!!.c'), null);
  });
  prueba('T91 aguanta base64url con y sin relleno', () => {
    const i = S.identidadDeToken(jwt({ usersiD: 7, name: 'ab' }));
    igual(i.usersiD, 7);
  });
  prueba('T92 un token sin reclamos de identidad devuelve objeto vacío, no nulo', () => {
    igual(S.identidadDeToken(jwt({ exp: 1 })), {}, 'vacio y nulo son cosas distintas: uno se leyo, el otro no');
  });

  /* ---- marcadores pegados en los argumentos ------------------------------ */

  prueba('T83 un id con corchetes se ataja antes de salir a la red', () => {
    const p = S.revisarArgs(S.leerArgs(['--confirmar=<el id>', '--cantidad=12']));
    cierto(p.length >= 1, 'tiene que reclamar');
    cierto(/marcador/.test(p.join(' ')), p.join(' '));
    cierto(/--id/.test(p.join(' ')), 'y nombrar la bandera: ' + p.join(' '));
  });
  prueba('T84 un valor que no es número se nombra distinto de un marcador', () => {
    const p = S.revisarArgs({ cantidad: 'doce' });
    cierto(/tiene que ser un numero/.test(p[0]), p[0]);
    falso(/marcador/.test(p[0]), 'no todo valor malo es un marcador pegado');
  });
  prueba('T85 los valores buenos no molestan', () => {
    igual(S.revisarArgs(S.leerArgs(['--confirmar=684032', '--cantidad=12', '--usuario=13'])), []);
    igual(S.revisarArgs({}), []);
  });
  prueba('T86 revisa TODAS las banderas numéricas, no sólo el id', () => {
    const p = S.revisarArgs({ cliente: '<cliente>', bodegaOrigen: '<bodega>', documento: '<doc>' });
    igual(p.length, 3, 'una corrida mal pegada suele traer varias: ' + JSON.stringify(p));
  });
  prueba('T87 una bandera vacía no se reclama', () => {
    igual(S.revisarArgs({ cantidad: '', usuario: null, id: undefined }), []);
  });

  /* ---- diferencias entre instantáneas ------------------------------------ */

  prueba('T74 encuentra el cambio de etapa en el encabezado y en el objeto', () => {
    const a = { formMetapaId: 43, formMetapa: { nombre: 'Pendiente Adjuntar Respaldo' } };
    const b = { formMetapaId: 44, formMetapa: { nombre: 'Pendiente de Confirmacion' } };
    const d = S.diferencias(a, b).map(x => x.campo);
    cierto(d.indexOf('formMetapaId') >= 0 && d.indexOf('formMetapa.nombre') >= 0, d.join(', '));
  });
  prueba('T75 entra a las líneas y nombra la posición', () => {
    const a = { formDdetalles: [{ recepcion: null }] };
    const b = { formDdetalles: [{ recepcion: 15 }] };
    igual(S.diferencias(a, b), [{ campo: 'formDdetalles[0].recepcion', antes: null, despues: 15 }]);
  });
  prueba('T76 avisa cuando una colección cambia de tamaño', () => {
    const d = S.diferencias({ formDregistros: [] }, { formDregistros: [{ formDdetalleiD: 1 }] });
    cierto(d.some(x => x.campo === 'formDregistros[]'), JSON.stringify(d));
  });
  prueba('T77 un campo que APARECE es un cambio, no un silencio', () => {
    const d = S.diferencias({}, { usuarioConfirmaId: 77 });
    igual(d, [{ campo: 'usuarioConfirmaId', antes: undefined, despues: 77 }]);
  });
  prueba('T78 sin cambios no inventa diferencias', () => {
    const doc = { a: 1, b: { c: 2 }, d: [{ e: 3 }] };
    igual(S.diferencias(doc, JSON.parse(JSON.stringify(doc))), []);
  });
  prueba('T79 null, cero y ausente son tres cosas distintas', () => {
    igual(S.diferencias({ x: null }, { x: 0 }).length, 1);
    igual(S.diferencias({}, { x: null }).length, 1);
  });

  /* ---- lo que el servidor dicta en sus errores --------------------------- */

  const ERR_VALIDA = '["No Tiene Lineas de detalles","Falta Cantidad a Despachar","Otro usuario Avanzo a etapa Siguiente. Favor Revizar"]';
  const ERR_TIPO = '{"title":"One or more validation errors occurred.","status":400,"errors":{"$":["The JSON value could not be converted to Application.Features.FormHeaders.Commands.UpdateForm."]}}';

  prueba('T113 saca los mensajes de validación de una lista', () => {
    const p = S.pistaDeContrato(ERR_VALIDA);
    igual(p.mensajes.length, 3);
    cierto(/Cantidad a Despachar/.test(p.mensajes[1]));
  });
  prueba('T114 saca el nombre del comando que el servidor nombró', () => {
    igual(S.pistaDeContrato(ERR_TIPO).comando, 'Application.Features.FormHeaders.Commands.UpdateForm');
  });
  prueba('T115 saca los mensajes del formato errors de ASP.NET', () => {
    const p = S.pistaDeContrato(ERR_TIPO);
    cierto(p.mensajes.length >= 1, 'el detalle del error también es un mensaje');
  });
  prueba('T116 prefija con el campo cuando errors lo nombra', () => {
    const p = S.pistaDeContrato('{"errors":{"cantidad":["requerido"]}}');
    igual(p.mensajes, ['cantidad: requerido']);
  });
  prueba('T117 el "$" de ASP.NET no se imprime como nombre de campo', () => {
    falso(/^\$: /.test(S.pistaDeContrato(ERR_TIPO).mensajes[0] || ''));
  });
  prueba('T118 junta varios intentos sin repetir y conserva el orden', () => {
    const p = S.juntarPistas([ERR_VALIDA, ERR_VALIDA, ERR_TIPO]);
    igual(p.mensajes[0], 'No Tiene Lineas de detalles');
    igual(p.mensajes.filter(m => m === 'No Tiene Lineas de detalles').length, 1, 'sin repetir:');
    igual(p.comando, 'Application.Features.FormHeaders.Commands.UpdateForm');
  });
  prueba('T119 un cuerpo vacío o que no es JSON no inventa pistas', () => {
    igual(S.pistaDeContrato('').mensajes, []);
    igual(S.pistaDeContrato(null).comando, null);
    igual(S.juntarPistas([]).mensajes, []);
    igual(S.juntarPistas(null).comando, null);
  });

  /* ---- hijos del documento ------------------------------------------------ */

  const DOCH = {
    formHeaderiD: 684029, bpId: 499,
    formDdetalles: [{ formDdetalleiD: 1, itemsId: 1, cantidad: 15, cantidadDespachar: null }],
    formDregistros: [],
    formMetapa: { formMetapaiD: 2, nombre: 'Por despachar' }
  };

  prueba('T120 encuentra las colecciones hijas y sus campos', () => {
    const h = S.hijosDelDocumento(DOCH);
    const det = h.find(x => x.nombre === 'formDdetalles');
    igual(det.tipo, 'lista');
    igual(det.largo, 1);
    cierto(det.campos.indexOf('cantidadDespachar') >= 0, 'el nombre que no se ve en el encabezado');
  });
  prueba('T121 también los objetos embebidos', () => {
    const m = S.hijosDelDocumento(DOCH).find(x => x.nombre === 'formMetapa');
    igual(m.tipo, 'objeto');
    cierto(m.campos.indexOf('formMetapaiD') >= 0);
  });
  prueba('T122 una lista vacía se informa, no se oculta', () => {
    const r = S.hijosDelDocumento(DOCH).find(x => x.nombre === 'formDregistros');
    igual(r.largo, 0);
    igual(r.campos, []);
  });
  prueba('T123 los campos planos no se confunden con hijos', () => {
    falso(S.hijosDelDocumento(DOCH).some(x => x.nombre === 'bpId'));
  });
  prueba('T124 un nulo no revienta', () => {
    igual(S.hijosDelDocumento(null), []);
    igual(S.hijosDelDocumento({ a: null }), []);
  });

  /* ---- el id de la creación ---------------------------------------------- */

  prueba('T108 el id pelado en el cuerpo se reconoce', () => {
    igual(S.idCreado('684029'), 684029);
    igual(S.idCreado('  684029\n'), 684029, 'con espacios alrededor también:');
    // Caso defensivo, y el único que sólo resuelve la vía directa: JSON.parse
    // revienta con un cero a la izquierda, así que sin ella esto daría nulo.
    igual(S.idCreado(' 0684029 '), 684029, 'con cero a la izquierda:');
  });
  prueba('T109 también si viene envuelto en un objeto', () => {
    igual(S.idCreado('{"id":4242}'), 4242);
    igual(S.idCreado('{"formHeaderiD":99}'), 99, 'con la mayúscula rara de Redlink:');
  });
  prueba('T110 NO confunde formId con el id del documento', () => {
    igual(S.idCreado('{"formId":1}'), null, 'formId es el tipo de formulario, no el documento');
  });
  prueba('T111 un id en texto se convierte a número', () => {
    igual(S.idCreado('{"id":"684029"}'), 684029);
  });
  prueba('T112 una respuesta vacía o sin id no inventa uno', () => {
    igual(S.idCreado(''), null);
    igual(S.idCreado(null), null);
    igual(S.idCreado('{"mensaje":"ok"}'), null);
    igual(S.idCreado('creado con exito'), null);
  });

  /* ---- detección de llaves en los maestros ------------------------------- */

  prueba('T96 encuentra el id aunque no se llame "id"', () => {
    const d = S.detectarCampos([{ bpId: 499, nombre: 'CLIENTE', esRetail: false }]);
    igual(d.campoId, 'bpId');
    igual(d.campoNombre, 'nombre');
  });
  prueba('T97 un "id" exacto gana sobre otro que sólo termina en id', () => {
    const d = S.detectarCampos([{ clienteId: 7, id: 42, nombre: 'X' }]);
    igual(d.campoId, 'id', 'el exacto tiene prioridad:');
  });
  prueba('T98 no toma por id un campo de texto que termine en Id', () => {
    const d = S.detectarCampos([{ externoId: 'AB-12', bodegaId: 9, nombreBodega: 'B' }]);
    igual(d.campoId, 'bodegaId');
  });
  prueba('T104 prefiere el campo que termina en Id antes que cualquier número', () => {
    // Sin la regla, el primer numérico sería "cantidad", que no identifica nada.
    const d = S.detectarCampos([{ cantidad: 5, bodegaId: 9, nombreBodega: 'B' }]);
    igual(d.campoId, 'bodegaId');
  });
  prueba('T105 un campo "nombre..." numérico no sirve de nombre', () => {
    const d = S.detectarCampos([{ bpId: 1, nombreId: 7, razonSocial: 'ACME SA' }]);
    igual(d.campoNombre, 'razonSocial', 'el nombre tiene que ser texto:');
  });

  prueba('T99 el campo nombrable gana sobre el primer texto cualquiera', () => {
    igual(S.detectarCampos([{ documentoId: 3, descripcion: 'Guia' }]).campoNombre, 'descripcion');
    // La dirección viene antes y también es texto: sin la regla de nombres, el
    // respaldo la elegiría y la lista mostraría calles en vez de clientes.
    igual(S.detectarCampos([{ bpId: 1, direccion: 'Av. Siempreviva 742', razonSocial: 'ACME SA' }]).campoNombre, 'razonSocial');
  });
  prueba('T71 devuelve los booleanos del maestro como banderas', () => {
    const d = S.detectarCampos([{ businessPartneriD: 8, cardName: 'ADELCO', transferencia: false }]);
    igual(d.banderas, ['transferencia'], 'esconderlas hace elegir un id a ciegas:');
  });
  prueba('T72 sin booleanos la lista de banderas va vacía, no indefinida', () => {
    igual(S.detectarCampos([{ bpId: 1, nombre: 'X' }]).banderas, []);
    igual(S.detectarCampos([]).banderas, undefined, 'una lista vacía no tiene forma que describir');
  });
  prueba('T73 varias banderas salen todas', () => {
    const d = S.detectarCampos([{ documentoiD: 1, nombre: 'X', vigente: true, esCliente: false }]);
    igual(d.banderas, ['vigente', 'esCliente']);
  });

  prueba('T100 devuelve las llaves para poder mirarlas', () => {
    igual(S.detectarCampos([{ a: 1, b: 'x' }]).campos, ['a', 'b']);
  });
  prueba('T101 una lista vacía o de basura no revienta ni inventa', () => {
    igual(S.detectarCampos([]), { campos: [], campoId: null, campoNombre: null });
    igual(S.detectarCampos(null), { campos: [], campoId: null, campoNombre: null });
    igual(S.detectarCampos([null, 3, 'x']), { campos: [], campoId: null, campoNombre: null });
  });
  prueba('T102 salta los elementos nulos y usa el primero que sirva', () => {
    igual(S.detectarCampos([null, { servicioId: 1, nombre: 'E' }]).campoId, 'servicioId');
  });
  prueba('T103 sin ningún texto deja campoNombre en nulo, no en vacío', () => {
    const d = S.detectarCampos([{ bodegaId: 5, activo: true }]);
    igual(d.campoId, 'bodegaId');
    igual(d.campoNombre, null);
  });
  prueba('T106 cae a cualquier texto cuando el nombre no se llama "nombre"', () => {
    // Redlink los llama cardName y bodegaCliente: sin respaldo, la lista sale
    // con los ids pelados y hay que ir a buscar cada uno a mano.
    igual(S.detectarCampos([{ businessPartneriD: 434, cardName: 'AC MARCA' }]).campoNombre, 'cardName');
    igual(S.detectarCampos([{ bodegaiD: 1681, bodegaCliente: 'REDTEC COQUIMBO', direccion: 'x' }]).campoNombre, 'bodegaCliente');
  });
  prueba('T107 el respaldo nunca toma el propio id como nombre', () => {
    // Acá el id es texto ('0012') y no hay ningún campo nombrable: sin el
    // resguardo, el respaldo devolvería el mismo campo como nombre y la lista
    // saldría con el id repetido dos veces.
    const d = S.detectarCampos([{ codigo: '0012', activo: true }]);
    igual(d.campoId, 'codigo');
    igual(d.campoNombre, null, 'id y nombre no pueden ser el mismo campo:');
  });

  /* ---- armado del documento de prueba ------------------------------------ */

  const MIN = { cliente: 499, servicio: 1, usuario: 13, bodegaOrigen: 1338, bodegaDestino: 1549 };

  prueba('T84 una emisión sale con la forma de la planilla', () => {
    const c = S.armarPayload(Object.assign({}, MIN, { cantidad: 15 }));
    igual(c.formId, 1);
    igual(c.bpOrigenId, S.BP_REDTEC, 'en una emisión el origen es REDTEC:');
    igual(c.bpDestinoId, 499, 'y el destino es el cliente:');
    igual(c.formDdetalles, [{ itemsId: 1, cantidad: 15 }]);
  });
  prueba('T85 nombra TODO lo que falta de una vez, no de a uno', () => {
    let msg = '';
    try { S.armarPayload({ cliente: 499 }); } catch (e) { msg = e.message; }
    cierto(/--servicio/.test(msg) && /--usuario/.test(msg) && /--bodega-origen/.test(msg) && /--bodega-destino/.test(msg),
      'tiene que nombrar los cuatro: ' + msg);
  });
  prueba('T86 la observación marca el documento como prueba', () => {
    cierto(/PRUEBA/i.test(S.armarPayload(MIN).observacionOrigen), 'quien lo vea en DEMO tiene que saber qué es');
  });
  prueba('T87 respeta el tope de cantidad de la planilla', () => {
    let msg = '';
    try { S.armarPayload(Object.assign({}, MIN, { cantidad: S.TOPE_CANTIDAD + 1 })); } catch (e) { msg = e.message; }
    cierto(/cantidad/.test(msg), 'tiene que rebotar: ' + msg);
    cierto(S.armarPayload(Object.assign({}, MIN, { cantidad: S.TOPE_CANTIDAD })).formDdetalles[0].cantidad === S.TOPE_CANTIDAD,
      'el tope exacto sí vale');
  });
  prueba('T88 una cantidad de cero o negativa no pasa', () => {
    igual(S.armarPayload(Object.assign({}, MIN, { cantidad: 0 })).formDdetalles[0].cantidad, 1, 'cero cae a 1:');
    let msg = ''; try { S.armarPayload(Object.assign({}, MIN, { cantidad: -3 })); } catch (e) { msg = e.message; }
    cierto(/cantidad/.test(msg));
  });
  prueba('T89 una transferencia exige destino, documento y número', () => {
    let msg = '';
    try { S.armarPayload(Object.assign({}, MIN, { form: 6 })); } catch (e) { msg = e.message; }
    // Ojo: "--documento-numero" contiene "--documento", así que buscar el
    // prefijo pelado daría por cubierto un campo que no se está pidiendo.
    cierto(/--destino/.test(msg), msg);
    cierto(/--documento \(documentoId\)/.test(msg), msg);
    cierto(/--documento-numero/.test(msg), msg);
  });
  prueba('T90 en una transferencia el origen es el cliente, no REDTEC', () => {
    const c = S.armarPayload(Object.assign({}, MIN, { form: 6, destino: 700, documento: 5, documentoNumero: 123 }));
    igual(c.bpOrigenId, 499);
    igual(c.bpDestinoId, 700);
    cierto(Array.isArray(c.formDtransportes), 'una transferencia lleva transporte');
  });
  prueba('T91 una emisión NO lleva transporte ni documento', () => {
    const c = S.armarPayload(MIN);
    falso('formDtransportes' in c);
    falso('documentoId' in c);
  });
  prueba('T92 un formId que la planilla no cubre se rechaza', () => {
    let msg = ''; try { S.armarPayload(Object.assign({}, MIN, { form: 3 })); } catch (e) { msg = e.message; }
    cierto(/formId/.test(msg), msg);
  });
  prueba('T93 la fecha sale en ISO y se puede fijar', () => {
    cierto(/^\d{4}-\d{2}-\d{2}$/.test(S.armarPayload(MIN).fechaRequerida));
    igual(S.armarPayload(Object.assign({}, MIN, { fecha: '2026-01-15' })).fechaRequerida, '2026-01-15');
    cierto(/^\d{4}-\d{2}-\d{2}$/.test(S.armarPayload(Object.assign({}, MIN, { fecha: 'ayer' })).fechaRequerida), 'basura cae a hoy');
  });
  prueba('T94 los ids llegan como texto desde la línea de comandos', () => {
    const c = S.armarPayload({ cliente: '499', servicio: '1', usuario: '13', bodegaOrigen: '1338', bodegaDestino: '1549' });
    igual(c.bpId, 499, 'tienen que ser números, no texto:');
  });
  prueba('T95 --maestros y los ids del creador se leen', () => {
    const a = S.leerArgs(['--crear', '--cliente=499', '--servicio=1', '--usuario=13',
                          '--bodega-origen=1338', '--bodega-destino=1549', '--form=6',
                          '--destino=700', '--documento=5', '--documento-numero=123', '--cita=42674991']);
    igual(a.modo, 'crear');
    igual(a.cliente, '499'); igual(a.bodegaOrigen, '1338'); igual(a.bodegaDestino, '1549');
    igual(a.destino, '700'); igual(a.documento, '5'); igual(a.documentoNumero, '123'); igual(a.cita, '42674991');
    igual(S.leerArgs(['--maestros']).modo, 'maestros');
  });

  /* ---- rango de búsqueda ------------------------------------------------- */

  prueba('T79 sin rango usa el tope, no infinito', () => {
    const r = S.rangoBusqueda(null, null);
    igual(r.desde, 1);
    igual(r.hasta, S.TOPE_BUSQUEDA);
  });
  prueba('T80 un rango gigante se recorta y lo dice', () => {
    const r = S.rangoBusqueda(1, 99999);
    igual(r.hasta, S.TOPE_BUSQUEDA);
    igual(r.recortado, true, 'tiene que avisar que recortó:');
  });
  prueba('T81 un rango al revés no se recorre hacia atrás', () => {
    const r = S.rangoBusqueda(500, 100);
    cierto(r.hasta >= r.desde, 'hasta nunca puede quedar antes que desde');
  });
  prueba('T82 un rango chico se respeta tal cual', () => {
    const r = S.rangoBusqueda(10, 20);
    igual(r.desde, 10); igual(r.hasta, 20); igual(r.recortado, false);
  });
  prueba('T83 --buscar, --desde y --hasta se leen', () => {
    const a = S.leerArgs(['--buscar', '--desde=10', '--hasta=20']);
    igual(a.modo, 'buscar'); igual(a.desde, '10'); igual(a.hasta, '20');
  });

  /* ---- campos de estado ------------------------------------------------- */

  prueba('T25 encuentra los campos que huelen a confirmación', () => {
    const c = S.camposDeEstado({ id: 1, nroPedido: 9, cantidadConfirmada: 0, fechaConfirmacion: null, patente: 'AB12' });
    const campos = c.map(x => x.campo);
    cierto(campos.indexOf('cantidadConfirmada') >= 0);
    cierto(campos.indexOf('fechaConfirmacion') >= 0);
    falso(campos.indexOf('patente') >= 0, 'patente no es estado');
  });
  prueba('T26 entra al primer elemento de un arreglo de detalles', () => {
    const c = S.camposDeEstado({ id: 1, formDdetalles: [{ id: 5, cantidad: 10, itemsId: 1 }] });
    cierto(c.map(x => x.campo).indexOf('formDdetalles[0].cantidad') >= 0);
  });
  prueba('T27 no se cae con nulos ni con arreglos vacíos', () => {
    igual(S.camposDeEstado(null), []);
    igual(S.camposDeEstado({ formDdetalles: [] }), []);
  });
  prueba('T28 conserva el valor, no sólo el nombre', () => {
    const c = S.camposDeEstado({ cantidadConfirmada: 7 });
    igual(c[0].valor, 7);
  });

  /* ---- asimetrías ------------------------------------------------------- */

  prueba('T29 encuentra el verbo que aparece en una sola ruta', () => {
    const a = S.asimetrias({ '/a': ['GET', 'POST', 'PUT', 'PATCH'], '/b': ['GET', 'POST', 'PUT'], '/c': ['GET', 'POST', 'PUT'] });
    igual(a.length, 1);
    igual(a[0].verbo, 'PATCH');
    igual(a[0].ruta, '/a');
  });
  prueba('T30 no inventa asimetría cuando todas son iguales', () => {
    igual(S.asimetrias({ '/a': ['GET'], '/b': ['GET'] }), []);
  });
  prueba('T31 con una sola ruta no hay asimetría que declarar', () => {
    igual(S.asimetrias({ '/a': ['GET', 'PATCH'] }), []);
  });
  prueba('T32 aguanta rutas sin respuesta', () => {
    const a = S.asimetrias({ '/a': ['PATCH'], '/b': [], '/c': null });
    igual(a.length, 1);
    igual(a[0].verbo, 'PATCH');
  });

  /* ---- cuerpos candidatos ----------------------------------------------- */

  // La forma REAL que devolvió el servidor, con la línea completa.
  const LINEA = {
    formDdetalleiD: 682870, formHeaderId: 684029, formId: 0, linea: 0, folio: 0,
    tipoProducto: 0, arriendo: false, itemsId: 1, itemCode: null, itemName: null,
    cantidad: 15, despachado: null, recepcion: null, recepcionAnterior: null,
    precio: null, items: { itemsiD: 1, itemName: 'PALLET REDTEC ROJO' }
  };
  const DOC = {
    formHeaderiD: 684029, formId: 1, formMetapaId: 2, avanzaEtapa: false,
    usuarioIngresoId: 13, bpId: 499, confirmacionVeces: 0, usuarioConfirmaId: null,
    servicio: { servicioiD: 1, nombre: 'Emision' },
    formMetapa: { formMetapaiD: 2, nombre: 'Por Confirmar' },
    formDdetalles: [LINEA], formDanexos: [], formDtransportes: [],
    formDregistros: [{ formDdetalleiD: 0, formHeaderId: 684029, cantidad: null }],
    formDinspeccions: []
  };

  prueba('T33 el id sale de formHeaderiD, no de "id"', () => {
    igual(S.idDeDocumento(DOC), 684029);
    igual(S.idDeDocumento({ id: 7 }), 7, 'pero si viene como id, también:');
    igual(S.idDeDocumento({ formId: 1 }), null, 'formId NO es el id del documento:');
    igual(S.idDeDocumento({ formHeaderiD: '684029' }), 684029, 'si viene como texto, se convierte:');
    igual(S.idDeDocumento(null), null);
  });
  prueba('T48 el eco manda TODAS las colecciones hijas, vacías incluidas', () => {
    // Omitir una lista vacía es justo lo que deja al manejador recorriendo un
    // nulo: el "Object reference not set" que nos costó una vuelta entera.
    const c = S.cuerposCandidatos(DOC, 15)[0].cuerpo;
    for (const k of ['formDdetalles', 'formDanexos', 'formDtransportes', 'formDregistros', 'formDinspeccions']) {
      cierto(Array.isArray(c[k]), 'falta ' + k);
    }
    igual(c.formDanexos, [], 'la vacía va vacía, no omitida:');
    // La única fila de formDregistros del documento es relleno (clave en 0), así
    // que la lista va, pero vacía: la lista presente evita el nulo del manejador
    // y la fila ausente evita el fallo al guardar.
    igual(c.formDregistros, []);
  });
  prueba('T58 una fila sin identidad propia no se devuelve', () => {
    // formDregistros llega con una fila de relleno (formDdetalleiD: 0). Si se
    // la devolvemos, el servidor intenta insertarla y falla al guardar.
    const doc = Object.assign({}, DOC, {
      formDregistros: [{ formDdetalleiD: 0, formHeaderId: 684029, cantidad: null },
                       { formDdetalleiD: 77, formHeaderId: 684029, cantidad: 5 }]
    });
    const c = S.cuerposCandidatos(doc, 15)[0].cuerpo;
    igual(c.formDregistros.length, 1, 'sólo la que existe de verdad:');
    igual(c.formDregistros[0].formDdetalleiD, 77);
  });
  prueba('T59 la línea de detalle con identidad sí se devuelve', () => {
    cierto(S.tieneIdentidad({ formDdetalleiD: 682870 }));
    falso(S.tieneIdentidad({ formDdetalleiD: 0 }));
    falso(S.tieneIdentidad({ formDdetalleiD: null }));
    igual(S.cuerposCandidatos(DOC, 15)[0].cuerpo.formDdetalles.length, 1);
  });
  prueba('T60 sin clave reconocible no se descarta la fila', () => {
    cierto(S.tieneIdentidad({ cantidad: 5 }), 'mejor mandarla de más que perderla');
    falso(S.tieneIdentidad(null));
  });
  prueba('T61 la clave propia es la PRIMERA que termina en iD', () => {
    // formHeaderId viene después y no es cero: si se mirara ése, la fila de
    // relleno pasaría por buena.
    falso(S.tieneIdentidad({ formDdetalleiD: 0, formHeaderId: 684029 }));
    // Y si hubiera dos claves con esa forma, manda la propia, que va primero:
    // mirar la última daría por buena una fila de relleno que apunta a otra.
    falso(S.tieneIdentidad({ formDdetalleiD: 0, otroiD: 9 }));
  });

  prueba('T62 hay un candidato que llena la fecha de despacho', () => {
    const c = S.cuerposCandidatos(DOC, 15).find(x => /fechaDespacho/.test(x.nombre));
    cierto(c, 'tiene que existir');
    cierto(/^\d{4}-\d{2}-\d{2}T/.test(c.cuerpo.fechaDespacho), c.cuerpo.fechaDespacho);
  });
  prueba('T63 la fecha de despacho sale de la requerida del documento', () => {
    // Una fecha que NO es hoy, o la prueba pasaría aunque la función ignorara
    // el documento y devolviera siempre la fecha actual.
    const doc = Object.assign({}, DOC, { fechaRequerida: '2026-03-04T00:00:00' });
    igual(S.fechaDeDespacho(doc), '2026-03-04T00:00:00', 'no una fecha inventada:');
  });
  prueba('T64 sin fecha requerida usable cae a hoy, no a vacío', () => {
    cierto(/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(S.fechaDeDespacho({})));
    cierto(/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(S.fechaDeDespacho({ fechaRequerida: 'cualquier cosa' })));
    cierto(/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(S.fechaDeDespacho(null)));
  });
  prueba('T65 no pisa una fecha de despacho que el documento ya tenga', () => {
    const doc = Object.assign({}, DOC, { fechaDespacho: '2026-10-01T00:00:00' });
    const c = S.cuerposCandidatos(doc, 15).find(x => /fechaDespacho/.test(x.nombre));
    igual(c.cuerpo.fechaDespacho, '2026-10-01T00:00:00');
  });
  prueba('T66 los demás candidatos no tocan la fecha de despacho', () => {
    for (const c of S.cuerposCandidatos(DOC, 15)) {
      if (/fechaDespacho/.test(c.nombre)) continue;
      igual(c.cuerpo.fechaDespacho, undefined, c.nombre + ': no puede inventarla');
    }
  });

  prueba('T80 con --usuario el cuerpo firma a nombre de quien ejecuta', () => {
    // MEDIDO: el portal sobrescribe usuarioIngresoId con el usuario que actua.
    // Devolver el que ya tenia el documento dejaria la firma a nombre de quien
    // no hizo nada, y la traza es lo unico que queda despues.
    igual(S.cuerposCandidatos(DOC, 15, '6')[0].cuerpo.usuarioIngresoId, 6);
    for (const c of S.cuerposCandidatos(DOC, 15, '6')) igual(c.cuerpo.usuarioIngresoId, 6, c.nombre + ':');
  });
  prueba('T81 sin --usuario queda el del documento, no se inventa', () => {
    igual(S.cuerposCandidatos(DOC, 15)[0].cuerpo.usuarioIngresoId, DOC.usuarioIngresoId);
  });
  prueba('T82 un usuario inválido no pisa el del documento', () => {
    ['0', '-3', 'x', '', null].forEach(function (v) {
      igual(S.cuerposCandidatos(DOC, 15, v)[0].cuerpo.usuarioIngresoId, DOC.usuarioIngresoId,
        'con ' + JSON.stringify(v) + ' no se puede firmar');
    });
  });

  prueba('T49 el eco conserva los escalares del encabezado', () => {
    const c = S.cuerposCandidatos(DOC, 15)[0].cuerpo;
    igual(c.bpId, 499);
    igual(c.usuarioConfirmaId, null, 'los nulos también:');
  });
  prueba('T50 el eco no manda los objetos de navegación del encabezado', () => {
    const c = S.cuerposCandidatos(DOC, 15)[0].cuerpo;
    falso('formMetapa' in c, 'formMetapa es navegación');
    falso('servicio' in c);
  });
  prueba('T51 avanzaEtapa va SIEMPRE, explícito, no por omisión', () => {
    const l = S.cuerposCandidatos(DOC, 15);
    for (const c of l) cierto('avanzaEtapa' in c.cuerpo, c.nombre + ': tiene que ir explícito');
    igual(l[0].cuerpo.avanzaEtapa, true);
    igual(l[l.length - 1].cuerpo.avanzaEtapa, false, 'el testigo lo manda en false, no lo omite:');
  });
  prueba('T52 una falla interna no se confunde con un cuerpo mal formado', () => {
    cierto(S.esFallaInterna('{"error":"Object reference not set to an instance of an object."}'));
    cierto(S.esFallaInterna('Sequence contains no elements'));
    falso(S.esFallaInterna('["Falta Cantidad a Despachar"]'));
    falso(S.esFallaInterna(''));
    falso(S.esFallaInterna(null));
  });

  prueba('T53 avanzaEtapa se agrega aunque el documento no lo traiga', () => {
    const sinBandera = { formHeaderiD: 1, formMetapaId: 2, formDdetalles: [{ cantidad: 3 }] };
    const l = S.cuerposCandidatos(sinBandera, 3);
    cierto('avanzaEtapa' in l[0].cuerpo, 'tiene que ir explícito, no depender del eco');
    igual(l[0].cuerpo.avanzaEtapa, true);
    igual(l[l.length - 1].cuerpo.avanzaEtapa, false, 'y el testigo lo manda en false:');
  });
  prueba('T54 la lectura separa "reventó adentro" de "cuerpo malo"', () => {
    const interno = S.lecturaDeIntentos([{ c: { nombre: 'x' }, cl: { clave: 'cuerpo-malo', verbo: true },
                                           texto: '{"error":"Object reference not set to an instance of an object."}' }]);
    cierto(/manejador/.test(interno.join(' ')), interno.join(' '));
    cierto(/uno que falta/.test(interno.join(' ')), 'tiene que decir que falta un campo, no que sobra');
    const validacion = S.lecturaDeIntentos([{ c: { nombre: 'x' }, cl: { clave: 'cuerpo-malo', verbo: true },
                                              texto: '["Falta Cantidad a Despachar"]' }]);
    cierto(/validación/.test(validacion.join(' ')), validacion.join(' '));
    falso(/manejador/.test(validacion.join(' ')), 'no puede decir lo mismo para los dos');
  });
  prueba('T67 los candidatos que avanzan van antes del que siempre funciona', () => {
    const l = S.cuerposCandidatos(DOC, 15);
    const ultimoQueAvanza = l.map(c => !!c.avanza).lastIndexOf(true);
    const primeroQueNo    = l.map(c => !!c.avanza).indexOf(false);
    cierto(ultimoQueAvanza < primeroQueNo,
      'si el que sólo guarda va antes, tapa a los demás: ' + l.map(c => c.nombre).join(' | '));
  });
  prueba('T68 el candidato de fechaDespacho intenta avanzar', () => {
    const c = S.cuerposCandidatos(DOC, 15).find(x => /fechaDespacho/.test(x.nombre));
    igual(c.avanza, true);
    igual(c.cuerpo.avanzaEtapa, true);
  });
  prueba('T69b un éxito que no pedía avanzar no se canta como confirmación', () => {
    const l = S.lecturaDeIntentos([{ c: { nombre: 'sin avanzar', avanza: false },
                                     cl: { clave: 'sirve', verbo: true }, texto: '{}' }]);
    cierto(/NO pedía avanzar/.test(l.join(' ')), l.join(' '));
    cierto(/sigue sin confirmar/.test(l.join(' ')));
  });
  prueba('T70b un éxito que sí pedía avanzar no lleva esa advertencia', () => {
    const l = S.lecturaDeIntentos([{ c: { nombre: 'con avanzar', avanza: true },
                                     cl: { clave: 'sirve', verbo: true }, texto: '{}' }]);
    falso(/NO pedía avanzar/.test(l.join(' ')));
    cierto(/Relee/.test(l.join(' ')));
  });

  prueba('T55 un éxito manda a releer antes de cantar victoria', () => {
    const l = S.lecturaDeIntentos([{ c: { nombre: 'el bueno' }, cl: { clave: 'sirve', verbo: true }, texto: '1' }]);
    cierto(/el bueno/.test(l.join(' ')));
    cierto(/Relee/.test(l.join(' ')), 'tiene que pedir la relectura');
  });
  prueba('T56 un 405 dice que la confirmación no pasa por ahí', () => {
    const l = S.lecturaDeIntentos([{ c: { nombre: 'x' }, cl: { clave: 'no-permitido', verbo: false }, texto: '' }]);
    cierto(/no aceptó PATCH/.test(l.join(' ')));
  });
  prueba('T57 sin intentos no inventa lectura', () => {
    igual(S.lecturaDeIntentos([]), []);
    igual(S.lecturaDeIntentos(null), []);
  });

  prueba('T34 la línea se devuelve tal cual, sin las propiedades de navegación', () => {
    const l = S.lineaParaEnviar(LINEA, 15, 15);
    igual(l.formDdetalleiD, 682870, 'conserva el id de la línea:');
    igual(l.itemCode, null, 'conserva los nulos, no los borra:');
    falso('items' in l, 'items es navegación y no va');
  });
  prueba('T35 lineaParaEnviar no inventa campos que no estaban', () => {
    const l = S.lineaParaEnviar({ cantidad: 5 }, null, null);
    igual(l, { cantidad: 5 }, 'sin cantidades pedidas no agrega nada:');
  });
  prueba('T36 la cantidad nunca supera lo que la línea pide', () => {
    igual(S.cantidadDeLinea(LINEA, 99), 15, 'se recorta al tope de la línea:');
    igual(S.cantidadDeLinea(LINEA, 10), 10);
    igual(S.cantidadDeLinea(LINEA, null), 15, 'sin cantidad, la de la línea:');
    igual(S.cantidadDeLinea({ cantidad: null }, null), null, 'sin nada, nada:');
  });
  prueba('T37 el primer candidato es el que confirma de verdad', () => {
    const l = S.cuerposCandidatos(DOC, 15);
    cierto(/despachado \+ recepcion \+ avanzaEtapa/.test(l[0].nombre), l[0].nombre);
    igual(l[0].cuerpo.formDdetalles[0].despachado, 15);
    igual(l[0].cuerpo.formDdetalles[0].recepcion, 15);
    igual(l[0].cuerpo.avanzaEtapa, true);
  });
  prueba('T38 todos los cuerpos mandan la etapa leída, contra "otro usuario avanzó"', () => {
    for (const c of S.cuerposCandidatos(DOC, 15)) igual(c.cuerpo.formMetapaId, 2, c.nombre + ':');
  });
  prueba('T39 todos llevan el id con el nombre que usa Redlink', () => {
    for (const c of S.cuerposCandidatos(DOC, 15)) igual(c.cuerpo.formHeaderiD, 684029, c.nombre + ':');
  });
  prueba('T40 todos llevan las líneas, que es lo que el servidor reclamó', () => {
    for (const c of S.cuerposCandidatos(DOC, 15)) {
      cierto(Array.isArray(c.cuerpo.formDdetalles) && c.cuerpo.formDdetalles.length === 1, c.nombre + ':');
    }
  });
  prueba('T41 el candidato de sólo despacho no manda recepción', () => {
    const c = S.cuerposCandidatos(DOC, 15).find(x => /sólo despachado/.test(x.nombre));
    igual(c.cuerpo.formDdetalles[0].despachado, 15);
    igual(c.cuerpo.formDdetalles[0].recepcion, null, 'la recepción queda como vino:');
  });
  prueba('T42 el testigo no pide ningún cambio', () => {
    const l = S.cuerposCandidatos(DOC, 15);
    const t = l[l.length - 1];
    cierto(/testigo/.test(t.nombre), 'y va al final');
    igual(t.cuerpo.formDdetalles[0].despachado, null);
    igual(t.cuerpo.formDdetalles[0].recepcion, null);
    igual(t.cuerpo.avanzaEtapa, false, 'el testigo no avanza nada');
  });
  prueba('T43 la cantidad llega como texto desde la línea de comandos', () => {
    igual(S.cuerposCandidatos(DOC, '10')[0].cuerpo.formDdetalles[0].recepcion, 10);
  });
  prueba('T44 un documento sin líneas no finge tenerlas', () => {
    const c = S.cuerposCandidatos({ formHeaderiD: 1, formMetapaId: 2 }, 15)[0].cuerpo;
    falso('formDdetalles' in c, 'si el documento no las trae, el eco tampoco');
  });
  prueba('T47 una línea nula en el arreglo no se manda como línea', () => {
    // Si el arreglo trae un hueco, mandarlo de vuelta como {} haría que el
    // servidor viera una línea sin cantidad y la rechazara entera.
    const doc = Object.assign({}, DOC, { formDdetalles: [null, LINEA] });
    const c = S.cuerposCandidatos(doc, 15)[0];
    igual(c.cuerpo.formDdetalles.length, 1, 'sólo la línea de verdad:');
    igual(c.cuerpo.formDdetalles[0].formDdetalleiD, 682870);
  });

  prueba('T45 sin id no se manda nada, ni el testigo', () => {
    igual(S.cuerposCandidatos({ formId: 1 }, 15), []);
  });
  prueba('T46 varias líneas se recortan cada una contra su propio tope', () => {
    const doc = Object.assign({}, DOC, {
      formDdetalles: [Object.assign({}, LINEA, { cantidad: 5 }), Object.assign({}, LINEA, { cantidad: 30 })]
    });
    const c = S.cuerposCandidatos(doc, 20)[0];
    igual(c.cuerpo.formDdetalles[0].recepcion, 5, 'la de 5 no puede recibir 20:');
    igual(c.cuerpo.formDdetalles[1].recepcion, 20);
  });

  /* ---- lectura del Allow ------------------------------------------------ */

  const hdr = v => ({ get: k => (k === 'allow' ? v : null) });

  prueba('T42 lee el Allow y lo deja ordenado y en mayúsculas', () => {
    // El orden de llegada NO es el de salida: así dos rutas se pueden comparar.
    igual(S.verbosDe(hdr('POST, get, patch')), ['GET', 'PATCH', 'POST']);
  });
  prueba('T43 sin Allow devuelve lista vacía, no revienta', () => {
    igual(S.verbosDe(hdr(null)), []);
    igual(S.verbosDe(null), []);
    igual(S.verbosDe({}), []);
  });

  /* ---- argumentos ------------------------------------------------------- */

  prueba('T44 sin argumentos el modo es el catálogo', () => {
    igual(S.leerArgs([]).modo, 'catalogo');
  });
  prueba('T45 --confirmar trae el documento y deja el modo', () => {
    const a = S.leerArgs(['--confirmar=4125549', '--cantidad=30']);
    igual(a.modo, 'confirmar');
    igual(a.id, '4125549');
    igual(a.cantidad, '30');
  });
  prueba('T70 --verbo se reconoce como modo propio', () => {
    igual(S.leerArgs(['--verbo']).modo, 'verbo');
  });
  prueba('T71 --timeout, --bp, --dias y --todo se leen', () => {
    const a = S.leerArgs(['--leer', '--timeout=90', '--bp=499', '--dias=30', '--todo']);
    igual(a.plazo, '90');
    igual(a.bp, '499');
    igual(a.dias, '30');
    igual(a.todo, true);
  });
  prueba('T72 sin pedirlos, bp y dias tienen valor por omisión y --todo es falso', () => {
    const a = S.leerArgs(['--leer']);
    igual(a.bp, '433');
    igual(a.dias, '7');
    igual(a.todo, false);
    igual(a.plazo, null);
  });

  prueba('T46 sin --si no se manda nada', () => {
    igual(S.leerArgs(['--confirmar=1']).si, false);
    igual(S.leerArgs(['--confirmar=1', '--si']).si, true);
  });

  return { ok: ok, fallos: fallos };
}

/* -------------------------------------------------------- mutaciones ----- */

const MUTACIONES = [
  ['M01 la guarda acepta cualquier host',              /u\.hostname\.toLowerCase\(\) === HOST_DEMO/, 'true'],
  ['M02 la guarda acepta http',                        /u\.protocol === 'https:' &&/, 'true &&'],
  ['M03 la guarda compara con endsWith',               /u\.hostname\.toLowerCase\(\) === HOST_DEMO/, "u.hostname.toLowerCase().endsWith(HOST_DEMO)"],
  ['M04 la guarda no se queja de una URL rota',        /return false; \}\n  return u\.protocol/, 'return true; }\n  return u.protocol'],
  ['M05 el marcador ignora los corchetes',             /\/\[<>\]\/\.test\(s\)/, 'false'],
  ['M06 el marcador ignora los puntos suspensivos',    /\|\| \/\\\.\\\.\\\.\/\.test\(s\)/, '|| false'],
  ['M07 faltantes no mira los marcadores',             /else if \(pintaDeMarcador\(v\)\)/, 'else if (false)'],
  ['M08 faltantes acepta el vacío',                    /if \(!v \|\| !String\(v\)\.trim\(\)\)/, 'if (false)'],
  ['M09 faltantes se queda con la primera variable',   /for \(const k of VARS\) \{/, 'for (const k of VARS.slice(0,1)) {'],
  ['M10 no enmascara el Bearer',                       /\(Bearer\\s\+\)\[A-Za-z0-9\._~\+\/=-\]\{8,\}\/gi, '\$1\*\*\*'/, "(Bearer\\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1$&'"],
  ['M11 no enmascara access_token',                    /access_token\|refresh_token\|id_token\|client_secret\|password/, 'nada_de_esto'],
  ['M12 un 400 pasa a contar como que el verbo no existe', /return \{ clave: 'cuerpo-malo',    verbo: true,/, "return { clave: 'cuerpo-malo',    verbo: false,"],
  ['M13 un 405 pasa a contar como que el verbo existe',   /return \{ clave: 'no-permitido',   verbo: false,/, "return { clave: 'no-permitido',   verbo: true,"],
  ['M14 un 401 pasa a concluir algo',                  /return \{ clave: 'no-autenticado', verbo: null,/, "return { clave: 'no-autenticado', verbo: true,"],
  ['M15 un 403 deja de contar como verbo existente',   /return \{ clave: 'sin-permiso',    verbo: true,/, "return { clave: 'sin-permiso',    verbo: null,"],
  ['M16 un 415 deja de contar',                        /return \{ clave: 'tipo-malo',      verbo: true,/, "return { clave: 'tipo-malo',      verbo: null,"],
  ['M17 el status no se convierte a número',           /const s = Number\(status\);/, 'const s = status;'],
  ['M18 los campos de estado pierden "cantidad"',      /\(confirm\|estado\|etapa\|autoriz\|aprob\|cantidad\|fecha\)/, '(confirm|estado|etapa|autoriz|aprob|fecha)'],
  ['M19 los campos de estado no entran a los arreglos',/if \(v\.length && typeof v\[0\] === 'object'\) ver\(v\[0\], ruta \+ '\[0\]'\);/, ''],
  ['M20 los campos de estado pierden el valor',        /out\.push\(\{ campo: ruta, valor: v \}\)/, 'out.push({ campo: ruta, valor: null })'],
  ['M21 la asimetría también marca verbos repetidos',  /if \(cuenta\[v\] === 1 && rutas\.length > 1\)/, 'if (cuenta[v] >= 1 && rutas.length > 1)'],
  ['M22 la asimetría ignora que haya una sola ruta',   /cuenta\[v\] === 1 && rutas\.length > 1/, 'cuenta[v] === 1'],
  ['M99 no saca el nombre del comando',                /const m = t\.match\(\/\[A-Za-z0-9_\.\]\*\\\.Commands\\\.\[A-Za-z0-9_\]\+\/\);/, 'const m = null;'],
  ['M100 no lee los mensajes de una lista',            /out\.mensajes = j\.filter\(x => typeof x === 'string'\)[^\n]*/, 'out.mensajes = [];'],
  ['M101 no lee el formato errors de ASP\.NET',        /\} else if \(j && typeof j === 'object' && j\.errors && typeof j\.errors === 'object'\) \{/, '} else if (false) {'],
  ['M102 imprime el "\$" como nombre de campo',        /\(k === '\$' \? '' : k \+ ': '\)/, "(k + ': ')"],
  ['M103 junta los mensajes repitiendo',               /if \(!vistos\[m\]\) \{ vistos\[m\] = true; mensajes\.push\(m\); \}/, 'mensajes.push(m);'],
  ['M104 el primer comando encontrado se pisa',        /if \(!comando && p\.comando\) comando = p\.comando;/, 'if (p.comando) comando = null;'],
  ['M105 los hijos no muestran sus campos',            /campos: prim \? Object\.keys\(prim\) : \[\]/, 'campos: []'],
  ['M106 los objetos embebidos se ignoran',            /\} else if \(v && typeof v === 'object'\) \{\n      out\.push\(\{ nombre: k, tipo: 'objeto'/, '} else if (false) {\n      out.push({ nombre: k, tipo: \'objeto\''],
  ['M107 los campos planos pasan por hijos',           /if \(Array\.isArray\(v\)\) \{/, 'if (true) {'],
  ['M108 la lista vacía se oculta',                    /out\.push\(\{ nombre: k, tipo: 'lista', largo: v\.length,/, "if (!v.length) continue; out.push({ nombre: k, tipo: 'lista', largo: v.length,"],
  ['M25 la cantidad no se recorta al tope',            /if \(hayTope && n > tope\) return tope;/, ''],
  ['M26 una cantidad de cero o negativa se acepta',    /if \(!Number\.isFinite\(n\) \|\| n <= 0\) return hayTope \? tope : null;/, 'if (!Number.isFinite(n)) return hayTope ? tope : null;'],
  ['M27 sin cantidad no cae a la de la línea',         /return hayTope \? tope : null;/, 'return null;'],
  ['M91 el id del documento sale de formId',           /for \(const k of \['formHeaderiD', 'formHeaderId', 'id'\]\)/, "for (const k of ['formId', 'formHeaderiD', 'formHeaderId', 'id'])"],
  ['M28 desaparece el testigo',                        /eco\('testigo · eco completo sin cambios',[^\n]*\n/, ''],
  ['M29 el testigo también avanza etapa',              /eco\('testigo · eco completo sin cambios',                  \{ despachado: false, recepcion: false, avanzar: false \}\);/, "eco('testigo · eco completo sin cambios',                  { despachado: false, recepcion: false, avanzar: true });"],
  ['M92 el eco omite las listas vacías',               /cuerpo\[k\] = filas\.map\(d => lineaParaEnviar\(d, null, null\)\);/, 'if (filas.length) cuerpo[k] = filas.map(d => lineaParaEnviar(d, null, null));'],
  ['M93 el eco omite las colecciones que no son detalle', /\} else \{\n      cuerpo\[k\] = filas\.map\(d => lineaParaEnviar\(d, null, null\)\);\n    \}/, '}'],
  ['M94 el eco manda los objetos de navegación',       /for \(const k of Object\.keys\(doc\)\) if \(esEscalar\(doc\[k\]\)\) cuerpo\[k\] = doc\[k\];/, 'for (const k of Object.keys(doc)) if (!Array.isArray(doc[k])) cuerpo[k] = doc[k];'],
  ['M95 el primer candidato no lleva recepción',       /eco\('eco completo · despachado \+ recepcion \+ avanzaEtapa', \{ despachado: true, recepcion: true, avanzar: true \}\);/, "eco('eco completo · despachado + recepcion + avanzaEtapa', { despachado: true, recepcion: false, avanzar: true });"],
  ['M97 el primer candidato no avanza la etapa',       /\{ despachado: true, recepcion: true, avanzar: true \}/, '{ despachado: true, recepcion: true, avanzar: false }'],
  ['M109 avanzaEtapa se omite en vez de ir explícito', /cuerpo\.avanzaEtapa = !!o\.avanzar;/, 'if (o.avanzar) cuerpo.avanzaEtapa = true;'],
  ['M110 las líneas no se filtran por objeto',         /const filas = v\.filter\(x => x && typeof x === 'object' && tieneIdentidad\(x\)\);/, 'const filas = v;'],
  ['M112 esFallaInterna marca cualquier error',        /\/object reference not set\|nullreference\|sequence contains no elements\|index \.\*out of range\/i/, '/./'],
  ['M23 la línea manda las propiedades de navegación', /for \(const k of Object\.keys\(det \|\| \{\}\)\) if \(esEscalar\(det\[k\]\)\) out\[k\] = det\[k\];/, 'for (const k of Object.keys(det || {})) out[k] = det[k];'],
  ['M24 el escalar deja de incluir los nulos',         /const esEscalar = v => v === null \|\| \['number', 'string', 'boolean'\]\.indexOf\(typeof v\) >= 0;/, "const esEscalar = v => ['number', 'string', 'boolean'].indexOf(typeof v) >= 0;"],
  ['M96 sin id igual manda cuerpos',                   /if \(idDeDocumento\(doc\) == null\) return lista;/, ''],
  ['M111 la falla interna se confunde con cuerpo malo', /if \(v\.some\(x => esFallaInterna\(x && x\.texto\)\)\) \{/, 'if (false) {'],
  ['M113 la lectura no pide relectura tras un éxito',  /out\.push\('Relee el documento antes de cantar victoria[^']*'\);/, ''],
  ['M114 un éxito no nombra cuál candidato fue',       /out\.push\(x\.c\.nombre \+ ' fue aceptado\.'\);/, "out.push('algo fue aceptado.');"],
  ['M115 las filas de relleno se devuelven',           /&& tieneIdentidad\(x\)/, ''],
  ['M116 la identidad mira cualquier campo iD',        /Object\.keys\(fila\)\.find\(k => \/i\[dD\]\$\/\.test\(k\)\)/, 'Object.keys(fila).reverse().find(k => /i[dD]$/.test(k))'],
  ['M117 una clave en cero pasa por identidad',        /return Number\.isFinite\(v\) && v > 0;/, 'return Number.isFinite(v);'],
  ['M118 sin clave reconocible se descarta la fila',   /if \(!clave\) return true;[^\n]*/, 'if (!clave) return false;'],
  ['M119 la fecha de despacho no se llena nunca',      /if \(o\.fechaDespacho && !cuerpo\.fechaDespacho\) \{/, 'if (false) {'],
  ['M120 la fecha de despacho se llena siempre',       /if \(o\.fechaDespacho && !cuerpo\.fechaDespacho\) \{/, 'if (!cuerpo.fechaDespacho) {'],
  ['M121 pisa la fecha de despacho existente',         /o\.fechaDespacho && !cuerpo\.fechaDespacho/, 'o.fechaDespacho'],
  ['M122 la fecha de despacho se inventa en hoy',      /if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\/\.test\(req\)\) return req\.slice\(0, 10\) \+ 'T00:00:00';/, ''],
  ['M123 la fecha de despacho va sin hora',            /return new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \+ 'T00:00:00';/, "return new Date().toISOString().slice(0, 10);"],
  ['M124 el que sólo guarda vuelve a ir primero',      /eco\('eco completo · despachado \+ recepcion \+ avanzaEtapa', \{ despachado: true, recepcion: true, avanzar: true \}\);/, "eco('eco completo · despachado + recepcion, sin avanzar',  { despachado: true, recepcion: true, avanzar: false });"],
  ['M125 los candidatos no dicen si avanzan',          /nombre: nombre, avanza: !!o\.avanzar,/, 'nombre: nombre,'],
  ['M126 un éxito sin avance se canta como confirmación', /if \(!sirven\.some\(x => x\.c && x\.c\.avanza\)\) \{/, 'if (false) {'],
  ['M127 la advertencia sale siempre, avance o no',    /if \(!sirven\.some\(x => x\.c && x\.c\.avanza\)\) \{/, 'if (true) {'],
  ['M128 las banderas del maestro se esconden',        /const banderas = campos\.filter\(k => typeof prim\[k\] === 'boolean'\);/, 'const banderas = [];'],
  ['M129 cualquier campo pasa por bandera',            /campos\.filter\(k => typeof prim\[k\] === 'boolean'\)/, 'campos.filter(k => true)'],
  ['M130 el diff no entra a los objetos',              /\} else if \(esObj\(a\) \|\| esObj\(b\)\) \{\n      out\.push\.apply\(out, diferencias\(a \|\| \{\}, b \|\| \{\}, ruta\)\);/, '} else if (false) {\n      out.push.apply(out, diferencias(a || {}, b || {}, ruta));'],
  ['M131 el diff no entra a las listas',               /if \(Array\.isArray\(a\) \|\| Array\.isArray\(b\)\) \{/, 'if (false) {'],
  ['M132 el diff no avisa el cambio de tamaño',        /if \(la\.length !== lb\.length\) out\.push\(\{ campo: ruta \+ '\[\]'/, "if (false) out.push({ campo: ruta + '[]'"],
  ['M133 el diff sólo mira las claves del antes',      /Object\.keys\(Object\.assign\(\{\}, antes \|\| \{\}, despues \|\| \{\}\)\)/, 'Object.keys(antes || {})'],
  ['M134 el diff confunde null con cero',              /\} else if \(JSON\.stringify\(a\) !== JSON\.stringify\(b\)\) \{\n      out\.push\(\{ campo: ruta, antes: a, despues: b \}\);/, '} else if (a != b) {\n      out.push({ campo: ruta, antes: a, despues: b });'],
  ['M135 el cuerpo no firma a nombre de quien ejecuta', /const u = parseInt\(o\.usuario, 10\);\n  if \(Number\.isFinite\(u\) && u > 0\) cuerpo\.usuarioIngresoId = u;/, 'const u = parseInt(o.usuario, 10);'],
  ['M136 un usuario invalido igual pisa la firma',     /if \(Number\.isFinite\(u\) && u > 0\) cuerpo\.usuarioIngresoId = u;/, 'cuerpo.usuarioIngresoId = u;'],
  ['M137 el usuario no llega a los candidatos',        /Object\.assign\(\{ cantidad: cantidad, usuario: usuario \}, o\)/, 'Object.assign({ cantidad: cantidad }, o)'],
  ['M138 los marcadores pegados pasan',                /if \(\/\[<>\]\/\.test\(t\)\) problemas\.push/, 'if (false) problemas.push'],
  ['M139 cualquier texto pasa por numero',             /else if \(!\/\^-\?\\d\+\$\/\.test\(t\)\) problemas\.push/, 'else if (false) problemas.push'],
  ['M140 solo revisa una bandera',                     /for \(const k of Object\.keys\(NUMERICOS\)\) \{/, 'for (const k of Object.keys(NUMERICOS).slice(0,1)) {'],
  ['M141 el mensaje no nombra la bandera',             /problemas\.push\(NUMERICOS\[k\] \+ '=' \+ t \+ '  <- eso es un marcador, no un valor'\)/, "problemas.push('valor invalido')"],
  ['M142 una bandera vacia se reclama',                /if \(v === null \|\| v === undefined \|\| v === ''\) continue;/, ''],
  ['M143 no lee el payload del token',                 /const txt = Buffer\.from\(partes\[1\]\.replace/, 'const txt = Buffer.from(partes[0].replace'],
  ['M144 muestra todos los reclamos del token',        /RECLAMOS_UTILES\.forEach\(function \(k\) \{ if \(c\[k\] !== undefined\) out\[k\] = c\[k\]; \}\);/, 'Object.keys(c).forEach(function (k) { out[k] = c[k]; });'],
  ['M145 un token ilegible devuelve objeto en vez de nulo', /if \(!c\) return null;/, 'if (!c) return {};'],
  ['M146 el usersiD no esta entre los reclamos utiles', /const RECLAMOS_UTILES = \['usersiD',/, "const RECLAMOS_UTILES = ['zzz',"],
  ['M30 el Allow no se normaliza a mayúsculas',        /\.map\(s => s\.trim\(\)\.toUpperCase\(\)\)/, '.map(s => s.trim())'],
  ['M31 el Allow no se ordena',                        /\.filter\(Boolean\)\.sort\(\)/, '.filter(Boolean)'],
  ['M32 --si queda prendido siempre',                  /else if \(x === '--si'\) a\.si = true;/, "a.si = true;"],
  ['M33 --confirmar no lee el documento',              /\{ a\.modo = 'confirmar'; a\.id = x\.slice\(12\); \}/, "{ a.modo = 'confirmar'; }"],
  ['M34 el error de cliente se confunde con el de usuario', /return \{ causa: 'cliente',/, "return { causa: 'usuario',"],
  ['M35 ya no distingue invalid_grant',                /if \(\/invalid_grant\|invalid user credentials\/i\.test\(t\)\)/, 'if (false)'],
  ['M36 unauthorized_client deja de reconocerse',      /unauthorized_client\|invalid_client/, 'nada_de_esto'],
  ['M37 el mensaje de cliente no nombra el secreto',   /el client_secret no sirve/, 'algo pasa'],
  ['M38 un 503 pasa a acusar al usuario',              /return \{ causa: 'servidor',/, "return { causa: 'usuario',"],
  ['M39 el error no sigue la cadena de causas',        /x = x && x\.cause;/, 'x = null;'],
  ['M40 el error se come el code',                     /const cod = \(x && x\.code\) \? ' \[' \+ x\.code \+ '\]' : '';/, "const cod = '';"],
  ['M41 la cadena circular no se corta',               /n\+\+ < 6/, 'n < 6'],
  ['M42 conHost pierde la causa',                      /nuevo\.cause = e;/, ''],
  ['M43 conHost no nombra el host',                    /'No se pudo hablar con ' \+ url/, "'No se pudo hablar'"],
  ['M44 el timeout se lee como host caído',            /UND_ERR_HEADERS_TIMEOUT\|HeadersTimeout\|TimeoutError\|ABORT_ERR/, 'NADA_DE_ESTO'],
  ['M45 el timeout deja de proponer --id',             /pide un documento puntual con --id/, 'reintenta'],
  ['M46 DNS y certificado se confunden',               /if \(\/ENOTFOUND\|EAI_AGAIN\/i\.test\(t\)\)/, 'if (false)'],
  ['M47 rechazo y corte de conexión se funden',        /if \(\/ECONNREFUSED\/i\.test\(t\)\)\n    return '[^']*';/, ''],
  ['M48 inventa lectura para cualquier error',         /return null;\n\}\n\n\/\/ Keycloak/, "return 'algo de red';\n}\n\n// Keycloak"],
  ['M49 la fecha sale en ISO',                         /return dos\(f\.getUTCMonth\(\) \+ 1\) \+ '-' \+ dos\(f\.getUTCDate\(\)\) \+ '-' \+ f\.getUTCFullYear\(\);/, "return f.getUTCFullYear() + '-' + dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate());"],
  ['M50 la fecha no rellena con cero',                 /const dos = n => String\(n\)\.padStart\(2, '0'\);/, 'const dos = n => String(n);'],
  ['M51 la ventana se corre un día',                   /\(d - 1\) \* 86400000/, 'd * 86400000'],
  ['M52 una ventana inválida queda en cero días',      /Math\.max\(1, parseInt\(dias, 10\) \|\| 7\)/, 'parseInt(dias, 10) || 0'],
  ['M53 --timeout no se lee',                          /else if \(x\.indexOf\('--timeout='\) === 0\) a\.plazo = x\.slice\(10\);/, ''],
  ['M54 --verbo no se reconoce',                       /else if \(x === '--verbo'\) a\.modo = 'verbo';/, ''],
  ['M55 el 404 vuelve a mirar sólo el número',         /if \(s === 404 && hablaDelRecurso\(texto\)\)/, 'if (false)'],
  ['M56 cualquier 404 pasa a probar el verbo',         /if \(s === 404 && hablaDelRecurso\(texto\)\)/, 'if (s === 404)'],
  ['M57 el HTML genérico cuenta como mensaje propio',  /if \(!t \|\| \/\^<!DOCTYPE\|\^<html\/i\.test\(t\)\) return false;/, 'if (!t) return false;'],
  ['M58 el "Not Found" pelado cuenta',                 /if \(\/\^not found\$\/i\.test\(dicho\.trim\(\)\)\) return false;[^\n]*/, ''],
  ['M59 el barrido pierde el tope',                    /if \(h - d \+ 1 > t\) h = d \+ t - 1;/, ''],
  ['M60 el barrido puede ir hacia atrás',              /if \(!Number\.isFinite\(h\) \|\| h < d\)/, 'if (!Number.isFinite(h))'],
  ['M61 el barrido no avisa que recortó',              /recortado: \(parseInt\(hasta, 10\) \|\| 0\) > h/, 'recortado: false'],
  ['M62 --buscar no se reconoce',                      /else if \(x === '--buscar'\) a\.modo = 'buscar';/, ''],
  ['M63 la emision sale con origen en el cliente',     /bpOrigenId: form === 1 \? BP_REDTEC : cliente,/, 'bpOrigenId: cliente,'],
  ['M64 el destino de la emision queda en REDTEC',     /bpDestinoId: form === 1 \? cliente : n\(o\.destino\),/, 'bpDestinoId: n(o.destino),'],
  ['M65 el armador reclama una falta a la vez',        /if \(falta\.length\) throw new Error\('Falta: ' \+ falta\.join\(', '\)\);/, "if (falta.length) throw new Error('Falta: ' + falta[0]);"],
  ['M66 el tope de cantidad desaparece',               /if \(cantidad < 1 \|\| cantidad > TOPE_CANTIDAD\)/, 'if (false)'],
  ['M67 el tope de cantidad queda abierto por arriba', /cantidad > TOPE_CANTIDAD/, 'cantidad > TOPE_CANTIDAD + 100'],
  ['M68 la observacion ya no dice que es prueba',      /const OBS_PRUEBA = '[^']*';/, "const OBS_PRUEBA = 'x';"],
  ['M69 la transferencia no exige documento',          /if \(!n\(o\.documento\)\)      falta\.push\('--documento \(documentoId\)'\);/, ''],
  ['M70 la transferencia no lleva transporte',         /cuerpo\.formDtransportes = \[\{/, 'cuerpo.noVa = [{'],
  ['M71 la emision tambien lleva transporte',          /if \(form === 6\) \{\n    cuerpo\.documentoId/, 'if (true) {\n    cuerpo.documentoId'],
  ['M72 acepta cualquier formId',                      /if \(form !== 1 && form !== 6\)/, 'if (false)'],
  ['M73 los ids no se convierten a numero',            /const n = \(v\) => \{ const x = parseInt\(v, 10\); return Number\.isFinite\(x\) \? x : null; \};/, 'const n = (v) => v;'],
  ['M74 la fecha pedida no se valida',                 /\(o\.fecha && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(o\.fecha\)\)/, '(o.fecha)'],
  ['M75 --maestros no se reconoce',                    /else if \(x === '--maestros'\) a\.modo = 'maestros';/, ''],
  ['M76 vuelve a adivinar que el id se llama id',      /if \(!campoId\) campoId = campos\.find\(k => \/id\$\/i\.test\(k\) && esNumero\(k\)\);/, ''],
  ['M77 el id exacto deja de tener prioridad',         /let campoId = campos\.find\(k => k\.toLowerCase\(\) === 'id' && esNumero\(k\)\);/, 'let campoId = null;'],
  ['M78 toma por id un texto que termina en Id',       /\/id\$\/i\.test\(k\) && esNumero\(k\)/, '/id$/i.test(k)'],
  ['M79 no reconoce descripcion como nombre',          /\(nombre\|descripcion\|descripción\|razon\|razón\|glosa\|titulo\|título\|cardname\)/, '(zzz)'],
  ['M80 el nombre puede no ser texto',                 /const esTexto = k => typeof prim\[k\] === 'string';/, 'const esTexto = k => true;'],
  ['M81 no salta los elementos nulos',                 /\(filas \|\| \[\]\)\.find\(f => f && typeof f === 'object' && !Array\.isArray\(f\)\)/, '(filas || [])[0]'],
  ['M82 no devuelve las llaves',                       /const campos = Object\.keys\(prim\);/, 'const campos = [];'],
  ['M83 sin respaldo para cardName',                   /if \(!campoNombre\) campoNombre = campos\.find\(k => k !== campoId && esTexto\(k\)\) \|\| null;/, ''],
  ['M84 el respaldo puede tomar el id como nombre',    /campos\.find\(k => k !== campoId && esTexto\(k\)\)/, 'campos.find(k => esTexto(k))'],
  ['M86 el id pelado deja de reconocerse',             /if \(\/\^\\d\+\$\/\.test\(t\)\) return Number\(t\);/, ''],
  ['M87 el id no se recorta de espacios',              /const t = String\(texto == null \? '' : texto\)\.trim\(\);\n  if \(!t\) return null;/, "const t = String(texto == null ? '' : texto);\n  if (!t) return null;"],
  ['M88 formId pasa por id del documento',             /\['id', 'formHeaderId', 'formHeaderiD', 'nroPedido', 'pedido'\]/, "['id', 'formId', 'formHeaderId', 'formHeaderiD', 'nroPedido', 'pedido']"],
  ['M89 un id en texto no se convierte (idCreado)',    /const v = j\[k\];\n      if \(typeof v === 'number' && Number\.isFinite\(v\)\) return v;\n      if \(typeof v === 'string' && \/\^\\d\+\$\/\.test\(v\.trim\(\)\)\) return Number\(v\.trim\(\)\);/, "const v = j[k];\n      if (typeof v === 'number' && Number.isFinite(v)) return v;"],
  ['M98 un id en texto no se convierte (documento)',   /const v = doc\[k\];\n    if \(typeof v === 'number' && Number\.isFinite\(v\)\) return v;\n    if \(typeof v === 'string' && \/\^\\d\+\$\/\.test\(v\.trim\(\)\)\) return Number\(v\.trim\(\)\);/, "const v = doc[k];\n    if (typeof v === 'number' && Number.isFinite(v)) return v;"],
  ['M90 inventa un id cuando no lo hay',               /return null;\n\}\n\n\/\* ---- maestros/, 'return 0;\n}\n\n/* ---- maestros'],
  ['M85 el respaldo acepta cualquier tipo',            /if \(!campoNombre\) campoNombre = campos\.find\(k => k !== campoId && esTexto\(k\)\)/, 'if (!campoNombre) campoNombre = campos.find(k => k !== campoId)']
];

function mutar() {
  const fuente = fs.readFileSync(RUTA, 'utf8');
  let vivas = [], muertas = 0, noAplican = [];
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try { r = correr(cargar(mutado)); }
    catch (e) { muertas++; continue; }          // ni siquiera carga: muerta
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

/* -------------------------------------------------------- principal ----- */

const S = require(RUTA);
const r = correr(S);
console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
for (const f of r.fallos) console.log('  FALLA ' + f);

if (process.argv.indexOf('--mutaciones') >= 0 || !r.fallos.length) {
  const m = mutar();
  console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
  for (const n of m.noAplican) console.log('  NO APLICA  ' + n + '  (el patrón ya no está en el archivo)');
  for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n + '  (ninguna prueba la vio)');
  if (m.vivas.length || m.noAplican.length) process.exit(1);
}

process.exit(r.fallos.length ? 1 : 0);
