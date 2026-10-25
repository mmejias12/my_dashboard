// ============================================================================
//  SONDA DE ARRIENDO · de donde sale SERV-DIAS-PALLET
//
//  QUE PREGUNTA. ARRIENDO es el 27,7% de la cartola (≈5.048 UF/mes) y es el
//  unico concepto cuya cantidad NO son pallets: son pallet-dias. La hipotesis
//  es que sale de dos campos de usuario que SAP estampa en la confirmacion
//  —cuantos pallets volvieron y cuantos dias estuvieron afuera— y que la
//  tarifa es 'Arriendo Pallet' del contrato, por pallet y por dia.
//
//  El maestro da el primer ancla: mediana 0,00077 UF, y 19,7M de unidades en
//  catorce semanas de OV son ≈6,06M al mes, que a 0,00077 dan 4.666 UF contra
//  los 5.048 de la cartola. Coincide en orden de magnitud y en unidad.
//
//  POR QUE UNA SONDA Y NO EL COMPARADOR. En transferencias intente adivinar la
//  regla dos veces y las dos me equivoque; la sonda la encontro en una corrida.
//  Aca hay cuatro cosas que no se saben y que cambian el diseno del comparador:
//    1. en que filas estan los dos campos (¿solo confirmaciones?)
//    2. si CalculoCantidad es lo mismo que Quantity o algo distinto
//    3. que forma tienen los dias (ceros, negativos, ajustes)
//    4. si Σ(cantidad × dias) por cliente y semana es la cantidad de la OV
//  Esta sonda las contesta y no concluye nada mas.
//
//  NO INVENTA NOMBRES DE CAMPO. Ya me paso una vez: parsePeriodo tenia
//  'U_HX_PeriodoDesde' escrito a mano y la unica razon de que funcionara fue
//  la suerte. Aca los campos se buscan por FORMA entre los U_* que traen los
//  documentos y se informa el nombre encontrado. Con --campos=cant,dias se
//  fuerzan a mano.
//
//  Credenciales SOLO por variable de entorno. Si falta una, el script se
//  detiene nombrando la variable, nunca su valor.
//      OS_STORAGE_CONN   ·  OS_SAP_CONTAINER (opcional)
//
//  Uso (PowerShell):
//    node scripts/sonda-arriendo.js --mes=2026-09
//    node scripts/sonda-arriendo.js --mes=2026-09 --cliente=C76773020-9
//    node scripts/sonda-arriendo.js --mes=2026-09 --campos=U_HX_RD_CalculoCantidad,U_HX_RD_CalculoDias
// ============================================================================
'use strict';

// La seleccion del universo —periodos por cliente, corte contable interno, OV
// duplicadas— ya esta escrita y probada en medir-emisiones.js. Reusarla es lo
// correcto: dos copias de esa logica se habrian separado en una semana, y
// cualquier arreglo alla sirve aca.
const M = require('./medir-emisiones.js');

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args = process.argv.slice(2);
const OPCIONES = ['mes', 'fecha', 'patron', 'concepto', 'tope', 'cliente', 'campos'];
const BANDERAS = ['mantener-corte', 'mantener-duplicadas'];
const opcion = (n, d) => M.leerOpcion(args, n, d);
const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);

const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const uf5 = n => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
const uf6 = n => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

// El servicio del contrato que deberia pagar esto, y el ItemCode que lo cobra.
const SERVICIO = 'Arriendo Pallet';
const PATRON = /^SERV-DIAS-PALLET/i;

// ── encontrar los campos ────────────────────────────────────────────────────

/** Los dos campos se buscan por FORMA entre los U_* presentes, no por un
 *  nombre escrito a mano, y se devuelve tambien la lista de candidatos para
 *  que un cambio de nombre en SAP se vea en vez de volverse un cero silencioso.
 *
 *  Un campo que no se encuentra devuelve null y el informe lo dice; medir con
 *  un nombre inventado da cero y cero no se distingue de "no hay arriendo". */
function buscarCampos(filas, limite) {
  const n = limite === undefined ? 2000 : limite;
  const claves = new Set();
  for (let i = 0; i < Math.min(n, (filas || []).length); i++)
    for (const k of Object.keys(filas[i] || {})) if (k.indexOf('U_') === 0) claves.add(k);
  const us = [...claves].sort();
  const cant = us.filter(k => /calc/i.test(k) && /cant/i.test(k));
  const dias = us.filter(k => /calc/i.test(k) && /dia/i.test(k));
  return { cant: cant[0] || null, dias: dias[0] || null,
           cantCandidatos: cant, diasCandidatos: dias, usuario: us };
}

