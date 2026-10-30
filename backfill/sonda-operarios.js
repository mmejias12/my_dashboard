// ============================================================================
//  backfill/sonda-operarios.js  ·  M3DATA · QUIEN hizo cada orden, y si ese
//  dato sirve para pagar un bono
//
//  QUE CONTESTA. De las ordenes de fabricacion de un periodo: cuantas traen
//  operario, cuantas no, cuantos de esos codigos son un RUT de verdad, y
//  cuanto pallet queda colgando de un codigo que no identifica a nadie.
//
//  POR QUE EXISTE. El operario SI esta en SAP: es el campo de usuario
//  OWOR.U_HX_OPERARIO, que apunta a la tabla de usuario @HX_OPERARIOS. NO
//  esta en el movimiento de inventario, que es donde se busco primero.
//
//  Medido contra SAP el 30-10-2026, periodo 21-sep a 19-oct: de 238.397
//  pallets producidos, 169.235 (71%) cuelgan de una orden sin un RUT. La
//  INSPECCION entera —108.535 pallets— no trae operario, y el pintado de
//  Santiago tampoco. Reparacion si lo trae, pero un tercio bajo codigos de
//  relleno (777-7, 9999-2, 333-3, 111-3, 11-1). Talca esta limpio.
//
//  OJO CON LEER ESTO DESDE UN EXCEL: el codigo 11-1 abierto en Excel se
//  convierte en la fecha 11-ene. Lo que parecia "un operario con una fecha
//  como codigo" era la planilla, no SAP. Por eso esta sonda lee del Service
//  Layer y no de una exportacion.
//
//  POR QUE IMPORTA QUE EL CODIGO SEA UN RUT. El bono viaja por RUT de punta a
//  punta: la planilla de produccion, la hoja que recibe RRHH y Talana usan el
//  RUT como llave. Un codigo que no es RUT obliga a cruzar por nombre, y
//  cruzar por nombre junta personas distintas que comparten un nombre de
//  pila.
//
//  LO QUE ESTA SONDA NO HACE: decidir a quien pagarle. Mide la calidad del
//  dato y nombra lo que no se puede resolver, para que se corrija en SAP.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL, SAP_USER, SAP_PASS, SAP_DB
//
//  Uso:
//    node backfill/sonda-operarios.js --desde=2026-09-21 --hasta=2026-10-19
//    node backfill/sonda-operarios.js --desde=2026-01-01 --hasta=2026-10-31 --tope=40
//    node backfill/sonda-operarios.js --desde=2026-10-01 --hasta=2026-10-31 --tabla=U_HX_OPERARIOS
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');

const args = process.argv.slice(2);
const OPCIONES = ['desde', 'hasta', 'tabla', 'campo', 'tope', 'pagina', 'item'];
const BANDERAS = ['detalle'];
const opcion = (n, d) => { const p = '--' + n + '='; for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length); return d; };
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

// ── lo puro ─────────────────────────────────────────────────────────────────

/*  EL DIGITO VERIFICADOR DEL RUT.
 *
 *  Los multiplicadores van 2,3,4,5,6,7 y vuelven a 2 — NO a 3. Con el 3 el
 *  algoritmo marca invalidos casi todos los RUT, y un 100% de rechazo es la
 *  firma de un error propio, no de mil RUT malos. Se verifica contra casos
 *  conocidos en la suite: 11111111-1, 12345678-5, 5126663-3, 1-9. */
function dv(numero) {
  const s = String(numero == null ? '' : numero);
  if (!/^\d+$/.test(s)) return null;
  let suma = 0, m = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    suma += Number(s[i]) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

/** Parte un codigo en numero y digito. No corrige nada: si viene basura,
 *  devuelve nulos y el que llama decide. */
function partirRut(codigo) {
  const t = String(codigo == null ? '' : codigo).replace(/[^0-9kK]/g, '').toUpperCase();
  if (t.length < 2) return { numero: null, digito: null };
  return { numero: t.slice(0, -1), digito: t.slice(-1) };
}

/*  CUANDO UN CODIGO NO PUEDE SER UNA PERSONA.
 *
 *  No basta con que el digito verificador cuadre: 99999999-2 valida y no es
 *  nadie. Se marca aparte lo que es evidentemente de relleno —todas las
 *  cifras iguales— y lo que ni siquiera tiene largo de RUT. Un RUT chileno
 *  de persona tiene entre 7 y 8 cifras antes del digito; 6 se deja pasar
 *  porque existen RUT antiguos cortos. */
function clasificarCodigo(codigo) {
  if (codigo == null || String(codigo).trim() === '')
    return { clase: 'vacio', motivo: 'la orden no trae operario' };
  const c = String(codigo).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(c) || /^\d{2}[-/]\d{2}[-/]\d{2,4}$/.test(c))
    return { clase: 'fecha', motivo: 'el codigo es una fecha, no un RUT' };
  const { numero, digito } = partirRut(c);
  if (!numero) return { clase: 'ilegible', motivo: 'no se puede leer como RUT' };
  if (numero.length < 6 || numero.length > 8)
    return { clase: 'largo', motivo: 'un RUT de persona tiene 6 a 8 cifras y este tiene ' + numero.length };
  if (new Set(numero).size === 1)
    return { clase: 'relleno', motivo: 'todas las cifras iguales: es un codigo de relleno' };
  const esperado = dv(numero);
  if (esperado !== digito)
    return { clase: 'digito', motivo: 'el digito verificador de ' + numero + ' es ' + esperado + ', no ' + digito };
  return { clase: 'rut', motivo: null };
}

