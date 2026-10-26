'use strict';
let ok=0, fail=0;
const chk=(n,c,d)=>{ if(c){ok++;console.log('  ok   '+n);} else {fail++;console.log('  FALLA '+n+(d?'  → '+d:''));} };
const P=require('./saldo-pool.js');
const V=require('./validar-arriendo-bin.js');

// ── deltaDiario ────────────────────────────────────────────────────────────
console.log('— el delta diario por socio —');
const MAPA = new Map([[10, 'R1'], [20, 'R2']]);
let dd = P.deltaDiario([
  { BinAbsEntry: 10, DocDate: '2026-01-05', delta: -40 },
  { BinAbsEntry: 10, DocDate: '2026-01-05', delta: 100 },
  { BinAbsEntry: 20, DocDate: '2026-01-06', delta: 7 },
  { BinAbsEntry: 99, DocDate: '2026-01-06', delta: 500 },
  { BinAbsEntry: 99, DocDate: '2026-01-07', delta: -500 },
  { BinAbsEntry: 10, DocDate: '', delta: 3 },
  null], MAPA);
chk('acumula por socio y dia', dd.porSocio.get('R1').get('2026-01-05') === 60);
chk('cada socio su serie', dd.porSocio.get('R2').get('2026-01-06') === 7);
// dos filas sin mapa de signo opuesto: netearlas daria cero y haria
// desaparecer mil pallets que si se movieron
chk('lo que no esta en el mapa se cuenta aparte',
    dd.sinMapa === 2 && dd.palletsSinMapa === 1000, String(dd.palletsSinMapa));
chk('y en valor absoluto, no neteado', dd.palletsSinMapa !== 0);
chk('y no se reparte entre los socios', dd.porSocio.size === 2);
chk('una fila sin fecha se cuenta aparte', dd.sinFecha === 1);
chk('un nulo en las filas no entra a ningun socio ni a los contadores',
    dd.porSocio.get('R1').size === 1 && dd.sinMapa === 2, JSON.stringify([...dd.porSocio.get('R1')]));
chk('deltaDiario de nada', P.deltaDiario(null, MAPA).porSocio.size === 0);

// ── nivelDeSocio ───────────────────────────────────────────────────────────
console.log('\n— el nivel dia por dia, y el minimo que alcanza —');
const dias = V.diasDeVentana('2026-01-01', '2026-01-05');
let n = P.nivelDeSocio(100, new Map([['2026-01-03', 50]]), dias);
chk('arranca en la semilla y suma los deltas', n.nivel === 150, String(n.nivel));
chk('informa la partida', n.s0 === 100);
chk('y el cambio', n.cambio === 50);
chk('el minimo es la partida si nunca baja', n.min === 100, String(n.min));
// EL CONTROL: un socio que entrega mas de lo que tenia
n = P.nivelDeSocio(100, new Map([['2026-01-02', -300], ['2026-01-04', 400]]), dias);
chk('el nivel final puede estar bien', n.nivel === 200, String(n.nivel));
chk('pero el minimo delata el imposible', n.min === -200, String(n.min));
chk('y dice que dia', n.minDia === '2026-01-02', String(n.minDia));
chk('un socio sin movimiento se queda en la partida',
    P.nivelDeSocio(500, null, dias).nivel === 500);
chk('una semilla ilegible cuenta como cero',
    P.nivelDeSocio('x', null, dias).nivel === 0 && P.nivelDeSocio(null, null, dias).s0 === 0);
chk('sin dias no se mueve', P.nivelDeSocio(100, new Map([['2026-01-03', 50]]), []).nivel === 100);

// ── nivelesPool ────────────────────────────────────────────────────────────
console.log('\n— el pool completo, y los socios que no estan en la semilla —');
// la semilla viene en orden ALFABETICO y no por tamano: si el pool no se
// ordenara, el primero de la lista seria R2 con 40 y no R1 con 1.100
const sem = V.leerSemilla({ fecha: '2025-12-31', saldos: [
  { cod: 'R2', nom: 'CHICO', saldo: 50 }, { cod: 'R3', nom: 'QUIETO', saldo: 200 },
  { cod: 'R1', nom: 'GRANDE', saldo: 1000 }] });
let ns = P.nivelesPool(sem, P.deltaDiario([
  { BinAbsEntry: 10, DocDate: '2026-01-02', delta: 100 },
  { BinAbsEntry: 20, DocDate: '2026-01-02', delta: -10 },
  { BinAbsEntry: 30, DocDate: '2026-01-03', delta: 77 }],
  new Map([[10, 'R1'], [20, 'R2'], [30, 'R9']])), dias);
chk('estan los tres de la semilla mas el que no esta', ns.length === 4, String(ns.length));
chk('viene ordenado por nivel y no por el orden de la semilla',
    ns[0].cod === 'R1' && ns[0].nivel === 1100, JSON.stringify(ns.map(x => x.cod)));
chk('y el ultimo es el menor', ns[ns.length - 1].nivel <= ns[0].nivel);
// UN SOCIO CON MOVIMIENTO Y SIN SEMILLA no es un detalle: arranca en cero
const r9 = ns.find(x => x.cod === 'R9');
chk('el socio sin semilla se marca', r9 && r9.enSemilla === false);
chk('y arranca en cero', r9.s0 === 0 && r9.nivel === 77);
chk('los de la semilla se marcan como tales', ns.find(x => x.cod === 'R3').enSemilla === true);
chk('el que no se movio conserva su saldo', ns.find(x => x.cod === 'R3').nivel === 200);
chk('nivelesPool de nada', P.nivelesPool(null, null, dias).length === 0);

// ── resumenPool ────────────────────────────────────────────────────────────
console.log('\n— el resumen, con la concentracion —');
// hay un socio en NEGATIVO: el total tiene que incluirlo, porque si se
// suman solo los positivos el pool se infla y nadie ve el problema
let r = P.resumenPool([
  { cod: 'A', nivel: 271505, min: 100, enSemilla: true },
  { cod: 'B', nivel: 80814, min: 50, enSemilla: true },
  { cod: 'D', nivel: -1000, min: -1000, minDia: '2026-05-05', enSemilla: true },
  { cod: 'C', nivel: 0, min: 0, enSemilla: true }]);
chk('suma el total incluyendo al que esta en negativo', r.total === 351319, String(r.total));
chk('y no solo los positivos', r.total !== 352319);
chk('cuenta los que tienen saldo y no los que no', r.conSaldo === 2 && r.socios === 4);
chk('informa el mayor', r.mayor.cod === 'A');
// LA CONCENTRACION: un total sin saber cuanto pesa el primero esconde lo que importa
chk('y cuanto concentra', Math.abs(r.concentracion - 271505 / 351319) < 1e-12,
    String(r.concentracion));
chk('el que esta en negativo aparece en la lista',
    r.negativos.length === 1 && r.negativos[0].cod === 'D');
