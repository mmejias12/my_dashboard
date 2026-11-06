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

console.log('\n— un documento con fecha futura NO corre la serie —');
/*  Esta prueba decia lo contrario hasta el 2-11-2026. El razonamiento era que
 *  restar del ancla un movimiento que el ancla todavia no habia visto corria
 *  toda la serie, y es cierto para un movimiento posteado DESPUES de leer el
 *  ancla. Pero la prueba no miraba eso: miraba la FECHA del documento, y el
 *  InStock de SAP no la mira —cuenta el movimiento apenas se contabiliza—.
 *  Ese dia una salida de 2 pallets fechada al dia siguiente marco la serie
 *  como corrida y dejo la distribucion diaria en blanco en las dos paginas;
 *  comprobado bodega por bodega, el ultimo cierre de cada una era exactamente
 *  su InStock. Lo que de verdad protege es cierraEnElAncla(), en
 *  armar-tablero-stock, que compara los cierres contra el saldo vivo. */
const FUT = S.anclaAlDia('2026-10-28','2026-10-29');
chk('una linea fechada despues del ancla no invalida la serie', FUT.ok===true, JSON.stringify(FUT));
chk('pero queda marcada como anomalia', FUT.futuro===true);
chk('y el motivo manda a mirar SAP, no el calculo',
    /fecha posterior a hoy/.test(FUT.motivo) && /la serie esta bien/i.test(FUT.motivo), FUT.motivo);
chk('el mismo dia si sirve', S.anclaAlDia('2026-10-29','2026-10-29').ok===true);
chk('un ancla mas nueva si sirve', S.anclaAlDia('2026-10-30','2026-10-29').ok===true);
chk('acepta una marca de tiempo completa', S.anclaAlDia('2026-10-29T14:39:00Z','2026-10-29').ok===true);
chk('sin fecha de lectura no se puede saber', S.anclaAlDia('','2026-10-29').ok===false);
chk('sin lineas no hay con que comparar', S.anclaAlDia('2026-10-28','').ok===true);
// una corrida normal no lleva la marca de anomalia
chk('sin fecha futura no se marca nada', S.anclaAlDia('2026-10-29','2026-10-29').futuro===undefined);
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


console.log('\n— una apertura negativa es imposible, y no es lo mismo que un cierre negativo —');
const dia2=(d,ap,e,sa,ci)=>({dia:d,apertura:ap,entradas:e,salidas:sa,cierre:ci,firme:true});
const SERAP=[
  {whs:'RT13-100',nombre:'SANTIAGO INSPECCION',dias:[
    dia2('2026-10-01',-3334,4457,4279,-3156), dia2('2026-10-02',-3156,3679,5355,-4832)]},
  {whs:'RT13-102',nombre:'SANTIAGO REPARACION',dias:[
    dia2('2026-10-01',4300,100,0,4400)]},
  {whs:'RT07-126',nombre:'TALCA TRANSITO',dias:[
    dia2('2026-10-09',-40,0,0,-40)]},
];
const AP=S.aperturasImposibles(SERAP);
chk('encuentra las que abren bajo cero', AP.length===2, String(AP.length));
chk('y no la que abre en positivo', !AP.some(x=>x.whs==='RT13-102'), AP.map(x=>x.whs).join(','));
// se ordena por la peor: es la que dice cuanto esta corrida la serie
chk('la peor va primero', AP[0].whs==='RT13-100' && AP[0].apertura===-3334, JSON.stringify(AP[0]));
chk('con el dia en que abre', AP[0].dia==='2026-10-01', AP[0].dia);
// mira la apertura del PRIMER dia, no la de cualquiera: lo que esta corrido
// es el arranque de la ventana, no un dia del medio
chk('mira el primer dia, no el peor del mes',
    S.aperturasImposibles([{whs:'X',nombre:'X',dias:[
      dia2('2026-10-01',500,0,900,-400), dia2('2026-10-02',-400,0,0,-400)]}]).length===0,
    'una que ABRE en positivo y despues cae no es apertura imposible');
chk('una bodega sin dias no entra', S.aperturasImposibles([{whs:'Y',nombre:'Y',dias:[]}]).length===0);
chk('y nada revienta', S.aperturasImposibles(null).length===0 && S.aperturasImposibles([]).length===0);
chk('una apertura en cero no es imposible',
    S.aperturasImposibles([{whs:'Z',nombre:'Z',dias:[dia2('2026-10-01',0,5,0,5)]}]).length===0);

console.log('\n— el desfase entre leer el ancla y leer las lineas —');
const DES=(a,l)=>S.desfaseDeLectura(a,l);
chk('unos segundos no son nada', DES('2026-11-02T16:34:46Z','2026-11-02T16:34:41Z').ok===true);
chk('y reporta cuantos', DES('2026-11-02T16:34:46Z','2026-11-02T16:34:41Z').segundos===5);
const TARDE=DES('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z');
chk('un ancla muy posterior a las lineas se declara', TARDE.ok===false && TARDE.segundos===166,
    JSON.stringify(TARDE));
chk('y dice en que direccion', /ancla se leyo 166 s DESPUES/.test(TARDE.motivo), TARDE.motivo);
const PRONTO=DES('2026-11-02T16:34:46Z','2026-11-02T16:40:00Z');
chk('las lineas posteriores al ancla tambien se declaran', PRONTO.ok===false, JSON.stringify(PRONTO));
chk('con el signo al reves y su propia explicacion',
    PRONTO.segundos===-314 && /lineas se guardaron 314 s DESPUES/.test(PRONTO.motivo), PRONTO.motivo);
chk('el tope se puede mover', TARDE.ok===false &&
    S.desfaseDeLectura('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z',300).ok===true);
