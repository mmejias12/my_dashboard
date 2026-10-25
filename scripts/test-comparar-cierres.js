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

console.log('\n— el veredicto —');
let v = C.veredicto([{ bodega:'RETAIL', ok:true, ret:{ dias:0, comparados:5, total:0, detalle:[] } },
                     { bodega:'CLIENTES', ok:true, ret:{ dias:0, comparados:5, total:0, detalle:[] } }]);
chk('sin cambios hacia atras dicta que si', v.nivel === 'si', v.nivel);
chk('y dice cuantos dias reviso', /5 dias ya cerrados/.test(v.texto), v.texto);
v = C.veredicto([{ bodega:'RETAIL', ok:true, ret:{ dias:2, comparados:5, total:-120,
                   detalle:[{dia:'2026-10-20',cambio:-100},{dia:'2026-10-19',cambio:-20}] } }]);
chk('con cambios manda a revisar', v.nivel === 'revisar', v.nivel);
chk('y nombra los dias y el monto', /2026-10-20/.test(v.texto) && /-120/.test(v.texto), v.texto);
chk('y dice que se posteo con fecha pasada', /fecha pasada despues del cierre/.test(v.texto), v.texto);
// no poder comparar NO es "todo bien": tiene que notarse
v = C.veredicto([{ bodega:'RETAIL', ok:false, n:1 }]);
chk('no poder comparar no dicta que si', v.nivel === 'revisar', v.nivel);
chk('y se explica', /no hay dos copias/.test(v.texto), v.texto);
chk('sin bodegas no hay veredicto',
    C.veredicto([]).nivel === 'sin datos' && C.veredicto(null).nivel === 'sin datos');

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
