'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const P=require('./sonda-planta-lineas.js');

console.log('— las bodegas que ya conocemos —');
const BOD = { bodegas:[{whs:'RT13-100',nombre:'STGO INSPECCION'},{whs:' RT13-102 ',nombre:'x'},
                       {whs:'',nombre:'vacia'},{whs:null},null,{nombre:'sin whs'}] };
const C = P.codigosDeBodega(BOD);
chk('salen del json de bodegas, no de una lista a mano', C.has('RT13-100') && C.size===2, [...C].join(','));
chk('un codigo con espacios se recorta', C.has('RT13-102'));
chk('una bodega sin codigo no entra', !C.has('') && !C.has('null'));
chk('sin json no revienta', P.codigosDeBodega(null).size===0 && P.codigosDeBodega({}).size===0);

console.log('\n— que campos de la linea traen una bodega —');
// la gracia es encontrarlos por CONTENIDO: si el campo se llamara distinto,
// buscarlo por nombre devolveria ceros y nadie se enteraria
const L = [
  { ItemCode:'111', Quantity:10, FromWarehouseCode:'RT13-100', WarehouseCode:'RT13-102', U_otro:'texto' },
  { ItemCode:'111', Quantity:5,  FromWarehouseCode:'RT13-102', WarehouseCode:'RT13-103' },
  { ItemCode:'111', Quantity:7,  FromWarehouseCode:'RT13-100', WarehouseCode:'RT13-103', Proyecto:'RT13-100' },
];
let F = P.camposConBodega(L, C.add('RT13-103'));
chk('encuentra los campos por su contenido',
    F.map(x=>x.campo).sort().join(',')==='FromWarehouseCode,Proyecto,WarehouseCode', JSON.stringify(F.map(x=>x.campo)));
chk('cuenta en cuantas lineas aparece cada uno',
    F.find(x=>x.campo==='FromWarehouseCode').veces===3 && F.find(x=>x.campo==='Proyecto').veces===1);
chk('el mas frecuente va primero', F[0].veces >= F[F.length-1].veces);
chk('trae valores de muestra para poder elegir cual es cual',
    F.find(x=>x.campo==='WarehouseCode').valores.join(',')==='RT13-102,RT13-103');
chk('un campo con texto que no es bodega no entra', !F.some(x=>x.campo==='U_otro'));
chk('un valor que no es string no entra',
    !P.camposConBodega([{n:123, W:'RT13-100'}], C).some(x=>x.campo==='n'));
chk('sin lineas no inventa campos', P.camposConBodega(null, C).length===0);
chk('sin bodegas conocidas no encuentra nada', P.camposConBodega(L, null).length===0);
// cinco ejemplos bastan: la lista es para decidir, no para listar la bodega entera
const MUCHAS = ['A','B','C','D','E','F','G'];
// un codigo de bodega podria ser numerico; aun asi, un NUMERO en la linea no
// es una bodega. Convertirlo a texto para comparar abriria esa puerta.
const CN = new Set(['100','RT13-100']);
chk('un numero que se parece a un codigo tampoco entra',
    P.camposConBodega([{n:100, W:'RT13-100'}], CN).map(x=>x.campo).join(',')==='W',
    JSON.stringify(P.camposConBodega([{n:100, W:'RT13-100'}], CN).map(x=>x.campo)));
chk('para comparar tambien se recorta',
    P.camposConBodega([{W:'  RT13-100  '}], C).length===1);
// el orden importa: el campo que aparece en mas lineas es el candidato a
// destino. Si saliera en orden de aparicion, el primero seria el raro.
const ORD = [{ Raro:'RT13-100', W:'RT13-102' }, { W:'RT13-102' }, { W:'RT13-103' }];
chk('el mas frecuente va primero aunque aparezca despues',
    P.camposConBodega(ORD, C)[0].campo==='W', JSON.stringify(P.camposConBodega(ORD, C).map(x=>x.campo)));
chk('los valores de muestra se topan en cinco',
    P.camposConBodega(MUCHAS.map(w=>({W:w})), new Set(MUCHAS))[0].valores.length===5);

console.log('\n— cual de los dos campos es el origen —');
// MEDIDO el 2026-10-27: los dos campos salian en las 835 lineas, el desempate
// cayo en el alfabeto y quedo todo invertido. RETAIL aparecio con -368 cuando
// nuestra serie, medida por otro camino, dice +368.
const EMPATE = [{campo:'FromWarehouseCode',veces:835},{campo:'WarehouseCode',veces:835}];
let E = P.elegirPuntas(EMPATE);
chk('con los dos empatados manda el nombre, no el alfabeto',
    E.desde==='FromWarehouseCode' && E.hacia==='WarehouseCode', JSON.stringify(E));
