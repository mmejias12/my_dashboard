'use strict';
const A = require('./armar-planta-html.js');
let ok = 0, fail = 0;
const chk = (q, c, extra) => { if (c) { ok++; console.log('  ok   ' + q); }
  else { fail++; console.log('  FALLA ' + q + (extra !== undefined ? '  → ' + extra : '')); } };

console.log('— la planta sale del codigo de bodega —');
chk('RT13 es Santiago', A.plantaDe('RT13-100').nombre === 'Santiago');
chk('RT07 es Talca', A.plantaDe('RT07-120').nombre === 'Talca');
chk('RT04 es Coquimbo', A.plantaDe('RT04-160').nombre === 'Coquimbo');
chk('y el codigo queda aparte del nombre', A.plantaDe('RT13-100').codigo === 'RT13');
// una planta nueva tiene que APARECER, no caer en "otras": si manana hay un
// RT21 la pagina lo muestra con su prefijo y alguien pregunta
chk('un prefijo desconocido sale con su propio codigo',
    A.plantaDe('RT21-900').codigo === 'RT21' && A.plantaDe('RT21-900').nombre === 'RT21');
chk('minuscula igual resuelve', A.plantaDe('rt13-100').codigo === 'RT13');
chk('con espacios igual resuelve', A.plantaDe('  RT07-122 ').codigo === 'RT07');
chk('un codigo sin forma de bodega no inventa planta',
    A.plantaDe('CLIENTES').codigo === '(sin planta)' && A.plantaDe('').codigo === '(sin planta)' &&
    A.plantaDe(null).codigo === '(sin planta)');
// RETAIL no es una planta y no puede colarse como una
chk('RETAIL no es una planta', A.plantaDe('RETAIL').codigo === '(sin planta)');
// el patron esta anclado al principio: un codigo que CONTIENE algo con forma
// de planta pero no empieza asi no es esa planta
chk('el codigo tiene que EMPEZAR con el prefijo',
    A.plantaDe('X-RT13-100').codigo === '(sin planta)', A.plantaDe('X-RT13-100').codigo);

const SER = [
  { whs:'RT13-100', nombre:'SANTIAGO INSPECCION', indicador:true, nivel:5758, dias:[
    { dia:'2026-09-30', apertura:100, entradas:10, salidas:0,  cierre:110, firme:true },
    { dia:'2026-10-26', apertura:1409, entradas:5214, salidas:5007, cierre:1616, firme:true },
    { dia:'2026-10-27', apertura:1616, entradas:3845, salidas:3471, cierre:1990, firme:true },
    { dia:'2026-10-28', apertura:1990, entradas:4411, salidas:643,  cierre:5758, firme:false } ] },
  { whs:'RT13-102', nombre:'SANTIAGO REPARACION', indicador:true, nivel:1178, dias:[
    { dia:'2026-10-26', apertura:3802, entradas:2143, salidas:2602, cierre:3343, firme:true },
    { dia:'2026-10-27', apertura:3343, entradas:1752, salidas:1500, cierre:3595, firme:true } ] },
  { whs:'RT13-266', nombre:'SANTIAGO MERMA', indicador:false, nivel:2620, dias:[
    { dia:'2026-10-27', apertura:2600, entradas:20, salidas:0, cierre:2620, firme:true } ] },
  { whs:'RT13-109', nombre:'SANTIAGO EXTRANOS', indicador:false, nivel:1544, dias:[] },
  { whs:'RT07-120', nombre:'TALCA INSPECCION', indicador:true, nivel:342, dias:[
    { dia:'2026-10-23', apertura:-202, entradas:907, salidas:363, cierre:342, firme:true } ] },
];

