'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const A=require('./armar-tablero-stock.js');

console.log('— formato chileno —');
chk('miles con punto', A.mil(810625) === '810.625', A.mil(810625));
chk('negativo lleva su menos', A.mil(-6488) === '-6.488', A.mil(-6488));
// mil() ya trae el '-': un conSigno ingenuo imprimia '+-6.488'
chk('conSigno no duplica el menos', A.conSigno(-6488) === '-6.488', A.conSigno(-6488));
chk('conSigno agrega el mas', A.conSigno(37511) === '+37.511', A.conSigno(37511));
chk('conSigno de cero no lleva signo', A.conSigno(0) === '0', A.conSigno(0));
chk('un numero que no es numero no se inventa', A.mil(null) === '—' && A.conSigno(undefined) === '—');
chk('porcentaje con coma', A.pct1(212945, 810625) === '26,3%', A.pct1(212945, 810625));
// dividir por cero no da Infinity en la pagina: da un guion
chk('porcentaje sobre cero no es Infinity', A.pct1(5, 0) === '—', A.pct1(5, 0));
chk('clase por signo', A.clasePos(1)==='d-pos' && A.clasePos(-1)==='d-neg' && A.clasePos(0)==='d-nul');

console.log('\n— los nombres vienen de SAP y pueden traer cualquier cosa —');
chk('escapa el ampersand', A.esc('A & B') === 'A &amp; B', A.esc('A & B'));
chk('escapa los angulos', A.esc('<script>') === '&lt;script&gt;', A.esc('<script>'));
chk('escapa la comilla doble', A.esc('di "hola"').includes('&quot;'));
chk('escapa la comilla simple', A.esc("O'Higgins").includes('&#39;'));
chk('un nombre con < no sale crudo a la pagina',
    !A.filaSocio({cod:'C1',nom:'<b>X</b>',nivel:1,cambio:0}).includes('<b>X</b>'));
chk('el BOM de PowerShell se saca', A.sinBom('﻿{"a":1}') === '{"a":1}');
chk('y un texto sin BOM queda igual', A.sinBom('{"a":1}') === '{"a":1}');

console.log('\n— reparto del pool: la bodega manda en cuantos hay —');
const BOD = { generado:'2026-10-25T04:15:44.042Z', bodegas:[
  {whs:'CLIENTES', nombre:'BODEGA CLIENTES', saldo:212945},
  {whs:'RETAIL',   nombre:'BODEGA RETAILERS', saldo:579026},
  {whs:'RT13-100', nombre:'SANTIAGO INSPECCION', saldo:5447},
  {whs:'RT13-103', nombre:'SANTIAGO PINTURA',    saldo:3664},
  {whs:'RT13-266', nombre:'SANTIAGO MERMA',      saldo:2620},
  {whs:'RT13-102', nombre:'SANTIAGO REPARACION', saldo:1711},
  {whs:'RT13-109', nombre:'EXTRAÑOS',            saldo:1544},
  {whs:'RT07-120', nombre:'TALCA INSPECCION',    saldo:1249},
  {whs:'RT13-105', nombre:'SANTIAGO DISPONIBLE', saldo:1231},
  {whs:'RT07-125', nombre:'TALCA DISPONIBLE',    saldo:559},
  {whs:'RT07-123', nombre:'TALCA PINTURA',       saldo:262},
  {whs:'RT04-160', nombre:'COQUIMBO TRANSITO',   saldo:225},
  {whs:'RT07-126', nombre:'TALCA OTRO',          saldo:142},
  {whs:'RT07-122', nombre:'TALCA REPARACION',    saldo:0},
  {whs:'RT14-170', nombre:'ARICA TRANSITO',      saldo:0},
]};
const F = A.clasificarPool(BOD.bodegas);
chk('clientes', F.clientes === 212945, String(F.clientes));
chk('retail', F.retail === 579026, String(F.retail));
chk('planta es todo lo demas, no una lista', F.planta === 18654, String(F.planta));
chk('la identidad cierra', F.total === 810625 && F.total === F.clientes + F.retail + F.planta);
chk('las nueve del indicador', F.nueve === 14265, String(F.nueve));
chk('y lo que queda fuera', F.fuera === 4389, String(F.fuera));
chk('nueve + fuera = planta', F.nueve + F.fuera === F.planta);
// una bodega del indicador en cero SI se muestra: que TALCA REPARACION este
// vacia es informacion. Una que no es del indicador y esta en cero, no.
chk('una del indicador en cero se muestra', F.filas.some(x => x.cod === 'RT07-122'));
chk('una de fuera en cero no se muestra', !F.filas.some(x => x.cod === 'RT14-170'));
chk('ordena de mayor a menor', F.filas[0].cod === 'RT13-100' && F.filas[0].nivel === 5447);
chk('marca cuales son del indicador',
    F.filas.find(x=>x.cod==='RT13-266').nueve === false &&
    F.filas.find(x=>x.cod==='RT13-100').nueve === true);
chk('sin bodegas no revienta', A.clasificarPool(null).total === 0);
// cuantas bodegas hay es un dato, no un numero escrito en la prosa
chk('cuenta las bodegas', F.bodegas === 15, String(F.bodegas));
// un whs con espacios es el mismo whs: SAP los trae a veces
chk('un codigo con espacios se reconoce',
    A.clasificarPool([{whs:' RETAIL ', saldo:10}]).retail === 10);

