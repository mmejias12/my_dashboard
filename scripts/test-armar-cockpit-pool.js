'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const A=require('./armar-cockpit-pool.js');
const T=require('./armar-tablero-stock.js');
// El script publicado lleva dentro el CODIGO de tarjetaHtml, asi que contar
// 'data-kpi=' o 'fuera-de-filtro' sobre la pagina entera cuenta tambien la
// funcion que los escribe. Lo que se mide es el html, no su generador.
const soloCuerpo = t => t.slice(0, t.indexOf('<script>'));


// Una serie chica pero con los casos que importan: una bodega sana, una con
// pocos dias malos, una con la mitad o mas, y una sin dias.
const dia=(d,ap,e,s,ci,f)=>({dia:d,apertura:ap,entradas:e,salidas:s,cierre:ci,firme:f!==false});
const SERIE=[
  { cod:'RT13-100', nom:'SANTIAGO INSPECCION', nivel:3455, dias:[
    dia('2026-10-01',10,0,20,-10), dia('2026-10-02',-10,30,0,20), dia('2026-10-03',20,0,25,-5) ] },
  { cod:'RT13-102', nom:'SANTIAGO REPARACION', nivel:4103, dias:[
    dia('2026-10-01',100,50,20,130), dia('2026-10-02',130,10,40,100) ] },
  { cod:'RT07-125', nom:'TALCA DISPONIBLE', nivel:319, dias:[
    dia('2026-10-01',5,0,10,-5), dia('2026-10-02',-5,30,0,25), dia('2026-10-03',25,5,0,30),
    dia('2026-10-06',30,0,0,30) ] },
  { cod:'RT07-126', nom:'TALCA TRANSITO', nivel:0, dias:[] },
];
// Las cuatro de SERIE suman 7.877 y las tres de fuera 4.389: el fixture cuadra
// consigo mismo, que es lo unico que permite probar que el desglose cuadra.
const D={ pool:803459, pool_sap:807848, fuera_del_pool:4389, sistemico:17890,
  bodegas:{ CLIENTES:{nivel:217181,socios:215714,residuo:1467,n:69},
            RETAIL:{nivel:578401,socios:546386,residuo:32015,n:60},
            PLANTA:{nivel:7877,fuera:4389,sap:12266} },
  anio:{ret:28577,cli:29149},
  meses:[{mes:'2026-09',etiqueta:'Sep',ret:14000,cli:14000},
         {mes:'2026-10',etiqueta:'Oct',ret:14577,cli:15149}],
  planta:[{cod:'RT13-100',nom:'SANTIAGO INSPECCION',nivel:3455,nueve:true},
          {cod:'RT13-102',nom:'SANTIAGO REPARACION',nivel:4103,nueve:true},
          {cod:'RT07-125',nom:'TALCA DISPONIBLE',nivel:319,nueve:true},
          {cod:'RT07-126',nom:'TALCA TRANSITO',nivel:0,nueve:true},
          {cod:'RT13-266',nom:'SANTIAGO MERMA',nivel:2620,nueve:false},
          {cod:'RT13-109',nom:'SANTIAGO EXTRANOS',nivel:1544,nueve:false},
          {cod:'RT04-160',nom:'COQUIMBO TRANSITO',nivel:225,nueve:false}],
  planta_dias:SERIE, planta_ancla:'2026-10-30T15:54:23.303Z',
  controles:[{titulo:'Conservación',texto:'Un traspaso mueve el reparto, nunca el total, y entre el 26 y el 27 de octubre el pool subió mil treinta unidades enteras',estado:'no pasa',medido:'2026-10-27'},
             {titulo:'Cobertura',texto:'Los nueve meses ya cerrados dan 174.918 documentos en SAP y 174.918 en nuestra extracción',medido:'2026-10-27'},
             {titulo:'Segunda fuente',texto:'coinciden al pallet',medido:'2026-10-26'}],
  extra_medido:'2026-10-26', ventana:{nivel:'2026-10-30',flujo_hasta:'2026-10-30',flujo_desde:'2026-01-01'} };

console.log('— la etapa sale del nombre: SAP no tiene campo de etapa —');
chk('inspeccion', A.etapaDeBodega('SANTIAGO INSPECCION')==='INSPECCION');
chk('y disponible', A.etapaDeBodega('TALCA DISPONIBLE')==='DISPONIBLE');
chk('sin importar mayusculas ni espacios', A.etapaDeBodega('  talca pintura ')==='PINTURA');
// un nombre con dos etapas adentro se queda con la PRIMERA del recorrido:
// "desarme y reparación" es una estación de desarme, no de reparación
chk('con dos etapas manda la primera del recorrido',
    A.etapaDeBodega('SANTIAGO DESARME Y REPARACION')==='DESARME',
    A.etapaDeBodega('SANTIAGO DESARME Y REPARACION'));
// un nombre que no trae etapa conocida NO se adivina
chk('lo que no reconoce no se inventa', A.etapaDeBodega('SANTIAGO MERMA')==='OTRA' &&
    A.etapaDeBodega('')==='OTRA' && A.etapaDeBodega(null)==='OTRA');

console.log('\n— la salud mira UNA cosa: dias con cierre bajo cero —');
const S0=A.saludDeBodega(SERIE[1]), S1=A.saludDeBodega(SERIE[2]), S2=A.saludDeBodega(SERIE[0]), S3=A.saludDeBodega(SERIE[3]);
chk('sin dias bajo cero es verde', S0.nivel==='sana' && S0.n===0 && S0.de===2, JSON.stringify(S0));
chk('menos de la mitad es amarillo', S1.nivel==='atencion' && S1.n===1 && S1.de===4, JSON.stringify(S1));
chk('la mitad o mas es rojo', S2.nivel==='critica' && S2.n===2 && S2.de===3, JSON.stringify(S2));
// lo que no se puede evaluar NO se pinta de verde: esa es la forma mas barata
// de mentir en un tablero
chk('sin dias es sin dato, no sana', S3.nivel==='sindato' && S3.texto==='Sin dato', JSON.stringify(S3));
// LA PALABRA NO ES UN COLOR. En REDTEC el rojo y el verde son tipos de
// pallet: una estacion rotulada "Rojo" se leia como una bodega con pallet
// rojo, no como una bodega critica. El estado se nombra por lo que es.
chk('y lo dice con su palabra', S0.texto==='Sana' && S1.texto==='Atención' && S2.texto==='Crítica',
    [S0.texto,S1.texto,S2.texto].join(' '));
chk('y ninguna palabra de estado es un color de pallet',
    ![S0,S1,S2,S3].some(x=>/rojo|verde|amarillo/i.test(x.texto)),
    [S0,S1,S2,S3].map(x=>x.texto).join(' '));
// justo en la mitad el borde es critica, no atencion: redondear hacia el lado
// comodo es lo que hace que un tablero deje de servir
chk('exactamente la mitad ya es rojo',
    A.saludDeBodega({dias:[dia('2026-10-01',0,0,1,-1), dia('2026-10-02',-1,2,0,1)]}).nivel==='critica');
// CERO NO ES NEGATIVO. Una bodega que cierra el día en cero está vacía, que es
// un estado perfectamente posible; TALCA REPARACION cierra así casi todos los
// días. Contarlo como imposible pondría media planta en rojo.
const CERO=A.saludDeBodega({dias:[dia('2026-10-01',5,0,5,0), dia('2026-10-02',0,3,3,0)]});
chk('un cierre en cero no es un dia negativo', CERO.nivel==='sana' && CERO.n===0, JSON.stringify(CERO));
chk('sin bodega no revienta', A.saludDeBodega(null).nivel==='sindato' && A.saludDeBodega({}).nivel==='sindato');

console.log('\n— las estaciones se ordenan por lo que hay que mirar primero —');
const BS=A.bodegasDelCockpit(SERIE);
chk('las cuatro entran', BS.length===4, String(BS.length));
// NO por saldo: RT13-102 tiene el saldo mas alto y va despues porque esta sana
chk('primero la critica, despues la de atencion, despues las sanas',
    BS.map(b=>b.salud.nivel).join(',')==='critica,atencion,sana,sindato', BS.map(b=>b.cod+':'+b.salud.nivel).join(' '));
chk('y no por saldo', BS[0].cod==='RT13-100' && BS[0].nivel < BS[2].nivel);
chk('cada una trae planta y etapa', BS[0].planta==='SANTIAGO' && BS[0].etapa==='INSPECCION');
chk('y su flujo sumado', BS[0].entradas===30 && BS[0].salidas===45, BS[0].entradas+'/'+BS[0].salidas);
chk('y el peor dia', BS[0].peor.cierre===-10 && BS[0].peor.dia==='2026-10-01', JSON.stringify(BS[0].peor));
// a igual salud manda el recorrido del pallet, no el codigo
// Los codigos van al reves que el recorrido a proposito: si el desempate fuera
// alfabetico daria A,Z y pondria DISPONIBLE antes que INSPECCION.
const REC=A.bodegasDelCockpit([
  { cod:'A', nom:'TALCA DISPONIBLE', nivel:1, dias:[dia('2026-10-01',0,1,0,1)] },
  { cod:'Z', nom:'TALCA INSPECCION', nivel:1, dias:[dia('2026-10-01',0,1,0,1)] } ]);
chk('a igual salud manda el recorrido, no el codigo', REC.map(b=>b.cod).join(',')==='Z,A',
    REC.map(b=>b.cod).join(','));
chk('sin serie no revienta', A.bodegasDelCockpit(null).length===0 && A.bodegasDelCockpit([]).length===0);
chk('una fila sin codigo no entra', A.bodegasDelCockpit([{nom:'X'}]).length===0);

console.log('\n— la matriz planta × etapa —');
const M=A.matrizPlantaEtapa(BS);
chk('dos plantas', M.plantas.join(',')==='SANTIAGO,TALCA', M.plantas.join(','));
// el eje de etapas va en el orden del recorrido, no alfabetico
chk('las etapas en orden de recorrido',
    M.etapas.join(',')==='INSPECCION,REPARACION,DISPONIBLE,TRANSITO', M.etapas.join(','));