/** Numero de un campo, o null. Un texto no numerico NO es cero: un cero se
 *  suma sin ruido y deja el total mas chico sin que nada avise. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return isFinite(x) ? x : null;
}

// ── perfil de los campos ────────────────────────────────────────────────────

/** En que filas viven los dos campos, por concepto de movimiento.
 *
 *  Es la primera pregunta y la que puede matar la hipotesis: si los campos
 *  aparecen tambien en TRANSFERENCIA, entonces el arriendo no se cobra solo
 *  al volver y el modelo es otro. */
function perfilCalculo(filas, campos) {
  const out = new Map();
  for (const f of (filas || [])) {
    // el rotulo del concepto ausente se deja legible: '(sin tipo)' y no
    // '(SIN TIPO)', que es lo que saldria de mayusculizar el reemplazo
    const t = String(f.U_HX_RD_TransType || '').toUpperCase().trim() || '(sin tipo)';
    let e = out.get(t);
    if (!e) {
      e = { tipo: t, filas: 0, conCant: 0, conDias: 0, conAmbos: 0, noNumericos: 0,
            cantCero: 0, diasCero: 0, cantNeg: 0, diasNeg: 0, palletDias: 0 };
      out.set(t, e);
    }
    e.filas++;
    const cv = campos.cant ? f[campos.cant] : undefined;
    const dv = campos.dias ? f[campos.dias] : undefined;
    const presente = v => v !== null && v !== undefined && v !== '';
    const c = num(cv), d = num(dv);
    if (presente(cv)) { e.conCant++; if (c === null) e.noNumericos++; }
    if (presente(dv)) { e.conDias++; if (d === null) e.noNumericos++; }
    if (c !== null && d !== null) {
      e.conAmbos++;
      e.palletDias += c * d;
      if (c === 0) e.cantCero++;
      if (d === 0) e.diasCero++;
      if (c < 0) e.cantNeg++;
      if (d < 0) e.diasNeg++;
    }
  }
  return out;
}

/** ¿CalculoCantidad es lo mismo que Quantity?
 *
 *  Si lo es, el campo es redundante y el modelo se simplifica a Quantity × dias.
 *  Si no lo es, hay que entender por que antes de usar uno de los dos: medir
 *  con el equivocado da un numero plausible y mal. */
function compararConQuantity(filas, campos, tope) {
  const T = tope === undefined ? 10 : tope;
  const r = { comparadas: 0, iguales: 0, distintas: 0, sinCant: 0, enCero: 0, ejemplos: [] };
  for (const f of (filas || [])) {
    const c = campos.cant ? num(f[campos.cant]) : null;
    if (c === null) { r.sinCant++; continue; }
    // LAS FILAS EN CERO NO SE COMPARAN. Medido en septiembre: el campo vale 0
    // en 46.679 de 50.753 filas, y comparar esos ceros contra un Quantity
    // positivo daba "6,4% iguales", un porcentaje que no significa nada y que
    // invita a leer que los campos no tienen relacion. La pregunta es si son
    // el mismo numero DONDE el campo esta poblado.
    if (c === 0) { r.enCero++; continue; }
    const q = num(f.Quantity);
    r.comparadas++;
    if (q !== null && Math.abs(q - c) < 1e-9) r.iguales++;
    else {
      r.distintas++;
      if (r.ejemplos.length < T)
        r.ejemplos.push({ docNum: f.DocNum, tipo: String(f.U_HX_RD_TransType || '').trim(),
                          quantity: q, calculo: c });
    }
  }
  return r;
}

/** Que forma tienen los dias. Los ceros y los negativos son lo que importa:
 *  un dia cero no cobra nada y un dia negativo seria un ajuste, y las dos
 *  cosas cambian lo que el comparador tiene que hacer con esas filas. */