console.log('\n— el corte de socios —');
const SOC = [
  {cod:'R96829710-4', nom:'WALMART CHILE COMERCIAL', nivel:309016, partida:271505},
  {cod:'R81537600-5', nom:'RENDIC HERMANOS',          nivel:73386,  partida:80814},
  {cod:'R81201000-K', nom:'CENCOSUD RETAIL',          nivel:47732,  partida:53278},
  {cod:'R76473580-3', nom:'EKONO',                    nivel:980,    partida:980},
  {cod:'R00000000-0', nom:'EN CERO',                  nivel:0,      partida:0},
  {cod:'R11111111-1', nom:'RETAIL NO HABILITADO',     nivel:-6488,  partida:0},
];
const C3 = A.cortarSocios(SOC, 3);
chk('el top va ordenado por nivel', C3.top.map(x=>x.cod).join()==='R96829710-4,R81537600-5,R81201000-K');
chk('el año es nivel menos partida', C3.top[0].cambio === 37511, String(C3.top[0].cambio));
chk('un socio en cero no cuenta como con saldo', C3.conSaldo === 5, String(C3.conSaldo));
chk('el resto son los que quedaron', C3.resto.n === 2, String(C3.resto.n));
chk('y suma los dos', C3.resto.nivel === 980 - 6488, String(C3.resto.nivel));
// el negativo no se esconde en la suma del resto: se nombra
chk('los negativos de la cola se nombran',
    C3.resto.negativos.length === 1 && C3.resto.negativos[0].cod === 'R11111111-1');
// uno que cae en el top ya se ve solo en la tabla: no hace falta la nota
chk('un negativo dentro del top no va a la nota',
    A.cortarSocios(SOC, 99).resto.negativos.length === 0);
chk('la nota los dice', /R11111111-1/.test(A.notaImposibles(C3.resto)) &&
    /-6\.488/.test(A.notaImposibles(C3.resto)), String(A.notaImposibles(C3.resto)));
chk('sin negativos no hay nota', A.notaImposibles({negativos:[]}) === null);
chk('un corte mas grande que la lista no rompe', A.cortarSocios(SOC, 99).resto.n === 0);
chk('sin socios tampoco', A.cortarSocios(null, 25).conSaldo === 0);

console.log('\n— concentracion por grupo —');
const G = A.porGrupo(SOC, A.GRUPOS);
chk('WALMART junta sus dos RUT', G.grupos.find(x=>/WALMART/.test(x.nom)).nivel === 309996,
    String(G.grupos.find(x=>/WALMART/.test(x.nom)).nivel));
chk('CENCOSUD con uno solo', G.grupos.find(x=>/CENCOSUD/.test(x.nom)).nivel === 47732);
// el denominador es el pallet ATRIBUIDO, no el saldo de bodega: el residuo no
// es de nadie y meterlo diluiria los porcentajes con algo que no se sabe
chk('la base es la suma de los socios', G.base === 309016+73386+47732+980+0-6488, String(G.base));
chk('un grupo sin ningun RUT presente queda en cero',
    A.porGrupo([{cod:'X', nivel:5}], [{nom:'NADIE', ruts:['R1']}]).grupos[0].nivel === 0);
chk('ordena de mayor a menor', G.grupos[0].nivel >= G.grupos[1].nivel);
chk('cuenta cuantos miembros aparecieron', G.grupos.find(x=>/SMU/.test(x.nom)).miembros === 1);

console.log('\n— meses pareados —');
const M = A.mesesPareados(
  [{mes:'2026-01',neto:2573},{mes:'2026-02',neto:10968}],
  [{mes:'2026-01',neto:-6012},{mes:'2026-03',neto:1409}]);
chk('la union de los meses, no la de uno', M.map(x=>x.mes).join()==='2026-01,2026-02,2026-03');
chk('alinea cada bodega con su mes', M[0].ret===2573 && M[0].cli===-6012);
// si un mes falta en una bodega es CERO, no el del otro mes
chk('un mes que falta es cero', M[1].cli===0 && M[2].ret===0);
chk('etiqueta en castellano', M[0].etiqueta==='Ene' && M[2].etiqueta==='Mar');
chk('un mes mal formado no entra', A.mesesPareados([{mes:'2026-1',neto:5}], []).length===0);
chk('sin meses no revienta', A.mesesPareados(null,null).length===0);

console.log('\n— un dato que falta no es un cero —');
chk('mil(null) es un guion', A.mil(null)==='—', A.mil(null));
chk('mil("") es un guion', A.mil('')==='—', A.mil(''));
chk('mil(0) si es cero', A.mil(0)==='0', A.mil(0));
chk('conSigno(null) es un guion', A.conSigno(null)==='—');
chk('pct con total nulo es nulo', A.pct(5, null)===null);
chk('mil de un string numerico funciona', A.mil('810625')==='810.625');

console.log('\n— geometria de la barra del pool —');
const D1 = A.datos(BOD, {socios:SOC, nivel:{bodega:579026, socios:424626, residuo:34063}, mensual:[], ventana:{}},
                        {socios:[], nivel:{bodega:212945, socios:211905, residuo:1040}, mensual:[], ventana:{}}, null);
const SV = A.svgPool(D1);
// cada tramo ocupa su porcentaje de 1000 MENOS 2 de separacion; sin esa
// separacion los tres colores se tocan y el ojo lee un solo bloque
chk('el tramo de clientes', /class="s-cli" x="0\.00" .*width="260\.69"/.test(SV), SV.slice(0,160));
chk('el de retail arranca donde termina el anterior', /class="s-ret" x="262\.69" .*width="712\.30"/.test(SV));
chk('y el de planta cierra', /class="s-pla" x="976\.99" .*width="21\.01"/.test(SV));
chk('cada tramo trae su tooltip con cifra y porcentaje',
    /<title>Clientes: 212\.945 \(26,3%\)<\/title>/.test(SV));
