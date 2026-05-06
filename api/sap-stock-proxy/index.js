// ─────────────────────────────────────────────────────────────────────────
// SAP-STOCK-PROXY · Azure Function (Node.js 18+)
// ─────────────────────────────────────────────────────────────────────────
// Proxy entre el dashboard m3link y SAP B1 Service Layer.
// Vista usada: STOCKHISTCLIENTE (movimientos históricos por cliente/bodega/producto)
//
// 3 MODOS DE OPERACIÓN:
//   ?modo=actual                            → Stock acumulado por (cliente, bodega, producto).
//                                              Suma entradas - salidas desde el inicio del rango,
//                                              devuelve solo las filas con stock != 0.
//   ?modo=movimientos&desde=&hasta=         → Movimientos crudos en el rango (raw data).
//   ?modo=stockxfecha&granularidad=         → Serie temporal con stock acumulado por
//                                              día/semana/mes (granularidades disponibles).
//   ?test=1                                 → Valida login a SAP, no consulta data.
//
// Filtros opcionales en todos los modos:
//   &cliente=XXX         → filtra por SL1Code (nombre del cliente/retail)
//   &whsCode=CLIENTES    → filtra por WhsCode ('CLIENTES' o 'RETAIL')
//   &desde=YYYY-MM-DD    → fecha inicio
//   &hasta=YYYY-MM-DD    → fecha fin
//
// Configuración requerida (Application Settings):
//   SAP_USER, SAP_PASS, SAP_DB, SAP_LOGIN_URL, SAP_DATA_URL
// ─────────────────────────────────────────────────────────────────────────

const https = require('https');
const { URL } = require('url');

// SAP B1 usa cert autofirmado en instalaciones internas → ignorar verificación.
const sapAgent = new https.Agent({ rejectUnauthorized: false });

// Cache en memoria de la sesión SAP (~30 min en SAP B1).
let cachedSession = { id: null, routeId: null, expiresAt: 0 };
const SESSION_TTL_MS = 25 * 60 * 1000;

// Cache en memoria del resultado del modo 'actual'.
// Key incluye los filtros para no mezclar respuestas de queries distintas.
// TTL: 1 hora. Si Azure recrea el container, se pierde (es esperado).
const stockActualCache = new Map();
const STOCK_CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hora

// ─────────────────────────────────────────────────────────────────────────
// HELPERS HTTP
// ─────────────────────────────────────────────────────────────────────────
function sapRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method: method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: headers || {},
      agent: sapAgent,
      timeout: 60000  // 60 seg por request a SAP. Usado solo para modo 'actual'
    };

    if (body) {
      const buf = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(buf);
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: text, json: json });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (60s) conectando a SAP')); });

    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// LOGIN A SAP B1
// ─────────────────────────────────────────────────────────────────────────
async function loginSAP(context) {
  const loginUrl = process.env.SAP_LOGIN_URL;
  const userName = process.env.SAP_USER;
  const password = process.env.SAP_PASS;
  const companyDB = process.env.SAP_DB;

  if (!loginUrl || !userName || !password || !companyDB) {
    throw new Error('Application Settings incompletas: faltan SAP_LOGIN_URL/SAP_USER/SAP_PASS/SAP_DB');
  }

  context.log('[SAP] Login a ' + loginUrl + ' como ' + userName);

  const res = await sapRequest('POST', loginUrl, { 'Content-Type': 'application/json' },
    { UserName: userName, Password: password, CompanyDB: companyDB });

  if (res.status !== 200) {
    throw new Error('Login SAP falló (HTTP ' + res.status + '): ' + (res.body || '').substring(0, 500));
  }

  const setCookies = res.headers['set-cookie'] || [];
  let sessionId = null, routeId = null;
  setCookies.forEach(c => {
    const sm = c.match(/B1SESSION=([^;]+)/);
    const rm = c.match(/ROUTEID=([^;]+)/);
    if (sm) sessionId = sm[1];
    if (rm) routeId = rm[1];
  });
  if (!sessionId && res.json && res.json.SessionId) sessionId = res.json.SessionId;

  if (!sessionId) throw new Error('Login OK pero no se obtuvo B1SESSION. Body: ' + (res.body || '').substring(0, 300));

  cachedSession = { id: sessionId, routeId: routeId, expiresAt: Date.now() + SESSION_TTL_MS };
  context.log('[SAP] Login OK · sesión válida por ' + (SESSION_TTL_MS / 60000) + ' min');
  return cachedSession;
}

