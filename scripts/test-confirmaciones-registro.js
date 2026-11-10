#!/usr/bin/env node
// ============================================================================
//  scripts/test-confirmaciones-registro.js
//
//  Pruebas de api/shared/confirmaciones-registro.js, con arnés de mutaciones.
//  Sin Blob: lo que se prueba es lo que decide, no lo que escribe.
//
//  Lo que protegen: el único lugar donde queda la CITA de Walmart. Redlink no
//  la guarda. Si una confirmación se registra mal, el informe al cliente sale
//  mal y no hay de dónde recuperarlo salvo volver a cruzar el .xlsx a mano.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'confirmaciones-registro.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

// El SDK de blob se puede sustituir por uno de mentira: sin eso, el camino de
// "el almacenamiento existe pero falla" no se prueba nunca, y ése es
// justamente el que no puede tumbar una confirmación ya escrita.
function compilar(fuente, blobFalso) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  // SIEMPRE un blob de mentira: así la suite corre sin tener instalado el SDK
  // de Azure, que es lo que uno quiere de una prueba — que no dependa de nada
  // que se pueda no haber instalado.
  const falso = blobFalso || blobQueGuarda();
  m.require = function (pedido) {
    return /storage-blob/.test(pedido) ? falso : propio(pedido);
  };
  m._compile(fuente, RUTA);
  return m.exports;
}

// Un BlobServiceClient que funciona y anota lo que se le escribió.
const ESCRITO = [];
function blobQueGuarda() {
  return {
    BlobServiceClient: {
      fromConnectionString: function () {
        return {
          getContainerClient: function (cont) {
            return {
              createIfNotExists: async function () {},
              getAppendBlobClient: function (ruta) {
                return {
                  createIfNotExists: async function () {},
                  appendBlock: async function (linea) { ESCRITO.push({ cont: cont, ruta: ruta, linea: linea }); }
                };
              },
              getBlobClient: function () {
                return { download: async function () {
                  const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; } };
              }
            };
          }
        };
      }
    }
  };
}

// Un BlobServiceClient que revienta en el momento que se le pida.
function blobQueFalla(donde) {
  const boom = () => { throw new Error('AuthorizationFailure: la cuenta no acepta la escritura'); };
  return {
    BlobServiceClient: {
      fromConnectionString: function () {
        return {
          getContainerClient: function () {
            return {
              createIfNotExists: async function () { if (donde === 'contenedor') boom(); },
              getAppendBlobClient: function () {
                return {
                  createIfNotExists: async function () { if (donde === 'crear') boom(); },
                  appendBlock: async function () { if (donde === 'append' || !donde) boom(); }
                };
              },
              getBlobClient: function () { return { download: async function () { boom(); } }; }
            };
          }
        };
      }
    }
  };
}

let ok = 0, fallos = [];
const pendientes = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pendientes.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const base = (c) => Object.assign({
  ts: '2026-11-10T14:30:00.000Z', folio: 4149330, docId: 692187, cantidad: 1,
  quien: 'mmejias@redtecsa.com',
  redlink: { cliente: 'INDUSTRIAS PRODUCTOS ALIMENTICIOS SA', destino: 'WALMART CHILE COMERCIAL S.A',
             bodega: 'ZWM11 CD WM EL PEÑON', despachado: 1, recepcion: 1,
             etapaAntes: 'Pendiente Adjuntar Respaldo', etapaDespues: 'Transferencia Confirmada',
             firma: 'M3LinkSystem' },
  reporte: { cita: '42759276', po: '2851158713', rut: '77643296-2', razonSocial: 'NUTRISCO CHILE S. A.',
             cd: 'WM El Peñón', servicio: 'Trans Diferenciada', recepcionWM: 1, aceptados: 1,
             rechazados: 0, cuando: '2026-11-06 10:49' }
}, c || {});

