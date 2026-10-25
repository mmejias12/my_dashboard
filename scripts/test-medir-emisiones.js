'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const M=require('./medir-emisiones.js');

// ── norm ───────────────────────────────────────────────────────────────────
console.log('— norm: solo para cruzar con el maestro de contratos —');
chk('mayusculas y espacios', M.norm('  Aconcagua Foods s.a. ')===M.norm('ACONCAGUA FOODS S.A'));
chk('puntuacion final no separa', M.norm('AGRICOLA HUILLINCO SPA.')===M.norm('AGRICOLA HUILLINCO SPA'));
chk('espacios dobles', M.norm('COMERCIAL   X  LTDA')==='COMERCIAL X LTDA');
chk('no junta nombres distintos', M.norm('AGRICOLA UNO')!==M.norm('AGRICOLA DOS'));
chk('null no revienta', M.norm(null)==='');

// ── parseTC ────────────────────────────────────────────────────────────────
console.log('\n— parseTC: el TC viaja como texto en el Comments —');
chk('es-CL 39.123,45', M.parseTC('... HASTA 04-10-2026 TC: 39.123,45')===39123.45, String(M.parseTC('TC: 39.123,45')));
chk('en-US 39,123.45', M.parseTC('TC: 39,123.45')===39123.45, String(M.parseTC('TC: 39,123.45')));
chk('sin separador', M.parseTC('TC: 39123')===39123);
chk('solo miles con punto', M.parseTC('TC: 39.123')===39123, String(M.parseTC('TC: 39.123')));
chk('solo miles con coma', M.parseTC('TC: 39,123')===39123, String(M.parseTC('TC: 39,123')));
chk('decimales con coma', M.parseTC('TC: 39123,45')===39123.45);
chk('decimales con punto', M.parseTC('TC: 39123.45')===39123.45);
chk('sin espacio tras los dos puntos', M.parseTC('TC:39.123,45')===39123.45);
chk('sin los dos puntos', M.parseTC('TC 39.123,45')===39123.45);
chk('punto final de frase no se come', M.parseTC('TC: 39.123,45.')===39123.45);
chk('sin TC → null', M.parseTC('FACTURACION SEMANA 40')===null);
chk('Comments vacio → null', M.parseTC('')===null && M.parseTC(null)===null);
chk('cero no es TC', M.parseTC('TC: 0')===null);
chk('ninguna lectura queda bajo el piso', M.parseTC('TC: 39,123.45')>=M.TC_MIN && M.parseTC('TC: 39.123,45')>=M.TC_MIN);

// ── parsePeriodo ───────────────────────────────────────────────────────────
console.log('\n— parsePeriodo: que semana cobra la OV —');
const COM='FACTURACION SEMANA 40 DESDE 28-09-2026 HASTA 04-10-2026 TC: 39.123,45';
let p=M.parsePeriodo({Comments:COM});
chk('lee dd-mm-aaaa del Comments y lo pasa a ISO', p.desde==='2026-09-28'&&p.hasta==='2026-10-04', JSON.stringify(p));
chk('declara que salio del Comments', p.origen==='Comments', p.origen);
p=M.parsePeriodo({Comments:COM, U_HX_PeriodoDesde:'2026-09-28', U_HX_PeriodoHasta:'2026-10-04'});
chk('el campo de usuario le gana al Comments', p.origen==='U_HX_PeriodoDesde/U_HX_PeriodoHasta', p.origen);
p=M.parsePeriodo({Comments:COM, U_HX_RD_FechaPeriodoIni:'2026-09-28T00:00:00Z', U_HX_RD_FechaPeriodoFin:'2026-10-04T00:00:00Z'});
chk('encuentra el campo aunque se llame distinto', p.desde==='2026-09-28'&&p.origen.indexOf('Ini')>0, JSON.stringify(p));
chk('corta la hora del ISO', p.hasta==='2026-10-04', p.hasta);
chk('campo vacio cae al Comments', M.parsePeriodo({Comments:COM,U_HX_PeriodoDesde:null,U_HX_PeriodoHasta:null}).origen==='Comments');
chk('un solo campo no alcanza', M.parsePeriodo({Comments:COM,U_HX_PeriodoDesde:'2026-09-28'}).origen==='Comments');
p=M.parsePeriodo({Comments:'FACTURACION SEMANA 40 DEL 28-09 AL 04-10'});
chk('sin periodo legible → no encontrado', p.desde===null&&p.origen==='no encontrado', JSON.stringify(p));
chk('un campo que no es fecha no cuenta', M.parsePeriodo({Comments:COM,U_HX_PeriodoDesde:'SEMANA 40',U_HX_PeriodoHasta:'x'}).origen==='Comments');

// ── calendario ─────────────────────────────────────────────────────────────
console.log('\n— calendario —');
chk('mes siguiente', M.mesSiguiente('2026-09')==='2026-10' && M.mesSiguiente('2026-12')==='2027-01');
chk('mes anterior', M.mesAnterior('2026-09')==='2026-08' && M.mesAnterior('2026-01')==='2025-12');
chk('fin de mes 30', M.finDeMes('2026-09')==='2026-09-30');
chk('fin de mes 31', M.finDeMes('2026-12')==='2026-12-31');
chk('febrero comun', M.finDeMes('2026-02')==='2026-02-28', M.finDeMes('2026-02'));
chk('febrero bisiesto', M.finDeMes('2028-02')==='2028-02-29', M.finDeMes('2028-02'));
chk('un solo mes', M.mesesEntre('2026-09-07','2026-09-13').join(',')==='2026-09');
chk('semana que cruza el borde toca dos meses', M.mesesEntre('2026-08-31','2026-09-06').join(',')==='2026-08,2026-09');
chk('semana que cruza hacia adelante', M.mesesEntre('2026-09-28','2026-10-04').join(',')==='2026-09,2026-10');
chk('cruza el año', M.mesesEntre('2026-12-28','2027-01-03').join(',')==='2026-12,2027-01');

// ── seleccion del universo: los dos defectos que motivaron las reescrituras ─
console.log('\n— periodosPorCliente: el periodo es del CLIENTE, no global —');
const ovp=(desde,hasta,extra)=>Object.assign({DocEntry:Math.random(), DocNum:1, CardCode:'C1', CardName:'CLIENTE UNO',
  U_HX_PeriodoDesde:desde, U_HX_PeriodoHasta:hasta, Comments:'TC: 39.123,45', _lineas:[]}, extra);

const SEMANAS=[['2026-08-31','2026-09-06'],['2026-09-07','2026-09-13'],['2026-09-14','2026-09-20'],
               ['2026-09-21','2026-09-27'],['2026-09-28','2026-10-04']];
const docsSem=SEMANAS.map(s=>ovp(s[0],s[1]));

let per=M.periodosPorCliente(docsSem,'2026-09',['2026-08','2026-09','2026-10']);
chk('con los tres meses las cinco semanas son usables',
    per.porCliente.get('C1').usables.size===5&&per.porCliente.get('C1').excluidos.size===0,
    per.porCliente.get('C1').usables.size+'/'+per.porCliente.get('C1').excluidos.size);

per=M.periodosPorCliente(docsSem,'2026-09',['2026-09']);
let c1=per.porCliente.get('C1');
chk('solo con septiembre quedan 3 usables', c1.usables.size===3, String(c1.usables.size));
chk('la semana 31-08..06-09 se excluye', c1.excluidos.has('2026-08-31..2026-09-06'));
chk('y dice que falta agosto', c1.excluidos.get('2026-08-31..2026-09-06').falta==='2026-08');
chk('la semana 28-09..04-10 se excluye por octubre', c1.excluidos.get('2026-09-28..2026-10-04').falta==='2026-10');
// PRIMER DEFECTO: filtrar por donde EMPIEZA el periodo borraba la semana de
// cabecera, cuyos seis ultimos dias son del mes
chk('una semana que EMPIEZA en el mes anterior entra al universo',
    M.periodosPorCliente([ovp('2026-08-31','2026-09-06')],'2026-09',['2026-08','2026-09'])
     .porCliente.get('C1').usables.size===1);
per=M.periodosPorCliente([ovp('2026-08-24','2026-08-30'),ovp('2026-10-05','2026-10-11')],'2026-09',['2026-08','2026-09','2026-10']);
chk('semanas que no tocan el mes quedan fuera', per.porCliente.size===0&&per.noSolapan===2, String(per.noSolapan));
chk('la semana que termina el dia 1 del mes solapa',
    M.periodosPorCliente([ovp('2026-08-26','2026-09-01')],'2026-09',['2026-08','2026-09']).porCliente.get('C1').usables.size===1);
chk('la semana que empieza el ultimo dia del mes solapa',
    M.periodosPorCliente([ovp('2026-09-30','2026-10-06')],'2026-09',['2026-09','2026-10']).porCliente.get('C1').usables.size===1);
per=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-07','2026-09-13')],'2026-09',['2026-09']);
chk('un periodo, dos OV', per.porCliente.get('C1').usables.get('2026-09-07..2026-09-13').ovs===2);
chk('OV sin periodo se cuenta aparte',
    M.periodosPorCliente([{DocEntry:1,CardCode:'C1',Comments:'SEMANA 40',_lineas:[]}],'2026-09',['2026-09']).sinPeriodo===1);

// SEGUNDO DEFECTO: los dos cortes de cierre de mes convivian en una lista
// global y se pisaban. Separados por cliente, cada uno usa el suyo.
per=M.periodosPorCliente([ovp('2026-09-28','2026-09-30',{CardCode:'CORTE'}),
                          ovp('2026-09-28','2026-10-04',{CardCode:'SEMANA'})],
                         '2026-09',['2026-09','2026-10']);
chk('cada cliente tiene su propio corte de fin de mes',
    per.porCliente.get('CORTE').usables.size===1&&per.porCliente.get('SEMANA').usables.size===1);
chk('el del corte NO ve la semana completa', per.porCliente.get('CORTE').usables.has('2026-09-28..2026-09-30'));
chk('y el de la semana NO ve el corte', per.porCliente.get('SEMANA').usables.has('2026-09-28..2026-10-04'));
chk('sin solapes entre clientes distintos', M.solapes(per.porCliente).length===0);
// ...y si un MISMO cliente tiene los dos, eso es un hallazgo, no una ambiguedad
per=M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                         '2026-09',['2026-09','2026-10']);
let sp=M.solapes(per.porCliente);
chk('un cliente con dos periodos que se pisan se informa', sp.length===1, JSON.stringify(sp));
chk('y dice cuales son', sp[0].a==='2026-09-28..2026-09-30'&&sp[0].b==='2026-09-28..2026-10-04', JSON.stringify(sp[0]));
chk('periodos consecutivos no se consideran pisados',
    M.solapes(M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],'2026-09',['2026-09']).porCliente).length===0);
