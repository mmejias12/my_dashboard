'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const C=require('./comparar-cierres.js');

console.log('— que dos copias se comparan —');
const N = ['2026-10-21-stock-retail.json','2026-10-23-stock-retail.json','2026-10-22-stock-retail.json',
           '2026-10-23-stock-clientes.json','2026-10-23-bodegas-hoy.json','basura.json',
           '2026-10-2-stock-retail.json'];
let p = C.parDeCopias(N, 'stock-retail');
// la ANTERIOR contra la ultima, no la primera: interesa lo que cambio desde
// la ultima vez que miramos, no desde el principio
chk('toma la ultima y la inmediatamente anterior',
    p.ahora.fecha === '2026-10-23' && p.antes.fecha === '2026-10-22', JSON.stringify([p.antes, p.ahora]));
chk('no toma la primera de todas', p.antes.fecha !== '2026-10-21');
chk('no mezcla bodegas', !/clientes/.test(p.ahora.archivo) && !/clientes/.test(p.antes.archivo));
chk('ignora archivos que no son copias', p.n === 3, String(p.n));
chk('una fecha mal formada no entra', p.n === 3);
chk('--hasta deja mirar un dia anterior',
    C.parDeCopias(N, 'stock-retail', '2026-10-22').ahora.fecha === '2026-10-22');
// con una sola copia no hay nada que comparar, y eso NO es "todo bien"
chk('con una sola copia no se puede comparar',
    C.parDeCopias(['2026-10-23-stock-retail.json'], 'stock-retail').ok === false);
chk('y se dice cuantas habia', C.parDeCopias(['2026-10-23-stock-retail.json'], 'stock-retail').n === 1);
chk('sin ninguna copia tampoco', C.parDeCopias([], 'stock-retail').ok === false);
chk('parDeCopias de nada', C.parDeCopias(null, 'stock-retail').n === 0);

console.log('\n— el nivel de bodega de una copia —');
chk('lo saca del bloque nivel', C.nivelDe({ nivel: { bodega: 579026 } }) === 579026);
// un nivel ausente NO es cero: cero diria que la bodega esta vacia
chk('sin nivel devuelve null, no cero',
    C.nivelDe({}) === null && C.nivelDe(null) === null && C.nivelDe({ nivel: {} }) === null);
chk('un cero explicito si es cero', C.nivelDe({ nivel: { bodega: 0 } }) === 0);

console.log('\n— la serie dia por dia —');
const AY = [{dia:'2026-10-20',cierre:100},{dia:'2026-10-21',cierre:200},{dia:'2026-10-22',cierre:300}];
const HO = [{dia:'2026-10-20',cierre:100},{dia:'2026-10-21',cierre:190},{dia:'2026-10-22',cierre:300},
            {dia:'2026-10-23',cierre:400}];
let S = C.serieDeCambios(AY, HO);
chk('solo los dias que estan en las dos copias', S.length === 3, JSON.stringify(S.map(x=>x.dia)));
chk('un dia nuevo no entra', !S.some(x => x.dia === '2026-10-23'));
// los dias sin cambio TIENEN que ir: sin ellos no se distingue un corrimiento
// de toda la serie de un posteo suelto
chk('los dias sin cambio van igual, con cambio 0',
    S.filter(x => x.cambio === 0).length === 2, JSON.stringify(S));
chk('el cambio es ahora menos antes',
    S.find(x => x.dia === '2026-10-21').cambio === -10);
chk('lleva los dos cierres para poder mostrarlos',
    S.find(x => x.dia === '2026-10-21').antes === 200 && S.find(x => x.dia === '2026-10-21').ahora === 190);
chk('un dia repetido no se cuenta dos veces',
    C.serieDeCambios(AY, HO.concat([{dia:'2026-10-21',cierre:999}])).length === 3);
chk('un cierre ausente se lee como cero',
    C.serieDeCambios([{dia:'d',cierre:50}], [{dia:'d'}])[0].cambio === -50);
chk('un cierre viejo ausente tambien',
    C.serieDeCambios([{dia:'d'}], [{dia:'d',cierre:50}])[0].cambio === 50);
