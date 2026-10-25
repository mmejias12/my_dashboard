// ============================================================================
//  scripts/medir-emisiones.js  ·  M3DATA
//
//  QUE MIDE Y POR QUE ES EL CONCEPTO QUE FALTABA
//  SERV-EMISIONES es la linea de mayor facturacion de la cartola y era la unica
//  que no se podia auditar: agrupa SIETE servicios distintos del contrato
//  (Emision, 24 horas, Express, LD, Recargo, Retiro, Retiro Cliente) con
//  tarifas distintas, asi que contra una sola tarifa no se podia medir.
//  Se destrabo cuando aparecio la tarifa estampada en U_HX_RD_TarifaCli.
//
//  LOS DOS LADOS
//    nuestro : documentos de emision        -> suma(cantidad x tarifa estampada)
//    la OV   : lineas SERV-EMISIONES de OV  -> suma(cantidad x precio / TC)
//
//  EL UNIVERSO SON LOS PERIODOS DE FACTURACION DE CADA CLIENTE, NO EL MES NI
//  UNA LISTA COMUN DE SEMANAS. Las dos versiones anteriores se equivocaron aca
//  y los dos errores se veian como descalce comercial sin serlo, asi que vale
//  dejarlos escritos.
//
//  PRIMER ERROR — el mes. REDTEC factura por semanas de lunes a domingo y la OV
//  se emite el lunes siguiente. La primera version tomaba la OV si su periodo
//  EMPEZABA dentro del mes:
//    · la semana 31-08..06-09 quedaba fuera (empieza en agosto) aunque seis de
//      sus dias son de septiembre, y nuestro lado SI contaba esos movimientos
//      -> clientes con nuestro lado inflado hasta un tercio;
//    · la semana 28-09..04-10 entraba completa, con cuatro dias de octubre que
//      nuestro lado no tenia -> los mismos clientes con la OV inflada ~8%.
//  Las dos cosas a la vez, cliente por cliente, y ninguna es un descalce.
//  Arreglo: el universo son los periodos que SOLAPAN el mes, no los que
//  empiezan en el. Un periodo cuyos dias no esten cubiertos por los blobs de
//  movimientos disponibles se EXCLUYE y se declara: comparar media semana
//  contra una semana completa es justamente el error de arriba.
//
//  SEGUNDO ERROR — la lista comun. Con los tres meses de movimientos quedaron
//  usables a la vez el periodo 28-09..30-09 (clientes con corte a fin de mes) y
//  el 28-09..04-10 (clientes con la semana completa). Como lista global esos dos
//  SE PISAN, y al ubicar un movimiento del 29-09 habia que elegir uno por el
//  orden del Map — o sea por nada. Medido: los movimientos del 28 al 30 se
//  fueron todos al periodo semanal, el de cierre quedo con 0 UF contra 957,47
//  UF de la OV, y el total del mes se movio 957 UF inexistentes.
//  Arreglo: el periodo es un atributo del CLIENTE. Cada movimiento se ubica en
//  los periodos de SU cliente, que no se pisan entre si. Y si los de algun
//  cliente si se pisan, eso se informa como hallazgo en vez de resolverse.
//
//  EL CRUCE ES POR CardCode. Los dos lados salen de SAP, asi que los dos traen
//  el codigo del socio de negocio. Cruzar por razon social separaba "TAK SPA"
//  de "TAK S.A." y dejaba clientes con un solo lado leidos como -100%. El
//  nombre se sigue usando para una cosa sola, donde no hay alternativa: el
//  maestro de contratos no tiene CardCode.
//
//  NO TOCA SAP: lee los blobs que escribio backfill/backfill-sap.js.
//
//  Requiere OS_STORAGE_CONN. Uso, desde la raiz del repo:
//    node scripts/medir-emisiones.js --mes=2026-09
//    node scripts/medir-emisiones.js --mes=2026-09 --fecha=U_HX_RD_FechaIngreso
//    node scripts/medir-emisiones.js --mes=2026-09 --patron=^SERV-EMI --tope=40
//    node scripts/medir-emisiones.js --mes=2026-09 --cliente=HAMBURGO
//    node scripts/medir-emisiones.js --mes=2026-09 --mantener-corte
//
//  SIRVE PARA CUALQUIER CONCEPTO, no solo emisiones: el concepto de SAP y el
//  ItemCode de la OV son parametros. --incluye suma otro TransType al mismo
//  concepto, que es como se mide si la confirmacion va junto con el movimiento:
//    node scripts/medir-emisiones.js --mes=2026-09 --concepto=TRANSFERENCIA --patron=SERV-TRANSFERENCIAS
//    node scripts/medir-emisiones.js --mes=2026-09 --concepto=TRANSFERENCIA --incluye=CONF_TRANSF --patron=SERV-TRANSFERENCIAS
//  Y --resta para el reverso. La OV de transferencias cobra TRANSFERENCIA
//  MENOS las confirmaciones, medido al pallet en septiembre:
//    node scripts/medir-emisiones.js --mes=2026-09 --concepto=TRANSFERENCIA --resta=CONF_TRANSF --patron=SERV-TRANSFERENCIAS
//  Y --resta-si para restar solo parte: la confirmacion viene en dos
//  direcciones y solo la de retorno parece netear.
//    ... --resta=CONF_TRANSF --resta-si=FromWarehouse=RETAIL
//  Y --por-tarifa cuando, ya aplicada la regla, queda un residuo: desglosa
//  nuestro neto por tarifa dentro de cada semana y busca que combinacion de
//  signos reproduce la OV. Es lo que mostro que en QUINTA la OV cobraba el
//  valor absoluto del credito en vez de abonarlo.
//    ... --resta=CONF_TRANSF --resta-si=FromWarehouse=RETAIL --por-tarifa
//  Dos OV para el mismo cliente y el mismo periodo se declaran y se sacan del
//  universo; con --mantener-duplicadas se vuelven a sumar como antes.
// ============================================================================
'use strict';

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args   = process.argv.slice(2);
/** Lee una opcion de una lista de argumentos. PURA y exportada a proposito: el
 *  parser se equivoco dos veces y las dos pasaron inadvertidas porque leia
 *  process.argv directo y no habia forma de probarlo.
 *  El valor es TODO lo que viene despues del PRIMER '='. Con split('=')[1] una
 *  opcion cuyo valor contiene '=' se truncaba: --resta-si=FromWarehouse=RETAIL
 *  devolvia 'FromWarehouse' y la condicion quedaba en null, en silencio. */
function leerOpcion(lista, n, def) {
  const a = (lista || []).find(x => String(x).startsWith('--' + n + '='));
  return a ? a.slice(a.indexOf('=') + 1) : def;
}

/** ¿Vino la bandera, con valor o sin el? */
function estaPresente(lista, n) {
  return (lista || []).some(x => x === '--' + n || String(x).startsWith('--' + n + '='));
}

const opcion = (n, def) => leerOpcion(args, n, def);
const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);

/** Opciones que EXIGEN valor, y banderas que no lo llevan. La distincion no es
 *  cosmetica: '--mes' suelto, sin '=2026-09', caia al default en silencio y la
 *  corrida medía otro mes del que se pidio. */
const OPCIONES = ['mes', 'fecha', 'patron', 'concepto', 'incluye', 'resta', 'resta-si',
                  'tope', 'cliente'];
const BANDERAS = ['mantener-corte', 'mantener-duplicadas', 'por-tarifa'];



/** Opciones que el script NO entiende.
 *
 *  POR QUE ESTA GUARDIA. Dos corridas seguidas se perdieron argumentos sin que
 *  nada avisara: una porque el shell se comio la linea, otra porque opcion()
 *  truncaba el valor en el primer '='. Las dos veces el script corrio igual,
 *  con el comportamiento por defecto, y el resultado parecia un hallazgo.
 *  Una opcion que no se entiende tiene que DETENER la corrida, no ignorarse. */
function opcionesDesconocidas(lista, conValor, banderas) {
  const v = conValor || OPCIONES, b = banderas || BANDERAS;
  return (lista || []).filter(x => String(x).startsWith('--') &&
    !v.some(o => String(x).startsWith('--' + o + '=')) &&
    !b.some(o => x === '--' + o || String(x).startsWith('--' + o + '=')));
}

const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const uf5 = n => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 5, maximumFractionDigits: 5 });

// ── fechas y meses ──────────────────────────────────────────────────────────

const iso = s => {
  if (!s) return null;
  const t = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(t);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
};

function mesSiguiente(mes) {
  let [a, m] = mes.split('-').map(Number);
  m++; if (m > 12) { m = 1; a++; }
  return a + '-' + String(m).padStart(2, '0');
}
function mesAnterior(mes) {
  let [a, m] = mes.split('-').map(Number);
  m--; if (m < 1) { m = 12; a--; }
  return a + '-' + String(m).padStart(2, '0');
}
function finDeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return mes + '-' + String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0');
}
/** Los meses que toca un rango de fechas, inclusive. Sirve para saber que
 *  blobs de movimientos hacen falta para cubrir un periodo completo. */
function mesesEntre(desde, hasta) {
  const out = [];
  let m = desde.slice(0, 7);
  const fin = hasta.slice(0, 7);
  for (let i = 0; i < 480; i++) { out.push(m); if (m === fin) break; m = mesSiguiente(m); }
  return out;
}

// ── helpers puros ───────────────────────────────────────────────────────────

/** Normaliza la razon social. Solo para cruzar con el maestro de contratos,
 *  que no trae CardCode; el cruce entre los dos lados va por CardCode. */
function norm(s) {
  s = String(s == null ? '' : s).toUpperCase().trim();
  s = s.replace(/[.,]+$/, '').replace(/\s+/g, ' ');
  s = s.replace(/S\.A\.C/g, 'SAC').replace(/S\.A/g, 'SA')
       .replace(/S\.P\.A/g, 'SPA').replace(/SPA\./g, 'SPA');
  return s.replace(/[^A-Z0-9 ]/g, '');
}

/** El TC (valor de la UF del periodo) viaja como TEXTO en el Comments de la OV:
 *  "FACTURACION SEMANA N DESDE dd-mm-aaaa HASTA dd-mm-aaaa TC: nnnnn,nn".
 *  Sin el TC no se puede llevar el monto en pesos de la OV a UF, que es la
 *  unidad en que estan las tarifas de contrato.
 *
 *  CUIDADO CON EL SEPARADOR. La primera version alternaba patrones y con
 *  "39,123.45" capturaba solo "39,123", devolviendo 39,123 en vez de
 *  39.123,45: un error de mil veces que no revienta, solo deja el lado de la
 *  OV mil veces mas grande. La regla sin ambiguedad es que el separador que
 *  aparece ULTIMO es el decimal y el otro es de miles; con un solo tipo de
 *  separador decide la cantidad de digitos que lo siguen (tres son miles).
 *  La plausibilidad NO se juzga aca: quien decide si un TC sirve es agregarOV,
 *  contra TC_MIN. */
function parseTC(comments) {
  const m = /TC\s*:?\s*(\d[\d.,]*)/i.exec(String(comments || ''));
  if (!m) return null;
  let s = m[1].replace(/[.,]+$/, '');
  const ic = s.lastIndexOf(','), ip = s.lastIndexOf('.');
  if (ic >= 0 && ip >= 0) {
    s = ic > ip ? s.replace(/\./g, '').replace(',', '.')   // 39.123,45
                : s.replace(/,/g, '');                      // 39,123.45
  } else if (ic >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=[^,]*$)/, '#').replace(/,/g, '').replace('#', '.')
                            : s.replace(/,/g, '');
  } else if (ip >= 0) {
    s = /\.\d{1,2}$/.test(s) ? s.replace(/\.(?=[^.]*$)/, '#').replace(/\./g, '').replace('#', '.')
                             : s.replace(/\./g, '');
  }
  const v = parseFloat(s);
  return isFinite(v) && v > 0 ? v : null;
}

/** Piso de plausibilidad del TC. La UF nunca ha valido menos de mil pesos y
 *  solo sube, asi que un TC bajo este piso no es un TC: es un separador mal
 *  leido o basura en el Comments. Se descarta y se declara, no se usa. */
