'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const O=require('./sonda-oinm-bodega.js');

// ── el reparto de cantidades: LA LECCION DEL FALSO POSITIVO ────────────────
console.log('— las cantidades se reparten antes de mirarlas —');
const FILA = { WarehouseCode: 'RT13-105', WarehouseName: 'SANTIAGO DISPONIBLE',
               InStock: 1771, Committed: 40, Ordered: 12, CountedQuantity: 1770,
               MinimalStock: 0, MaximalStock: 0, MinimalOrder: 5,
               StandardAveragePrice: 3200.5,
               // StockValue lleva "stock" pero es plata: sin anclar el saldo,
               // el nivel de la bodega saldria en pesos. AdminQuantity lleva
               // "min" adentro de "Admin": sin anclar el limite, una cantidad
               // real se escondria como politica.
               StockValue: 9999999, AdminQuantity: 7,
               ItemWarehouseInfoCollection: [{ x: 1 }], Nada: null, Texto: 'hola' };
const c = O.clasificarCantidades(FILA);
const clase = k => (c.find(x => x.campo === k) || {}).clase;
chk('InStock es saldo', clase('InStock') === 'saldo', String(clase('InStock')));
// ESTO es lo que fallo la vez pasada: MinimalStock contiene "Stock"
chk('MinimalStock es limite, NO saldo', clase('MinimalStock') === 'limite', String(clase('MinimalStock')));
chk('MaximalStock es limite, NO saldo', clase('MaximalStock') === 'limite', String(clase('MaximalStock')));
chk('MinimalOrder es limite y no compromiso', clase('MinimalOrder') === 'limite', String(clase('MinimalOrder')));
chk('Committed es compromiso', clase('Committed') === 'compromiso', String(clase('Committed')));
chk('Ordered es compromiso', clase('Ordered') === 'compromiso', String(clase('Ordered')));
// un conteo de inventario no es el saldo del sistema: se ve pero no dicta
chk('CountedQuantity es ambigua, no saldo', clase('CountedQuantity') === 'ambigua', String(clase('CountedQuantity')));
chk('una coleccion no es una cantidad', clase('ItemWarehouseInfoCollection') === undefined);
chk('un nulo no es una cantidad', clase('Nada') === undefined);
chk('un texto no es una cantidad', clase('Texto') === undefined);
// el precio no lleva palabra de cantidad: no tiene por que entrar
chk('un precio no entra', clase('StandardAveragePrice') === undefined, String(clase('StandardAveragePrice')));
chk('pero la ambigua se muestra igual, no se calla', c.some(x => x.clase === 'ambigua'));
// el ancla del saldo: sin ella, un monto en pesos pasa a ser el nivel
chk('StockValue no es saldo: lleva "stock" pero es plata',
    clase('StockValue') === 'ambigua', String(clase('StockValue')));
// el ancla del limite: sin ella, cualquier campo con "min" adentro se esconde
chk('AdminQuantity no es limite: el "min" esta adentro de otra palabra',
    clase('AdminQuantity') === 'ambigua', String(clase('AdminQuantity')));
// un numero que viene como string no es un numero: sumarlo concatena
chk('un saldo que viene como texto no es un saldo',
    O.saldoDeFila({ OnHand: '500' }).saldo === null,
    JSON.stringify(O.saldoDeFila({ OnHand: '500' })));
chk('y el reparto sale ordenado por campo',
    c.map(x => x.campo).join() === c.map(x => x.campo).slice().sort((a, b) => a.localeCompare(b)).join(),
    c.map(x => x.campo).join());
chk('clasificarCantidades de nada', O.clasificarCantidades(null).length === 0);

// ── el saldo de una fila ───────────────────────────────────────────────────
console.log('\n— solo la clase saldo dicta —');
let s = O.saldoDeFila(FILA);
chk('el saldo sale de InStock y de ningun otro', s.saldo === 1771 && s.campo === 'InStock', JSON.stringify(s));
// una fila que SOLO trae limites —los dos en cero— es exactamente el caso que
// me hizo dictaminar "SI hay camino" cuando no lo habia
chk('una fila con puros limites no tiene saldo',
    O.saldoDeFila({ MinimalStock: 0, MaximalStock: 0 }).saldo === null);
