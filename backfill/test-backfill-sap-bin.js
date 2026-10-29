'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const B=require('./backfill-sap-bin.js');
const S=require('./backfill-sap.js');
const SU=require('./sonda-sap-ubicacion.js');

// ── deltaDeAsignacion: la funcion que decide el signo ──────────────────────
console.log('— deltaDeAsignacion: equivocar el signo da un saldo que igual PARECE un saldo —');
// los dos casos medidos sobre DocEntry 35058202
chk('batFromWarehouse SALE y es negativo',
    B.deltaDeAsignacion({BinAbsEntry:5271, Quantity:4, BinActionType:'batFromWarehouse'})===-4);
chk('batToWarehouse ENTRA y es positivo',
    B.deltaDeAsignacion({BinAbsEntry:5275, Quantity:4, BinActionType:'batToWarehouse'})===4);
chk('los dos no son lo mismo',
    B.deltaDeAsignacion({Quantity:4,BinActionType:'batFromWarehouse'})!==
    B.deltaDeAsignacion({Quantity:4,BinActionType:'batToWarehouse'}));
// un tipo desconocido NO se adivina
chk('un BinActionType desconocido devuelve null, no cero',
    B.deltaDeAsignacion({Quantity:4, BinActionType:'batOtraCosa'})===null);
chk('sin tipo tampoco se adivina', B.deltaDeAsignacion({Quantity:4})===null);
chk('cero es un delta valido, no un dato ausente',
    B.deltaDeAsignacion({Quantity:0, BinActionType:'batToWarehouse'})===0);
chk('una cantidad no numerica no pasa',
    B.deltaDeAsignacion({Quantity:'cuatro', BinActionType:'batToWarehouse'})===null);
chk('una cantidad ausente tampoco', B.deltaDeAsignacion({BinActionType:'batToWarehouse'})===null);
chk('tolera espacios en el tipo',
    B.deltaDeAsignacion({Quantity:2, BinActionType:' batToWarehouse '})===2);
chk('un decimal se conserva',
    B.deltaDeAsignacion({Quantity:1.5, BinActionType:'batFromWarehouse'})===-1.5);
chk('nulo no revienta', B.deltaDeAsignacion(null)===null && B.deltaDeAsignacion(undefined)===null);

// ── filasDeDocumento ───────────────────────────────────────────────────────
console.log('\n— filasDeDocumento: una fila por asignacion, solo del item pedido —');
const DOC={DocEntry:35058202, DocNum:695061, DocDate:'2026-10-23T00:00:00Z', CardCode:'C91004000-6',
  StockTransferLines:[
    {LineNum:0, ItemCode:'11111111110', SerialNumbers:[], BatchNumbers:[],
     StockTransferLinesBinAllocations:[
       {BinAbsEntry:5271, Quantity:4, BinActionType:'batFromWarehouse'},
       {BinAbsEntry:5275, Quantity:4, BinActionType:'batToWarehouse'}]},
    {LineNum:1, ItemCode:'OTRO-ITEM',
     StockTransferLinesBinAllocations:[{BinAbsEntry:99, Quantity:9, BinActionType:'batToWarehouse'}]}]};
let r=B.filasDeDocumento(DOC,'StockTransferLines','11111111110');
chk('dos filas de la linea del pallet rojo', r.filas.length===2, JSON.stringify(r.filas));
chk('descarta el otro item', !r.filas.some(f=>f.ItemCode==='OTRO-ITEM'));
chk('arrastra la cabecera', r.filas[0].DocEntry===35058202 && r.filas[0].DocNum===695061 &&
    r.filas[0].CardCode==='C91004000-6');
chk('recorta la fecha a YYYY-MM-DD', r.filas[0].DocDate==='2026-10-23', r.filas[0].DocDate);
chk('guarda la ubicacion y la cantidad', r.filas[0].BinAbsEntry===5271 && r.filas[0].Quantity===4);
chk('y el delta con su signo', r.filas[0].delta===-4 && r.filas[1].delta===4);
chk('sin item trae todas',
    B.filasDeDocumento(DOC,'StockTransferLines',null).filas.length===3);
// una asignacion con tipo desconocido se CUENTA, no se descarta en silencio
const RARO={DocEntry:1, StockTransferLines:[{LineNum:0, ItemCode:'X',
  StockTransferLinesBinAllocations:[{BinAbsEntry:1,Quantity:1,BinActionType:'batRaro'}]}]};
