'use strict';
const O = require('./sonda-operarios.js');
let ok = 0, fail = 0;
const chk = (q, c, extra) => { if (c) { ok++; console.log('  ok   ' + q); }
  else { fail++; console.log('  FALLA ' + q + (extra !== undefined ? '  → ' + extra : '')); } };

console.log('— el digito verificador, contra casos conocidos —');
// Esto se verifica ANTES de usarlo: con los multiplicadores volviendo a 3 en
// vez de a 2, el algoritmo marcaba invalidos 53 de 53 RUT, y un 100% de
// rechazo es la firma de un error propio y no de 53 RUT malos.
chk('11111111-1', O.dv('11111111') === '1', O.dv('11111111'));
chk('12345678-5', O.dv('12345678') === '5', O.dv('12345678'));
chk('5126663-3', O.dv('5126663') === '3', O.dv('5126663'));
chk('1-9', O.dv('1') === '9', O.dv('1'));
chk('12329559-5 (Nelson, el que calza en los dos lados)', O.dv('12329559') === '5');
chk('19412330-2 (el que SAP tiene bien)', O.dv('19412330') === '2');
chk('19414330-3 (el que la planilla tiene mal como -2)', O.dv('19414330') === '3');
// los dos bordes del resto: 11 da '0' y 10 da 'K'
chk('el resto 11 da 0', O.dv('1000013') === '0', O.dv('1000013'));
chk('el resto 10 da K', O.dv('1000005') === 'K', O.dv('1000005'));
// los RUT reales que trae SAP validan: es la comprobacion de que el
// algoritmo quedo bien, no solo de que no revienta
chk('los RUT reales de SAP validan',
    O.dv('15543708') === '1' && O.dv('17184943') === '8' && O.dv('19105809') === '7');
chk('un numero con letras no tiene digito', O.dv('12a45') === null && O.dv('') === null && O.dv(null) === null);

console.log('\n— partir un codigo —');
chk('separa numero y digito', O.partirRut('12329559-5').numero === '12329559' && O.partirRut('12329559-5').digito === '5');
chk('aguanta puntos', O.partirRut('12.329.559-5').numero === '12329559');
chk('aguanta minuscula en la K', O.partirRut('18009265-k').digito === 'K');
chk('sin guion igual parte', O.partirRut('123295595').numero === '12329559');
chk('algo muy corto no se parte', O.partirRut('5').numero === null && O.partirRut('').numero === null);

console.log('\n— clasificar un codigo: la razon por la que no sirve —');
chk('un RUT bueno es un RUT', O.clasificarCodigo('12329559-5').clase === 'rut');
chk('y no trae motivo', O.clasificarCodigo('12329559-5').motivo === null);
chk('vacio es vacio', O.clasificarCodigo(null).clase === 'vacio' && O.clasificarCodigo('  ').clase === 'vacio');
// dos operarios reales tienen una FECHA cargada como codigo: alguien escribio
// algo tipo 11-01-26 y SAP lo guardo como fecha
chk('una fecha se nombra como fecha', O.clasificarCodigo('2026-01-11').clase === 'fecha',
    JSON.stringify(O.clasificarCodigo('2026-01-11')));
chk('y tambien con hora', O.clasificarCodigo('2026-02-11 00:00:00').clase === 'fecha');
chk('y en formato corto', O.clasificarCodigo('11-01-26').clase === 'fecha');
// el relleno valida el digito a veces, asi que no basta con el DV
chk('todas las cifras iguales es relleno', O.clasificarCodigo('3333-1').clase === 'relleno' ||
    O.clasificarCodigo('3333-1').clase === 'largo', JSON.stringify(O.clasificarCodigo('3333-1')));
// ARMADOS esta cargado en SAP como 99999999-9, y ese digito verificador
// CUADRA. Validar el DV no alcanza: hay que mirar tambien la forma
chk('99999999-9 valida el digito y NO es nadie',
    O.dv('99999999') === '9' && O.clasificarCodigo('99999999-9').clase === 'relleno',
    JSON.stringify(O.clasificarCodigo('99999999-9')));
chk('un codigo demasiado corto se nombra por su largo', O.clasificarCodigo('333-3').clase === 'largo');
chk('y uno demasiado largo tambien', O.clasificarCodigo('99999999999-9').clase === 'largo');
chk('un digito equivocado lo dice con el correcto',
    O.clasificarCodigo('19414330-2').clase === 'digito' &&
    /es 3, no 2/.test(O.clasificarCodigo('19414330-2').motivo),
    O.clasificarCodigo('19414330-2').motivo);