// el title tiene que estar DENTRO del rect o no es tooltip de nada
chk('el title va dentro del rect', /<rect[^>]*><title>/.test(SV) && !/\/><title>/.test(SV));
chk('un pool en cero no da anchos negativos', !/width="-/.test(A.svgPool(
    A.datos({bodegas:[]}, {socios:[],nivel:{},mensual:[],ventana:{}}, {socios:[],nivel:{},mensual:[],ventana:{}}, null))));

console.log('\n— geometria de las barras mensuales —');
const MESES10 = A.mesesPareados(
  [{mes:'2026-01',neto:2573},{mes:'2026-02',neto:10968},{mes:'2026-03',neto:9086},
   {mes:'2026-04',neto:-797},{mes:'2026-05',neto:1964},{mes:'2026-06',neto:2398},
   {mes:'2026-07',neto:8993},{mes:'2026-08',neto:2365},{mes:'2026-09',neto:-1791},
   {mes:'2026-10',neto:679}],
  [{mes:'2026-01',neto:-6012},{mes:'2026-02',neto:-1887},{mes:'2026-03',neto:1409},
   {mes:'2026-04',neto:12343},{mes:'2026-05',neto:3586},{mes:'2026-06',neto:2353},
   {mes:'2026-07',neto:-6288},{mes:'2026-08',neto:7053},{mes:'2026-09',neto:9907},
   {mes:'2026-10',neto:2649}]);
const SM = A.svgMeses(MESES10);
chk('la linea de arriba es el maximo',
    /y1="14\.0"[^>]*\/><text[^>]*>\+12\.343</.test(SM), 'no');
chk('el cero cae en su lugar', />0<\/text>/.test(SM) && /y1="139\.9"/.test(SM));
chk('la linea de abajo es el minimo', /y1="204\.0"/.test(SM) && />-6\.288</.test(SM));
chk('la primera barra de retail', /class="b-ret" x="62\.8" y="113\.6" width="24" height="26\.2"/.test(SM),
    (SM.match(/class="b-ret"[^>]*/)||[''])[0]);
// un mes negativo tiene que CAER del cero, no crecer desde el borde
chk('un mes negativo arranca en el cero',
    /class="b-cli" x="91\.8" y="139\.9" width="24" height="61\.3"/.test(SM),
    (SM.match(/class="b-cli"[^>]*/)||[''])[0]);
chk('las etiquetas de mes van centradas', /x="89\.3" y="222" text-anchor="middle">Ene</.test(SM));
chk('estan los doce meses que hay', (SM.match(/text-anchor="middle"/g)||[]).length === 10);
chk('sin meses no dibuja nada', A.svgMeses([]) === '' && A.svgMeses(null) === '');
// todo positivo: no debe haber linea de minimo negativa
chk('todo positivo no inventa una linea negativa',
    (A.svgMeses(A.mesesPareados([{mes:'2026-01',neto:10}],[{mes:'2026-01',neto:20}]))
      .match(/class="grid"/g)||[]).length === 2);

console.log('\n— la pagina —');
const PG = A.pagina(D1);
chk('es un documento completo', /^<!doctype html>/.test(PG) && /<\/html>\s*$/.test(PG));
chk('trae su hoja de estilo adentro', PG.includes('--marca:#b5342a'));
chk('declara el titulo', /<title>Stock y Flujos de Pallets<\/title>/.test(PG));
chk('el pool sale del dato', PG.includes('>810.625<'));
chk('la cantidad de bodegas tambien', PG.includes('en las 15 bodegas de la empresa'));
chk('el residuo de retail tambien', PG.includes('residuo sin ubicación: 34.063'));
chk('el aviso usa el residuo de hoy, no uno escrito a mano',
    /34\.063 pallets de BODEGA RETAILERS sin retailer identificado/.test(PG) &&
    /\(5,9% del retail\)/.test(PG));
// la hora que se muestra es la de la LECTURA de SAP, no la de la corrida:
// decir "pagina generada" al lado de la hora del dato lo hace pasar por fresco
chk('dice cuando se leyo SAP', /Saldo de bodega leído de SAP el 2026-10-25 04:15 UTC/.test(PG),
    (PG.match(/leído de SAP[^.]*/)||[''])[0]);
chk('y que ninguna cifra esta a mano', /ninguna cifra está escrita a mano/.test(PG));
// sin tablero-extra.json esas secciones NO se dibujan: un hueco visible es
// mejor que una cifra de hace un mes presentada como de hoy
chk('sin extra no aparece el flujo por bodega', !PG.includes('Flujo del año por bodega'));
chk('sin extra no aparecen los controles', !PG.includes('<h3>Controles</h3>'));
chk('con extra si aparece el flujo', A.pagina(A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
    {medido:'2026-10-26', flujo_por_bodega:[['RETAIL','BODEGA RETAILERS',1053631,1017877]],
     controles:[{titulo:'Cobertura', texto:'190.590 y 190.590'}]}))
    .includes('Flujo del año por bodega'));

console.log('\n— la nota del gráfico mensual puede estar resuelta —');
const NOTA = (extra) => A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[{mes:'2026-01',neto:5}],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[{mes:'2026-01',neto:5}],ventana:{}}, extra));
const ENV = NOTA({mensual_nota:'falta zanjar cual columna'});
chk('por omisión sigue diciendo en verificación',
    /<div class="enrevision"><b>En verificación\.<\/b> falta zanjar/.test(ENV), ENV.slice(0,0));
const VER = NOTA({mensual_nota:'quedó zanjado contra M2LINK', mensual_verificado:true});
chk('marcada como verificada cambia el cartel',
    /<div class="resuelto"><b>Verificado\.<\/b> quedó zanjado/.test(VER));
chk('y ya no grita en verificación', !/En verificación/.test(VER), VER.slice(0,0));
// la bandera sin nota no dibuja nada: no hay cartel vacío
chk('la bandera sola no dibuja cartel',
    !/class="resuelto"/.test(NOTA({mensual_verificado:true})));