function distribucionDias(filas, campos) {
  const v = [];
  for (const f of (filas || [])) {
    const d = campos.dias ? num(f[campos.dias]) : null;
    if (d !== null) v.push(d);
  }
  v.sort((a, b) => a - b);
  const q = p => v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null;
  return { n: v.length, min: v.length ? v[0] : null, p25: q(0.25), mediana: q(0.5),
           p75: q(0.75), max: v.length ? v[v.length - 1] : null,
           ceros: v.filter(x => x === 0).length,
           negativos: v.filter(x => x < 0).length,
           sobre365: v.filter(x => x > 365).length };
}

// ── los dos lados ───────────────────────────────────────────────────────────

/** NUESTRO lado: Σ(cantidad × dias) por cliente y periodo.
 *
 *  La unidad es pallet-dias, no pallets. Se dice en cada rotulo del informe a
 *  proposito: un numero correcto con la unidad equivocada es peor que un error,
 *  porque nadie lo revisa. */
function palletDias(filas, periodos, campoFecha, campos, conceptos) {
  const quiero = new Set((conceptos || []).map(x => String(x).toUpperCase().trim()));
  const porCliente = new Map();
  let fuera = 0, sinFecha = 0, sinOV = 0, sinCampos = 0, noNumericos = 0, ambiguas = 0;
  for (const f of (filas || [])) {
    const t = String(f.U_HX_RD_TransType || '').toUpperCase().trim();
    if (quiero.size && !quiero.has(t)) continue;
    const cv = campos.cant ? f[campos.cant] : undefined;
    const dv = campos.dias ? f[campos.dias] : undefined;
    if ((cv === undefined || cv === null || cv === '') &&
        (dv === undefined || dv === null || dv === '')) { sinCampos++; continue; }
    const c = num(cv), d = num(dv);
    if (c === null || d === null) { noNumericos++; continue; }
    const cod = String(f.CardCode || '(sin CardCode)').trim();
    const cl = periodos.get(cod);
    if (!cl) { sinOV++; continue; }
    const fecha = M.iso(f[campoFecha]);
    if (!fecha) { sinFecha++; continue; }
    const kps = M.periodosDe(fecha, cl.usables);
    if (!kps.length) { fuera++; continue; }
    if (kps.length > 1) ambiguas++;
    const kp = kps.length === 1 ? kps[0] : M.AMBIGUO;

    let r = porCliente.get(cod);
    if (!r) { r = { cod, nom: String(f.CardName || '').trim(), dias: 0, pallets: 0,
                    filas: 0, periodos: new Map() }; porCliente.set(cod, r); }
    const pd = c * d;
    r.dias += pd; r.pallets += c; r.filas++;
    const rp = r.periodos.get(kp) || { dias: 0, pallets: 0, filas: 0 };
    rp.dias += pd; rp.pallets += c; rp.filas++;
    r.periodos.set(kp, rp);
  }
  return { porCliente, fuera, sinFecha, sinOV, sinCampos, noNumericos, ambiguas };
}

/** El lado OV: las lineas de SERV-DIAS-PALLET, con su cantidad y su precio
 *  unitario llevado a UF. El precio unitario ES la tarifa diaria si la
 *  hipotesis es correcta, asi que se guarda para poder compararla. */
function ovArriendo(docs, periodos, patron) {
  const re = patron || PATRON;
  const porCliente = new Map();
  let sinTC = 0, tcDudoso = 0, fuera = 0, usadas = 0;
  for (const d of (docs || [])) {
    const cod = String(d.CardCode || '(sin CardCode)').trim();
    const cl = periodos.get(cod);
    const p = M.parsePeriodo(d);
    const kp = p.desde ? M.clave(p) : null;
    if (!kp || !cl || !cl.usables.has(kp)) { fuera++; continue; }
    const esUF = /^UF$/i.test(String(d.DocCurrency || d.DocCur || '').trim());
    const leido = M.parseTC(d.Comments);
    const tc = esUF ? 1 : (leido != null && leido >= M.TC_MIN ? leido : null);
    if (!tc) { if (leido != null) tcDudoso++; else sinTC++; continue; }
    for (const l of (d._lineas || [])) {
      if (!re.test(String(l.ItemCode || ''))) continue;
      const cant = num(l.Quantity) || 0;
      const precio = num(l.Price != null ? l.Price : l.UnitPrice) || 0;
      const uf = (cant * precio) / tc;
      let r = porCliente.get(cod);
      if (!r) { r = { cod, nom: String(d.CardName || '').trim(), dias: 0, uf: 0,
                      filas: 0, periodos: new Map() }; porCliente.set(cod, r); }
      r.dias += cant; r.uf += uf; r.filas++;
      const rp = r.periodos.get(kp) || { dias: 0, uf: 0, filas: 0, ovs: new Set(), tarifas: new Set() };
      rp.dias += cant; rp.uf += uf; rp.filas++; rp.ovs.add(d.DocNum);
      // la tarifa diaria implicita, por linea: precio en CLP sobre el TC
      if (cant) rp.tarifas.add(precio / tc);
      r.periodos.set(kp, rp);
      usadas++;
    }
  }
  return { porCliente, sinTC, tcDudoso, fuera, usadas };
}

