// ============================================================================
//  shared/talana-client.js  ·  Cliente HTTP de la API REST de Talana
//
//  Base:  https://talana.com/es/api/<recurso>/
//  Auth:  header  Authorization: Token <TALANA_TOKEN>
//
//  Talana aplica un límite de uso explícito (developers.talana.com → FAQ):
//     0–20 req/min  → recomendado
//    21–50 req/min  → aceptable, pero desaconsejado
//      >50 req/min  → HTTP 429 y BLOQUEO DE 10 MINUTOS de esa URL
//
//  Por eso este cliente NO permite llamadas en paralelo: todas las peticiones
//  pasan por una cola serializada con una separación mínima entre ellas
//  (TALANA_RPM, por defecto 18 req/min). Si aun así llega un 429, respeta el
//  header Retry-After y reintenta.
//
//  Como las Functions gestionadas de Static Web Apps se cortan alrededor de
//  los 45 s, cada operación recibe un "presupuesto" de tiempo: cuando se
//  agota, el cliente devuelve lo que alcanzó a traer y marca completo:false
//  para que el llamador reanude en la siguiente invocación.
// ============================================================================

const https = require('https');
const http  = require('http');

const HOST   = process.env.TALANA_HOST  || 'talana.com';
const PROTO  = process.env.TALANA_PROTO || 'https';
const BASE   = process.env.TALANA_BASE  || '/es/api';
const TOKEN  = process.env.TALANA_TOKEN || '';

// Peticiones por minuto que nos permitimos. Muy por debajo del techo de 50.
const RPM        = Math.max(1, Number(process.env.TALANA_RPM || 18));
const SEPARACION = Math.ceil(60000 / RPM);          // ms entre peticiones
const TIMEOUT    = Number(process.env.TALANA_TIMEOUT_MS || 25000);
const PAGE_SIZE  = Math.max(1, Number(process.env.TALANA_PAGE_SIZE || 200));
const REINTENTOS = Math.max(0, Number(process.env.TALANA_REINTENTOS || 2));

// ── presupuesto de tiempo ───────────────────────────────────────────────────
function crearPresupuesto(ms) {
  const fin = Date.now() + Math.max(0, ms);
  return {
    restante: () => fin - Date.now(),
    agotado:  (margen = 0) => (fin - Date.now()) <= margen
  };
}

// ── cola serializada con separación mínima ──────────────────────────────────
let cadena = Promise.resolve();
let ultimaSalida = 0;

const dormir = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function enCola(fn) {
  const turno = cadena.then(async () => {
    const espera = SEPARACION - (Date.now() - ultimaSalida);
    if (espera > 0) await dormir(espera);
    ultimaSalida = Date.now();
    return fn();
  });
  // La cadena nunca se rompe por un error de una petición concreta.
  cadena = turno.then(() => {}, () => {});
  return turno;
}

// ── petición cruda ──────────────────────────────────────────────────────────
function peticion(path) {
  const lib = PROTO === 'https' ? https : http;
  return new Promise(resolve => {
    const req = lib.request(
      {
        hostname: HOST,
        path,
        method: 'GET',
        headers: {
          'Authorization': `Token ${TOKEN}`,
          'Accept':        'application/json',
          'User-Agent':    'REDTEC-M3LINK/1.0'
        }
      },
      res => {
        let cuerpo = '';
        res.on('data', c => (cuerpo += c));
        res.on('end', () => resolve({ status: res.statusCode, cuerpo, headers: res.headers }));
      }
    );
    req.on('error', e => resolve({ status: 0, cuerpo: '', headers: {}, error: e.message }));
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      resolve({ status: 0, cuerpo: '', headers: {}, error: `Timeout ${TIMEOUT} ms en ${HOST}${path}` });
    });
    req.end();
  });
}

function construirPath(recurso, params) {
  // recurso: '/mark/'  → '/es/api/mark/?a=1&b=2'
  const limpio = recurso.startsWith('/') ? recurso : '/' + recurso;
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return BASE + limpio + (qs ? `?${qs}` : '');
}

/**
 * Una petición GET a Talana, con throttle y reintento ante 429 / 5xx.
 * Devuelve { status, json, cuerpo, path }. Lanza sólo si no hay token.
 */