const TC_MIN = 1000;

/** El periodo que cobra la OV. Primero los campos de usuario; si no estan, se
 *  saca del texto del Comments, donde tambien figura.
 *
 *  NO SE ASUME EL NOMBRE DEL CAMPO: se busca por FORMA y el nombre encontrado
 *  va en el origen. Asi la corrida lo deja escrito en vez de que un nombre
 *  inventado haga pasar inadvertido el campo real y todo caiga al Comments.
 *  (Medido en septiembre: los 470 documentos traen U_HX_PeriodoDesde y
 *  U_HX_PeriodoHasta, asi que el Comments quedo como respaldo.) */
const reDesde = /^U_.*(?:PERIODO|FECHA).*(?:DESDE|INI)/i;
const reHasta = /^U_.*(?:PERIODO|FECHA).*(?:HASTA|FIN|TERM)/i;

function parsePeriodo(doc) {
  let kd = null, kh = null;
  for (const k of Object.keys(doc)) {
    if (!kd && reDesde.test(k) && iso(doc[k])) kd = k;
    if (!kh && reHasta.test(k) && iso(doc[k])) kh = k;
  }
  if (kd && kh) return { desde: iso(doc[kd]), hasta: iso(doc[kh]), origen: kd + '/' + kh };
  const m = /DESDE\s+(\d{2}-\d{2}-\d{4}).{0,12}?HASTA\s+(\d{2}-\d{2}-\d{4})/i.exec(String(doc.Comments || ''));
  if (m) return { desde: iso(m[1]), hasta: iso(m[2]), origen: 'Comments' };
  return { desde: null, hasta: null, origen: 'no encontrado' };
}

const clave = p => p.desde + '..' + p.hasta;

const VARIANTES = ['Emision', 'Emision 24 horas', 'Emision Express', 'Emision LD',
                   'Emision Recargo', 'Emision Retiro', 'Emision Retiro Cliente'];

function cerca(a, b, tol) {
  tol = tol === undefined ? 0.005 : tol;
  if (a == null || b == null) return false;
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= tol;
}

/** TODAS las variantes del contrato que calzan con esta tarifa. Importa que
 *  devuelva la lista y no la primera: hay contratos con dos servicios de
 *  emision al mismo precio, y ahi la tarifa NO identifica el servicio. Eso se
 *  declara, no se resuelve por el orden en que estan escritas en VARIANTES.
 *  No afecta el MONTO — la tarifa es la tarifa — solo el desglose por nombre. */
function variantes(tarifa, tarifasCliente, servicios) {
  if (!tarifasCliente) return [];
  return (servicios || VARIANTES).filter(v => cerca(tarifa, tarifasCliente[v]));
}
function variante(tarifa, tarifasCliente, servicios) {
  const vs = variantes(tarifa, tarifasCliente, servicios);
  return vs.length ? vs[0] : null;
}

/** Los servicios de contrato que puede tener un concepto de SAP.
 *  EMISION es el unico que agrupa varios, y por eso tiene su lista escrita.
 *  Para el resto sale del mapa _equivalencias_sap del maestro de tarifas, que
 *  es donde quedo anotada la correspondencia: "CONF_TRANSF" -> "Transferencias
 *  | Trans Diferenciada  (hereda la del movimiento que vuelve)". Se corta en
 *  el parentesis porque eso es comentario, no un nombre de servicio. */
function serviciosDe(concepto, equivalencias) {
  if (String(concepto).toUpperCase() === 'EMISION') return VARIANTES;
  const e = equivalencias && equivalencias[concepto];
  if (!e) return [];
  return String(e).split('(')[0].split('|').map(x => x.trim()).filter(Boolean);
}

// ── seleccion del universo ──────────────────────────────────────────────────

/** Los periodos de facturacion con que se va a comparar, POR CLIENTE.
 *
 *  POR QUE POR CLIENTE Y NO UNA LISTA GLOBAL. Esto lo hice mal una vez y el
 *  error vale dejarlo escrito. REDTEC no corta todas las semanas igual: al
 *  cierre de mes algunos clientes reciben una OV del 28-09 al 30-09 y otros una
 *  del 28-09 al 04-10. Como lista global esos dos periodos SE PISAN, y al
 *  ubicar un movimiento del 29-09 habia que elegir uno de los dos por el orden
 *  del Map — o sea por nada. Resultado medido: los movimientos del 28 al 30 se
 *  fueron todos al periodo semanal, el periodo de cierre quedo con 0 UF de
 *  nuestro lado contra 957,47 UF de la OV, y el total del mes se movio 957 UF
 *  que no existen.
 *  El periodo es un atributo del CLIENTE: cada uno tiene los suyos y los de un
 *  mismo cliente no se pisan. Asi la ubicacion de un movimiento es unica. Y si
 *  los de algun cliente SI se pisan, eso ya no es una ambiguedad que haya que
 *  resolver — es un hallazgo (dias facturados dos veces) y se informa.
 *
 *  Entra: los documentos de OV, el mes pedido, y los meses de movimientos que
 *  SI estan en el storage. Sale, por cliente, sus periodos que solapan el mes,
 *  separados en usables (todos sus dias cubiertos por movimientos) y excluidos,
 *  con el motivo escrito. */
/** EL RANGO QUE DEFINE EL UNIVERSO. Acepta un mes solo —como siempre— o
 *  varios: '2026-09', '2026-07,2026-10' o ['2026-07','2026-10'].
 *
 *  Con varios es un RANGO CONTINUO del primer dia del mes menor al ultimo
 *  del mes mayor, no un conjunto: '2026-07,2026-09' incluye agosto. Se dice
 *  aca porque es lo contrario de lo que sugiere la coma, y alguien que
 *  quiera saltearse un mes tiene que saber que esto no lo hace.
 *
 *  El orden en que vengan no importa. Lo que no parece un mes se ignora, y
 *  si no queda ninguno no hay rango: eso es distinto de un rango vacio. */
function rangoDeMeses(mes) {
  // Un arreglo no necesita rama propia: String(['2026-07','2026-10']) ya da
  // '2026-07,2026-10' y el split lo vuelve a partir igual. Tenia una y se
  // saco, porque ninguna entrada podia recorrerla sola.
  const ms = String(mes == null ? '' : mes).split(',')
    .map(x => String(x).trim()).filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
  if (!ms.length) return null;
  return { ini: ms[0] + '-01', fin: finDeMes(ms[ms.length - 1]), meses: ms };
}

function periodosPorCliente(docs, mes, mesesConMovimientos) {
  const r = rangoDeMeses(mes);
  if (!r) return { porCliente: new Map(), origenPeriodo: new Map(), sinPeriodo: 0, noSolapan: 0 };
  const ini = r.ini, fin = r.fin;
  const hay = new Set(mesesConMovimientos || []);
  const porCliente = new Map(), origenPeriodo = new Map();
  let sinPeriodo = 0, noSolapan = 0;

  for (const d of docs) {
    const p = parsePeriodo(d);
    origenPeriodo.set(p.origen, (origenPeriodo.get(p.origen) || 0) + 1);
    if (!p.desde || !p.hasta) { sinPeriodo++; continue; }
    // solapa el mes si empieza antes del fin del mes y termina despues del inicio
    if (!(p.desde <= fin && p.hasta >= ini)) { noSolapan++; continue; }
    const cod = String(d.CardCode || '(sin CardCode)').trim();
    let c = porCliente.get(cod);
    if (!c) { c = { usables: new Map(), excluidos: new Map() }; porCliente.set(cod, c); }
    const k = clave(p);
    const faltan = mesesEntre(p.desde, p.hasta).filter(m => !hay.has(m));
    const destino = faltan.length ? c.excluidos : c.usables;
    let e = destino.get(k);
    if (!e) { e = { desde: p.desde, hasta: p.hasta, ovs: 0, falta: faltan.join(', ') }; destino.set(k, e); }
    e.ovs++;
  }
  return { porCliente, origenPeriodo, sinPeriodo, noSolapan };
}

/** Descarta las OV de CIERRE CONTABLE INTERNO.
 *
 *  Cuando un cliente tiene dos periodos que se pisan, el corto es un corte de
 *  cierre de mes que REDTEC emite para cerrar septiembre y que NO se factura.
 *  Esto no es una suposicion de conveniencia: medido con el enlace BaseEntry de
 *  las lineas de factura, 27 de 27 de esas OV no llegaron a factura — 957,46891
 *  UF ordenados, 0,00000 facturados (ver scripts/medir-facturacion.js).
 *
 *  Dejarlas adentro era lo que ensuciaba toda la comparacion: de 29 clientes
 *  descuadrados, 21 tenian como UNICA diferencia exactamente el monto de su
 *  propia OV de cierre. Sacandolas, esos 21 calzan y el descalce real queda
 *  concentrado en los 8 que sobran.
 *
 *  Se descarta el periodo mas corto de cada par que se pisa, y se devuelve lo
 *  descartado para poder mostrarlo: un filtro silencioso seria peor que el
 *  problema que arregla. */
function resolverCortes(porCliente) {
  const cortes = [];
  for (const [cod, c] of porCliente) {
    const dias = p => Date.parse(p.hasta) - Date.parse(p.desde);
    // de mayor a menor duracion: se conserva el periodo largo
    const ps = [...c.usables.entries()].sort((a, b) => dias(b[1]) - dias(a[1]));
    const quedan = [];
    for (const [k, p] of ps) {
      // CONTENCION, no solape. El corte de cierre esta DENTRO de la semana
      // (28-09..30-09 dentro de 28-09..04-10). Con solape simple bastaria que
      // dos semanas consecutivas compartieran un dia para descartar una semana
      // legitima, y eso es peor que el problema: esos casos tienen que seguir
      // apareciendo como solape para que alguien los mire.
      const choca = quedan.find(([, q]) => p.desde >= q.desde && p.hasta <= q.hasta);
      if (choca) {
        cortes.push({ cod, descartado: k, aFavorDe: choca[0], ovs: p.ovs });
        c.usables.delete(k);
      } else quedan.push([k, p]);
    }
  }
  return cortes;
}

/** DOS OV para el mismo cliente y el MISMO periodo.
 *
 *  POR QUE EXISTE. resolverCortes resuelve el caso en que un periodo esta
 *  CONTENIDO en otro. Dos OV con el periodo identico no estan en relacion de
 *  contencion: caen en la misma clave y sus lineas se suman, asi que el lado OV
 *  queda al doble y la diferencia parece un hallazgo enorme. Paso en agosto:
 *  116 OV para 58 clientes en la semana del 27-07, 141 para 59 en la del 24-08,
 *  cada segunda OV exactamente en DocNum + 58, y 29 de 29 clientes con la OV al
 *  doble de los movimientos al pallet. La corrida informaba 1.223,79 UF de
 *  diferencia y 1.209,79 eran eso.
 *
 *  QUE HACE. No elige cual es la buena, porque no hay con que decidirlo: saca
 *  del universo ese (cliente, periodo) y lo devuelve para que se muestre. Medir
 *  contra una OV elegida al azar seria inventar, y sumarlas es lo que ya falla.
 *
 *  MUTA porCliente —borra el periodo de usables— igual que resolverCortes. */
/** B1 dice que si de varias formas segun el dialecto: 'tYES', true, 'Y'. El
 *  booleano no necesita rama propia: String(true) ya da 'TRUE'. La
 *  comparacion es por IGUALDAD y no por "contiene": buscar la letra Y adentro
 *  daria que si a cualquier valor inesperado que la lleve. */
function esSi(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'TYES' || s === 'Y' || s === 'YES' || s === 'TRUE';
}

/** El estado de una OV con los nombres que usa B1.
 *
 *  'sabeAnulada' NO es decoracion. Si el blob no trajo ni Cancelled ni
 *  CancelStatus, que el documento no este anulado y que no sepamos si lo esta
 *  son cosas distintas, y tratarlas igual seria decidir por el que lee. */