chk('y dice por que', /ningun campo de saldo/.test(O.saldoDeFila({ MaximalStock: 0 }).motivo));
// dos candidatos: elegir uno a dedo es como no haber mirado
chk('con dos campos de saldo no se elige: se declara',
    O.saldoDeFila({ InStock: 10, OnHand: 20 }).saldo === null);
chk('y se nombran los dos', /InStock/.test(O.saldoDeFila({ InStock: 10, OnHand: 20 }).motivo) &&
    /OnHand/.test(O.saldoDeFila({ InStock: 10, OnHand: 20 }).motivo));
chk('un saldo en cero es un saldo, no una ausencia',
    O.saldoDeFila({ InStock: 0 }).saldo === 0, JSON.stringify(O.saldoDeFila({ InStock: 0 })));
chk('un saldo negativo se devuelve tal cual, no se recorta',
    O.saldoDeFila({ InStock: -50 }).saldo === -50);

// ── el nivel por bodega ────────────────────────────────────────────────────
console.log('\n— el nivel por bodega —');
// el orden de insercion es A PROPOSITO distinto del ordenado: si coincidiera,
// quitar el sort no rompería ninguna prueba
const CRUDAS = [
  { WarehouseCode: 'RT13-105', InStock: 1771 },
  { WarehouseCode: 'RT13-999', InStock: -12 },
  { WarehouseCode: 'CLIENTES', InStock: 214385 },
  { WarehouseCode: 'RT13-000', InStock: 0 },
  { WarehouseCode: 'RETAIL',   InStock: 579104 },
  { WarehouseCode: '  RT07-125  ', InStock: 559 },
  { WarehouseCode: null,       InStock: 900 },
  { WarehouseCode: 'RT13-XXX', MaximalStock: 0 },
  null,
];
const n = O.nivelPorBodega(CRUDAS);
chk('ordena de mayor a menor', n.filas[0].whs === 'RETAIL' && n.filas[1].whs === 'CLIENTES',
    n.filas.map(x => x.whs).join());
chk('recorta el codigo de bodega', n.filas.some(x => x.whs === 'RT07-125'),
    n.filas.map(x => x.whs).join());
// un saldo que no se sabe donde esta no es un saldo ubicado
chk('una fila sin codigo no entra al total', !n.filas.some(x => x.saldo === 900) && n.sinCodigo.length === 1);
chk('una bodega sin saldo legible se reporta, no se descarta',
    n.sinSaldo.length === 1 && n.sinSaldo[0].whs === 'RT13-XXX', JSON.stringify(n.sinSaldo));
chk('el negativo se conserva: es el hallazgo', n.filas.some(x => x.saldo === -12));
chk('un nulo en las filas no rompe', n.filas.length === 6, String(n.filas.length));

// ── el catalogo ────────────────────────────────────────────────────────────
console.log('\n— que bodega maneja ubicaciones —');
const CAT = [
  { WarehouseCode: 'RETAIL',   WarehouseName: 'BODEGA RETAILERS', EnableBinLocations: 'tYES' },
  { WarehouseCode: 'CLIENTES', WarehouseName: 'BODEGA CLIENTES',  EnableBinLocations: 'tYES' },
  { WarehouseCode: 'RT13-105', WarehouseName: 'SANTIAGO DISPONIBLE', EnableBinLocations: 'tNO' },
  { WarehouseCode: 'RT07-125', WarehouseName: 'TALCA DISPONIBLE', EnableBinLocations: false, Inactive: 'tYES' },
  { WarehouseCode: 'RT13-000', WarehouseName: 'SANTIAGO VACIA', EnableBinLocations: true },
  { WarehouseCode: null, WarehouseName: 'fantasma' },
];
const m = O.mapaBodegas(CAT);
chk('tYES es con ubicaciones', m.get('RETAIL').conUbicaciones === true);
chk('tNO es sin ubicaciones', m.get('RT13-105').conUbicaciones === false);
chk('el booleano tambien vale', m.get('RT07-125').conUbicaciones === false);
chk('la inactiva se marca', m.get('RT07-125').inactiva === true);
chk('el booleano true tambien vale', m.get('RT13-000').conUbicaciones === true);
chk('una bodega sin codigo no entra al mapa', m.size === 5, String(m.size));

