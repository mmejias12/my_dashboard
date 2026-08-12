// ============================================================================
//  shared/consulta-cliente.js  ·  consultar_cliente(entidad, desde, hasta)
//
//  Vista PROFUNDA por entidad (cliente o bodega), EN VIVO desde RDTOut. Da lo
//  que el caché agregado no tiene: las 4 cantidades (solicitada, despachada,
//  confirmada, pendiente), el desglose por etapa/estado, cuánto fue como
//  origen vs destino, y el detalle operación por operación.
//
//  Es una consulta viva (no usa el caché diario): trae las filas del rango en
//  trozos, las filtra por la entidad y agrega en memoria. Por eso responde
//  "cuántas emisiones vs transferencias hizo Cambiaso" sin re-backfillear nada.
// ============================================================================

const mov = require('./movimientos.js');
const ops = require('./ops-fetch.js');        // se llama por objeto → testeable/mockeable
const { partirRango } = require('./rangos.js');

const norm = mov.norm;                          // normaliza acentos/mayúsculas
const num  = x => Number(x) || 0;

function coincide(valor, termino) {
  return norm(valor).indexOf(termino) !== -1;   // match por subcadena (permite nombre parcial)
}

// Devuelve { entidad, tipo, rol, desde, hasta, total_operaciones, resumen, detalle }.
async function consultarCliente({ desde, hasta, entidad, tipo, rol, detalle, max }, ctx) {
  const reISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!reISO.test(desde || '') || !reISO.test(hasta || '')) throw new Error('fechas inválidas: se espera YYYY-MM-DD');
  if (!entidad || !String(entidad).trim()) throw new Error('falta la entidad (cliente o bodega)');
  const hoy = new Date().toISOString().slice(0, 10);
  if (hasta > hoy) hasta = hoy;
  if (desde > hasta) throw new Error('desde > hasta');

  const term = norm(entidad);
  tipo = tipo === 'bodega' ? 'bodega' : 'cliente';
  rol  = (rol === 'origen' || rol === 'destino') ? rol : 'ambos';
  const N = Math.min(Math.max(num(max) || 50, 1), 200);

  const campoOrigen  = tipo === 'bodega' ? 'bodegaOrigenStr'  : 'clienteOrigenStr';
  const campoDestino = tipo === 'bodega' ? 'bodegaDestinoStr' : 'clienteDestinoStr';

  // 1) Traer el rango en trozos y quedarse solo con las filas de la entidad.
  const filas = [];
  for (const t of partirRango(desde, hasta)) {
    const parte = await ops.consultarOps(t.desde, t.hasta);
    for (const f of parte) {
      const enOrigen  = coincide(f[campoOrigen], term);
      const enDestino = coincide(f[campoDestino], term);
      const match = rol === 'origen' ? enOrigen
                  : rol === 'destino' ? enDestino
                  : (enOrigen || enDestino);
      if (!match) continue;
      f.__rol = (enOrigen && enDestino) ? 'origen+destino' : (enOrigen ? 'origen' : 'destino');
      filas.push(f);
    }
    if (ctx && ctx.log) ctx.log(`cliente "${entidad}" ${t.desde}..${t.hasta}: ${parte.length} filas del rango`);
  }

  // 2) Resumen por concepto: conteo + 4 cantidades + origen/destino + etapas.
  const resumen = {};
  function acc(concepto) {
    if (!resumen[concepto]) resumen[concepto] = {
      operaciones: 0, solicitado: 0, despachado: 0, confirmado: 0, pendiente: 0,
      confirmado_como_origen: 0, confirmado_como_destino: 0, etapas: {}
    };
    return resumen[concepto];
  }
  for (const f of filas) {
    const concepto = mov.conceptoDe(f.operacion) || '(sin mapear)';
    const r = acc(concepto);
    r.operaciones += 1;
    r.solicitado  += num(f.cantidadSolicitada);
    r.despachado  += num(f.cantidadDespachada);
    r.confirmado  += num(f.cantidadConfirmada);
    r.pendiente   += num(f.cantidadPendiente);
    if (f.__rol.indexOf('origen')  !== -1) r.confirmado_como_origen  += num(f.cantidadConfirmada);
    if (f.__rol.indexOf('destino') !== -1) r.confirmado_como_destino += num(f.cantidadConfirmada);
    const etapa = String(f.etapaOperacion || f.estado || '(sin etapa)').trim() || '(sin etapa)';
    r.etapas[etapa] = (r.etapas[etapa] || 0) + 1;
  }

  // 3) Detalle línea a línea (opcional), más recientes primero, acotado a N.
  let lineas = null;
  if (detalle) {
    lineas = filas.slice()
      .sort((a, b) => String(mov.fechaDe(b)).localeCompare(String(mov.fechaDe(a))))
      .slice(0, N)
      .map(f => ({
        fecha: mov.fechaDe(f),
        operacion: f.operacion,
        concepto: mov.conceptoDe(f.operacion) || '(sin mapear)',
        rol: f.__rol,
        clienteOrigen: f.clienteOrigenStr || '',
        clienteDestino: f.clienteDestinoStr || '',
        bodegaOrigen: f.bodegaOrigenStr || '',
        bodegaDestino: f.bodegaDestinoStr || '',
        solicitado: num(f.cantidadSolicitada),
        despachado: num(f.cantidadDespachada),
        confirmado: num(f.cantidadConfirmada),
        pendiente: num(f.cantidadPendiente),
        etapa: f.etapaOperacion || f.estado || ''
      }));
  }

  return {
    entidad, tipo, rol, desde, hasta,
    total_operaciones: filas.length,
    resumen,
    detalle: lineas,
    detalle_mostrado: lineas ? lineas.length : 0,
    detalle_truncado: detalle ? (filas.length > N) : false
  };
}

