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
 * Recorre TODAS las paginas de /redtec/cargas para un rango.
 * Devuelve el array plano de cargas tal cual lo entrega la API.
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
    todas.push(...lote);
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

module.exports = { obtenerCargas, obtenerEvidencia, partirUrlEvidencia, BASE };
