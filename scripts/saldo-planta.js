// ============================================================================
//  scripts/saldo-planta.js  ·  M3DATA · el stock de PLANTA, dia por dia
//
//  QUE CONTESTA. Cuanto pallet hay en cada etapa de planta —inspeccion,
//  reparacion, pintura, disponible— al CIERRE de cada dia, y por donde paso
//  para llegar ahi. O sea: como se disponibiliza el pallet.
//
//  POR QUE NO EXISTIA. Las bodegas de planta no manejan ubicaciones, y la
//  extraccion solo guardaba filas de asignacion de ubicacion: de la planta no
//  teniamos un solo movimiento. Habia que pedirselo a Datawalt, que lee OINM
//  y registra UNA FILA POR BODEGA sin decir de donde vino el pallet —asi que
//  la cadena no se podia dibujar— y encima con la replica atrasada: su
//  27-oct daba CERO salidas en una bodega que despacha 4.000 por dia.
//  Desde el 28-oct-2026 la extraccion guarda el movimiento de bodega por
//  linea en lineasbod/<mes>.json, y esto lo lee.
//
//  EL CIERRE ES AL TERMINO DEL DIA, no a la hora de la corrida. En SAP la
//  fecha del movimiento es FECHA, sin hora: restando del nivel de hoy todos
//  los movimientos posteriores a un dia queda el cierre de ese dia completo,
//  se hayan posteado a las 9 o a las 23. La consecuencia hay que decirla: el
//  cierre de un dia queda FIRME recien al dia siguiente. El ultimo dia de la
//  serie es el dia en curso y va marcado como parcial.
//
//  LA APERTURA DE UN DIA ES EL CIERRE DEL ANTERIOR, por construccion. Se
//  declara igual, para que la igualdad se pueda ver y no haya que creerla.
//
//  SOLO LEE. No escribe en SAP; escribe un json local si se le pide.
//
//  Credenciales SOLO por variable de entorno.
//      OS_STORAGE_CONN
//
//  Uso (PowerShell):
//    node scripts/saldo-planta.js --meses=2026-10
//    node scripts/saldo-planta.js --meses=2026-09,2026-10 --json=data/planta.json
//    node scripts/saldo-planta.js --meses=2026-10 --bodegas=data/bodegas-hoy.json
// ============================================================================
'use strict';

const P = require('./saldo-pool.js');                          // cierreDelDia, sinBom
const A = require('./armar-tablero-stock.js');                 // NUEVE: una regla, un lugar
const L = require('../backfill/sonda-planta-lineas.js');       // netoPorBodega, leyDeDosPuntas

const args = process.argv.slice(2);
const OPCIONES = ['meses', 'bodegas', 'json', 'tope', 'contraste', 'fecha'];
const BANDERAS = ['cadena'];
const opcion = (n, d) => { const p = '--' + n + '='; for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length); return d; };
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** LAS BODEGAS DE PLANTA SON "TODO LO DEMAS", no una lista.
 *
 *  Clientes y retail estan afuera porque tienen ubicaciones y ya se miden por
 *  socio. El resto es REDTEC. Definirlo por exclusion y no por lista es lo
 *  que hace que una bodega nueva entre sola el dia que aparezca, en vez de
 *  quedarse invisible hasta que alguien se acuerde de agregarla. */
function bodegasDePlanta(bodegasHoy) {
  const out = [];
  for (const b of ((bodegasHoy && bodegasHoy.bodegas) || [])) {
    const whs = (b && b.whs != null) ? String(b.whs).trim() : '';
    if (!whs || whs === 'CLIENTES' || whs === 'RETAIL') continue;
    out.push({ whs, nombre: String((b && b.nombre) || whs),
               nivel: Number(b && b.saldo) || 0, indicador: A.NUEVE.has(whs) });
  }
  return out.sort((x, y) => y.nivel - x.nivel || (x.whs < y.whs ? -1 : 1));
}

/** EL MOVIMIENTO DE UNA BODEGA, DIA POR DIA, desde las lineas.
 *
 *  Misma forma que la serie de saldo-pool —dia, entradas, salidas, neto— para
 *  que cierreDelDia() sirva igual para las dos y la caminata hacia atras no
 *  este escrita dos veces. */
