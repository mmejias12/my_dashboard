'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const V=require('./validar-arriendo-bin.js');
const SS=require('./sonda-saldo.js');

// ── mapaDeMaestro ──────────────────────────────────────────────────────────
console.log('— mapaDeMaestro: una ubicacion sin cliente no se reparte, se cuenta —');
const MAE={ubicaciones:[
  {AbsEntry:1, BinCode:'CLIENTES-UBICACIÓN-DE-SISTEMA', IsSystemBin:'tYES', CardCode:null},
  {AbsEntry:5271, CardCode:'C91004000-6', IsSystemBin:'tNO'},
  {AbsEntry:5275, CardCode:'C91438000-6', IsSystemBin:'tNO'},
  {AbsEntry:5276, CardCode:null, IsSystemBin:'tNO'},
  {AbsEntry:5277, CardCode:'C91004000-6', IsSystemBin:true}]};
let m=V.mapaDeMaestro(MAE);
chk('mapea las atribuidas', m.get(5271)==='C91004000-6' && m.get(5275)==='C91438000-6');
chk('deja fuera la de sistema (texto)', !m.has(1));
chk('y la de sistema (booleano)', !m.has(5277));
chk('deja fuera la que no tiene cliente', !m.has(5276));
chk('o sea dos de cinco', m.size===2, String(m.size));
chk('un maestro vacio', V.mapaDeMaestro({ubicaciones:[]}).size===0 && V.mapaDeMaestro(null).size===0);

// ── deltaDiarioPorCliente ──────────────────────────────────────────────────
console.log('\n— deltaDiarioPorCliente —');
const FILAS=[{BinAbsEntry:5271, DocDate:'2026-09-07', delta:-4},
             {BinAbsEntry:5275, DocDate:'2026-09-07', delta:4},
             {BinAbsEntry:5271, DocDate:'2026-09-07', delta:-6},
             {BinAbsEntry:9999, DocDate:'2026-09-08', delta:100},
             {BinAbsEntry:5271, DocDate:'', delta:3}];
let dd=V.deltaDiarioPorCliente(FILAS, m);
chk('acumula por cliente y dia', dd.porCliente.get('C91004000-6').get('2026-09-07')===-10);
chk('cada cliente su serie', dd.porCliente.get('C91438000-6').get('2026-09-07')===4);
chk('lo que no esta en el mapa se cuenta', dd.filasSinMapa===1 && dd.binsSinMapa.size===1);
chk('y se dice cuantos pallets son', dd.palletsSinMapa===100);
// en VALOR ABSOLUTO: una entrada y una salida de la misma magnitud no son
// "cero pallets sin mapa", son doscientos que no sabemos de quien son
chk('los pallets sin mapa se cuentan en valor absoluto, no se compensan',
    V.deltaDiarioPorCliente([{BinAbsEntry:9999,DocDate:'2026-09-08',delta:100},
                             {BinAbsEntry:9998,DocDate:'2026-09-08',delta:-100}], m).palletsSinMapa===200);
chk('la fila sin fecha se cuenta aparte', dd.sinFecha===1);
chk('y no se suma a ningun dia', !dd.porCliente.get('C91004000-6').has(''));
chk('sin mapa todo queda sin atribuir',
    V.deltaDiarioPorCliente(FILAS, new Map()).filasSinMapa===5);
chk('listas vacias', V.deltaDiarioPorCliente([], m).porCliente.size===0 &&
    V.deltaDiarioPorCliente(null, m).filasSinMapa===0);

// ── diasDeVentana ──────────────────────────────────────────────────────────
console.log('\n— diasDeVentana: los dias SIN movimiento tambien se cobran —');
chk('de corrido', V.diasDeVentana('2026-09-07','2026-09-13').length===7);
chk('incluye los dos bordes', V.diasDeVentana('2026-09-07','2026-09-13')[0]==='2026-09-07' &&
    V.diasDeVentana('2026-09-07','2026-09-13')[6]==='2026-09-13');
chk('un solo dia', V.diasDeVentana('2026-09-07','2026-09-07').length===1);
chk('cruza el mes', V.diasDeVentana('2026-09-28','2026-10-04').length===7);
chk('al reves no inventa nada', V.diasDeVentana('2026-09-13','2026-09-07').length===0);
chk('fechas invalidas', V.diasDeVentana('x','y').length===0 && V.diasDeVentana(null,null).length===0);

// ── serieRelativa y acumuladoDePeriodo ─────────────────────────────────────
console.log('\n— serieRelativa: el acumulado arrastra los dias quietos —');
const DIAS=V.diasDeVentana('2026-09-07','2026-09-13');
const DEL=new Map([['2026-09-08',10],['2026-09-11',-4]]);
let sr=V.serieRelativa(DEL, DIAS);
chk('arranca en cero', sr.get('2026-09-07')===0);
chk('suma el dia del movimiento', sr.get('2026-09-08')===10);
chk('y lo ARRASTRA los dias sin movimiento', sr.get('2026-09-09')===10 && sr.get('2026-09-10')===10);
chk('resta cuando sale', sr.get('2026-09-11')===6 && sr.get('2026-09-13')===6);
chk('sin movimientos queda todo en cero',
    [...V.serieRelativa(new Map(), DIAS).values()].every(x=>x===0));
let ac=V.acumuladoDePeriodo(sr, DIAS);
chk('R es la suma de los r de la semana', ac.R===0+10+10+10+6+6+6, String(ac.R));
chk('n son los dias', ac.n===7);
chk('y declara que esta completo', ac.completo===true && ac.faltan===0);
// un periodo a medias daria un R chico y un S0 inventado
let inc=V.acumuladoDePeriodo(sr, V.diasDeVentana('2026-09-11','2026-09-17'));
chk('un periodo que se sale de la ventana NO se declara completo',
    inc.completo===false && inc.faltan===4, JSON.stringify(inc));
chk('sin dias', V.acumuladoDePeriodo(sr, []).completo===false);

// ── s0Implicito y dispersionS0 ─────────────────────────────────────────────
console.log('\n— S0: todos los periodos tienen que dar el MISMO numero —');
chk('despeja S0 de PD = S0*n + R', V.s0Implicito(7*100+48, 48, 7)===100);
chk('con R cero es el promedio', V.s0Implicito(700, 0, 7)===100);
chk('sin dias no despeja', V.s0Implicito(700, 0, 0)===null);
let d1=V.dispersionS0([100,100,100]);
chk('tres periodos de acuerdo: rango cero', d1.rango===0 && d1.dispersion===0);
chk('y el promedio es el valor', d1.promedio===100);
let d2=V.dispersionS0([100,110,90]);
chk('en desacuerdo lo dice', d2.rango===20 && Math.abs(d2.dispersion-0.2)<1e-9);
chk('ignora los nulos', V.dispersionS0([100,null,undefined,100]).n===2);
chk('sin valores no inventa', V.dispersionS0([]).promedio===null && V.dispersionS0(null).n===0);
chk('promedio cero no divide por cero', V.dispersionS0([0,0]).dispersion===null);

// ── predecir ───────────────────────────────────────────────────────────────
console.log('\n— predecir —');
chk('PD = S0*n + R', V.predecir(100,48,7)===748);
chk('sin movimiento es el saldo por los dias', V.predecir(100,0,7)===700);