// sin marca de tiempo no se inventa un cero: se dice que no se puede medir
chk('sin marca no se inventa que esta bien',
    DES('2026-11-02T16:34:46Z',null).ok===null && DES('2026-11-02T16:34:46Z',null).segundos===null);
chk('y lo dice', /no se puede medir/.test(DES('2026-11-02T16:34:46Z',null).motivo));
chk('una fecha ilegible es lo mismo que no tenerla',
    DES('2026-11-02T16:34:46Z','el martes').ok===null);
chk('sin ancla tampoco', DES(null,'2026-11-02T16:32:00Z').ok===null);
// DE QUE BLOB HABLA. "las lineas se guardaron 89.634 s despues" con cuatro
// meses leidos no deja saber cual de los cuatro, y la respuesta cambia todo:
// el mes en curso es un problema, un mes cerrado reextraido no lo es
chk('el mensaje dice que blob se comparo',
    /lineasbod\/2026-11\.json/.test(
      S.desfaseDeLectura('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z',null,'2026-11').motivo),
    S.desfaseDeLectura('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z',null,'2026-11').motivo);
chk('y lo deja en el resultado para el json',
    S.desfaseDeLectura('2026-11-02T16:34:46Z','2026-11-02T16:34:41Z',null,'2026-11').mes==='2026-11');
chk('sin mes el mensaje queda como estaba',
    !/lineasbod/.test(DES('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z').motivo) &&
    DES('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z').mes===null);
chk('un mes mal escrito no ensucia el mensaje',
    !/lineasbod/.test(S.desfaseDeLectura('2026-11-02T16:34:46Z','2026-11-02T16:32:00Z',null,'noviembre').motivo));

// ============================================================
// CUAL BLOB MANDA PARA MEDIR EL DESFASE
// ============================================================
console.log('\n— cual de los blobs se compara contra el ancla —');
// EL DEL MES MAS NUEVO, no el escrito mas tarde. Reextraer agosto el 5 de
// noviembre lo deja como el blob mas reciente, pero agosto esta cerrado: ahi
// ya no nace ningun documento, asi que su hora de escritura no dice nada
// sobre si el saldo y las lineas estan en hora
const BL=[{mes:'2026-08',guardado:'2026-11-05T04:28:25Z'},
          {mes:'2026-09',guardado:'2026-11-05T01:13:00Z'},
          {mes:'2026-10',guardado:'2026-11-04T03:16:00Z'},
          {mes:'2026-11',guardado:'2026-11-04T03:34:31Z'}];
chk('manda el mes mas nuevo, no el escrito mas tarde',
    S.blobQueManda(BL).mes==='2026-11' && S.blobQueManda(BL).guardado==='2026-11-04T03:34:31Z',
    JSON.stringify(S.blobQueManda(BL)));
// el caso real del 2026-11-05: con la regla vieja daba 89.634 s de alarma y
// las aperturas eran identicas con el ancla fresca; con esta da 57 s
chk('con la regla nueva ese mismo dia no hay alarma',
    S.desfaseDeLectura('2026-11-04T03:34:31Z',S.blobQueManda(BL).guardado).ok===true,
    String(S.desfaseDeLectura('2026-11-04T03:34:31Z',S.blobQueManda(BL).guardado).segundos));
chk('y con la regla vieja si la habia',
    S.desfaseDeLectura('2026-11-04T03:34:31Z','2026-11-05T04:28:25Z').ok===false);
chk('el orden en que se leyeron no importa',
    S.blobQueManda(BL.slice().reverse()).mes==='2026-11');
chk('con un solo mes, ese manda', S.blobQueManda([BL[1]]).mes==='2026-09');
// un blob del mes en curso SIN marca no puede caer al de agosto: eso diria
// "en hora" apoyandose en un mes que no mide nada
chk('si el mes que manda no trae marca, no se cae al de otro mes',
    S.blobQueManda([BL[0],{mes:'2026-11',guardado:null}]).mes==='2026-11' &&
    S.blobQueManda([BL[0],{mes:'2026-11',guardado:null}]).guardado===null,
    JSON.stringify(S.blobQueManda([BL[0],{mes:'2026-11',guardado:null}])));
chk('y entonces el desfase dice que no se puede medir',
    S.desfaseDeLectura('2026-11-04T03:34:31Z',null,null,'2026-11').ok===null);
chk('un mes mal escrito no se elige',
    S.blobQueManda([{mes:'octubre',guardado:'2026-11-05T00:00:00Z'},BL[2]]).mes==='2026-10');
chk('sin blobs no revienta',
    S.blobQueManda([])===null && S.blobQueManda(null)===null &&
    S.blobQueManda([null,{}])===null);
chk('el anio pesa mas que el mes',
    S.blobQueManda([{mes:'2027-01',guardado:'a'},{mes:'2026-12',guardado:'b'}]).mes==='2027-01');

// ELEGIR EL BLOB Y MEDIRLO VAN JUNTOS: medir contra uno y nombrar otro en el
// mensaje seria peor que no nombrar ninguno
const LEC=S.lecturaDeLaVentana('2026-11-04T03:34:31Z',BL);
chk('mide contra el blob que eligio', LEC.manda.mes==='2026-11' && LEC.desfase.ok===true,
    JSON.stringify(LEC.manda)+' '+LEC.desfase.segundos+' s');
chk('y el mensaje habla de ESE blob, no de otro',
    LEC.desfase.mes==='2026-11', String(LEC.desfase.mes));
const LEC2=S.lecturaDeLaVentana('2026-11-05T12:00:00Z',BL);
chk('con el ancla de un dia despues si hay alarma, y nombra el mes',
    LEC2.desfase.ok===false && /lineasbod\/2026-11\.json/.test(LEC2.desfase.motivo),
    LEC2.desfase.motivo);