chk('un valor raro en la bandera no verifica',
    /class="enrevision"/.test(NOTA({mensual_nota:'x', mensual_verificado:0})));

console.log('\n— un control puede NO pasar, y entonces se dice —');
// el titulo era "Controles que paso": un panel que solo sabe decir que todo
// esta bien miente el dia que algo deja de estarlo, y ese dia llego
const EST = A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
  {medido:'2026-10-27', controles:[
    {titulo:'Conservación', texto:'subió 1.030', estado:'no pasa', medido:'2026-10-27'},
    {titulo:'Cobertura', texto:'cuadra'}]}));
chk('el titulo ya no afirma que todos pasaron',
    EST.includes('<h3>Controles</h3>') && !EST.includes('Controles que pasó'));
chk('el que no pasa se marca', /<dt class="malo">Conservación · NO PASA<\/dt>/.test(EST),
    (EST.match(/<dt[^>]*>Conservación[^<]*</)||[''])[0]);
chk('y el que pasa no lleva marca', /<dt>Cobertura<\/dt>/.test(EST) && !/Cobertura · NO PASA/.test(EST));
chk('un estado desconocido no marca nada', !/NO PASA/.test(A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
  {controles:[{titulo:'X', texto:'y', estado:'mas o menos'}]}))));

console.log('\n— el desglose del residuo envejece y se avisa —');
// el residuo se recalcula todos los dias; el desglose no. Cuando dejan de
// sumar lo mismo hay que decirlo, no dejar que el lector descubra dos cifras
// que no cuadran y no sepa cual creer.
const DES = (det, nivRet, socRet) => A.pagina(A.datos(BOD,
  {socios:[{cod:'R1',nivel:socRet}], nivel:{bodega:nivRet, socios:socRet, residuo:nivRet-socRet},
   mensual:[], ventana:{}},
  {socios:[], nivel:{bodega:212945, socios:212945, residuo:0}, mensual:[], ventana:{}},
  {medido:'2026-10-26', residuo_detalle:det}));
// cuadra: no se dice nada
const CUA = DES([{cantidad:600, que:'en la ubicación de sistema'},
                 {cantidad:400, que:'en RETAIL NA'}], 579026, 578026);
chk('cuando el desglose suma el residuo no hay aviso', !/de diferencia/.test(CUA));
chk('y el desglose igual sale', /600<\/dt><dd>en la ubicación de sistema/.test(CUA));
// no cuadra: se dice, con la resta hecha
const NOC = DES([{cantidad:600, que:'en la ubicación de sistema'},
                 {cantidad:400, que:'en RETAIL NA'}], 579026, 578226);
chk('cuando no suma, se avisa con las dos cifras',
    /El desglose suma <b>1.000<\/b> y el residuo de hoy es <b>800<\/b>/.test(NOC),
    (NOC.match(/El desglose suma[^<]*<b>[^<]*<\/b>[^<]*<b>[^<]*<\/b>[^.]*/)||[''])[0]);
chk('y con la diferencia firmada', /: -200 de diferencia/.test(NOC));
// OJO: '-200' contiene '200'; hay que mirar el signo, no el numero suelto
chk('la resta va en el sentido correcto', !/: \+200 de diferencia/.test(NOC));
chk('cada parte del desglose lleva su fecha',
    /en RETAIL NA <span class="fecha">medido el 2026-10-26<\/span>/.test(NOC));
chk('y una parte con fecha propia la usa',
    /<span class="fecha">medido el 2026-10-20<\/span>/.test(
      DES([{cantidad:800, que:'x', medido:'2026-10-20'}], 579026, 578226)));

console.log('\n— cada control con su propia fecha —');
// Se habian mezclado controles medidos en dias distintos bajo un unico
// "medidos al ...". El que se recalcula hoy no puede leerse tan viejo como el
// que no se toca hace una semana.
const CTL = A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
  {medido:'2026-10-26', controles:[
    {titulo:'Cobertura', texto:'cuadra', medido:'2026-10-27'},
    {titulo:'Segunda fuente', texto:'coincide'}]}));
chk('el control con fecha propia la muestra',
    /cuadra <span class="fecha">medido el 2026-10-27<\/span>/.test(CTL),
    (CTL.match(/cuadra[^<]*<span[^>]*>[^<]*</)||[''])[0]);
chk('el que no la trae cae en la del archivo',
    /coincide <span class="fecha">medido el 2026-10-26<\/span>/.test(CTL));
// la fecha de cada uno reemplaza al pie que decia una sola para todos
chk('ya no hay un pie con una sola fecha para todos', !/Medidos al /.test(CTL), CTL.slice(0,0));
const SF = A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
  {controles:[{titulo:'X', texto:'y'}]}));
chk('sin ninguna fecha lo dice, no se la inventa',
    /y <span class="fecha">medido el sin fecha<\/span>/.test(SF));
