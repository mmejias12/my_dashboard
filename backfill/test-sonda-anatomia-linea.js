'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const A=require('./sonda-anatomia-linea.js');

const ITEM = '11111111110';
const linea = (o) => Object.assign({ ItemCode: ITEM, Quantity: 10 }, o);
const asig = (t, q) => ({ BinAbsEntry: 1, Quantity: q, BinActionType: t });

console.log('— la anatomia de una linea —');
let x = A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations:
  [asig('batFromWarehouse', 4), asig('batToWarehouse', 4)] }), ITEM);
chk('una linea con las dos asignaciones aporta', x.aporta === true && x.filas === 2, JSON.stringify(x));
chk('y netea cero', x.neto === 0, String(x.neto));
chk('sin causa cuando aporta', x.causa === null);

// CAMINO MUDO (a): ninguna coleccion matchea RE_BIN
x = A.anatomiaDeLinea(linea({ AlgunaOtraCollection: [{ x: 1 }] }), ITEM);
chk('sin coleccion de ubicacion no aporta', x.aporta === false);
chk('y la causa lo dice', x.causa === 'sin coleccion de ubicacion', String(x.causa));
chk('y arrastra la cantidad de la linea', x.cantidad === 10, String(x.cantidad));
chk('y deja ver que colecciones si traia',
    x.colecciones.indexOf('AlgunaOtraCollection') >= 0, x.colecciones.join());

// CAMINO MUDO (b): la coleccion existe pero viene vacia
x = A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [], Quantity: 300 }), ITEM);
chk('coleccion vacia no aporta', x.aporta === false);
// distinguir (a) de (b) es el punto: una es un bug nuestro y la otra es SAP
chk('y es una causa DISTINTA de no tener coleccion',
    x.causa === 'coleccion vacia', String(x.causa));
chk('con su cantidad', x.cantidad === 300);

// las asignaciones ilegibles son un tercer caso
x = A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [asig('batLoQueSea', 5)] }), ITEM);
chk('asignaciones ilegibles no aportan', x.aporta === false && x.raros === 1);
chk('y tienen causa propia', x.causa === 'todas las asignaciones ilegibles', String(x.causa));

// otro item: no es una perdida, es filtro
x = A.anatomiaDeLinea(linea({ ItemCode: '999', StockTransferLinesBinAllocations: [] }), ITEM);
chk('otro item se marca aparte', x.esDelItem === false && x.causa === 'otro item');
chk('sin item pedido, toda linea es del item', A.anatomiaDeLinea(linea({}), null).esDelItem === true);
// SAP no siempre devuelve el codigo como texto; comparar sin convertir deja
// la linea afuera y el pallet desaparece sin que nadie lo cuente
chk('un ItemCode numerico es el mismo item que el texto',
    A.anatomiaDeLinea({ ItemCode: 11111111110, Quantity: 1 }, ITEM).esDelItem === true);
chk('arrastra las bodegas de la linea',
    A.anatomiaDeLinea(linea({ FromWarehouseCode: 'RT13-105', WarehouseCode: 'RETAIL' }), ITEM)
      .desde === 'RT13-105');
chk('anatomiaDeLinea de nada', A.anatomiaDeLinea(null, ITEM).aporta === false);

console.log('\n— el resumen del dia —');
// el orden de insercion es A PROPOSITO el inverso del ordenado por cantidad,
// y la linea de otro item lleva asignaciones de verdad: si no, no se nota si
// se cuela en el neto
const AN = [
  A.anatomiaDeLinea(linea({ OtraCollection: [{ a: 1 }], Quantity: 50 }), ITEM),
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [asig('batToWarehouse', 7)] }), ITEM),
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [], Quantity: 2000 }), ITEM),
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [], Quantity: 908 }), ITEM),
  A.anatomiaDeLinea(linea({ ItemCode: '999', Quantity: 99,
    StockTransferLinesBinAllocations: [asig('batToWarehouse', 5000)] }), ITEM),
  // otro item que TAMPOCO aporta: si el resumen dejara de filtrar por item,
  // estos 777 se sumarian a los pallets que creemos estar perdiendo
  A.anatomiaDeLinea(linea({ ItemCode: '999', Quantity: 777,
    StockTransferLinesBinAllocations: [] }), ITEM),
  // y otro item con una coleccion sin reconocer: no es un problema nuestro,
  // es otro producto, y no tiene que ensuciar el listado de colecciones
  A.anatomiaDeLinea(linea({ ItemCode: '999', Quantity: 5,
    ColeccionDeOtroItem: [{ a: 1 }] }), ITEM), null ];
const R = A.resumirAnatomia(AN);
chk('cuenta todas las lineas', R.lineas === 7, String(R.lineas));
chk('y las del item', R.delItem === 4, String(R.delItem));
chk('y las que aportan', R.aportan === 1, String(R.aportan));
// ESTE es el numero que se fue a buscar: los pallets que SAP cuenta y nosotros no
chk('suma los pallets de las lineas mudas', R.cantidadMuda === 2958, String(R.cantidadMuda));
chk('y las agrupa por causa', R.mudas.length === 2, JSON.stringify(R.mudas.map(m => m.causa)));
// la causa mas grande primero: es por donde hay que empezar
chk('la causa de mas pallets va primero',
    R.mudas[0].causa === 'coleccion vacia' && R.mudas[0].cantidad === 2908,
    JSON.stringify(R.mudas[0]));
chk('el neto solo cuenta lo que si aporta', R.neto === 7, String(R.neto));
// una linea de otro item NO es una perdida: no tiene que entrar a las mudas
chk('las lineas de otro item no cuentan como mudas aunque no aporten',
    R.lineasMudas === 3 && R.cantidadMuda === 2958, [R.lineasMudas, R.cantidadMuda].join('/'));