// ── veredicto ──────────────────────────────────────────────────────────────
console.log('\n— veredicto: la vara es lo que dio contra WAVE —');
chk('en linea con WAVE cierra', V.veredicto({total:100,exactas:43,p1:57}).nivel==='si');
chk('justo en el borde tambien', V.veredicto({total:100,exactas:35,p1:50}).nivel==='si');
chk('un pelo abajo es parcial', V.veredicto({total:100,exactas:34,p1:50}).nivel==='parcial');
chk('pocas exactas pero muchas al 1% sigue siendo parcial, no "si"',
    V.veredicto({total:100,exactas:10,p1:60}).nivel==='parcial');
// y al reves: muchas exactas con pocas al 1% tampoco alcanza. Las DOS condiciones
chk('muchas exactas pero pocas al 1% tampoco es "si"',
    V.veredicto({total:100,exactas:40,p1:45}).nivel==='parcial',
    V.veredicto({total:100,exactas:40,p1:45}).nivel);
chk('muy abajo es que no', V.veredicto({total:100,exactas:1,p1:5}).nivel==='no');
chk('sin celdas no concluye', V.veredicto({total:0}).nivel==='sin datos' && V.veredicto(null).nivel==='sin datos');
chk('el si menciona que es con fuente propia', /fuente propia/.test(V.veredicto({total:100,exactas:50,p1:60}).texto));
chk('el parcial manda a mirar S0 y las ubicaciones sin mapa ANTES de ajustar',
    /antes de ajustar nada/i.test(V.veredicto({total:100,exactas:10,p1:30}).texto));
// el "no" tiene que separar las dos causas, porque llevan a cosas distintas:
// S0 disperso = el modelo esta mal; S0 estable y celdas que no calzan = falta dato
chk('el no distingue las dos causas',
    /dispersion de S0 alta/.test(V.veredicto({total:100,exactas:0,p1:0}).texto) &&
    /falta son movimientos/.test(V.veredicto({total:100,exactas:0,p1:0}).texto),
    V.veredicto({total:100,exactas:0,p1:0}).texto);

// ── de punta a punta: un mundo donde la respuesta se conoce ────────────────
console.log('\n— de punta a punta: saldo conocido, se reconstruye desde los movimientos —');
// El cliente arranca con 1.000 pallets. Mueve +200 el 09-09 y -50 el 09-16.
const S0=1000;
const MOV=[{BinAbsEntry:5271, DocDate:'2026-09-09', delta:200},
           {BinAbsEntry:5271, DocDate:'2026-09-16', delta:-50}];
const P=['2026-09-07..2026-09-13','2026-09-14..2026-09-20','2026-09-21..2026-09-27'];
function pdReal(per){ let t=0;
  for (const d of SS.diasDelPeriodo(per)) { let s=S0;
    for (const mv of MOV) if (mv.DocDate<=d) s+=mv.delta; t+=s; } return t; }
const MAPA2=new Map([[5271,'C1']]);
const dd2=V.deltaDiarioPorCliente(MOV, MAPA2);
const DIAS2=V.diasDeVentana('2026-09-07','2026-09-27');
const SR2=V.serieRelativa(dd2.porCliente.get('C1'), DIAS2);
const celdas=P.map(p=>{ const a=V.acumuladoDePeriodo(SR2, SS.diasDelPeriodo(p));
  return {p, pd:pdReal(p), R:a.R, n:a.n, s0:V.s0Implicito(pdReal(p), a.R, a.n)}; });
chk('los tres periodos estan completos', celdas.every(c=>c.n===7));
chk('los tres despejan el MISMO S0', celdas.every(c=>Math.abs(c.s0-S0)<1e-9),
    JSON.stringify(celdas.map(c=>c.s0)));
chk('la dispersion es cero', V.dispersionS0(celdas.map(c=>c.s0)).rango===0);
// anclando en el primero se predicen los otros dos EXACTO
const anc=celdas[0].s0;
chk('predice el segundo exacto', V.predecir(anc,celdas[1].R,celdas[1].n)===celdas[1].pd);
chk('y el tercero', V.predecir(anc,celdas[2].R,celdas[2].n)===celdas[2].pd);
// y sin ancla: la variacion de PD es la variacion de R
chk('sin ancla, ΔPD = ΔR', (celdas[1].pd-celdas[0].pd)===(celdas[1].R-celdas[0].R));
// si FALTA un movimiento, el S0 deja de coincidir: eso es lo que la sonda caza
const dd3=V.deltaDiarioPorCliente([MOV[0]], MAPA2);
const SR3=V.serieRelativa(dd3.porCliente.get('C1'), DIAS2);
const s0s=P.map(p=>{ const a=V.acumuladoDePeriodo(SR3, SS.diasDelPeriodo(p));
  return V.s0Implicito(pdReal(p), a.R, a.n); });
chk('si falta un movimiento los S0 dejan de coincidir',
    V.dispersionS0(s0s).rango>0, JSON.stringify(s0s));
chk('y el ancla ya no predice', V.predecir(s0s[0], V.acumuladoDePeriodo(SR3,SS.diasDelPeriodo(P[2])).R, 7)!==celdas[2].pd);

// ── cercanos ───────────────────────────────────────────────────────────────
console.log('\n— cercanos: dos S0 que dicen lo mismo —');
chk('identicos concuerdan', V.cercanos(26676, 26676, 0.01));
chk('dentro del 1% concuerdan', V.cercanos(26676, 26800, 0.01));
chk('26.676 contra 850 no', !V.cercanos(26676, 850, 0.01));
chk('los dos en cero concuerdan', V.cercanos(0, 0, 0.01));
chk('cero contra algo no', !V.cercanos(0, 5, 0.01) && !V.cercanos(5, 0, 0.01));
chk('es simetrico', V.cercanos(100, 100.5, 0.01) === V.cercanos(100.5, 100, 0.01));
// el denominador es el MAYOR: con el menor, 100 vs 102 daria 0,0200 y con el
// mayor 0,0196. La tolerancia de 0,0198 parte justo esos dos casos.
chk('el denominador es el mayor, no el menor', V.cercanos(100, 102, 0.0198));
chk('y no el menor', !V.cercanos(100, 102, 0.0195));
chk('el borde de la tolerancia entra', V.cercanos(100, 101, 1 / 101));
chk('negativos iguales concuerdan', V.cercanos(-500, -500, 0.01));
chk('signos opuestos no', !V.cercanos(-100, 100, 0.01));
chk('null y NaN nunca concuerdan',
    !V.cercanos(null, 5, 0.01) && !V.cercanos(NaN, NaN, 0.01) && !V.cercanos(Infinity, 1, 0.01));

// ── mediana ────────────────────────────────────────────────────────────────
console.log('\n— mediana —');
chk('impar', V.mediana([1, 3, 2]) === 2);
chk('par: promedia las dos del medio', V.mediana([1, 2, 3, 4]) === 2.5);
chk('ordena como numero y no como texto', V.mediana([9, 10, 11]) === 10, String(V.mediana([9, 10, 11])));
chk('ignora null y NaN', V.mediana([null, 2, NaN, 4, 6]) === 4);
chk('vacio da null', V.mediana([]) === null && V.mediana(null) === null);
const MUT = [3, 1, 2];
V.mediana(MUT);
chk('no ordena el arreglo que recibe', MUT[0] === 3 && MUT[2] === 2, JSON.stringify(MUT));