r = P.resumenPool([{ cod: 'A', nivel: 100, min: -5, minDia: '2026-02-01', enSemilla: true },
                   { cod: 'B', nivel: 50, min: 0, enSemilla: false }]);
chk('caza el negativo por el MINIMO y no por el nivel final',
    r.negativos.length === 1 && r.negativos[0].cod === 'A', JSON.stringify(r.negativos));
chk('y al que no esta en la semilla', r.sinSemilla.length === 1 && r.sinSemilla[0].cod === 'B');
chk('sin socios no hay concentracion', P.resumenPool([]).concentracion === null);
chk('resumenPool de nada', P.resumenPool(null).socios === 0);

// ── veredicto ──────────────────────────────────────────────────────────────
console.log('\n— el veredicto: para lo imposible no hay umbral —');
let v = P.veredicto(P.resumenPool([{ cod: 'A', nivel: 100, min: 10, enSemilla: true }]));
chk('todo sobre cero y con semilla: pasa', v.nivel === 'si', v.nivel);
chk('y dice el total y la concentracion', /100/.test(v.texto) && /100\.0%/.test(v.texto), v.texto);
// UN SOLO negativo basta: no hay tolerancia para lo que no puede pasar
v = P.veredicto(P.resumenPool([{ cod: 'A', nivel: 100, min: 10, enSemilla: true },
                               { cod: 'B', nivel: 5, min: -1, minDia: '2026-03-01', enSemilla: true }]));
chk('un solo negativo manda a revisar', v.nivel === 'revisar', v.nivel);
chk('y lo nombra con el dia', /B/.test(v.texto) && /2026-03-01/.test(v.texto), v.texto);
chk('y explica que significa', /menos de cero/.test(v.texto));
v = P.veredicto(P.resumenPool([{ cod: 'A', nivel: 100, min: 10, enSemilla: false }]));
chk('un socio sin semilla tambien manda a revisar', v.nivel === 'revisar');
// el fragmento "arrancan en cero" sobrevive a recortar el final de la frase,
// asi que hay que pedir la parte que dice QUE HACER
chk('y dice que faltan en la semilla', /Faltan en la semilla/.test(v.texto), v.texto);
chk('y los nombra, que son justo la lista que hay que ir a buscar',
    /\bA\b/.test(v.texto), v.texto);
chk('y advierte que el nivel es una cota, no un saldo',
    /cota inferior/.test(v.texto), v.texto);
chk('sin socios no hay veredicto', P.veredicto(P.resumenPool([])).nivel === 'sin datos' &&
    P.veredicto(null).nivel === 'sin datos');

// ── el reparto de lo no atribuido ──────────────────────────────────────────
console.log('\n— lo no atribuido se parte en dos razones distintas —');
const MAE = { ubicaciones: [ { AbsEntry: 10, CardCode: 'R1' }, { AbsEntry: 20, CardCode: 'R2' },
                             { AbsEntry: 30, CardCode: null }, { AbsEntry: 31, CardCode: null },
                             { AbsEntry: 40, CardCode: null, IsSystemBin: 'tYES' } ],
              socios: [ { cod: 'R1', nom: 'UNO SA' }, { cod: 'R9', nom: 'NUEVE SA' },
                        { cod: 'R8', nom: '  ' } ] };
const DEB = P.binsDeBodega(MAE).bins;
chk('el set de la bodega trae las ubicaciones sin socio', DEB.has(30) && DEB.has(31), [...DEB].join());
chk('y tambien las que si tienen socio', DEB.has(10) && DEB.has(20));
// una de sistema no es una ubicacion que haya que atribuir: si entrara al
// set, su movimiento se contaria como hueco de atribucion propio
chk('pero no las de sistema', !DEB.has(40) && DEB.size === 4, String(DEB.size));
chk('binsDeBodega de nada', P.binsDeBodega(null).total === 0 && P.binsDeBodega({}).total === 0);

// EL BUG: el maestro se arma desde los SOCIOS, y un socio puede tener
// ubicaciones en mas de una bodega. Contarlas todas rompia el movimiento de
// la bodega por 7.886 pallets.
const MAEW = { ubicaciones: [
  { AbsEntry: 10, CardCode: 'R1', Warehouse: 'RETAIL' },
  { AbsEntry: 20, CardCode: null, Warehouse: 'RETAIL' },
  { AbsEntry: 30, CardCode: 'R2', Warehouse: 'CLIENTES' },
  { AbsEntry: 40, CardCode: null, Warehouse: 'RT13-105' },
  { AbsEntry: 50, CardCode: 'R3' },
  { AbsEntry: 60, Warehouse: 'RETAIL', IsSystemBin: 'tYES' } ] };
const BW = P.binsDeBodega(MAEW, 'RETAIL');
chk('solo entran las ubicaciones de ESTA bodega',
    BW.bins.has(10) && BW.bins.has(20) && !BW.bins.has(30) && !BW.bins.has(40),
    [...BW.bins].join());
chk('y se dice cuantas eran de otra', BW.deOtra === 2, String(BW.deOtra));
// sin el campo no se adivina: entra, pero queda contada para que se vea
chk('una sin campo Warehouse entra pero se declara',
    BW.bins.has(50) && BW.sinCampo === 1, JSON.stringify([...BW.bins, BW.sinCampo]));
chk('las de sistema siguen afuera y se cuentan aparte',
    !BW.bins.has(60) && BW.sistema === 1);
chk('el total es lo que quedo adentro', BW.total === 3, String(BW.total));
// sin bodega objetivo no se filtra nada: es el modo viejo, explicito
chk('sin bodega objetivo entran todas', P.binsDeBodega(MAEW).total === 5,
    String(P.binsDeBodega(MAEW).total));
chk('el codigo de bodega se recorta antes de comparar',
    P.binsDeBodega({ ubicaciones: [{ AbsEntry: 1, Warehouse: '  RETAIL ' }] }, 'RETAIL').total === 1);
// --bodega= se escribe a mano y un espacio pegado es facil; sin recortar el
// objetivo, el filtro dejaria la bodega vacia y el residuo saldria enorme
chk('y el que viene por --bodega tambien se recorta',
    P.binsDeBodega({ ubicaciones: [{ AbsEntry: 1, Warehouse: 'RETAIL' }] }, ' RETAIL ').total === 1,
    String(P.binsDeBodega({ ubicaciones: [{ AbsEntry: 1, Warehouse: 'RETAIL' }] }, ' RETAIL ').total));

const FIL = [ { BinAbsEntry: 10, DocDate: '2026-01-05', delta: 5 },
              { BinAbsEntry: 30, DocDate: '2026-01-05', delta: -70 },
              { BinAbsEntry: 31, DocDate: '2026-01-06', delta: 30 },
              { BinAbsEntry: 99, DocDate: '2026-01-06', delta: 900 } ];