// ── el cruce ────────────────────────────────────────────────────────────────

/** La tarifa diaria del contrato para un cliente, buscada por su razon social
 *  normalizada igual que en el resto de los scripts. */
function tarifaContrato(nom, maestro, servicio) {
  const c = maestro && maestro[M.norm(nom)];
  const t = c && c.tarifas && c.tarifas[servicio || SERVICIO];
  const v = num(t);
  return v;
}

/** Veredicto de la tarifa implicita contra la del contrato. La tolerancia es
 *  relativa porque las tarifas diarias tienen seis decimales y el precio de la
 *  OV viene redondeado a peso. */
function veredictoTarifa(implicitas, contrato, tolRel) {
  const tol = tolRel === undefined ? 0.005 : tolRel;
  const vs = [...(implicitas || [])].filter(x => x != null && isFinite(x));
  if (!vs.length) return { veredicto: 'sin tarifa en la OV', implicita: null, contrato };
  if (vs.length > 1) {
    const min = Math.min(...vs), max = Math.max(...vs);
    if ((max - min) > tol * Math.max(Math.abs(max), 1e-12))
      return { veredicto: 'varias tarifas en la semana', implicita: null, contrato, tarifas: vs.length };
  }
  const imp = vs[0];
  if (contrato == null) return { veredicto: 'sin contrato', implicita: imp, contrato };
  if (contrato === 0) return { veredicto: imp === 0 ? 'calza en cero' : 'contrato en cero', implicita: imp, contrato };
  const rel = Math.abs(imp - contrato) / Math.abs(contrato);
  return { veredicto: rel <= tol ? 'calza' : 'otra tarifa', implicita: imp, contrato, rel };
}

/** Une los dos lados por cliente y periodo. Lo que decide es el COCIENTE de
 *  pallet-dias: si la hipotesis es correcta tiene que dar 1. Un cociente
 *  estable y distinto de 1 (2, 7, 30) seria otra unidad, no un descalce, y es
 *  justo lo que hay que poder ver. */
function cruzarArriendo(nu, ov, maestro) {
  const out = [];
  for (const cod of new Set([...nu.keys(), ...ov.keys()])) {
    const a = nu.get(cod), b = ov.get(cod);
    const ks = new Set([...(a ? a.periodos.keys() : []), ...(b ? b.periodos.keys() : [])]);
    for (const k of [...ks].sort()) {
      const m = (a && a.periodos.get(k)) || { dias: 0, pallets: 0 };
      const o = (b && b.periodos.get(k)) || { dias: 0, uf: 0, tarifas: new Set() };
      const nom = (a && a.nom) || (b && b.nom) || cod;
      const t = veredictoTarifa(o.tarifas, tarifaContrato(nom, maestro));
      out.push({ cod, nom, periodo: k,
                 nuestroDias: m.dias, nuestroPallets: m.pallets,
                 ovDias: o.dias, ovUF: o.uf,
                 cociente: m.dias ? o.dias / m.dias : null,
                 difDias: o.dias - m.dias,
                 tarifa: t,
                 // lo que valdrian NUESTROS pallet-dias a la tarifa del contrato
                 nuestroUF: t.contrato == null ? null : m.dias * t.contrato });
    }
  }
  return out.sort((x, y) => Math.abs(y.difDias) - Math.abs(x.difDias));
}

/** Resumen de los cocientes: si estan todos pegados a un mismo numero, ese
 *  numero es la respuesta —1 si la hipotesis es correcta, otra cosa si la
 *  unidad es distinta—. Si estan dispersos, el modelo esta mal y no hay que
 *  salvarlo con un factor. */