chk('y se declara que el nombre lo resolvio', E.seguro===true && /nombre/.test(E.regla));
// al reves en la lista: el resultado no puede depender del orden de entrada
chk('el orden de la lista no cambia el resultado',
    P.elegirPuntas([EMPATE[1],EMPATE[0]]).desde==='FromWarehouseCode');
// si ningun nombre lo declara, se elige por frecuencia PERO se dice que es suposicion
let G = P.elegirPuntas([{campo:'BodegaA',veces:9},{campo:'BodegaB',veces:4}]);
chk('sin pista en el nombre se usa la frecuencia', G.hacia==='BodegaA' && G.desde==='BodegaB');
chk('y se declara que es una suposicion', G.seguro===false && /suposicion/.test(G.regla));
// dos campos que los dos parecen origen tampoco resuelven nada
chk('dos candidatos a origen no resuelven',
    P.elegirPuntas([{campo:'FromA',veces:9},{campo:'FromB',veces:9}]).seguro===false);
// y tampoco resuelven cuando SI hay un candidato a destino: con dos campos que
// dicen "from" no se sabe cual es, y elegir el primero seria tirar una moneda
const DOSFROM = P.elegirPuntas([{campo:'FromA',veces:9},{campo:'FromB',veces:8},{campo:'W',veces:7}]);
chk('dos "from" con un destino disponible tampoco resuelven',
    DOSFROM.seguro===false && /suposicion/.test(DOSFROM.regla), JSON.stringify(DOSFROM));
chk('con un solo campo no hay origen', P.elegirPuntas([{campo:'W',veces:9}]).desde===null);
chk('y se dice que es una sola punta', /una sola punta/.test(P.elegirPuntas([{campo:'W',veces:9}]).regla));
chk('sin campos no revienta', P.elegirPuntas(null).hacia===null && P.elegirPuntas([]).desde===null);
chk('una entrada basura se ignora', P.elegirPuntas([null,{campo:'W',veces:1}]).hacia==='W');

console.log('\n— la arista de una linea —');
const A = P.aristaDeLinea(L[0],'FromWarehouseCode','WarehouseCode','111');
chk('de donde sale y a donde entra', A.desde==='RT13-100' && A.hacia==='RT13-102' && A.cantidad===10);
chk('otro item no es arista', P.aristaDeLinea({ItemCode:'999'},'a','b','111')===null);
chk('sin filtro de item pasa cualquiera', P.aristaDeLinea({ItemCode:'999',Quantity:1},'a','b',null)!==null);
// una punta ausente NO se inventa: queda null y se cuenta aparte
const U = P.aristaDeLinea({ItemCode:'111',Quantity:4,WarehouseCode:'RT13-100'},'FromWarehouseCode','WarehouseCode','111');
chk('una punta ausente queda en null, no se rellena', U.desde===null && U.hacia==='RT13-100');
chk('una cantidad no numerica es cero, no NaN',
    P.aristaDeLinea({ItemCode:'111',Quantity:'x',WarehouseCode:'RT13-100'},'f','WarehouseCode','111').cantidad===0);
chk('los codigos se recortan',
    P.aristaDeLinea({ItemCode:'111',Quantity:1,W:'  RT13-100  '},'f','W','111').hacia==='RT13-100');
chk('un campo vacio no es una punta',
    P.aristaDeLinea({ItemCode:'111',Quantity:1,W:'   '},'f','W','111').hacia===null);

console.log('\n— las aristas del dia —');
let R = P.aristasDeLineas(L.concat([{ItemCode:'111',Quantity:3,WarehouseCode:'RT13-100'}]),
                          'FromWarehouseCode','WarehouseCode','111');
chk('agrupa por par origen-destino', R.aristas.length===4, JSON.stringify(R.aristas.map(a=>a.desde+'>'+a.hacia)));
chk('suma cantidades y cuenta lineas',
    R.aristas.find(a=>a.desde==='RT13-100'&&a.hacia==='RT13-102').cantidad===10);