function movimientoDeBodega(lineas, whs, campo) {
  const w = String(whs == null ? '' : whs).trim();
  const f = String(campo || 'DocDate');
  const m = new Map();
  // Sin guardia para w vacio a proposito: una bodega vacia no calza con
  // ninguna punta y el bucle devuelve la lista vacia solo. Un if aparte seria
  // codigo que nunca decide nada.
  for (const l of (lineas || [])) {
    if (!l) continue;
    const d = String(l[f] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const q = Number(l.cantidad) || 0;
    const entra = l.hacia === w, sale = l.desde === w;
    if (!entra && !sale) continue;
    const e = m.get(d) || { dia: d, entradas: 0, salidas: 0, neto: 0, lineas: 0 };
    // Una linea de la bodega a si misma —un traspaso interno— entra y sale: no
    // mueve el nivel y no tiene por que ensuciar ni entradas ni salidas.
    if (entra && sale) { e.lineas++; m.set(d, e); continue; }
    if (entra) { e.entradas += q; e.neto += q; } else { e.salidas += q; e.neto -= q; }
    e.lineas++;
    m.set(d, e);
  }
  return [...m.values()].sort((a, b) => a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0);
}

/** MARCA CUAL CIERRE ES FIRME. El de un dia ya pasado lo es; el del dia en
 *  curso no, porque todavia le pueden entrar movimientos. Decirlo es la
 *  diferencia entre un cierre y una foto de las cinco de la tarde. */
function marcarFirmes(serie, fechaAncla) {
  const f = String(fechaAncla || '').slice(0, 10);
  return (serie || []).map(d => ({ ...d, firme: /^\d{4}-\d{2}-\d{2}$/.test(f) ? d.dia < f : null }));
}

/** LA CADENA: las aristas que tocan la planta, partidas en tres.
 *
 *  Adentro son los pasos entre etapas —lo que responde como se disponibiliza
 *  el pallet—. Las que entran y las que salen son la frontera con clientes y
 *  retail. Mezclarlas daria un numero mas grande que no significa nada. */
function cadenaDePlanta(lineas, conjunto) {
  const s = conjunto instanceof Set ? conjunto : new Set(conjunto || []);
  const m = new Map();
  let sinFecha = 0;
  for (const l of (lineas || [])) {
    if (!l) continue;
    // Misma puerta que movimientoDeBodega: una linea sin fecha utilizable no
    // se puede poner en ningun dia. Si la cadena la contara igual, los totales
    // de las dos vistas no cerrarian y nadie sabria por que.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.DocDate || '').slice(0, 10))) { sinFecha++; continue; }
    const dentroD = l.desde != null && s.has(l.desde);
    const dentroH = l.hacia != null && s.has(l.hacia);
    if (!dentroD && !dentroH) continue;
    const tipo = dentroD && dentroH ? 'adentro' : (dentroH ? 'entra' : 'sale');
    const k = tipo + '|' + (l.desde || '(fuera)') + '|' + (l.hacia || '(fuera)');
    const e = m.get(k) || { tipo, desde: l.desde, hacia: l.hacia, lineas: 0, cantidad: 0 };
    e.lineas++; e.cantidad += Number(l.cantidad) || 0;
    m.set(k, e);
  }
  const todas = [...m.values()].sort((a, b) => b.cantidad - a.cantidad ||
      ((a.desde || '') + (a.hacia || '') < (b.desde || '') + (b.hacia || '') ? -1 : 1));
  const suma = t => todas.filter(x => x.tipo === t).reduce((a, x) => a + x.cantidad, 0);
  return { aristas: todas, adentro: suma('adentro'), entra: suma('entra'), sale: suma('sale'), sinFecha };
}

/** UN NIVEL NEGATIVO ES IMPOSIBLE y es el unico control que encuentra un
 *  error sin segunda fuente: una bodega no puede tener menos de cero. */
function nivelesImposibles(series) {
  const out = [];
  for (const s of (series || [])) {
    let peor = null;
    for (const d of (s.dias || [])) if (peor === null || d.cierre < peor.cierre) peor = d;
    if (peor && peor.cierre < 0) out.push({ whs: s.whs, nombre: s.nombre, cierre: peor.cierre, dia: peor.dia });
  }
  return out.sort((a, b) => a.cierre - b.cierre);
}

/*  QUE FECHA MANDA LA SERIE DE PLANTA.
 *
 *  La de CREACION, porque la pregunta que contesta la planta es "¿cuantos
 *  pallets hay aca?" y el pallet sale de la bodega cuando se crea el
 *  documento, no cuando el cliente lo recibe. La de documento es la contable
 *  y es la correcta para clientes y retail, donde lo que importa es desde
 *  cuando se cobra arriendo.
 *
 *  Pero no se puede usar una fecha que el dato no trae. Mientras los blobs no
 *  se re-extraigan con la fecha de creacion, la serie sigue saliendo por fecha
 *  de documento Y SE DICE: una serie que cambia de significado sin avisar es
 *  peor que una que no cambia. */
function fechaQueManda(cobertura, pedida) {
  const c = cobertura || {};
  if (pedida === 'DocDate' || pedida === 'CreaDate')
    return { campo: pedida, porDefecto: false,
             motivo: 'la fecha la forzo quien corrio el calculo: ' + pedida };
  if (c.completa)
    return { campo: 'CreaDate', porDefecto: true, motivo: null };
  if (c.conCrea > 0)
    return { campo: 'DocDate', porDefecto: true,
             motivo: 'solo ' + c.conCrea + ' de ' + c.lineas + ' lineas traen fecha de creacion, ' +
                     'asi que la serie sale por fecha de documento. Mezclar las dos daria una serie ' +
                     'que no es ninguna de las dos' };
  return { campo: 'DocDate', porDefecto: true,
           motivo: 'ninguna linea trae fecha de creacion todavia: la serie sale por fecha de ' +
                   'documento, que es la contable y no la de la planta. Se arregla re-extrayendo' };
}

/*  EL TRANSITO: LOS PALLETS QUE ESTAN EN EL AIRE.
 *
 *  Una emision a cliente se CREA el dia en que el pallet sale de la bodega de
 *  planta —el camion puede seguir estacionado en el patio, pero sistemicamente
 *  ya salio— y se FECHA el dia en que el cliente la recibe, que es desde
 *  cuando se le cobra arriendo. Entre una cosa y la otra el pallet no cuenta
 *  en planta por fecha de creacion y si cuenta por fecha de documento.
 *
 *  Esa diferencia tiene nombre en REDTEC y hasta ahora no tenia numero:
 *
 *      planta (fecha de documento)  =  planta (fecha de creacion)  +  transito
 *             100                   =             20               +    80
 *
 *  Se cuenta el NETO sobre las nueve: una linea que sale de planta suma al
 *  transito, una que entra resta, y una que va de una estacion a otra no mueve
 *  el total y no entra. Un traspaso interno pendiente cambia el reparto entre
 *  estaciones, no cuantos pallets hay en planta.
 *
 *  SIN LAS DOS FECHAS NO SE PUEDE MEDIR, y eso se dice: devolver cero cuando
 *  no se sabe es peor que no devolver nada, porque un cero se publica como si
 *  significara "no hay nada en el aire". */
/*  CUANTAS LINEAS DEL TRANSITO SE GUARDAN. El detalle viaja hasta la pagina
 *  dentro de datos-stock.json, asi que no puede crecer sin tope. Diez alcanzan
 *  para explicar el numero: van ordenadas de mayor a menor y el resto se
 *  anuncia por su cuenta. */
const TOPE_DETALLE = 10;

function enTransito(lineas, hasta, conjunto) {
  const dia = x => { const t = String(x == null ? '' : x).slice(0, 10);
                     return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
  const corte = dia(hasta);
  const dentro = c => !!(conjunto && (conjunto.has ? conjunto.has(c) : conjunto.indexOf(c) >= 0));
  const ls = Array.isArray(lineas) ? lineas : [];
  let conCrea = 0;
  for (const l of ls) if (l && dia(l.CreaDate)) conCrea++;
  if (!corte)
    return { medible: false, pallets: null, lineas: 0, conCrea,
             motivo: 'no se puede medir el transito: la fecha de corte no es una fecha' };
  // El dato viejo no trae fecha de creacion. Mientras no se re-extraiga, el
  // transito no se puede saber, y la pagina tiene que decirlo en vez de
  // publicar un cero que se leeria como "no hay nada en el aire".
  if (!conCrea)
    return { medible: false, pallets: null, lineas: 0, conCrea: 0,
             motivo: 'ninguna linea trae fecha de creacion: el transito no se puede medir ' +
                     'hasta que se re-extraiga guardandola' };
  let pallets = 0, n = 0, sinFecha = 0;
  const det = [];
  for (const l of ls) {
    if (!l) continue;
    const c = dia(l.CreaDate), d = dia(l.DocDate);
    // Creada y sin fecha de documento utilizable: salio de la bodega y no
    // tiene dia de llegada. No se puede ubicar en el tiempo, asi que no entra
    // al numero — pero se cuenta, porque es un pallet en el aire sin fecha de
    // aterrizaje y eso es lo contrario de un detalle.
    if (c && !d) { sinFecha++; continue; }
    if (!c || !d) continue;
    if (!(c <= corte && d > corte)) continue;
    const sale = dentro(l.desde), entra = dentro(l.hacia);
    if (sale === entra) continue;              // interna o ajena: no mueve el total
    const q = sale ? (Number(l.cantidad) || 0) : -(Number(l.cantidad) || 0);
    pallets += q;
    n++;
    // DE DONDE SALE Y A DONDE VA. "540 pallets en el aire" no se puede
    // perseguir; "540 de RT13-105 a CLIENTES, documento 695061, creado el 3 y
    // fechado el 4" se busca en SAP en diez segundos. El numero sin esto
    // obliga a creerle o a ignorarlo, que son las dos malas opciones.
    //
    // LA BODEGA DE DESTINO NO ES EL CLIENTE: el socio vive en la ubicacion
    // (el bin), que esta en binmov y no en esta linea. Hasta aca llega lo que
    // se puede decir sin inventar.
    det.push({ doc: l.DocEntry == null ? null : l.DocEntry,
               num: l.DocNum == null ? null : l.DocNum,
               desde: l.desde || null, hacia: l.hacia || null,
               cantidad: q, crea: c, llega: d });
  }
  // Las mas grandes primero, que son las que explican el numero; el empate se
  // rompe por DocEntry para que dos corridas del mismo dato impriman igual.
  det.sort((x, y) => (Math.abs(y.cantidad) - Math.abs(x.cantidad)) || (Number(x.doc) - Number(y.doc)));
  return { medible: true, pallets, lineas: n, conCrea, sinFecha,
           detalle: det.slice(0, TOPE_DETALLE),
           motivo: sinFecha ? sinFecha + ' linea(s) creadas sin fecha de documento utilizable: ' +
                              'salieron de la bodega y no tienen dia de llegada' : null };
}

/*  CUANTAS LINEAS TRAEN CADA FECHA. Mientras la re-extraccion no pase por
 *  todos los meses va a haber blobs con las dos y blobs con una sola, y la
 *  pagina no puede mezclarlos sin decirlo. */
function coberturaDeFechas(lineas) {
  const ls = Array.isArray(lineas) ? lineas : [];
  const ok = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x == null ? '' : x).slice(0, 10));
  let conDoc = 0, conCrea = 0, conLasDos = 0;
  for (const l of ls) {
    if (!l) continue;
    const d = ok(l.DocDate), c = ok(l.CreaDate);
    if (d) conDoc++;
    if (c) conCrea++;
    if (d && c) conLasDos++;
  }
  return { lineas: ls.length, conDoc, conCrea, conLasDos,
           completa: ls.length > 0 && conLasDos === ls.length };
}