// un dia compartido en el borde tambien es un dia facturado dos veces
chk('comparten un solo dia: igual se pisan',
    M.solapes(M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-13','2026-09-19')],'2026-09',['2026-09']).porCliente).length===1,
    JSON.stringify(M.solapes(M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-13','2026-09-19')],'2026-09',['2026-09']).porCliente)));
// y el solape se detecta aunque las OV lleguen desordenadas
chk('detecta el solape con las OV en desorden',
    M.solapes(M.periodosPorCliente([ovp('2026-09-28','2026-10-04'),ovp('2026-09-28','2026-09-30')],'2026-09',['2026-09','2026-10']).porCliente).length===1);
chk('y en desorden sin solape no inventa uno',
    M.solapes(M.periodosPorCliente([ovp('2026-09-21','2026-09-27'),ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],'2026-09',['2026-09']).porCliente).length===0);

// vista global, solo para mostrar
const vg=M.vistaGlobal(M.periodosPorCliente([ovp('2026-09-07','2026-09-13',{CardCode:'A'}),
                                             ovp('2026-09-07','2026-09-13',{CardCode:'B'})],
                                            '2026-09',['2026-09']).porCliente);
chk('la vista global junta el periodo', vg.usables.size===1);
chk('y cuenta clientes y OV', vg.usables.get('2026-09-07..2026-09-13').clientes===2&&vg.usables.get('2026-09-07..2026-09-13').ovs===2);
// un cliente con DOS OV del mismo periodo: 1 cliente, 2 OV. Si los dos
// contadores salieran del mismo numero, esto no se distinguiria
const vg2=M.vistaGlobal(M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-07','2026-09-13')],'2026-09',['2026-09']).porCliente);
chk('un cliente con dos OV: 1 cliente, 2 OV',
    vg2.usables.get('2026-09-07..2026-09-13').clientes===1&&vg2.usables.get('2026-09-07..2026-09-13').ovs===2,
    JSON.stringify(vg2.usables.get('2026-09-07..2026-09-13')));

const PER=M.periodosPorCliente(docsSem,'2026-09',['2026-09']).porCliente;
const U=PER.get('C1').usables;

// ── periodoDe ──────────────────────────────────────────────────────────────
console.log('\n— periodoDe —');
chk('fecha al medio', M.periodoDe('2026-09-10',U)==='2026-09-07..2026-09-13');
chk('primer dia incluido', M.periodoDe('2026-09-07',U)==='2026-09-07..2026-09-13');
chk('ultimo dia incluido', M.periodoDe('2026-09-13',U)==='2026-09-07..2026-09-13');
chk('fecha de un periodo excluido no cae en ninguno', M.periodoDe('2026-09-02',U)===null, String(M.periodoDe('2026-09-02',U)));
chk('fecha fuera de todo', M.periodoDe('2026-11-11',U)===null);
chk('fecha nula', M.periodoDe(null,U)===null);

// ── nuestro lado ───────────────────────────────────────────────────────────
console.log('\n— nuestro lado: emisiones x tarifa estampada, dentro del universo —');
const TAR={'Emision':0.065,'Emision 24 horas':0.07,'Emision Express':0.075,'Devolucion':0.027};
const maestro={}; maestro[M.norm('CLIENTE UNO')]={tarifas:TAR};
const fila=o=>Object.assign({DocEntry:1, CardCode:'C1', CardName:'CLIENTE UNO', DocDate:'2026-09-10',
  U_HX_RD_TransType:'EMISION', Quantity:100, U_HX_RD_TarifaCli:0.065}, o);

let nu=M.agregarNuestro([fila({Quantity:100}),fila({Quantity:200})],maestro,PER,'DocDate');
chk('suma cantidad', nu.porVariante.get('Emision').cant===300, String(nu.porVariante.get('Emision').cant));
chk('UF = cantidad x tarifa fila por fila', Math.abs(nu.porVariante.get('Emision').uf-300*0.065)<1e-9);
chk('agrupa por cliente', nu.porCliente.size===1);
chk('y por periodo', nu.porPeriodo.get('2026-09-07..2026-09-13').cant===300);

// el filtro de fecha: una fila de un periodo excluido NO entra
nu=M.agregarNuestro([fila({DocDate:'2026-09-10'}),fila({DocDate:'2026-09-02'})],maestro,PER,'DocDate');
chk('fila de un periodo excluido queda fuera', nu.porVariante.get('Emision').cant===100, String(nu.porVariante.get('Emision').cant));
chk('y se cuenta', nu.fueraDeUniverso===1);
chk('fila sin fecha se cuenta aparte', M.agregarNuestro([fila({DocDate:null})],maestro,PER,'DocDate').sinFecha===1);
chk('el campo de fecha es parametrizable',
    M.agregarNuestro([fila({DocDate:'2026-09-02', U_HX_RD_FechaIngreso:'2026-09-10'})],maestro,PER,'U_HX_RD_FechaIngreso').porVariante.get('Emision').cant===100);

// solo EMISION
nu=M.agregarNuestro([fila({}),fila({U_HX_RD_TransType:'TRANSFERENCIA',Quantity:9999})],maestro,PER,'DocDate');
chk('ignora conceptos que no son EMISION', nu.porVariante.get('Emision').cant===100, String(nu.porVariante.get('Emision').cant));
chk('y no cuenta su cantidad en ningun lado', [...nu.porVariante.values()].reduce((a,g)=>a+g.cant,0)===100);
chk('tolera espacios en el concepto', M.agregarNuestro([fila({U_HX_RD_TransType:' EMISION '})],maestro,PER,'DocDate').porVariante.get('Emision').cant===100);

// variantes
nu=M.agregarNuestro([fila({U_HX_RD_TarifaCli:0.065}),fila({U_HX_RD_TarifaCli:0.075})],maestro,PER,'DocDate');
chk('separa variantes por tarifa', nu.porVariante.size===2&&nu.porVariante.get('Emision Express').cant===100);
chk('el cliente las suma igual', nu.porCliente.get('C1').cant===200);
chk('y deja ver el desglose del cliente', nu.porCliente.get('C1').variantes.size===2);

// tarifa ausente y tarifa basura
nu=M.agregarNuestro([fila({U_HX_RD_TarifaCli:null,Quantity:40})],maestro,PER,'DocDate');
chk('sin tarifa: cero UF pero la cantidad se conserva', nu.porCliente.get('C1').uf===0&&nu.porCliente.get('C1').cant===40);
chk('sin tarifa: se cuenta aparte', nu.sinTarifa===1&&nu.cantSinTarifa===40, JSON.stringify([nu.sinTarifa,nu.cantSinTarifa]));
nu=M.agregarNuestro([fila({U_HX_RD_TarifaCli:'N/A',Quantity:40}),fila({Quantity:100})],maestro,PER,'DocDate');
let tot=[...nu.porVariante.values()].reduce((a,g)=>a+g.uf,0);
chk('tarifa no numerica no contamina el total', isFinite(tot)&&Math.abs(tot-100*0.065)<1e-9, String(tot));
chk('tarifa no numerica se cuenta como sin tarifa', nu.sinTarifa===1&&nu.cantSinTarifa===40);
chk('tarifa numerica en texto si se usa',
    Math.abs(M.agregarNuestro([fila({U_HX_RD_TarifaCli:'0.065'})],maestro,PER,'DocDate').porVariante.get('Emision').uf-100*0.065)<1e-9);

// tarifa que no calza con el contrato
nu=M.agregarNuestro([fila({U_HX_RD_TarifaCli:0.09})],maestro,PER,'DocDate');
chk('tarifa desconocida: se valoriza con lo estampado', Math.abs([...nu.porVariante.values()][0].uf-100*0.09)<1e-9);
chk('tarifa desconocida: se cuenta como sin variante', nu.sinVariante===1);
chk('y queda rotulada con la tarifa a la vista', [...nu.porVariante.keys()][0].indexOf('0.09')>0, [...nu.porVariante.keys()][0]);
chk('cliente fuera del maestro se cuenta', M.agregarNuestro([fila({CardName:'FANTASMA'})],maestro,PER,'DocDate').sinMaestro===1);

// empate de variantes
const EMP={'Emision':0.065,'Emision 24 horas':0.065};
chk('empate: variantes() devuelve las dos', M.variantes(0.065,EMP).length===2);
chk('empate: variante() no se cae', M.variante(0.065,EMP)==='Emision');
chk('sin empate devuelve una', M.variantes(0.065,TAR).length===1);
const mEmp={}; mEmp[M.norm('CLIENTE UNO')]={tarifas:EMP};
chk('empate se declara', M.agregarNuestro([fila({})],mEmp,PER,'DocDate').ambiguas===1);
chk('sin empate no se declara', M.agregarNuestro([fila({})],maestro,PER,'DocDate').ambiguas===0);
chk('tolera redondeo chico', M.variante(0.06503,TAR)==='Emision');
chk('no calza fuera de tolerancia', M.variante(0.08,TAR)===null);
chk('no mira servicios que no son emision', M.variante(0.027,TAR)===null);
chk('tarifa nula → null', M.variante(null,TAR)===null);
chk('cliente sin contrato → null', M.variante(0.065,null)===null);

// clientes distintos: por CardCode
const PER2=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),
                                 ovp('2026-09-07','2026-09-13',{CardCode:'C2'})],'2026-09',['2026-09']).porCliente;
nu=M.agregarNuestro([fila({}),fila({CardCode:'C2',CardName:'CLIENTE DOS'})],maestro,PER2,'DocDate');
chk('separa clientes por CardCode', nu.porCliente.size===2, String(nu.porCliente.size));
// un movimiento de un cliente SIN ninguna OV del mes no se puede comparar: se
// cuenta aparte en vez de sumarse contra una OV que no existe
nu=M.agregarNuestro([fila({}),fila({CardCode:'C9',CardName:'SIN OV'})],maestro,PER,'DocDate');
chk('movimiento de cliente sin OV no entra', nu.porCliente.size===1&&nu.sinOV===1, JSON.stringify([nu.porCliente.size,nu.sinOV]));
// mismo CardCode con la razon social escrita distinto NO se parte
nu=M.agregarNuestro([fila({CardName:'TAK SPA'}),fila({CardName:'TAK S.A.'})],maestro,PER,'DocDate');
chk('mismo CardCode, dos escrituras del nombre: un solo cliente', nu.porCliente.size===1, String(nu.porCliente.size));
chk('y la cantidad suma', nu.porCliente.get('C1').cant===200);

// ── lado OV ────────────────────────────────────────────────────────────────
console.log('\n— lado OV: lineas de emision llevadas a UF con el TC —');
const lin=o=>Object.assign({ItemCode:'SERV-EMISIONES', Quantity:100, Price:2543.03}, o);
const ovDoc=o=>Object.assign({DocEntry:1, DocNum:5001, CardCode:'C1', CardName:'CLIENTE UNO',
  U_HX_PeriodoDesde:'2026-09-07', U_HX_PeriodoHasta:'2026-09-13',
  Comments:'FACTURACION SEMANA 38 TC: 39.123,45', _lineas:[lin({})]}, o);

let ov=M.agregarOV([ovDoc({})],PER);
let r=ov.porCliente.get('C1');
chk('usa la linea de emision', ov.usadas===1, String(ov.usadas));
chk('UF = cantidad x precio / TC', Math.abs(r.uf-(100*2543.03)/39123.45)<1e-9, String(r.uf));
chk('registra la OV', r.ovs.size===1);
chk('y la imputa al periodo', Math.abs(ov.porPeriodo.get('2026-09-07..2026-09-13').uf-r.uf)<1e-12);

// OV de un periodo que no esta en el universo
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-08-31',U_HX_PeriodoHasta:'2026-09-06'})],PER);
chk('OV de un periodo excluido no se usa', ov.usadas===0&&ov.fueraDeUniverso===1, JSON.stringify([ov.usadas,ov.fueraDeUniverso]));
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-10-05',U_HX_PeriodoHasta:'2026-10-11'})],PER);
chk('OV de otro mes tampoco', ov.usadas===0&&ov.fueraDeUniverso===1);
// la semana corta de cierre de mes, para el cliente que la tiene
const PERC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30')],'2026-09',['2026-09']).porCliente;
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-09-30'})],PERC);
chk('la semana corta de cierre si se usa para su cliente', ov.usadas===1, String(ov.usadas));
// ...y el movimiento del 29 de ese cliente se ubica en SU corte, no en la
// semana completa de otro cliente: es el defecto que movio 957 UF
nu=M.agregarNuestro([fila({DocDate:'2026-09-29'})],maestro,PERC,'DocDate');
chk('el movimiento del 29 cae en el corte de su cliente',
    nu.porPeriodo.get('2026-09-28..2026-09-30').cant===100, JSON.stringify([...nu.porPeriodo.keys()]));

// el inventario de ItemCode se arma ANTES del filtro: es el catalogo completo
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-10-05',U_HX_PeriodoHasta:'2026-10-11',
                       _lineas:[lin({ItemCode:"SERV-DIAS-PALLET",Quantity:7777})]})],PER);
chk('inventaria ItemCode incluso de OV que no se usan', ov.itemCodes.get('SERV-DIAS-PALLET').cant===7777);
chk('pero no los suma a la comparacion', ov.usadas===0);

// solo las lineas de emision
ov=M.agregarOV([ovDoc({_lineas:[lin({}),lin({ItemCode:'SERV-DIAS-PALLET',Quantity:9999,Price:50})]})],PER);
chk('ignora lineas de otro servicio', ov.usadas===1, String(ov.usadas));
chk('pero las inventaria', ov.itemCodes.size===2&&ov.itemCodes.get('SERV-DIAS-PALLET').cant===9999);
chk('el inventario cuenta las filas', ov.itemCodes.get('SERV-EMISIONES').filas===1);

// patron configurable
ov=M.agregarOV([ovDoc({_lineas:[lin({ItemCode:'SERV-EMI-24'})]})],PER,/^SERV-EMI/);
chk('patron de ItemCode configurable', ov.usadas===1);
chk('con el patron por defecto no habria calzado', M.agregarOV([ovDoc({_lineas:[lin({ItemCode:'SERV-EMI-24'})]})],PER).usadas===0);

// precio: Price es el que cobro la OV; UnitPrice es antes del descuento
ov=M.agregarOV([ovDoc({_lineas:[lin({Price:2000,UnitPrice:2543.03})]})],PER);
chk('usa Price, el precio que la OV cobro', Math.abs(ov.porCliente.get('C1').uf-(100*2000)/39123.45)<1e-9);
ov=M.agregarOV([ovDoc({_lineas:[lin({Price:null,UnitPrice:2543.03})]})],PER);
chk('sin Price cae a UnitPrice', Math.abs(ov.porCliente.get('C1').uf-(100*2543.03)/39123.45)<1e-9);

// TC
ov=M.agregarOV([ovDoc({Comments:'FACTURACION SEMANA 38'})],PER);
chk('sin TC no se inventa un monto', ov.usadas===0&&ov.sinTC===1, JSON.stringify([ov.usadas,ov.sinTC]));
ov=M.agregarOV([ovDoc({Comments:'TC: 39,12'})],PER);
chk('TC implausible se descarta', ov.usadas===0&&ov.tcDudoso===1, JSON.stringify([ov.usadas,ov.tcDudoso,ov.sinTC]));
chk('y no se confunde con TC ausente', ov.sinTC===0);
ov=M.agregarOV([ovDoc({DocCurrency:'UF', Comments:'SEMANA 38', _lineas:[lin({Price:0.065})]})],PER);
chk('OV ya en UF no se divide por ningun TC', Math.abs(ov.porCliente.get('C1').uf-100*0.065)<1e-9, String(ov.porCliente.get('C1').uf));
chk('y se declara', ov.enUF===1&&ov.sinTC===0);

// dos OV y dos lineas
ov=M.agregarOV([ovDoc({}),ovDoc({DocEntry:2,DocNum:5002})],PER);
chk('dos OV del mismo cliente suman', ov.porCliente.get('C1').cant===200);
chk('y se cuentan como dos OV', ov.porCliente.get('C1').ovs.size===2);
ov=M.agregarOV([ovDoc({_lineas:[lin({}),lin({})]})],PER);
chk('dos lineas de la misma OV = una OV', ov.porCliente.get('C1').ovs.size===1);
chk('pero las dos lineas suman', ov.porCliente.get('C1').cant===200);

// ── sonda de campos de fecha ───────────────────────────────────────────────
console.log('\n— sondaFechas: que campo usa la facturacion —');
let s=M.sondaFechas([fila({DocDate:'2026-09-02', U_HX_RD_FechaIngreso:'2026-09-10'}),
                     fila({DocDate:'2026-09-03', U_HX_RD_FechaIngreso:'2026-09-11'})], PER);
chk('cuenta dentro/fuera por campo', s.get('DocDate').fuera===2 && s.get('U_HX_RD_FechaIngreso').dentro===2,
    JSON.stringify([...s]));