let d2 = P.deltaDiario(FIL, MAPA, DEB);
chk('la ubicacion de esta bodega sin socio es hueco de atribucion',
    d2.sinSocio === 2 && d2.palletsSinSocio === 100, d2.sinSocio + '/' + d2.palletsSinSocio);
chk('y se nombran las ubicaciones del hueco, no solo se cuentan',
    d2.binsSinSocio.has(30) && d2.binsSinSocio.has(31) && d2.binsSinSocio.size === 2);
chk('la de otra bodega es ruido esperado y va aparte',
    d2.deOtraBodega === 1 && d2.palletsDeOtraBodega === 900, String(d2.deOtraBodega));
// el invariante que impide que una fila se cuente dos veces o se pierda
chk('las tres razones suman exactamente lo no atribuido',
    d2.sinSocio + d2.deOtraBodega + d2.sinClasificar === d2.sinMapa &&
    d2.palletsSinSocio + d2.palletsDeOtraBodega + d2.palletsSinClasificar === d2.palletsSinMapa,
    [d2.sinSocio, d2.deOtraBodega, d2.sinClasificar, d2.sinMapa].join('/'));
chk('y lo atribuido no se toca', d2.porSocio.get('R1').get('2026-01-05') === 5);
// SIN el set no se adivina: poner 30 y 31 en "de otra bodega" seria inventar
let d3 = P.deltaDiario(FIL, MAPA);
// un arreglo es truthy pero no tiene .has: sin el guardia esto se cae a
// media corrida en vez de decir que no pudo clasificar
let d4 = P.deltaDiario(FIL, MAPA, [30, 31]);
chk('un set que no es Set no revienta la corrida, se declara sin clasificar',
    d4.sinClasificar === 3 && d4.sinSocio === 0,
    [d4.sinClasificar, d4.sinSocio].join('/'));
chk('sin el set de la bodega nada se clasifica, y se dice',
    d3.sinClasificar === 3 && d3.palletsSinClasificar === 1000 &&
    d3.sinSocio === 0 && d3.deOtraBodega === 0,
    [d3.sinClasificar, d3.sinSocio, d3.deOtraBodega].join('/'));

// ── los nombres del maestro ────────────────────────────────────────────────
console.log('\n— el nombre del socio cuando la semilla no lo tiene —');
const NOM = P.nombresDeMaestro(MAE);
chk('el maestro nombra a los socios', NOM.get('R1') === 'UNO SA' && NOM.get('R9') === 'NUEVE SA');
// un nombre en blanco no es un nombre: dejarlo pasar pinta la fila vacia en
// vez de caer al RUT, que al menos identifica
chk('un nombre en blanco no entra', !NOM.has('R8'), String(NOM.get('R8')));
chk('nombresDeMaestro de nada', P.nombresDeMaestro(null).size === 0);

// ── la cota inferior de la semilla ─────────────────────────────────────────
console.log('\n— cuanto le falta a la semilla, no "revisar esto" —');
let c = P.cotaSemilla({ s0: 499, min: -296 });
chk('la semilla tenia que ser al menos |minimo| mas alta', c.cota === 795, String(c && c.cota));
chk('y se dice por cuanto esta corta', c.falta === 296, String(c && c.falta));
// un socio sin semilla arranca en cero: la cota es el piso de lo que le falta
chk('sin semilla la cota es el piso del saldo que debe haber tenido',
    P.cotaSemilla({ s0: 0, min: -6488 }).cota === 6488);
chk('si nunca bajo de cero no hay cota que declarar',
    P.cotaSemilla({ s0: 100, min: 0 }) === null && P.cotaSemilla({ s0: 100, min: 7 }) === null);
chk('cotaSemilla de nada', P.cotaSemilla(null) === null && P.cotaSemilla({ s0: 1 }) === null);

// ── los quietos ────────────────────────────────────────────────────────────
console.log('\n— cambio cero: dormido o semilla congelada —');
const CU = new Set(['A']);
const qq = P.quietos([{ cod: 'A', nivel: 500, cambio: 0 }, { cod: 'B', nivel: 746, cambio: 0 },
                      { cod: 'C', nivel: 900, cambio: 12 }], CU);
chk('con ubicacion propia el cero es un dato: esta dormido',
    qq.dormidos.length === 1 && qq.dormidos[0].cod === 'A', qq.dormidos.map(x => x.cod).join());
chk('sin ninguna ubicacion el nivel es la semilla arrastrada',
    qq.sinUbicacion.length === 1 && qq.sinUbicacion[0].cod === 'B',
    qq.sinUbicacion.map(x => x.cod).join());
chk('el que se movio no es un quieto', qq.dormidos.concat(qq.sinUbicacion).every(x => x.cod !== 'C'));
// un cambio chico NO es cero: redondear aca borraria la distincion completa
chk('cambio de uno no es cambio cero',
    P.quietos([{ cod: 'D', nivel: 5, cambio: 1 }], CU).sinUbicacion.length === 0);
chk('sin el set de socios con ubicacion, todos caen en semilla congelada',
    P.quietos([{ cod: 'A', nivel: 1, cambio: 0 }], null).sinUbicacion.length === 1);
chk('quietos de nada', P.quietos(null, CU).dormidos.length === 0);

// ── el ancla de bodega ─────────────────────────────────────────────────────
console.log('\n— leer la salida de la sonda —');
const SONDA = { generado: '2026-10-24T13:00:00Z', item: '11111111110', bodegas: [
  { whs: 'RETAIL',   nombre: 'BODEGA RETAILERS', saldo: 579008, conUbicaciones: true },
  { whs: ' CLIENTES ', nombre: 'BODEGA CLIENTES', saldo: 212963, conUbicaciones: true },
  { whs: 'RT13-105', nombre: 'SANTIAGO DISPONIBLE', saldo: 1231, conUbicaciones: false },
  { whs: 'RT13-000', nombre: 'VACIA', saldo: 0, conUbicaciones: false },
  { whs: 'X', saldo: 'no soy un numero' },
  { whs: null, saldo: 5 }, null ] };
const BOD = P.leerBodegas(SONDA);
chk('trae el saldo por bodega', BOD.porWhs.get('RETAIL').saldo === 579008);
chk('recorta el codigo', BOD.porWhs.get('CLIENTES').saldo === 212963, [...BOD.porWhs.keys()].join());
// una bodega en cero es un dato: saber que esta vacia no es lo mismo que no saber
chk('una bodega en cero entra igual', BOD.porWhs.has('RT13-000'));
chk('un saldo que no es numero no entra', !BOD.porWhs.has('X'));
chk('una bodega sin codigo no entra', BOD.n === 4, String(BOD.n));
chk('conserva si maneja ubicaciones',
    BOD.porWhs.get('RETAIL').conUbicaciones === true &&
    BOD.porWhs.get('RT13-105').conUbicaciones === false);