chk('el tope se puede mover tambien por aca',
    S.lecturaDeLaVentana('2026-11-05T12:00:00Z',BL,200000).desfase.ok===true);
chk('sin blobs dice que no se puede medir, no que esta bien',
    S.lecturaDeLaVentana('2026-11-04T03:34:31Z',[]).desfase.ok===null &&
    S.lecturaDeLaVentana('2026-11-04T03:34:31Z',[]).manda===null);

console.log('\n— el veredicto separa los dos negativos —');
const VAP=S.veredicto(SERAP,[],{cuadra:true},{ok:true},AP,{ok:true});
chk('nombra la apertura negativa', /ABREN LA VENTANA EN NEGATIVO/.test(VAP.texto), VAP.texto.slice(0,70));
chk('dice cuanto esta corrida la serie', /corrida por al menos 3\.334/.test(VAP.texto), VAP.texto);
// NO puede decir "se arregla en SAP": este error es nuestro
chk('y NO manda a arreglarlo a SAP, porque es nuestro',
    /Se arregla midiendo la apertura, no en SAP/.test(VAP.texto) &&
    !/la salida de mercancias/.test(VAP.texto), VAP.texto.slice(-90));
chk('queda en revisar', VAP.nivel==='revisar');
const VCI=S.veredicto(SERAP,[{whs:'RT13-100',cierre:-7415,dia:'2026-10-09'}],{cuadra:true},{ok:true},[],{ok:true});
chk('el cierre negativo sigue diciendo que es la fecha del documento',
    /FECHA del documento/.test(VCI.texto) && /Se arregla en SAP, no aca/.test(VCI.texto));
chk('y no habla de apertura', !/ABREN LA VENTANA/.test(VCI.texto));
chk('el desfase se declara aparte',
    /LECTURA DESFASADA/.test(S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],TARDE).texto));
chk('y un desfase dentro de tope no dice nada',
    !/LECTURA DESFASADA/.test(S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true}).texto));
chk('sin nada que decir, el veredicto es si',
    S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true}).nivel==='si');
chk('y menciona que abren en positivo',
    /abren la ventana en positivo/.test(S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true}).texto));
chk('el veredicto sin los argumentos nuevos no revienta',
    S.veredicto(SERAP,[],{cuadra:true},{ok:true}).nivel==='si');

console.log('\n— el json se lleva los dos controles —');
const PJ=S.payloadJson({generado:'2026-11-02T16:36:37Z',anclaLeida:'2026-11-02T16:34:46Z',
  lineasGuardadas:'2026-11-02T16:32:00Z', desfase:TARDE, aperturasImposibles:AP,
  meses:['2026-10'],ancla:{ok:true},veredicto:VAP,indicador:1,fueraDelIndicador:0,
  cierreFirme:'2026-11-01',bodegas:SER,cadena:[]});
chk('las aperturas imposibles viajan', PJ.aperturas_imposibles.length===2);
chk('y las dos marcas de lectura tambien',
    PJ.lectura.ancla==='2026-11-02T16:34:46Z' && PJ.lectura.lineas==='2026-11-02T16:32:00Z',
    JSON.stringify(PJ.lectura));
chk('con el desfase medido', PJ.lectura.desfase_s===166 && PJ.lectura.ok===false,
    JSON.stringify(PJ.lectura));
chk('sin dato, el json no finge un cero',
    S.payloadJson({}).lectura.desfase_s===null && S.payloadJson({}).lectura.ok===null);
chk('ni inventa aperturas', S.payloadJson({}).aperturas_imposibles.length===0);


console.log('\n— el transito: los pallets que estan en el aire —');
// La emision se CREA el dia que el pallet sale de planta y se FECHA el dia que
// el cliente la recibe. En el medio no cuenta por creacion y si por documento.
const NUE=new Set(['RT13-105','RT13-100','RT13-102']);
const l=(de,a,q,c,d)=>({desde:de,hacia:a,cantidad:q,CreaDate:c,DocDate:d});
const LT=[
  l('RT13-105','CLIENTES',80,'2026-11-02','2026-11-03'),   // sale, pendiente
  l('RT13-100','RT13-105',40,'2026-11-02','2026-11-03'),   // interna, no cuenta
  l('CLIENTES','RT13-100',10,'2026-11-02','2026-11-03'),   // entra, resta
  l('RT13-105','CLIENTES', 5,'2026-11-01','2026-11-01'),   // ya fechada
];
const T2=S.enTransito(LT,'2026-11-02',NUE);
chk('cuenta lo que salio y no esta fechado', T2.pallets===70, String(T2.pallets));
chk('y dice cuantas lineas lo componen', T2.lineas===2, String(T2.lineas));
// una estacion a otra cambia el reparto, no cuantos pallets hay en planta
chk('un traspaso interno pendiente NO es transito',
    S.enTransito([l('RT13-100','RT13-105',40,'2026-11-02','2026-11-03')],'2026-11-02',NUE).pallets===0);
chk('una linea entre dos bodegas ajenas tampoco',
    S.enTransito([l('CLIENTES','RETAIL',40,'2026-11-02','2026-11-03')],'2026-11-02',NUE).pallets===0);
// una que ENTRA a planta y no esta fechada resta: viene en camino hacia aca
chk('lo que viene entrando resta del transito',
    S.enTransito([l('CLIENTES','RT13-100',10,'2026-11-02','2026-11-03')],'2026-11-02',NUE).pallets===-10);
