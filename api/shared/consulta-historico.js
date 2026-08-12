// ============================================================================
//  shared/consulta-historico.js  ·  consultar_operacion(desde, hasta)
//
//  El corazón del tool use: responde el movimiento de pallets de CUALQUIER
//  rango combinando el caché diario con consultas en vivo, según las reglas
//  de negocio acordadas:
//
//   · Conceptos estables (emisiones, retiros, devoluciones, recogida):
//     SIEMPRE del caché. Días que falten se consultan una vez, se guardan
//     (incluso vacíos: un domingo sin movimiento también se cachea) y quedan
//     para siempre — el vaso se llena solo.
//
//   · Transferencias: definitivas si el día tiene más de VENTANA (40) días
//     de antigüedad → del caché. Dentro de la ventana aún suben por
//     confirmación tardía → se consultan EN VIVO y la respuesta se marca
//     `transferencias_provisional` para que el asistente avise
//     "sujeto a confirmación". De paso, esos días calientes se regraban con
//     lo recién consultado (refresco gratis del caché).
// ============================================================================

const mov   = require('./movimientos.js');
const cache = require('./cache-dia.js');
const { consultarOps } = require('./ops-fetch.js');
const { partirRango } = require('./rangos.js');

const VENTANA = mov.VENTANA_TRANSFER_DIAS;   // 40 días

const hoyIso = () => new Date().toISOString().slice(0, 10);
const addDias = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Agrupa fechas sueltas en subrangos contiguos: ['a','b','d'] -> [a..b],[d..d]
function agruparContiguas(fechas) {
  const out = [];
  for (const f of fechas.sort()) {
    const ult = out[out.length - 1];
    if (ult && addDias(ult.hasta, 1) === f) ult.hasta = f;
    else out.push({ desde: f, hasta: f });
  }
  return out;
}

// Consulta en vivo los días faltantes de un rango y los guarda en el caché.
// Días sin filas se guardan VACÍOS (en 0) si ya cerraron, para no volver a
// consultarlos nunca (domingos y feriados).
async function completarFaltantes(container, faltantes, ctx) {
  if (!faltantes.length) return;
  for (const grupo of agruparContiguas(faltantes)) {
    for (const trozo of partirRango(grupo.desde, grupo.hasta)) {
      const filas = await consultarOps(trozo.desde, trozo.hasta);
      const porDia = mov.agregarPorDia(filas);
      for (const fecha of cache.rangoDias(trozo.desde, trozo.hasta)) {
        const acc = porDia[fecha] || mov.nuevoAcc();
        if (cache.diaCerrado(fecha) || porDia[fecha]) {
          await cache.guardarDia(container, fecha, acc);
        }
      }
      if (ctx && ctx.log) ctx.log(`historico: rellenados ${trozo.desde}..${trozo.hasta} (${filas.length} filas)`);
    }
  }
}

// ── LA CONSULTA ─────────────────────────────────────────────────────────────
// Devuelve { desde, hasta, movimiento, transferencias_provisional, _origen }.
async function consultarOperacion({ desde, hasta, desglose }, ctx) {
  // saneo básico
  const reISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!reISO.test(desde || '') || !reISO.test(hasta || '')) {
    throw new Error('fechas inválidas: se espera YYYY-MM-DD');
  }
  const hoy = hoyIso();
  if (hasta > hoy) hasta = hoy;                     // el futuro no existe
  if (desde > hasta) throw new Error('desde > hasta');

  const container = cache.getContainer();
  await container.createIfNotExists();

  const corte = addDias(hoy, -VENTANA);             // >= corte ⇒ "caliente"
  const finFrio = hasta < corte ? hasta : addDias(corte, -1);
  const iniCaliente = desde > corte ? desde : corte;
  const hayFrio = desde <= finFrio;
  const hayCaliente = hasta >= corte;

  const partes = [];
  const origen = { cache_dias: 0, vivo_dias: 0, rellenados: 0 };

  // — Parte fría: 100% caché (rellenando lo que falte, una sola vez) —
  if (hayFrio) {
    let r = await cache.leerRango(container, desde, finFrio);
    if (r.faltantes.length) {
      origen.rellenados = r.faltantes.length;
      await completarFaltantes(container, r.faltantes, ctx);
      r = await cache.leerRango(container, desde, finFrio);
    }
    origen.cache_dias += r.dias_leidos;
    partes.push(r.movimiento);
  }

  // — Parte caliente: en vivo (transferencias frescas) + regraba el caché —
  if (hayCaliente) {
    const filas = await consultarOps(iniCaliente, hasta);
    const porDia = mov.agregarPorDia(filas);
    const acc = mov.agregarMovimientos(filas);
    partes.push(mov.paraCache(acc));
    origen.vivo_dias = cache.rangoDias(iniCaliente, hasta).length;

    // refresco del caché con lo recién traído (días sin filas: vacío si cerró)
    for (const fecha of cache.rangoDias(iniCaliente, hasta)) {
      const dia = porDia[fecha] || mov.nuevoAcc();
      if (cache.diaCerrado(fecha) || porDia[fecha]) {
        await cache.guardarDia(container, fecha, dia);
      }
    }
  }

  const movimiento = mov.combinarDias(partes);
  const resp = {
    desde, hasta,
    movimiento,
    transferencias_provisional: hayCaliente,
    _origen: origen
  };
  // Desglose por cliente/bodega solo si lo piden (para no inflar la respuesta).
  if (desglose) resp.desglose = mov.topDetalle(movimiento.detalle, 8);
  delete movimiento.detalle;   // los mapas completos no viajan al modelo
  return resp;
}

module.exports = { consultarOperacion, agruparContiguas, VENTANA };