chk('descubre campos U_*FECHA sin que se los nombren', s.has('U_HX_RD_FechaIngreso'));
chk('incluye DocDate y TaxDate siempre', s.has('DocDate')&&s.has('TaxDate'));
chk('cuenta los nulos', s.get('TaxDate').nulos===2, JSON.stringify(s.get('TaxDate')));
// la sonda tiene que mirar los periodos de CADA cliente: con dos clientes de
// cortes distintos, una lista comun daria el conteo equivocado
const PERD=M.periodosPorCliente([ovp('2026-09-07','2026-09-13',{CardCode:'A'}),
                                 ovp('2026-09-21','2026-09-27',{CardCode:'B'})],'2026-09',['2026-09']).porCliente;
let s2=M.sondaFechas([fila({CardCode:'A',DocDate:'2026-09-10'}),
                      fila({CardCode:'B',DocDate:'2026-09-10'})], PERD);
chk('cada movimiento se mide contra el periodo de su cliente',
    s2.get('DocDate').dentro===1&&s2.get('DocDate').fuera===1, JSON.stringify(s2.get('DocDate')));
chk('la sonda cuenta los movimientos sin OV',
    M.sondaFechas([fila({CardCode:'Z'})], PERD).get('DocDate').sinOV===1);

// ── comparar ───────────────────────────────────────────────────────────────
console.log('\n— comparar: cruce por CardCode —');
const lado=(cod,nom,uf)=>[cod,{cod,nom,uf,cant:0,filas:0}];
let c=M.comparar(new Map([lado('C1','UNO',100),lado('C2','DOS',50)]),
                 new Map([lado('C1','UNO',110),lado('C2','DOS',50)]));
chk('dos lados → comparable', c.comparables.length===2&&c.unLado.length===0);
chk('dif y pct', Math.abs(c.comparables[0].dif-10)<1e-9&&Math.abs(c.comparables[0].pct-10)<1e-9, JSON.stringify(c.comparables[0]));
chk('ordena por diferencia absoluta', c.comparables[0].cod==='C1');
// una diferencia NEGATIVA grande tiene que encabezar igual que una positiva:
// ordenar con signo esconderia los clientes donde cobramos de menos
c=M.comparar(new Map([lado('C1','UNO',100),lado('C2','DOS',100)]),
             new Map([lado('C1','UNO',110),lado('C2','DOS',80)]));
chk('la diferencia negativa mas grande va primero', c.comparables[0].cod==='C2',
    c.comparables.map(x=>x.cod+':'+x.dif).join(' '));
// un cliente en un solo lado NO es un descalce de 100%
c=M.comparar(new Map([lado('C1','UNO',100)]), new Map([lado('C2','DOS',80)]));
chk('cliente solo en un lado va aparte', c.comparables.length===0&&c.unLado.length===2, JSON.stringify([c.comparables.length,c.unLado.length]));
chk('y conserva el CardCode para poder buscarlo', c.unLado.map(x=>x.cod).sort().join(',')==='C1,C2');
// el nombre se toma del lado que exista
c=M.comparar(new Map(), new Map([lado('C9','SOLO EN LA OV',5)]));
chk('toma el nombre del lado que exista', c.unLado[0].nom==='SOLO EN LA OV');
chk('cero contra cero es comparable con dif 0',
    M.comparar(new Map([lado('C1','UNO',0)]),new Map([lado('C1','UNO',0)])).comparables[0].dif===0);

// ── estado del documento ───────────────────────────────────────────────────
console.log('\n— estadoDe: distinguir "no lo cobraron" de "no correspondia" —');
chk('junta los campos de estado que vengan', M.estadoDe({DocumentStatus:'bost_Close',Cancelled:'tYES'})==='DocumentStatus=bost_Close Cancelled=tYES',
    M.estadoDe({DocumentStatus:'bost_Close',Cancelled:'tYES'}));
chk('con uno solo', M.estadoDe({DocumentStatus:'bost_Open'})==='DocumentStatus=bost_Open');
// que el extractor no haya traido ningun campo de estado NO es lo mismo que
// que todos los documentos esten vigentes, y hay que poder verlo
chk('sin campos de estado lo dice', M.estadoDe({DocNum:1})==='(sin campo de estado)');
chk('vacio no cuenta como estado', M.estadoDe({DocumentStatus:''})==='(sin campo de estado)');
chk('null no cuenta como estado', M.estadoDe({Cancelled:null})==='(sin campo de estado)');
nu=M.agregarNuestro([fila({DocumentStatus:'bost_Open'}),fila({DocumentStatus:'bost_Close',Quantity:40})],maestro,PER,'DocDate');
chk('el cliente desglosa por estado', nu.porCliente.get('C1').estados.size===2, String(nu.porCliente.get('C1').estados.size));
chk('y suma bien dentro de cada estado', nu.porCliente.get('C1').estados.get('DocumentStatus=bost_Close').cant===40);

// ── detalle de un cliente ──────────────────────────────────────────────────
console.log('\n— detalle documento por documento —');
let dn=M.detalleNuestro([fila({DocEntry:10,DocNum:900,Quantity:60}),
                         fila({DocEntry:10,DocNum:900,Quantity:40}),
                         fila({DocEntry:11,DocNum:901,DocDate:'2026-09-02',Quantity:25})],'C1',U,'DocDate');
chk('reagrupa las lineas en documentos', dn.length===2, String(dn.length));
chk('suma las lineas del mismo documento', dn.find(d=>d.docNum===900).cant===100);
chk('valoriza con la tarifa del documento', Math.abs(dn.find(d=>d.docNum===900).uf-100*0.065)<1e-9);
chk('marca el documento que quedo fuera del universo', dn.find(d=>d.docNum===901).periodo===null);
chk('trae el estado de cada documento', dn[0].estado==='(sin campo de estado)');
chk('ordena por fecha', dn[0].fecha<=dn[1].fecha);
chk('filtra por CardCode', M.detalleNuestro([fila({CardCode:'C2'})],'C1',U,'DocDate').length===0);
chk('filtra por concepto', M.detalleNuestro([fila({U_HX_RD_TransType:'TRASPASO'})],'C1',U,'DocDate').length===0);

let dv=M.detalleOV([ovDoc({}),ovDoc({DocEntry:2,DocNum:5002,U_HX_PeriodoDesde:'2026-08-31',U_HX_PeriodoHasta:'2026-09-06'})],'C1',U);
chk('trae las lineas de los dos periodos', dv.length===2, String(dv.length));
chk('marca cual esta en el universo', dv.filter(l=>l.usable).length===1, JSON.stringify(dv.map(l=>l.usable)));
chk('calcula la UF de la linea', Math.abs(dv[0].uf-(100*2543.03)/39123.45)<1e-9);
chk('sin TC deja la UF en null, no en cero',
    M.detalleOV([ovDoc({Comments:'SEMANA 38'})],'C1',U)[0].uf===null);
chk('filtra por CardCode', M.detalleOV([ovDoc({CardCode:'C2'})],'C1',U).length===0);
chk('respeta el patron de ItemCode', M.detalleOV([ovDoc({_lineas:[lin({ItemCode:'SERV-DIAS-PALLET'})]})],'C1',U).length===0);

// ── dias cubiertos por dos OV ──────────────────────────────────────────────
console.log('\n— periodosDe: no elegir cuando la fecha cae en dos —');
// la forma real de septiembre: el MISMO cliente con el corte de fin de mes y
// la semana completa. 58 clientes asi en los datos.
const PERX=M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                                '2026-09',['2026-09','2026-10']).porCliente;
const UX=PERX.get('C1').usables;
chk('el 29 cae en los dos periodos', M.periodosDe('2026-09-29',UX).length===2, JSON.stringify(M.periodosDe('2026-09-29',UX)));
chk('el 2 de octubre cae solo en el largo', M.periodosDe('2026-10-02',UX).length===1);
chk('el 20 de septiembre no cae en ninguno', M.periodosDe('2026-09-20',UX).length===0);
chk('fecha nula devuelve lista vacia', M.periodosDe(null,UX).length===0);

// el movimiento ambiguo se cuenta UNA vez y va al casillero aparte
nu=M.agregarNuestro([fila({DocDate:'2026-09-29',Quantity:100}),
                     fila({DocDate:'2026-10-02',Quantity:50})],maestro,PERX,'DocDate');
chk('el movimiento ambiguo no se duplica', nu.porCliente.get('C1').cant===150, String(nu.porCliente.get('C1').cant));
chk('y no se pierde', Math.abs(nu.porCliente.get('C1').uf-150*0.065)<1e-9);
chk('va al casillero de los dias cubiertos dos veces', nu.porPeriodo.get(M.AMBIGUO).cant===100,
    JSON.stringify([...nu.porPeriodo].map(([k,v])=>k+':'+v.cant)));
chk('el movimiento no ambiguo va a su periodo', nu.porPeriodo.get('2026-09-28..2026-10-04').cant===50);
chk('se cuenta cuantas filas quedaron ambiguas', nu.dobleCobertura===1, String(nu.dobleCobertura));
chk('sin solape no hay ambiguas', M.agregarNuestro([fila({})],maestro,PER,'DocDate').dobleCobertura===0);

console.log('\n— analisisSolape: la aritmetica decide si hay duplicado —');
const movs=[fila({DocEntry:1,DocDate:'2026-09-29',Quantity:100}),   // dias compartidos
            fila({DocEntry:2,DocDate:'2026-10-02',Quantity:200})];  // resto del periodo largo
const ovCorta=ovDoc({DocEntry:50,DocNum:1,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-09-30',
                     _lineas:[lin({Quantity:100,Price:0.065*39123.45})]});
// caso 1: la OV larga cobra el periodo COMPLETO -> los dias compartidos van dos veces
let ovLargaTodo=ovDoc({DocEntry:51,DocNum:2,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                       _lineas:[lin({Quantity:300,Price:0.065*39123.45})]});
let sp2=M.solapes(PERX);
let an=M.analisisSolape(movs,[ovCorta,ovLargaTodo],PERX,'DocDate',null,sp2);
chk('un cliente analizado', an.length===1, String(an.length));
chk('identifica los dias compartidos', an[0].interseccion==='2026-09-28..2026-09-30', an[0].interseccion);
chk('mide los movimientos de esos dias', Math.abs(an[0].movI.uf-100*0.065)<1e-9, String(an[0].movI.uf));
chk('mide los del periodo largo', Math.abs(an[0].movB.uf-300*0.065)<1e-9, String(an[0].movB.uf));
chk('veredicto duplicado', an[0].veredicto==='duplicado', an[0].veredicto+' ovB='+an[0].ovB.uf);
chk('y el duplicado vale lo de esos dias', Math.abs(an[0].duplicado-100*0.065)<1e-9, String(an[0].duplicado));
// caso 2: la OV larga cobra solo el RESTO -> se reparten, no hay duplicado
let ovLargaResto=ovDoc({DocEntry:52,DocNum:3,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                        _lineas:[lin({Quantity:200,Price:0.065*39123.45})]});
an=M.analisisSolape(movs,[ovCorta,ovLargaResto],PERX,'DocDate',null,sp2);
chk('veredicto reparten', an[0].veredicto==='reparten', an[0].veredicto);
chk('sin duplicado', an[0].duplicado===0);
// caso 3: ni una ni otra -> no concluyente, y no se inventa un veredicto
let ovRaro=ovDoc({DocEntry:53,DocNum:4,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                  _lineas:[lin({Quantity:999,Price:0.065*39123.45})]});
an=M.analisisSolape(movs,[ovCorta,ovRaro],PERX,'DocDate',null,sp2);
chk('veredicto no concluyente', an[0].veredicto==='no concluyente', an[0].veredicto);
chk('y no cuenta duplicado', an[0].duplicado===0);
chk('no concluye porque lo inexplicado supera lo medido',
    Math.abs(an[0].resto)>an[0].movI.uf, an[0].resto+' vs '+an[0].movI.uf);
chk('el cliente sin solape no se analiza', M.analisisSolape(movs,[ovCorta],PER,'DocDate',null,M.solapes(PER)).length===0);
// los movimientos de OTRO cliente no pueden entrar en el analisis
an=M.analisisSolape(movs.concat([fila({DocEntry:9,CardCode:'C2',DocDate:'2026-09-29',Quantity:5000})]),
                    [ovCorta,ovLargaTodo],PERX,'DocDate',null,sp2);
chk('no mezcla movimientos de otro cliente', Math.abs(an[0].movI.uf-100*0.065)<1e-9, String(an[0].movI.uf));
// el corto y el largo se reconocen por su fin, no por el orden en que llegaron
const PERY=M.periodosPorCliente([ovp('2026-09-28','2026-10-04'),ovp('2026-09-28','2026-09-30')],
                                '2026-09',['2026-09','2026-10']).porCliente;
an=M.analisisSolape(movs,[ovCorta,ovLargaTodo],PERY,'DocDate',null,M.solapes(PERY));
chk('reconoce cual es el corto aunque llegue segundo', an[0].corto==='2026-09-28..2026-09-30',
    an[0].corto+' / '+an[0].largo);