chk('y la fecha del ancla', BOD.generado === '2026-10-24T13:00:00Z');
chk('leerBodegas de nada', P.leerBodegas(null).n === 0);

console.log('\n— el delta de la bodega entera, no solo de los socios —');
const DEB2 = new Set([10, 20, 30]);
const FIL2 = [ { BinAbsEntry: 10, DocDate: '2026-10-20', delta: 100 },
               { BinAbsEntry: 30, DocDate: '2026-10-20', delta: 7 },     // sin socio, pero es de la bodega
               { BinAbsEntry: 99, DocDate: '2026-10-20', delta: 5000 },  // de otra bodega
               { BinAbsEntry: 20, DocDate: '2026-10-21', delta: -40 },
               { BinAbsEntry: 10, DocDate: 'basura', delta: 9 }, null ];
const DB = P.deltaDeBodega(FIL2, DEB2);
// ESTA es la diferencia con deltaDiario: la ubicacion sin socio TAMBIEN mueve
// la bodega, y si no se cuenta el nivel hacia atras queda mal
chk('la ubicacion sin socio tambien mueve la bodega',
    DB.porDia.get('2026-10-20') === 107, String(DB.porDia.get('2026-10-20')));
chk('la de otra bodega no entra', DB.porDia.get('2026-10-20') !== 5107);
chk('acumula por dia', DB.porDia.get('2026-10-21') === -40);
chk('una fecha ilegible no entra', DB.usadas === 3, String(DB.usadas));
chk('sin set de bodega no cuenta nada, no cuenta todo',
    P.deltaDeBodega(FIL2, null).usadas === 0);

console.log('\n— el ancla tiene que caer dentro de lo que medimos —');
chk('mismo dia: pega', P.anclaAplicable('2026-10-23', '2026-10-23').ok === true);
// no es teorico: entre el 23 y el 24 se movieron 1.518 pallets
chk('un dia de brecha NO pega', P.anclaAplicable('2026-10-24', '2026-10-23').ok === false);
chk('y dice cuantos dias', P.anclaAplicable('2026-10-26', '2026-10-23').brecha === 3,
    String(P.anclaAplicable('2026-10-26', '2026-10-23').brecha));
chk('y lo explica', /nadie sumo/.test(P.anclaAplicable('2026-10-24', '2026-10-23').motivo));
// un ancla anterior a la cobertura es otro problema distinto y hay que decirlo
chk('un ancla ANTERIOR a la cobertura tampoco pega',
    P.anclaAplicable('2026-10-20', '2026-10-23').ok === false &&
    /ANTERIOR/.test(P.anclaAplicable('2026-10-20', '2026-10-23').motivo));
chk('con timestamp completo igual compara por dia',
    P.anclaAplicable('2026-10-23T18:40:00Z', '2026-10-23').ok === true);
chk('sin fecha no pega y se dice', P.anclaAplicable(null, '2026-10-23').ok === false);
// sin el guardia de formato, Date.parse da NaN y el mensaje sale diciendo
// "NaN dia(s) que nadie sumo": falso, y ademas ilegible para quien lo lea
chk('una fecha ilegible no pasa por buena', P.anclaAplicable('ayer', '2026-10-23').ok === false);
chk('y se dice que la fecha no es legible, no que faltan NaN dias',
    /no es legible/.test(P.anclaAplicable('ayer', '2026-10-23').motivo),
    P.anclaAplicable('ayer', '2026-10-23').motivo);

// ── el control que de verdad importa: cuando se leyo cada cosa ────────────
// ── las ubicaciones sin socio, como numero propio ─────────────────────────
// ── la ley de las lineas internas ─────────────────────────────────────────
console.log('\n— el neto mes a mes localiza la rotura —');
const PD = new Map([['2026-03-05', 100], ['2026-01-31', -40], ['2026-03-20', 7],
                    ['2026-02-01', 0], ['basura', 999], ['2026-1-5', 5]]);
const PM = P.netoPorMes(PD);
chk('agrupa por mes', PM.length === 3, JSON.stringify(PM));
chk('y suma dentro del mes', PM.find(x => x.mes === '2026-03').neto === 107,
    JSON.stringify(PM.find(x => x.mes === '2026-03')));
// orden cronologico: una serie desordenada no deja ver donde se rompio
chk('en orden cronologico, no en el que vinieron',
    PM.map(x => x.mes).join() === '2026-01,2026-02,2026-03', PM.map(x => x.mes).join());
// un mes en cero es un dato: dice que ese blob no movio nada
chk('un mes en cero aparece igual', PM.some(x => x.mes === '2026-02' && x.neto === 0));
chk('una fecha ilegible no inventa un mes',
    !PM.some(x => /basura|2026-1/.test(x.mes)), PM.map(x => x.mes).join());
chk('netoPorMes de nada', P.netoPorMes(null).length === 0 && P.netoPorMes(new Map()).length === 0);

console.log('\n— la serie diaria de un mes —');
const PD2 = new Map([['2026-02-10', 5], ['2026-01-31', 99], ['2026-02-03', -8],
                     ['2026-02-28', 0], ['2026-03-01', 7]]);
const SD = P.serieDiaria(PD2, '2026-02');
chk('solo los dias de ese mes', SD.length === 3, JSON.stringify(SD.map(x => x.dia)));
chk('en orden', SD.map(x => x.dia).join() === '2026-02-03,2026-02-10,2026-02-28', SD.map(x => x.dia).join());
// un dia en cero es un dato: si el otro lado movio ese dia, ahi esta el hueco
chk('un dia en cero aparece', SD.some(x => x.dia === '2026-02-28' && x.neto === 0));
chk('el 31 de enero no se cuela en febrero', !SD.some(x => x.dia === '2026-01-31'));
chk('acepta el mes con dia pegado', P.serieDiaria(PD2, '2026-02-15').length === 3);
chk('un mes ilegible no devuelve todo', P.serieDiaria(PD2, 'febrero').length === 0 &&
    P.serieDiaria(PD2, null).length === 0);
// una clave con hora tiene que salir como dia, no como timestamp
chk('una clave con hora se recorta a dia',
    P.serieDiaria(new Map([['2026-02-10T13:45:00Z', 4]]), '2026-02')[0].dia === '2026-02-10',
    P.serieDiaria(new Map([['2026-02-10T13:45:00Z', 4]]), '2026-02')[0].dia);
// y una clave basura NUNCA puede salir como dia, ni aunque el mes pedido sea
// la misma basura: lo que devuelve esta funcion son fechas o nada
chk('una clave basura no sale como dia ni pidiendo esa basura',
    P.serieDiaria(new Map([['basura1', 5]]), 'basura1').length === 0,
    JSON.stringify(P.serieDiaria(new Map([['basura1', 5]]), 'basura1')));
