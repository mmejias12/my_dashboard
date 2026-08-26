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
 * ── DOS COSAS QUE CONVIENE CONFIRMAR CON OPERACIONES ─────────────────────────
 *
 *  1. OPERACIONES_DESPACHO. El túnel es de salida, así que sólo interesan los
 *     viajes que salen cargados. En consulta-transporte, 'Emision' y
 *     'Emision 24 horas' son emisión de pallets (salida) y 'Retiro' /
 *     'Devolucion' son entrada. Si en tu operación hay otro valor que también
 *     sale por el túnel, agrégalo a la lista o a la app setting.
 *
 *  2. LA MARCA DE TIEMPO. El monitor necesita tener el camión esperando ANTES
 *     de que pase. Si `fechaConfirmacion` se estampa recién cuando el viaje se
 *     cierra —es decir, después del paso— el camión nunca aparecería en la lista
 *     de espera y toda carga saldría como "sin guía". Vale la pena mirar en
 *     RDTOut un viaje del día y comprobar en qué momento se llena ese campo.
 *     Si llegara tarde, hay que usar el campo que sí marca la emisión.
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

/** Operaciones que corresponden a un camión saliendo por el túnel de despacho. */
const OPERACIONES_DESPACHO = (process.env.OPERACIONES_DESPACHO ||
  'Emision,Emision 24 horas').split(',').map((s) => s.trim().toLowerCase());

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
      const pallets = Number(f.cantidadConfirmada) || Number(f.cantidadSolicitada) || 0;
      const cuando = f.fechaConfirmacion || f.fechaDespacho || f.horaIngreso || null;
      const fecha = cuando ? String(cuando).slice(0, 10) : null;

      return {
        numero: String(f.dteNro || f.nroDocumento || f.nroPedido || '').trim(),
        fecha,
        hora_emision: cuando,
        patente: normalizarPatente(f.patente),
        chofer: (f.chofer || '').trim() || null,
        transportista: f.transportistaStr || f.transportista || null,
        cliente: f.clienteDestinoStr || f.clienteOrigenStr || null,
        bodega: f.bodegaDestinoStr || f.bodegaOrigenStr || null,
        operacion: (f.operacion || '').trim(),
        pallets_declarados: pallets,
        // El conteo real de filas lo pone la cámara; acá va sólo el nominal.
        filas: null,
        pallets_por_fila: PALLETS_POR_FILA,
      };
    })
    .filter((g) =>
      g.patente &&
      g.pallets_declarados > 0 &&
      g.fecha &&
      OPERACIONES_DESPACHO.includes(g.operacion.toLowerCase()));
}

module.exports = { obtenerGuias, normalizarPatente, PALLETS_POR_FILA, OPERACIONES_DESPACHO };