chk('la fecha tambien se escapa', A.pagina(A.datos(BOD,
  {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
  {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
  {controles:[{titulo:'X', texto:'y', medido:'<b>hoy</b>'}]})).includes('&lt;b&gt;hoy&lt;/b&gt;'));

console.log('\n— el descalce entre la sonda y el ancla no se esconde —');
const DD = A.datos(BOD, {socios:SOC, nivel:{bodega:579000}, mensual:[], ventana:{}},
                        {socios:[], nivel:{bodega:212945}, mensual:[], ventana:{}}, null);
chk('se detecta', DD.descalces.length === 1, JSON.stringify(DD.descalces));
chk('dice las dos cifras', /579\.026/.test(DD.descalces[0]) && /579\.000/.test(DD.descalces[0]));
chk('y sale en la pagina', A.pagina(DD).includes('Lecturas que no coinciden'));
chk('cuando cuadran no hay aviso', D1.descalces.length === 0 &&
    !A.pagina(D1).includes('Lecturas que no coinciden'));
// un ancla ausente no es un descalce: es otra cosa, y no se inventa
chk('un ancla ausente no cuenta como descalce',
    A.datos(BOD, {socios:SOC,nivel:{},mensual:[],ventana:{}},
                 {socios:[],nivel:{},mensual:[],ventana:{}}, null).descalces.length === 0);

console.log('\n— opciones —');
chk('lee una opcion', A.opcion('bodegas','x',['--bodegas=data/b.json'])==='data/b.json');
chk('sin la opcion queda el defecto', A.opcion('bodegas','x',[])==='x');
chk('una opcion desconocida se delata', A.opcionesRaras(['--bodegaz=a']).length===1);
chk('las conocidas no', A.opcionesRaras(['--bodegas=a','--salida=b']).length===0);

console.log('\n— lo que el orden de los datos de prueba estaba tapando —');
// un saldo fraccionario tiene que redondearse, no imprimirse con coma
chk('mil redondea', A.mil(1234.6)==='1.235' && A.mil(1234.4)==='1.234', A.mil(1234.6));
// los socios NO vienen ordenados de SAP: si el orden lo trae la entrada, la
// prueba anterior pasaba igual sin el sort
const DESORDEN = [
  {cod:'C3', nom:'TRES',  nivel:30,  partida:0},
  {cod:'C1', nom:'UNO',   nivel:100, partida:0},
  {cod:'C2', nom:'DOS',   nivel:50,  partida:0},
];
chk('ordena socios que llegan desordenados',
    A.cortarSocios(DESORDEN, 3).top.map(x=>x.cod).join()==='C1,C2,C3',
    A.cortarSocios(DESORDEN, 3).top.map(x=>x.cod).join());
chk('y el corte se queda con los mas grandes',
    A.cortarSocios(DESORDEN, 1).top[0].cod==='C1' && A.cortarSocios(DESORDEN, 1).resto.nivel===80);
// lo mismo con los grupos: la tabla de GRUPOS esta declarada de mayor a menor
// por casualidad del dato de hoy, no por construccion
const GD = A.porGrupo([{cod:'X', nivel:10},{cod:'Y', nivel:900}],
                      [{nom:'CHICO', ruts:['X']}, {nom:'GRANDE', ruts:['Y']}]);
chk('ordena grupos declarados al reves', GD.grupos[0].nom==='GRANDE', GD.grupos[0].nom);
// y con los meses
const MD = A.mesesPareados([{mes:'2026-03',neto:3},{mes:'2026-01',neto:1}],
                           [{mes:'2026-02',neto:2}]);
chk('ordena meses que llegan desordenados', MD.map(x=>x.mes).join()==='2026-01,2026-02,2026-03',
    MD.map(x=>x.mes).join());

console.log('\n— el aviso sale del dato, no de un numero escrito —');
const OTRO = A.datos(BOD, {socios:SOC, nivel:{bodega:579026, socios:500000, residuo:12345}, mensual:[], ventana:{}},
                          {socios:[], nivel:{bodega:212945, socios:211905, residuo:1040}, mensual:[], ventana:{}}, null);
const PO = A.pagina(OTRO);
chk('el aviso usa el residuo que vino', PO.includes('12.345 pallets de BODEGA RETAILERS'));
chk('y no el de ayer', !PO.includes('34.063 pallets de BODEGA RETAILERS'));
chk('el porcentaje se recalcula', PO.includes('(2,1% del retail)'), 'no');
// con residuo cero no hay nada que avisar
chk('sin residuo no hay aviso', !A.pagina(A.datos(BOD,
    {socios:SOC, nivel:{bodega:579026, socios:579026, residuo:0}, mensual:[], ventana:{}},
    {socios:[], nivel:{bodega:212945}, mensual:[], ventana:{}}, null)).includes('Lo que falta resolver'));

console.log('\n— el descalce se mira en las dos bodegas —');
const DC = A.datos(BOD, {socios:SOC, nivel:{bodega:579026}, mensual:[], ventana:{}},
                        {socios:[], nivel:{bodega:200000}, mensual:[], ventana:{}}, null);
chk('un descalce solo en clientes se detecta', DC.descalces.length===1 &&
    /CLIENTES/.test(DC.descalces[0]), JSON.stringify(DC.descalces));
chk('y sale en la pagina', A.pagina(DC).includes('Lecturas que no coinciden'));

console.log('\n— la nota de contraste del aviso —');
const CON = A.datos(BOD, {socios:SOC, nivel:{bodega:579026, socios:544963, residuo:34063}, mensual:[], ventana:{}},
                         {socios:[], nivel:{bodega:212945}, mensual:[], ventana:{}},
                         {medido:'2026-10-25', aviso_nota:'Datawalt deja 35.565 sin atribuir.'});
const PC = A.pagina(CON);
chk('la nota sale en el aviso', PC.includes('Datawalt deja 35.565 sin atribuir.'));
// va ANTES de la pregunta abierta: primero el contraste, despues la pregunta
// Va ENTRE el parrafo del residuo y la pregunta abierta, y una sola vez:
// comparar solo el primer indice deja pasar una copia extra mas arriba.
chk('va una sola vez y dentro del aviso',
    (PC.match(/Datawalt deja 35\.565 sin atribuir\./g) || []).length === 1 &&
    PC.indexOf('Datawalt deja') > PC.indexOf('sin retailer identificado'),
    String((PC.match(/Datawalt deja/g)||[]).length));
chk('sin nota el aviso sigue entero',
    A.pagina(D1).includes('sin retailer identificado') && !A.pagina(D1).includes('Datawalt'));
// una nota vacia o de puro espacio no deja un parrafo en blanco
chk('una nota vacia no se dibuja', A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}}, {aviso_nota:'   '}).aviso_nota === null);
chk('y se escapa como todo lo demas', A.pagina(A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026,residuo:10},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
    {aviso_nota:'<b>x</b>'})).includes('&lt;b&gt;x&lt;/b&gt;'));