/** UNA APERTURA NEGATIVA ES OTRA COSA QUE UN CIERRE NEGATIVO.
 *
 *  Un cierre bajo cero ya lo sabemos explicar: es la FECHA del documento, SAP
 *  lo reproduce por su cuenta y se arregla en SAP. Una apertura bajo cero no:
 *  la apertura del primer dia de la ventana no se mide, se DESPEJA
 *
 *      apertura = saldo vivo - todo el movimiento de la ventana
 *
 *  y por eso es el residuo donde cae cualquier diferencia entre el saldo y las
 *  lineas: movimiento con fecha fuera de la ventana, o lineas y ancla leidas
 *  en instantes distintos. El residuo no avisa, corre TODA la serie hacia
 *  arriba o hacia abajo por igual, y lo unico que delata que esta corrido es
 *  que la apertura quede en negativo, porque un nivel no puede ser negativo.
 *
 *  Es el control mas barato que tenemos contra ese error y el unico que no
 *  necesita segunda fuente ni el mes anterior: al 2-11-2026 RT13-100 abria
 *  octubre en -3.334, o sea su serie del mes estaba corrida por al menos esa
 *  cantidad, y nadie lo estaba mirando. */
function aperturasImposibles(series) {
  const out = [];
  for (const s of (series || [])) {
    const dias = (s && s.dias) || [];
    if (!dias.length) continue;
    const a = Number(dias[0].apertura);
    if (Number.isFinite(a) && a < 0)
      out.push({ whs: s.whs, nombre: s.nombre, apertura: a, dia: dias[0].dia });
  }
  return out.sort((x, y) => x.apertura - y.apertura);
}