chk('serieDiaria de nada', P.serieDiaria(null, '2026-02').length === 0);

console.log('\n— un traspaso dentro de la misma bodega netea cero —');
const DEBF = new Set([10, 20]);
const FLF = [
  // interna que cumple: sale de un rack, entra al otro
  { DocEntry: 1, LineNum: 0, BinAbsEntry: 10, delta: -5 },
  { DocEntry: 1, LineNum: 0, BinAbsEntry: 20, delta: 5 },
  // cruzada: una punta adentro, la otra en otra bodega
  { DocEntry: 2, LineNum: 0, BinAbsEntry: 10, delta: -7 },
  { DocEntry: 2, LineNum: 0, BinAbsEntry: 99, delta: 7 },
  // una sola punta: la otra bodega no maneja ubicaciones
  { DocEntry: 3, LineNum: 0, BinAbsEntry: 20, delta: 3 },
  // interna a la que le falta la punta de entrada: ESTA es la fuga
  { DocEntry: 4, LineNum: 0, BinAbsEntry: 10, delta: -9 },
  { DocEntry: 4, LineNum: 0, BinAbsEntry: 20, delta: 0 },
  // enteramente de otra bodega
  { DocEntry: 5, LineNum: 0, BinAbsEntry: 98, delta: 400 },
  // UN documento con DOS lineas distintas: la primera es un traspaso interno
  // cuadrado, la segunda sale sola. Agrupar por documento las juntaria y el
  // descuadre de la linea 1 se escondería dentro de una "interna" falsa.
  { DocEntry: 6, LineNum: 0, BinAbsEntry: 10, delta: -4 },
  { DocEntry: 6, LineNum: 0, BinAbsEntry: 20, delta: 4 },
  { DocEntry: 6, LineNum: 1, BinAbsEntry: 10, delta: -6 },
  null ];
const FL = P.flujoPorLinea(FLF, DEBF);
chk('agrupa por documento Y linea, no solo por documento', FL.lineas === 7, String(FL.lineas));
chk('la interna que cumple no aporta al movimiento de la bodega',
    FL.interna.n === 3, String(FL.interna.n));
chk('la cruzada aporta solo la punta de adentro', FL.cruzada.neto === -7, String(FL.cruzada.neto));
chk('la de una punta aporta su delta', FL.unaPunta.n === 2 && FL.unaPunta.neto === -3,
    JSON.stringify(FL.unaPunta));
chk('la de otra bodega no aporta nada', FL.fuera.n === 1 && FL.fuera.neto === 0);
// LA LEY: si las internas no netean cero, a alguna le falta una punta
chk('el descuadre de las internas es el numero a perseguir',
    FL.descuadre === -9, String(FL.descuadre));
chk('y se dice que la ley no se cumple', FL.cumpleLey === false);
chk('el movimiento de la bodega es la suma de las tres clases',
    FL.netoBodega === FL.interna.neto + FL.cruzada.neto + FL.unaPunta.neto &&
    FL.netoBodega === -19, String(FL.netoBodega));
// una linea con las dos puntas adentro y bien netea cero: la ley SE cumple
const OK2 = P.flujoPorLinea(FLF.slice(0, 2), DEBF);
chk('con las internas cuadradas la ley se cumple',
    OK2.cumpleLey === true && OK2.descuadre === 0, JSON.stringify(OK2.interna));
// dos filas de la MISMA linea en el mismo bin siguen siendo una linea
chk('dos puntas en el mismo bin no inventan una linea',
    P.flujoPorLinea([{ DocEntry: 9, LineNum: 1, BinAbsEntry: 10, delta: 2 },
                     { DocEntry: 9, LineNum: 1, BinAbsEntry: 10, delta: -2 }], DEBF).lineas === 1);
// sin el set de la bodega todo queda afuera: no se adivina
chk('sin set de bodega nada cuenta como adentro',
    P.flujoPorLinea(FLF, null).fuera.n === 7 && P.flujoPorLinea(FLF, null).netoBodega === 0);
chk('flujoPorLinea de nada', P.flujoPorLinea(null, DEBF).lineas === 0);

console.log('\n— el neto de las ubicaciones sin socio —');
const DET = [{ AbsEntry: 1, filas: 10, pallets: 500, neto: -300 },
             { AbsEntry: 2, filas: 3, pallets: 9000, neto: 50 },
             { AbsEntry: 3, filas: 1, pallets: 20, neto: -7000 }, null];
const RS = P.resumenSinSocio(DET);
chk('cuenta las ubicaciones', RS.n === 3, String(RS.n));
chk('suma las filas', RS.filas === 14, String(RS.filas));
// el neto puede ser negativo y es el numero que importa: netearlo mal fue
// lo que escondio el problema de RETAIL
chk('el neto se suma con signo', RS.neto === -7250, String(RS.neto));
chk('los pallets van en valor absoluto, aparte del neto', RS.pallets === 9520, String(RS.pallets));
// se ordena por el NETO en valor absoluto, no por el movimiento bruto: la
// que mueve 9.000 y netea 50 no es la sospechosa
chk('ordena por el neto en valor absoluto, no por lo bruto',
    RS.mayores[0].AbsEntry === 3 && RS.mayores[1].AbsEntry === 1,
    RS.mayores.map(x => x.AbsEntry).join());
chk('y no toca el arreglo que le pasaron', DET[0].AbsEntry === 1 && DET.length === 4);
chk('resumenSinSocio de nada', P.resumenSinSocio(null).n === 0 && P.resumenSinSocio([]).neto === 0);

console.log('\n— la frescura de la cobertura es del ultimo mes —');
const COB = [{ mes: '2026-09', guardado: '2026-09-30T10:00:00Z' },
             { mes: '2026-10', guardado: '2026-10-25T19:00:00Z' },
             { mes: '2026-01', guardado: '2026-02-01T10:00:00Z' },
             { mes: '2026-08' }, null];
// los meses viejos no cambian: exigirle frescura a enero no sirve de nada
chk('toma el mes mayor, no el primero ni el mas viejo',
    P.frescuraCobertura(COB).mes === '2026-10', JSON.stringify(P.frescuraCobertura(COB)));
chk('y su hora de extraccion', P.frescuraCobertura(COB).guardado === '2026-10-25T19:00:00Z');
chk('un mes sin hora no sirve de ancla de frescura',
    P.frescuraCobertura([{ mes: '2026-11' }]) === null);
chk('frescuraCobertura de nada', P.frescuraCobertura(null) === null && P.frescuraCobertura([]) === null);