let rr=B.filasDeDocumento(RARO,'StockTransferLines',null);
chk('el tipo desconocido no entra como fila', rr.filas.length===0);
chk('pero queda contado y dice cual era', rr.raros.length===1 && rr.raros[0].tipo==='batRaro');
chk('un documento sin lineas', B.filasDeDocumento({DocEntry:1},'StockTransferLines',null).filas.length===0);
chk('sin clave de lineas', B.filasDeDocumento(DOC,null,null).filas.length===0);
chk('nulo no revienta', B.filasDeDocumento(null,'x',null).filas.length===0);
// la coleccion de lotes NO es de ubicaciones
// y tampoco entra por la puerta de atras como "tipo desconocido": ni siquiera
// se mira, porque no es una coleccion de ubicaciones
const LOTES=B.filasDeDocumento({DocEntry:1, StockTransferLines:[{LineNum:0, ItemCode:'X',
  BatchNumbers:[{Quantity:5}], SerialNumbers:[{Quantity:7}]}]},'StockTransferLines',null);
chk('BatchNumbers no se confunde con una asignacion de ubicacion', LOTES.filas.length===0);
chk('y no se cuenta como tipo desconocido: no es una coleccion de ubicaciones',
    LOTES.raros.length===0, JSON.stringify(LOTES.raros));
// el ItemCode puede venir como numero desde SAP
chk('el filtro de item compara por valor, no por tipo',
    B.filasDeDocumento({DocEntry:1, StockTransferLines:[{LineNum:0, ItemCode:11111111110,
      StockTransferLinesBinAllocations:[{BinAbsEntry:1,Quantity:1,BinActionType:'batToWarehouse'}]}]},
      'StockTransferLines','11111111110').filas.length===1);

// ── las urls ───────────────────────────────────────────────────────────────
console.log('\n— urlLista y urlPorClave —');
const UL=B.urlLista('https://h/b1s/v1','StockTransfers','DocDate','2026-09-01','2026-09-30',200,400);
chk('filtra por el rango', /DocDate%20ge%20'2026-09-01'/.test(UL) || /ge '2026-09-01'/.test(decodeURIComponent(UL)),
    decodeURIComponent(UL));
chk('ordena por DocEntry asc, que es unico y estable',
    /orderby=DocEntry asc/.test(decodeURIComponent(UL)));
chk('pagina con top y skip', /\$top=200/.test(UL) && /\$skip=400/.test(UL));
chk('respeta el top que le pasan, no uno fijo',
    /\$top=50/.test(B.urlLista('r','E','DocDate','a','b',50,0)),
    B.urlLista('r','E','DocDate','a','b',50,0));
chk('sin top cae a 200', /\$top=200/.test(B.urlLista('r','E','DocDate','a','b')));
chk('sin rango no arma url', B.urlLista('r','E','DocDate',null,'2026-09-30',10,0)===null &&
    B.urlLista('r','E','DocDate','2026-09-01',null,10,0)===null);
chk('sin raiz ni entidad tampoco',
    B.urlLista(null,'E','DocDate','a','b',1,0)===null && B.urlLista('r',null,'DocDate','a','b',1,0)===null);
const UC=B.urlPorClave('https://h/b1s/v1','StockTransfers',35058202);
chk('la url por clave lleva el DocEntry entre parentesis',
    UC==='https://h/b1s/v1/StockTransfers(35058202)', UC);
chk('un DocEntry 0 es valido', B.urlPorClave('r','E',0)==='r/E(0)');
chk('sin DocEntry no arma url',
    B.urlPorClave('r','E',null)===null && B.urlPorClave('r','E','')===null);

// ── saldoPorBin: el control de cordura ─────────────────────────────────────
console.log('\n— saldoPorBin: en un traspaso la suma de los deltas tiene que dar CERO —');
let sb=B.saldoPorBin(r.filas);
chk('suma por ubicacion', sb.porBin.get(5271)===-4 && sb.porBin.get(5275)===4);
chk('en una linea con las dos puntas el total da cero', sb.total===0, String(sb.total));
// pero el total del MES no tiene por que dar cero, y creer que si fue un error
// mio que marcaba NO CUADRA sobre datos sanos
chk('el total de un mes con traspasos a bodegas sin ubicaciones NO da cero',
    B.saldoPorBin([{BinAbsEntry:1,delta:-4},{BinAbsEntry:2,delta:4},{BinAbsEntry:3,delta:8116}]).total===8116);
chk('si falta una punta NO da cero',
    B.saldoPorBin([{BinAbsEntry:1,delta:-4}]).total===-4);