// al dia siguiente ya esta fechada y deja de estar en el aire
chk('cuando llega la fecha deja de estar en transito', S.enTransito(LT,'2026-11-03',NUE).pallets===0);
// el 1-nov la unica linea que existe se creo y se fecho el mismo dia: nunca
// pasa por el aire. Y las otras tres todavia no se crean.
chk('una linea creada y fechada el mismo dia nunca esta en transito',
    S.enTransito(LT,'2026-11-01',NUE).pallets===0, String(S.enTransito(LT,'2026-11-01',NUE).pallets));
chk('ni antes de crearse',
    S.enTransito(LT,'2026-10-31',NUE).pallets===0, String(S.enTransito(LT,'2026-10-31',NUE).pallets));
// y una creada antes del corte y fechada despues SI esta, aunque pasen dias
chk('una que cruza varios dias sigue en el aire todos ellos',
    [1,2,3].every(i=>S.enTransito([l('RT13-105','CLIENTES',80,'2026-11-01','2026-11-05')],
      '2026-11-0'+i,NUE).pallets===80));
// la identidad que une las dos lecturas
const porCrea=S.movimientoDeBodega(LT,'RT13-105','CreaDate');
const porDoc =S.movimientoDeBodega(LT,'RT13-105','DocDate');
chk('el campo de fecha se puede elegir',
    JSON.stringify(porCrea.map(x=>x.dia))!==JSON.stringify(porDoc.map(x=>x.dia)),
    porCrea.map(x=>x.dia).join(',')+' vs '+porDoc.map(x=>x.dia).join(','));
chk('y por defecto sigue siendo la del documento',
    JSON.stringify(S.movimientoDeBodega(LT,'RT13-105'))===JSON.stringify(porDoc));
// SIN LAS DOS FECHAS NO SE PUEDE MEDIR, y un cero se leeria como "no hay nada"
const SINC=S.enTransito(LT.map(x=>({...x,CreaDate:null})),'2026-11-02',NUE);
chk('sin fecha de creacion no se inventa un cero',
    SINC.medible===false && SINC.pallets===null, JSON.stringify(SINC));
chk('y dice por que', /re-extraiga/.test(SINC.motivo), SINC.motivo);
chk('una fecha de corte ilegible tampoco da cero',
    S.enTransito(LT,'el lunes',NUE).medible===false &&
    S.enTransito(LT,'el lunes',NUE).pallets===null);
chk('sin lineas no revienta', S.enTransito([],'2026-11-02',NUE).medible===false &&
    S.enTransito(null,'2026-11-02',NUE).medible===false);
chk('una lista de codigos sirve igual que un Set',
    S.enTransito(LT,'2026-11-02',['RT13-105','RT13-100','RT13-102']).pallets===70);
// una linea a medio fechar no se adivina
// una creada sin fecha de documento salio de la bodega y no tiene dia de
// llegada: no se puede ubicar en el tiempo, pero no puede pasar en silencio
const SINDOC=S.enTransito([l('RT13-105','CLIENTES',80,'2026-11-02',null)],'2026-11-02',NUE);
chk('una linea sin fecha de documento no entra al numero', SINDOC.pallets===0, String(SINDOC.pallets));
chk('pero se cuenta aparte', SINDOC.sinFecha===1, String(SINDOC.sinFecha));
chk('y se declara', /sin fecha de documento utilizable/.test(SINDOC.motivo||''), String(SINDOC.motivo));
chk('cuando todas tienen las dos, no sobra nada que declarar',
    T2.sinFecha===0 && T2.motivo===null, JSON.stringify({s:T2.sinFecha,m:T2.motivo}));

console.log('\n— la cobertura de fechas se declara, no se supone —');
chk('cuenta las que traen cada una', (c=>c.conDoc===4&&c.conCrea===4&&c.conLasDos===4&&c.completa)
    (S.coberturaDeFechas(LT)), JSON.stringify(S.coberturaDeFechas(LT)));
const MIX=S.coberturaDeFechas([LT[0],{...LT[1],CreaDate:null}]);
chk('con un blob a medias lo dice', MIX.completa===false && MIX.conCrea===1,
    JSON.stringify(MIX));
chk('sin lineas no se declara completa', S.coberturaDeFechas([]).completa===false);
chk('y no revienta con nada', S.coberturaDeFechas(null).lineas===0);


console.log('\n— que fecha manda la serie de planta —');
chk('con todas las lineas completas, manda la de creacion',
    S.fechaQueManda({lineas:10,conCrea:10,conLasDos:10,completa:true}).campo==='CreaDate');
// mezclar las dos daria una serie que no es ninguna de las dos
chk('con los blobs a medias NO se mezcla: sale por documento',
    S.fechaQueManda({lineas:10,conCrea:4,conLasDos:4,completa:false}).campo==='DocDate');
chk('y se dice por que', /no es ninguna de las dos/.test(
    S.fechaQueManda({lineas:10,conCrea:4,conLasDos:4,completa:false}).motivo));
chk('sin ninguna fecha de creacion tambien sale por documento, y lo declara',
    (f=>f.campo==='DocDate' && /re-extrayendo/.test(f.motivo))
      (S.fechaQueManda({lineas:10,conCrea:0,conLasDos:0,completa:false})));
chk('se puede forzar para comparar las dos lecturas',
    (f=>f.campo==='CreaDate' && f.porDefecto===false)(S.fechaQueManda({completa:false},'CreaDate')));
chk('una fecha forzada que no existe se ignora',
    S.fechaQueManda({completa:true},'cualquiera').campo==='CreaDate');