chk('un RUT de 6 cifras pasa (los antiguos existen)', O.clasificarCodigo('123456-5').clase !== 'largo');
// el relleno se nombra relleno AUNQUE el digito no cuadre: si se chequeara
// despues del digito, 1111111-9 saldria como "digito equivocado" y alguien
// iria a corregir un numero que nunca fue de nadie
chk('un relleno con el digito MAL igual es relleno',
    O.dv('1111111') === '4' && O.clasificarCodigo('1111111-9').clase === 'relleno',
    JSON.stringify(O.clasificarCodigo('1111111-9')));
chk('y con el digito bien tambien', O.clasificarCodigo('1111111-4').clase === 'relleno');
chk('333333-7 es relleno aunque valide', O.clasificarCodigo('333333-7').clase === 'relleno');
chk('algo ilegible se nombra ilegible', O.clasificarCodigo('----').clase === 'ilegible');

console.log('\n— un turno o un proceso no es una persona —');
chk('TURNO MAÑANA no es persona', O.pareceProceso('TURNO MAÑANA'));
chk('ARMADOS no es persona', O.pareceProceso('ARMADOS'));
chk('REPARACION PALLET PLANTA 2 no es persona', O.pareceProceso('REPARACION PALLET PLANTA 2'));
chk('una persona si es persona', !O.pareceProceso('NELSON JAVIER GUTIERREZ') && !O.pareceProceso('PEDRO ARAYA'));
chk('sin nombre no se afirma nada', !O.pareceProceso(null) && !O.pareceProceso(''));
// el patron va anclado al principio: alguien que se apellide asi es una
// persona, no un proceso
chk('una persona con esa palabra en medio del nombre SI es persona',
    !O.pareceProceso('JUAN ARMADO PEREZ') && !O.pareceProceso('ANA PLANTA SOTO'),
    String(O.pareceProceso('JUAN ARMADO PEREZ')));

console.log('\n— normalizar la orden —');
const CRUDA = { AbsoluteEntry: 98330, DocumentNumber: 100008560, ItemNo: 'REP-PAL-ROJOS',
                PostingDate: '2026-10-27T00:00:00Z', PlannedQuantity: 320, CompletedQuantity: 300,
                RejectedQuantity: 4, U_HX_OPERARIO: ' 12329559-5 ' };
const N = O.normalizarOrden(CRUDA);
chk('recorta la fecha a diez', N.fecha === '2026-10-27', N.fecha);
chk('recorta el codigo del operario', N.operario === '12329559-5', JSON.stringify(N.operario));
chk('trae las tres cantidades', N.planificada === 320 && N.completada === 300 && N.rechazada === 4);
chk('un operario vacio queda en null',
    O.normalizarOrden({ U_HX_OPERARIO: '   ' }).operario === null &&
    O.normalizarOrden({}).operario === null);
// una cantidad ausente NO es cero: cero es una orden sin produccion
chk('una cantidad ausente queda en null, no en cero',
    O.normalizarOrden({}).completada === null && O.normalizarOrden({ CompletedQuantity: 0 }).completada === 0);
chk('sin orden no revienta', O.normalizarOrden(null).operario === null);

console.log('\n— cual cantidad se usa —');
// un bono por produccion se paga sobre lo COMPLETADO; lo planificado es lo
// que se pensaba hacer
chk('se prefiere la completada', O.cantidadDeOrden({ planificada: 320, completada: 300 }).cual === 'completada');
chk('y vale lo completado', O.cantidadDeOrden({ planificada: 320, completada: 300 }).valor === 300);
chk('sin completada se cae a la planificada y lo dice',
    O.cantidadDeOrden({ planificada: 320, completada: null }).cual === 'planificada');
chk('una completada en CERO no se confunde con ausente',
    O.cantidadDeOrden({ planificada: 320, completada: 0 }).cual === 'completada' &&
    O.cantidadDeOrden({ planificada: 320, completada: 0 }).valor === 0);
chk('sin ninguna lo dice', O.cantidadDeOrden({}).cual === 'ninguna' && O.cantidadDeOrden({}).valor === 0);

console.log('\n— la cobertura por proceso —');
const ORD = [
  { item:'REP-PAL-ROJOS', operario:'12329559-5', completada:100 },
  { item:'REP-PAL-ROJOS', operario:'333-3',      completada:200 },
  { item:'REP-PAL-ROJOS', operario:null,         completada:50  },
  { item:'REP-PAL-ROJOS', operario:'99999999-9', completada:30  },
  { item:'PIN-PAL-ROJOS', operario:null,         completada:900 },
  { item:'PIN-PAL-ROJOS', operario:'15543708-1', completada:100 },
];
const NOM = new Map([['12329559-5','NELSON GUTIERREZ'], ['333-3','LUIS RENTERIA'],
                     ['99999999-9','ARMADOS'], ['15543708-1','PEDRO ARAYA']]);