function estadoDoc(d) {
  const sabeAnulada = !!(d && (d.Cancelled !== undefined || d.CancelStatus !== undefined));
  const anulada = !!(d && (esSi(d.Cancelled) ||
                     /^cs_?cancelled$/i.test(String(d.CancelStatus || '').trim())));
  const st = String((d && d.DocumentStatus) || '').trim();
  const cerrada = /^bost_Close$/i.test(st);
  const abierta = /^bost_Open$/i.test(st);
  return { docNum: d ? d.DocNum : null, anulada, cerrada, abierta, sabeAnulada,
           sabeEstado: cerrada || abierta, total: d ? Number(d.DocTotal) : null };
}

/** SACA LAS OV ANULADAS. Hasta el 24-10 nadie las filtraba, y eran 198 de
 *  1.136 documentos. Las de las dos semanas de reemision quedaban afuera por
 *  duplicadas y las del corte de cierre por contenidas, asi que no ensuciaron
 *  nada; pero descartar la celda entera por duplicada cuando una de las dos
 *  OV esta anulada es perder 117 celdas buenas. Filtrando primero, la celda
 *  queda con UNA sola OV y vuelve a la comparacion.
 *
 *  Las que NO traen el campo se CONSERVAN y se cuentan aparte: no saber si
 *  esta anulada no es lo mismo que saber que lo esta, y botarlas por las
 *  dudas seria perder facturacion real. Si 'ciegas' no da cero, ese blob se
 *  escribio con una version de backfill-sap.js que no pedia Cancelled y hay
 *  que reextraerlo con --forzar.
 *
 *  Devuelve las dos listas y no solo las vivas, por lo mismo que
 *  resolverCortes devuelve lo descartado: un filtro silencioso es peor que
 *  el problema que arregla. */
function filtrarAnuladas(docsOV) {
  const vivas = [], anuladas = [];
  let ciegas = 0;
  for (const d of (docsOV || [])) {
    if (!d) continue;
    const e = estadoDoc(d);
    if (!e.sabeAnulada) ciegas++;
    if (e.anulada) anuladas.push(d); else vivas.push(d);
  }
  return { vivas, anuladas, ciegas };
}

/** El informe del filtro, como lista de lineas para poder probarlo. */
function informeAnuladas(r, tope) {
  const out = [];
  if (!r) return out;
  const n = (r.anuladas || []).length, t = tope === undefined ? 12 : tope;
  if (n) {
    out.push('  OV anuladas descartadas: ' + n + '   (no cobran, y dejarlas adentro hacia');
    out.push('  que su celda se descartara por duplicada)');
    const nums = r.anuladas.slice(0, t).map(d => d && d.DocNum).filter(x => x != null);
    if (nums.length) out.push('     ' + nums.join(' ') + (n > t ? '  ... y ' + (n - t) + ' mas' : ''));
  }
  if (r.ciegas)
    out.push('  OJO: ' + r.ciegas + ' OV no traen el campo de anulacion y se conservan. Ese blob ' +
             'se extrajo con una version vieja: reextraer con --entidad=Orders --forzar.');
  return out;
}

function resolverDuplicadas(docsOV, porCliente) {
  const vistas = new Map();            // cod|periodo -> [DocNum]
  for (const d of docsOV) {
    const cod = String(d.CardCode || '').trim();
    const c = porCliente.get(cod);
    if (!c) continue;
    const p = parsePeriodo(d);
    if (!p.desde) continue;
    const kp = clave(p);
    if (!c.usables.has(kp)) continue;
    const k = cod + '|' + kp;
    const a = vistas.get(k) || [];
    a.push(d.DocNum);
    vistas.set(k, a);
  }
  const dup = [];
  for (const [k, docs] of vistas) {
    if (docs.length < 2) continue;
    const i = k.indexOf('|');
    const cod = k.slice(0, i), periodo = k.slice(i + 1);
    dup.push({ cod, periodo, n: docs.length,
               docNums: docs.slice().sort((a, b) => Number(a) - Number(b)) });
    porCliente.get(cod).usables.delete(periodo);
  }
  return dup.sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)) ||
                            String(a.cod).localeCompare(String(b.cod)));
}

/** El informe de OV duplicadas, como lista de lineas. Texto en vez de
 *  console.log para poder probarlo sin tocar produccion. */
function informeDuplicadas(dup, tope) {
  if (!dup || !dup.length) return [];
  const T = Math.max(1, tope || 25);
  const porPeriodo = new Map(), clientes = new Set();
  for (const d of dup) {
    const e = porPeriodo.get(d.periodo) || { celdas: 0, docs: 0 };
    e.celdas++; e.docs += d.n; porPeriodo.set(d.periodo, e);
    clientes.add(d.cod);
  }
  const L = ['', '  OV DUPLICADAS · MISMO CLIENTE Y MISMO PERIODO: ' + dup.length +
    ' celdas · ' + clientes.size + ' clientes'];
  for (const [p, e] of [...porPeriodo].sort())
    L.push('    ' + p + '   ' + String(e.celdas).padStart(4) + ' clientes con mas de una OV   ' +
           String(e.docs).padStart(4) + ' OV en total');
  L.push('  Esos (cliente, periodo) quedan FUERA de la comparacion: sumar las dos OV deja el lado');
  L.push('  OV al doble, y elegir una no se puede decidir con los datos. El total de abajo NO');
  L.push('  cubre esas semanas. Con --mantener-duplicadas se vuelve al comportamiento anterior.');
  for (const d of dup.slice(0, T))
    L.push('    ' + String(d.cod).padEnd(14) + String(d.periodo).padEnd(26) +
           d.n + ' OV: ' + d.docNums.join(', '));
  if (dup.length > T) L.push('    ... y ' + (dup.length - T) + ' celdas mas');
  return L;
}

/** Clientes con periodos propios que se pisan: dias que su facturacion cubre
 *  dos veces. No es un problema de este script — es algo que hay que mirar. */
function solapes(porCliente) {
  const out = [];
  for (const [cod, c] of porCliente) {
    const ps = [...c.usables.values()].sort((a, b) => a.desde.localeCompare(b.desde));
    for (let i = 1; i < ps.length; i++)
      if (ps[i].desde <= ps[i - 1].hasta)
        out.push({ cod, a: clave(ps[i - 1]), b: clave(ps[i]) });
  }
  return out;
}

/** Vista agregada de los periodos, solo para mostrarlos: cuantas OV y cuantos
 *  clientes usan cada uno. */
function vistaGlobal(porCliente) {
  const usables = new Map(), excluidos = new Map();
  for (const [cod, c] of porCliente) {
    for (const [k, p] of c.usables) {
      const e = usables.get(k) || { desde: p.desde, hasta: p.hasta, ovs: 0, clientes: 0, falta: '' };
      e.ovs += p.ovs; e.clientes++; usables.set(k, e);
    }
    for (const [k, p] of c.excluidos) {
      const e = excluidos.get(k) || { desde: p.desde, hasta: p.hasta, ovs: 0, clientes: 0, falta: p.falta };
      e.ovs += p.ovs; e.clientes++; excluidos.set(k, e);
    }
  }
  return { usables, excluidos };
}

/** TODOS los periodos usables en que cae una fecha.
 *
 *  Devuelve lista y no uno solo porque medido en septiembre 58 clientes tienen
 *  DOS OV que cubren los dias 28, 29 y 30: una del 28-09 al 30-09 y otra del
 *  28-09 al 04-10. O sea el solape no esta entre clientes — esta DENTRO de cada
 *  cliente, y por lo tanto no se deshace separando por cliente. Elegir uno de
 *  los dos es lo que hizo aparecer 957 UF inexistentes. Aca no se elige: se
 *  informa que la fecha cae en dos, el movimiento se cuenta UNA vez en el total
 *  del cliente, y en la tabla por periodo va a un casillero aparte. */
function periodosDe(fecha, usables) {
  const out = [];
  if (!fecha) return out;
  for (const [k, p] of usables) if (fecha >= p.desde && fecha <= p.hasta) out.push(k);
  return out;
}

/** El primer periodo que contiene la fecha. Solo para mostrar y para contar
 *  dentro/fuera; la agregacion usa periodosDe y nunca elige. */
function periodoDe(fecha, usables) {
  const ps = periodosDe(fecha, usables);
  return ps.length ? ps[0] : null;
}

/** Casillero de la tabla por periodo para los dias que dos OV del mismo
 *  cliente cubren a la vez. */
const AMBIGUO = '(dias cubiertos por 2 OV)';

/** Sonda: cual de los campos de fecha de los movimientos es el que usa la
 *  facturacion. No se adivina — se cuenta cuantas filas de emision caen dentro
 *  de los periodos DE SU PROPIO CLIENTE con cada campo candidato, y el que mas
 *  calce es el que la facturacion esta usando. */
function sondaFechas(filas, porCliente) {
  const cand = new Set(['DocDate', 'TaxDate']);
  for (const f of filas.slice(0, 50))
    for (const k of Object.keys(f)) if (/^U_.*FECHA/i.test(k)) cand.add(k);
  const out = new Map();
  for (const k of cand) {
    const e = { dentro: 0, fuera: 0, nulos: 0, sinOV: 0 };
    for (const f of filas) {
      const c = porCliente.get(String(f.CardCode || '').trim());
      if (!c) { e.sinOV++; continue; }
      const d = iso(f[k]);
      if (!d) e.nulos++;
      else if (periodosDe(d, c.usables).length) e.dentro++;
      else e.fuera++;
    }
    out.set(k, e);
  }
  return out;
}

// ── estado del documento ────────────────────────────────────────────────────

/** Una diferencia a favor nuestro admite dos lecturas opuestas: o la OV no
 *  cobro un movimiento que existe, o nosotros estamos contando un movimiento
 *  que no correspondia cobrar (anulado, cerrado, reversado). Antes de llamarle
 *  subfacturacion hay que descartar la segunda, y para eso se mira el estado
 *  del documento. Si el extractor no trajo ningun campo de estado, se dice —
 *  que es distinto de que todos los documentos esten vigentes. */
const CAMPOS_ESTADO = ['DocumentStatus', 'Cancelled', 'CancelStatus'];
function estadoDe(f) {
  const p = CAMPOS_ESTADO.filter(k => f[k] != null && f[k] !== '').map(k => k + '=' + f[k]);
  return p.length ? p.join(' ') : '(sin campo de estado)';
}

// ── los dos lados ───────────────────────────────────────────────────────────

/** Nuestro lado: los documentos de emision que caen en los periodos usables,
 *  valorizados con la tarifa que SAP trae estampada en cada uno. */