let FUENTE_ACTUAL = FUENTE;
async function correr(S, fuente) {
  FUENTE_ACTUAL = fuente || FUENTE;
  pendientes.length = 0;
  ok = 0; fallos = [];

  /* ---- la diferencia, que es el número del informe --------------------- */

  prueba('R01 sin diferencia cuando Walmart recibió todo', () => {
    const r = S.armarRegistro(base());
    igual([r.diferencia, r.clase], [0, 'sin-diferencia']);
  });
  prueba('R02 recibió menos: la diferencia es negativa', () => {
    const r = S.armarRegistro(base({ redlink: Object.assign({}, base().redlink, { despachado: 20, recepcion: 15 }) }));
    igual([r.diferencia, r.clase], [-5, 'recibio-menos']);
  });
  prueba('R03 recibió más: la diferencia es positiva', () => {
    const r = S.armarRegistro(base({ redlink: Object.assign({}, base().redlink, { despachado: 15, recepcion: 20 }) }));
    igual([r.diferencia, r.clase], [5, 'recibio-mas']);
  });
  prueba('R04 sin los dos números no se inventa una diferencia', () => {
    // Un cero sería una afirmación: "no hubo diferencia". Que falte un dato no
    // es lo mismo que que los números calcen.
    igual(S.diferenciaDe(null, 5), null);
    igual(S.diferenciaDe(5, null), null);
    igual(S.diferenciaDe('x', 5), null);
    igual(S.claseDe(null), 'sin-dato');
    const r = S.armarRegistro(base({ redlink: { despachado: null, recepcion: null } }));
    igual([r.diferencia, r.clase], [null, 'sin-dato']);
  });
  prueba('R05 la diferencia se CALCULA, no se recibe armada', () => {
    // Si viniera del navegador, el informe al cliente lo decidiría el navegador.
    const r = S.armarRegistro(base({ diferencia: 999, clase: 'sin-diferencia',
      redlink: Object.assign({}, base().redlink, { despachado: 20, recepcion: 15 }) }));
    igual([r.diferencia, r.clase], [-5, 'recibio-menos'], 'mandaron 999 y se ignora');
  });

  /* ---- los dos bloques, separados --------------------------------------- */

  prueba('R06 lo de Redlink y lo del reporte no se mezclan', () => {
    const r = S.armarRegistro(base());
    igual(r.redlink.cliente, 'INDUSTRIAS PRODUCTOS ALIMENTICIOS SA');
    igual(r.reporte.razonSocial, 'NUTRISCO CHILE S. A.');
    cierto(r.reporte.cita === '42759276', 'la cita sólo existe acá: Redlink no la guarda');
    falso('cita' in r.redlink, 'la cita NO puede figurar como dato de Redlink');
  });
  prueba('R07 el nombre del cliente prefiere la razón social del reporte', () => {
    // Es la que el cliente reconoce y la que va en el correo.
    igual(S.nombreCliente(S.armarRegistro(base())), 'NUTRISCO CHILE S. A.');
    // Si el reporte no la trajo, cae en la de Redlink en vez de quedar vacío.
    const sinRS = S.armarRegistro(base({ reporte: { cita: '1' } }));
    igual(S.nombreCliente(sinRS), 'INDUSTRIAS PRODUCTOS ALIMENTICIOS SA');
    igual(S.nombreCliente({}), '');
  });
  prueba('R08 lo que llega del navegador se acota', () => {
    const largo = 'x'.repeat(5000);
    const r = S.armarRegistro(base({ reporte: { cita: largo, razonSocial: { raro: 1 } } }));
    cierto(r.reporte.cita.length <= 120, 'quedó en ' + r.reporte.cita.length);
    igual(r.reporte.razonSocial, '', 'un objeto no entra como texto');
    igual(S.texto('a\u0000b\nc'), 'a b c', 'los caracteres de control se limpian');
    igual(S.texto(null), '');
  });
  prueba('R09 los números se guardan como números', () => {
    const r = S.armarRegistro(base({ cantidad: '7', reporte: Object.assign({}, base().reporte, { aceptados: '3' }) }));
    igual([r.cantidad, r.reporte.aceptados], [7, 3]);
    igual(S.entero('no'), null);
  });

  /* ---- el día, que es con el que se pinta el calendario ----------------- */

  prueba('R10 el día es el de la CONFIRMACIÓN, no el de la recepción', () => {
    // El calendario responde "qué se confirmó tal día". La recepción en el CD
    // puede ser de la semana pasada.
    const r = S.armarRegistro(base({ ts: '2026-11-10T23:50:00.000Z' }));
    igual(r.dia, '2026-11-10');
    cierto(r.reporte.cuando.indexOf('2026-11-06') === 0, 'y la del CD queda aparte');
  });
  prueba('R11 sin ts se pone la hora de ahora, no se deja vacío', () => {
    const r = S.armarRegistro({ folio: 1 });
    cierto(/^\d{4}-\d{2}-\d{2}$/.test(r.dia), r.dia);
    cierto(r.ts.length > 10);
  });

  /* ---- guardar nunca puede tumbar una confirmación ---------------------- */

  pruebaAsync('R12a con almacenamiento guarda una línea JSON por confirmación', async () => {
    const previo = process.env.CONFIRMACIONES_STORAGE_CONN;
    process.env.CONFIRMACIONES_STORAGE_CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net';
    try {
      ESCRITO.length = 0;
      const M = compilar(FUENTE_ACTUAL);
      const r = await M.registrar(base());
      igual(r.ok, true, r.motivo);
      igual(ESCRITO.length, 1);
      // El archivo es el del mes de la confirmación: así el informe semanal
      // sabe cuáles abrir sin leer todo el histórico.
      igual(ESCRITO[0].ruta, 'confirmaciones/2026-11.jsonl');
      cierto(ESCRITO[0].linea.endsWith('\n'), 'una línea por registro, terminada');
      const guardado = JSON.parse(ESCRITO[0].linea);
      igual([guardado.folio, guardado.reporte.cita, guardado.clase], [4149330, '42759276', 'sin-diferencia']);
    } finally {
      if (previo === undefined) delete process.env.CONFIRMACIONES_STORAGE_CONN;
      else process.env.CONFIRMACIONES_STORAGE_CONN = previo;
    }
  });
  pruebaAsync('R12b si el blob FALLA tampoco lanza, y dice por qué', async () => {
    // El caso que de verdad va a pasar algún día: la cuenta existe, la
    // conexión está, y la escritura se cae. La confirmación ya movió
    // inventario en SAP; reportar "falló" haría que alguien la reintente.
    const previo = process.env.CONFIRMACIONES_STORAGE_CONN;
    process.env.CONFIRMACIONES_STORAGE_CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net';
    try {
      for (const donde of ['contenedor', 'crear', 'append']) {
        const M = compilar(FUENTE_ACTUAL, blobQueFalla(donde));
        const r = await M.registrar(base());
        igual(r.ok, false, 'fallando en ' + donde);
        cierto(/AuthorizationFailure/.test(r.motivo), 'tiene que decir qué falló: ' + r.motivo);
        igual(r.registro.folio, 4149330, 'y devolver el registro igual');
      }
    } finally {
      if (previo === undefined) delete process.env.CONFIRMACIONES_STORAGE_CONN;
      else process.env.CONFIRMACIONES_STORAGE_CONN = previo;
    }
  });
  pruebaAsync('R12 sin almacenamiento NO lanza: la confirmación ya ocurrió', async () => {
    // Cuando esto corre, la escritura en Redlink ya movió inventario en SAP.
    // Lanzar haría que alguien la reintente, que es lo peor que puede pasar.
    const r = await S.registrar(base());
    igual(r.ok, false);
    cierto(/almacenamiento/.test(r.motivo), r.motivo);
    cierto(!!r.registro, 'igual devuelve el registro armado, para poder mostrarlo');
    igual(r.registro.folio, 4149330);
  });

  /* ---- el rango y los meses -------------------------------------------- */

  prueba('R13 un rango que cruza el cambio de mes toca los dos archivos', () => {
    igual(S.mesesDe('2026-10-28', '2026-11-03'), ['2026-10', '2026-11']);
    igual(S.mesesDe('2026-11-03', '2026-11-09'), ['2026-11']);
    igual(S.mesesDe('2025-12-30', '2026-01-02'), ['2025-12', '2026-01'], 'y el cambio de año');
  });
  prueba('R14 un rango al revés o inválido no devuelve meses', () => {
    igual(S.mesesDe('2026-11-09', '2026-11-03'), []);
    igual(S.mesesDe('', ''), []);
    igual(S.mesesDe('basura', '2026-11-03'), []);
  });
  pruebaAsync('R15 el rango filtra por día: el blob es por mes', async () => {
    const mes = [
      { dia: '2026-11-01', ts: '2026-11-01T10:00:00Z', folio: 1 },
      { dia: '2026-11-05', ts: '2026-11-05T10:00:00Z', folio: 2 },
      { dia: '2026-11-20', ts: '2026-11-20T10:00:00Z', folio: 3 }
    ];
    const r = await S.leerRango('2026-11-03', '2026-11-09', async () => mes);
    igual(r.map(x => x.folio), [2], 'sólo el que cae dentro');
  });
  pruebaAsync('R16 el rango ordena por hora, no por el orden del archivo', async () => {
    // Dos navegadores escriben en el mismo blob: el append no garantiza orden.
    const mes = [
      { dia: '2026-11-05', ts: '2026-11-05T18:00:00Z', folio: 2 },
      { dia: '2026-11-05', ts: '2026-11-05T09:00:00Z', folio: 1 }
    ];
    const r = await S.leerRango('2026-11-01', '2026-11-30', async () => mes);
    igual(r.map(x => x.folio), [1, 2]);
  });

  /* ---- las agregaciones que alimentan la página ------------------------- */

  const reg = (dia, clase, cantidad, cliente, dif) => ({
    dia: dia, ts: dia + 'T10:00:00Z', clase: clase, cantidad: cantidad, diferencia: dif === undefined ? 0 : dif,
    reporte: { razonSocial: cliente, rut: '1-9' }, redlink: { cliente: cliente }
  });

  prueba('R17 el calendario cuenta y desglosa cada día', () => {
    const d = S.porDia([
      reg('2026-11-10', 'sin-diferencia', 10, 'A'),
      reg('2026-11-10', 'recibio-menos', 5, 'B', -3),
      reg('2026-11-10', 'recibio-mas', 7, 'A', 2),
      reg('2026-11-11', 'sin-diferencia', 4, 'A')
    ]);
    igual(d.length, 2);
    igual([d[0].dia, d[0].n, d[0].pallets], ['2026-11-10', 3, 22]);
    igual([d[0].sinDiferencia, d[0].recibioMenos, d[0].recibioMas], [1, 1, 1]);
    igual(d[0].clientes, 2, 'cuenta clientes distintos, no filas');
  });
  prueba('R18 los días salen ordenados', () => {
    const d = S.porDia([reg('2026-11-11', 'sin-diferencia', 1, 'A'), reg('2026-11-02', 'sin-diferencia', 1, 'A')]);
    igual(d.map(x => x.dia), ['2026-11-02', '2026-11-11']);
  });
  prueba('R19 una fila sin día no entra al calendario', () => {
    igual(S.porDia([{ clase: 'sin-diferencia', cantidad: 1 }]).length, 0);
    igual(S.porDia(null).length, 0);
  });
  prueba('R20 por cliente: el que tiene más diferencias va primero', () => {
    // Es el que hay que mirar. Y tiene que ganar aunque tenga MENOS filas y
    // vaya después alfabéticamente: si no, el orden lo decide otra cosa y el
    // cliente con problemas queda abajo justo cuando importa.
    const c = S.porCliente([
      reg('2026-11-10', 'sin-diferencia', 10, 'AAA TRANQUILO'),
      reg('2026-11-10', 'sin-diferencia', 10, 'AAA TRANQUILO'),
      reg('2026-11-10', 'sin-diferencia', 10, 'AAA TRANQUILO'),
      reg('2026-11-10', 'recibio-menos', 5, 'ZZZ CON PROBLEMAS', -3),
      reg('2026-11-10', 'recibio-mas', 5, 'ZZZ CON PROBLEMAS', 2)
    ]);
    igual(c[0].cliente, 'ZZZ CON PROBLEMAS', 'dos filas con diferencia ganan a tres sin ella');
    igual([c[0].recibioMenos, c[0].recibioMas, c[0].n], [1, 1, 2]);
    igual(c[0].palletsDiferencia, 5, 'los pallets en juego, en valor absoluto');
    igual([c[1].cliente, c[1].sinDiferencia], ['AAA TRANQUILO', 3]);
  });
  prueba('R21 por cliente guarda las filas para el detalle', () => {
    const c = S.porCliente([reg('2026-11-10', 'sin-diferencia', 10, 'A')]);
    igual(c[0].filas.length, 1);
    igual(c[0].rut, '1-9');
  });
  prueba('R22 sin cliente no se pierde la fila: se agrupa aparte', () => {
    const c = S.porCliente([{ dia: '2026-11-10', clase: 'sin-diferencia', cantidad: 3 }]);
    igual(c.length, 1);
    igual(c[0].cliente, '(sin cliente)');
    igual(c[0].pallets, 3);
  });

  for (const [n, fn] of pendientes.slice()) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['N01 la diferencia se lee al revés',          /return r - d;/, 'return d - r;'],
  ['N02 un dato faltante se cuenta como cero',   /if \(d === null \|\| r === null\) return null;/, 'if (false) return null;'],
  ['N03 recibir menos y más son lo mismo',       /return dif < 0 \? 'recibio-menos' : 'recibio-mas';/, "return 'recibio-menos';"],
  ['N04 sin dato se canta como sin diferencia',  /if \(dif === null\) return 'sin-dato';/, ''],
  ['N05 la diferencia se recibe del navegador',  /diferencia: dif,\n    clase: claseDe\(dif\)/, 'diferencia: d.diferencia, clase: d.clase'],
  ['N06 el texto del navegador no se acota',     /\.slice\(0, LARGO\)/, ''],
  ['N07 un objeto entra como texto',             /if \(typeof v === 'object'\) return '';/, ''],
  ['N08 los caracteres de control pasan',        /\.replace\(\/\[\\u0000-\\u001f\]\+\/g, ' '\)/, ''],
  ['N09 el día sale de la recepción y no de la confirmación', /dia: diaDe\(ts\)/, 'dia: diaDe((d.reporte || {}).cuando)'],
  ['N10 sin ts el registro queda sin fecha',     /const ts = d\.ts \|\| new Date\(\)\.toISOString\(\);/, 'const ts = d.ts;'],
  ['N11 guardar sin almacenamiento LANZA',       /return \{ ok: false, registro: ev,\n             motivo: 'no hay almacenamiento/, "throw new Error('sin almacenamiento'); return { ok: false, registro: ev,\n             motivo: 'no hay almacenamiento"],
  ['N12 un fallo del blob tumba la confirmación', /catch \(e\) \{\n    return \{ ok: false, registro: ev, motivo:/, 'catch (e) { throw e; return { ok: false, registro: ev, motivo:'],
  ['N13 el registro no vuelve cuando falla',     /return \{ ok: false, registro: ev,\n             motivo: 'no hay almacenamiento/, "return { ok: false, registro: null,\n             motivo: 'no hay almacenamiento"],
  ['N14 un rango de dos meses lee uno solo',     /if \(act >= b\) break;/, 'break;'],
  ['N15 un rango al revés devuelve meses igual', /\|\| d2 < d1\) return \[\];/, ') return [];'],
  ['N15b el rango no valida el formato de las fechas', /if \(!RE_DIA\.test\(d1\) \|\| !RE_DIA\.test\(d2\)/, 'if (false'],
  ['N16 el rango no filtra por día',             /return d >= desde && d <= hasta;/, 'return true;'],
  ['N17 el rango no ordena por hora',            /\.sort\(function \(a, b\) \{ return String\(a\.ts \|\| ''\)\.localeCompare\(String\(b\.ts \|\| ''\)\); \}\)/, ''],
  ['N18 el calendario no desglosa',              /if \(r\.clase === 'sin-diferencia'\) x\.sinDiferencia\+\+;/, 'if (false) x.sinDiferencia++;'],
  ['N19 el calendario no suma pallets',          /x\.pallets \+= entero\(r\.cantidad\) \|\| 0;\n    if \(r\.clase === 'sin-diferencia'\) x\.sinDiferencia\+\+;/, "x.pallets += 0;\n    if (r.clase === 'sin-diferencia') x.sinDiferencia++;"],
  ['N20 el calendario cuenta filas y no clientes', /clientes: Object\.keys\(x\.clientes\)\.length/, 'clientes: x.n'],
  ['N21 una fila sin día entra al calendario',   /if \(!d\) return;/, ''],
  ['N22 los días salen desordenados',            /Object\.keys\(ix\)\.sort\(\)\.map/, 'Object.keys(ix).map'],
  ['N23 el cliente ignora la razón social del reporte', /return texto\(rp\.razonSocial\) \|\| texto\(rl\.cliente\) \|\| '';/, "return texto(rl.cliente) || '';"],
  ['N24 el orden por cliente esconde las diferencias', /return \(b\.recibioMenos \+ b\.recibioMas\) - \(a\.recibioMenos \+ a\.recibioMas\)/, 'return 0 * (b.recibioMenos + b.recibioMas) - 0 * (a.recibioMenos + a.recibioMas)'],
  ['N25 los pallets en juego no se suman',       /x\.palletsDiferencia \+= Math\.abs\(r\.diferencia \|\| 0\); \}\n    else if \(r\.clase === 'recibio-mas'\)/, "x.palletsDiferencia += 0; }\n    else if (r.clase === 'recibio-mas')"],
  ['N26 las filas sin cliente se pierden',       /const c = nombreCliente\(r\) \|\| '\(sin cliente\)';/, 'const c = nombreCliente(r); if (!c) return;'],
  ['N27 el detalle por cliente no guarda las filas', /x\.filas\.push\(r\);/, ''],
  ['N28 el archivo del mes sale del mes equivocado', /blobMes\(String\(ev\.ts\)\.slice\(0, 7\)\)/, "blobMes('2000-01')"],
  ['N29 las líneas se pegan sin separador',          /const linea = JSON\.stringify\(ev\) \+ '\\n';/, 'const linea = JSON.stringify(ev);']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(compilar(mutado), mutado); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  const S = compilar(FUENTE);
  const r = await correr(S);
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
