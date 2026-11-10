#!/usr/bin/env node
// ============================================================================
//  scripts/test-confirmaciones-historial.js
//
//  Pruebas de api/confirmaciones-historial, con arnés de mutaciones.
//  El historial se lee y nada más: no hay ruta para editarlo ni borrarlo.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'confirmaciones-historial', 'index.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

let REGISTROS = [];
let HAY = true;
let REVIENTA = false;
const PEDIDOS = [];

// El módulo del historial se sustituye: estas pruebas son sobre la función,
// no sobre el blob. Las agregaciones tienen su propia suite.
function historialFalso() {
  const real = require(path.join(__dirname, '..', 'api', 'shared', 'confirmaciones-registro.js'));
  return {
    hayStorage: () => HAY,
    leerRango: async (desde, hasta) => {
      PEDIDOS.push([desde, hasta]);
      if (REVIENTA) throw new Error('BlobNotFound: el contenedor no existe');
      return REGISTROS.filter(r => r.dia >= desde && r.dia <= hasta);
    },
    porDia: real.porDia,
    porCliente: real.porCliente
  };
}

function compilar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  m.require = function (pedido) {
    return /confirmaciones-registro\.js$/.test(pedido) ? historialFalso() : propio(pedido);
  };
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
  userDetails: 'alguien@redtecsa.com', userRoles: roles || []
})).toString('base64');
const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };

const reg = (dia, clase, cantidad, cliente, dif) => ({
  dia: dia, ts: dia + 'T10:00:00Z', clase: clase, cantidad: cantidad,
  diferencia: dif === undefined ? 0 : dif, folio: 1,
  reporte: { razonSocial: cliente, rut: '1-9', cita: '42759276' },
  redlink: { cliente: cliente }
});

async function llamar(F, query, roles) {
  const c = ctx();
  await F(c, { method: 'GET', headers: { 'x-ms-client-principal': principal(roles || ['logistica']) },
               query: query || {} });
  return c.res;
}