chk('acumula varias filas de la misma ubicacion',
    B.saldoPorBin([{BinAbsEntry:1,delta:3},{BinAbsEntry:1,delta:-1}]).porBin.get(1)===2);
chk('lista vacia', B.saldoPorBin([]).total===0 && B.saldoPorBin(null).porBin.size===0);

// ── controlDePuntas ────────────────────────────────────────────────────────
console.log('\n— controlDePuntas: el neto del mes NO tiene por que dar cero —');
// una linea con las dos puntas: sale de una ubicacion y entra en otra
const DOS=[{DocEntry:1,LineNum:0,BinAbsEntry:5271,delta:-4},
           {DocEntry:1,LineNum:0,BinAbsEntry:5275,delta:4}];
let cp=B.controlDePuntas(DOS);
chk('cuenta la linea con las dos puntas', cp.dosPuntas===1 && cp.lineas===1);
chk('y netea cero, asi que no hay descuadre', cp.descuadradas.length===0);
// una linea con UNA sola punta es legitima: la otra bodega no tiene ubicaciones
let una=B.controlDePuntas([{DocEntry:2,LineNum:0,BinAbsEntry:1,delta:-7}]);
chk('una sola punta de salida se cuenta aparte', una.soloSale===1 && una.dosPuntas===0);
chk('y NO se declara descuadrada', una.descuadradas.length===0);
let ent=B.controlDePuntas([{DocEntry:3,LineNum:0,BinAbsEntry:1,delta:7}]);
chk('una sola punta de entrada tambien', ent.soloEntra===1 && ent.descuadradas.length===0);
// EL caso que importa: dos puntas que no netean
let mal=B.controlDePuntas([{DocEntry:4,LineNum:0,BinAbsEntry:1,delta:-4},
                           {DocEntry:4,LineNum:0,BinAbsEntry:2,delta:3}]);
chk('dos puntas que NO netean es el descuadre de verdad',
    mal.descuadradas.length===1 && mal.descuadradas[0].neto===-1, JSON.stringify(mal.descuadradas));
chk('y dice que documento y que linea',
    mal.descuadradas[0].DocEntry===4 && mal.descuadradas[0].LineNum===0);
// las lineas se separan dentro del mismo documento
let dosl=B.controlDePuntas([{DocEntry:5,LineNum:0,delta:-1},{DocEntry:5,LineNum:0,delta:1},
                            {DocEntry:5,LineNum:1,delta:-2}]);
chk('dos lineas del mismo documento no se mezclan',
    dosl.lineas===2 && dosl.dosPuntas===1 && dosl.soloSale===1);
// y el conjunto del mes: neto distinto de cero SIN descuadres
let mes=B.controlDePuntas(DOS.concat([{DocEntry:9,LineNum:0,BinAbsEntry:3,delta:8116}]));
chk('un mes puede netear 8.116 y estar perfecto',
    mes.descuadradas.length===0 && B.saldoPorBin(DOS.concat([{BinAbsEntry:3,delta:8116}])).total===8116);
// un delta CERO existe (Quantity 0 con tipo valido) y no es ni entrada ni
// salida: contarlo como entrada convierte una linea sana en un falso descuadre
let cero=B.controlDePuntas([{DocEntry:7,LineNum:0,delta:0}]);
chk('un delta cero no es entrada ni salida',
    cero.soloEntra===0 && cero.soloSale===0 && cero.ceroNeto===1, JSON.stringify(cero));
chk('y una linea con un cero y una salida no es "dos puntas"',
    B.controlDePuntas([{DocEntry:8,LineNum:0,delta:0},{DocEntry:8,LineNum:0,delta:-5}]).dosPuntas===0);
chk('esa linea no se declara descuadrada',
    B.controlDePuntas([{DocEntry:8,LineNum:0,delta:0},{DocEntry:8,LineNum:0,delta:-5}]).descuadradas.length===0);
chk('lista vacia', B.controlDePuntas([]).lineas===0 && B.controlDePuntas(null).lineas===0);

// ── atribuir ───────────────────────────────────────────────────────────────
console.log('\n— atribuir: una fila sin cliente no se descarta en silencio —');
const MAPA=new Map([[5271,'C91004000-6'],[5275,'C91438000-6']]);
let at=B.atribuir(r.filas, MAPA);
chk('atribuye las dos', at.con.length===2 && at.sin.length===0);
chk('agrega el CardCode de la ubicacion, sin pisar el del documento',
    at.con[0].CardCodeBin==='C91004000-6' && at.con[0].CardCode==='C91004000-6');
