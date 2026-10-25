// ============================================================================
//  scripts/validar-arriendo-bin.js  ·  M3DATA · ¿el saldo de SAP reproduce la
//  cantidad que factura la cartola?
//
//  LA PRUEBA QUE CIERRA EL CONCEPTO. backfill-sap-bin.js ya trajo desde SAP el
//  movimiento por ubicacion, y binmaestro el mapa ubicacion -> cliente (538 de
//  539). Falta lo unico que importa: que con eso se reproduzca la cantidad de
//  SERV-DIAS-PALLET, que es el 27,7% de lo que REDTEC factura.
//
//  LA CUENTA, y por que el ancla no es trampa.
//      saldo(d) = S0 + r(d)      r(d) = suma de los deltas hasta el dia d
//      PD(p)    = S0*n_p + R_p   R_p  = suma de r(d) sobre los dias de p
//  S0 es el saldo al empezar la ventana y NO esta en los movimientos: se
//  despeja de UN periodo y con eso se PREDICEN los demas. El ancla sale de la
//  propia orden de venta de REDTEC, no de WAVE, para que la validacion no
//  dependa del dato que se esta reemplazando.
//
//  Y HAY UNA PRUEBA QUE NO NECESITA ANCLA: entre dos periodos del MISMO largo,
//  S0 se cancela y la variacion de pallet-dias tiene que ser exactamente la
//  variacion de R. Esa es la mas limpia de las dos y se informa aparte.
//
//  EL DIAGNOSTICO MAS FUERTE no es el porcentaje: es la DISPERSION de S0. Si
//  el modelo es correcto, el S0 despejado de cada periodo por separado tiene
//  que dar el MISMO numero. Si varia, el modelo esta mal y ningun porcentaje
//  lo arregla.
//
//  Y CUANDO NO CALZA, HAY QUE SABER POR QUE. La dispersion dice "mal" pero no
//  dice quien. El CONSENSO si: busca el grupo mas grande de periodos que
//  concuerdan y nombra a los que sobran. Con eso el que no calza se parte en
//      ancla aislada  el unico que discrepa es el primero, que es justo el
//                     que la prueba estricta usa de ancla. El modelo esta
//                     bien; lo raro es la OV de esa semana (QUINTA, CAMBIASO).
//      quiebre        los que discrepan son un tramo seguido: hubo un cambio
//                     de saldo real que los movimientos extraidos no vieron.
//                     Ahi falta dato.
//      disperso       hay grupos pero no forman tramos. Ese si es el modelo
//                     o la atribucion.
//      sin consenso   ningun par de periodos concuerda. No hay sobre que
//                     medir, y decir cualquier otra cosa es inventar.
//  Los dos primeros NO se arreglan tocando la formula, y los dos ultimos no se
//  arreglan mirando la cartola. Por eso se informan separados.
//
//  'sin consenso' se agrego despues de la corrida del 24-10, que mostro el
//  error: sin esa pregunta, un cliente con los cuatro S0 distintos entre si
//  caia en 'quiebre' con un S0 de consenso que era el del ancla, elegido por
//  desempate. Diez de los dieciocho quiebres de esa corrida eran eso. Un grupo
//  de uno no es un acuerdo.
//
//  --tol cambia la holgura del consenso y NO mueve el veredicto: la prueba
//  estricta no lo usa. QUINTA con el 1% no tiene consenso; con --tol=0.15
//  resulta ser un ancla aislada, porque sus tres semanas de atras concuerdan
//  en un S0 de ~5.300 y la del ancla dice 411.
//
//  EL FILTRO DE ANULADAS, y por que va primero. Hasta el 24-10 nadie sacaba
//  las OV anuladas: eran 198 de 1.136. Ninguna ensuciaba el resultado —las
//  de las dos semanas de reemision quedaban fuera por duplicadas y las 58
//  del corte de cierre por contenidas— pero descartar la celda ENTERA por
//  duplicada cuando una de las dos OV esta anulada es perder una celda
//  buena. Eran 117 de ~340. Filtrando primero, la celda queda con una sola
//  OV y vuelve a la comparacion.
//
//  LO QUE SE APRENDIO CON CUATRO MESES (24-10, ventana 2026-07-01..10-23, 220
//  celdas): 41,4% exactas y 52,7% dentro del 1%, practicamente lo mismo que
//  con dos meses. Con --tol=0.15 quedan 41 clientes estables de 57.
//
//  Y aparecio el patron que importa: los que no calzan casi no discuten la
//  CANTIDAD, discuten los DIAS. Despejando n de PD = S0*n + R con el S0 del
//  consenso, CAMBIASO 2026-09-28 cobro 1,01 dias de 7; KUNSTMANN 2026-09-28,
//  1,10; QUINTA 2026-09-07, 0,78 mientras sus otras semanas dan 6,1 a 6,9.
//  Por eso el informe trae la columna "dias cobro": separa la semana mal
//  calculada de la semana emitida con un dia, que no se arreglan igual.
//
//  OJO AL SESGO DE BORDE: con --tol=0.15, de los 16 clientes que no son
//  estables, en 10 el periodo que discrepa es el PRIMERO o el ULTIMO de la
//  ventana. Puede ser real o puede ser de como se arma el universo de
//  periodos. No sacar conclusiones de un periodo de borde sin mirar el de al
//  lado con la ventana corrida.
//
//  DONDE QUEDO ARRIENDO (24-10, ventana 2026-01-01..10-23, 41 periodos, los
//  diez meses de binmov completos y sin huecos).
//      con el ancla despejada de la cartola : 36,9% exactas · 48,7% al 1%
//      con S0 medido aparte (semilla)       : 44,8% exactas · 55,6% al 1%
//      la vara, medida contra WAVE el 23-10 : 42,9% exactas · 56,9% al 1%
//  Sobre 2.223 celdas contra las 807 con que se puso la vara: las exactas
//  quedan ARRIBA y la banda del 1% queda 1,3 puntos abajo. Se sostiene con
//  2,75 veces mas universo, que era la prueba que faltaba.
//
//  DONDE QUEDO ARRIENDO (24-10, ventana 2026-06-01..10-23, 20 periodos).
//      con el ancla despejada de la cartola : 35,5% exactas · 48,9% al 1%
//      con S0 medido aparte (semilla)       : 43,7% exactas · 56,5% al 1%
//      la vara, medida contra WAVE el 23-10 : 42,9% exactas · 56,9% al 1%
//  Mismo dato, mismos deltas, mismo modelo: lo unico que cambia es de donde
//  sale S0. Con S0 medido, la cadena propia pasa la vara sobre 1.111 celdas
//  contra las 807 con que se puso. El 35,5% era el ancla, no la extraccion.
//
//  Lo que falta para no pedir nada prestado es el NIVEL DE PARTIDA, y hay
//  dos caminos: binmov hasta donde el stock era cero (~40 meses, medido a
//  450 doc/min son unas 30 horas de lectura), o el acceso _RO a HANA para
//  leer HX_BINPALLETS directo. SAP por Service Layer NO lo da: ver
//  backfill/sonda-sap-saldo.js, que ya lo descarto por los cuatro lados.
//
//  EL CRUCE CONTRA WAVE QUE CIERRA EL CONCEPTO (24-10). El S0 que esta
//  sonda despeja de la OV, sin mirar Datawalt, contra el nivel que WAVE
//  calcula acumulando su propia serie desde 2023-07-16, al 2026-07-05:
//
//      ACONCAGUA FOODS            968  ·  968      exacto
//      PRODUCTOS NUTRITIVOS       948  ·  948      exacto
//      SOC. PUNTA DE LOBOS        271  ·  271      exacto
//      COMERCIAL ROCKY            213  ·  213      exacto
//      AGRICOLA LOS COLONOS       153  ·  153      exacto
//      BALEARES                   105  ·  105      exacto
//      LA FUENTE NATURAL           79  ·   79      exacto
//      ORIZON                      78  ·   78      exacto
//      SOC. COM. LOS ALERCES       21  ·   21      exacto
//      COMERCIAL FG CORP          491  ·  490      0,2%
//      PAIMASA                  3.679  ·  3.686    0,2%
//      LATIN AMERICAN FOODS     2.310  ·  2.297    0,6%
//      MOLINO PUENTE ALTO       3.777  ·  3.808    0,8%
//      PRODUCTOS FERNANDEZ     28.124  ·  27.271   3,1%
//      LAB. BALLERINA          14.150  ·  14.808   4,4%
//
//  NUEVE CLIENTES EXACTOS AL PALLET por dos caminos independientes. La
//  cadena propia —Service Layer, BinAllocations, BinLocations.Description,
//  BPAddresses— da el mismo numero que la vista de Datawalt sobre HANA. No
//  hace falta ni m2link ni Datawalt para calcular ARRIENDO.
//
//  Y DE AHI SALE EL ARREGLO DEL ANCLA. WAVE no necesita ancla porque tiene
//  la serie de deltas desde 2023-07-16: su S0 es la suma acumulada y no hay
//  nada que despejar. Nosotros arrancamos en 2026-07, asi que tenemos que
//  despejarlo de UNA semana, y si esa semana esta mala arrastra todas las
//  demas. BALLERINA es el caso: catorce semanas concuerdan en 14.150 —y
//  WAVE dice 14.808— mientras la semana del ancla implica ~20.674, o sea
//  unos 41.000 pallet-dia cobrados de mas en esa sola semana.
//
//  Y SE PROBO SI SAP DA EL SALDO DIRECTO, que seria el atajo: no lo da. El
//  Service Layer solo publica MinimumQty y MaximumQty de BinLocations, que
//  son limites de CAPACIDAD y vienen en cero; view.svc y sml.svc dan 404; y
//  lo que el $metadata llama Balance es todo contabilidad. Queda registrado
//  en backfill/sonda-sap-saldo.js para no volver a preguntarlo.
//
//  Extendiendo binmov hacia atras hasta donde arranca la serie, S0 deja de
//  ser una incognita y la prueba estricta se vuelve exacta por construccion.
//  Medido: ~19.000 documentos por mes a 450 doc/min son unos 43 minutos por
//  mes, y son unos 40 meses.
//
//  LA VARA ESTA PUESTA DE ANTES, medida contra WAVE el 23-10: 346 de 807
//  celdas exactas al pallet-dia (42,9%), 459 dentro del 1% (56,9%) y trece
//  clientes con sus quince semanas exactas. Esto tiene que parecerse a eso.
//  Con dos meses de binmov el universo es mas chico y el informe lo dice.
//
//  Credenciales SOLO por variable de entorno.  OS_STORAGE_CONN · OS_SAP_CONTAINER
//
//  Uso (PowerShell):
//    node scripts/validar-arriendo-bin.js --mes=2026-09
//    node scripts/validar-arriendo-bin.js --mes=2026-09 --cliente=FERNANDEZ
//    node scripts/validar-arriendo-bin.js --mes=2026-09 --cliente=QUINTA
//    node scripts/validar-arriendo-bin.js --meses=2026-01,...,2026-10 \
//         --universo=2026-01,2026-10 --semilla=backfill/s0-semilla-2025-12-31.json
//        --semilla trae S0 MEDIDO y no despejado, asi que se predicen TODAS
//        las celdas y lo que no calza ya no puede ser culpa del ancla. La
//        semilla tiene que ser del dia ANTERIOR al inicio de la ventana o no
//        se usa: un dia de hueco es un dia de movimientos que nadie sumo.
//    node scripts/validar-arriendo-bin.js --meses=2026-07,2026-08,2026-09,2026-10 \
//         --universo=2026-07,2026-10 --tol=0.15
//        --meses dice que BLOBS cargar; --universo, que PERIODOS comparar.
//        No son lo mismo y confundirlos tenia el resultado clavado en 220
//        celdas con cuatro meses de datos cargados: el universo seguia
//        siendo septiembre, o sea 5 semanas de 17.
// ============================================================================
'use strict';