/** EL DESFASE ENTRE EL ANCLA Y LAS LINEAS.
 *
 *  La serie se calcula hacia atras desde el saldo vivo restando las lineas, y
 *  eso solo es valido si las dos cosas se leyeron en el MISMO instante. No se
 *  leen en el mismo instante: las lineas salen de un blob que escribio la
 *  extraccion y el ancla de una lectura posterior. Todo documento posteado
 *  entre las dos aparece en una y no en la otra, y la diferencia no se
 *  reporta: se hunde en la apertura.
 *
 *  Esto no corrige nada. Mide la exposicion y la deja escrita en el json, que
 *  es lo que hoy no existe: el desfase se imprimia en consola y se perdia. El
 *  tamano del error de verdad lo dice la apertura negativa; esto dice cuanta
 *  ventana hubo para cometerlo.
 *
 *  Las lineas MAS NUEVAS que el ancla es la direccion peligrosa —hay
 *  movimiento en las lineas que el saldo todavia no tiene— pero al reves
 *  tambien corre la serie, asi que se miden las dos. */
function desfaseDeLectura(anclaLeida, lineasGuardadas, topeSegundos) {
  const t = x => { const d = new Date(String(x || '')); return isNaN(d.getTime()) ? null : d.getTime(); };
  const a = t(anclaLeida), l = t(lineasGuardadas);
  const tope = Number(topeSegundos) > 0 ? Number(topeSegundos) : 60;
  if (a === null || l === null)
    return { ok: null, segundos: null, tope,
             motivo: 'no se puede medir el desfase: falta la marca de tiempo de ' +
                     (a === null ? 'el ancla' : 'las lineas') };
  const seg = Math.round((a - l) / 1000);
  if (Math.abs(seg) <= tope) return { ok: true, segundos: seg, tope, motivo: null };
  return { ok: false, segundos: seg, tope,
           motivo: seg > 0
             ? 'el ancla se leyo ' + seg + ' s DESPUES que las lineas: un documento posteado en ese ' +
               'rato esta en el saldo y no en las lineas, y la diferencia se va entera a la apertura'
             : 'las lineas se guardaron ' + (-seg) + ' s DESPUES que el ancla: traen movimiento que el ' +
               'saldo todavia no tenia, y esa diferencia se va entera a la apertura' };
}

/*  LA LEY DEL POOL, en su forma correcta.
 *
 *  La primera version exigia que la suma de los netos de todas las bodegas
 *  diera CERO, "porque lo que sale de una entra en otra", y con las tres
 *  entidades marcaba revisar con +3.461. Estaba mal el control, no el dato.
 *
 *  Una linea con sus DOS puntas mueve pallets de una bodega a otra: suma +q en
 *  el destino y -q en el origen, asi que netea cero por construccion. Una
 *  linea con UNA sola punta —una salida o una entrada de mercancias— aporta su
 *  cantidad una sola vez: ESA es la que mueve el total del pool. Entonces la
 *  suma de todos los netos no es cero: es exactamente el neto de produccion.
 *
 *  Medido el 29-10-2026 contra OINM, octubre del pallet rojo: traspasos
 *  505.048 de entrada y 505.048 de salida —netean cero al pallet— y la
 *  produccion deja +3.101 (101.377 de entrada menos 98.276 de salida).
 *
 *  Lo que este control SI puede fallar: que los traspasos no neteen cero. Eso
 *  si seria una linea mal leida. */
function leyDelPool(lineas) {
  let traspasos = 0, produccion = 0, nTraspaso = 0, nUnaPunta = 0, nSinPunta = 0;
  for (const l of (lineas || [])) {
    if (!l) continue;
    const d = l.desde != null && l.desde !== '', h = l.hacia != null && l.hacia !== '';
    const q = Number(l.cantidad) || 0;
    if (d && h) { nTraspaso++; traspasos += 0; }        // +q en destino y -q en origen
    else if (h) { nUnaPunta++; produccion += q; }
    else if (d) { nUnaPunta++; produccion -= q; }
    else nSinPunta++;
  }
  return { traspasos, produccion, nTraspaso, nUnaPunta, nSinPunta,
           cumple: traspasos === 0 };
}

/** El neto por bodega TIENE que dar el neto de produccion, no cero. Si no da,
 *  hay una linea leida mal: es el unico control de esta familia que puede
 *  fallar de verdad. */
function cuadraturaDelNeto(netos, ley) {
  const suma = (netos || []).reduce((s, x) => s + (Number(x && x.neto) || 0), 0);
  const esperado = Number(ley && ley.produccion) || 0;
  return { suma, esperado, diferencia: suma - esperado, cuadra: suma === esperado };
}

/*  EL ANCLA Y LAS LINEAS TIENEN QUE SER DE LA MISMA CORRIDA.
 *
 *  El nivel se calcula HACIA ATRAS desde el ancla: nivel(t) = ancla menos todo
 *  lo que se movio despues de t. Si el ancla se leyo ANTES del ultimo dia con
 *  movimiento, ese movimiento todavia no estaba en el ancla y restarlo corre
 *  TODA la serie. Visto el 29-10-2026: ancla del 28-10 a las 17:41 con lineas
 *  extraidas el 29-10 a las 14:39, y los cierres de Santiago salieron corridos
 *  contra el nivel que OINM calcula por su cuenta. */
