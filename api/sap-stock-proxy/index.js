// ─────────────────────────────────────────────────────────────────────────
// SAP-STOCK-PROXY · Azure Function (Node.js 18+)
// ─────────────────────────────────────────────────────────────────────────
// Proxy entre el dashboard m3link y SAP B1 Service Layer.
//
// Maneja:
//   1. Login a SAP B1 → obtiene B1SESSION cookie
//   2. Cacheo de la sesión (válida ~30 min, se reutiliza entre requests)
//   3. Re-login automático si la sesión expiró (HTTP 401)
//   4. Query a STOCKHISTCLIENTE con filtros opcionales
//   5. Paginación de OData (@odata.nextLink) para traer todos los registros
//   6. Manejo de SSL autofirmado (común en SAP B1 instalaciones internas)
//
// Configuración requerida (Application Settings de la Function App):
//   SAP_USER       = virtualdv\red.sistemas
//   SAP_PASS       = (password)
//   SAP_DB         = CLPRDREDTEC
//   SAP_LOGIN_URL  = https://hwvdvc02sbo01.virtualdv.cloud:50000/b1s/v2/Login
//   SAP_DATA_URL   = https://hwvdvc02sbo01.virtualdv.cloud:50000/b1s/v1/sml.svc/STOCKHISTCLIENTE
//
// Endpoints expuestos:
//   GET /api/sap-stock-proxy?test=1            → valida login, sin consultar data
//   GET /api/sap-stock-proxy?cliente=XXX       → filtra por WhsCode (cliente)
//   GET /api/sap-stock-proxy?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET /api/sap-stock-proxy                   → trae todo (cuidado: muy grande)
// ─────────────────────────────────────────────────────────────────────────

const https = require('https');
const { URL } = require('url');

// SAP B1 usa cert autofirmado en instalaciones internas → ignorar verificación.
// Solo aplica a conexiones a SAP, no afecta otros HTTPS.
const sapAgent = new https.Agent({ rejectUnauthorized: false });

// Cache en memoria de la sesión SAP. Las sesiones duran ~30 min en SAP B1.
let cachedSession = {
  id: null,
  routeId: null,
  expiresAt: 0
};
const SESSION_TTL_MS = 25 * 60 * 1000;  // 25 min con margen seguro

// ─────────────────────────────────────────────────────────────────────────
// HELPER: HTTPS request con agente SAP (acepta cert autofirmado)
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
      timeout: 30000
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (30s) conectando a SAP')); });

    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// LOGIN a SAP B1
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

  // Cookies vienen en headers['set-cookie'] como array
  const setCookies = res.headers['set-cookie'] || [];
  let sessionId = null, routeId = null;
  setCookies.forEach(c => {
    const sm = c.match(/B1SESSION=([^;]+)/);
    const rm = c.match(/ROUTEID=([^;]+)/);
    if (sm) sessionId = sm[1];
    if (rm) routeId = rm[1];
  });

  // Fallback: algunas versiones devuelven SessionId en el body
  if (!sessionId && res.json && res.json.SessionId) sessionId = res.json.SessionId;

  if (!sessionId) {
    throw new Error('Login OK pero no se obtuvo B1SESSION. Body: ' + (res.body || '').substring(0, 300));
  }

  cachedSession = {
    id: sessionId,
    routeId: routeId,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
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
// QUERY a STOCKHISTCLIENTE (con paginación OData)
// ─────────────────────────────────────────────────────────────────────────
async function fetchStock(context, filtros) {
  const baseUrl = process.env.SAP_DATA_URL;
  if (!baseUrl) throw new Error('Falta SAP_DATA_URL en Application Settings');

  const odataFilters = [];
  if (filtros.cliente) odataFilters.push("WhsCode eq '" + filtros.cliente.replace(/'/g, "''") + "'");
  if (filtros.desde)   odataFilters.push("DocDate ge '" + filtros.desde + "'");
  if (filtros.hasta)   odataFilters.push("DocDate le '" + filtros.hasta + "'");

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

    // Hasta 2 intentos por página (re-login si 401)
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
    context.log('[SAP] Página ' + pageCount + ': +' + rows.length + ' filas (acumulado: ' + allRows.length + ')');

    // Paginación OData
    nextUrl = data['@odata.nextLink'] || null;
    if (nextUrl && !nextUrl.startsWith('http')) {
      const base = new URL(baseUrl);
      nextUrl = base.origin + '/' + nextUrl.replace(/^\//, '');
    }
  }

  return allRows;
}

// ─────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders() };
    return;
  }

  const t0 = Date.now();
  const params = req.query || {};

  try {
    // Modo TEST: solo valida login, no consulta data
    if (params.test === '1') {
      const sess = await getSession(context, true);  // forzar login fresco
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

    // Query normal
    const filtros = {
      cliente: params.cliente || null,
      desde:   params.desde   || null,
      hasta:   params.hasta   || null
    };
    const rows = await fetchStock(context, filtros);

    // Mapear columnas con nombres legibles (igual al script Python original)
    const mapped = rows.map(r => ({
      cliente:     r.WhsCode,
      nombre:      r.SL1Code,
      bodega:      r.BinCode,
      descripcion: r.Descr,
      producto:    r.ItemCode,
      fecha:       r.DocDate,
      entrada:     Number(r.Entrada || 0),
      salida:      Number(r.Salida || 0),
      id:          r.id__
    }));

    context.res = {
      status: 200,
      headers: corsHeaders(),
      body: {
        ok: true,
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
