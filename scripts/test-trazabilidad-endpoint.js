#!/usr/bin/env node
// ============================================================================
//  scripts/test-trazabilidad-endpoint.js
//
//  Pruebas de api/trazabilidad, con arnés de mutaciones. Los tres módulos de
//  almacenamiento se sustituyen: acá se prueba la función HTTP y el armado de
//  la respuesta, no el blob.
//
//  Lo que protegen: la respuesta que logística va a leer para decidir si una
//  cita quedó corta. Un desajuste que no se muestra es una cita que nadie
//  vuelve a mirar.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'trazabilidad', 'index.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
const RPLAN = path.join(__dirname, '..', 'api', 'shared', 'planillas-walmart.js');
const RPEND = path.join(__dirname, '..', 'api', 'shared', 'pendientes-cruce.js');
process.env.PLANILLAS_STORAGE_CONN = process.env.PLANILLAS_STORAGE_CONN || 'FALSA';
const realPlan = require(RPLAN);
const realPend = require(RPEND);

let FILAS = [];         // apariciones guardadas
let CONFS = [];         // confirmaciones guardadas
let EVENTOS = [];       // eventos de pendientes
let GUARDADO = null;    // lo que el POST mandó a guardar
let HAY = true, FALLA = false, REVIENTA = false;

function planFalso() {
  return {
    hayStorage: () => HAY,
    mesesRecientes: realPlan.mesesRecientes,
    apariciones: realPlan.apariciones,
    cambios: realPlan.cambios,
    leerMes: async (m) => {
      if (REVIENTA) throw new Error('AuthorizationFailure');
      return FILAS.filter(function (f) { return String(f.ts).slice(0, 7) === m; });
    },
    registrar: async (filas, ctx) => {
      GUARDADO = { filas: filas, ctx: ctx };
      if (FALLA) return { ok: false, escritos: 0, motivo: 'AuthorizationFailure' };
      return { ok: true, escritos: filas.length, motivo: '' };
    }
  };
}
function confFalso() {
  return { leerRango: async () => CONFS };
}
function pendFalso() {
  return { abiertas: realPend.abiertas,
           leerEstado: async (hoy) => realPend.estadoVigente(EVENTOS, hoy) };
}

function compilar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  m.require = function (p) {
    if (/planillas-walmart\.js$/.test(p)) return planFalso();
    if (/confirmaciones-registro\.js$/.test(p)) return confFalso();
    if (/pendientes-cruce\.js$/.test(p)) return pendFalso();
    return propio(p);
  };
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
const pruebas = [];
function pruebaAsync(n, fn) { pruebas.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const principal = (roles) => Buffer.from(JSON.stringify({
  userDetails: 'ana@redtecsa.com', userRoles: roles || ['logistica'] })).toString('base64');
const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };

const hoy = new Date().toISOString().slice(0, 10);
const mes = hoy.slice(0, 7);
// Las fechas de las pruebas cuelgan de HOY para que caigan siempre dentro de
// la ventana que la función mira: una prueba con fechas fijas deja de probar
// nada el mes siguiente.
const dia = (atras) => new Date(Date.parse(hoy + 'T00:00:00Z') - atras * 86400000).toISOString().slice(0, 10);

const ap = (d, cita, extra) => Object.assign({
  ts: d + 'T10:00:00.000Z', dia: d, archivo: 'rep-' + d + '.xlsx', quien: 'mmejias',
  cita: cita, po: '8651142003', rut: '92091000-9', cliente: 'UNILEVER CHILE LIMITADA',
  cd: '6009', recepcion: '1', fecha: d, total: 20, malos: 0, canje: 20,
  folio: 4149330, bandeja: 'porConfirmar'
}, extra || {});

const conf = (d, folio, cita, cantidad) => ({
  ts: d + 'T12:00:00.000Z', dia: d, folio: folio, docId: 55, cantidad: cantidad,
  quien: 'ana@redtecsa.com', via: 'pagina',
  redlink: { cliente: 'UNILEVER CHILE LIMITADA', despachado: 20, recepcion: cantidad,
             etapaAntes: 'Pendiente de Confirmación', etapaDespues: 'Transferencia Confirmada',
             firma: 'M3LinkSystem' },
  reporte: { cita: cita, po: '8651142003', rut: '92091000-9' },
  diferencia: 0, clase: 'exacta'
});

