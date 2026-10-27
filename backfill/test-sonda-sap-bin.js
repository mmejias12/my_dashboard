'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const B=require('./sonda-sap-bin.js');
const S=require('./backfill-sap.js');

// ── coleccionesAnidadas ────────────────────────────────────────────────────
console.log('— coleccionesAnidadas: lo que la proyeccion de backfill-sap NO mira —');
let c=B.coleccionesAnidadas({DocEntry:1, Lines:[{a:1},{a:2}], Otra:[], Texto:'x', Obj:{a:1}, Nulo:null});
chk('encuentra las colecciones', c.map(x=>x.clave).join(',')==='Lines,Otra', JSON.stringify(c));
chk('cuenta los elementos', c.find(x=>x.clave==='Lines').n===2);
chk('una coleccion vacia tambien se informa', c.find(x=>x.clave==='Otra').n===0);
chk('un objeto NO es coleccion', !c.some(x=>x.clave==='Obj'));
chk('un string tampoco', !c.some(x=>x.clave==='Texto'));
chk('null tampoco', !c.some(x=>x.clave==='Nulo'));
chk('sale ordenado', B.coleccionesAnidadas({Z:[],A:[]}).map(x=>x.clave).join(',')==='A,Z');
chk('vacio y nulo no revientan', B.coleccionesAnidadas({}).length===0 && B.coleccionesAnidadas(null).length===0);

// ── coleccionesDeBin ───────────────────────────────────────────────────────
console.log('\n— coleccionesDeBin —');
const COL=[{clave:'StockTransferLinesBinAllocations',n:2},{clave:'SerialNumbers',n:0},
           {clave:'BatchNumbers',n:1},{clave:'DocumentLinesBinAllocations',n:3}];
chk('caza las de ubicacion', B.coleccionesDeBin(COL).map(x=>x.clave).join(',')
    ==='StockTransferLinesBinAllocations,DocumentLinesBinAllocations');
chk('no se lleva lotes ni series', !B.coleccionesDeBin(COL).some(x=>/Batch|Serial/.test(x.clave)));
// LA TRAMPA: 'BatchNumbers' contiene 'B' pero no 'bin'; y 'Combine' SI contiene 'bin'
chk('OJO: la heuristica es por nombre y lo dice',
    B.coleccionesDeBin([{clave:'Combine',n:1}]).length===1);
chk('tambien caza el castellano', B.coleccionesDeBin([{clave:'Ubicaciones',n:1}]).length===1);
chk('vacio y nulo no revientan', B.coleccionesDeBin([]).length===0 && B.coleccionesDeBin(null).length===0);

// ── utilesDeBin ────────────────────────────────────────────────────────────
console.log('\n— utilesDeBin: que la coleccion exista no basta —');
let u=B.utilesDeBin({BinAbsEntry:42, Quantity:120, AllowNegative:'tNO',
                     SerialAndBatchNumbersBaseLine:-1, BinActionType:'batToWarehouse'});
chk('encuentra la cantidad', u.cantidad.join(',')==='Quantity');
chk('encuentra la ubicacion', u.ubicacion.join(',')==='BinAbsEntry', u.ubicacion.join(','));
// BinActionType SI existe en la asignacion de B1 y NO es una ubicacion: buscar
// 'bin' en cualquier parte del nombre la contaria como tal
chk('BinActionType lleva Bin y NO es una ubicacion',
    u.ubicacion.indexOf('BinActionType')<0, u.ubicacion.join(','));
chk('y concluye que sirve', u.sirve===true);
chk('sin cantidad NO sirve', B.utilesDeBin({BinAbsEntry:42}).sirve===false);
chk('sin ubicacion NO sirve', B.utilesDeBin({Quantity:1}).sirve===false);
chk('una fila vacia no sirve', B.utilesDeBin({}).sirve===false && B.utilesDeBin(null).sirve===false);
chk('trae todas las claves para poder mirarlas',
    B.utilesDeBin({BinAbsEntry:1,Quantity:2,X:3}).claves.length===3);
// SerialAndBatchNumbersBaseLine NO es una ubicacion aunque tenga numeros
chk('no confunde la linea base con una ubicacion',
    B.utilesDeBin({SerialAndBatchNumbersBaseLine:-1}).ubicacion.length===0);
