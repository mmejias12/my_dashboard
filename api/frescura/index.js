// ============================================================================
//  frescura/index.js  ·  De cuándo es el dato de cada fuente
//
//    GET /api/frescura
//
//  Lo consume la franja del index. Las reglas (qué cuenta como atraso y a qué
//  hora se le empieza a exigir el dato del día a cada fuente) viven en
//  shared/frescura.js, que se prueba sin red. Acá va solo el cableado a los
//  almacenes que ya existen y el caché.
//
//  Dos decisiones:
//   · Cada sonda va en su propio try. Si un almacén se cae, esa píldora dice
//     "sin dato" y las otras tres siguen informando. Una franja que desaparece
//     entera porque una fuente falló es justo cuando más falta hace.
//   · Caché en memoria por unos minutos. Esto se llama en CADA carga del index,
//     y la respuesta cambia una vez al día: sin caché serían decenas de
//     lecturas a blob por hora para decir lo mismo.
// ============================================================================
'use strict';

const F = require('../shared/frescura.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const CACHE_MIN = Number(process.env.FRESCURA_CACHE_MIN || 5);
let cache = null;   // { hasta: epoch_ms, dato: {...} }

function cargar(nombre) {
  try { return require('../shared/' + nombre + '.js'); } catch (e) { return null; }
}

/* ── Sondas: (fecha) => ¿hay dato de ese día? ─────────────────────────────
   Devuelven false ante cualquier problema; nunca lanzan. */

function sondaStock() {
  const m = cargar('stock-dia');
  if (!m || typeof m.existeDia !== 'function') return null;
  return async (f) => { try { return !!(await m.existeDia(f)); } catch (e) { return false; } };
}

function sondaOps() {
  const m = cargar('cold-operaciones');
  if (!m || typeof m.leerDia !== 'function' || typeof m.getContainer !== 'function') return null;
  let cont = null;
  return async (f) => {
    try {
      if (!cont) cont = m.getContainer();
      const d = await m.leerDia(cont, f, { silencioso: true });
      return Array.isArray(d) ? d.length > 0 : !!d;
    } catch (e) { return false; }
  };
}

/* Walmart no se camina día por día: el mes entero es UN blob. Se lee una vez
   y se resuelve de memoria, que es más barato que seis descargas. */
function sondaWalmart(hoy) {
  const m = cargar('planillas-walmart');
  if (!m || typeof m.leerMes !== 'function') return null;
  let dias = null;
  return async (f) => {
    if (dias === null) {
      dias = {};
      try {
        const meses = typeof m.mesesRecientes === 'function'
          ? m.mesesRecientes(hoy, 2) : [hoy.slice(0, 7)];
        for (const mes of meses) {
          const filas = await m.leerMes(mes);
          for (const fila of (filas || [])) {
            const c = typeof m.cuando === 'function' ? m.cuando(fila) : (fila.fecha || fila.dia);
            if (c) dias[String(c).slice(0, 10)] = true;
          }
        }
      } catch (e) { /* queda el objeto vacío: dirá "sin dato" */ }
    }
    return !!dias[f];
  };
}

function sondaTalana() {
  const m = cargar('talana-store');
  if (!m || typeof m.leerMarcasDia !== 'function' || typeof m.getContainer !== 'function') return null;
  let cont = null;
  return async (f) => {
    try {
      if (!cont) cont = m.getContainer();
      const d = await m.leerMarcasDia(cont, f);
      if (!d) return false;
      const marcas = d.marcas || d;
      return Array.isArray(marcas) ? marcas.length > 0 : Object.keys(marcas || {}).length > 0;
    } catch (e) { return false; }
  };
}

async function calcular() {
  const hoy = F.ahoraEnChile().fecha;
  return F.armar({
    ops:     sondaOps(),
    sap:     sondaStock(),
    walmart: sondaWalmart(hoy),
    talana:  sondaTalana()
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  const ahora = Date.now();
  const forzar = String((req.query && req.query.recargar) || '') === '1';

  try {
    if (!forzar && cache && cache.hasta > ahora) {
      context.res = {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
                   'Cache-Control': 'private, max-age=60' },
        body: JSON.stringify({ ...cache.dato, deCache: true })
      };
      return;
    }
    const dato = await calcular();
    cache = { hasta: ahora + CACHE_MIN * 60000, dato };
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
                 'Cache-Control': 'private, max-age=60' },
      body: JSON.stringify(dato)
    };
  } catch (err) {
    context.log.error('frescura:', err && err.message);
    /* Que falle el endpoint no puede tumbar el index: devuelve la forma
       esperada con todo en "sin dato" y la franja se dibuja igual. */
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ generado: new Date().toISOString(), error: true,
                             fuentes: [], atrasadas: 0 })
    };
  }
};
