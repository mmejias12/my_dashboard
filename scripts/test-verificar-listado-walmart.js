#!/usr/bin/env node
// ============================================================================
//  scripts/test-verificar-listado-walmart.js
//
//  Pruebas de scripts/verificar-listado-walmart.js, con arnés de mutaciones.
//  Lo que se está protegiendo acá no es un informe: es la lista de folios que
//  alguien va a pegar en un Excel que mueve inventario en SAP. Una fila de más
//  es un ajuste que no correspondía.
//
//    node scripts/test-verificar-listado-walmart.js
//    node scripts/test-verificar-listado-walmart.js --mutaciones
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, 'verificar-listado-walmart.js');

function cargar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const OPS = [
  { nroPedido: 4138211, cantidadDespachada: 16, cantidadConfirmada: 0,  etapaOperacion: 'Pendiente de Confirmacion' },
  { nroPedido: 4138273, cantidadDespachada: 10, cantidadConfirmada: 10, etapaOperacion: 'Transferencia Confirmada' },
  { nroPedido: 4138310, cantidadDespachada: 5,  cantidadConfirmada: 0,  etapaOperacion: 'Pendiente de Confirmacion' },
  { nroPedido: 4138999, cantidadDespachada: 9,  cantidadConfirmada: 0,  etapaOperacion: 'Pendiente de Confirmacion' },
  { nroPedido: 4138999, cantidadDespachada: 9,  cantidadConfirmada: 0,  etapaOperacion: 'Pendiente de Confirmacion' }
];

