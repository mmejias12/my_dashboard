'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const C=require('./comparar-cartola.js');
const E=require('./medir-emisiones.js');

// ── norm ───────────────────────────────────────────────────────────────────
console.log('— norm de conceptos —');
chk('mayusculas y espacios', C.norm('  Transferencia  Walmart ')==='TRANSFERENCIA WALMART');
chk('saca puntuacion', C.norm('ARRIENDO/DIAS-PALLET')==='ARRIENDO DIAS PALLET');
chk('null no revienta', C.norm(null)==='');
chk('no junta conceptos distintos', C.norm('TRASPASO')!==C.norm('TRANSFERENCIA'));

// ── resolverMapa ───────────────────────────────────────────────────────────
console.log('\n— resolverMapa: contra los conceptos que realmente aparecen —');
const CONC=['EMISION','TRANSFERENCIA','TRANSFERENCIA WALMART','TRASPASO','DEVOLUCION',
            'ARRIENDO DIAS PALLET','COMPENSACION LOGISTICA','RELOCALIZA'];
let m=C.resolverMapa(['SERV-EMISIONES','SERV-TRANSFERENCIAS','SERV-TRANSF-WALMART'],CONC);
chk('calce exacto', m.get('SERV-EMISIONES').concepto==='EMISION' && m.get('SERV-EMISIONES').via==='exacto');
// LA TRAMPA: "TRANSFERENCIA" esta contenido en "TRANSFERENCIA WALMART", asi que
// el mas largo tiene que ganar o los dos ItemCode irian al mismo concepto
chk('WALMART no se come a TRANSFERENCIA', m.get('SERV-TRANSFERENCIAS').concepto==='TRANSFERENCIA',
    m.get('SERV-TRANSFERENCIAS').concepto);
chk('y TRANSFERENCIA no se come a WALMART', m.get('SERV-TRANSF-WALMART').concepto==='TRANSFERENCIA WALMART',
    m.get('SERV-TRANSF-WALMART').concepto);
// inclusion cuando el nombre de la cartola es mas corto o mas largo
m=C.resolverMapa(['SERV-DIAS-PALLET'],['DIAS PALLET']);
chk('resuelve por palabras', m.get('SERV-DIAS-PALLET').concepto==='DIAS PALLET' && m.get('SERV-DIAS-PALLET').via==='por palabras',
    JSON.stringify(m.get('SERV-DIAS-PALLET')));
chk('tolera puntuacion distinta', C.resolverMapa(['SERV-COMP-LOGI'],['COMPENSACION LOGISTICA.']).get('SERV-COMP-LOGI').concepto==='COMPENSACION LOGISTICA.');
// EL DESEMPATE TIENE QUE SERVIR EN LOS DOS SENTIDOS. Si la cartola nombra los
// conceptos en plural, "TRANSFERENCIA" calza por inclusion con DOS candidatos
// y quedarse con el mas largo manda las transferencias normales al WALMART.
const PLUR=['EMISION','TRANSFERENCIAS','TRANSFERENCIAS WALMART'];
m=C.resolverMapa(['SERV-TRANSFERENCIAS','SERV-TRANSF-WALMART'],PLUR);
chk('en plural, TRANSFERENCIA no se va al WALMART', m.get('SERV-TRANSFERENCIAS').concepto==='TRANSFERENCIAS',
    m.get('SERV-TRANSFERENCIAS').concepto);
chk('y WALMART sigue calzando', m.get('SERV-TRANSF-WALMART').concepto==='TRANSFERENCIAS WALMART',
    m.get('SERV-TRANSF-WALMART').concepto);
// y el sentido inverso: cuando el buscado es el largo
m=C.resolverMapa(['SERV-TRANSF-WALMART'],['TRANSFERENCIA','TRANSFERENCIA WALMART ESPECIAL']);
chk('el buscado largo elige el candidato mas parecido', m.get('SERV-TRANSF-WALMART').concepto==='TRANSFERENCIA WALMART ESPECIAL',
    m.get('SERV-TRANSF-WALMART').concepto);