// ── consensoS0 ─────────────────────────────────────────────────────────────
console.log('\n— consensoS0: cuales periodos estan de acuerdo, no el promedio —');
let k = V.consensoS0([26676, 26676, 26676, 26676]);
chk('si todos concuerdan no sobra ninguno', k.fuera.length === 0 && k.dentro.length === 4);
chk('y la cobertura es entera', k.cobertura === 1);
// LA FORMA DE QUINTA: el ancla dice una cosa y los otros tres dicen otra.
k = V.consensoS0([850, 26676, 26676, 26676]);
chk('el grupo grande son los tres', JSON.stringify(k.dentro) === '[1,2,3]', JSON.stringify(k.dentro));
chk('y el que sobra es el primero', JSON.stringify(k.fuera) === '[0]');
chk('el valor es el del grupo, no el promedio de todo', k.valor === 26676, String(k.valor));
chk('la cobertura es 3 de 4', k.cobertura === 0.75);
k = V.consensoS0([26676, 26676, 26676, 850]);
chk('tambien lo caza al final', JSON.stringify(k.fuera) === '[3]');
// el valor del grupo es la MEDIANA del grupo: un borde no corre el consenso
// el grupo se elige asimetrico a proposito: su mediana (26.680) y su
// promedio (26.682) son numeros distintos, que es la unica forma de que el
// test note la diferencia.
k = V.consensoS0([1000, 26676, 26680, 26690]);
chk('el valor es la mediana del grupo', k.valor === 26680, String(k.valor));
chk('y no el promedio del grupo', k.valor !== (26676 + 26680 + 26690) / 3);
chk('ni la mediana de todo', k.valor !== (1000 + 26676) / 2);
// empate 2 a 2: gana el grupo del periodo mas temprano, para que no dependa
// del orden en que se recorre
k = V.consensoS0([100, 100, 500, 500]);
chk('el empate se parte por el periodo mas temprano', JSON.stringify(k.dentro) === '[0,1]',
    JSON.stringify(k.dentro));
k = V.consensoS0([null, 26676, 26676, NaN]);
chk('los periodos sin S0 no cuentan', k.n === 2 && JSON.stringify(k.dentro) === '[1,2]');
chk('ni aparecen como discrepantes', k.fuera.length === 0, JSON.stringify(k.fuera));
// la cobertura se mide contra los que TIENEN S0: dos de tres, no dos de cuatro
k = V.consensoS0([null, 100, 100, 500]);
chk('la cobertura descuenta los periodos sin S0', k.cobertura === 2 / 3, String(k.cobertura));
k = V.consensoS0([null, null]);
chk('sin ningun S0 no hay consenso', k.n === 0 && k.valor === null && k.cobertura === null);
chk('con tolerancia amplia todos concuerdan', V.consensoS0([850, 26676], 10).fuera.length === 0);
chk('con la de por defecto no', V.consensoS0([850, 26676]).fuera.length === 1);
chk('la tolerancia por defecto es el 1%', V.TOL_CONSENSO === 0.01);
chk('consensoS0 de nada', V.consensoS0(null).n === 0);

// ── esTramo ────────────────────────────────────────────────────────────────
console.log('\n— esTramo: un tramo seguido del tiempo y no periodos sueltos —');
chk('consecutivos', V.esTramo([1, 2, 3]));
chk('desordenados pero consecutivos', V.esTramo([3, 1, 2]));
chk('con un hueco no', !V.esTramo([0, 2]));
chk('uno solo si', V.esTramo([0]));
chk('vacio no', !V.esTramo([]) && !V.esTramo(null));
const TR = [3, 1, 2];
V.esTramo(TR);
chk('no ordena el arreglo que recibe', TR[0] === 3, JSON.stringify(TR));

// ── clasificarCliente ──────────────────────────────────────────────────────
console.log('\n— clasificarCliente: en que se parte el que no calza —');
const cel = (p, s0) => ({ periodo: p, s0, R: 0, n: 7, pd: 0 });
let cl = V.clasificarCliente([cel('p1', 26676), cel('p2', 26676), cel('p3', 26676)]);
chk('todos de acuerdo: estable', cl.clase === 'estable', cl.clase);
chk('y no nombra periodos que se salgan', cl.periodos.length === 0);
// LA FORMA DE QUINTA
cl = V.clasificarCliente([cel('p1', 850), cel('p2', 26676), cel('p3', 26676), cel('p4', 26676)]);
chk('solo el primero discrepa: ancla aislada', cl.clase === 'ancla aislada', cl.clase);
chk('y dice cual periodo es', JSON.stringify(cl.periodos) === '["p1"]');
chk('el consenso trae el S0 de verdad', cl.consenso.valor === 26676);
// un tramo al final es otra cosa: ahi hubo un cambio de saldo que no se vio
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 100), cel('p3', 900), cel('p4', 900)]);
chk('un tramo seguido al final: quiebre', cl.clase === 'quiebre', cl.clase);
chk('y dice donde se parte', cl.corte === 'p3', String(cl.corte));
// UN SOLO periodo fuera, pero no el ancla: tampoco es ancla aislada. Lo que
// hace especial al primero es que es el que la prueba estricta usa de ancla.
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 100), cel('p3', 900)]);
chk('un periodo solo al final no es ancla aislada', cl.clase === 'quiebre', cl.clase);
chk('y el corte es ese', cl.corte === 'p3', String(cl.corte));
// un tramo que EMPIEZA en el ancla y sigue: tampoco. No alcanza con mirar
// cual es el primero que se sale; hay que mirar cuantos son.
cl = V.clasificarCliente([cel('p1', 850), cel('p2', 850),
                          cel('p3', 26676), cel('p4', 26676), cel('p5', 26676)]);
chk('un tramo que arranca en el ancla es quiebre', cl.clase === 'quiebre', cl.clase);
chk('y se parte en el primero', cl.corte === 'p1', String(cl.corte));
chk('el consenso son los tres de atras', cl.consenso.valor === 26676);
// sueltos y alternados: eso si es el modelo
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 900), cel('p3', 100), cel('p4', 900)]);
chk('alternados: disperso', cl.clase === 'disperso', cl.clase);
chk('y nombra los dos que sobran', cl.periodos.length === 2, JSON.stringify(cl.periodos));
// el caso que separa el 'y' del 'o': los que se salen SI son un tramo [1,2],
// pero el consenso [0,3] no lo es. Eso no es un cambio de saldo, es ruido.
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 900), cel('p3', 900), cel('p4', 100)]);
chk('si solo un lado es tramo, es disperso', cl.clase === 'disperso', cl.clase);
chk('y el consenso es el del primero', cl.consenso.valor === 100,
    String(cl.consenso.valor) + ' ' + JSON.stringify(cl.consenso.dentro));