const M = require('./medir-emisiones.js');
const A = require('./sonda-arriendo.js');
const SS = require('./sonda-saldo.js');

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args = process.argv.slice(2);
const OPCIONES = ['mes', 'meses', 'patron', 'tope', 'cliente', 'bodega', 'tol', 'universo', 'semilla'];
const BANDERAS = ['mantener-corte', 'mantener-duplicadas'];
const opcion = (n, d) => M.leerOpcion(args, n, d);
const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);
// --tol NO mueve el veredicto: la prueba estricta no lo usa. Sirve para mirar
// la estructura con otra holgura. QUINTA con el 1% no tiene consenso y con el
// 15% resulta ser un ancla aislada: sus tres semanas de atras concuerdan en un
// S0 de ~5.300 y la del ancla dice 411.
const TOL = (() => { const v = parseFloat(opcion('tol', '')); return isFinite(v) && v > 0 ? v : undefined; })();

const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const DIA = 86400000;
const TOL_CONSENSO = 0.01;        // la misma vara del 1% con que se mide la estabilidad

// ── lo puro ─────────────────────────────────────────────────────────────────

/** El mapa ubicacion -> cliente, tal como lo dejo backfill-sap-bin --maestro.
 *  Deja fuera la ubicacion de sistema y las que quedaron sin atribuir: una
 *  ubicacion sin cliente no se reparte, se cuenta. */
function mapaDeMaestro(json) {
  const m = new Map();
  for (const u of ((json && json.ubicaciones) || [])) {
    if (!u || u.AbsEntry == null || !u.CardCode) continue;
    if (u.IsSystemBin === 'tYES' || u.IsSystemBin === true) continue;
    m.set(u.AbsEntry, u.CardCode);
  }
  return m;
}

/** El movimiento diario de cada cliente. Lo que no esta en el mapa se cuenta
 *  aparte y no se descarta en silencio: esas son las ubicaciones de RETAIL y
 *  de los clientes que no facturan arriendo, y hay que poder verlas. */
function deltaDiarioPorCliente(filas, mapa) {
  const porCliente = new Map();
  const binsSinMapa = new Set();
  let filasSinMapa = 0, palletsSinMapa = 0, sinFecha = 0;
  for (const f of (filas || [])) {
    const cod = mapa && mapa.get ? mapa.get(f.BinAbsEntry) : null;
    if (!cod) { filasSinMapa++; palletsSinMapa += Math.abs(Number(f.delta) || 0); binsSinMapa.add(f.BinAbsEntry); continue; }
    const d = String(f.DocDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { sinFecha++; continue; }
    let s = porCliente.get(cod);
    if (!s) { s = new Map(); porCliente.set(cod, s); }
    s.set(d, (s.get(d) || 0) + (Number(f.delta) || 0));
  }
  return { porCliente, filasSinMapa, palletsSinMapa, binsSinMapa, sinFecha };
}

/** Todos los dias de la ventana, de corrido. Sin esto el acumulado se saltea
 *  los dias sin movimiento, que son la mayoria, y el saldo de esos dias —que
 *  igual se cobran— desaparece. */
function diasDeVentana(desde, hasta) {
  const a = Date.parse(desde + 'T00:00:00Z'), b = Date.parse(hasta + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b; t += DIA) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** r(d): el acumulado RELATIVO al inicio de la ventana. Relativo porque el
 *  saldo de partida no esta en los movimientos; se despeja despues. */
function serieRelativa(deltaDiario, dias) {
  const out = new Map();
  let acc = 0;
  for (const d of (dias || [])) { acc += (deltaDiario && deltaDiario.get(d)) || 0; out.set(d, acc); }
  return out;
}

/** R_p y n_p de un periodo. 'completo' dice si TODOS sus dias estan en la
 *  ventana: un periodo a medias daria un R chico y un S0 inventado. */
function acumuladoDePeriodo(serieR, diasDelPeriodo) {
  let R = 0, faltan = 0;
  for (const d of (diasDelPeriodo || [])) {
    if (!serieR || !serieR.has(d)) { faltan++; continue; }
    R += serieR.get(d);
  }
  const n = (diasDelPeriodo || []).length;
  return { R, n, faltan, completo: n > 0 && faltan === 0 };
}

/** S0 despejado de UN periodo:  PD = S0*n + R  ->  S0 = (PD - R)/n */
function s0Implicito(pdObservado, R, n) {
  if (!n) return null;
  return (Number(pdObservado) - R) / n;
}

/** Que tan de acuerdo estan los periodos sobre cual es el S0 del cliente. ES
 *  EL DIAGNOSTICO: si el modelo es correcto todos tienen que dar lo mismo. */
function dispersionS0(valores) {
  const v = (valores || []).filter(x => x != null && isFinite(x));
  if (!v.length) return { n: 0, promedio: null, rango: null, dispersion: null };
  const min = Math.min.apply(null, v), max = Math.max.apply(null, v);
  const prom = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, promedio: prom, min, max, rango: max - min,
           dispersion: Math.abs(prom) > 1e-9 ? (max - min) / Math.abs(prom) : null };
}

/** El pallet-dia que predice el modelo con un S0 dado. */
function predecir(s0, R, n) { return s0 * n + R; }

/** El veredicto. La vara se declara ANTES: tiene que parecerse a lo que dio
 *  contra WAVE —42,9% exactas y 56,9% dentro del 1%— porque es el mismo dato
 *  por otro camino. Muy por debajo significa que el camino propio perdio algo. */
function veredicto(r) {
  const t = (r && r.total) || 0;
  if (!t) return { nivel: 'sin datos', texto: 'No quedo ninguna celda para comparar.' };
  const pe = 100 * (r.exactas || 0) / t, p1 = 100 * (r.p1 || 0) / t;
  if (pe >= 35 && p1 >= 50) return { nivel: 'si', pe, p1,
    texto: 'REPRODUCE LA CARTOLA desde SAP, en linea con lo medido contra WAVE (42,9% exactas, ' +
           '56,9% dentro del 1%). ARRIENDO se puede calcular con fuente propia.' };
  if (p1 >= 25) return { nivel: 'parcial', pe, p1,
    texto: 'Reproduce una parte y queda lejos de lo medido contra WAVE. Algo se pierde en el ' +
           'camino propio: mirar la dispersion de S0 y las ubicaciones sin mapa ANTES de ajustar nada.' };
  return { nivel: 'no', pe, p1,
    texto: 'No reproduce. Con la dispersion de S0 alta el modelo esta mal; con S0 estable y ' +
           'celdas que no calzan, lo que falta son movimientos.' };
}

/** Dos S0 que dicen lo mismo. Relativo al mayor de los dos, porque un cliente
 *  con 26.676 pallets y otro con 850 no se pueden medir con la misma holgura
 *  absoluta. Los dos en cero concuerdan. */
function cercanos(a, b, tol) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return false;
  const may = Math.max(Math.abs(a), Math.abs(b));
  if (!may) return true;
  return Math.abs(a - b) / may <= tol;
}