console.log('\n— el desfase entre las dos lecturas —');
// SAP acepta documentos post-fechados, asi que comparar fechas de documento
// no dice nada: lo que importa es cuando se leyo cada cosa
let de = P.desfaseLecturas('2026-10-25T20:00:00Z', '2026-10-25T18:00:00Z');
chk('dos horas de desfase se acepta', de.ok === true && de.horas === 2, JSON.stringify(de));
chk('y dice en que direccion', /ancla se leyo despues/.test(de.direccion), de.direccion);
de = P.desfaseLecturas('2026-10-25T18:00:00Z', '2026-10-25T20:00:00Z');
chk('la cobertura despues del ancla tambien es desfase, con la otra direccion',
    de.horas === -2 && /cobertura se extrajo despues/.test(de.direccion), JSON.stringify(de));
// la direccion cambia el signo del error pero no su tamaño: las dos importan
chk('y se acepta igual: el tope es sobre el valor absoluto', de.ok === true);
chk('mas de un dia no se acepta',
    P.desfaseLecturas('2026-10-25T20:00:00Z', '2026-10-24T04:00:00Z').ok === false);
chk('y tampoco al reves',
    P.desfaseLecturas('2026-10-24T04:00:00Z', '2026-10-25T20:00:00Z').ok === false);
chk('el tope se puede mover', P.desfaseLecturas('2026-10-25T20:00:00Z', '2026-10-24T04:00:00Z', 48).ok === true);
chk('misma hora es desfase cero',
    P.desfaseLecturas('2026-10-25T20:00:00Z', '2026-10-25T20:00:00Z').horas === 0);
chk('sin hora de una de las dos no se cuadra nada',
    P.desfaseLecturas('2026-10-25T20:00:00Z', null).ok === false &&
    /falta la hora/.test(P.desfaseLecturas(null, '2026-10-25T20:00:00Z').motivo));

console.log('\n— los documentos post-fechados —');
// dos post-fechados y EN DESORDEN a proposito: si vinieran ordenados, quitar
// el sort no rompería nada
const FE = ['2026-10-27', '2026-10-20', '2026-10-25', '2026-10-26', '2026-10-26', 'basura'];
let mp = P.movimientoDespuesDe(FE, '2026-10-25');
// no son un error: SAP los acepta y ya estan dentro del saldo vivo
chk('cuenta las filas posteriores al tope', mp.filas === 3, String(mp.filas));
chk('y lista las fechas una sola vez', mp.fechas.length === 2, JSON.stringify(mp.fechas));
chk('y ordenadas, no en el orden en que vinieron',
    mp.fechas.join() === '2026-10-26,2026-10-27', mp.fechas.join());
chk('y hasta donde llegan', mp.hasta === '2026-10-27');
// el dia del tope NO es posterior al tope
chk('el dia del tope no cuenta como posterior', !mp.fechas.includes('2026-10-25'));
chk('una fecha ilegible no cuenta', mp.filas === 3);
chk('sin post-fechados no hay nada que declarar',
    P.movimientoDespuesDe(FE, '2026-12-31').filas === 0 &&
    P.movimientoDespuesDe(FE, '2026-12-31').hasta === null);
chk('sin tope no se inventan posteriores', P.movimientoDespuesDe(FE, null).filas === 0);
chk('movimientoDespuesDe de nada', P.movimientoDespuesDe(null, '2026-01-01').filas === 0);

console.log('\n— la brecha se puede tolerar, pero no callar —');
// negarse siempre cambia un numero con incertidumbre conocida por ningun numero
chk('con --brecha=1 una brecha de un dia se acepta',
    P.anclaAplicable('2026-10-24', '2026-10-23', 1).ok === true);
chk('y queda MARCADA como tolerada, no como limpia',
    P.anclaAplicable('2026-10-24', '2026-10-23', 1).tolerada === true);
chk('y se dice entre que dias falta medir',
    /2026-10-23/.test(P.anclaAplicable('2026-10-24', '2026-10-23', 1).motivo) &&
    /2026-10-24/.test(P.anclaAplicable('2026-10-24', '2026-10-23', 1).motivo));
chk('una brecha mayor a la tolerada no pasa',
    P.anclaAplicable('2026-10-26', '2026-10-23', 1).ok === false);
chk('sin brecha no se marca tolerada', P.anclaAplicable('2026-10-23', '2026-10-23', 5).tolerada === false);
// un ancla anterior NO es una brecha: es un ancla equivocada, y tolerarla
// seria sumar hacia adelante creyendo que se resta
chk('un ancla anterior no se tolera ni con --brecha grande',
    P.anclaAplicable('2026-10-20', '2026-10-23', 99).ok === false);
chk('una brecha negativa en el parametro no abre la puerta',
    P.anclaAplicable('2026-10-24', '2026-10-23', -5).ok === false);
chk('una brecha que no es numero se lee como cero',
    P.anclaAplicable('2026-10-24', '2026-10-23', 'muchos').ok === false);

console.log('\n— el signo de los cambios —');
// el bug: mil() ya trae el '-', y agregarle '+' a mano daba '+-6.488'
chk('un negativo lleva UN solo signo', P.conSigno(-6488) === '-6.488', P.conSigno(-6488));
chk('un positivo lleva el mas', P.conSigno(1624) === '+1.624', P.conSigno(1624));
chk('el cero no lleva signo', P.conSigno(0) === '0', P.conSigno(0));

console.log('\n— el BOM de PowerShell —');
chk('un BOM al principio se saca', P.sinBom('\uFEFF{"a":1}') === '{"a":1}');
chk('y el json queda parseable', JSON.parse(P.sinBom('\uFEFF{"a":1}')).a === 1);
// un FEFF en el medio es un caracter del contenido, no un BOM
chk('un FEFF que no esta al principio no se toca',
    P.sinBom('{"a":"\uFEFF"}') === '{"a":"\uFEFF"}');
chk('un archivo sin BOM no se recorta', P.sinBom('{"a":1}') === '{"a":1}');
chk('sinBom de nada no revienta', P.sinBom(null) === '' && P.sinBom(undefined) === '');

console.log('\n— el nivel hacia atras, sin semilla —');
const DD2 = new Map([['2026-10-21', 100], ['2026-10-22', -30], ['2026-10-23', 5]]);
let h = P.nivelHaciaAtras(1000, DD2, ['2026-10-21', '2026-10-22', '2026-10-23']);
chk('resta lo que se movio despues del corte', h.nivel === 1000 - 75, String(h.nivel));
chk('informa el ancla y lo movido', h.ancla === 1000 && h.movido === 75);
chk('y cuantos dias restó', h.dias === 3);
// restar en vez de sumar es justo el error que invierte todo el resultado
chk('no suma: resta', P.nivelHaciaAtras(1000, DD2, ['2026-10-21']).nivel === 900);
chk('sin dias posteriores el nivel es el ancla', P.nivelHaciaAtras(1000, DD2, []).nivel === 1000);
chk('un dia sin movimiento no inventa nada',
    P.nivelHaciaAtras(1000, DD2, ['2026-10-19']).nivel === 1000);
chk('sin ancla no hay nivel',
    P.nivelHaciaAtras(null, DD2, []) === null && P.nivelHaciaAtras('x', DD2, []) === null);