// el orden de las preguntas importa: [0] solo TAMBIEN es un tramo, y si se
// preguntara por quiebre antes, la forma de QUINTA se informaria como un
// cambio de saldo que no existio.
cl = V.clasificarCliente([cel('p1', 850), cel('p2', 26676), cel('p3', 26676)]);
chk('el ancla sola no se informa como quiebre', cl.clase === 'ancla aislada', cl.clase);
// UN GRUPO DE UNO NO ES UN CONSENSO. Los cuatro S0 reales de QUINTA el 24-10.
// Con el 1% ninguno concuerda con ninguno: el grupo mas grande es de uno y el
// desempate se queda con el primero por ser el primero. Informar eso como
// 'quiebre' con S0 411 —que es el del ancla— era inventar un acuerdo.
const QUINTA = [cel('2026-09-07', 411), cel('2026-09-14', 5541),
                cel('2026-09-21', 5609), cel('2026-09-28', 4821)];
cl = V.clasificarCliente(QUINTA);
chk('todos distintos: sin consenso, no quiebre', cl.clase === 'sin consenso', cl.clase);
chk('y nombra los tres que se salen', cl.periodos.length === 3, JSON.stringify(cl.periodos));
// y con una holgura mas ancha aparece la estructura: las tres de atras
// concuerdan en ~5.300 y la del ancla dice 411.
cl = V.clasificarCliente(QUINTA, 0.15);
chk('con holgura del 15% es un ancla aislada', cl.clase === 'ancla aislada', cl.clase);
chk('y el periodo que se sale es el ancla', JSON.stringify(cl.periodos) === '["2026-09-07"]');
chk('clasificarCliente le pasa la tolerancia al consenso', cl.consenso.dentro.length === 3);
// dos periodos que no concuerdan tampoco son un quiebre: no hay sobre que medir
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 900)]);
chk('dos periodos en desacuerdo: sin consenso', cl.clase === 'sin consenso', cl.clase);
// un solo periodo con S0 no confirma nada
chk('un solo S0 legible no alcanza para dictaminar',
    V.clasificarCliente([cel('p1', 100), cel('p2', null)]).clase === 'sin datos',
    V.clasificarCliente([cel('p1', 100), cel('p2', null)]).clase);
// y los casos de antes no se movieron: dos que concuerdan y uno que no SIGUE
// siendo un quiebre, porque ahi el grupo si tiene dos miembros
cl = V.clasificarCliente([cel('p1', 100), cel('p2', 100), cel('p3', 900)]);
chk('un grupo de dos si es consenso', cl.clase === 'quiebre', cl.clase);

chk('sin celdas: sin datos', V.clasificarCliente([]).clase === 'sin datos' &&
    V.clasificarCliente(null).clase === 'sin datos');
chk('una celda nula no rompe la clasificacion',
    V.clasificarCliente([null, cel('p1', 100), cel('p2', 100)]).clase === 'estable');
chk('con los S0 ilegibles tampoco hay clase', V.clasificarCliente([cel('p1', null), cel('p2', NaN)]).clase === 'sin datos');

// ── repredecir ─────────────────────────────────────────────────────────────
console.log('\n— repredecir: cuanto se recupera con otro ancla —');
let rp = V.repredecir([{ periodo: 'p1', pd: 700, R: 0, n: 7 },
                       { periodo: 'p2', pd: 777, R: 70, n: 7 }], 100);
chk('repredice TODOS los periodos, el primero incluido', rp.length === 2);
chk('el primero con el S0 que le dan', rp[0].pred === 700 && rp[0].dif === 0);
chk('y el segundo', rp[1].pred === 770, String(rp[1].pred));
chk('la diferencia es prediccion menos facturado', rp[1].dif === -7, String(rp[1].dif));
chk('el relativo se mide contra lo facturado', Math.abs(rp[1].rel - 7 / 777) < 1e-12);
rp = V.repredecir([{ periodo: 'p1', pd: 0, R: 0, n: 7 }], 0);
chk('facturado cero y prediccion cero: calza', rp[0].rel === 0);
rp = V.repredecir([{ periodo: 'p1', pd: 0, R: 0, n: 7 }], 5);
chk('facturado cero y prediccion no: no calza', rp[0].rel === 1);
chk('una celda nula no rompe', V.repredecir([null, { periodo: 'p', pd: 7, R: 0, n: 7 }], 1).length === 1);
chk('repredecir de nada', V.repredecir(null, 1).length === 0);

// ── clasificarSinMapa ──────────────────────────────────────────────────────
console.log('\n— clasificarSinMapa: 517.531 pallets que no son todos el mismo problema —');
const MAE2 = { ubicaciones: [{ AbsEntry: 5271, CardCode: 'C91004000-6', IsSystemBin: 'tNO' },
                             { AbsEntry: 5276, CardCode: null, IsSystemBin: 'tNO' },
                             { AbsEntry: 2, CardCode: null, IsSystemBin: true },
                             { AbsEntry: 1, CardCode: null, IsSystemBin: 'tYES' }] };
const m2 = V.mapaDeMaestro(MAE2);
const sm = V.clasificarSinMapa([
  { BinAbsEntry: 5271, delta: -400 },      // tiene cliente: no entra
  { BinAbsEntry: 5276, delta: -100 },      // en el maestro, sin cliente
  { BinAbsEntry: 5276, delta: 100 },
  { BinAbsEntry: 1, delta: 7 },            // de sistema, marcada con texto
  { BinAbsEntry: 2, delta: 3 },            // de sistema, marcada con booleano
  { BinAbsEntry: 9999, delta: 50000 },     // ni figura: otra bodega
  { BinAbsEntry: 9998, delta: 1 }], m2, MAE2);
chk('la que tiene cliente no entra en ninguna clase',
    !sm['sin atribuir'].bins.has(5271) && !sm['otra bodega'].bins.has(5271));
chk('la que no figura en el maestro es de otra bodega',
    sm['otra bodega'].bins.size === 2 && sm['otra bodega'].pallets === 50001);
chk('la que figura sin cliente es una atribucion que falta',
    sm['sin atribuir'].bins.size === 1 && sm['sin atribuir'].filas === 2);
chk('los pallets se cuentan en valor absoluto, no se netean',
    sm['sin atribuir'].pallets === 200, String(sm['sin atribuir'].pallets));
chk('la de sistema va aparte', sm['de sistema'].bins.size === 2 && sm['de sistema'].pallets === 10,
    String(sm['de sistema'].bins.size) + ' / ' + sm['de sistema'].pallets);
chk('se reconoce tanto por texto como por booleano',
    sm['de sistema'].bins.has(1) && sm['de sistema'].bins.has(2));
chk('las tres clases son distintas', sm['otra bodega'].pallets !== sm['sin atribuir'].pallets);
chk('sin filas no se inventa nada', V.clasificarSinMapa([], m2, MAE2)['otra bodega'].filas === 0);
chk('sin maestro todo cae en otra bodega',
    V.clasificarSinMapa([{ BinAbsEntry: 7, delta: 3 }], new Map(), null)['otra bodega'].pallets === 3);

// ── diasCobrados ───────────────────────────────────────────────────────────
console.log('\n— diasCobrados: no es que la cantidad este mal, es que cobro un dia —');
chk('una semana entera da los dias de la semana', V.diasCobrados(7000, 0, 1000) === 7);
chk('con movimiento en el medio tambien', V.diasCobrados(7350, 350, 1000) === 7);
// los tres casos reales del 24-10, con el S0 del consenso
chk('CAMBIASO 2026-09-28 cobro un dia de siete',
    Math.abs(V.diasCobrados(21145, 0, 20990) - 1.007) < 0.001,
    String(V.diasCobrados(21145, 0, 20990)));