// un ItemCode que no esta en el mapa se declara, no se adivina
m=C.resolverMapa(['SERV-NUEVO'],CONC);
chk('ItemCode desconocido se declara', m.get('SERV-NUEVO').concepto===null && m.get('SERV-NUEVO').via==='sin entrada en el mapa',
    JSON.stringify(m.get('SERV-NUEVO')));
// un concepto del mapa que NO aparece en la cartola tambien se declara
m=C.resolverMapa(['SERV-TRASPASOS'],['EMISION']);
chk('concepto ausente en la cartola se declara', m.get('SERV-TRASPASOS').concepto===null &&
    m.get('SERV-TRASPASOS').via==='no aparece en la cartola', JSON.stringify(m.get('SERV-TRASPASOS')));
chk('mapa propio se respeta', C.resolverMapa(['X'],['FOO'],{'X':'FOO'}).get('X').concepto==='FOO');
// GUARDIA: si la cartola solo tiene el concepto grande, los dos ItemCode
// calzarian con el mismo y sumariamos dos veces lo mismo
m=C.resolverMapa(['SERV-TRANSFERENCIAS','SERV-TRANSF-WALMART'],['TRANSFERENCIA WALMART']);
let conc=[...m.values()].filter(r=>r.concepto);
chk('dos ItemCode no se quedan con el mismo concepto', conc.length===1, JSON.stringify([...m]));
chk('y el que pierde dice por que', [...m.values()].some(r=>!r.concepto && /lo tomo/.test(r.via)),
    JSON.stringify([...m.values()].map(r=>r.via)));
chk('gana el calce exacto', m.get('SERV-TRANSF-WALMART').concepto==='TRANSFERENCIA WALMART',
    m.get('SERV-TRANSF-WALMART').concepto);
// con los dos conceptos presentes, cada uno se queda con el suyo
m=C.resolverMapa(['SERV-TRANSFERENCIAS','SERV-TRANSF-WALMART'],['TRANSFERENCIA','TRANSFERENCIA WALMART']);
chk('con los dos conceptos, uno cada uno',
    m.get('SERV-TRANSFERENCIAS').concepto==='TRANSFERENCIA' && m.get('SERV-TRANSF-WALMART').concepto==='TRANSFERENCIA WALMART',
    JSON.stringify([...m].map(([k,v])=>k+'->'+v.concepto)));

// ── inventario ─────────────────────────────────────────────────────────────
console.log('\n— inventario —');
const car=o=>Object.assign({cardCode:'C1',cardName:'CLIENTE UNO',operacion:'EMISION',
  fecha:'2026-09-10',cantidad:100,netoUF:6.5,netoCLP:254303,tarifaUF:0.065}, o);
let inv=C.inventario([car({}),car({cantidad:50,netoUF:3.25}),car({operacion:'TRASPASO',netoUF:1})],'operacion','netoUF','netoCLP');
chk('separa por valor', inv.size===2, String(inv.size));
chk('suma UF', Math.abs(inv.get('EMISION').uf-9.75)<1e-9, String(inv.get('EMISION').uf));
chk('suma cantidad', inv.get('EMISION').cant===150);
chk('cuenta filas', inv.get('EMISION').filas===2);
chk('suma CLP', inv.get('EMISION').clp===254303*2);
chk('valor vacio se rotula', C.inventario([car({operacion:''})],'operacion','netoUF').has('(vacio)'));
chk('no mete todo en un solo casillero',
    C.inventario([car({operacion:'A'}),car({operacion:'B'}),car({operacion:'C'})],'operacion','netoUF').size===3);
chk('sin campo CLP no revienta', C.inventario([car({})],'operacion','netoUF').get('EMISION').clp===0);
// del lado OV la cantidad viene en Quantity, no en cantidad
chk('lee Quantity cuando no hay cantidad',
    C.inventario([{ItemCode:'SERV-DEV',Quantity:77}],'ItemCode','__nada').get('SERV-DEV').cant===77);

