/**
 * guias-fetch.js — lado REDTEC del cruce: lo que el camión declara llevar.
 *
 * FUENTE: RDTOut /api/RDTOut/OpsXRangoFechas, el MISMO endpoint que ya usan
 * m3link-viajes-proxy, consulta-transporte y transportes-pagos. No hace falta
 * un endpoint nuevo: cada viaje ya trae patente, chofer, cantidad y documento.
 * Se respeta el contrato fechaInicial/fechaFinal que usa consulta-transporte.
 *
 * Los nombres de campo salen del mapeo ya probado en shared/consulta-transporte.js
 * (procesarViaje), así que no son inventados: cantidadConfirmada, patente, chofer,
 * dteNro, clienteDestinoStr, bodegaDestinoStr, operacion, fechaConfirmacion.
 *
 * ── LO QUE SE MIDIÓ EN PRODUCCIÓN (26 y 27 de agosto de 2026) ────────────────
 *
 *  · RDTOut IGNORA el rango pedido: consultando un solo día devolvió 18.679
 *    filas repartidas entre el 25-06 y el 26-08. El recorte por fecha es
 *    obligatorio y se hace más abajo.
 *  · horaIngreso es el único campo con hora real. fechaDespacho y
 *    fechaConfirmacion llegan siempre a medianoche.
 *  · La PATENTE aparece recién en la etapa "Inspeccion Retiro": de 8 retiros
 *    con patente, los 8 estaban en esa etapa, y ninguno de los 12 en etapa
 *    "Solicitud" la traía. Es decir, la patente se llena cuando el camión ya
 *    llegó — que es justo cuando pasa por el túnel.
 *  · Solicitado y confirmado difieren seguido, y ahí está el valor del cruce:
 *    RW5303 pidió 512 y se confirmaron 480; LS3119 pidió 320 y se confirmaron
 *    319; VG1943 pidió 300 y se confirmaron 396.
 */

/* Ya no se usan: este módulo dejó de llamar a RDTOut el 2-nov-2026 y ahora lee
   del almacén frío y de la consulta viva (ver traerFilas). Se dejan nombrados
   para que quede escrito de dónde venía el dato antes y nadie los reinvente. */
// const OPS_HOST = 'https://apirdt1.azurewebsites.net';
// const OPS_PATH = '/api/RDTOut/OpsXRangoFechas';

/**
 * Pallets por fila. Confirmado por dos vías independientes:
 *  - la carga real C920 (patente BJCL13): 14 filas, 251 pallets;
 *  - el catálogo de flota de consulta-transporte: BJCL13 tiene capacidad 252,
 *    y 252 = 14 x 18, igual que los camiones de 540 = 30 x 18.
 * Con esto el monitor puede señalar la fila corta sin depender de que la guía
 * declare cuántas filas lleva el camión.
 */
const PALLETS_POR_FILA = Number(process.env.PALLETS_POR_FILA) || 18;

/**
 * Operaciones que se consideran. Vacío = todas.
 *
 * OJO: no filtrar por operación es el default a propósito. Medido el 26-08-2026,
 * de 597 viajes del día sólo 11 traían patente, y ninguno era Emisión: 8 Retiro
 * y 3 Devolución. El túnel está viendo retiros e inspecciones, no despachos, así
 * que filtrar por 'Emision' dejaba el cruce en cero. Traer patente ya es el filtro
 * relevante. Para acotarlo, poner la app setting OPERACIONES_DESPACHO con la lista
 * separada por comas una vez que operaciones confirme cuáles pasan por el túnel.
 */