console.log('\n— las plantas y los meses que hay —');
const PL = A.plantasDe(SER);
chk('salen las dos plantas', PL.map(p => p.codigo).join(',') === 'RT13,RT07', JSON.stringify(PL));
// la que importa primero, y grande es por STOCK: contar bodegas dejaba Talca
// primera con 727 pallets mientras Santiago tiene 15.751
chk('ordena por stock y no por cantidad de bodegas',
    PL[0].codigo === 'RT13' && PL[0].stock === 5758 + 1178 + 2620 + 1544, JSON.stringify(PL[0]));
chk('cuenta todas sus bodegas, no solo las del indicador', PL[0].bodegas === 4, PL[0].bodegas);
chk('y tambien cuenta las del indicador aparte', PL[0].indicador === 2, PL[0].indicador);
// la prueba que importa: una planta con MAS bodegas pero menos stock va despues
chk('mas bodegas con menos stock no gana',
    A.plantasDe([{ whs:'RT07-1', indicador:true, nivel:10 }, { whs:'RT07-2', indicador:true, nivel:10 },
                 { whs:'RT07-3', indicador:true, nivel:10 }, { whs:'RT13-1', indicador:true, nivel:900 }])
     .map(x => x.codigo).join(',') === 'RT13,RT07');
chk('sin series no hay plantas', A.plantasDe([]).length === 0 && A.plantasDe(null).length === 0);
// una fila sin codigo de bodega no puede inventar una planta "(sin planta)"
chk('una serie sin codigo no crea una planta',
    A.plantasDe([{ nivel:5 }, null, { whs:'RT13-1', nivel:1 }]).map(x => x.codigo).join(',') === 'RT13',
    JSON.stringify(A.plantasDe([{ nivel:5 }, null, { whs:'RT13-1', nivel:1 }])));
const MES = A.mesesDe(SER);
// mas nuevo primero: lo que se abre por defecto es el mes en curso
chk('los meses salen mas nuevo primero', MES.join(',') === '2026-10,2026-09', MES.join(','));
chk('un dia mal escrito no crea un mes',
    A.mesesDe([{ dias:[{ dia:'28-10-2026' }, { dia:'2026-10-01' }] }]).join(',') === '2026-10');
chk('sin dias no hay meses', A.mesesDe([{ whs:'A', dias:[] }]).length === 0);

console.log('\n— los dias de un mes —');
chk('solo los del mes pedido', A.diasDelMes(SER[0], '2026-10').length === 3, A.diasDelMes(SER[0],'2026-10').length);
chk('y el otro mes queda aparte', A.diasDelMes(SER[0], '2026-09').length === 1);
// un mes sin movimiento NO se rellena con un cero: "no movio" y "movio y
// quedo igual" son cosas distintas
chk('un mes sin movimiento da vacio', A.diasDelMes(SER[0], '2026-08').length === 0);
chk('sin serie no revienta', A.diasDelMes(null, '2026-10').length === 0);
// sin mes no pasan TODOS los dias: un mes vacio no es "cualquier mes"
chk('un mes vacio no deja pasar todo',
    A.diasDelMes(SER[0], '').length === 0 && A.diasDelMes(SER[0], null).length === 0,
    A.diasDelMes(SER[0], '').length);

console.log('\n— el cierre firme, que es el numero grande —');
// el dia en curso NO sirve: todavia le pueden entrar movimientos
const F = A.cierreFirme(SER[0], '2026-10');
chk('es el ultimo dia firme y no el ultimo dia', F.dia === '2026-10-27' && F.cierre === 1990, JSON.stringify(F));
chk('sin dias firmes no hay cierre',
    A.cierreFirme({ dias:[{ dia:'2026-10-28', cierre:9, firme:false }] }, '2026-10') === null);
chk('sin mes mira toda la serie', A.cierreFirme(SER[0], null).dia === '2026-10-27');
chk('una bodega sin dias no tiene cierre', A.cierreFirme(SER[3], '2026-10') === null);