async function get(recurso, params, opts = {}) {
  if (!TOKEN) {
    const e = new Error('TALANA_TOKEN no configurado en la Function App');
    e.codigo = 'SIN_TOKEN';
    throw e;
  }
  const path = typeof recurso === 'string' && recurso.startsWith(BASE)
    ? recurso                       // ya viene absoluto (enlace "next" de DRF)
    : construirPath(recurso, params);

  const presupuesto = opts.presupuesto;
  let intento = 0;

  while (true) {
    if (presupuesto && presupuesto.agotado(SEPARACION)) {
      return { status: 0, json: null, cuerpo: '', path, agotado: true };
    }

    const r = await enCola(() => peticion(path));

    // 429: respetar Retry-After. Si no alcanza el presupuesto, rendirse limpio.
    if (r.status === 429 && intento < REINTENTOS) {
      const esperaSeg = Number(r.headers['retry-after'] || 0);
      const espera = esperaSeg > 0 ? esperaSeg * 1000 : 15000 * (intento + 1);
      if (presupuesto && presupuesto.restante() < espera + SEPARACION) {
        return { status: 429, json: null, cuerpo: r.cuerpo, path, agotado: true };
      }
      await dormir(espera);
      intento++;
      continue;
    }

    // Error de red o 5xx transitorio.
    if ((r.status === 0 || r.status >= 500) && intento < REINTENTOS) {
      const espera = 2000 * (intento + 1);
      if (presupuesto && presupuesto.restante() < espera + SEPARACION) {
        return { status: r.status, json: null, cuerpo: r.cuerpo, path, error: r.error, agotado: true };
      }
      await dormir(espera);
      intento++;
      continue;
    }

    let json = null;
    if (r.cuerpo) { try { json = JSON.parse(r.cuerpo); } catch (_) { json = null; } }
    return { status: r.status, json, cuerpo: r.cuerpo, headers: r.headers, path, error: r.error };
  }
}

// ── normalización de respuestas ─────────────────────────────────────────────
// Talana mezcla dos formas: algunos recursos devuelven un array plano
// (sucursal, workShift, rotativeDay...) y otros el sobre paginado de DRF
// { count, next, previous, results }.
function extraerItems(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

/**
 * Recorre todas las páginas de un recurso siguiendo el enlace "next" de DRF.
 * Devuelve { items, completo, paginas, status, error }.
 *  - completo:false significa que se acabó el presupuesto o el tope de páginas
 *    y el llamador debe reanudar más tarde (los items traídos son válidos).
 */
async function listar(recurso, params, opts = {}) {
  const presupuesto = opts.presupuesto;
  const maxPaginas  = opts.maxPaginas || 60;
  const pageSize    = opts.pageSize || PAGE_SIZE;

  const items = [];
  let paginas = 0;
  let siguiente = null;
  let ultimoStatus = 0;

  while (paginas < maxPaginas) {
    const r = siguiente
      ? await get(siguiente, null, opts)
      : await get(recurso, { ...(params || {}), page_size: pageSize }, opts);

    ultimoStatus = r.status;

    if (r.agotado) return { items, completo: false, paginas, status: r.status, motivo: 'presupuesto' };

    if (r.status !== 200) {
      const e = new Error(`Talana ${recurso} → HTTP ${r.status}${r.error ? ' (' + r.error + ')' : ''}: ${String(r.cuerpo).slice(0, 300)}`);
      e.status = r.status;
      e.recurso = recurso;
      throw e;
    }

    const lote = extraerItems(r.json);
    items.push(...lote);
    paginas++;

    const next = r.json && !Array.isArray(r.json) ? r.json.next : null;
    if (!next) return { items, completo: true, paginas, status: ultimoStatus };

    // El "next" de DRF viene absoluto: quedarse con path + query.
    try {
      const u = new URL(next);
      siguiente = u.pathname + u.search;
    } catch (_) {
      siguiente = next.startsWith('/') ? next : null;
      if (!siguiente) return { items, completo: true, paginas, status: ultimoStatus };
    }
  }

  return { items, completo: false, paginas, status: ultimoStatus, motivo: 'max_paginas' };
}

module.exports = {
  get, listar, extraerItems, crearPresupuesto, construirPath,
  HOST, BASE, PROTO, RPM, SEPARACION, PAGE_SIZE,
  tieneToken: () => Boolean(TOKEN)
};
