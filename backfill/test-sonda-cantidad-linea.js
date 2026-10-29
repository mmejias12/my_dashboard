'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const Q=require('./sonda-cantidad-linea.js');

console.log('— si el documento esta anulado —');
chk('Cancelled tYES', Q.estaAnulado({Cancelled:'tYES'})===true);
chk('Cancelled booleano', Q.estaAnulado({Cancelled:true})===true);
chk('DocumentStatus cancelado', Q.estaAnulado({DocumentStatus:'bost_Cancelled'})===true);
chk('un documento vivo no esta anulado',
    Q.estaAnulado({Cancelled:'tNO',DocumentStatus:'bost_Close'})===false);
chk('sin documento no revienta', Q.estaAnulado(null)===false && Q.estaAnulado({})===false);

console.log('\n— que lineas entran —');
const DOCS=[
 {DocEntry:1,DocNum:11,Cancelled:'tNO',DocumentLines:[
   {ItemCode:'111',WarehouseCode:'RT13-100',Quantity:100,InventoryQuantity:60,UoMCode:'PAQ'},
   {ItemCode:'111',WarehouseCode:'RT13-103',Quantity:7,InventoryQuantity:7,UoMCode:'UN'},
   {ItemCode:'111',WarehouseCode:'  RT13-100  ',Quantity:0,InventoryQuantity:0,UoMCode:'UN',Impreso:false},
   {ItemCode:'999',WarehouseCode:'RT13-100',Quantity:5,InventoryQuantity:5,UoMCode:'UN'},
   null]},
 {DocEntry:2,DocNum:12,Cancelled:'tYES',DocumentLines:[
   {ItemCode:'111',WarehouseCode:'RT13-100',Quantity:40,InventoryQuantity:26,UoMCode:'PAQ'}]},
 {DocEntry:3,DocNum:13,StockTransferLines:[
   {ItemCode:'111',WarehouseCode:'RT13-100',Quantity:1,InventoryQuantity:1,UoMCode:'UN'}]},
 null];
let LI=Q.lineasDeInteres(DOCS,'111',[{campo:'WarehouseCode',valor:'RT13-100'}]);
chk('solo el item pedido', LI.length===4, String(LI.length));
// un codigo con espacios es la misma bodega: comparar sin recortar la perderia
chk('la bodega se recorta al comparar', LI.some(x=>x.linea.WarehouseCode==='  RT13-100  '));
chk('solo la bodega pedida', LI.every(x=>x.linea.WarehouseCode.trim()==='RT13-100'));
chk('arrastra si el documento estaba anulado',
    LI.filter(x=>x.anulado).length===1, JSON.stringify(LI.map(x=>x.anulado)));
// un campo que no es texto ni numero no es ni cantidad ni valor: tocarlo revienta
chk('un booleano no entra por ninguna de las dos puertas',
    !Q.totalesNumericos(LI,false).some(x=>x.campo==='Impreso') &&
    !Q.valoresDeTexto(LI,6).some(x=>x.campo==='Impreso'));
chk('lee las dos formas de nombrar las lineas',
    LI.some(x=>x.DocEntry===3), JSON.stringify(LI.map(x=>x.DocEntry)));
chk('sin bodega entran todas las del item', Q.lineasDeInteres(DOCS,'111',[]).length===5);
chk('sin item entran todas', Q.lineasDeInteres(DOCS,null,[{campo:'WarehouseCode',valor:'RT13-100'}]).length===5);
chk('una linea nula no revienta', LI.length===4);
chk('sin documentos no hay lineas', Q.lineasDeInteres(null,'111',[{campo:'W',valor:'X'}]).length===0);

// el filtro es generico: cuando la pregunta cambia de bodega a otro campo, no
// hay que tocar el codigo
console.log('\n— los filtros campo=valor —');
chk('lee varios', JSON.stringify(Q.leerFiltros('A=1,B=2').filtros)==='[{"campo":"A","valor":"1"},{"campo":"B","valor":"2"}]');
chk('recorta espacios', Q.leerFiltros(' A = 1 ').filtros[0].campo==='A');
chk('un valor con = adentro no se parte mal', Q.leerFiltros('A=x=y').filtros[0].valor==='x=y');
chk('vacio no es filtro', Q.leerFiltros('').filtros.length===0 && Q.leerFiltros(null).filtros.length===0);
chk('sin campo es error', /filtro sin campo=valor/.test(Q.leerFiltros('=1').error||''));
chk('sin igual tambien', /filtro sin campo=valor/.test(Q.leerFiltros('A').error||''));
chk('pasa cuando calza', Q.pasaFiltros({A:'1'},[{campo:'A',valor:'1'}])===true);
chk('y recorta al comparar', Q.pasaFiltros({A:'  1 '},[{campo:'A',valor:'1'}])===true);
chk('no pasa cuando no calza', Q.pasaFiltros({A:'2'},[{campo:'A',valor:'1'}])===false);
chk('un campo ausente no pasa', Q.pasaFiltros({},[{campo:'A',valor:'1'}])===false);
chk('sin filtros pasa todo', Q.pasaFiltros({},[])===true && Q.pasaFiltros({},null)===true);
chk('dos filtros se cumplen los dos',
    Q.pasaFiltros({A:'1',B:'2'},[{campo:'A',valor:'1'},{campo:'B',valor:'2'}])===true &&
    Q.pasaFiltros({A:'1',B:'3'},[{campo:'A',valor:'1'},{campo:'B',valor:'2'}])===false);