console.log('\n— el cierre de un dia es la apertura del siguiente —');
const CA = A.cierreYApertura(SER[1], '2026-10');
chk('devuelve las dos filas', CA.cierre.dia === '2026-10-27' && CA.apertura === null, JSON.stringify(CA));
const CA2 = A.cierreYApertura({ dias:[
  { dia:'2026-10-26', apertura:1409, cierre:1616, firme:true },
  { dia:'2026-10-27', apertura:1616, cierre:1990, firme:false } ] }, '2026-10');
chk('y declara que la igualdad calza', CA2.calza === true && CA2.apertura.dia === '2026-10-27', JSON.stringify(CA2));
// si algun dia deja de calzar tiene que VERSE, no quedar escondida en el calculo
const CA3 = A.cierreYApertura({ dias:[
  { dia:'2026-10-26', apertura:1, cierre:1616, firme:true },
  { dia:'2026-10-27', apertura:999, cierre:2, firme:false } ] }, '2026-10');
chk('y avisa cuando NO calza', CA3.calza === false, JSON.stringify(CA3));
chk('sin cierre firme no hay par', A.cierreYApertura(SER[3], '2026-10') === null);

console.log('\n— el resumen de una planta —');
const R = A.resumenDePlanta(SER, 'RT13', '2026-10');
chk('el numero grande suma solo el indicador', R.indicador === 1990 + 3595, R.indicador);
chk('la merma va fuera del indicador', R.resto === 2620 && R.fuera.length === 1, JSON.stringify(R.fuera));
chk('y el total es la suma de los dos', R.total === 1990 + 3595 + 2620);
chk('no se cuela la otra planta', R.dentro.every(x => x.whs.indexOf('RT13') === 0), JSON.stringify(R.dentro));
chk('el dia del resumen es el mas nuevo de sus cierres', R.dia === '2026-10-27', R.dia);
// una bodega que ese mes no movio NO tiene cierre: meter su nivel de hoy en el
// total seria sumar dos fechas distintas
chk('la bodega sin movimiento queda nombrada aparte',
    R.sinCierre.length === 1 && R.sinCierre[0].whs === 'RT13-109', JSON.stringify(R.sinCierre));
chk('y su nivel NO entra en el total', R.total === 8205, R.total);
chk('lo de dentro sale de mayor a menor',
    R.dentro.map(x => x.whs).join(',') === 'RT13-102,RT13-100', R.dentro.map(x => x.whs).join(','));
chk('otra planta da su propio resumen', A.resumenDePlanta(SER, 'RT07', '2026-10').indicador === 342);
chk('sin planta suma todas', A.resumenDePlanta(SER, null, '2026-10').indicador === 1990 + 3595 + 342);
chk('una planta que no existe da cero', A.resumenDePlanta(SER, 'RT99', '2026-10').total === 0);

console.log('\n— los cierres desparejos se avisan, no se rellenan —');
// sumar el cierre del 27 de una bodega con el del 23 de otra da un numero que
// no existio nunca
const D = A.cierresDesparejos(A.resumenDePlanta(SER, null, '2026-10'));
chk('detecta la bodega que quedo atras',
    D.parejos === false && D.atras.length === 1 && D.atras[0].whs === 'RT07-120', JSON.stringify(D));
chk('y dice de que dia es', D.atras[0].dia === '2026-10-23');
chk('con todos al mismo dia esta parejo', A.cierresDesparejos(A.resumenDePlanta(SER, 'RT13', '2026-10')).parejos === true);
// tambien las de AFUERA del indicador: su cierre tambien aparece en la pagina
// y tambien puede ser de otro dia
chk('una bodega de afuera atrasada tambien se detecta',
    A.cierresDesparejos({ dia:'2026-10-27', dentro:[{ whs:'A', dia:'2026-10-27' }],
                          fuera:[{ whs:'B', dia:'2026-10-20' }] }).atras.map(x => x.whs).join(',') === 'B');
chk('sin resumen no revienta', A.cierresDesparejos(null).parejos === true);