const j = O.juntar(n.filas, m);
const de = w => j.find(x => x.whs === w);
chk('junta nombre con nivel', de('RETAIL').nombre === 'BODEGA RETAILERS');
// una bodega con saldo que no esta en el catalogo es justo la que despues
// aparece como una diferencia que nadie sabe de donde sale
chk('una bodega con saldo fuera del catalogo se marca, no se descarta',
    de('RT13-999').enCatalogo === false && de('RT13-999').conUbicaciones === null,
    JSON.stringify(de('RT13-999')));
chk('y sigue estando', j.length === 6, String(j.length));

// ── la flota ───────────────────────────────────────────────────────────────
console.log('\n— la flota, partida por si se puede abrir por socio —');
const t = O.totalFlota(j);
chk('el total los suma a todos, negativo incluido',
    t.total === 579104 + 214385 + 1771 - 12 + 559, String(t.total));
chk('lo que se puede abrir por socio', t.conUbicaciones === 579104 + 214385 + 0, String(t.conUbicaciones));
chk('lo que no se va a poder abrir nunca', t.sinUbicaciones === 1771 + 559, String(t.sinUbicaciones));
chk('y lo que no se sabe va aparte, no sumado a una de las dos',
    t.desconocidas === -12 && t.nDesconocidas === 1, String(t.desconocidas));
// las tres clases tienen que cubrir el total, si no hay plata perdida
chk('las tres clases suman el total',
    t.conUbicaciones + t.sinUbicaciones + t.desconocidas === t.total);
chk('la bodega negativa se caza', t.negativas.length === 1 && t.negativas[0].whs === 'RT13-999');
// una bodega vacia es posible; una bodega con menos de cero no
chk('una bodega en cero NO es una bodega imposible',
    !t.negativas.some(x => x.whs === 'RT13-000'), t.negativas.map(x => x.whs).join());
chk('totalFlota de nada', O.totalFlota(null).total === 0 && O.totalFlota([]).bodegas === 0);

// ── el control: bodega contra sus ubicaciones ──────────────────────────────
console.log('\n— el residuo: pallets en la bodega sin ubicacion asignada —');
let r = O.residuo(579104, 545923);
chk('el residuo es lo que la bodega tiene y las ubicaciones no', r.residuo === 33181, String(r.residuo));
chk('y en porcentaje de la bodega', Math.abs(r.porcentaje - 33181 / 579104) < 1e-12);
chk('un residuo positivo no es imposible: es una categoria que existe', r.imposible === false);
// las ubicaciones no pueden sumar mas que la bodega que las contiene
chk('un residuo NEGATIVO si es imposible', O.residuo(100, 150).imposible === true);
chk('residuo cero es cerrado y posible',
    O.residuo(100, 100).residuo === 0 && O.residuo(100, 100).imposible === false);
chk('una bodega en cero no divide por cero', O.residuo(0, 0).porcentaje === null);
chk('residuo de basura es null', O.residuo(null, 5) === null && O.residuo(5, 'x') === null);

// ── las urls ───────────────────────────────────────────────────────────────
console.log('\n— las rutas —');
const us = O.urlsNivel('https://h:50000/b1s/v1', '11111111110');
chk('tres rutas, la navegacion primero', us.length === 3 && /ItemWarehouseInfoCollection$/.test(us[0]), us[0]);
chk('el item va entre comillas simples', /Items\('11111111110'\)/.test(us[0]), us[0]);
// un apostrofo en el codigo partiria la url en dos
chk('un apostrofo se escapa duplicandolo', /Items\('a''b'\)/.test(O.urlsNivel('r', "a'b")[0]),
    O.urlsNivel('r', "a'b")[0]);
chk('sin raiz o sin item no hay rutas',
    O.urlsNivel('', 'x').length === 0 && O.urlsNivel('r', '  ').length === 0);
const ub = O.urlBodegas('https://h:50000/b1s/v1', 200, 400);
chk('el catalogo pide los cuatro campos que importan',
    /WarehouseCode%2CWarehouseName%2CEnableBinLocations%2CInactive/.test(ub), ub);
chk('y pagina', /\$top=200/.test(ub) && /\$skip=400/.test(ub), ub);
chk('urlBodegas sin raiz es null', O.urlBodegas(null) === null);

