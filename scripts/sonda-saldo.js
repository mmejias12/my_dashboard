// ============================================================================
//  SONDA DE SALDO · el stock de pallets por cliente, leido desde el arriendo
//
//  QUE PREGUNTA. sonda-arriendo.js probo que SERV-DIAS-PALLET son pallet-dias
//  a la tarifa diaria del contrato (272 de 277 celdas calzan al sexto decimal)
//  pero que NO sale de los campos de calculo del movimiento: los saldos son de
//  decenas de miles de pallets que se mueven de a cientos por semana, o sea un
//  STOCK. El modelo que queda es el devengo diario sobre el saldo:
//
//      PD(periodo) = Σ sobre los dias del periodo del saldo del cliente ese dia
//      saldo(d)    = S0 + flujo acumulado hasta d
//
//  COMO SE PRUEBA SIN AJUSTAR NADA. Entre dos periodos consecutivos, S0 se
//  cancela:
//      PD(W2) - PD(W1) = Σ_{d∈W2} C(d) - Σ_{d∈W1} C(d)
//  Los dos lados se calculan: el izquierdo de la OV, el derecho de los
//  movimientos. CERO incognitas, cuatro ecuaciones por cliente. Si calzan, el
//  modelo es correcto y recien ahi S0 sale despejado — cinco veces por cliente,
//  una por semana, y las cinco tienen que dar lo mismo.
//
//  QUE CONCEPTOS MUEVEN EL SALDO. No se adivina. El lado derecho es LINEAL en
//  los signos, asi que se resuelven por minimos cuadrados sobre todos los
//  clientes y semanas a la vez —285 ecuaciones contra ~12 incognitas— y despues
//  se REDONDEAN a entero y se vuelve a evaluar exacto. El veredicto no es "el
//  ajuste quedo bien": es cuantas de las 285 ecuaciones reproduce la regla
//  entera. Un coeficiente que sale en 0,73 dice que el modelo esta mal, y eso
//  tambien es un resultado.
//
//  CONTRA EL SOBREAJUSTE. Un concepto que casi no mueve nada admite cualquier
//  coeficiente sin cambiar el error. Esos se marcan 'sin peso' en vez de
//  informar un numero que no significa nada.
//
//  Credenciales SOLO por variable de entorno; si falta una el script se
//  detiene nombrandola, nunca su valor.    OS_STORAGE_CONN · OS_SAP_CONTAINER
//
//  Uso (PowerShell):
//    node scripts/sonda-saldo.js --mes=2026-09
//    node scripts/sonda-saldo.js --mes=2026-09 --cliente=C91004000-6
//    node scripts/sonda-saldo.js --mes=2026-09 --signos=EMISION:1,CONF_DEVOL:-1
// ============================================================================
'use strict';

const M = require('./medir-emisiones.js');
const A = require('./sonda-arriendo.js');

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args = process.argv.slice(2);
const OPCIONES = ['mes', 'fecha', 'patron', 'tope', 'cliente', 'signos', 'minpeso'];
const BANDERAS = ['mantener-corte', 'mantener-duplicadas'];
const opcion = (n, d) => M.leerOpcion(args, n, d);
const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);

const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const dec = (n, k) => Number(n).toLocaleString('es-CL', { minimumFractionDigits: k === undefined ? 3 : k,
                                                          maximumFractionDigits: k === undefined ? 3 : k });

const DIA = 86400000;

// ── calendario del periodo ──────────────────────────────────────────────────

/** Los dias de un periodo 'YYYY-MM-DD..YYYY-MM-DD', extremos incluidos.
 *
 *  Se hace en UTC a proposito: con fechas locales, un periodo que cruza un
 *  cambio de hora pierde o gana un dia, y un dia de diferencia sobre un saldo
 *  de 27.000 pallets son 27.000 pallet-dias de error que nadie veria. */