console.log('\n— el nivel de una bodega un dia que no movio —');
// el stock no se evapora porque nadie lo toque
const UNA = { dias:[
  { dia:'2026-10-05', apertura:100, entradas:50, salidas:0, cierre:150, firme:true },
  { dia:'2026-10-09', apertura:150, entradas:0,  salidas:30, cierre:120, firme:true } ] };
chk('el dia que movio da su cierre', A.nivelAlDia(UNA, '2026-10', '2026-10-05') === 150);
chk('un dia posterior sin movimiento arrastra el ultimo cierre',
    A.nivelAlDia(UNA, '2026-10', '2026-10-07') === 150, A.nivelAlDia(UNA,'2026-10','2026-10-07'));
chk('el ultimo dia arrastra hasta fin de mes', A.nivelAlDia(UNA, '2026-10', '2026-10-31') === 120);
// antes de su primer movimiento el nivel es la apertura de ese primer dia:
// es el nivel con que llego al mes
chk('antes del primer movimiento vale la apertura',
    A.nivelAlDia(UNA, '2026-10', '2026-10-01') === 100, A.nivelAlDia(UNA,'2026-10','2026-10-01'));
// una bodega que no movio en el mes NO tiene nivel que afirmar de ese mes
chk('sin movimiento en el mes no hay nivel', A.nivelAlDia({ dias:[] }, '2026-10', '2026-10-05') === null);
chk('sin serie tampoco revienta', A.nivelAlDia(null, '2026-10', '2026-10-05') === null);

console.log('\n— la curva de la planta suma TODAS sus bodegas, no solo las que movieron —');
const SP = A.serieDePlanta(SER, 'RT13', '2026-10');
chk('hay un dia por cada dia con movimiento', SP.length === 3, JSON.stringify(SP.map(x => x.dia)));
chk('el 26 suma las dos', SP[0].dia === '2026-10-26' && SP[0].cierre === 1616 + 3343, JSON.stringify(SP[0]));
chk('y las entradas tambien', SP[0].entradas === 5214 + 2143 && SP[0].salidas === 5007 + 2602);
// ESTA es la que importa: el 28 solo movio RT13-100, pero RT13-102 sigue
// teniendo sus 3.595. Sumar solo lo que movio daba 5.758 en vez de 9.353
chk('un dia en que solo movio una bodega arrastra el nivel de la otra',
    SP[2].dia === '2026-10-28' && SP[2].cierre === 5758 + 3595, JSON.stringify(SP[2]));
// la apertura se despeja del cierre y del movimiento, asi que la igualdad
// cierre(t) = apertura(t+1) se cumple por construccion
chk('el cierre de un dia es la apertura del siguiente',
    SP[1].apertura === SP[0].cierre && SP[2].apertura === SP[1].cierre,
    JSON.stringify(SP.map(x => [x.dia, x.apertura, x.cierre])));
chk('y la apertura nunca sale NaN', SP.every(x => isFinite(x.apertura)), JSON.stringify(SP));
// la merma no entra en la curva del indicador
chk('la merma no entra en la curva', SP[1].cierre === 1990 + 3595, SP[1].cierre);
// un dia es firme para la planta solo si lo es para las bodegas que movieron
chk('un dia en curso contagia a toda la planta', SP[2].firme === false, JSON.stringify(SP[2]));
chk('y los dias cerrados siguen firmes', SP[0].firme === true && SP[1].firme === true);
chk('va en orden de fecha', SP.map(x => x.dia).join(',') === '2026-10-26,2026-10-27,2026-10-28');
// la union de dias de varias bodegas NO viene ordenada sola: si la primera
// bodega movio despues que la segunda, el orden de insercion sale al reves
chk('la union de dias se ordena aunque venga al reves',
    A.serieDePlanta([
      { whs:'RT13-1', indicador:true, nivel:1, dias:[{ dia:'2026-10-27', apertura:0, entradas:1, salidas:0, cierre:1, firme:true }] },
      { whs:'RT13-2', indicador:true, nivel:2, dias:[{ dia:'2026-10-05', apertura:0, entradas:2, salidas:0, cierre:2, firme:true }] }
    ], 'RT13', '2026-10').map(x => x.dia).join(',') === '2026-10-05,2026-10-27',
    A.serieDePlanta([
      { whs:'RT13-1', indicador:true, nivel:1, dias:[{ dia:'2026-10-27', apertura:0, entradas:1, salidas:0, cierre:1, firme:true }] },
      { whs:'RT13-2', indicador:true, nivel:2, dias:[{ dia:'2026-10-05', apertura:0, entradas:2, salidas:0, cierre:2, firme:true }] }
    ], 'RT13', '2026-10').map(x => x.dia).join(','));
