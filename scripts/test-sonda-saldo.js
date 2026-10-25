'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const S=require('./sonda-saldo.js');

// ── diasDelPeriodo ─────────────────────────────────────────────────────────
console.log('— diasDelPeriodo: un dia de mas sobre 27.000 pallets son 27.000 pallet-dias —');
let d=S.diasDelPeriodo('2026-09-07..2026-09-13');
chk('una semana son 7 dias', d.length===7, String(d.length));
chk('incluye el primero y el ultimo', d[0]==='2026-09-07'&&d[6]==='2026-09-13', JSON.stringify([d[0],d[6]]));
chk('sin saltos', d.join(',')==='2026-09-07,2026-09-08,2026-09-09,2026-09-10,2026-09-11,2026-09-12,2026-09-13', d.join(','));
chk('un solo dia es un dia', S.diasDelPeriodo('2026-09-07..2026-09-07').length===1);
chk('el corte de fin de mes son 3 dias', S.diasDelPeriodo('2026-09-28..2026-09-30').length===3);
// cruces de mes y de año: el saldo se devenga igual
chk('cruza el mes', S.diasDelPeriodo('2026-08-31..2026-09-06').length===7);
chk('cruza el año', S.diasDelPeriodo('2026-12-28..2027-01-03').length===7);
chk('febrero bisiesto', S.diasDelPeriodo('2028-02-26..2028-03-03').length===7);
// EL CAMBIO DE HORA. Con fechas locales, la semana que cruza el adelanto de
// reloj de Chile devuelve SEIS dias, y seis dias sobre un saldo de 27.000
// pallets son 27.000 pallet-dias que nadie iria a buscar. Se prueba con la
// zona horaria de Chile puesta, no con la del servidor.
const TZ0=process.env.TZ;
process.env.TZ='America/Santiago';
const cruza=S.diasDelPeriodo('2026-09-03..2026-09-09');
chk('la semana del cambio de hora en Chile sigue teniendo 7 dias',
    cruza.length===7, cruza.length+' dias: '+cruza.join(','));
chk('y el ultimo dia es el correcto', cruza[6]==='2026-09-09', cruza[6]);
process.env.TZ=TZ0;
chk('clave al reves no devuelve nada', S.diasDelPeriodo('2026-09-13..2026-09-07').length===0);
chk('clave rota no revienta', S.diasDelPeriodo('xx').length===0 && S.diasDelPeriodo(null).length===0);
// la regex acepta el FORMATO pero no garantiza que la fecha exista
chk('una fecha con formato valido pero imposible no devuelve dias',
    S.diasDelPeriodo('2026-02-30..2026-03-05').length===0,
    String(S.diasDelPeriodo('2026-02-30..2026-03-05').length));

// ── flujosDiarios ──────────────────────────────────────────────────────────
console.log('\n— flujosDiarios: el signo CRUDO de SAP, sin interpretar —');
const fila=o=>Object.assign({CardCode:'C1', CardName:'UNO', DocDate:'2026-09-08',
  U_HX_RD_TransType:'EMISION', Quantity:100}, o);
let fl=S.flujosDiarios([fila({}), fila({Quantity:50}),
                        fila({U_HX_RD_TransType:'CONF_DEVOL', Quantity:30})],'DocDate');
chk('separa por cliente', fl.porCliente.size===1);
chk('separa por concepto', fl.porCliente.get('C1').porConcepto.size===2);
chk('suma el mismo dia', fl.porCliente.get('C1').porConcepto.get('EMISION').get('2026-09-08')===150,
    String(fl.porCliente.get('C1').porConcepto.get('EMISION').get('2026-09-08')));
// NO se invierte ningun signo aca: eso lo decide la resolucion
chk('la confirmacion entra en POSITIVO, sin interpretar',
    fl.porCliente.get('C1').porConcepto.get('CONF_DEVOL').get('2026-09-08')===30);
chk('inventario global de conceptos', fl.conceptos.get('EMISION')===150);
chk('fila sin fecha se cuenta', S.flujosDiarios([fila({DocDate:null})],'DocDate').sinFecha===1);
chk('fila sin concepto se cuenta', S.flujosDiarios([fila({U_HX_RD_TransType:''})],'DocDate').sinConcepto===1);
chk('cantidad no numerica entra como cero, no como NaN',
    S.flujosDiarios([fila({Quantity:'x'})],'DocDate').conceptos.get('EMISION')===0);