/** Un nombre que describe un turno o un proceso no es una persona. Se nombra
 *  explicito en vez de adivinar: lo que no esta en la lista pasa. */
const NO_PERSONA = /^(turno|armad|reparacion|pintado|inspeccion|planta|sin |varios|otros)/i;

function pareceProceso(nombre) {
  return NO_PERSONA.test(String(nombre == null ? '' : nombre).trim());
}

/** Una orden normalizada. La cantidad que importa para un bono es la
 *  COMPLETADA, no la planificada: se guardan las dos y se dice cual falta. */
function normalizarOrden(o) {
  const x = o || {};
  const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
  return {
    numero: x.DocumentNumber != null ? x.DocumentNumber : x.AbsoluteEntry,
    entrada: x.AbsoluteEntry,
    item: x.ItemNo == null ? null : String(x.ItemNo),
    fecha: String(x.PostingDate == null ? '' : x.PostingDate).slice(0, 10) || null,
    planificada: num(x.PlannedQuantity),
    completada: num(x.CompletedQuantity),
    rechazada: num(x.RejectedQuantity),
    operario: x.U_HX_OPERARIO == null ? null : String(x.U_HX_OPERARIO).trim() || null,
    estado: x.ProductionOrderStatus == null ? null : String(x.ProductionOrderStatus),
  };
}

/*  CUAL CANTIDAD USAR, declarado y no supuesto.
 *
 *  Completada es la que corresponde a un bono por produccion. Si SAP no la
 *  trae se cae a la planificada y la sonda lo DICE, porque pagar sobre lo
 *  planificado es pagar por lo que se pensaba hacer. */
function cantidadDeOrden(orden) {
  const o = orden || {};
  if (o.completada != null) return { valor: o.completada, cual: 'completada' };
  if (o.planificada != null) return { valor: o.planificada, cual: 'planificada' };
  return { valor: 0, cual: 'ninguna' };
}

/** El resumen por proceso: cuanto cuelga de un operario identificable y
 *  cuanto no. Lo que no se puede atribuir no se reparte ni se descarta: se
 *  cuenta aparte. */
