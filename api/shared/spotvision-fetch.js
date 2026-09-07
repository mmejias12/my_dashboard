/**
 * spotvision-fetch.js
 * Acceso a la API de Monitoreo de Activos de SPOTVISION.
 *
 * La API Key NUNCA sale del servidor: se lee de la app setting
 * SPOTVISION_API_KEY y no hay fallback hardcodeado (a diferencia de
 * ops-fetch.js, cuyo fallback quedo pendiente de rotar).
 *
 * App settings requeridas:
 *   SPOTVISION_API_KEY   clave entregada por SPOTVISION
 *   SPOTVISION_BASE_URL  opcional, default https://redtec.spotcloud.io/monitoreo-activos
 */

const BASE = process.env.SPOTVISION_BASE_URL ||
  'https://redtec.spotcloud.io/monitoreo-activos';

function apiKey() {
  const k = process.env.SPOTVISION_API_KEY;
  if (!k) throw new Error('Falta la app setting SPOTVISION_API_KEY');
  return k;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET con reintentos. Seccion 8 de la guia:
 *  - 5xx / 502 / timeout  -> reintentar con backoff exponencial
 *  - 401 / 403 / 422      -> NO reintentar, es configuracion o parametros
 */
async function pedir(url, { intentos = 4, timeoutMs = 20000 } = {}) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: { 'x-api-key': apiKey() },
        signal: ac.signal,
      });
      clearTimeout(t);

      if (r.status === 401 || r.status === 403 || r.status === 422 || r.status === 404) {
        const cuerpo = await r.text();
        const e = new Error(`SPOTVISION ${r.status}: ${cuerpo}`);
        e.status = r.status;
        e.noReintentar = true;
        throw e;
      }
      if (!r.ok) throw new Error(`SPOTVISION ${r.status}`);
      return r;
    } catch (e) {
      clearTimeout(t);
      if (e.noReintentar) throw e;
      ultimoError = e;
      if (i < intentos - 1) await dormir(1000 * 2 ** i + Math.random() * 250);
    }
  }
  throw ultimoError;
}

/**
 * DETALLE POR BULTO. Desde el 05-09-2026 la API entrega, en cada bulto, un
 * arreglo `detalles` con la composicion real de la fila:
 *
 *   "detalles": [ {tipo:"pallet", color:"blanco", cantidad:4},
 *                 {tipo:"pallet", color:"rojo",   cantidad:14} ]
 *
 * Es el campo que veniamos pidiendo (consulta 1 del anexo). Se normaliza a
 * `pallets_bulto` para que el resto del sistema lo use sin cambios: el monitor
 * ya sabe marcar la fila corta cuando ese numero existe.
 *
 * Verificado sobre 33 cargas del 02 al 04-09: la suma de `cantidad` coincide
 * EXACTO con `total_pallets` en las 33. Ademas responde la consulta 4 del
 * anexo: de 687 filas, 602 traen 18 pallets pero las demas van entre 1 y 20,
 * asi que la camara cuenta pallets reales y no posiciones de la fila.
 */
function normalizarBulto(b) {
  const det = Array.isArray(b.detalles) ? b.detalles : null;
  if (!det) return b;
  const pallets = det.reduce((s, d) => s + (Number(d.cantidad) || 0), 0);
  const colores = {};
  for (const d of det) {
    const c = (d.color || 'sin color').toLowerCase();
    colores[c] = (colores[c] || 0) + (Number(d.cantidad) || 0);
  }
  return { ...b, pallets_bulto: pallets, colores };
}

function normalizarCarga(c) {
  if (!Array.isArray(c.bultos)) return c;
  const bultos = c.bultos.map(normalizarBulto);
  // Colores de toda la carga. Las capacidades de la flota cambian segun el
  // color del pallet, asi que este dato deja de ser una incognita.
  const colores = {};
  for (const b of bultos) {
    for (const k in (b.colores || {})) colores[k] = (colores[k] || 0) + b.colores[k];
  }
  return { ...c, bultos, colores: Object.keys(colores).length ? colores : undefined };
}

/**
 * Recorre TODAS las paginas de /redtec/cargas para un rango.
 * Devuelve el array plano de cargas, con el detalle por bulto normalizado.
 */
async function obtenerCargas(fechaInicio, fechaFin, { tamanoPagina = 200 } = {}) {
  const todas = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const qs = new URLSearchParams({
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      pagina: String(pagina),
      tamano_pagina: String(tamanoPagina),
    });
    const r = await pedir(`${BASE}/redtec/cargas?${qs}`);
    totalPaginas = Number(r.headers.get('X-Total-Paginas') || 0);
    const lote = await r.json();
    todas.push(...lote.map(normalizarCarga));
    if (totalPaginas === 0) break;
    pagina++;
  }
  return todas;
}

/**
 * Descarga los bytes de una evidencia. Se usa desde el endpoint
 * spotvision-evidencia, que es el unico camino por el que el browser
 * puede ver una imagen (la key no puede viajar en un <img src>).
 */
async function obtenerEvidencia(tipo, id) {
  if (tipo !== 'bulto' && tipo !== 'patente') {
    const e = new Error('tipo debe ser bulto o patente');
    e.status = 422;
    throw e;
  }
  const r = await pedir(`${BASE}/redtec/evidencias?tipo=${tipo}&id=${encodeURIComponent(id)}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get('content-type') || 'image/jpeg',
  };
}

/** Extrae tipo e id de un foto_bulto_url / foto_patente_url del payload. */
function partirUrlEvidencia(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { tipo: u.searchParams.get('tipo'), id: u.searchParams.get('id') };
  } catch { return null; }
}

module.exports = {
  obtenerCargas, obtenerEvidencia, partirUrlEvidencia, BASE,
  normalizarCarga, normalizarBulto,
};