chk('dos clientes', S.flujosDiarios([fila({}),fila({CardCode:'C2'})],'DocDate').porCliente.size===2);
chk('lista vacia', S.flujosDiarios([],'DocDate').porCliente.size===0 &&
    S.flujosDiarios(null,'DocDate').porCliente.size===0);

// ── acumuladoEnPeriodo ─────────────────────────────────────────────────────
console.log('\n— acumuladoEnPeriodo: Σ del flujo ACUMULADO, no del flujo —');
const serie=o=>new Map(Object.entries(o));
const SEM=S.diasDelPeriodo('2026-09-07..2026-09-13');
// 10 el lunes y nada mas: el acumulado vale 10 los 7 dias → 70
chk('un movimiento el primer dia cuenta los 7 dias',
    S.acumuladoEnPeriodo(serie({'2026-09-07':10}),SEM)===70,
    String(S.acumuladoEnPeriodo(serie({'2026-09-07':10}),SEM)));
// el mismo movimiento el ultimo dia cuenta UN dia
chk('el ultimo dia cuenta una vez', S.acumuladoEnPeriodo(serie({'2026-09-13':10}),SEM)===10);
chk('el del medio cuenta los dias que quedan',
    S.acumuladoEnPeriodo(serie({'2026-09-10':10}),SEM)===40,
    String(S.acumuladoEnPeriodo(serie({'2026-09-10':10}),SEM)));
// lo anterior al periodo arrastra: es saldo, no flujo
chk('un movimiento ANTERIOR al periodo arrastra los 7 dias',
    S.acumuladoEnPeriodo(serie({'2026-08-01':10}),SEM)===70);
chk('uno posterior no entra', S.acumuladoEnPeriodo(serie({'2026-10-01':10}),SEM)===0);
chk('se acumulan varios', S.acumuladoEnPeriodo(serie({'2026-09-07':10,'2026-09-10':10}),SEM)===110,
    String(S.acumuladoEnPeriodo(serie({'2026-09-07':10,'2026-09-10':10}),SEM)));
chk('negativos restan', S.acumuladoEnPeriodo(serie({'2026-09-07':10,'2026-09-10':-10}),SEM)===30,
    String(S.acumuladoEnPeriodo(serie({'2026-09-07':10,'2026-09-10':-10}),SEM)));
chk('serie vacia', S.acumuladoEnPeriodo(new Map(),SEM)===0 && S.acumuladoEnPeriodo(null,SEM)===0);
chk('sin dias', S.acumuladoEnPeriodo(serie({'2026-09-07':10}),[])===0);
// el orden de insercion de la serie no debe importar
chk('no depende del orden de insercion',
    S.acumuladoEnPeriodo(serie({'2026-09-10':10,'2026-09-07':10}),SEM)===110);

// ── ecuaciones ─────────────────────────────────────────────────────────────
console.log('\n— ecuaciones: S0 se cancela, no hay incognita libre —');
const PERS=['2026-09-07..2026-09-13','2026-09-14..2026-09-20'];
const pd=(a,b)=>new Map([['C1',{periodos:new Map([[PERS[0],{dias:a}],[PERS[1],{dias:b}]])}]]);
let fl2=S.flujosDiarios([fila({DocDate:'2026-09-10',Quantity:10})],'DocDate');
let eq=S.ecuaciones(fl2, pd(1000,1100), PERS, ['EMISION']);
chk('una ecuacion por par consecutivo', eq.ecs.length===1, String(eq.ecs.length));
chk('el objetivo es la diferencia de PD', eq.ecs[0].objetivo===100, String(eq.ecs[0].objetivo));
// el coeficiente es la diferencia de acumulados: semana2 = 70, semana1 = 40
chk('el coeficiente es la diferencia de acumulados', eq.ecs[0].coef[0]===30, String(eq.ecs[0].coef[0]));
chk('trae cliente y periodos', eq.ecs[0].cod==='C1'&&eq.ecs[0].de===PERS[0]&&eq.ecs[0].a===PERS[1]);
// tres periodos → dos pares
chk('tres periodos dan dos ecuaciones',
    S.ecuaciones(fl2, new Map([['C1',{periodos:new Map([[PERS[0],{dias:1}],[PERS[1],{dias:2}],
      ['2026-09-21..2026-09-27',{dias:3}]])}]]), PERS.concat('2026-09-21..2026-09-27'), ['EMISION']).ecs.length===2);
