#!/usr/bin/env node
// ============================================================================
//  scripts/test-planillas-walmart.js
//
//  Pruebas de api/shared/planillas-walmart.js, con arnés de mutaciones.
//
//  Lo que protegen: la secuencia de apariciones de una cita en los reportes de
//  Walmart. Es el único lugar donde queda escrito que el 10-07 decían 9 y el
//  14-07 decían 20. El archivo de Walmart no guarda historia y el de mañana
//  reemplaza al de hoy: si esto se pierde o se ordena mal, la pregunta "¿desde
//  cuándo lo sabíamos?" deja de tener respuesta y no hay de dónde recuperarla.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'planillas-walmart.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

process.env.PLANILLAS_STORAGE_CONN = process.env.PLANILLAS_STORAGE_CONN || 'FALSA';

let ESCRITO = [];
let LEER = {};                       // ruta -> texto del blob
function blobQueGuarda() {
  return { BlobServiceClient: { fromConnectionString: function () {
    return { getContainerClient: function () {
      return {
        createIfNotExists: async function () {},
        getAppendBlobClient: function (ruta) {
          return { createIfNotExists: async function () {},
                   appendBlock: async function (b) { ESCRITO.push({ ruta: ruta, bloque: b }); } };
        },
        getBlobClient: function (ruta) {
          return { download: async function () {
            if (!(ruta in LEER)) { const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; }
            return { readableStreamBody: [Buffer.from(LEER[ruta], 'utf8')] };
          } };
        }
      };
    } };
  } } };
}
function blobQueFalla() {
  return { BlobServiceClient: { fromConnectionString: function () {
    return { getContainerClient: function () {
      return { createIfNotExists: async function () { throw new Error('AuthorizationFailure'); } };
    } };
  } } };
}

function compilar(fuente, blobFalso) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  const falso = blobFalso || blobQueGuarda();
  m.require = function (p) { return /storage-blob/.test(p) ? falso : propio(p); };
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
const pendientes = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pendientes.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

// Una aparición ya armada, como la devuelve armarFila.
const ap = (dia, cita, extra) => Object.assign({
  ts: dia + 'T10:00:00.000Z', dia: dia, archivo: 'r-' + dia + '.xlsx', quien: 'mmejias',
  cita: cita, po: '8651142003', rut: '92091000-9', cliente: 'UNILEVER CHILE LIMITADA',
  cd: '6009', recepcion: '1', fecha: dia, total: 20, malos: 0, canje: 20,
  folio: 4149330, bandeja: 'porConfirmar'
}, extra || {});

