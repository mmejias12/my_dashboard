#!/usr/bin/env node
// ============================================================================
//  scripts/test-pf-estado.js
//
//  Pruebas de api/pf-estado y del diagnóstico de api/shared/pf-llaves.js, con
//  arnés de mutaciones.
//
//  Lo que protegen: este endpoint existe para explicar por qué una clave no
//  quedó activa, así que inevitablemente habla de claves. La propiedad que no
//  puede fallar es que NUNCA muestre una.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA_F = path.join(__dirname, '..', 'api', 'pf-estado', 'index.js');
const RUTA_L = path.join(__dirname, '..', 'api', 'shared', 'pf-llaves.js');
const FUENTE_F = fs.readFileSync(RUTA_F, 'utf8');
const FUENTE_L = fs.readFileSync(RUTA_L, 'utf8');

const CLAVE = 'S3cret' + 'a'.repeat(38);     // 44, como una base64 de 32 bytes
let FALTAN = [], BASE = 'https://apidemo.portalredtec.cl', STORAGE = true;
let BODEGAS_PEDIDAS = [], BODEGAS_FALLAN = false;

function compilarL(fuente) {
  const m = new Module(RUTA_L, null);
  m.filename = RUTA_L;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA_L));
  m._compile(fuente, RUTA_L);
  return m.exports;
}
function compilarF(fuenteF, fuenteL) {
  const m = new Module(RUTA_F, null);
  m.filename = RUTA_F;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA_F));
  const propio = Module.prototype.require.bind(m);
  m.require = function (p) {
    if (/pf-llaves\.js$/.test(p)) return compilarL(fuenteL || FUENTE_L);
    if (/pf-escritura\.js$/.test(p)) return { faltantes: () => FALTAN, get API_BASE() { return BASE; },
      bodegasDe: async function (bp) {
        BODEGAS_PEDIDAS.push(bp);
        if (BODEGAS_FALLAN) throw new Error('No se pudo leer el maestro de bodegas (HTTP 502)');
        return [{ bodegaiD: 1524 }, { bodegaiD: 1525 }];
      } };
    if (/pf-bitacora\.js$/.test(p)) return { hayStorage: () => STORAGE, CONTAINER: 'redtec-confirmaciones' };
    return propio(p);
  };
  m._compile(fuenteF, RUTA_F);
  return m.exports;
}

let ok = 0, fallos = [];
const pend = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pend.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }
function contiene(lista, re, m) {
  if (!(lista || []).some(x => re.test(JSON.stringify(x)))) {
    throw new Error((m || 'nada calza con ' + re) + ' · ' + JSON.stringify(lista));
  }
}

const principal = (roles) => Buffer.from(JSON.stringify({
  userDetails: 'mmejias@redtecsa.com', userRoles: roles || ['admin'] })).toString('base64');
const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };
const BUENA = JSON.stringify([{ clave: CLAVE, bpId: 499, usuarioIngresoId: 740, nombre: 'PF' }]);

async function pedir(F, roles, metodo, query) {
  const c = ctx();
  await F(c, { method: metodo || 'GET', headers: { 'x-ms-client-principal': principal(roles) },
               query: query || {} });
  return c.res;
}