chk('y el veredicto no cambia con el orden', an[0].veredicto==='duplicado', an[0].veredicto);
// periodos que empiezan en dias distintos: la interseccion es el cruce, no la union
const PERZ=M.periodosPorCliente([ovp('2026-09-25','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                                '2026-09',['2026-09','2026-10']).porCliente;
an=M.analisisSolape(movs,[ovCorta,ovLargaTodo],PERZ,'DocDate',null,M.solapes(PERZ));
chk('la interseccion es el cruce de los dos rangos', an[0].interseccion==='2026-09-28..2026-09-30', an[0].interseccion);

// --- los tres casos que la tolerancia fija resolvia mal ---
// 1) sin emisiones en ninguno de los dos periodos: el solape es inofensivo y
//    eso NO es un veredicto indeciso
an=M.analisisSolape([],[],PERX,'DocDate',null,sp2);
chk('sin emisiones en esos dias no es "no concluyente"', an[0].veredicto==='sin emisiones', an[0].veredicto);
chk('y no aporta duplicado', an[0].duplicado===0);
// 2) la OV larga cobra el periodo completo MAS algo que no sabemos explicar.
//    Esta del lado del periodo completo, asi que igual cobra los dias
//    compartidos: es duplicado, con un resto declarado aparte. Es el caso
//    CAMBIASO (OV larga 244,94 contra 204,12 del periodo y 122,47 del resto).
const ovLargaMas=ovDoc({DocEntry:54,DocNum:5,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                        _lineas:[lin({Quantity:360,Price:0.065*39123.45})]});
an=M.analisisSolape(movs,[ovCorta,ovLargaMas],PERX,'DocDate',null,sp2);
chk('la OV larga con un extra igual es duplicado', an[0].veredicto==='duplicado', an[0].veredicto);
chk('el duplicado sigue siendo lo de los dias compartidos', Math.abs(an[0].duplicado-100*0.065)<1e-9);
chk('y el extra se declara como resto', Math.abs(an[0].resto-60*0.065)<1e-9, String(an[0].resto));
chk('sin extra el resto es cero', Math.abs(M.analisisSolape(movs,[ovCorta,ovLargaTodo],PERX,'DocDate',null,sp2)[0].resto)<1e-9);
// 3) si la OV corta NO cobra los dias compartidos, no se puede hablar de
//    duplicado aunque la larga cobre todo
const ovCortaOtra=ovDoc({DocEntry:55,DocNum:6,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-09-30',
                         _lineas:[lin({Quantity:7,Price:0.065*39123.45})]});
an=M.analisisSolape(movs,[ovCortaOtra,ovLargaTodo],PERX,'DocDate',null,sp2);
chk('si la OV corta no cobra esos dias, no es duplicado', an[0].veredicto!=='duplicado', an[0].veredicto);
chk('y no se suma duplicado', an[0].duplicado===0);
// 4) emisiones en el periodo largo pero NINGUNA en los dias compartidos: hay
//    contenido, asi que no es "sin emisiones" — simplemente no hay nada que
//    se pueda estar cobrando dos veces. Es el caso C76522630-9 de los datos.
const movSoloOct=[fila({DocEntry:3,DocDate:'2026-10-02',Quantity:200})];
const ovCortaCero=ovDoc({DocEntry:56,DocNum:7,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-09-30',
                         _lineas:[lin({Quantity:0,Price:0})]});
const ovLargaOct=ovDoc({DocEntry:57,DocNum:8,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                        _lineas:[lin({Quantity:200,Price:0.065*39123.45})]});
an=M.analisisSolape(movSoloOct,[ovCortaCero,ovLargaOct],PERX,'DocDate',null,sp2);
chk('con emisiones en el periodo largo no es "sin emisiones"', an[0].veredicto!=='sin emisiones',
    an[0].veredicto+'  movB='+an[0].movB.uf);
chk('y no cuenta duplicado porque no hay dias compartidos con emisiones', an[0].duplicado===0);
// 5) la OV larga cobra MUCHO MENOS que los movimientos de su periodo. El resto
//    es negativo y grande: tampoco se concluye, el signo no debe importar.
const ovLargaMenos=ovDoc({DocEntry:58,DocNum:9,U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04',
                          _lineas:[lin({Quantity:50,Price:0.065*39123.45})]});
an=M.analisisSolape(movs,[ovCorta,ovLargaMenos],PERX,'DocDate',null,sp2);
chk('resto negativo grande tampoco concluye', an[0].veredicto==='no concluyente', an[0].veredicto);
chk('y el resto queda con su signo', an[0].resto<0, String(an[0].resto));

// ── resolverCortes ─────────────────────────────────────────────────────────
console.log('\n— resolverCortes: la OV de cierre interna sale de la comparacion —');
// la forma real: el corte 28-30 dentro de la semana 28-09..04-10
let PC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                            '2026-09',['2026-09','2026-10']).porCliente;
let ct=M.resolverCortes(PC);
chk('descarta uno de los dos', ct.length===1, String(ct.length));
chk('descarta el CORTO', ct[0].descartado==='2026-09-28..2026-09-30', ct[0].descartado);
chk('a favor del largo', ct[0].aFavorDe==='2026-09-28..2026-10-04', ct[0].aFavorDe);
chk('y lo saca del mapa del cliente', PC.get('C1').usables.size===1 && PC.get('C1').usables.has('2026-09-28..2026-10-04'),
    JSON.stringify([...PC.get('C1').usables.keys()]));
chk('despues de resolver no quedan solapes', M.solapes(PC).length===0);
// el orden de llegada no debe importar: el largo gana igual
PC=M.periodosPorCliente([ovp('2026-09-28','2026-10-04'),ovp('2026-09-28','2026-09-30')],
                        '2026-09',['2026-09','2026-10']).porCliente;
ct=M.resolverCortes(PC);
chk('el largo gana aunque llegue primero', ct[0].descartado==='2026-09-28..2026-09-30', ct[0].descartado);
// semanas que NO se pisan no se tocan
PC=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],
                        '2026-09',['2026-09']).porCliente;
chk('las semanas normales no se descartan', M.resolverCortes(PC).length===0 && PC.get('C1').usables.size===2);
// un cliente con corte y otro sin corte: solo se toca el que corresponde
PC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30',{CardCode:'A'}),
                         ovp('2026-09-28','2026-10-04',{CardCode:'A'}),
                         ovp('2026-09-28','2026-10-04',{CardCode:'B'})],
                        '2026-09',['2026-09','2026-10']).porCliente;
ct=M.resolverCortes(PC);
chk('solo se descarta en el cliente que tiene las dos', ct.length===1 && ct[0].cod==='A', JSON.stringify(ct));
chk('el otro cliente queda intacto', PC.get('B').usables.size===1);
// cuenta cuantas OV traia el periodo descartado, para poder informarlo
PC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-09-30'),
                         ovp('2026-09-28','2026-10-04')],'2026-09',['2026-09','2026-10']).porCliente;
