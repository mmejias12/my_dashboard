'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const S=require('./saldo-planta.js');
const P=require('./saldo-pool.js');

console.log('— que bodegas son de planta —');
const BOD = { generado:'2026-10-28T17:41:00Z', bodegas:[
  {whs:'RETAIL',nombre:'BODEGA RETAILERS',saldo:577927},
  {whs:'CLIENTES',nombre:'BODEGA CLIENTES',saldo:217025},
  {whs:'RT13-100',nombre:'SANTIAGO INSPECCION',saldo:5758},
  {whs:'RT13-266',nombre:'SANTIAGO MERMA',saldo:2620},
  {whs:' RT13-103 ',nombre:'SANTIAGO PINTURA',saldo:2921},
  {whs:'',nombre:'vacia',saldo:9}, null ]};
const PL = S.bodegasDePlanta(BOD);
// planta es "todo lo demas", no una lista: una bodega nueva entra sola
chk('clientes y retail quedan afuera', !PL.some(x=>x.whs==='RETAIL'||x.whs==='CLIENTES'));
chk('el resto entra', PL.length===3, JSON.stringify(PL.map(x=>x.whs)));
chk('marca cuales son del indicador de las nueve',
    PL.find(x=>x.whs==='RT13-100').indicador===true && PL.find(x=>x.whs==='RT13-266').indicador===false);
chk('un codigo con espacios se recorta', PL.some(x=>x.whs==='RT13-103'));
chk('una bodega sin codigo no entra', !PL.some(x=>x.whs===''));
chk('van de mayor a menor, en orden estricto',
    PL.map(x=>x.whs).join(',')==='RT13-100,RT13-103,RT13-266', JSON.stringify(PL.map(x=>x.whs)));
chk('sin json no revienta', S.bodegasDePlanta(null).length===0);

console.log('\n— el movimiento de una bodega, dia por dia —');
const LIN = [
  {DocDate:'2026-10-26',desde:'RETAIL',  hacia:'RT13-100',cantidad:1000},
  {DocDate:'2026-10-26',desde:'RT13-100',hacia:'RT13-103',cantidad:400},
  {DocDate:'2026-10-27',desde:'RETAIL',  hacia:'RT13-100',cantidad:3635},
  {DocDate:'2026-10-27',desde:'RT13-100',hacia:'RT13-100',cantidad:50},   // interno
  {DocDate:'fecha mala',desde:'RETAIL',  hacia:'RT13-100',cantidad:99},
  {DocDate:'2026-10-27',desde:'RT13-102',hacia:'RT13-103',cantidad:1500},
  null,
];
const M = S.movimientoDeBodega(LIN,'RT13-100');
chk('un dia por fecha con movimiento', M.length===2, JSON.stringify(M.map(x=>x.dia)));
chk('lo que entra suma', M[0].entradas===1000 && M[1].entradas===3635);
chk('lo que sale resta', M[0].salidas===400 && M[0].neto===600);
// un traspaso de la bodega a si misma no mueve el nivel: contarlo en entradas
// Y en salidas inflaria las dos columnas sin cambiar el neto
chk('un traspaso interno no ensucia entradas ni salidas',
    M[1].entradas===3635 && M[1].salidas===0 && M[1].neto===3635, JSON.stringify(M[1]));
chk('pero la linea igual se cuenta', M[1].lineas===2);
chk('una fecha mala no entra', !M.some(x=>x.dia==='fecha mala'));
chk('van en orden', M[0].dia < M[1].dia);
// la serie se ordena aunque las lineas vengan al reves
chk('la serie se ordena aunque las lineas lleguen desordenadas',
    S.movimientoDeBodega([{DocDate:'2026-10-27',hacia:'B',cantidad:1},
                          {DocDate:'2026-10-25',hacia:'B',cantidad:1}],'B')
     .map(x=>x.dia).join(',')==='2026-10-25,2026-10-27');
chk('una bodega sin lineas no tiene serie', S.movimientoDeBodega(LIN,'RT99').length===0);
chk('sin bodega no hay serie', S.movimientoDeBodega(LIN,'').length===0 && S.movimientoDeBodega(LIN,null).length===0);
chk('una cantidad ilegible es cero',
    S.movimientoDeBodega([{DocDate:'2026-10-26',desde:'A',hacia:'B',cantidad:'x'}],'B')[0].entradas===0);

console.log('\n— el cierre al termino del dia y la apertura del siguiente —');
// el nivel de hoy es el ancla y se camina hacia atras
const SER = P.cierreDelDia(S.movimientoDeBodega(LIN,'RT13-100'), 5758);
chk('el ultimo cierre es el nivel medido', SER[SER.length-1].cierre===5758);
chk('la apertura de un dia es el cierre del anterior',
    SER[1].apertura===SER[0].cierre, JSON.stringify(SER));