console.log('\n— de donde salen las filas de la respuesta —');
chk('envueltas en value', O.filasDeRespuesta({ value: [1, 2] }).length === 2);
chk('colgadas del item', O.filasDeRespuesta({ ItemWarehouseInfoCollection: [1] }).length === 1);
chk('peladas', O.filasDeRespuesta([1, 2, 3]).length === 3);
// una respuesta que no trae lista NO es una lista vacia: no dice nada
chk('lo que no es lista devuelve null, no una lista vacia',
    O.filasDeRespuesta({ ItemCode: 'x' }) === null && O.filasDeRespuesta(null) === null);

// ── el veredicto ───────────────────────────────────────────────────────────
console.log('\n— el veredicto —');
let v = O.veredicto(t, []);
chk('dicta que si hay camino', v.nivel === 'si', v.nivel);
chk('y dice cuanto se puede abrir por socio y cuanto no',
    /en bodegas CON ubicaciones/.test(v.texto) && /se pueden abrir por socio/.test(v.texto) &&
    /en bodegas SIN ubicaciones/.test(v.texto) && /no se van a poder abrir nunca/.test(v.texto), v.texto);
chk('y avisa de la bodega negativa', /NEGATIVO/.test(v.texto) && /RT13-999/.test(v.texto), v.texto);
chk('y avisa de la que no esta en el catalogo', /no estan en el catalogo/.test(v.texto), v.texto);
// sin bodegas con saldo NO hay camino, por mas que las rutas hayan dado 200
v = O.veredicto(O.totalFlota([]), [{ url: '/x', estado: 'HTTP 200 · vino sin filas' }]);
chk('sin saldo no hay camino', v.nivel === 'no', v.nivel);
chk('y se dicen las rutas que se probaron', /HTTP 200/.test(v.texto), v.texto);
chk('veredicto de nada', O.veredicto(null, null).nivel === 'no');

// ── la fila de muestra ─────────────────────────────────────────────────────
console.log('\n— la fila que se imprime de muestra —');
// la primera fila real fue '01 ALMACEN POR DEFECTO' con todo en cero: el
// bloque de clases no mostraba ningun valor y se veia igual que una ruta muda
const MUESTRAS = [ { WarehouseCode: '01', InStock: 0 },
                   { WarehouseCode: 'RT13-105', InStock: 1231 },
                   { WarehouseCode: 'RETAIL', InStock: 579008 },
                   { WarehouseCode: 'X', InStock: -900000 } ];
chk('elige la de mayor saldo en valor absoluto, no la primera',
    O.filaMuestra(MUESTRAS).WarehouseCode === 'X', String(O.filaMuestra(MUESTRAS).WarehouseCode));
chk('y no la mayor con signo', O.filaMuestra(MUESTRAS.slice(0, 3)).WarehouseCode === 'RETAIL');
// si todas estan en cero igual hay que mostrar una: ver los nombres de los
// campos vale aunque los valores no digan nada
chk('si todas estan en cero devuelve una igual',
    O.filaMuestra([{ WarehouseCode: 'A', InStock: 0 }]).WarehouseCode === 'A');
chk('una fila sin saldo legible no desplaza a una que si lo tiene',
    O.filaMuestra([{ WarehouseCode: 'A', MaximalStock: 0 }, { WarehouseCode: 'B', InStock: 5 }])
      .WarehouseCode === 'B');
// con TODO en cero, la que tiene saldo legible gana igual: lo que se quiere
// ver es el campo que dicta, aunque valga cero
chk('entre una ilegible y una en cero, gana la que tiene saldo legible',
    O.filaMuestra([{ WarehouseCode: 'A', MaximalStock: 0 }, { WarehouseCode: 'B', InStock: 0 }])
      .WarehouseCode === 'B',
    String(O.filaMuestra([{ WarehouseCode: 'A', MaximalStock: 0 }, { WarehouseCode: 'B', InStock: 0 }]).WarehouseCode));
// si NINGUNA trae saldo legible igual hay que mostrar una: ver los nombres de
// los campos es justo lo que dice por que no se pudo leer
chk('si ninguna tiene saldo legible devuelve una igual, no nada',
    (O.filaMuestra([{ WarehouseCode: 'A', MaximalStock: 0 }]) || {}).WarehouseCode === 'A',
    JSON.stringify(O.filaMuestra([{ WarehouseCode: 'A', MaximalStock: 0 }])));
