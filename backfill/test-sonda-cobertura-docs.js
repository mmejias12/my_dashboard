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
// nombra las DOS causas posibles, no una: con este dato no se puede elegir
chk('nombra las dos causas posibles',
    /se salta paginas/.test(v.texto) && /fecha vieja/.test(v.texto), v.texto);
chk('y dice como distinguirlas', /re-extraer ese mes y volver a comparar/.test(v.texto), v.texto);
chk('y dice cuantos faltan y donde',
    /FALTAN DOCUMENTOS: 20 en 1 mes/.test(v.texto) && /2026-01/.test(v.texto), v.texto);
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

console.log('\n— lo que explica el reloj —');
// LA MEDICION REAL del 27-10-2026: el blob se guardo a las 23:44Z con 17.255
// documentos y la sonda corrio 16 minutos despues. SAP contaba 2 mas.
const HOY = C.huecoEsperado(17255, '2026-10-01', '2026-10-31',
                            '2026-10-27T23:44:00Z', '2026-10-28T00:00:00Z');
chk('en 16 minutos de octubre caben 8 documentos', HOY === 8, String(HOY));
chk('asi que un hueco de 2 lo explica el reloj', 2 <= HOY);
// Y LA CORRIDA ANTERIOR, con el mismo criterio: hueco de 251 contra 20
// esperados. El mismo calculo que hoy absuelve, ese dia acusa.
const AYER = C.huecoEsperado(17062, '2026-10-01', '2026-10-31',
                             '2026-10-26T17:47:00Z', '2026-10-26T18:30:00Z');
chk('en 43 minutos caben 20', AYER === 20, String(AYER));
chk('y 251 no lo explica el reloj', 251 > AYER);
// un mes CERRADO no recibe nada por el paso del tiempo: lo que crezca ahi hay
// que mirarlo, no perdonarlo
chk('un mes cerrado no perdona nada',
    C.huecoEsperado(18760, '2026-01-01', '2026-01-31',
                    '2026-10-24T22:36:00Z', '2026-10-28T00:00:00Z') === 0);
chk('sin tiempo transcurrido no cabe nada',
    C.huecoEsperado(17255, '2026-10-01', '2026-10-31',
                    '2026-10-27T23:44:00Z', '2026-10-27T23:44:00Z') === 0);
// solo cuenta el rato en que el mes seguia ABIERTO, no todo el rato
chk('despues de que el mes cierra el reloj deja de correr',
    C.huecoEsperado(1000, '2026-09-01', '2026-09-30', '2026-09-15T00:00:00Z', '2026-10-05T00:00:00Z') ===
    C.huecoEsperado(1000, '2026-09-01', '2026-09-30', '2026-09-15T00:00:00Z', '2026-12-05T00:00:00Z'));
// sin dato no se inventa una excusa: null, y el hueco queda sin explicar
chk('sin fecha de guardado no hay excusa',
    C.huecoEsperado(100, '2026-10-01', '2026-10-31', null, '2026-10-28T00:00:00Z') === null);
chk('con fechas basura tampoco',
    C.huecoEsperado(100, 'x', 'y', 'z', 'w') === null && C.huecoEsperado(0, '2026-10-01', '2026-10-31',
      '2026-10-27T23:44:00Z', '2026-10-28T00:00:00Z') === null);
// el ultimo dia del mes TODAVIA es mes abierto: el filtro de SAP lo incluye
const ULT = C.huecoEsperado(17255, '2026-10-01', '2026-10-31',
                            '2026-10-31T10:00:00Z', '2026-10-31T22:00:00Z');
chk('el ultimo dia del mes todavia cuenta como abierto', ULT > 0, String(ULT));
chk('y un cierre dentro del ultimo dia no da el mes por cerrado',
    C.comparar([{ mes:'2026-10', sap:1, nuestro:1, desde:'2026-10-01', hasta:'2026-10-31',
                 guardado:'2026-10-31T10:00:00Z', ahora:'2026-10-31T22:00:00Z' }])[0].cerrado === false);
chk('un reloj al reves no explica nada',
    C.huecoEsperado(100, '2026-10-01', '2026-10-31',
                    '2026-10-28T00:00:00Z', '2026-10-27T00:00:00Z') === null);