/*  UN DOCUMENTO CON FECHA FUTURA NO CORRE LA SERIE.
 *
 *  Esta prueba comparaba el dia en que se leyo el ancla contra el dia del
 *  movimiento mas nuevo, y daba por corrida la serie cuando el segundo era
 *  posterior. Es un proxy equivocado: el InStock de SAP NO mira la fecha del
 *  documento, cuenta el movimiento apenas se contabiliza, asi que un documento
 *  fechado mañana YA esta adentro del ancla y la serie esta bien calculada.
 *
 *  Medido el 2-11-2026: una salida de 2 pallets en RT13-105 fechada al dia
 *  siguiente marco la serie como corrida y dejo en blanco la distribucion
 *  diaria entera en las dos paginas. Comprobado bodega por bodega, el ultimo
 *  cierre de cada una era exactamente su InStock, incluida esa.
 *
 *  Un documento con fecha futura SI es una anomalia —SAP no deberia aceptarlo—
 *  y por eso se informa, pero como algo que arreglar en SAP, no como un motivo
 *  para no publicar. Quien comprueba de verdad que la serie y el tablero salen
 *  del mismo saldo es cierraEnElAncla(), en armar-tablero-stock.js, que
 *  compara los cierres contra el saldo vivo bodega por bodega. */
function anclaAlDia(fechaAncla, diaMasNuevo) {
  const a = String(fechaAncla || '').slice(0, 10), d = String(diaMasNuevo || '').slice(0, 10);
  const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (!fecha(a)) return { ok: false, motivo: 'el ancla no trae fecha de lectura: no se puede saber si alcanza' };
  if (!fecha(d)) return { ok: true, motivo: null };
  if (a < d) return { ok: true, futuro: true, ancla: a, ultimo: d,
    motivo: 'hay movimiento fechado hasta el ' + d + ' y el ancla se leyo el ' + a +
            '. La serie esta bien: el saldo vivo de SAP ya incluye ese documento, porque el InStock ' +
            'no mira la fecha. Lo que hay que revisar es por que SAP acepto un documento con fecha ' +
            'posterior a hoy' };
  return { ok: true, motivo: null };
}

/*  LO QUE SE ESCRIBE EN EL JSON, aparte de main() para poder probarlo.
 *
 *  El json lleva SU PROPIO VEREDICTO. Sin eso, quien lo consume no tiene como
 *  saber que la serie salio corrida: el aviso se lo lleva la consola y el
 *  archivo se ve igual de sano. Con ancla_al_dia en false, armar-tablero se
 *  niega a dibujarla en vez de publicar numeros que no calzan con el saldo
 *  por bodega de mas arriba. */
function payloadJson(p) {
  const x = p || {};
  const anc = x.ancla || {}, ver = x.veredicto || {};
  return {
    _que_es: 'Stock de planta por bodega y por dia. El cierre de cada dia es al termino del dia; ' +
             'el del dia en curso va con firme:false porque todavia le pueden entrar movimientos.',
    _ojo: anc.ok ? null : 'SERIE CORRIDA: ' + (anc.motivo || 'no se pudo verificar el ancla'),
    generado: x.generado || null,
    ancla: x.anclaLeida || null,
    meses: x.meses || [],
    ancla_al_dia: anc.ok === true,
    veredicto: { nivel: ver.nivel || null, texto: ver.texto || null },
    indicador: Number(x.indicador) || 0,
    fueraDelIndicador: Number(x.fueraDelIndicador) || 0,
    cierreFirme: x.cierreFirme || null,
    aperturas_imposibles: x.aperturasImposibles || [],
    /*  La identidad que une las dos lecturas de la planta:
     *      planta (fecha de documento) = planta (fecha de creacion) + transito
     *  Mientras el transito no sea medible va en null, nunca en cero: un cero
     *  se publica como "no hay nada en el aire", que es una afirmacion. */
    fecha_serie: (x.fecha && x.fecha.campo) || null,
    fecha_serie_porque: (x.fecha && x.fecha.motivo) || null,
    transito: x.transito ? { medible: !!x.transito.medible, pallets: x.transito.pallets,
                             lineas: x.transito.lineas || 0,
                             sin_fecha: x.transito.sinFecha || 0,
                             detalle: x.transito.detalle || [],
                             motivo: x.transito.motivo || null, al: x.transitoAl || null }
                         : { medible: false, pallets: null, lineas: 0, sin_fecha: 0, detalle: [],
                             motivo: 'no se calculo', al: null },
    lectura: {
      ancla: x.anclaLeida || null,
      lineas: x.lineasGuardadas || null,
      desfase_s: (x.desfase && x.desfase.segundos != null) ? x.desfase.segundos : null,
      ok: (x.desfase && x.desfase.ok != null) ? x.desfase.ok : null,
    },
    bodegas: x.bodegas || [],
    cadena: x.cadena || [],
  };
}