chk('la mas grande primero', R.aristas[0].cantidad>=R.aristas[R.aristas.length-1].cantidad);
chk('cuenta las lineas de una sola punta', R.unaPunta===1 && R.cantidadUnaPunta===3);
chk('sin lineas no hay aristas', P.aristasDeLineas(null,'a','b','111').aristas.length===0);
// dos lineas del mismo par son UNA arista con la suma de las dos
const DOS = P.aristasDeLineas([
  {ItemCode:'111',Quantity:10,FromWarehouseCode:'RT13-100',WarehouseCode:'RT13-102'},
  {ItemCode:'111',Quantity:6, FromWarehouseCode:'RT13-100',WarehouseCode:'RT13-102'}],
  'FromWarehouseCode','WarehouseCode','111');
chk('dos lineas del mismo par suman, no se pisan',
    DOS.aristas.length===1 && DOS.aristas[0].cantidad===16 && DOS.aristas[0].lineas===2,
    JSON.stringify(DOS.aristas));

console.log('\n— el movimiento de cada bodega —');
let N = P.netoPorBodega(R.aristas);
const de = w => N.find(x=>x.bodega===w);
chk('lo que sale de una bodega se le resta', de('RT13-100').sale===17, JSON.stringify(de('RT13-100')));
chk('lo que entra se le suma', de('RT13-103').entra===12);
chk('el neto es entra menos sale', de('RT13-100').neto === de('RT13-100').entra - de('RT13-100').sale);
chk('una punta nula no crea una bodega', !N.some(x=>x.bodega===null||x.bodega==='?'));
chk('sin aristas no hay bodegas', P.netoPorBodega(null).length===0);

console.log('\n— la ley de las dos puntas —');
// con todas las lineas de dos puntas, la suma de los netos es cero
let RR = P.aristasDeLineas(L,'FromWarehouseCode','WarehouseCode','111');
let LEY = P.leyDeDosPuntas(P.netoPorBodega(RR.aristas), RR.cantidadUnaPunta);
chk('con dos puntas en todas, la suma da cero', LEY.suma===0 && LEY.cumple===true, String(LEY.suma));
// con una linea de una sola punta, la suma se corre JUSTO en esa cantidad
chk('una linea de una punta corre la suma en su cantidad',
    P.leyDeDosPuntas(P.netoPorBodega(R.aristas), R.cantidadUnaPunta).suma===3);
chk('y queda explicada por esa linea',
    P.leyDeDosPuntas(P.netoPorBodega(R.aristas), R.cantidadUnaPunta).explicadoPorUnaPunta===true);
chk('un descuadre mayor que las lineas de una punta NO queda explicado',
    P.leyDeDosPuntas([{neto:500}], 10).explicadoPorUnaPunta===false);
// un descuadre NEGATIVO es igual de grave que uno positivo
chk('un descuadre negativo tampoco queda explicado',
    P.leyDeDosPuntas([{neto:-500}], 10).explicadoPorUnaPunta===false);
chk('una suma distinta de cero NO cumple la ley',
    P.leyDeDosPuntas([{neto:-500}], 10).cumple===false &&
    P.leyDeDosPuntas([{neto:3}], 99).cumple===false);
chk('sin netos la suma es cero', P.leyDeDosPuntas(null,0).suma===0);

console.log('\n— el veredicto —');
let v = P.veredicto([], R, LEY);
chk('sin ningun campo de bodega dicta que no', v.nivel==='no', v.nivel);
chk('y dice que la planta no se puede medir asi', /NO se puede medir/.test(v.texto), v.texto);
v = P.veredicto([{campo:'WarehouseCode',veces:9,valores:[]}], R, LEY);
chk('con una sola punta manda a revisar', v.nivel==='revisar', v.nivel);
chk('y explica que la cadena queda sin responder', /cadena/.test(v.texto), v.texto);
v = P.veredicto(F, RR, LEY);
chk('con las dos puntas dicta que si', v.nivel==='si', v.nivel);
chk('y nombra los dos campos', v.texto.indexOf(F[0].campo)>=0 && v.texto.indexOf(F[1].campo)>=0, v.texto);
chk('y dice que no hace falta fuente nueva', /sin fuente nueva/.test(v.texto));
v = P.veredicto(F, R, P.leyDeDosPuntas(P.netoPorBodega(R.aristas), R.cantidadUnaPunta));
chk('con lineas de una punta lo informa', /1 linea\(s\) con una sola punta/.test(v.texto), v.texto);
v = P.veredicto(F, {unaPunta:0,cantidadUnaPunta:0}, {suma:500,cumple:false,explicadoPorUnaPunta:false});
chk('un descuadre sin explicar manda a revisar', v.nivel==='revisar', v.nivel);
chk('y lo dice con el numero', /\+500/.test(v.texto) && /NO alcanzan/.test(v.texto), v.texto);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
