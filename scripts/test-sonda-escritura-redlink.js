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
  ['M33 --confirmar no lee el documento',              /\{ a\.modo = 'confirmar'; a\.id = x\.slice\(12\); \}/, "{ a.modo = 'confirmar'; }"]
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