chk('sin series la curva es vacia', A.serieDePlanta([], 'RT13', '2026-10').length === 0);
// una bodega sin movimiento en el mes no puede meter un null en la suma
chk('la bodega que no movio no contamina la curva',
    A.serieDePlanta([{ whs:'RT13-1', indicador:true, nivel:9, dias:[] },
                     { whs:'RT13-2', indicador:true, nivel:5, dias:[
                       { dia:'2026-10-05', apertura:0, entradas:5, salidas:0, cierre:5, firme:true }] }],
                    'RT13', '2026-10')[0].cierre === 5);

console.log('\n— las etapas en el orden del recorrido del pallet —');
// alfabetico pondria DISPONIBLE primero, que es el FINAL del recorrido
chk('inspeccion va antes que disponible',
    A.ordenDeEtapa('SANTIAGO INSPECCION') < A.ordenDeEtapa('SANTIAGO DISPONIBLE'));
chk('reparacion va antes que pintura',
    A.ordenDeEtapa('TALCA REPARACION') < A.ordenDeEtapa('TALCA PINTURA'));
chk('pintura va antes que disponible',
    A.ordenDeEtapa('X PINTURA') < A.ordenDeEtapa('X DISPONIBLE'));
// una bodega que no es etapa va al final y conserva su nombre: aparece en vez
// de perderse
chk('una bodega que no es etapa va al final',
    A.ordenDeEtapa('SANTIAGO MERMA') === A.ETAPAS.length &&
    A.ordenDeEtapa('SANTIAGO MERMA') > A.ordenDeEtapa('X DISPONIBLE'));
chk('sin nombre no revienta', A.ordenDeEtapa(null) === A.ETAPAS.length);
const ORD = A.porRecorrido([
  { whs:'RT13-105', nombre:'SANTIAGO DISPONIBLE' },
  { whs:'RT13-100', nombre:'SANTIAGO INSPECCION' },
  { whs:'RT13-266', nombre:'SANTIAGO MERMA' },
  { whs:'RT13-103', nombre:'SANTIAGO PINTURA' },
  { whs:'RT13-102', nombre:'SANTIAGO REPARACION' } ]);
chk('el recorrido completo queda en orden',
    ORD.map(x => x.whs).join(',') === 'RT13-100,RT13-102,RT13-103,RT13-105,RT13-266',
    ORD.map(x => x.whs).join(','));
chk('no muta el arreglo que recibe',
    A.porRecorrido(ORD) !== ORD && A.porRecorrido([]).length === 0);
// la prueba que importa: el orden por codigo de bodega NO basta. Aca
// DISPONIBLE tiene el codigo mas chico y aun asi va al final del recorrido
chk('el recorrido manda sobre el codigo de bodega',
    A.porRecorrido([{ whs:'RT13-001', nombre:'X DISPONIBLE' },
                    { whs:'RT13-999', nombre:'X INSPECCION' }])
     .map(x => x.whs).join(',') === 'RT13-999,RT13-001',
    A.porRecorrido([{ whs:'RT13-001', nombre:'X DISPONIBLE' },
                    { whs:'RT13-999', nombre:'X INSPECCION' }]).map(x => x.whs).join(','));

