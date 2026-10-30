'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const A=require('./armar-cockpit-pool.js');
const T=require('./armar-tablero-stock.js');

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
const D={ pool:808183, pool_sap:812572, fuera_del_pool:4389, sistemico:17890,
  bodegas:{ CLIENTES:{nivel:217181,socios:215714,residuo:1467,n:69},
            RETAIL:{nivel:578401,socios:546386,residuo:32015,n:60},
            PLANTA:{nivel:12601,fuera:4389,sap:16990} },
  anio:{ret:28577,cli:29149}, meses:[{mes:'2026-10',etiqueta:'Oct',ret:5,cli:-3}],
  planta:[], planta_dias:SERIE, planta_ancla:'2026-10-30T15:54:23.303Z',
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
chk('sin dias bajo cero es verde', S0.nivel==='verde' && S0.n===0 && S0.de===2, JSON.stringify(S0));
chk('menos de la mitad es amarillo', S1.nivel==='amarillo' && S1.n===1 && S1.de===4, JSON.stringify(S1));
chk('la mitad o mas es rojo', S2.nivel==='rojo' && S2.n===2 && S2.de===3, JSON.stringify(S2));
// lo que no se puede evaluar NO se pinta de verde: esa es la forma mas barata
// de mentir en un tablero
chk('sin dias es sin dato, no verde', S3.nivel==='sindato' && S3.texto==='Sin dato', JSON.stringify(S3));
chk('y lo dice con su palabra', S0.texto==='Verde' && S1.texto==='Amarillo' && S2.texto==='Rojo');
// justo en la mitad el borde es rojo, no amarillo: redondear hacia el lado
// comodo es lo que hace que un tablero deje de servir
chk('exactamente la mitad ya es rojo',
    A.saludDeBodega({dias:[dia('2026-10-01',0,0,1,-1), dia('2026-10-02',-1,2,0,1)]}).nivel==='rojo');
// CERO NO ES NEGATIVO. Una bodega que cierra el día en cero está vacía, que es
// un estado perfectamente posible; TALCA REPARACION cierra así casi todos los
// días. Contarlo como imposible pondría media planta en rojo.
const CERO=A.saludDeBodega({dias:[dia('2026-10-01',5,0,5,0), dia('2026-10-02',0,3,3,0)]});
chk('un cierre en cero no es un dia negativo', CERO.nivel==='verde' && CERO.n===0, JSON.stringify(CERO));
chk('sin bodega no revienta', A.saludDeBodega(null).nivel==='sindato' && A.saludDeBodega({}).nivel==='sindato');

console.log('\n— las estaciones se ordenan por lo que hay que mirar primero —');
const BS=A.bodegasDelCockpit(SERIE);
chk('las cuatro entran', BS.length===4, String(BS.length));
// NO por saldo: RT13-102 tiene el saldo mas alto y va despues porque esta sana
chk('primero la roja, despues la amarilla, despues las sanas',
    BS.map(b=>b.salud.nivel).join(',')==='rojo,amarillo,verde,sindato', BS.map(b=>b.cod+':'+b.salud.nivel).join(' '));
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
chk('la celda con bodega trae su salud', cel('SANTIAGO','INSPECCION').salud.nivel==='rojo');
// un cruce que NO existe no es un cruce sano: es un cruce que no existe
chk('un cruce sin bodega se marca vacio, no verde',
    cel('TALCA','REPARACION').salud.nivel==='vacio' && cel('TALCA','REPARACION').bodega===null);
chk('sin bodegas no revienta', A.matrizPlantaEtapa(null).celdas.length===0);

console.log('\n— el titular dice la conclusion, no el dato —');
const TI=A.titular(D,BS);
chk('nombra cuantas estaciones estan mal', /2 de 4 estaciones/.test(TI.frase), TI.frase);
chk('con el pool al lado', /808\.183/.test(TI.frase));
chk('y el nivel es el peor que haya', TI.nivel==='rojo', TI.nivel);
chk('la cola trae los dias y el peor cierre', /3 de 9 días/.test(TI.cola) && /-10/.test(TI.cola), TI.cola);
// el dia que no haya negativos, el titular lo tiene que decir solo
const SANO=A.titular(D, A.bodegasDelCockpit([SERIE[1]]));
chk('sin negativos cambia solo', /ninguna estación/.test(SANO.frase) && SANO.nivel==='verde', SANO.frase);
// solo amarillas no es rojo
const AM=A.titular(D, A.bodegasDelCockpit([SERIE[2]]));
chk('solo amarillas no se declara rojo', AM.nivel==='amarillo', AM.nivel);
chk('sin serie lo dice y no inventa', /sin distribución diaria/.test(A.titular(D,[]).cola));

console.log('\n— las tarjetas —');
const TJ=A.tarjetas(D,BS);
chk('ocho tarjetas', TJ.length===8, String(TJ.length));
chk('la primera reparte el pool en tres', TJ[0].stack.length===3 &&
    TJ[0].stack.reduce((a,s)=>a+s.v,0)===808183, String(TJ[0].stack.reduce((a,s)=>a+s.v,0)));
chk('y declara el total de SAP', /812\.572/.test(TJ[0].ks));
chk('planta muestra el indicador, no lo que SAP tiene', TJ[1].kv==='12.601', TJ[1].kv);
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
chk('la fila trae los datos para filtrar', /data-planta="SANTIAGO"/.test(FC) && /data-salud="rojo"/.test(FC));
chk('y la salud con glifo y palabra', /◆/.test(FC) && /Rojo/.test(FC));
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

console.log('\n' + ok + ' ok, ' + fail + ' fallas');
process.exit(fail ? 1 : 0);