chk('resumirAnatomia de nada', A.resumirAnatomia(null).delItem === 0);

console.log('\n— las colecciones que RE_BIN no reconoce —');
// la MENOS frecuente aparece PRIMERO a proposito: si no, quitar el orden por
// frecuencia no rompería nada
const AN2 = [
  A.anatomiaDeLinea(linea({ TerceraCollection: [{ a: 1 }], Quantity: 1 }), ITEM),
  A.anatomiaDeLinea(linea({ OtraCollection: [{ a: 1 }], Quantity: 1 }), ITEM),
  A.anatomiaDeLinea(linea({ OtraCollection: [{ a: 1 }], Quantity: 1 }), ITEM),
  A.anatomiaDeLinea(linea({ OtraCollection: [{ a: 1 }], Quantity: 1 }), ITEM) ];
const NR2 = A.coleccionesNoReconocidas(AN2);
chk('cuenta cuantas veces aparece cada una',
    NR2.find(c => c.clave === 'OtraCollection').n === 3, JSON.stringify(NR2));
// la mas frecuente primero: por ahi se empieza a mirar
chk('y ordena por frecuencia, no por orden de aparicion',
    NR2[0].clave === 'OtraCollection' && NR2[1].clave === 'TerceraCollection',
    NR2.map(c => c.clave).join());
const NR = A.coleccionesNoReconocidas(AN);
chk('nombra la coleccion no reconocida',
    NR.length === 1 && NR[0].clave === 'OtraCollection', JSON.stringify(NR));
// una coleccion RECONOCIDA pero vacia no es un problema de nombre: no va aca
chk('la coleccion vacia pero reconocida no entra',
    !NR.some(c => /BinAllocations/.test(c.clave)), JSON.stringify(NR));
chk('y la coleccion de otro item tampoco',
    !NR.some(c => c.clave === 'ColeccionDeOtroItem'), JSON.stringify(NR));
chk('una linea que aporta no entra', NR.reduce((a, c) => a + c.n, 0) === 1);
chk('coleccionesNoReconocidas de nada', A.coleccionesNoReconocidas(null).length === 0);

console.log('\n— el veredicto —');
let v = A.veredicto(R, NR);
chk('con lineas mudas dicta que no', v.nivel === 'no', v.nivel);
chk('y dice cuantos pallets se pierden', /2.958 pallets que SAP si cuenta/.test(v.texto), v.texto);
chk('y desglosa por causa', /coleccion vacia/.test(v.texto) && /sin coleccion/.test(v.texto), v.texto);
chk('y nombra la coleccion no reconocida', /OtraCollection/.test(v.texto), v.texto);
// cuando NO hay coleccion sin reconocer, el veredicto tiene que decir que
// entonces es SAP y no nosotros: es la conclusion que cambia que se arregla
v = A.veredicto(A.resumirAnatomia([
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [], Quantity: 500 }), ITEM)]), []);
chk('sin colecciones sin reconocer, apunta a SAP y no a nosotros',
    /Ninguna coleccion sin reconocer/.test(v.texto) && /Entonces SAP/.test(v.texto) &&
    /SIN asignarle ubicacion/.test(v.texto) && /por construccion/.test(v.texto), v.texto);
v = A.veredicto(A.resumirAnatomia([
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [asig('batToWarehouse', 1)] }), ITEM)]), []);
chk('sin lineas mudas dicta que si', v.nivel === 'si', v.nivel);
// con documentos sin leer, el numero es una COTA INFERIOR y tiene que decirlo
// ANTES que nada: presentarlo como completo seria peor que no tenerlo
v = A.veredicto(R, NR, 7);
chk('con documentos fallidos avisa que es una cota inferior',
    /COTA INFERIOR/.test(v.texto) && /7 documento/.test(v.texto), v.texto);
chk('y el aviso va al principio, no al final',
    /COTA INFERIOR/.test(v.texto) &&
    v.texto.indexOf('COTA INFERIOR') < v.texto.indexOf('lineas del item'), v.texto.slice(0, 60));
// y si TODO aporta pero hubo fallidos, tampoco se puede dictar que si
v = A.veredicto(A.resumirAnatomia([
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [asig('batToWarehouse', 1)] }), ITEM)]), [], 3);
chk('sin lineas mudas pero con fallidos, no dicta que si',
    v.nivel === 'revisar', v.nivel);
chk('sin fallidos el aviso no aparece', !/COTA INFERIOR/.test(A.veredicto(R, NR, 0).texto));
// tambien en la rama limpia: ahi es MAS importante, porque el texto dice que
// todo aporta y sin el aviso se leeria como que no falta nada
const VL = A.veredicto(A.resumirAnatomia([
  A.anatomiaDeLinea(linea({ StockTransferLinesBinAllocations: [asig('batToWarehouse', 1)] }), ITEM)]), [], 3);
chk('en la rama limpia el aviso tambien va primero',
    /COTA INFERIOR/.test(VL.texto) &&
    VL.texto.indexOf('COTA INFERIOR') < VL.texto.indexOf('aportan filas'), VL.texto.slice(0, 80));
chk('sin lineas del item no hay veredicto',
    A.veredicto(A.resumirAnatomia([]), []).nivel === 'sin datos' &&
    A.veredicto(null, []).nivel === 'sin datos');

console.log('\n— opciones —');
chk('--dia es obligatoria y con valor', A.OPCIONES.indexOf('dia') >= 0);
chk('--item se puede cambiar', A.OPCIONES.indexOf('item') >= 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
