#!/usr/bin/env node
// ============================================================================
//  scripts/test-walmart-nucleo.js
//
//  Pruebas de data/walmart-nucleo.js, con arnes de mutaciones.
//
//  Este nucleo lo usan DOS consumidores: la vista del navegador y los scripts
//  de Node. Lo que produce es la lista de folios con la cantidad que se va a
//  confirmar en Redlink, y una confirmacion mueve inventario en SAP. Una fila
//  de mas no es un informe mal armado: es un ajuste que no correspondia.
//
//  Por eso las pruebas no usan archivos de ejemplo que puedan faltar: el .xlsx
//  se construye aca mismo, byte a byte, para poder probar hasta el caso del
//  encabezado local con largo de extra distinto al del directorio central
//  (el error clasico al leer un ZIP, que corre el dato unos bytes sin avisar).
//
//    node scripts/test-walmart-nucleo.js
//    node scripts/test-walmart-nucleo.js --mutaciones
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'data', 'walmart-nucleo.js');

function cargar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
async function prueba(n, fn) {
  try { await fn(); ok++; }
  catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
}
function igual(a, b, m) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x);
}
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }
function revienta(fn, re, m) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error((m || '') + ' esperaba que reventara y no revento');
  if (re && !re.test(String(e.message))) throw new Error((m || '') + ' revento con "' + e.message + '"');
}
async function revientaAsync(fn, re, m) {
  let e = null;
  try { await fn(); } catch (x) { e = x; }
  if (!e) throw new Error((m || '') + ' esperaba que reventara y no revento');
  if (re && !re.test(String(e.message))) throw new Error((m || '') + ' revento con "' + e.message + '"');
}

/* ======================================================================== */
/*  Un .xlsx de verdad, armado aca                                          */
/* ======================================================================== */

const crc32 = typeof zlib.crc32 === 'function' ? (b) => zlib.crc32(b) : () => 0;

// EXTRA_LOCAL distinto de cero es a proposito: el directorio central declara
// extra 0 y el encabezado local declara 7. Un lector que salte el encabezado
// con los largos del directorio queda 7 bytes corrido.
const EXTRA_LOCAL = 7;

