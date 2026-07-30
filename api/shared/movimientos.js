// ============================================================================
//  shared/movimientos.js  ·  Lógica canónica de movimiento de pallets
//
//  Réplica fiel de cómo M3LINK resuelve las operaciones (analisis-transferencias
//  y calendario-retiro-pallets), para que el asistente dé los MISMOS números que
//  los dashboards. Funciones puras, sin I/O: las usan la ingesta, la carga
//  inicial y el tool use.
//
//  Correcciones incorporadas respecto a la primera versión de la ingesta:
//   1. Transferencias = 'transfer' O 'trans diferenciada' (M3LINK cuenta ambas).
//   2. Cada fila se ancla por fechaRequerida (una transferencia de marzo
//      confirmada en abril cuenta en marzo). Fallback: fechaConfirmacion.
//   3. Cantidad = cantidadConfirmada (lo realmente cumplido), como los KPIs.
// ============================================================================

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                 .trim().toLowerCase();

// Substrings por concepto. Orden = prioridad (primera coincidencia gana).
// 'transfer' cubre transferencia/transferido; 'trans diferenciada' es un tipo
// aparte que NO contiene 'transfer', por eso va explícito (igual que M3LINK).
const CONCEPTOS = [
  ['transferencias', ['transfer', 'trans diferenciada']],
  ['devoluciones',   ['devolucion']],
  ['recogida',       ['recogida', 'recoleccion']],
  ['emisiones',      ['emision']],
  ['retiros',        ['retiro']]
];

// Conceptos que se congelan al cerrar el día (se guardan en caché).
// Transferencias NO está: sube por confirmación tardía, va aparte.
const ESTABLES = ['emisiones', 'retiros', 'devoluciones', 'recogida'];

function conceptoDe(operacion) {
  const o = norm(operacion);
  if (!o) return null;
  for (const [concepto, claves] of CONCEPTOS) {
    if (claves.some(k => o.includes(k))) return concepto;
  }
  return null;   // no mapeada: se ignora y se registra, nunca se adivina
}

// Planta: Talca/Coquimbo por nombre, resto Santiago (regla de M3LINK).
// El pallet vuelve a la planta en un retiro, por eso destino manda.
// Plantas conocidas. Temuco operó solo durante 2024; se mantiene para no
// contar sus movimientos como Santiago en los datos de ese año.
const PLANTAS = ['santiago', 'talca', 'coquimbo', 'temuco'];
function plantaDeTexto(t) {
  const b = String(t || '').toUpperCase();
  if (b.indexOf('TEMUCO') !== -1) return 'temuco';
  if (b.indexOf('COQUIMBO') !== -1) return 'coquimbo';
  if (b.indexOf('TALCA') !== -1) return 'talca';
  return 'santiago';   // default histórico de la operación
}
function plantaDe(fila) {
  return plantaDeTexto(
    fila.bodegaDestino || fila.bodegaDestinoStr || fila.planta || fila.bodegaOrigenStr
  );
}

// Fecha de anclaje: requerida (planificación) primero; confirmación de respaldo.
function fechaDe(fila) {
  const f = fila.fechaRequerida || fila.fechaConfirmacion || '';
  return String(f).slice(0, 10);   // 'YYYY-MM-DD'
}

function nuevoAcc() {
  const z = () => { const o = { total: 0 }; for (const p of PLANTAS) o[p] = 0; return o; };
  return { emisiones: z(), retiros: z(), recogida: 0, devoluciones: 0,
           transferencias: 0, _sinMapear: {} };
}

// Suma una fila dentro de un acumulador.
function sumarFila(acc, fila) {
  const concepto = conceptoDe(fila.operacion);
  const v = Number(fila.cantidadConfirmada) || 0;   // confirmado = lo cumplido
  if (!concepto) {
    const k = norm(fila.operacion) || '(vacío)';
    acc._sinMapear[k] = (acc._sinMapear[k] || 0) + v;
    return;
  }
  if (concepto === 'emisiones' || concepto === 'retiros') {
    acc[concepto].total += v;
    acc[concepto][plantaDe(fila)] += v;
  } else {
    acc[concepto] += v;
  }
}

// Agrega TODAS las filas juntas (usado para un rango en vivo, incl. transferencias).
function agregarMovimientos(filas) {
  const acc = nuevoAcc();
  for (const f of filas) sumarFila(acc, f);
  return acc;
}

// Agrega las filas EN BUCKETS POR DÍA, anclando por fechaRequerida.
// Devuelve { 'YYYY-MM-DD': acc, ... }. Es la base del caché diario.
// Agrega filas EN una mapa de días existente (mutándola). Permite acumular
// varios trozos (chunks) del backfill sin perder datos en los bordes: si una
// fila cae en un día ya tocado por otro chunk, se suma, no se pisa.
function agregarPorDiaEn(filas, dias) {
  for (const f of filas) {
    const fecha = fechaDe(f);
    if (!fecha) continue;
    if (!dias[fecha]) dias[fecha] = nuevoAcc();
    sumarFila(dias[fecha], f);
  }
  return dias;
}
function agregarPorDia(filas) { return agregarPorDiaEn(filas, {}); }

// Subconjunto que se guarda en el blob diario: todos los conceptos de negocio,
// INCLUIDAS transferencias. En días antiguos ya están confirmadas (definitivas);
// la capa de lectura decide si un día reciente hay que refrescarlo en vivo.
function paraCache(acc) {
  return {
    emisiones: acc.emisiones, retiros: acc.retiros,
    devoluciones: acc.devoluciones, recogida: acc.recogida,
    transferencias: acc.transferencias
  };
}

// Suma varios días (leídos del caché) en el movimiento de un rango.
function combinarDias(lista) {
  const z = () => { const o = { total: 0 }; for (const p of PLANTAS) o[p] = 0; return o; };
  const out = { emisiones: z(), retiros: z(), devoluciones: 0, recogida: 0, transferencias: 0 };
  for (const d of lista) {
    if (!d) continue;
    for (const p of ['total', ...PLANTAS]) {
      out.emisiones[p] += (d.emisiones && d.emisiones[p]) || 0;
      out.retiros[p]   += (d.retiros   && d.retiros[p])   || 0;
    }
    out.devoluciones   += d.devoluciones || 0;
    out.recogida       += d.recogida || 0;
    out.transferencias += d.transferencias || 0;
  }
  return out;
}

// Ventana de gracia de transferencias: dentro de estos días desde hoy, el valor
// aún puede subir por confirmación tardía, así que se considera provisorio.
// (2023-2025 quedan siempre fuera de la ventana → definitivas.)
const VENTANA_TRANSFER_DIAS = 40;

module.exports = {
  norm, conceptoDe, nuevoAcc, plantaDe, plantaDeTexto, fechaDe,
  agregarMovimientos, agregarPorDia, agregarPorDiaEn,
  paraCache, combinarDias, VENTANA_TRANSFER_DIAS,
  ESTABLES, CONCEPTOS, PLANTAS
};