chk('KUNSTMANN 2026-09-28 tambien',
    Math.abs(V.diasCobrados(6127, 0, 5553) - 1.103) < 0.001);
chk('QUINTA 2026-09-07 cobro menos de un dia', V.diasCobrados(4796, 0, 6143) < 1);
chk('y sus otras semanas cobran casi siete', V.diasCobrados(42463, 0, 6143) > 6.5);
// el acumulado SI entra en la cuenta: sin restarlo, un cliente que crecio en
// la semana parece haber cobrado mas dias de los que tiene el periodo
chk('el acumulado se descuenta', V.diasCobrados(8000, 1000, 1000) === 7,
    String(V.diasCobrados(8000, 1000, 1000)));
chk('y no se suma', V.diasCobrados(8000, 1000, 1000) !== 9);
chk('un S0 cero no despeja nada', V.diasCobrados(7000, 0, 0) === null);
chk('un S0 negativo tampoco', V.diasCobrados(7000, 0, -1000) === null);
chk('ni un S0 que no es numero',
    V.diasCobrados(7000, 0, null) === null && V.diasCobrados(7000, 0, NaN) === null);
chk('un facturado ilegible da que no se sabe', V.diasCobrados(NaN, 0, 1000) === null);

// ── aciertoPorDistancia / tendenciaDeAcierto ───────────────────────────────
console.log('\n— el acierto segun la distancia al ancla: ancla o dato —');
// un cliente cuyo ancla es BUENA: todas las distancias aciertan
const cliD = (s0Ancla, pds) => ({ cod: 'C', nom: 'C', celdas: pds.map((pd, i) => ({
  periodo: 'p' + i, pd, R: 0, n: 7, s0: i === 0 ? s0Ancla : pd / 7 })) });
let apdD = V.aciertoPorDistancia([cliD(100, [700, 700, 700, 700])]);
chk('hay una entrada por distancia', apdD.size === 3, String(apdD.size));
chk('la distancia arranca en 1, no en 0', apdD.has(1) && !apdD.has(0));
chk('con el ancla buena acierta en todas', apdD.get(1).exactas === 1 && apdD.get(3).exactas === 1);
chk('y cuenta las celdas', apdD.get(1).n === 1);
// un ancla MALA falla todas por igual: el error no crece con la distancia
apdD = V.aciertoPorDistancia([cliD(200, [1400, 700, 700, 700])]);
chk('con el ancla mala no acierta ninguna',
    apdD.get(1).exactas === 0 && apdD.get(3).exactas === 0);
// y tampoco entra en el 1%: el 1% es una condicion aparte, no un sinonimo
chk('ni entra en el 1%', apdD.get(1).p1 === 0 && apdD.get(3).p1 === 0,
    JSON.stringify(apdD.get(1)));
// un cliente con dos celdas solo aporta a la distancia 1
apdD = V.aciertoPorDistancia([cliD(100, [700, 700])]);
chk('dos celdas aportan solo a la distancia 1', apdD.size === 1 && apdD.has(1));
chk('un cliente de una sola celda no aporta nada',
    V.aciertoPorDistancia([{ celdas: [{ periodo: 'p0', pd: 7, R: 0, n: 7, s0: 1 }] }]).size === 0);
chk('aciertoPorDistancia de nada', V.aciertoPorDistancia(null).size === 0);
// el dentro-del-1% se cuenta aparte del exacto
apdD = V.aciertoPorDistancia([cliD(100, [700, 703])]);
chk('703 contra 700 no es exacto pero si entra en el 1%',
    apdD.get(1).exactas === 0 && apdD.get(1).p1 === 1, JSON.stringify(apdD.get(1)));

console.log('\n— tendenciaDeAcierto —');
const mkD = arr => new Map(arr.map((p, i) => [i + 1, { n: 100, exactas: 0, p1: p }]));
// cae fuerte: 90% al principio, 30% al final
let tD = V.tendenciaDeAcierto(mkD([90, 90, 90, 60, 50, 30, 30, 30, 30]));
chk('si cae lo dice', tD.cae === true, JSON.stringify(tD));
chk('y trae las dos puntas', Math.abs(tD.inicio - 0.9) < 1e-9 && Math.abs(tD.fin - 0.3) < 1e-9);
// parejo: no cae
tD = V.tendenciaDeAcierto(mkD([50, 50, 50, 50, 50, 50]));
chk('si es parejo no cae', tD.cae === false, JSON.stringify(tD));
// una caida de 4 puntos NO alcanza: esta por debajo del umbral
tD = V.tendenciaDeAcierto(mkD([50, 50, 50, 46, 46, 46]));
chk('cuatro puntos no es una caida', tD.cae === false, JSON.stringify(tD));
tD = V.tendenciaDeAcierto(mkD([50, 50, 50, 44, 44, 44]));
chk('seis puntos si', tD.cae === true);
chk('respeta el umbral que le pasan',
    V.tendenciaDeAcierto(mkD([50, 50, 50, 46, 46, 46]), 0.02).cae === true);
// SUBIR no es caer
chk('si sube no se informa como caida', V.tendenciaDeAcierto(mkD([30, 30, 30, 90, 90, 90])).cae === false);
// LAS PUNTAS SE PESAN POR CELDAS, no por distancia. Con seis distancias el
// tercio son dos: una de 1 celda al 100% y otra de 99 al 0%. Pesando da 1%;
// promediando las dos tasas daria 50%, que es otra historia.
tD = V.tendenciaDeAcierto(new Map([[1, { n: 1, p1: 1 }], [2, { n: 99, p1: 0 }],
                                   [3, { n: 10, p1: 5 }], [4, { n: 10, p1: 5 }],
                                   [5, { n: 50, p1: 0 }], [6, { n: 50, p1: 0 }]]));
chk('las puntas se pesan por celdas', Math.abs(tD.inicio - 0.01) < 1e-9, String(tD.inicio));
chk('y no se promedian las tasas', Math.abs(tD.inicio - 0.5) > 1e-9);
chk('con esas puntas no hay caida', tD.cae === false, JSON.stringify(tD));
// LAS DISTANCIAS SE ORDENAN antes de cortar los tercios. Un Map recorre en
// orden de insercion, asi que sin ordenar el "primer tercio" seria el
// primero que entro y no el mas cercano al ancla.
const DESORD = new Map();
DESORD.set(6, { n: 50, p1: 0 }); DESORD.set(1, { n: 50, p1: 50 });
DESORD.set(3, { n: 50, p1: 25 }); DESORD.set(2, { n: 50, p1: 50 });
DESORD.set(5, { n: 50, p1: 0 }); DESORD.set(4, { n: 50, p1: 25 });
tD = V.tendenciaDeAcierto(DESORD);
chk('ordena las distancias aunque lleguen desordenadas',
    Math.abs(tD.inicio - 1) < 1e-9 && Math.abs(tD.fin - 0) < 1e-9, JSON.stringify(tD));
chk('y con eso detecta la caida', tD.cae === true);
chk('con una sola distancia no hay tendencia',
    V.tendenciaDeAcierto(mkD([50])).cae === null);