chk('la ubicacion y el documento pueden tener socios distintos',
    at.con[1].CardCodeBin==='C91438000-6' && at.con[1].CardCode==='C91004000-6');
let at2=B.atribuir([{BinAbsEntry:999,delta:1}], MAPA);
chk('la que no esta en el mapa va aparte', at2.con.length===0 && at2.sin.length===1);
chk('sin mapa no atribuye nada pero no pierde filas',
    B.atribuir(r.filas,null).sin.length===2);
chk('lista vacia', B.atribuir([],MAPA).con.length===0 && B.atribuir(null,MAPA).sin.length===0);

// ── de punta a punta: documento -> filas -> cliente ────────────────────────
console.log('\n— de punta a punta: del documento al saldo por cliente —');
const BINS=[{AbsEntry:5271, Sublevel1:'PF', Description:'PF CENTRO DISTRIBUCION TALCA', IsSystemBin:'tNO'},
            {AbsEntry:5275, Sublevel1:'PF', Description:'PF CHILLAN', IsSystemBin:'tNO'},
            {AbsEntry:5276, Sublevel1:'PF', Description:'NOMBRE QUE NO ESTA', IsSystemBin:'tNO'}];
const IDX=SU.indiceDirecciones([{cod:'C91004000-6',
  dirs:[{nombre:'PF CENTRO DISTRIBUCION TALCA'},{nombre:'PF CHILLAN'}]}]).indice;
const PR=SU.propagarPorGrupo(BINS, IDX, 'Description', 'Sublevel1');
chk('el mapa cubre las tres, dos por nombre y una por grupo', PR.asignacion.size===3);
const AT=B.atribuir(B.filasDeDocumento(DOC,'StockTransferLines','11111111110').filas, PR.asignacion);
chk('las dos filas quedan atribuidas al mismo cliente',
    AT.con.length===2 && AT.con.every(f=>f.CardCodeBin==='C91004000-6'));
// y el saldo de ESE cliente en el traspaso interno es cero, porque movio entre
// dos ubicaciones suyas
chk('un traspaso entre dos ubicaciones del mismo cliente no le cambia el saldo',
    B.saldoPorBin(AT.con).total===0);
// pero si la punta de entrada fuera de otro cliente, el saldo se mueve
const AT2=B.atribuir(B.filasDeDocumento(DOC,'StockTransferLines','11111111110').filas, MAPA);
const porCli=new Map();
for (const f of AT2.con) porCli.set(f.CardCodeBin,(porCli.get(f.CardCodeBin)||0)+f.delta);
chk('entre clientes distintos uno pierde y el otro gana',
    porCli.get('C91004000-6')===-4 && porCli.get('C91438000-6')===4,
    JSON.stringify([...porCli]));

// ── lo prestado ────────────────────────────────────────────────────────────
console.log('\n— lo que se toma prestado, en vez de copiarlo —');
chk('nombreLineas de backfill-sap', S.nombreLineas(DOC)==='StockTransferLines');
chk('finDeMes de backfill-sap', S.finDeMes('2026-02')==='2026-02-28');
chk('listarMeses de backfill-sap', S.listarMeses('2026-09','2026-10').join(',')==='2026-09,2026-10');
chk('propagarPorGrupo de la sonda de ubicacion', typeof SU.propagarPorGrupo==='function');
chk('la lista de clientes del arriendo', SU.CLIENTES_ARRIENDO.split(',').length===77);
chk('StockTransfers esta en la lista blanca de backfill-sap',
    S.ENTIDADES.indexOf('StockTransfers')>=0);

// ── opciones ───────────────────────────────────────────────────────────────
console.log('\n— opciones —');
chk('--maestro y --forzar son banderas',
    B.BANDERAS.indexOf('maestro')>=0 && B.BANDERAS.indexOf('forzar')>=0);
chk('--conc y --item son opciones con valor',
    B.OPCIONES.indexOf('conc')>=0 && B.OPCIONES.indexOf('item')>=0);
chk('--bodega y --clientes tambien, para el modo maestro',
    B.OPCIONES.indexOf('bodega')>=0 && B.OPCIONES.indexOf('clientes')>=0);

// ── urlSociosPorPrefijo ────────────────────────────────────────────────────
console.log('\n— los socios por prefijo: la lista sale de SAP, no de una constante —');
let u = B.urlSociosPorPrefijo('https://h/b1s/v1', 'R', 200, 0);
chk('pega el filtro por rango y no por startswith',
    /CardCode%20ge%20'R'%20and%20CardCode%20lt%20'S'/.test(u), u);