function coberturaPorProceso(ordenes, nombres, itemPallet) {
  const m = new Map();
  const nom = nombres instanceof Map ? nombres : new Map(Object.entries(nombres || {}));
  for (const o of (ordenes || [])) {
    if (!o) continue;
    const k = o.item || '(sin item)';
    const e = m.get(k) || { item: k, familia: familiaDeItem(k, itemPallet), ordenes: 0,
                            total: 0, conRut: 0, sinOperario: 0, codigoMalo: 0, noPersona: 0 };
    const { valor } = cantidadDeOrden(o);
    e.ordenes++; e.total += valor;
    const c = clasificarCodigo(o.operario);
    if (c.clase === 'vacio') e.sinOperario += valor;
    else if (pareceProceso(nom.get(o.operario))) e.noPersona += valor;
    else if (c.clase === 'rut') e.conRut += valor;
    else e.codigoMalo += valor;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total ||
                                        (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}

/** Los codigos que hay que arreglar, de mayor a menor dano. */
function codigosAArreglar(ordenes, nombres) {
  const nom = nombres instanceof Map ? nombres : new Map(Object.entries(nombres || {}));
  const m = new Map();
  for (const o of (ordenes || [])) {
    if (!o) continue;
    const c = clasificarCodigo(o.operario);
    const proceso = pareceProceso(nom.get(o.operario));
    if (c.clase === 'rut' && !proceso) continue;
    const k = o.operario == null ? '(vacio)' : String(o.operario);
    const e = m.get(k) || { codigo: k, nombre: nom.get(o.operario) || null,
                            clase: proceso ? 'no es persona' : c.clase,
                            motivo: proceso ? 'el nombre describe un turno o un proceso' : c.motivo,
                            ordenes: 0, total: 0 };
    e.ordenes++; e.total += cantidadDeOrden(o).valor;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total ||
                                        (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
}

/*  NO SE SUMAN PALLETS CON TABLAS.
 *
 *  La primera corrida contra SAP imprimio "300.594 de 403.095 (74,6%)" y ese
 *  numero no significa nada: sumaba 238.397 pallets con 164.698 tablas, tacos
 *  y varas. REDTEC fabrica sus propios semielaborados, asi que entre las
 *  ordenes de fabricacion conviven las dos cosas.
 *
 *  La regla: produce pallets la orden cuyo item es el pallet —o una variante
 *  suya, los semielaborados <item>-1 y <item>-2— o cuyo codigo nombra el
 *  pallet (REP-PAL-ROJOS, PIN-PAL-ROJOS, INSP-PAL-ROJOS). Lo demas es insumo.
 *  CONVER-PINT-ROJA convierte pintura y cae del lado correcto solo.
 *
 *  Se declara aca y se imprime en la corrida, para que se pueda discutir la
 *  regla en vez de descubrirla leyendo el codigo. */
function familiaDeItem(item, itemPallet) {
  const i = String(item == null ? '' : item).trim().toUpperCase();
  if (!i) return 'insumo';
  const pal = String(itemPallet == null ? '' : itemPallet).trim().toUpperCase();
  if (pal && (i === pal || i.indexOf(pal + '-') === 0)) return 'pallet';
  return /PAL/.test(i) ? 'pallet' : 'insumo';
}

/*  UN CODIGO USADO EN DOS PLANTAS ES UNA SENAL, no un dato curioso.
 *
 *  Una persona trabaja en una planta. Si el mismo codigo aparece produciendo
 *  en Santiago y en Talca, lo mas probable es que dos personas lo compartan
 *  —que es justo lo que pasa con los codigos de relleno— y entonces el bono
 *  de una se le suma a la otra. */
function plantaDeItem(item) {
  return /TALCA/i.test(String(item == null ? '' : item)) ? 'TALCA' : 'SANTIAGO';
}

function codigosEnDosPlantas(ordenes, nombres) {
  const nom = nombres instanceof Map ? nombres : new Map(Object.entries(nombres || {}));
  const m = new Map();
  for (const o of (ordenes || [])) {
    if (!o || o.operario == null) continue;
    const e = m.get(o.operario) || { codigo: o.operario, nombre: nom.get(o.operario) || null,
                                     SANTIAGO: 0, TALCA: 0 };
    e[plantaDeItem(o.item)] += cantidadDeOrden(o).valor;
    m.set(o.operario, e);
  }
  return [...m.values()].filter(e => e.SANTIAGO > 0 && e.TALCA > 0)
    .sort((a, b) => (b.SANTIAGO + b.TALCA) - (a.SANTIAGO + a.TALCA));
}

/** El total por familia. Cada una lleva su propia cuenta porque sus unidades
 *  no son comparables. */
function porFamilia(cobertura) {
  const m = new Map();
  for (const c of (cobertura || [])) {
    const f = c.familia || 'insumo';
    const e = m.get(f) || { familia: f, total: 0, conRut: 0, procesos: 0 };
    e.total += c.total; e.conRut += c.conRut; e.procesos++;
    m.set(f, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total ||
                                        (a.familia < b.familia ? -1 : 1));
}

/** El veredicto, POR FAMILIA. Un solo porcentaje sobre pallets mas tablas no
 *  dice nada, y el que importa para el bono es el de los pallets. */
function veredicto(cobertura, arreglar, dosPlantas, cual) {
  const fam = porFamilia(cobertura);
  const tot = fam.reduce((s, f) => s + f.total, 0);
  if (!tot) return { nivel: 'sin datos', texto: 'No hay ordenes de fabricacion en el periodo pedido.' };
  const p = [];
  for (const f of fam) {
    const malo = f.total - f.conRut;
    p.push((f.familia === 'pallet' ? 'PALLETS' : 'INSUMOS') + ': ' + mil(malo) + ' de ' + mil(f.total) +
           ' (' + pct(malo, f.total) + ') cuelga de una orden sin un RUT que identifique a una persona.');
  }
  if (dosPlantas && dosPlantas.length)
    p.push(dosPlantas.length + ' codigo(s) producen en las DOS plantas, que es la firma de un codigo ' +
           'compartido por dos personas: ' + dosPlantas.slice(0, 3).map(x => x.codigo).join(', ') + '.');
  if (cual === 'planificada')
    p.push('OJO: SAP no devolvio la cantidad COMPLETADA y se esta midiendo sobre la PLANIFICADA. ' +
           'Un bono sobre lo planificado paga por lo que se pensaba hacer.');
  // El bono de produccion se paga por pallets: ESA es la familia que manda.
  const pal = fam.find(f => f.familia === 'pallet');
  const base = pal || fam[0];
  const malo = base.total - base.conRut;
  const nivel = malo === 0 ? 'si' : (malo / base.total > 0.05 ? 'no sirve para pagar' : 'revisar');
  if (malo === 0 && fam.length === 1)
    return { nivel: 'si', texto: 'Las ' + mil(tot) + ' unidades del periodo cuelgan de un RUT valido.' };
  return { nivel, texto: p.join('  ') };
}

module.exports = { dv, partirRut, clasificarCodigo, pareceProceso, normalizarOrden, cantidadDeOrden,
                   coberturaPorProceso, codigosAArreglar, familiaDeItem, porFamilia, plantaDeItem, codigosEnDosPlantas,
                   veredicto, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────

/*  DE DONDE SALE EL NOMBRE DEL OPERARIO.
 *
 *  @HX_OPERARIOS es una tabla de USUARIO, y el Service Layer no las expone
 *  siempre con el mismo nombre segun la version. En vez de adivinar uno, se
 *  prueban los que se conocen y se DICE cual funciono. Si ninguno responde,
 *  la sonda sigue sin nombres en vez de caerse: la clasificacion de codigos
 *  no depende del nombre, solo el "esto es un turno y no una persona". */
const RUTAS_TABLA = ["U_HX_OPERARIOS", "HX_OPERARIOS", "UserTables('HX_OPERARIOS')"];

async function leerOperarios(ses, raiz, forzada) {
  const rutas = forzada ? [forzada] : RUTAS_TABLA;
  const probados = [];
  for (const r of rutas) {
    try {
      const x = await ses.get(raiz + '/' + r + '?$top=400');
      probados.push(r + ' → HTTP ' + x.status);
      if (x.status === 200 && x.json && Array.isArray(x.json.value)) {
        const m = new Map();
        for (const f of x.json.value) {
          const c = f && (f.Code != null ? f.Code : f.U_Code);
          const n = f && (f.Name != null ? f.Name : f.U_Name);
          if (c != null) m.set(String(c).trim(), n == null ? null : String(n).trim());
        }
        return { ruta: r, nombres: m, probados };
      }
    } catch (e) { probados.push(r + ' → ' + String(e && e.message || e).slice(0, 50)); }
  }
  return { ruta: null, nombres: new Map(), probados };
}

async function main() {
  const malas = args.filter(x => String(x).startsWith('--') &&
    !OPCIONES.some(o => String(x).startsWith('--' + o + '=')) && !BANDERAS.some(o => x === '--' + o));
  if (malas.length) { console.error('Opcion no reconocida: ' + malas.join('  ')); process.exit(1); }
  const falta = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', '));
    console.error('Se declaran en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const desde = opcion('desde', null), hasta = opcion('hasta', null);
  const fecha = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (!fecha(desde) || !fecha(hasta)) { console.error('Faltan --desde=YYYY-MM-DD y --hasta=YYYY-MM-DD'); process.exit(1); }
  if (desde > hasta) { console.error('--desde es posterior a --hasta'); process.exit(1); }
  const TOPE = Math.max(1, parseInt(opcion('tope', '20'), 10) || 20);
  const PAGINA = Math.max(20, Math.min(500, parseInt(opcion('pagina', '200'), 10) || 200));
  const CAMPO = opcion('campo', 'PostingDate');

  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();
  console.log('Sonda de operarios   ·  ' + desde + ' a ' + hasta);
  console.log('Raiz: ' + raiz + '   ·  base ' + process.env.SAP_DB);
  console.log('SOLO LEE. Mide si el campo de operario sirve para pagar un bono.\n');

  const op = await leerOperarios(ses, raiz, opcion('tabla', null));
  if (op.ruta) console.log('  tabla de operarios: ' + op.ruta + '   ·  ' + mil(op.nombres.size) + ' filas');
  else {
    console.log('  NO se pudo leer la tabla de operarios. Se probo: ' + op.probados.join('  ·  '));
    console.log('  Se sigue sin nombres: la validacion del codigo no los necesita.');
  }

  const ordenes = [];
  for (let skip = 0; ; skip += PAGINA) {
    const url = raiz + '/ProductionOrders?$filter=' +
      encodeURIComponent(CAMPO + " ge '" + desde + "' and " + CAMPO + " le '" + hasta + "'") +
      '&$orderby=' + encodeURIComponent('AbsoluteEntry asc') +
      '&$top=' + PAGINA + '&$skip=' + skip;
    const r = await S.conReintentos(() => ses.get(url));
    if (r.status !== 200) {
      console.error('ProductionOrders HTTP ' + r.status + ' — ' + String(r.text || '').slice(0, 200));
      process.exit(1);
    }
    const v = (r.json && r.json.value) || [];
    for (const o of v) ordenes.push(normalizarOrden(o));
    process.stdout.write('\r  ordenes leidas: ' + mil(ordenes.length));
    if (v.length < PAGINA) break;      // se avanza por lo RECIBIDO, no por lo pedido
  }
  process.stdout.write('\n');
  if (!ordenes.length) { console.log('\n  No hay ordenes en el periodo.'); return; }

  const cual = cantidadDeOrden(ordenes.find(o => cantidadDeOrden(o).cual !== 'ninguna') || {}).cual;
  const conCompletada = ordenes.filter(o => o.completada != null).length;
  const conRechazada = ordenes.filter(o => o.rechazada != null).length;
  console.log('  cantidad usada: ' + cual +
              '   ·  con completada: ' + mil(conCompletada) + '/' + mil(ordenes.length) +
              '   ·  con rechazada: ' + mil(conRechazada) + '/' + mil(ordenes.length));

  const ITEM = opcion('item', '11111111110');
  const cob = coberturaPorProceso(ordenes, op.nombres, ITEM);
  // Los pallets van primero y aparte: las tablas y los tacos se cuentan en
  // otra unidad y sumarlos da un numero que no existe.
  for (const fam of ['pallet', 'insumo']) {
    const filas = cob.filter(c => c.familia === fam);
    if (!filas.length) continue;
    console.log('\n── ' + (fam === 'pallet' ? 'PALLETS' : 'FABRICACION DE INSUMO (tablas, tacos, pintura)') +
                ' ' + '─'.repeat(Math.max(4, 58 - (fam === 'pallet' ? 7 : 46))));
    console.log('  ' + 'proceso'.padEnd(28) + 'total'.padStart(10) + 'con RUT'.padStart(11) +
                'sin oper.'.padStart(11) + 'cod. malo'.padStart(11) + 'no persona'.padStart(12));
    for (const c of filas.slice(0, TOPE))
      console.log('  ' + String(c.item).slice(0, 27).padEnd(28) + mil(c.total).padStart(10) +
                  mil(c.conRut).padStart(11) + mil(c.sinOperario).padStart(11) +
                  mil(c.codigoMalo).padStart(11) + mil(c.noPersona).padStart(12));
    const t = filas.reduce((a, c) => a + c.total, 0), r = filas.reduce((a, c) => a + c.conRut, 0);
    console.log('  ' + 'suma'.padEnd(28) + mil(t).padStart(10) + mil(r).padStart(11) +
                '   ' + pct(t - r, t) + ' sin RUT');
  }
  console.log('\n  (produce pallets la orden cuyo item es ' + ITEM + ', una variante suya, o nombra PAL)');

  const arr = codigosAArreglar(ordenes, op.nombres);
  if (arr.length) {
    console.log('\n── CODIGOS QUE HAY QUE ARREGLAR EN SAP ' + '─'.repeat(34));
    for (const a of arr.slice(0, TOPE))
      console.log('  ' + String(a.codigo).slice(0, 22).padEnd(24) +
                  String(a.nombre || '—').slice(0, 26).padEnd(28) +
                  mil(a.total).padStart(9) + '  ' + a.motivo);
    if (arr.length > TOPE) console.log('  … y ' + (arr.length - TOPE) + ' mas');
  }

  const dos = codigosEnDosPlantas(ordenes, op.nombres);
  if (dos.length) {
    console.log('\n── EL MISMO CODIGO EN LAS DOS PLANTAS ' + '─'.repeat(35));
    for (const d of dos.slice(0, TOPE))
      console.log('  ' + String(d.codigo).slice(0, 22).padEnd(24) +
                  String(d.nombre || '—').slice(0, 26).padEnd(28) +
                  'Santiago ' + mil(d.SANTIAGO).padStart(8) + '   Talca ' + mil(d.TALCA).padStart(8));
  }

  const v = veredicto(cob, arr, dos, cual);
  console.log('\n── VEREDICTO ' + '─'.repeat(59));
  console.log('  ' + v.texto);
  console.log('');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