// un par al que le falta un lado NO se inventa
eq=S.ecuaciones(fl2, new Map([['C1',{periodos:new Map([[PERS[0],{dias:1000}]])}]]), PERS, ['EMISION']);
chk('par sin OV se descarta y se cuenta', eq.ecs.length===0 && eq.paresSinOV===1);
chk('cliente sin OV no genera ecuaciones', S.ecuaciones(fl2,new Map(),PERS,['EMISION']).ecs.length===0);
chk('un concepto que el cliente no movio da coeficiente 0',
    S.ecuaciones(fl2,pd(1,2),PERS,['TRASPASO']).ecs[0].coef[0]===0);
chk('el orden de los coeficientes sigue al de conceptos',
    S.ecuaciones(fl2,pd(1,2),PERS,['TRASPASO','EMISION']).ecs[0].coef.join(',')==='0,30');

// ── minimosCuadrados ───────────────────────────────────────────────────────
console.log('\n— minimosCuadrados —');
let r=S.minimosCuadrados([[1,0],[0,1],[1,1]],[2,3,5]);
chk('resuelve un sistema exacto', Math.abs(r.x[0]-2)<1e-9&&Math.abs(r.x[1]-3)<1e-9, JSON.stringify(r.x));
// un concepto que mueve millones y otro que mueve unidades tienen que poder
// resolverse juntos: sin escalar por columna el de unidades se pierde en el
// redondeo de las ecuaciones normales
// un concepto que mueve millones y otro que mueve unidades tienen que
// resolverse JUNTOS: es el caso real, donde SERV-DIAS-PALLET va en cientos de
// miles y algunos conceptos mueven decenas de pallets
for (const e of [2,4,6,8]) {
  const big=Math.pow(10,e);
  const Am=[[big,1],[2*big,-1],[3*big,2],[big,3]];
  const rm=S.minimosCuadrados(Am, Am.map(f=>f[0]+5*f[1]));
  chk('magnitudes 10^'+e+' entre columnas se resuelven juntas',
      rm.x[0]!=null && rm.x[1]!=null && Math.abs(rm.x[0]-1)<1e-6 && Math.abs(rm.x[1]-5)<1e-3,
      JSON.stringify(rm.x));
}
// LO QUE ENCONTRE MUTANDO: dos columnas casi colineales tienen que salir
// DECLARADAS, no con un coeficiente inventado
r=S.minimosCuadrados([[1,1],[2,2],[3,3.0000001]],[2,4,6]);
chk('columnas casi colineales se declaran en vez de inventar un numero',
    r.indeterminadas.length===1, JSON.stringify(r));
chk('y no devuelve un coeficiente absurdo',
    r.x.every(v=>v===null||Math.abs(v)<100), JSON.stringify(r.x));
// una columna de ceros no se puede determinar y tiene que decirse
r=S.minimosCuadrados([[1,0],[2,0],[3,0]],[1,2,3]);
chk('columna muerta → indeterminada', r.indeterminadas.join(',')==='1', JSON.stringify(r.indeterminadas));
chk('y su coeficiente queda null, no 0', r.x[1]===null, String(r.x[1]));
chk('la columna viva igual se resuelve', Math.abs(r.x[0]-1)<1e-9, String(r.x[0]));
// dos columnas identicas son colineales: una queda indeterminada
chk('columnas colineales se declaran',
    S.minimosCuadrados([[1,1],[2,2],[3,3]],[2,4,6]).indeterminadas.length===1,
    JSON.stringify(S.minimosCuadrados([[1,1],[2,2],[3,3]],[2,4,6])));
chk('sin filas no revienta', S.minimosCuadrados([],[]).n===0);
r=S.minimosCuadrados([[1,0],[0,1],[1,1],[1,0]],[1,1,2,1.0000001]);
chk('sobredeterminado consistente', Math.abs(r.x[0]-1)<1e-5&&Math.abs(r.x[1]-1)<1e-5, JSON.stringify(r.x));

