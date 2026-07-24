// ============================================================================
//  rangos.js  ·  Manejo del límite de 180 días de los APIs (RDTOut y afines)
//
//  El límite es POR CONSULTA, no un límite de cuán seguido consultas. Hay dos
//  necesidades distintas y se resuelven distinto:
//
//   1. VENTANA CORTA (hoy, la semana)  -> consulta directa de 1 a 7 días.
//      Barata y rápida: se puede correr cada 15 minutos sin problema.
//
//   2. ACUMULADO YTD (1-ene a hoy)     -> ya supera los 180 días.
//      Se resuelve de dos formas combinadas:
//        a) INCREMENTAL: el snapshot guarda el acumulado y la última fecha
//           consolidada; cada corrida consulta solo los días nuevos y suma.
//        b) RECONSTRUCCIÓN: cada cierto tiempo (de madrugada) se recalcula
//           todo el año troceado en segmentos de <=180 días, para corregir
//           cualquier deriva por datos cargados con fecha retroactiva.
// ============================================================================

const LIMITE_DIAS = 180;
const MARGEN = 5; // margen de seguridad; se piden trozos de 175 días

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const parse = s => (s instanceof Date ? new Date(s) : new Date(s + 'T00:00:00Z'));

/**
 * Trocea un rango en segmentos que respetan el límite del API.
 * partirRango('2026-01-01','2026-07-23') -> [{desde,hasta}, {desde,hasta}]
 */
function partirRango(desde, hasta, limite = LIMITE_DIAS - MARGEN) {
  const ini = parse(desde), fin = parse(hasta);
  if (fin < ini) return [];
  const trozos = [];
  let cur = ini;
  while (cur <= fin) {
    let tope = addDays(cur, limite - 1);
    if (tope > fin) tope = fin;
    trozos.push({ desde: iso(cur), hasta: iso(tope) });
    cur = addDays(tope, 1);
  }
  return trozos;
}

/**
 * Consulta un rango largo troceándolo y sumando los resultados.
 * @param fetchTrozo  async ({desde,hasta}) => number|object
 * @param combinar    (acum, parcial) => acum     (default: suma numérica)
 */
async function consultarRangoLargo(desde, hasta, fetchTrozo, combinar) {
  const trozos = partirRango(desde, hasta);
  const sumar = combinar || ((a, b) => (a || 0) + (b || 0));
  let acc = null;
  for (const t of trozos) {
    const parcial = await fetchTrozo(t);
    acc = acc === null ? parcial : sumar(acc, parcial);
  }
  return acc;
}

/**
 * Acumulador incremental. Evita re-consultar el año entero en cada corrida.
 *
 * estado = { valor: 654055, consolidado_hasta: '2026-07-20' }
 *
 * Solo pide los días entre consolidado_hasta+1 y hoy, y los suma.
 * Si no hay estado previo, reconstruye completo (troceado) desde inicioAnio.
 */
async function acumularIncremental(estado, hoy, inicioAnio, fetchTrozo, combinar) {
  const sumar = combinar || ((a, b) => (a || 0) + (b || 0));
  const hoyIso = iso(parse(hoy));

  // Sin estado previo -> reconstrucción completa troceada.
  if (!estado || estado.valor === undefined || !estado.consolidado_hasta) {
    const valor = await consultarRangoLargo(inicioAnio, hoyIso, fetchTrozo, sumar);
    return { valor, consolidado_hasta: hoyIso, modo: 'reconstruccion' };
  }

  const desde = iso(addDays(parse(estado.consolidado_hasta), 1));
  if (desde > hoyIso) return { ...estado, modo: 'sin-cambios' };

  const delta = await consultarRangoLargo(desde, hoyIso, fetchTrozo, sumar);
  return { valor: sumar(estado.valor, delta), consolidado_hasta: hoyIso, modo: 'incremental' };
}

/** ¿Toca reconstrucción completa? (por defecto, una vez al día de madrugada) */
function tocaReconstruccion(ahora = new Date(), horaLocal = 3) {
  // ahora debe venir ya en hora local (ver WEBSITE_TIME_ZONE)
  return ahora.getHours() === horaLocal;
}

module.exports = {
  LIMITE_DIAS, partirRango, consultarRangoLargo,
  acumularIncremental, tocaReconstruccion
};
