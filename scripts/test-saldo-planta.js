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

console.log('\n— la ley del pool: los traspasos netean cero, la produccion mueve el total —');
// Medido contra OINM el 29-10-2026, octubre: traspasos 505.048 de entrada y
// 505.048 de salida, y produccion +3.101. La primera version de este control
// exigia que la suma de TODOS los netos diera cero y marcaba revisar con
// +3.461, que era el dato correcto y el control equivocado.
const LINP=[
  {desde:'RETAIL',hacia:'RT13-100',cantidad:300},   // traspaso: netea cero solo
  {desde:'RT13-102',hacia:'RT13-103',cantidad:100}, // traspaso
  {desde:'RT13-100',hacia:null,cantidad:250},       // salida de mercancias
  {desde:null,hacia:'RT13-102',cantidad:400},       // entrada de mercancias
  {desde:null,hacia:null,cantidad:9},               // ninguna punta es bodega
];
const LEY=S.leyDelPool(LINP);
chk('los traspasos netean cero por construccion', LEY.traspasos===0 && LEY.cumple===true);
chk('y se cuentan', LEY.nTraspaso===2 && LEY.nUnaPunta===2 && LEY.nSinPunta===1, JSON.stringify(LEY));
// la entrada SUMA al pool y la salida RESTA: 400 - 250
chk('la produccion es lo unico que mueve el total', LEY.produccion===150, LEY.produccion);
chk('una entrada sola suma', S.leyDelPool([{desde:null,hacia:'A',cantidad:7}]).produccion===7);
chk('una salida sola resta', S.leyDelPool([{desde:'A',hacia:null,cantidad:7}]).produccion===-7);
chk('una punta en cadena vacia no es bodega',
    S.leyDelPool([{desde:'A',hacia:'',cantidad:7}]).produccion===-7);
chk('sin lineas la ley se cumple', S.leyDelPool([]).cumple===true && S.leyDelPool(null).produccion===0);
chk('una linea nula no se cuenta', S.leyDelPool([null,{desde:'A',hacia:'B',cantidad:1}]).nTraspaso===1);
// una cantidad ilegible no puede contaminar el neto
chk('una cantidad ilegible cuenta como cero',
    S.leyDelPool([{desde:null,hacia:'A',cantidad:'x'}]).produccion===0);

console.log('\n— la cuadratura: el neto por bodega tiene que dar la produccion —');
// ESTE es el control que si puede fallar: si no da, hay una linea leida mal
const NET=[{whs:'RT13-100',neto:50},{whs:'RT13-102',neto:500},{whs:'RT13-103',neto:100},
           {whs:'RETAIL',neto:-300},{whs:'RT13-102b',neto:-200}];
chk('cuadra cuando la suma da la produccion',
    S.cuadraturaDelNeto(NET,{produccion:150}).cuadra===true,
    JSON.stringify(S.cuadraturaDelNeto(NET,{produccion:150})));
const MAL=S.cuadraturaDelNeto(NET,{produccion:0});
chk('no cuadra contra cero, que era la ley vieja', MAL.cuadra===false && MAL.diferencia===150, JSON.stringify(MAL));
chk('y dice cuanto falta', S.cuadraturaDelNeto([{neto:10}],{produccion:4}).diferencia===6);
chk('sin netos la suma es cero', S.cuadraturaDelNeto(null,{produccion:0}).cuadra===true);
chk('sin ley se espera cero', S.cuadraturaDelNeto([{neto:0}],null).cuadra===true);

console.log('\n— el ancla tiene que ser igual o mas nueva que la ultima linea —');
// Visto el 29-10-2026: ancla del 28-10 17:41 con lineas hasta el 29-10. El
// nivel se calcula hacia atras desde el ancla, asi que restar un movimiento
// que el ancla todavia no vio corre TODA la serie.
chk('un ancla mas vieja que la ultima linea no sirve',
    S.anclaAlDia('2026-10-28','2026-10-29').ok===false);
chk('y dice las dos fechas',
    /28.*29|29/.test(S.anclaAlDia('2026-10-28','2026-10-29').motivo) &&
    /toda la serie queda corrida/.test(S.anclaAlDia('2026-10-28','2026-10-29').motivo),
    S.anclaAlDia('2026-10-28','2026-10-29').motivo);
chk('el mismo dia si sirve', S.anclaAlDia('2026-10-29','2026-10-29').ok===true);
chk('un ancla mas nueva si sirve', S.anclaAlDia('2026-10-30','2026-10-29').ok===true);
chk('acepta una marca de tiempo completa', S.anclaAlDia('2026-10-29T14:39:00Z','2026-10-29').ok===true);
chk('sin fecha de lectura no se puede saber', S.anclaAlDia('','2026-10-29').ok===false);
chk('sin lineas no hay con que comparar', S.anclaAlDia('2026-10-28','').ok===true);
chk('una fecha mal escrita no se da por buena', S.anclaAlDia('28-10-2026','2026-10-29').ok===false);

