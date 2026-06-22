// api/m3link-viajes-proxy/index.js
// Proxy a M3Link RDTOut/OpsXRangoFechas con cache in-memory TTL 5 min.
// Reemplaza la versión anterior sin cache. Mismo patrón que sap-stock-proxy.

const https = require('https');

const API_HOST = 'apirdt1.azurewebsites.net';
const API_PATH = '/api/RDTOut/OpsXRangoFechas';
const TTL_MS = 5 * 60 * 1000; // 5 minutos
const FETCH_TIMEOUT_MS = 25000;

// Cache in-memory por instancia de Function (se recicla en cold start, está OK)
const cache = new Map(); // key = "fechaInicial_fechaFinal" → { data, timestamp }

function fetchM3Link(fechaInicial, fechaFinal, apiKey) {
  return new Promise((resolve, reject) => {
    const qs = `fechaInicial=${encodeURIComponent(fechaInicial)}&fechaFinal=${encodeURIComponent(fechaFinal)}`;
    const opts = {
      hostname: API_HOST,
      path: `${API_PATH}?${qs}`,
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: FETCH_TIMEOUT_MS
    };

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Upstream HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Upstream returned non-JSON: ' + body.substring(0, 200)));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Upstream timeout after ${FETCH_TIMEOUT_MS}ms`));
    });
    req.on('error', err => reject(err));
    req.end();
  });
}

module.exports = async function (context, req) {
  const fechaInicial = (req.query.fechaInicial || '').trim();
  const fechaFinal = (req.query.fechaFinal || '').trim();

  if (!fechaInicial || !fechaFinal) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Faltan parámetros fechaInicial y fechaFinal (formato YYYY-MM-DD)' }
    };
    return;
  }

  // Validar formato ISO básico
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFinal)) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' }
    };
    return;
  }

  const apiKey = process.env.REDTEC_API_KEY;
  if (!apiKey) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'REDTEC_API_KEY no configurada en Application Settings' }
    };
    return;
  }

  const cacheKey = `${fechaInicial}_${fechaFinal}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();

  // Cache HIT
  if (cached && (now - cached.timestamp) < TTL_MS) {
    const ageSec = Math.floor((now - cached.timestamp) / 1000);
    context.log(`[CACHE HIT] ${cacheKey} (age=${ageSec}s, ${cached.data.length} viajes)`);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'X-Cache-Age': `${ageSec}s`,
        'X-Cache-Expires-In': `${Math.floor((TTL_MS - (now - cached.timestamp)) / 1000)}s`,
        'Access-Control-Allow-Origin': '*'
      },
      body: cached.data
    };
    return;
  }

  // Cache MISS → fetch upstream
  context.log(`[CACHE MISS] ${cacheKey} → consultando M3Link…`);
  const t0 = Date.now();

  try {
    const data = await fetchM3Link(fechaInicial, fechaFinal, apiKey);
    const arr = Array.isArray(data) ? data : (data.items || data.data || []);
    const dt = Date.now() - t0;

    cache.set(cacheKey, { data: arr, timestamp: now });

    // Limpiar entradas expiradas para evitar leak (la cache rara vez crece mucho)
    if (cache.size > 50) {
      for (const [k, v] of cache.entries()) {
        if ((now - v.timestamp) > TTL_MS) cache.delete(k);
      }
    }

    context.log(`[FETCH OK] ${cacheKey} en ${dt}ms (${arr.length} viajes)`);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'X-Upstream-Time': `${dt}ms`,
        'Access-Control-Allow-Origin': '*'
      },
      body: arr
    };
  } catch (err) {
    context.log.error(`[FETCH ERROR] ${cacheKey}: ${err.message}`);

    // Si hay cache expirado, devolverlo como degradación (mejor algo viejo que nada)
    if (cached) {
      const ageSec = Math.floor((now - cached.timestamp) / 1000);
      context.log(`[STALE FALLBACK] devolviendo cache expirado (age=${ageSec}s)`);
      context.res = {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'STALE',
          'X-Cache-Age': `${ageSec}s`,
          'X-Upstream-Error': err.message,
          'Access-Control-Allow-Origin': '*'
        },
        body: cached.data
      };
      return;
    }

    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Error consultando M3Link upstream', detail: err.message }
    };
  }
};
