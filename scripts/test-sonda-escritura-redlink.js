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

  const DOC = { id: 77, cantidad: 30, formDdetalles: [{ id: 5, cantidad: 30, itemsId: 1 }] };

  prueba('T33 con cantidad propone merge y json-patch, con sus Content-Type', () => {
    const l = S.cuerposCandidatos(DOC, 25);
    const merge = l.find(c => /encabezado/.test(c.nombre));
    const jp    = l.find(c => /json-patch · replace \/cantidadConfirmada/.test(c.nombre));
    cierto(merge && jp, 'tienen que estar los dos');
    igual(merge.contentType, 'application/json');
    igual(jp.contentType, 'application/json-patch+json');
  });
  prueba('T34 el json-patch va como lista de operaciones', () => {
    const jp = S.cuerposCandidatos(DOC, 25).find(c => c.contentType === 'application/json-patch+json');
    cierto(Array.isArray(jp.cuerpo), 'JsonPatch es una lista');
    igual(jp.cuerpo[0].op, 'replace');
    igual(jp.cuerpo[0].value, 25);
  });
  prueba('T35 propone también el detalle cuando el documento lo trae', () => {
    const d = S.cuerposCandidatos(DOC, 25).find(c => /detalle/.test(c.nombre));
    cierto(d, 'falta el candidato del detalle');
    igual(d.cuerpo.formDdetalles[0].id, 5);
    igual(d.cuerpo.formDdetalles[0].cantidadConfirmada, 25);
  });
  prueba('T36 sin detalles no inventa el candidato del detalle', () => {
    const l = S.cuerposCandidatos({ id: 1 }, 10);
    falso(l.some(c => /detalle/.test(c.nombre)));
  });
  prueba('T37 sin cantidad no propone cuerpos de cantidad', () => {
    const l = S.cuerposCandidatos(DOC, null);
    falso(l.some(c => /cantidadConfirmada/.test(c.nombre)), 'sin cantidad no hay qué confirmar');
  });
  prueba('T38 una cantidad de cero o negativa no cuenta como cantidad', () => {
    falso(S.cuerposCandidatos(DOC, 0).some(c => /cantidadConfirmada/.test(c.nombre)));
    falso(S.cuerposCandidatos(DOC, -3).some(c => /cantidadConfirmada/.test(c.nombre)));
  });
  prueba('T39 la cantidad llega como texto desde la línea de comandos', () => {
    const jp = S.cuerposCandidatos(DOC, '25').find(c => c.contentType === 'application/json-patch+json');
    igual(jp.cuerpo[0].value, 25, 'tiene que ser número, no texto:');
  });
  prueba('T40 siempre va el testigo vacío, y va al final', () => {
    const l = S.cuerposCandidatos(DOC, 25);
    igual(/testigo/.test(l[l.length - 1].nombre), true);
    igual(l[l.length - 1].cuerpo, {});
  });
  prueba('T41 propone estadoId sólo si el documento lo tiene', () => {
    falso(S.cuerposCandidatos(DOC, 25).some(c => /estadoId/.test(c.nombre)));
    cierto(S.cuerposCandidatos({ id: 1, estadoId: 3 }, 25).some(c => /estadoId/.test(c.nombre)));
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
  ['M23 el json-patch se manda como objeto',           /cuerpo: \[\{ op: 'replace', path: '\/cantidadConfirmada', value: cant \}\]/, "cuerpo: { op: 'replace', path: '/cantidadConfirmada', value: cant }"],
  ['M24 el json-patch va con Content-Type de merge',   /contentType: 'application\/json-patch\+json',\n      cuerpo: \[\{ op: 'replace', path: '\/cantidadConfirmada'/, "contentType: 'application/json',\n      cuerpo: [{ op: 'replace', path: '/cantidadConfirmada'"],
  ['M25 la cantidad no se convierte a número',         /const n   = Number\(cantidad\);/, 'const n   = cantidad;'],
  ['M26 una cantidad de cero se acepta',               /n > 0 \? n : null/, 'n >= 0 ? n : null'],
  ['M27 el candidato del detalle se arma sin detalle', /if \(det\) \{/, 'if (true) {'],
  ['M28 desaparece el testigo vacío',                  /lista\.push\(\{\n    nombre: 'testigo · cuerpo vacío',[\s\S]*?\}\);\n/, ''],
  ['M29 el testigo queda primero',                     /return lista;\n\}/, 'return lista.slice(-1).concat(lista.slice(0,-1));\n}'],
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
  ['M62 --buscar no se reconoce',                      /else if \(x === '--buscar'\) a\.modo = 'buscar';/, '']
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