chk('informa cuantas OV tenia el periodo descartado', M.resolverCortes(PC)[0].ovs===2,
    String(M.resolverCortes(M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-10-04')],'2026-09',['2026-09','2026-10']).porCliente)[0].ovs));

// dos semanas consecutivas que comparten un dia NO son un corte interno: no
// se descarta ninguna y el caso sigue visible como solape para que se mire
PC=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-13','2026-09-19')],
                        '2026-09',['2026-09']).porCliente;
chk('dos semanas que comparten un dia no se descartan', M.resolverCortes(PC).length===0, 
    JSON.stringify(M.resolverCortes(M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-13','2026-09-19')],'2026-09',['2026-09']).porCliente)));
chk('y siguen visibles como solape', M.solapes(PC).length===1, String(M.solapes(PC).length));
// un periodo que termina el MISMO dia que el largo igual esta contenido
PC=M.periodosPorCliente([ovp('2026-09-30','2026-10-04'),ovp('2026-09-28','2026-10-04')],
                        '2026-09',['2026-09','2026-10']).porCliente;
ct=M.resolverCortes(PC);
chk('contenido con el mismo dia final se descarta', ct.length===1 && ct[0].descartado==='2026-09-30..2026-10-04',
    JSON.stringify(ct));
// y uno que empieza el mismo dia y termina despues NO esta contenido
PC=M.periodosPorCliente([ovp('2026-09-28','2026-10-04'),ovp('2026-09-28','2026-10-11')],
                        '2026-09',['2026-09','2026-10']).porCliente;
chk('el que se desborda no esta contenido', M.resolverCortes(PC).length===1 &&
    M.resolverCortes(M.periodosPorCliente([ovp('2026-09-28','2026-10-04'),ovp('2026-09-28','2026-10-11')],'2026-09',['2026-09','2026-10']).porCliente)[0].descartado==='2026-09-28..2026-10-04');

// solo lo CONTENIDO se descarta
PC=M.periodosPorCliente([ovp('2026-09-29','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                        '2026-09',['2026-09','2026-10']).porCliente;
chk('un periodo contenido adentro si se descarta', M.resolverCortes(PC).length===1);
// cada cliente se resuelve por separado
PC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30',{CardCode:'A'}),ovp('2026-09-28','2026-10-04',{CardCode:'A'}),
                         ovp('2026-09-28','2026-09-30',{CardCode:'B'}),ovp('2026-09-28','2026-10-04',{CardCode:'B'})],
                        '2026-09',['2026-09','2026-10']).porCliente;
ct=M.resolverCortes(PC);
chk('dos clientes con corte: dos descartes', ct.length===2, JSON.stringify(ct.map(x=>x.cod)));
chk('cada uno conserva SU semana', PC.get('A').usables.size===1 && PC.get('B').usables.size===1,
    JSON.stringify([PC.get('A').usables.size, PC.get('B').usables.size]));

// y el efecto que importa: despues de resolver, los movimientos del 29 ya no
// son ambiguos y la OV de cierre no se cuenta
PC=M.periodosPorCliente([ovp('2026-09-28','2026-09-30'),ovp('2026-09-28','2026-10-04')],
                        '2026-09',['2026-09','2026-10']).porCliente;
M.resolverCortes(PC);
nu=M.agregarNuestro([fila({DocDate:'2026-09-29',Quantity:100})],maestro,PC,'DocDate');
chk('el movimiento del 29 deja de ser ambiguo', nu.dobleCobertura===0, String(nu.dobleCobertura));
chk('y cae en la semana', nu.porPeriodo.get('2026-09-28..2026-10-04').cant===100,
    JSON.stringify([...nu.porPeriodo.keys()]));
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-09-30'})],PC);
chk('la OV de cierre ya no se suma', ov.usadas===0 && ov.fueraDeUniverso===1, JSON.stringify([ov.usadas,ov.fueraDeUniverso]));
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-09-28',U_HX_PeriodoHasta:'2026-10-04'})],PC);
chk('la OV de la semana si', ov.usadas===1);

// ── descuadres ─────────────────────────────────────────────────────────────
console.log('\n— descuadres: en que semana, y por cuantos pallets —');
// la forma real medida: HAMBURGO calza en cuatro semanas y le falta un
// movimiento de 540 en la del 14 al 20
const PERH=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],
                                '2026-09',['2026-09']).porCliente;
const movH=[fila({DocEntry:1,DocDate:'2026-09-08',Quantity:540}),
            fila({DocEntry:2,DocDate:'2026-09-15',Quantity:540}),
            fila({DocEntry:3,DocDate:'2026-09-16',Quantity:540})];
const ovH=[ovDoc({DocEntry:50,DocNum:900,U_HX_PeriodoDesde:'2026-09-07',U_HX_PeriodoHasta:'2026-09-13',
                  _lineas:[lin({Quantity:540,Price:0.065*39123.45})]}),
           ovDoc({DocEntry:51,DocNum:901,U_HX_PeriodoDesde:'2026-09-14',U_HX_PeriodoHasta:'2026-09-20',
                  _lineas:[lin({Quantity:540,Price:0.065*39123.45})]})];
nu=M.agregarNuestro(movH,maestro,PERH,'DocDate');
ov=M.agregarOV(ovH,PERH);
let dd=M.descuadres(nu.porCliente,ov.porCliente,['C1']);
chk('senala una sola semana', dd.length===1, JSON.stringify(dd.map(d=>d.periodo)));
chk('y es la correcta', dd[0].periodo==='2026-09-14..2026-09-20', dd[0].periodo);
chk('dice cuantos pallets faltan', dd[0].difCant===-540, String(dd[0].difCant));
chk('y cuanto valen', Math.abs(dd[0].difUF+540*0.065)<1e-9, String(dd[0].difUF));
chk('trae los dos lados', dd[0].movCant===1080 && dd[0].ovCant===540, JSON.stringify([dd[0].movCant,dd[0].ovCant]));
chk('nombra la OV del periodo', dd[0].ovs[0]===901, JSON.stringify(dd[0].ovs));
chk('la semana que calza no aparece', !dd.some(d=>d.periodo==='2026-09-07..2026-09-13'));

// una semana con movimientos y SIN linea de emision en la OV
ov=M.agregarOV([ovH[0]],PERH);
dd=M.descuadres(nu.porCliente,ov.porCliente,['C1']);
let sinLinea=dd.find(d=>d.periodo==='2026-09-14..2026-09-20');
chk('semana sin linea de emision aparece', !!sinLinea);
chk('con la OV en cero y sin numero de OV', sinLinea.ovCant===0 && sinLinea.ovs.length===0,
    JSON.stringify([sinLinea.ovCant,sinLinea.ovs]));

// una semana facturada SIN ningun movimiento: existe solo del lado de la OV y
// tiene que aparecer igual, o se perderia una factura sin respaldo
nu=M.agregarNuestro([fila({DocEntry:1,DocDate:'2026-09-08',Quantity:540})],maestro,PERH,'DocDate');
ov=M.agregarOV(ovH,PERH);
dd=M.descuadres(nu.porCliente,ov.porCliente,['C1']);
let soloOV=dd.find(d=>d.periodo==='2026-09-14..2026-09-20');
chk('semana facturada sin movimientos aparece', !!soloOV, JSON.stringify(dd.map(d=>d.periodo)));
chk('con movimientos en cero y delta positivo', soloOV && soloOV.movCant===0 && soloOV.difCant===540,
    JSON.stringify(soloOV && [soloOV.movCant,soloOV.difCant]));
nu=M.agregarNuestro(movH,maestro,PERH,'DocDate');

// el caso inverso: la OV cobra MAS que los movimientos
const ovMas=[ovH[0], ovDoc({DocEntry:52,DocNum:902,U_HX_PeriodoDesde:'2026-09-14',U_HX_PeriodoHasta:'2026-09-20',
                            _lineas:[lin({Quantity:1620,Price:0.065*39123.45})]})];
ov=M.agregarOV(ovMas,PERH);
dd=M.descuadres(nu.porCliente,ov.porCliente,['C1']);
chk('cobro de mas sale con delta positivo', dd[0].difCant===540, String(dd[0].difCant));

// tolerancia: una diferencia de redondeo no es un descuadre
const ovCasi=[ovDoc({DocEntry:53,DocNum:903,U_HX_PeriodoDesde:'2026-09-07',U_HX_PeriodoHasta:'2026-09-13',
                     _lineas:[lin({Quantity:540,Price:0.065*39123.45*1.0000001})]})];
nu=M.agregarNuestro([fila({DocEntry:1,DocDate:'2026-09-08',Quantity:540})],maestro,PERH,'DocDate');
ov=M.agregarOV(ovCasi,PERH);
chk('el redondeo no se reporta', M.descuadres(nu.porCliente,ov.porCliente,['C1']).length===0,
    JSON.stringify(M.descuadres(nu.porCliente,ov.porCliente,['C1'])));
chk('con tolerancia cero si', M.descuadres(nu.porCliente,ov.porCliente,['C1'],0).length===1);

// un cliente que no esta en ninguno de los dos lados no revienta
chk('cliente inexistente', M.descuadres(nu.porCliente,ov.porCliente,['C9']).length===0);
// y solo se miran los clientes pedidos
nu=M.agregarNuestro(movH.concat([fila({DocEntry:9,CardCode:'C2',DocDate:'2026-09-15',Quantity:99})]),
                    maestro,M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20'),
                                                  ovp('2026-09-14','2026-09-20',{CardCode:'C2'})],'2026-09',['2026-09']).porCliente,'DocDate');
chk('solo los clientes pedidos', M.descuadres(nu.porCliente,new Map(),['C1']).every(d=>d.cod==='C1'));

// ── el concepto como parametro ─────────────────────────────────────────────
console.log('\n— serviciosDe: de que servicios de contrato puede ser un concepto —');
chk('EMISION trae las siete variantes', M.serviciosDe('EMISION').length===7);
chk('no depende del maestro para EMISION', M.serviciosDe('emision',null).length===7);
const EQ={'TRANSFERENCIA':'Transferencias','TRASPASO':'Traspasos',
          'CONF_TRANSF':'Transferencias | Trans Diferenciada  (hereda la del movimiento que vuelve)'};
chk('un concepto simple', JSON.stringify(M.serviciosDe('TRANSFERENCIA',EQ))==='["Transferencias"]');
// el comentario entre parentesis NO es un nombre de servicio
chk('corta en el parentesis', JSON.stringify(M.serviciosDe('CONF_TRANSF',EQ))==='["Transferencias","Trans Diferenciada"]',
    JSON.stringify(M.serviciosDe('CONF_TRANSF',EQ)));
chk('concepto que no esta en el mapa', M.serviciosDe('NUEVO',EQ).length===0);
chk('sin mapa no revienta', M.serviciosDe('TRANSFERENCIA',null).length===0);

console.log('\n— agregarNuestro con otro concepto —');
const filaT=o=>Object.assign({DocEntry:1, CardCode:'C1', CardName:'CLIENTE UNO', DocDate:'2026-09-10',
  U_HX_RD_TransType:'TRANSFERENCIA', Quantity:100, U_HX_RD_TarifaCli:0.021}, o);
const maestroT={}; maestroT[M.norm('CLIENTE UNO')]={tarifas:{'Transferencias':0.021,'Traspasos':0.026}};
nu=M.agregarNuestro([filaT({}),fila({})],maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA'],servicios:['Transferencias']});
chk('toma TRANSFERENCIA y deja EMISION fuera', nu.porCliente.get('C1').cant===100, String(nu.porCliente.get('C1').cant));
chk('identifica el servicio del contrato', nu.porVariante.has('Transferencias'), JSON.stringify([...nu.porVariante.keys()]));
chk('UF con la tarifa estampada', Math.abs(nu.porVariante.get('Transferencias').uf-100*0.021)<1e-9);
// sin opt se comporta como antes: solo EMISION
chk('por defecto sigue siendo EMISION', M.agregarNuestro([filaT({}),fila({})],maestroT,PER,'DocDate').porCliente.get('C1').cant===100);
chk('y es la fila de EMISION', M.agregarNuestro([filaT({}),fila({})],maestro,PER,'DocDate').porVariante.has('Emision'));
// --incluye: el movimiento y su confirmacion en el mismo concepto
nu=M.agregarNuestro([filaT({}),filaT({DocEntry:2,U_HX_RD_TransType:'CONF_TRANSF',Quantity:40})],
                    maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA','CONF_TRANSF'],servicios:['Transferencias']});
chk('suma el movimiento y su confirmacion', nu.porCliente.get('C1').cant===140, String(nu.porCliente.get('C1').cant));
chk('sin --incluye la confirmacion no entra',
    M.agregarNuestro([filaT({}),filaT({DocEntry:2,U_HX_RD_TransType:'CONF_TRANSF',Quantity:40})],
                     maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA'],servicios:['Transferencias']}).porCliente.get('C1').cant===100);
chk('el concepto se compara sin importar mayusculas',
    M.agregarNuestro([filaT({U_HX_RD_TransType:'transferencia'})],maestroT,PER,'DocDate',
                     {conceptos:['TRANSFERENCIA'],servicios:['Transferencias']}).porCliente.size===1);
chk('y tolera espacios', M.agregarNuestro([filaT({U_HX_RD_TransType:' TRANSFERENCIA '})],maestroT,PER,'DocDate',
                     {conceptos:['TRANSFERENCIA'],servicios:['Transferencias']}).porCliente.size===1);
// la lista de servicios acota el calce: una tarifa de traspaso no es transferencia
chk('la tarifa de otro servicio no se identifica',
    M.agregarNuestro([filaT({U_HX_RD_TarifaCli:0.026})],maestroT,PER,'DocDate',
                     {conceptos:['TRANSFERENCIA'],servicios:['Transferencias']}).sinVariante===1);
chk('variantes respeta la lista que le pasan', M.variantes(0.026,{'Transferencias':0.021,'Traspasos':0.026},['Transferencias']).length===0);
chk('y sin lista usa las de emision', M.variantes(0.065,{'Emision':0.065}).length===1);

console.log('\n— detalleNuestro con otro concepto —');
dn=M.detalleNuestro([filaT({DocEntry:7,DocNum:700}),fila({DocEntry:8,DocNum:800})],'C1',U,'DocDate',
                    {conceptos:['TRANSFERENCIA']});
chk('el detalle filtra por el concepto pedido', dn.length===1 && dn[0].docNum===700, JSON.stringify(dn.map(d=>d.docNum)));
chk('y por defecto sigue en EMISION',
    M.detalleNuestro([filaT({DocEntry:7,DocNum:700}),fila({DocEntry:8,DocNum:800})],'C1',U,'DocDate')[0].docNum===800);

// ── --resta: el reverso ────────────────────────────────────────────────────
console.log('\n— resta: la confirmacion es el reverso del movimiento —');
// la forma real medida en PUNTO AZUL: la OV cobra TRANSFERENCIA menos CONF_TRANSF
const movR=[filaT({DocEntry:1,Quantity:2579}),
            filaT({DocEntry:2,U_HX_RD_TransType:'CONF_TRANSF',Quantity:275})];
nu=M.agregarNuestro(movR,maestroT,PER,'DocDate',
                    {conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF'],servicios:['Transferencias']});
chk('la cantidad queda neta', nu.porCliente.get('C1').cant===2579-275, String(nu.porCliente.get('C1').cant));
chk('y la UF tambien', Math.abs(nu.porCliente.get('C1').uf-(2579-275)*0.021)<1e-9, String(nu.porCliente.get('C1').uf));
chk('el grupo del servicio queda neto', nu.porVariante.get('Transferencias').cant===2304);
chk('y el periodo tambien', nu.porPeriodo.get('2026-09-07..2026-09-13').cant===2304);
// sin --resta la confirmacion no entra para nada
chk('sin resta la confirmacion se ignora',
    M.agregarNuestro(movR,maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA'],servicios:['Transferencias']})
     .porCliente.get('C1').cant===2579);
// con --incluye SUMA, con --resta RESTA: son lo contrario
chk('incluye y resta van en sentidos opuestos',
    M.agregarNuestro(movR,maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA','CONF_TRANSF'],servicios:['Transferencias']})
     .porCliente.get('C1').cant===2579+275);
// un concepto restado que NO esta en los movimientos no cambia nada
// el nombre del concepto restado se normaliza igual que el pedido
chk('la resta tolera minusculas y espacios',
    M.agregarNuestro(movR,maestroT,PER,'DocDate',
      {conceptos:['TRANSFERENCIA'],resta:[' conf_transf '],servicios:['Transferencias']}).porCliente.get('C1').cant===2304,
    String(M.agregarNuestro(movR,maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA'],resta:[' conf_transf '],servicios:['Transferencias']}).porCliente.get('C1').cant));
chk('restar un concepto ausente no cambia nada',
    M.agregarNuestro([filaT({Quantity:100})],maestroT,PER,'DocDate',
                     {conceptos:['TRANSFERENCIA'],resta:['CONF_DEVOL'],servicios:['Transferencias']}).porCliente.get('C1').cant===100);
// la resta puede dejar el neto en cero o negativo, y eso NO se puede ocultar
nu=M.agregarNuestro([filaT({DocEntry:1,Quantity:100}),
                     filaT({DocEntry:2,U_HX_RD_TransType:'CONF_TRANSF',Quantity:150})],
                    maestroT,PER,'DocDate',{conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF'],servicios:['Transferencias']});
chk('el neto negativo se conserva', nu.porCliente.get('C1').cant===-50, String(nu.porCliente.get('C1').cant));
chk('y su UF tambien', Math.abs(nu.porCliente.get('C1').uf+50*0.021)<1e-9, String(nu.porCliente.get('C1').uf));
// el descuadre por semana tambien queda neto
ov=M.agregarOV([ovDoc({U_HX_PeriodoDesde:'2026-09-07',U_HX_PeriodoHasta:'2026-09-13',
                       _lineas:[lin({Quantity:2304,Price:0.021*39123.45})]})],PER);
nu=M.agregarNuestro(movR,maestroT,PER,'DocDate',
                    {conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF'],servicios:['Transferencias']});
dd=M.descuadres(nu.porCliente,ov.porCliente,['C1']);
chk('con la resta aplicada el descuadre desaparece', dd.length===0, JSON.stringify(dd));
// el detalle marca la fila restada
dn=M.detalleNuestro(movR,'C1',U,'DocDate',{conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF']});
chk('el detalle trae las dos filas', dn.length===2, String(dn.length));
chk('y marca cual es el reverso', dn.some(d=>/RESTA/.test(d.estado)), JSON.stringify(dn.map(d=>d.estado)));
chk('con la cantidad en negativo', dn.find(d=>/RESTA/.test(d.estado)).cant===-275,
    String(dn.find(d=>/RESTA/.test(d.estado)).cant));

// ── --resta-si: restar solo una parte ──────────────────────────────────────
console.log('\n— resta-si: la confirmacion viene en dos direcciones —');
// la forma real: CONF_TRANSF con FromWarehouse RETAIL es retorno; con CLIENTES
// va en la misma direccion que un movimiento y no deberia netear
const movD=[filaT({DocEntry:1,Quantity:1000,FromWarehouse:'CLIENTES',ToWarehouse:'RETAIL'}),
            filaT({DocEntry:2,U_HX_RD_TransType:'CONF_TRANSF',Quantity:300,FromWarehouse:'RETAIL',ToWarehouse:'CLIENTES'}),
            filaT({DocEntry:3,U_HX_RD_TransType:'CONF_TRANSF',Quantity:200,FromWarehouse:'CLIENTES',ToWarehouse:'RETAIL'})];
const base={conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF'],servicios:['Transferencias']};
nu=M.agregarNuestro(movD,maestroT,PER,'DocDate',base);
chk('sin condicion se restan las dos', nu.porCliente.get('C1').cant===500, String(nu.porCliente.get('C1').cant));
nu=M.agregarNuestro(movD,maestroT,PER,'DocDate',Object.assign({},base,{restaSi:{campo:'FromWarehouse',valor:'RETAIL'}}));
chk('con la condicion se resta solo el retorno', nu.porCliente.get('C1').cant===700, String(nu.porCliente.get('C1').cant));
chk('y la UF acompana', Math.abs(nu.porCliente.get('C1').uf-700*0.021)<1e-9);
chk('lo omitido se cuenta', nu.restaOmitida===1, String(nu.restaOmitida));
chk('sin condicion no hay omitidas', M.agregarNuestro(movD,maestroT,PER,'DocDate',base).restaOmitida===0);
// la condicion NO debe tocar los movimientos, solo lo que se resta
nu=M.agregarNuestro(movD,maestroT,PER,'DocDate',
    Object.assign({},base,{restaSi:{campo:'FromWarehouse',valor:'NINGUNA'}}));
chk('la condicion no filtra los movimientos', nu.porCliente.get('C1').cant===1000, String(nu.porCliente.get('C1').cant));
chk('y entonces se omiten las dos confirmaciones', nu.restaOmitida===2);
// compara sin importar mayusculas ni espacios
chk('la condicion tolera mayusculas y espacios',
    M.agregarNuestro(movD,maestroT,PER,'DocDate',
      Object.assign({},base,{restaSi:{campo:'FromWarehouse',valor:' retail '}})).porCliente.get('C1').cant===700);
// un campo ausente no cumple: no se puede restar por omision
chk('un campo ausente no cumple la condicion',
    M.agregarNuestro(movD,maestroT,PER,'DocDate',
      Object.assign({},base,{restaSi:{campo:'NoExiste',valor:'X'}})).porCliente.get('C1').cant===1000);
// el detalle aplica la misma condicion
dn=M.detalleNuestro(movD,'C1',U,'DocDate',Object.assign({},base,{restaSi:{campo:'FromWarehouse',valor:'RETAIL'}}));
chk('el detalle respeta la condicion', dn.length===2, JSON.stringify(dn.map(d=>d.docNum)));
chk('y sin condicion trae las tres', M.detalleNuestro(movD,'C1',U,'DocDate',base).length===3);

// ── itemCodesDelPatron: la guardia del patron ──────────────────────────────
console.log('\n— itemCodesDelPatron: que esta tomando el patron —');
const ovT=[ovDoc({_lineas:[{ItemCode:'SERV-TRANSFERENCIAS',Quantity:100},
                           {ItemCode:'SERV-TRANSF-WALMART',Quantity:60},
                           {ItemCode:'SERV-DIAS-PALLET',Quantity:9999}]})];
let ic=M.itemCodesDelPatron(ovT,/^SERV-TRANSF/);
chk('un patron amplio toma los dos', ic.size===2, JSON.stringify([...ic.keys()]));
chk('y deja fuera lo que no calza', !ic.has('SERV-DIAS-PALLET'));
chk('trae la cantidad', ic.get('SERV-TRANSF-WALMART').cant===60);
chk('y las lineas', ic.get('SERV-TRANSFERENCIAS').lineas===1);
chk('un patron exacto toma uno solo', M.itemCodesDelPatron(ovT,/^SERV-TRANSFERENCIAS$/).size===1);
chk('sin patron usa el de emisiones', M.itemCodesDelPatron([ovDoc({_lineas:[lin({})]})]).has('SERV-EMISIONES'));
chk('suma las lineas repetidas del mismo ItemCode',
    M.itemCodesDelPatron([ovDoc({_lineas:[{ItemCode:'SERV-DEV',Quantity:10},{ItemCode:'SERV-DEV',Quantity:5}]})],/SERV-DEV/)
     .get('SERV-DEV').cant===15);
chk('ItemCode vacio no se cuenta', M.itemCodesDelPatron([ovDoc({_lineas:[{ItemCode:'',Quantity:10}]})],/.*/).size===0);
chk('documento sin lineas no revienta', M.itemCodesDelPatron([ovDoc({_lineas:null})],/.*/).size===0);

// ── la guardia de las opciones ─────────────────────────────────────────────
console.log('\n— leerOpcion: el valor es todo lo que sigue al primer igual —');
chk('valor simple', M.leerOpcion(['--mes=2026-09'],'mes')==='2026-09');
// LA TRAMPA que costo dos corridas: el valor contiene un '='
chk('valor con un igual adentro', M.leerOpcion(['--resta-si=FromWarehouse=RETAIL'],'resta-si')==='FromWarehouse=RETAIL',
    JSON.stringify(M.leerOpcion(['--resta-si=FromWarehouse=RETAIL'],'resta-si')));
chk('ausente devuelve el default', M.leerOpcion(['--mes=1'],'patron','X')==='X');
chk('sin valor devuelve el default', M.leerOpcion(['--mes'],'mes','D')==='D');
chk('valor vacio es vacio, no el default', M.leerOpcion(['--mes='],'mes','D')==='');
// --resta no debe leer el valor de --resta-si
chk('--resta no se come a --resta-si', M.leerOpcion(['--resta-si=A=B'],'resta','vacio')==='vacio',
    JSON.stringify(M.leerOpcion(['--resta-si=A=B'],'resta','vacio')));
chk('y --resta-si se lee bien estando los dos',
    M.leerOpcion(['--resta=CONF','--resta-si=A=B'],'resta-si')==='A=B');
chk('lista vacia', M.leerOpcion([],'mes','D')==='D' && M.leerOpcion(null,'mes','D')==='D');

console.log('\n— estaPresente: la bandera sin valor —');
chk('bandera sola', M.estaPresente(['--mantener-corte'],'mantener-corte')===true);
chk('bandera con valor', M.estaPresente(['--mantener-corte=1'],'mantener-corte')===true);
chk('ausente', M.estaPresente(['--mes=1'],'mantener-corte')===false);
chk('un prefijo no la activa', M.estaPresente(['--mantener'],'mantener-corte')===false);
// y al reves: una opcion MAS LARGA no debe activar la bandera corta
chk('una opcion mas larga no la activa', M.estaPresente(['--mantener-corte-otro'],'mantener-corte')===false,
    String(M.estaPresente(['--mantener-corte-otro'],'mantener-corte')));
chk('--resta no activa --resta-si', M.estaPresente(['--resta=X'],'resta-si')===false);
chk('lista vacia', M.estaPresente([],'x')===false && M.estaPresente(null,'x')===false);

console.log('\n— opcionesDesconocidas: ninguna opcion se pierde en silencio —');
chk('una opcion valida pasa', M.opcionesDesconocidas(['--mes=2026-09']).length===0);
chk('con valor que contiene = tambien', M.opcionesDesconocidas(['--resta-si=FromWarehouse=RETAIL']).length===0);
chk('sin valor tambien', M.opcionesDesconocidas(['--mantener-corte']).length===0);
chk('una opcion inventada se caza', M.opcionesDesconocidas(['--restasi=X']).length===1,
    JSON.stringify(M.opcionesDesconocidas(['--restasi=X'])));
chk('un typo se caza', M.opcionesDesconocidas(['--incluir=X'])[0]==='--incluir=X');
// un prefijo de una opcion valida NO es la opcion valida
// una opcion que EXIGE valor, escrita sin valor, no es valida: caeria al
// default y la corrida mediria otra cosa de la que se pidio
chk('una opcion con valor escrita sin valor se caza', M.opcionesDesconocidas(['--mes']).length===1,
    JSON.stringify(M.opcionesDesconocidas(['--mes'])));
chk('pero una bandera sin valor si es valida', M.opcionesDesconocidas(['--mantener-corte']).length===0);
chk('y una bandera con valor se tolera', M.opcionesDesconocidas(['--mantener-corte=1']).length===0);
chk('BANDERAS no se mezcla con OPCIONES', M.OPCIONES.indexOf('mantener-corte')<0 && M.BANDERAS.indexOf('mantener-corte')>=0);
chk('lo que no empieza con -- se ignora', M.opcionesDesconocidas(['2026-09','archivo.json']).length===0);
chk('lista vacia', M.opcionesDesconocidas([]).length===0 && M.opcionesDesconocidas(null).length===0);
chk('varias a la vez', M.opcionesDesconocidas(['--mes=1','--xx','--yy=2']).length===2);
chk('se puede pasar otra lista de validas', M.opcionesDesconocidas(['--foo=1'],['foo']).length===0);
chk('OPCIONES incluye resta-si', M.OPCIONES.indexOf('resta-si')>=0);
// la trampa que motivo todo: --resta-si NO debe confundirse con --resta
chk('--resta-si no se lee como --resta', M.opcionesDesconocidas(['--resta-si=A=B'],['resta']).length===1,
    JSON.stringify(M.opcionesDesconocidas(['--resta-si=A=B'],['resta'])));

// ── la pregunta del signo ──────────────────────────────────────────────────
console.log('\n— netosPorTarifa: el desglose sobre el que se busca el signo —');
const bk=(clave,tarifa,concepto,cant,uf)=>[clave,{clave,tarifa,concepto,cant,uf,filas:1}];
const rpDe=(...bs)=>{ let c=0,u=0; for(const b of bs){c+=b[1].cant;u+=b[1].uf;}
  return {cant:c,uf:u,filas:bs.length,tarifas:new Map(bs)}; };
let nt=M.netosPorTarifa(rpDe(bk('0.053 TRANSFERENCIA',0.053,'TRANSFERENCIA',354,18.762),
                             bk('0.03376 TRANSFERENCIA',0.03376,'TRANSFERENCIA',82,2.76832)));
chk('devuelve un elemento por casillero', nt.length===2, String(nt.length));
chk('ordena por UF en valor absoluto', nt[0].clave.indexOf('0.053')===0, nt[0].clave);
chk('conserva tarifa y concepto', nt[0].tarifa===0.053&&nt[0].concepto==='TRANSFERENCIA', JSON.stringify(nt[0]));
// un casillero en cero no cambia ninguna suma, pero SI duplica las
// combinaciones que calzan: dejarlo haria que todo saliera "ambiguo"
chk('el casillero en cero se descarta',
    M.netosPorTarifa(rpDe(bk('a',0.05,'T',10,0.5),bk('b',0.02,'T',0,0))).length===1);
chk('cero en UF pero no en pallets se conserva',
    M.netosPorTarifa(rpDe(bk('a',0,'T',10,0))).length===1);
chk('periodo sin tarifas', M.netosPorTarifa({cant:0,uf:0}).length===0);
chk('periodo ausente', M.netosPorTarifa(undefined).length===0 && M.netosPorTarifa(null).length===0);

console.log('\n— combinacionDeSignos: que signos reproducen la OV —');
const C=(netos,uf,cant,opt)=>M.combinacionDeSignos(netos,uf,cant,opt);
const n2=(a,b)=>[{clave:'A',tarifa:0.1,cant:a,uf:a*0.1},{clave:'B',tarifa:0.2,cant:b,uf:b*0.2}];
chk('la suma directa calza y no inventa inversiones',
    C(n2(10,5),10*0.1+5*0.2,15).veredicto==='calza');
chk('y no devuelve tarifas invertidas', C(n2(10,5),2,15).invertidas.length===0);
// la inversion: lo que se encontro en QUINTA
let rS=C([{clave:'T',tarifa:0.053,cant:354,uf:18.762},
         {clave:'C',tarifa:0.053,cant:-233,uf:-12.349},
         {clave:'t',tarifa:0.03376,cant:82,uf:2.76832},
         {clave:'c',tarifa:0.03376,cant:-61,uf:-2.05936}], 30.40207, 566);
chk('encuentra la inversion de QUINTA semana 1', rS.veredicto==='credito cobrado', rS.veredicto);
chk('y dice cuanto se dio vuelta', Math.abs(rS.subtotalUF+11.64004)<1e-4, String(rS.subtotalUF));
chk('el subtotal invertido explica la diferencia',
    Math.abs(2*Math.abs(rS.subtotalUF)-23.28011)<1e-3, String(2*Math.abs(rS.subtotalUF)));
// LAS DOS condiciones: una sola no prueba nada, porque con suficientes
// casilleros casi cualquier monto se puede armar
chk('exige que calcen tambien los pallets',
    C(n2(10,5),2,999).veredicto==='sin explicacion', C(n2(10,5),2,999).veredicto);
chk('y exige que calcen tambien las UF', C(n2(10,5),999,15).veredicto!=='calza');
chk('nada calza → se declara', C([{clave:'A',tarifa:0.1,cant:10,uf:1}],0.7,7).veredicto==='sin explicacion');
// direccion contraria: un cargo convertido en abono no es lo mismo y no se suma
rS=C([{clave:'A',tarifa:0.05,cant:100,uf:5},{clave:'B',tarifa:0.05,cant:10,uf:0.5}],-4.5,-90);
chk('un cargo acreditado se clasifica aparte', rS.veredicto==='cargo acreditado', rS.veredicto);
chk('y su subtotal es positivo', rS.subtotalUF>0, String(rS.subtotalUF));
// dos combinaciones igual de simples no prueban ninguna
rS=C([{clave:'A',tarifa:0.1,cant:5,uf:0.5},{clave:'B',tarifa:0.1,cant:5,uf:0.5},
      {clave:'C',tarifa:0.1,cant:100,uf:10}],10,100);
chk('dos combinaciones empatadas → ambiguo', rS.veredicto==='ambiguo', rS.veredicto);
chk('y no se queda con ninguna', rS.invertidas.length===0);
chk('ambiguo dice cuantas calzan', rS.combinaciones===2, String(rS.combinaciones));
// cantidad igual y UF distinta NO es un signo dado vuelta: son los mismos
// pallets a otro precio, y se mide contra el contrato
rS=C(n2(10,5),2.5,15);
chk('misma cantidad y otro precio se clasifica aparte', rS.veredicto==='precio distinto', rS.veredicto);
chk('y no se le inventa una inversion', rS.invertidas.length===0&&rS.flips===0);
chk('si tampoco calza la cantidad queda sin explicacion',
    C(n2(10,5),2.5,99).veredicto==='sin explicacion', C(n2(10,5),2.5,99).veredicto);
// LESAFFRE 07..13-09: cero pallets de diferencia y 0,12476 UF
chk('el caso real de LESAFFRE',
    C([{clave:'0.03372 T',tarifa:0.03372,concepto:'T',cant:27,uf:0.74690}],0.87166,27).veredicto==='precio distinto');
// la OV sin ninguna linea para el cliente-semana es otra cosa, y va ANTES de
// buscar signos para que ningun subconjunto que sume cero invente una inversion
rS=C([{clave:'A',tarifa:0.034,cant:536,uf:18.19720}],0,0);
chk('sin linea de OV se dice asi', rS.veredicto==='sin linea de OV', rS.veredicto);
chk('y no como una inversion', rS.invertidas.length===0);
chk('un subconjunto que suma cero no inventa inversion con la OV vacia',
    C([{clave:'A',tarifa:0.1,cant:10,uf:1},{clave:'B',tarifa:0.1,cant:-10,uf:-1},
       {clave:'C',tarifa:0.1,cant:7,uf:0.7}],0,0).veredicto==='sin linea de OV');
chk('pero si los dos lados estan en cero, calza', C([],0,0).veredicto==='calza');

// la mas simple gana cuando NO hay empate
rS=C([{clave:'A',tarifa:0.1,cant:10,uf:1},{clave:'B',tarifa:0.1,cant:4,uf:0.4},
     {clave:'C',tarifa:0.1,cant:-4,uf:-0.4}],-1,-10);
chk('elige la combinacion con menos inversiones', rS.flips===1, String(rS.flips));
chk('y es la que corresponde', rS.invertidas.length===1&&rS.invertidas[0].clave==='A', JSON.stringify(rS.invertidas));
// casos borde
chk('sin casilleros y OV en cero → calza', C([],0,0).veredicto==='calza');
chk('sin casilleros y OV con monto → sin movimientos', C([],5,10).veredicto==='sin movimientos');
chk('netos nulo no revienta', C(null,0,0).veredicto==='calza');
const muchos=[]; for(let i=0;i<13;i++) muchos.push({clave:'k'+i,tarifa:0.01,cant:i+1,uf:(i+1)*0.01});
chk('trece casilleros se declaran en vez de adivinarse',
    C(muchos,999,999).veredicto==='demasiadas tarifas', C(muchos,999,999).veredicto);
chk('doce todavia se calculan', C(muchos.slice(0,12),999,999).veredicto==='sin explicacion');
// tolerancia: el TC viene redondeado, asi que la OV nunca da el decimo decimal
chk('un desvio de 1e-5 UF sigue calzando', C(n2(10,5),2.00001,15).veredicto==='calza');
chk('un desvio de 0,01 UF no', C(n2(10,5),2.01,15).veredicto!=='calza', C(n2(10,5),2.01,15).veredicto);
chk('se puede apretar la tolerancia', C(n2(10,5),2.00001,15,{tolUF:1e-9}).veredicto!=='calza');

// QUINTA entera: las cinco semanas, con los numeros de la corrida real
console.log('\n— QUINTA: las cinco semanas reales —');
const semana=(p53,n53,p33,n33)=>[
  {clave:'0.053 TRANSFERENCIA',tarifa:0.053,concepto:'TRANSFERENCIA',cant:p53,uf:p53*0.053},
  {clave:'0.053 CONF_TRANSF',tarifa:0.053,concepto:'CONF_TRANSF',cant:-n53,uf:-n53*0.053},
  {clave:'0.03376 TRANSFERENCIA',tarifa:0.03376,concepto:'TRANSFERENCIA',cant:p33,uf:p33*0.03376},
  {clave:'0.03376 CONF_TRANSF',tarifa:0.03376,concepto:'CONF_TRANSF',cant:-n33,uf:-n33*0.03376}];
const QUINTA=[
  {s:semana(354,233,82,61), ovUF:18.76201+11.64006, ovCant:354+212, esp:'credito cobrado'},
  {s:semana(265,141,97,50), ovUF:14.04500+ 5.88628, ovCant:265+ 94, esp:'credito cobrado'},
  {s:semana(265,398,67, 5), ovUF:14.04500+19.00087, ovCant:265+336, esp:'credito cobrado'},
  {s:semana(325,269,90,18), ovUF:17.22497+11.82629, ovCant:325+197, esp:'credito cobrado'},
  {s:semana(346, 23,87,38), ovUF:18.33798+ 0.43525, ovCant:346+ 26, esp:'calza'}];
let sobre=0, aciertos=0;
for (let i=0;i<QUINTA.length;i++) {
  const q=QUINTA[i], v=C(q.s,q.ovUF,q.ovCant);
  if (v.veredicto===q.esp) aciertos++;
  else console.log('      semana '+(i+1)+' dio "'+v.veredicto+'" y se esperaba "'+q.esp+'"');
  let nuestro=0; for (const b of q.s) nuestro+=b.uf;
  if (v.veredicto==='credito cobrado') sobre+=q.ovUF-nuestro;
}
chk('las cinco semanas dan el veredicto esperado', aciertos===5, aciertos+'/5');
chk('la semana en que el neteo dio positivo calza sin invertir nada',
    C(QUINTA[4].s,QUINTA[4].ovUF,QUINTA[4].ovCant).flips===0);
chk('lo cobrado de mas suma 96,70696 UF', Math.abs(sobre-96.70696)<0.001, sobre.toFixed(5));

console.log('\n— agregarNuestro: el desglose por (tarifa, concepto) —');
nu=M.agregarNuestro([filaT({DocEntry:1,Quantity:354,U_HX_RD_TarifaCli:0.053}),
                     filaT({DocEntry:2,Quantity:233,U_HX_RD_TarifaCli:0.053,U_HX_RD_TransType:'CONF_TRANSF'})],
                    maestroT,PER,'DocDate',
                    {conceptos:['TRANSFERENCIA'],resta:['CONF_TRANSF'],servicios:['Transferencias']});
const rpq=nu.porCliente.get('C1').periodos.get('2026-09-07..2026-09-13');
chk('el periodo trae el desglose', !!rpq && rpq.tarifas instanceof Map, JSON.stringify(rpq&&[...rpq.tarifas.keys()]));
chk('misma tarifa y distinto concepto son DOS casilleros', rpq.tarifas.size===2, String(rpq.tarifas.size));
chk('el movimiento entra en positivo', (rpq.tarifas.get('0.053 TRANSFERENCIA')||{}).cant===354);
chk('y la confirmacion en negativo', (rpq.tarifas.get('0.053 CONF_TRANSF')||{}).cant===-233);
chk('el neto del periodo no cambia', rpq.cant===121, String(rpq.cant));
chk('los casilleros suman el neto del periodo',
    [...rpq.tarifas.values()].reduce((a,b)=>a+b.cant,0)===rpq.cant);
chk('una fila sin tarifa tiene su propio casillero',
    M.agregarNuestro([filaT({U_HX_RD_TarifaCli:null})],maestroT,PER,'DocDate',
      {conceptos:['TRANSFERENCIA'],servicios:['Transferencias']})
     .porCliente.get('C1').periodos.get('2026-09-07..2026-09-13').tarifas.has('(sin tarifa) TRANSFERENCIA'));

console.log('\n— analisisSignos —');
const nuM=new Map([['C1',{nom:'UNO',cod:'C1',periodos:new Map([
  ['2026-09-07..2026-09-13',rpDe(bk('a',0.05,'T',100,5),bk('b',0.05,'C',-40,-2))],
  [M.AMBIGUO,rpDe(bk('a',0.05,'T',999,49.95))]])}]]);
const ovM=new Map([['C1',{nom:'UNO',cod:'C1',periodos:new Map([
  ['2026-09-07..2026-09-13',{cant:140,uf:7}]])}]]);
const anS=M.analisisSignos(nuM,ovM);
chk('una fila por cliente y periodo comparable', anS.length===1, String(anS.length));
chk('deja fuera el casillero ambiguo', anS.every(x=>x.periodo!==M.AMBIGUO));
chk('encuentra la inversion', anS[0].veredicto==='credito cobrado', anS[0].veredicto);
chk('informa la diferencia en UF', Math.abs(anS[0].difUF-4)<1e-9, String(anS[0].difUF));
chk('y en pallets', anS[0].difCant===80, String(anS[0].difCant));
// un delta impar NO puede venir de un signo dado vuelta: es la corroboracion
// independiente, y tiene que viajar en el resultado
chk('marca el delta par', anS[0].par===true);
// un delta IMPAR no puede venir de un signo dado vuelta, y por eso la marca
// solo sirve si tambien sabe decir que no
chk('y marca el delta impar',
    M.analisisSignos(new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([['p1',rpDe(bk('a',0.05,'T',100,5))]])}]]),
      new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([['p1',{cant:107,uf:5.35}]])}]]))[0].par===false);
chk('un cliente que solo esta de un lado no entra',
    M.analisisSignos(nuM,new Map()).length===0);
chk('un periodo que solo tiene OV se mira igual',
    M.analisisSignos(new Map([['C1',{nom:'UNO',cod:'C1',periodos:new Map()}]]),ovM)[0].veredicto==='sin movimientos');
chk('ordena por diferencia descendente',
    M.analisisSignos(new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([
      ['p1',rpDe(bk('a',0.05,'T',10,0.5))],['p2',rpDe(bk('a',0.05,'T',10,0.5))]])}]]),
      new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([
      ['p1',{cant:10,uf:0.6}],['p2',{cant:10,uf:5}]])}]]))[0].periodo==='p2');
chk('por-tarifa es bandera, no opcion con valor',
    M.BANDERAS.indexOf('por-tarifa')>=0 && M.OPCIONES.indexOf('por-tarifa')<0);
chk('--por-tarifa no se rechaza', M.opcionesDesconocidas(['--por-tarifa']).length===0);
// si los casilleros y el total del periodo dejaran de ser la misma suma, el
// renglon probaria una cosa y mostraria otra: eso tiene que detenerse, no pasar
const roto=new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([
  ['p1',{cant:999,uf:49.95,filas:1,tarifas:new Map([['a',{clave:'a',tarifa:0.05,concepto:'T',cant:100,uf:5}]])}]])}]]);