function mediana(valores) {
  const s = (valores || []).filter(x => x != null && isFinite(x)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** EL GRUPO MAS GRANDE DE PERIODOS QUE ESTA DE ACUERDO SOBRE S0. Es la
 *  pregunta que el promedio no contesta: con cuatro periodos, tres que dicen
 *  26.676 y uno que dice 850, el promedio no es ninguno de los dos y la
 *  dispersion solo alcanza a decir "mal". El consenso dice CUALES estan de
 *  acuerdo y cual sobra, que es lo que decide si el modelo fallo o si fallo
 *  una sola orden de venta.
 *
 *  El empate se parte por el periodo mas temprano, para que la respuesta no
 *  dependa del orden en que se recorre. El valor del grupo es la MEDIANA y no
 *  el promedio: un solo periodo raro que entre por el borde de la tolerancia
 *  no tiene que correr el consenso entero. */
function consensoS0(valores, tol) {
  const t = (tol === undefined || tol === null) ? TOL_CONSENSO : tol;
  const v = (valores || []).map(x => (x == null || !isFinite(x)) ? null : Number(x));
  const vivos = [];
  for (let i = 0; i < v.length; i++) if (v[i] !== null) vivos.push(i);
  if (!vivos.length) return { valor: null, dentro: [], fuera: [], n: 0, cobertura: null };
  let mejor = null;
  for (const i of vivos) {
    const dentro = vivos.filter(j => cercanos(v[i], v[j], t));
    if (!mejor || dentro.length > mejor.length) mejor = dentro;
  }
  const enGrupo = new Set(mejor);
  const fuera = vivos.filter(i => !enGrupo.has(i));
  return { valor: mediana(mejor.map(i => v[i])), dentro: mejor, fuera,
           n: vivos.length, cobertura: mejor.length / vivos.length };
}

/** Indices consecutivos: un tramo del tiempo y no periodos sueltos. */
function esTramo(indices) {
  const s = (indices || []).slice().sort((a, b) => a - b);
  if (!s.length) return false;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1] + 1) return false;
  return true;
}

/** EN QUE SE PARTE UN CLIENTE QUE NO CALZA. No son el mismo problema:
 *
 *    estable        todos los periodos dicen el mismo S0. Calza.
 *    ancla aislada  el unico que discrepa es el PRIMERO, que es justo el que
 *                   la prueba estricta usa de ancla. El modelo esta bien y lo
 *                   que esta raro es la orden de venta de esa semana.
 *    quiebre        los que discrepan son un tramo seguido: hubo un cambio de
 *                   saldo real que los movimientos extraidos no vieron.
 *                   Ahi falta dato, no modelo.
 *    disperso       no hay patron. Ese si es el modelo o la atribucion.
 *
 *  La distincion importa porque los tres primeros casos NO se arreglan
 *  tocando la formula, y el cuarto no se arregla mirando la cartola. */
function clasificarCliente(celdas, tol) {
  const cs = (celdas || []).filter(Boolean);
  const k = consensoS0(cs.map(c => c.s0), tol);
  const per = i => (cs[i] ? cs[i].periodo : null);
  if (k.n < 2) return { clase: 'sin datos', consenso: k, periodos: [] };
  if (!k.fuera.length) return { clase: 'estable', consenso: k, periodos: [] };
  // UN GRUPO DE UNO NO ES UN CONSENSO. La primera version no preguntaba esto y
  // la corrida del 24-10 la dejo en evidencia: con los cuatro S0 distintos
  // entre si el grupo mas grande es de uno solo, el desempate se queda con el
  // primero por ser el primero, y el resultado se informaba como "quiebre" con
  // un S0 de consenso que era el del ancla. Diez de los dieciocho quiebres eran
  // esto. Aca no hay nada sobre que medir y hay que decirlo.
  if (k.dentro.length < 2) return { clase: 'sin consenso', consenso: k, periodos: k.fuera.map(per) };
  if (k.fuera.length === 1 && k.fuera[0] === 0)
    return { clase: 'ancla aislada', consenso: k, periodos: [per(0)] };
  if (esTramo(k.fuera) && esTramo(k.dentro))
    return { clase: 'quiebre', consenso: k, periodos: k.fuera.map(per),
             corte: per(Math.min.apply(null, k.fuera)) };
  return { clase: 'disperso', consenso: k, periodos: k.fuera.map(per) };
}

/** Que pasaria con OTRO ancla. NO reemplaza la prueba estricta: esa despeja
 *  S0 de un solo periodo y predice los demas, y es la que vale justamente
 *  porque no mira el resultado antes de elegir. Esto mide algo distinto y mas
 *  chico: cuanto de lo que no calza se explica porque el ancla era el raro. */
function repredecir(celdas, s0) {
  const out = [];
  for (const c of (celdas || [])) {
    if (!c) continue;
    const pred = predecir(s0, c.R, c.n);
    const dif = pred - c.pd;
    out.push({ periodo: c.periodo, pd: c.pd, pred, dif,
               rel: c.pd ? Math.abs(dif) / Math.abs(c.pd) : (dif ? 1 : 0) });
  }
  return out;
}

/** SI EL NUMERO DE DIAS SE PUEDE LEER COMO DIAS.
 *
 *  diasCobrados despeja n de PD = S0*n + R. Mientras el modelo se cumple, da
 *  los dias del periodo y se lee solo. Cuando el modelo NO se cumple para esa
 *  celda, el mismo despeje da cualquier cosa: en la corrida de diez meses
 *  salieron -0,96 y 59,14 "dias de 7".
 *
 *  Eso NO es un error de la cuenta: es la cuenta avisando que la celda no
 *  entra en el modelo. Pero imprimirlo como "cobro 59 dias" invita a creer
 *  que la OV multiplico por 59, y eso es una conclusion que el dato no
 *  sostiene — sobre todo en una tabla que va a Finanzas.
 *
 *  El numero se sigue mostrando, porque esconderlo seria peor, pero marcado:
 *  fuera de 0 y el doble del periodo, lo que dice es "esta celda no se
 *  explica con este saldo", no cuantos dias se cobraron. El doble y no menos
 *  porque los 9,96 de 7 de CLEANER eran un sobrecobro REAL y tienen que
 *  seguir leyendose como dias. */
function diasPlausibles(dias, n) {
  if (dias == null || !isFinite(dias)) return false;
  // El 'n <= 0' que habia aca era redundante y se saco: el !n ya caza el cero,
  // y con n negativo el rango [0, 2n] queda vacio, asi que nada lo satisface.
  if (!n || !isFinite(n)) return false;
  return dias >= 0 && dias <= 2 * n;
}

/** LAS UBICACIONES DE CLIENTES SIN DUENO, CON NOMBRE Y APELLIDO.
 *
 *  Contarlas no alcanza. Son dos, mueven 16.881 pallets, y la pregunta que
 *  importa es de QUIEN son: si caen en uno de los grupos en conflicto
 *  —PUNTOAZUL junta a LO PINTO, PAN DE AZUCAR, HIDROPONICOS y PUNTO AZUL;
 *  LESAFFRE junta a LESAFFRE y PIBAMOUR— entonces la lista corta de clientes
 *  a los que la OV les cobra de mas se explica sola, y el arreglo es
 *  renombrar direcciones en SAP, no tocar codigo.
 *
 *  Si no caen ahi, la hipotesis se cae y hay que buscar en otro lado. Para
 *  eso hay que poder mirarlas, y para mirarlas hay que nombrarlas. */