function agregarNuestro(filas, maestro, periodos, campoFecha, opt) {
  // El concepto es un parametro: la maquinaria no tiene nada propio de las
  // emisiones. `conceptos` admite varios para poder sumar un movimiento y su
  // confirmacion en el mismo concepto, que es la pregunta abierta de
  // TRANSFERENCIA. Por defecto se comporta igual que antes.
  const o = opt || {};
  const quiero = new Set((o.conceptos && o.conceptos.length ? o.conceptos : ['EMISION'])
    .map(x => String(x).toUpperCase().trim()));
  // Conceptos que se RESTAN. Medido sobre septiembre: la OV de transferencias
  // cobra TRANSFERENCIA menos CONF_TRANSF. En PUNTO AZUL las cinco semanas
  // calzan al pallet (2.304/2.305, 2.364, 1.768, 2.698, 1.750) y el delta que
  // informaba la corrida sin resta era identico a la cantidad de
  // confirmaciones. Sumarlas con --incluye empeoraba la diferencia de -12,9%
  // a -33,4%: la confirmacion no es una transferencia mas, es su reverso.
  const resta = new Set((o.resta || []).map(x => String(x).toUpperCase().trim()));
  // CONDICION SOBRE LO QUE SE RESTA. Medido con sonda-confirmaciones.js:
  // CONF_TRANSF viene en DOS direcciones — 23.363 pallets RETAIL->CLIENTES, que
  // son retornos, y 10.570 CLIENTES->RETAIL, que van en la misma direccion que
  // un movimiento. Restar las dos es lo que dejaba nueve clientes con cantidad
  // facturable negativa. La condicion permite restar solo las que cumplen algo,
  // y lo omitido se cuenta para que no desaparezca en silencio.
  const si = o.restaSi || null;   // { campo, valor }
  const cumple = f => !si || String(f[si.campo] == null ? '' : f[si.campo]).toUpperCase().trim()
                              === String(si.valor).toUpperCase().trim();
  const servicios = o.servicios || VARIANTES;
  const porCliente = new Map(), porVariante = new Map(), porPeriodo = new Map();
  let sinMaestro = 0, sinVariante = 0, sinTarifa = 0, cantSinTarifa = 0,
      ambiguas = 0, fueraDeUniverso = 0, sinFecha = 0, sinOV = 0, dobleCobertura = 0,
      restaOmitida = 0;

  for (const f of filas) {
    const tipo = String(f.U_HX_RD_TransType || '').toUpperCase().trim();
    const esResta = resta.has(tipo);
    if (!quiero.has(tipo) && !esResta) continue;
    if (esResta && !cumple(f)) { restaOmitida++; continue; }
    const signo = esResta ? -1 : 1;
    const cod = String(f.CardCode || '(sin CardCode)').trim();
    // Cada movimiento se ubica en los periodos de SU cliente, no en una lista
    // comun: dos clientes pueden tener cortes distintos para la misma semana.
    const c = periodos.get(cod);
    if (!c) { sinOV++; continue; }
    const fecha = iso(f[campoFecha]);
    if (!fecha) { sinFecha++; continue; }
    const kps = periodosDe(fecha, c.usables);
    if (!kps.length) { fueraDeUniverso++; continue; }
    // El movimiento se cuenta UNA vez pase lo que pase. Si su fecha cae en dos
    // periodos del cliente, no se reparte ni se elige: va al casillero aparte.
    if (kps.length > 1) dobleCobertura++;
    const kp = kps.length === 1 ? kps[0] : AMBIGUO;

    const nom = String(f.CardName || '').trim();
    const cant = (Number(f.Quantity) || 0) * signo;
    // Una tarifa no numerica (un "N/A" tipeado en el UDF) daria NaN, y un solo
    // NaN deja el TOTAL del mes en NaN sin que nada reviente. Se trata igual
    // que una tarifa ausente: cantidad si, cero UF, y contada aparte.
    const crudo = f.U_HX_RD_TarifaCli == null ? null : Number(f.U_HX_RD_TarifaCli);
    const tar = (crudo == null || !isFinite(crudo)) ? null : crudo;
    if (tar == null) { sinTarifa++; cantSinTarifa += cant; }

    const tc = maestro[norm(nom)];
    if (!tc) sinMaestro++;
    const vs = variantes(tar, tc && tc.tarifas, servicios);
    if (vs.length > 1) ambiguas++;
    const v = vs.length ? vs[0] : null;
    if (!v) sinVariante++;
    const ufFila = tar == null ? 0 : cant * tar;

    let r = porCliente.get(cod);
    if (!r) { r = { nom, cod, cant: 0, uf: 0, filas: 0, variantes: new Map(), estados: new Map(), periodos: new Map() }; porCliente.set(cod, r); }
    r.cant += cant; r.uf += ufFila; r.filas++;
    // por (cliente, periodo): es lo que permite senalar LA SEMANA en que un
    // cliente se descuadra, en vez de dejar un total mensual sin direccion
    const rp = r.periodos.get(kp) || { cant: 0, uf: 0, filas: 0, tarifas: new Map() };
    rp.cant += cant; rp.uf += ufFila; rp.filas++;
    // Desglose por (TARIFA, CONCEPTO) dentro del periodo.
    //
    // Tiene que ser por los dos, no solo por tarifa. En QUINTA el movimiento y
    // su confirmacion comparten la tarifa 0,053: sumados dan +121 y la OV cobro
    // 566, que no sale de ninguna combinacion de signos sobre ese 121. Con los
    // dos conceptos separados —+354 y −233— si sale, y es la unica que sale.
    // Agregar antes de tiempo destruye justo la informacion que hace falta.
    const kt = (tar == null ? '(sin tarifa)' : String(tar)) + ' ' + tipo;
    const tt = rp.tarifas.get(kt) || { clave: kt, tarifa: tar, concepto: tipo, cant: 0, uf: 0, filas: 0 };
    tt.cant += cant; tt.uf += ufFila; tt.filas++;
    rp.tarifas.set(kt, tt);
    r.periodos.set(kp, rp);
    const es = estadoDe(f);
    const ee = r.estados.get(es) || { cant: 0, uf: 0, filas: 0 };
    ee.cant += cant; ee.uf += ufFila; ee.filas++;
    r.estados.set(es, ee);
    const kv = v || ('(sin variante ' + tar + ')');
    r.variantes.set(kv, (r.variantes.get(kv) || 0) + cant);

    const g = porVariante.get(kv) || { cant: 0, uf: 0, filas: 0 };
    g.cant += cant; g.uf += ufFila; g.filas++;
    porVariante.set(kv, g);

    const q = porPeriodo.get(kp) || { cant: 0, uf: 0, filas: 0 };
    q.cant += cant; q.uf += ufFila; q.filas++;
    porPeriodo.set(kp, q);
  }
  return { porCliente, porVariante, porPeriodo, sinMaestro, sinVariante,
           sinTarifa, cantSinTarifa, ambiguas, fueraDeUniverso, sinFecha, sinOV,
           dobleCobertura, restaOmitida };
}

/** El lado de la OV: las lineas de emision de los periodos usables, llevadas a
 *  UF con el TC del Comments. Inventaria TODOS los ItemCode que ve, de todos
 *  los documentos, para que el diagnostico muestre el catalogo completo. */
function agregarOV(docs, periodos, patron) {
  const re = patron || /EMISION/i;
  const porCliente = new Map(), porPeriodo = new Map(), itemCodes = new Map();
  let sinTC = 0, tcDudoso = 0, fueraDeUniverso = 0, usadas = 0, enUF = 0;

  for (const d of docs) {
    const lineas = d._lineas || [];
    for (const l of lineas) {
      const ic = String(l.ItemCode || '(sin ItemCode)').trim();
      const e = itemCodes.get(ic) || { filas: 0, cant: 0 };
      e.filas++; e.cant += Number(l.Quantity) || 0;
      itemCodes.set(ic, e);
    }
    const cod = String(d.CardCode || '(sin CardCode)').trim();
    const c = periodos.get(cod);
    const p = parsePeriodo(d);
    const kp = p.desde ? clave(p) : null;
    if (!kp || !c || !c.usables.has(kp)) { fueraDeUniverso++; continue; }

    // Si la OV YA esta en UF no hay nada que convertir, y dividir por el TC
    // dejaria el monto cuarenta mil veces chico. Es la unica razon por la que
    // el TC puede faltar sin que la OV sea inservible.
    const esUF = /^UF$/i.test(String(d.DocCurrency || d.DocCur || '').trim());
    const tcLeido = parseTC(d.Comments);
    const tc = esUF ? 1 : (tcLeido != null && tcLeido >= TC_MIN ? tcLeido : null);
    if (!tc) { if (tcLeido != null) tcDudoso++; else sinTC++; continue; }
    if (esUF) enUF++;

    for (const l of lineas) {
      if (!re.test(String(l.ItemCode || ''))) continue;
      const cant = Number(l.Quantity) || 0;
      // En el Service Layer el precio de la linea es Price (ya con descuento
      // aplicado), que es exactamente lo que la OV cobro. UnitPrice, si el
      // extractor lo trae, es el precio ANTES del descuento.
      const precio = Number(l.Price != null ? l.Price : l.UnitPrice) || 0;
      let r = porCliente.get(cod);
      if (!r) { r = { nom: String(d.CardName || '').trim(), cod, cant: 0, uf: 0, filas: 0, ovs: new Set(), periodos: new Map() }; porCliente.set(cod, r); }
      r.cant += cant; r.uf += (cant * precio) / tc; r.filas++; r.ovs.add(d.DocNum);
      const rp = r.periodos.get(kp) || { cant: 0, uf: 0, filas: 0, ovs: new Set() };
      rp.cant += cant; rp.uf += (cant * precio) / tc; rp.filas++; rp.ovs.add(d.DocNum);
      r.periodos.set(kp, rp);

      const q = porPeriodo.get(kp) || { cant: 0, uf: 0, filas: 0 };
      q.cant += cant; q.uf += (cant * precio) / tc; q.filas++;
      porPeriodo.set(kp, q);
      usadas++;
    }
  }
  return { porCliente, porPeriodo, itemCodes, sinTC, tcDudoso, fueraDeUniverso, usadas, enUF };
}

/** Detalle documento por documento de UN cliente, de los dos lados, para
 *  entender una diferencia en vez de suponerla. El extractor guarda una fila
 *  por linea, asi que aca se vuelve a juntar por documento. */