chk('y no usa startswith', !/startswith/i.test(u));
chk('ordena por CardCode para poder paginar', /orderby=CardCode%20asc/.test(u));
chk('lleva top y skip', /top=200/.test(u) && /skip=0/.test(u));
// EL SUCESOR SE CALCULA, no se escribe: con 'C' tiene que dar 'D'
chk('el sucesor de C es D', /ge%20'C'%20and%20CardCode%20lt%20'D'/.test(
    B.urlSociosPorPrefijo('https://h/b1s/v1', 'C', 200, 0)));
chk('el sucesor de R es S', /lt%20'S'/.test(B.urlSociosPorPrefijo('https://h/b1s/v1', 'R')));
// un prefijo de dos letras: solo cambia la ULTIMA
u = B.urlSociosPorPrefijo('https://h/b1s/v1', 'RT', 200, 0);
chk('un prefijo de dos letras avanza solo la ultima',
    /ge%20'RT'%20and%20CardCode%20lt%20'RU'/.test(u), u);
chk('limpia los espacios del prefijo',
    B.urlSociosPorPrefijo('https://h/b1s/v1', ' R ', 200, 0) ===
    B.urlSociosPorPrefijo('https://h/b1s/v1', 'R', 200, 0));
chk('el skip se respeta', /skip=400/.test(B.urlSociosPorPrefijo('https://h/b1s/v1', 'R', 200, 400)));
chk('sin prefijo no hay url', B.urlSociosPorPrefijo('https://h/b1s/v1', '') === null &&
    B.urlSociosPorPrefijo('https://h/b1s/v1', null) === null &&
    B.urlSociosPorPrefijo('https://h/b1s/v1', '  ') === null);
chk('sin raiz tampoco', B.urlSociosPorPrefijo(null, 'R') === null);
chk('--prefijo es una opcion con valor', B.OPCIONES.indexOf('prefijo') >= 0);

console.log('\n— la ventana incremental: hasta donde llega el corte —');
chk('sin --desde el mes va entero', B.corteDeVentana(null,'2026-10').completo === true &&
    B.corteDeVentana(null,'2026-10').corte == null);
chk('una fecha dentro del mes es el corte', B.corteDeVentana('2026-10-24','2026-10').corte === '2026-10-24');
chk('y no se marca como completo', B.corteDeVentana('2026-10-24','2026-10').completo === false);
// una ventana que empieza antes del mes cubre el mes entero: no hay que fusionar
chk('una fecha anterior al mes cubre todo',
    B.corteDeVentana('2026-09-15','2026-10').completo === true);
chk('el primer dia tambien', B.corteDeVentana('2026-10-01','2026-10').completo === true);
// un mes entero anterior a la ventana NO se toca
chk('un mes anterior a la ventana queda fuera', B.corteDeVentana('2026-10-24','2026-09').fuera === true);
chk('el ultimo dia del mes todavia entra', B.corteDeVentana('2026-10-31','2026-10').corte === '2026-10-31');
chk('febrero bisiesto se respeta', B.corteDeVentana('2024-02-29','2024-02').corte === '2024-02-29');
chk('una fecha mal escrita se rechaza', /no es YYYY-MM-DD/.test(B.corteDeVentana('24-10-2026','2026-10').error||''));
chk('un mes mal escrito tambien', /mes invalido/.test(B.corteDeVentana(null,'octubre').error||''));

console.log('\n— que documentos se vuelven a pedir —');
const ENT = [
  { DocEntry: 1, DocDate: '2026-10-02' },
  { DocEntry: 2, DocDate: '2026-10-23' },
  { DocEntry: 3, DocDate: '2026-10-24' },
  { DocEntry: 4, DocDate: '2026-10-26T00:00:00Z' },
  { DocEntry: 5, DocDate: null },
  { DocEntry: 6, DocDate: '2026-10-05T12:00:00Z' },   // con hora y ANTES del corte
];
const P1 = B.partirEntries(ENT, '2026-10-24');
chk('se piden los del corte en adelante', P1.traer.join() === '3,4,5', P1.traer.join());
chk('los anteriores quedan como estaban', P1.antes.join() === '1,2,6', P1.antes.join());
// SIN cortar la fecha a diez, una con hora no calza el patron y se volveria a
// pedir aunque sea vieja: es la diferencia entre fusionar y re-extraer medio mes
chk('una fecha con hora ANTERIOR al corte no se vuelve a pedir', !P1.traer.includes(6));
// el corte es INCLUSIVO: el dia del corte se vuelve a pedir
chk('el dia del corte se vuelve a pedir', P1.traer.includes(3));
// una fecha con hora se corta a diez caracteres, no se descarta
chk('una fecha con hora se entiende', P1.traer.includes(4));
// sin fecha legible se pide: es el lado seguro
chk('un documento sin fecha se pide', P1.traer.includes(5));
chk('sin corte se piden todos', B.partirEntries(ENT, null).traer.length === 6);
chk('una entrada sin DocEntry se ignora', B.partirEntries([{DocDate:'2026-10-25'}], null).traer.length === 0);
chk('sin entradas no revienta', B.partirEntries(null,'2026-10-24').traer.length === 0);