console.log('\n— frescura: la pagina tiene que delatar su propia antiguedad —');
chk('el mismo dia no avisa', A.antiguedad('2026-10-25','2026-10-25').texto === null);
// un dia de atraso es lo NORMAL: el tablero muestra el cierre de ayer
chk('un dia de atraso tampoco', A.antiguedad('2026-10-25','2026-10-26').texto === null);
chk('dos dias ya avisa', A.antiguedad('2026-10-25','2026-10-27').nivel === 'atrasado');
chk('y dice cuantos', /Hace 2 días/.test(A.antiguedad('2026-10-25','2026-10-27').texto));
chk('muchos dias escala a grave', A.antiguedad('2026-10-25','2026-11-05').nivel === 'viejo');
chk('y nombra la causa', /no está corriendo/.test(A.antiguedad('2026-10-25','2026-11-05').texto));
// una fecha futura no es frescura: es un reloj o un dato mal puesto
chk('una fecha futura se delata', A.antiguedad('2026-10-25','2026-10-20').nivel === 'futuro');
chk('una fecha ilegible no se adivina', A.antiguedad('ayer','2026-10-25').nivel === 'desconocido');
chk('sin fecha tampoco', A.antiguedad(null,'2026-10-25').dias === null);
chk('cruza el cambio de mes', A.antiguedad('2026-09-30','2026-10-02').dias === 2);
chk('y el cambio de año', A.antiguedad('2025-12-31','2026-01-02').dias === 2);

console.log('\n— la fecha va embebida y la cuenta la hace el navegador —');
chk('el sello lleva la fecha como dato', /<div class="sello" data-medido="2026-10-25"/.test(PG),
    (PG.match(/<div class="sello"[^>]*/)||[''])[0]);
chk('hay un contenedor para el aviso', /<div class="rancio" id="rancio" hidden>/.test(PG));
chk('va antes de la cabecera, no al final', PG.indexOf('id="rancio"') < PG.indexOf('<h1>'));
// la pagina embebe la MISMA funcion probada aca: si se escribiera a mano una
// copia para el navegador, las dos podrian divergir sin que nadie lo note
chk('la pagina embebe la funcion probada', PG.includes(A.antiguedad.toString()));
chk('el script cierra bien la etiqueta', PG.includes('<\/script>') && !PG.includes('</script></script>'));
chk('el script va dentro de un bloque script', PG.indexOf('function antiguedad') > PG.indexOf('<script>'));
// si el navegador falla, la pagina tiene que seguir siendo legible
chk('el aviso arranca oculto', /id="rancio" hidden/.test(PG));
chk('el script esta envuelto en try', /try \{[\s\S]*catch \(e\)/.test(PG.slice(PG.indexOf('(function () {'))));

console.log('\n— la marca de verificacion del grafico mensual —');
const REV = A.datos(BOD,
  {socios:SOC, nivel:{bodega:579026}, mensual:[{mes:'2026-01',neto:5}], ventana:{}},
  {socios:[], nivel:{bodega:212945}, mensual:[{mes:'2026-01',neto:7}], ventana:{}},
  {medido:'2026-10-26', mensual_nota:'El reparto entre meses no esta corroborado.'});
const PR = A.pagina(REV);
chk('la marca sale en la pagina', PR.includes('El reparto entre meses no esta corroborado.'));
chk('dice que esta en verificacion', PR.includes('<b>En verificación.</b>'));
// tiene que estar JUNTO al grafico, no al pie: quien mira las barras la ve
// OJO: 'enrevision' tambien esta en la hoja de estilo, asi que buscar la
// palabra suelta da siempre verdadero. Hay que buscar el div.
const DIV = '<div class="enrevision">';
chk('va dentro de la seccion del movimiento mensual',
    PR.indexOf('Movimiento neto por mes') < PR.indexOf(DIV) &&
    PR.indexOf(DIV) < PR.indexOf('Quién tiene los pallets'));
chk('va antes del grafico, no despues',
    PR.indexOf(DIV) < PR.indexOf('<svg viewBox="0 0 760'));
chk('sin nota no aparece el cartel', !A.pagina(D1).includes(DIV));
chk('una nota en blanco no deja el cartel vacio', A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
    {mensual_nota:'  '}).mensual_nota === null);
chk('se escapa como todo lo demas', A.pagina(A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026},mensual:[{mes:'2026-01',neto:5}],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
    {mensual_nota:'<b>x</b>'})).includes('&lt;b&gt;x&lt;/b&gt;'));
// sin meses no hay seccion, asi que tampoco marca
chk('sin grafico no hay marca', !A.pagina(A.datos(BOD,
    {socios:SOC,nivel:{bodega:579026},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:212945},mensual:[],ventana:{}},
    {mensual_nota:'algo'})).includes(DIV));

console.log('\n— el residuo tiene nombre, no es un misterio —');
const EXTRA_RES = {medido:'2026-10-26', sistemico:17890, residuo_detalle:[
  {cantidad:17890, que:'en la ubicación de sistema de la bodega.'},
  {cantidad:17620, que:'en la ubicación RETAIL NA / NO HABILITADO.'}]};
const DRES = A.datos(BOD, {socios:SOC, nivel:{bodega:579026, socios:544963, residuo:34063}, mensual:[], ventana:{}},
                          {socios:[], nivel:{bodega:212945}, mensual:[], ventana:{}}, EXTRA_RES);