console.log('\n— lo que se escribe en el json —');
// El json lleva SU PROPIO veredicto: sin eso, el aviso se lo lleva la consola
// y el archivo se ve igual de sano. armar-tablero exige ancla_al_dia para
// dibujar, asi que una serie corrida no se publica sola.
const PJ_OK = S.payloadJson({ generado:'2026-10-30T12:00:00Z', anclaLeida:'2026-10-30T11:00:00Z',
  meses:['2026-09','2026-10'], ancla:{ ok:true, motivo:null },
  veredicto:{ nivel:'si', texto:'todo bien' }, indicador:15963, fueraDelIndicador:4389,
  cierreFirme:'2026-10-29', bodegas:[{ whs:'RT13-100' }], cadena:[{ desde:'A' }] });
chk('con el ancla al dia lo declara', PJ_OK.ancla_al_dia === true);
chk('y no pone el aviso', PJ_OK._ojo === null);
chk('lleva el veredicto adentro', PJ_OK.veredicto.nivel === 'si' && PJ_OK.veredicto.texto === 'todo bien');
chk('y los numeros', PJ_OK.indicador === 15963 && PJ_OK.fueraDelIndicador === 4389 &&
    PJ_OK.cierreFirme === '2026-10-29' && PJ_OK.bodegas.length === 1 && PJ_OK.cadena.length === 1);
chk('el ancla que se guarda es la LEIDA, no el resultado del control',
    PJ_OK.ancla === '2026-10-30T11:00:00Z');
const PJ_MAL = S.payloadJson({ ancla:{ ok:false, motivo:'el ancla se leyo el 28 y hay movimiento hasta el 29' },
  veredicto:{ nivel:'revisar', texto:'x' } });
chk('con el ancla corrida lo declara en false', PJ_MAL.ancla_al_dia === false);
chk('y lo grita en _ojo', /SERIE CORRIDA/.test(PJ_MAL._ojo) && /hay movimiento hasta el 29/.test(PJ_MAL._ojo),
    PJ_MAL._ojo);
// sin control de ancla tampoco se declara al dia: fallar cerrado
chk('sin control de ancla no se declara al dia', S.payloadJson({}).ancla_al_dia === false);
chk('sin nada no revienta', S.payloadJson(null).ancla_al_dia === false && S.payloadJson(null).bodegas.length === 0);

console.log('\n— el veredicto —');
const SERIES=[{whs:'A',dias:[{dia:'d',cierre:5}]},{whs:'B',dias:[{dia:'d',cierre:1}]}];
const CUAD_OK={suma:150,esperado:150,diferencia:0,cuadra:true};
const ANC_OK={ok:true,motivo:null};
let v = S.veredicto(SERIES,[],CUAD_OK,ANC_OK);
chk('todo limpio dicta que si', v.nivel==='si', v.nivel);
chk('y dice cuantas bodegas cerro', /2 bodegas de planta/.test(v.texto), v.texto);
v = S.veredicto(SERIES,IMP,CUAD_OK,ANC_OK);
chk('con un nivel imposible manda a revisar', v.nivel==='revisar' && /NEGATIVO/.test(v.texto), v.texto);
chk('y lo nombra con su dia', /RT13-100 \(-1\.250 el 2026-10-26\)/.test(v.texto), v.texto);
// un mensaje que dice CINCO y nombra CUATRO se lee como un error de cuenta
const CINCO = [1,2,3,4,5].map(i => ({ whs:'B'+i, nombre:'x', cierre:-i, dia:'2026-10-0'+i }));
const v5 = S.veredicto(SERIES, CINCO, CUAD_OK, ANC_OK);
chk('si corta la lista dice cuantas quedaron fuera',
    /5 bodega\(s\) con nivel NEGATIVO/.test(v5.texto) && /y 1 mas/.test(v5.texto), v5.texto);
chk('nombra solo las primeras cuatro',
    /B1 /.test(v5.texto) && /B4 /.test(v5.texto) && v5.texto.indexOf('B5 (') < 0, v5.texto);
// con cuatro o menos no sobra ninguna y no se agrega la coletilla
chk('con cuatro no dice que sobren', !/y 0 mas/.test(S.veredicto(SERIES, CINCO.slice(0,4), CUAD_OK, ANC_OK).texto) &&
    !/ mas\./.test(S.veredicto(SERIES, CINCO.slice(0,4), CUAD_OK, ANC_OK).texto),
    S.veredicto(SERIES, CINCO.slice(0,4), CUAD_OK, ANC_OK).texto);
// el nivel negativo esta en SAP, medido contra OINM: decir "falta movimiento"
// manda a buscar donde no hay nada
chk('y no culpa al calculo', /SAP tiene esos dias en negativo/.test(v.texto) &&
    /FECHA del documento/.test(v.texto) && !/falta movimiento/.test(v.texto), v.texto);
v = S.veredicto(SERIES,[],{suma:500,esperado:150,diferencia:350,cuadra:false},ANC_OK);
chk('un descuadre contra la produccion manda a revisar',
    v.nivel==='revisar' && /\+350 sin explicar/.test(v.texto), v.texto);
chk('y dice que eso si es una linea mal leida', /linea leida mal/.test(v.texto), v.texto);
v = S.veredicto(SERIES,[],CUAD_OK,{ok:false,motivo:'el ancla se leyo antes'});
chk('un ancla vieja manda a revisar', v.nivel==='revisar' && /ANCLA/.test(v.texto), v.texto);
chk('sin bodegas no hay veredicto', S.veredicto([],[],CUAD_OK,ANC_OK).nivel==='sin datos');

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