chk('acepta BinCode ademas de BinAbsEntry', B.utilesDeBin({BinCode:'A',Quantity:1}).sirve===true);

// ── binHabilitado ──────────────────────────────────────────────────────────
console.log('\n— binHabilitado: sin gestion por ubicaciones, la coleccion vacia es lo normal —');
chk('tYES de B1', B.binHabilitado({EnableBinLocations:'tYES'})===true);
chk('tNO de B1', B.binHabilitado({EnableBinLocations:'tNO'})===false);
chk('booleano', B.binHabilitado({EnableBinLocations:true})===true);
chk('el nombre alternativo', B.binHabilitado({BinLocationsEnabled:'tYES'})===true);
// si el campo NO viene, eso NO es "no": es que no sabemos, y se distingue
chk('campo ausente devuelve null, no false', B.binHabilitado({})===null && B.binHabilitado(null)===null);
chk('null no es lo mismo que false', B.binHabilitado({})!==B.binHabilitado({EnableBinLocations:'tNO'}));

// ── totalBin ───────────────────────────────────────────────────────────────
console.log('\n— totalBin: cuantas asignaciones trae el documento entero —');
// las dos primeras lineas con DISTINTA cantidad de asignaciones, para que
// contar lineas y contar asignaciones no den por casualidad el mismo numero
const DOC={StockTransferLines:[
  {LineNum:0, StockTransferLinesBinAllocations:[{BinAbsEntry:1,Quantity:10},{BinAbsEntry:2,Quantity:5},{BinAbsEntry:3,Quantity:1}], SerialNumbers:[]},
  {LineNum:1, StockTransferLinesBinAllocations:[{BinAbsEntry:4,Quantity:7},{BinAbsEntry:5,Quantity:2}], SerialNumbers:[]},
  {LineNum:2, StockTransferLinesBinAllocations:[], SerialNumbers:[]}]};
let t=B.totalBin(DOC,'StockTransferLines');
chk('cuenta las lineas', t.lineas===3);
chk('suma las asignaciones de TODAS las lineas, no una por linea', t.filas===5, JSON.stringify(t));
chk('y cuantas lineas tienen alguna', t.lineasConBin===2);
chk('un documento sin asignaciones da cero', B.totalBin({L:[{L:0,SerialNumbers:[]}]},'L').filas===0);
chk('sin clave de lineas no revienta', B.totalBin(DOC,null).filas===0 && B.totalBin(null,'X').lineas===0);

// ── compararFormas ─────────────────────────────────────────────────────────
console.log('\n— compararFormas: la lista y la clave NO devuelven lo mismo —');
chk('si la lista ya lo trae, se dice',
    B.compararFormas({filas:3},{filas:3}).veredicto==='la lista ya lo trae');
chk('vacio en la lista y lleno por clave es el caso que importa',
    B.compararFormas({filas:0},{filas:3}).veredicto==='SOLO por clave');
chk('vacio en las dos', B.compararFormas({filas:0},{filas:0}).veredicto==='vacio en las dos formas');
chk('informa los dos numeros',
    B.compararFormas({filas:0},{filas:7}).lista===0 && B.compararFormas({filas:0},{filas:7}).clave===7);
chk('nulos no revientan', B.compararFormas(null,null).veredicto==='vacio en las dos formas');
// la lista manda: si ya viene, no importa lo que diga la clave
chk('con la lista llena no se declara "solo por clave"',
    B.compararFormas({filas:2},{filas:0}).veredicto==='la lista ya lo trae');

// ── urlExpand ──────────────────────────────────────────────────────────────
console.log('\n— urlExpand: el tercer camino, el que decide el costo —');
const U=B.urlExpand('https://h/b1s/v1','StockTransfers','StockTransferLines','StockTransferLinesBinAllocations',2);
chk('arma la url', /\/StockTransfers\?/.test(U), U);
chk('pide el expand anidado', /expand=StockTransferLines%2FStockTransferLinesBinAllocations/.test(U), U);
chk('respeta el top', /\$top=2/.test(U));
chk('ordena por DocEntry para que sea estable', /orderby=DocEntry/.test(decodeURIComponent(U)));
// el $select ANIDADO es el que no es confiable en B1; el expand va PELADO
chk('NO mete un $select adentro del expand', U.indexOf('select')<0, U);
chk('top por defecto', /\$top=2/.test(B.urlExpand('r','E','L','B')));
chk('sin coleccion de bin no hay url', B.urlExpand('r','E','L',null)===null);
chk('sin lineas tampoco', B.urlExpand('r','E',null,'B')===null);
chk('sin entidad ni raiz tampoco',
    B.urlExpand('r',null,'L','B')===null && B.urlExpand(null,'E','L','B')===null);