chk('una celda por cruce', M.celdas.length===M.plantas.length*M.etapas.length, String(M.celdas.length));
const cel=(p,e)=>M.celdas.find(c=>c.planta===p&&c.etapa===e);
chk('la celda con bodega trae su salud', cel('SANTIAGO','INSPECCION').salud.nivel==='critica');
// un cruce que NO existe no es un cruce sano: es un cruce que no existe
chk('un cruce sin bodega se marca vacio, no verde',
    cel('TALCA','REPARACION').salud.nivel==='vacio' && cel('TALCA','REPARACION').bodega===null);
chk('sin bodegas no revienta', A.matrizPlantaEtapa(null).celdas.length===0);

console.log('\n— el titular dice la conclusion, no el dato —');
const TI=A.titular(D,BS);
chk('nombra cuantas estaciones estan mal', /2 de 4 estaciones/.test(TI.frase), TI.frase);
chk('con el pool al lado', /803\.459/.test(TI.frase), TI.frase);
chk('y el nivel es el peor que haya', TI.nivel==='critica', TI.nivel);
chk('la cola trae los dias y el peor cierre', /3 de 9 días/.test(TI.cola) && /-10/.test(TI.cola), TI.cola);
// el dia que no haya negativos, el titular lo tiene que decir solo
const SANO=A.titular(D, A.bodegasDelCockpit([SERIE[1]]));
chk('sin negativos cambia solo', /ninguna estación/.test(SANO.frase) && SANO.nivel==='sana', SANO.frase);
// solo amarillas no es rojo
const AM=A.titular(D, A.bodegasDelCockpit([SERIE[2]]));
chk('solo amarillas no se declara rojo', AM.nivel==='atencion', AM.nivel);
chk('sin serie lo dice y no inventa', /sin distribución diaria/.test(A.titular(D,[]).cola));

// EL NUMERO Y SU DUEÑO. La cola trae el peor cierre de toda la serie y la
// estacion que lo tiene. Son dos datos del mismo registro y tienen que salir
// juntos: el orden del cockpit pone primero la que tiene MAS dias malos, que
// no es necesariamente la que tiene el PEOR dia. Aqui RT07-120 encabeza (dos
// dias bajo cero contra uno) y el peor cierre es de RT13-100.
const PAR=[
  { cod:'RT07-120', nom:'TALCA INSPECCION', nivel:50, dias:[
    dia('2026-10-01',10,0,30,-20), dia('2026-10-02',-20,0,10,-30), dia('2026-10-03',-30,80,0,50) ] },
  { cod:'RT13-100', nom:'SANTIAGO INSPECCION', nivel:40, dias:[
    dia('2026-10-01',10,0,10,0), dia('2026-10-02',0,0,900,-900), dia('2026-10-03',-900,940,0,40) ] },
];
const TP=A.titular(D, A.bodegasDelCockpit(PAR));
chk('el peor cierre de la cola es el minimo de toda la serie', /peor -900 /.test(TP.cola), TP.cola);
chk('y la cola nombra a la estacion que lo tiene, no a la primera en rojo',
    /peor -900 en RT13-100$/.test(TP.cola), TP.cola);
chk('que no es la que encabeza el orden del cockpit',
    A.bodegasDelCockpit(PAR)[0].cod==='RT07-120', A.bodegasDelCockpit(PAR)[0].cod);
// la pareja viaja junta tambien cuando el dueño SI encabeza
const TU=A.titular(D, A.bodegasDelCockpit([PAR[1],PAR[0]].map(b=>b)));
chk('el par no depende del orden de entrada', /peor -900 en RT13-100$/.test(TU.cola), TU.cola);

console.log('\n— las tarjetas —');
const TJ=A.tarjetas(D,BS);
chk('ocho tarjetas', TJ.length===8, String(TJ.length));
chk('la primera reparte el pool en tres', TJ[0].stack.length===3 &&
    TJ[0].stack.reduce((a,s)=>a+s.v,0)===803459, String(TJ[0].stack.reduce((a,s)=>a+s.v,0)));
chk('y declara el total de SAP', /807\.848/.test(TJ[0].ks), TJ[0].ks);
chk('planta muestra el indicador, no lo que SAP tiene', TJ[1].kv==='7.877', TJ[1].kv);
chk('y dice que lo de fuera no suma', /no suman/.test(TJ[1].ks));
chk('los dias en negativo salen de la serie', TJ[5].kv==='3' && /de 9/.test(TJ[5].u), TJ[5].kv+' '+TJ[5].u);
chk('con chip critico cuando los hay', TJ[5].chip.c==='crit', JSON.stringify(TJ[5].chip));
// sin negativos el chip cambia de significado, no desaparece
const TJS=A.tarjetas(D, A.bodegasDelCockpit([SERIE[1]]));
chk('sin negativos el chip es bueno', TJS[5].chip.c==='good', JSON.stringify(TJS[5].chip));
chk('los controles cuentan los que pasan', TJ[7].kv==='2' && /de 3/.test(TJ[7].u), TJ[7].kv+' '+TJ[7].u);
chk('y nombran el que no pasa', /Conservación/.test(TJ[7].ks));
// una tarjeta que no se puede calcular NO sale en cero
const SINCOB=A.tarjetas({...D, controles:[]}, BS);
chk('sin control de cobertura la tarjeta lo dice', SINCOB[6].kv==='—' && SINCOB[6].chip.c==='nodata',
    SINCOB[6].kv+' '+JSON.stringify(SINCOB[6].chip));
// el residuo son las DOS patas: mostrar solo el de retail esconde 1.467
chk('el residuo suma las dos patas', TJ[3].kv==='33.482', TJ[3].kv);
chk('y nombra cada una', /retail <b>32\.015<\/b>/.test(TJ[3].ks) && /clientes <b>1\.467<\/b>/.test(TJ[3].ks), TJ[3].ks);
chk('sin datos no revienta', A.tarjetas(null,null).length===8);

console.log('\n— lo que hay que decidir sale del dato —');
const DE=A.decisiones(D,BS);
chk('un control que no pasa entra', DE.some(x=>/Conservación no pasa/.test(x.t)), JSON.stringify(DE.map(x=>x.t)));
chk('los controles que pasan no', !DE.some(x=>/Cobertura/.test(x.t)));
chk('una estacion roja entra', DE.some(x=>/SANTIAGO INSPECCION/.test(x.t)));
// una amarilla NO entra: si todo entra, la lista deja de ser una decision
chk('una amarilla no entra', !DE.some(x=>/TALCA DISPONIBLE/.test(x.t)), JSON.stringify(DE.map(x=>x.t)));
chk('sin nada que decidir queda vacia', A.decisiones({controles:[]}, A.bodegasDelCockpit([SERIE[1]])).length===0);

console.log('\n— los compromisos se cuentan contra el ancla, no a mano —');
chk('dias hasta una fecha futura', A.diasHasta('2026-11-07','2026-10-30')===8, String(A.diasHasta('2026-11-07','2026-10-30')));
chk('y una pasada da negativo', A.diasHasta('2026-10-01','2026-10-30')===-29, String(A.diasHasta('2026-10-01','2026-10-30')));
chk('el mismo dia es cero', A.diasHasta('2026-10-30','2026-10-30')===0);
chk('una fecha que no es fecha no se inventa', A.diasHasta('manana','2026-10-30')===null &&
    A.diasHasta('2026-11-07','hoy')===null);
const HI=A.hitos('2026-10-30');
chk('los hitos vienen ordenados por cercania', HI.map(h=>h.dias).every((v,i,a)=>i===0||a[i-1]<=v),
    HI.map(h=>h.dias).join(','));
chk('el mas cercano lleva aviso', HI[0].cls==='warn' && /\+8 d/.test(HI[0].v), HI[0].cls+' '+HI[0].v);
chk('y uno lejano no', HI[HI.length-1].cls==='good');
// un hito vencido tiene que gritar
const VEN=A.hitos('2027-01-01');
chk('un hito vencido se marca critico', VEN.every(h=>h.cls==='crit'), VEN.map(h=>h.cls).join(','));
chk('y su cuenta va en negativo', VEN[0].v.indexOf('-')===0, VEN[0].v);

console.log('\n— recortar por palabra, no a la mitad de una —');
chk('un texto corto queda igual', A.recortar('hola',20)==='hola');
chk('uno largo se corta en el espacio', A.recortar('calculadas hacia atras y hacia adelante',24)==='calculadas hacia atras…',
    A.recortar('calculadas hacia atras y hacia adelante',24));
chk('y nunca queda un corte a mitad de palabra', A.recortar('calculadas hacia atras y hacia adelante',24).indexOf('hac…')<0);
// una palabra sola mas larga que el corte no puede devolver vacio
chk('una palabra larguisima igual se corta', A.recortar('supercalifragilisticoespialidoso',10).length>5,
    A.recortar('supercalifragilisticoespialidoso',10));
chk('sin texto no revienta', A.recortar(null,10)==='' && A.recortar(undefined,10)==='');
chk('no deja el punto antes de los suspensivos', A.recortar('uno dos. tres cuatro',9)==='uno dos…',
    A.recortar('uno dos. tres cuatro',9));