console.log('\n— la tabla de dias —');
const T = A.tablaDeDias([{ dia:'2026-10-27', apertura:1616, entradas:3845, salidas:3471, cierre:1990, firme:true },
                         { dia:'2026-10-28', apertura:1990, entradas:4411, salidas:643, cierre:-5, firme:false }]);
chk('trae las cinco columnas', /apertura<\/th>/.test(T) && /salidas<\/th>/.test(T) && /cierre<\/th>/.test(T));
chk('los numeros van con separador de miles', /3\.845/.test(T) && /1\.990/.test(T), T.slice(0,200));
// un dia en curso NO puede disfrazarse de cerrado: el cierre todavia se mueve
chk('el dia en curso va marcado', /en curso/.test(T) && (T.match(/en curso/g) || []).length === 1, T);
chk('un cierre negativo va marcado', /class="malo">-5/.test(T), T);
chk('sin dias da una tabla vacia y no revienta', /<tbody><\/tbody>/.test(A.tablaDeDias([])));

console.log('\n— el bloque de una planta —');
const B = A.bloqueDePlanta(SER, 'RT13', '2026-10');
chk('el numero grande es el indicador', /<span class="n">5\.585<\/span>/.test(B), B.slice(0, 400));
chk('y dice de que dia es', /cierre del 2026-10-27/.test(B));
chk('la merma sale fuera del indicador', /Fuera del indicador/.test(B) && /2\.620/.test(B));
// una bodega sin movimiento en el mes NO entra en el total y tiene que decirlo
// merma y extranos son justo las que no mueven todos los meses, y son las dos
// que la gente de planta mira abajo del numero grande: van en el DETALLE con
// su stock de hoy y marcadas, no escondidas en un aviso
chk('la bodega de afuera que no movio va en el detalle y dice que es de hoy',
    /RT13-109/.test(B) && /no movio en 2026-10 · stock de hoy/.test(B) &&
    /stock de <b>hoy<\/b>/.test(B), B);
chk('y NO esta sumada en el numero grande', /<span class="n">5\.585<\/span>/.test(B));
// en cambio una del INDICADOR que no movio si cambia el numero grande, y eso
// tiene que ser un aviso
chk('una del indicador que no movio va como aviso',
    /bodega\(s\) del indicador sin movimiento/.test(
      A.bloqueDePlanta(SER.concat([{ whs:'RT13-900', nombre:'SANTIAGO LAVADO', indicador:true,
                                     nivel:77, dias:[] }]), 'RT13', '2026-10')));
// y al reves: una de AFUERA que no movio no cambia el numero grande, asi que
// NO puede salir como aviso. Un aviso que suena cuando no pasa nada deja de
// leerse el dia que pasa algo
chk('una de afuera que no movio NO sale como aviso',
    !/bodega\(s\) del indicador sin movimiento/.test(B), B.slice(0, 900));
chk('nombra las etapas en orden', B.indexOf('SANTIAGO INSPECCION') < B.indexOf('SANTIAGO REPARACION'));
// en un telefono la tabla se corta por la derecha: la columna que la gente
// mira tiene que quedar pegada al nombre, no al final
chk('el cierre va antes que entro y salio en la tabla de etapas',
    B.indexOf('<th>cierre 2026-10-27</th>') < B.indexOf('<th>entro</th>'), B.slice(400, 700));
chk('las tablas scrollean dentro de su panel y no la pagina',
    (B.match(/class="tscroll"/g) || []).length >= 3, (B.match(/class="tscroll"/g) || []).length);