// un ancla en cero es un ancla, no una ausencia
chk('un ancla en cero se usa', P.nivelHaciaAtras(0, DD2, ['2026-10-21']).nivel === -100);

console.log('\n— la cuadratura —');
let cu = P.cuadrar(579008, 545923);
chk('el residuo es lo que la bodega tiene y los socios no', cu.residuo === 33085, String(cu.residuo));
chk('y que fraccion esta atribuida', Math.abs(cu.cubierto - 545923 / 579008) < 1e-12);
chk('un residuo positivo no es imposible', cu.imposible === false);
// los socios no pueden tener mas que la bodega que los contiene
chk('residuo NEGATIVO es imposible', P.cuadrar(100, 150).imposible === true);
chk('residuo cero cuadra y es posible',
    P.cuadrar(100, 100).residuo === 0 && P.cuadrar(100, 100).imposible === false);
chk('bodega en cero no divide por cero',
    P.cuadrar(0, 0).porcentaje === null && P.cuadrar(0, 0).cubierto === null);
chk('cuadrar de nada', P.cuadrar(null, 5) === null && P.cuadrar(5, null) === null);

console.log('\n— lo que suma la semilla —');
chk('suma los saldos de la semilla',
    P.sumaSemilla({ porCod: new Map([['A', 100], ['B', 250]]) }) === 350);
chk('un cero suma cero y no rompe',
    P.sumaSemilla({ porCod: new Map([['A', 0]]) }) === 0);
chk('sumaSemilla de nada', P.sumaSemilla(null) === 0 && P.sumaSemilla({}) === 0);

// ── el movimiento del dia, bruto y no solo neto ───────────────────────────
console.log('\n— entradas y salidas del dia, no solo el neto —');
const DEBM = new Set([1, 2]);
const FM = [{ BinAbsEntry: 1, DocDate: '2026-10-24', delta: -30 },
            { BinAbsEntry: 1, DocDate: '2026-10-23', delta: 100 },
            { BinAbsEntry: 2, DocDate: '2026-10-23', delta: -100 },
            { BinAbsEntry: 9, DocDate: '2026-10-23', delta: 5000 },
            { BinAbsEntry: 1, DocDate: 'basura', delta: 7 }, null];
const MD = P.movimientoPorDia(FM, DEBM);
// un dia puede netear CERO y haber movido medio pool: por eso el bruto
chk('un dia de neto cero igual reporta su movimiento',
    MD[0].dia === '2026-10-23' && MD[0].neto === 0 &&
    MD[0].entradas === 100 && MD[0].salidas === 100, JSON.stringify(MD[0]));
chk('las salidas van en positivo, no en negativo', MD[0].salidas === 100);
chk('ordena por dia', MD.map(x => x.dia).join() === '2026-10-23,2026-10-24', MD.map(x => x.dia).join());
chk('la ubicacion de otra bodega no entra', MD[0].entradas !== 5100);
chk('una fecha ilegible no entra', MD[0].filas === 2);
chk('sin set de bodega no cuenta nada', P.movimientoPorDia(FM, null).length === 0);

// ── el cierre del dia ─────────────────────────────────────────────────────
console.log('\n— cierre de un dia = apertura del siguiente —');
const CD = P.cierreDelDia(MD, 1030);
// se camina hacia atras desde el nivel que SAP confirma, no hacia adelante
chk('el ultimo cierre es el nivel que dicta SAP', CD[CD.length - 1].cierre === 1030);
chk('y el anterior se despeja restando su neto', CD[0].cierre === 1060, String(CD[0].cierre));
// LA LEY que pidio operaciones, y es por construccion
chk('el cierre de un dia ES la apertura del siguiente',
    CD[0].cierre === CD[1].apertura, CD[0].cierre + ' vs ' + CD[1].apertura);
chk('la apertura del primero es su cierre menos su neto',
    CD[0].apertura === CD[0].cierre - CD[0].neto);
chk('arrastra entradas y salidas de cada dia', CD[0].entradas === 100 && CD[0].salidas === 100);
chk('un nivel final que no es numero no arma serie', P.cierreDelDia(MD, 'x').length === 0);
// si le llega desordenada, caminar hacia atras sin ordenar da cierres al azar
const DES = P.cierreDelDia([{ dia: '2026-10-24', entradas: 0, salidas: 30, neto: -30 },
                            { dia: '2026-10-23', entradas: 100, salidas: 40, neto: 60 }], 1030);
chk('ordena la serie antes de caminarla hacia atras',
    DES[0].dia === '2026-10-23' && DES[0].cierre === 1060 && DES[1].cierre === 1030,
    JSON.stringify(DES.map(x => x.dia + ':' + x.cierre)));
chk('cierreDelDia de nada', P.cierreDelDia(null, 10).length === 0);

// ── el posteo retroactivo ─────────────────────────────────────────────────
console.log('\n— dos mediciones del mismo dia: lo que SAP en vivo no ve —');
// el cambio CHICO va primero a proposito: si el detalle no se ordenara por
// tamaño, el que hay que mirar quedaria sepultado abajo
const AYER = [{ dia: '2026-10-21', cierre: 300 }, { dia: '2026-10-22', cierre: 500 },
              { dia: '2026-10-23', cierre: 1060 }];
const HOY  = [{ dia: '2026-10-21', cierre: 308 }, { dia: '2026-10-22', cierre: 500 },
              { dia: '2026-10-23', cierre: 1115 }, { dia: '2026-10-24', cierre: 1085 }];
const PR = P.posteoRetroactivo(AYER, HOY);
chk('detecta los dias que cambiaron despues de cerrados', PR.dias === 2, JSON.stringify(PR.detalle));
chk('y pone el cambio mas grande primero',
    PR.detalle[0].dia === '2026-10-23' && PR.detalle[0].cambio === 55, JSON.stringify(PR.detalle));
chk('y suma el total movido hacia atras', PR.total === 63, String(PR.total));
chk('el dia que no cambio no se reporta', !PR.detalle.some(x => x.dia === '2026-10-22'));
// un dia que ayer no existia no es un posteo retroactivo: es un dia nuevo
chk('un dia nuevo no cuenta como retroactivo', !PR.detalle.some(x => x.dia === '2026-10-24'));
chk('dice cuantos dias se pudieron comparar', PR.comparados === 3, String(PR.comparados));
chk('sin cambios no hay retroactivo', P.posteoRetroactivo(AYER, AYER).dias === 0);
chk('posteoRetroactivo de nada', P.posteoRetroactivo(null, null).dias === 0);