const COB = O.coberturaPorProceso(ORD, NOM);
chk('el proceso mas grande va primero', COB[0].item === 'PIN-PAL-ROJOS', JSON.stringify(COB.map(c=>c.item)));
const rep = COB.find(c => c.item === 'REP-PAL-ROJOS');
chk('con RUT suma solo lo identificable', rep.conRut === 100, JSON.stringify(rep));
chk('sin operario va aparte', rep.sinOperario === 50);
chk('el codigo malo va aparte', rep.codigoMalo === 200);
// ARMADOS valida el digito pero no es nadie: no puede contarse como con RUT
chk('un nombre de proceso no cuenta como RUT', rep.noPersona === 30 && rep.conRut === 100);
chk('las cuatro columnas suman el total',
    rep.conRut + rep.sinOperario + rep.codigoMalo + rep.noPersona === rep.total, JSON.stringify(rep));
chk('el pintado queda casi todo sin operario',
    COB[0].sinOperario === 900 && COB[0].conRut === 100);
chk('sin ordenes no hay cobertura', O.coberturaPorProceso([], NOM).length === 0 &&
    O.coberturaPorProceso(null).length === 0);
chk('una orden sin item no se pierde',
    O.coberturaPorProceso([{ operario:'12329559-5', completada:5 }]).length === 1);
chk('acepta los nombres como objeto tambien',
    O.coberturaPorProceso(ORD, { '99999999-9':'ARMADOS' }).find(c=>c.item==='REP-PAL-ROJOS').noPersona === 30);
// Un turno puede estar cargado con un RUT que VALIDA. Ahi el nombre es lo
// unico que lo delata, asi que se mira ANTES que el digito verificador.
const TURNO = [{ item:'X', operario:'12329559-5', completada:70 }];
const NOMT = new Map([['12329559-5','TURNO TARDE']]);
chk('un turno con RUT valido no cuenta como con RUT',
    O.coberturaPorProceso(TURNO, NOMT)[0].noPersona === 70 &&
    O.coberturaPorProceso(TURNO, NOMT)[0].conRut === 0,
    JSON.stringify(O.coberturaPorProceso(TURNO, NOMT)[0]));

console.log('\n— los codigos que hay que arreglar —');
const ARR = O.codigosAArreglar(ORD, NOM);
chk('no lista los que estan bien', !ARR.some(a => a.codigo === '12329559-5'), JSON.stringify(ARR.map(a=>a.codigo)));
chk('el de mayor dano va primero', ARR[0].codigo === '(vacio)' && ARR[0].total === 950, JSON.stringify(ARR[0]));
chk('cada uno trae su motivo', ARR.every(a => a.motivo && a.motivo.length > 10), JSON.stringify(ARR));
chk('el de relleno dice por que', /6 a 8 cifras/.test(ARR.find(a=>a.codigo==='333-3').motivo));
chk('el de proceso dice por que', /turno o un proceso/.test(ARR.find(a=>a.codigo==='99999999-9').motivo));
chk('y trae el nombre para poder preguntarle a alguien',
    ARR.find(a=>a.codigo==='333-3').nombre === 'LUIS RENTERIA');
// y el turno con RUT valido tambien hay que arreglarlo
chk('un turno con RUT valido igual entra en la lista a arreglar',
    O.codigosAArreglar(TURNO, NOMT).length === 1 &&
    /turno o un proceso/.test(O.codigosAArreglar(TURNO, NOMT)[0].motivo),
    JSON.stringify(O.codigosAArreglar(TURNO, NOMT)));

console.log('\n— no se suman pallets con tablas —');
// La primera corrida contra SAP imprimio "300.594 de 403.095 (74,6%)" y ese
// numero no existe: sumaba 238.397 pallets con 164.698 tablas y tacos.
chk('un proceso que nombra PAL produce pallets',
    O.familiaDeItem('REP-PAL-ROJOS','11111111110') === 'pallet' &&
    O.familiaDeItem('INSP-PAL-ROJOS','11111111110') === 'pallet' &&
    O.familiaDeItem('PIN-PAL-ROJOS-TALCA','11111111110') === 'pallet');