const OPERACIONES_DESPACHO = (process.env.OPERACIONES_DESPACHO || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Clasifica la operación. El tablero trata distinto cada tipo:
 *  - emision:        el camión SALE con carga; se compara contra lo declarado.
 *  - retiro:         el camión LLEGA con pallets del cliente; se compara contra
 *                    la solicitud de retiro y lo confirmado en la inspección.
 *  - devolucion:     tampoco es un despacho; se marca para que nadie la lea así.
 *  - relocalizacion: traslado de pallets ENTRE DEPENDENCIAS DE REDTEC. El camión
 *                    no sale de la planta, así que no hay nada que cruzar.
 */
function clasificar(op, dteNro) {
  const o = (op || '').trim().toLowerCase();

  // RELOCALIZACIÓN INTERNA — va ANTES del DTE, y es a propósito.
  //
  // Un traslado entre dependencias de REDTEC también emite documento de
  // traslado, así que dteNro > 0 lo hacía caer en 'emision' y el monitor de
  // andén lo cruzaba contra el conteo de la cámara como si fuera un despacho:
  // cada relocalización terminaba en rojo — faltante, sobrante o directamente
  // "camión sin guía" — y con correo a operaciones. No es un despacho: el
  // vehículo no abandona las instalaciones.
  //
  // El fragmento 'relocaliz' cubre tanto "Relocalización" como "Relocalizacion"
  // porque el acento viene después, y es exactamente el mismo criterio que ya
  // usan m3link_dashboard_dark.html, top10.html y semaforo-gerencial.html
  // ("Traslados internos entre recintos REDTEC"). En la cartola esta operación
  // llega con netoCLP = 0: no se factura porque no se vende nada.
  if (o.indexOf('relocaliz') >= 0) return 'relocalizacion';

  // El DTE es la señal dura: las emisiones generan documento (serie 72xxx,
  // incremental) y llegan con dteNro > 0; los retiros y devoluciones traen
  // dteNro en 0 y se identifican por nroDocumento. Se ve nítido en los datos:
  // el pedido 4087445 (emisión) trae dte 72137 y documento vacío, mientras el
  // 4106282 (retiro) trae dte 0 y documento 80717024.
  if (Number(dteNro) > 0) return 'emision';
  if (o.startsWith('emision')) return 'emision';
  if (o.startsWith('retiro')) return 'retiro';
  if (o.startsWith('devolucion')) return 'devolucion';
  return 'otro';
}

// Patentes fuera del alcance del túnel de Santiago (Talca y la de pruebas).
// El catálogo vive en flota.js para que el lado cámara y el lado guía apliquen
// exactamente el mismo criterio.
const { patenteEnAlcance } = require('./flota');
const cold = require('./cold-operaciones.js');
const { consultarOps } = require('./ops-fetch.js');

/* Cuántos días hacia atrás se le piden a la consulta VIVA. Redlink filtra por
   fecha de INGRESO, así que un día basta para pescar lo que se cargó anoche
   para salir hoy; lo anterior ya vive en el almacén frío. */
const VIVO_DIAS = Math.max(0, Number(process.env.GUIAS_VIVO_DIAS) || 1);
/* El andén pregunta cada 15 s y Redlink es el sistema TRANSACCIONAL del portal:
   sin este memo lo estaríamos sondeando cuatro veces por minuto por cada
   instancia. 60 s es menos que el tiempo que tarda un pedido en cerrarse. */
const MEMO_MS = Math.max(0, Number(process.env.GUIAS_MEMO_MS) || 60000);
/* Presupuesto de la consulta viva. Redlink cobra del orden de 16 s por dos días
   y el corte de Static Web Apps es a los 45 s: sin techo, un día lento tumba el
   endpoint completo en vez de devolver lo que alcanzó a juntar. */
const VIVO_MS = Math.max(5000, Number(process.env.GUIAS_VIVO_MS) || 20000);
const memo = new Map();

const moverDia = (s, n) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ──────────────────────────────────────────────────────────────────────────
   DE DÓNDE SALEN LAS FILAS

   Hasta el 2-nov-2026 esto le pegaba directo a RDTOut. Ese día el proveedor
   migró su base a otro servidor y `opsxrangofechas` dejó de recibir datos
   nuevos: medido, devolvía guías hasta el 30-oct y cero del 31 en adelante,
   así que TODO camión que cruzaba el túnel caía en "camión sin guía" —
   crítico, con sonido y con correo— por un problema de origen.

   Ahora se leen DOS caminos y se juntan, a propósito:
     · el almacén frío agrupa por día OPERATIVO (requerida/despacho), que es
       el que le importa al andén, y lo llena el backfill desde Redlink;
     · la consulta viva pasa por el interruptor OPS_ORIGEN, o sea hoy Redlink,
       y filtra por fecha de INGRESO.
   Una emisión cargada la semana pasada para salir hoy sólo aparece por el
   primero; una guía creada y cerrada hace diez minutos, sólo por el segundo.
   Gana la VIVA cuando una operación está en los dos, porque la patente y el
   DTE se cargan recién al cerrar el pedido.
   ────────────────────────────────────────────────────────────────────────── */
async function traerFilas(desde, hasta) {
  const ahora = Date.now();
  const clave = desde + '|' + hasta;
  const guardado = memo.get(clave);
  if (guardado && ahora - guardado.ts < MEMO_MS) return guardado.filas;

  /* CLAVE DE DEDUPE: nroPedido primero, igual que cold.dedup y que el camino
     cold de api/ops ("mismo criterio que cold.dedup: por nroPedido"). Medido en
     producción el 2-nov con el rango 30-oct..2-nov: 1.194 filas del frío + 417
     vivas dan 1.588 operaciones, o sea 23 están en los dos lados — y esas 23
     traen un formHeaderiD DISTINTO en cada lado. Con la cabecera como clave se
     colaban las 23 duplicadas y el andén mostraba dos veces la misma guía
     (73030 y 73013, por ejemplo). nroPedido es la llave de negocio y existe en
     las dos fuentes; la cabecera queda sólo de respaldo. */
  const idDe = (f) => String(f.nroPedido || f.formHeaderiD || '');
  const porId = new Map();

  let frio = null, errorFrio = null;
  try { frio = await cold.leerRango(cold.getContainer(), desde, hasta, { sinRl: true }); }
  catch (e) { errorFrio = e.message; }
  for (const f of (frio && frio.ops) || []) { const k = idDe(f); if (k) porId.set(k, f); }

  /* LA VENTANA VIVA VA ACOTADA. El andén pide arrastre=3, o sea un rango de
     cuatro días, y Redlink filtra por fecha de INGRESO: pedirle los cuatro no
     agrega guías nuevas (los días cerrados ya están en el frío) y sí arriesga
     el corte de 45 s en un endpoint que se consulta cada 15 s. Lo vivo cubre
     sólo la cola, con el mismo criterio que COLD_LIVE_DIAS en api/ops. */
  const pisoVivo = moverDia(hasta, -VIVO_DIAS);
  let vivoDesde = moverDia(desde, -VIVO_DIAS);
  if (vivoDesde < pisoVivo) vivoDesde = pisoVivo;

  let vivo = [], errorVivo = null;
  try { vivo = await consultarOps(vivoDesde, hasta, { presupuestoMs: VIVO_MS }); }
  catch (e) { errorVivo = e.message; }
  for (const f of vivo) { const k = idDe(f); if (k) porId.set(k, f); }

  /* Si los dos caminos fallaron NO se devuelve una lista vacía: el andén la
     leería como "ninguna de estas patentes tiene guía" y pintaría de rojo
     crítico cada camión que pase. Un origen caído tiene que verse como un
     error, no como una flota sin documentos. */
  const sinFrio = !frio || frio.sin_storage || errorFrio;
  if (!porId.size && errorVivo && sinFrio) {
    throw new Error('sin fuente de guías (vivo: ' + errorVivo + (errorFrio ? ' · frío: ' + errorFrio : '') + ')');
  }

  const filas = [...porId.values()];
  memo.set(clave, { ts: ahora, filas });
  /* El memo es por instancia y la Function se recicla sola; igual se poda para
     no dejar creciendo un mapa con un rango distinto por día. */
  if (memo.size > 24) for (const [k, v] of memo) if (ahora - v.ts > MEMO_MS) memo.delete(k);
  return filas;
}

function normalizarPatente(p) {
  return (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

async function obtenerGuias(desde, hasta) {
  const filas = await traerFilas(desde, hasta);

  return filas
    .map((f) => {
      // cantidadConfirmada es la que usa la prefactura; si el viaje aún no se
      // confirma, la solicitada es lo que el camión debería llevar.
      const solicitada  = Number(f.cantidadSolicitada)  || 0;
      const despachada  = Number(f.cantidadDespachada)  || 0;
      const confirmada  = Number(f.cantidadConfirmada)  || 0;
      const tipo = clasificar(f.operacion, f.dteNro);
      // Base de comparación contra el conteo de la cámara:
      //  - emisión: lo que el documento declara que sale.
      //  - retiro:  lo confirmado en la inspección; si aún no se confirma, lo
      //             solicitado por el cliente. Ojo: sol y conf difieren seguido
      //             (26-08: RW5303 pidió 512 y se confirmaron 480).
      const pallets = tipo === 'retiro'
        ? (confirmada || despachada || solicitada)
        : (confirmada || solicitada);
      // OJO CON LAS DOS FECHAS. horaIngreso es cuándo se CREÓ el pedido, no
      // cuándo se movió el camión: la emisión 4087445 se creó el 28-07 y se
      // despachó el 28-08. Filtrar por horaIngreso dejaba fuera justamente las
      // emisiones, que se preparan con semanas de anticipación.
      //   · fecha        → día operativo, para el recorte y el cruce.
      //   · hora_emision → horaIngreso, único campo con hora, sólo de referencia.
      // ¿EL DESPACHO YA SE CERRÓ EN RDTOut? Medido entre el 31-08 y el 04-09:
      // de 55 emisiones con patente, 54 estaban en etapa "Cerrado" y una en
      // "Confirmar". El historial del pedido 4087420 muestra por qué: el camión
      // cruzó el túnel a las 14:42, la patente y el DTE se cargaron a las 14:54
      // y el pedido quedó Cerrado a las 16:10. Es decir, el cierre ocurre
      // DESPUÉS de que el camión salió. Una emisión cerrada y confirmada que la
      // cámara nunca registró no es un camión por salir: es un despacho que ya
      // ocurrió y que la cámara no vio.
      const etapaTxt = (f.etapaOperacion || '').trim();
      const despachoCerrado = /cerrado/i.test(etapaTxt) && confirmada > 0;

      const diaOperativo = f.fechaDespacho || f.fechaConfirmacion || f.fechaRequerida || f.horaIngreso;
      const fecha = diaOperativo ? String(diaOperativo).slice(0, 10) : null;
      const cuando = f.horaIngreso || diaOperativo || null;

      return {
        // en retiros y devoluciones dteNro llega en 0: cae al número de pedido
        numero: String(f.dteNro || f.nroDocumento || f.nroPedido || '').replace(/^0$/, '').trim()
                || String(f.nroPedido || '').trim(),
        fecha,
        hora_emision: cuando,
        patente: normalizarPatente(f.patente),
        chofer: (f.chofer || '').trim() || null,
        transportista: f.transportistaStr || f.transportista || null,
        cliente: f.clienteDestinoStr || f.clienteOrigenStr || null,
        bodega: f.bodegaDestinoStr || f.bodegaOrigenStr || null,
        operacion: (f.operacion || '').trim(),
        tipo,
        fecha_creacion: f.horaIngreso ? String(f.horaIngreso).slice(0, 10) : null,
        etapa: etapaTxt || null,
        despacho_cerrado: despachoCerrado,
        nro_pedido: String(f.nroPedido || '').trim() || null,
        pallets_declarados: pallets,
        cantidad_solicitada: solicitada,
        cantidad_despachada: despachada,
        cantidad_confirmada: confirmada,
        // El conteo real de filas lo pone la cámara; acá va sólo el nominal.
        filas: null,
        pallets_por_fila: PALLETS_POR_FILA,
      };
    })
    // RECORTE POR FECHA — imprescindible. RDTOut ignora el rango pedido: al
    // consultar un solo día devolvió 18.679 filas repartidas entre el 25-06 y el
    // 26-08. Sin este recorte, el monitor mostraba guías de hace un mes y el
    // cruce con la cámara daba cero. consulta-transporte.js ya hacía lo mismo.
    .filter((g) =>
      g.patente &&
      // Talca y la patente de pruebas: nunca cruzan el túnel, así que como
      // "guía sin carga" sólo ensucian el monitor y el informe.
      patenteEnAlcance(g.patente) &&
      g.pallets_declarados > 0 &&
      g.fecha && g.fecha >= desde && g.fecha <= hasta &&
      (!OPERACIONES_DESPACHO.length ||
        OPERACIONES_DESPACHO.includes(g.operacion.toLowerCase())));
}

module.exports = { obtenerGuias, traerFilas, normalizarPatente, clasificar,
  PALLETS_POR_FILA, OPERACIONES_DESPACHO, VIVO_DIAS, MEMO_MS, VIVO_MS };