const TOOL_SCHEMA = {
  name: 'consultar_cliente',
  description:
    'Vista PROFUNDA de un CLIENTE o BODEGA nombrado, EN VIVO, para un rango. ' +
    'Da lo que consultar_operacion no tiene: las 4 cantidades (solicitada, ' +
    'despachada, confirmada, pendiente), el desglose por etapa/estado, cuánto ' +
    'fue como origen vs destino, y el detalle operación por operación. Úsala ' +
    'cuando pregunten por una entidad con NOMBRE (ej. "emisiones vs ' +
    'transferencias de Cambiaso", "operaciones del cliente X", "en qué etapa ' +
    'están las transferencias de Y") o pidan el detalle línea a línea. Devuelve ' +
    '`resumen` por concepto y, si pasas detalle:true, `detalle` con las filas. ' +
    'Es viva (tarda unos segundos): usa rangos acotados y NO la uses para ' +
    'totales por planta (para eso está consultar_operacion).',
  input_schema: {
    type: 'object',
    properties: {
      entidad: { type: 'string', description: 'Nombre (o parte) del cliente o bodega, ej. "Cambiaso"' },
      desde:   { type: 'string', description: 'Inicio del rango, YYYY-MM-DD' },
      hasta:   { type: 'string', description: 'Fin del rango, YYYY-MM-DD' },
      tipo:    { type: 'string', enum: ['cliente', 'bodega'], description: 'Buscar la entidad como cliente (default) o como bodega' },
      rol:     { type: 'string', enum: ['origen', 'destino', 'ambos'], description: 'Contar solo cuando la entidad es origen, destino, o ambos (default ambos)' },
      detalle: { type: 'boolean', description: 'Si true, incluye las operaciones línea a línea (acotadas a max)' },
      max:     { type: 'number', description: 'Máximo de líneas de detalle (default 50, tope 200)' }
    },
    required: ['entidad', 'desde', 'hasta']
  }
};

module.exports = { consultarCliente, TOOL_SCHEMA };