console.log('\n— la fusion con lo que ya estaba —');
const VIEJAS = [
  { DocEntry: 1, DocDate: '2026-10-02', delta:  5 },
  { DocEntry: 2, DocDate: '2026-10-23', delta:  7 },
  { DocEntry: 3, DocDate: '2026-10-24', delta: 11 },   // dentro de la ventana: se descarta
  { DocEntry: 9, DocDate: '',           delta: 99 },   // sin fecha: se descarta
  { DocEntry: 8, DocDate: '2026-10-05T12:00:00Z', delta: 23 },   // con hora, anterior
];
const NUEVAS = [
  { DocEntry: 3, DocDate: '2026-10-24', delta: 13 },   // el mismo doc, valor corregido
  { DocEntry: 7, DocDate: '2026-10-26', delta: 17 },
];
const F = B.fusionarFilas(VIEJAS, NUEVAS, '2026-10-24');
chk('conserva lo anterior al corte', F.filter(x=>x.DocEntry===1||x.DocEntry===2).length === 2);
// la version vieja de un documento de la ventana NO puede sobrevivir
chk('no quedan dos versiones del mismo documento',
    F.filter(x=>x.DocEntry===3).length === 1 && F.find(x=>x.DocEntry===3).delta === 13);
chk('entra lo nuevo', F.some(x=>x.DocEntry===7));
// una fila vieja sin fecha se descarta: su documento se vuelve a pedir
chk('una fila vieja sin fecha no se conserva', !F.some(x=>x.DocEntry===9));
chk('una fila vieja con hora anterior al corte se conserva', F.some(x=>x.DocEntry===8));
chk('el total cuadra', F.length === 5, String(F.length));
// un documento de la ventana que se anulo en SAP desaparece, no queda colgado
chk('un documento anulado en la ventana desaparece',
    !B.fusionarFilas(VIEJAS, [], '2026-10-24').some(x=>x.DocEntry===3));
chk('sin corte la fusion es solo lo nuevo', B.fusionarFilas(VIEJAS, NUEVAS, null).length === 2);
chk('sin filas viejas tampoco revienta', B.fusionarFilas(null, NUEVAS, '2026-10-24').length === 2);
chk('--desde es una opcion con valor', B.OPCIONES.indexOf('desde') >= 0);

console.log('\n— lineasDeDocumento: el movimiento de bodega, que es lo unico que ve la planta —');
// los nombres de los campos NO son un supuesto: los confirmo la sonda contra
// SAP el 27-10-2026, buscandolos por contenido. Si alguien los cambia aca sin
// volver a medir, esta prueba es el recordatorio.
chk('los campos son los que confirmo la sonda',
    B.CAMPO_DESDE === 'FromWarehouseCode' && B.CAMPO_HACIA === 'WarehouseCode',
    B.CAMPO_DESDE + ' / ' + B.CAMPO_HACIA);
const DOCP = { DocEntry: 77, DocNum: 9001, DocDate: '2026-10-27T00:00:00Z', StockTransferLines: [
  { LineNum: 0, ItemCode: '11111111110', Quantity: 3635, FromWarehouseCode: 'RETAIL',   WarehouseCode: 'RT13-100' },
  { LineNum: 1, ItemCode: '11111111110', Quantity: 1500, FromWarehouseCode: 'RT13-102', WarehouseCode: 'RT13-103' },
  { LineNum: 2, ItemCode: '99999',       Quantity: 10,   FromWarehouseCode: 'RETAIL',   WarehouseCode: 'RT13-100' },
  null,
]};
let LD = B.lineasDeDocumento(DOCP, 'StockTransferLines', '11111111110', 'ambas', 'traspaso');
chk('una fila por linea del item', LD.length === 2, String(LD.length));
chk('de donde sale y a donde entra',
    LD[0].desde === 'RETAIL' && LD[0].hacia === 'RT13-100' && LD[0].cantidad === 3635,
    JSON.stringify(LD[0]));
