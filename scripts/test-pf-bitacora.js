#!/usr/bin/env node
// ============================================================================
//  scripts/test-pf-bitacora.js
//
//  Pruebas de api/shared/pf-bitacora.js, con arnés de mutaciones. El blob se
//  sustituye: lo que se prueba es el reductor y el armado del evento, que es
//  donde vive la verdad.
//
//  Lo que protegen: la única defensa contra crear dos relocalizaciones por un
//  reintento. Si esta bitácora miente sobre el estado de una llave, PF mueve
//  los pallets dos veces y eso llega a SAP.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'pf-bitacora.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
process.env.PF_STORAGE_CONN = process.env.PF_STORAGE_CONN || 'FALSA';

let ESCRITO = [], LEER = {};
function blobQueGuarda() {
  return { BlobServiceClient: { fromConnectionString: function () {
    return { getContainerClient: function () {
      return {
        createIfNotExists: async function () {},
        getAppendBlobClient: function (ruta) {
          return { createIfNotExists: async function () {},
                   appendBlock: async function (b) { ESCRITO.push({ ruta, bloque: b }); } };
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
function compilar(fuente, falso) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  const b = falso || blobQueGuarda();
  m.require = function (p) { return /storage-blob/.test(p) ? b : propio(p); };
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
const pend = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pend.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const LL = '499|5|45285';
const HU = { bodegaOrigenId: 1537, bodegaDestinoId: 1550, cantidad: 24, documentoId: 5, documentoNumero: 45285 };
const ev = (ts, estado, extra) => Object.assign({ ts, llave: LL, estado, bpId: 499, huella: HU }, extra || {});

let FUENTE_ACTUAL = FUENTE;

async function correr(S, fuente) {
  FUENTE_ACTUAL = fuente || FUENTE;
  pend.length = 0; ok = 0; fallos = [];
  ESCRITO = []; LEER = {};

  /* ── armar el evento ─────────────────────────────────────────────────── */

  prueba('B01 el evento guarda la llave, el estado y la huella', function () {
    const e = S.armarEvento(ev('2026-11-12T10:00:00.000Z', 'creado', { folio: 4150001, docId: 700123 }));
    igual([e.llave, e.estado, e.folio, e.docId, e.bpId], [LL, 'creado', 4150001, 700123, 499]);
    igual(e.huella, HU, 'la huella viaja entera');
    igual(e.dia, '2026-11-12');
  });

  prueba('B02 un estado inventado se degrada a "en-duda", NO a vía libre', function () {
    // Un estado que no entendemos no puede autorizar una segunda escritura.
    ['loquesea', '', null, undefined, 'CREADO'].forEach(function (x) {
      igual(S.armarEvento({ llave: LL, estado: x }).estado, 'en-duda', 'con ' + JSON.stringify(x));
    });
  });

  prueba('B03 los cuatro estados válidos se guardan tal cual', function () {
    S.ESTADOS.forEach(function (e) {
      igual(S.armarEvento({ llave: LL, estado: e }).estado, e);
    });
  });

  prueba('B04 una huella que no es objeto queda en null, no a medias', function () {
    [1, 'x', true, null].forEach(function (x) {
      igual(S.armarEvento({ llave: LL, estado: 'creado', huella: x }).huella, null, 'con ' + JSON.stringify(x));
    });
  });

  prueba('B05 el día sale del ts del evento', function () {
    const e = S.armarEvento({ llave: LL, estado: 'creado', ts: '2026-01-31T23:59:00.000Z' });
    igual(e.dia, '2026-01-31');
  });

  prueba('B06 sin ts se usa ahora, y el día cuadra con él', function () {
    const e = S.armarEvento({ llave: LL, estado: 'creado' });
    igual(e.dia, String(e.ts).slice(0, 10));
  });

  prueba('B07 el detalle se limpia: un evento es una línea del jsonl', function () {
    const e = S.armarEvento({ llave: LL, estado: 'rechazado', detalle: 'uno\ndos\ttres' });
    falso(/[\n\t]/.test(e.detalle), JSON.stringify(e.detalle));
  });

  /* ── escribir ────────────────────────────────────────────────────────── */

  pruebaAsync('B08 se escribe una línea en el archivo del mes del evento', async function () {
    const r = await S.registrar(ev('2026-11-12T10:00:00.000Z', 'intentando'));
    igual(r.ok, true, r.motivo);
    igual(ESCRITO.length, 1);
    igual(ESCRITO[0].ruta, 'pf/relocalizaciones/2026-11.jsonl');
    cierto(/\n$/.test(ESCRITO[0].bloque), 'tiene que cerrar con salto');
    igual(JSON.parse(ESCRITO[0].bloque).llave, LL);
  });

  pruebaAsync('B09 un evento sin llave NO se guarda: sería un registro que nadie puede leer', async function () {
    const r = await S.registrar({ estado: 'creado' });
    igual([r.ok, ESCRITO.length], [false, 0]);
    cierto(/llave/.test(r.motivo), r.motivo);
  });

  pruebaAsync('B10 eventos de meses distintos van a archivos distintos', async function () {
    await S.registrar(ev('2026-10-31T23:00:00.000Z', 'intentando'));
    await S.registrar(ev('2026-11-01T01:00:00.000Z', 'creado', { folio: 1 }));
    igual(ESCRITO.map(e => e.ruta),
          ['pf/relocalizaciones/2026-10.jsonl', 'pf/relocalizaciones/2026-11.jsonl']);
  });

  pruebaAsync('B11 si el blob falla, registrar NO lanza: avisa con el motivo', async function () {
    const T = compilar(FUENTE_ACTUAL, blobQueFalla());
    const r = await T.registrar(ev('2026-11-12T10:00:00.000Z', 'creado'));
    igual(r.ok, false);
    cierto(/AuthorizationFailure/.test(r.motivo), r.motivo);
  });

  /* ── leer y reducir ──────────────────────────────────────────────────── */

  pruebaAsync('B12 un mes que no existe se lee vacío', async function () {
    igual(await S.leerMes('2020-01'), []);
  });

  pruebaAsync('B13 una línea corrupta no bota el mes entero', async function () {
    LEER['pf/relocalizaciones/2026-11.jsonl'] =
      JSON.stringify(S.armarEvento(ev('2026-11-12T10:00:00.000Z', 'intentando'))) + '\n' +
      '{roto\n' +
      JSON.stringify(S.armarEvento(ev('2026-11-12T10:00:05.000Z', 'creado', { folio: 9 }))) + '\n';
    igual((await S.leerMes('2026-11')).length, 2);
  });

  prueba('B14 por llave gana el evento MÁS NUEVO', function () {
    const v = S.estadoVigente([
      S.armarEvento(ev('2026-11-12T10:00:00.000Z', 'intentando')),
      S.armarEvento(ev('2026-11-12T10:00:05.000Z', 'creado', { folio: 4150001 }))]);
    igual([v[LL].estado, v[LL].folio], ['creado', 4150001]);
  });

  prueba('B15 el orden del archivo NO manda: manda el ts', function () {
    // Dos funciones pueden escribir a la vez y el append no garantiza el orden.
    // Si mandara el orden del archivo, un "intentando" tardío borraría un
    // "creado" y la próxima llamada duplicaría el documento.
    const v = S.estadoVigente([
      S.armarEvento(ev('2026-11-12T10:00:05.000Z', 'creado', { folio: 4150001 })),
      S.armarEvento(ev('2026-11-12T10:00:00.000Z', 'intentando'))]);
    igual(v[LL].estado, 'creado', 'el viejo no puede pisar al nuevo');
  });

  prueba('B16 llaves distintas no se mezclan', function () {
    const v = S.estadoVigente([
      S.armarEvento(ev('2026-11-12T10:00:00.000Z', 'creado', { folio: 1 })),
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:01.000Z', 'rechazado'), { llave: '499|5|999' }))]);
    igual([v[LL].estado, v['499|5|999'].estado], ['creado', 'rechazado']);
  });

  prueba('B17 un evento sin llave no entra al reductor', function () {
    const v = S.estadoVigente([{ ts: '2026-11-12T10:00:00.000Z', estado: 'creado' }, null]);
    igual(Object.keys(v), []);
  });

  pruebaAsync('B18 leerEstado encuentra la llave mirando varios meses', async function () {
    const m = S.mesesRecientes('2026-11-12', S.MESES_ATRAS);
    LEER['pf/relocalizaciones/' + m[0] + '.jsonl'] =
      JSON.stringify(S.armarEvento(ev(m[0] + '-05T10:00:00.000Z', 'creado', { folio: 4140000 }))) + '\n';
    const e = await S.leerEstado(LL, '2026-11-12');
    igual(e && e.folio, 4140000, 'tiene que encontrarlo en el mes más viejo de la ventana');
  });

  pruebaAsync('B19 una llave que no existe devuelve null, no un estado inventado', async function () {
    igual(await S.leerEstado('no|existe|0', '2026-11-12'), null);
  });

  prueba('B20 los meses van del más viejo al más nuevo e incluyen el actual', function () {
    igual(S.mesesRecientes('2026-11-12', 3), ['2026-09', '2026-10', '2026-11']);
    igual(S.mesesRecientes('2026-01-15', 3), ['2025-11', '2025-12', '2026-01']);
  });

  /* ── lo que queda en el aire ─────────────────────────────────────────── */

  prueba('B21 enVilo trae los dos estados que significan "no sabemos"', function () {
    const v = S.estadoVigente([
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:00.000Z', 'intentando'), { llave: 'a' })),
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:01.000Z', 'en-duda'), { llave: 'b' })),
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:02.000Z', 'creado'), { llave: 'c' })),
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:03.000Z', 'rechazado'), { llave: 'd' }))]);
    igual(S.enVilo(v).map(x => x.llave).sort(), ['a', 'b']);
  });

  prueba('B22 enVilo sale del más nuevo al más viejo', function () {
    const v = S.estadoVigente([
      S.armarEvento(Object.assign(ev('2026-11-10T10:00:00.000Z', 'en-duda'), { llave: 'viejo' })),
      S.armarEvento(Object.assign(ev('2026-11-12T10:00:00.000Z', 'en-duda'), { llave: 'nuevo' }))]);
    igual(S.enVilo(v).map(x => x.llave), ['nuevo', 'viejo']);
  });

  prueba('B23 un 404 se distingue de un problema de permisos', function () {
    const e404 = new Error('x'); e404.statusCode = 404;
    cierto(S.esNoExiste(e404));
    cierto(S.esNoExiste(new Error('BlobNotFound')));
    falso(S.esNoExiste(new Error('AuthorizationFailure')), 'un 403 NO es "todavía no existe"');
  });

  for (const [n, fn] of pend) {
    ESCRITO = []; LEER = {};
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['Z01 un estado inventado se guarda tal cual',   /ESTADOS\.indexOf\(d\.estado\) >= 0 \? d\.estado : 'en-duda'/, 'd.estado'],
  ['Z02 un estado inventado se degrada a "creado"', /: 'en-duda',\n    folio: entero\(d\.folio\)/, ": 'creado',\n    folio: entero(d.folio)"],
  ['Z03 la huella se guarda aunque no sea objeto', /\(d\.huella && typeof d\.huella === 'object'\) \? d\.huella : null/, 'd.huella || null'],
  ['Z04 el día no sale del ts',                    /dia: String\(ts\)\.slice\(0, 10\)/, "dia: '2026-01-01'"],
  ['Z05 el detalle no se limpia',                  /return String\(v\)\.replace\(\/\[\\u0000-\\u001f\]\+\/g, ' '\)\.trim\(\)\.slice\(0, max \|\| 300\);/, 'return String(v);'],
  ['Z06 se guarda un evento sin llave',            /if \(!ev\.llave\) return \{ ok: false, motivo: 'el evento no trae llave' \};/, ''],
  ['Z07 todo va a un mismo archivo de mes',        /blobMes\(String\(ev\.ts\)\.slice\(0, 7\)\)/, "blobMes('2026-11')"],
  ['Z08 la línea se escribe sin salto final',      /const linea = JSON\.stringify\(ev\) \+ '\\n';/, 'const linea = JSON.stringify(ev);'],
  ['Z09 un fallo del blob lanza',                  /\} catch \(e\) \{\n    return \{ ok: false, motivo: \(e && e\.message\)/, '} catch (e) { throw e; return { ok: false, motivo: (e && e.message)'],
  ['Z10 una línea corrupta bota el mes',           /try \{ return JSON\.parse\(l\); \} catch \(e\) \{ return null; \}/, 'return JSON.parse(l);'],
  ['Z11 un 404 al leer el mes lanza',              /if \(esNoExiste\(e\)\) return \[\];/, ''],
  ['Z12 un 403 se trata como "no existe"',         /return !!e && \(e\.statusCode === 404/, 'return !!e && (true'],
  ['Z13 el reductor respeta el orden del archivo', /\.sort\(function \(a, b\) \{ return String\(a\.ts \|\| ''\)\.localeCompare\(String\(b\.ts \|\| ''\)\); \}\)\n/, ''],
  ['Z14 el reductor se queda con el más VIEJO',    /return String\(a\.ts \|\| ''\)\.localeCompare\(String\(b\.ts \|\| ''\)\); \}\)\n    \.forEach/, "return String(b.ts || '').localeCompare(String(a.ts || '')); })\n    .forEach"],
  ['Z15 el reductor acepta eventos sin llave',     /\.filter\(function \(e\) \{ return e && e\.llave; \}\)\n    /, ''],
  ['Z15b el filtro va después de ordenar',         /\.filter\(function \(e\) \{ return e && e\.llave; \}\)\n    \.sort\(function \(a, b\) \{ return String\(a\.ts \|\| ''\)\.localeCompare\(String\(b\.ts \|\| ''\)\); \}\)\n    \.forEach\(function \(e\) \{ out\[e\.llave\] = e; \}\);/, ".sort(function (a, b) { return String(a.ts || '').localeCompare(String(b.ts || '')); })\n    .filter(function (e) { return e && e.llave; })\n    .forEach(function (e) { out[e.llave] = e; });"],
  ['Z16 leerEstado mira un solo mes',              /for \(const m of mesesRecientes\(hoy, MESES_ATRAS\)\) ev = ev\.concat\(await traer\(m\)\);/, 'ev = await traer(mesesRecientes(hoy, MESES_ATRAS).pop());'],
  ['Z17 leerEstado inventa un estado si no hay',   /return vig\[llave\] \|\| null;/, "return vig[llave] || { estado: 'creado' };"],
  ['Z18 los meses salen del nuevo al viejo',       /return out\.reverse\(\);/, 'return out;'],
  ['Z19 el salto de año no baja el año',           /if \(m < 1\) \{ m = 12; y--; \}/, 'if (m < 1) { m = 12; }'],
  ['Z20 enVilo incluye los creados',               /ESTADOS_EN_VILO\.indexOf\(e\.estado\) >= 0/, 'true'],
  ['Z21 enVilo deja fuera los "intentando"',       /const ESTADOS_EN_VILO = \['intentando', 'en-duda'\];/, "const ESTADOS_EN_VILO = ['en-duda'];"],
  ['Z22 enVilo sale del más viejo primero',        /return String\(b\.ts \|\| ''\)\.localeCompare\(String\(a\.ts \|\| ''\)\); \}\);\n\}/, "return String(a.ts || '').localeCompare(String(b.ts || '')); });\n}"]
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(compilar(mutado), mutado); } catch (e) { muertas++; FUENTE_ACTUAL = FUENTE; continue; }
    FUENTE_ACTUAL = FUENTE;
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
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
