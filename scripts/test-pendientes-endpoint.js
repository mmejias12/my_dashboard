#!/usr/bin/env node
// ============================================================================
//  scripts/test-pendientes-endpoint.js
//
//  Pruebas de api/pendientes-cruce, con arnés de mutaciones. El módulo de
//  almacenamiento se sustituye: acá se prueba la función HTTP, no el blob.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'pendientes-cruce', 'index.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
const real = require(path.join(__dirname, '..', 'api', 'shared', 'pendientes-cruce.js'));

let EVENTOS = [];       // lo que ya está guardado
let GUARDADOS = [];     // lo que la función manda a guardar
let HAY = true, FALLA = false, REVIENTA = false;

function pendFalso() {
  return {
    hayStorage: () => HAY,
    DIAS_PARA_PREGUNTAR: real.DIAS_PARA_PREGUNTAR,
    abiertas: real.abiertas,
    porCliente: real.porCliente,
    leerEstado: async (hoy) => {
      if (REVIENTA) throw new Error('BlobNotFound: el contenedor no existe');
      return real.estadoVigente(EVENTOS, hoy);
    },
    registrar: async (evs) => {
      GUARDADOS = GUARDADOS.concat(evs);
      if (FALLA) return { ok: false, escritos: 0, motivo: 'AuthorizationFailure' };
      EVENTOS = EVENTOS.concat(evs.map(real.armarEvento));
      return { ok: true, escritos: evs.length, motivo: '' };
    }
  };
}

function compilar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  m.require = function (p) { return /pendientes-cruce\.js$/.test(p) ? pendFalso() : propio(p); };
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
const pendientes = [];
function pruebaAsync(n, fn) { pendientes.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const principal = (roles) => Buffer.from(JSON.stringify({
  userDetails: 'ana@redtecsa.com', userRoles: roles || ['logistica'] })).toString('base64');
const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };

async function llamar(F, metodo, cuerpo, roles) {
  const c = ctx();
  await F(c, { method: metodo, headers: { 'x-ms-client-principal': principal(roles) },
               body: cuerpo || {}, query: {} });
  return c.res;
}
const hoy = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function correr(F) {
  pendientes.length = 0;
  ok = 0; fallos = [];
  EVENTOS = []; GUARDADOS = []; HAY = true; FALLA = false; REVIENTA = false;

  pruebaAsync('E01 una cita sin cruce queda guardada y vuelve como abierta', async () => {
    EVENTOS = []; GUARDADOS = [];
    const r = await llamar(F, 'POST', { archivo: 'Reporte-RedTec.xlsx', vistas: [
      { cita: '42759276', cliente: 'NUTRISCO CHILE S. A.', rut: '77643296-2', pallets: 15 }
    ] });
    igual(r.status, 200);
    igual(r.body.abiertas, 1);
    igual(r.body.pallets, 15, 'los pallets en juego son el dato que importa');
    igual(r.body.guardados, 1);
    igual(GUARDADOS[0].accion, 'vista');
    igual(GUARDADOS[0].archivo, 'Reporte-RedTec.xlsx', 'queda de qué archivo salió');
    igual(GUARDADOS[0].quien, 'ana@redtecsa.com', 'y quién lo subió');
  });
  pruebaAsync('E02 cuando cruza, sale de la lista', async () => {
    EVENTOS = []; GUARDADOS = [];
    await llamar(F, 'POST', { vistas: [{ cita: '42759276', cliente: 'A', pallets: 15 }] });
    const r = await llamar(F, 'POST', { cruzadas: [{ cita: '42759276', folio: 4149330 }] });
    igual(r.body.abiertas, 0);
    igual(r.body.pallets, 0);
    igual(GUARDADOS[GUARDADOS.length - 1].accion, 'cruzo');
  });
  pruebaAsync('E03 cerrarla a mano también la saca, con su motivo', async () => {
    EVENTOS = []; GUARDADOS = [];
    await llamar(F, 'POST', { vistas: [{ cita: '42759276', cliente: 'A', pallets: 15 }] });
    const r = await llamar(F, 'POST', { cerradas: [{ cita: '42759276', motivo: 'Walmart la anuló' }] });
    igual(r.body.abiertas, 0);
    igual(GUARDADOS[GUARDADOS.length - 1].accion, 'cerrada');
    igual(GUARDADOS[GUARDADOS.length - 1].motivo, 'Walmart la anuló');
  });
  pruebaAsync('E04 el mismo archivo subido dos veces no duplica', async () => {
    // Es lo normal: el reporte de hoy trae las mismas citas que el de ayer.
    EVENTOS = []; GUARDADOS = [];
    const uno = { vistas: [{ cita: '42759276', cliente: 'A', pallets: 15 }] };
    await llamar(F, 'POST', uno);
    const r = await llamar(F, 'POST', uno);
    igual(r.body.abiertas, 1, 'sigue siendo una sola cita');
  });
  pruebaAsync('E05 las que pasaron los 7 días se cuentan aparte', async () => {
    EVENTOS = [real.armarEvento({ ts: diasAtras(9) + 'T10:00:00Z', accion: 'vista',
                                  cita: '42759276', cliente: 'A', pallets: 15 }),
               real.armarEvento({ ts: diasAtras(2) + 'T10:00:00Z', accion: 'vista',
                                  cita: '42759277', cliente: 'A', pallets: 4 })];
    const r = await llamar(F, 'GET');
    igual([r.body.abiertas, r.body.urgentes], [2, 1]);
    igual(r.body.diasParaPreguntar, 7);
  });
  pruebaAsync('E06 vuelven agrupadas por cliente, el de más pallets primero', async () => {
    EVENTOS = [real.armarEvento({ ts: hoy() + 'T10:00:00Z', accion: 'vista', cita: '42759276',
                                  cliente: 'CHICO', pallets: 3 }),
               real.armarEvento({ ts: hoy() + 'T10:00:00Z', accion: 'vista', cita: '42759277',
                                  cliente: 'GRANDE', pallets: 25 })];
    const r = await llamar(F, 'GET');
    igual(r.body.clientes.map(c => c.cliente), ['GRANDE', 'CHICO']);
  });
  pruebaAsync('E07 un cuerpo con basura no revienta ni guarda basura', async () => {
    EVENTOS = []; GUARDADOS = [];
    const r = await llamar(F, 'POST', { vistas: ['no soy un objeto', null, 7,
      { cita: '42759276', cliente: 'A', pallets: 1 }], cruzadas: 'tampoco' });
    igual(r.status, 200);
    igual(GUARDADOS.length, 1, 'sólo el que era un objeto');
  });
  pruebaAsync('E08 un POST gigante se acota', async () => {
    EVENTOS = []; GUARDADOS = [];
    const muchas = [];
    for (let i = 0; i < 2000; i++) muchas.push({ cita: String(42700000 + i), cliente: 'A', pallets: 1 });
    await llamar(F, 'POST', { vistas: muchas });
    cierto(GUARDADOS.length <= 500, 'se guardaron ' + GUARDADOS.length);
  });
  pruebaAsync('E09 si el guardado falla, se dice y NO se pierde la respuesta', async () => {
    EVENTOS = []; GUARDADOS = []; FALLA = true;
    const r = await llamar(F, 'POST', { vistas: [{ cita: '42759276', cliente: 'A', pallets: 1 }] });
    FALLA = false;
    igual(r.status, 200, 'el cruce ya se mostró en pantalla: esto no lo tumba');
    cierto(/no se pudo guardar/.test(r.body.aviso || ''), r.body.aviso);
    cierto(/AuthorizationFailure/.test(r.body.aviso || ''), 'y dice por qué');
  });
  pruebaAsync('E10 sin almacenamiento lo dice, no finge que no hay pendientes', async () => {
    HAY = false;
    const r = await llamar(F, 'GET');
    HAY = true;
    igual(r.status, 200);
    igual(r.body.almacenamiento, false);
    cierto(/no se están guardando/.test(r.body.aviso || ''), r.body.aviso);
  });
  pruebaAsync('E11 cero pendientes NO es lo mismo que sin almacenamiento', async () => {
    EVENTOS = [];
    const r = await llamar(F, 'GET');
    igual([r.body.almacenamiento, r.body.abiertas], [true, 0]);
    falso(!!r.body.aviso);
  });
  pruebaAsync('E12 sin rol no se ve ni se escribe', async () => {
    igual((await llamar(F, 'GET', {}, ['authenticated'])).status, 403);
    igual((await llamar(F, 'POST', { vistas: [{ cita: '42759276' }] }, ['authenticated'])).status, 403);
    const c = ctx();
    await F(c, { method: 'GET', headers: {}, body: {}, query: {} });
    igual(c.res.status, 403, 'sin identidad');
    const c2 = ctx();
    await F(c2, { method: 'GET', headers: { 'x-ms-client-principal': 'no-es-json!!' }, body: {}, query: {} });
    igual(c2.res.status, 403, 'con identidad ilegible');
  });
  pruebaAsync('E13 si el blob revienta, el detalle no viaja al navegador', async () => {
    REVIENTA = true;
    const r = await llamar(F, 'GET');
    REVIENTA = false;
    igual(r.status, 502);
    falso(/BlobNotFound/.test(JSON.stringify(r.body)), 'se filtró: ' + JSON.stringify(r.body));
  });
  pruebaAsync('E14 el preflight no escribe', async () => {
    const c = ctx();
    await F(c, { method: 'OPTIONS', headers: {}, body: {}, query: {} });
    igual(c.res.status, 204);
  });
  pruebaAsync('E15 la respuesta no se cachea', async () => {
    const r = await llamar(F, 'GET');
    igual(r.headers['Cache-Control'], 'no-store');
  });

  for (const [n, fn] of pendientes.slice()) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['R01 las vistas no se guardan',               /sumar\(c\.vistas, 'vista'\);/, ''],
  ['R02 las cruzadas se guardan como vistas',    /sumar\(c\.cruzadas, 'cruzo'\);/, "sumar(c.cruzadas, 'vista');"],
  ['R03 las cerradas no se guardan',             /sumar\(c\.cerradas, 'cerrada'\);/, ''],
  ['R04 no queda de qué archivo ni quién',       /\{ accion: accion, archivo: archivo, quien: nombre \}/, '{ accion: accion }'],
  ['R05 entra cualquier cosa como evento',       /if \(!x \|\| typeof x !== 'object'\) return;/, ''],
  ['R06 un POST gigante entra entero',           /\.slice\(0, MAX_EVENTOS\)/, ''],
  ['R07 el tope de eventos es enorme',           /const MAX_EVENTOS = 500;/, 'const MAX_EVENTOS = 100000;'],
  ['R08 no se informan los pallets en juego',    /pallets: abiertas\.reduce\(function \(a, e\) \{ return a \+ \(e\.pallets \|\| 0\); \}, 0\)/, 'pallets: 0'],
  ['R09 no se cuentan las urgentes',             /urgentes: abiertas\.filter\(function \(e\) \{ return e\.urgente; \}\)\.length/, 'urgentes: 0'],
  ['R10 vuelven las resueltas junto con las abiertas', /const abiertas = pend\.abiertas\(estados\);/, 'const abiertas = estados;'],
  ['R11 no se agrupa por cliente',               /clientes: pend\.porCliente\(estados\)/, 'clientes: []'],
  ['R12 un fallo al guardar se esconde',         /if \(!r\.ok\) estado\.aviso = 'no se pudo guardar el seguimiento: ' \+ r\.motivo;/, ''],
  ['R13 sin almacenamiento finge que no hay pendientes', /if \(!pend\.hayStorage\(\)\) \{/, 'if (false) {'],
  ['R14 sin almacenamiento no se distingue',     /return salir\(200, \{ almacenamiento: false, abiertas: 0/, 'return salir(200, { almacenamiento: true, abiertas: 0'],
  ['R15 cualquiera ve las pendientes',           /if \(!q\.roles\.some\(r => ROLES\.indexOf\(r\) >= 0\)\) \{/, 'if (false) {'],
  ['R16 un principal corrupto pasa',             /catch \(e\) \{ return \{ nombre: '', roles: \[\] \}; \}/, "catch (e) { return { nombre: '', roles: ['admin'] }; }"],
  ['R17 el error interno viaja al navegador',    /error: 'no se pudo leer las citas pendientes; revisar el log de la función'/, 'error: String((e && e.message) || e)'],
  ['R18 el preflight escribe',                   /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, ''],
  ['R19 la respuesta se cachea',                 /'Cache-Control': 'no-store'/, "'Cache-Control': 'max-age=300'"],
  ['R20 el POST no devuelve el estado recalculado', /const estado = await responder\(hoy\);/, 'const estado = { abiertas: 0, pallets: 0, urgentes: 0, citas: [], clientes: [] };']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(compilar(mutado)); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  const r = await correr(compilar(FUENTE));
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