chk('la cadena de planta queda legible',
    LD[1].desde === 'RT13-102' && LD[1].hacia === 'RT13-103');
chk('otro item no entra', !LD.some(x => x.ItemCode === '99999'));
chk('una linea nula no revienta ni entra', LD.length === 2);
chk('la fecha se recorta a diez', LD[0].DocDate === '2026-10-27');
chk('arrastra documento y linea para poder rastrear',
    LD[0].DocEntry === 77 && LD[0].DocNum === 9001 && LD[1].LineNum === 1);
// una punta ausente NO se inventa: hay lineas que mueven contra algo que no
// es una bodega, y taparlas seria perder que existen
let UNA = B.lineasDeDocumento({ DocEntry:1, DocDate:'2026-10-27', L:[
  { ItemCode:'1', Quantity:5, WarehouseCode:'RT13-100' }] }, 'L', '1', 'ambas', 'traspaso');
chk('una punta ausente queda en null', UNA[0].desde === null && UNA[0].hacia === 'RT13-100');
chk('un codigo con espacios se recorta', B.lineasDeDocumento({ DocEntry:1, DocDate:'d', L:[
  { ItemCode:'1', Quantity:1, FromWarehouseCode:'  RETAIL  ' }] }, 'L', '1', 'ambas')[0].desde === 'RETAIL');
chk('un codigo vacio no es una punta', B.lineasDeDocumento({ DocEntry:1, DocDate:'d', L:[
  { ItemCode:'1', Quantity:1, FromWarehouseCode:'   ' }] }, 'L', '1', 'ambas')[0].desde === null);
chk('una cantidad ilegible es cero, no NaN', B.lineasDeDocumento({ DocEntry:1, DocDate:'d', L:[
  { ItemCode:'1', Quantity:'x', WarehouseCode:'RETAIL' }] }, 'L', '1', 'ambas')[0].cantidad === 0);
chk('sin filtro de item pasan todas',
    B.lineasDeDocumento(DOCP, 'StockTransferLines', null, 'ambas').length === 3);
chk('sin documento o sin clave no hay lineas',
    B.lineasDeDocumento(null, 'L', '1', 'ambas').length === 0 &&
    B.lineasDeDocumento(DOCP, null, '1', 'ambas').length === 0 &&
    B.lineasDeDocumento({}, 'L', '1', 'ambas').length === 0);
// la fusion incremental es la MISMA que la de las filas: le basta DocDate
const VL = [{ DocDate:'2026-10-20', desde:'A', hacia:'B', cantidad:1 }];
const NL = [{ DocDate:'2026-10-27', desde:'C', hacia:'D', cantidad:2 }];
chk('las lineas se fusionan con la misma regla que las filas',
    B.fusionarFilas(VL, NL, '2026-10-25').length === 2 &&
    B.fusionarFilas(VL, NL, '2026-10-15').length === 1);

// LAS TRES ENTIDADES. Medido el 29-10-2026: la cadena de planta no son
// traspasos. Inspeccion sale por salida de mercancias y reparacion y pintura
// entran por entrada de mercancias. Leyendo solo traspasos se veia media
// planta y el nivel de inspeccion daba -76.636.
chk('se leen las tres entidades que mueven el pallet',
    B.ENTIDADES.map(e => e.entidad).join(',') ===
    'StockTransfers,InventoryGenExits,InventoryGenEntries', JSON.stringify(B.ENTIDADES));
// cada entidad con su direccion: si salida y entrada se dan vuelta, los
// pallets que inspeccion despacha se cuentan como recibidos y el nivel sale
// con el signo cambiado en los dos extremos de la cadena
chk('cada entidad declara su propia direccion',
    B.ENTIDADES.map(e => e.entidad + ':' + e.direccion + ':' + e.tipo).join(' ') ===
    'StockTransfers:ambas:traspaso InventoryGenExits:sale:salida InventoryGenEntries:entra:entrada',
    JSON.stringify(B.ENTIDADES));
// el recorrido extra lee TODAS las entidades menos la que ya leyo la fase de
// traspasos: incluirla duplica cada linea del mes, dejar fuera otra deja la
// planta a medias
chk('el recorrido extra son las otras dos',
    B.entidadesExtra().map(e => e.entidad).join(',') ===
    'InventoryGenExits,InventoryGenEntries', JSON.stringify(B.entidadesExtra()));
chk('el recorrido extra no repite la entidad principal',
    B.entidadesExtra().length === B.ENTIDADES.length - 1);