chk('el item del pallet tambien', O.familiaDeItem('11111111110','11111111110') === 'pallet');
chk('y sus semielaborados', O.familiaDeItem('11111111110-1','11111111110') === 'pallet' &&
    O.familiaDeItem('11111111110-2','11111111110') === 'pallet');
// una tabla NO es un pallet: 21111611110 empieza parecido y no lo es
chk('una tabla es insumo', O.familiaDeItem('21111611110','11111111110') === 'insumo' &&
    O.familiaDeItem('22112811110','11111111110') === 'insumo', O.familiaDeItem('21111611110','11111111110'));
chk('la conversion de pintura es insumo', O.familiaDeItem('CONVER-PINT-ROJA','11111111110') === 'insumo');
chk('no distingue mayusculas', O.familiaDeItem('rep-pal-rojos','11111111110') === 'pallet');
chk('sin item cae en insumo', O.familiaDeItem(null,'11111111110') === 'insumo' && O.familiaDeItem('','x') === 'insumo');
// el item del pallet es un parametro: si cambia, la regla lo sigue
chk('el item del pallet se puede cambiar',
    O.familiaDeItem('99999','99999') === 'pallet' && O.familiaDeItem('11111111110','99999') === 'insumo');
// el guion importa: un item que EMPIEZA con el del pallet pero sigue con
// otra cifra es otro item, no una variante suya
chk('un item que solo empieza igual no es una variante',
    O.familiaDeItem('999997','99999') === 'insumo', O.familiaDeItem('999997','99999'));
const MIX = O.coberturaPorProceso([
  { item:'REP-PAL-ROJOS', operario:'12329559-5', completada:100 },
  { item:'INSP-PAL-ROJOS', operario:null, completada:900 },
  { item:'21111611110', operario:'12329559-5', completada:5000 },
  { item:'22112811110', operario:'333-3', completada:3000 },
], NOM, '11111111110');
chk('la cobertura marca la familia de cada proceso',
    MIX.filter(c=>c.familia==='pallet').length === 2 && MIX.filter(c=>c.familia==='insumo').length === 2,
    JSON.stringify(MIX.map(c=>[c.item,c.familia])));
const FAM = O.porFamilia(MIX);
chk('y se suman por separado',
    FAM.find(f=>f.familia==='pallet').total === 1000 &&
    FAM.find(f=>f.familia==='insumo').total === 8000, JSON.stringify(FAM));
chk('la familia mas grande va primero', FAM[0].familia === 'insumo');
chk('sin cobertura no hay familias', O.porFamilia([]).length === 0 && O.porFamilia(null).length === 0);
// un proceso al que no se le marco familia NO puede caer del lado de los
// pallets: ahi es donde se decide si se puede pagar
chk('sin familia marcada cae en insumo',
    O.porFamilia([{ total:7, conRut:0 }])[0].familia === 'insumo');
const VMIX = O.veredicto(MIX, [], [], 'completada');
chk('el veredicto da un porcentaje POR familia', /PALLETS:/.test(VMIX.texto) && /INSUMOS:/.test(VMIX.texto), VMIX.texto);
chk('y no uno solo que los mezcle', !/1\.000 de 9\.000/.test(VMIX.texto) && !/9\.000/.test(VMIX.texto), VMIX.texto);
chk('el de pallets sale con su propia cuenta', /900 de 1\.000 \(90\.0%\)/.test(VMIX.texto), VMIX.texto);
// el bono se paga por pallets: esa familia es la que decide el nivel
chk('el nivel lo decide la familia de los pallets', VMIX.nivel === 'no sirve para pagar', VMIX.nivel);
const SOLOINS = O.veredicto(O.coberturaPorProceso(
  [{ item:'21111611110', operario:null, completada:100 }], NOM, '11111111110'), [], [], 'completada');
chk('sin pallets decide la familia que haya', SOLOINS.nivel === 'no sirve para pagar', SOLOINS.nivel);
// los pallets mandan AUNQUE sean la familia mas chica: el bono se paga por
// pallets, no por tablas
const CHICO = O.veredicto(O.coberturaPorProceso([
  { item:'REP-PAL-ROJOS', operario:null, completada:100 },        // 100% sin RUT, y es lo que importa
  { item:'21111611110', operario:'12329559-5', completada:90000 }, // mucho mas grande y todo limpio
], NOM, '11111111110'), [], [], 'completada');
chk('los pallets mandan aunque sean la familia mas chica',
    CHICO.nivel === 'no sirve para pagar', CHICO.nivel + ' · ' + CHICO.texto);