const PRES = A.pagina(DRES);
chk('el desglose aparece', PRES.includes('17.890') && PRES.includes('17.620'));
chk('con su explicacion', PRES.includes('ubicación RETAIL NA / NO HABILITADO.'));
// 17.890 tambien sale arriba, en el pool: hay que mirar la fila del desglose
chk('va dentro del aviso',
    PRES.indexOf('sin retailer identificado') < PRES.indexOf('<dt>17.890</dt>'));
// una partida sin cantidad valida no se dibuja a medias
chk('una partida sin cantidad se descarta',
    A.datos(BOD,{socios:SOC,nivel:{bodega:1,residuo:1},mensual:[],ventana:{}},
                {socios:[],nivel:{bodega:1},mensual:[],ventana:{}},
                {residuo_detalle:[{que:'sin numero'},{cantidad:5,que:'ok'}]}).residuo_detalle.length === 1);
chk('una partida sin texto tambien', A.datos(BOD,
    {socios:SOC,nivel:{bodega:1,residuo:1},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:1},mensual:[],ventana:{}},
    {residuo_detalle:[{cantidad:5}]}).residuo_detalle.length === 0);
chk('sin desglose el aviso sigue entero', A.pagina(D1).includes('sin retailer identificado'));
chk('el texto del desglose se escapa', A.pagina(A.datos(BOD,
    {socios:SOC,nivel:{bodega:1,residuo:1},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:1},mensual:[],ventana:{}},
    {residuo_detalle:[{cantidad:5,que:'<b>x</b>'}]})).includes('&lt;b&gt;x&lt;/b&gt;'));

console.log('\n— lo sistemico no es pool —');
chk('se declara cuanto no rota', DRES.sistemico === 17890);
chk('la pagina lo dice', PRES.includes('17.890</b> son sistémicos y no rotan'));
// OJO con includes: '-792.735' CONTIENE '792.735', asi que una resta al reves
// pasaria desapercibida. Hay que mirar la etiqueta completa.
chk('y calcula el pool en rotacion',
    PRES.includes('el pool en rotación es <b>792.735</b>') && !PRES.includes('<b>-792.735</b>'),
    (PRES.match(/el pool en rotación es <b>[^<]*<\/b>/)||[''])[0]);
// sin el dato declarado no se inventa un pool en rotacion
chk('sin declararlo no aparece', D1.sistemico === null && !A.pagina(D1).includes('no rotan'));
chk('un sistemico no numerico no cuenta', A.datos(BOD,
    {socios:SOC,nivel:{bodega:1},mensual:[],ventana:{}},
    {socios:[],nivel:{bodega:1},mensual:[],ventana:{}}, {sistemico:'mucho'}).sistemico === null);

console.log('\n— la distribucion diaria de planta, entrada opcional —');
const PLA = { ancla:'2026-10-29T14:00:00Z', ancla_al_dia:true, meses:['2026-09','2026-10'], bodegas:[
  { whs:'RT13-105', nombre:'SANTIAGO DISPONIBLE', indicador:true, nivel:1730, dias:[
    { dia:'2026-10-27', apertura:1160, entradas:3000, salidas:2556, cierre:1604, firme:true },
    { dia:'2026-10-26', apertura:-678, entradas:8114, salidas:6276, cierre:1160, firme:true } ] },
  { whs:'RT13-100', nombre:'SANTIAGO INSPECCION', indicador:true, nivel:5758, dias:[
    { dia:'2026-10-27', apertura:1616, entradas:3845, salidas:3471, cierre:1990, firme:true },
    { dia:'2026-10-28', apertura:1990, entradas:4411, salidas:643, cierre:5758, firme:false } ] },
  { whs:'RT13-266', nombre:'SANTIAGO MERMA', indicador:false, nivel:2620, dias:[
    { dia:'2026-10-27', apertura:2600, entradas:20, salidas:0, cierre:2620, firme:true } ] },
  { whs:'RT13-109', nombre:'SANTIAGO EXTRANOS', indicador:false, nivel:1544, dias:[] },
  { whs:'RT04-160', nombre:'COQUIMBO TRANSITO', indicador:false, nivel:225, dias:[
    { dia:'2026-10-26', apertura:225, entradas:266, salidas:266, cierre:225, firme:true } ] } ] };
const SP = A.serieDePlanta(PLA);
// Mauro, 30-10-2026: solo las nueve del indicador. Merma, extranos y transito
// estan en el pool pero su nivel no se mueve por el recorrido del pallet.
chk('solo entran las nueve del indicador',
    SP.map(x => x.cod).join(',') === 'RT13-100,RT13-105', SP.map(x => x.cod).join(','));
chk('la merma no entra', !SP.some(x => x.cod === 'RT13-266'));
chk('el transito de Coquimbo tampoco', !SP.some(x => x.cod === 'RT04-160'));
// el orden es el del recorrido del pallet: inspeccion antes que disponible
chk('van en el orden del recorrido, no alfabetico',
    SP[0].cod === 'RT13-100' && SP[1].cod === 'RT13-105', SP.map(x => x.nom).join(' | '));
chk('cada bodega trae sus dias ordenados por fecha',
    SP[1].dias.map(d => d.dia).join(',') === '2026-10-26,2026-10-27', SP[1].dias.map(d => d.dia).join(','));
chk('y las cuatro cifras del dia', SP[0].dias[0].apertura === 1616 && SP[0].dias[0].entradas === 3845 &&
    SP[0].dias[0].salidas === 3471 && SP[0].dias[0].cierre === 1990);