function diasDelPeriodo(clave) {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(String(clave || ''));
  if (!m) return [];
  const a = Date.parse(m[1] + 'T00:00:00Z'), b = Date.parse(m[2] + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return [];
  // Date NO rechaza una fecha imposible: la rueda. '2026-02-30' se vuelve el 2
  // de marzo y la ventana sale corrida sin que nada avise. La unica forma de
  // detectarlo es exigir que la fecha vuelva a escribirse igual.
  if (new Date(a).toISOString().slice(0, 10) !== m[1]) return [];
  if (new Date(b).toISOString().slice(0, 10) !== m[2]) return [];
  // b < a lo resuelve el propio bucle: devuelve la lista vacia
  const out = [];
  for (let t = a; t <= b; t += DIA) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ── flujo diario ────────────────────────────────────────────────────────────

/** Movimiento diario por cliente y concepto, en pallets y con el signo CRUDO
 *  de SAP. El signo del concepto lo decide despues la resolucion; aca no se
 *  interpreta nada. */
function flujosDiarios(filas, campoFecha) {
  const porCliente = new Map();
  const conceptos = new Map();
  let sinFecha = 0, sinConcepto = 0;
  for (const f of (filas || [])) {
    const c = String(f.U_HX_RD_TransType || '').toUpperCase().trim();
    if (!c) { sinConcepto++; continue; }
    const fecha = M.iso(f[campoFecha]);
    if (!fecha) { sinFecha++; continue; }
    const cod = String(f.CardCode || '(sin CardCode)').trim();
    const q = Number(f.Quantity);
    const cant = isFinite(q) ? q : 0;
    conceptos.set(c, (conceptos.get(c) || 0) + cant);
    let cl = porCliente.get(cod);
    if (!cl) { cl = { cod, nom: String(f.CardName || '').trim(), porConcepto: new Map() };
               porCliente.set(cod, cl); }
    let pc = cl.porConcepto.get(c);
    if (!pc) { pc = new Map(); cl.porConcepto.set(c, pc); }
    pc.set(fecha, (pc.get(fecha) || 0) + cant);
  }
  return { porCliente, conceptos, sinFecha, sinConcepto };
}

/** Σ_{d∈W} C(d) para UN concepto de UN cliente, donde C es el flujo acumulado
 *  desde el inicio de la ventana.
 *
 *  El origen del acumulado es arbitrario: cualquier constante se absorbe en S0
 *  y desaparece al restar dos periodos. Por eso esta funcion no necesita saber
 *  cuando empieza la historia, que es justo el dato que no tenemos. */
function acumuladoEnPeriodo(serieDiaria, dias) {
  if (!dias || !dias.length) return 0;
  const fechas = [...(serieDiaria || new Map()).keys()].sort();
  let acum = 0, i = 0, total = 0;
  for (const d of dias) {
    while (i < fechas.length && fechas[i] <= d) { acum += serieDiaria.get(fechas[i]); i++; }
    total += acum;
  }
  return total;
}

/** Una ecuacion por cliente y por PAR de periodos consecutivos:
 *      PD(W2) - PD(W1) = Σ_c s_c · [A_c(W2) - A_c(W1)]
 *  El lado izquierdo es el objetivo, los corchetes son los coeficientes. No
 *  hay termino independiente: S0 se cancelo.
 *
 *  Un par con un periodo sin OV no se inventa: se cuenta y se deja afuera. */
function ecuaciones(flujos, pdPorCliente, periodosOrdenados, conceptos) {
  const ecs = [];
  let paresSinOV = 0;
  const diasDe = new Map();
  for (const k of periodosOrdenados) diasDe.set(k, diasDelPeriodo(k));
  for (const [cod, cl] of flujos.porCliente) {
    const pd = pdPorCliente.get(cod);
    if (!pd) continue;
    const acum = new Map();   // concepto -> periodo -> Σ C
    for (const c of conceptos) {
      const serie = cl.porConcepto.get(c) || new Map();
      const m = new Map();
      for (const k of periodosOrdenados) m.set(k, acumuladoEnPeriodo(serie, diasDe.get(k)));
      acum.set(c, m);
    }
    for (let i = 0; i + 1 < periodosOrdenados.length; i++) {
      const k1 = periodosOrdenados[i], k2 = periodosOrdenados[i + 1];
      const p1 = pd.periodos.get(k1), p2 = pd.periodos.get(k2);
      if (!p1 || !p2) { paresSinOV++; continue; }
      ecs.push({ cod, nom: cl.nom, de: k1, a: k2,
                 objetivo: p2.dias - p1.dias,
                 coef: conceptos.map(c => acum.get(c).get(k2) - acum.get(c).get(k1)) });
    }
  }
  return { ecs, paresSinOV };
}

// ── resolver los signos ─────────────────────────────────────────────────────

/** Minimos cuadrados por ecuaciones normales con pivoteo parcial.
 *
 *  Devuelve tambien que columnas quedaron INDETERMINADAS. Es lo que importa:
 *  un concepto que casi no mueve nada admite cualquier coeficiente sin cambiar
 *  el error, y reportar 0,73 para ese concepto seria presentar ruido como
 *  hallazgo. Esas columnas salen con null, no con un numero. */
function minimosCuadrados(filasCoef, objetivos, minPivote) {
  const n = (filasCoef[0] || []).length;
  // UMBRAL RELATIVO, no absoluto. Lo encontre mutando el solver: con un umbral
  // fijo, dos columnas casi colineales pasan el pivoteo y devuelven
  // coeficientes enormes y falsos —en una prueba dio 226 donde la respuesta
  // era 5— sin declarar nada. Un numero equivocado con cara de resultado es
  // peor que un null. El pivote se compara contra la diagonal inicial de la
  // propia columna, que es su escala natural.
  const eps = minPivote === undefined ? 1e-10 : minPivote;
  if (!n || !filasCoef.length) return { x: [], indeterminadas: [], n: 0 };
  // SIN escalado por columna, a proposito. Lo tuve y lo saque: medido sobre
  // ocho ordenes de magnitud de diferencia entre columnas, con el umbral de
  // pivote relativo de abajo da exactamente el mismo resultado. Era una rama
  // que no podia justificar con ninguna prueba.
  const AtA = [], Atb = [];
  for (let i = 0; i < n; i++) { AtA.push(new Array(n).fill(0)); Atb.push(0); }
  for (let r = 0; r < filasCoef.length; r++) {
    for (let i = 0; i < n; i++) {
      const ai = filasCoef[r][i];
      Atb[i] += ai * objetivos[r];
      for (let j = 0; j < n; j++) AtA[i][j] += ai * filasCoef[r][j];
    }
  }
  const mat = AtA.map((f, i) => f.concat([Atb[i]]));
  // la escala natural de cada columna, ANTES de eliminar: si el pivote cae muy
  // por debajo de esto, la columna quedo determinada solo por ruido numerico
  const diag0 = [];
  for (let i = 0; i < n; i++) diag0.push(Math.abs(AtA[i][i]));
  const escalaMax = Math.max(...diag0, 1e-300);
  const orden = [];
  const indet = new Set();
  let fila = 0;
  for (let col = 0; col < n; col++) {
    let mejor = fila, mx = 0;
    for (let r = fila; r < n; r++) if (Math.abs(mat[r][col]) > mx) { mx = Math.abs(mat[r][col]); mejor = r; }
    if (mx <= eps * Math.max(diag0[col], escalaMax * 1e-12)) { indet.add(col); continue; }
    const t = mat[fila]; mat[fila] = mat[mejor]; mat[mejor] = t;
    for (let r = 0; r < n; r++) {
      if (r === fila) continue;
      const k = mat[r][col] / mat[fila][col];
      if (!k) continue;
      for (let j = col; j <= n; j++) mat[r][j] -= k * mat[fila][j];
    }
    orden.push([col, fila]);
    fila++;
  }
  const x = new Array(n).fill(null);
  for (const [col, f] of orden) x[col] = mat[f][n] / mat[f][col];
  return { x, indeterminadas: [...indet].sort((a, b) => a - b), n };
}

/** Cuanto mueve cada concepto, en la escala de lo que hay que explicar. Un
 *  concepto por debajo del umbral no se puede determinar con estos datos y se
 *  dice asi, en vez de darle el coeficiente que el ajuste quiera. */
function pesoDeConceptos(filasCoef, objetivos, minRel) {
  const umbral = minRel === undefined ? 0.001 : minRel;
  const n = (filasCoef[0] || []).length;
  let escalaObj = 0;
  for (const o of objetivos) escalaObj = Math.max(escalaObj, Math.abs(o));
  const out = [];
  for (let j = 0; j < n; j++) {
    let mx = 0, suma = 0;
    for (const f of filasCoef) { mx = Math.max(mx, Math.abs(f[j])); suma += Math.abs(f[j]); }
    out.push({ col: j, maximo: mx, suma,
               rel: escalaObj ? mx / escalaObj : 0,
               conPeso: escalaObj ? (mx / escalaObj) >= umbral : false });
  }
  return out;
}

/** Redondeo a los unicos valores que tienen sentido fisico: un concepto suma
 *  al saldo, lo resta, o no lo toca. Lo indeterminado queda en 0 y se marca. */
function aEnteros(x, pesos) {
  return (x || []).map((v, j) => {
    if (v == null || !(pesos[j] && pesos[j].conPeso)) return 0;
    const r = Math.round(v);
    return Math.max(-1, Math.min(1, r));
  });
}

/** EL VEREDICTO. No es el error del ajuste: es cuantas ecuaciones reproduce
 *  EXACTO la regla entera. Una regla que explica 280 de 285 es una regla; una
 *  que explica 140 es un ajuste con buena cara. */
function evaluarEnteros(ecs, signos, tol) {
  const t = tol === undefined ? 0.5 : tol;
  let calzan = 0;
  const fallan = [];
  for (const e of ecs) {
    let v = 0;
    for (let j = 0; j < signos.length; j++) v += signos[j] * e.coef[j];
    const r = e.objetivo - v;
    if (Math.abs(r) <= t) calzan++;
    else fallan.push(Object.assign({ residuo: r, modelo: v }, e));
  }
  fallan.sort((a, b) => Math.abs(b.residuo) - Math.abs(a.residuo));
  return { total: ecs.length, calzan, fallan,
           pct: ecs.length ? 100 * calzan / ecs.length : 0 };
}

// ── el saldo ────────────────────────────────────────────────────────────────

/** Despeja S0 una vez por periodo:  S0 = (PD - Σ_{d∈W} C(d)) / dias
 *
 *  Son estimaciones INDEPENDIENTES del mismo numero. Que coincidan no es un
 *  ajuste: es la prueba. Que no coincidan dice en que semana se rompe. */
function estimarS0(flujos, pdPorCliente, periodosOrdenados, conceptos, signos) {
  const diasDe = new Map();
  for (const k of periodosOrdenados) diasDe.set(k, diasDelPeriodo(k));
  const out = [];
  for (const [cod, cl] of flujos.porCliente) {
    const pd = pdPorCliente.get(cod);
    if (!pd) continue;
    const est = [];
    for (const k of periodosOrdenados) {
      const p = pd.periodos.get(k);
      const dias = diasDe.get(k);
      if (!p || !dias.length) continue;
      let acum = 0;
      for (let j = 0; j < conceptos.length; j++) {
        if (!signos[j]) continue;
        acum += signos[j] * acumuladoEnPeriodo(cl.porConcepto.get(conceptos[j]) || new Map(), dias);
      }
      est.push({ periodo: k, s0: (p.dias - acum) / dias.length, pd: p.dias, dias: dias.length });
    }
    if (!est.length) continue;
    const v = est.map(e => e.s0);
    const min = Math.min(...v), max = Math.max(...v);
    const prom = v.reduce((a, b) => a + b, 0) / v.length;
    out.push({ cod, nom: cl.nom, estimaciones: est, n: v.length,
               min, max, promedio: prom, rango: max - min,
               dispersion: Math.abs(prom) > 1e-9 ? (max - min) / Math.abs(prom) : null });
  }
  return out.sort((a, b) => (b.dispersion || 0) - (a.dispersion || 0));
}

/** Lee --signos=CONCEPTO:1,OTRO:-1 y lo deja en el orden de `conceptos`.
 *  Un concepto escrito que no existe DETIENE la corrida: silenciarlo seria
 *  medir con una regla distinta de la que se pidio. */
function leerSignos(txt, conceptos) {
  if (!txt) return null;
  const s = new Array(conceptos.length).fill(0);
  const malos = [];
  for (const par of String(txt).split(',')) {
    if (!par.trim()) continue;
    const i = par.lastIndexOf(':');
    const nom = (i < 0 ? par : par.slice(0, i)).toUpperCase().trim();
    const v = i < 0 ? NaN : Number(par.slice(i + 1));
    const j = conceptos.indexOf(nom);
    if (j < 0 || !isFinite(v)) { malos.push(par.trim()); continue; }
    s[j] = v;
  }
  return { signos: s, malos };
}

module.exports = { diasDelPeriodo, flujosDiarios, acumuladoEnPeriodo, ecuaciones,
                   minimosCuadrados, pesoDeConceptos, aEnteros, evaluarEnteros,
                   estimarS0, leerSignos, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = M.opcionesDesconocidas(args, OPCIONES, BANDERAS);
  if (malas.length) {
    console.error('Opcion no reconocida: ' + malas.join('  '));
    console.error('Con valor: ' + OPCIONES.map(o => '--' + o + '=').join('  '));
    console.error('Banderas : ' + BANDERAS.map(o => '--' + o).join('  '));
    process.exit(1);
  }
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  const mes = opcion('mes', '2026-09');
  const campoFecha = opcion('fecha', 'DocDate');
  const patron = opcion('patron', null);
  const re = patron ? new RegExp(patron, 'i') : A.PATRON;
  const minPeso = Number(opcion('minpeso', '0.001'));
  const vecinos = [M.mesAnterior(mes), mes, M.mesSiguiente(mes)];

  async function leer(ent, m) {
    const b = cc.getBlobClient(ent + '/' + m + '.json');
    if (!(await b.exists())) return null;
    return JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  }
  const movFilas = [], conMov = [], sinMov = [];
  for (const m of vecinos) {
    const j = await leer('stocktransfers', m);
    if (!j) { sinMov.push(m); continue; }
    conMov.push(m);
    for (const f of (j.filas || [])) movFilas.push(f);
  }
  if (!conMov.length) { console.error('No hay ningun blob stocktransfers de ' + vecinos.join(', ')); process.exit(1); }
  const ovFilas = [], conOV = [], sinOV = [];
  for (const m of vecinos) {
    const j = await leer('orders', m);
    if (!j) { sinOV.push(m); continue; }
    conOV.push(m);
    for (const f of (j.filas || [])) ovFilas.push(f);
  }
  if (!conOV.length) { console.error('No hay ningun blob orders de ' + vecinos.join(', ')); process.exit(1); }
  const porDoc = new Map();
  for (const f of ovFilas) {
    let d = porDoc.get(f.DocEntry);
    if (!d) { d = Object.assign({}, f, { _lineas: [] }); porDoc.set(f.DocEntry, d); }
    d._lineas.push(f);
  }
  const docsOV = [...porDoc.values()];

  console.log('Movimientos : stocktransfers ' + conMov.join(' + ') + ' · ' + mil(movFilas.length) + ' filas' +
              (sinMov.length ? '   (sin blob: ' + sinMov.join(', ') + ')' : ''));
  console.log('OV          : orders ' + conOV.join(' + ') + ' · ' + mil(docsOV.length) + ' documentos' +
              (sinOV.length ? '   (sin blob: ' + sinOV.join(', ') + ')' : ''));
  for (const l of M.avisoBlobsOV(mes, sinOV)) console.log(l);
  console.log('Modelo: PD(periodo) = Σ sobre los dias del saldo del cliente.  Fecha: ' + campoFecha);
  console.log('La prueba es entre periodos consecutivos, donde S0 se cancela: CERO incognitas.\n');

  // universo
  const per = M.periodosPorCliente(docsOV, mes, conMov);
  const cortes = M.estaPresente(args, 'mantener-corte') ? [] : M.resolverCortes(per.porCliente);
  const dup = M.estaPresente(args, 'mantener-duplicadas') ? [] : M.resolverDuplicadas(docsOV, per.porCliente);
  const sel = M.vistaGlobal(per.porCliente);
  if (cortes.length) console.log('  OV de cierre contable interno descartadas: ' + cortes.length + ' clientes');
  for (const l of M.informeDuplicadas(dup, TOPE)) console.log(l);
  const periodos = [...sel.usables.keys()].sort();
  console.log('\n── PERIODOS ' + '─'.repeat(62));
  for (const k of periodos) console.log('    ' + k + '   ' + diasDelPeriodo(k).length + ' dias');
  if (periodos.length < 2) { console.error('\nHacen falta al menos DOS periodos consecutivos para que S0 se cancele.'); process.exit(1); }

  const ov = A.ovArriendo(docsOV, per.porCliente, re);
  const flujos = flujosDiarios(movFilas, campoFecha);
  const conceptos = [...flujos.conceptos.keys()].sort();

  console.log('\n── CONCEPTOS QUE MUEVEN PALLETS ' + '─'.repeat(42));
  for (const [c, q] of [...flujos.conceptos].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])))
    console.log('    ' + c.padEnd(26) + mil(q).padStart(12) + ' pallets');
  if (flujos.sinFecha) console.log('    filas sin ' + campoFecha + ': ' + mil(flujos.sinFecha));
  if (flujos.sinConcepto) console.log('    filas sin concepto: ' + mil(flujos.sinConcepto));

  const { ecs, paresSinOV } = ecuaciones(flujos, ov.porCliente, periodos, conceptos);
  console.log('\n── LAS ECUACIONES ' + '─'.repeat(56));
  console.log('  pares de periodos consecutivos con los dos lados: ' + ecs.length +
              (paresSinOV ? '   ·  descartados por falta de OV: ' + paresSinOV : ''));
  console.log('  incognitas (conceptos): ' + conceptos.length);
  if (!ecs.length) { console.error('\nNo hay ninguna ecuacion: sin esto no hay nada que probar.'); process.exit(1); }

  const filasCoef = ecs.map(e => e.coef), objetivos = ecs.map(e => e.objetivo);
  const pesos = pesoDeConceptos(filasCoef, objetivos, minPeso);
  const forzados = leerSignos(opcion('signos', null), conceptos);
  if (forzados && forzados.malos.length) {
    console.error('\n--signos no reconoce: ' + forzados.malos.join('  '));
    console.error('Conceptos validos: ' + conceptos.join(', '));
    process.exit(1);
  }

  let crudo = null, signos;
  if (forzados) { signos = forzados.signos; console.log('  signos forzados por --signos'); }
  else {
    crudo = minimosCuadrados(filasCoef, objetivos);
    signos = aEnteros(crudo.x, pesos);
  }

  console.log('\n── QUE CONCEPTO MUEVE EL SALDO ' + '─'.repeat(43));
  console.log('  ' + 'concepto'.padEnd(26) + 'cuanto mueve'.padStart(14) + 'rel'.padStart(9) +
              'ajuste'.padStart(10) + 'entero'.padStart(8) + '   nota');
  for (let j = 0; j < conceptos.length; j++) {
    const p = pesos[j];
    const x = crudo ? crudo.x[j] : null;
    const nota = !p.conPeso ? 'sin peso: no se puede determinar con estos datos'
      : (crudo && crudo.indeterminadas.indexOf(j) >= 0) ? 'indeterminado'
      : (x != null && Math.abs(x - Math.round(x)) > 0.1) ? 'NO es entero: el modelo no cierra aca' : '';
    console.log('  ' + conceptos[j].padEnd(26) + mil(p.maximo).padStart(14) +
                dec(p.rel, 4).padStart(9) +
                (x == null ? 's/d' : dec(x, 3)).padStart(10) +
                String(signos[j]).padStart(8) + '   ' + nota);
  }

  const ev = evaluarEnteros(ecs, signos);
  console.log('\n── EL VEREDICTO · cuantas ecuaciones reproduce la regla ENTERA ' + '─'.repeat(11));
  console.log('  calzan ' + ev.calzan + ' de ' + ev.total + '  (' + ev.pct.toFixed(1) + '%)');
  console.log('  ' + (ev.pct >= 95 ? 'El modelo del saldo es correcto: el arriendo se devenga sobre el saldo diario.'
            : ev.pct >= 50 ? 'Reproduce la mayoria pero no es una regla: hay algo mas moviendo el saldo.'
            : 'El modelo NO es este. No lo salvo con un factor.'));
  if (ev.fallan.length) {
    console.log('\n  las que no calzan, por residuo:');
    console.log('  ' + 'cliente'.padEnd(30) + 'de'.padEnd(13) + 'a'.padEnd(13) +
                'observado'.padStart(13) + 'modelo'.padStart(13) + 'residuo'.padStart(13));
    for (const f of ev.fallan.slice(0, TOPE))
      console.log('  ' + String(f.nom).slice(0, 29).padEnd(30) + f.de.slice(5, 10).padEnd(13) +
                  f.a.slice(5, 10).padEnd(13) + mil(f.objetivo).padStart(13) +
                  mil(f.modelo).padStart(13) + mil(f.residuo).padStart(13));
    if (ev.fallan.length > TOPE) console.log('  ... y ' + (ev.fallan.length - TOPE) + ' mas');
  }

  // ── el saldo ──────────────────────────────────────────────────────────────
  const s0 = estimarS0(flujos, ov.porCliente, periodos, conceptos, signos);
  const buenos = s0.filter(c => c.dispersion != null && c.dispersion <= 0.01);
  console.log('\n── EL SALDO POR CLIENTE · ' + periodos.length + ' estimaciones independientes de S0 ' + '─'.repeat(10));
  console.log('  clientes con S0: ' + s0.length + '   ·  con las ' + periodos.length +
              ' estimaciones dentro del 1%: ' + buenos.length);
  let total = 0; for (const c of buenos) total += c.promedio;
  console.log('  suma de los saldos coherentes: ' + mil(total) + ' pallets en poder de clientes');
  console.log('\n  ' + 'cliente'.padEnd(34) + 'S0 promedio'.padStart(13) + 'min'.padStart(12) +
              'max'.padStart(12) + 'rango'.padStart(11) + 'disp'.padStart(9));
  for (const c of s0.slice(0, TOPE))
    console.log('  ' + String(c.nom).slice(0, 33).padEnd(34) + mil(c.promedio).padStart(13) +
                mil(c.min).padStart(12) + mil(c.max).padStart(12) + mil(c.rango).padStart(11) +
                (c.dispersion == null ? 's/d' : (100 * c.dispersion).toFixed(2) + '%').padStart(9));

  const pedido = opcion('cliente', null);
  if (pedido) {
    const f = s0.filter(c => c.cod === pedido || String(c.nom).toUpperCase().indexOf(pedido.toUpperCase()) >= 0);
    if (!f.length) { console.log('\nNingun cliente calza con "' + pedido + '"'); return; }
    for (const c of f.slice(0, 5)) {
      console.log('\n── DETALLE · ' + c.nom + ' [' + c.cod + '] ' + '─'.repeat(20));
      console.log('    ' + 'periodo'.padEnd(26) + 'dias'.padStart(6) + 'PD de la OV'.padStart(14) + 'S0 despejado'.padStart(14));
      for (const e of c.estimaciones)
        console.log('    ' + e.periodo.padEnd(26) + String(e.dias).padStart(6) +
                    mil(e.pd).padStart(14) + mil(e.s0).padStart(14));
      console.log('    ' + 'rango entre estimaciones'.padEnd(26) + ' '.repeat(6) + ' '.repeat(14) + mil(c.rango).padStart(14));
    }
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