chk('sin copias no hay serie',
    C.serieDeCambios(null, null).length === 0 && C.serieDeCambios(AY, null).length === 0);
chk('filas basura no rompen', C.serieDeCambios([null,{dia:'d',cierre:1}], [{},null,{dia:'d',cierre:3}]).length === 1);

console.log('\n— deriva de la serie vs posteo retroactivo —');
// LA FORMA REAL medida el 27-10-2026: 297 dias comparados, 296 cambiaron
// exactamente -613 y el mas nuevo -2.539. La lectura cruda decia
// "-183.987 pallets", que no es ningun pallet.
const ANT = [], AHO = [];
for (let i = 0; i < 297; i++) {
  const d = '2026-' + String(Math.floor(i/31)+1).padStart(2,'0') + '-' + String(i%31+1).padStart(2,'0');
  ANT.push({ dia:d, cierre:500000+i*10 });
  AHO.push({ dia:d, cierre:500000+i*10 + (i===296 ? -2539 : -613) });
}
let R = C.separarDeriva(C.serieDeCambios(ANT, AHO));
chk('el crudo sumaba -183.987', C.serieDeCambios(ANT,AHO).reduce((a,x)=>a+x.cambio,0) === -183987);
chk('la deriva es el -613 que comparten todos', R.deriva === -613, String(R.deriva));
chk('queda UN dia realmente reescrito, no 297', R.dias.length === 1, String(R.dias.length));
chk('y el movimiento de ese dia cambio -1.926', R.total === -1926 && R.dias[0].real === -1926,
    JSON.stringify(R.dias));
chk('es el dia mas nuevo', R.dias[0].dia === '2026-10-18', R.dias[0].dia);
chk('cuenta los dias comparados', R.n === 297, String(R.n));
// LA LEY: las dos puntas tienen que cerrar contra el medio
chk('ley: deriva + suma de reescrituras = cambio del dia mas nuevo',
    R.deriva + R.total === -2539, String(R.deriva + R.total));

// un corrimiento parejo SIN ningun posteo: deriva pura, cero dias reescritos
const [P1,P2] = [[],[]];
for (let i = 0; i < 40; i++) { const d='2026-09-'+String(i+1).padStart(2,'0');
  P1.push({dia:d,cierre:1000+i}); P2.push({dia:d,cierre:1000+i-7}); }
let D = C.separarDeriva(C.serieDeCambios(P1,P2));
chk('corrimiento parejo: deriva y ningun dia reescrito',
    D.deriva === -7 && D.dias.length === 0 && D.total === 0, JSON.stringify(D));

// UN SOLO dia movido entre muchos quietos NO es deriva: es justo lo contrario,
// y confundirlo seria tapar el unico posteo de verdad
const Q1 = [], Q2 = [];
for (let i = 0; i < 40; i++) { const d='2026-09-'+String(i+1).padStart(2,'0');
  Q1.push({dia:d,cierre:1000}); Q2.push({dia:d,cierre:i===10?940:1000}); }
let U = C.separarDeriva(C.serieDeCambios(Q1,Q2));
chk('un dia suelto no se lee como deriva', U.deriva === 0, String(U.deriva));
chk('y aparece como movimiento que se corrio de un dia al siguiente',
    U.dias.length === 2 && U.dias.map(x=>x.real).sort((a,b)=>a-b).join(',') === '-60,60',
    JSON.stringify(U.dias));

// nada cambio: ni deriva ni posteos, pero los dias se contaron
let Z = C.separarDeriva(C.serieDeCambios(P1,P1));
chk('sin ningun cambio no hay nada que separar',
    Z.deriva === 0 && Z.dias.length === 0 && Z.total === 0 && Z.n === 40, JSON.stringify(Z));

// el orden lo pone separarDeriva: la serie puede venir como venga
const BAR = C.serieDeCambios(ANT, AHO).slice().reverse();
let B = C.separarDeriva(BAR);
chk('una serie desordenada da el mismo resultado',
    B.deriva === -613 && B.dias.length === 1 && B.total === -1926, JSON.stringify([B.deriva,B.total]));