chk('filaMuestra de nada', O.filaMuestra(null) === null && O.filaMuestra([]) === null);

// ── la salida para otro programa ───────────────────────────────────────────
console.log('\n— la salida json —');
const js = O.salidaJson(j, t, '11111111110', '2026-10-24T00:00:00Z');
chk('lleva la flota y las dos mitades',
    js.flota === t.total && js.conUbicaciones === t.conUbicaciones &&
    js.sinUbicaciones === t.sinUbicaciones, JSON.stringify([js.flota, js.conUbicaciones]));
chk('lleva todas las bodegas, las de cero incluidas', js.bodegas.length === j.length);
chk('cada bodega lleva si maneja ubicaciones',
    js.bodegas.find(b => b.whs === 'RETAIL').conUbicaciones === true &&
    js.bodegas.find(b => b.whs === 'RT13-105').conUbicaciones === false);
chk('y si estaba en el catalogo', js.bodegas.find(b => b.whs === 'RT13-999').enCatalogo === false);
chk('lleva el item y la fecha', js.item === '11111111110' && js.generado === '2026-10-24T00:00:00Z');
// quien lo consuma tiene que saber que es de hoy, no de una fecha cualquiera
chk('advierte que es el nivel de hoy y no sirve para una fecha pasada',
    /nivel de HOY/.test(js._ojo) && /no guarda historia/.test(js._ojo), js._ojo);
chk('y que no depende de ninguna semilla', /no depende de ninguna semilla/.test(js._que_es));
chk('sin fecha se pone una sola', typeof O.salidaJson([], null, 'x').generado === 'string');

// ── el canal del reporte ───────────────────────────────────────────────────
console.log('\n— con --json el reporte NO puede ir a stdout —');
const OK = function ok(){}, ERR = function err(){};
// esto fue un error de verdad: el primer --json imprimia el reporte y el json
// al mismo stdout, y redirigir a un archivo daba texto mezclado con json
chk('con --json el reporte se va por el otro canal', O.canalReporte(true, OK, ERR) === ERR);
chk('sin --json el reporte va por el canal normal', O.canalReporte(false, OK, ERR) === OK);
chk('y la decision es por la bandera, no al revés',
    O.canalReporte(true, OK, ERR) !== O.canalReporte(false, OK, ERR));

// ── integracion: los canales de verdad, en un proceso de verdad ───────────
console.log('\n— stdout no se ensucia nunca —');
// Sin credenciales la sonda falla cerrado. Lo que importa aca es que stdout
// quede VACIO: si escribiera el mensaje de error ahi, redirigir a un archivo
// dejaria un .json con texto adentro, que es justo el bug que hubo.
const { spawnSync } = require('child_process');
const env = Object.assign({}, process.env);
for (const k of ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB']) delete env[k];
const run = spawnSync(process.execPath, [__dirname + '/sonda-oinm-bodega.js', '--json'],
                      { env, encoding: 'utf8', timeout: 20000 });
chk('sin credenciales falla cerrado', run.status === 1, String(run.status));
chk('y stdout queda vacio: un redirect no deja basura',
    run.stdout === '', JSON.stringify(String(run.stdout).slice(0, 80)));
chk('el aviso va por stderr', /Faltan variables de entorno/.test(run.stderr), String(run.stderr).slice(0, 80));
// y nunca el valor de una credencial, solo su nombre
// la regla de la casa: se nombra la variable que falta, NUNCA su valor. Un
// '=' en el mensaje seria la primera señal de que se filtro uno.
chk('nombra las variables que faltan', /SAP_PASS/.test(run.stderr) && /SAP_DB/.test(run.stderr),
    String(run.stderr).slice(0, 120));
chk('y ningun valor: no hay un solo = en el mensaje', !/=/.test(run.stderr),
    String(run.stderr).slice(0, 120));

console.log('\n— opciones —');
chk('--item es opcion con valor', O.OPCIONES.indexOf('item') >= 0);
chk('--todas es bandera', O.BANDERAS.indexOf('todas') >= 0);
chk('--json es bandera', O.BANDERAS.indexOf('json') >= 0);
chk('--salida es opcion con valor', O.OPCIONES.indexOf('salida') >= 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