chk('desglose que no cuadra con el total se declara',
    M.analisisSignos(roto,new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([['p1',{cant:100,uf:5}]])}]]))[0]
      .veredicto==='desglose inconsistente');
chk('y cuando cuadra no se declara',
    M.analisisSignos(new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([['p1',rpDe(bk('a',0.05,'T',100,5))]])}]]),
      new Map([['C1',{nom:'U',cod:'C1',periodos:new Map([['p1',{cant:100,uf:5}]])}]]))[0].veredicto==='calza');

console.log('\n— resolverDuplicadas: dos OV para el mismo cliente y el mismo periodo —');
// la forma real de agosto: el lote semanal emitido dos veces, el segundo
// documento exactamente en DocNum + 58
let PD=M.periodosPorCliente([ovp('2026-09-07','2026-09-13',{DocNum:11960}),
                             ovp('2026-09-07','2026-09-13',{DocNum:12018})],'2026-09',['2026-09']).porCliente;
let dp=M.resolverDuplicadas([ovp('2026-09-07','2026-09-13',{DocNum:11960}),
                             ovp('2026-09-07','2026-09-13',{DocNum:12018})],PD);
chk('caza la celda duplicada', dp.length===1, String(dp.length));
chk('dice cuantas OV eran', dp[0].n===2, String(dp[0].n));
chk('y cuales, ordenadas', dp[0].docNums.join(',')==='11960,12018', dp[0].docNums.join(','));
chk('nombra cliente y periodo', dp[0].cod==='C1'&&dp[0].periodo==='2026-09-07..2026-09-13', JSON.stringify(dp[0]));
// LO IMPORTANTE: la celda sale del universo, que es lo que evita el doble
chk('saca el periodo de usables', PD.get('C1').usables.size===0,
    JSON.stringify([...PD.get('C1').usables.keys()]));
