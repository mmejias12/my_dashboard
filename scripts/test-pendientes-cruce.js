#!/usr/bin/env node
// ============================================================================
//  scripts/test-pendientes-cruce.js
//
//  Pruebas de api/shared/pendientes-cruce.js, con arnés de mutaciones.
//  Sin Blob: lo que se prueba es el reductor, que es donde vive la verdad.
//
//  Lo que protegen: la única lista de citas que Walmart declara recibidas y
//  que no tienen transferencia. El archivo de mañana ya no las trae, así que
//  si se pierden acá no hay de dónde recuperarlas.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'pendientes-cruce.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

const ESCRITO = [];
function blobQueGuarda() {
  return { BlobServiceClient: { fromConnectionString: function () {
    return { getContainerClient: function () {
      return {
        createIfNotExists: async function () {},
        getAppendBlobClient: function (ruta) {
          return { createIfNotExists: async function () {},
                   appendBlock: async function (b) { ESCRITO.push({ ruta: ruta, bloque: b }); } };
        },
        getBlobClient: function () { return { download: async function () {
          const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; } }; }
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

const ev = (dia, accion, cita, extra) => Object.assign({
  ts: dia + 'T10:00:00.000Z', dia: dia, accion: accion, cita: cita,
  rut: '77643296-2', cliente: 'NUTRISCO CHILE S. A.', pallets: 15, fechaReporte: dia, filas: []
}, extra || {});

let FUENTE_ACTUAL = FUENTE;
async function correr(S, fuente) {
  FUENTE_ACTUAL = fuente || FUENTE;
  pendientes.length = 0;
  ok = 0; fallos = [];

  /* ---- el reductor ------------------------------------------------------ */

  prueba('P01 una cita vista queda abierta, con sus días', () => {
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276')], '2026-11-10');
    igual(e.length, 1);
    igual([e[0].estado, e[0].desde, e[0].dias, e[0].visto], ['abierta', '2026-11-01', 9, 1]);
  });
  prueba('P02 verla otra vez no la duplica: la cuenta', () => {
    // El mismo archivo llega casi todos los días con las mismas citas. Si cada
    // vista creara una fila, la lista se volvería ilegible en una semana.
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276'),
                               ev('2026-11-02', 'vista', '42759276'),
                               ev('2026-11-03', 'vista', '42759276')], '2026-11-10');
    igual(e.length, 1);
    igual([e[0].visto, e[0].desde, e[0].ultimaVez], [3, '2026-11-01', '2026-11-03']);
  });
  prueba('P03 los datos del reporte más reciente ganan', () => {
    // Walmart corrige cantidades de un día para otro: el informe tiene que
    // decir la última, no la primera.
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276', { pallets: 15 }),
                               ev('2026-11-05', 'vista', '42759276', { pallets: 12 })], '2026-11-10');
    igual(e[0].pallets, 12);
  });
  prueba('P04 cuando por fin cruza, deja de estar abierta', () => {
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276'),
                               ev('2026-11-04', 'cruzo', '42759276', { folio: 4149330 })], '2026-11-10');
    igual([e[0].estado, e[0].folio, e[0].resueltaEl], ['cruzo', 4149330, '2026-11-04']);
    igual(S.abiertas(e).length, 0);
  });
  prueba('P05 cerrarla a mano también la saca', () => {
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276'),
                               ev('2026-11-04', 'cerrada', '42759276', { motivo: 'Walmart la anuló' })], '2026-11-10');
    igual(e[0].estado, 'cerrada');
    igual(e[0].motivo, 'Walmart la anuló');
    igual(S.abiertas(e).length, 0);
  });
  prueba('P06 si vuelve a aparecer después de cruzar, se reabre', () => {
    // Pasa: se confirma, Walmart la vuelve a mandar, y el cruce la encuentra
    // otra vez sin transferencia. El estado es el ÚLTIMO, no el primero.
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276'),
                               ev('2026-11-04', 'cruzo', '42759276', { folio: 1 }),
                               ev('2026-11-06', 'vista', '42759276')], '2026-11-10');
    igual(e[0].estado, 'abierta');
  });
  prueba('P07 el orden es por hora, no por el orden del archivo', () => {
    // Dos personas cruzando en dos computadores escriben en el mismo blob.
    const e = S.estadoVigente([ev('2026-11-06', 'cruzo', '42759276', { folio: 9 }),
                               ev('2026-11-01', 'vista', '42759276')], '2026-11-10');
    igual(e[0].estado, 'cruzo', 'el cruce es posterior aunque venga primero en el archivo');
  });
  prueba('P08 a los 7 días pasa a urgente, antes no', () => {
    const a = S.estadoVigente([ev('2026-11-04', 'vista', '42759276')], '2026-11-10');
    const b = S.estadoVigente([ev('2026-11-03', 'vista', '42759276')], '2026-11-10');
    igual([a[0].dias, a[0].urgente], [6, false]);
    igual([b[0].dias, b[0].urgente], [7, true]);
    igual(S.DIAS_PARA_PREGUNTAR, 7);
  });
  prueba('P09 una cerrada nunca es urgente, por vieja que sea', () => {
    const e = S.estadoVigente([ev('2026-01-01', 'vista', '42759276'),
                               ev('2026-01-02', 'cerrada', '42759276')], '2026-11-10');
    falso(e[0].urgente, 'ya está resuelta: no hay nada que preguntar');
  });
  prueba('P10 lo que no es una cita de ocho dígitos no entra', () => {
    // El campo es libre en el reporte y trae rangos, puntos y texto.
    ['4275', '42759276-42759277', '', 'basura', null].forEach(function (c) {
      igual(S.estadoVigente([ev('2026-11-01', 'vista', c)], '2026-11-10').length, 0, 'entró ' + c);
    });
    igual(S.estadoVigente([ev('2026-11-01', 'vista', '42759276')], '2026-11-10').length, 1);
  });
  prueba('P11 días negativos no existen', () => {
    // Un evento con fecha futura no puede dar una antigüedad negativa.
    const e = S.estadoVigente([ev('2026-12-01', 'vista', '42759276')], '2026-11-10');
    igual(e[0].dias, 0);
    igual(S.diasEntre('2026-11-10', '2026-11-03'), 0);
    igual(S.diasEntre('basura', '2026-11-03'), 0);
  });

  /* ---- por cliente, que es la salida que pidió logística ---------------- */

  prueba('P12 agrupa por cliente y el de más pallets va primero', () => {
    // Es plata: pallets en un CD sin transferencia que los respalde. Y tiene
    // que ganar por PALLETS aunque el otro tenga más citas vencidas, o el
    // orden lo estaría decidiendo otra cosa.
    const e = S.estadoVigente([
      ev('2026-11-01', 'vista', '42759270', { cliente: 'CHICO', pallets: 1 }),
      ev('2026-11-01', 'vista', '42759271', { cliente: 'CHICO', pallets: 1 }),
      ev('2026-11-01', 'vista', '42759272', { cliente: 'CHICO', pallets: 1 }),
      ev('2026-11-09', 'vista', '42759277', { cliente: 'GRANDE', pallets: 25 }),
      ev('2026-11-05', 'vista', '42759278', { cliente: 'GRANDE', pallets: 13 })
    ], '2026-11-10');
    const c = S.porCliente(e);
    igual(c.map(x => x.cliente), ['GRANDE', 'CHICO'], '38 pallets pesan más que 3 citas vencidas');
    igual([c[0].citas, c[0].pallets, c[0].urgentes], [2, 38, 0]);
    igual(c[1].urgentes, 3);
    // La más vieja del grupo, aunque se procese después que una más nueva.
    igual(c[0].masVieja, '2026-11-05', 'tiene que quedar la más vieja del cliente');
  });
  prueba('P13 por cliente sólo cuenta las abiertas', () => {
    const e = S.estadoVigente([
      ev('2026-11-01', 'vista', '42759276', { cliente: 'A', pallets: 10 }),
      ev('2026-11-02', 'cruzo', '42759276', { cliente: 'A', folio: 1 }),
      ev('2026-11-01', 'vista', '42759277', { cliente: 'A', pallets: 4 })
    ], '2026-11-10');
    const c = S.porCliente(e);
    igual([c[0].citas, c[0].pallets], [1, 4], 'la que cruzó ya no está en juego');
  });
  prueba('P14 cuenta cuántas de cada cliente ya pasaron los 7 días', () => {
    const e = S.estadoVigente([
      ev('2026-11-01', 'vista', '42759276', { cliente: 'A', pallets: 1 }),
      ev('2026-11-09', 'vista', '42759277', { cliente: 'A', pallets: 1 })
    ], '2026-11-10');
    igual(S.porCliente(e)[0].urgentes, 1);
  });
  prueba('P15 sin cliente no se pierde: se agrupa aparte', () => {
    const e = S.estadoVigente([ev('2026-11-01', 'vista', '42759276', { cliente: '' })], '2026-11-10');
    igual(S.porCliente(e)[0].cliente, '(sin cliente)');
  });

  /* ---- lo que llega del navegador --------------------------------------- */

  prueba('P16 las filas del reporte se guardan acotadas', () => {
    // Se guardan para poder volver a cruzarlas con el MISMO cruzar(). Pero el
    // .xlsx trae dieciocho columnas y no todas tienen por qué entrar.
    const e = S.armarEvento({ cita: '42759276', filas: [{ cita: '42759276', total: '15', canje: 15,
      malos: 0, rut: '1-9', cliente: 'X', cd: '6009', recepcion: '406507', fecha: '2026-11-09',
      inventado: 'no', basura: { a: 1 } }] });
    const f = e.filas[0];
    igual(Object.keys(f).sort(), S.CAMPOS_FILA.concat(['total', 'malos', 'canje']).sort());
    igual([f.total, f.canje], [15, 15], 'los números quedan como números');
    falso('inventado' in f, 'una columna que no está en la lista no entra');
  });
  prueba('P17 una acción inventada cae en vista, no rompe', () => {
    igual(S.armarEvento({ cita: '42759276', accion: 'borrar' }).accion, 'vista');
    igual(S.armarEvento({ cita: '42759276', accion: 'cruzo' }).accion, 'cruzo');
  });
  prueba('P18 el texto del navegador se acota y se limpia', () => {
    const e = S.armarEvento({ cita: '42759276', cliente: 'x'.repeat(900), motivo: { raro: 1 } });
    cierto(e.cliente.length <= 120, 'quedó en ' + e.cliente.length);
    igual(e.motivo, '');
    igual(S.texto('a\u0000b'), 'a b');
  });
  prueba('P19 no se guardan cuarenta mil filas por cita', () => {
    const muchas = [];
    for (let i = 0; i < 500; i++) muchas.push({ cita: '42759276', total: 1 });
    igual(S.armarEvento({ cita: '42759276', filas: muchas }).filas.length, 40);
  });

  /* ---- escribir y leer --------------------------------------------------- */

  pruebaAsync('P20 escribe una línea por evento, en el archivo del mes', async () => {
    const previo = process.env.PENDIENTES_STORAGE_CONN;
    process.env.PENDIENTES_STORAGE_CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;';
    try {
      ESCRITO.length = 0;
      const M = compilar(FUENTE_ACTUAL);
      const r = await M.registrar([ev('2026-11-01', 'vista', '42759276'),
                                   ev('2026-11-02', 'vista', '42759277')]);
      igual([r.ok, r.escritos], [true, 2]);
      igual(ESCRITO.length, 1, 'los del mismo mes van en un solo append');
      igual(ESCRITO[0].ruta, 'pendientes/2026-11.jsonl');
      igual(ESCRITO[0].bloque.split('\n').filter(Boolean).length, 2);
    } finally {
      if (previo === undefined) delete process.env.PENDIENTES_STORAGE_CONN;
      else process.env.PENDIENTES_STORAGE_CONN = previo;
    }
  });
  pruebaAsync('P21 eventos de meses distintos van a archivos distintos', async () => {
    const previo = process.env.PENDIENTES_STORAGE_CONN;
    process.env.PENDIENTES_STORAGE_CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;';
    try {
      ESCRITO.length = 0;
      const M = compilar(FUENTE_ACTUAL);
      await M.registrar([ev('2026-10-31', 'vista', '42759276'), ev('2026-11-01', 'vista', '42759277')]);
      igual(ESCRITO.map(x => x.ruta).sort(), ['pendientes/2026-10.jsonl', 'pendientes/2026-11.jsonl']);
    } finally {
      if (previo === undefined) delete process.env.PENDIENTES_STORAGE_CONN;
      else process.env.PENDIENTES_STORAGE_CONN = previo;
    }
  });
  pruebaAsync('P22 si el blob falla NO lanza: el cruce ya se mostró', async () => {
    const previo = process.env.PENDIENTES_STORAGE_CONN;
    process.env.PENDIENTES_STORAGE_CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;';
    try {
      const M = compilar(FUENTE_ACTUAL, blobQueFalla());
      const r = await M.registrar([ev('2026-11-01', 'vista', '42759276')]);
      igual(r.ok, false);
      cierto(/AuthorizationFailure/.test(r.motivo), r.motivo);
    } finally {
      if (previo === undefined) delete process.env.PENDIENTES_STORAGE_CONN;
      else process.env.PENDIENTES_STORAGE_CONN = previo;
    }
  });
  pruebaAsync('P23 sin nada que escribir no se toca el blob', async () => {
    ESCRITO.length = 0;
    const r = await S.registrar([]);
    igual([r.ok, r.escritos], [true, 0]);
    igual(ESCRITO.length, 0);
    const r2 = await S.registrar([{ cita: 'basura' }]);
    igual(r2.escritos, 0, 'una cita inválida no justifica una escritura');
  });
  pruebaAsync('P24 el estado se arma leyendo varios meses hacia atrás', async () => {
    const pedidos = [];
    const e = await S.leerEstado('2026-11-10', async function (mes) {
      pedidos.push(mes);
      return mes === '2026-09' ? [ev('2026-09-20', 'vista', '42759276')] : [];
    });
    igual(pedidos.length, S.MESES_ATRAS);
    igual(pedidos[pedidos.length - 1], '2026-11', 'el último es el mes corriente');
    igual(e.length, 1, 'una cita de hace dos meses sigue apareciendo');
    cierto(e[0].urgente);
  });
  prueba('P25 los meses se piden del más viejo al más nuevo', () => {
    const m = S.mesesRecientes('2026-01-15', 3);
    igual(m, ['2025-11', '2025-12', '2026-01'], 'y cruzando el año');
  });

  for (const [n, fn] of pendientes.slice()) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['Q01 cada vista crea una fila nueva',        /if \(!ix\[c\]\) \{/, 'if (true) {'],
  ['Q02 no se cuentan las veces vista',         /x\.visto\+\+;/, ''],
  ['Q03 gana el primer reporte y no el último', /if \(e\.pallets\) x\.pallets = e\.pallets;/, ''],
  ['Q04 cruzar no la saca de la lista',         /x\.estado = 'cruzo';/, "x.estado = 'abierta';"],
  ['Q05 cerrarla no la saca',                   /x\.estado = 'cerrada';/, "x.estado = 'abierta';"],
  ['Q06 una que reaparece no se reabre',        /x\.visto\+\+;\n      x\.estado = 'abierta';/, 'x.visto++;'],
  ['Q07 el orden no es por hora',               /\.sort\(function \(a, b\) \{ return String\(a\.ts \|\| ''\)\.localeCompare\(String\(b\.ts \|\| ''\)\); \}\)/, ''],
  ['Q08 el umbral de urgencia se va a 30 días', /parseInt\(process\.env\.PENDIENTES_DIAS \|\| '7', 10\) \|\| 7/, "parseInt(process.env.PENDIENTES_DIAS || '30', 10) || 30"],
  ['Q09 urgente se marca un día antes',         /x\.dias >= DIAS_PARA_PREGUNTAR/, 'x.dias >= DIAS_PARA_PREGUNTAR - 1'],
  ['Q10 una cerrada también se marca urgente',  /x\.urgente = x\.estado === 'abierta' && x\.dias >= DIAS_PARA_PREGUNTAR;/, 'x.urgente = x.dias >= DIAS_PARA_PREGUNTAR;'],
  ['Q11 cualquier cosa entra como cita',        /\.filter\(function \(e\) \{ return e && esCita\(e\.cita\); \}\)/, '.filter(function (e) { return !!e; })'],
  ['Q12 una cita de cualquier largo vale',      /const esCita = \(v\) => \/\^\\d\{8\}\$\/\.test/, 'const esCita = (v) => /^\\d+$/.test'],
  ['Q13 los días pueden salir negativos',       /return d < 0 \? 0 : d;/, 'return d;'],
  ['Q14 por cliente incluye las resueltas',     /abiertas\(estados\)\.forEach/, '(estados || []).forEach'],
  ['Q15 por cliente no suma pallets',           /x\.pallets \+= e\.pallets \|\| 0;/, ''],
  ['Q16 el orden por cliente ignora los pallets', /return b\.pallets - a\.pallets \|\| b\.urgentes - a\.urgentes/, 'return 0 * (b.pallets - a.pallets) || b.urgentes - a.urgentes'],
  ['Q17 no se cuentan las urgentes por cliente', /if \(e\.urgente\) x\.urgentes\+\+;/, ''],
  ['Q18 la cita más vieja se pierde',           /if \(e\.desde < x\.masVieja\) x\.masVieja = e\.desde;/, ''],
  ['Q19 las filas del reporte no se acotan',    /CAMPOS_FILA\.forEach\(function \(k\) \{ out\[k\] = texto\(\(f \|\| \{\}\)\[k\]\); \}\);/, 'Object.keys(f || {}).forEach(function (k) { out[k] = (f || {})[k]; });'],
  ['Q20 se guardan todas las filas que manden', /\.slice\(0, 40\)/, ''],
  ['Q21 una acción inventada se guarda tal cual', /ACCIONES\.indexOf\(e\.accion\) >= 0 \? e\.accion : 'vista'/, 'e.accion'],
  ['Q22 se escribe aunque no haya nada válido', /if \(!evs\.length\) return \{ ok: true, escritos: 0, motivo: '' \};/, ''],
  ['Q23 los eventos de meses distintos van al mismo archivo', /const m = String\(e\.ts\)\.slice\(0, 7\);/, "const m = '2026-11';"],
  ['Q24 las líneas se pegan sin separador',     /const bloque = porMes\[m\]\.join\('\\n'\) \+ '\\n';/, "const bloque = porMes[m].join('');"],
  ['Q25 un fallo del blob lanza',               /catch \(e\) \{\n    return \{ ok: false, escritos: 0, motivo:/, 'catch (e) { throw e; return { ok: false, escritos: 0, motivo:'],
  ['Q26 el estado lee un solo mes',             /for \(const m of mesesRecientes\(hoy, MESES_ATRAS\)\) ev = ev\.concat\(await traer\(m\)\);/, 'ev = await traer(mesesRecientes(hoy, 1)[0]);'],
  ['Q27 los meses salen del más nuevo al más viejo', /return out\.reverse\(\);/, 'return out;']
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