function resumenCocientes(filas, tol) {
  const t = tol === undefined ? 0.01 : tol;
  const v = (filas || []).map(f => f.cociente).filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, veredicto: 'sin datos' };
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const med = q(0.5);
  const cerca = v.filter(x => Math.abs(x - med) <= t * Math.max(Math.abs(med), 1e-12)).length;
  return { n: v.length, min: v[0], p25: q(0.25), mediana: med, p75: q(0.75), max: v[v.length - 1],
           cercaDeLaMediana: cerca, pctCerca: 100 * cerca / v.length,
           enUno: v.filter(x => Math.abs(x - 1) <= t).length,
           veredicto: cerca / v.length >= 0.8
             ? (Math.abs(med - 1) <= t ? 'el cociente es 1: la cantidad de la OV son pallet-dias'
                                       : 'cociente estable en ' + med.toFixed(4) + ': la unidad no es la que supusimos')
             : 'cocientes dispersos: el modelo no es este' };
}

module.exports = { buscarCampos, num, perfilCalculo, compararConQuantity, distribucionDias,
                   palletDias, ovArriendo, tarifaContrato, veredictoTarifa, cruzarArriendo,
                   resumenCocientes, SERVICIO, PATRON, OPCIONES, BANDERAS };

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
  const fs = require('fs'), path = require('path');
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  const mes = opcion('mes', '2026-09');
  const campoFecha = opcion('fecha', 'DocDate');
  const patron = opcion('patron', null);
  const re = patron ? new RegExp(patron, 'i') : PATRON;
  const concepto = opcion('concepto', null);
  const conceptos = concepto ? concepto.split(',').map(x => x.trim()).filter(Boolean) : [];
  const vecinos = [M.mesAnterior(mes), mes, M.mesSiguiente(mes)];

  const rutaMaestro = path.join(__dirname, '..', 'data', 'tarifas_contrato.json');
  if (!fs.existsSync(rutaMaestro)) { console.error('Falta ' + rutaMaestro); process.exit(1); }
  const mj = JSON.parse(fs.readFileSync(rutaMaestro, 'utf8'));
  const maestro = {};
  for (const nom of Object.keys(mj.clientes)) maestro[M.norm(nom)] = mj.clientes[nom];

  async function leer(ent, m) {
    const b = cc.getBlobClient(ent + '/' + m + '.json');
    if (!(await b.exists())) return null;
    return JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  }

  const movFilas = [], mesesConMov = [], mesesSinMov = [];
  for (const m of vecinos) {
    const j = await leer('stocktransfers', m);
    if (!j) { mesesSinMov.push(m); continue; }
    mesesConMov.push(m);
    for (const f of (j.filas || [])) movFilas.push(f);
  }
  if (!mesesConMov.length) { console.error('No hay ningun blob stocktransfers de ' + vecinos.join(', ')); process.exit(1); }

  const ovFilas = [], mesesConOV = [], mesesSinOV = [];
  for (const m of vecinos) {
    const j = await leer('orders', m);
    if (!j) { mesesSinOV.push(m); continue; }
    mesesConOV.push(m);
    for (const f of (j.filas || [])) ovFilas.push(f);
  }
  if (!mesesConOV.length) { console.error('No hay ningun blob orders de ' + vecinos.join(', ')); process.exit(1); }
  const porDoc = new Map();
  for (const f of ovFilas) {
    let d = porDoc.get(f.DocEntry);
    if (!d) { d = Object.assign({}, f, { _lineas: [] }); porDoc.set(f.DocEntry, d); }
    d._lineas.push(f);
  }
  const docsOV = [...porDoc.values()];

  console.log('Maestro de contratos: ' + mj._clientes + ' clientes · ' + mj._tarifas + ' tarifas' +
              '   ·  servicio que paga esto: ' + SERVICIO);
  console.log('Movimientos : stocktransfers ' + mesesConMov.join(' + ') + ' · ' + mil(movFilas.length) + ' filas' +
              (mesesSinMov.length ? '   (sin blob: ' + mesesSinMov.join(', ') + ')' : ''));
  console.log('OV          : orders ' + mesesConOV.join(' + ') + ' · ' + mil(docsOV.length) + ' documentos, ' +
              mil(ovFilas.length) + ' lineas' +
              (mesesSinOV.length ? '   (sin blob: ' + mesesSinOV.join(', ') + ')' : ''));
  for (const l of M.avisoBlobsOV(mes, mesesSinOV)) console.log(l);
  console.log('ItemCode buscado en la OV: ' + (patron || 'SERV-DIAS-PALLET') +
              '   ·  fecha del movimiento: ' + campoFecha);
  console.log('UNIDAD: la cantidad de este concepto son PALLET-DIAS, no pallets.\n');

  // ── 1. los campos ─────────────────────────────────────────────────────────
  const forzados = opcion('campos', null);
  let campos;
  if (forzados) {
    const p = forzados.split(',').map(x => x.trim());
    campos = { cant: p[0] || null, dias: p[1] || null, cantCandidatos: [], diasCandidatos: [], usuario: [] };
  } else campos = buscarCampos(movFilas);

  console.log('── 1 · LOS CAMPOS, buscados por forma ' + '─'.repeat(36));
  console.log('  cantidad : ' + (campos.cant || 'NO ENCONTRADO') +
              (campos.cantCandidatos.length > 1 ? '   (tambien calzan: ' + campos.cantCandidatos.slice(1).join(', ') + ')' : ''));
  console.log('  dias     : ' + (campos.dias || 'NO ENCONTRADO') +
              (campos.diasCandidatos.length > 1 ? '   (tambien calzan: ' + campos.diasCandidatos.slice(1).join(', ') + ')' : ''));
  if (!campos.cant || !campos.dias) {
    console.log('\n  Falta uno de los dos campos. Medir sin el daria CERO, y un cero no se');
    console.log('  distingue de "este cliente no tuvo arriendo". Campos U_* presentes:');
    for (const k of campos.usuario) console.log('    ' + k);
    console.log('\n  Si cambiaron de nombre, pasalos a mano: --campos=<cantidad>,<dias>');
    return;
  }

  // ── 2. donde viven ────────────────────────────────────────────────────────
  const perfil = perfilCalculo(movFilas, campos);
  console.log('\n── 2 · EN QUE FILAS ESTAN ' + '─'.repeat(48));
  console.log('  ' + 'concepto'.padEnd(20) + 'filas'.padStart(8) + 'con cant'.padStart(10) +
              'con dias'.padStart(10) + 'los dos'.padStart(9) + 'cant=0'.padStart(8) +
              'dias=0'.padStart(8) + 'cant<0'.padStart(8) + 'dias<0'.padStart(8) + 'pallet-dias'.padStart(14));
  for (const [, e] of [...perfil].sort((a, b) => b[1].conAmbos - a[1].conAmbos))
    console.log('  ' + e.tipo.slice(0, 19).padEnd(20) + mil(e.filas).padStart(8) +
                mil(e.conCant).padStart(10) + mil(e.conDias).padStart(10) +
                mil(e.conAmbos).padStart(9) + mil(e.cantCero).padStart(8) +
                mil(e.diasCero).padStart(8) + mil(e.cantNeg).padStart(8) +
                mil(e.diasNeg).padStart(8) + mil(e.palletDias).padStart(14));
  const conAlgo = [...perfil.values()].filter(e => e.conAmbos > 0);
  console.log('  conceptos que traen los dos campos: ' +
              (conAlgo.length ? conAlgo.map(e => e.tipo).join(', ') : '(ninguno)'));
  if (conAlgo.length > 1)
    console.log('  OJO: estan en MAS de un concepto. El arriendo no se cobraria solo al volver,\n' +
                '  y el comparador tiene que decidir cuales suma. No lo decide esta sonda.');
  const noNum = [...perfil.values()].reduce((a, e) => a + e.noNumericos, 0);
  if (noNum) console.log('  valores presentes pero NO numericos: ' + mil(noNum) + ' (no se suman, se cuentan aca)');

  // ── 3. ¿cantidad es Quantity? ─────────────────────────────────────────────
  const soloConCampos = movFilas.filter(f => campos.cant && f[campos.cant] !== undefined && f[campos.cant] !== null && f[campos.cant] !== '');
  const cq = compararConQuantity(soloConCampos, campos, TOPE);
  console.log('\n── 3 · ' + campos.cant + ' CONTRA Quantity ' + '─'.repeat(30));
  console.log('  el campo esta en CERO en ' + mil(cq.enCero) + ' filas: esas no se comparan.');
  console.log('  comparadas (campo distinto de cero): ' + mil(cq.comparadas) +
              '   ·  iguales: ' + mil(cq.iguales) + '   ·  distintas: ' + mil(cq.distintas) +
              (cq.comparadas ? '   (' + (100 * cq.iguales / cq.comparadas).toFixed(1) + '% iguales)' : ''));
  if (!cq.distintas && cq.comparadas)
    console.log('  Son el mismo numero siempre: el modelo se simplifica a Quantity × dias.');
  else if (cq.distintas) {
    console.log('  NO son el mismo numero. Hay que entender por que antes de elegir uno:');
    for (const e of cq.ejemplos)
      console.log('    OV/doc ' + String(e.docNum).padStart(8) + '  ' + String(e.tipo).padEnd(16) +
                  '  Quantity ' + mil(e.quantity).padStart(8) + '   ' + campos.cant + ' ' + mil(e.calculo).padStart(8));
  }

  // ── 4. forma de los dias ──────────────────────────────────────────────────
  const dd = distribucionDias(soloConCampos, campos);
  console.log('\n── 4 · FORMA DE ' + campos.dias + ' ' + '─'.repeat(32));
  console.log('  n ' + mil(dd.n) + '   min ' + dd.min + '   p25 ' + dd.p25 + '   mediana ' + dd.mediana +
              '   p75 ' + dd.p75 + '   max ' + dd.max);
  console.log('  en cero: ' + mil(dd.ceros) + '   negativos: ' + mil(dd.negativos) +
              '   sobre 365: ' + mil(dd.sobre365));
  if (dd.negativos) console.log('  Los negativos serian ajustes: el comparador tiene que decidir si los resta.');

  // ── 5. el cruce ───────────────────────────────────────────────────────────
  const per = M.periodosPorCliente(docsOV, mes, mesesConMov);
  const cortes = M.estaPresente(args, 'mantener-corte') ? [] : M.resolverCortes(per.porCliente);
  const duplicadas = M.estaPresente(args, 'mantener-duplicadas') ? [] : M.resolverDuplicadas(docsOV, per.porCliente);
  const sel = M.vistaGlobal(per.porCliente);
  if (cortes.length) console.log('\n  OV de cierre contable interno descartadas: ' + cortes.length + ' clientes');
  for (const l of M.informeDuplicadas(duplicadas, TOPE)) console.log(l);

  console.log('\n── 5 · PERIODOS USABLES ' + '─'.repeat(50));
  for (const [k, p] of [...sel.usables].sort())
    console.log('    ' + k + '   ' + String(p.ovs).padStart(4) + ' OV   ' + String(p.clientes).padStart(3) + ' clientes');
  if (!sel.usables.size) { console.error('\nNingun periodo usable: no hay con que comparar.'); process.exit(1); }

  const nu = palletDias(movFilas, per.porCliente, campoFecha, campos, conceptos.length ? conceptos : conAlgo.map(e => e.tipo));
  const ov = ovArriendo(docsOV, per.porCliente, re);
  console.log('\n── 6 · Σ(' + campos.cant + ' × ' + campos.dias + ') CONTRA LA OV ' + '─'.repeat(12));
  let nd = 0, np = 0; for (const r of nu.porCliente.values()) { nd += r.dias; np += r.pallets; }
  let od = 0, ou = 0; for (const r of ov.porCliente.values()) { od += r.dias; ou += r.uf; }
  console.log('  nuestro : ' + mil(nd) + ' pallet-dias   (' + mil(np) + ' pallets en ' + mil(nu.porCliente.size) + ' clientes)');
  console.log('  OV      : ' + mil(od) + ' pallet-dias   ' + uf5(ou) + ' UF   ' +
              mil(ov.usadas) + ' lineas en ' + mil(ov.porCliente.size) + ' clientes');
  console.log('  cociente global: ' + (nd ? (od / nd).toFixed(6) : 's/d'));
  if (nu.fuera)       console.log('  filas fuera de los periodos de su cliente: ' + mil(nu.fuera));
  if (nu.sinOV)       console.log('  filas de clientes sin OV en el mes: ' + mil(nu.sinOV));
  if (nu.sinCampos)   console.log('  filas del concepto SIN los dos campos: ' + mil(nu.sinCampos));
  if (nu.noNumericos) console.log('  filas con los campos no numericos: ' + mil(nu.noNumericos));
  if (nu.ambiguas)    console.log('  filas en dos periodos del mismo cliente: ' + mil(nu.ambiguas));
  if (ov.sinTC)       console.log('  OV sin TC legible: ' + mil(ov.sinTC));
  if (ov.tcDudoso)    console.log('  OV con TC bajo el piso: ' + mil(ov.tcDudoso));

  const cru = cruzarArriendo(nu.porCliente, ov.porCliente, maestro);
  const res = resumenCocientes(cru);
  console.log('\n── 7 · EL COCIENTE, que es lo que decide ' + '─'.repeat(33));
  console.log('  celdas (cliente × semana) con los dos lados: ' + res.n);
  if (res.n) {
    console.log('  min ' + res.min.toFixed(4) + '   p25 ' + res.p25.toFixed(4) + '   mediana ' + res.mediana.toFixed(4) +
                '   p75 ' + res.p75.toFixed(4) + '   max ' + res.max.toFixed(4));
    console.log('  dentro del 1% de la mediana: ' + res.cercaDeLaMediana + ' de ' + res.n +
                ' (' + res.pctCerca.toFixed(1) + '%)   ·  pegadas a 1: ' + res.enUno);
    console.log('  => ' + res.veredicto);
  }

  console.log('\n── 8 · LA TARIFA DIARIA ' + '─'.repeat(50));
  const vt = new Map();
  for (const c of cru) vt.set(c.tarifa.veredicto, (vt.get(c.tarifa.veredicto) || 0) + 1);
  console.log('  ' + [...vt].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(' · '));
  console.log('  ' + 'cliente'.padEnd(34) + 'implicita OV'.padStart(14) + 'contrato'.padStart(14) + '   veredicto');
  const muestra = cru.filter(c => c.tarifa.implicita != null).slice(0, TOPE);
  for (const c of muestra)
    console.log('  ' + c.nom.slice(0, 33).padEnd(34) + uf6(c.tarifa.implicita).padStart(14) +
                (c.tarifa.contrato == null ? 's/d' : uf6(c.tarifa.contrato)).padStart(14) +
                '   ' + c.tarifa.veredicto + '   ' + c.periodo);

  console.log('\n── 9 · LAS CELDAS QUE MAS SE SEPARAN ' + '─'.repeat(37));
  console.log('  ' + 'cliente'.padEnd(30) + 'periodo'.padEnd(26) + 'nuestro p-d'.padStart(14) +
              'OV p-d'.padStart(14) + 'cociente'.padStart(10) + 'nuestro UF'.padStart(13) + 'OV UF'.padStart(13));
  for (const c of cru.slice(0, TOPE))
    console.log('  ' + c.nom.slice(0, 29).padEnd(30) + c.periodo.padEnd(26) +
                mil(c.nuestroDias).padStart(14) + mil(c.ovDias).padStart(14) +
                (c.cociente == null ? 's/d' : c.cociente.toFixed(4)).padStart(10) +
                (c.nuestroUF == null ? 's/d' : uf5(c.nuestroUF)).padStart(13) + uf5(c.ovUF).padStart(13));

  // Detalle de un cliente
  const pedido = opcion('cliente', null);
  if (pedido) {
    const filas = cru.filter(c => c.cod === pedido ||
      String(c.nom).toUpperCase().indexOf(pedido.toUpperCase()) >= 0);
    if (!filas.length) { console.log('\nNingun cliente calza con "' + pedido + '"'); return; }
    console.log('\n── DETALLE · ' + filas[0].nom + ' [' + filas[0].cod + '] ' + '─'.repeat(20));
    for (const c of filas.slice().sort((a, b) => String(a.periodo).localeCompare(String(b.periodo))))
      console.log('  ' + c.periodo.padEnd(26) + 'nuestro ' + mil(c.nuestroDias).padStart(12) + ' p-d   OV ' +
                  mil(c.ovDias).padStart(12) + ' p-d   cociente ' +
                  (c.cociente == null ? 's/d' : c.cociente.toFixed(4)).padStart(9) +
                  '   tarifa ' + (c.tarifa.implicita == null ? 's/d' : uf6(c.tarifa.implicita)) +
                  ' vs ' + (c.tarifa.contrato == null ? 's/d' : uf6(c.tarifa.contrato)));
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