// una sola OV por periodo no se toca
PD=M.periodosPorCliente([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],'2026-09',['2026-09']).porCliente;
chk('una OV por periodo no se declara',
    M.resolverDuplicadas([ovp('2026-09-07','2026-09-13'),ovp('2026-09-14','2026-09-20')],PD).length===0);
chk('y los dos periodos siguen usables', PD.get('C1').usables.size===2);
// duplicada en UNA semana no debe arrastrar la otra
const DOCS=[ovp('2026-09-07','2026-09-13',{DocNum:1}),ovp('2026-09-07','2026-09-13',{DocNum:2}),
            ovp('2026-09-14','2026-09-20',{DocNum:3})];
PD=M.periodosPorCliente(DOCS,'2026-09',['2026-09']).porCliente;
dp=M.resolverDuplicadas(DOCS,PD);
chk('solo saca la semana duplicada', dp.length===1 && PD.get('C1').usables.size===1 &&
    PD.get('C1').usables.has('2026-09-14..2026-09-20'), JSON.stringify([...PD.get('C1').usables.keys()]));
// dos clientes, uno duplicado y el otro no
const DOS=[ovp('2026-09-07','2026-09-13',{CardCode:'A',DocNum:1}),
           ovp('2026-09-07','2026-09-13',{CardCode:'A',DocNum:2}),
           ovp('2026-09-07','2026-09-13',{CardCode:'B',DocNum:3})];
PD=M.periodosPorCliente(DOS,'2026-09',['2026-09']).porCliente;
dp=M.resolverDuplicadas(DOS,PD);
chk('no castiga al cliente que esta bien', dp.length===1 && dp[0].cod==='A' &&
    PD.get('B').usables.size===1, JSON.stringify(dp));
// tres OV en la misma celda
const TRES=[ovp('2026-09-07','2026-09-13',{DocNum:1}),ovp('2026-09-07','2026-09-13',{DocNum:2}),
            ovp('2026-09-07','2026-09-13',{DocNum:3})];
PD=M.periodosPorCliente(TRES,'2026-09',['2026-09']).porCliente;
chk('cuenta tres', M.resolverDuplicadas(TRES,PD)[0].n===3);
// una OV de un periodo que NO esta en el universo no cuenta como duplicada
PD=M.periodosPorCliente([ovp('2026-09-07','2026-09-13')],'2026-09',['2026-09']).porCliente;
chk('una OV fuera del universo no se mezcla',
    M.resolverDuplicadas([ovp('2026-09-07','2026-09-13'),ovp('2026-11-02','2026-11-08'),
                          ovp('2026-11-02','2026-11-08')],PD).length===0);
chk('una OV sin periodo legible se ignora',
    M.resolverDuplicadas([Object.assign(ovp('2026-09-07','2026-09-13'),{Comments:'x',U_HX_PeriodoDesde:null,U_HX_PeriodoHasta:null}),
                          ovp('2026-09-07','2026-09-13')],
      M.periodosPorCliente([ovp('2026-09-07','2026-09-13')],'2026-09',['2026-09']).porCliente).length===0);
chk('una OV de un cliente que no esta en el universo se ignora',
    M.resolverDuplicadas([ovp('2026-09-07','2026-09-13',{CardCode:'ZZ'}),ovp('2026-09-07','2026-09-13',{CardCode:'ZZ'})],
      M.periodosPorCliente([ovp('2026-09-07','2026-09-13')],'2026-09',['2026-09']).porCliente).length===0);
chk('sin documentos', M.resolverDuplicadas([],new Map()).length===0);

console.log('\n— informeDuplicadas —');
chk('sin duplicadas no dice nada', M.informeDuplicadas([],25).length===0 &&
    M.informeDuplicadas(null,25).length===0);
let DL=M.informeDuplicadas([{cod:'C77961510-3',periodo:'2026-07-27..2026-08-02',n:2,docNums:[12001,12059]},
                            {cod:'C91438000-6',periodo:'2026-07-27..2026-08-02',n:2,docNums:[11960,12018]},
                            {cod:'C76773020-9',periodo:'2026-08-24..2026-08-30',n:3,docNums:[12319,12378,12400]}],25);
let DT=DL.join('\n');
chk('cuenta celdas y clientes', DT.indexOf('3 celdas · 3 clientes')>=0, DT);
chk('agrupa por periodo', DT.indexOf('2026-07-27..2026-08-02      2 clientes con mas de una OV      4 OV en total')>=0, DT);
chk('lista los DocNum', DT.indexOf('12001, 12059')>=0 && DT.indexOf('12319, 12378, 12400')>=0, DT);
chk('dice que quedan fuera del total', DT.indexOf('NO')>=0 && DT.indexOf('FUERA de la comparacion')>=0, DT);
chk('ofrece la bandera para volver atras', DT.indexOf('--mantener-duplicadas')>=0);
chk('el tope recorta y lo dice',
    M.informeDuplicadas(Array.from({length:9},(_,i)=>({cod:'C'+i,periodo:'p',n:2,docNums:[1,2]})),3)
     .join('\n').indexOf('y 6 celdas mas')>=0);