chk('sin cobertura no revienta', S.fechaQueManda(null).campo==='DocDate');
// cuando la serie sale por la fecha que NO corresponde, el veredicto lo grita
const FD=S.fechaQueManda({lineas:10,conCrea:0,conLasDos:0,completa:false});
const VF=S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true},FD,{medible:false});
chk('el veredicto avisa que la serie no es la de la planta',
    /FECHA DE LA SERIE/.test(VF.texto) && /no "cuantos hay en planta"/.test(VF.texto),
    VF.texto.slice(0,80));
chk('con la fecha correcta no dice nada',
    !/FECHA DE LA SERIE/.test(S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true},
      {campo:'CreaDate',porDefecto:true,motivo:null},{medible:true,pallets:0}).texto));
chk('ni cuando la forzo una persona a sabiendas',
    !/FECHA DE LA SERIE/.test(S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true},
      {campo:'DocDate',porDefecto:false,motivo:'forzada'},{medible:true,pallets:0}).texto));
chk('y las lineas en el aire sin fecha de llegada se declaran',
    /en el aire y no tienen dia de llegada/.test(
      S.veredicto(SERAP,[],{cuadra:true},{ok:true},[],{ok:true},
        {campo:'CreaDate',porDefecto:true},{medible:true,pallets:5,sinFecha:3}).texto));

console.log('\n— el json lleva el transito, y en null cuando no se sabe —');
const PJT=S.payloadJson({fecha:{campo:'CreaDate',motivo:null},
  transito:{medible:true,pallets:80,lineas:2,sinFecha:0,motivo:null}, transitoAl:'2026-11-01'});
chk('la fecha de la serie viaja', PJT.fecha_serie==='CreaDate');
chk('y el transito con su dia', PJT.transito.pallets===80 && PJT.transito.al==='2026-11-01',
    JSON.stringify(PJT.transito));
// un cero se publicaria como "no hay nada en el aire", que es una afirmacion
const PJN=S.payloadJson({transito:{medible:false,pallets:null,motivo:'falta re-extraer'}});
chk('cuando no se puede medir va en null, no en cero',
    PJN.transito.medible===false && PJN.transito.pallets===null, JSON.stringify(PJN.transito));
chk('con su motivo', /falta re-extraer/.test(PJN.transito.motivo));
chk('y sin transito tampoco finge un cero',
    S.payloadJson({}).transito.pallets===null && S.payloadJson({}).transito.medible===false);

console.log('\n— y de donde sale y a donde va: 540 en el aire no se puede perseguir —');
const lx=(de,a,q,c,d,n)=>({desde:de,hacia:a,cantidad:q,CreaDate:c,DocDate:d,DocEntry:n,DocNum:n+900000});
const LD=[
  lx('RT13-105','CLIENTES',540,'2026-11-02','2026-11-04',35058202),
  lx('RT13-100','RT13-105', 40,'2026-11-02','2026-11-03',35058203),   // interna
  lx('CLIENTES','RT13-100', 10,'2026-11-02','2026-11-03',35058204),   // entra
  lx('RT13-105','CLIENTES', 80,'2026-11-02','2026-11-03',35058205),
];
const TD=S.enTransito(LD,'2026-11-02',NUE);
chk('hay una fila de detalle por cada linea contada',
    TD.detalle.length===TD.lineas && TD.lineas===3, JSON.stringify(TD.detalle.map(x=>x.doc)));
chk('con las dos bodegas, el documento y las dos fechas',
    TD.detalle[0].desde==='RT13-105' && TD.detalle[0].hacia==='CLIENTES' &&
    TD.detalle[0].doc===35058202 && TD.detalle[0].num===35958202 &&
    TD.detalle[0].crea==='2026-11-02' && TD.detalle[0].llega==='2026-11-04',
    JSON.stringify(TD.detalle[0]));
// las grandes primero: son las que explican el numero
chk('ordenado de mayor a menor', TD.detalle.map(x=>Math.abs(x.cantidad)).join(',')==='540,80,10',
    TD.detalle.map(x=>x.cantidad).join(','));
// la que ENTRA viene con signo negativo, igual que como suma al total
chk('la que entra a planta va negativa',
    TD.detalle.find(x=>x.doc===35058204).cantidad===-10);
// y el orden mira el TAMANO, no el signo: 300 que vienen entrando pesan mas
// que 20 que salen, y el que lee quiere ver primero el movimiento grande
chk('ordena por tamano, no por signo',
    S.enTransito([lx('RT13-105','CLIENTES',20,'2026-11-02','2026-11-04',11),
                  lx('CLIENTES','RT13-100',300,'2026-11-02','2026-11-04',12)],
                 '2026-11-02',NUE).detalle[0].cantidad===-300);
chk('y el detalle suma lo mismo que el total',
    TD.detalle.reduce((a,x)=>a+x.cantidad,0)===TD.pallets, String(TD.pallets));
// lo que no cuenta tampoco aparece: un detalle con lineas que no suman al
// numero manda a buscar documentos que no tienen nada que ver
chk('la interna no esta en el detalle', !TD.detalle.some(x=>x.doc===35058203));
chk('una linea entre dos bodegas ajenas tampoco',
    S.enTransito([lx('CLIENTES','RETAIL',40,'2026-11-02','2026-11-03',1)],'2026-11-02',NUE).detalle.length===0);
chk('una ya fechada tampoco',
    S.enTransito([lx('RT13-105','CLIENTES',5,'2026-11-01','2026-11-01',2)],'2026-11-02',NUE).detalle.length===0);
// DOS CORRIDAS DEL MISMO DATO TIENEN QUE IMPRIMIR IGUAL
const EMP=[lx('RT13-105','CLIENTES',80,'2026-11-02','2026-11-04',35058300),
           lx('RT13-105','CLIENTES',80,'2026-11-02','2026-11-04',35058299)];