async function correr(S, fuente) {
  pendientes.length = 0;
  ok = 0; fallos = [];
  ESCRITO = []; LEER = {};

  /* ---- armarFila: lo que entra al archivo ------------------------------ */

  prueba('P01 una fila del reporte queda con las columnas que sirven', function () {
    const f = S.armarFila({ cita: '42751929', po: '8651142003', rut: '92091000-9',
      cliente: 'UNILEVER', cd: '6009', recepcion: '7703', fecha: '2026-11-10',
      total: 20, malos: 2, canje: 18, folio: 4149330, bandeja: 'porConfirmar' },
      { ts: '2026-11-11T12:30:00.000Z', archivo: 'rep.xlsx', quien: 'mmejias' });
    igual(f.dia, '2026-11-11', 'el día sale del ts');
    igual([f.cita, f.po, f.cd, f.total, f.malos, f.canje], ['42751929', '8651142003', '6009', 20, 2, 18]);
    igual([f.folio, f.bandeja], [4149330, 'porConfirmar'], 'lo que resolvió el cruce');
    igual(f.archivo, 'rep.xlsx');
  });

  prueba('P02 sin ts se usa la hora de ahora y el día cuadra con ella', function () {
    const f = S.armarFila({ cita: '42751929' }, {});
    igual(f.dia, String(f.ts).slice(0, 10), 'el día tiene que salir del mismo ts');
    cierto(/^\d{4}-\d{2}-\d{2}T/.test(f.ts), 'el ts tiene que ser ISO');
  });

  prueba('P03 una cantidad ausente queda en 0, no en null', function () {
    const f = S.armarFila({ cita: '42751929' }, {});
    igual([f.total, f.malos, f.canje], [0, 0, 0]);
  });

  prueba('P04 el folio ausente queda en null y NO en 0', function () {
    // Un 0 acá se leería como "folio 0", que es un folio. null es "no sabemos".
    const f = S.armarFila({ cita: '42751929' }, {});
    igual(f.folio, null, 'folio');
  });

  prueba('P05 un objeto en una columna no se escribe como [object Object]', function () {
    const f = S.armarFila({ cita: '42751929', cliente: { a: 1 }, total: { b: 2 } }, {});
    igual([f.cliente, f.total], ['', 0]);
  });

  prueba('P06 un texto larguísimo se corta', function () {
    const f = S.armarFila({ cita: '42751929', cliente: 'x'.repeat(500) }, {});
    cierto(f.cliente.length <= 120, 'quedó en ' + f.cliente.length);
  });

  prueba('P07 los saltos de línea se limpian: una fila es una línea del jsonl', function () {
    const f = S.armarFila({ cita: '42751929', cliente: 'UNI\nLEVER\tS.A.' }, {});
    falso(/[\n\t]/.test(f.cliente), 'quedó ' + JSON.stringify(f.cliente));
  });

  prueba('P08 una cantidad decimal se redondea a entero', function () {
    igual(S.armarFila({ cita: '42751929', total: 19.6 }, {}).total, 20);
  });

  /* ---- registrar -------------------------------------------------------- */

  pruebaAsync('P09 se escriben las filas con cita y se descartan las otras', async function () {
    const r = await S.registrar([{ cita: '42751929', total: 5 }, { cita: 'xx', total: 9 },
                                 { total: 3 }, null], { ts: '2026-11-11T10:00:00.000Z' });
    igual([r.ok, r.escritos], [true, 1], 'sólo la cita válida');
    igual(ESCRITO.length, 1, 'un appendBlock');
    igual(ESCRITO[0].ruta, 'planillas/2026-11.jsonl');
  });

  pruebaAsync('P10 cada fila es una línea de JSON que se puede volver a leer', async function () {
    await S.registrar([{ cita: '42751929' }, { cita: '42751936' }], { ts: '2026-11-11T10:00:00.000Z' });
    const lineas = ESCRITO[0].bloque.split('\n').filter(Boolean);
    igual(lineas.length, 2, 'dos líneas');
    igual(JSON.parse(lineas[1]).cita, '42751936');
    cierto(/\n$/.test(ESCRITO[0].bloque), 'el bloque tiene que cerrar con salto');
  });

  pruebaAsync('P11 filas de meses distintos van a archivos distintos', async function () {
    await S.registrar([{ cita: '42751929' }], { ts: '2026-10-31T23:00:00.000Z' });
    await S.registrar([{ cita: '42751936' }], { ts: '2026-11-01T01:00:00.000Z' });
    igual(ESCRITO.map(e => e.ruta), ['planillas/2026-10.jsonl', 'planillas/2026-11.jsonl']);
  });

  pruebaAsync('P12 sin filas útiles no se toca el blob', async function () {
    const r = await S.registrar([], {});
    igual([r.ok, r.escritos, ESCRITO.length], [true, 0, 0]);
  });

  pruebaAsync('P13 un reporte absurdamente grande se acota', async function () {
    const muchas = [];
    for (let i = 0; i < S.MAX_FILAS + 50; i++) muchas.push({ cita: '4275' + String(1000 + (i % 9000)) });
    const r = await S.registrar(muchas, { ts: '2026-11-11T10:00:00.000Z' });
    cierto(r.escritos <= S.MAX_FILAS, 'escribió ' + r.escritos);
  });

  pruebaAsync('P14 si el blob falla, registrar NO lanza: avisa y devuelve el motivo', async function () {
    const T = compilar(FUENTE_ACTUAL, blobQueFalla());
    const r = await T.registrar([{ cita: '42751929' }], { ts: '2026-11-11T10:00:00.000Z' });
    igual(r.ok, false, 'ok');
    cierto(/AuthorizationFailure/.test(r.motivo), 'motivo: ' + r.motivo);
  });

  pruebaAsync('P14b sin filas y sin almacenamiento, no guardar nada no es un fallo', async function () {
    // Importa el orden: primero "no hay nada que escribir", después "no hay
    // dónde escribir". Al revés, un cruce sin citas nuevas aparecería en
    // pantalla como un problema de almacenamiento que no existe.
    const antes = process.env.PLANILLAS_STORAGE_CONN;
    const otros = ['CONFIRMACIONES_STORAGE_CONN', 'BLOB_CONNECTION_STRING',
                   'OS_STORAGE_CONN', 'ANDEN_STORAGE_CONN'];
    const guardados = otros.map(k => process.env[k]);
    delete process.env.PLANILLAS_STORAGE_CONN;
    otros.forEach(k => { delete process.env[k]; });
    try {
      const T = compilar(FUENTE_ACTUAL);
      falso(T.hayStorage(), 'el módulo tiene que verse sin almacenamiento');
      igual(await T.registrar([], {}), { ok: true, escritos: 0, motivo: '' }, 'sin filas');
      const r = await T.registrar([{ cita: '42751929' }], { ts: '2026-11-11T10:00:00.000Z' });
      igual(r.ok, false, 'con filas y sin almacenamiento SÍ es un fallo');
    } finally {
      process.env.PLANILLAS_STORAGE_CONN = antes;
      otros.forEach((k, i) => { if (guardados[i] !== undefined) process.env[k] = guardados[i]; });
    }
  });

  /* ---- leerMes ---------------------------------------------------------- */

  pruebaAsync('P15 un mes que no existe todavía se lee como vacío', async function () {
    igual(await S.leerMes('2020-01'), []);
  });

  pruebaAsync('P16 una línea corrupta no bota el mes entero', async function () {
    LEER['planillas/2026-11.jsonl'] =
      JSON.stringify(ap('2026-11-10', '42751929')) + '\n{roto\n' +
      JSON.stringify(ap('2026-11-11', '42751936')) + '\n';
    const f = await S.leerMes('2026-11');
    igual(f.length, 2, 'las dos buenas');
  });

  /* ---- apariciones ------------------------------------------------------ */

  prueba('P17 las apariciones salen de la más nueva a la más vieja', function () {
    const a = S.apariciones([ap('2026-07-10', '42510877'), ap('2026-07-14', '42510877'),
                             ap('2026-07-12', '42510877')], []);
    igual(a.map(x => x.dia), ['2026-07-14', '2026-07-12', '2026-07-10']);
  });

  prueba('P18 el mismo archivo con los mismos números es UNA aparición', function () {
    // Dos personas suben el mismo reporte y ninguna sabe de la otra.
    const f = ap('2026-11-11', '42751929');
    igual(S.apariciones([f, JSON.parse(JSON.stringify(f))], []).length, 1);
  });

  prueba('P19 el mismo archivo con otra cantidad son DOS apariciones', function () {
    // Esto es un cambio real, no un duplicado: no se puede perder.
    const a = ap('2026-11-11', '42751929');
    const b = ap('2026-11-11', '42751929', { canje: 9 });
    igual(S.apariciones([a, b], []).length, 2);
  });

  prueba('P19b dos reportes distintos del mismo día son DOS apariciones', function () {
    // El reporte de Walmart llega más de una vez al día. Que dos archivos
    // digan lo mismo no es un duplicado: son dos veces que lo dijeron, y la
    // trazabilidad muestra el nombre del archivo de cada una.
    const a = ap('2026-11-11', '42751929', { archivo: 'mañana.xlsx', ts: '2026-11-11T09:00:00.000Z' });
    const b = ap('2026-11-11', '42751929', { archivo: 'tarde.xlsx',  ts: '2026-11-11T17:00:00.000Z' });
    igual(S.apariciones([a, b], []).map(x => x.archivo), ['tarde.xlsx', 'mañana.xlsx']);
  });

  prueba('P20 pedir unas citas deja fuera las demás', function () {
    const a = S.apariciones([ap('2026-11-11', '42751929'), ap('2026-11-11', '42751936')], ['42751936']);
    igual(a.map(x => x.cita), ['42751936']);
  });

  prueba('P21 sin citas pedidas vienen todas', function () {
    igual(S.apariciones([ap('2026-11-11', '42751929'), ap('2026-11-11', '42751936')], []).length, 2);
  });

  prueba('P22 una fila sin cita válida no entra', function () {
    igual(S.apariciones([ap('2026-11-11', 'xx'), { cita: '42751929' }, null], []).length, 1);
  });

  prueba('P23 dos citas del mismo día salen en orden estable', function () {
    const a = S.apariciones([ap('2026-11-11', '42751936'), ap('2026-11-11', '42751929')], []);
    igual(a.map(x => x.cita), ['42751929', '42751936'], 'desempate por cita');
  });

  /* ---- cambios: el caso que trajo logística ----------------------------- */

  prueba('P24 Walmart dijo 9 y después 20: queda escrito el salto', function () {
    const c = S.cambios(S.apariciones([
      ap('2026-07-10', '42510877', { total: 9, canje: 9 }),
      ap('2026-07-14', '42510877', { total: 20, canje: 20 })], []));
    igual(c.length, 1);
    igual([c[0].de, c[0].a, c[0].canjeAntes, c[0].canjeAhora, c[0].diferencia],
          ['2026-07-10', '2026-07-14', 9, 20, 11]);
  });

  prueba('P25 la misma cantidad en dos reportes NO es un cambio', function () {
    igual(S.cambios(S.apariciones([ap('2026-11-10', '42751929'), ap('2026-11-11', '42751929')], [])), []);
  });

  prueba('P26 bajar la cantidad también es un cambio, con diferencia negativa', function () {
    const c = S.cambios(S.apariciones([
      ap('2026-11-10', '42751929', { total: 20, canje: 20 }),
      ap('2026-11-11', '42751929', { total: 9, canje: 9 })], []));
    igual([c.length, c[0].diferencia], [1, -11]);
  });

  prueba('P27 tres apariciones dan dos cambios, en el orden en que pasaron', function () {
    const c = S.cambios(S.apariciones([
      ap('2026-11-09', '42751929', { total: 5, canje: 5 }),
      ap('2026-11-10', '42751929', { total: 12, canje: 12 }),
      ap('2026-11-11', '42751929', { total: 20, canje: 20 })], []));
    igual(c.map(x => [x.de, x.a, x.diferencia]),
          [['2026-11-10', '2026-11-11', 8], ['2026-11-09', '2026-11-10', 7]], 'el más nuevo primero');
  });

  prueba('P28 cambia el total pero no el canje: también se reporta', function () {
    // Walmart puede mover rechazados sin mover el canje; el par entero importa.
    const c = S.cambios(S.apariciones([
      ap('2026-11-10', '42751929', { total: 20, malos: 0, canje: 20 }),
      ap('2026-11-11', '42751929', { total: 22, malos: 2, canje: 20 })], []));
    igual([c.length, c[0].totalAntes, c[0].totalAhora, c[0].diferencia], [1, 20, 22, 0]);
  });

  prueba('P28b cambia el canje pero no el total: también se reporta', function () {
    // Mismo total de 20, pero Walmart movió 2 a rechazados: lo que vamos a
    // confirmar cambió de 20 a 18 sin que el total se moviera un pallet.
    const c = S.cambios(S.apariciones([
      ap('2026-11-10', '42751929', { total: 20, malos: 0, canje: 20 }),
      ap('2026-11-11', '42751929', { total: 20, malos: 2, canje: 18 })], []));
    igual([c.length, c[0].canjeAntes, c[0].canjeAhora, c[0].diferencia], [1, 20, 18, -2]);
  });

  prueba('P29 dos citas distintas no se mezclan entre ellas', function () {
    const c = S.cambios(S.apariciones([
      ap('2026-11-10', '42751929', { total: 9, canje: 9 }),
      ap('2026-11-11', '42751936', { total: 20, canje: 20 })], []));
    igual(c, [], 'cada cita es su propia historia');
  });

  prueba('P30 una sola aparición no genera cambios', function () {
    igual(S.cambios(S.apariciones([ap('2026-11-11', '42751929')], [])), []);
  });

  /* ---- meses ------------------------------------------------------------ */

  prueba('P31 los meses recientes incluyen el actual y van del viejo al nuevo', function () {
    igual(S.mesesRecientes('2026-11-11', 3), ['2026-09', '2026-10', '2026-11']);
  });

  prueba('P32 el salto de año no se rompe', function () {
    igual(S.mesesRecientes('2026-01-15', 3), ['2025-11', '2025-12', '2026-01']);
  });

  /* ---- varios ----------------------------------------------------------- */

  prueba('P33 una cita es de ocho dígitos y nada más', function () {
    igual([S.esCita('42751929'), S.esCita('4275192'), S.esCita('427519299'),
           S.esCita(' 42751929 '), S.esCita('4275192a'), S.esCita(null)],
          [true, false, false, true, false, false]);
  });

  prueba('P34 un 404 del blob se distingue de un error de permisos', function () {
    const e404 = new Error('x'); e404.statusCode = 404;
    cierto(S.esNoExiste(e404));
    cierto(S.esNoExiste(new Error('BlobNotFound')));
    falso(S.esNoExiste(new Error('AuthorizationFailure')), 'un 403 NO es "todavía no existe"');
  });

  for (const [n, fn] of pendientes) {
    // Cada prueba asíncrona arranca con el blob limpio: si no, la que corre
    // segunda ve lo que escribió la primera y pasa (o falla) por el motivo
    // equivocado.
    ESCRITO = []; LEER = {};
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

let FUENTE_ACTUAL = FUENTE;

const MUTACIONES = [
  ['X01 el día no sale del ts',                   /dia: String\(ts\)\.slice\(0, 10\)/, "dia: '2026-01-01'"],
  ['X02 las cantidades ausentes quedan en null',  /total: entero\(\(f \|\| \{\}\)\.total\) \|\| 0/, 'total: entero((f || {}).total)'],
  ['X03 el folio ausente queda en 0',             /folio: entero\(\(f \|\| \{\}\)\.folio\)/, 'folio: entero((f || {}).folio) || 0'],
  ['X04 los textos no se acotan',                 /return String\(v\)\.replace\(\/\[\\u0000-\\u001f\]\+\/g, ' '\)\.trim\(\)\.slice\(0, LARGO\);/, 'return String(v);'],
  ['X05 los saltos de línea pasan',               /\.replace\(\/\[\\u0000-\\u001f\]\+\/g, ' '\)/, ''],
  ['X06 un objeto se escribe como objeto',        /if \(typeof v === 'object'\) return '';/, ''],
  ['X07 los decimales no se redondean',           /return Number\.isFinite\(n\) \? Math\.round\(n\) : null;/, 'return Number.isFinite(n) ? n : null;'],
  ['X08 se guardan filas sin cita',               /\.filter\(function \(f\) \{ return esCita\(f\.cita\); \}\)/, ''],
  ['X09 no se acota el tamaño del reporte',       /\.slice\(0, MAX_FILAS\)/, ''],
  ['X10 se escribe aunque no haya nada',          /if \(!fs\.length\) return \{ ok: true, escritos: 0, motivo: '' \};/, ''],
  ['X11 todo va a un solo mes',                   /const m = String\(f\.ts\)\.slice\(0, 7\);/, "const m = '2026-11';"],
  ['X12 las líneas se pegan sin separador',       /const bloque = porMes\[m\]\.join\('\\n'\) \+ '\\n';/, "const bloque = porMes[m].join('');"],
  ['X13 un fallo del blob lanza',                 /\} catch \(e\) \{\n    return \{ ok: false, escritos: 0, motivo:/, '} catch (e) { throw e; return { ok: false, escritos: 0, motivo:'],
  ['X14 una línea corrupta bota el mes',          /try \{ return JSON\.parse\(l\); \} catch \(e\) \{ return null; \}/, 'return JSON.parse(l);'],
  ['X15 un 404 al leer el mes lanza',             /if \(esNoExiste\(e\)\) return \[\];/, ''],
  ['X16 un 403 se trata como "no existe"',        /return !!e && \(e\.statusCode === 404/, 'return !!e && (true'],
  ['X17 las apariciones salen de la vieja a la nueva', /return String\(b\.ts \|\| ''\)\.localeCompare\(String\(a\.ts \|\| ''\)\) \|\|/, "return String(a.ts || '').localeCompare(String(b.ts || '')) ||"],
  ['X18 no hay desempate entre citas del mismo día', /String\(a\.cita\)\.localeCompare\(String\(b\.cita\)\);/, '0;'],
  ['X19 la llave de dedup ignora las cantidades', /const llave = \[f\.cita, f\.archivo, f\.dia, f\.total, f\.malos, f\.canje, f\.recepcion\]\.join\('\|'\);/, "const llave = [f.cita, f.archivo, f.dia].join('|');"],
  ['X20 la llave de dedup ignora el archivo',     /\[f\.cita, f\.archivo, f\.dia, f\.total/, '[f.cita, f.dia, f.total'],
  ['X21 no se deduplica nada',                    /if \(vistas\[llave\]\) return;/, ''],
  ['X22 el filtro por cita no filtra',            /if \(hay && !quiero\[String\(f\.cita\)\]\) return;/, ''],
  ['X23 pedir citas vacías deja todo fuera',      /const hay = Object\.keys\(quiero\)\.length;/, 'const hay = 1;'],
  ['X24 filas sin cita válida entran a apariciones', /if \(!f \|\| !esCita\(f\.cita\)\) return;/, ''],
  ['X25 cambios compara al revés en el tiempo',   /const lista = porCita\[c\]\.slice\(\)\.reverse\(\);/, 'const lista = porCita[c].slice();'],
  ['X26 cambios ignora el total',                 /if \(a\.canje === b\.canje && a\.total === b\.total\) continue;/, 'if (a.canje === b.canje) continue;'],
  ['X27 cambios ignora el canje',                 /if \(a\.canje === b\.canje && a\.total === b\.total\) continue;/, 'if (a.total === b.total) continue;'],
  ['X28 cambios reporta todo como cambio',        /if \(a\.canje === b\.canje && a\.total === b\.total\) continue;\n/, ''],
  ['X29 la diferencia va al revés',               /diferencia: b\.canje - a\.canje/, 'diferencia: a.canje - b.canje'],
  ['X30 cambios mezcla citas distintas',          /\(porCita\[f\.cita\] = porCita\[f\.cita\] \|\| \[\]\)\.push\(f\);/, "(porCita['x'] = porCita['x'] || []).push(f);"],
  ['X31 los cambios salen del más viejo primero', /return out\.sort\(function \(x, y\) \{ return String\(y\.a\)\.localeCompare\(String\(x\.a\)\); \}\);/, 'return out;'],
  ['X32 los meses salen del nuevo al viejo',      /return out\.reverse\(\);/, 'return out;'],
  ['X33 los meses recientes no incluyen el actual', /out\.push\(y \+ '-' \+ String\(m\)\.padStart\(2, '0'\)\);\n    m--;/, "m--;\n    out.push(y + '-' + String(m).padStart(2, '0'));"],
  ['X34 el salto de año no baja el año',          /if \(m < 1\) \{ m = 12; y--; \}/, 'if (m < 1) { m = 12; }'],
  ['X35 una cita de cualquier largo vale',        /const esCita = \(v\) => \/\^\\d\{8\}\$\/\.test/, 'const esCita = (v) => /^\\d+$/.test'],
  ['X36 la cita no se recorta antes de validar',  /: v\)\.trim\(\)\);/, ': v));']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    FUENTE_ACTUAL = mutado;
    let r;
    try { r = await correr(compilar(mutado), mutado); } catch (e) { muertas++; FUENTE_ACTUAL = FUENTE; continue; }
    FUENTE_ACTUAL = FUENTE;
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  FUENTE_ACTUAL = FUENTE;
  const r = await correr(compilar(FUENTE), FUENTE);
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