chk('tendencia de nada', V.tendenciaDeAcierto(null).cae === null &&
    V.tendenciaDeAcierto(new Map()).n === 0);

// ── diasPlausibles ─────────────────────────────────────────────────────────
console.log('\n— un cobro de dias negativos no existe: marcarlo, no esconderlo —');
chk('siete de siete es plausible', V.diasPlausibles(7, 7));
chk('uno de siete tambien: es el hallazgo, no un error', V.diasPlausibles(1, 7));
chk('cero es plausible: una semana sin cobrar', V.diasPlausibles(0, 7));
// LOS DOS CASOS REALES DE LA CORRIDA DE DIEZ MESES
chk('-0,96 de 7 NO se puede leer como dias', !V.diasPlausibles(-0.96, 7));
chk('59,14 de 7 tampoco', !V.diasPlausibles(59.14, 7));
chk('18,75 de 7 tampoco', !V.diasPlausibles(18.75, 7));
// el borde: hasta el doble del periodo se acepta, porque 9,96 de 7 era un
// sobrecobro real de CLEANER y no queremos marcarlo como fuera de modelo
chk('9,96 de 7 sigue siendo plausible: era un sobrecobro real',
    V.diasPlausibles(9.96, 7));
chk('el doble exacto entra', V.diasPlausibles(14, 7));
chk('y un pelo mas que el doble no', !V.diasPlausibles(14.01, 7));
chk('un periodo de 3 dias tiene su propio borde',
    V.diasPlausibles(6, 3) && !V.diasPlausibles(6.5, 3));
chk('sin dias no es plausible', !V.diasPlausibles(null, 7) && !V.diasPlausibles(NaN, 7));
chk('sin largo de periodo tampoco',
    !V.diasPlausibles(7, 0) && !V.diasPlausibles(7, null) && !V.diasPlausibles(7, -7));
// el caso que de verdad exige la guarda: cero dias cobrados en un periodo de
// cero dias pasaria el rango [0, 0] y se leeria como plausible, cuando lo que
// pasa es que no hay periodo
chk('cero dias en un periodo de cero no es plausible, es que no hay periodo',
    !V.diasPlausibles(0, 0), String(V.diasPlausibles(0, 0)));

// ── detalleSinAtribuir ─────────────────────────────────────────────────────
console.log('\n— nombrar las ubicaciones de CLIENTES sin dueno, no solo contarlas —');
const MAE3 = { ubicaciones: [
  { AbsEntry: 10, BinCode: 'CLIENTES-A-01', Description: 'ALIFRUT MAULE',
    Sublevel1: 'ALIFRUT', CardCode: 'C1', IsSystemBin: 'tNO' },
  { AbsEntry: 20, BinCode: 'CLIENTES-PA-07', Description: 'CASA MATRIZ',
    Sublevel1: 'PUNTOAZUL', CardCode: null, IsSystemBin: 'tNO' },
  { AbsEntry: 30, BinCode: 'CLIENTES-LE-50', Description: null,
    Sublevel1: 'LESAFFRE', CardCode: null, IsSystemBin: 'tNO' },
  { AbsEntry: 1, BinCode: 'SISTEMA', Description: null, CardCode: null, IsSystemBin: 'tYES' },
  // la de sistema marcada con BOOLEANO, que es la otra forma en que viene
  { AbsEntry: 2, BinCode: 'SISTEMA-2', Description: null, CardCode: null, IsSystemBin: true },
  { AbsEntry: 40, BinCode: 'CLIENTES-LF-03', Description: 'HAMBURGO PLANTA',
    Sublevel1: 'LAFHAMBURGO', CardCode: null, IsSystemBin: 'tNO' }] };
const m3 = V.mapaDeMaestro(MAE3);
let sa = V.detalleSinAtribuir([
  { BinAbsEntry: 10, delta: -500 },        // tiene dueno: no entra
  { BinAbsEntry: 20, delta: -300 },
  { BinAbsEntry: 20, delta: 100 },
  { BinAbsEntry: 30, delta: 50 },
  { BinAbsEntry: 1, delta: 7 },            // de sistema por texto: no entra
  { BinAbsEntry: 2, delta: 9 },            // de sistema por booleano: tampoco
  { BinAbsEntry: 999, delta: 9000 },       // otra bodega: tampoco
  // esta entra ULTIMA y es la mas grande: si no se ordenara, quedaria al final
  { BinAbsEntry: 40, delta: -5000 }], m3, MAE3);
const porAbs = n => sa.find(x => x.AbsEntry === n);
chk('solo las de CLIENTES sin dueno', sa.length === 3, JSON.stringify(sa.map(x => x.AbsEntry)));
chk('la que tiene dueno no entra', !porAbs(10));
chk('la de sistema por texto tampoco', !porAbs(1));
chk('ni la de sistema por booleano', !porAbs(2), JSON.stringify(sa.map(x => x.AbsEntry)));
chk('la de otra bodega tampoco', !porAbs(999));
// LO QUE SE VINO A BUSCAR: el grupo y la descripcion, para saber de quien es
chk('trae el grupo', porAbs(20).Sublevel1 === 'PUNTOAZUL', JSON.stringify(porAbs(20)));
chk('y la descripcion', porAbs(20).Description === 'CASA MATRIZ');
chk('y el BinCode por si no hay descripcion', porAbs(30).BinCode === 'CLIENTES-LE-50');
// los pallets en absoluto, el neto con signo: son dos preguntas distintas
chk('los pallets se cuentan en absoluto', porAbs(20).pallets === 400, String(porAbs(20).pallets));
chk('y el neto conserva el signo', porAbs(20).neto === -200, String(porAbs(20).neto));
chk('cuenta las filas', porAbs(20).filas === 2);
chk('viene ordenado por pallets aunque llegue al final',
    sa[0].AbsEntry === 40 && sa[2].AbsEntry === 30,
    JSON.stringify(sa.map(x => x.AbsEntry + ':' + x.pallets)));
chk('sin movimiento no aparece ninguna', V.detalleSinAtribuir([], m3, MAE3).length === 0);
chk('sin maestro no se inventa nada',
    V.detalleSinAtribuir([{ BinAbsEntry: 20, delta: 1 }], m3, null).length === 0);
chk('detalleSinAtribuir de nada', V.detalleSinAtribuir(null, m3, MAE3).length === 0);

// ── edadMaestro ────────────────────────────────────────────────────────────
console.log('\n— la edad del maestro: un maestro viejo se ve como mas retail —');
let em = V.edadMaestro({ generado: '2026-10-23T18:00:00.000Z', _ubicaciones: 539,
                         _atribuidas: 538 }, '2026-10-24');
chk('cuenta los dias', em.dias === 1, String(em.dias));
chk('trae las ubicaciones que tenia SAP y las atribuidas',
    em.ubicaciones === 539 && em.atribuidas === 538);
chk('trae la fecha tal cual', em.generado === '2026-10-23T18:00:00.000Z');
em = V.edadMaestro({ generado: '2026-09-01T00:00:00.000Z' }, '2026-10-24');
chk('un maestro de hace mes y medio da 53 dias', em.dias === 53, String(em.dias));
// un cero es un conteo: no es lo mismo que no saber
em = V.edadMaestro({ generado: '2026-10-24T00:00:00.000Z', _ubicaciones: 0, _atribuidas: 0 }, '2026-10-24');
chk('cero ubicaciones se informa como cero, no como que no se sabe',
    em.ubicaciones === 0 && em.atribuidas === 0, JSON.stringify(em));
