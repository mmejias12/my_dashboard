'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const C=require('./sonda-cobertura-docs.js');

console.log('— la url del $count usa EL MISMO filtro que la extraccion —');
const u = C.urlConteo('https://h:50000/b1s/v1', 'StockTransfers', 'DocDate', '2026-02-01', '2026-02-28');
chk('pega $count a la entidad', /StockTransfers\/\$count\?/.test(u), u);
// si el filtro no fuera identico al de la extraccion, comparar no probaria nada
chk('filtra por ge y le, igual que urlLista',
    /DocDate%20ge%20'2026-02-01'/.test(u) && /DocDate%20le%20'2026-02-28'/.test(u), u);
chk('sin alguna parte no hay url',
    C.urlConteo(null,'E','F','a','b') === null && C.urlConteo('r','E','F','a',null) === null);

console.log('\n— el $count vuelve como texto pelado —');
chk('un entero se lee', C.leerConteo('15672') === 15672);
chk('con espacios tambien', C.leerConteo('  420 \n') === 420);
chk('el cero es un conteo valido', C.leerConteo('0') === 0);
// un cuerpo raro NO es cero: tratarlo como cero diria "no falta nada"
chk('un cuerpo que no es entero devuelve null, no cero',
    C.leerConteo('<html>error</html>') === null && C.leerConteo('') === null &&
    C.leerConteo(null) === null, String(C.leerConteo('x')));
chk('un decimal no es un conteo', C.leerConteo('12.5') === null);
chk('un negativo no es un conteo', C.leerConteo('-3') === null);

console.log('\n— la comparacion —');
const CMP = C.comparar([{ mes: '2026-03', sap: 100, nuestro: 100 },
                        { mes: '2026-01', sap: 500, nuestro: 480 },
                        { mes: '2026-02', sap: 200, nuestro: 215 },
                        { mes: '2026-04', sap: null, nuestro: 7 },
                        { mes: '2026-05', sap: 9, nuestro: null },
                        { mes: null, sap: 1, nuestro: 1 }, null]);
chk('ordena por mes', CMP.map(x => x.mes).join() === '2026-01,2026-02,2026-03,2026-04,2026-05',
    CMP.map(x => x.mes).join());
chk('calcula lo que falta', CMP.find(x => x.mes === '2026-01').falta === 20);
chk('un mes que cuadra da cero', CMP.find(x => x.mes === '2026-03').falta === 0);
// que el blob tenga MAS que SAP es otro problema, no un faltante negativo
chk('el blob con mas documentos da falta negativa',
    CMP.find(x => x.mes === '2026-02').falta === -15);
// sin uno de los dos numeros no se compara: inventar un cero diria que cuadra
chk('sin conteo de SAP no es medible',
    CMP.find(x => x.mes === '2026-04').medible === false &&
    CMP.find(x => x.mes === '2026-04').falta === null);
chk('sin blob tampoco', CMP.find(x => x.mes === '2026-05').medible === false);
chk('una fila sin mes no entra', CMP.length === 5, String(CMP.length));

console.log('\n— el resumen —');
const R = C.resumen(CMP);
chk('cuenta los medibles', R.medidos === 3, String(R.medidos));
chk('y los que no se pudieron medir', R.noMedibles === 2, String(R.noMedibles));
chk('separa los meses cortos', R.cortos.length === 1 && R.cortos[0].mes === '2026-01');
chk('de los que sobran', R.sobran.length === 1 && R.sobran[0].mes === '2026-02');
// el total que falta suma SOLO los cortos: compensarlo con los que sobran
// escondería el faltante detras de un exceso de otro mes
chk('los documentos que faltan no se netean contra los que sobran',
    R.faltanDocs === 20, String(R.faltanDocs));
chk('los totales solo cuentan lo medible',
    R.sapTotal === 800 && R.nuestroTotal === 795, [R.sapTotal, R.nuestroTotal].join());
chk('resumen de nada', C.resumen(null).medidos === 0 && C.resumen([]).faltanDocs === 0);

console.log('\n— el veredicto —');
let v = C.veredicto(C.resumen(C.comparar([{ mes: '2026-01', sap: 500, nuestro: 480 }])));
chk('un mes corto dicta que no', v.nivel === 'no', v.nivel);
chk('y nombra la paginacion, que es la causa a revisar', /paginacion/.test(v.texto), v.texto);
chk('y dice cuantos faltan y donde',
    /faltan 20 en 1 mes/.test(v.texto) && /2026-01/.test(v.texto), v.texto);
v = C.veredicto(C.resumen(C.comparar([{ mes: '2026-01', sap: 500, nuestro: 500 },
                                      { mes: '2026-02', sap: 200, nuestro: 200 }])));
chk('todo cuadrado dicta que si', v.nivel === 'si', v.nivel);
// y si cuadra, el veredicto tiene que decir DONDE buscar entonces
chk('y manda a buscar adentro del documento',
    /DENTRO del documento/.test(v.texto) && /asignaciones/.test(v.texto), v.texto);
v = C.veredicto(C.resumen(C.comparar([{ mes: '2026-01', sap: 100, nuestro: 120 }])));
chk('un blob con mas documentos tambien dicta que no', v.nivel === 'no');
chk('y se explica aparte, no como faltante', /MAS documentos/.test(v.texto), v.texto);
// un mes que no se pudo comparar no es un mes que cuadra: callarlo haria
// leer "todo bien" sobre una muestra incompleta
v = C.veredicto(C.resumen(C.comparar([{ mes: '2026-01', sap: 500, nuestro: 500 },
                                      { mes: '2026-02', sap: null, nuestro: 9 }])));
chk('los meses que no se pudieron comparar se avisan',
    /1 mes\(es\) sin comparar/.test(v.texto), v.texto);
chk('sin nada medible no hay veredicto',
    C.veredicto(C.resumen([])).nivel === 'sin datos' && C.veredicto(null).nivel === 'sin datos');

console.log('\n— opciones —');
chk('--meses acota', C.OPCIONES.indexOf('meses') >= 0);
chk('--entidad y --fecha permiten probar otra coleccion',
    C.OPCIONES.indexOf('entidad') >= 0 && C.OPCIONES.indexOf('fecha') >= 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