const evPend = (d, cita) => realPend.armarEvento({
  ts: d + 'T10:00:00.000Z', accion: 'vista', cita: cita, rut: '92091000-9',
  cliente: 'UNILEVER CHILE LIMITADA', pallets: 15, fechaReporte: d, filas: []
});

async function pedir(S, query, metodo, cuerpo, roles) {
  const c = ctx();
  await S(c, { method: metodo || 'GET', headers: { 'x-ms-client-principal': principal(roles) },
               query: query || {}, body: cuerpo });
  return c.res;
}

async function correr(S) {
  ok = 0; fallos = [];
  pruebas.length = 0;

  /* ---- permisos --------------------------------------------------------- */

  pruebaAsync('T01 sin rol no se ve nada', async function () {
    const r = await pedir(S, { q: '4149330' }, 'GET', null, ['conteos']);
    igual(r.status, 403);
  });

  pruebaAsync('T02 comercial puede MIRAR la trazabilidad', async function () {
    FILAS = [ap(dia(1), '42751929')];
    const r = await pedir(S, { q: '4149330' }, 'GET', null, ['comercial']);
    igual(r.status, 200);
    igual(r.body.apariciones.length, 1);
  });

  pruebaAsync('T03 comercial NO puede anotar apariciones', async function () {
    // Mirar y escribir no son el mismo permiso: la bitácora la escribe quien cruza.
    const r = await pedir(S, {}, 'POST', { filas: [{ cita: '42751929' }] }, ['comercial']);
    igual(r.status, 403);
  });

  pruebaAsync('T04 OPTIONS no exige rol ni devuelve cuerpo', async function () {
    const c = ctx();
    await S(c, { method: 'OPTIONS', headers: {}, query: {} });
    igual(c.res.status, 204);
  });

  /* ---- el término de búsqueda ------------------------------------------- */

  pruebaAsync('T05 buscar vacío es un 400 con un mensaje que dice qué poner', async function () {
    const r = await pedir(S, {}, 'GET');
    igual(r.status, 400);
    cierto(/pedido|cita|PO/.test(r.body.error), r.body.error);
  });

  pruebaAsync('T06 un término con comillas o espacios se rechaza, no se busca', async function () {
    for (const q of ['42751929 OR 1=1', "a'b", '{}', 'x'.repeat(40), '12']) {
      const r = await pedir(S, { q: q }, 'GET');
      igual(r.status, 400, 'con ' + JSON.stringify(q));
    }
  });

  /* ---- búsqueda por folio / cita / PO ----------------------------------- */

  pruebaAsync('T07 buscar por FOLIO trae la historia de su cita', async function () {
    FILAS = [ap(dia(5), '42751929', { folio: null, bandeja: 'excepcion' }),
             ap(dia(1), '42751929', { folio: 4149330 })];
    const r = await pedir(S, { q: '4149330' }, 'GET');
    igual(r.status, 200);
    // La aparición vieja NO tenía folio todavía y tiene que venir igual: es
    // justamente el día en que no cruzaba.
    igual(r.body.apariciones.map(x => x.dia), [dia(1), dia(5)]);
    igual(r.body.citas, ['42751929']);
  });

  pruebaAsync('T08 buscar por CITA trae lo mismo', async function () {
    FILAS = [ap(dia(5), '42751929'), ap(dia(1), '42751929')];
    const r = await pedir(S, { q: '42751929' }, 'GET');
    igual(r.body.apariciones.length, 2);
  });

  pruebaAsync('T09 buscar por PO trae las citas de ese pedido', async function () {
    FILAS = [ap(dia(2), '42751929', { po: '5450706975' }),
             ap(dia(2), '42751936', { po: '5450706975' }),
             ap(dia(2), '42751943', { po: '8651142003' })];
    const r = await pedir(S, { q: '5450706975' }, 'GET');
    igual(r.body.citas, ['42751929', '42751936']);
    igual(r.body.apariciones.length, 2);
  });

  pruebaAsync('T10 un folio con DOS citas trae las dos', async function () {
    // Visto el 11-nov con UNILEVER: tres citas, tres POs, un folio por cita.
    FILAS = [ap(dia(2), '42751929', { folio: 4149330 }),
             ap(dia(2), '42751936', { folio: 4149330 })];
    const r = await pedir(S, { q: '4149330' }, 'GET');
    igual(r.body.citas, ['42751929', '42751936']);
  });

  pruebaAsync('T11 un número que no existe contesta "no hallado", no un error', async function () {
    FILAS = [ap(dia(2), '42751929')];
    const r = await pedir(S, { q: '99999999' }, 'GET');
    igual([r.status, r.body.hallado], [200, false]);
    igual(r.body.apariciones, []);
  });

  pruebaAsync('T11b un folio sin planillas NO devuelve la historia de otras citas', async function () {
    // apariciones() con lista vacía significa "sin filtro": sin guardia, buscar
    // un folio desconocido devolvía los seis meses completos de todo el mundo.
    FILAS = [ap(dia(2), '42751929', { folio: 4149330, po: '8651142003' })];
    const r = await pedir(S, { q: '9999999' }, 'GET');
    igual(r.body.apariciones, [], 'no puede traer la cita de otro');
    igual(r.body.hallado, false);
  });

  pruebaAsync('T11c un folio confirmado ANTES de que existiera este registro se encuentra', async function () {
    // Los 49 folios confirmados el 10-nov no tienen planillas: la única huella
    // es la confirmación. Si buscarlos no devuelve nada, la trazabilidad llega
    // vacía justo para lo que ya hicimos.
    FILAS = [];
    CONFS = [conf(dia(3), 4149330, '42510877', 20)];
    const r = await pedir(S, { q: '4149330' }, 'GET');
    igual([r.body.hallado, r.body.confirmaciones.length], [true, 1]);
    igual(r.body.confirmaciones[0].folio, 4149330);
  });

  pruebaAsync('T11d una confirmación del script, sin cita en el reporte, se encuentra por folio', async function () {
    FILAS = [];
    const c = conf(dia(3), 4149330, '', 20); c.via = 'script';
    CONFS = [c];
    const r = await pedir(S, { q: '4149330' }, 'GET');
    igual(r.body.confirmaciones.length, 1, 'el folio tiene que alcanzar');
  });

  pruebaAsync('T11e buscando por CITA se encuentra una confirmación de otro folio', async function () {
    // Confirmada bajo un folio que nunca pasó por planillas: la cita del
    // reporte es el único puente.
    FILAS = [];
    CONFS = [conf(dia(3), 4148680, '42510877', 20)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.confirmaciones.length, 1, 'la cita tiene que alcanzar');
  });

  pruebaAsync('T11f una aparición vieja bajo otro folio arrastra sus confirmaciones', async function () {
    FILAS = [ap(dia(6), '42510877', { folio: 4148680 }),
             ap(dia(1), '42510877', { folio: 4149330 })];
    CONFS = [conf(dia(6), 4148680, '', 9)];
    const r = await pedir(S, { q: '4149330' }, 'GET');
    igual(r.body.folios, ['4148680', '4149330'], 'los dos folios de la cita');
    igual(r.body.confirmaciones.length, 1);
  });

  pruebaAsync('T11g se leen todos los meses de la ventana, no sólo el actual', async function () {
    FILAS = [ap(dia(45), '42510877', { total: 9, canje: 9 })];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.apariciones.length, 1, 'la del mes pasado tiene que venir');
  });

  /* ---- el caso de logística: 9 y después 20 ----------------------------- */

  pruebaAsync('T12 el salto de 9 a 20 queda en cambios', async function () {
    FILAS = [ap(dia(4), '42510877', { total: 9, canje: 9 }),
             ap(dia(1), '42510877', { total: 20, canje: 20 })];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.cambios.length, 1);
    igual([r.body.cambios[0].canjeAntes, r.body.cambios[0].canjeAhora], [9, 20]);
  });

  pruebaAsync('T13 confirmamos 9 y Walmart ahora dice 20: sale como desajuste', async function () {
    FILAS = [ap(dia(4), '42510877', { total: 9, canje: 9 }),
             ap(dia(1), '42510877', { total: 20, canje: 20 })];
    CONFS = [conf(dia(4), 4149330, '42510877', 9)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.desajustes.length, 1, 'tiene que haber uno');
    const d = r.body.desajustes[0];
    igual([d.cita, d.declarado, d.confirmado, d.faltan, d.sobran], ['42510877', 20, 9, 11, 0]);
    igual(d.ultimoReporte, dia(1), 'el desajuste se mide contra lo ÚLTIMO que dijo Walmart');
  });

  pruebaAsync('T13b el desajuste se mide contra el CANJE, no contra el total', async function () {
    // Walmart declara 22 en total con 2 rechazados: lo que corresponde
    // confirmar son 20. Medir contra el total inventaría un faltante de 2 y
    // mandaría a logística a revisar una cita que está correcta.
    FILAS = [ap(dia(1), '42510877', { total: 22, malos: 2, canje: 20 })];
    CONFS = [conf(dia(1), 4149330, '42510877', 20)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.desajustes, []);
  });

  pruebaAsync('T14 si confirmamos lo que Walmart declara, no hay desajuste', async function () {
    FILAS = [ap(dia(1), '42510877', { total: 20, canje: 20 })];
    CONFS = [conf(dia(1), 4149330, '42510877', 20)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.desajustes, []);
  });

  pruebaAsync('T15 confirmamos de MÁS: también se avisa', async function () {
    FILAS = [ap(dia(1), '42510877', { total: 9, canje: 9 })];
    CONFS = [conf(dia(1), 4149330, '42510877', 20)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual([r.body.desajustes[0].faltan, r.body.desajustes[0].sobran], [0, 11]);
  });

  pruebaAsync('T16 una cita sin confirmar NO es un desajuste', async function () {
    // Todavía no la tocamos: eso es "por confirmar", no "quedó corta".
    FILAS = [ap(dia(1), '42510877', { total: 20, canje: 20 })];
    CONFS = [];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.desajustes, []);
    igual(r.body.confirmaciones, []);
  });

  pruebaAsync('T17 con dos confirmaciones manda la última', async function () {
    FILAS = [ap(dia(1), '42510877', { total: 20, canje: 20 })];
    CONFS = [conf(dia(4), 4149330, '42510877', 9), conf(dia(1), 4149330, '42510877', 20)];
    const r = await pedir(S, { q: '42510877' }, 'GET');
    igual(r.body.desajustes, [], 'la última ya cubrió los 20');
    igual(r.body.confirmaciones.map(x => x.cantidad), [20, 9], 'de la más nueva a la más vieja');
  });

  /* ---- pendientes ------------------------------------------------------- */

  pruebaAsync('T18 si la cita está esperando transferencia, se dice', async function () {
    FILAS = [ap(dia(2), '42751929', { folio: null, bandeja: 'excepcion' })];
    EVENTOS = [evPend(dia(2), '42751929')];
    const r = await pedir(S, { q: '42751929' }, 'GET');
    igual(r.body.pendientes.length, 1);
    igual(r.body.pendientes[0].cita, '42751929');
  });

  pruebaAsync('T19 las pendientes de OTRAS citas no se cuelan', async function () {
    FILAS = [ap(dia(2), '42751929')];
    EVENTOS = [evPend(dia(2), '42751936')];
    const r = await pedir(S, { q: '42751929' }, 'GET');
    igual(r.body.pendientes, []);
  });

  /* ---- POST: anotar las apariciones ------------------------------------- */

  pruebaAsync('T20 el POST guarda las filas con el archivo y quién las subió', async function () {
    const r = await pedir(S, {}, 'POST', { archivo: 'rep.xlsx', filas: [{ cita: '42751929' }] });
    igual([r.status, r.body.guardados, r.body.ok], [200, 1, true]);
    igual(GUARDADO.ctx.archivo, 'rep.xlsx');
    igual(GUARDADO.ctx.quien, 'ana@redtecsa.com', 'quién lo subió NO lo manda el navegador');
  });

  pruebaAsync('T21 un POST absurdamente grande se acota', async function () {
    const muchas = [];
    for (let i = 0; i < S.MAX_FILAS_POST + 100; i++) muchas.push({ cita: '42751929' });
    const r = await pedir(S, {}, 'POST', { filas: muchas });
    cierto(r.body.guardados <= S.MAX_FILAS_POST, 'guardó ' + r.body.guardados);
  });

  pruebaAsync('T21b un POST cuyas filas no son una lista se trata como vacío', async function () {
    const r = await pedir(S, {}, 'POST', { filas: 'abc' });
    igual([r.status, r.body.guardados], [200, 0]);
  });

  pruebaAsync('T22 un POST sin filas no es un error', async function () {
    const r = await pedir(S, {}, 'POST', {});
    igual([r.status, r.body.guardados], [200, 0]);
  });

  pruebaAsync('T23 si no se pudo guardar, el POST lo DICE y no finge un ok', async function () {
    FALLA = true;
    try {
      const r = await pedir(S, {}, 'POST', { filas: [{ cita: '42751929' }] });
      igual([r.status, r.body.ok], [200, false]);
      cierto(/AuthorizationFailure/.test(r.body.aviso), r.body.aviso);
    } finally { FALLA = false; }
  });

  /* ---- bordes ----------------------------------------------------------- */

  pruebaAsync('T24 sin almacenamiento se avisa, y "no hay historia" no se disfraza de "no existe"', async function () {
    HAY = false;
    try {
      const r = await pedir(S, { q: '42751929' }, 'GET');
      igual([r.status, r.body.almacenamiento, r.body.hallado], [200, false, false]);
      cierto(/almacenamiento/.test(r.body.aviso), r.body.aviso);
    } finally { HAY = true; }
  });

  pruebaAsync('T25 si el blob revienta, 502 y el detalle queda en el log', async function () {
    REVIENTA = true;
    try {
      const r = await pedir(S, { q: '42751929' }, 'GET');
      igual(r.status, 502);
      falso(/AuthorizationFailure/.test(JSON.stringify(r.body)), 'el error interno no se filtra');
    } finally { REVIENTA = false; }
  });

  pruebaAsync('T26 los meses se pueden pedir, pero con tope', async function () {
    igual([S.mesesPedidos(undefined), S.mesesPedidos('3'), S.mesesPedidos('999'),
           S.mesesPedidos('0'), S.mesesPedidos('x')],
          [S.MESES_DEF, 3, S.MESES_TOPE, S.MESES_DEF, S.MESES_DEF]);
  });

  pruebaAsync('T27 la ventana que se mira viaja en la respuesta', async function () {
    FILAS = [ap(dia(1), '42751929')];
    const r = await pedir(S, { q: '42751929', meses: '2' }, 'GET');
    igual(r.body.meses, 2);
    cierto(/^\d{4}-\d{2}-01$/.test(r.body.desde), 'desde: ' + r.body.desde);
  });

  for (const [n, fn] of pruebas) {
    FILAS = []; CONFS = []; EVENTOS = []; GUARDADO = null;
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['Y01 comercial puede escribir',             /if \(!q\.roles\.some\(r => \['admin', 'logistica', 'jefatura'\]\.indexOf\(r\) >= 0\)\) \{\n        return salir\(403[\s\S]*?\n      \}/, ''],
  ['Y02 cualquiera ve la trazabilidad',        /if \(!q\.roles\.some\(r => ROLES\.indexOf\(r\) >= 0\)\) \{/, 'if (false) {'],
  ['Y03 el término no se valida',              /if \(!\/\^\[A-Za-z0-9-\]\{3,30\}\$\/\.test\(t\)\) return \{ ok: false/, 'if (false) return { ok: false'],
  ['Y04 un término de un solo dígito vale',    /\{3,30\}\$\//, '{1,30}$/'],
  ['Y05 no se busca por folio',               /return String\(f\.folio\) === t \|\| String\(f\.po\) === t;/, 'return String(f.po) === t;'],
  // Y06 ("no se busca por cita" en coincide) se RETIRÓ: era equivalente. Un
  // término de ocho dígitos ya entra como cita por el camino de abajo, y una
  // cita nunca calza con un folio ni con un PO, así que comparar la cita en
  // coincide no cambiaba ninguna respuesta. El código se simplificó en vez de
  // inventarle una prueba.
  ['Y06 el guardia de la lista vacía se saca', /const apar = listaCitas\.length\n    \? planillas\.apariciones\(filas, listaCitas\)\.slice\(0, MAX_RESULTADOS\)\n    : \[\];/, 'const apar = planillas.apariciones(filas, listaCitas).slice(0, MAX_RESULTADOS);'],
  ['Y07 no se busca por PO',                  / \|\| String\(f\.po\) === t;/, ';'],
  ['Y08 sólo se devuelven las filas que calzaron, no la historia de la cita',
      /\? planillas\.apariciones\(filas, listaCitas\)\.slice\(0, MAX_RESULTADOS\)/,
      '? directas.slice(0, MAX_RESULTADOS)'],
  ['Y09 un folio suelto no se usa como folio', /if \(\/\^\\d\+\$\/\.test\(t\)\) folios\[t\] = 1;/, ''],
  ['Y10 los folios que trae la cita no se suman', /apar\.forEach\(function \(f\) \{ if \(f\.folio\) folios\[String\(f\.folio\)\] = 1; \}\);/, ''],
  ['Y11 las confirmaciones no se filtran por cita', /folios\[String\(r\.folio\)\] \|\| \(r\.reporte && citas\[String\(r\.reporte\.cita\)\]\)/, 'folios[String(r.folio)]'],
  ['Y12 las confirmaciones no se filtran por folio', /return folios\[String\(r\.folio\)\] \|\|/, 'return false ||'],
  ['Y13 las confirmaciones salen de la vieja a la nueva', /return String\(b\.ts \|\| ''\)\.localeCompare\(String\(a\.ts \|\| ''\)\); \}\)\n    \.slice/, "return String(a.ts || '').localeCompare(String(b.ts || '')); })\n    .slice"],
  // Y14 ("manda la primera y no la última") se RETIRÓ: era equivalente. mias
  // ya viene ordenada de la más nueva a la más vieja, así que comparar los ts
  // daba siempre el mismo resultado que tomar la primera. El código quedó con
  // la versión simple y el orden lo cuida Y13.
  ['Y14 la última confirmación de la cita no gana', /if \(!c \|\| confirmadoPorCita\[c\]\) return;/, 'if (!c) return;\n    if (confirmadoPorCita[c] && String(r.ts) > String(confirmadoPorCita[c].ts)) return;'],
  ['Y15 el desajuste se mide contra la aparición más vieja', /apar\.forEach\(function \(f\) \{ if \(!ultima\[f\.cita\]\) ultima\[f\.cita\] = f; \}\);/, 'apar.forEach(function (f) { ultima[f.cita] = f; });'],
  ['Y16 una cita sin confirmar se reporta como desajuste', /if \(!k\) return null;/, 'if (!k) k = { cantidad: 0, ts: "" };'],
  ['Y17 un desajuste de cero se reporta',      /if \(declarado === confirmado\) return null;/, ''],
  ['Y18 faltan y sobran se confunden',         /faltan: declarado > confirmado \? declarado - confirmado : 0,/, 'faltan: confirmado > declarado ? confirmado - declarado : 0,'],
  ['Y19 sobran siempre sale en cero',          /sobran: confirmado > declarado \? confirmado - declarado : 0,/, 'sobran: 0,'],
  ['Y20 el desajuste se mide contra el total y no contra el canje', /const declarado = Number\(u\.canje\) \|\| 0;/, 'const declarado = Number(u.total) || 0;'],
  ['Y21 las pendientes no se filtran por cita', /\.filter\(function \(e\) \{ return citas\[String\(e\.cita\)\]; \}\)/, ''],
  ['Y22 hallado es siempre true',              /hallado: !!\(apar\.length \|\| mias\.length \|\| esperando\.length\)/, 'hallado: true'],
  ['Y23 hallado ignora las confirmaciones',    /!!\(apar\.length \|\| mias\.length \|\| esperando\.length\)/, '!!(apar.length || esperando.length)'],
  ['Y24 el POST no acota las filas',           /\.slice\(0, MAX_FILAS_POST\)/, ''],
  ['Y25 el POST acepta un cuerpo que no es lista', /\(Array\.isArray\(c\.filas\) \? c\.filas : \[\]\)/, '(c.filas || [])'],
  ['Y26 quién subió el archivo lo manda el navegador', /archivo: \(req\.body \|\| \{\}\)\.archivo, quien: q\.nombre/, 'archivo: (req.body || {}).archivo, quien: (req.body || {}).quien'],
  ['Y27 un fallo al guardar se reporta como ok', /ok: r\.ok,/, 'ok: true,'],
  ['Y28 un fallo al guardar no dice por qué',  /aviso: r\.ok \? '' : 'no se pudieron guardar las apariciones: ' \+ r\.motivo/, "aviso: ''"],
  ['Y29 sin almacenamiento se contesta como si no existiera el pedido', /if \(!planillas\.hayStorage\(\)\) \{[\s\S]*?\n    \}/, ''],
  ['Y30 el error interno se filtra al navegador', /return salir\(502, \{ error: 'no se pudo leer la trazabilidad; revisar el log de la función' \}\);/, "return salir(502, { error: String((e && e.message) || e) });"],
  ['Y31 los meses no tienen tope',             /return Math\.min\(n, MESES_TOPE\);/, 'return n;'],
  ['Y32 un meses inválido no cae al default',  /if \(!Number\.isFinite\(n\) \|\| n < 1\) return MESES_DEF;/, ''],
  ['Y33 el OPTIONS exige rol',                 /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, ''],
  ['Y34 se lee un solo mes de planillas',      /for \(const m of planillas\.mesesRecientes\(hoy, meses\)\) out = out\.concat\(await traer\(m\)\);/, 'out = await traer(planillas.mesesRecientes(hoy, meses).pop());']
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