console.log('\n— el mismo codigo en dos plantas —');
// una persona trabaja en una planta; el mismo codigo en las dos es la firma
// de dos personas compartiendolo, y el bono de una se le suma a la otra
chk('TALCA sale del nombre del item', O.plantaDeItem('REP-PAL-ROJOS-TALCA') === 'TALCA');
chk('y lo demas es Santiago', O.plantaDeItem('REP-PAL-ROJOS') === 'SANTIAGO' && O.plantaDeItem(null) === 'SANTIAGO');
chk('no distingue mayuscula', O.plantaDeItem('rep-pal-rojos-talca') === 'TALCA');
const DOS = O.codigosEnDosPlantas([
  { item:'REP-PAL-ROJOS', operario:'333-3', completada:100 },
  { item:'REP-PAL-ROJOS-TALCA', operario:'333-3', completada:200 },
  { item:'REP-PAL-ROJOS', operario:'12329559-5', completada:300 },
], NOM);
chk('encuentra el compartido', DOS.length === 1 && DOS[0].codigo === '333-3', JSON.stringify(DOS));
chk('con las dos cifras', DOS[0].SANTIAGO === 100 && DOS[0].TALCA === 200);
chk('el que trabaja en una sola planta no sale', !DOS.some(d => d.codigo === '12329559-5'));
chk('sin ordenes no revienta', O.codigosEnDosPlantas([]).length === 0 && O.codigosEnDosPlantas(null).length === 0);
// las ordenes SIN operario estan en las dos plantas por definicion y no son
// un codigo compartido: denunciarlas seria ruido sobre el hallazgo real
chk('las ordenes sin operario no salen como codigo compartido',
    O.codigosEnDosPlantas([{ item:'REP-PAL-ROJOS', operario:null, completada:10 },
                           { item:'REP-PAL-ROJOS-TALCA', operario:null, completada:10 }]).length === 0);

console.log('\n— el veredicto —');
const V = O.veredicto(COB, ARR, DOS, 'completada');
chk('dice cuanto no se puede atribuir', /1\.180 de 1\.380/.test(V.texto), V.texto);
chk('y con que porcentaje', /85\.5%/.test(V.texto), V.texto);
chk('y los nombra como pallets porque REP- y PIN- lo son', /PALLETS:/.test(V.texto), V.texto);
chk('la cuenta del veredicto cuadra con la cobertura',
    COB.reduce((s,c)=>s+c.total,0) === 1380 && COB.reduce((s,c)=>s+c.conRut,0) === 200);
// mas de un 5% sin atribuir no sirve para pagar: no es un detalle
chk('con tanto sin atribuir no sirve para pagar', V.nivel === 'no sirve para pagar', V.nivel);
chk('avisa del codigo en dos plantas', /DOS plantas/.test(V.texto));
// pagar sobre lo planificado es pagar por lo que se pensaba hacer
chk('avisa si se esta midiendo sobre la planificada',
    /PLANIFICADA/.test(O.veredicto(COB, ARR, [], 'planificada').texto));
chk('y no lo avisa si es la completada', !/PLANIFICADA/.test(V.texto));
const LIMPIO = O.veredicto([{ item:'X', total:100, conRut:100, sinOperario:0, codigoMalo:0, noPersona:0 }], [], [], 'completada');
chk('todo con RUT dicta que si', LIMPIO.nivel === 'si', LIMPIO.texto);
chk('y lo dice con sus palabras', /cuelgan de un RUT valido/.test(LIMPIO.texto), LIMPIO.texto);
const POCO = O.veredicto([{ item:'X', total:1000, conRut:980, sinOperario:20, codigoMalo:0, noPersona:0 }], [], [], 'completada');
chk('un 2% manda a revisar y no a parar', POCO.nivel === 'revisar', POCO.nivel);
// el umbral esta en 5%: un 10% ya no sirve para pagar un bono por persona
const DIEZ = O.veredicto([{ item:'X', total:1000, conRut:900, sinOperario:100, codigoMalo:0, noPersona:0 }], [], [], 'completada');
chk('un 10% ya no sirve para pagar', DIEZ.nivel === 'no sirve para pagar', DIEZ.nivel);
const CINCO = O.veredicto([{ item:'X', total:1000, conRut:950, sinOperario:50, codigoMalo:0, noPersona:0 }], [], [], 'completada');
chk('justo en el 5% todavia es revisar', CINCO.nivel === 'revisar', CINCO.nivel);
chk('sin ordenes lo dice', O.veredicto([], [], [], 'completada').nivel === 'sin datos');

console.log('\n' + ok + ' ok, ' + fail + ' fallas\n');
process.exit(fail ? 1 : 0);