chk('serie vacia o nula', C.separarDeriva([]).n === 0 && C.separarDeriva(null).deriva === 0 &&
    C.separarDeriva(undefined).dias.length === 0);
chk('un solo dia: todo es deriva, no hay con que compararlo',
    C.separarDeriva([{dia:'a',cambio:-5}]).deriva === -5 &&
    C.separarDeriva([{dia:'a',cambio:-5}]).dias.length === 0);
chk('un cambio no numerico se descarta',
    C.separarDeriva([{dia:'a',cambio:'x'},{dia:'b',cambio:3}]).n === 1);
chk('una fila sin dia se descarta', C.separarDeriva([{cambio:3},{dia:'b',cambio:3}]).n === 1);
// el mas grande primero: si hay diez, los diez primeros son los que importan
let O = C.separarDeriva([{dia:'a',cambio:0},{dia:'b',cambio:5},{dia:'c',cambio:-20},{dia:'d',cambio:-20}]);
chk('los dias reescritos salen de mayor a menor',
    O.dias.map(x=>Math.abs(x.real)).join(',') === '25,5', JSON.stringify(O.dias));

console.log('\n— el veredicto —');
const sinNada = { deriva:0, dias:[], total:0, n:5 };
let v = C.veredicto([{ bodega:'RETAIL', ok:true, sep:sinNada },
                     { bodega:'CLIENTES', ok:true, sep:sinNada }]);
chk('sin cambios hacia atras dicta que si', v.nivel === 'si', v.nivel);
chk('y dice cuantos dias reviso', /los 5 dias ya cerrados siguen igual/.test(v.texto), v.texto);

v = C.veredicto([{ bodega:'RETAIL', ok:true, sep:{ deriva:-613, dias:[], total:0, n:297 } }]);
chk('solo deriva manda a revisar', v.nivel === 'revisar', v.nivel);
chk('y la nombra con su monto y sus dias', /deriva de -613 en los 297 dias/.test(v.texto), v.texto);
chk('y explica que es movimiento que las ubicaciones no vieron',
    /ubicaciones no vio/.test(v.texto), v.texto);
chk('y NO dice que se posteo con fecha pasada', !/fecha pasada/.test(v.texto), v.texto);

v = C.veredicto([{ bodega:'RETAIL', ok:true, sep:{ deriva:-613, n:297, total:-1926,
                   dias:[{dia:'2026-10-26',real:-1926}] } }]);
chk('deriva y posteo se informan por separado',
    /deriva de -613/.test(v.texto) && /1 dia\(s\) reescritos/.test(v.texto), v.texto);
chk('y nombra el dia y el monto real', /2026-10-26 -1\.926/.test(v.texto), v.texto);
chk('y dice que se posteo con fecha pasada',
    /fecha pasada despues del cierre/.test(v.texto), v.texto);
chk('el monto que se publica es el real, no el crudo',
    /-1\.926 pallets/.test(v.texto) && !/183\.987/.test(v.texto), v.texto);

v = C.veredicto([{ bodega:'RETAIL', ok:true, sep:{ deriva:0, n:297, total:-120,
                   dias:[{dia:'2026-10-20',real:-100},{dia:'2026-10-19',real:-20}] } }]);
chk('sin deriva se informa solo el posteo', v.nivel === 'revisar' && !/deriva/.test(v.texto), v.texto);
chk('se nombran hasta tres dias', /2026-10-20 -100/.test(v.texto) && /2026-10-19 -20/.test(v.texto), v.texto);

// no poder comparar NO es "todo bien": tiene que notarse
v = C.veredicto([{ bodega:'RETAIL', ok:false, n:1 }]);
chk('no poder comparar no dicta que si', v.nivel === 'revisar', v.nivel);
chk('y se explica', /no hay dos copias/.test(v.texto), v.texto);
chk('sin bodegas no hay veredicto',
    C.veredicto([]).nivel === 'sin datos' && C.veredicto(null).nivel === 'sin datos');

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