function detalleSinAtribuir(filas, mapa, maestroJson) {
  const info = new Map();
  for (const u of ((maestroJson && maestroJson.ubicaciones) || []))
    if (u && u.AbsEntry != null) info.set(u.AbsEntry, u);
  const por = new Map();
  for (const f of (filas || [])) {
    if (!f) continue;
    if (mapa && mapa.get && mapa.get(f.BinAbsEntry)) continue;
    const u = info.get(f.BinAbsEntry);
    if (!u) continue;                                   // esa es de otra bodega
    if (u.IsSystemBin === 'tYES' || u.IsSystemBin === true) continue;
    let e = por.get(f.BinAbsEntry);
    if (!e) {
      e = { AbsEntry: f.BinAbsEntry, BinCode: u.BinCode || null,
            Description: u.Description || null, Sublevel1: u.Sublevel1 || null,
            filas: 0, pallets: 0, neto: 0 };
      por.set(f.BinAbsEntry, e);
    }
    const d = Number(f.delta) || 0;
    e.filas++; e.pallets += Math.abs(d); e.neto += d;
  }
  return [...por.values()].sort((a, b) => b.pallets - a.pallets);
}

/** CUANTOS DIAS COBRO LA ORDEN DE VENTA. De PD = S0*n + R se despeja n, pero
 *  con el S0 del CONSENSO y no con el del ancla:  n = (PD - R) / S0.
 *
 *  Si el cliente sostiene un saldo parejo y la semana tiene siete dias, esto
 *  tiene que dar siete. Cuando da uno, la OV cobro UN DIA de siete, y eso es
 *  una conversacion completamente distinta con Finanzas que "la cantidad esta
 *  mal": no hay que discutir cuantos pallets tenia, hay que mirar por que esa
 *  semana se emitio con un dia. CAMBIASO 2026-09-28 da 1,01. KUNSTMANN
 *  2026-09-28 da 1,10. QUINTA 2026-09-07 da 0,78 mientras sus otras tres
 *  semanas dan entre 6,1 y 6,9.
 *
 *  Un S0 negativo o cero no despeja nada y se informa como que no se sabe. */
function diasCobrados(pd, R, s0) {
  const b = Number(s0);
  if (b == null || !isFinite(b) || b <= 0) return null;
  const v = (Number(pd) - Number(R)) / b;
  return isFinite(v) ? v : null;
}

/** LA EDAD DEL MAESTRO, que hay que poder ver y no deducir.
 *
 *  El maestro es una foto: se arma una vez con backfill-sap-bin --maestro y
 *  queda. Si despues SAP crea ubicaciones nuevas, los movimientos en esas
 *  ubicaciones no aparecen como 'sin atribuir' —eso seria lo util— sino como
 *  'otra bodega', porque la ubicacion no figura en el maestro y
 *  clasificarSinMapa no tiene como distinguir una ubicacion nueva de CLIENTES
 *  de una de retail.
 *
 *  O sea que un maestro viejo no se ve como un error: se ve como mas retail.
 *  Por eso se informa cuando se genero y cuantas ubicaciones tenia, para
 *  poder compararlo con lo que SAP tiene hoy (sonda-sap-ubicacion lo dice) en
 *  vez de suponer que sigue al dia. */
function edadMaestro(json, hoy) {
  const gen = (json && json.generado) || null;
  // La cuenta va por FECHA de calendario y no por timestamp. Con el reloj, un
  // maestro armado ayer a las 18:00 daba "0 dias" a la manana siguiente, que
  // no es lo que entiende nadie que lea la linea.
  const t = Date.parse(String(gen || '').slice(0, 10) + 'T00:00:00Z');
  const h = Date.parse(String(hoy || '').slice(0, 10) + 'T00:00:00Z');
  const dias = (isFinite(t) && isFinite(h)) ? Math.floor((h - t) / DIA) : null;
  return { generado: gen, dias,
           ubicaciones: (json && json._ubicaciones) != null ? json._ubicaciones : null,
           atribuidas: (json && json._atribuidas) != null ? json._atribuidas : null };
}

/** LA VENTANA, y por que las dos puntas no se calculan igual.
 *
 *  El INICIO sale de la COBERTURA de los blobs, no del primer movimiento
 *  observado: binmov/2026-06.json cubre junio completo por construccion, asi
 *  que si el dia 1 no tuvo movimientos el saldo de ese dia igual existe y su
 *  delta es cero. Tomar el primer movimiento corria el inicio uno o dos dias
 *  —y eso alcanzaba para que la semilla, que tiene que pegar exacto con el
 *  dia anterior, se rechazara sola sin que faltara nada.
 *
 *  El FIN es al reves: sale del ULTIMO MOVIMIENTO y no de la cobertura,
 *  porque el mes en curso esta a medias. El blob de octubre dice cubrir
 *  hasta el 31 pero el dato llega al 23, y extender la ventana hasta el 31
 *  daria por 'completos' periodos que no lo estan. */
function ventana(coberturas, fechasObservadas) {
  const d = (coberturas || []).map(c => c && c.desde).filter(Boolean).sort();
  const f = (fechasObservadas || []).filter(Boolean).slice().sort();
  return { desde: d.length ? d[0] : (f.length ? f[0] : null),
           hasta: f.length ? f[f.length - 1] : null,
           porCobertura: d.length > 0,
           primerMovimiento: f.length ? f[0] : null };
}

/** LA SEMILLA DE S0, que es la forma de no despejarlo del dato que se esta
 *  validando.
 *
 *  Hasta ahora S0 salia de UNA semana de la cartola. Eso tiene dos problemas:
 *  si esa semana esta mala arrastra todas las demas —BALLERINA, catorce
 *  semanas falladas por un ancla mala— y ademas es un poco circular, porque
 *  se usa la cartola para predecir la cartola.
 *
 *  Con una semilla S0 viene medido aparte y las predicciones no gastan
 *  ninguna celda en el ancla: se predicen TODAS. El archivo lleva su
 *  procedencia adentro y dice que es un puente, no la arquitectura final.
 *
 *  La semilla se indexa por CardCode y no por razon social, a proposito: los
 *  nombres tienen mojibake en tarifas_contrato.json y cruzarlos por texto ya
 *  nos costo un cliente perdido en silencio. */
function leerSemilla(json) {
  const porCod = new Map();
  for (const x of ((json && json.saldos) || [])) {
    if (!x || !x.cod) continue;
    const v = Number(x.saldo);
    if (!isFinite(v)) continue;
    porCod.set(String(x.cod).trim(), v);
  }
  return { fecha: (json && json.fecha) || null, fuente: (json && json.fuente) || null,
           porCod, n: porCod.size };
}

/** El dia siguiente a una fecha ISO. */
function diaSiguiente(iso) {
  const t = Date.parse(String(iso || '') + 'T00:00:00Z');
  if (!isFinite(t)) return null;
  return new Date(t + DIA).toISOString().slice(0, 10);
}

/** LA SEMILLA TIENE QUE PEGAR CON LA VENTANA, y si no pega se dice y no se
 *  usa. Si la semilla es del 2025-12-31 la ventana tiene que empezar el
 *  2026-01-01: un dia de hueco es un dia de movimientos que nadie sumo, y
 *  arrastrarlo en silencio seria peor que no tener semilla. Falla cerrado. */
function semillaAplicable(fechaSemilla, ventanaDesde) {
  if (!fechaSemilla || !ventanaDesde) return { ok: false, motivo: 'falta la fecha' };
  const sig = diaSiguiente(fechaSemilla);
  if (!sig) return { ok: false, motivo: 'la fecha de la semilla no se entiende' };
  if (sig === ventanaDesde) return { ok: true, motivo: null };
  return { ok: false, motivo: 'la semilla es del ' + fechaSemilla + ' y la ventana empieza el ' +
           ventanaDesde + '; tendria que empezar el ' + sig +
           (sig < ventanaDesde ? ' (faltan meses de binmov en el medio)'
                               : ' (la semilla es posterior a la ventana)') };
}

/** Predice TODOS los periodos con el S0 de la semilla. No hay ancla que
 *  gastar ni que pueda estar mala. */
function predecirConSemilla(filasCli, semilla) {
  const out = [];
  for (const c of (filasCli || [])) {
    const s0 = semilla && semilla.porCod ? semilla.porCod.get(c.cod) : undefined;
    if (s0 === undefined) { out.push({ cod: c.cod, nom: c.nom, sinSemilla: true, celdas: [] }); continue; }
    const celdas = [];
    for (const x of (c.celdas || [])) {
      const pred = predecir(s0, x.R, x.n);
      const dif = pred - x.pd;
      celdas.push({ periodo: x.periodo, pd: x.pd, pred, dif,
                    rel: x.pd ? Math.abs(dif) / Math.abs(x.pd) : (dif ? 1 : 0),
                    s0Ov: x.s0 });
    }
    out.push({ cod: c.cod, nom: c.nom, s0: s0, celdas });
  }
  return out;
}

