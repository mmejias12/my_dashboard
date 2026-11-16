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
    if (/pf-escritura\.js$/.test(p)) return { faltantes: () => FALTAN, get API_BASE() { return BASE; } };
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

async function pedir(F, roles, metodo) {
  const c = ctx();
  await F(c, { method: metodo || 'GET', headers: { 'x-ms-client-principal': principal(roles) } });
  return c.res;
}

async function correr(S, L, fuenteL) {
  const FL = fuenteL || FUENTE_L;
  ok = 0; fallos = []; pend.length = 0;
  FALTAN = []; BASE = 'https://apidemo.portalredtec.cl'; STORAGE = true;
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

  prueba('T05 PF_CLAVES sin definir se nombra por su nombre', function () {
    const d = L.diagnostico({});
    igual([d.ok, d.activas], [false, 0]);
    cierto(/no está definida/.test(d.motivo), d.motivo);
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

  pruebaAsync('T14 OPTIONS no pide rol', async function () {
    const c = ctx();
    await S(c, { method: 'OPTIONS', headers: {} });
    igual(c.res.status, 204);
  });

  for (const [n, fn] of pend) {
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
  ['G07 OPTIONS exige rol',                /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, '']
];
const MUT_L = [
  ['H01 la huella es un trozo de la clave', /return crypto\.createHash\('sha256'\)\.update\(String\(clave \|\| ''\), 'utf8'\)\.digest\('hex'\)\.slice\(0, 12\);/, 'return String(clave || "").slice(0, 12);'],
  ['H02 la huella no distingue claves',    /\.digest\('hex'\)\.slice\(0, 12\)/, ".digest('hex').slice(0, 0)"],
  ['H03 el diagnóstico muestra la clave',  /return \{ nombre: x\.nombre, bpId: x\.bpId, usuarioIngresoId: x\.usuarioIngresoId,\n               largoClave: x\.clave\.length, huella: huella\(x\.clave\) \};/, 'return { nombre: x.nombre, bpId: x.bpId, clave: x.clave, huella: huella(x.clave) };'],
  ['H04 un JSON roto no se distingue',     /motivo: 'PF_CLAVES no es JSON válido; tiene que ser una lista en una sola línea' \};/, "motivo: '' };"],
  ['H05 un objeto suelto pasa como lista', /if \(!Array\.isArray\(lista\)\) \{[\s\S]*?\n  \}/, ''],
  ['H06 PF_CLAVES ausente no se nombra',   /motivo: 'PF_CLAVES no está definida en la configuración' \};/, "motivo: '' };"],
  ['H07 no se dice por qué se descartó',   /if \(p\.length\) descartadas\.push\(\{ entrada: i \+ 1, problemas: p \}\);/, ''],
  ['H08 las entradas se numeran desde cero', /\{ entrada: i \+ 1, problemas: p \}/, '{ entrada: i, problemas: p }'],
  ['H09 una clave corta no se reporta',    /p\.push\('la clave tiene ' \+ x\.clave\.length \+ ' caracteres y el mínimo son 24'\);/, ''],
  ['H10 falta bpId no se reporta',         /if \(!\(Number\(x\.bpId\) > 0\)\) p\.push\('falta "bpId", o no es un número mayor que cero'\);/, ''],
  ['H11 ok no mira las activas',           /ok: buenas\.length > 0,/, 'ok: true,']
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