chk('la entidad principal se lee como traspaso con las dos puntas',
    B.comoSeLee('StockTransfers').direccion === 'ambas' &&
    B.comoSeLee('StockTransfers').tipo === 'traspaso');
chk('una entidad fuera de la tabla se trata como traspaso',
    B.comoSeLee('Loquesea').direccion === 'ambas' && B.comoSeLee('Loquesea').tipo === 'traspaso');
chk('una salida consultada por nombre se lee como salida',
    B.comoSeLee('InventoryGenExits').direccion === 'sale' &&
    B.comoSeLee('InventoryGenEntries').direccion === 'entra',
    JSON.stringify([B.comoSeLee('InventoryGenExits'), B.comoSeLee('InventoryGenEntries')]));
// Esta se verifica sobre el TEXTO del archivo y no ejecutandola: el recorrido
// vive dentro de unMes, que pide paginas a SAP y no se puede correr en una
// prueba. Lo que se protege es concreto: si el recorrido iterara ENTIDADES en
// vez de entidadesExtra(), leeria los traspasos dos veces y cada linea de
// traspaso del mes quedaria duplicada en el blob.
const FUENTE = require('fs').readFileSync(require('path').join(__dirname, 'backfill-sap-bin.js'), 'utf8');
chk('el recorrido extra itera la lista filtrada, no la tabla completa',
    /for \(const E of entidadesExtra\(\)\)/.test(FUENTE) &&
    !/for \(const E of ENTIDADES[^.]/.test(FUENTE));
const UNALIN = { DocEntry:5, DocDate:'2026-10-26', L:[
  { ItemCode:'1', Quantity:300, FromWarehouseCode:'RETAIL', WarehouseCode:'RT13-100' }] };
const porDir = d => B.lineasDeDocumento(UNALIN, 'L', '1', d, 't')[0];
// una salida de mercancias saca pallets de la bodega SIN contraparte: la
// bodega de la linea es el ORIGEN, y el destino no existe
chk('en una salida la bodega es el origen y no hay destino',
    porDir('sale').desde === 'RT13-100' && porDir('sale').hacia === null,
    JSON.stringify(porDir('sale')));
// y en una entrada es al reves
chk('en una entrada la bodega es el destino y no hay origen',
    porDir('entra').hacia === 'RT13-100' && porDir('entra').desde === null);
chk('en un traspaso van las dos puntas',
    porDir('ambas').desde === 'RETAIL' && porDir('ambas').hacia === 'RT13-100');
chk('sin direccion se asume traspaso',
    B.lineasDeDocumento(UNALIN, 'L', '1', null, 't')[0].desde === 'RETAIL');
chk('cada linea queda etiquetada con su tipo',
    B.lineasDeDocumento(UNALIN, 'L', '1', 'sale', 'salida')[0].tipo === 'salida');
chk('sin tipo queda como traspaso',
    B.lineasDeDocumento(UNALIN, 'L', '1', 'ambas')[0].tipo === 'traspaso');
// la direccion NO cambia la cantidad: el signo lo pone la punta que se llena
chk('la cantidad es la misma en las tres',
    porDir('sale').cantidad === 300 && porDir('entra').cantidad === 300 && porDir('ambas').cantidad === 300);

console.log('\n— ventanaUsable: un blob sin lineas no se puede fusionar —');
// las lineas viven en su propio blob: saldo-pool lee los diez binmov dos veces
// por cierre y no tiene por que descargar 25 MB que no usa
chk('las lineas van en su propio prefijo', B.PREFIJO_LINEAS === 'lineasbod/', B.PREFIJO_LINEAS);
// fusionar la ventana contra un blob viejo dejaria un mes con lineas solo en
// los ultimos dias, haciendose pasar por completo. Peor que no tener nada.
chk('un blob sin lineas no sirve para la ventana',
    B.ventanaUsable({ filas: [1,2,3] }).ok === false);
chk('y se dice por que', /no trae lineas de bodega/.test(B.ventanaUsable({ filas: [] }).motivo));
chk('un mes legitimamente vacio si sirve', B.ventanaUsable({ filas: [], lineas: [] }).ok === true);
chk('con lineas sirve', B.ventanaUsable({ lineas: [{}] }).ok === true && B.ventanaUsable({ lineas:[{}] }).motivo === null);
chk('sin blob no sirve', B.ventanaUsable(null).ok === false);
chk('lineas que no es un arreglo no sirve', B.ventanaUsable({ lineas: 'si' }).ok === false);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