// ── pesoDeConceptos ────────────────────────────────────────────────────────
console.log('\n— pesoDeConceptos: lo que casi no mueve no se puede determinar —');
let p=S.pesoDeConceptos([[1000,0.5],[2000,1]],[1000,2000]);
chk('el grande tiene peso', p[0].conPeso===true);
chk('el chico no', p[1].conPeso===false, JSON.stringify(p[1]));
chk('informa cuanto mueve', p[0].maximo===2000 && p[1].maximo===1);
chk('la relacion es contra lo que hay que explicar', Math.abs(p[1].rel-0.0005)<1e-12, String(p[1].rel));
chk('justo en el umbral SI tiene peso',
    S.pesoDeConceptos([[1000,1],[2000,2]],[1000,2000])[1].conPeso===true);
chk('el umbral se puede mover', S.pesoDeConceptos([[1000,0.5],[2000,1]],[1000,2000],1e-9)[1].conPeso===true);
chk('objetivo en cero no da division por cero',
    S.pesoDeConceptos([[1,1]],[0])[0].rel===0);

// ── aEnteros ───────────────────────────────────────────────────────────────
console.log('\n— aEnteros: un concepto suma, resta, o no toca el saldo —');
const pesoTodo=n=>Array.from({length:n},()=>({conPeso:true}));
chk('redondea a 1', S.aEnteros([0.98],pesoTodo(1))[0]===1);
chk('redondea a -1', S.aEnteros([-1.02],pesoTodo(1))[0]===-1);
chk('redondea a 0', S.aEnteros([0.11],pesoTodo(1))[0]===0);
// no existe un concepto que cuente doble
chk('nada queda fuera de {-1,0,1}', S.aEnteros([7,-9],pesoTodo(2)).join(',')==='1,-1');
chk('lo indeterminado queda en 0', S.aEnteros([null],pesoTodo(1))[0]===0);
chk('lo que no tiene peso queda en 0 aunque el ajuste diga 1',
    S.aEnteros([0.99],[{conPeso:false}])[0]===0);

// ── evaluarEnteros ─────────────────────────────────────────────────────────
console.log('\n— evaluarEnteros: el veredicto es reproduccion exacta, no error de ajuste —');
const ec=(obj,coef)=>({cod:'C1',nom:'UNO',de:'a',a:'b',objetivo:obj,coef});
let ev=S.evaluarEnteros([ec(10,[10]),ec(20,[20])],[1]);
chk('todas calzan', ev.calzan===2 && ev.pct===100);
ev=S.evaluarEnteros([ec(10,[10]),ec(20,[5])],[1]);
chk('cuenta las que no', ev.calzan===1 && ev.fallan.length===1);
chk('informa el residuo', ev.fallan[0].residuo===15, String(ev.fallan[0].residuo));
chk('y lo que daba el modelo', ev.fallan[0].modelo===5);
chk('ordena por residuo', S.evaluarEnteros([ec(2,[1]),ec(100,[1])],[1]).fallan[0].objetivo===100);
// medio pallet-dia de redondeo no es un descalce; 10 si
chk('tolera el redondeo', S.evaluarEnteros([ec(10.4,[10])],[1]).calzan===1);
chk('no tolera una diferencia real', S.evaluarEnteros([ec(20,[10])],[1]).calzan===0);
chk('la tolerancia se puede apretar', S.evaluarEnteros([ec(10.4,[10])],[1],0.01).calzan===0);
chk('varios conceptos se combinan',
    S.evaluarEnteros([ec(5,[10,5])],[1,-1]).calzan===1, JSON.stringify(S.evaluarEnteros([ec(5,[10,5])],[1,-1])));
chk('signo cero ignora el concepto', S.evaluarEnteros([ec(10,[10,999])],[1,0]).calzan===1);
chk('sin ecuaciones el pct es 0 y no NaN', S.evaluarEnteros([],[1]).pct===0);

// ── estimarS0 ──────────────────────────────────────────────────────────────
console.log('\n— estimarS0: cinco lecturas independientes del mismo numero —');
// saldo constante 100, sin movimientos: cada semana 700 pallet-dias
const sinMov=S.flujosDiarios([],'DocDate');
sinMov.porCliente.set('C1',{cod:'C1',nom:'UNO',porConcepto:new Map()});
let s0=S.estimarS0(sinMov, pd(700,700), PERS, ['EMISION'], [1]);
chk('despeja el saldo', s0[0].promedio===100, String(s0[0].promedio));
chk('las dos estimaciones coinciden', s0[0].rango===0 && s0[0].dispersion===0);
chk('informa cuantas estimaciones uso', s0[0].n===2);
// con un movimiento: 10 pallets el 10-09 → semana2 acumula 30 mas que semana1
let s0b=S.estimarS0(fl2, pd(740,770), PERS, ['EMISION'], [1]);
chk('con movimiento sigue dando un solo S0',
    Math.abs(s0b[0].min-s0b[0].max)<1e-9, JSON.stringify(s0b[0].estimaciones));
