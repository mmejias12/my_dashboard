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

const OPS_HOST = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const OPS_PATH = process.env.OS_OPS_PATH || '/api/RDTOut/OpsXRangoFechas';

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
 *  - emision:    el camión SALE con carga; se compara contra lo declarado.
 *  - retiro:     el camión LLEGA con pallets del cliente; se compara contra la
 *                solicitud de retiro y contra lo confirmado en la inspección.
 *  - devolucion: tampoco es un despacho; se marca para que nadie la lea como tal.
 */
function clasificar(op, dteNro) {
  // El DTE es la señal dura: las emisiones generan documento (serie 72xxx,
  // incremental) y llegan con dteNro > 0; los retiros y devoluciones traen
  // dteNro en 0 y se identifican por nroDocumento. Se ve nítido en los datos:
  // el pedido 4087445 (emisión) trae dte 72137 y documento vacío, mientras el
  // 4106282 (retiro) trae dte 0 y documento 80717024.
  if (Number(dteNro) > 0) return 'emision';
  const o = (op || '').trim().toLowerCase();
  if (o.startsWith('emision')) return 'emision';
  if (o.startsWith('retiro')) return 'retiro';
  if (o.startsWith('devolucion')) return 'devolucion';
  return 'otro';
}

function normalizarPatente(p) {
  return (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

async function obtenerGuias(desde, hasta) {
  const key = process.env.REDTEC_API_KEY;
  if (!key) throw new Error('Falta la app setting REDTEC_API_KEY');

  const url = `${OPS_HOST}${OPS_PATH}`
    + `?fechaInicial=${encodeURIComponent(desde)}&fechaFinal=${encodeURIComponent(hasta)}`;

  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Api-Key': key } });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`RDTOut ${r.status} (${desde}..${hasta}) ${cuerpo.slice(0, 120)}`);
  }
  const data = await r.json();
  const filas = Array.isArray(data) ? data : [data];

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
        etapa: (f.etapaOperacion || '').trim() || null,
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
      g.pallets_declarados > 0 &&
      g.fecha && g.fecha >= desde && g.fecha <= hasta &&
      (!OPERACIONES_DESPACHO.length ||
        OPERACIONES_DESPACHO.includes(g.operacion.toLowerCase())));
}

module.exports = { obtenerGuias, normalizarPatente, clasificar, PALLETS_POR_FILA, OPERACIONES_DESPACHO };