console.log('\n— el html —');
const MH=A.matrizHtml(M);
chk('cada celda lleva su glifo, no solo el color', /◆/.test(MH) && /●/.test(MH) && /▲/.test(MH), MH.slice(0,0));
chk('la celda con bodega es clicable', /data-cod="RT13-100"/.test(MH) && /role="button"/.test(MH));
// la celda vacia NO es clicable: no hay nada que abrir, y un boton que no
// hace nada es peor que ningun boton
chk('hay un data-cod por celda con bodega y ninguno de mas',
    (MH.match(/data-cod="/g)||[]).length===M.celdas.filter(c=>c.bodega).length,
    (MH.match(/data-cod="/g)||[]).length+' vs '+M.celdas.filter(c=>c.bodega).length);
chk('y la vacia no trae uno en blanco', !/data-cod=""/.test(MH));
chk('y cada una trae su title', (MH.match(/title="/g)||[]).length>=M.celdas.length);
const FC=A.filaCartera(BS[0]);
chk('la fila trae los datos para filtrar', /data-planta="SANTIAGO"/.test(FC) && /data-salud="critica"/.test(FC));
chk('y la salud con glifo y palabra', /◆/.test(FC) && /Crítica/.test(FC), FC.slice(-120));
chk('una lista vacia dice por que', /class="empty"/.test(A.listaHtml([],'nada por aca')) &&
    /nada por aca/.test(A.listaHtml([],'nada por aca')));
// el texto de la lista sale de SAP y de los controles: no puede ir crudo
const LCRUDO=A.listaHtml([{ico:'!',cls:'crit',t:'<b>uno</b>',m:'<i>dos</i>',v:'<u>x</u>'}],'');
chk('la lista escapa el texto', LCRUDO.indexOf('<b>uno</b>')<0 && LCRUDO.indexOf('<i>dos</i>')<0 &&
    LCRUDO.indexOf('<u>x</u>')<0, LCRUDO.slice(0,160));
chk('el chip de estado sale solo si hay', A.chipEstado(null)==='' && /st-good/.test(A.chipEstado({c:'good',t:'x'})));
const DB=A.dumbbell(SERIE,BS,'2026-10');
chk('la mancuerna dibuja los dos extremos', (DB.match(/<circle/g)||[]).length===BS.filter(b=>b.dias).length*2,
    String((DB.match(/<circle/g)||[]).length));
chk('y marca el cero', /class="cero"/.test(DB));
// el circulo del cierre, no la leyenda: la leyenda nombra el color igual
chk('el circulo del cierre bajo cero se pinta distinto',
    /<circle[^>]*fill="var\(--crit\)"/.test(DB), (DB.match(/<circle[^>]*fill="[^"]*"/g)||[]).join(' '));
chk('y el que cierra arriba de cero no', /<circle[^>]*fill="var\(--pla\)"/.test(DB));
// EL CERO SIEMPRE ENTRA EN LA ESCALA, aunque ninguna estacion lo toque: sin el
// la mancuerna compara dos niveles altos entre si y no contra el piso
const SOLOALTO=A.dumbbell(
  [{cod:'P', nom:'TALCA PINTURA', nivel:0, dias:[dia('2026-10-01',100,20,0,120)]}],
  A.bodegasDelCockpit([{cod:'P', nom:'TALCA PINTURA', nivel:0, dias:[dia('2026-10-01',100,20,0,120)]}]),
  '2026-10');
const xcero=Number((SOLOALTO.match(/class="cero" x1="([\d.]+)"/)||[])[1]);
chk('el cero entra en la escala aunque nadie lo toque', xcero===128, String(xcero));
chk('sin mes no revienta', /class="empty"/.test(A.dumbbell(SERIE,BS,'2025-01')));
chk('el metodo declara de donde sale cada numero', /ItemWarehouseInfoCollection/.test(A.metodo(D)) &&
    /nivel\(t\) = ancla/.test(A.metodo(D)));

console.log('\n— el javascript que viaja —');
const JS=A.script(SERIE,'2026-10');
for (const f of ['panelDeMes','svgFlujoDia','svgNivelDia','tablaDeDias','resumenDelMes','diasDelMes','rehidratar','mil'])
  if (f!=='panelDeMes') chk('publica '+f, JS.indexOf('function '+f+'(')>=0);
chk('lleva la serie adentro', /var PD = rehidratar\(\[/.test(JS) && JS.indexOf('RT13-100')>=0);
chk('y el mes por defecto', /var MES0 = "2026-10"/.test(JS));
// si lo publicado no es javascript valido, el navegador se come la pagina entera
const cuerpo=JS.replace(/^<script>\n/,'').replace(/\n<\/script>$/,'').replace(/<\\\//g,'</');
chk('lo publicado es javascript valido',
    (()=>{try{new Function(cuerpo);return true;}catch(e){return 'no: '+e.message;}})()===true,
    (()=>{try{new Function(cuerpo);return '';}catch(e){return e.message;}})());
// el unico '</script' que puede haber es el cierre del bloque, al final
// sinCierreDeScript es defensa en profundidad: hoy jsonSeguro ya saca los '<'
// del payload y ninguna de las funciones publicadas trae "</script" en su
// texto, asi que no hay entrada que lo haga observable. Se afirma el codigo.
chk('el payload pasa por sinCierreDeScript antes de salir',
    /sinCierreDeScript\(cuerpo\)/.test(A.script.toString()), 'el blindaje se sacó de script()');
chk('el unico cierre es el del final', (JS.match(/<\/script/g)||[]).length===1 &&
    /<\/script>$/.test(JS.trim()), String((JS.match(/<\/script/g)||[]).length));

console.log('\n— la pagina —');
const PG=A.pagina(D);
chk('es un documento completo', /^<!doctype html>/.test(PG) && /<\/html>\s*$/.test(PG));
chk('arranca en oscuro', /<html lang="es" data-theme="dark">/.test(PG));
chk('lleva la R de REDTEC de favicon y de logo',
    (PG.match(/data:image\/png;base64,/g)||[]).length===2, String((PG.match(/data:image\/png;base64,/g)||[]).length));
chk('con las fuentes del portal', /family=Inter/.test(PG) && /JetBrains\+Mono/.test(PG));
chk('y carga sesion.js como las demas vistas', /<script src="\/sesion\.js">/.test(PG));
chk('las cinco franjas numeradas', (PG.match(/<span class="num">\d<\/span>/g)||[]).length===5,
    String((PG.match(/<span class="num">\d<\/span>/g)||[]).length));
chk('con sus preguntas por titulo', /¿Cómo estamos\?/.test(PG) && /¿Dónde está el problema\?/.test(PG) &&
    /¿Hacia dónde vamos\?/.test(PG) && /¿Qué hay que decidir\?/.test(PG));
chk('el titular arriba de todo', PG.indexOf('class="headline')<PG.indexOf('¿Cómo estamos?'));
chk('vuelta al panel y al detalle', /m3link_dashboard_dark\.html/.test(PG) && /stock-flujos-pallets\.html/.test(PG));
chk('cada bloque de script tiene su cierre',
    (PG.match(/<script\b/g)||[]).length===(PG.match(/<\/script>/g)||[]).length,
    (PG.match(/<script\b/g)||[]).length+' vs '+(PG.match(/<\/script>/g)||[]).length);
// los nombres vienen de SAP
const HOSTIL=A.pagina({...D, planta_dias:[{cod:'RT13-100',nom:'<img src=x onerror=alert(1)>',nivel:1,
  dias:[dia('2026-10-01',0,1,0,1)]}]});
chk('un nombre con html no sale crudo', HOSTIL.indexOf('<img src=x')<0,
    (HOSTIL.match(/.{0,30}img src=x.{0,10}/) || [''])[0]);
chk('y uno con </script> no parte la pagina',
    (()=>{const P=A.pagina({...D, planta_dias:[{cod:'RT13-100',nom:'X</script>Y',nivel:1,
      dias:[dia('2026-10-01',0,1,0,1)]}]});
      return (P.match(/<script\b/g)||[]).length===(P.match(/<\/script>/g)||[]).length;})());
// sin distribucion diaria la pagina SALE igual, sin inventar la seccion
const SINPLANTA=A.pagina({...D, planta_dias:null});
chk('sin serie diaria la pagina igual sale', /^<!doctype html>/.test(SINPLANTA));
chk('y el titular lo dice', /sin distribución diaria/.test(SINPLANTA));

console.log('\n— el orden del recorrido, distinto del de la tabla —');
const PR=A.porRecorrido(BS);
chk('empieza por inspeccion y termina en transito',
    PR.map(x=>x.etapa).join(',')==='INSPECCION,REPARACION,DISPONIBLE,TRANSITO', PR.map(x=>x.etapa).join(','));
// la TABLA ordena por salud; el desglose por recorrido. Son dos preguntas.
chk('no es el mismo orden que el de la tabla',
    PR.map(x=>x.cod).join(',')!==BS.map(x=>x.cod).join(','),
    PR.map(x=>x.cod).join(',')+' vs '+BS.map(x=>x.cod).join(','));
chk('y no pierde ni agrega bodegas', PR.length===BS.length);
chk('no muta la lista que recibe', BS.map(x=>x.cod).join(',')===A.bodegasDelCockpit(SERIE).map(x=>x.cod).join(','));
chk('sin lista no revienta', A.porRecorrido(null).length===0);

console.log('\n— un desglose SUMA, y si no, lo dice —');
const DOK=A.desglose('x','T','9','u','i',[{a:'a',v:4},{a:'b',v:5}],{a:'Total',v:9},null,null);
chk('cuando suma, cuadra', DOK.cuadra===true && DOK.suma===9 && DOK.descuadre===0);
const DMAL=A.desglose('x','T','9','u','i',[{a:'a',v:4},{a:'b',v:5}],{a:'Total',v:20},null,null);
chk('cuando no suma, lo declara', DMAL.cuadra===false && DMAL.descuadre===-11, JSON.stringify({c:DMAL.cuadra,d:DMAL.descuadre}));
// filas sin numero (textos) no pueden inventar un descuadre
chk('las filas de solo texto no cuadran ni descuadran',
    A.desglose('x','T','-','','i',[{a:'a',v:null}],null,null,null).cuadra===true);
chk('una fila nula no cuenta', A.desglose('x','T','4','','i',[null,{a:'a',v:4}],{a:'T',v:4},null,null).cuadra===true);
// una fila de texto mezclada con numeros NO puede arrastrar la suma a cero
// y un desglose que es SOLO texto con un total declarado no puede gritar un
// descuadre de -20: no hay nada que sumar, asi que no hay contradiccion que
// detectar. Callar es correcto; inventar un descuadre no.
const SOLOTEXTO=A.desglose('x','T','20','','i',[{a:'un control',v:null}],{a:'T',v:20},null,null);
chk('solo texto con total no inventa un descuadre', SOLOTEXTO.cuadra===true,
    SOLOTEXTO.suma+' vs '+SOLOTEXTO.total.v+' → '+SOLOTEXTO.cuadra);
const MIXTO=A.desglose('x','T','4','','i',[{a:'nota',v:null},{a:'a',v:4}],{a:'T',v:4},null,null);
chk('una fila de texto no entra en la suma', MIXTO.cuadra===true && MIXTO.suma===4,
    MIXTO.suma+' / '+MIXTO.cuadra);

console.log('\n— las composiciones de cada cifra publicada —');
const CO=A.composiciones(D,BS);
chk('hay una por cada tarjeta',
    Object.keys(CO).join(',')==='pool,planta,atribucion,residuo,anio,negativos,cobertura,controles',
    Object.keys(CO).join(','));
// ESTA es la prueba que importa: lo que el desglose muestra tiene que sumar
// lo que la tarjeta publica. Si no, la pagina se contradice sola.
for (const k of Object.keys(CO))
  chk('el desglose de ' + k + ' cuadra', CO[k].cuadra===true,
      CO[k].total ? CO[k].suma + ' vs ' + CO[k].total.v : 'sin total');
// y las claves tienen que ser las mismas que declaran las tarjetas
chk('cada tarjeta declara la clave de su desglose',
    A.tarjetas(D,BS).map(t=>t.clave).join(',')===Object.keys(CO).join(','),
    A.tarjetas(D,BS).map(t=>t.clave).join(','));
chk('y el numero del desglose es el de la tarjeta',
    A.tarjetas(D,BS).every(t=>CO[t.clave].kv===t.kv),
    A.tarjetas(D,BS).map(t=>t.clave+':'+t.kv+'/'+CO[t.clave].kv).join(' '));

chk('el pool se compone de las tres patas', CO.pool.filas.length===3 && CO.pool.total.v===803459);
chk('y lo de fuera va aparte, sin sumar', CO.pool.extra.v===4389 &&
    CO.pool.extra.filas.length===3, String(CO.pool.extra.filas.length));
// la secuencia COMPLETA, no solo los extremos: por salud daria
// Inspeccion, Disponible, Reparacion, Transito y los extremos calzarian igual
chk('planta lista sus bodegas en orden de recorrido',
    CO.planta.filas.map(f=>f.b.split(' · ')[1]).join(',')==='Inspeccion,Reparacion,Disponible,Transito',
    CO.planta.filas.map(f=>f.b).join(' | '));
chk('atribucion reconcilia contra el saldo de las dos bodegas',
    CO.atribucion.total.v===215714+546386 && /762\.100 de 795\.582/.test(CO.atribucion.nota), CO.atribucion.nota);
chk('el año suma los meses', CO.anio.filas.length===2 && CO.anio.total.v===57726);
chk('los negativos listan solo las estaciones que los tienen',
    CO.negativos.filas.length===2 && CO.negativos.total.v===3,
    CO.negativos.filas.map(f=>f.a).join(' | '));
// las sanas van en el bloque que NO suma, para que se vea que están sin
// inflar el total de días malos
chk('y las sanas van aparte', CO.negativos.extra && CO.negativos.extra.filas.length===1 &&
    CO.negativos.extra.v===0, JSON.stringify(CO.negativos.extra && CO.negativos.extra.v));
// el que no pasa va primero AUNQUE venga ultimo en el json: un control que
// falla escondido en la fila nueve es un control que nadie ve
const CTRLREV=A.composiciones({...D, controles:[
  {titulo:'Pasa uno',texto:'t',medido:'2026-10-26'},
  {titulo:'Pasa dos',texto:'t',medido:'2026-10-26'},
  {titulo:'Falla',texto:'t',estado:'no pasa',medido:'2026-10-27'}]}, BS);
chk('los controles ponen primero el que no pasa',
    /NO PASA/.test(CTRLREV.controles.filas[0].a) && CTRLREV.controles.filas[0].malo===true,
    CTRLREV.controles.filas.map(f=>f.a).join(' | '));
chk('y cada uno trae su fecha', CO.controles.filas.every(f=>f.fecha));
// sin el control de cobertura NO se inventa un 100
const SINCOB2=A.composiciones({...D, controles:[]}, BS);
chk('sin control de cobertura el desglose lo dice', SINCOB2.cobertura.kv==='—' &&
    /No se inventa un 100/.test(SINCOB2.cobertura.nota), SINCOB2.cobertura.nota);
chk('sin datos no revienta', Object.keys(A.composiciones(null,null)).length===8);

// Y al reves: si el json viene incoherente —una bodega del indicador que no
// esta en la serie diaria— el desglose NO puede disimularlo.
const INCOH=A.composiciones({...D, bodegas:{...D.bodegas, PLANTA:{nivel:99999,fuera:4389,sap:1}}}, BS);
chk('un total que no calza con sus partes queda declarado',
    INCOH.planta.cuadra===false && INCOH.planta.descuadre===7877-99999,
    INCOH.planta.suma+' vs '+INCOH.planta.total.v);

console.log('\n— el desglose dibujado —');
const DH=A.desgloseHtml(CO.planta);
chk('lleva el titulo y la cifra', /Planta · indicador/.test(DH) && /7\.877/.test(DH));
chk('una fila por componente, mas un pie por bloque',
    (DH.match(/<tr>/g)||[]).length===CO.planta.filas.length+CO.planta.extra.filas.length+2,
    (DH.match(/<tr>/g)||[]).length+' para '+CO.planta.filas.length+'+'+CO.planta.extra.filas.length);
chk('el total va en el pie de la tabla', /<tfoot><tr><td>Indicador de planta<\/td><td class="num">7\.877/.test(DH));
chk('y el bloque que no suma va marcado', /class="desg ref"/.test(DH));
// si no cuadra, el panel lo dice EN EL PANEL, no en silencio
const DHMAL=A.desgloseHtml(A.desglose('x','T','20','','i',[{a:'a',v:4}],{a:'Total',v:20},null,null));
chk('un desglose que no cuadra lo grita', /Las filas suman 4 y el total declarado es 20/.test(DHMAL),
    (DHMAL.match(/Las filas[^<]*/)||[''])[0]);
chk('y uno que cuadra no dice nada', DH.indexOf('de diferencia')<0);
chk('sin composicion no revienta', /No hay desglose/.test(A.desgloseHtml(null)));
// los nombres vienen de SAP
chk('escapa el texto de las filas',
    A.desgloseHtml(A.desglose('x','<b>T</b>','1','','<i>i</i>',[{a:'<u>a</u>',b:'<s>b</s>',v:1}],null,null,'<em>n</em>'))
      .indexOf('<u>a</u>')<0);

console.log('\n— la tarjeta abre su desglose —');
const TH=A.tarjetaHtml(A.tarjetas(D,BS)[1],0);
chk('la tarjeta declara su clave', /data-kpi="planta"/.test(TH));
chk('y es un boton de verdad', /role="button"/.test(TH) && /tabindex="0"/.test(TH) && /aria-label=/.test(TH));
chk('con la flecha que avisa que se abre', /class="abrir"/.test(TH) && /↗/.test(TH));
// una tarjeta sin clave NO finge que se abre
const SINCLAVE=A.tarjetaHtml({et:'X',hint:'y',kv:'1',u:''},0);
chk('una tarjeta sin desglose no finge', SINCLAVE.indexOf('data-kpi')<0 && SINCLAVE.indexOf('abrir')<0);
const PGK=A.pagina(D);
chk('las ocho tarjetas de la pagina abren', (soloCuerpo(PGK).match(/data-kpi="/g)||[]).length===8,
    String((soloCuerpo(PGK).match(/data-kpi="/g)||[]).length));
chk('y las composiciones viajan al navegador con contenido',
    /var DESG = \{/.test(PGK) && PGK.indexOf('"clave":"planta"')>=0 && PGK.indexOf('"clave":"controles"')>=0,
    (PGK.match(/var DESG = .{0,40}/)||[''])[0]);
chk('con el renderizador publicado, no una copia', PGK.indexOf('function desgloseHtml(')>=0);

console.log('\n— el cajon abre en un mes que la estacion TENGA —');
// RT13-100 del fixture tiene octubre con dos dias bajo cero: abre en octubre.
chk('con dias bajo cero manda el mes del peor dia',
    A.mesDeApertura(SERIE[0])==='2026-10', String(A.mesDeApertura(SERIE[0])));
// una que cruza meses y tiene el peor en el mes VIEJO abre en el viejo, no en
// el nuevo: el mes que hay que mirar es donde esta el problema.
const CRUZA={cod:'RT13-999',nom:'X',nivel:5,dias:[
  dia('2026-10-28',0,0,70,-70), dia('2026-11-01',-70,75,0,5)]};
chk('aunque el mes del peor dia no sea el ultimo',
    A.mesDeApertura(CRUZA)==='2026-10', String(A.mesDeApertura(CRUZA)));
// sin ningun dia bajo cero manda el ultimo mes, que es la lectura de hoy
const SANA={cod:'RT13-998',nom:'Y',nivel:9,dias:[
  dia('2026-10-30',4,5,0,9), dia('2026-11-02',9,0,0,9)]};
chk('sin dias bajo cero manda el mes mas nuevo',
    A.mesDeApertura(SANA)==='2026-11', String(A.mesDeApertura(SANA)));
// un cierre en CERO no es un dia malo: la estacion quedo vacia, no en falta.
// Si contara como malo, esta abriria en octubre en vez de en la lectura de hoy.
const ENCERO={cod:'RT13-996',nom:'W',nivel:7,dias:[
  dia('2026-10-20',4,0,4,0), dia('2026-11-02',0,7,0,7)]};
chk('un cierre en cero no manda el mes: no es un dia malo',
    A.mesDeApertura(ENCERO)==='2026-11', String(A.mesDeApertura(ENCERO)));
// con dos meses malos manda el PEOR, no el primero que aparece
const DOSMALOS={cod:'RT13-995',nom:'V',nivel:0,dias:[
  dia('2026-10-05',0,0,5,-5), dia('2026-11-01',-5,0,895,-900)]};
chk('entre dos meses malos manda el del peor dia, no el primero',
    A.mesDeApertura(DOSMALOS)==='2026-11', String(A.mesDeApertura(DOSMALOS)));
chk('una estacion sin dias no inventa un mes', A.mesDeApertura(SERIE[3])===null);
chk('ni revienta con nada', A.mesDeApertura(null)===null && A.mesDeApertura({})===null);
// una fecha rota no puede elegir el mes ni tumbar la funcion
chk('una fecha ilegible se ignora, no se ofrece',
    A.mesDeApertura({dias:[{dia:'sin fecha',cierre:-9},{dia:'2026-10-05',cierre:3}]})==='2026-10');
chk('los meses de una estacion son los que tiene, ordenados y sin repetir',
    A.mesesDeBodega(CRUZA).join(',')==='2026-10,2026-11', A.mesesDeBodega(CRUZA).join(','));
// el selector se lee de izquierda a derecha: el orden es del mes, no del orden
// en que los dias vengan en el json
const DESORDEN={cod:'RT13-994',nom:'U',nivel:1,dias:[
  dia('2026-11-02',0,1,0,1), dia('2026-10-30',0,0,0,0), dia('2026-11-01',0,0,0,0)]};
chk('y van en orden de mes aunque los dias no vengan ordenados',
    A.mesesDeBodega(DESORDEN).join(',')==='2026-10,2026-11',
    A.mesesDeBodega(DESORDEN).join(','));
chk('y una sin dias no ofrece ninguno', A.mesesDeBodega(SERIE[3]).length===0);

console.log('\n— la ultima semana es la de la estacion, no la del calendario —');
const LARGA={cod:'RT13-997',nom:'Z',nivel:0,dias:[]};
for(let i=1;i<=10;i++) LARGA.dias.push(dia('2026-10-'+String(i).padStart(2,'0'),0,0,0,i));
const SEM=A.ultimaSemana(LARGA,7);
chk('trae siete dias', SEM.length===7, String(SEM.length));
chk('y son los ULTIMOS siete', SEM[0].dia==='2026-10-04' && SEM[6].dia==='2026-10-10',
    SEM[0].dia+'..'+SEM[6].dia);
chk('con su cierre, no con el nivel', SEM[6].cierre===10, String(SEM[6].cierre));
chk('siete por defecto', A.ultimaSemana(LARGA).length===7);
// menos de siete dias no se rellena: un dia inventado es peor que una semana corta
chk('una estacion con menos dias devuelve los que hay, sin rellenar',
    A.ultimaSemana(SERIE[1],7).length===2, String(A.ultimaSemana(SERIE[1],7).length));
chk('y una sin dias devuelve vacio',
    A.ultimaSemana(SERIE[3],7).length===0 && A.ultimaSemana(null,7).length===0);

console.log('\n— la mini-serie de cierres —');
chk('sin dias no dibuja nada', A.miniSemana([])==='' && A.miniSemana(null)==='');
const MS=A.miniSemana([{dia:'2026-10-01',cierre:100},{dia:'2026-10-02',cierre:-50},
                       {dia:'2026-10-03',cierre:0}]);
chk('una barra por dia', (MS.match(/<rect /g)||[]).length===3,
    String((MS.match(/<rect /g)||[]).length));
chk('la linea de cero esta', /<line [^>]*class="mej"/.test(MS));
// el signo no se adivina: la barra negativa cuelga del eje y la positiva sube
const rects=[...MS.matchAll(/<rect [^>]*y="([\d.]+)"[^>]*height="([\d.]+)"[^>]*class="(m[pb])"/g)]
  .map(m=>({y:+m[1],h:+m[2],c:m[3]}));
const ejeDe=svg=>+(/<line [^>]*y1="([\d.]+)"/.exec(svg)[1]);
const altoDe=svg=>+(/viewBox="0 0 \d+ (\d+)"/.exec(svg)[1]);
const EJE=ejeDe(MS);
chk('la positiva sube hasta el eje', rects[0].c==='mp' && rects[0].y+rects[0].h===EJE,
    JSON.stringify(rects[0])+' eje '+EJE);
chk('la negativa cuelga desde el eje', rects[1].c==='mb' && rects[1].y===EJE,
    JSON.stringify(rects[1])+' eje '+EJE);
chk('un cierre en cero deja marca y no desaparece', rects[2].h===1 && rects[2].c==='mp',
    JSON.stringify(rects[2]));
// la escala es la de la propia serie: el valor mas grande llega al tope
chk('el mayor llega al tope de su propia escala', rects[0].h===EJE-1, String(rects[0].h));
const CHICA=A.miniSemana([{dia:'2026-10-01',cierre:3},{dia:'2026-10-02',cierre:-1}]);
const hChica=[...CHICA.matchAll(/height="([\d.]+)"/g)].map(m=>+m[1]);
chk('una serie chica usa el mismo alto que una grande, no una escala comun',
    hChica[0]===ejeDe(CHICA)-1, String(hChica[0]));
// con un negativo el cero va al medio; sin ninguno baja al piso y la semana
// usa el alto entero, porque aplastarla a la mitad la haria parecer plana
chk('con un cierre bajo cero el eje va al medio', EJE===altoDe(MS)/2, String(EJE));
const TODOPOS=A.miniSemana([{dia:'2026-10-01',cierre:3},{dia:'2026-10-02',cierre:9}]);
chk('sin ninguno bajo cero el eje baja al piso',
    ejeDe(TODOPOS)===altoDe(TODOPOS)-1, String(ejeDe(TODOPOS)));
chk('y la barra mas alta usa mas de la mitad del alto',
    Math.max(...[...TODOPOS.matchAll(/height="([\d.]+)"/g)].map(m=>+m[1])) > altoDe(TODOPOS)/2,
    TODOPOS.slice(0,90));
// un cierre en CERO no baja el eje al medio: cero no es negativo, y esa
// semana sigue mereciendo el alto entero
const CONCERO=A.miniSemana([{dia:'2026-10-01',cierre:0},{dia:'2026-10-02',cierre:5}]);
chk('un cierre en cero no empuja el eje al medio',
    ejeDe(CONCERO)===altoDe(CONCERO)-1, String(ejeDe(CONCERO)));
// un valor chiquito al lado de uno enorme no puede desaparecer: 1 contra
// 10.000 da menos de un pixel, y una barra de cero pixeles se lee como "no
// hay dato" cuando el dato es que cerro en 1
const ENANA=A.miniSemana([{dia:'2026-10-01',cierre:10000},{dia:'2026-10-02',cierre:1}]);
const hEnana=[...ENANA.matchAll(/height="([\d.]+)"/g)].map(m=>+m[1]);
chk('un valor minimo al lado de uno enorme sigue viendose',
    hEnana[1]>=1.6, String(hEnana[1]));
chk('y se distingue de la marca del cierre en cero',
    hEnana[1]>1, hEnana.join(','));
chk('la linea de cero se dibuja en los dos casos',
    /class="mej"/.test(MS) && /class="mej"/.test(TODOPOS));
chk('y nada se sale de la caja con el eje abajo',
    [...TODOPOS.matchAll(/y="([\d.]+)"[^>]*height="([\d.]+)"/g)]
      .every(m=>+m[1]>=0 && +m[1]+ +m[2]<=altoDe(TODOPOS)), TODOPOS.slice(0,120));
// cada barra dice su dia y su numero al pasar por encima
chk('cada barra nombra su dia y su cierre', /<title>2026-10-02: -50<\/title>/.test(MS), MS.slice(0,120));
// el escape se prueba DENTRO del title: el aria-label tambien lleva la fecha,
// asi que buscar &lt;x&gt; en cualquier parte del svg pasa igual sin escapar.
const ESC=A.miniSemana([{dia:'<x>',cierre:1}]);
chk('el dia va escapado dentro del title de la barra',
    /<title>&lt;x&gt;: 1<\/title>/.test(ESC), ESC.slice(ESC.indexOf('<rect')));
chk('y tampoco se cuela un tag crudo en el resto del svg',
    ESC.indexOf('<x>')<0, ESC.slice(0,160));
// un dia sin fecha no dibuja una barra anonima ni ensucia el rotulo: se cae
// del dibujo, porque una barra que no puede decir de que dia es no informa.
const SINF=A.miniSemana([{dia:null,cierre:5},{dia:'2026-10-02',cierre:3}]);
chk('un dia sin fecha no dibuja barra', (SINF.match(/<rect /g)||[]).length===1,
    String((SINF.match(/<rect /g)||[]).length));
chk('y el rotulo arranca en el primer dia que SI tiene fecha',
    /del 2026-10-02 al 2026-10-02/.test(SINF), SINF.slice(0,150));
chk('si ninguno tiene fecha no dibuja nada',
    A.miniSemana([{dia:null,cierre:5}])==='');
chk('todo cabe en su caja', (()=>{const vb=/viewBox="0 0 (\d+) (\d+)"/.exec(MS);
    const W=+vb[1],H=+vb[2];
    return [...MS.matchAll(/x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)]
      .every(m=>+m[1]>=0 && +m[2]>=0 && +m[1]+ +m[3]<=W && +m[2]+ +m[4]<=H);})());

console.log('\n— la semana viaja en el desglose de planta —');
const CP=A.composiciones(D,BS);
chk('cada fila de planta trae su semana',
    CP.planta.filas.every(f=>Array.isArray(f.sem)), '');
chk('con los dias de ESA estacion',
    CP.planta.filas.find(f=>/RT13-100/.test(f.b)).sem.length===3,
    String(CP.planta.filas.find(f=>/RT13-100/.test(f.b)).sem.length));
chk('la que no tiene dias trae la semana vacia, no inventada',
    CP.planta.filas.find(f=>/RT07-126/.test(f.b)).sem.length===0);
chk('y la nota avisa que cada mini-serie va en su propia escala',
    /propia escala/.test(CP.planta.nota), CP.planta.nota.slice(0,60));
// el desglose sigue cuadrando: la semana es adorno, no cambia la suma
chk('agregar la semana no mueve la suma', CP.planta.cuadra && CP.planta.suma===7877,
    String(CP.planta.suma));
const HP=A.desgloseHtml(CP.planta);
chk('el html de la fila dibuja la mini-serie', /<div class="sem"><svg class="mini"/.test(HP));
chk('y dice el tramo que cubre', /cierre del 2026-10-01 al 2026-10-03/.test(HP));
chk('una fila sin semana no dibuja una vacia',
    !/class="sem"/.test(A.desgloseHtml(CP.anio)));

console.log('\n— el cajon de mes viaja al navegador —');
const PGM=A.pagina(D);
chk('el renderizador de la mini-serie va publicado', PGM.indexOf('function miniSemana(')>=0);
chk('y el mapa de apertura tambien', /var APER = \{/.test(PGM));
chk('con el mes del peor dia de la estacion que lo tiene',
    /"RT13-100":"2026-10"/.test(PGM), (PGM.match(/var APER = .{0,120}/)||[''])[0]);
chk('la estacion sin dias va en nulo, no en un mes cualquiera',
    /"RT07-126":null/.test(PGM));
chk('el cajon elige el mes de la estacion y no el del tablero',
    PGM.indexOf('APER[cod] || MES0')>=0);
chk('y si ese mes no existe cae al ultimo que la estacion tenga',
    PGM.indexOf('ms.indexOf(M) < 0')>=0);
chk('los chips de mes se dibujan con el cod y el mes a cuestas',
    PGM.indexOf('data-dc=')>=0 && PGM.indexOf('data-dm=')>=0);
chk('y el chip se atiende antes que la fila que abrio el cajon',
    PGM.indexOf('el.closest("[data-dm]")') < PGM.indexOf('el.closest("[data-cod]")'));
chk('una sola estacion con un solo mes no muestra selector',
    A.pagina(Object.assign({},D,{planta_dias:[SERIE[1]]})).indexOf('ms.length > 1')>=0);
// un mes con un solo dia no dice "1 dias ... del X al X"
chk('un mes de un solo dia se lee en singular',
    PGM.indexOf("día con movimiento, el ")>=0 && PGM.indexOf("r.n === 1 ?")>=0);
chk('el html sigue cerrando los script que abre',
    (PGM.match(/<script/g)||[]).length===(PGM.match(/<\/script>/g)||[]).length,
    (PGM.match(/<script/g)||[]).length+'/'+(PGM.match(/<\/script>/g)||[]).length);

console.log('\n— el nivel diario de la planta entera se arrastra, no se suma —');
// Dos estaciones que no se mueven el mismo dia. Sumar las filas del dia daria
// el nivel de UNA sola; lo correcto es arrastrar la que no tuvo documento.
const DOS=[
  {cod:'A',nom:'A',nivel:30,dias:[dia('2026-10-01',10,0,0,10), dia('2026-10-03',10,20,0,30)]},
  {cod:'B',nom:'B',nivel:5,dias:[dia('2026-10-02',100,0,95,5)]},
];
const ND=A.nivelDiarioDePlanta(DOS);
chk('el calendario junta los dias de todas las estaciones',
    ND.map(x=>x.dia).join(',')==='2026-10-01,2026-10-02,2026-10-03', ND.map(x=>x.dia).join(','));
// el dia 1 B todavia no se movio: vale su apertura (100), no cero
chk('antes de su primer dia, una estacion vale su apertura, no cero',
    ND[0].cierre===110, String(ND[0].cierre));
chk('el dia que solo se mueve una, la otra arrastra su nivel',
    ND[1].cierre===15, String(ND[1].cierre));
chk('y al final suma los ultimos cierres de cada una',
    ND[2].cierre===35, String(ND[2].cierre));
// LA PRUEBA QUE IMPORTA: el ultimo total cae en el saldo vivo de SAP.
// SERIE no sirve para esto — sus niveles declarados (7.877) no son el final de
// sus propios dias (125), y ESA incoherencia la prueba el test de mas abajo.
// Aca hace falta un fixture que SI cuadre consigo mismo, que es lo unico que
// permite probar que el arrastre aterriza donde debe.
const COHS=[
  {cod:'RT13-100',nom:'SANTIAGO INSPECCION',nivel:300,dias:[
    dia('2026-10-01',100,250,50,300), dia('2026-10-03',300,0,100,200),
    dia('2026-10-05',200,100,0,300)]},
  {cod:'RT13-102',nom:'SANTIAGO REPARACION',nivel:80,dias:[
    dia('2026-10-02',50,40,10,80)]},
];
const COHD={pool:1000,pool_sap:1000,fuera_del_pool:0,
  bodegas:{CLIENTES:{nivel:620,socios:600,residuo:20,n:3},
           RETAIL:{nivel:0,socios:0,residuo:0,n:0},
           PLANTA:{nivel:380,fuera:0,sap:380}},
  anio:{ret:0,cli:0}, meses:[], planta:[
    {cod:'RT13-100',nom:'SANTIAGO INSPECCION',nivel:300,nueve:true},
    {cod:'RT13-102',nom:'SANTIAGO REPARACION',nivel:80,nueve:true}],
  planta_dias:COHS, planta_ancla:'2026-10-05T12:00:00.000Z', controles:[],
  ventana:{nivel:'2026-10-05',flujo_hasta:'2026-10-05',flujo_desde:'2026-10-01'}};
const NDR=A.nivelDiarioDePlanta(COHS);
chk('el ultimo total cae exactamente en el indicador declarado',
    NDR[NDR.length-1].cierre===COHD.bodegas.PLANTA.nivel,
    NDR[NDR.length-1].cierre+' vs '+COHD.bodegas.PLANTA.nivel);
chk('y la suma de los ultimos cierres es ese mismo numero',
    COHS.reduce((a,b)=>a+b.dias[b.dias.length-1].cierre,0)===380);
chk('sin serie no inventa niveles',
    A.nivelDiarioDePlanta([]).length===0 && A.nivelDiarioDePlanta(null).length===0);
chk('una estacion sin dias no entra ni aporta cero',
    A.nivelDiarioDePlanta([SERIE[3]]).length===0);
// el orden del json no puede cambiar el resultado
const REV=A.nivelDiarioDePlanta([{cod:'A',nom:'A',nivel:30,dias:[
  dia('2026-10-03',10,20,0,30), dia('2026-10-01',10,0,0,10)]}]);
chk('los dias desordenados dan el mismo arrastre',
    REV.map(x=>x.dia+':'+x.cierre).join(',')==='2026-10-01:10,2026-10-03:30',
    REV.map(x=>x.dia+':'+x.cierre).join(','));
// el orden importa de verdad cuando una estacion todavia no empieza: su
// aporte es la apertura de su PRIMER dia, y si los dias vienen al reves la
// "primera" fila es la ultima y el nivel de arranque sale de otro dia
const DESORD=[
  {cod:'A',nom:'A',nivel:90,dias:[dia('2026-10-04',50,40,0,90), dia('2026-10-02',20,30,0,50)]},
  {cod:'B',nom:'B',nivel:5,dias:[dia('2026-10-01',5,0,0,5)]},
];
chk('el arrastre no depende del orden en que vengan los dias',
    A.nivelDiarioDePlanta(DESORD).map(x=>x.dia+':'+x.cierre).join(',')
      ==='2026-10-01:25,2026-10-02:55,2026-10-04:95',
    A.nivelDiarioDePlanta(DESORD).map(x=>x.dia+':'+x.cierre).join(','));
chk('una fecha ilegible no entra al calendario',
    A.nivelDiarioDePlanta([{cod:'A',dias:[{dia:'ayer',apertura:0,cierre:5},
      dia('2026-10-02',0,5,0,5)]}]).length===1);

console.log('\n— la mini-serie del nivel es una linea con su banda declarada —');
chk('sin dias no dibuja nada', A.miniNivel([])==='' && A.miniNivel(null)==='');
const MN=A.miniNivel([{dia:'2026-10-28',cierre:14210},{dia:'2026-10-31',cierre:16525},
                      {dia:'2026-11-03',cierre:13607}]);
chk('un punto por dia', (MN.match(/<circle /g)||[]).length===3,
    String((MN.match(/<circle /g)||[]).length));
chk('con su linea y su area', /<polyline [^>]*class="mn"/.test(MN) && /<path [^>]*class="mna"/.test(MN));
// la banda de la semana va escrita: una linea sin banda declarada exagera
chk('la banda de la semana va en el rotulo del svg',
    /entre 13\.607 y 16\.525/.test(MN), MN.slice(0,170));
chk('cada punto dice su dia y su monto', /<title>2026-10-31: 16\.525<\/title>/.test(MN));
chk('y el ultimo punto va marcado distinto',
    (MN.match(/class="mnu"/g)||[]).length===1 && /r="3" class="mnu"/.test(MN));
// el maximo arriba y el minimo abajo, no al reves
const ys=[...MN.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map(m=>+m[1]);
chk('el maximo queda mas arriba que el minimo', ys[1]<ys[0] && ys[1]<ys[2],
    ys.join(','));
chk('el ultimo, que es el minimo, queda al fondo', ys[2]===Math.max(...ys), ys.join(','));
// una semana sin variacion no divide por cero ni dibuja un salto
const PLANA=A.miniNivel([{dia:'2026-10-01',cierre:100},{dia:'2026-10-02',cierre:100}]);
const yp=[...PLANA.matchAll(/cy="([\d.]+)"/g)].map(m=>+m[1]);
chk('una semana sin variacion es una linea recta, no un error',
    yp.length===2 && yp[0]===yp[1] && isFinite(yp[0]), yp.join(','));
chk('y un solo dia tampoco revienta',
    /<circle /.test(A.miniNivel([{dia:'2026-10-01',cierre:9}])));
chk('todo cabe en la caja', (()=>{const vb=/viewBox="0 0 (\d+) (\d+)"/.exec(MN);
    const W=+vb[1],H=+vb[2];
    return [...MN.matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
      .every(m=>+m[1]-+m[3]>=0 && +m[2]-+m[3]>=0 && +m[1]+ +m[3]<=W && +m[2]+ +m[3]<=H);})(),
    MN.slice(MN.indexOf('<circle')));
chk('la fecha va escapada en el title',
    /<title>&lt;x&gt;: 1<\/title>/.test(A.miniNivel([{dia:'<x>',cierre:1}])));

console.log('\n— la tarjeta de planta publica su semana —');
const TJP=A.tarjetas(D,BS).find(x=>x.clave==='planta');
chk('la tarjeta trae la semana del nivel', Array.isArray(TJP.sem) && TJP.sem.length>0,
    String(TJP.sem&&TJP.sem.length));
chk('y la marca como nivel, no como cierres de estacion', TJP.semTipo==='nivel', TJP.semTipo);
chk('el rotulo declara la banda de la semana', /entre <b>/.test(TJP.semRot), TJP.semRot);
// el numero de la tarjeta y el ultimo de la linea tienen que ser el mismo,
// y cuando lo son la tarjeta lo dice en vez de dejarlo a la fe del que mira
const TJC=A.tarjetas(COHD,A.bodegasDelCockpit(COHS)).find(x=>x.clave==='planta');
chk('con un dato que cuadra, declara que el cierre es el saldo de SAP',
    /el mismo saldo que SAP/.test(TJC.semRot), TJC.semRot);
chk('y el ultimo punto de la linea ES el numero que la tarjeta publica',
    TJC.sem[TJC.sem.length-1].cierre===COHD.bodegas.PLANTA.nivel,
    TJC.sem[TJC.sem.length-1].cierre+' vs '+TJC.kv);
// y cuando NO cuadra —el fixture SERIE no cuadra consigo mismo— la tarjeta
// tiene que decirlo, no dibujar la linea y callarse
chk('si la linea no cierra en el saldo de SAP, la tarjeta lo declara',
    /de diferencia/.test(TJP.semRot) && /malo/.test(TJP.semRot), TJP.semRot);
chk('nombrando los dos numeros y la diferencia',
    /la serie cierra en 125 y SAP dice 7\.877: -7\.752 de diferencia/.test(TJP.semRot),
    TJP.semRot);
chk('las otras tarjetas no se llenan de mini-series',
    A.tarjetas(D,BS).filter(x=>x.sem&&x.sem.length).length===1,
    String(A.tarjetas(D,BS).filter(x=>x.sem&&x.sem.length).length));
chk('y sin serie de planta la tarjeta no dibuja una linea vacia',
    (x=>!x.semRot&&(!x.sem||!x.sem.length))(
      A.tarjetas(Object.assign({},D,{planta_dias:[]}),BS).find(y=>y.clave==='planta')));

const PGS=A.pagina(D);
chk('la linea llega dibujada a la pagina, no a medias',
    /<svg class="mini nivel"/.test(PGS) && /class="mnu"/.test(PGS));
chk('con el rotulo al lado', /nivel del 2026-10-01 al /.test(PGS), '');
chk('y una sola vez: es la tarjeta de planta, no todas',
    (soloCuerpo(PGS).match(/<svg class="mini nivel"/g)||[]).length===1,
    String((soloCuerpo(PGS).match(/<svg class="mini nivel"/g)||[]).length));

console.log('\n— el javascript publicado COMPILA —');
// Se arma como un arreglo de strings, asi que nada lo revisa hasta que alguien
// abre la pagina. Un "quietas()" sin punto y coma seguido de "[].forEach" se
// parsea como quietas()[] y revienta la interaccion entera en silencio: la
// pagina se ve bien y ningun chip responde. Esto lo caza en el test.
const PGJS=A.pagina(D);
const cuerpoJS=(() => { const i=PGJS.indexOf('<script>'), j=PGJS.lastIndexOf('<\/script>');
  return PGJS.slice(i+8, j); })();
chk('hay script y no esta vacio', cuerpoJS.length>2000, String(cuerpoJS.length));
chk('y el navegador lo va a poder parsear', (() => {
  try { new Function(cuerpoJS.replace(/<\\\/script/g, '</script')); return true; }
  catch (e) { return 'NO: ' + e.message; }
})()===true, (() => { try { new Function(cuerpoJS.replace(/<\\\/script/g,'</script')); return ''; }
  catch(e){ return e.message; } })());

console.log('\n— lo publicado se basta solo —');
// pct1 llama a pct. Se publico pct1 y no pct, y el resultado fue que la pagina
// cargaba perfecta y al primer clic en un filtro las ocho tarjetas reventaban
// con "pct is not defined" — sin que nada en el servidor fallara. Esta prueba
// mira cada funcion publicada, busca a quien llama, y exige que esa tambien
// este publicada. Es la unica forma de que no vuelva a pasar con la siguiente.
const PUB=(() => { const i=PGJS.indexOf('<script>'), j=PGJS.lastIndexOf('<\/script>');
  return PGJS.slice(i+8, j); })();
const declaradas=new Set([...PUB.matchAll(/^function ([A-Za-z_$][\w$]*)\(/gm)].map(m=>m[1])
  .concat([...PUB.matchAll(/^var ([A-Za-z_$][\w$]*) =/gm)].map(m=>m[1])));
// todo lo que el modulo exporta y que por lo tanto PODRIA hacer falta
const delModulo=new Set(Object.keys(A).concat(Object.keys(T)).filter(k=>typeof A[k]==='function'||typeof T[k]==='function'||Array.isArray(A[k])||Array.isArray(T[k])||(A[k]&&typeof A[k]==='object')));
const faltan=[];
for (const nom of declaradas) {
  const fn = A[nom] || T[nom];
  if (typeof fn !== 'function') continue;
  const src = fn.toString();
  for (const otro of delModulo)
    if (otro !== nom && new RegExp('[^\\w$.]' + otro.replace(/\$/g,'\\$') + '\\s*[(\\[.]').test(src)
        && !declaradas.has(otro) && faltan.indexOf(otro + ' ← ' + nom) < 0)
      faltan.push(otro + ' ← ' + nom);
}
chk('toda funcion publicada tiene publicado a quien llama', faltan.length===0, faltan.join(' · '));
chk('y la lista de publicadas no esta vacia', declaradas.size>20, String(declaradas.size));
chk('el dato viaja al navegador', /var DAT = \{/.test(PGJS));
chk('con las constantes que esas funciones necesitan',
    ['var ETAPAS =','var ORDEN_SALUD =','var GLIFO =','var NOMBRE_SALUD ='].every(x=>PGJS.indexOf(x)>=0));
// las dos listas de socios son el grueso del json y no las usa ninguna
// tarjeta: mandarlas seria peso por nada en cada carga
const GORDO={pool:1,retail:[{cod:'a'},{cod:'b'}],clientes:[{cod:'c'}],
             planta_dias:[{cod:'x'}],bodegas:{},controles:[]};
const FLACO=A.datosPublicables(GORDO);
chk('el dato publicado va sin las dos listas de socios',
    FLACO.retail===undefined && FLACO.clientes===undefined, Object.keys(FLACO).join(','));
chk('ni la serie de planta, que ya viaja comprimida aparte',
    FLACO.planta_dias===undefined, Object.keys(FLACO).join(','));
chk('y con todo lo demas intacto', FLACO.pool===1 && !!FLACO.bodegas && !!FLACO.controles,
    Object.keys(FLACO).join(','));

console.log('\n— el filtro de planta recalcula lo que es de planta —');
const TODAS=A.bodegasDelCockpit(SERIE);
const SGO=TODAS.filter(b=>b.planta==='SANTIAGO');
const TITSGO=A.titular(D,SGO,'SANTIAGO');
chk('el titular nombra la planta', /SANTIAGO/.test(TITSGO.frase), TITSGO.frase);
// con un filtro puesto el pool NO puede seguir en el titular: 803.459 al lado
// de la palabra SANTIAGO se lee como el pool de Santiago
chk('y deja de mostrar el pool, que es de toda la empresa',
    !/803\.459/.test(TITSGO.frase) && !/Pool de/.test(TITSGO.frase), TITSGO.frase);
chk('sin filtro el pool sigue estando', /Pool de/.test(A.titular(D,TODAS).frase));
chk('la cola cuenta solo los dias de esa planta',
    /de 5 días/.test(TITSGO.cola), TITSGO.cola);
const TJSGO=A.tarjetas(D,SGO,'SANTIAGO');
const plS=TJSGO.find(x=>x.clave==='planta');
chk('el indicador es la suma de las estaciones de esa planta',
    plS.kv===A.mil?undefined:plS.kv==='7.558', plS.kv);
chk('y el referencial son las bodegas fuera del indicador DE ESA PLANTA',
    /4\.164/.test(plS.ks), plS.ks.replace(/<[^>]+>/g,''));
// la mini-serie de la tarjeta tambien se recorta: si arrastrara las nueve
// estaciones con el titulo SANTIAGO, la linea diria una cosa y el numero otra
const soloSgo=SERIE.filter(x=>/^SANTIAGO/.test(x.nom));
const esperada=A.nivelDiarioDePlanta(soloSgo);
chk('la semana de la tarjeta se arrastra solo con las estaciones de esa planta',
    plS.sem[plS.sem.length-1].cierre===esperada[esperada.length-1].cierre,
    plS.sem[plS.sem.length-1].cierre+' vs '+esperada[esperada.length-1].cierre);
chk('y no es la misma que la general',
    plS.sem[plS.sem.length-1].cierre!==
      A.tarjetas(D,TODAS).find(x=>x.clave==='planta').sem.slice(-1)[0].cierre,
    plS.sem[plS.sem.length-1].cierre+' vs '+
      A.tarjetas(D,TODAS).find(x=>x.clave==='planta').sem.slice(-1)[0].cierre);
const TJTAL=A.tarjetas(D,TODAS.filter(b=>b.planta==='TALCA'),'TALCA');
chk('una planta sin bodegas de referencia lo dice, no muestra las de otra',
    /sin bodegas de referencia/.test(TJTAL.find(x=>x.clave==='planta').ks),
    TJTAL.find(x=>x.clave==='planta').ks.replace(/<[^>]+>/g,''));
// solo DOS de las ocho son de planta; las otras seis tienen que declararlo
const AMB=A.tarjetas(D,TODAS).map(x=>x.clave+':'+x.ambito);
chk('las ocho declaran su alcance', AMB.every(x=>/:(planta|global)$/.test(x)), AMB.join(' '));
chk('y solo dos son de planta',
    AMB.filter(x=>/:planta$/.test(x)).join(',')==='planta:planta,negativos:planta', AMB.join(' '));
chk('la tarjeta global publica su alcance y su rotulo',
    /data-ambito="global"/.test(A.tarjetaHtml(A.tarjetas(D,TODAS)[0],0)) &&
    /fuera-de-filtro/.test(A.tarjetaHtml(A.tarjetas(D,TODAS)[0],0)));
chk('y la de planta no lleva rotulo de que no se filtra',
    /data-ambito="planta"/.test(A.tarjetaHtml(plS,1)) && !/fuera-de-filtro/.test(A.tarjetaHtml(plS,1)));
// el rotulo va ESCRITO y oculto por css, no armado en el navegador: si el
// javascript no corre, la pagina no puede quedar mostrando el global sin aviso
chk('el rotulo viaja en el html, no lo arma el navegador',
    (soloCuerpo(A.pagina(D)).match(/<div class="fuera-de-filtro">/g)||[]).length===6,
    String((soloCuerpo(A.pagina(D)).match(/<div class="fuera-de-filtro">/g)||[]).length));

console.log('\n— el navegador recalcula con lo mismo que arma la pagina —');
// Ya no viajan vistas precalculadas: viajan el dato y las funciones. Lo que
// hay que probar es que esas funciones, llamadas como las llama el navegador,
// dan lo que corresponde para cada filtro.
const filaDe = bs => bs.map(A.filaCartera).join('');
chk('la tabla de una planta solo trae sus filas',
    (filaDe(SGO).match(/<tr /g)||[]).length===SGO.length &&
    !/TALCA/.test(filaDe(SGO)), String((filaDe(SGO).match(/<tr /g)||[]).length));
chk('y la matriz se recorta con ella',
    (A.matrizHtml(A.matrizPlantaEtapa(SGO)).match(/class="cel/g)||[]).length <
    (A.matrizHtml(A.matrizPlantaEtapa(TODAS)).match(/class="cel/g)||[]).length);
chk('los conteos de salud son del subconjunto, no del total',
    A.contarSalud(SGO)['']===SGO.length &&
    A.contarSalud(SGO).critica===SGO.filter(b=>b.salud.nivel==='critica').length,
    JSON.stringify(A.contarSalud(SGO)));
chk('sin bodegas los conteos son cero, no el total', A.contarSalud([])['']===0);

console.log('\n— el periodo recorta el movimiento, no el saldo —');
const PER=A.periodosDeSerie(SERIE);
chk('los meses y los dias son los que EXISTEN',
    PER.meses.join(',')==='2026-10' && PER.dias.length===4,
    PER.meses.join(',')+' · '+PER.dias.length);
chk('y declara hasta donde llega el dato',
    PER.desde==='2026-10-01' && PER.hasta==='2026-10-06', PER.desde+'→'+PER.hasta);
chk('sin serie no ofrece periodos', A.periodosDeSerie([]).dias.length===0 &&
    A.periodosDeSerie(null).meses.length===0);
// un selector que ofrezca un dia que no existe devuelve una pagina vacia, y
// una pagina vacia se lee como "ese dia no pasó nada"
const SUCIA=[{cod:'X',nom:'A B',dias:[{dia:'el martes',cierre:1},{dia:'2026-10-05',cierre:2}]}];
chk('una fecha ilegible no llega al selector',
    A.periodosDeSerie(SUCIA).dias.join(',')==='2026-10-05',
    A.periodosDeSerie(SUCIA).dias.join(','));
chk('ni al listado de meses',
    A.periodosDeSerie([{cod:'X',nom:'A B',dias:[{dia:'2026-13',cierre:1}]}]).meses.length===0);
// recortar por mes deja las estaciones y les quita los dias de fuera
const OCT=A.serieDelPeriodo(SERIE,'2026-10');
chk('un mes completo no pierde ninguna estacion', OCT.length===SERIE.length);
const UNDIA=A.serieDelPeriodo(SERIE,'2026-10-02');
chk('un dia deja solo ese dia',
    UNDIA.every(b=>b.dias.every(x=>x.dia==='2026-10-02')), JSON.stringify(UNDIA.map(b=>b.dias.length)));
chk('y la estacion que no se movio ese dia queda sin dias, no fuera',
    UNDIA.length===SERIE.length && UNDIA.some(b=>b.dias.length===0));
chk('sin periodo devuelve la serie tal cual', A.serieDelPeriodo(SERIE,'')===SERIE);
chk('y recortar no toca la serie original',
    SERIE[0].dias.length===3, String(SERIE[0].dias.length));
// una estacion sin movimiento en el periodo es SIN DATO, no sana: no haber
// tenido documento no es lo mismo que haber cerrado bien todos los dias
chk('la estacion sin movimiento en el periodo queda sin dato, no sana',
    A.bodegasDelCockpit(UNDIA).filter(b=>b.salud.nivel==='sindato').length>0,
    A.bodegasDelCockpit(UNDIA).map(b=>b.cod+':'+b.salud.nivel).join(' '));
// EL SALDO NO SE FILTRA POR FECHA, y la tarjeta tiene que decirlo
const TJPER=A.tarjetas(D,A.bodegasDelCockpit(OCT),undefined,'2026-10');
const plPER=TJPER.find(x=>x.clave==='planta');
chk('con periodo el indicador sigue siendo la lectura de hoy',
    plPER.kv===A.tarjetas(D,TODAS).find(x=>x.clave==='planta').kv, plPER.kv);
chk('y la tarjeta avisa que un saldo no se filtra por fecha',
    /no se filtra por fecha/.test(plPER.nota||''), String(plPER.nota));
chk('sin periodo no aparece esa nota',
    !A.tarjetas(D,TODAS).find(x=>x.clave==='planta').nota);
// con periodo la serie cierra donde termina el periodo, no en el saldo de
// hoy: reclamar un descalce ahi seria una alarma falsa
// la linea sigue a los dos filtros: una linea que llega a noviembre debajo de
// un tablero que dice "octubre" es la misma mentira que un numero sin filtrar
// EL ORDEN IMPORTA. Si se recorta la serie y despues se arrastra, la estacion
// que no tuvo movimiento en el periodo desaparece y su nivel se pierde: con
// cuatro de nueve estaciones con documento en noviembre, el total caia de
// 13.607 a 1.637. Se arrastra sobre la serie entera y se recorta el resultado.
const QUIETA=[
  {cod:'A',nom:'SANTIAGO INSPECCION',nivel:1000,dias:[
    dia('2026-10-30',0,1000,0,1000)]},
  {cod:'B',nom:'SANTIAGO PINTURA',nivel:7,dias:[
    dia('2026-10-30',0,5,0,5), dia('2026-11-02',5,2,0,7)]},
];
const TJQ=A.tarjetas(Object.assign({},D,{planta_dias:QUIETA}),
                     A.bodegasDelCockpit(A.serieDelPeriodo(QUIETA,'2026-11')),
                     undefined,'2026-11');
chk('la estacion sin movimiento en el periodo sigue aportando su nivel',
    TJQ.find(x=>x.clave==='planta').sem.slice(-1)[0].cierre===1007,
    String(TJQ.find(x=>x.clave==='planta').sem.slice(-1)[0].cierre));
chk('la semana de la tarjeta tambien se recorta al periodo',
    plPER.sem.every(x=>x.dia.slice(0,7)==='2026-10'),
    plPER.sem.map(x=>x.dia).join(' '));
const TJDIA=A.tarjetas(D,A.bodegasDelCockpit(A.serieDelPeriodo(SERIE,'2026-10-02')),
                       undefined,'2026-10-02');
chk('y con un dia elegido la linea es ese dia',
    TJDIA.find(x=>x.clave==='planta').sem.map(x=>x.dia).join(',')==='2026-10-02',
    TJDIA.find(x=>x.clave==='planta').sem.map(x=>x.dia).join(','));
chk('con periodo no se acusa descalce contra el saldo de hoy',
    !/de diferencia/.test(plPER.semRot||''), plPER.semRot);
chk('y dice a que fecha cierra', /cierra en <b>[\d.-]+<\/b> al 2026-10/.test(plPER.semRot||''),
    plPER.semRot);
chk('el selector de dia llega a la pagina con los dias que hay',
    (soloCuerpo(PGJS).match(/<option value="2026-10-\d\d">/g)||[]).length===PER.dias.length,
    String((soloCuerpo(PGJS).match(/<option value="2026-10-\d\d">/g)||[]).length));
chk('y la barra dice hasta donde alcanza el dato',
    /class="cobertura"/.test(PGJS) && /todavía no están extraídos/.test(PGJS));

console.log('\n' + ok + ' ok, ' + fail + ' fallas');
process.exit(fail ? 1 : 0);