chk('el empate se rompe por DocEntry, no por el orden de llegada',
    [1,2,3].every(()=>S.enTransito(EMP,'2026-11-02',NUE).detalle.map(x=>x.doc).join(',')
                       ==='35058299,35058300'),
    S.enTransito(EMP,'2026-11-02',NUE).detalle.map(x=>x.doc).join(','));
// el detalle viaja hasta la pagina dentro de datos-stock.json: con tope
const MUCHAS=[];
for (let i=0;i<25;i++) MUCHAS.push(lx('RT13-105','CLIENTES',i+1,'2026-11-02','2026-11-04',40000000+i));
const TCAP=S.enTransito(MUCHAS,'2026-11-02',NUE);
chk('el detalle tiene tope de 10', TCAP.detalle.length===10, String(TCAP.detalle.length));
chk('pero el conteo de lineas las cuenta todas', TCAP.lineas===25, String(TCAP.lineas));
chk('y el total tambien', TCAP.pallets===325, String(TCAP.pallets));
chk('el tope deja las mas grandes, no las primeras', TCAP.detalle[0].cantidad===25);
// sin fecha de creacion no hay transito y tampoco detalle que sugiera que si
chk('si no se puede medir no hay detalle',
    !(S.enTransito(LD.map(x=>({...x,CreaDate:null})),'2026-11-02',NUE).detalle||[]).length);
const PJD=S.payloadJson({ series:[], transito:TD, transitoAl:'2026-11-02' });
chk('y el detalle llega al json que lee la pagina',
    PJD.transito.detalle.length===3 && PJD.transito.detalle[0].cantidad===540,
    JSON.stringify(PJD.transito.detalle[0]));
chk('sin transito el json trae un detalle vacio, no undefined',
    Array.isArray(S.payloadJson({ series:[] }).transito.detalle));

console.log('\n— el transito de CADA dia, no solo el del ultimo cierre —');
// El calendario de la tarjeta deja elegir un dia: sin una serie, elegir el 29
// de octubre mostraria el stock del 29 al lado del transito de hoy.
const LS=[lx('RT13-105','CLIENTES',80,'2026-11-02','2026-11-04',1),
          lx('RT13-105','CLIENTES',30,'2026-11-03','2026-11-04',2)];
const TPD=S.transitoPorDia(LS,['2026-11-02','2026-11-03','2026-11-04'],NUE);
chk('un renglon por dia pedido', TPD.length===3, String(TPD.length));
chk('el 02 tiene en el aire solo la primera', TPD[0].pallets===80, String(TPD[0].pallets));
chk('el 03 ya tiene las dos', TPD[1].pallets===110, String(TPD[1].pallets));
chk('y el 04, cuando llegan, cero', TPD[2].pallets===0, String(TPD[2].pallets));
chk('cada renglon dice cuantas lineas lo componen',
    TPD[0].lineas===1 && TPD[1].lineas===2 && TPD[2].lineas===0,
    TPD.map(x=>x.lineas).join(','));
chk('viene ordenado por dia aunque se pidan desordenados',
    S.transitoPorDia(LS,['2026-11-04','2026-11-02'],NUE).map(x=>x.dia).join(',')
      ==='2026-11-02,2026-11-04');
chk('un dia repetido sale una sola vez',
    S.transitoPorDia(LS,['2026-11-02','2026-11-02'],NUE).length===1);
chk('una fecha que no es fecha no entra',
    S.transitoPorDia(LS,['el lunes','2026-11-02'],NUE).map(x=>x.dia).join(',')==='2026-11-02');
// SIN FECHA DE CREACION NO SE PUEDE MEDIR, y eso no es cero pallets en el aire
chk('sin fecha de creacion el dia va en null, no en cero',
    S.transitoPorDia(LS.map(x=>({...x,CreaDate:null})),['2026-11-02'],NUE)[0].pallets===null);
chk('sin dias devuelve vacio', S.transitoPorDia(LS,[],NUE).length===0);
chk('sin nada no revienta', S.transitoPorDia(null,null,NUE).length===0);
// y el dia por dia tiene que dar lo MISMO que la medicion suelta de ese dia
chk('coincide con enTransito para el mismo dia',
    S.transitoPorDia(LS,['2026-11-03'],NUE)[0].pallets===S.enTransito(LS,'2026-11-03',NUE).pallets);
const PJTD=S.payloadJson({ series:[], transitoDias:TPD });
chk('la serie llega al json que lee la pagina',
    PJTD.transito_dias.length===3 && PJTD.transito_dias[1].pallets===110,
    JSON.stringify(PJTD.transito_dias[1]));
chk('y sin serie va un arreglo vacio, no undefined',
    Array.isArray(S.payloadJson({ series:[] }).transito_dias));

// ============================================================
// EL TRANSITO REPARTIDO POR PLANTA
// ============================================================
console.log('\n— a que planta se le anota el pallet que esta en el aire —');
// El codigo de bodega lleva el recinto (RT13, RT07) pero esa correspondencia
// no esta declarada en ninguna parte: la planta sale del NOMBRE
const NOM=new Map([['RT13-105','SANTIAGO DISPONIBLE'],['RT13-100','SANTIAGO INSPECCION'],
                   ['RT07-125','TALCA DISPONIBLE'],['RT13-266','SANTIAGO MERMA']]);
chk('la planta sale del nombre, no del codigo',
    S.plantaDeCodigo('RT13-105',NOM)==='SANTIAGO' && S.plantaDeCodigo('RT07-125',NOM)==='TALCA',
    S.plantaDeCodigo('RT13-105',NOM)+'/'+S.plantaDeCodigo('RT07-125',NOM));