// ── camposFecha ────────────────────────────────────────────────────────────
console.log('\n— camposFecha: no se asume el nombre —');
let cf=C.camposFecha([car({fechaFacturacion:'2026-09-14'})]);
chk('encuentra los dos', cf.indexOf('fecha')>=0 && cf.indexOf('fechaFacturacion')>=0, JSON.stringify(cf));
chk('ignora campos que no son fecha', C.camposFecha([car({})]).indexOf('cantidad')<0);
chk('ignora un campo de fecha con basura', C.camposFecha([{fecha:'SEMANA 40'}]).length===0,
    JSON.stringify(C.camposFecha([{fecha:'SEMANA 40'}])));
chk('lista vacia', C.camposFecha([]).length===0);

// ── el universo compartido ─────────────────────────────────────────────────
const ovp=(desde,hasta,extra)=>Object.assign({DocEntry:Math.random(), DocNum:1, CardCode:'C1',
  CardName:'CLIENTE UNO', U_HX_PeriodoDesde:desde, U_HX_PeriodoHasta:hasta,
  Comments:'TC: 39.123,45', _lineas:[]}, extra);
const PER=E.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],
                               '2026-09',['2026-09']).porCliente;

// ── agruparCartola ─────────────────────────────────────────────────────────
console.log('\n— lado cartola —');
let a=C.agruparCartola([car({}),car({fecha:'2026-09-16',netoUF:3.5})],PER,'fecha');
chk('agrupa por cliente y concepto', a.porClienteConcepto.size===1, String(a.porClienteConcepto.size));
chk('suma la UF', Math.abs(a.porClienteConcepto.get('C1|EMISION').uf-10)<1e-9);
chk('y por concepto', Math.abs(a.porConcepto.get('EMISION').uf-10)<1e-9);
chk('cuenta clientes distintos del concepto', a.porConcepto.get('EMISION').clientes.size===1);
// conceptos distintos del mismo cliente no se mezclan
a=C.agruparCartola([car({}),car({operacion:'TRASPASO',netoUF:1})],PER,'fecha');
chk('separa conceptos', a.porClienteConcepto.size===2 && a.porConcepto.size===2);
// fila fuera de los periodos del cliente
a=C.agruparCartola([car({fecha:'2026-09-25'})],PER,'fecha');
chk('fila fuera del universo se cuenta aparte', a.fuera===1 && a.porClienteConcepto.size===0);
chk('cliente sin OV se cuenta aparte', C.agruparCartola([car({cardCode:'C9'})],PER,'fecha').sinOV===1);
chk('fila sin cardCode se cuenta aparte', C.agruparCartola([car({cardCode:''})],PER,'fecha').sinCliente===1);
chk('fila sin fecha se cuenta aparte', C.agruparCartola([car({fecha:null})],PER,'fecha').sinFecha===1);
chk('el campo de fecha es parametrizable',
    C.agruparCartola([car({fecha:'2026-09-25',fechaFacturacion:'2026-09-16'})],PER,'fechaFacturacion').porClienteConcepto.size===1);

// ── agruparSAP ─────────────────────────────────────────────────────────────
console.log('\n— lado SAP —');
const lin=o=>Object.assign({ItemCode:'SERV-EMISIONES', Quantity:100, Price:0.065*39123.45}, o);
const mapa=C.resolverMapa(['SERV-EMISIONES','SERV-TRASPASOS'],['EMISION','TRASPASO']);
let s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{_lineas:[lin({})]})],PER,mapa);
chk('rotula con el concepto de la cartola', s.porConcepto.has('EMISION'), JSON.stringify([...s.porConcepto.keys()]));
chk('UF = cantidad x precio / TC', Math.abs(s.porConcepto.get('EMISION').uf-100*0.065)<1e-9, String(s.porConcepto.get('EMISION').uf));
chk('guarda CLP', Math.abs(s.porConcepto.get('EMISION').clp-100*0.065*39123.45)<1e-6);
// el precio que importa es el que la OV cobro (Price), no el de lista
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{_lineas:[lin({Price:1000,UnitPrice:0.065*39123.45})]})],PER,mapa);
chk('usa Price, no UnitPrice', Math.abs(s.porConcepto.get('EMISION').uf-(100*1000)/39123.45)<1e-9,
    String(s.porConcepto.get('EMISION').uf));
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{_lineas:[lin({Price:null,UnitPrice:0.065*39123.45})]})],PER,mapa);
chk('sin Price cae a UnitPrice', Math.abs(s.porConcepto.get('EMISION').uf-100*0.065)<1e-9);