async function correr(S, L, fuenteL) {
  const FL = fuenteL || FUENTE_L;
  ok = 0; fallos = []; pend.length = 0;
  FALTAN = []; BASE = 'https://apidemo.portalredtec.cl'; STORAGE = true;
  BODEGAS_PEDIDAS = []; BODEGAS_FALLAN = false;
  process.env.PF_CLAVES = BUENA;

  /* ── LO QUE NO PUEDE FALLAR ──────────────────────────────────────────── */

  pruebaAsync('T01 la clave NUNCA sale, ni entera ni en pedazos', async function () {
    const r = await pedir(S, ['admin']);
    const t = JSON.stringify(r.body);
    falso(t.indexOf(CLAVE) >= 0, 'salió entera');
    falso(t.indexOf('S3cret') >= 0, 'salió el principio');
    falso(t.indexOf(CLAVE.slice(-10)) >= 0, 'salió el final');
  });

  prueba('T02 la huella no deja reconstruir la clave', function () {
    const h = L.huella(CLAVE);
    igual(h.length, 12);
    falso(CLAVE.indexOf(h) >= 0, 'la huella no puede ser un trozo de la clave');
    cierto(L.huella('a') !== L.huella('b'), 'dos claves distintas, dos huellas');
    igual(L.huella(CLAVE), L.huella(CLAVE), 'la misma clave da siempre la misma');
  });

  pruebaAsync('T03 sin rol admin no se ve nada', async function () {
    for (const roles of [['logistica'], ['comercial'], []]) {
      const r = await pedir(S, roles);
      igual(r.status, 403, 'con ' + JSON.stringify(roles));
      falso(JSON.stringify(r.body).indexOf('huella') >= 0, 'ni un pedazo del diagnóstico');
    }
  });

  /* ── el diagnóstico ──────────────────────────────────────────────────── */

  pruebaAsync('T04 con todo bien dice que está listo para recibir', async function () {
    const r = await pedir(S, ['admin']);
    igual(r.status, 200);
    igual([r.body.claves.ok, r.body.credenciales.ok, r.body.listoParaRecibir], [true, true, true]);
    igual(r.body.claves.clientes[0].bpId, 499);
    igual(r.body.claves.clientes[0].largoClave, 44);
  });

  prueba('T05 sin nada configurado se dice qué poner', function () {
    const d = L.diagnostico({});
    igual([d.ok, d.activas], [false, 0]);
    cierto(/no hay claves/.test(d.motivo), d.motivo);
  });

  prueba('T06 un JSON roto se distingue de una lista mal armada', function () {
    cierto(/no es JSON válido/.test(L.diagnostico({ PF_CLAVES: '{roto' }).motivo));
    cierto(/tiene que ser una LISTA/.test(L.diagnostico({ PF_CLAVES: '{"clave":"x"}' }).motivo),
           'un objeto suelto es el error más fácil de cometer');
  });

  prueba('T07 cada entrada descartada dice POR QUÉ, con su número', function () {
    const d = L.diagnostico({ PF_CLAVES: JSON.stringify([
      { clave: 'abc', bpId: 499, usuarioIngresoId: 740 },
      { clave: CLAVE, usuarioIngresoId: 740 },
      { clave: CLAVE, bpId: 499 }]) });
    igual([d.ok, d.entradas, d.activas], [false, 3, 0],
          'con todas descartadas NO puede decir que está ok');
    igual(d.descartadas.map(x => x.entrada), [1, 2, 3], 'numeradas desde 1');
    contiene(d.descartadas, /3 caracteres y el mínimo son 24/);
    contiene(d.descartadas, /falta .?.?bpId/);
    contiene(d.descartadas, /falta .?.?usuarioIngresoId/);
  });

  prueba('T07b cuando el JSON no parsea, se describe la FORMA sin el contenido', function () {
    const buena = '[{"clave":"' + CLAVE + '","bpId":499,"usuarioIngresoId":740,"nombre":"PF"}]';
    const casos = {
      curvas:    buena.replace(/"/g, '\u201C'),
      envuelta:  "'" + buena + "'",
      truncada:  buena.slice(0, 30),
      otroInicio: '[[' + buena.slice(2, 30),
      conEspacio: '  ' + buena + '  '
    };
    Object.keys(casos).forEach(function (n) {
      const d = L.diagnostico({ PF_CLAVES: casos[n] });
      // Lo que no puede fallar nunca, ni describiendo el error.
      falso(JSON.stringify(d).indexOf(CLAVE) >= 0, 'se filtró la clave con ' + n);
      falso(JSON.stringify(d).indexOf('S3cret') >= 0, 'se filtró el principio con ' + n);
    });
    cierto(/CURVAS/.test(JSON.stringify(L.diagnostico({ PF_CLAVES: casos.curvas }).pistas)),
           'las comillas curvas son el culpable más común y hay que nombrarlas');
    // La forma viaja en la respuesta, no sólo las pistas: el largo y los
    // extremos son lo que permite comparar con lo que uno creía haber pegado.
    const dc = L.diagnostico({ PF_CLAVES: casos.truncada });
    igual([dc.forma.empieza, dc.forma.largo], ['[{', 30], JSON.stringify(dc.forma));
    contiene(L.diagnostico({ PF_CLAVES: casos.otroInicio }).pistas, /empieza con/,
             'si parece JSON pero arranca distinto, se dice con qué arranca');
    contiene(L.diagnostico({ PF_CLAVES: casos.envuelta }).pistas, /no parece JSON/,
             'envuelta en comillas simples ya no parece JSON');
    contiene(L.diagnostico({ PF_CLAVES: casos.truncada }).pistas, /termina con/);
    igual(L.diagnostico({ PF_CLAVES: casos.conEspacio }).ok, true,
          'los espacios al borde NO rompen el JSON: eso lo tolera JSON.parse');
  });

  prueba('T07c la forma no incluye ningún trozo de la clave', function () {
    const f = L.forma('[{"clave":"' + CLAVE + '"}]');
    igual([f.empieza, f.termina], ['[{', '}]']);
    falso(JSON.stringify(f).indexOf('S3cret') >= 0, JSON.stringify(f));
    igual(f.largo, ('[{"clave":"' + CLAVE + '"}]').length, 'el largo sí, el contenido no');
  });

  prueba('T07d si pegaron la CLAVE SOLA, no se muestran sus extremos', function () {
    // El caso real: PF_CLAVES con la clave pelada. Ahí los primeros y últimos
    // caracteres del valor son parte del secreto, no de la sintaxis.
    const d = L.diagnostico({ PF_CLAVES: CLAVE });
    const t = JSON.stringify(d);
    falso(t.indexOf(CLAVE.slice(0, 2)) >= 0, 'se filtró el principio: ' + t);
    falso(t.indexOf(CLAVE.slice(-2)) >= 0, 'se filtró el final: ' + t);
    igual([d.forma.empieza, d.forma.termina, d.forma.pareceJson], ['', '', false]);
    contiene(d.pistas, /no parece JSON/);
    contiene(d.pistas, /LISTA COMPLETA/, 'y dice qué va en la variable');
  });

  prueba('T07e la forma simple evita el JSON del todo', function () {
    const d = L.diagnostico({ PF_CLAVE: CLAVE, PF_BP_ID: '499', PF_USUARIO_ID: '740' });
    igual([d.ok, d.fuente, d.activas], [true, 'PF_CLAVE', 1]);
    igual(d.clientes[0], { nombre: 'PF', bpId: 499, usuarioIngresoId: 740,
                           largoClave: CLAVE.length, huella: L.huella(CLAVE) });
    falso(JSON.stringify(d).indexOf(CLAVE) >= 0);
  });

  prueba('T07f una PF_CLAVES rota NO tumba el servicio si la forma simple está puesta', function () {
    const d = L.diagnostico({ PF_CLAVES: '{roto', PF_CLAVE: CLAVE, PF_BP_ID: '499', PF_USUARIO_ID: '740' });
    igual([d.ok, d.fuente], [true, 'PF_CLAVE']);
    cierto(/mal armada y se ignoró/.test(d.motivo), d.motivo);
  });

  prueba('T07g la lista manda sobre la forma simple cuando las dos sirven', function () {
    const d = L.diagnostico({ PF_CLAVES: BUENA, PF_CLAVE: 'z'.repeat(44),
                              PF_BP_ID: '500', PF_USUARIO_ID: '741' });
    igual([d.fuente, d.clientes[0].bpId], ['PF_CLAVES', 499]);
  });

  prueba('T07g2 una clave puesta con la forma simple SÍ autentica', function () {
    // Lo que importa de verdad: que el portero la reconozca, no sólo que el
    // diagnóstico la vea.
    const env = { PF_CLAVE: CLAVE, PF_BP_ID: '499', PF_USUARIO_ID: '740' };
    igual(L.identificar(CLAVE, env), { bpId: 499, usuarioIngresoId: 740, nombre: 'PF' });
    igual(L.identificar('x'.repeat(44), env), null, 'y otra clave no');
  });

  prueba('T07h sin nada configurado se dicen LAS DOS maneras', function () {
    const d = L.diagnostico({});
    igual([d.ok, d.fuente], [false, '']);
    cierto(/PF_CLAVE \+ PF_BP_ID \+ PF_USUARIO_ID/.test(d.motivo), d.motivo);
    cierto(/PF_CLAVES/.test(d.motivo), d.motivo);
  });

  prueba('T08 el motivo del descarte tampoco muestra la clave', function () {
    const d = L.diagnostico({ PF_CLAVES: JSON.stringify([{ clave: CLAVE, bpId: 0, usuarioIngresoId: 740 }]) });
    falso(JSON.stringify(d).indexOf(CLAVE) >= 0, JSON.stringify(d));
    falso(JSON.stringify(d).indexOf('S3cret') >= 0);
  });

  prueba('T09 una lista con buenas y malas activa sólo las buenas', function () {
    const d = L.diagnostico({ PF_CLAVES: JSON.stringify([
      { clave: 'corta', bpId: 499, usuarioIngresoId: 740 },
      { clave: CLAVE, bpId: 500, usuarioIngresoId: 741, nombre: 'OTRO' }]) });
    igual([d.ok, d.entradas, d.activas], [true, 2, 1]);
    igual(d.clientes[0].nombre, 'OTRO');
    igual(d.descartadas.length, 1);
  });

  /* ── credenciales y ambiente ─────────────────────────────────────────── */

  pruebaAsync('T10 se dice contra QUÉ ambiente escribe', async function () {
    const r = await pedir(S, ['admin']);
    igual([r.body.credenciales.redlink, r.body.credenciales.esDemo],
          ['https://apidemo.portalredtec.cl', true]);
    BASE = 'https://api.portalredtec.cl';
    const r2 = await pedir(S, ['admin']);
    igual(r2.body.credenciales.esDemo, false, 'productivo NO puede verse como demo');
    BASE = 'https://apidemo.portalredtec.cl';
  });

  pruebaAsync('T11 las credenciales que faltan se nombran, acá sí', async function () {
    // Acá sí se nombran: es el admin configurando, no un cliente llamando.
    FALTAN = ['PF_REDLINK_USER'];
    try {
      const r = await pedir(S, ['admin']);
      igual([r.body.credenciales.ok, r.body.listoParaRecibir], [false, false]);
      igual(r.body.credenciales.faltan, ['PF_REDLINK_USER']);
    } finally { FALTAN = []; }
  });

  pruebaAsync('T12 sin almacenamiento se avisa, porque sin él no hay idempotencia', async function () {
    STORAGE = false;
    try {
      const r = await pedir(S, ['admin']);
      igual(r.body.bitacora.almacenamiento, false);
    } finally { STORAGE = true; }
  });

  pruebaAsync('T13 listoParaRecibir exige las dos cosas', async function () {
    process.env.PF_CLAVES = '{roto';
    try {
      const r = await pedir(S, ['admin']);
      igual(r.body.listoParaRecibir, false, 'sin claves no está listo aunque haya credenciales');
    } finally { process.env.PF_CLAVES = BUENA; }
  });

  pruebaAsync('T13b sin ?probar no se toca Redlink', async function () {
    // Ver la configuración no puede depender de que Redlink esté arriba.
    const r = await pedir(S, ['admin']);
    igual(BODEGAS_PEDIDAS, [], 'no se consultó nada');
    igual(r.body.redlinkResponde, undefined);
  });

  pruebaAsync('T13c con ?probar=1 se consulta y se informa cuántas bodegas vinieron', async function () {
    const r = await pedir(S, ['admin'], 'GET', { probar: '1' });
    igual(BODEGAS_PEDIDAS, [499]);
    igual([r.body.redlinkResponde[0].ok, r.body.redlinkResponde[0].bodegas], [true, 2]);
    cierto(typeof r.body.redlinkResponde[0].ms === 'number', 'y cuánto tardó');
  });

  pruebaAsync('T13d si Redlink falla, acá SÍ se dice el motivo', async function () {
    // Al cliente se le oculta porque puede traer la respuesta de Redlink; a
    // quien opera su propia instalación, no.
    BODEGAS_FALLAN = true;
    try {
      const r = await pedir(S, ['admin'], 'GET', { probar: '1' });
      igual(r.body.redlinkResponde[0].ok, false);
      cierto(/HTTP 502/.test(r.body.redlinkResponde[0].motivo), r.body.redlinkResponde[0].motivo);
      igual(r.status, 200, 'que Redlink falle no rompe el diagnóstico');
    } finally { BODEGAS_FALLAN = false; }
  });

  pruebaAsync('T13e sin rol admin, ?probar tampoco consulta', async function () {
    await pedir(S, ['logistica'], 'GET', { probar: '1' });
    igual(BODEGAS_PEDIDAS, [], 'el rol se mira ANTES de gastar una llamada a Redlink');
  });

  pruebaAsync('T14 OPTIONS no pide rol', async function () {
    const c = ctx();
    await S(c, { method: 'OPTIONS', headers: {} });
    igual(c.res.status, 204);
  });

  for (const [n, fn] of pend) {
    // Cada prueba asíncrona arranca limpia: si no, la que corre después ve las
    // llamadas de la anterior y afirma (o niega) por el motivo equivocado.
    BODEGAS_PEDIDAS = []; BODEGAS_FALLAN = false;
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUT_F = [
  ['G01 cualquiera ve el diagnóstico',     /if \(!q\.roles\.some\(r => ROLES\.indexOf\(r\) >= 0\)\) \{[\s\S]*?\n  \}/, ''],
  ['G02 logistica también lo ve',          /const ROLES = \['admin'\];/, "const ROLES = ['admin', 'logistica'];"],
  ['G03 listoParaRecibir ignora las credenciales', /listoParaRecibir: diag\.ok && falta\.length === 0/, 'listoParaRecibir: diag.ok'],
  ['G04 listoParaRecibir ignora las claves', /listoParaRecibir: diag\.ok && falta\.length === 0/, 'listoParaRecibir: falta.length === 0'],
  ['G05 productivo se reporta como demo',  /esDemo: \/\^https:\\\/\\\/apidemo\\\.\/i\.test\(String\(escritura\.API_BASE \|\| ''\)\)/, 'esDemo: /apidemo/i.test(String(escritura.API_BASE || "")) || true'],
  ['G06 el ambiente no se informa',        /redlink: escritura\.API_BASE,/, "redlink: '',"],
  ['G07 OPTIONS exige rol',                /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, ''],
  ['G08 siempre se consulta a Redlink',    /if \(String\(\(req\.query \|\| \{\}\)\.probar \|\| ''\) === '1'\) \{/, 'if (true) {'],
  ['G09 un fallo de Redlink tumba el diagnóstico', /\} catch \(e\) \{\n        \/\/ Acá SÍ va el motivo[\s\S]*?\n      \}/, '} catch (e) { throw e; }'],
  ['G10 el motivo del fallo no se informa', /motivo: String\(\(e && e\.message\) \|\| e\)\.slice\(0, 300\)/, "motivo: ''"],
  ['G11 no se informa cuántas bodegas vinieron', /bodegas: Array\.isArray\(b\) \? b\.length : 0,/, 'bodegas: 0,'],
  ['G12 la prueba no viaja en la respuesta', /redlinkResponde: prueba,/, '']
];
const MUT_L = [
  ['H01 la huella es un trozo de la clave', /return crypto\.createHash\('sha256'\)\.update\(String\(clave \|\| ''\), 'utf8'\)\.digest\('hex'\)\.slice\(0, 12\);/, 'return String(clave || "").slice(0, 12);'],
  ['H02 la huella no distingue claves',    /\.digest\('hex'\)\.slice\(0, 12\)/, ".digest('hex').slice(0, 0)"],
  ['H03 el diagnóstico muestra la clave',  /return \{ nombre: x\.nombre, bpId: x\.bpId, usuarioIngresoId: x\.usuarioIngresoId,\n             largoClave: x\.clave\.length, huella: huella\(x\.clave\) \};/, 'return { nombre: x.nombre, clave: x.clave, huella: huella(x.clave) };'],
  ['H04 un JSON roto no se distingue',     /motivo: 'PF_CLAVES no es JSON válido; tiene que ser una lista en una sola línea',\n             forma: f, pistas: pistas \};/, "motivo: '', forma: f, pistas: pistas };"],
  ['H05 un objeto suelto pasa como lista', /if \(!Array\.isArray\(lista\)\) \{[\s\S]*?\n  \}/, ''],
  ['H06 sin claves no se dice qué poner',  /'no hay claves: pon PF_CLAVE \+ PF_BP_ID \+ PF_USUARIO_ID \(lo más simple\), ' \+/, "'' + "],
  ['H17 los extremos se muestran aunque no sea JSON', /empieza: pareceJson \? t\.slice\(0, 2\) : '',/, 'empieza: t.slice(0, 2),'],
  ['H18 el final se muestra aunque no sea JSON', /termina: pareceJson \? t\.slice\(-2\) : '',/, 'termina: t.slice(-2),'],
  ['H19 no se avisa que no parece JSON',   /pistas\.push\('el valor no parece JSON: no empieza con "\[" ni con "\{"'\);/, ''],
  ['H20 no se dice que la variable lleva la lista', /pistas\.push\('PF_CLAVES lleva la LISTA COMPLETA en JSON, no la clave sola: ' \+/, "pistas.push('' + "],
  ['H21 la forma simple no se usa nunca',  /return lista\.length \? lista : simple\(env\);/, 'return lista;'],
  ['H22 la forma simple acepta claves cortas', /if \(clave\.length < 24 \|\| !\(bpId > 0\) \|\| !\(usuarioIngresoId > 0\)\) return \[\];/, ''],
  ['H23 la forma simple pisa a la lista',  /return lista\.length \? lista : simple\(env\);/, 'return simple(env).length ? simple(env) : lista;'],
  ['H24 una PF_CLAVES rota tumba la forma simple', /if \(sim\.length\) \{\n      return \{ ok: true, fuente: 'PF_CLAVE'[\s\S]*?\n    \}/, ''],
  ['H07 no se dice por qué se descartó',   /if \(p\.length\) descartadas\.push\(\{ entrada: i \+ 1, problemas: p \}\);/, ''],
  ['H08 las entradas se numeran desde cero', /\{ entrada: i \+ 1, problemas: p \}/, '{ entrada: i, problemas: p }'],
  ['H09 una clave corta no se reporta',    /p\.push\('la clave tiene ' \+ x\.clave\.length \+ ' caracteres y el mínimo son 24'\);/, ''],
  ['H10 falta bpId no se reporta',         /if \(!\(Number\(x\.bpId\) > 0\)\) p\.push\('falta "bpId", o no es un número mayor que cero'\);/, ''],
  ['H11 ok no mira las activas',           /ok: buenas\.length > 0,/, 'ok: true,'],
  ['H12 la forma muestra un trozo de la clave', /empieza: pareceJson \? t\.slice\(0, 2\) : '',/, 'empieza: t.slice(0, 20),'],
  ['H13 las comillas curvas no se detectan', /if \(f\.comillasCurvas\) pistas\.push/, 'if (false) pistas.push'],
  ['H14 no se dice con qué empieza',        /if \(f\.empieza !== '\[\{'\) pistas\.push/, 'if (false) pistas.push'],
  ['H15 no se dice con qué termina',        /if \(f\.termina !== '\}\]'\) pistas\.push/, 'if (false) pistas.push'],
  ['H16 la forma no viaja',                 /forma: f, pistas: pistas \};/, 'pistas: pistas };']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  const casos = MUT_F.map(x => ['F', x]).concat(MUT_L.map(x => ['L', x]));
  for (const [cual, [nombre, busca, pone]] of casos) {
    const fuente = cual === 'F' ? FUENTE_F : FUENTE_L;
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try {
      r = cual === 'F' ? await correr(compilarF(mutado, FUENTE_L), compilarL(FUENTE_L), FUENTE_L)
                       : await correr(compilarF(FUENTE_F, mutado), compilarL(mutado), mutado);
    } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: casos.length };
}

(async function () {
  const r = await correr(compilarF(FUENTE_F, FUENTE_L), compilarL(FUENTE_L), FUENTE_L);
  console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
  for (const f of r.fallos) console.log('  FALLA ' + f);
  if (!r.fallos.length || process.argv.indexOf('--mutaciones') >= 0) {
    const m = await mutar();
    console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
    for (const n of m.noAplican) console.log('  NO APLICA  ' + n);
    for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n);
    if (m.vivas.length || m.noAplican.length) process.exit(1);
  }
  process.exit(r.fallos.length ? 1 : 0);
})();