// SIN NOMBRE NO SE ADIVINA: devolver "RT13-105" como planta inventaria una
// planta que no existe y el filtro no la ofreceria nunca
chk('sin nombre no se inventa una planta',
    S.plantaDeCodigo('RT13-105',null)==='SIN PLANTA' &&
    S.plantaDeCodigo('RT99-999',NOM)==='SIN PLANTA',
    S.plantaDeCodigo('RT13-105',null));
chk('y tambien acepta un objeto plano',
    S.plantaDeCodigo('RT07-125',{'RT07-125':'TALCA DISPONIBLE'})==='TALCA');

const NUE2=new Set(['RT13-105','RT13-100','RT07-125','RT13-266']);
const LP=[
  l('RT13-105','CLIENTES',80,'2026-11-02','2026-11-03'),   // Santiago, sale
  l('RT07-125','RETAIL',  30,'2026-11-02','2026-11-03'),   // Talca, sale
  l('CLIENTES','RT13-100',10,'2026-11-02','2026-11-03'),   // Santiago, entra: resta
  l('RT13-105','RT07-125',99,'2026-11-02','2026-11-03'),   // interna: no cuenta
];
const TP=S.enTransito(LP,'2026-11-02',NUE2,NOM);
chk('cada planta lleva su parte',
    TP.porPlanta.SANTIAGO===70 && TP.porPlanta.TALCA===30,
    JSON.stringify(TP.porPlanta));
// LA PARTICION ES EXACTA: cada linea contada tiene un solo extremo adentro,
// asi que si la suma no diera el total habria pallets anotados dos veces o
// ninguna, y el filtro mostraria un numero que no existe
chk('y la suma de las plantas es el total',
    Object.keys(TP.porPlanta).reduce((a,k)=>a+TP.porPlanta[k],0)===TP.pallets,
    JSON.stringify(TP.porPlanta)+' vs '+TP.pallets);
// SE ANOTA AL EXTREMO DE ADENTRO: la linea que entra viene DE clientes, que
// no tiene planta; la bodega de REDTEC que la recibe es la que la cuenta
chk('la que entra se le anota a la bodega que la recibe',
    S.enTransito([l('CLIENTES','RT07-125',10,'2026-11-02','2026-11-03')],'2026-11-02',NUE2,NOM)
      .porPlanta.TALCA===-10, '');
chk('una interna no le suma a ninguna planta',
    Object.keys(S.enTransito([l('RT13-105','RT07-125',99,'2026-11-02','2026-11-03')],
      '2026-11-02',NUE2,NOM).porPlanta).length===0, '');
// una bodega de REDTEC que no esta entre las nueve igual tiene planta: el
// filtro de Santiago la alcanza aunque no sume al indicador
chk('merma tambien se anota a su planta',
    S.enTransito([l('RT13-266','CLIENTES',7,'2026-11-02','2026-11-03')],'2026-11-02',NUE2,NOM)
      .porPlanta.SANTIAGO===7, '');
chk('sin el mapa de nombres todo cae en SIN PLANTA',
    S.enTransito(LP,'2026-11-02',NUE2)['porPlanta']['SIN PLANTA']===100,
    JSON.stringify(S.enTransito(LP,'2026-11-02',NUE2).porPlanta));
// NO MEDIBLE NO ES CERO: sin reparto va en null, para que la pagina pueda
// decir "no se puede saber" en vez de "esa planta no tiene nada en el aire"
chk('cuando no se puede medir, el reparto va en null',
    S.enTransito(LP,'el lunes',NUE2,NOM).porPlanta===null &&
    S.enTransito(LP.map(x=>({...x,CreaDate:null})),'2026-11-02',NUE2,NOM).porPlanta===null, '');
chk('el detalle dice a que planta se anoto cada linea',
    TP.detalle.filter(x=>x.desde==='RT07-125')[0].planta==='TALCA',
    JSON.stringify(TP.detalle.map(x=>x.desde+':'+x.planta)));

// Y DIA POR DIA, no solo al ultimo cierre: con un dia elegido y el filtro en
// Santiago, las tres filas tienen que hablar de Santiago ESE dia
const TDP=S.transitoPorDia(LP,['2026-11-01','2026-11-02','2026-11-03'],NUE2,NOM);
chk('el reparto viaja en cada dia',
    TDP[1].por_planta.SANTIAGO===70 && TDP[1].por_planta.TALCA===30,
    JSON.stringify(TDP[1]));
chk('un dia sin nada en el aire reparte vacio, no null',
    TDP[2].pallets===0 && TDP[2].por_planta && Object.keys(TDP[2].por_planta).length===0,
    JSON.stringify(TDP[2]));
chk('y un dia que no se puede medir va en null',
    S.transitoPorDia(LP.map(x=>({...x,CreaDate:null})),['2026-11-02'],NUE2,NOM)[0].por_planta===null,
    JSON.stringify(S.transitoPorDia(LP.map(x=>({...x,CreaDate:null})),['2026-11-02'],NUE2,NOM)[0]));

const PJP=S.payloadJson({ series:[], transito:TP, transitoAl:'2026-11-02', transitoDias:TDP });
chk('el reparto sale publicado como por_planta',
    PJP.transito.por_planta.SANTIAGO===70 && PJP.transito_dias[1].por_planta.TALCA===30,
    JSON.stringify(PJP.transito.por_planta));
chk('y sin transito queda en null, no en un objeto vacio',
    S.payloadJson({ series:[] }).transito.por_planta===null, '');

// ============================================================
// LO QUE LA EXTRACCION NO PUDO LEER
// ============================================================
console.log('\n— los documentos perdidos de cada blob —');
const BF=[{mes:'2026-08',guardado:'a',fallidos:[]},
          {mes:'2026-09',guardado:'b',fallidos:[{DocEntry:1},{DocEntry:2}]},
          {mes:'2026-10',guardado:'c',fallidos:[]},
          {mes:'2026-11',guardado:'d',fallidos:[{DocEntry:3}]}];