// el dia en curso tiene que seguir marcado: su cierre todavia se mueve
chk('el dia en curso llega marcado', SP[0].dias[1].firme === false && SP[0].dias[0].firme === true);
chk('una bodega del indicador sin dias no deja una fila vacia',
    A.serieDePlanta({ bodegas:[{ whs:'RT13-100', nombre:'X', dias:[] }] }).length === 0);
chk('un dia mal fechado no entra',
    A.serieDePlanta({ bodegas:[{ whs:'RT13-100', nombre:'X',
      dias:[{ dia:'28-10-2026', cierre:1 }, { dia:'2026-10-28', cierre:2, firme:true }] }] })[0].dias.length === 1);
chk('sin json no revienta', A.serieDePlanta(null).length === 0 && A.serieDePlanta({}).length === 0);
// el codigo viene de SAP: un espacio de mas no puede dejar fuera a una bodega
chk('un codigo con espacios igual entra',
    A.serieDePlanta({ bodegas:[{ whs:' RT13-100 ', nombre:'X',
      dias:[{ dia:'2026-10-28', cierre:2, firme:true }] }] }).length === 1);
// ESTA es la que importa para el orden: en Santiago y Talca el codigo sube
// junto con el recorrido, asi que ordenar por codigo da lo mismo DENTRO de
// una planta. Mezclando las dos no: RT07-125 es DISPONIBLE y va al final
// aunque su codigo sea menor que el de SANTIAGO INSPECCION.
const MIX = A.serieDePlanta({ bodegas:[
  { whs:'RT07-125', nombre:'TALCA DISPONIBLE', dias:[{ dia:'2026-10-27', cierre:1, firme:true }] },
  { whs:'RT13-100', nombre:'SANTIAGO INSPECCION', dias:[{ dia:'2026-10-27', cierre:1, firme:true }] } ] });
chk('el recorrido manda sobre el codigo de bodega',
    MIX.map(x => x.cod).join(',') === 'RT13-100,RT07-125', MIX.map(x => x.cod).join(','));

console.log('\n— el ancla de la serie y la del tablero tienen que ser la misma —');
// si no, los cierres diarios no son los mismos numeros que el saldo por
// bodega de mas arriba y la pagina se contradice sola
chk('misma fecha y declarada al dia, calza',
    A.anclaCalza({ ancla:'2026-10-29T14:00:00Z', ancla_al_dia:true }, { generado:'2026-10-29T09:00:00Z' }).ok === true);
// Que las dos fechas coincidan NO basta: las dos salen del mismo
// bodegas-hoy.json, asi que una serie calculada con lineas mas nuevas que el
// ancla declara la misma fecha y viene corrida igual. saldo-planta lo sabe y
// lo escribe; aca se exige.
const COR = A.anclaCalza({ ancla:'2026-10-28T17:41:00Z', ancla_al_dia:false }, { generado:'2026-10-28T17:41:00Z' });
chk('misma fecha pero marcada como corrida: no se dibuja', COR.ok === false, JSON.stringify(COR));
chk('y dice que saldo-planta la marco', /marcó como corrida/.test(COR.motivo), COR.motivo);
// fallar cerrado: un json viejo que no declara el campo tampoco pasa
const VIE = A.anclaCalza({ ancla:'2026-10-29T14:00:00Z' }, { generado:'2026-10-29T09:00:00Z' });
chk('un json sin ancla_al_dia tampoco pasa', VIE.ok === false, JSON.stringify(VIE));
chk('y dice que falta el campo', /no trae ancla_al_dia/.test(VIE.motivo), VIE.motivo);
const AM = A.anclaCalza({ ancla:'2026-10-28T17:41:00Z', ancla_al_dia:true }, { generado:'2026-10-29T14:39:00Z' });
chk('distinta fecha, no calza', AM.ok === false);
chk('y dice las dos fechas', /2026-10-28/.test(AM.motivo) && /2026-10-29/.test(AM.motivo), AM.motivo);
chk('sin ancla en la serie lo dice', /serie de planta no trae ancla/.test(A.anclaCalza({ ancla_al_dia:true }, { generado:'2026-10-29' }).motivo));
chk('sin fecha en el tablero lo dice', /tablero no trae fecha/.test(A.anclaCalza({ ancla:'2026-10-29', ancla_al_dia:true }, {}).motivo));
chk('sin nada no revienta', A.anclaCalza(null, null).ok === false);
// dos textos iguales que NO son fechas no son un ancla que calce: sin fecha
// no hay nada que comparar y hay que decirlo
chk('dos valores iguales que no son fechas no calzan',
    A.anclaCalza({ ancla:'hoy', ancla_al_dia:true }, { generado:'hoy' }).ok === false,
    JSON.stringify(A.anclaCalza({ ancla:'hoy', ancla_al_dia:true }, { generado:'hoy' })));

console.log('\n— datos() con y sin la planta —');
const VAC = { socios:[], nivel:{}, mensual:[], ventana:{} };
chk('sin planta la seccion queda en null', A.datos(BOD, VAC, VAC, null).planta_dias === null);
const DP = A.datos(BOD, VAC, VAC, null, PLA);
chk('con planta vienen las dos bodegas del indicador', DP.planta_dias.length === 2, DP.planta_dias.length);
chk('y el ancla y los meses para poder rotularla',
    DP.planta_ancla === '2026-10-29T14:00:00Z' && DP.planta_meses.join(',') === '2026-09,2026-10');
// el paso 2 es solo la cañeria: la pagina todavia no dibuja nada con esto
chk('la pagina sigue saliendo igual con o sin planta',
    A.pagina(A.datos(BOD, VAC, VAC, null)) === A.pagina(DP));

console.log('\n' + ok + ' ok, ' + fail + ' fallas');
process.exit(fail ? 1 : 0);