chk('se puede filtrar por un campo que no es bodega',
    Q.lineasDeInteres(DOCS,'111',[{campo:'UoMCode',valor:'PAQ'}]).length===2);

console.log('\n— cada campo numerico, totalizado —');
// la gracia: NO elegir ninguno. Se suman todos y despues se mira cual calza.
let T=Q.totalesNumericos(LI,false);
const de=c=>T.find(x=>x.campo===c);
chk('suma Quantity', de('Quantity').total===141, JSON.stringify(de('Quantity')));
chk('y tambien InventoryQuantity', de('InventoryQuantity').total===87);
chk('cuenta en cuantas lineas aparece', de('Quantity').veces===4);
// un codigo que parece numero NO es una cantidad: SAP lo manda como texto y
// sumarlo seria ruido que tapa el campo bueno
chk('un codigo de texto no se totaliza', !T.some(x=>x.campo==='ItemCode'));
chk('un texto tampoco', !T.some(x=>x.campo==='UoMCode'));
chk('el mas grande primero', T[0].total>=T[T.length-1].total);
let V=Q.totalesNumericos(LI,true);
chk('sin anulados baja el total',
    V.find(x=>x.campo==='Quantity').total===101 && V.find(x=>x.campo==='InventoryQuantity').total===61);
chk('sin lineas no hay totales', Q.totalesNumericos(null,false).length===0);

console.log('\n— los campos de texto que distinguen —');
let X=Q.valoresDeTexto(LI,6);
chk('la unidad de medida aparece con sus valores',
    X.some(x=>x.campo==='UoMCode' && x.valores.join(',')==='PAQ,UN'), JSON.stringify(X));
// un campo con un solo valor no distingue nada y solo hace ruido
chk('un campo con un valor unico no se lista', !X.some(x=>x.campo==='WarehouseCode'));
chk('los valores de muestra se topan',
    Q.valoresDeTexto([{linea:{u:'a'}},{linea:{u:'b'}},{linea:{u:'c'}}],2)[0].valores.length===2);
chk('sin lineas no hay campos', Q.valoresDeTexto(null,6).length===0);

console.log('\n— que campo da el numero que ya conocemos —');
chk('encuentra el que calza exacto', Q.candidatos(T,141).join(',')==='Quantity');
chk('y el otro cuando el esperado es el otro', Q.candidatos(T,87).join(',')==='InventoryQuantity');
chk('si ninguno calza no inventa', Q.candidatos(T,999).length===0);
chk('sin esperado no elige nada', Q.candidatos(T,null).length===0 && Q.candidatos(T,'x').length===0);
// OJO: Number(null) es 0 y es finito. Sin cuidado, no pasar --esperado se leia
// como "espero cero" y la sonda dictaminaba sobre un numero que nadie dio.
chk('ausente no es cero', isNaN(Q.numeroEsperado(null)) && isNaN(Q.numeroEsperado(undefined)) &&
    isNaN(Q.numeroEsperado('')) && isNaN(Q.numeroEsperado('  ')));
chk('pero un cero explicito si vale', Q.numeroEsperado(0)===0 && Q.numeroEsperado('0')===0);
chk('un esperado de cero si elige',
    Q.candidatos([{campo:'X',total:0}], 0).join(',')==='X');

console.log('\n— el veredicto —');
let v=Q.veredicto(['Quantity'],['Quantity'],141,0,T);
chk('calza con y sin anulados', v.nivel==='si' && /con y sin los anulados/.test(v.texto), v.texto);
v=Q.veredicto([],['InventoryQuantity'],61,1,T);
chk('calza solo descontando anulados',
    v.nivel==='si' && /SOLO descontando/.test(v.texto) && /InventoryQuantity/.test(v.texto), v.texto);
// si el campo que calza NO es el mismo con y sin anulados, no se puede decir
// "con y sin": son dos respuestas distintas y hay que quedarse con la buena
v=Q.veredicto(['Quantity'],['InventoryQuantity'],87,1,T);
chk('campos distintos con y sin anulados no se funden',
    /SOLO descontando/.test(v.texto) && /InventoryQuantity/.test(v.texto) &&
    !/con y sin los anulados/.test(v.texto), v.texto);
v=Q.veredicto(['Quantity'],[],141,1,T);
chk('calza solo contando todo', v.nivel==='si' && /contando todos/.test(v.texto), v.texto);
v=Q.veredicto([],[],3386,0,T);
chk('si nada calza lo dice', v.nivel==='no' && /NINGUN campo/.test(v.texto), v.texto);
chk('y no culpa a la unidad ni a la anulacion',
    /no es unidad de medida ni anulacion/.test(v.texto), v.texto);
// cuando algo queda cerca, nombrarlo ahorra el siguiente viaje
v=Q.veredicto([],[],140,0,T);
chk('nombra los que quedan cerca', /Quantity \(141\)/.test(v.texto), v.texto);
chk('sin esperado no dictamina', Q.veredicto([],[],null,0,T).nivel==='sin esperado');
chk('y explica por que', /la eleccion queda a ojo/.test(Q.veredicto([],[],null,0,T).texto));

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