chk('suma los perdidos de todos los meses', S.fallidosDeBlobs(BF).total===3,
    String(S.fallidosDeBlobs(BF).total));
chk('y dice de que mes es cada uno',
    S.fallidosDeBlobs(BF).porMes.map(x=>x.mes+':'+x.n).join(',')==='2026-09:2,2026-11:1',
    JSON.stringify(S.fallidosDeBlobs(BF).porMes));
chk('un mes limpio no ensucia la lista',
    S.fallidosDeBlobs(BF).porMes.every(x=>x.n>0));
chk('todo limpio da cero y lista vacia',
    S.fallidosDeBlobs([{mes:'2026-10',fallidos:[]}]).total===0 &&
    S.fallidosDeBlobs([{mes:'2026-10',fallidos:[]}]).porMes.length===0);
// UN BLOB VIEJO NO TRAE EL CAMPO, y eso NO es cero perdidos: es que no se
// sabe. Publicarlo como limpio seria exactamente el error que esto persigue
chk('sin el campo va aparte, no como cero',
    S.fallidosDeBlobs([{mes:'2026-01'},{mes:'2026-02',fallidos:null}]).sinDato.join(',')==='2026-01,2026-02',
    JSON.stringify(S.fallidosDeBlobs([{mes:'2026-01'},{mes:'2026-02',fallidos:null}])));
chk('y no suma al total',
    S.fallidosDeBlobs([{mes:'2026-01'}]).total===0);
chk('un numero suelto tambien se entiende',
    S.fallidosDeBlobs([{mes:'2026-10',fallidos:16}]).total===16);
chk('los meses salen ordenados',
    S.fallidosDeBlobs([{mes:'2026-11',fallidos:[1]},{mes:'2026-08',fallidos:[1]}])
      .porMes.map(x=>x.mes).join(',')==='2026-08,2026-11');
chk('un mes mal escrito se ignora',
    S.fallidosDeBlobs([{mes:'octubre',fallidos:[1,2]}]).total===0);
chk('sin blobs no revienta',
    S.fallidosDeBlobs([]).total===0 && S.fallidosDeBlobs(null).total===0 &&
    S.fallidosDeBlobs([null,{}]).total===0);

// LA POLITICA ES UNA SOLA Y VIVE EN EL EXTRACTOR: si aca hubiera una copia,
// un dia una acepta y la otra rechaza el mismo numero
const XB=require('../backfill/backfill-sap-bin.js');
chk('la decision la toma la misma funcion que el extractor',
    typeof XB.veredictoDeFallidos==='function' &&
    XB.veredictoDeFallidos(3,0).ok===false && XB.veredictoDeFallidos(3,3).ok===true);
const SRC=require('fs').readFileSync(require('path').join(__dirname,'saldo-planta.js'),'utf8');
chk('y saldo-planta la importa en vez de copiarla',
    /require\('\.\.\/backfill\/backfill-sap-bin\.js'\)/.test(SRC) &&
    /X\.veredictoDeFallidos/.test(SRC), '');
// OJO: esto mira la FORMA del codigo, no su conducta. La escritura vive en
// main(), que necesita SAP y el storage. Se exige que el guardia EXISTA —un
// indexOf de -1 pasaria la comparacion de orden sin guardia ninguno— y que
// vaya antes de escribir.
const iG = SRC.indexOf('if (salida && !vfal.ok)');
const iW = SRC.indexOf('fs.writeFileSync(salida');
chk('el guardia existe y va antes de escribir el json',
    iG > 0 && iW > 0 && iG < iW, 'guardia@' + iG + ' escribe@' + iW);
chk('y corta de verdad, no solo avisa',
    SRC.indexOf('process.exitCode = 1', iG) > iG &&
    SRC.indexOf('return;', iG) > SRC.indexOf('process.exitCode = 1', iG) &&
    SRC.indexOf('return;', iG) < iW,
    'exit@' + SRC.indexOf('process.exitCode = 1', iG) + ' return@' + SRC.indexOf('return;', iG));
chk('y la corrida termina con codigo distinto de cero',
    /process\.exitCode = 1/.test(SRC), '');
chk('--fallidos es una opcion declarada', S.OPCIONES.indexOf('fallidos')>=0, S.OPCIONES.join(','));

// LO TOLERADO SE PUBLICA DECLARADO: si se acepta el hueco, la pagina tiene
// que poder decir que esa serie esta corrida
const PJF=S.payloadJson({ series:[], fallidos:{total:3,porMes:[{mes:'2026-09',n:3}],sinDato:['2026-01']} });
chk('el payload lleva lo que falto',
    PJF.lineas_fallidas.total===3 && PJF.lineas_fallidas.por_mes[0].mes==='2026-09',
    JSON.stringify(PJF.lineas_fallidas));
chk('y los meses de los que no se sabe',
    PJF.lineas_fallidas.sin_dato.join(',')==='2026-01');
chk('sin nada que declarar va en null, no en un objeto en cero',
    S.payloadJson({ series:[], fallidos:{total:0,porMes:[],sinDato:[]} }).lineas_fallidas===null &&
    S.payloadJson({ series:[] }).lineas_fallidas===null);
// solo los meses sin dato tambien es algo que decir
chk('solo meses sin dato igual se declara',
    S.payloadJson({ series:[], fallidos:{total:0,porMes:[],sinDato:['2026-01']} })
      .lineas_fallidas.sin_dato.join(',')==='2026-01');

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