chk('y el S0 es el saldo ANTES de la ventana',
    Math.abs(s0b[0].promedio-100)<1e-9, String(s0b[0].promedio));
// el signo equivocado parte las estimaciones: es justo lo que tiene que delatar
chk('con el signo al reves las estimaciones se separan',
    S.estimarS0(fl2, pd(740,770), PERS, ['EMISION'], [-1])[0].rango!==0);
chk('ordena por dispersion descendente',
    S.estimarS0(S.flujosDiarios([fila({CardCode:'C1'}),fila({CardCode:'C2'})],'DocDate'),
      new Map([['C1',{periodos:new Map([[PERS[0],{dias:700}],[PERS[1],{dias:700}]])}],
               ['C2',{periodos:new Map([[PERS[0],{dias:700}],[PERS[1],{dias:9999}]])}]]),
      PERS, ['EMISION'], [0])[0].cod==='C2');
chk('cliente sin OV no aparece', S.estimarS0(fl2,new Map(),PERS,['EMISION'],[1]).length===0);
chk('un solo periodo igual estima', S.estimarS0(sinMov, new Map([['C1',{periodos:new Map([[PERS[0],{dias:700}]])}]]),
    [PERS[0]], ['EMISION'], [1])[0].n===1);
// el corte contable son TRES dias: dividir por 7 fijo daria un saldo 2,3 veces
// mas chico y seguiria pareciendo un numero razonable
const CORTE=['2026-09-28..2026-09-30'];
chk('un periodo de 3 dias se divide por 3, no por 7',
    S.estimarS0(sinMov, new Map([['C1',{periodos:new Map([[CORTE[0],{dias:300}]])}]]),
      CORTE, ['EMISION'], [1])[0].promedio===100,
    String(S.estimarS0(sinMov, new Map([['C1',{periodos:new Map([[CORTE[0],{dias:300}]])}]]),
      CORTE, ['EMISION'], [1])[0].promedio));
chk('y el detalle informa cuantos dias uso',
    S.estimarS0(sinMov, new Map([['C1',{periodos:new Map([[CORTE[0],{dias:300}]])}]]),
      CORTE, ['EMISION'], [1])[0].estimaciones[0].dias===3);
chk('S0 en cero no da dispersion infinita',
    S.estimarS0(sinMov, pd(0,0), PERS, ['EMISION'], [1])[0].dispersion===null);

// ── leerSignos ─────────────────────────────────────────────────────────────
console.log('\n— leerSignos —');
let ls=S.leerSignos('EMISION:1,CONF_DEVOL:-1',['CONF_DEVOL','EMISION','TRASPASO']);
chk('respeta el orden de conceptos', ls.signos.join(',')==='-1,1,0', ls.signos.join(','));
chk('sin malos', ls.malos.length===0);
// un concepto inventado NO se ignora: mediria con otra regla de la pedida
chk('un concepto que no existe se devuelve como malo',
    S.leerSignos('FANTASMA:1',['EMISION']).malos.join(',')==='FANTASMA:1');
chk('un valor no numerico tambien', S.leerSignos('EMISION:x',['EMISION']).malos.length===1);
chk('tolera minusculas y espacios', S.leerSignos(' emision : 1 ',['EMISION']).signos[0]===1);
chk('vacio → null', S.leerSignos(null,['EMISION'])===null && S.leerSignos('',['EMISION'])===null);
chk('coma colgando no rompe', S.leerSignos('EMISION:1,',['EMISION']).malos.length===0);