async function getSession(context, forceNew) {
  if (!forceNew && cachedSession.id && Date.now() < cachedSession.expiresAt) {
    context.log('[SAP] Reusando sesión cacheada');
    return cachedSession;
  }
  return await loginSAP(context);
}

// ─────────────────────────────────────────────────────────────────────────
// FETCH RAW: trae movimientos crudos desde SAP (con paginación OData)
// ─────────────────────────────────────────────────────────────────────────
async function fetchRaw(context, filtros) {
  const baseUrl = process.env.SAP_DATA_URL;
  if (!baseUrl) throw new Error('Falta SAP_DATA_URL en Application Settings');

  // Construir filtros OData
  const odataFilters = [];
  if (filtros.cliente)  odataFilters.push("SL1Code eq '" + filtros.cliente.replace(/'/g, "''") + "'");
  if (filtros.whsCode)  odataFilters.push("WhsCode eq '" + filtros.whsCode.replace(/'/g, "''") + "'");
  if (filtros.desde)    odataFilters.push("DocDate ge '" + filtros.desde + "'");
  if (filtros.hasta)    odataFilters.push("DocDate le '" + filtros.hasta + "'");

  let queryUrl = baseUrl;
  if (odataFilters.length) {
    queryUrl += '?$filter=' + encodeURIComponent(odataFilters.join(' and '));
  }

  context.log('[SAP] Query → ' + queryUrl);

  let allRows = [];
  let nextUrl = queryUrl;
  let pageCount = 0;
  let session = await getSession(context);

  while (nextUrl && pageCount < 50) {
    pageCount++;

    let res;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const cookieVal = 'B1SESSION=' + session.id + (session.routeId ? '; ROUTEID=' + session.routeId : '');
      res = await sapRequest('GET', nextUrl, {
        'Cookie': cookieVal,
        'Prefer': 'odata.maxpagesize=300000',
        'Accept': 'application/json'
      });

      if (res.status === 401 && attempt === 1) {
        context.log('[SAP] Sesión expirada (401). Re-login...');
        session = await getSession(context, true);
        continue;
      }
      break;
    }

    if (res.status !== 200) {
      throw new Error('Query SAP falló (HTTP ' + res.status + '): ' + (res.body || '').substring(0, 500));
    }

    const data = res.json || {};
    const rows = data.value || [];
    allRows = allRows.concat(rows);
    context.log('[SAP] Página ' + pageCount + ': +' + rows.length + ' (acumulado: ' + allRows.length + ')');

    nextUrl = data['@odata.nextLink'] || null;
    if (nextUrl && !nextUrl.startsWith('http')) {
      const base = new URL(baseUrl);
      nextUrl = base.origin + '/' + nextUrl.replace(/^\//, '');
    }
  }

  return allRows;
}

// Mapea fila cruda de SAP a estructura legible
function mapRow(r) {
  return {
    cliente:     r.WhsCode,            // 'CLIENTES' o 'RETAIL'
    nombre:      r.SL1Code,            // PUNTOAZUL, WALMART, etc
    bodega:      r.BinCode,            // código de bodega (AGRICOLALOPINTO-001)
    descripcion: r.Descr,              // nombre legible de la bodega
    producto:    r.ItemCode,
    fecha:       r.DocDate,
    entrada:     Number(r.Entrada || 0),
    salida:      Number(r.Salida || 0),
    id:          r.id__
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MODO 'ACTUAL': stock acumulado por (whsCode, nombre, bodega, producto)
// ─────────────────────────────────────────────────────────────────────────
function calcularStockActual(rows) {
  const mapa = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const whs = r.WhsCode || '';
    const nom = r.SL1Code || '';
    const bod = r.BinCode || '';
    const prd = r.ItemCode || '';
    const desc = r.Descr || '';
    const ent = Number(r.Entrada || 0);
    const sal = Number(r.Salida || 0);

    const key = whs + '|' + nom + '|' + bod + '|' + prd;
    if (!mapa[key]) {
      mapa[key] = {
        cliente:     whs,        // 'CLIENTES' o 'RETAIL'
        nombre:      nom,
        bodega:      bod,
        descripcion: desc,
        producto:    prd,
        stock:       0,
        entradas:    0,
        salidas:     0,
        movimientos: 0
      };
    }
    mapa[key].entradas += ent;
    mapa[key].salidas  += sal;
    mapa[key].stock    += (ent - sal);
    mapa[key].movimientos++;
  }

  // Devolver solo combinaciones con stock distinto de cero (filtro útil para UI)
  return Object.values(mapa).filter(x => x.stock !== 0);
}

// ─────────────────────────────────────────────────────────────────────────
// MODO 'STOCKXFECHA': serie temporal de stock
// granularidad: 'diario' | 'semanal' | 'mensual' (default semanal)
// stockTipo:
//   'acumulado' (default) → stock al cierre de cada período (acumulado desde el inicio)
//   'periodo'             → solo movimiento neto de cada período (entradas - salidas)
// ─────────────────────────────────────────────────────────────────────────

// Devuelve clave del período según granularidad
// 'diario'   → 'YYYY-MM-DD'
// 'semanal'  → 'YYYY-Www' (ISO week)
// 'mensual'  → 'YYYY-MM'
function periodoClave(fechaIso, granularidad) {
  if (!fechaIso) return '';
  const iso = fechaIso.substring(0, 10);
  if (granularidad === 'diario')  return iso;
  if (granularidad === 'mensual') return iso.substring(0, 7);
  // ISO week
  const d = new Date(iso + 'T12:00:00Z');
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - target) / (7 * 86400000));
  return d.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function calcularStockXFecha(rows, granularidad, stockTipo) {
  // Paso 1: agrupar movimientos por (combinación, período)
  // movimientos[claveGrupo][periodo] = { entradas, salidas }
  const movimientos = {};
  rows.forEach(r => {
    const grupo = (r.WhsCode || '') + '|' + (r.SL1Code || '');  // por cliente
    const periodo = periodoClave(r.DocDate, granularidad);
    if (!periodo) return;
    if (!movimientos[grupo]) movimientos[grupo] = {};
    if (!movimientos[grupo][periodo]) movimientos[grupo][periodo] = { e: 0, s: 0 };
    movimientos[grupo][periodo].e += Number(r.Entrada || 0);
    movimientos[grupo][periodo].s += Number(r.Salida || 0);
  });

  // Paso 2:
  //   - acumulado: cronológicamente vamos sumando (stock al cierre)
  //   - periodo: solo el neto del período (entradas - salidas)
  const resultado = [];
  Object.keys(movimientos).forEach(grupo => {
    const partes = grupo.split('|');
    const whsCode = partes[0];
    const nombre = partes[1];
    const periodos = Object.keys(movimientos[grupo]).sort();
    let acumulado = 0;
    periodos.forEach(p => {
      const m = movimientos[grupo][p];
      const neto = m.e - m.s;
      acumulado += neto;
      resultado.push({
        cliente:  whsCode,        // CLIENTES o RETAIL
        nombre:   nombre,
        periodo:  p,
        entradas: m.e,
        salidas:  m.s,
        // 'stock' depende de stockTipo:
        //   acumulado → al cierre del período (stock real)
        //   periodo   → solo el movimiento neto del período (puede ser negativo)
        stock:    stockTipo === 'periodo' ? neto : acumulado
      });
    });
  });

  return resultado;
}

// ─────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders() };
    return;
  }

  const t0 = Date.now();
  const params = req.query || {};

  try {
    // Modo TEST
    if (params.test === '1') {
      const sess = await getSession(context, true);
      context.res = {
        status: 200,
        headers: corsHeaders(),
        body: {
          ok: true,
          mensaje: 'Login a SAP exitoso',
          sessionId: sess.id ? sess.id.substring(0, 8) + '...' : null,
          routeId: sess.routeId,
          tomo_ms: Date.now() - t0,
          configuracion: {
            login_url: process.env.SAP_LOGIN_URL,
            data_url:  process.env.SAP_DATA_URL,
            user:      process.env.SAP_USER,
            db:        process.env.SAP_DB
          }
        }
      };
      return;
    }

    // Filtros comunes
    const filtros = {
      cliente: params.cliente || null,
      whsCode: params.whsCode || null,
      desde:   params.desde   || null,
      hasta:   params.hasta   || null
    };

    // Detectar modo. Default 'movimientos' para mantener compatibilidad con la primera versión.
    const modo = (params.modo || 'movimientos').toLowerCase();

    // MODO ACTUAL: trae todo el histórico (o desde 'desde' si se especifica), agrupa, suma
    if (modo === 'actual') {
      // Si no se especifica desde/hasta, partir desde 2023 (data más antigua disponible)
      if (!filtros.desde) filtros.desde = '2023-01-01';
      if (!filtros.hasta) filtros.hasta = new Date().toISOString().substring(0, 10);

      // Cache key por filtros (cliente, whsCode, desde, hasta)
      const cacheKey = JSON.stringify(filtros);
      const forceRefresh = params.forceRefresh === '1' || params.refresh === '1';

      // Verificar cache (a menos que se haya pedido forceRefresh)
      if (!forceRefresh) {
        const cached = stockActualCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
          const ageMs = Date.now() - cached.savedAt;
          context.log('[SAP] CACHE HIT modo actual · edad ' + Math.round(ageMs/1000) + 's · ' + cached.payload.total + ' combinaciones');
          context.res = {
            status: 200,
            headers: corsHeaders(),
            body: Object.assign({}, cached.payload, {
              cache_hit: true,
              cache_age_seconds: Math.round(ageMs / 1000),
              tomo_ms: Date.now() - t0
            })
          };
          return;
        }
      }

      // CACHE MISS: query fresca a SAP
      context.log('[SAP] CACHE MISS modo actual · pidiendo a SAP...');
      const rows = await fetchRaw(context, filtros);
      const stockActual = calcularStockActual(rows);

      context.log('[SAP] Stock actual: ' + stockActual.length + ' combinaciones (de ' + rows.length + ' movimientos)');

      // Totales por WhsCode (CLIENTES vs RETAIL) para KPIs rápidos
      const totalesPorTipo = {};
      stockActual.forEach(r => {
        if (!totalesPorTipo[r.cliente]) totalesPorTipo[r.cliente] = { combinaciones: 0, total_pallets: 0, clientes_unicos: new Set() };
        totalesPorTipo[r.cliente].combinaciones++;
        totalesPorTipo[r.cliente].total_pallets += r.stock;
        totalesPorTipo[r.cliente].clientes_unicos.add(r.nombre);
      });
      Object.keys(totalesPorTipo).forEach(k => {
        totalesPorTipo[k].clientes_unicos = totalesPorTipo[k].clientes_unicos.size;
      });

      const payload = {
        ok: true,
        modo: 'actual',
        total: stockActual.length,
        movimientos_procesados: rows.length,
        filtros: filtros,
        totales_por_tipo: totalesPorTipo,
        items: stockActual
      };

      // Guardar en cache
      stockActualCache.set(cacheKey, {
        savedAt: Date.now(),
        expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
        payload: payload
      });
      context.log('[SAP] Cache guardado · TTL ' + (STOCK_CACHE_TTL_MS/60000) + ' min');

      context.res = {
        status: 200,
        headers: corsHeaders(),
        body: Object.assign({}, payload, {
          cache_hit: false,
          tomo_ms: Date.now() - t0
        })
      };
      return;
    }

    // MODO STOCKXFECHA: serie temporal con stock acumulado o por período
    if (modo === 'stockxfecha') {
      const granularidad = (params.granularidad || 'semanal').toLowerCase();
      if (['diario', 'semanal', 'mensual'].indexOf(granularidad) < 0) {
        throw new Error("granularidad inválida: usa 'diario', 'semanal' o 'mensual'");
      }
      const stockTipo = (params.stockTipo || 'acumulado').toLowerCase();
      if (['acumulado', 'periodo'].indexOf(stockTipo) < 0) {
        throw new Error("stockTipo inválido: usa 'acumulado' o 'periodo'");
      }
      // Para 'acumulado' siempre arrancamos desde 2023 para que el cálculo sea correcto.
      // Para 'periodo' respetamos el rango pedido por el usuario.
      if (stockTipo === 'acumulado') {
        if (!filtros.desde) filtros.desde = '2023-01-01';
        if (!filtros.hasta) filtros.hasta = new Date().toISOString().substring(0, 10);
      } else {
        if (!filtros.desde) filtros.desde = '2023-01-01';
        if (!filtros.hasta) filtros.hasta = new Date().toISOString().substring(0, 10);
      }

      const rows = await fetchRaw(context, filtros);
      const serie = calcularStockXFecha(rows, granularidad, stockTipo);

      context.res = {
        status: 200,
        headers: corsHeaders(),
        body: {
          ok: true,
          modo: 'stockxfecha',
          granularidad: granularidad,
          stockTipo: stockTipo,
          total: serie.length,
          movimientos_procesados: rows.length,
          filtros: filtros,
          tomo_ms: Date.now() - t0,
          items: serie
        }
      };
      return;
    }

    // MODO MOVIMIENTOS (default): raw data sin procesar
    const rows = await fetchRaw(context, filtros);
    const mapped = rows.map(mapRow);

    context.res = {
      status: 200,
      headers: corsHeaders(),
      body: {
        ok: true,
        modo: 'movimientos',
        total: mapped.length,
        filtros: filtros,
        tomo_ms: Date.now() - t0,
        items: mapped
      }
    };
  } catch (err) {
    context.log.error('[SAP] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders(),
      body: {
        ok: false,
        error: err.message || String(err),
        tomo_ms: Date.now() - t0
      }
    };
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
}