chk('mantener-duplicadas es bandera', M.BANDERAS.indexOf('mantener-duplicadas')>=0 &&
    M.OPCIONES.indexOf('mantener-duplicadas')<0);
chk('--mantener-duplicadas no se rechaza', M.opcionesDesconocidas(['--mantener-duplicadas']).length===0);

console.log('\n— avisoBlobsOV: un blob que falta no puede leerse en silencio —');
chk('sin faltantes no dice nada', M.avisoBlobsOV('2026-09',[]).length===0 &&
    M.avisoBlobsOV('2026-09',null).length===0);
let AV=M.avisoBlobsOV('2026-08',['2026-07','2026-08']).join('\n');
chk('nombra los meses que faltan', AV.indexOf('2026-07, 2026-08')>=0, AV);
chk('el mes auditado es grave y lo dice', AV.indexOf('NO es el mes completo')>=0, AV);
chk('el mes anterior se separa', AV.indexOf('solo la semana que entra cruzando')>=0, AV);
AV=M.avisoBlobsOV('2026-08',['2026-07']).join('\n');
chk('faltando solo el anterior no se exagera', AV.indexOf('NO es el mes completo')<0, AV);
chk('pero igual avisa', AV.indexOf('OJO')>=0);
chk('el mes siguiente tambien es grave (ahi se emite la OV de la ultima semana)',
    M.avisoBlobsOV('2026-08',['2026-09']).join('\n').indexOf('NO es el mes completo')>=0);

console.log('\n— informeSignos: el informe se arma sin tocar produccion —');
const sigOK=[{cod:'C1',nom:'UNO',periodo:'p1',nuestroUF:5,nuestroCant:100,ovUF:5,ovCant:100,
              difUF:0,difCant:0,tarifas:1,veredicto:'calza',invertidas:[],flips:0,par:true}];
let LI=M.informeSignos(sigOK,25);
chk('devuelve lineas, no imprime', Array.isArray(LI)&&LI.every(x=>typeof x==='string'));
chk('cuando todo calza lo dice', LI.join('\n').indexOf('Todas las semanas calzan')>=0);
chk('y cuenta los veredictos', LI.join('\n').indexOf('calza 1')>=0, LI.join(' | '));
const sigMal=[{cod:'C1',nom:'QUINTA S.A.',periodo:'2026-09-14..2026-09-20',nuestroUF:-4.95588,nuestroCant:-71,
               ovUF:33.04587,ovCant:601,difUF:38.00175,difCant:672,tarifas:4,veredicto:'credito cobrado',
               invertidas:[{clave:'0.053 CONF_TRANSF',cant:-398,uf:-21.094}],flips:1,subtotalUF:-19.00088,par:true},
              {cod:'C2',nom:'OTRO',periodo:'p9',nuestroUF:1,nuestroCant:10,ovUF:2,ovCant:21,
               difUF:1,difCant:11,tarifas:2,veredicto:'sin explicacion',invertidas:[],flips:0,par:false}];
LI=M.informeSignos(sigMal,25); const TXT=LI.join('\n');
chk('lista la semana invertida', TXT.indexOf('QUINTA S.A.')>=0);
chk('muestra cuanto se dio vuelta', TXT.indexOf('-19,00088')>=0, TXT);
chk('suma lo cobrado de mas por direccion', TXT.indexOf('credito cobrado: 38,00175 UF')>=0, TXT);
chk('no inventa la direccion contraria', TXT.indexOf('cargo acreditado:')<0);
// las dos direcciones son cosas distintas y tienen que aparecer POR SEPARADO:
// sumadas en un neto no significan nada
const TXT2=M.informeSignos(sigMal.concat([{cod:'C3',nom:'TERCERO',periodo:'p3',nuestroUF:10,nuestroCant:100,
  ovUF:-4,ovCant:-40,difUF:-14,difCant:-140,tarifas:2,veredicto:'cargo acreditado',
  invertidas:[{clave:'0.07 T',cant:100,uf:7}],flips:1,subtotalUF:7,par:true}]),25).join('\n');
chk('la direccion contraria se informa en su propia linea',
    TXT2.indexOf('cargo acreditado: -14,00000 UF')>=0, TXT2);
chk('y no se mezcla con la otra',
    TXT2.indexOf('credito cobrado: 38,00175 UF')>=0, TXT2);
chk('cuenta los deltas pares y los impares', TXT.indexOf('pares: 1')>=0 && TXT.indexOf('impares: 1')>=0, TXT);
chk('con un impar no afirma que todos son pares', TXT.indexOf('todos pares')<0);
chk('con todos pares si lo afirma',
    M.informeSignos([sigMal[0]],25).join('\n').indexOf('todos pares')>=0);
chk('el tope recorta y lo dice',
    M.informeSignos(Array.from({length:12},(_,i)=>Object.assign({},sigMal[1],{periodo:'p'+i})),1)
      .join('\n').indexOf('y 8 semanas mas')>=0);
chk('lista vacia no revienta', M.informeSignos([],25).length>0);
// 'precio distinto' lleva su propio total: no es signo ni cantidad
const TXT3=M.informeSignos([{cod:'C1',nom:'LESAFFRE',periodo:'p1',nuestroUF:0.74690,nuestroCant:27,
  ovUF:0.87166,ovCant:27,difUF:0.12476,difCant:0,tarifas:1,veredicto:'precio distinto',
  invertidas:[],flips:0,par:true}],25).join('\n');
chk('el precio distinto se suma aparte', TXT3.indexOf('precio distinto (misma cantidad, otra tarifa): 0,12476 UF')>=0, TXT3);
chk('y no se cuenta como credito cobrado', TXT3.indexOf('credito cobrado:')<0);
chk('sin filas de precio distinto no aparece la linea',
    M.informeSignos(sigOK,25).join('\n').indexOf('precio distinto (')<0);

// ── rangoDeMeses ───────────────────────────────────────────────────────────
console.log('\n— rangoDeMeses: un mes como siempre, o un rango continuo —');
let rm = M.rangoDeMeses('2026-09');
chk('un mes solo va del 1 al ultimo', rm.ini === '2026-09-01' && rm.fin === '2026-09-30');
rm = M.rangoDeMeses('2026-07,2026-10');
chk('varios meses: del primer dia del menor al ultimo del mayor',
    rm.ini === '2026-07-01' && rm.fin === '2026-10-31', JSON.stringify(rm));
chk('y deja adentro los meses del medio', rm.meses.length === 2 && rm.ini < '2026-08-01' && rm.fin > '2026-09-30');
chk('el orden en que vengan no importa',
    JSON.stringify(M.rangoDeMeses('2026-10,2026-07')) === JSON.stringify(M.rangoDeMeses('2026-07,2026-10')));
chk('acepta un arreglo igual que una coma',
    JSON.stringify(M.rangoDeMeses(['2026-07', '2026-10'])) === JSON.stringify(M.rangoDeMeses('2026-07,2026-10')));
chk('febrero bisiesto lo resuelve finDeMes', M.rangoDeMeses('2024-02').fin === '2024-02-29',
    M.rangoDeMeses('2024-02').fin);
chk('lo que no parece un mes se ignora', M.rangoDeMeses('2026-09,basura').meses.length === 1);
chk('sin ningun mes no hay rango', M.rangoDeMeses('basura') === null &&
    M.rangoDeMeses('') === null && M.rangoDeMeses(null) === null);
chk('un mes con espacios alrededor igual sirve', M.rangoDeMeses(' 2026-09 ').ini === '2026-09-01');

console.log('\n— periodosPorCliente con un rango —');
const ovP = (cod, desde, hasta) => ({ CardCode: cod,
  Comments: 'DESDE ' + desde + ' HASTA ' + hasta });
// julio, agosto y septiembre: con el universo en septiembre entra una sola
const DOCS_R = [ovP('C1', '27-07-2026', '02-08-2026'),
                ovP('C1', '24-08-2026', '30-08-2026'),
                ovP('C1', '07-09-2026', '13-09-2026')];
const HAY_R = ['2026-07', '2026-08', '2026-09'];
let pp = M.periodosPorCliente(DOCS_R, '2026-09', HAY_R);
chk('con el universo en un mes entra solo lo de ese mes',
    pp.porCliente.get('C1').usables.size === 1, String(pp.porCliente.get('C1').usables.size));
chk('y lo demas se cuenta como que no solapa', pp.noSolapan === 2, String(pp.noSolapan));
// EL ARREGLO: con el rango abierto entran las tres
pp = M.periodosPorCliente(DOCS_R, '2026-07,2026-09', HAY_R);
chk('con el rango abierto entran las tres', pp.porCliente.get('C1').usables.size === 3,
    String(pp.porCliente.get('C1').usables.size));
chk('y no queda ninguna afuera', pp.noSolapan === 0);
// la semana que cruza el borde del rango igual entra: solapa
pp = M.periodosPorCliente([ovP('C1', '28-09-2026', '04-10-2026')], '2026-09', HAY_R);
chk('la semana que cruza el fin del rango solapa y entra',
    pp.porCliente.get('C1').usables.size + pp.porCliente.get('C1').excluidos.size === 1);
// un universo ilegible no inventa un universo entero
pp = M.periodosPorCliente(DOCS_R, 'basura', HAY_R);
chk('un universo ilegible no deja entrar nada', pp.porCliente.size === 0, String(pp.porCliente.size));

// ── filtrarAnuladas ────────────────────────────────────────────────────────
console.log('\n— filtrarAnuladas: 198 de 1.136 OV estaban anuladas y nadie las sacaba —');
const ovA = (num, cancel, cs) => {
  const o = { DocNum: num, DocTotal: 100 };
  if (cancel !== undefined) o.Cancelled = cancel;
  if (cs !== undefined) o.CancelStatus = cs;
  return o;
};
let fa = M.filtrarAnuladas([ovA(1, 'tNO'), ovA(2, 'tYES'), ovA(3, 'tNO')]);
chk('deja pasar las vivas', fa.vivas.length === 2 && fa.vivas[0].DocNum === 1);
chk('y aparta las anuladas', fa.anuladas.length === 1 && fa.anuladas[0].DocNum === 2);
chk('no inventa ciegas cuando el campo esta', fa.ciegas === 0);
chk('tambien saca por CancelStatus',
    M.filtrarAnuladas([ovA(1, undefined, 'csCancelled')]).anuladas.length === 1);
chk('csNo no es anulada', M.filtrarAnuladas([ovA(1, undefined, 'csNo')]).vivas.length === 1);
// una anulacion EN CURSO todavia no esta anulada: el documento sigue cobrando
chk('csCancellationInProcess todavia no esta anulada',
    M.filtrarAnuladas([ovA(1, undefined, 'csCancellationInProcess')]).vivas.length === 1);
// CancelStatus solo ya alcanza para saber: son dos nombres del mismo dato y
// mirar uno solo deja ciego al blob que trae el otro
chk('con CancelStatus solo no queda ciega',
    M.filtrarAnuladas([ovA(1, undefined, 'csNo')]).ciegas === 0,
    String(M.filtrarAnuladas([ovA(1, undefined, 'csNo')]).ciegas));
// la comparacion es por igualdad: un valor inesperado con Y adentro no es un si
chk('un valor inesperado con Y adentro no anula',
    M.filtrarAnuladas([{ DocNum: 1, Cancelled: 'MAYBE' }]).vivas.length === 1);
chk('esSi compara por igualdad', !M.esSi('MAYBE') && !M.esSi('YA VEREMOS') && M.esSi('tYES'));
// LA QUE NO TRAE EL CAMPO SE CONSERVA. Botarla por las dudas seria perder
// facturacion real; lo que corresponde es avisar para reextraer el blob.
fa = M.filtrarAnuladas([ovA(1), ovA(2, 'tYES')]);
chk('la que no trae el campo se conserva', fa.vivas.length === 1 && fa.vivas[0].DocNum === 1);
chk('y se cuenta aparte para poder avisar', fa.ciegas === 1);
chk('un nulo en la lista no entra a ningun lado',
    M.filtrarAnuladas([null, ovA(1, 'tNO')]).vivas.length === 1);
chk('filtrar de nada', M.filtrarAnuladas(null).vivas.length === 0 &&
    M.filtrarAnuladas([]).anuladas.length === 0);
chk('no se pierde ningun documento por el camino',
    (f => f.vivas.length + f.anuladas.length === 3)(M.filtrarAnuladas([ovA(1,'tNO'), ovA(2,'tYES'), ovA(3)])));

console.log('\n— informeAnuladas: un filtro silencioso es peor que el problema —');
let ia = M.informeAnuladas(M.filtrarAnuladas([ovA(1, 'tNO'), ovA(2, 'tYES')]));
chk('dice cuantas saco', ia.join(' ').indexOf('descartadas: 1') >= 0, JSON.stringify(ia));
chk('y nombra la OV para poder ir a buscarla', ia.join(' ').indexOf('2') >= 0);
chk('sin anuladas no dice nada', M.informeAnuladas(M.filtrarAnuladas([ovA(1, 'tNO')])).length === 0);
ia = M.informeAnuladas(M.filtrarAnuladas([ovA(1)]));
chk('pero si avisa de las que no traen el campo', ia.length === 1 && /reextraer/.test(ia[0]), JSON.stringify(ia));
ia = M.informeAnuladas(M.filtrarAnuladas([ovA(1,'tYES'), ovA(2,'tYES'), ovA(3,'tYES')]), 2);
chk('respeta el tope y dice cuantas mas hay', /y 1 mas/.test(ia.join(' ')), JSON.stringify(ia));
chk('informeAnuladas de nada', M.informeAnuladas(null).length === 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