// ── raizV2 / urlExpandAnidado ──────────────────────────────────────────────
console.log('\n— raizV2 y el expand anidado: la v1 habla OData v3, la v2 habla v4 —');
chk('cambia v1 por v2', B.raizV2('https://h:50000/b1s/v1')==='https://h:50000/b1s/v2');
chk('tambien desde v2', B.raizV2('https://h:50000/b1s/v2')==='https://h:50000/b1s/v2');
chk('una raiz que no termina en /b1s/vN no se adivina',
    B.raizV2('https://h/api')===null && B.raizV2('https://h/b1s/v1/Orders')===null);
chk('vacio y nulo', B.raizV2('')===null && B.raizV2(null)===null);
const UA=B.urlExpandAnidado('https://h:50000/b1s/v1','StockTransfers',
                            'StockTransferLines','StockTransferLinesBinAllocations',2);
chk('apunta a la v2', /\/b1s\/v2\//.test(UA), UA);
// la sintaxis v4 anida con parentesis; la v3 lo hacia con barra y por eso rebota
chk('anida con parentesis, no con barra',
    decodeURIComponent(UA).indexOf('StockTransferLines($expand=StockTransferLinesBinAllocations)')>=0,
    decodeURIComponent(UA));
chk('no usa la barra del dialecto viejo',
    decodeURIComponent(UA).indexOf('StockTransferLines/StockTransferLinesBinAllocations')<0);
chk('tambien ordena por DocEntry: sin orden estable la pagina no es comparable',
    /orderby=DocEntry/.test(decodeURIComponent(UA)), UA);
chk('y la forma vieja SI usa la barra',
    decodeURIComponent(B.urlExpand('https://h/b1s/v1','E','L','B'))
      .indexOf('expand=L/B')>=0);
chk('sin coleccion de bin no hay url anidada',
    B.urlExpandAnidado('https://h/b1s/v1','E','L',null)===null);
chk('con una raiz rara tampoco', B.urlExpandAnidado('https://h/api','E','L','B')===null);

// ── veredictoBin ───────────────────────────────────────────────────────────
console.log('\n— veredictoBin: tres respuestas, tres caminos distintos —');
const V=h=>B.veredictoBin(h);
chk('una entidad que sirve basta', V([{entidad:'A',tieneColeccion:true,sirve:true}]).nivel==='si');
chk('y nombra cual', V([{entidad:'StockTransfers',tieneColeccion:true,sirve:true}]).entidades[0]==='StockTransfers');
chk('la coleccion vacia es su propio caso',
    V([{entidad:'A',tieneColeccion:true,sirve:false}]).nivel==='vacia');
chk('sin coleccion es que no', V([{entidad:'A',tieneColeccion:false,sirve:false}]).nivel==='no');
// el caso real del 23-oct: la coleccion esta, viene vacia en la lista, y la
// pregunta es si llega pidiendo el documento por su clave
chk('vacia en la lista pero llena por clave tiene su propio nivel',
    V([{entidad:'A',tieneColeccion:true,sirve:false,sirvePorClave:true}]).nivel==='solo por clave');
// el $expand es el mejor caso: pagina como hoy
chk('con $expand tiene su propio nivel',
    V([{entidad:'A',tieneColeccion:true,sirvePorClave:true,sirveConExpand:true}]).nivel==='con expand');
chk('y manda sobre "solo por clave"',
    V([{entidad:'A',sirvePorClave:true,tieneColeccion:true},
       {entidad:'B',sirveConExpand:true}]).nivel==='con expand');
chk('pero NO manda sobre la lista pelada',
    V([{entidad:'A',sirveConExpand:true},{entidad:'B',sirve:true}]).nivel==='si');
chk('el texto del expand no promete sin verificar, y dice QUE verificar',
    /no corte la pagina ni pierda lineas/.test(V([{entidad:'A',sirveConExpand:true}]).texto),
    V([{entidad:'A',sirveConExpand:true}]).texto);
chk('y avisa del costo, que es una peticion por documento',
    /por documento/.test(V([{entidad:'A',tieneColeccion:true,sirve:false,sirvePorClave:true}]).texto));
chk('un "sirve" de la lista manda sobre "por clave"',
    V([{entidad:'A',sirvePorClave:true,tieneColeccion:true},{entidad:'B',sirve:true}]).nivel==='si');
chk('"por clave" manda sobre "vacia"',
    V([{entidad:'A',tieneColeccion:true,sirve:false},
       {entidad:'B',tieneColeccion:true,sirve:false,sirvePorClave:true}]).nivel==='solo por clave');
chk('sin hallazgos no concluye', V([]).nivel==='sin datos' && V(null).nivel==='sin datos');
chk('un "sirve" manda sobre una vacia',
    V([{entidad:'A',tieneColeccion:true,sirve:false},{entidad:'B',tieneColeccion:true,sirve:true}]).nivel==='si');
// los textos tienen que llevar a la accion correcta, no a una frase bonita
chk('el si dice que el arreglo es la proyeccion, no una fuente nueva',
    /la proyeccion los descarta/.test(V([{sirve:true,entidad:'A'}]).texto) &&
    /no una fuente nueva/.test(V([{sirve:true,entidad:'A'}]).texto));
chk('el vacia advierte que una muestra no basta',
    /no basta/.test(V([{tieneColeccion:true,sirve:false,entidad:'A'}]).texto));
chk('el no manda a SQL sobre HANA', /HANA/.test(V([{tieneColeccion:false,sirve:false,entidad:'A'}]).texto));
chk('el no nombra donde vive el dato', /ILM1/.test(V([{tieneColeccion:false,sirve:false,entidad:'A'}]).texto));

// ── de punta a punta: una linea de StockTransfer como la manda B1 ──────────
console.log('\n— de punta a punta: una linea tal como la manda el Service Layer —');
const LINEA={LineNum:0, ItemCode:'11111111110', Quantity:540, WarehouseCode:'CLIENTES',
  FromWarehouseCode:'RT13-100', SerialNumbers:[], BatchNumbers:[],
  StockTransferLinesBinAllocations:[
    {BinAbsEntry:331, Quantity:540, AllowNegative:'tNO', SerialAndBatchNumbersBaseLine:-1, BinActionType:'batToWarehouse'}]};
const col=B.coleccionesAnidadas(LINEA);
chk('ve las tres colecciones de la linea', col.length===3, col.map(x=>x.clave).join(','));
const bin=B.coleccionesDeBin(col);
chk('y se queda con la de ubicacion', bin.length===1 && bin[0].n===1);
const ut=B.utilesDeBin(LINEA.StockTransferLinesBinAllocations[0]);
chk('la asignacion trae cantidad y ubicacion', ut.sirve===true, JSON.stringify(ut));
chk('o sea el veredicto seria que SI',
    B.veredictoBin([{entidad:'StockTransfers',tieneColeccion:true,sirve:true}]).nivel==='si');
// y la contraparte: si B1 no tiene gestion por ubicaciones, la coleccion no viene
const SIN={LineNum:0, Quantity:540, SerialNumbers:[], BatchNumbers:[]};
chk('sin gestion por ubicaciones no hay coleccion de bin',
    B.coleccionesDeBin(B.coleccionesAnidadas(SIN)).length===0);

// ── que lo prestado de backfill-sap siga en pie ───────────────────────────
console.log('\n— lo que se toma prestado —');
chk('nombreLineas encuentra la coleccion de lineas',
    S.nombreLineas({DocEntry:1, StockTransferLines:[{}]})==='StockTransferLines');
chk('crearSesion sigue exportada', typeof S.crearSesion==='function');
chk('las tres entidades con ubicacion estan declaradas',
    B.ENTIDADES_BIN.length===3 && B.ENTIDADES_BIN.indexOf('StockTransfers')>=0);
chk('y las tres estan en la lista blanca de backfill-sap',
    B.ENTIDADES_BIN.every(e=>S.ENTIDADES.indexOf(e)>=0));
chk('--entidades y --docs son opciones con valor',
    B.OPCIONES.indexOf('entidades')>=0 && B.OPCIONES.indexOf('docs')>=0);
chk('--crudo es bandera', B.BANDERAS.indexOf('crudo')>=0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