function correr(S) {
  ok = 0; fallos = [];

  /* ---- lectura del CSV, que puede volver editado a mano -------------------- */

  prueba('T01 lee el csv que escribimos, con punto y coma', () => {
    const r = S.leerListado('folio;cantRecibida\r\n4138211;16\r\n4138273;10\r\n');
    igual(r.filas, [{ folio: 4138211, cantRecibida: 16 }, { folio: 4138273, cantRecibida: 10 }]);
    igual(r.malas, []);
  });
  prueba('T02 aguanta coma y tabulación, que es como vuelve de Excel', () => {
    igual(S.leerListado('4138211,16').filas, [{ folio: 4138211, cantRecibida: 16 }]);
    igual(S.leerListado('4138211\t16').filas, [{ folio: 4138211, cantRecibida: 16 }]);
  });
  prueba('T03 salta el encabezado aunque esté o no esté', () => {
    igual(S.leerListado('folio;cantRecibida\n4138211;16').filas.length, 1);
    igual(S.leerListado('4138211;16').filas.length, 1, 'sin encabezado también:');
  });
  prueba('T04 una línea que no se entiende NO se adivina, se nombra', () => {
    const r = S.leerListado('4138211;16\nbasura\n;;\n4138273;diez');
    igual(r.filas.length, 1);
    igual(r.malas.length, 3, 'tres líneas rotas tienen que salir las tres');
    cierto(r.malas[0].linea === 2, 'con su número de línea');
  });
  prueba('T05 no acepta un folio que no es un número', () => {
    igual(S.leerListado('41A8211;16').filas, [], 'un folio con letra confirmaría otra cosa');
  });
  prueba('T06 no acepta una cantidad negativa ni decimal', () => {
    igual(S.leerListado('4138211;-5').filas, []);
    igual(S.leerListado('4138211;1.5').filas, []);
  });
  prueba('T07 líneas vacías y espacios no ensucian el resultado', () => {
    const r = S.leerListado('\n  \n 4138211 ; 16 \n\n');
    igual(r.filas, [{ folio: 4138211, cantRecibida: 16 }]);
    igual(r.malas, []);
  });
  prueba('T08 un archivo vacío no revienta', () => {
    igual(S.leerListado(''), { filas: [], malas: [] });
    igual(S.leerListado(null), { filas: [], malas: [] });
  });

  /* ---- el veredicto ------------------------------------------------------- */

  prueba('T09 una pendiente con la cantidad que calza se confirma', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 16 }], OPS);
    igual(r[0].veredicto, 'confirmar');
  });
  prueba('T10 una YA confirmada se saca del listado', () => {
    const r = S.verificar([{ folio: 4138273, cantRecibida: 10 }], OPS);
    igual(r[0].veredicto, 'yaConfirmada', 'pegarla de nuevo seria un segundo ajuste en SAP');
  });
  prueba('T10b una ANULADA no se rotula como que espera algo', () => {
    const ops = [{ nroPedido: 1, cantidadDespachada: 19, cantidadConfirmada: 0,
                   etapaOperacion: 'Transferencia Anulada', operacion: 'Transferencias' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops)[0].veredicto, 'anulada',
      'una anulada no espera ningun respaldo');
  });
  prueba('T10d una operacion que no es transferencia se nombra como tal', () => {
    const ops = [{ nroPedido: 1, cantidadDespachada: 4, cantidadConfirmada: 0,
                   etapaOperacion: 'Confirma Relocaliza', operacion: 'Relocalizacion' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 4 }], ops)[0].veredicto, 'noEsTransferencia',
      'la cita cayo en otra cosa: no es un problema de etapa');
  });
  prueba('T10e la 43 pasa aunque se exija etapa: el camino masivo la confirma', () => {
    // Resuelto por Marcelo el 9-nov-2026: en las confirmaciones masivas de
    // Walmart no corresponde adjuntar respaldo. Antes de eso esta prueba
    // esperaba lo contrario, y la bandera habria sacado la mayor parte del dia.
    const ops = [{ nroPedido: 1, cantidadDespachada: 19, cantidadConfirmada: 0,
                   etapaOperacion: 'Pendiente Adjuntar Respaldo', operacion: 'Transferencias' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops)[0].veredicto, 'confirmar');
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops, true)[0].veredicto, 'confirmar',
      'la bandera ya no la deja afuera');
  });
  prueba('T10e2 la bandera sigue sirviendo, y sigue siendo opcional', () => {
    const ops = [{ nroPedido: 1, cantidadDespachada: 19, cantidadConfirmada: 0,
                   etapaOperacion: 'Transferencia Reconfirmada', operacion: 'Transferencias' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops)[0].veredicto, 'confirmar',
      'sin la bandera no filtra por etapa');
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops, true)[0].veredicto, 'etapaNoConfirmable');
  });
  prueba('T10c las DOS etapas pendientes son confirmables, y nada mas', () => {
    cierto(S.etapaConfirmable({ etapaOperacion: 'Pendiente de Confirmacion' }));
    cierto(S.etapaConfirmable({ etapaOperacion: 'PENDIENTE DE CONFIRMACIÓN' }));
    cierto(S.etapaConfirmable({ etapaOperacion: 'Pendiente Adjuntar Respaldo' }));
    falso(S.etapaConfirmable({ etapaOperacion: 'Pendiente' }), 'empezar con la palabra no alcanza');
    falso(S.etapaConfirmable({ etapaOperacion: 'Pendiente de Aprobacion' }));
    falso(S.etapaConfirmable({ etapaOperacion: 'Transferencia Confirmada' }));
    falso(S.etapaConfirmable({}));
  });
  prueba('T10f "Trans Diferenciada" es del circuito; los otros servicios no', () => {
    cierto(S.esTransferencia({ operacion: 'Trans Diferenciada' }));
    cierto(S.esTransferencia({ operacion: 'Transferencias' }));
    ['Relocalizacion', 'Traspasos', 'Devolucion', 'Emision', 'Retiro',
     'Trans Expresa', 'Transporte'].forEach(function (o) {
      falso(S.esTransferencia({ operacion: o }), o + ' no es del circuito');
    });
    const ops = [{ nroPedido: 1, cantidadDespachada: 19, cantidadConfirmada: 0,
                   etapaOperacion: 'Pendiente Adjuntar Respaldo', operacion: 'Trans Diferenciada' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 3 }], ops)[0].veredicto, 'confirmar');
  });

  prueba('T11 un folio que no aparece no se da por bueno', () => {
    igual(S.verificar([{ folio: 777, cantRecibida: 3 }], OPS)[0].veredicto, 'noAparece');
  });
  prueba('T12 un folio que cae en varias operaciones no se elige al azar', () => {
    const r = S.verificar([{ folio: 4138999, cantRecibida: 9 }], OPS);
    igual(r[0].veredicto, 'duplicada');
    igual(r[0].operaciones, 2);
  });
  prueba('T13 si lo despachado bajó, la cantidad se recalcula, no se recorta sola', () => {
    const r = S.verificar([{ folio: 4138310, cantRecibida: 8 }], OPS);
    igual(r[0].veredicto, 'recalcular', 'pedia 8 y ahora solo hay 5 despachados');
  });
  prueba('T14 confirmar menos de lo despachado sigue siendo válido', () => {
    igual(S.verificar([{ folio: 4138211, cantRecibida: 10 }], OPS)[0].veredicto, 'confirmar');
  });
  prueba('T15 una etapa "Pendiente" con cantidad confirmada > 0 no cuenta como confirmada', () => {
    const ops = [{ nroPedido: 1, cantidadDespachada: 5, cantidadConfirmada: 5, etapaOperacion: 'Pendiente de Confirmacion' }];
    igual(S.verificar([{ folio: 1, cantRecibida: 5 }], ops)[0].veredicto, 'confirmar',
      'la etapa manda: ya nos equivocamos una vez con la fecha');
  });
  prueba('T16 cantidad confirmada en cero con etapa confirmada tampoco cuenta', () => {
    const ops = [{ nroPedido: 1, cantidadDespachada: 5, cantidadConfirmada: 0, etapaOperacion: 'Transferencia Confirmada' }];
    igual(S.estaConfirmada(ops[0]), false, 'hacen falta las DOS señales');
  });
  prueba('T17 el veredicto conserva lo necesario para entenderlo', () => {
    const r = S.verificar([{ folio: 4138273, cantRecibida: 10 }], OPS)[0];
    igual([r.despachada, r.confirmada, r.etapa], [10, 10, 'Transferencia Confirmada']);
  });
  prueba('T18 sin operaciones, nada se da por confirmable', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 16 }], []);
    igual(r[0].veredicto, 'noAparece', 'una consulta vacía no autoriza nada');
  });
  prueba('T19 una operación sin folio no entra al índice', () => {
    const sucias = [{ nroPedido: null, cantidadDespachada: 9, cantidadConfirmada: 0, etapaOperacion: 'Pendiente' },
                    { nroPedido: '', cantidadDespachada: 9, cantidadConfirmada: 0, etapaOperacion: 'Pendiente' },
                    { nroPedido: 'DJWC13', cantidadDespachada: 9, cantidadConfirmada: 0, etapaOperacion: 'Pendiente' }];
    igual(S.verificar([{ folio: 4138211, cantRecibida: 16 }], sucias)[0].veredicto, 'noAparece');
    // null y '' se vuelven 0 al convertirlos: sin la guarda quedarían todas
    // apiladas bajo el folio 0, y ahí el veredicto saldría de basura.
    igual(S.verificar([{ folio: 0, cantRecibida: 1 }], sucias)[0].veredicto, 'noAparece',
      'una operación sin folio no puede terminar indexada bajo el folio 0:');
  });

  /* ---- las filas con diferencia, que son las de riesgo -------------------- */

  prueba('T24 separa las que confirman menos de lo despachado', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 10 }, { folio: 4138310, cantRecibida: 5 }], OPS);
    const d = S.conDiferencia(r);
    igual(d.length, 1, 'solo la de 10 contra 16 despachados');
    igual(d[0].folio, 4138211);
  });
  prueba('T25 una que confirma todo lo despachado NO es de riesgo', () => {
    igual(S.conDiferencia(S.verificar([{ folio: 4138310, cantRecibida: 5 }], OPS)), []);
  });
  prueba('T26 una ya confirmada no entra entre las de diferencia', () => {
    // Ya salio del listado por otro motivo: contarla acá la haria aparecer dos
    // veces en el informe y nadie sabria cual de los dos avisos atender.
    const r = S.verificar([{ folio: 4138273, cantRecibida: 3 }], OPS);
    igual(S.conDiferencia(r), []);
  });
  prueba('T27 una que hay que recalcular tampoco', () => {
    igual(S.conDiferencia(S.verificar([{ folio: 4138310, cantRecibida: 99 }], OPS)), []);
  });
  prueba('T28 sin filas no inventa diferencias', () => {
    igual(S.conDiferencia([]), []);
    igual(S.conDiferencia(null), []);
  });

  /* ---- la salida ---------------------------------------------------------- */

  prueba('T20 la salida lleva SOLO las que hay que confirmar', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 16 }, { folio: 4138273, cantRecibida: 10 },
                           { folio: 777, cantRecibida: 3 }], OPS);
    igual(S.csvDelVerificado(r), 'folio;cantRecibida\r\n4138211;16\r\n');
  });
  prueba('T29 con --sin-diferencia la salida deja fuera las discutibles', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 10 },   // 16 despachados: diferencia
                           { folio: 4138310, cantRecibida: 5 }], OPS);  // 5 de 5: limpia
    igual(S.csvDelVerificado(r, { sinDiferencia: true }), 'folio;cantRecibida\r\n4138310;5\r\n');
    igual(S.csvDelVerificado(r), 'folio;cantRecibida\r\n4138211;10\r\n4138310;5\r\n',
      'sin la bandera salen las dos, que es lo que pidio Marcelo');
  });
  prueba('T30 el archivo de revisión lleva el detalle para decidir', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 10 }, { folio: 4138310, cantRecibida: 5 }], OPS);
    igual(S.csvParaRevisar(r), 'folio;despachada;aConfirmar;porInformar\r\n4138211;16;10;6\r\n');
  });
  prueba('T31 sin filas con diferencia el archivo de revisión va vacío pero con encabezado', () => {
    const r = S.verificar([{ folio: 4138310, cantRecibida: 5 }], OPS);
    igual(S.csvParaRevisar(r), 'folio;despachada;aConfirmar;porInformar\r\n');
  });

  prueba('T21 una salida vacía igual lleva encabezado', () => {
    igual(S.csvDelVerificado([]), 'folio;cantRecibida\r\n');
    igual(S.csvDelVerificado(null), 'folio;cantRecibida\r\n');
  });
  prueba('T22 el resumen cuenta cada veredicto', () => {
    const r = S.verificar([{ folio: 4138211, cantRecibida: 16 }, { folio: 4138273, cantRecibida: 10 },
                           { folio: 777, cantRecibida: 3 }], OPS);
    igual(S.resumen(r), { confirmar: 1, yaConfirmada: 1, noAparece: 1 });
  });
  prueba('T23 todo veredicto tiene su texto, para que nadie lea una clave suelta', () => {
    const claves = ['confirmar', 'recalcular', 'yaConfirmada', 'noAparece', 'duplicada'];
    claves.forEach(k => cierto(S.VEREDICTOS[k] && S.VEREDICTOS[k].length > 8, 'falta el texto de ' + k));
    cierto(/YA fue confirmada/.test(S.VEREDICTOS.yaConfirmada), 'el más importante tiene que gritar');
  });

  return { ok: ok, fallos: fallos };
}