function detalleNuestro(filas, cod, usables, campoFecha, opt) {
  const o = opt || {};
  const quiero = new Set((o.conceptos && o.conceptos.length ? o.conceptos : ['EMISION'])
    .map(x => String(x).toUpperCase().trim()));
  const resta = new Set((o.resta || []).map(x => String(x).toUpperCase().trim()));
  const si = o.restaSi || null;
  const cumple = f => !si || String(f[si.campo] == null ? '' : f[si.campo]).toUpperCase().trim()
                              === String(si.valor).toUpperCase().trim();
  const porDoc = new Map();
  for (const f of filas) {
    const tipo = String(f.U_HX_RD_TransType || '').toUpperCase().trim();
    if (!quiero.has(tipo) && !resta.has(tipo)) continue;
    if (resta.has(tipo) && !cumple(f)) continue;
    const signo = resta.has(tipo) ? -1 : 1;
    if (String(f.CardCode || '').trim() !== cod) continue;
    const fecha = iso(f[campoFecha]);
    const k = f.DocEntry;
    let d = porDoc.get(k);
    if (!d) {
      const crudo = f.U_HX_RD_TarifaCli == null ? null : Number(f.U_HX_RD_TarifaCli);
      d = { docEntry: k, docNum: f.DocNum, fecha, periodo: periodoDe(fecha, usables),
            estado: estadoDe(f) + (signo < 0 ? '  [' + tipo + ' RESTA]' : ''),
            tarifa: (crudo == null || !isFinite(crudo)) ? null : crudo,
            cant: 0, uf: 0 };
      porDoc.set(k, d);
    }
    const cant = (Number(f.Quantity) || 0) * signo;
    d.cant += cant;
    d.uf += d.tarifa == null ? 0 : cant * d.tarifa;
  }
  return [...porDoc.values()].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

function detalleOV(docs, cod, usables, patron) {
  const re = patron || /EMISION/i;
  const out = [];
  for (const d of docs) {
    if (String(d.CardCode || '').trim() !== cod) continue;
    const p = parsePeriodo(d);
    const kp = p.desde ? clave(p) : null;
    const esUF = /^UF$/i.test(String(d.DocCurrency || d.DocCur || '').trim());
    const tcLeido = parseTC(d.Comments);
    const tc = esUF ? 1 : (tcLeido != null && tcLeido >= TC_MIN ? tcLeido : null);
    for (const l of (d._lineas || [])) {
      if (!re.test(String(l.ItemCode || ''))) continue;
      const cant = Number(l.Quantity) || 0;
      const precio = Number(l.Price != null ? l.Price : l.UnitPrice) || 0;
      out.push({ docNum: d.DocNum, periodo: kp, usable: !!(kp && usables.has(kp)),
                 itemCode: l.ItemCode, cant, precio, tc,
                 uf: tc ? (cant * precio) / tc : null });
    }
  }
  return out.sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
}

/** Cuantifica el solape, que es la unica forma de saber si tres dias se estan
 *  cobrando dos veces o si las dos OV cobran cosas distintas.
 *
 *  Para cada cliente con dos periodos que se pisan calcula, con los
 *  movimientos:  A = lo que corresponde al periodo corto
 *                B = lo que corresponde al periodo largo
 *                I = lo que corresponde a los dias que comparten
 *  y con las OV: ovA y ovB, lo que cada una cobro.
 *  Si ovA ≈ A y ovB ≈ B, entonces los dias de I se cobraron en las dos y el
 *  duplicado vale I. Si ovB ≈ B − I, las dos se reparten el periodo y no hay
 *  duplicado. La aritmetica decide; no hace falta suponer. */
function analisisSolape(filas, docsOV, porCliente, campoFecha, patron, pares, opt) {
  const re = patron || /EMISION/i;
  const quiero = new Set(((opt && opt.conceptos && opt.conceptos.length ? opt.conceptos : ['EMISION']))
    .map(x => String(x).toUpperCase().trim()));
  const out = [];
  for (const s of pares) {
    const c = porCliente.get(s.cod);
    if (!c) continue;
    const pa = c.usables.get(s.a), pb = c.usables.get(s.b);
    if (!pa || !pb) continue;
    // el corto es el que termina antes; I son los dias compartidos
    const [corto, largo] = pa.hasta <= pb.hasta ? [pa, pb] : [pb, pa];
    const iDesde = corto.desde > largo.desde ? corto.desde : largo.desde;
    const iHasta = corto.hasta < largo.hasta ? corto.hasta : largo.hasta;

    const suma = (desde, hasta) => {
      let cant = 0, uf = 0;
      for (const f of filas) {
        if (!quiero.has(String(f.U_HX_RD_TransType || '').toUpperCase().trim())) continue;
        if (String(f.CardCode || '').trim() !== s.cod) continue;
        const d = iso(f[campoFecha]);
        if (!d || d < desde || d > hasta) continue;
        const cr = f.U_HX_RD_TarifaCli == null ? null : Number(f.U_HX_RD_TarifaCli);
        const tar = (cr == null || !isFinite(cr)) ? null : cr;
        const q = Number(f.Quantity) || 0;
        cant += q; uf += tar == null ? 0 : q * tar;
      }
      return { cant, uf };
    };
    const ovDe = p => {
      let cant = 0, uf = 0;
      for (const d of docsOV) {
        if (String(d.CardCode || '').trim() !== s.cod) continue;
        const q = parsePeriodo(d);
        if (!q.desde || clave(q) !== clave(p)) continue;
        const esUF = /^UF$/i.test(String(d.DocCurrency || d.DocCur || '').trim());
        const tcL = parseTC(d.Comments);
        const tc = esUF ? 1 : (tcL != null && tcL >= TC_MIN ? tcL : null);
        if (!tc) continue;
        for (const l of (d._lineas || [])) {
          if (!re.test(String(l.ItemCode || ''))) continue;
          const q2 = Number(l.Quantity) || 0;
          cant += q2; uf += (q2 * Number(l.Price != null ? l.Price : l.UnitPrice) || 0) / tc;
        }
      }
      return { cant, uf };
    };

    const movA = suma(corto.desde, corto.hasta);
    const movB = suma(largo.desde, largo.hasta);
    const movI = suma(iDesde, iHasta);
    const oA = ovDe(corto), oB = ovDe(largo);

    // Si no hubo emisiones en ninguno de los dos periodos, el solape es
    // inofensivo: no hay nada que se pueda cobrar dos veces. Eso NO es un
    // veredicto indeciso y mezclarlo con los indecisos esconde cuantos casos
    // quedaron de verdad sin resolver.
    const nada = [movA.uf, movB.uf, movI.uf, oA.uf, oB.uf].every(v => Math.abs(v) < 1e-6);

    // ¿La OV larga cobro el periodo completo, o solo la parte que no comparte?
    // La pregunta se decide por CERCANIA RELATIVA, no por una tolerancia fija.
    // Con tolerancia fija, un cliente cuya OV larga cobra ademas algo que no
    // sabemos explicar caia en "no concluyente" aunque su distancia al periodo
    // completo fuera tres veces menor que al resto. Medido: la OV larga de
    // CAMBIASO cobra 244,94 contra 204,12 del periodo completo y 122,47 del
    // resto — esta inequivocamente del lado del periodo completo, o sea
    // tambien cobra los dias compartidos.
    const dTodo = Math.abs(oB.uf - movB.uf);
    const dResto = Math.abs(oB.uf - (movB.uf - movI.uf));
    // y la OV corta tiene que estar cobrando efectivamente esos dias
    const cortaCobraLosDias = movI.uf > 0 && cerca(oA.uf, movI.uf, 0.02);
    // LIMITE AL TEST RELATIVO. Por cercania relativa sola, una OV larga que
    // cobra cualquier disparate queda igual "mas cerca" del periodo completo
    // que del resto, y el veredicto saldria duplicado por aritmetica de
    // distancias y no por evidencia. Si lo que la OV larga cobra de mas no se
    // puede explicar y ademas es MAYOR que los dias compartidos que estoy
    // tratando de medir, entonces lo que domina es lo que no entiendo: no
    // concluye.
    const restoUF = oB.uf - movB.uf;
    const restoDomina = Math.abs(restoUF) > movI.uf;
    const dup = !nada && cortaCobraLosDias && dTodo < dResto && !restoDomina;

    out.push({ cod: s.cod, corto: clave(corto), largo: clave(largo),
               interseccion: iDesde + '..' + iHasta,
               movA, movB, movI, ovA: oA, ovB: oB,
               // lo que la OV larga cobra por encima de los movimientos de su
               // propio periodo: es otra cosa, y no hay que confundirla con el
               // duplicado ni dejarla tapada por el
               resto: restoUF,
               veredicto: nada ? 'sin emisiones'
                        : dup ? 'duplicado'
                        : cortaCobraLosDias && dResto < dTodo && !restoDomina ? 'reparten'
                        : 'no concluyente',
               duplicado: dup ? movI.uf : 0 });
  }
  return out;
}

/** En QUE SEMANA se descuadra un cliente, y por cuantos pallets.
 *
 *  Un total mensual descuadrado no dice nada: hay que poder ir al documento.
 *  Medido en septiembre, los ocho clientes descuadrados tenian cada uno uno o
 *  dos movimientos puntuales sin facturar, y agrupados en semanas concretas
 *  (tres clientes en la del 14 al 20, tres en la del 7 al 13). Eso no se ve en
 *  el total; se ve aca.
 *
 *  Devuelve, por cliente y periodo, cantidad y UF de los dos lados y su
 *  diferencia. La diferencia de CANTIDAD es la mas util: dice cuantos pallets
 *  de diferencia hay, y de ahi sale cual es el movimiento. */
function descuadres(nuPorCliente, ovPorCliente, cods, tolUF) {
  const tol = tolUF === undefined ? 0.001 : tolUF;
  const out = [];
  for (const cod of cods) {
    const a = nuPorCliente.get(cod), b = ovPorCliente.get(cod);
    const ks = new Set([...(a ? a.periodos.keys() : []), ...(b ? b.periodos.keys() : [])]);
    for (const k of [...ks].sort()) {
      const m = (a && a.periodos.get(k)) || { cant: 0, uf: 0 };
      const o = (b && b.periodos.get(k)) || { cant: 0, uf: 0 };
      if (Math.abs(o.uf - m.uf) <= tol) continue;
      out.push({ cod, nom: (a && a.nom) || (b && b.nom) || cod, periodo: k,
                 movCant: m.cant, movUF: m.uf, ovCant: o.cant, ovUF: o.uf,
                 difCant: o.cant - m.cant, difUF: o.uf - m.uf,
                 ovs: o.ovs ? [...o.ovs] : [] });
    }
  }
  return out;
}

// ── la pregunta del signo ───────────────────────────────────────────────────

/** Nuestro neto por tarifa en un (cliente, periodo), SIN las tarifas cuyo neto
 *  es cero.
 *
 *  Sacar los ceros no es cosmetico: invertir un cero no cambia nada, asi que
 *  dejarlos haria que al menos dos combinaciones de signos calzaran siempre y
 *  todo saldria "ambiguo", que es la forma elegante de no decir nada. */
function netosPorTarifa(rp, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  const out = [];
  for (const e of ((rp && rp.tarifas) || new Map()).values()) {
    if (Math.abs(e.uf) <= t && Math.abs(e.cant) <= t) continue;
    out.push({ clave: e.clave, tarifa: e.tarifa, concepto: e.concepto, cant: e.cant, uf: e.uf });
  }
  return out.sort((a, b) => Math.abs(b.uf) - Math.abs(a.uf));
}

const MAX_TARIFAS_SIGNO = 12;

/** Busca que combinacion de signos sobre nuestro neto por tarifa reproduce lo
 *  que cobro la OV en ese (cliente, periodo).
 *
 *  POR QUE EXISTE. En QUINTA la OV cobro 131,20 UF contra nuestros 34,50 y la
 *  diferencia no era ningun movimiento faltante: las cuatro semanas en que el
 *  neteo daba CREDITO aparecian cobradas en positivo, con el mismo valor
 *  absoluto. La quinta semana, la unica en que el neteo dio positivo, calzaba
 *  al quinto decimal. Eso no se ve en el total del cliente ni en el delta de
 *  la semana: hay que preguntarle a la aritmetica, tarifa por tarifa, que
 *  signos reproducen la OV.
 *
 *  NO ES UNA INFERENCIA. Con n tarifas se prueban las 2^n combinaciones y se
 *  exige que calcen LAS DOS cosas a la vez, UF y pallets, que salen de
 *  documentos distintos. Lo que no se puede decidir se declara ('ambiguo',
 *  'sin explicacion') en vez de elegir el veredicto que conviene. */
function combinacionDeSignos(netos, ovUF, ovCant, opt) {
  const o = opt || {};
  const tu = o.tolUF === undefined ? 0.0005 + 2e-6 * Math.abs(ovUF) : o.tolUF;
  const tq = o.tolCant === undefined ? 0.001 : o.tolCant;
  const n = (netos || []).length;
  if (!n) return { veredicto: (Math.abs(ovUF) <= tu && Math.abs(ovCant) <= tq)
                              ? 'calza' : 'sin movimientos', invertidas: [], flips: 0 };
  // 2^n crece rapido, y un cliente con trece tarifas distintas en una semana
  // seria otro problema y no este. Se declara en vez de adivinarlo.
  if (n > MAX_TARIFAS_SIGNO) return { veredicto: 'demasiadas tarifas', tarifas: n, invertidas: [], flips: 0 };

  const suma = m => {
    let uf = 0, cant = 0, flips = 0;
    for (let i = 0; i < n; i++) {
      const neg = (m >> i) & 1;
      if (neg) flips++;
      uf += (neg ? -1 : 1) * netos[i].uf;
      cant += (neg ? -1 : 1) * netos[i].cant;
    }
    return { uf, cant, flips };
  };
  const calza = s => Math.abs(s.uf - ovUF) <= tu && Math.abs(s.cant - ovCant) <= tq;

  // Sin invertir nada: no hay nada que explicar, y no se sigue buscando.
  const base = suma(0);
  if (calza(base)) return { veredicto: 'calza', invertidas: [], flips: 0 };

  // La OV no tiene linea para este cliente-semana. Es el caso de THE PROTEIN
  // —536 pallets movidos y ninguna linea— y no es un descalce de monto:
  // llamarlo 'sin explicacion' seria alarmar por algo que ya esta entendido.
  // Va ANTES de buscar signos, porque si algun subconjunto sumara cero
  // apareceria una inversion inventada.
  if (Math.abs(ovUF) <= tu && Math.abs(ovCant) <= tq)
    return { veredicto: 'sin linea de OV', invertidas: [], flips: 0 };

  const hits = [];
  for (let m = 1; m < (1 << n); m++) { const s = suma(m); if (calza(s)) hits.push({ m, flips: s.flips }); }
  // Nada calza invirtiendo signos. Si la CANTIDAD ya calzaba sin invertir nada
  // y lo unico que no cuadra son las UF, entonces no faltan ni sobran pallets:
  // son los mismos pallets a otro precio. Es el caso de LESAFFRE en la semana
  // del 7 al 13 —cero pallets de diferencia y 0,12476 UF— y es un animal
  // distinto, que se mide contra el contrato y no contra el signo.
  if (!hits.length) return {
    veredicto: Math.abs(base.cant - ovCant) <= tq ? 'precio distinto' : 'sin explicacion',
    invertidas: [], flips: 0 };
  hits.sort((a, b) => a.flips - b.flips);
  // Dos combinaciones igual de simples que calzan las dos no prueban ninguna.
  if (hits.length > 1 && hits[1].flips === hits[0].flips)
    return { veredicto: 'ambiguo', combinaciones: hits.length, invertidas: [], flips: 0 };
  const inv = netos.filter((_, i) => (hits[0].m >> i) & 1);
  // El veredicto lo da el SUBTOTAL de lo invertido, no cada pieza por separado:
  // invertir todos los miembros de un grupo es invertir el grupo, y lo que la
  // OV dio vuelta fue un subtotal. En QUINTA el subtotal invertido vale
  // -11,64 UF —un abono— y aparece cobrado en +11,64.
  // Las dos direcciones no son la misma cosa y no se suman en un solo total:
  // una cobra un abono, la otra abona un cargo.
  let sub = 0, subCant = 0;
  for (const x of inv) { sub += x.uf; subCant += x.cant; }
  return { veredicto: sub < 0 ? 'credito cobrado' : 'cargo acreditado',
           invertidas: inv, flips: hits[0].flips, subtotalUF: sub, subtotalCant: subCant };
}

/** Corre la busqueda de signos sobre todos los (cliente, periodo) que tienen
 *  los dos lados. El casillero AMBIGUO queda fuera a proposito: ahi los
 *  movimientos no estan asignados a una semana y no hay OV contra que medir. */
function analisisSignos(nuPorCliente, ovPorCliente, opt) {
  const out = [];
  for (const cod of [...nuPorCliente.keys()].filter(c => ovPorCliente.has(c))) {
    const a = nuPorCliente.get(cod), b = ovPorCliente.get(cod);
    for (const k of [...new Set([...a.periodos.keys(), ...b.periodos.keys()])].sort()) {
      if (k === AMBIGUO) continue;
      const rp = a.periodos.get(k), o = b.periodos.get(k) || { cant: 0, uf: 0 };
      const nuUF = (rp && rp.uf) || 0, nuCant = (rp && rp.cant) || 0;
      const netos = netosPorTarifa(rp);
      // GUARDIA. El veredicto sale de los casilleros y la diferencia que se
      // informa sale del total del periodo. Son dos sumas de las mismas filas,
      // asi que tienen que coincidir: si alguna vez dejaran de hacerlo, el
      // renglon diria una cosa y probaria otra, y nadie se enteraria.
      let sUF = 0, sCant = 0;
      for (const x of netos) { sUF += x.uf; sCant += x.cant; }
      const r = (Math.abs(sUF - nuUF) > 1e-6 || Math.abs(sCant - nuCant) > 1e-6)
        ? { veredicto: 'desglose inconsistente', invertidas: [], flips: 0 }
        : combinacionDeSignos(netos, o.uf, o.cant, opt);
      const difCant = o.cant - nuCant;
      out.push({ cod, nom: a.nom || b.nom || cod, periodo: k,
                 nuestroUF: nuUF, nuestroCant: nuCant, ovUF: o.uf, ovCant: o.cant,
                 difUF: o.uf - nuUF, difCant,
                 tarifas: netos.length, veredicto: r.veredicto, invertidas: r.invertidas,
                 flips: r.flips, combinaciones: r.combinaciones, subtotalUF: r.subtotalUF,
                 par: Number.isInteger(difCant) && difCant % 2 === 0 });
    }
  }
  return out.sort((x, y) => Math.abs(y.difUF) - Math.abs(x.difUF));
}

/** Aviso de blobs de OV ausentes, como lista de lineas.
 *
 *  POR QUE. Un blob que falta no deja un total equivocado —eso se notaria—
 *  sino que hace DESAPARECER semanas enteras, y lo que queda sale igual de
 *  prolijo. La medicion de agosto comparo UNA sola semana porque faltaban los
 *  blobs de orders de julio y agosto, y el unico sintoma fue que la lista de
 *  periodos traia un solo renglon. El de movimientos ya avisaba; el de OV se
 *  leia como null en silencio.
 *
 *  Distingue cual falta porque no pesan igual: la OV de una semana se emite el
 *  lunes siguiente, asi que las semanas del mes auditado se facturan en `mes` y
 *  en el mes SIGUIENTE. Que falte el anterior solo afecta la semana que entra
 *  cruzando el borde. */
function avisoBlobsOV(mes, faltan) {
  if (!faltan || !faltan.length) return [];
  const L = ['', '  OJO · FALTA EL BLOB DE ORDERS: ' + faltan.join(', '),
    '  Un blob ausente no deja un total equivocado: deja FUERA las semanas que ese mes cubre, y el',
    '  resto de la corrida sale igual de prolijo. Revisa la lista de periodos usables antes de leer',
    '  cualquier total.'];
  const duros = faltan.filter(m => m === mes || m === mesSiguiente(mes));
  const blando = faltan.filter(m => m === mesAnterior(mes));
  if (duros.length)
    L.push('  ' + duros.join(', ') + ': ahi se facturan semanas de ' + mes +
           '. El total de esta corrida NO es el mes completo.');
  if (blando.length)
    L.push('  ' + blando.join(', ') + ': afecta solo la semana que entra cruzando el inicio de ' + mes + '.');
  return L;
}

/** El informe de la busqueda de signos, como lista de lineas.
 *
 *  Devuelve texto en vez de imprimirlo para que se pueda probar. Un bloque de
 *  treinta console.log dentro de main solo se ejecuta contra produccion, y un
 *  nombre mal escrito ahi revienta la corrida despues de leer SAP entero. */
function informeSignos(sig, tope) {
  const T = Math.max(1, (tope || 25) * 4);
  const L = ['', '── POR TARIFA · que combinacion de signos reproduce la OV ' + '─'.repeat(14),
    '  Por cada cliente y semana se toma NUESTRO neto desglosado por (tarifa, concepto) y se',
    '  prueban las 2^n combinaciones de signos, exigiendo que calcen a la vez las UF y los pallets.',
    '  "credito cobrado" = la unica combinacion que reproduce la OV da vuelta un subtotal negativo:',
    '  la OV cobro como cargo lo que correspondia abonar.', ''];
  const malos = sig.filter(s => s.veredicto !== 'calza');
  if (!malos.length) L.push('  Todas las semanas calzan sin invertir ningun signo.');
  else {
    L.push('  ' + 'cliente'.padEnd(26) + 'periodo'.padEnd(24) + 'nuestro UF'.padStart(12) +
           'OV UF'.padStart(12) + 'dif UF'.padStart(12) + '   veredicto / lo que se dio vuelta');
    for (const s of malos.slice(0, T))
      L.push('  ' + String(s.nom).slice(0, 25).padEnd(26) + String(s.periodo).padEnd(24) +
             uf5(s.nuestroUF).padStart(12) + uf5(s.ovUF).padStart(12) + uf5(s.difUF).padStart(12) +
             '   ' + s.veredicto +
             ((s.invertidas && s.invertidas.length)
               ? '  ' + uf5(s.subtotalUF) + ' UF = [' +
                 s.invertidas.map(x => x.clave + ' ' + mil(x.cant)).join(' + ') + ']' : '') +
             (s.combinaciones ? '  (' + s.combinaciones + ' combinaciones calzan)' : ''));
    if (malos.length > T) L.push('  ... y ' + (malos.length - T) + ' semanas mas');
  }
  const cuenta = new Map();
  for (const s of sig) cuenta.set(s.veredicto, (cuenta.get(s.veredicto) || 0) + 1);
  L.push('', '  veredictos sobre ' + sig.length + ' semanas-cliente: ' +
         [...cuenta].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(' · '));
  // Las dos direcciones NO se suman en un solo total: una cobra un abono y la
  // otra abona un cargo, y juntarlas dejaria un neto que no significa nada.
  for (const v of ['credito cobrado', 'cargo acreditado']) {
    const f = sig.filter(s => s.veredicto === v);
    if (!f.length) continue;
    let uf = 0; const cl = new Set();
    for (const s of f) { uf += s.difUF; cl.add(s.cod); }
    L.push('  ' + v + ': ' + uf5(uf) + ' UF   ·  ' + cl.size + ' clientes   ·  ' + f.length + ' semanas');
  }
  // 'precio distinto' no es signo ni cantidad: son los mismos pallets a otra
  // tarifa, y se mide contra el contrato. Va con su propio total para que no
  // se confunda con lo anterior.
  const pd = sig.filter(s => s.veredicto === 'precio distinto');
  if (pd.length) {
    let uf = 0; const cl = new Set();
    for (const s of pd) { uf += s.difUF; cl.add(s.cod); }
    L.push('  precio distinto (misma cantidad, otra tarifa): ' + uf5(uf) + ' UF   ·  ' +
           cl.size + ' clientes   ·  ' + pd.length + ' semanas');
  }
  // CORROBORACION INDEPENDIENTE. Si un credito se cobra en positivo, el delta
  // en pallets es el DOBLE de lo invertido, o sea par. No sale de la busqueda
  // de signos —sale de contar— asi que es una segunda opinion gratis.
  const conDelta = sig.filter(s => Math.abs(s.difCant) > 0);
  const pares = conDelta.filter(s => s.par).length;
  if (conDelta.length)
    L.push('  deltas en pallets distintos de cero: ' + conDelta.length + '   ·  pares: ' + pares +
           '   ·  impares: ' + (conDelta.length - pares) +
           (pares === conDelta.length ? '   (todos pares: es la firma de una inversion de signo)' : ''));
  return L;
}

/** Que ItemCode de la OV toma el patron, con su cantidad.
 *
 *  POR QUE EXISTE. Un patron amplio (^SERV-TRANSF) toma DOS lineas de la OV
 *  —SERV-TRANSFERENCIAS y SERV-TRANSF-WALMART— mientras del lado de los
 *  movimientos se audita un solo concepto. La comparacion entonces mide una
 *  cosa contra otra y la diferencia parece un hallazgo. Me paso: una corrida
 *  dio 1.799,75 UF de diferencia y 1.517,41 de esos eran, exactamente, la
 *  linea WALMART que el patron habia tomado y el concepto no.
 *  Esto no se puede dejar al ojo: el script tiene que decirlo. */
function itemCodesDelPatron(docsOV, patron) {
  const re = patron || /EMISION/i;
  const m = new Map();
  for (const d of docsOV)
    for (const l of (d._lineas || [])) {
      const ic = String(l.ItemCode || '').trim();
      if (!ic || !re.test(ic)) continue;
      const e = m.get(ic) || { lineas: 0, cant: 0 };
      e.lineas++; e.cant += Number(l.Quantity) || 0;
      m.set(ic, e);
    }
  return m;
}

/** Une los dos lados por CardCode. Devuelve los comparables (con los dos
 *  lados) separados de los que tienen uno solo, porque un cliente que esta en
 *  un lado y no en el otro no es un descalce de 100%: es otra cosa, y mezclarlo
 *  en el ranking de diferencias tapa las diferencias reales. */
function comparar(nuestro, ov) {
  const comparables = [], unLado = [];
  for (const cod of new Set([...nuestro.keys(), ...ov.keys()])) {
    const a = nuestro.get(cod), b = ov.get(cod);
    const fila = { cod, nom: (a && a.nom) || (b && b.nom) || cod,
                   nuestro: a ? a.uf : 0, ov: b ? b.uf : 0 };
    fila.dif = fila.ov - fila.nuestro;
    fila.pct = fila.nuestro ? (100 * fila.dif / fila.nuestro) : null;
    (a && b ? comparables : unLado).push(fila);
  }
  comparables.sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  unLado.sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  return { comparables, unLado };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = opcionesDesconocidas(args);
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
  const concepto = opcion('concepto', 'EMISION').toUpperCase().trim();
  const incluye = opcion('incluye', '').split(',').map(x => x.toUpperCase().trim()).filter(Boolean);
  const resta   = opcion('resta', '').split(',').map(x => x.toUpperCase().trim()).filter(Boolean);
  const restaSiTxt = opcion('resta-si', null);
  if (restaSiTxt !== null && restaSiTxt.indexOf('=') <= 0) {
    console.error('--resta-si espera campo=valor y llego: "' + restaSiTxt + '"');
    console.error('Ejemplo: --resta-si=FromWarehouse=RETAIL');
    process.exit(1);
  }
  const restaSi = restaSiTxt
    ? { campo: restaSiTxt.slice(0, restaSiTxt.indexOf('=')).trim(),
        valor: restaSiTxt.slice(restaSiTxt.indexOf('=') + 1).trim() } : null;
  const re = patron ? new RegExp(patron, 'i') : null;
  const vecinos = [mesAnterior(mes), mes, mesSiguiente(mes)];

  const rutaMaestro = path.join(__dirname, '..', 'data', 'tarifas_contrato.json');
  if (!fs.existsSync(rutaMaestro)) { console.error('Falta ' + rutaMaestro); process.exit(1); }
  const mj = JSON.parse(fs.readFileSync(rutaMaestro, 'utf8'));
  const maestro = {};
  for (const nom of Object.keys(mj.clientes)) maestro[norm(nom)] = mj.clientes[nom];

  async function leer(ent, m) {
    const b = cc.getBlobClient(ent + '/' + m + '.json');
    if (!(await b.exists())) return null;
    return JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  }

  // Movimientos: el mes y sus dos vecinos, para poder cubrir las semanas que
  // cruzan el borde. Los que falten se declaran y se excluyen sus periodos.
  const movFilas = [], mesesConMov = [], mesesSinMov = [];
  for (const m of vecinos) {
    const j = await leer('stocktransfers', m);
    if (!j) { mesesSinMov.push(m); continue; }
    mesesConMov.push(m);
    for (const f of (j.filas || [])) movFilas.push(f);
  }
  if (!mesesConMov.length) { console.error('No hay ningun blob stocktransfers de ' + vecinos.join(', ')); process.exit(1); }

  // OV: los mismos tres meses. El extractor guarda una fila por LINEA, asi que
  // se reagrupan por documento para leer cabecera y lineas juntas.
  const ovFilas = [], mesesConOV = [], mesesSinOV = [];
  for (const m of vecinos) {
    const j = await leer('orders', m);
    // Un blob de OV que no esta NO puede leerse en silencio. No produce un
    // total equivocado: hace DESAPARECER semanas enteras, y la corrida sale
    // prolija, con menos periodos, sin que nada lo diga. Paso de verdad —
    // la medicion de agosto midio una sola semana porque faltaban los blobs
    // de julio y agosto, y el unico sintoma fue la lista de periodos.
    if (!j) { mesesSinOV.push(m); continue; }
    mesesConOV.push(m);
    for (const f of (j.filas || [])) ovFilas.push(f);
  }
  const porDoc = new Map();
  for (const f of ovFilas) {
    let d = porDoc.get(f.DocEntry);
    if (!d) { d = Object.assign({}, f, { _lineas: [] }); porDoc.set(f.DocEntry, d); }
    d._lineas.push(f);
  }
  const docsOV = [...porDoc.values()];

  console.log('Maestro de contratos: ' + mj._clientes + ' clientes · ' + mj._tarifas + ' tarifas');
  console.log('Movimientos : stocktransfers ' + mesesConMov.join(' + ') + ' · ' + mil(movFilas.length) + ' filas' +
              (mesesSinMov.length ? '   (sin blob: ' + mesesSinMov.join(', ') + ')' : ''));
  console.log('OV          : orders ' + (mesesConOV.join(' + ') || '(ninguno)') + ' · ' + mil(docsOV.length) +
              ' documentos, ' + mil(ovFilas.length) + ' lineas' +
              (mesesSinOV.length ? '   (sin blob: ' + mesesSinOV.join(', ') + ')' : ''));
  if (!mesesConOV.length) { console.error('\nNo hay ningun blob orders de ' + vecinos.join(', ') + ': no hay con que comparar.'); process.exit(1); }
  for (const l of avisoBlobsOV(mes, mesesSinOV)) console.log(l);
  const conceptos = [concepto].concat(incluye);
  const servicios = serviciosDe(concepto, mj._equivalencias_sap);
  const opt = { conceptos, servicios, resta, restaSi };
  console.log('Concepto auditado: ' + conceptos.join(' + ') + (resta.length ? ' - ' + resta.join(' - ') : '') +
              '   ·  patron de ItemCode: ' + (patron || 'EMISION') +
              '   ·  servicios de contrato: ' + (servicios.length ? servicios.join(', ') : '(ninguno en el maestro)'));
  if (resta.length) console.log('Los conceptos despues del signo menos se RESTAN: su cantidad y su UF entran en negativo.');
  if (restaSi) console.log('Solo se restan las filas con ' + restaSi.campo + ' = ' + restaSi.valor + '.');
  console.log('Fecha usada para ubicar el movimiento: ' + campoFecha + '\n');
  if (concepto !== 'EMISION' && !patron)
    console.log('  OJO: estas auditando ' + concepto + ' pero el patron de ItemCode sigue en EMISION.\n' +
                '  Pasale --patron=SERV-TRANSFERENCIAS (o el que corresponda) o la comparacion no tiene sentido.\n');

  const per = periodosPorCliente(docsOV, mes, mesesConMov);
  // Las OV de cierre contable interno se descartan ANTES de comparar, porque
  // esta probado que no se facturan. Con --mantener-corte se deja el
  // comportamiento anterior para poder volver a verlas.
  const cortes = estaPresente(args, 'mantener-corte') ? [] : resolverCortes(per.porCliente);
  // Las OV duplicadas se sacan DESPUES del corte contable y ANTES de armar la
  // vista: si no, los periodos que se excluyen seguirian saliendo como usables.
  const duplicadas = estaPresente(args, 'mantener-duplicadas') ? [] : resolverDuplicadas(docsOV, per.porCliente);
  const sel = vistaGlobal(per.porCliente);
  const pisados = solapes(per.porCliente);

  console.log('── DIAGNOSTICO ' + '─'.repeat(58));
  console.log('  ItemCode distintos en las lineas de la OV:');
  const inv = agregarOV(docsOV, new Map(), re);   // solo para inventariar
  for (const [ic, e] of [...inv.itemCodes].sort((a, b) => b[1].filas - a[1].filas))
    console.log('    ' + ic.padEnd(26) + String(e.filas).padStart(6) + ' lineas   cant ' + mil(e.cant));
  console.log('  Campos de linea disponibles: ' +
              Object.keys(ovFilas[0] || {}).filter(k => /Quantity|Price|LineTotal|ItemCode|Discount/.test(k)).join(', '));
  console.log('  De donde salio el periodo: ' + [...per.origenPeriodo].map(([k, n]) => k + ' ' + n).join(' | '));

  console.log('\n  Periodos que solapan ' + mes + ' (un cliente usa solo los suyos):');
  for (const [k, p] of [...sel.usables].sort())
    console.log('    USABLE   ' + k + '   ' + String(p.ovs).padStart(4) + ' OV   ' +
                String(p.clientes).padStart(3) + ' clientes');
  for (const [k, p] of [...sel.excluidos].sort())
    console.log('    excluido ' + k + '   ' + String(p.ovs).padStart(4) + ' OV   ' +
                String(p.clientes).padStart(3) + ' clientes   falta stocktransfers de ' + p.falta);
  if (!sel.usables.size) { console.error('\nNingun periodo usable: no hay con que comparar.'); process.exit(1); }

  if (cortes.length) {
    const porPar = new Map();
    for (const c of cortes) {
      const k = c.descartado + ' (a favor de ' + c.aFavorDe + ')';
      porPar.set(k, (porPar.get(k) || 0) + 1);
    }
    console.log('\n  OV DE CIERRE CONTABLE INTERNO DESCARTADAS: ' + cortes.length + ' clientes');
    for (const [k, n] of porPar) console.log('    ' + k + '   ·  ' + n + ' clientes');
    console.log('    (probado en medir-facturacion.js: 27 de 27 de estas OV no llegaron a factura)');
  }

  for (const l of informeDuplicadas(duplicadas, TOPE)) console.log(l);

  if (pisados.length) {
    console.log('\n  CLIENTES CON DOS OV QUE CUBREN LOS MISMOS DIAS: ' + pisados.length);
    const pares = new Map();
    for (const s of pisados) pares.set(s.a + '|' + s.b, (pares.get(s.a + '|' + s.b) || 0) + 1);
    for (const [k, n] of pares) console.log('    ' + k.replace('|', '   y   ') + '   ·  ' + n + ' clientes');
  }

  const mirados = opt.conceptos.concat(resta);
  const emisiones = movFilas.filter(f => mirados.indexOf(String(f.U_HX_RD_TransType || '').toUpperCase().trim()) >= 0);
  console.log('\n  Campo de fecha: filas de ' + mirados.join('+') + ' que caen en los periodos de su cliente');
  for (const [k, e] of [...sondaFechas(emisiones, per.porCliente)].sort((a, b) => b[1].dentro - a[1].dentro))
    console.log('    ' + (k === campoFecha ? '> ' : '  ') + k.padEnd(28) +
                String(e.dentro).padStart(6) + ' dentro   ' + String(e.fuera).padStart(6) + ' fuera   ' +
                String(e.nulos).padStart(6) + ' sin fecha   ' + String(e.sinOV).padStart(6) + ' sin OV');

  const nu = agregarNuestro(movFilas, maestro, per.porCliente, campoFecha, opt);
  const ov = agregarOV(docsOV, per.porCliente, re);

  // GUARDIA: el patron y los conceptos tienen que estar hablando de lo mismo.
  const tomados = itemCodesDelPatron(docsOV, re);
  console.log('\n  ItemCode que toma el patron ' + (patron || 'EMISION') + ':');
  for (const [ic, e] of [...tomados].sort((a, b) => b[1].cant - a[1].cant))
    console.log('    ' + ic.padEnd(26) + String(e.lineas).padStart(6) + ' lineas   cant ' + mil(e.cant));
  if (tomados.size > conceptos.length)
    console.log('  AVISO: el patron toma ' + tomados.size + ' ItemCode y se auditan ' + conceptos.length +
                ' concepto(s) de movimiento.\n' +
                '  Si falta un concepto del lado de los movimientos, la diferencia de abajo es ese\n' +
                '  concepto entero y no un hallazgo. Agregalo con --incluye.');

  console.log('\n── NUESTRO LADO · ' + conceptos.join('+') + (resta.length ? '-' + resta.join('-') : '') + ' valorizado con la tarifa estampada ' + '─'.repeat(5));
  let nuUF = 0, nuCant = 0;
  for (const [v, g] of [...nu.porVariante].sort((a, b) => b[1].uf - a[1].uf)) {
    console.log('  ' + v.padEnd(28) + String(g.filas).padStart(5) + ' filas   cant ' +
                mil(g.cant).padStart(9) + '   ' + uf5(g.uf).padStart(13) + ' UF');
    nuUF += g.uf; nuCant += g.cant;
  }
  console.log('  ' + 'TOTAL'.padEnd(28) + '               cant ' + mil(nuCant).padStart(9) + '   ' + uf5(nuUF).padStart(13) + ' UF');
  if (nu.fueraDeUniverso) console.log('  filas fuera de los periodos de su cliente: ' + mil(nu.fueraDeUniverso));
  if (nu.sinOV)       console.log('  filas de clientes sin ninguna OV en el mes: ' + mil(nu.sinOV));
  if (nu.restaOmitida) console.log('  filas del concepto restado que NO cumplen la condicion (no se restaron): ' + mil(nu.restaOmitida));
  if (nu.dobleCobertura) console.log('  filas cuya fecha cae en DOS periodos del mismo cliente: ' +
                                  mil(nu.dobleCobertura) + ' (contadas una vez, en "' + AMBIGUO + '")');
  if (nu.sinFecha)    console.log('  filas sin ' + campoFecha + ': ' + nu.sinFecha);
  if (nu.sinMaestro)  console.log('  filas de clientes que no estan en el maestro: ' + nu.sinMaestro);
  if (nu.sinVariante) console.log('  filas cuya tarifa no calza con ninguna variante: ' + nu.sinVariante);
  if (nu.sinTarifa)   console.log('  filas SIN tarifa estampada: ' + nu.sinTarifa +
                                  ' (aportan cant ' + mil(nu.cantSinTarifa) + ' y cero UF)');
  if (nu.ambiguas)    console.log('  filas cuya tarifa calza con MAS de una variante: ' + nu.ambiguas +
                                  ' — no afecta el monto, solo el desglose por nombre');

  let ovUF = 0, ovCant = 0;
  for (const r of ov.porCliente.values()) { ovUF += r.uf; ovCant += r.cant; }
  console.log('\n── LADO OV · lineas de emision llevadas a UF con el TC ' + '─'.repeat(13));
  console.log('  lineas usadas: ' + mil(ov.usadas) + '   cant ' + mil(ovCant) + '   ' + uf5(ovUF) + ' UF' +
              (ov.sinTC ? '   ·  sin TC: ' + ov.sinTC : '') +
              (ov.tcDudoso ? '   ·  TC bajo ' + mil(TC_MIN) + ': ' + ov.tcDudoso : '') +
              (ov.enUF ? '   ·  ya en UF: ' + ov.enUF : ''));

  console.log('\n── POR PERIODO · los dos lados sobre los mismos dias ' + '─'.repeat(15));
  console.log('  ' + 'periodo'.padEnd(26) + 'nuestro UF'.padStart(13) + 'OV UF'.padStart(13) +
              'dif UF'.padStart(12) + 'dif %'.padStart(9));
  for (const k of [...sel.usables.keys()].sort().concat(nu.porPeriodo.has(AMBIGUO) ? [AMBIGUO] : [])) {
    const a = nu.porPeriodo.get(k) || { uf: 0 }, b = ov.porPeriodo.get(k) || { uf: 0 };
    const pct = a.uf ? (100 * (b.uf - a.uf) / a.uf) : null;
    console.log('  ' + k.padEnd(26) + uf5(a.uf).padStart(13) + uf5(b.uf).padStart(13) +
                uf5(b.uf - a.uf).padStart(12) +
                (pct === null ? '      s/d' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%').padStart(9));
  }

  const cmp = comparar(nu.porCliente, ov.porCliente);
  console.log('\n── COMPARACION POR CLIENTE · cruce por CardCode ' + '─'.repeat(26));
  console.log('  ' + 'cliente'.padEnd(34) + 'nuestro UF'.padStart(13) + 'OV UF'.padStart(13) +
              'dif UF'.padStart(12) + 'dif %'.padStart(9));
  for (const c of cmp.comparables.slice(0, TOPE))
    console.log('  ' + c.nom.slice(0, 33).padEnd(34) + uf5(c.nuestro).padStart(13) + uf5(c.ov).padStart(13) +
                uf5(c.dif).padStart(12) + ((c.pct >= 0 ? '+' : '') + c.pct.toFixed(1) + '%').padStart(9));

  if (cmp.unLado.length) {
    console.log('\n  CON UN SOLO LADO (no son descalce: o falta el movimiento o falta la OV)');
    for (const c of cmp.unLado.slice(0, TOPE))
      console.log('  ' + c.nom.slice(0, 33).padEnd(34) + uf5(c.nuestro).padStart(13) + uf5(c.ov).padStart(13) +
                  uf5(c.dif).padStart(12) + '   ' + c.cod);
  }

  if (pisados.length) {
    const an = analisisSolape(movFilas, docsOV, per.porCliente, campoFecha, re, pisados, opt);
    console.log('\n── LOS DIAS CUBIERTOS POR DOS OV · que cobro cada una ' + '─'.repeat(18));
    // los que no tienen emisiones en esos dias no aportan nada: se cuentan y
    // no se listan, para que la tabla muestre solo los casos con contenido
    const conAlgo = an.filter(a => a.veredicto !== 'sin emisiones');
    console.log('  ' + 'cliente'.padEnd(16) + 'dias'.padEnd(24) +
                'mov dias'.padStart(11) + 'OV corta'.padStart(11) +
                'mov largo'.padStart(11) + 'OV larga'.padStart(11) +
                'resto'.padStart(10) + '   veredicto');
    for (const a of conAlgo.slice(0, TOPE))
      console.log('  ' + a.cod.padEnd(16) + a.interseccion.padEnd(24) +
                  uf5(a.movI.uf).padStart(11) + uf5(a.ovA.uf).padStart(11) +
                  uf5(a.movB.uf).padStart(11) + uf5(a.ovB.uf).padStart(11) +
                  (Math.abs(a.resto) < 1e-6 ? '' : uf5(a.resto)).padStart(10) + '   ' + a.veredicto);
    if (conAlgo.length > TOPE) console.log('  ... y ' + (conAlgo.length - TOPE) + ' clientes mas con contenido');
    const cuenta = new Map();
    let dup = 0, resto = 0, sumaOvA = 0, sumaMovI = 0;
    for (const a of an) {
      cuenta.set(a.veredicto, (cuenta.get(a.veredicto) || 0) + 1);
      dup += a.duplicado; resto += a.resto; sumaOvA += a.ovA.uf; sumaMovI += a.movI.uf;
    }
    console.log('\n  veredictos: ' + [...cuenta].map(([k, n]) => k + ' ' + n).join(' · '));
    console.log('  las OV cortas cobraron ' + uf5(sumaOvA) + ' UF  ·  los movimientos de esos dias valen ' +
                uf5(sumaMovI) + ' UF');
    if (dup) console.log('  UF de dias cobrados dos veces: ' + uf5(dup));
    if (Math.abs(resto) > 1e-6)
      console.log('  UF que las OV largas cobran por encima de los movimientos de su periodo: ' + uf5(resto));
  }

  // Los que NO calzan: antes de llamarle subfacturacion, mirar el estado de
  // los documentos que estamos contando.
  const descuadrados = cmp.comparables.filter(c => Math.abs(c.pct) > 0.5).concat(cmp.unLado);
  if (descuadrados.length) {
    console.log('\n── LOS QUE NO CALZAN · estado de los documentos de nuestro lado ' + '─'.repeat(9));
    const dd = descuadres(nu.porCliente, ov.porCliente, descuadrados.map(c => c.cod));
    for (const c of descuadrados) {
      const r = nu.porCliente.get(c.cod);
      console.log('  ' + c.nom.slice(0, 40) + '   [' + c.cod + ']   dif ' + uf5(c.dif) + ' UF');
      if (r) for (const [es, e] of [...r.estados].sort((a, b) => b[1].uf - a[1].uf))
        console.log('      ' + es.padEnd(42) + String(e.filas).padStart(4) + ' doc-lineas   cant ' +
                    mil(e.cant).padStart(8) + '   ' + uf5(e.uf).padStart(12) + ' UF');
      for (const d of dd.filter(x => x.cod === c.cod))
        console.log('      ' + d.periodo.padEnd(26) + 'mov ' + mil(d.movCant).padStart(7) +
                    '  OV ' + mil(d.ovCant).padStart(7) + '   delta ' + mil(d.difCant).padStart(7) +
                    ' pallets   ' + uf5(d.difUF).padStart(11) + ' UF' +
                    (d.ovs.length ? '   OV ' + d.ovs.join(',') : '   SIN LINEA DE EMISION'));
    }
    const faltantes = dd.filter(d => d.difCant < 0);
    if (faltantes.length) {
      let uf = 0, pal = 0;
      for (const d of faltantes) { uf += d.difUF; pal -= d.difCant; }
      console.log('\n  semanas con pallets movidos y no facturados: ' + faltantes.length +
                  '   ·  ' + mil(pal) + ' pallets   ·  ' + uf5(uf) + ' UF');
    }
  }

  const dentro = cmp.comparables.filter(c => Math.abs(c.pct) <= 0.5).length;
  console.log('\n  clientes comparables: ' + cmp.comparables.length + '   ·  calzan dentro del 0,5%: ' + dentro +
              '   ·  con un solo lado: ' + cmp.unLado.length);
  console.log('  TOTAL nuestro ' + uf5(nuUF) + ' UF   contra OV ' + uf5(ovUF) + ' UF   ·  dif ' +
              uf5(ovUF - nuUF) + ' UF' + (nuUF ? '  (' + ((ovUF - nuUF) / nuUF * 100).toFixed(2) + '%)' : ''));
  if (sel.excluidos.size)
    console.log('\n  OJO: ' + sel.excluidos.size + ' periodo(s) quedaron fuera por falta de movimientos. ' +
                'El total de arriba NO es el mes completo.');
  if (duplicadas.length)
    console.log('\n  OJO: ' + duplicadas.length + ' (cliente, periodo) quedaron fuera por OV duplicada. ' +
                'El total de arriba NO cubre esas semanas.');

  // ¿La OV cobro nuestro neto, o su valor absoluto?
  if (estaPresente(args, 'por-tarifa'))
    for (const l of informeSignos(analisisSignos(nu.porCliente, ov.porCliente), TOPE)) console.log(l);

  // Detalle de un cliente: documento por documento, los dos lados.
  const pedido = opcion('cliente', null);
  if (pedido) {
    const cods = [...new Set([...nu.porCliente.values(), ...ov.porCliente.values()]
      .filter(r => r.cod === pedido || r.nom.toUpperCase().indexOf(pedido.toUpperCase()) >= 0)
      .map(r => r.cod))];
    if (!cods.length) { console.log('\nNingun cliente calza con "' + pedido + '"'); return; }
    for (const cod of cods) {
      const r = nu.porCliente.get(cod) || ov.porCliente.get(cod);
      console.log('\n── DETALLE · ' + r.nom + ' [' + cod + '] ' + '─'.repeat(20));
      console.log('  NUESTRO LADO');
      console.log('    ' + 'fecha'.padEnd(12) + 'docNum'.padStart(9) + 'cant'.padStart(9) +
                  'tarifa'.padStart(11) + 'UF'.padStart(12) + '   periodo / estado');
      const propios = (per.porCliente.get(cod) || { usables: new Map() }).usables;
      for (const d of detalleNuestro(movFilas, cod, propios, campoFecha, opt))
        console.log('    ' + String(d.fecha).padEnd(12) + String(d.docNum).padStart(9) +
                    mil(d.cant).padStart(9) + String(d.tarifa).padStart(11) + uf5(d.uf).padStart(12) +
                    '   ' + (d.periodo || 'FUERA DEL UNIVERSO') + '  ' + d.estado);
      console.log('  LADO OV');
      console.log('    ' + 'periodo'.padEnd(26) + 'docNum'.padStart(9) + 'cant'.padStart(9) +
                  'precio'.padStart(12) + 'UF'.padStart(12) + '   itemCode');
      for (const l of detalleOV(docsOV, cod, propios, re))
        console.log('    ' + String(l.periodo).padEnd(26) + String(l.docNum).padStart(9) +
                    mil(l.cant).padStart(9) + mil(l.precio).padStart(12) +
                    (l.uf == null ? 'sin TC' : uf5(l.uf)).padStart(12) +
                    '   ' + l.itemCode + (l.usable ? '' : '   (periodo fuera del universo)'));
    }
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}

module.exports = { norm, iso, parseTC, parsePeriodo, variante, variantes, cerca,
                   mesSiguiente, mesAnterior, finDeMes, mesesEntre, clave,
                   rangoDeMeses, periodosPorCliente, solapes, resolverCortes, vistaGlobal, periodoDe, periodosDe,
                   resolverDuplicadas, informeDuplicadas,
                   esSi, estadoDoc, filtrarAnuladas, informeAnuladas,
                   sondaFechas, estadoDe, analisisSolape, AMBIGUO,
                   agregarNuestro, agregarOV, comparar, descuadres, serviciosDe,
                   netosPorTarifa, combinacionDeSignos, analisisSignos, informeSignos,
                   avisoBlobsOV, MAX_TARIFAS_SIGNO,
                   itemCodesDelPatron, opcionesDesconocidas, OPCIONES, BANDERAS,
                   leerOpcion, estaPresente,
                   detalleNuestro, detalleOV, VARIANTES, TC_MIN };