function zipDe(archivos) {
  const partes = [], central = [];
  let off = 0;
  archivos.forEach(function (a) {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const crudo = Buffer.from(a.texto, 'utf8');
    const comprimir = a.comprimir !== false;
    const metodo = comprimir ? 8 : 0;
    const dato = comprimir ? zlib.deflateRawSync(crudo) : crudo;
    const extra = Buffer.alloc(EXTRA_LOCAL, 0x41);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(metodo, 8);
    lh.writeUInt32LE(crc32(crudo) >>> 0, 14);
    lh.writeUInt32LE(dato.length, 18);
    lh.writeUInt32LE(crudo.length, 22);
    lh.writeUInt16LE(nombre.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    central.push({ nombre: nombre, metodo: metodo, crc: crc32(crudo) >>> 0,
                   comp: dato.length, sin: crudo.length, inicio: off });
    partes.push(lh, nombre, extra, dato);
    off += 30 + nombre.length + extra.length + dato.length;
  });
  const cds = [];
  let largoCd = 0;
  central.forEach(function (c) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(c.metodo, 10);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.comp, 20);
    h.writeUInt32LE(c.sin, 24);
    h.writeUInt16LE(c.nombre.length, 28);
    h.writeUInt16LE(0, 30);          // extra 0 en el central, 7 en el local
    h.writeUInt16LE(0, 32);
    h.writeUInt32LE(c.inicio, 42);
    cds.push(h, c.nombre);
    largoCd += 46 + c.nombre.length;
  });
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(largoCd, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat(partes.concat(cds).concat([eocd]));
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function letraCol(n) {
  let s = ''; n++;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Las celdas vacias NO se escriben, igual que Excel: asi se prueba que el
// lector se guie por la referencia de celda y no por el orden.
function hojaDe(matriz) {
  const sst = [];
  const indice = (s) => { const i = sst.indexOf(s); if (i >= 0) return i; sst.push(s); return sst.length - 1; };
  const filas = matriz.map(function (f, r) {
    const celdas = f.map(function (v, c) {
      if (v === null || v === undefined) return '';
      const ref = letraCol(c) + (r + 1);
      if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="s"><v>' + indice(String(v)) + '</v></c>';
    }).join('');
    return '<row r="' + (r + 1) + '">' + celdas + '</row>';
  }).join('');
  return {
    hoja: '<?xml version="1.0"?><worksheet><sheetData>' + filas + '</sheetData></worksheet>',
    sst: '<sst count="' + sst.length + '">' + sst.map(s => '<si><t>' + escapar(s) + '</t></si>').join('') + '</sst>'
  };
}
function xlsxDe(matriz, o) {
  const p = hojaDe(matriz);
  const comprimir = !(o && o.sinComprimir);
  return zipDe([
    { nombre: '[Content_Types].xml', texto: '<Types/>', comprimir: comprimir },
    { nombre: 'xl/sharedStrings.xml', texto: p.sst, comprimir: comprimir },
    { nombre: 'xl/worksheets/sheet1.xml', texto: p.hoja, comprimir: comprimir }
  ]);
}

/* ======================================================================== */
/*  Los datos de prueba                                                     */
/* ======================================================================== */

const CAB = ['appt_nbr', 'Rut', 'Razon Social', 'po_dc_nbr', 'rcvr_nbr', 'rcvr_final_ts',
             'cntnr_type_desc', 'pallet_tot_qty', 'pallet_bad_qty', 'pallet_exch_qty', 'valido'];

// 46223 es el 2026-07-20 en el calendario de Excel.
const SERIAL = 46223;

function filaWM(cita, canje, extra) {
  const f = [cita, '76437903-9', 'BUDDY PET LIMITADA', 6020, 351487, SERIAL, 'PALLET', canje, 0, canje, 'S'];
  if (extra) Object.keys(extra).forEach(k => { f[CAB.indexOf(k)] = extra[k]; });
  return f;
}

// El lado Redlink: lo que devuelve /proxy/ops con el contrato RDT.
const OPS = [
  { nroPedido: 4138211, nroCita: '42704805', operacion: 'Transferencia', etapaOperacion: 'Pendiente Adjuntar Respaldo',
    cantidadDespachada: 16, cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02 CD WM QUILICURA FRIO', observacion: '' },
  { nroPedido: 4138273, nroCita: '42710381', operacion: 'Transferencia', etapaOperacion: 'Pendiente de Confirmacion',
    cantidadDespachada: 10, cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02', observacion: '' },
  { nroPedido: 4138310, nroCita: '', operacion: 'Transferencia', etapaOperacion: 'Pendiente de Confirmacion',
    cantidadDespachada: 8, cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02', observacion: 'segun cita 42713735 del cliente' },
  { nroPedido: 4138400, nroCita: '42716539', operacion: 'Transferencia', etapaOperacion: 'Transferencia Confirmada',
    cantidadDespachada: 12, cantidadConfirmada: 12, bodegaDestinoStr: 'ZWM02', observacion: '' },
  { nroPedido: 4138500, nroCita: '42720001', operacion: 'Transferencia', etapaOperacion: 'Transferencia Anulada',
    cantidadDespachada: 7, cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02', observacion: '' },
  { nroPedido: 4138600, nroCita: '42730001', operacion: 'Despacho', etapaOperacion: 'Pendiente de Confirmacion',
    cantidadDespachada: 4, cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02', observacion: '' }
];

/* ======================================================================== */
/*  Las pruebas                                                             */
/* ======================================================================== */

async function correr(N) {
  ok = 0; fallos = [];

  /* ---- el ZIP ----------------------------------------------------------- */

  await prueba('T01 lee un .xlsx comprimido y devuelve la matriz', async () => {
    const m = await N.leerXlsx(xlsxDe([CAB, filaWM(42704805, 16)]));
    igual(m.length, 2, 'encabezado mas una fila:');
    igual(m[0][0], 'appt_nbr');
  });
  await prueba('T02 lee un .xlsx guardado sin comprimir', async () => {
    const m = await N.leerXlsx(xlsxDe([CAB, filaWM(42704805, 16)], { sinComprimir: true }));
    igual(m[0][0], 'appt_nbr');
    igual(m[1][7], 16);
  });
  await prueba('T03 salta el encabezado local con SUS largos, no los del central', async () => {
    // Si el lector usara los largos del directorio central quedaria 7 bytes
    // corrido y el XML vendria partido. Esta es la unica prueba que lo detecta.
    const m = await N.leerXlsx(xlsxDe([CAB, filaWM(42704805, 16)]));
    igual(m[1][0], 42704805);
  });
  await prueba('T04 un archivo que no es ZIP revienta diciendolo', () => {
    revienta(() => N.entradasZip(Buffer.from('esto es un pdf, no un excel')), /no parece un \.xlsx/i);
  });
  await prueba('T05 un .xlsx sin hoja de calculo revienta diciendolo', async () => {
    const z = zipDe([{ nombre: 'otra/cosa.xml', texto: '<a/>' }]);
    await revientaAsync(() => N.leerXlsx(z), /hoja de c/i);
  });
  await prueba('T06 encuentra las tres entradas del zip', () => {
    const z = N.entradasZip(xlsxDe([CAB]));
    igual(z.entradas.map(e => e.nombre),
          ['[Content_Types].xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  });

  /* ---- el XML de la hoja ------------------------------------------------- */

  await prueba('T07 la columna sale de la referencia: A=0, Z=25, AA=26', () => {
    igual(N.columnaANumero('A1'), 0);
    igual(N.columnaANumero('B2'), 1);
    igual(N.columnaANumero('Z10'), 25);
    igual(N.columnaANumero('AA1'), 26);
    igual(N.columnaANumero('AB100'), 27);
  });
  await prueba('T08 una celda vacia al medio deja un hueco, no corre la fila', () => {
    const xml = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>';
    igual(N.leerHoja(xml, ['uno', 'tres']), [['uno', null, 'tres']]);
  });
  await prueba('T09 una celda autocerrada no descoloca las siguientes', () => {
    const xml = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"/><c r="C1" t="s"><v>1</v></c></row>';
    igual(N.leerHoja(xml, ['uno', 'tres']), [['uno', null, 'tres']]);
  });
  await prueba('T10 un numero vuelve como numero, no como texto', () => {
    const f = N.leerHoja('<row r="1"><c r="A1"><v>16</v></c></row>', []);
    igual(f[0][0], 16);
    cierto(typeof f[0][0] === 'number', 'tiene que ser numero');
  });
  await prueba('T11 el texto compartido se resuelve por indice', () => {
    igual(N.leerHoja('<row r="1"><c r="A1" t="s"><v>1</v></c></row>', ['cero', 'uno']), [['uno']]);
  });
  await prueba('T12 el texto en linea tambien se lee', () => {
    igual(N.leerHoja('<row r="1"><c r="A1" t="inlineStr"><is><t>hola</t></is></c></row>', []), [['hola']]);
  });
  await prueba('T13 un texto partido en varios <t> se junta completo', () => {
    igual(N.leerSharedStrings('<si><r><t>BUDDY </t></r><r><t>PET</t></r></si>'), ['BUDDY PET']);
  });
  await prueba('T14 las entidades se desarman, y el & al final', () => {
    igual(N.leerSharedStrings('<si><t>A &amp; B</t></si>'), ['A & B']);
    igual(N.leerSharedStrings('<si><t>&lt;3</t></si>'), ['<3']);
    // Un & escapado dos veces tiene que quedar como texto "&lt;", no como "<".
    igual(N.leerSharedStrings('<si><t>&amp;lt;</t></si>'), ['&lt;']);
  });
  await prueba('T15 el serial de Excel se traduce a fecha ISO', () => {
    igual(N.serialAFecha(46223), '2026-07-20');
    igual(N.serialAFecha(25569), '1970-01-01', 'la epoca de Unix:');
  });

  /* ---- las columnas del reporte ----------------------------------------- */

  await prueba('T16 lee las filas por NOMBRE de columna', () => {
    const f = N.filasWalmart([CAB, filaWM(42704805, 16)]);
    igual(f.length, 1);
    igual(f[0].cita, '42704805');
    igual(f[0].canje, 16);
    igual(f[0].cliente, 'BUDDY PET LIMITADA');
    igual(f[0].fecha, '2026-07-20');
  });
  await prueba('T17 las columnas desordenadas se leen igual', () => {
    const cab = CAB.slice().reverse();
    const fila = filaWM(42704805, 16).slice().reverse();
    const f = N.filasWalmart([cab, fila]);
    igual(f[0].cita, '42704805');
    igual(f[0].canje, 16);
  });
  await prueba('T18 si falta una columna revienta con el nombre', () => {
    const cab = CAB.filter(c => c !== 'pallet_exch_qty');
    revienta(() => N.filasWalmart([cab, cab.map(() => 1)]), /pallet_exch_qty/);
  });
  await prueba('T19 una hoja vacia revienta diciendolo', () => {
    revienta(() => N.filasWalmart([]), /vac/i);
  });
  await prueba('T20 una fila sin cita se salta', () => {
    const f = N.filasWalmart([CAB, filaWM('', 5), filaWM(42704805, 16)]);
    igual(f.length, 1);
    igual(f[0].cita, '42704805');
  });
  await prueba('T21 el encabezado nunca entra como dato', () => {
    const f = N.filasWalmart([CAB, filaWM(42704805, 16)]);
    igual(f.map(x => x.cita), ['42704805']);
  });
  await prueba('T22 total, malos y canje se leen cada uno de su columna', () => {
    const fila = filaWM(42704805, 9, { pallet_tot_qty: 20, pallet_bad_qty: 2 });
    const f = N.filasWalmart([CAB, fila]);
    igual([f[0].total, f[0].malos, f[0].canje], [20, 2, 9]);
  });
  await prueba('T23 una fecha ya escrita como texto se respeta', () => {
    const f = N.filasWalmart([CAB, filaWM(42704805, 3, { rcvr_final_ts: '2026-10-28 14:30:00' })]);
    igual(f[0].fecha, '2026-10-28');
  });

  /* ---- las citas, que son campo libre ----------------------------------- */

  await prueba('T24 la cita son ocho digitos, no cualquier numero', () => {
    igual(N.citasDeTexto('cita 42704805 por 16 pallets'), ['42704805']);
    igual(N.citasDeTexto('42704805-42710381'), ['42704805', '42710381']);
    igual(N.citasDeTexto('42713735 - 42716539'), ['42713735', '42716539']);
    igual(N.citasDeTexto('42710724.'), ['42710724']);
    igual(N.citasDeTexto(''), []);
    igual(N.citasDeTexto(null), []);
  });
  await prueba('T25 la misma cita repetida cuenta una vez', () => {
    igual(N.citasDeTexto('42704805 / 42704805'), ['42704805']);
  });

  await prueba('T25b una cita es de ocho digitos y nada mas', () => {
    cierto(N.esCita('42704805'));
    falso(N.esCita('38046'), 'cinco digitos no es una cita');
    falso(N.esCita('427048050'), 'nueve tampoco');
    falso(N.esCita(''));
    falso(N.esCita(null));
  });

  /* ---- agrupar por cita -------------------------------------------------- */

  await prueba('T26 varias recepciones de una cita son UNA transferencia', () => {
    const filas = N.filasWalmart([CAB,
      filaWM(42704805, 10, { rcvr_nbr: 111 }),
      filaWM(42704805, 6,  { rcvr_nbr: 222 })]);
    const g = N.agruparPorCita(filas);
    igual(g.length, 1);
    igual(g[0].canje, 16, 'el canje se suma:');
    igual(g[0].filas, 2);
    igual(g[0].recepciones, ['111', '222']);
  });
  await prueba('T27 la fecha del grupo es la mas temprana', () => {
    const g = N.agruparPorCita([
      { cita: '1', total: 0, malos: 0, canje: 0, fecha: '2026-10-28', recepcion: '' },
      { cita: '1', total: 0, malos: 0, canje: 0, fecha: '2026-10-21', recepcion: '' }
    ]);
    igual(g[0].fecha, '2026-10-21');
  });
  await prueba('T28 el total y los malos tambien se suman', () => {
    const g = N.agruparPorCita([
      { cita: '1', total: 10, malos: 1, canje: 9, fecha: '', recepcion: '' },
      { cita: '1', total: 5,  malos: 2, canje: 3, fecha: '', recepcion: '' }
    ]);
    igual([g[0].total, g[0].malos, g[0].canje], [15, 3, 12]);
  });

  /* ---- el cruce contra Redlink ------------------------------------------ */

  await prueba('T29 indexa por cita y guarda las que traen observacion', () => {
    const idx = N.indexar(OPS);
    igual(idx.porCita.get('42704805').length, 1);
    igual(idx.conObs.length, 1);
    igual(idx.conObs[0].nroPedido, 4138310);
  });
  await prueba('T30 una cita en un solo pedido es coincidencia exacta', () => {
    igual(N.clasificar({ cita: '42704805' }, N.indexar(OPS)).estado, 'exacta');
  });
  await prueba('T31 una cita en dos pedidos es duplicada, no se elige una', () => {
    const ops = [OPS[0], Object.assign({}, OPS[0], { nroPedido: 9999 })];
    const c = N.clasificar({ cita: '42704805' }, N.indexar(ops));
    igual(c.estado, 'duplicada');
    igual(c.ops.length, 2);
  });
  await prueba('T32 si no esta en el campo cita se busca en la observacion', () => {
    const c = N.clasificar({ cita: '42713735' }, N.indexar(OPS));
    igual(c.estado, 'por-observacion');
    igual(c.ops[0].nroPedido, 4138310);
  });
  await prueba('T33 la cita se encuentra en cualquier parte de la observacion', () => {
    const ops = [{ nroPedido: 1, nroCita: '', observacion: 'OC 12 ref 42713735 fin' }];
    igual(N.clasificar({ cita: '42713735' }, N.indexar(ops)).estado, 'por-observacion');
  });
  await prueba('T33b la misma cita en dos observaciones no se resuelve sola', () => {
    const ops = [{ nroPedido: 1, nroCita: '', observacion: 'ref 42713735' },
                 { nroPedido: 2, nroCita: '', observacion: 'tambien 42713735' }];
    const c = N.clasificar({ cita: '42713735' }, N.indexar(ops));
    igual(c.estado, 'duplicada-observacion');
    igual(c.ops.length, 2);
  });
  await prueba('T34 una cita que no esta en ninguna parte es sin-match', () => {
    igual(N.clasificar({ cita: '99999999' }, N.indexar(OPS)).estado, 'sin-match');
  });

  /* ---- la regla de cantidad, confirmada por el area --------------------- */

  await prueba('T35 si Walmart recibio MENOS, se confirma lo recibido', () => {
    igual(N.reglaCantidad(10, 5), { aConfirmar: 5, diferencia: -5, porAvisar: 0 });
  });
  await prueba('T36 si Walmart recibio MAS, se confirma lo despachado', () => {
    igual(N.reglaCantidad(10, 15), { aConfirmar: 10, diferencia: 5, porAvisar: 5 });
  });
  await prueba('T37 iguales: se confirma todo y no hay nada que avisar', () => {
    igual(N.reglaCantidad(16, 16), { aConfirmar: 16, diferencia: 0, porAvisar: 0 });
  });
  await prueba('T38 lo que se le avisa al cliente son las diferencias POSITIVAS', () => {
    // Si despacho 10 y Walmart dice 15, hay 5 pallets en Walmart sin respaldo:
    // el cliente tiene que emitir otra transferencia por esos 5.
    igual(N.reglaCantidad(10, 15).porAvisar, 5);
    igual(N.reglaCantidad(15, 10).porAvisar, 0, 'al reves no se le avisa nada:');
  });
  await prueba('T39 valores sucios no tumban la regla', () => {
    igual(N.reglaCantidad(null, undefined), { aConfirmar: 0, diferencia: 0, porAvisar: 0 });
    igual(N.reglaCantidad('10', '15').aConfirmar, 10);
  });

  /* ---- las etapas -------------------------------------------------------- */

  await prueba('T40 las DOS etapas pendientes son confirmables en el camino masivo', () => {
    // Resuelto por Marcelo el 9-nov-2026: en las confirmaciones masivas de
    // Walmart no corresponde adjuntar respaldo. Antes la 43 quedaba fuera, y
    // eran 55 de los 60 folios del primer dia real.
    cierto(N.etapaConfirmable({ etapaOperacion: 'Pendiente de Confirmacion' }));
    cierto(N.etapaConfirmable({ etapaOperacion: 'Pendiente de Confirmación' }), 'con tilde tambien:');
    cierto(N.etapaConfirmable({ etapaOperacion: 'Pendiente Adjuntar Respaldo' }));
    falso(N.etapaConfirmable({ etapaOperacion: 'Transferencia Confirmada' }));
    falso(N.etapaConfirmable({ etapaOperacion: 'Transferencia Reconfirmada' }));
  });
  await prueba('T40b empezar con "Pendiente" NO alcanza', () => {
    // Las dos confirmables empiezan igual: un regex /pendiente/i deja pasar
    // cualquier etapa futura que arranque con esa palabra.
    falso(N.etapaConfirmable({ etapaOperacion: 'Pendiente' }));
    falso(N.etapaConfirmable({ etapaOperacion: 'Pendiente de Aprobacion' }));
    falso(N.etapaConfirmable({ etapaOperacion: 'Pendiente Reversa' }));
  });
  await prueba('T41 una operacion nula no hace reventar nada', () => {
    falso(N.etapaConfirmable(null));
    falso(N.esAnulada(null));
    falso(N.estaConfirmada(null));
  });
  await prueba('T42 reconoce una anulada', () => {
    cierto(N.esAnulada({ etapaOperacion: 'Transferencia Anulada' }));
    falso(N.esAnulada({ etapaOperacion: 'Pendiente de Confirmacion' }));
  });
  await prueba('T43 solo los servicios de transferencia; sin dato, se deja pasar', () => {
    cierto(N.esTransferencia({ operacion: 'Transferencia' }));
    cierto(N.esTransferencia({ operacion: 'Transferencias' }), 'el nombre real viene en plural:');
    cierto(N.esTransferencia({}), 'sin el campo no se descarta:');
    falso(N.esTransferencia({ operacion: 'Despacho' }));
  });
  await prueba('T43b "Trans Diferenciada" ES del circuito de Walmart', () => {
    // Medido en vivo: mismo servicio hacia bodegas ZWM*, misma máquina de
    // etapas y 698 ya confirmadas. Dejarla afuera perdía la mitad del día.
    cierto(N.esTransferencia({ operacion: 'Trans Diferenciada' }));
    cierto(N.esTransferencia({ operacion: '  TRANS DIFERENCIADA  ' }), 'sin importar mayusculas ni espacios:');
  });
  await prueba('T43c los otros servicios de Redlink NO entran', () => {
    ['Relocalizacion', 'Traspasos', 'Devolucion', 'Emision', 'Emision 24 horas',
     'Emision LD', 'Emision Retiro Cliente', 'Retiro'].forEach(function (o) {
      falso(N.esTransferencia({ operacion: o }), o + ' no debería entrar');
    });
  });
  await prueba('T43d un servicio nuevo sale nombrado, no se cuela', () => {
    falso(N.esTransferencia({ operacion: 'Trans Expresa' }), 'un nombre parecido no alcanza');
    const ops = [Object.assign({}, OPS[1], { operacion: 'Trans Expresa' })];
    const r = N.cruzar(N.filasWalmart([CAB, filaWM(42710381, 10)]), ops);
    igual(r.porConfirmar.length, 0);
    cierto(/Trans Expresa/.test(r.excepciones[0].motivo), r.excepciones[0].motivo);
  });
  await prueba('T44 "confirmada" necesita DOS senales: cantidad y etapa', () => {
    cierto(N.estaConfirmada({ cantidadConfirmada: 12, etapaOperacion: 'Transferencia Confirmada' }));
    falso(N.estaConfirmada({ cantidadConfirmada: 3, etapaOperacion: 'Pendiente de Confirmacion' }),
          'con etapa pendiente no esta confirmada aunque traiga cantidad:');
    falso(N.estaConfirmada({ cantidadConfirmada: 0, etapaOperacion: 'Transferencia Anulada' }),
          'sin cantidad no esta confirmada aunque la etapa no sea pendiente:');
  });

  /* ---- las tres bandejas ------------------------------------------------- */

  const FILAS = N.filasWalmart([CAB,
    filaWM(42704805, 16),   // 4138211 despacho 16, etapa 43  -> confirmar 16
    filaWM(42710381, 15),   // 4138273 despacho 10, etapa 44  -> confirmar 10 y avisar 5
    filaWM(42713735, 8),    // 4138310 por observacion        -> confirmar 8
    filaWM(42716539, 12),   // 4138400 ya confirmada          -> excepcion
    filaWM(42720001, 7),    // 4138500 anulada                -> excepcion
    filaWM(42730001, 4),    // 4138600 no es transferencia    -> excepcion
    filaWM(49999999, 3)     // no existe en Redlink           -> excepcion
  ]);

  await prueba('T45 toda cita termina en alguna bandeja, con motivo', () => {
    const r = N.cruzar(FILAS, OPS);
    igual(r.citas, 7);
    igual(r.porConfirmar.length + r.excepciones.length, 7, 'nada se pierde en silencio:');
    r.excepciones.forEach(e => cierto(e.motivo && e.motivo.length > 5, 'excepcion sin motivo'));
  });
  await prueba('T46 lo confirmable sale con folio y cantidad', () => {
    const r = N.cruzar(FILAS, OPS);
    igual(r.porConfirmar.map(f => [f.folio, f.aConfirmar]),
          [[4138211, 16], [4138273, 10], [4138310, 8]]);
  });
  await prueba('T47 sale ordenado por folio', () => {
    const r = N.cruzar(FILAS.slice().reverse(), OPS);
    const folios = r.porConfirmar.map(f => f.folio);
    igual(folios, folios.slice().sort((a, b) => a - b));
  });
  await prueba('T48 una ya confirmada no se vuelve a confirmar', () => {
    const r = N.cruzar(FILAS, OPS);
    falso(r.porConfirmar.some(f => f.folio === 4138400), 'la confirmada no puede estar en la lista');
    cierto(r.excepciones.some(e => e.folio === 4138400 && /ya estaba confirmada/.test(e.motivo)));
  });
  await prueba('T49 una anulada queda afuera y dice que esta anulada', () => {
    const r = N.cruzar(FILAS, OPS);
    cierto(r.excepciones.some(e => e.folio === 4138500 && /anulada/.test(e.motivo)));
    falso(r.porConfirmar.some(f => f.folio === 4138500));
  });
  await prueba('T50 lo que no es transferencia queda afuera, nombrando la operacion', () => {
    const r = N.cruzar(FILAS, OPS);
    cierto(r.excepciones.some(e => e.folio === 4138600 && /Despacho/.test(e.motivo)));
  });
  await prueba('T51 una cita sin operacion en Redlink queda afuera', () => {
    const r = N.cruzar(FILAS, OPS);
    cierto(r.excepciones.some(e => e.cita === '49999999' && /sin coincidencia/.test(e.motivo)));
  });
  await prueba('T52 la bandeja de aviso trae las positivas, de mayor a menor', () => {
    const r = N.cruzar(FILAS, OPS);
    igual(r.avisar.map(f => [f.folio, f.porAvisar]), [[4138273, 5]]);
  });
  await prueba('T51b una fila de resumen se nombra por lo que es, no "sin coincidencia"', () => {
    const filas = N.filasWalmart([CAB, filaWM(38046, 30)]);
    const r = N.cruzar(filas, OPS);
    igual(r.porConfirmar.length, 0);
    igual(r.excepciones.length, 1);
    cierto(/8 d/i.test(r.excepciones[0].motivo), r.excepciones[0].motivo);
    falso(/sin coincidencia/.test(r.excepciones[0].motivo), 'no manda a buscar a Redlink');
  });
  await prueba('T52b el aviso sale de mayor a menor, para atacar primero lo grande', () => {
    const filas = N.filasWalmart([CAB, filaWM(42704805, 20), filaWM(42710381, 13)]);
    const r = N.cruzar(filas, OPS);   // 4138211 despacho 16 -> avisar 4; 4138273 despacho 10 -> avisar 3
    igual(r.avisar.map(f => f.porAvisar), [4, 3]);
  });
  await prueba('T53 una ya confirmada con diferencia positiva SE LE AVISA igual', () => {
    // El cliente tiene que emitir la transferencia por la diferencia aunque la
    // confirmacion ya se hizo: esos pallets estan en Walmart sin respaldo.
    const filas = N.filasWalmart([CAB, filaWM(42716539, 20)]);  // 4138400 despacho 12, ya confirmada
    const r = N.cruzar(filas, OPS);
    igual(r.porConfirmar.length, 0);
    igual(r.avisar.map(f => [f.folio, f.porAvisar]), [[4138400, 8]]);
  });
  await prueba('T54 el filtro por etapa es opcional: sin pedirlo, no filtra', () => {
    const r = N.cruzar(FILAS, OPS);
    cierto(r.porConfirmar.some(f => f.folio === 4138211), 'la etapa 43 entra si no se exige etapa');
  });
  await prueba('T55 con exigirEtapa las dos pendientes quedan; una cerrada sale', () => {
    const r = N.cruzar(FILAS, OPS, { exigirEtapa: true });
    cierto(r.porConfirmar.some(f => f.folio === 4138211), 'la 43 queda: el camino masivo la confirma');
    cierto(r.porConfirmar.some(f => f.folio === 4138273), 'la 44 queda');
    // Y la bandera sigue sirviendo para lo que no es confirmable.
    const ops = [Object.assign({}, OPS[1], { etapaOperacion: 'Transferencia Reconfirmada' })];
    const filas = N.filasWalmart([CAB, filaWM(42710381, 10)]);
    igual(N.cruzar(filas, ops).porConfirmar.length, 1, 'sin la bandera pasa');
    const con = N.cruzar(filas, ops, { exigirEtapa: true });
    igual(con.porConfirmar.length, 0, 'con la bandera no');
    cierto(/todav/.test(con.excepciones[0].motivo), con.excepciones[0].motivo);
  });
  await prueba('T56 cantidad cero no se confirma', () => {
    const filas = N.filasWalmart([CAB, filaWM(42704805, 0)]);
    const r = N.cruzar(filas, OPS);
    igual(r.porConfirmar.length, 0);
    cierto(r.excepciones.some(e => /cero/.test(e.motivo)));
  });
  await prueba('T57 dos citas que caen en el mismo folio salen las DOS nombradas', () => {
    const ops = [Object.assign({}, OPS[0], { nroCita: '42704805-42710381' })];
    const filas = N.filasWalmart([CAB, filaWM(42704805, 5), filaWM(42710381, 6)]);
    const r = N.cruzar(filas, ops);
    igual(r.porConfirmar.length, 0, 'ninguna se confirma a ciegas:');
    igual(r.excepciones.length, 2);
    r.excepciones.forEach(e => cierto(/mismo folio/.test(e.motivo), 'motivo: ' + e.motivo));
  });
  await prueba('T58 una cita en dos operaciones queda afuera con el conteo', () => {
    const ops = [OPS[0], Object.assign({}, OPS[0], { nroPedido: 7777 })];
    const filas = N.filasWalmart([CAB, filaWM(42704805, 5)]);
    const r = N.cruzar(filas, ops);
    igual(r.porConfirmar.length, 0);
    cierto(/cae en 2 operaciones/.test(r.excepciones[0].motivo), r.excepciones[0].motivo);
  });
  await prueba('T59 cada fila confirmable lleva la etapa a la vista', () => {
    const r = N.cruzar(FILAS, OPS);
    r.porConfirmar.forEach(f => cierto(f.etapa && f.etapa.length > 3, 'falta la etapa en el folio ' + f.folio));
  });
  await prueba('T59b cada fila lleva el id del documento y el cliente de Redlink', () => {
    // El id del documento es con lo que se escribe en Redlink: si no viaja con
    // la fila, quien confirma tiene que ir a buscarlo a mano folio por folio.
    const ops = [Object.assign({}, OPS[1], { formHeaderiD: 684029, clienteOrigenStr: 'BUDDY PET LIMITADA' })];
    const filas = N.filasWalmart([CAB, filaWM(42710381, 10)]);
    const r = N.cruzar(filas, ops);
    igual(r.porConfirmar[0].docId, 684029);
    igual(r.porConfirmar[0].clienteRedlink, 'BUDDY PET LIMITADA');
  });
  await prueba('T59c cada fila dice de qué servicio salió', () => {
    const ops = [Object.assign({}, OPS[1], { operacion: 'Trans Diferenciada' })];
    const r = N.cruzar(N.filasWalmart([CAB, filaWM(42710381, 10)]), ops);
    igual(r.porConfirmar[0].servicio, 'Trans Diferenciada');
  });
  await prueba('T60 sin operaciones, todo cae en excepciones y nada revienta', () => {
    const r = N.cruzar(FILAS, []);
    igual(r.porConfirmar.length, 0);
    igual(r.excepciones.length, 7);
  });
  await prueba('T61 sin filas de Walmart devuelve las tres bandejas vacias', () => {
    const r = N.cruzar([], OPS);
    igual([r.porConfirmar.length, r.excepciones.length, r.avisar.length, r.citas], [0, 0, 0, 0]);
  });

  /* ---- el resumen de excepciones ----------------------------------------- */

  await prueba('T61b toda excepcion lleva una clave estable, no solo el texto', () => {
    // El texto trae datos adentro ("cae en 2 operaciones"): agrupar por texto
    // parte la misma familia en varias. La clave es lo que se puede contar.
    const r = N.cruzar(FILAS, OPS);
    r.excepciones.forEach(e => cierto(e.clave && e.clave.length > 3, 'excepcion sin clave: ' + e.motivo));
    const claves = r.excepciones.map(e => e.clave).sort();
    igual(claves, ['anulada', 'no-transferencia', 'sin-match', 'ya-confirmada']);
  });
  await prueba('T61c toda clave tiene su nombre en castellano', () => {
    Object.keys(N.FAMILIAS).forEach(k => cierto(N.FAMILIAS[k] && N.FAMILIAS[k].length > 5, 'falta el texto de ' + k));
    igual(N.FAMILIAS['ya-confirmada'], 'ya confirmadas');
  });
  await prueba('T61d el resumen cuenta por familia, de mayor a menor', () => {
    const r = N.cruzar(FILAS, OPS);
    const res = N.resumenMotivos(r.excepciones);
    igual(res.map(x => x.n), res.map(x => x.n).slice().sort((a, b) => b - a), 'tiene que venir ordenado');
    igual(res.reduce((a, x) => a + x.n, 0), r.excepciones.length, 'el resumen suma el total');
    res.forEach(x => cierto(x.texto && x.texto !== x.clave, 'la clave ' + x.clave + ' salio sin nombre'));
  });
  await prueba('T61e el resumen agrupa las que traen numero adentro del texto', () => {
    const ops = [OPS[0], Object.assign({}, OPS[0], { nroPedido: 1 }), Object.assign({}, OPS[0], { nroPedido: 2 })];
    const filas = N.filasWalmart([CAB, filaWM(42704805, 5)]);
    const res = N.resumenMotivos(N.cruzar(filas, ops).excepciones);
    igual(res, [{ clave: 'cita-ambigua', n: 1, texto: 'la cita cae en varias operaciones' }]);
  });
  await prueba('T61e2 la familia mas numerosa va primero y el conteo es real', () => {
    const res = N.resumenMotivos([{ clave: 'anulada' }, { clave: 'ya-confirmada' },
                                  { clave: 'ya-confirmada' }, { clave: 'ya-confirmada' }]);
    igual(res, [{ clave: 'ya-confirmada', n: 3, texto: 'ya confirmadas' },
                { clave: 'anulada', n: 1, texto: 'anuladas' }]);
  });
  await prueba('T61f con empate ordena por nombre, no al azar', () => {
    const res = N.resumenMotivos([{ clave: 'ya-confirmada' }, { clave: 'anulada' }]);
    igual(res.map(x => x.clave), ['anulada', 'ya-confirmada']);
  });
  await prueba('T61g sin excepciones el resumen viene vacio', () => {
    igual(N.resumenMotivos([]), []);
    igual(N.resumenMotivos(null), []);
  });

  /* ---- la salida --------------------------------------------------------- */

  await prueba('T62 el csv va con encabezado, punto y coma y CRLF', () => {
    igual(N.csvDeConfirmar([{ folio: 4138211, aConfirmar: 16 }, { folio: 4138273, aConfirmar: 10 }]),
          'folio;cantRecibida\r\n4138211;16\r\n4138273;10\r\n');
  });
  await prueba('T63 un csv vacio igual trae el encabezado', () => {
    igual(N.csvDeConfirmar([]), 'folio;cantRecibida\r\n');
    igual(N.csvDeConfirmar(null), 'folio;cantRecibida\r\n');
  });
  await prueba('T64 el pegado a Excel va con tabulacion y sin encabezado', () => {
    igual(N.tsvDeConfirmar([{ folio: 4138211, aConfirmar: 16 }]), '4138211\t16');
    igual(N.tsvDeConfirmar([]), '');
  });

  /* ---- la ventana de consulta ------------------------------------------- */

  await prueba('T65 la ventana cubre el reporte con margen hacia atras y adelante', () => {
    const v = N.ventanaDeReporte([{ fecha: '2026-10-28' }], 20);
    igual(v, { desde: '2026-10-08', hasta: '2026-11-17' });
  });
  await prueba('T66 el margen por omision son 20 dias', () => {
    igual(N.ventanaDeReporte([{ fecha: '2026-10-28' }]), { desde: '2026-10-08', hasta: '2026-11-17' });
  });
  await prueba('T67 toma la mas vieja y la mas nueva, venga en cualquier orden', () => {
    const v = N.ventanaDeReporte([{ fecha: '2026-10-28' }, { fecha: '2026-10-01' }, { fecha: '2026-10-15' }], 0);
    igual(v, { desde: '2026-10-01', hasta: '2026-10-28' });
  });
  await prueba('T68 sin fechas utiles devuelve null, no una ventana inventada', () => {
    igual(N.ventanaDeReporte([{ fecha: '' }, { fecha: 'ayer' }]), null);
    igual(N.ventanaDeReporte([]), null);
  });

  /* ---- la consulta en tramos --------------------------------------------- */

  await prueba('T70 parte la ventana en tramos que cubren todo sin huecos', () => {
    const v = N.ventanasDe('2026-10-08', '2026-11-17', 5);
    cierto(v.length >= 8, 'tiene que trocear: ' + v.length);
    igual(v[0].desde, '2026-10-08', 'arranca donde se pidió');
    igual(v[v.length - 1].hasta, '2026-11-17', 'y termina donde se pidió');
    const DIA = 86400000;
    for (let i = 1; i < v.length; i++) {
      const salto = (new Date(v[i].desde) - new Date(v[i - 1].hasta)) / DIA;
      igual(salto, 1, 'hueco entre el tramo ' + i + ' y el ' + (i + 1));
    }
  });
  await prueba('T71 ningún tramo pasa del paso pedido', () => {
    const DIA = 86400000;
    [[ '2026-10-08', '2026-11-17', 5 ], [ '2026-01-01', '2026-01-02', 5 ], [ '2026-01-01', '2026-01-01', 5 ]]
      .forEach(function (c) {
        N.ventanasDe(c[0], c[1], c[2]).forEach(function (x) {
          const largo = (new Date(x.hasta) - new Date(x.desde)) / DIA + 1;
          cierto(largo <= c[2] && largo >= 1, 'tramo de ' + largo + ' días');
        });
      });
  });
  await prueba('T72 un solo día devuelve un solo tramo de ese día', () => {
    igual(N.ventanasDe('2026-11-09', '2026-11-09', 5), [{ desde: '2026-11-09', hasta: '2026-11-09' }]);
  });
  await prueba('T73 fechas al revés o inválidas devuelven vacío, no una ventana inventada', () => {
    igual(N.ventanasDe('2026-11-17', '2026-10-08', 5), []);
    igual(N.ventanasDe('', '', 5), []);
    igual(N.ventanasDe('ayer', 'hoy', 5), []);
  });

  await prueba('T74 dos rangos se pisan si comparten aunque sea un día', () => {
    const r = (d, h) => ({ desde: d, hasta: h });
    cierto(N.seSolapan(r('2026-10-08','2026-10-28'), r('2026-10-28','2026-11-02')), 'un día en común basta');
    cierto(N.seSolapan(r('2026-10-08','2026-11-17'), r('2026-11-09','2026-11-09')), 'uno contenido en el otro');
    cierto(N.seSolapan(r('2026-11-09','2026-11-09'), r('2026-10-08','2026-11-17')), 'y al revés');
    falso(N.seSolapan(r('2026-10-08','2026-10-28'), r('2026-10-29','2026-11-02')), 'pegados no es pisarse');
    falso(N.seSolapan(r('2026-11-09','2026-11-10'), r('2026-10-08','2026-10-28')));
  });
  await prueba('T75 sin rangos válidos no inventa un solape', () => {
    falso(N.seSolapan(null, { desde: '2026-11-09', hasta: '2026-11-09' }));
    falso(N.seSolapan({ desde: '2026-11-09' }, { desde: '2026-11-09', hasta: '2026-11-09' }));
    falso(N.seSolapan({}, {}));
  });

  /* ---- de punta a punta -------------------------------------------------- */

  await prueba('T69 del .xlsx al csv, el camino completo', async () => {
    const m = await N.leerXlsx(xlsxDe([CAB, filaWM(42704805, 16), filaWM(42710381, 15)]));
    const filas = N.filasWalmart(m);
    const r = N.cruzar(filas, OPS);
    igual(N.csvDeConfirmar(r.porConfirmar), 'folio;cantRecibida\r\n4138211;16\r\n4138273;10\r\n');
    igual(r.avisar.length, 1);
    cierto(N.ventanaDeReporte(filas) !== null, 'la ventana sale del propio reporte');
  });

  await prueba('T90 el PO del reporte se arrastra hasta la fila cruzada', () => {
    // No existe en Redlink. Si no viaja desde el .xlsx, después no hay de
    // dónde sacarlo para el informe al cliente salvo volver a cruzar a mano.
    const cab = Object.keys(N.COLUMNAS).map(k => N.COLUMNAS[k]).concat(['po_nbr']);
    const fila = cab.map(function (c) {
      if (c === 'appt_nbr') return 42704805;
      if (c === 'po_nbr') return '2851158713';
      if (c === 'Rut') return '77643296-2';
      if (c === 'Razon Social') return 'NUTRISCO CHILE S. A.';
      if (c === 'pallet_tot_qty' || c === 'pallet_exch_qty') return 15;
      if (c === 'pallet_bad_qty') return 0;
      return 1;
    });
    const f = N.filasWalmart([cab, fila]);
    igual(f[0].po, '2851158713');
    igual(N.agruparPorCita(f)[0].po, '2851158713', 'y sobrevive al agrupado por cita');
    // Y llega hasta la fila cruzada, que es la que el navegador manda a guardar.
    const r = N.cruzar(f, OPS);
    igual(r.porConfirmar.length, 1, JSON.stringify(r.excepciones));
    igual(r.porConfirmar[0].po, '2851158713', 'el PO tiene que llegar hasta acá');
  });
  await prueba('T91 un reporte SIN la columna de PO sigue siendo válido', () => {
    // Exigirla haría que un archivo bueno se rechace entero por una columna
    // que no decide nada.
    const cab = Object.keys(N.COLUMNAS).map(k => N.COLUMNAS[k]);
    const fila = cab.map(function (c) {
      if (c === 'appt_nbr') return 42759276;
      if (c === 'pallet_tot_qty' || c === 'pallet_exch_qty') return 15;
      if (c === 'pallet_bad_qty') return 0;
      return 1;
    });
    const f = N.filasWalmart([cab, fila]);
    igual(f[0].po, '', 'sin PO queda vacío, no undefined');
    igual(N.COLUMNAS.po, undefined, 'el PO no puede estar entre las obligatorias');
    igual(N.COLUMNAS_OPCIONALES.po, 'po_nbr');
  });

  await prueba('T95 una cita que vuelve con MÁS va a reconfirmar, no a excepciones', () => {
    // El caso de logística: Walmart recibió 9 de 20, se confirmó por 9, y días
    // después la misma cita vuelve diciendo 20. Antes caía en "ya confirmada"
    // junto a cincuenta excepciones y nadie la miraba: 11 pallets perdidos.
    const ops = [{ nroPedido: 4077940, nroCita: '42510877', operacion: 'Transferencia',
                   etapaOperacion: 'Transferencia Confirmada', cantidadDespachada: 20,
                   cantidadConfirmada: 9, bodegaDestinoStr: 'ZWM01', observacion: '' }];
    const filas = [{ cita: '42510877', rut: '1-9', cliente: 'LABORATORIO BALLERINA LIMITADA',
                     cd: '6009', recepcion: '1', fecha: '2026-07-14', po: '5450705665',
                     total: 20, malos: 0, canje: 20 }];
    const r = N.cruzar(filas, ops);
    igual(r.reconfirmar.length, 1, 'tiene que salir en su propia bandeja');
    igual(r.excepciones.length, 0, 'y NO quedar enterrada entre las excepciones');
    igual(r.porConfirmar.length, 0, 'tampoco se confirma como si fuera nueva');
    const f = r.reconfirmar[0];
    igual([f.yaConfirmada, f.objetivo, f.faltanPorConfirmar], [9, 20, 11]);
    cierto(/faltan 11/.test(f.motivo), f.motivo);
  });
  await prueba('T96 si vuelve con lo mismo, sigue siendo sólo "ya confirmada"', () => {
    const ops = [{ nroPedido: 4077940, nroCita: '42510877', operacion: 'Transferencia',
                   etapaOperacion: 'Transferencia Confirmada', cantidadDespachada: 20,
                   cantidadConfirmada: 9, bodegaDestinoStr: 'ZWM01', observacion: '' }];
    const filas = [{ cita: '42510877', rut: '1-9', cliente: 'X', cd: '6009', recepcion: '1',
                     fecha: '2026-07-14', po: '', total: 9, malos: 0, canje: 9 }];
    const r = N.cruzar(filas, ops);
    igual(r.reconfirmar.length, 0, 'no hay nada que reconfirmar');
    igual(r.excepciones.map(e => e.clave), ['ya-confirmada']);
  });
  await prueba('T97 si ahora declara MENOS de lo confirmado, se dice', () => {
    // No se puede desconfirmar, pero quedarse callado sería esconder que se
    // confirmó de más.
    const ops = [{ nroPedido: 4077940, nroCita: '42510877', operacion: 'Transferencia',
                   etapaOperacion: 'Transferencia Confirmada', cantidadDespachada: 20,
                   cantidadConfirmada: 9, bodegaDestinoStr: 'ZWM01', observacion: '' }];
    const filas = [{ cita: '42510877', rut: '1-9', cliente: 'X', cd: '6009', recepcion: '1',
                     fecha: '2026-07-14', po: '', total: 5, malos: 0, canje: 5 }];
    const r = N.cruzar(filas, ops);
    igual(r.reconfirmar.length, 0);
    igual(r.excepciones.map(e => e.clave), ['confirmada-de-mas']);
    cierto(/4 de más/.test(r.excepciones[0].motivo), r.excepciones[0].motivo);
  });
  await prueba('T98 la reconfirmación nunca apunta a más de lo despachado', () => {
    // Walmart declarando 25 sobre 20 despachados no significa confirmar 25:
    // es la misma regla de cantidad de siempre, sólo que contra lo ya
    // confirmado en vez de contra cero.
    igual(N.reglaReconfirmacion(20, 25, 9).objetivo, 20);
    igual(N.reglaReconfirmacion(20, 25, 9).faltan, 11);
    igual(N.reglaReconfirmacion(20, 20, 20).faltan, 0, 'completa no necesita nada');
    igual(N.reglaReconfirmacion(20, 0, 9).sobran, 9);
  });

  return { ok: ok, fallos: fallos };
}

/* ======================================================================== */
/*  Las mutaciones: cada una tiene que morir                                */
/* ======================================================================== */

const MUTACIONES = [
  ['T90m el PO no se arrastra',                     /po: idx\.po < 0 \? '' : String\(f\[idx\.po\] === null/, "po: '' && String(f[idx.po] === null"],
  ['T91m el PO se vuelve obligatorio',              /const COLUMNAS_OPCIONALES = \{ po: 'po_nbr' \};/, 'const COLUMNAS_OPCIONALES = {};'],
  ['T92m el PO se pierde al agrupar por cita',      /po: f\.po \|\| '', recepciones: \[\]/, "po: '', recepciones: []"],
  ['T93m el PO se pierde en la fila cruzada',       /po: g\.po \|\| '',/, "po: '',"],
  // la regla de cantidad
  ['M01 confirma siempre lo despachado',            /aConfirmar: a < d \? a : d/, 'aConfirmar: d'],
  ['M02 confirma siempre lo que dice Walmart',      /aConfirmar: a < d \? a : d/, 'aConfirmar: a'],
  ['M03 avisa las diferencias negativas',           /porAvisar: a > d \? a - d : 0/, 'porAvisar: a < d ? d - a : 0'],
  ['M04 la diferencia sale al reves',               /diferencia: a - d/, 'diferencia: d - a'],

  // las etapas
  ['M06 cualquier "Pendiente" se da por confirmable', /\/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, '/pendiente/i]'],
  ['M06b se pierde la 43, que es la mayoria del dia',  /, \/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, ']'],
  ['M06c se pierde la 44',                             /\[\/pendiente\\s\+de\\s\+confirmaci\/i, /, '['],
  ['M07 "confirmada" se decide solo por la cantidad', /return n > 0 && !\/\^\\s\*pendiente\/i\.test\(etapaDe\(op\)\);/, 'return n > 0;'],
  ['M08 "confirmada" se decide solo por la etapa',   /return n > 0 && !\/\^\\s\*pendiente\/i\.test\(etapaDe\(op\)\);/, 'return !/^\\s*pendiente/i.test(etapaDe(op));'],
  ['M09 todo se considera transferencia',            /return !n \|\| SERVICIOS_TRANSFERENCIA\.indexOf\(n\) >= 0;/, 'return true;'],
  ['M10 sin el campo operacion se descarta',         /return !n \|\| SERVICIOS_TRANSFERENCIA/, 'return SERVICIOS_TRANSFERENCIA'],
  ['M09b se pierde Trans Diferenciada',              /'transferencias', 'trans diferenciada'\]/, "'transferencias']"],
  ['M09c se pierde el plural, que es el nombre real', /'transferencia', 'transferencias',/, "'transferencia',"],
  ['M09d el servicio no se normaliza a minusculas',  /const n = norm\(op && op\.operacion\)\.toLowerCase\(\);/, 'const n = norm(op && op.operacion);'],
  ['M09e cualquier servicio parecido se cuela',      /SERVICIOS_TRANSFERENCIA\.indexOf\(n\) >= 0;/, "/^trans/i.test(n);"],
  ['M59b la fila pierde el servicio',                /servicio: norm\(op\.operacion\),/, "servicio: '',"],
  ['M11 una operacion nula hace reventar la etapa',  /const etapaDe = \(op\) => String\(\(op && op\.etapaOperacion\) \|\| ''\);/, 'const etapaDe = (op) => String(op.etapaOperacion);'],

  // las citas
  ['M12 cualquier numero se toma como cita',         /match\(\/\\d\{8\}\/g\)/, 'match(/\\d+/g)'],
  ['M13 la cita repetida se cuenta dos veces',       /Array\.from\(new Set\(String\(v \|\| ''\)\.match\(\/\\d\{8\}\/g\) \|\| \[\]\)\)/, "(String(v || '').match(/\\d{8}/g) || [])"],

  // agrupar
  ['M14 el canje se reemplaza en vez de sumarse',    /g\.filas\+\+; g\.total \+= f\.total; g\.malos \+= f\.malos; g\.canje \+= f\.canje;/, 'g.filas++; g.total += f.total; g.malos += f.malos; g.canje = f.canje;'],
  ['M15 el total se reemplaza en vez de sumarse',    /g\.total \+= f\.total/, 'g.total = f.total'],
  ['M16 no cuenta cuantas filas trae la cita',       /g\.filas\+\+;/, ''],
  ['M17 la fecha del grupo es la mas nueva',         /if \(f\.fecha && \(!g\.fecha \|\| f\.fecha < g\.fecha\)\)/, 'if (f.fecha && (!g.fecha || f.fecha > g.fecha))'],
  ['M18 pierde las recepciones',                     /if \(f\.recepcion\) g\.recepciones\.push\(f\.recepcion\);/, ''],

  // clasificar
  ['M19 con varias coincidencias toma la primera',   /if \(exactas\.length === 1\) return \{ estado: 'exacta', ops: exactas \};/, "if (exactas.length >= 1) return { estado: 'exacta', ops: exactas };"],
  ['M20 no busca en la observacion',                 /const porObs = idx\.conObs\.filter\(o => norm\(o\.observacion\)\.indexOf\(grupo\.cita\) >= 0\);/, 'const porObs = [];'],
  ['M21 la observacion tiene que empezar con la cita', /\.indexOf\(grupo\.cita\) >= 0\);/, '.indexOf(grupo.cita) === 0);'],
  ['M22 el indice de observaciones queda al reves',  /if \(norm\(o\.observacion\)\) conObs\.push\(o\);/, 'if (!norm(o.observacion)) conObs.push(o);'],
  ['M23 una cita en dos observaciones se resuelve',  /if \(porObs\.length > 1\) return \{ estado: 'duplicada-observacion', ops: porObs \};/, ''],

  // el .xlsx
  ['M24 salta el encabezado local con los largos del central', /const dato = local \+ 30 \+ ln \+ le;/, 'const dato = local + 30 + nLargo + eLargo;'],
  ['M25 un archivo que no es ZIP pasa callado',      /if \(fin < 0\) throw new Error\('No parece un \.xlsx: no se encontró el final del ZIP'\);/, ''],
  ['M26 busca el directorio central donde no esta',  /let p = dv\.getUint32\(fin \+ 16, true\);/, 'let p = dv.getUint32(fin + 12, true);'],
  ['M27 lo guardado sin comprimir se intenta inflar', /if \(metodo === 0\) return new TextDecoder\(\)\.decode\(u8\);/, ''],
  ['M28 la falta de hoja pasa callada',              /if \(!hoja\) throw new Error\('El archivo no trae hoja de cálculo'\);/, ''],

  // el XML
  ['M29 la columna sale del orden y no de la referencia', /const col = ref \? columnaANumero\(ref\) : celdas\.length;/, 'const col = celdas.length;'],
  ['M30 la columna queda corrida en uno',            /return n - 1;/, 'return n;'],
  ['M31 la referencia se lee con los digitos de la fila', /const letras = String\(ref\)\.replace\(\/\\d\+\/g, ''\);/, 'const letras = String(ref);'],
  ['M32 la columna cuenta en base 10',               /n = n \* 26 \+ /, 'n = n * 10 + '],
  ['M33 la celda autocerrada se muerde con la rama normal', /const reC = \/<c\(\[\^>\]\*\)\\\/>\|<c\(\[\^>\]\*\)>\(\[\\s\\S\]\*\?\)<\\\/c>\/g;/, "const reC = /<c([^>]*)>([\\s\\S]*?)<\\/c>|<c([^>]*)\\/>/g;"],
  ['M33b la celda autocerrada ni se busca',          /\/<c\(\[\^>\]\*\)\\\/>\|<c/, '/<c'],
  ['M34 el texto compartido queda como indice',      /if \(tipo === 's' && mv\) v = sst\[Number\(mv\[1\]\)\];/, "if (tipo === 's' && mv) v = mv[1];"],
  ['M35 los numeros vuelven como texto',             /else if \(mv\) \{ const n = Number\(mv\[1\]\); v = isNaN\(n\) \? desescapar\(mv\[1\]\) : n; \}/, 'else if (mv) { v = mv[1]; }'],
  ['M36 el texto en linea se ignora',                /else if \(tipo === 'inlineStr' && mis\)/, 'else if (false)'],
  ['M37 un texto partido se junta con espacios',     /\.join\(''\)\);\n  \}\n  return out;/, ".join(' '));\n  }\n  return out;"],
  ['M38 el & se desarma primero y rompe lo escapado', /return String\(s\)\.replace\(\/&lt;\/g, '<'\)/, "return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')"],
  ['M39 el desfase del calendario de Excel cambia',  /\(n - 25569\)/, '(n - 25568)'],
  ['M40 el dia de Excel deja de ser un dia',         /\* 86400000\)/, '* 8640000)'],

  // las columnas del reporte
  ['M41 una columna que falta pasa callada',         /if \(i < 0\) throw new Error\('Al reporte le falta la columna "' \+ COLUMNAS\[k\] \+ '"'\);/, ''],
  ['M42 la hoja vacia pasa callada',                 /if \(!matriz\.length\) throw new Error\('La hoja vino vacía'\);/, ''],
  ['M43 el encabezado se lee de la segunda fila',    /const cab = matriz\[0\]\.map/, 'const cab = matriz[1].map'],
  ['M44 el encabezado entra como dato',              /for \(let r = 1; r < matriz\.length; r\+\+\)/, 'for (let r = 0; r < matriz.length; r++)'],
  ['M45 una fila sin cita entra igual',              /if \(!f \|\| f\[idx\.cita\] === null \|\| f\[idx\.cita\] === undefined \|\| f\[idx\.cita\] === ''\) continue;/, 'if (!f) continue;'],
  ['M46 el canje se lee de la columna del total',    /canje: Number\(f\[idx\.canje\]\) \|\| 0/, 'canje: Number(f[idx.total]) || 0'],
  ['M47 el total se lee de la columna del canje',    /total: Number\(f\[idx\.total\]\) \|\| 0/, 'total: Number(f[idx.canje]) || 0'],
  ['M48 el serial de fecha queda como numero crudo', /typeof f\[idx\.cuando\] === 'number' \? serialAFecha\(f\[idx\.cuando\]\) :/, 'false ?  serialAFecha(f[idx.cuando]) :'],

  // el cruce
  ['M48b una cita corta se trata como cita',         /if \(!esCita\(g\.cita\)\) \{ excepciones\.push\([^\n]*?\); return; \}/, ''],
  ['M48c la cita acepta cualquier largo',            /function esCita\(v\) \{ return \/\^\\d\{8\}\$\/\.test\(String\(v \|\| ''\)\); \}/, "function esCita(v) { return /^\\d+$/.test(String(v || '')); }"],
  ['M49 una cita sin coincidencia desaparece',       /if \(c\.estado === 'sin-match'\) \{ excepciones\.push\([^\n]*?\); return; \}/, "if (c.estado === 'sin-match') { return; }"],
  ['M50 con varias operaciones se toma la primera',  /if \(c\.ops\.length !== 1\) \{/, 'if (false) {'],
  ['M51 una anulada se confirma',                    /if \(esAnulada\(op\)\)            \{ excepciones\.push\([^\n]*?\); return; \}/, ''],
  ['M52 lo que no es transferencia se confirma',     /if \(!esTransferencia\(op\)\)     \{/, 'if (false) {'],
  ['M53 una ya confirmada se confirma de nuevo',     /if \(estaConfirmada\(op\)\) \{\n      \/\/ Ya está confirmada/, 'if (false) {\n      // Ya está confirmada'],
  // La reconfirmación: el caso que logística trajo el 10-nov.
  ['M94 una que vuelve con más se da por cerrada',   /if \(rc\.faltan > 0\) \{/, 'if (false) {'],
  ['M95 lo que falta se calcula al revés',           /faltan: objetivo > c \? objetivo - c : 0,/, 'faltan: c > objetivo ? c - objetivo : 0,'],
  ['M96 lo que falta ignora lo ya confirmado',       /faltan: objetivo > c \? objetivo - c : 0,/, 'faltan: objetivo,'],
  ['M97 el objetivo puede pasar lo despachado',      /const objetivo = reglaCantidad\(despachada, recibidaWM\)\.aConfirmar;/, 'const objetivo = Number(recibidaWM) || 0;'],
  ['M98 confirmar de más no se nombra',              /if \(rc\.sobran > 0\) \{/, 'if (false) {'],
  ['M99 confirmada de más se cuenta como que falta', /sobran: c > objetivo \? c - objetivo : 0/, 'sobran: 0'],
  ['M54 el filtro por etapa actua siempre',          /if \(o\.exigirEtapa && !etapaConfirmable\(op\)\) \{/, 'if (!etapaConfirmable(op)) {'],
  ['M55 el filtro por etapa actua al reves',         /if \(o\.exigirEtapa && !etapaConfirmable\(op\)\) \{/, 'if (o.exigirEtapa && etapaConfirmable(op)) {'],
  ['M56 una cantidad cero se confirma',              /if \(!\(r\.aConfirmar > 0\)\)      \{/, 'if (false) {'],
  ['M57 un folio repetido se confirma dos veces',    /if \(vistos\[f\.folio\] > 1\)/, 'if (false)'],
  ['M58 el aviso al cliente se pierde',              /if \(r\.porAvisar > 0\) avisar\.push\(fila\);/, ''],
  ['M59 una ya confirmada deja de avisarse',         /if \(r\.porAvisar > 0\) avisar\.push\(fila\);/, 'if (r.porAvisar > 0 && !estaConfirmada(op)) avisar.push(fila);'],
  ['M60 la lista sale sin ordenar por folio',        /limpias\.sort\(\(a, b\) => Number\(a\.folio\) - Number\(b\.folio\)\);/, ''],
  ['M61 el aviso sale de menor a mayor',             /avisar\.sort\(\(a, b\) => b\.porAvisar - a\.porAvisar\);/, 'avisar.sort((a, b) => a.porAvisar - b.porAvisar);'],
  ['M62 la fila confirmable pierde la etapa',        /folio: op\.nroPedido, etapa: etapaDe\(op\)/, "folio: op.nroPedido, etapa: ''"],
  ['M62b la fila pierde el id del documento',        /docId: op\.formHeaderiD,/, 'docId: null,'],
  ['M62c la fila pierde el cliente de Redlink',      /clienteRedlink: op\.clienteOrigenStr \|\| '',/, "clienteRedlink: '',"],
  ['M63 no cuenta las citas del reporte',            /citas: grupos\.length/, 'citas: 0'],

  // el resumen de excepciones
  ['M63b la excepcion pierde la clave',              /clave: 'ya-confirmada', motivo: 'ya estaba confirmada'/, "motivo: 'ya estaba confirmada'"],
  ['M63c dos familias distintas comparten clave',    /clave: 'anulada', motivo: 'transferencia anulada'/, "clave: 'ya-confirmada', motivo: 'transferencia anulada'"],
  ['M63d el resumen no ordena',                      /\.sort\(\(a, b\) => \(b\.n - a\.n\) \|\| a\.texto\.localeCompare\(b\.texto\)\);/, ';'],
  ['M63e el resumen ordena de menor a mayor',        /\(b\.n - a\.n\) \|\| a\.texto\.localeCompare/, '(a.n - b.n) || a.texto.localeCompare'],
  ['M63f el empate queda al azar',                   /\(b\.n - a\.n\) \|\| a\.texto\.localeCompare\(b\.texto\)/, '(b.n - a.n)'],
  ['M63g el resumen no cuenta, marca presencia',     /cuenta\.set\(k, \(cuenta\.get\(k\) \|\| 0\) \+ 1\);/, 'cuenta.set(k, 1);'],
  ['M63h el resumen muestra la clave cruda',         /texto: FAMILIAS\[clave\] \|\| clave/, 'texto: clave'],

  // la consulta en tramos
  ['M75 los tramos se pisan',                        /const fin = Math\.min\(t \+ \(paso - 1\) \* DIA, d1\.getTime\(\)\);/, 'const fin = Math.min(t + paso * DIA, d1.getTime());'],
  ['M76 no trocea: pide todo de una',                /const paso = Math\.max\(1, parseInt\(dias, 10\) \|\| 5\);/, 'const paso = 99999;'],
  ['M78 el ultimo tramo se pasa de la fecha pedida', /Math\.min\(t \+ \(paso - 1\) \* DIA, d1\.getTime\(\)\)/, 't + (paso - 1) * DIA'],

  ['M79 pegados se dan por solapados',               /String\(a\.desde\) <= String\(b\.hasta\) && String\(b\.desde\) <= String\(a\.hasta\)/, 'String(a.desde) <= String(b.hasta)'],
  ['M80 nunca se solapan',                           /return String\(a\.desde\) <= String\(b\.hasta\)/, 'return false && String(a.desde) <= String(b.hasta)'],
  ['M81 un rango incompleto se da por valido',       /if \(!a \|\| !b \|\| !a\.desde \|\| !a\.hasta \|\| !b\.desde \|\| !b\.hasta\) return false;/, 'if (!a || !b) return false;'],

  // la salida
  ['M64 el csv sale sin encabezado',                 /const out = \['folio;cantRecibida'\];/, 'const out = [];'],
  ['M65 el csv separa con coma',                     /String\(f\.folio\) \+ ';' \+ String\(f\.aConfirmar\)/, "String(f.folio) + ',' + String(f.aConfirmar)"],
  ['M66 el csv corta lineas sin retorno de carro',   /return out\.join\('\\r\\n'\) \+ '\\r\\n';/, "return out.join('\\n') + '\\n';"],
  ['M67 el pegado a Excel separa con punto y coma',  /String\(f\.folio\) \+ '\\t' \+ String\(f\.aConfirmar\)/, "String(f.folio) + ';' + String(f.aConfirmar)"],

  // la ventana
  ['M68 la ventana sale sin margen',                 /const m = Number\.isFinite\(Number\(margen\)\) \? Number\(margen\) : 20;/, 'const m = 0;'],
  ['M69 el margen de atras suma en vez de restar',   /corrido\(fechas\[0\], -m\)/, 'corrido(fechas[0], m)'],
  ['M70 sin fechas inventa una ventana',             /if \(!fechas\.length\) return null;/, ''],
  ['M71 la ventana no ordena las fechas',            /\.filter\(f => \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(f\)\)\.sort\(\);/, '.filter(f => /^\\d{4}-\\d{2}-\\d{2}$/.test(f));'],
  ['M72 la fecha mal escrita entra a la ventana',    /\.filter\(f => \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(f\)\)/, '.filter(f => true)']
];

async function mutar() {
  const fuente = fs.readFileSync(RUTA, 'utf8');
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(cargar(mutado)); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  const N = require(RUTA);
  const r = await correr(N);
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