function veredicto(series, imposibles, cuad, ancla, aperturas, desfase, fecha, transito) {
  const p = [];
  if (!series || !series.length)
    return { nivel: 'sin datos', texto: 'No hay bodegas de planta con movimiento en la ventana pedida.' };
  if (ancla && ancla.ok === false) p.push('ANCLA: ' + ancla.motivo + '.');
  // Un documento con fecha futura no invalida la serie, pero hay que decirlo:
  // es la misma familia que los niveles negativos —fecha de documento— y se
  // arregla en el mismo lugar.
  else if (ancla && ancla.futuro) p.push('FECHA FUTURA: ' + ancla.motivo + '.');
  // El nivel negativo NO es nuestro: medido el 29-10-2026, el acumulado que
  // OINM calcula por su cuenta tambien da negativo los mismos dias, y en Talca
  // al pallet (-409 el 9-oct en RT07-120, -166 en RT07-126, identicos a los
  // nuestros). Lo que lo produce es la FECHA del documento: la salida de
  // mercancias de inspeccion queda fechada antes que el traspaso que la
  // alimenta. Decir "falta movimiento" manda a buscar donde no hay nada.
  // Un mensaje que dice CINCO y nombra CUATRO se lee como un error de cuenta.
  // Si se corta la lista hay que decir cuantas quedaron fuera.
  if (imposibles && imposibles.length) {
    const TOPE_IMP = 4;
    const sobran = imposibles.length - TOPE_IMP;
    p.push(imposibles.length + ' bodega(s) con nivel NEGATIVO en algun dia: ' +
           imposibles.slice(0, TOPE_IMP).map(x => x.whs + ' (' + mil(x.cierre) + ' el ' + x.dia + ')').join(', ') +
           (sobran > 0 ? ' y ' + sobran + ' mas' : '') +
           '. No es un error del calculo: SAP tiene esos dias en negativo y la causa es la FECHA del ' +
           'documento —la salida de mercancias queda fechada antes que el traspaso que la alimenta—. ' +
           'Se arregla en SAP, no aca.');
  }
  /*  Va DESPUES de los cierres negativos y con otras palabras a proposito:
   *  los dos dicen "negativo" y son problemas distintos. El cierre negativo
   *  es de SAP y se arregla alla; la apertura negativa es NUESTRA, dice que
   *  la serie del mes esta corrida, y se arregla midiendo la apertura en vez
   *  de despejarla. Confundirlos manda a reclamar al lugar equivocado. */
  if (aperturas && aperturas.length) {
    const TOPE_AP = 4;
    const sobran = aperturas.length - TOPE_AP;
    const peor = aperturas[0];
    p.push(aperturas.length + ' bodega(s) ABREN LA VENTANA EN NEGATIVO: ' +
           aperturas.slice(0, TOPE_AP).map(x => x.whs + ' (' + mil(x.apertura) + ' el ' + x.dia + ')').join(', ') +
           (sobran > 0 ? ' y ' + sobran + ' mas' : '') +
           '. Esto NO es la fecha del documento: la apertura no se mide, se despeja como saldo vivo ' +
           'menos el movimiento de la ventana, asi que es el residuo donde cae toda diferencia entre ' +
           'el saldo y las lineas. Que sea negativa significa que la serie de ' + peor.whs + ' esta ' +
           'corrida por al menos ' + mil(-peor.apertura) + ' pallets, y con ella todos sus dias. ' +
           'Se arregla midiendo la apertura, no en SAP.');
  }
  /*  Que la serie salga por una fecha distinta de la que corresponde no es un
   *  error del dato, pero cambia lo que el numero significa, y eso se dice
   *  arriba y no en una nota al pie. */
  if (fecha && fecha.campo === 'DocDate' && fecha.porDefecto && fecha.motivo)
    p.push('FECHA DE LA SERIE: ' + fecha.motivo + '. Mientras tanto el indicador de planta ' +
           'responde "cuantos habia segun la fecha contable", no "cuantos hay en planta".');
  if (transito && transito.medible && transito.sinFecha)
    p.push(transito.sinFecha + ' linea(s) salieron de la bodega sin fecha de documento utilizable: ' +
           'estan en el aire y no tienen dia de llegada.');
  if (desfase && desfase.ok === false)
    p.push('LECTURA DESFASADA: ' + desfase.motivo + '. Es la ventana en que se puede producir la ' +
           'apertura corrida de arriba; cuanto se produjo lo dice la apertura, no esto.');
  if (cuad && cuad.cuadra === false)
    p.push('El neto por bodega da ' + conSigno(cuad.suma) + ' y la produccion del periodo ' +
           conSigno(cuad.esperado) + ': ' + conSigno(cuad.diferencia) + ' sin explicar. ' +
           'Eso si es una linea leida mal.');
  if (!p.length)
    return { nivel: 'si', texto: 'Las ' + series.length + ' bodegas de planta cierran dia a dia sin ' +
             'niveles imposibles, abren la ventana en positivo, los traspasos netean cero y el neto ' +
             'por bodega da exactamente la produccion del periodo.' };
  return { nivel: 'revisar', texto: p.join('  ') };
}