// ── de punta a punta ───────────────────────────────────────────────────────
// La prueba que vale: se arma un mundo con un S0 CONOCIDO y unos flujos
// conocidos, se generan los pallet-dias EXACTAMENTE como dice el modelo, y se
// le pide a la maquinaria que recupere los signos y el saldo sin saberlos.
console.log('\n— de punta a punta: recuperar signos y S0 de un mundo conocido —');
const S0_REAL=1000;
const MOV=[
  {c:'EMISION',    f:'2026-09-09', q:100},
  {c:'EMISION',    f:'2026-09-16', q:200},
  {c:'CONF_DEVOL', f:'2026-09-10', q:50},
  {c:'CONF_DEVOL', f:'2026-09-23', q:300},
  {c:'TRASPASO',   f:'2026-09-11', q:999},   // no mueve el saldo: coeficiente 0
];
const PE=['2026-09-07..2026-09-13','2026-09-14..2026-09-20','2026-09-21..2026-09-27'];
const SIGNO_REAL={EMISION:1, CONF_DEVOL:-1, TRASPASO:0};
function pdReal(periodo){
  let total=0;
  for (const d of S.diasDelPeriodo(periodo)) {
    let saldo=S0_REAL;
    for (const m of MOV) if (m.f<=d) saldo += SIGNO_REAL[m.c]*m.q;
    total+=saldo;
  }
  return total;
}
const filasMov=MOV.map(m=>({CardCode:'CX',CardName:'MUNDO CONOCIDO',DocDate:m.f,
                            U_HX_RD_TransType:m.c,Quantity:m.q}));
const flE=S.flujosDiarios(filasMov,'DocDate');
const concE=[...flE.conceptos.keys()].sort();
const pdE=new Map([['CX',{periodos:new Map(PE.map(k=>[k,{dias:pdReal(k)}]))}]]);
const eqE=S.ecuaciones(flE,pdE,PE,concE);
chk('arma dos ecuaciones con tres periodos', eqE.ecs.length===2, String(eqE.ecs.length));
const coefE=eqE.ecs.map(e=>e.coef), objE=eqE.ecs.map(e=>e.objetivo);
const pesE=S.pesoDeConceptos(coefE,objE);
const crudoE=S.minimosCuadrados(coefE,objE);
const sigE=S.aEnteros(crudoE.x,pesE);
const esperado=concE.map(c=>SIGNO_REAL[c]);
chk('recupera los signos sin que se los digan', sigE.join(',')===esperado.join(','),
    JSON.stringify({concE,sigE,esperado,crudo:crudoE.x}));
const evE=S.evaluarEnteros(eqE.ecs,sigE);
chk('y reproduce las ecuaciones exacto', evE.calzan===evE.total && evE.pct===100, JSON.stringify(evE));
const s0E=S.estimarS0(flE,pdE,PE,concE,sigE);
chk('recupera el S0 que no sabia', Math.abs(s0E[0].promedio-S0_REAL)<1e-9, String(s0E[0].promedio));
chk('y las tres estimaciones coinciden', s0E[0].rango<1e-9, String(s0E[0].rango));
// con un signo mal puesto, todo el andamiaje tiene que delatarlo
const malo=concE.map(c=>c==='CONF_DEVOL'?1:SIGNO_REAL[c]);
chk('un signo mal puesto NO reproduce las ecuaciones', S.evaluarEnteros(eqE.ecs,malo).calzan<evE.total);
chk('y parte las estimaciones de S0', S.estimarS0(flE,pdE,PE,concE,malo)[0].rango>1);
// y si los pallet-dias NO salen del saldo, nada tiene que calzar
const pdFalso=new Map([['CX',{periodos:new Map(PE.map((k,i)=>[k,{dias:[7000,123456,99][i]}]))}]]);
const eqF=S.ecuaciones(flE,pdFalso,PE,concE);
chk('con pallet-dias inventados el modelo no cierra',
    S.evaluarEnteros(eqF.ecs,S.aEnteros(S.minimosCuadrados(eqF.ecs.map(e=>e.coef),
      eqF.ecs.map(e=>e.objetivo)).x,S.pesoDeConceptos(eqF.ecs.map(e=>e.coef),
      eqF.ecs.map(e=>e.objetivo)))).calzan<2);

// ── opciones ───────────────────────────────────────────────────────────────
console.log('\n— opciones —');
const M2=require('./medir-emisiones.js');
chk('--signos y --minpeso son opciones con valor',
    S.OPCIONES.indexOf('signos')>=0 && S.OPCIONES.indexOf('minpeso')>=0);
chk('las banderas heredadas estan', S.BANDERAS.indexOf('mantener-duplicadas')>=0);
chk('una opcion inventada se caza', M2.opcionesDesconocidas(['--signo=x'],S.OPCIONES,S.BANDERAS).length===1);
chk('--signos con dos pares pasa', M2.opcionesDesconocidas(['--signos=A:1,B:-1'],S.OPCIONES,S.BANDERAS).length===0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