// ── la salida para el tablero ─────────────────────────────────────────────
console.log('\n— la salida completa —');
const SJ = P.salidaJson({
  bodega: 'RETAIL', generado: '2026-10-25T09:00:00Z',
  cuadratura: { bodega: 579026, socios: 544963, residuo: 34063, cubierto: 0.941 },
  // 30 socios: con 25 o menos, recortar la cola no se notaria
  niveles: [{ cod: 'R1', s0: 10, nivel: 30, cambio: 20, min: 5, minDia: '2026-03-01', enSemilla: true },
            { cod: 'R2', s0: 0, nivel: 7, cambio: 7, min: 0, minDia: null, enSemilla: false }].concat(
            Array.from({ length: 28 }, (_, i) => ({ cod: 'R' + (i + 3), s0: 1, nivel: 1,
              cambio: 0, min: 1, minDia: null, enSemilla: true }))),
  nombre: c => c === 'R1' ? 'UNO SA' : null,
  mensual: [{ mes: '2026-01', neto: 5 }], dias: CD,
});
// el tablero tiene que traer TODOS los socios: recortar la cola obliga a
// volver a correr el script apenas alguien pregunta por uno chico
chk('van todos los socios, no un top', SJ.socios.length === 30, String(SJ.socios.length));
chk('con su nombre resuelto', SJ.socios[0].nom === 'UNO SA');
chk('y si no hay nombre, no se inventa', SJ.socios[1].nom === null);
chk('marca quien no tenia semilla', SJ.socios[1].enSemilla === false);
chk('lleva el nivel y el residuo', SJ.nivel.bodega === 579026 && SJ.nivel.residuo === 34063);
chk('y que fraccion esta atribuida', SJ.nivel.atribuido === 0.941);
chk('lleva la serie de dias con cierre y apertura',
    SJ.dias.length === 2 && SJ.dias[0].cierre === 1060 && SJ.dias[0].apertura === 1060,
    JSON.stringify(SJ.dias[0]));
// sin cuadratura los campos quedan en null, no en cero: cero diria "medido"
chk('sin cuadratura el nivel queda en null, no en cero',
    P.salidaJson({}).nivel.bodega === null, JSON.stringify(P.salidaJson({}).nivel));
chk('explica como leer el cierre y la apertura',
    /cierre de un dia = apertura del siguiente/.test(SJ._como_leerlo));
chk('y que una consulta en vivo no ve el retroactivo',
    /en vivo/.test(SJ._como_leerlo) && /no lo puede ver/.test(SJ._como_leerlo));
chk('salidaJson de nada no revienta', P.salidaJson(null).socios.length === 0);

console.log('\n— opciones —');
chk('--bodega y --semilla son opciones con valor',
    P.OPCIONES.indexOf('bodega') >= 0 && P.OPCIONES.indexOf('semilla') >= 0);
chk('--corte permite pedir el nivel a una fecha', P.OPCIONES.indexOf('corte') >= 0);
chk('--bodegas trae el ancla de SAP', P.OPCIONES.indexOf('bodegas') >= 0);
chk('--brecha permite tolerar y declarar', P.OPCIONES.indexOf('brecha') >= 0);
chk('--desfase mueve el tope entre lecturas', P.OPCIONES.indexOf('desfase') >= 0);
chk('--diario abre un mes dia a dia', P.OPCIONES.indexOf('diario') >= 0);
chk('--json emite la salida del tablero', P.OPCIONES.indexOf('json') >= 0);

console.log('\n— las ubicaciones de la bodega que ademas tienen socio —');
const BINSBOD = new Set([10, 11, 12, 13]);
const MAPABOD = new Map([[10, 'R1'], [12, 'R3'], [99, 'R9']]);
const CSBOD = P.binsConSocio(BINSBOD, MAPABOD);
chk('se queda con las que tienen socio', [...CSBOD].sort().join() === '10,12', [...CSBOD].join());
// una ubicacion con socio que NO es de esta bodega no entra: el maestro trae todas
chk('no entra una de otra bodega', !CSBOD.has(99));
// sin mapa no se adivina: ninguna tiene socio conocido
chk('sin mapa no hay socios', P.binsConSocio(BINSBOD, null).size === 0);
chk('sin bodega tampoco', P.binsConSocio(null, MAPABOD).size === 0);
// un socio vacio o nulo no cuenta como socio conocido
chk('un socio vacio no cuenta', P.binsConSocio(new Set([1]), new Map([[1, '']])).size === 0);
chk('un socio nulo tampoco', P.binsConSocio(new Set([1]), new Map([[1, null]])).size === 0);

console.log('\n— las dos sumas se separan de verdad —');
const FILASBOD = [
  { BinAbsEntry: 10, DocDate: '2026-02-03', delta:  100 },
  { BinAbsEntry: 12, DocDate: '2026-02-10', delta:   50 },
  { BinAbsEntry: 11, DocDate: '2026-02-14', delta: -400 },
  { BinAbsEntry: 77, DocDate: '2026-02-20', delta:  999 },
];
const todas   = P.netoPorMes(P.deltaDeBodega(FILASBOD, BINSBOD).porDia);
const soloSoc = P.netoPorMes(P.deltaDeBodega(FILASBOD, P.binsConSocio(BINSBOD, MAPABOD)).porDia);
chk('todas las de la bodega suman -250', todas[0].neto === -250, JSON.stringify(todas));
chk('las que tienen socio suman +150', soloSoc[0].neto === 150, JSON.stringify(soloSoc));
// la resta es justamente el movimiento que no se puede atribuir
chk('la diferencia es el movimiento sin socio', todas[0].neto - soloSoc[0].neto === -400);
chk('ninguna de las dos toca la bodega ajena', !JSON.stringify(todas).includes('999'));

console.log('\n— la tabla mensual pareada —');
const FMES = P.filasMensuales(
  [{mes:'2026-01',neto:2573},{mes:'2026-02',neto:7626},{mes:'2026-05',neto:1964}],
  [{mes:'2026-01',neto:2573},{mes:'2026-02',neto:10968}]);
chk('respeta el orden de la columna de todas', FMES.map(x=>x.mes).join()==='2026-01,2026-02,2026-05');
chk('parea cada mes con el suyo', FMES[1].todas===7626 && FMES[1].conSocio===10968, JSON.stringify(FMES[1]));
// LA COLUMNA NO PUEDE COPIAR A LA OTRA: ese fue el defecto que se escapo
chk('las dos columnas son distintas', FMES[1].todas !== FMES[1].conSocio);
chk('la tercera es la resta', FMES[1].sinSocio === 7626 - 10968, String(FMES[1].sinSocio));
// un mes sin contraparte vale cero, no el del mes vecino
chk('un mes sin contraparte es cero', FMES[2].conSocio === 0 && FMES[2].sinSocio === 1964);
chk('cuando coinciden la resta es cero', FMES[0].sinSocio === 0);
chk('sin series no revienta', P.filasMensuales(null,null).length === 0);

console.log('\n'+ok+' ok, '+fail+' fallas\n');
process.exit(fail?1:0);