/** Donde la cartola no concuerda con el saldo medido. Es el entregable para
 *  Finanzas: la diferencia entre el S0 que implica la OV y el S0 medido, en
 *  pallets, por cliente. */
function discrepanciaS0(pred, tol) {
  const t = tol === undefined ? 0.05 : tol;
  const out = [];
  for (const c of (pred || [])) {
    if (c.sinSemilla || !c.celdas.length) continue;
    const s0s = c.celdas.map(x => x.s0Ov).filter(x => x != null && isFinite(x));
    if (!s0s.length) continue;
    const med = mediana(s0s);
    const may = Math.max(Math.abs(med), Math.abs(c.s0));
    const rel = may ? Math.abs(med - c.s0) / may : 0;
    if (rel > t) out.push({ cod: c.cod, nom: c.nom, s0Medido: c.s0, s0Ov: med,
                            dif: med - c.s0, rel });
  }
  return out.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
}

/** EL ACIERTO SEGUN LA DISTANCIA AL ANCLA.
 *
 *  La prueba estricta despeja S0 de UN periodo y predice los demas, asi que
 *  un ancla mala no falla una celda: falla TODAS las que vienen despues. Con
 *  cinco periodos son cuatro celdas; con quince, catorce. Por eso el
 *  porcentaje estricto puede BAJAR al abrir la ventana aunque el dato sea
 *  exactamente el mismo.
 *
 *  Medido el 24-10 sobre los mismos blobs, cambiando solo el ancho:
 *      167 celdas -> 38,9% exactas   ·  sin ancla 46,7%
 *      220 celdas -> 41,4% exactas   ·  sin ancla 46,4%
 *      775 celdas -> 33,3% exactas   ·  sin ancla 45,3%
 *  La prueba estricta se mueve nueve puntos y la que no usa ancla no se
 *  mueve. Eso ya dice que parte de lo que se pierde es del metodo.
 *
 *  Esta tabla dice cuanto, PERO SOLO DE UNA DE LAS DOS COSAS. Si el acierto
 *  cae con la distancia, el error se ACUMULA. Si es parejo, no se acumula.
 *  Eso no limpia al ancla: un ancla mala con error CONSTANTE —como
 *  LABORATORIO BALLERINA, que falla por los mismos ~45.700 en la distancia 1
 *  y en la 14— da una curva perfectamente plana. Plano significa 'no se
 *  acumula', no 'el ancla no tiene la culpa'.
 *
 *  Medido el 24-10 sobre 775 celdas: 50,2% al principio, 49,2% al final. No
 *  se acumula; lo que falta, falta parejo.
 *
 *  No mueve ninguna vara —la de arriba sigue puesta de antes—: la mide. */
function aciertoPorDistancia(filasCli) {
  const por = new Map();
  for (const c of (filasCli || [])) {
    const cs = (c && c.celdas) || [];
    if (cs.length < 2) continue;
    const s0 = cs[0].s0;
    for (let i = 1; i < cs.length; i++) {
      const x = cs[i], pred = predecir(s0, x.R, x.n);
      const dif = pred - x.pd;
      const rel = x.pd ? Math.abs(dif) / Math.abs(x.pd) : (dif ? 1 : 0);
      const e = por.get(i) || { n: 0, exactas: 0, p1: 0 };
      e.n++;
      if (Math.abs(dif) < 0.5) e.exactas++;
      if (rel <= 0.01) e.p1++;
      por.set(i, e);
    }
  }
  return por;
}

/** Si el acierto cae con la distancia. Compara el primer tercio de las
 *  distancias contra el ultimo. Cinco puntos porcentuales es el minimo para
 *  llamarlo caida: por debajo de eso, con estos tamanos de muestra, es
 *  ruido. */
function tendenciaDeAcierto(por, minCaida) {
  const m = por || new Map();
  const ks = [...m.keys()].sort((a, b) => a - b);
  if (ks.length < 2) return { n: ks.length, inicio: null, fin: null, cae: null };
  const corte = Math.max(1, Math.round(ks.length / 3));
  const tajada = sel => {
    let n = 0, p1 = 0;
    for (const k of sel) { const e = m.get(k); n += e.n; p1 += e.p1; }
    return n ? p1 / n : null;
  };
  const inicio = tajada(ks.slice(0, corte)), fin = tajada(ks.slice(-corte));
  const u = minCaida === undefined ? 0.05 : minCaida;
  return { n: ks.length, inicio, fin,
           cae: (inicio == null || fin == null) ? null : fin < inicio - u };
}

/** LAS UBICACIONES SIN CLIENTE, SEPARADAS. Contarlas todas juntas fue lo que
 *  hizo parecer que faltaban 517.531 pallets de clientes: la que ni siquiera
 *  figura en el maestro es de OTRA BODEGA —retail, sobre todo— y no deberia
 *  tener cliente nunca; la que figura con CardCode nulo SI es una atribucion
 *  que falta y vale lo que mueve. Son dos numeros distintos y el segundo es
 *  el unico que hay que perseguir. */
function clasificarSinMapa(filas, mapa, maestroJson) {
  const enMaestro = new Map();
  for (const u of ((maestroJson && maestroJson.ubicaciones) || []))
    if (u && u.AbsEntry != null) enMaestro.set(u.AbsEntry, u);
  const clases = {
    'otra bodega': { bins: new Set(), filas: 0, pallets: 0 },
    'sin atribuir': { bins: new Set(), filas: 0, pallets: 0 },
    'de sistema': { bins: new Set(), filas: 0, pallets: 0 },
  };
  for (const f of (filas || [])) {
    if (!f) continue;
    if (mapa && mapa.get && mapa.get(f.BinAbsEntry)) continue;
    const u = enMaestro.get(f.BinAbsEntry);
    const k = !u ? 'otra bodega'
            : (u.IsSystemBin === 'tYES' || u.IsSystemBin === true) ? 'de sistema'
            : 'sin atribuir';
    const c = clases[k];
    c.bins.add(f.BinAbsEntry);
    c.filas++;
    c.pallets += Math.abs(Number(f.delta) || 0);
  }
  return clases;
}