// linea cuyo ItemCode no esta mapeado: se cuenta, no se cuela
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{_lineas:[lin({}),lin({ItemCode:'SERV-OTRO',Quantity:9999})]})],PER,mapa);
chk('linea sin mapear no entra', Math.abs(s.porConcepto.get('EMISION').uf-100*0.065)<1e-9);
chk('y se cuenta', s.sinMapa===1, String(s.sinMapa));
// OV de un periodo fuera del universo
s=C.agruparSAP([ovp('2026-09-21','2026-09-27',{_lineas:[lin({})]})],PER,mapa);
chk('OV fuera del universo no entra', s.usadas===0 && s.fuera===1, JSON.stringify([s.usadas,s.fuera]));
// sin TC no se inventa monto
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{Comments:'SEMANA 38',_lineas:[lin({})]})],PER,mapa);
chk('sin TC la OV no se usa', s.usadas===0 && s.sinTC===1, JSON.stringify([s.usadas,s.sinTC]));
// OV ya en UF
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{DocCurrency:'UF',Comments:'SEMANA 38',_lineas:[lin({Price:0.065})]})],PER,mapa);
chk('OV en UF no se divide por el TC', Math.abs(s.porConcepto.get('EMISION').uf-100*0.065)<1e-9);
// TC implausible
s=C.agruparSAP([ovp('2026-09-07','2026-09-13',{Comments:'TC: 39,12',_lineas:[lin({})]})],PER,mapa);
chk('TC bajo el piso se descarta', s.usadas===0 && s.sinTC===1);

// ── cruzar ─────────────────────────────────────────────────────────────────
console.log('\n— cruzar los dos lados —');
const lado=(cod,concepto,uf)=>[cod+'|'+concepto,{cod,nom:cod,concepto,uf,cant:0,clp:0,filas:1}];
let x=C.cruzar(new Map([lado('C1','EMISION',100),lado('C1','TRASPASO',10)]),
               new Map([lado('C1','EMISION',100),lado('C1','TRASPASO',12)]));
chk('dos pares comparables', x.ambos.length===2 && x.unLado.length===0);
chk('cuenta los que calzan', x.calzan===1, String(x.calzan));
chk('la mayor diferencia primero', x.ambos[0].concepto==='TRASPASO');
chk('dif = SAP - cartola', Math.abs(x.ambos[0].dif-2)<1e-9, String(x.ambos[0].dif));
// una diferencia NEGATIVA grande tiene que encabezar igual
x=C.cruzar(new Map([lado('C1','EMISION',100),lado('C1','TRASPASO',100)]),
           new Map([lado('C1','EMISION',105),lado('C1','TRASPASO',80)]));
chk('ordena por valor absoluto', x.ambos[0].concepto==='TRASPASO', x.ambos[0].concepto);
// concepto en un solo lado
x=C.cruzar(new Map([lado('C1','RELOCALIZA',5)]), new Map());
chk('concepto solo en la cartola va aparte', x.ambos.length===0 && x.unLado.length===1);
chk('y conserva el concepto', x.unLado[0].concepto==='RELOCALIZA');
x=C.cruzar(new Map(), new Map([lado('C2','EMISION',7)]));
chk('concepto solo en SAP tambien', x.unLado.length===1 && x.unLado[0].cod==='C2');
// tolerancia
chk('la tolerancia se respeta', C.cruzar(new Map([lado('C1','EMISION',100)]),
                                         new Map([lado('C1','EMISION',100.004)])).calzan===1);
chk('y no se estira', C.cruzar(new Map([lado('C1','EMISION',100)]),
                               new Map([lado('C1','EMISION',100.006)])).calzan===0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
