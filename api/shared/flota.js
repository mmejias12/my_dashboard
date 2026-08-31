/**
 * flota.js — capacidades de la flota, según "Capacidad de camiones.xlsx".
 *
 * Cuatro unidades son CAMIÓN + CARRO (la rampla o acoplado de arrastre) y cinco
 * son camión simple. El carro importa para leer el conteo de la cámara: si en
 * una pasada el total se parece a la capacidad del camión solo, es señal de que
 * el carro no se contó; si supera el total de camión + carro, el conteo no puede
 * ser correcto porque no cabe físicamente.
 *
 * Las capacidades cambian según el color del pallet (rojo o verde), y no sabemos
 * cuál lleva cada viaje, así que se guarda el máximo: sirve como tope duro.
 * Un conteo por debajo del tope no prueba nada; uno por encima sí.
 */

const FLOTA = {
  //            carro   camión   despacho  retiro     conductor
  NC8771: { carro: true,  camion: 240, emision: 600, retiro: 640, conductor: 'Julio Bulnes' },
  VG1943: { carro: true,  camion: 240, emision: 600, retiro: 640, conductor: 'Victor Vega' },
  CCRC36: { carro: true,  camion: 280, emision: 600, retiro: 680, conductor: 'Juan Carlos Vega' },
  RW5303: { carro: true,  camion: 280, emision: 600, retiro: 600, conductor: 'Gonzalo Campos' },
  BJCL13: { carro: false, camion: 280, emision: 280, retiro: 280, conductor: 'Ismael Campos' },
  LS3119: { carro: false, camion: 320, emision: 320, retiro: 320, conductor: 'Antonio Vega' },
  SP3393: { carro: false, camion: 320, emision: 320, retiro: 320, conductor: 'Cesar Anabalon' },
  CPVW43: { carro: false, camion: 320, emision: 320, retiro: 320, conductor: 'Cristobal Echeverria' },
  FV2792: { carro: false, camion: 280, emision: 280, retiro: 280, conductor: 'Emilio Caulle' },
};

/**
 * PATENTES FUERA DE ALCANCE — no pasan por el túnel de Santiago, así que nunca
 * van a tener conteo de cámara y su única contribución al tablero es ruido:
 * aparecerían siempre como "sin carga" o "sin cruce".
 *
 *  · GXVL57 y CKWR19 son de la operación de TALCA.
 *  · XX999 es la patente de pruebas de SPOTVISION. Además no es un formato
 *    chileno válido (acá son 4 letras + 2 dígitos, o 2 letras + 4 dígitos),
 *    por eso el patrón de dos letras + 999 se puede descartar sin riesgo de
 *    borrar un camión real.
 *
 * Se puede ampliar sin tocar código con la app setting PATENTES_EXCLUIDAS,
 * lista separada por comas. Lo que se agregue ahí se suma a esta base.
 */
const EXCLUIDAS_BASE = ['GXVL57', 'CKWR19'];

const EXCLUIDAS = new Set([
  ...EXCLUIDAS_BASE,
  ...String(process.env.PATENTES_EXCLUIDAS || '')
    .split(',').map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean),
]);

const PRUEBA = /^[A-Z]{2}999$/;   // XX999 y variantes de prueba

/** true si la patente entra en el tablero (no es de otra plaza ni de prueba). */
function patenteEnAlcance(p) {
  const k = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return true;            // sin patente se decide en otra parte
  return !EXCLUIDAS.has(k) && !PRUEBA.test(k);
}

/** Capacidad tope de una patente para el tipo de movimiento. null si no está en la flota. */
function capacidad(patente, tipo) {
  const f = FLOTA[patente];
  if (!f) return null;
  return tipo === 'retiro' ? f.retiro : f.emision;
}

/**
 * Contrasta el conteo de la cámara contra la capacidad física del camión.
 * Devuelve null si la patente no está en el catálogo.
 */
function revisarCapacidad(patente, contados, tipo) {
  const f = FLOTA[patente];
  if (!f || !contados) return null;
  const tope = capacidad(patente, tipo);
  return {
    tiene_carro: f.carro,
    capacidad_total: tope,
    capacidad_camion: f.camion,
    // Imposible: no caben tantos pallets arriba. Apunta a un problema de conteo,
    // no a una diferencia con el documento.
    excede_capacidad: contados > tope,
    exceso: contados - tope,
    // Sospecha de carro no leído: el total se parece al del camión solo, en una
    // unidad que sí lleva carro. Una fila de holgura (18 pallets) de margen.
    posible_carro_no_leido: f.carro && Math.abs(contados - f.camion) <= 18,
  };
}

module.exports = {
  FLOTA, capacidad, revisarCapacidad,
  patenteEnAlcance, EXCLUIDAS: [...EXCLUIDAS], PRUEBA,
};