async function correr(F) {
  pendientes.length = 0;
  ok = 0; fallos = [];
  REGISTROS = [
    reg('2026-11-03', 'sin-diferencia', 10, 'NUTRISCO CHILE S. A.'),
    reg('2026-11-03', 'recibio-menos', 5, 'ALIMENTOS Y FRUTOS S A', -3),
    reg('2026-11-10', 'sin-diferencia', 7, 'NUTRISCO CHILE S. A.')
  ];
  HAY = true; REVIENTA = false; PEDIDOS.length = 0;

  pruebaAsync('H01 devuelve los registros, los días y los clientes a la vez', async () => {
    // Juntas a propósito: si cada vista agregara por su cuenta, dos pantallas
    // podrían mostrar números distintos del mismo día.
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' });
    igual(r.status, 200);
    igual(r.body.registros.length, 3);
    igual(r.body.dias.map(d => d.dia), ['2026-11-03', '2026-11-10']);
    igual(r.body.clientes.length, 2);
    igual(r.body.almacenamiento, true);
  });
  pruebaAsync('H02 el cliente con diferencias va primero', async () => {
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' });
    igual(r.body.clientes[0].cliente, 'ALIMENTOS Y FRUTOS S A');
    igual(r.body.clientes[0].recibioMenos, 1);
  });
  pruebaAsync('H03 el rango filtra de verdad', async () => {
    const r = await llamar(F, { desde: '2026-11-09', hasta: '2026-11-11' });
    igual(r.body.registros.length, 1);
    igual(PEDIDOS[PEDIDOS.length - 1], ['2026-11-09', '2026-11-11'], 'el rango viaja tal cual');
  });
  pruebaAsync('H04 sin rango usa el mes corriente, no todo el histórico', async () => {
    const r = await llamar(F, {});
    igual(r.status, 200);
    const p = PEDIDOS[PEDIDOS.length - 1];
    cierto(/^\d{4}-\d{2}-01$/.test(p[0]), 'empieza el día 1: ' + p[0]);
    cierto(p[1] >= p[0], p.join(' a '));
  });
  pruebaAsync('H05 un rango mal escrito se rechaza con texto, no con un 500', async () => {
    for (const q of [{ desde: 'ayer', hasta: '2026-11-10' }, { desde: '2026-11-01', hasta: '10-11-2026' },
                     { desde: '2026-13-40', hasta: '2026-11-10' }]) {
      const r = await llamar(F, q);
      igual(r.status, 400, JSON.stringify(q));
      cierto(/YYYY-MM-DD/.test(r.body.error), r.body.error);
    }
    // Y que el motivo sea el correcto: una fecha que no existe no es un rango
    // al revés, y decirlo mal manda a mirar al lado equivocado.
    const r2 = await llamar(F, { desde: '2026-13-40', hasta: '2026-11-10' });
    falso(/al revés/.test(r2.body.error), 'el motivo está mal: ' + r2.body.error);
    cierto(/existan/.test(r2.body.error), r2.body.error);
    igual((await llamar(F, { desde: '2026-02-30', hasta: '2026-03-01' })).status, 400,
      'el 30 de febrero no existe');
  });
  pruebaAsync('H06 un rango al revés se rechaza', async () => {
    const r = await llamar(F, { desde: '2026-11-10', hasta: '2026-11-01' });
    igual(r.status, 400);
    cierto(/al revés/.test(r.body.error), r.body.error);
  });
  pruebaAsync('H07 un rango enorme se rechaza antes de leer 40 blobs', async () => {
    const r = await llamar(F, { desde: '2020-01-01', hasta: '2026-11-10' });
    igual(r.status, 400);
    cierto(/días/.test(r.body.error), r.body.error);
  });
  pruebaAsync('H08 sin almacenamiento lo DICE, no finge que no hubo nada', async () => {
    // Es la señal de salud que hace falta antes de confirmar en masa.
    HAY = false;
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' });
    HAY = true;
    igual(r.status, 200, 'no es culpa de quien pregunta');
    igual(r.body.almacenamiento, false);
    cierto(/no se están guardando/.test(r.body.aviso || ''), r.body.aviso);
    igual(r.body.registros, []);
  });
  pruebaAsync('H09 cero confirmaciones NO es lo mismo que sin almacenamiento', async () => {
    const r = await llamar(F, { desde: '2026-01-01', hasta: '2026-01-31' });
    igual(r.status, 200);
    igual(r.body.almacenamiento, true, 'había dónde guardar: simplemente no hubo');
    igual(r.body.registros, []);
    falso(!!r.body.aviso, 'y no se avisa nada');
  });
  pruebaAsync('H10 sin rol no se ve el historial', async () => {
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' }, ['authenticated']);
    igual(r.status, 403);
  });
  pruebaAsync('H11 comercial SÍ puede verlo: es quien habla con el cliente', async () => {
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' }, ['comercial']);
    igual(r.status, 200);
  });
  pruebaAsync('H12 sin principal, o con uno corrupto, tampoco', async () => {
    const c = ctx();
    await F(c, { method: 'GET', headers: {}, query: { desde: '2026-11-01', hasta: '2026-11-30' } });
    igual(c.res.status, 403, 'sin identidad');
    // Un principal que no se puede leer NO puede caer en roles de más: ante la
    // duda, ninguno.
    const c2 = ctx();
    await F(c2, { method: 'GET', headers: { 'x-ms-client-principal': 'esto-no-es-json-valido!!' },
                  query: { desde: '2026-11-01', hasta: '2026-11-30' } });
    igual(c2.res.status, 403, 'con identidad ilegible');
  });
  pruebaAsync('H13 si el blob revienta, el detalle no viaja al navegador', async () => {
    REVIENTA = true;
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' });
    REVIENTA = false;
    igual(r.status, 502);
    falso(/BlobNotFound/.test(JSON.stringify(r.body)), 'se filtró el error interno: ' + JSON.stringify(r.body));
  });
  pruebaAsync('H14 el preflight no lee nada', async () => {
    const c = ctx();
    await F(c, { method: 'OPTIONS', headers: {}, query: {} });
    igual(c.res.status, 204);
  });
  pruebaAsync('H15 la respuesta no se cachea', async () => {
    // Un historial cacheado muestra confirmaciones viejas justo después de
    // confirmar, que es cuando alguien va a mirarlo.
    const r = await llamar(F, { desde: '2026-11-01', hasta: '2026-11-30' });
    igual(r.headers['Cache-Control'], 'no-store');
  });

  for (const [n, fn] of pendientes.slice()) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['H01m no devuelve el desglose por cliente',   /clientes: historial\.porCliente\(registros\)/, 'clientes: []'],
  ['H02m no devuelve los días',                  /dias: historial\.porDia\(registros\)/, 'dias: []'],
  ['H03m el rango no se le pasa al lector',      /historial\.leerRango\(r\.desde, r\.hasta\)/, "historial.leerRango('2000-01-01', '2100-01-01')"],
  ['H04m sin rango lee todo el histórico',       /const desde = String\(\(q && q\.desde\) \|\| ''\) \|\| hoy\.slice\(0, 8\) \+ '01';/, "const desde = String((q && q.desde) || '') || '2000-01-01';"],
  ['H05m el formato de fecha no se valida',      /if \(!esDiaReal\(desde\) \|\| !esDiaReal\(hasta\)\) \{/, 'if (false) {'],
  ['H05b una fecha que no existe pasa',          /return !isNaN\(f\.getTime\(\)\) && f\.toISOString\(\)\.slice\(0, 10\) === d;/, 'return !isNaN(f.getTime());'],
  ['H06m un rango al revés pasa',                /if \(hasta < desde\) return \{ error: 'el rango está al revés/, "if (false) return { error: 'el rango está al revés"],
  ['H07m no hay tope de días',                   /if \(diasEntre\(desde, hasta\) > MAX_DIAS\) \{/, 'if (false) {'],
  ['H07b el tope de días es enorme',             /const MAX_DIAS = 400;/, 'const MAX_DIAS = 100000;'],
  ['H08m sin almacenamiento finge que no hubo nada', /if \(!historial\.hayStorage\(\)\) \{/, 'if (false) {'],
  ['H08b no se distingue sin almacenamiento de sin datos', /almacenamiento: false, desde: r\.desde/, 'almacenamiento: true, desde: r.desde'],
  ['H09m siempre avisa, haya o no almacenamiento', /almacenamiento: true, desde: r\.desde, hasta: r\.hasta,\n      registros: registros,/, "almacenamiento: true, aviso: 'las confirmaciones no se están guardando', desde: r.desde, hasta: r.hasta,\n      registros: registros,"],
  ['H10m cualquiera ve el historial',            /if \(!q\.roles\.some\(r => ROLES\.indexOf\(r\) >= 0\)\) \{/, 'if (false) {'],
  ['H11m comercial queda fuera',                 /const ROLES = \['admin', 'logistica', 'jefatura', 'comercial'\];/, "const ROLES = ['admin', 'logistica', 'jefatura'];"],
  ['H12m un principal corrupto pasa',            /catch \(e\) \{ return \{ nombre: '', roles: \[\] \}; \}/, "catch (e) { return { nombre: '', roles: ['admin'] }; }"],
  ['H13m el error interno viaja al navegador',   /error: 'no se pudo leer el historial; revisar el log de la función'/, 'error: String((e && e.message) || e)'],
  ['H14m el preflight lee',                      /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, ''],
  ['H15m la respuesta se cachea',                /'Cache-Control': 'no-store'/, "'Cache-Control': 'max-age=300'"]
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