const MUTACIONES = [
  ['M29 el filtro por etapa actua siempre',           /if \(exigirEtapa && !etapaConfirmable\(op\)\)/, 'if (!etapaConfirmable(op))'],
  ['M31 una anulada se trata como pendiente',         /if \(esAnulada\(op\)\) return Object\.assign\(base, \{ veredicto: 'anulada' \}\);/, ''],
  ['M32 una no-transferencia pasa como confirmable',  /if \(op\.operacion && !esTransferencia\(op\)\)/, 'if (false)'],
  ['M30 cualquier etapa pendiente se da por confirmable', /\/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, '/pendiente/i]'],
  ['M30b se pierde la 43, que es la mayoria del dia',  /, \/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, ']'],
  ['M30c se pierde la 44',                             /\[\/pendiente\\s\+de\\s\+confirmaci\/i, /, '['],
  ['M32b se pierde Trans Diferenciada',                /'transferencias', 'trans diferenciada'\]/, "'transferencias']"],
  ['M32c cualquier servicio parecido se cuela',        /SERVICIOS_TRANSFERENCIA\.indexOf\(n\) >= 0;/, "/^trans/i.test(n);"],
  ['M01 una ya confirmada pasa a confirmable',        /if \(estaConfirmada\(op\)\) return Object\.assign\(base, \{ veredicto: 'yaConfirmada' \}\);/, ''],
  ['M02 la etapa deja de pesar en "confirmada"',      /return n > 0 && !\/\^\\s\*pendiente\/i\.test\(String\(\(op && op\.etapaOperacion\) \|\| ''\)\);/, 'return n > 0;'],
  ['M03 la cantidad deja de pesar en "confirmada"',   /const n = Number\(op && op\.cantidadConfirmada\) \|\| 0;\n  return n > 0/, "const n = 1;\n  return n > 0"],
  ['M04 un folio ausente se da por confirmable',      /if \(!ops\.length\)     return Object\.assign\(\{\}, l, \{ veredicto: 'noAparece' \}\);/, ''],
  ['M05 un folio duplicado se resuelve tomando el primero', /if \(ops\.length > 1\)  return Object\.assign\(\{\}, l, \{ veredicto: 'duplicada', operaciones: ops\.length \}\);/, ''],
  ['M06 pedir más de lo despachado deja de avisar',   /if \(l\.cantRecibida > desp\) return Object\.assign\(base, \{ veredicto: 'recalcular' \}\);/, ''],
  ['M07 pedir lo justo se marca como recalcular',     /if \(l\.cantRecibida > desp\)/, 'if (l.cantRecibida >= desp)'],
  ['M08 la salida incluye todo, no sólo lo confirmable', /\.filter\(f => f\.veredicto === 'confirmar'\)/, '.filter(f => true)'],
  ['M09 la salida pierde el encabezado',              /const out = \['folio;cantRecibida'\];/, 'const out = [];'],
  ['M10 el csv separa con coma',                      /out\.push\(String\(f\.folio\) \+ ';' \+ String\(f\.cantRecibida\)\)/, "out.push(String(f.folio) + ',' + String(f.cantRecibida))"],
  ['M11 una línea rota del csv se adivina',           /if \(!\/\^\\d\+\$\/\.test\(folio\) \|\| !\/\^\\d\+\$\/\.test\(cant\)\) \{/, 'if (false) {'],
  ['M12 el folio acepta letras',                      /!\/\^\\d\+\$\/\.test\(folio\)/, '!/^.+$/.test(folio)'],
  ['M13 la cantidad acepta decimales',                /!\/\^\\d\+\$\/\.test\(cant\)/, '!/^[\\\\d.]+$/.test(cant)'],
  ['M14 el encabezado se procesa como fila',          /if \(\/\^folio\\s\*\[;,\\t\]\/i\.test\(t\)\) return;/, ''],
  ['M15 las líneas rotas no se cuentan',              /malas\.push\(\{ linea: i \+ 1, texto: t\.slice\(0, 60\) \}\);/, ''],
  ['M16 el número de línea sale corrido',             /malas\.push\(\{ linea: i \+ 1,/, 'malas.push({ linea: i,'],
  ['M17 el veredicto pierde el detalle',              /despachada: desp,\n      confirmada: Number\(op\.cantidadConfirmada\) \|\| 0,\n      etapa: op\.etapaOperacion \|\| ''/, "despachada: null,\n      confirmada: null,\n      etapa: ''"],
  ['M18 el resumen no cuenta',                        /c\[f\.veredicto\] = \(c\[f\.veredicto\] \|\| 0\) \+ 1;/, ''],
  ['M19 el texto del veredicto grave se suaviza',     /yaConfirmada: 'YA fue confirmada — sacar del listado',/, "yaConfirmada: 'confirmada',"],
  ['M20 una operación sin folio entra al índice',     /if \(!Number\.isFinite\(f\) \|\| f <= 0\) return;/, ''],
  ['M25 --sin-diferencia no filtra nada',             /\.filter\(f => !o\.sinDiferencia \|\| f\.cantRecibida === f\.despachada\)/, '.filter(f => true)'],
  ['M26 --sin-diferencia filtra al reves',            /!o\.sinDiferencia \|\| f\.cantRecibida === f\.despachada/, '!o.sinDiferencia || f.cantRecibida !== f.despachada'],
  ['M27 el archivo de revision pierde el encabezado', /const out = \['folio;despachada;aConfirmar;porInformar'\];/, 'const out = [];'],
  ['M28 el por informar sale al reves',               /f\.despachada - f\.cantRecibida\]\.join\(';'\)/, "f.cantRecibida - f.despachada].join(';')"],
  ['M22 las de diferencia no se separan',             /f\.veredicto === 'confirmar' && f\.cantRecibida !== f\.despachada/, 'false'],
  ['M23 toda fila cuenta como de diferencia',         /f\.veredicto === 'confirmar' && f\.cantRecibida !== f\.despachada/, 'true'],
  ['M24 las ya confirmadas entran entre las de diferencia', /f\.veredicto === 'confirmar' && f\.cantRecibida !== f\.despachada/, 'f.cantRecibida !== f.despachada'],
  ['M21 un folio nulo se indexa bajo cero',           /if \(!Number\.isFinite\(f\) \|\| f <= 0\) return;/, 'if (!Number.isFinite(f)) return;']
];

function mutar() {
  const fuente = fs.readFileSync(RUTA, 'utf8');
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try { r = correr(cargar(mutado)); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

const S = require(RUTA);
const r = correr(S);
console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
for (const f of r.fallos) console.log('  FALLA ' + f);

if (!r.fallos.length || process.argv.indexOf('--mutaciones') >= 0) {
  const m = mutar();
  console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
  for (const n of m.noAplican) console.log('  NO APLICA  ' + n);
  for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n);
  if (m.vivas.length || m.noAplican.length) process.exit(1);
}
process.exit(r.fallos.length ? 1 : 0);