chk('mismo dia da cero dias', em.dias === 0);
em = V.edadMaestro({}, '2026-10-24');
chk('sin fecha no se inventa una edad', em.dias === null && em.generado === null);
chk('sin conteos tampoco', em.ubicaciones === null && em.atribuidas === null);
chk('una fecha ilegible no da una edad', V.edadMaestro({ generado: 'ayer' }, '2026-10-24').dias === null);
chk('sin hoy tampoco', V.edadMaestro({ generado: '2026-10-23T00:00:00Z' }, null).dias === null);
chk('edadMaestro de nada', V.edadMaestro(null, '2026-10-24').dias === null);

// ── ventana ────────────────────────────────────────────────────────────────
console.log('\n— la ventana: el inicio por cobertura, el fin por el dato —');
const COB = [{ mes: '2026-06', desde: '2026-06-01', hasta: '2026-06-30' },
             { mes: '2026-07', desde: '2026-07-01', hasta: '2026-07-31' },
             { mes: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' }];
// EL CASO QUE MOTIVA LA FUNCION: el primer movimiento es del 3 de junio, no
// del 1. Tomar el movimiento corria el inicio dos dias y la semilla, que
// tiene que pegar exacto con el dia anterior, se rechazaba sola.
let vn = V.ventana(COB, ['2026-06-03', '2026-10-23', '2026-07-15']);
chk('el inicio sale de la cobertura, no del primer movimiento',
    vn.desde === '2026-06-01', vn.desde);
chk('y se puede avisar que el primer movimiento es otro',
    vn.primerMovimiento === '2026-06-03' && vn.porCobertura === true);
// EL FIN AL REVES: octubre dice cubrir hasta el 31 y el dato llega al 23.
// Extender hasta el 31 daria por completos periodos que no lo estan.
chk('el fin sale del ultimo movimiento, no de la cobertura',
    vn.hasta === '2026-10-23', vn.hasta);
chk('y no del 2026-10-31', vn.hasta !== '2026-10-31');
// las coberturas pueden llegar desordenadas
chk('ordena las coberturas', V.ventana([{ desde: '2026-07-01' }, { desde: '2026-06-01' }],
    ['2026-07-02']).desde === '2026-06-01');
// sin cobertura cae al primer movimiento, que es mejor que nada
vn = V.ventana([], ['2026-06-03', '2026-10-23']);
chk('sin cobertura usa el primer movimiento', vn.desde === '2026-06-03' && vn.porCobertura === false);
chk('una cobertura sin desde no cuenta',
    V.ventana([{ mes: '2026-06' }], ['2026-06-03']).desde === '2026-06-03');
chk('sin nada no hay ventana', V.ventana(null, null).desde === null &&
    V.ventana([], []).hasta === null);
const FOBS = ['2026-10-23', '2026-06-03'];
V.ventana(COB, FOBS);
chk('no ordena el arreglo de fechas que recibe', FOBS[0] === '2026-10-23', JSON.stringify(FOBS));

// ── leerSemilla / diaSiguiente / semillaAplicable ──────────────────────────
console.log('\n— la semilla de S0: medir aparte en vez de despejar de la cartola —');
const SEM = { fecha: '2025-12-31', fuente: 'WAVE', saldos: [
  { cod: 'C91004000-6', nom: 'FERNANDEZ', saldo: 26819 },
  { cod: ' C76773020-9 ', nom: 'QUINTA', saldo: 6193 },
  { cod: 'C76099789-7', nom: 'ACONCAGUA', saldo: 0 },
  { cod: 'C-MALO', nom: 'ilegible', saldo: 'x' },
  { cod: '', nom: 'sin cod', saldo: 5 },
  null] };
let sem = V.leerSemilla(SEM);
chk('indexa por CardCode', sem.porCod.get('C91004000-6') === 26819);
chk('limpia los espacios del codigo', sem.porCod.get('C76773020-9') === 6193,
    JSON.stringify([...sem.porCod.keys()]));
// un saldo CERO es un saldo, no una ausencia: el cliente devolvio todo
chk('un saldo cero se guarda', sem.porCod.get('C76099789-7') === 0 &&
    sem.porCod.has('C76099789-7'));
chk('un saldo ilegible no entra', !sem.porCod.has('C-MALO'));
chk('un codigo vacio no entra', !sem.porCod.has(''));
chk('un nulo no revienta', sem.n === 3, String(sem.n));
chk('trae la fecha y la fuente', sem.fecha === '2025-12-31' && sem.fuente === 'WAVE');
chk('semilla de nada', V.leerSemilla(null).n === 0);

chk('diaSiguiente normal', V.diaSiguiente('2025-12-31') === '2026-01-01');
chk('diaSiguiente cruzando mes', V.diaSiguiente('2026-01-31') === '2026-02-01');
chk('diaSiguiente en febrero bisiesto', V.diaSiguiente('2024-02-28') === '2024-02-29');
chk('diaSiguiente de una basura', V.diaSiguiente('x') === null && V.diaSiguiente(null) === null);

// LA SEMILLA TIENE QUE PEGAR EXACTO CON LA VENTANA
let ap = V.semillaAplicable('2025-12-31', '2026-01-01');
chk('si pega, se usa', ap.ok === true, JSON.stringify(ap));
ap = V.semillaAplicable('2025-12-31', '2026-07-01');
chk('con seis meses de hueco NO se usa', ap.ok === false, JSON.stringify(ap));
chk('y dice que faltan meses en el medio', /faltan meses/.test(ap.motivo), ap.motivo);
ap = V.semillaAplicable('2026-07-31', '2026-01-01');
chk('una semilla posterior a la ventana tampoco', ap.ok === false);
chk('y lo dice distinto', /posterior/.test(ap.motivo), ap.motivo);
// el mismo dia NO sirve: ese dia se contaria dos veces
ap = V.semillaAplicable('2026-01-01', '2026-01-01');
chk('la semilla del mismo dia que la ventana no sirve', ap.ok === false, JSON.stringify(ap));
chk('sin fecha falla cerrado', V.semillaAplicable(null, '2026-01-01').ok === false &&
    V.semillaAplicable('2025-12-31', null).ok === false);
// y el motivo tiene que decir QUE falta, no inventar una comparacion
chk('y dice que falta la fecha', /falta la fecha/.test(V.semillaAplicable(null, '2026-01-01').motivo) &&
    /falta la fecha/.test(V.semillaAplicable('2025-12-31', null).motivo),
    V.semillaAplicable('2025-12-31', null).motivo);

// ── predecirConSemilla ─────────────────────────────────────────────────────
console.log('\n— predecirConSemilla: no se gasta ninguna celda en el ancla —');
const semM = V.leerSemilla({ fecha: '2025-12-31', saldos: [{ cod: 'C1', saldo: 100 }] });
const cliS = [{ cod: 'C1', nom: 'UNO', celdas: [
                 { periodo: 'p1', pd: 700, R: 0, n: 7, s0: 100 },
                 { periodo: 'p2', pd: 770, R: 70, n: 7, s0: 100 }] },
              { cod: 'C9', nom: 'SIN SEMILLA', celdas: [{ periodo: 'p1', pd: 7, R: 0, n: 7, s0: 1 }] }];
let pr = V.predecirConSemilla(cliS, semM);
chk('predice TODAS las celdas, la primera incluida', pr[0].celdas.length === 2);
chk('y acierta las dos con el S0 medido',
    pr[0].celdas[0].dif === 0 && pr[0].celdas[1].dif === 0, JSON.stringify(pr[0].celdas));
chk('el cliente sin semilla se marca y no se inventa',
    pr[1].sinSemilla === true && pr[1].celdas.length === 0);
chk('guarda el S0 que implicaba la OV para poder compararlo',
    pr[0].celdas[0].s0Ov === 100);
// UN SALDO CERO ES UN SALDO: el cliente que devolvio todo se predice igual,
// y su prediccion es cero. Tratarlo como ausente lo saca de la medicion.
const semZ = V.leerSemilla({ fecha: '2025-12-31', saldos: [{ cod: 'C0', saldo: 0 }] });
const prZ = V.predecirConSemilla([{ cod: 'C0', nom: 'DEVOLVIO TODO',
  celdas: [{ periodo: 'p1', pd: 0, R: 0, n: 7, s0: 0 }] }], semZ);
chk('un cliente con saldo cero se predice, no se descarta',
    !prZ[0].sinSemilla && prZ[0].celdas.length === 1, JSON.stringify(prZ[0]));
chk('y su prediccion es cero', prZ[0].celdas[0].pred === 0 && prZ[0].celdas[0].dif === 0);
// EL SIGNO: la diferencia es prediccion menos facturado. Si el saldo medido
// es mayor que lo que cobro la OV, la diferencia es POSITIVA.
const prS = V.predecirConSemilla([{ cod: 'C1', nom: 'COBRO MENOS',
  celdas: [{ periodo: 'p1', pd: 600, R: 0, n: 7, s0: 85 }] }], semM);
chk('la diferencia es prediccion menos facturado', prS[0].celdas[0].dif === 100,
    String(prS[0].celdas[0].dif));
chk('y no al reves', prS[0].celdas[0].dif !== -100);
chk('predecirConSemilla de nada', V.predecirConSemilla(null, semM).length === 0);

// ── discrepanciaS0 ─────────────────────────────────────────────────────────
console.log('\n— discrepanciaS0: la lista corta para Finanzas —');
const semD = V.leerSemilla({ fecha: '2025-12-31', saldos: [
  { cod: 'C1', saldo: 100 }, { cod: 'C2', saldo: 100 }, { cod: 'C3', saldo: 100 },
  { cod: 'C4', saldo: 95 }] });
let prD = V.predecirConSemilla([
  // concuerda: la OV implica lo mismo que el saldo medido
  { cod: 'C1', nom: 'CALZA', celdas: [{ periodo: 'p1', pd: 700, R: 0, n: 7, s0: 100 },
                                      { periodo: 'p2', pd: 700, R: 0, n: 7, s0: 100 }] },
  // discrepa fuerte: la OV cobra como si tuviera 200
  { cod: 'C2', nom: 'COBRA DE MAS', celdas: [{ periodo: 'p1', pd: 1400, R: 0, n: 7, s0: 200 },
                                             { periodo: 'p2', pd: 1400, R: 0, n: 7, s0: 200 }] },
  // discrepa poco: 3% queda bajo el umbral del 5%
  { cod: 'C3', nom: 'CASI', celdas: [{ periodo: 'p1', pd: 721, R: 0, n: 7, s0: 103 },
                                     { periodo: 'p2', pd: 721, R: 0, n: 7, s0: 103 }] }], semD);
let d = V.discrepanciaS0(prD);
chk('solo sale el que discrepa de verdad', d.length === 1 && d[0].cod === 'C2',
    JSON.stringify(d.map(x => x.cod)));
chk('informa los dos S0 y la diferencia',
    d[0].s0Medido === 100 && d[0].s0Ov === 200 && d[0].dif === 100);
chk('el de 3% queda fuera con el umbral por defecto', !d.some(x => x.cod === 'C3'));
chk('y entra si se baja el umbral', V.discrepanciaS0(prD, 0.01).some(x => x.cod === 'C3'));
// EL DENOMINADOR ES EL MAYOR DE LOS DOS. Con 95 medido y 100 en la OV, medir
// contra el mayor da 5,00% —justo en el borde, no pasa— y contra el menor
// 5,26%, que si pasaria. El caso parte las dos formas.
const prM = V.predecirConSemilla([{ cod: 'C4', nom: 'BORDE',
  celdas: [{ periodo: 'p1', pd: 700, R: 0, n: 7, s0: 100 },
           { periodo: 'p2', pd: 700, R: 0, n: 7, s0: 100 }] }], semD);
chk('el borde exacto del 5% no entra: se mide contra el mayor',
    V.discrepanciaS0(prM).length === 0, JSON.stringify(V.discrepanciaS0(prM)));
// se usa la MEDIANA de los S0 de la OV: una semana rara no arrastra al cliente
prD = V.predecirConSemilla([{ cod: 'C1', nom: 'UNA SEMANA RARA', celdas: [
  { periodo: 'p1', pd: 700, R: 0, n: 7, s0: 100 },
  { periodo: 'p2', pd: 700, R: 0, n: 7, s0: 100 },
  { periodo: 'p3', pd: 7000, R: 0, n: 7, s0: 1000 }] }], semD);
chk('una sola semana rara no mete al cliente en la lista',
    V.discrepanciaS0(prD).length === 0, JSON.stringify(V.discrepanciaS0(prD)));
// el orden: la diferencia mas grande primero, que es por donde se empieza
const prO = V.predecirConSemilla([
  { cod: 'C2', nom: 'CHICA', celdas: [{ periodo: 'p1', pd: 840, R: 0, n: 7, s0: 120 }] },
  { cod: 'C1', nom: 'GRANDE', celdas: [{ periodo: 'p1', pd: 3500, R: 0, n: 7, s0: 500 }] }], semD);
const dO = V.discrepanciaS0(prO);
chk('viene ordenado por el tamano de la diferencia, el mayor primero',
    dO.length === 2 && dO[0].cod === 'C1', JSON.stringify(dO.map(x => x.cod)));
chk('el cliente sin semilla no entra en la lista',
    V.discrepanciaS0(V.predecirConSemilla([{ cod: 'CX', nom: 'x', celdas: [] }], semD)).length === 0);
chk('discrepanciaS0 de nada', V.discrepanciaS0(null).length === 0);

// ── opciones ───────────────────────────────────────────────────────────────
console.log('\n— opciones —');
chk('--tol es una opcion con valor', V.OPCIONES.indexOf('tol') >= 0);
chk('--semilla y --universo tambien',
    V.OPCIONES.indexOf('semilla') >= 0 && V.OPCIONES.indexOf('universo') >= 0);
chk('--mes y --cliente son opciones con valor',
    V.OPCIONES.indexOf('mes')>=0 && V.OPCIONES.indexOf('cliente')>=0);
chk('--meses permite fijar la ventana', V.OPCIONES.indexOf('meses')>=0);
chk('las banderas heredadas estan', V.BANDERAS.indexOf('mantener-duplicadas')>=0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