chk('trae el mes dia por dia', /El mes dia por dia/.test(B));
chk('declara la igualdad cierre-apertura', /apertura del dia siguiente/.test(B));
chk('viene oculto para que lo muestre el selector', /data-planta="RT13" data-mes="2026-10" hidden/.test(B));
chk('no se cuela la otra planta', B.indexOf('RT07-120') < 0, B);
// un par planta+mes sin cierre firme no puede salir con un numero en blanco
const B2 = A.bloqueDePlanta(SER, 'RT13', '2026-08');
chk('sin cierre firme lo dice en vez de mostrar un numero vacio',
    /Sin cierre firme/.test(B2) && !/class="n"/.test(B2), B2);

// Coquimbo es una sola bodega de transito y ninguna entra al indicador: un
// "0" en grande es verdad y no significa nada
const SOLOFUERA = [{ whs:'RT04-160', nombre:'COQUIMBO TRANSITO', indicador:false, nivel:225, dias:[
  { dia:'2026-10-26', apertura:225, entradas:266, salidas:266, cierre:225, firme:true }] }];
const B3 = A.bloqueDePlanta(SOLOFUERA, 'RT04', '2026-10');
chk('una planta sin bodegas del indicador no muestra un cero en grande',
    /<span class="n">225<\/span>/.test(B3) && !/<span class="n">0<\/span>/.test(B3), B3.slice(0, 400));
chk('y explica por que va aparte', /no tiene bodegas dentro del indicador/.test(B3));

console.log('\n— la pagina completa —');
const P = A.armar({ bodegas: SER, ancla:'2026-10-28T17:41:48.489Z', generado:'2026-10-29T15:00:00Z',
                    meses:['2026-09','2026-10'] });
chk('es un html completo', /^<!doctype html>/.test(P) && /<\/html>$/.test(P));
chk('declara el charset y el viewport', /charset="utf-8"/.test(P) && /width=device-width/.test(P));
chk('trae los dos selectores', /id="sel-planta"/.test(P) && /id="sel-mes"/.test(P));
chk('las dos plantas estan en el selector', /Santiago/.test(P) && /Talca/.test(P));
chk('el mes mas nuevo va primero en el selector',
    P.indexOf('<option value="2026-10">') < P.indexOf('<option value="2026-09">'));
// un bloque por cada par: la pagina NO hace fetch, asi que todo va embebido
chk('hay un bloque por cada planta y mes',
    (P.match(/class="bloque"/g) || []).length === 4, (P.match(/class="bloque"/g) || []).length);
chk('no hace fetch de nada', !/fetch\(/.test(P) && !/XMLHttpRequest/.test(P));
chk('no usa almacenamiento del navegador', !/localStorage/.test(P) && !/sessionStorage/.test(P));
chk('el tema oscuro esta declarado dos veces, por media y por atributo',
    /prefers-color-scheme:dark/.test(P) && /\[data-theme="dark"\]/.test(P));
chk('el body trae fondo propio', /body\{background:var\(--bg\)/.test(P));
chk('el pie dice de cuando es el ancla', /2026-10-28T17:41/.test(P));
chk('y avisa de donde viene un nivel negativo', /fecha del documento en SAP/.test(P));
// sin datos la pagina tiene que DECIRLO y dar el comando, no salir en blanco
const V = A.armar({ bodegas: [] });
chk('sin datos lo dice y da el comando',
    /Sin datos/.test(V) && /saldo-planta\.js/.test(V) && /<\/html>$/.test(V), V.slice(-300));
chk('sin nada tampoco revienta', /Sin datos/.test(A.armar(null)));
// el escape importa: el nombre de bodega viene de SAP
chk('el nombre de bodega va escapado',
    /&lt;b&gt;/.test(A.bloqueDePlanta([{ whs:'RT13-100', nombre:'<b>x', indicador:true, nivel:1,
      dias:[{ dia:'2026-10-27', apertura:0, entradas:1, salidas:0, cierre:1, firme:true }] }],
      'RT13', '2026-10')));

console.log('\n' + ok + ' ok, ' + fail + ' fallas\n');
process.exit(fail ? 1 : 0);