chk('y cada cierre es su apertura mas el neto',
    SER.every(d=>d.cierre===d.apertura+d.neto));

console.log('\n— cual cierre es firme —');
const F = S.marcarFirmes(SER,'2026-10-27T17:41:00Z');
chk('un dia ya pasado cierra firme', F[0].firme===true);
chk('el dia en curso NO es un cierre firme', F[1].firme===false, JSON.stringify(F[1]));
chk('sin fecha de ancla no se afirma nada', S.marcarFirmes(SER,null)[0].firme===null);
chk('no pierde los campos de la serie', F[0].cierre===SER[0].cierre && F[0].apertura===SER[0].apertura);
chk('sin serie no revienta', S.marcarFirmes(null,'2026-10-27').length===0);

console.log('\n— la cadena —');
const CJ = new Set(['RT13-100','RT13-102','RT13-103']);
const C = S.cadenaDePlanta(LIN, CJ);
chk('separa lo que entra, lo de adentro y lo que sale',
    C.entra===4635 && C.adentro===1950 && C.sale===0,
    JSON.stringify({e:C.entra,a:C.adentro,s:C.sale}));
// una linea sin fecha utilizable no puede ir a ningun dia: si la cadena la
// contara y la serie diaria no, los dos totales no cerrarian
chk('una linea sin fecha queda fuera y se cuenta', C.sinFecha===1, String(C.sinFecha));
chk('y no suma en ninguna punta', C.entra===4635);
chk('una arista entre etapas queda como adentro',
    C.aristas.some(a=>a.tipo==='adentro'&&a.desde==='RT13-102'&&a.hacia==='RT13-103'&&a.cantidad===1500));
chk('una arista desde retail queda como entra',
    C.aristas.some(a=>a.tipo==='entra'&&a.desde==='RETAIL'));
chk('lo que no toca la planta no entra',
    !C.aristas.some(a=>a.desde==='CLIENTES'&&a.hacia==='RETAIL'));
chk('la mas grande primero, en orden estricto',
    C.aristas.map(a=>a.cantidad).join(',')==='4635,1500,400,50', JSON.stringify(C.aristas.map(a=>a.cantidad)));
chk('sin conjunto no hay cadena', S.cadenaDePlanta(LIN,null).aristas.length===0);

console.log('\n— un nivel negativo es imposible —');
const IMP = S.nivelesImposibles([
  {whs:'RT13-100',nombre:'INSP',dias:[{dia:'2026-10-26',cierre:-1250},{dia:'2026-10-27',cierre:300}]},
  {whs:'RT13-103',nombre:'PINT',dias:[{dia:'2026-10-26',cierre:5}]} ]);
chk('lo encuentra', IMP.length===1 && IMP[0].whs==='RT13-100', JSON.stringify(IMP));
chk('y dice que dia y cuanto', IMP[0].cierre===-1250 && IMP[0].dia==='2026-10-26');
chk('sin negativos no hay nada', S.nivelesImposibles([{whs:'A',dias:[{dia:'d',cierre:0}]}]).length===0);
chk('un cero no es negativo', S.nivelesImposibles([{whs:'A',dias:[{dia:'d',cierre:0}]}]).length===0);

console.log('\n— el veredicto —');
const SERIES=[{whs:'A',dias:[{dia:'d',cierre:5}]},{whs:'B',dias:[{dia:'d',cierre:1}]}];
const LEY_OK={suma:0,cumple:true,explicadoPorUnaPunta:true};
let v = S.veredicto(SERIES,[],LEY_OK);
chk('todo limpio dicta que si', v.nivel==='si', v.nivel);
chk('y dice cuantas bodegas cerro', /2 bodegas de planta/.test(v.texto), v.texto);
v = S.veredicto(SERIES,IMP,LEY_OK);
chk('con un nivel imposible manda a revisar', v.nivel==='revisar' && /NEGATIVO/.test(v.texto), v.texto);
chk('y lo nombra con su dia', /RT13-100 \(-1\.250 el 2026-10-26\)/.test(v.texto), v.texto);
v = S.veredicto(SERIES,[],{suma:500,cumple:false,explicadoPorUnaPunta:false});
chk('un descuadre sin explicar manda a revisar', v.nivel==='revisar' && /\+500/.test(v.texto), v.texto);
v = S.veredicto(SERIES,[],{suma:500,cumple:false,explicadoPorUnaPunta:true});
chk('un descuadre que explican las lineas de una punta no alarma', v.nivel==='si', v.texto);
chk('sin bodegas no hay veredicto', S.veredicto([],[],LEY_OK).nivel==='sin datos');

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