module.exports = { bodegasDePlanta, movimientoDeBodega, marcarFirmes, cadenaDePlanta,
                   nivelesImposibles, aperturasImposibles, desfaseDeLectura,
                   enTransito, coberturaDeFechas, fechaQueManda,
                   leyDelPool, cuadraturaDelNeto, anclaAlDia, payloadJson, veredicto,
                   OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = args.filter(x => String(x).startsWith('--') &&
    !OPCIONES.some(o => String(x).startsWith('--' + o + '=')) && !BANDERAS.some(o => x === '--' + o));
  if (malas.length) { console.error('Opcion no reconocida: ' + malas.join('  ')); process.exit(1); }
  if (!process.env.OS_STORAGE_CONN) {
    console.error('Falta la variable de entorno: OS_STORAGE_CONN');
    console.error('Se declara en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const fs = require('fs');
  const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
  const meses = String(opcion('meses', '')).split(',').map(x => x.trim()).filter(Boolean);
  if (!meses.length) { console.error('Falta --meses=YYYY-MM[,YYYY-MM]'); process.exit(1); }
  const TOPE = Math.max(1, parseInt(opcion('tope', '20'), 10) || 20);

  const rutaBod = opcion('bodegas', 'data/bodegas-hoy.json');
  let bod;
  try { bod = JSON.parse(P.sinBom(fs.readFileSync(rutaBod, 'utf8'))); }
  catch (e) {
    console.error('No se pudo leer ' + rutaBod + ': ' + e.message);
    console.error('Corre antes: node backfill/sonda-oinm-bodega.js --salida=data/bodegas-hoy.json');
    process.exit(1);
  }
  const planta = bodegasDePlanta(bod);
  const fechaAncla = String(bod.generado || '').slice(0, 10);

  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  console.log('Stock de planta dia por dia   ·  meses ' + meses.join(', '));
  console.log('Ancla: ' + rutaBod + ' · leida ' + (bod.generado || '?') + '   ·  ' +
              planta.length + ' bodegas de planta');
  console.log('SOLO LEE. El cierre de cada dia es al TERMINO del dia; el del dia en curso va marcado.\n');

  let lineas = [], lineasGuardadas = null;
  for (const mes of meses) {
    const nombre = 'lineasbod/' + mes + '.json';
    const b = cc.getBlobClient(nombre);
    if (!await b.exists()) {
      console.error('No esta ' + CONT + '/' + nombre + '.');
      console.error('  Ese mes se extrajo antes de que se guardaran las lineas de bodega.');
      console.error('  Corre: node backfill/backfill-sap-bin.js ' + mes + ' ' + mes + ' --forzar');
      process.exit(1);
    }
    const j = JSON.parse((await b.downloadToBuffer()).toString('utf8'));
    const n = (j && j.lineas) || [];
    // La marca del blob se imprimia y se perdia. Es la unica forma de saber
    // cuanta ventana hubo entre leer las lineas y leer el ancla, asi que se
    // guarda: manda la MAS NUEVA, que es la que mas cerca esta del ancla.
    if (j && j._guardado && (!lineasGuardadas || String(j._guardado) > lineasGuardadas))
      lineasGuardadas = String(j._guardado);
    console.log('  ' + nombre + ': ' + mil(n.length) + ' lineas   ·  extraido ' +
                String(j._guardado || '?').slice(0, 16).replace('T', ' '));
    lineas = lineas.concat(n);
  }
  console.log('  total: ' + mil(lineas.length) + ' lineas de bodega\n');

  const conjunto = new Set(planta.map(x => x.whs));
  const cob = coberturaDeFechas(lineas);
  const fec = fechaQueManda(cob, opcion('fecha', null));
  console.log('  fechas por linea: ' + mil(cob.conDoc) + ' con documento · ' + mil(cob.conCrea) +
              ' con creacion   ·  la serie sale por ' + fec.campo);
  if (fec.motivo) console.log('    ' + fec.motivo);
  const series = [];
  for (const b of planta) {
    const mov = movimientoDeBodega(lineas, b.whs, fec.campo);
    if (!mov.length && !b.nivel) continue;
    series.push({ whs: b.whs, nombre: b.nombre, indicador: b.indicador, nivel: b.nivel,
                  dias: marcarFirmes(P.cierreDelDia(mov, b.nivel), fechaAncla) });
  }

  const ultimoFirme = (s) => {
    const f = (s.dias || []).filter(d => d.firme);
    return f.length ? f[f.length - 1] : null;
  };
  console.log('── EL CIERRE FIRME MAS RECIENTE ' + '─'.repeat(42));
  let nueve = 0, resto = 0, diaFirme = null;
  for (const s of series) {
    const u = ultimoFirme(s);
    if (u) { diaFirme = diaFirme && diaFirme > u.dia ? diaFirme : u.dia; }
    const v = u ? u.cierre : s.nivel;
    if (s.indicador) nueve += v; else resto += v;
  }
  console.log('  al cierre del ' + (diaFirme || '?') + '   ·  indicador de planta: ' + mil(nueve) +
              '   ·  fuera del indicador: ' + mil(resto));
  console.log('  ' + 'bodega'.padEnd(12) + 'nombre'.padEnd(24) + 'cierre'.padStart(10) +
              'hoy'.padStart(10) + '   ');
  for (const s of series) {
    const u = ultimoFirme(s);
    console.log('  ' + (s.indicador ? '* ' : '  ') + s.whs.padEnd(10) + s.nombre.slice(0, 23).padEnd(24) +
                (u ? mil(u.cierre) : '—').padStart(10) + mil(s.nivel).padStart(10));
  }

  for (const s of series) {
    if (!s.dias.length) continue;
    console.log('\n── ' + s.whs + ' · ' + s.nombre + ' ' + '─'.repeat(Math.max(0, 50 - s.nombre.length)));
    console.log('  ' + 'dia'.padEnd(13) + 'apertura'.padStart(10) + 'entradas'.padStart(10) +
                'salidas'.padStart(10) + 'cierre'.padStart(10));
    for (const d of s.dias.slice(-TOPE))
      console.log('  ' + d.dia.padEnd(13) + mil(d.apertura).padStart(10) + mil(d.entradas).padStart(10) +
                  mil(d.salidas).padStart(10) + mil(d.cierre).padStart(10) +
                  (d.firme === false ? '   ← dia en curso, parcial' : ''));
  }

  if (bandera('cadena')) {
    const c = cadenaDePlanta(lineas, conjunto);
    console.log('\n── LA CADENA ' + '─'.repeat(61));
    console.log('  entra a planta: ' + mil(c.entra) + '   ·  entre etapas: ' + mil(c.adentro) +
                '   ·  sale de planta: ' + mil(c.sale) +
                (c.sinFecha ? '   ·  ' + mil(c.sinFecha) + ' linea(s) sin fecha utilizable, fuera' : ''));
    console.log('  ' + 'tipo'.padEnd(10) + 'origen'.padEnd(12) + 'destino'.padEnd(12) +
                'lineas'.padStart(8) + 'pallets'.padStart(11));
    for (const a of c.aristas.slice(0, TOPE))
      console.log('  ' + a.tipo.padEnd(10) + String(a.desde || '(fuera)').padEnd(12) +
                  String(a.hacia || '(fuera)').padEnd(12) + mil(a.lineas).padStart(8) +
                  mil(a.cantidad).padStart(11));
  }

  // CONTRASTE: el mismo calculo sobre RETAIL, que ya medimos por otro camino.
  // Si no calza, lo de planta tampoco vale, y es mejor saberlo aca.
  const ruta = opcion('contraste', 'data/stock-retail.json');
  try {
    const sr = JSON.parse(P.sinBom(fs.readFileSync(ruta, 'utf8')));
    const mov = movimientoDeBodega(lineas, 'RETAIL');
    const porDia = new Map(mov.map(d => [d.dia, d]));
    let comparados = 0, distintos = [];
    for (const d of (sr.dias || [])) {
      const m = porDia.get(d.dia);
      if (!m) continue;
      comparados++;
      if (m.neto !== d.neto) distintos.push({ dia: d.dia, lineas: m.neto, ubicaciones: d.neto });
    }
    console.log('\n── CONTRASTE CONTRA LA CAPA DE UBICACIONES ' + '─'.repeat(31));
    console.log('  RETAIL, ' + mil(comparados) + ' dia(s) comparados contra ' + ruta);
    if (!distintos.length) console.log('  los ' + mil(comparados) + ' dias dan el mismo neto por los dos caminos');
    else {
      console.log('  ' + mil(distintos.length) + ' dia(s) NO calzan:');
      for (const x of distintos.slice(0, 10))
        console.log('     ' + x.dia + '   lineas ' + conSigno(x.lineas) + '   ubicaciones ' + conSigno(x.ubicaciones));
    }
  } catch (e) { console.log('\n  (sin contraste: no se pudo leer ' + ruta + ')'); }

  const ley = leyDelPool(lineas);
  const cuad = cuadraturaDelNeto(L.netoPorBodega(lineas), ley);
  const diaMasNuevo = lineas.reduce((m, l) => {
    const d = String((l && l.DocDate) || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > m ? d : m;
  }, '');
  const anc = anclaAlDia(fechaAncla, diaMasNuevo);
  // El transito se mide al ultimo dia FIRME: el dia en curso todavia tiene
  // camiones saliendo y el numero cambiaria cada vez que se mira.
  const transitoAl = diaFirme || fechaAncla;
  const tra = enTransito(lineas, transitoAl, conjunto);
  const imp = nivelesImposibles(series);
  const ape = aperturasImposibles(series);
  const des = desfaseDeLectura(bod.generado, lineasGuardadas);
  const v = veredicto(series, imp, cuad, anc, ape, des, fec, tra);

  console.log('\n── LA LEY DEL POOL ' + '─'.repeat(55));
  console.log('  traspasos: ' + mil(ley.nTraspaso) + ' lineas con las dos puntas · netean ' +
              conSigno(ley.traspasos) + ' (tienen que netear cero, siempre)');
  console.log('  produccion: ' + mil(ley.nUnaPunta) + ' lineas con una sola punta · neto ' +
              conSigno(ley.produccion) + ' (esto es lo UNICO que mueve el total del pool)');
  console.log('  el neto por bodega da ' + conSigno(cuad.suma) + ' contra ' + conSigno(cuad.esperado) +
              ' esperado: ' + (cuad.cuadra ? 'cuadra' : conSigno(cuad.diferencia) + ' SIN EXPLICAR') +
              (ley.nSinPunta ? '   ·  ' + mil(ley.nSinPunta) + ' linea(s) sin ninguna bodega' : ''));

  console.log('\n── LA LECTURA ' + '─'.repeat(60));
  console.log('  ancla leida  ' + (bod.generado || '?'));
  console.log('  lineas desde ' + (lineasGuardadas || '?'));
  console.log('  desfase      ' + (des.segundos == null ? 'no medible' :
    des.segundos + ' s' + (des.ok ? '  (dentro del tope de ' + des.tope + ' s)' : '  ← FUERA DE TOPE')));
  console.log('\n── LA APERTURA DE LA VENTANA ' + '─'.repeat(45));
  console.log('  La apertura no se mide: se despeja. Una negativa dice que la serie esta corrida.');
  if (!ape.length) console.log('  las ' + series.length + ' bodegas abren en positivo');
  else for (const x of ape)
    console.log('  ' + x.whs.padEnd(10) + x.nombre.slice(0, 23).padEnd(24) +
                mil(x.apertura).padStart(10) + '   el ' + x.dia + '   ← imposible');

  console.log('\n── EN TRANSITO ' + '─'.repeat(59));
  console.log('  Pallets que ya salieron de la bodega y que el cliente todavia no recibe.');
  if (!tra.medible) console.log('  no se puede medir: ' + tra.motivo);
  else {
    console.log('  al cierre del ' + transitoAl + ':  ' + mil(tra.pallets) + ' pallets en ' +
                mil(tra.lineas) + ' linea(s)');
    console.log('  planta por fecha de documento = planta por fecha de creacion + ' + mil(tra.pallets));
    if (tra.sinFecha) console.log('  ' + mil(tra.sinFecha) + ' linea(s) sin fecha de documento utilizable');
    if (tra.detalle && tra.detalle.length) {
      console.log('  De donde sale y a donde va. La bodega de destino NO es el cliente:');
      console.log('  el socio vive en la ubicacion, y la ubicacion no viene en esta linea.');
      for (const x of tra.detalle)
        console.log('     ' + String(x.desde || '—').padEnd(11) + '→ ' + String(x.hacia || '—').padEnd(11) +
                    mil(x.cantidad).padStart(9) + '   doc ' + (x.num == null ? x.doc : x.num) +
                    '   creado ' + x.crea + ' · llega ' + x.llega);
      if (tra.lineas > tra.detalle.length)
        console.log('     (y ' + mil(tra.lineas - tra.detalle.length) + ' linea(s) mas)');
    }
  }

  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);

  const salida = opcion('json', null);
  if (salida) {
    fs.writeFileSync(salida, JSON.stringify(payloadJson({
      generado: new Date().toISOString(), anclaLeida: bod.generado || null, meses,
      ancla: anc, veredicto: v,
      indicador: nueve, fueraDelIndicador: resto, cierreFirme: diaFirme,
      aperturasImposibles: ape, lineasGuardadas, desfase: des,
      fecha: fec, transito: tra, transitoAl,
      bodegas: series, cadena: cadenaDePlanta(lineas, conjunto).aristas,
    }), null, 1), 'utf8');
    console.log('\n  escrito: ' + salida);
  }
  console.log('');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