console.log('\n— el hueco explicado no se denuncia, el otro si —');
const ABIERTO = [{ mes:'2026-09', sap:19128, nuestro:19128 },
                 { mes:'2026-10', sap:17257, nuestro:17255, desde:'2026-10-01', hasta:'2026-10-31',
                   guardado:'2026-10-27T23:44:00Z', ahora:'2026-10-28T00:00:00Z' }];
let cA = C.comparar(ABIERTO), rA = C.resumen(cA), vA = C.veredicto(rA);
chk('el mes abierto queda marcado como explicado',
    cA.find(x => x.mes === '2026-10').explicado === true, JSON.stringify(cA[1]));
chk('no entra en los cortos', rA.cortos.length === 0 && rA.explicados.length === 1);
chk('y el veredicto no acusa', vA.nivel === 'si', vA.texto);
chk('pero lo dice, no lo esconde', /2026-10 -2/.test(vA.texto), vA.texto);
chk('y avisa que un mes abierto no se puede juzgar por conteo',
    /el mes[\s\S]*siga abierto el conteo no lo puede juzgar/.test(vA.texto), vA.texto);

const ROTO = [{ mes:'2026-10', sap:17313, nuestro:17062, desde:'2026-10-01', hasta:'2026-10-31',
                guardado:'2026-10-26T17:47:00Z', ahora:'2026-10-26T18:30:00Z' }];
let vR = C.veredicto(C.resumen(C.comparar(ROTO)));
chk('un hueco de 251 si se denuncia', vR.nivel === 'no', vR.texto);
chk('y se dice cuanto explicaba el reloj', /explica 20/.test(vR.texto), vR.texto);
// un mes CERRADO con hueco se denuncia aunque el blob sea viejisimo
const CERRADO = [{ mes:'2026-02', sap:18364, nuestro:18000, desde:'2026-02-01', hasta:'2026-02-28',
                   guardado:'2026-02-10T00:00:00Z', ahora:'2026-10-28T00:00:00Z' }];
chk('un mes cerrado con hueco siempre se denuncia',
    C.veredicto(C.resumen(C.comparar(CERRADO))).nivel === 'no');
// y se denuncia por lo que ES: un blob sacado el 10 de febrero no cubre febrero,
// y eso no se discute con una tasa, se re-extrae
chk('y se denuncia como blob incompleto, no como paginacion',
    /BLOB SACADO ANTES DE QUE EL MES CERRARA/.test(C.veredicto(C.resumen(C.comparar(CERRADO))).texto) &&
    !/se salta paginas/.test(C.veredicto(C.resumen(C.comparar(CERRADO))).texto),
    C.veredicto(C.resumen(C.comparar(CERRADO))).texto);
chk('el mes incompleto no se cuenta como faltante',
    C.resumen(C.comparar(CERRADO)).cortos.length === 0 &&
    C.resumen(C.comparar(CERRADO)).incompletos.length === 1);
// y TAMPOCO se da por explicado por el reloj: un blob de media semana del mes
// deja un esperado enorme que perdonaria cualquier hueco
chk('un mes cerrado nunca se da por explicado',
    C.resumen(C.comparar(CERRADO)).explicados.length === 0 &&
    C.comparar(CERRADO)[0].explicado === false,
    JSON.stringify(C.comparar(CERRADO)[0]));
// un mes cerrado con el blob sacado DESPUES del cierre si es un faltante de verdad
const CERRADO_OK = [{ mes:'2026-02', sap:18364, nuestro:18000, desde:'2026-02-01', hasta:'2026-02-28',
                      guardado:'2026-10-24T00:00:00Z', ahora:'2026-10-28T00:00:00Z' }];
chk('con el blob sacado despues del cierre, el hueco es un faltante',
    C.resumen(C.comparar(CERRADO_OK)).cortos.length === 1 &&
    /se salta paginas/.test(C.veredicto(C.resumen(C.comparar(CERRADO_OK))).texto));
chk('el reloj no perdona un mes cerrado',
    C.comparar(CERRADO_OK)[0].explicado === false && C.comparar(CERRADO_OK)[0].cerrado === true);

console.log('\n— opciones —');
chk('--meses acota', C.OPCIONES.indexOf('meses') >= 0);
chk('--entidad y --fecha permiten probar otra coleccion',
    C.OPCIONES.indexOf('entidad') >= 0 && C.OPCIONES.indexOf('fecha') >= 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