module.exports = { mapaDeMaestro, deltaDiarioPorCliente, diasDeVentana, serieRelativa,
                   acumuladoDePeriodo, s0Implicito, dispersionS0, predecir, veredicto,
                   cercanos, mediana, consensoS0, esTramo, clasificarCliente, repredecir,
                   clasificarSinMapa, detalleSinAtribuir, diasCobrados, diasPlausibles,
                   aciertoPorDistancia,
                   tendenciaDeAcierto,
                   ventana, edadMaestro, leerSemilla, diaSiguiente, semillaAplicable,
                   predecirConSemilla,
                   discrepanciaS0,
                   TOL_CONSENSO, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = M.opcionesDesconocidas(args, OPCIONES, BANDERAS);
  if (malas.length) {
    console.error('Opcion no reconocida: ' + malas.join('  '));
    console.error('Con valor: ' + OPCIONES.map(o => '--' + o + '=').join('  '));
    process.exit(1);
  }
  const mes = opcion('mes', '2026-09');
  const bodega = opcion('bodega', 'CLIENTES');
  const patron = opcion('patron', null);
  let re;
  try { re = patron ? new RegExp(patron, 'i') : A.PATRON; }
  catch (e) { console.error('--patron no es una expresion valida'); process.exit(1); }
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);
  async function leer(nombre) {
    const b = cc.getBlobClient(nombre);
    if (!(await b.exists())) return null;
    return JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  }

  // ── los insumos ───────────────────────────────────────────────────────────
  const maestro = await leer('binmaestro/' + bodega + '.json');
  if (!maestro) { console.error('Falta binmaestro/' + bodega + '.json. Correr backfill-sap-bin.js --maestro'); process.exit(1); }
  const mapa = mapaDeMaestro(maestro);

  const lista = String(opcion('meses', [M.mesAnterior(mes), mes, M.mesSiguiente(mes)].join(',')))
    .split(',').map(x => x.trim()).filter(Boolean);
  const filasBin = [], conBin = [], sinBin = [], coberturas = [];
  for (const m of lista) {
    const j = await leer('binmov/' + m + '.json');
    if (!j) { sinBin.push(m); continue; }
    conBin.push(m);
    coberturas.push({ mes: m, desde: j.desde, hasta: j.hasta });
    for (const f of (j.filas || [])) filasBin.push(f);
  }
  if (!conBin.length) { console.error('No hay ningun blob binmov de ' + lista.join(', ')); process.exit(1); }

  const ovFilas = [], conOV = [], sinOV = [];
  for (const m of lista) {
    const j = await leer('orders/' + m + '.json');
    if (!j) { sinOV.push(m); continue; }
    conOV.push(m);
    for (const f of (j.filas || [])) ovFilas.push(f);
  }
  if (!conOV.length) { console.error('No hay ningun blob orders de ' + lista.join(', ')); process.exit(1); }
  const porDoc = new Map();
  for (const f of ovFilas) {
    let d = porDoc.get(f.DocEntry);
    if (!d) { d = Object.assign({}, f, { _lineas: [] }); porDoc.set(f.DocEntry, d); }
    d._lineas.push(f);
  }
  // EL FILTRO DE ANULADAS VA ANTES QUE TODO LO DEMAS. Si una OV anulada
  // entra, su celda se descarta despues por duplicada y se pierde una celda
  // buena: eso costaba 117 celdas de las ~340 del universo.
  const fa = M.filtrarAnuladas([...porDoc.values()]);
  const docsOV = fa.vivas;

  const em = edadMaestro(maestro, new Date().toISOString().slice(0, 10));
  console.log('Maestro : binmaestro/' + bodega + '.json · ' + mil(mapa.size) + ' ubicaciones con cliente' +
              (em.ubicaciones != null ? '   de ' + mil(em.ubicaciones) + ' que tenia SAP' : '') +
              (em.generado ? '   ·  armado ' + String(em.generado).slice(0, 10) +
                             (em.dias != null ? ' (' + em.dias + ' dias)' : '') : ''));
  if (em.dias != null && em.dias >= 7)
    console.log('  OJO: el maestro es una foto de hace ' + em.dias + ' dias. Una ubicacion creada ' +
                'despues\n  no sale como "sin atribuir" sino como "otra bodega", o sea se ve como mas ' +
                'retail\n  y no como un error. Rehacerlo: backfill-sap-bin.js --maestro');
  console.log('Bin     : binmov ' + conBin.join(' + ') + ' · ' + mil(filasBin.length) + ' filas' +
              (sinBin.length ? '   (sin blob: ' + sinBin.join(', ') + ')' : ''));
  console.log('OV      : orders ' + conOV.join(' + ') + ' · ' + mil(docsOV.length) + ' documentos' +
              (sinOV.length ? '   (sin blob: ' + sinOV.join(', ') + ')' : ''));
  for (const l of M.avisoBlobsOV(mes, sinOV)) console.log(l);
  for (const l of M.informeAnuladas(fa)) console.log(l);

  // ── 1 · el movimiento por cliente ─────────────────────────────────────────
  const dd = deltaDiarioPorCliente(filasBin, mapa);
  const fechas = filasBin.map(f => String(f.DocDate || '').slice(0, 10)).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const vn = ventana(coberturas, fechas);
  const vDesde = vn.desde, vHasta = vn.hasta;
  const dias = diasDeVentana(vDesde, vHasta);
  console.log('\n── 1 · EL MOVIMIENTO ' + '─'.repeat(53));
  console.log('  ventana: ' + vDesde + ' a ' + vHasta + '   ·  ' + dias.length + ' dias');
  if (vn.porCobertura && vn.primerMovimiento && vn.primerMovimiento !== vDesde)
    console.log('  (el inicio sale de la cobertura del blob; el primer movimiento es del ' +
                vn.primerMovimiento + ' y los dias anteriores tienen delta cero)');
  console.log('  clientes con movimiento: ' + dd.porCliente.size);
  console.log('  filas sin ubicacion en el mapa: ' + mil(dd.filasSinMapa) + '   ·  ' +
              mil(dd.palletsSinMapa) + ' pallets en ' + dd.binsSinMapa.size + ' ubicaciones');
  const sm = clasificarSinMapa(filasBin, mapa, maestro);
  for (const k of ['otra bodega', 'sin atribuir', 'de sistema']) {
    const c = sm[k];
    if (!c.filas) continue;
    console.log('     ' + k.padEnd(14) + mil(c.bins.size).padStart(6) + ' ubicaciones  ' +
                mil(c.filas).padStart(8) + ' filas  ' + mil(c.pallets).padStart(10) + ' pallets');
  }
  console.log('  "otra bodega" es RETAIL y no deberia tener cliente. La unica que hay que');
  console.log('  perseguir es "sin atribuir": esa si es una ubicacion de CLIENTES sin dueno.');
  const sa = detalleSinAtribuir(filasBin, mapa, maestro);
  if (sa.length) {
    console.log('\n  LAS DE CLIENTES SIN DUENO, UNA POR UNA:');
    console.log('     ' + 'AbsEntry'.padStart(9) + '  ' + 'grupo'.padEnd(16) +
                'pallets'.padStart(10) + 'neto'.padStart(10) + '   descripcion');
    for (const u of sa.slice(0, TOPE))
      console.log('     ' + String(u.AbsEntry).padStart(9) + '  ' +
                  String(u.Sublevel1 || 's/g').slice(0, 15).padEnd(16) +
                  mil(u.pallets).padStart(10) + mil(u.neto).padStart(10) +
                  '   ' + String(u.Description || u.BinCode || 's/d').slice(0, 44));
    console.log('     Si el grupo es uno de los que estan EN CONFLICTO (PUNTOAZUL, LESAFFRE,');
    console.log('     LAFHAMBURGO), la lista corta del final se explica sola y el arreglo es');
    console.log('     renombrar direcciones en SAP, no tocar codigo.');
  }
  if (dd.sinFecha) console.log('  filas sin fecha legible: ' + mil(dd.sinFecha));

  // ── 2 · el universo de la cartola ─────────────────────────────────────────
  // --mes acota el universo de periodos a UN mes; --meses solo dice que
  // blobs cargar. Con cuatro meses de datos y el universo en septiembre se
  // comparan 5 semanas de 17, que es lo que tenia el resultado clavado en
  // 220 celdas. --universo abre el rango sin tocar el resto.
  const universo = opcion('universo', null) || mes;
  const per = M.periodosPorCliente(docsOV, universo, conOV);
  const ru = M.rangoDeMeses(universo);
  if (ru && ru.meses.length > 1)
    console.log('\n  universo de periodos: ' + ru.ini + ' a ' + ru.fin +
                '   (rango continuo, no un conjunto de meses sueltos)');
  const cortes = M.estaPresente(args, 'mantener-corte') ? [] : M.resolverCortes(per.porCliente);
  const dup = M.estaPresente(args, 'mantener-duplicadas') ? [] : M.resolverDuplicadas(docsOV, per.porCliente);
  const sel = M.vistaGlobal(per.porCliente);
  if (cortes.length) console.log('\n  OV de cierre contable interno descartadas: ' + cortes.length + ' clientes');
  for (const l of M.informeDuplicadas(dup, TOPE)) console.log(l);
  const periodos = [...sel.usables.keys()].sort();
  const ov = A.ovArriendo(docsOV, per.porCliente, re);

  // ── 3 · S0 por cliente, que es el diagnostico ─────────────────────────────
  const filasCli = [];
  for (const r of ov.porCliente.values()) {
    const serieR = serieRelativa(dd.porCliente.get(r.cod), dias);
    const celdas = [];
    for (const k of periodos) {
      const p = r.periodos.get(k);
      if (!p) continue;
      const ac = acumuladoDePeriodo(serieR, SS.diasDelPeriodo(k));
      if (!ac.completo) continue;
      celdas.push({ periodo: k, pd: p.dias, R: ac.R, n: ac.n, s0: s0Implicito(p.dias, ac.R, ac.n) });
    }
    if (celdas.length < 2) continue;
    filasCli.push({ cod: r.cod, nom: r.nom, celdas, disp: dispersionS0(celdas.map(c => c.s0)) });
  }
  console.log('\n── 2 · EL SALDO DE PARTIDA · todos los periodos tienen que dar el MISMO S0 ' + '─');
  console.log('  clientes con dos o mas periodos completos: ' + filasCli.length);
  const orden = filasCli.slice().sort((a, b) => (a.disp.dispersion == null ? 9 : a.disp.dispersion) -
                                                (b.disp.dispersion == null ? 9 : b.disp.dispersion));
  console.log('\n  ' + 'cliente'.padEnd(34) + 'per'.padStart(5) + 'S0 promedio'.padStart(13) +
              'rango'.padStart(11) + 'disp'.padStart(9));
  for (const c of orden.slice(0, TOPE))
    console.log('  ' + String(c.nom).slice(0, 33).padEnd(34) + String(c.celdas.length).padStart(5) +
                mil(c.disp.promedio).padStart(13) + mil(c.disp.rango).padStart(11) +
                (c.disp.dispersion == null ? 's/d' : (100 * c.disp.dispersion).toFixed(1) + '%').padStart(9));
  // la clase se calcula aca y no mas abajo porque la tabla de los que no
  // calzan necesita el S0 del consenso para despejar los dias cobrados.
  const clasePorCod = new Map();
  for (const c of filasCli) clasePorCod.set(c.cod, clasificarCliente(c.celdas, TOL));
  const estables = filasCli.filter(c => c.disp.dispersion != null && c.disp.dispersion <= 0.01);
  console.log('\n  clientes con los S0 dentro del 1%: ' + estables.length + ' de ' + filasCli.length);

  // ── 4 · predecir con el ancla del primer periodo ──────────────────────────
  let exactas = 0, p1 = 0, p5 = 0, total = 0;
  const fallan = [];
  for (const c of filasCli) {
    const s0 = c.celdas[0].s0;                       // ancla: el primer periodo
    for (let i = 1; i < c.celdas.length; i++) {      // y se PREDICEN los demas
      const x = c.celdas[i];
      const pred = predecir(s0, x.R, x.n);
      const dif = pred - x.pd, rel = x.pd ? Math.abs(dif) / Math.abs(x.pd) : (dif ? 1 : 0);
      total++;
      if (Math.abs(dif) < 0.5) exactas++;
      if (rel <= 0.01) p1++;
      if (rel <= 0.05) p5++;
      else fallan.push({ cod: c.cod, nom: c.nom, periodo: x.periodo, pd: x.pd, R: x.R, n: x.n, pred, dif, rel });
    }
  }
  console.log('\n── 3 · PREDECIR · ancla en el primer periodo, el resto se predice ' + '─'.repeat(8));
  console.log('  celdas predichas: ' + total);
  if (total) {
    console.log('     exactas al pallet-dia : ' + exactas + '   (' + (100 * exactas / total).toFixed(1) + '%)');
    console.log('     dentro del 1%         : ' + p1 + '   (' + (100 * p1 / total).toFixed(1) + '%)');
    console.log('     dentro del 5%         : ' + p5 + '   (' + (100 * p5 / total).toFixed(1) + '%)');
  }

  // ── 5 · la prueba SIN ancla ───────────────────────────────────────────────
  let dOk = 0, dTot = 0;
  for (const c of filasCli) {
    for (let i = 1; i < c.celdas.length; i++) {
      const a = c.celdas[i - 1], b = c.celdas[i];
      if (a.n !== b.n) continue;                      // S0 solo se cancela con el mismo largo
      dTot++;
      const obs = b.pd - a.pd, mod = b.R - a.R;
      const may = Math.max(Math.abs(obs), Math.abs(mod), 1);
      if (Math.abs(mod - obs) / may <= 0.05) dOk++;
    }
  }
  console.log('\n── 4 · SIN ANCLA · entre periodos del mismo largo, S0 se cancela ' + '─'.repeat(9));
  console.log('  pares comparables: ' + dTot + '   ·  calzan dentro del 5%: ' + dOk +
              (dTot ? '   (' + (100 * dOk / dTot).toFixed(1) + '%)' : ''));

  // ── 4b · cuanto de lo que falla es el ancla propagandose ────────────────
  const apd = aciertoPorDistancia(filasCli);
  const tend = tendenciaDeAcierto(apd);
  if (apd.size > 2) {
    console.log('\n  acierto segun la DISTANCIA al ancla (el ancla es el periodo 0):');
    console.log('  ' + 'dist'.padStart(6) + 'celdas'.padStart(9) + 'exactas'.padStart(10) +
                'dentro 1%'.padStart(12));
    for (const k of [...apd.keys()].sort((a, b) => a - b)) {
      const e = apd.get(k);
      console.log('  ' + String(k).padStart(6) + String(e.n).padStart(9) +
                  ((100 * e.exactas / e.n).toFixed(1) + '%').padStart(10) +
                  ((100 * e.p1 / e.n).toFixed(1) + '%').padStart(12));
    }
    if (tend.cae === true)
      console.log('  CAE con la distancia (' + (100 * tend.inicio).toFixed(1) + '% -> ' +
                  (100 * tend.fin).toFixed(1) + '%): el error se ACUMULA al alejarse del ancla.');
    else if (tend.cae === false) {
      console.log('  NO cae con la distancia (' + (100 * tend.inicio).toFixed(1) + '% -> ' +
                  (100 * tend.fin).toFixed(1) + '%): el error NO se acumula.');
      console.log('  Ojo: eso no limpia al ancla. Un ancla mala con error constante —BALLERINA');
      console.log('  falla por los mismos ~45.700 en la distancia 1 y en la 14— da una curva');
      console.log('  plana igual. Plano es "no se acumula", no "el ancla no tiene la culpa".');
    }
  }

  if (fallan.length) {
    console.log('\n  las que mas se alejan:');
    console.log('  ' + 'cliente'.padEnd(34) + 'periodo'.padEnd(24) + 'facturado'.padStart(13) +
                'modelo'.padStart(13) + 'dif'.padStart(12) + 'dias cobro'.padStart(16));
    let fueraModelo = 0;
    for (const f of fallan.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, TOPE)) {
      const cl = clasePorCod.get(f.cod);
      const dc = cl && cl.clase !== 'sin consenso' ? diasCobrados(f.pd, f.R, cl.consenso.valor) : null;
      const okd = diasPlausibles(dc, f.n);
      if (dc != null && !okd) fueraModelo++;
      console.log('  ' + String(f.nom).slice(0, 33).padEnd(34) + f.periodo.padEnd(24) +
                  mil(f.pd).padStart(13) + mil(f.pred).padStart(13) + mil(f.dif).padStart(12) +
                  (dc == null ? 's/d' : dc.toFixed(2) + ' de ' + f.n + (okd ? '' : ' (!)')).padStart(16));
    }
    console.log('  "dias cobro" despeja n de PD = S0*n + R con el S0 del consenso. Tiene que dar');
    console.log('  los dias del periodo. Cuando da 1 de 7, la OV cobro un dia: eso no es una');
    console.log('  cantidad mal calculada, es una semana emitida con un dia.');
    if (fueraModelo) {
      console.log('  Las marcadas con (!) dan un numero que NO se puede leer como dias —negativo,');
      console.log('  o varias veces el periodo—. Ahi la cuenta avisa que la celda no entra en el');
      console.log('  modelo con ese saldo; NO dice que se hayan cobrado esos dias. Son ' +
                  fueraModelo + ' de las ' + Math.min(fallan.length, TOPE) + ' que se listan.');
    }
  }

  // ── 6 · por que no calzan los que no calzan ──────────────────────────────
  const clases = new Map();
  const detalle = [];
  for (const c of filasCli) {
    const cl = clasePorCod.get(c.cod);
    clases.set(cl.clase, (clases.get(cl.clase) || 0) + 1);
    if (cl.clase !== 'estable') detalle.push({ c, cl });
  }
  console.log('\n── 5 · POR QUE NO CALZAN · el consenso dice CUALES periodos se contradicen ' + '─');
  for (const k of ['estable', 'ancla aislada', 'quiebre', 'disperso', 'sin consenso', 'sin datos'])
    if (clases.get(k)) console.log('  ' + k.padEnd(16) + String(clases.get(k)).padStart(4) + ' clientes');
  console.log('  "ancla aislada" NO es una falla del modelo: el unico periodo que se sale es el');
  console.log('  que la prueba estricta usa de ancla, y los demas concuerdan entre si. Ahi lo');
  console.log('  raro es la orden de venta de esa semana, igual que en CAMBIASO.');
  if (clases.get('sin consenso')) {
    console.log('  "sin consenso" es que ningun par de periodos concuerda con la holgura de ' +
                (100 * (TOL === undefined ? TOL_CONSENSO : TOL)).toFixed(0) + '%.');
    if (TOL === undefined)
      console.log('  Probar --tol=0.15 para ver si igual hay estructura con una holgura mas ancha.');
  }

  // cuanto se recupera si el ancla se toma del consenso en vez del primer periodo
  let rExactas = 0, rP1 = 0, rTotal = 0, rSaltados = 0;
  for (const { c, cl } of detalle) {
    // sin consenso no hay con que repredecir: el valor seria el de un periodo
    // suelto elegido por desempate, y meterlo aca inventaria un resultado.
    if (cl.clase === 'sin consenso') { rSaltados++; continue; }
    if (cl.consenso.valor == null) continue;
    for (const x of repredecir(c.celdas, cl.consenso.valor)) {
      rTotal++;
      if (Math.abs(x.dif) < 0.5) rExactas++;
      if (x.rel <= 0.01) rP1++;
    }
  }
  if (rTotal) {
    console.log('\n  sobre los ' + detalle.length + ' clientes que no son estables, si el ancla se toma del');
    console.log('  consenso y no del primer periodo: ' + rExactas + ' de ' + rTotal + ' exactas (' +
                (100 * rExactas / rTotal).toFixed(1) + '%), ' + rP1 + ' dentro del 1% (' +
                (100 * rP1 / rTotal).toFixed(1) + '%).');
    console.log('  Esto NO sube el veredicto —elegir el ancla mirando el resultado es hacer trampa—;');
    console.log('  mide cuanto de lo que no calza es culpa del ancla y no del dato.');
    if (rSaltados) console.log('  (' + rSaltados + ' clientes sin consenso quedan fuera de esta cuenta)');
  }

  const conDetalle = detalle.filter(d => d.cl.clase !== 'disperso');
  if (conDetalle.length) {
    console.log('\n  ' + 'cliente'.padEnd(34) + 'clase'.padEnd(15) + 'S0 consenso'.padStart(13) +
                'per'.padStart(8) + '   periodos que se salen');
    for (const { c, cl } of conDetalle.slice(0, TOPE))
      console.log('  ' + String(c.nom).slice(0, 33).padEnd(34) + cl.clase.padEnd(15) +
                  (cl.clase === 'sin consenso' ? '—' : mil(cl.consenso.valor)).padStart(13) +
                  (cl.consenso.dentro.length + '/' + cl.consenso.n).padStart(8) +
                  '   ' + cl.periodos.map(x => String(x).slice(0, 10)).join(' '));
  }

  // ── 7 · con semilla: S0 medido aparte, sin gastar ancla ─────────────────
  let conSemilla = null;
  const rutaSemilla = opcion('semilla', null);
  if (rutaSemilla) {
    let js = null;
    try { js = JSON.parse(require('fs').readFileSync(rutaSemilla, 'utf8')); }
    catch (e) { console.log('\n  No se pudo leer la semilla ' + rutaSemilla + ': ' + e.message); }
    if (js) {
      const sem = leerSemilla(js);
      const ap = semillaAplicable(sem.fecha, vDesde);
      console.log('\n── 6 · CON SEMILLA · S0 medido aparte, se predicen TODAS las celdas ' + '─'.repeat(6));
      console.log('  semilla: ' + rutaSemilla);
      console.log('  fecha ' + sem.fecha + '   ·  ' + sem.n + ' clientes   ·  ' + (sem.fuente || 's/f'));
      if (!ap.ok) {
        console.log('  NO SE USA: ' + ap.motivo);
        console.log('  Un dia de hueco entre la semilla y la ventana es un dia de movimientos que');
        console.log('  nadie sumo. Antes que arrastrarlo en silencio, no se usa.');
      } else {
        const pr = predecirConSemilla(filasCli, sem);
        let sExa = 0, sP1 = 0, sP5 = 0, sTot = 0, sinSem = 0;
        for (const c of pr) {
          if (c.sinSemilla) { sinSem++; continue; }
          for (const x of c.celdas) {
            sTot++;
            if (Math.abs(x.dif) < 0.5) sExa++;
            if (x.rel <= 0.01) sP1++;
            if (x.rel <= 0.05) sP5++;
          }
        }
        console.log('  celdas predichas: ' + sTot + '   (TODAS: no se gasta ninguna en el ancla)');
        if (sTot) {
          console.log('     exactas al pallet-dia : ' + sExa + '   (' + (100 * sExa / sTot).toFixed(1) + '%)');
          console.log('     dentro del 1%         : ' + sP1 + '   (' + (100 * sP1 / sTot).toFixed(1) + '%)');
          console.log('     dentro del 5%         : ' + sP5 + '   (' + (100 * sP5 / sTot).toFixed(1) + '%)');
        }
        if (sinSem) console.log('  clientes sin saldo en la semilla: ' + sinSem);
        conSemilla = { total: sTot, exactas: sExa, p1: sP1, p5: sP5, fecha: sem.fecha };
        console.log('  Esto NO reemplaza el veredicto de arriba: la semilla viene de WAVE, que es');
        console.log('  la dependencia que se quiere eliminar. Mide otra cosa y vale por eso: con');
        console.log('  S0 medido aparte, lo que queda sin calzar ya no puede ser culpa del ancla.');

        const disc = discrepanciaS0(pr);
        if (disc.length) {
          console.log('\n  DONDE LA CARTOLA NO CONCUERDA CON EL SALDO MEDIDO (sobre 5%):');
          console.log('  ' + 'cliente'.padEnd(34) + 'saldo medido'.padStart(14) +
                      'S0 que implica la OV'.padStart(22) + 'dif'.padStart(12));
          for (const d of disc.slice(0, TOPE))
            console.log('  ' + String(d.nom).slice(0, 33).padEnd(34) + mil(d.s0Medido).padStart(14) +
                        mil(d.s0Ov).padStart(22) + mil(d.dif).padStart(12));
          if (disc.length > TOPE) console.log('  ... y ' + (disc.length - TOPE) + ' clientes mas');
          console.log('  Un cliente aca es uno al que la OV le cobra como si tuviera otra cantidad');
          console.log('  de pallets que la que los movimientos dicen que tiene. Es la lista corta.');
        } else console.log('\n  Ningun cliente discrepa mas del 5% entre el saldo medido y el que implica su OV.');
      }
    }
  }

  const ver = veredicto({ total, exactas, p1, p5 });
  const verSem = conSemilla ? veredicto(conSemilla) : null;
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  CON ANCLA DESPEJADA DE LA CARTOLA (' + (100 * exactas / (total || 1)).toFixed(1) +
              '% exactas, ' + (100 * p1 / (total || 1)).toFixed(1) + '% dentro del 1%):');
  console.log('  ' + ver.texto);
  // El resultado con semilla NO reemplaza la vara —se declaro antes y se
  // mide sobre la prueba estricta— pero dejar el titular diciendo "queda
  // lejos" cuando tres lineas mas arriba el mismo dato con S0 medido la pasa
  // seria esconder el resultado detras de su propia definicion.
  if (verSem) {
    console.log('');
    console.log('  CON S0 MEDIDO APARTE, SOBRE EL MISMO DATO (' +
                (100 * conSemilla.exactas / (conSemilla.total || 1)).toFixed(1) + '% exactas, ' +
                (100 * conSemilla.p1 / (conSemilla.total || 1)).toFixed(1) + '% dentro del 1%):');
    console.log('  ' + verSem.texto);
    console.log('  Esto NO mueve la vara: la vara se mide sobre la prueba estricta y esa sigue');
    console.log('  siendo la de arriba. Lo que dice es DONDE estaba el problema. Los deltas son');
    console.log('  nuestros y el modelo es nuestro; lo unico prestado es el nivel de partida, y');
    console.log('  eso no es un error del camino propio sino hasta donde llega la extraccion.');
    console.log('  Se deja de pedir prestado con binmov hasta el inicio de la serie, o con el');
    console.log('  acceso _RO a HANA para leer HX_BINPALLETS directo.');
  }
  console.log('');
  console.log('  La vara es lo medido contra WAVE el 23-10: 42,9% exactas y 56,9% dentro del 1%,');
  console.log('  sobre 807 celdas de 15 semanas. Aca son ' + total + ' celdas, asi que el universo');
  console.log('  es mas chico y el porcentaje es menos firme.');

  const pedido = opcion('cliente', null);
  if (pedido) {
    const f = filasCli.filter(c => c.cod === pedido ||
      String(c.nom).toUpperCase().indexOf(pedido.toUpperCase()) >= 0);
    if (!f.length) { console.log('\nNingun cliente calza con "' + pedido + '"'); return; }
    for (const c of f.slice(0, 3)) {
      console.log('\n── DETALLE · ' + c.nom + ' [' + c.cod + '] ' + '─'.repeat(20));
      const s0 = c.celdas[0].s0;
      const cl = clasificarCliente(c.celdas, TOL);
      console.log('    S0 del ancla: ' + mil(s0) + '   ·  dispersion entre periodos: ' +
                  (c.disp.dispersion == null ? 's/d' : (100 * c.disp.dispersion).toFixed(2) + '%'));
      console.log('    clase: ' + cl.clase + '   ·  S0 del consenso: ' +
                  (cl.clase === 'sin consenso' ? 'no hay' : mil(cl.consenso.valor)) +
                  '   (' + cl.consenso.dentro.length + ' de ' + cl.consenso.n + ' periodos)');
      console.log('    ' + 'periodo'.padEnd(26) + 'dias'.padStart(6) + 'facturado'.padStart(13) +
                  'modelo'.padStart(13) + 'dif'.padStart(11) + 'dias cobro'.padStart(12) +
                  '   S0 que implica');
      c.celdas.forEach((x, i) => {
        const pred = predecir(s0, x.R, x.n);
        const dc = cl.clase !== 'sin consenso' ? diasCobrados(x.pd, x.R, cl.consenso.valor) : null;
        console.log('    ' + x.periodo.padEnd(26) + String(x.n).padStart(6) + mil(x.pd).padStart(13) +
                    (i === 0 ? '(ancla)'.padStart(13) : mil(pred).padStart(13)) +
                    (i === 0 ? ''.padStart(11) : mil(pred - x.pd).padStart(11)) +
                    (dc == null ? 's/d' : dc.toFixed(2)).padStart(12) +
                    '   ' + mil(x.s0));
      });
    }
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
