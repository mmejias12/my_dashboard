// ─────────────────────────────────────────────────────────────────────────
// SAP-STOCK-PROXY · Azure Function (Node.js 18+)
// ─────────────────────────────────────────────────────────────────────────
// Proxy entre el dashboard m3link y SAP B1 Service Layer.
// Vista usada: STOCKHISTCLIENTE (movimientos históricos por cliente/bodega/producto)
//
// 4 MODOS DE OPERACIÓN:
//   ?modo=actual                            → Stock acumulado por (cliente, bodega, producto).
//                                              Suma entradas - salidas desde el inicio del rango,
//                                              devuelve solo las filas con stock != 0.
//   ?modo=cierredia&fecha=YYYY-MM-DD        → Stock al cierre de una fecha específica (23:59).
//                                              Devuelve totales agrupados CLIENTES/RETAIL.
//                                              Útil para gerencia: "cierre del día anterior" exacto.
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
// SONDA DEL SERVICE LAYER
//
// El monitor de anden no puede verificar las cargas de pallet blanco: su
// documento vive en SAP, no en Redlink. Antes de construir esa pasada hay que
// saber si SAP nos la puede dar, y eso no se averigua leyendo codigo.
//
// Tres preguntas, una sola llamada:
//   1. A que entidades llegamos con las credenciales de hoy. El proxy usa la
//      vista semantica sml.svc/STOCKHISTCLIENTE; las entidades estandar viven
//      en otra rama (b1s/v1/DeliveryNotes, /Invoices...) y el permiso puede ser
//      distinto.
//   2. Cuantos documentos hay en la fecha que se pida.
//   3. LA QUE DECIDE TODO: si esos documentos traen la PATENTE. Sin patente no
//      hay con que cruzar contra el conteo de la camara, y entonces el hueco no
//      se cierra leyendo SAP por muchos documentos que haya: alguien tiene que
//      registrar la patente en el documento.
//
// La sonda es de SOLO LECTURA: un $top acotado por entidad y nada mas.
// ─────────────────────────────────────────────────────────────────────────

// Documentos que podrian contener el movimiento de pallet blanco.
const ENTIDADES_SONDA = [
  { nombre: 'DeliveryNotes',         que: 'entregas de venta (guia de despacho)' },
  { nombre: 'Invoices',              que: 'facturas de venta' },
  { nombre: 'PurchaseDeliveryNotes', que: 'recepciones de compra' },
  { nombre: 'PurchaseInvoices',      que: 'facturas de compra' },
  { nombre: 'Orders',                que: 'pedidos de venta' },
  { nombre: 'InventoryGenExits',     que: 'salidas de inventario' },
  { nombre: 'InventoryGenEntries',   que: 'entradas de inventario' },
];

// Patente chilena: 4 letras + 2 digitos (nuevo) o 2 letras + 4 digitos (antiguo).
const RE_PATENTE = /\b([A-Z]{4}\d{2}|[A-Z]{2}\d{4})\b/;

/** Recorre un objeto y devuelve los campos cuyo valor parece una patente. */
function camposConPatente(obj, prefijo, salida, profundidad) {
  salida = salida || [];
  profundidad = profundidad || 0;
  if (!obj || typeof obj !== 'object' || profundidad > 3) return salida;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string') {
      const m = RE_PATENTE.exec(v.toUpperCase());
      if (m) salida.push({ campo: (prefijo ? prefijo + '.' : '') + k, valor: v.slice(0, 40), patente: m[1] });
    } else if (Array.isArray(v)) {
      v.slice(0, 3).forEach((x, i) =>
        camposConPatente(x, (prefijo ? prefijo + '.' : '') + k + '[' + i + ']', salida, profundidad + 1));
    } else if (typeof v === 'object') {
      camposConPatente(v, (prefijo ? prefijo + '.' : '') + k, salida, profundidad + 1);
    }
  }
  return salida;
}

async function sondear(context, fecha) {
  // PRIMERO LO OBVIO: que SAP este configurado en ESTA Function App.
  // La primera version de la sonda respondia "no se pudo deducir la raiz del
  // Service Layer", que era cierto pero desorientaba: la raiz no se podia
  // deducir porque la URL venia vacia. Un diagnostico que no distingue "no esta
  // configurado" de "esta mal configurado" hace perder una vuelta entera.
  const faltan = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (faltan.length) {
    return {
      ok: false, configurado: false, faltan,
      error: 'SAP no esta configurado en esta Function App. Faltan: ' + faltan.join(', '),
      como_arreglarlo: 'Azure Portal -> la Function App del m3link -> Configuration -> '
        + 'Application settings. Los valores estan documentados en api/sap-stock-proxy/README.md '
        + '(ese README apunta a la Function App func-redtec-sap, que es OTRA: por eso aca no estan).',
    };
  }

  const login = process.env.SAP_LOGIN_URL;
  // La raiz del Service Layer sale de la URL de login: .../b1s/v2/Login -> .../b1s/v1
  let raiz = login.replace(/\/b1s\/v\d+\/Login\/?$/i, '/b1s/v1');
  if (raiz === login) {
    // Respaldo: cortar en /b1s/, que es lo unico que el Service Layer garantiza.
    const i = login.toLowerCase().indexOf('/b1s/');
    if (i < 0) {
      return { ok: false, configurado: true,
               error: 'SAP_LOGIN_URL no parece una URL del Service Layer: ' + login };
    }
    raiz = login.slice(0, i) + '/b1s/v1';
  }

  let session;
  try {
    session = await getSession(context);
  } catch (e) {
    // Configurado pero incomunicado. Es un problema distinto y se resuelve en
    // otra parte, asi que conviene decirlo con todas sus letras.
    return {
      ok: false, configurado: true, alcanzable: false, raiz,
      error: 'SAP esta configurado pero no se pudo conectar: ' + (e.message || e),
      pista: 'Un ENOTFOUND, ECONNREFUSED o timeout apunta a la red, no a las credenciales: '
        + 'el puerto 50000 del SAP tiene que estar abierto a las IPs de salida de Azure, '
        + 'o la Function App necesita integracion con la VNet que resuelve ese DNS.',
    };
  }
  const cookie = () => 'B1SESSION=' + session.id + (session.routeId ? '; ROUTEID=' + session.routeId : '');

  const resultado = { raiz, fecha, entidades: [] };

  for (const ent of ENTIDADES_SONDA) {
    // $top=5 y filtro por fecha: alcanza para responder las tres preguntas sin
    // traerse medio SAP a una Function.
    const url = raiz + '/' + ent.nombre
      + "?$filter=DocDate eq '" + fecha + "'"
      + '&$top=5&$orderby=DocEntry desc';

    let res;
    try {
      res = await sapRequest('GET', url, { Cookie: cookie(), Accept: 'application/json' });
      if (res.status === 401) {                       // sesion vencida: un reintento
        session = await getSession(context, true);
        res = await sapRequest('GET', url, { Cookie: cookie(), Accept: 'application/json' });
      }
    } catch (e) {
      resultado.entidades.push({ entidad: ent.nombre, que: ent.que, error: String(e.message || e) });
      continue;
    }

    const fila = { entidad: ent.nombre, que: ent.que, status: res.status };
    if (res.status !== 200) {
      // El mensaje de SAP distingue "no existe" de "no tienes permiso", y esa
      // diferencia decide si el camino esta cerrado o solo falta autorizacion.
      fila.detalle = (res.body || '').slice(0, 200);
      resultado.entidades.push(fila);
      continue;
    }

    const filas = (res.json && res.json.value) || [];
    fila.documentos = filas.length;
    if (filas.length) {
      const d = filas[0];
      fila.ejemplo = {
        DocEntry: d.DocEntry, DocNum: d.DocNum, DocDate: d.DocDate,
        CardCode: d.CardCode, CardName: d.CardName,
        Comments: d.Comments ? String(d.Comments).slice(0, 80) : null,
        lineas: Array.isArray(d.DocumentLines) ? d.DocumentLines.length : null,
        cantidad_total: Array.isArray(d.DocumentLines)
          ? d.DocumentLines.reduce((s, l) => s + (Number(l.Quantity) || 0), 0) : null,
      };
      // Campos definidos por el usuario: es donde suele terminar la patente.
      fila.campos_udf = Object.keys(d).filter(k => k.indexOf('U_') === 0);
      // LA PREGUNTA QUE DECIDE: hay algo que parezca una patente, en cualquier campo?
      const hallazgos = [];
      filas.forEach((doc, i) => camposConPatente(doc, 'doc[' + i + ']', hallazgos));
      fila.patente_detectada = hallazgos.length > 0;
      fila.donde_aparece = hallazgos.slice(0, 6);
      // Campos de transporte estandar, por si vienen vacios pero existen
      fila.campos_transporte = ['TrackingNumber', 'TransportationCode', 'ShipToCode', 'U_Patente']
        .filter(k => k in d)
        .map(k => k + '=' + (d[k] == null ? 'null' : String(d[k]).slice(0, 30)));
    }
    resultado.entidades.push(fila);
  }

  // Lectura en una linea, para no tener que interpretar el JSON a mano.
  const conDocs = resultado.entidades.filter(e => e.documentos > 0);
  const conPatente = resultado.entidades.filter(e => e.patente_detectada);
  resultado.conclusion =
    conDocs.length === 0
      ? 'No se alcanzo ninguna entidad con documentos en ' + fecha
        + '. Revisar permisos del usuario SAP o probar otra fecha.'
      : conPatente.length === 0
        ? 'Hay documentos (' + conDocs.map(e => e.entidad).join(', ') + ') pero NINGUNO trae patente. '
          + 'El cruce con la camara no se puede cerrar leyendo SAP: hay que registrar la patente en el documento.'
        : 'Hay documentos CON patente en: ' + conPatente.map(e => e.entidad).join(', ')
          + '. La pasada es viable.';
  resultado.ok = true;
  resultado.configurado = true;
  resultado.alcanzable = true;
  return resultado;
}

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

    // Modo SONDA: que nos puede dar SAP para el cruce del anden.
    //   GET /api/sap-stock-proxy?sondeo=1&fecha=YYYY-MM-DD
    if (params.sondeo === '1') {
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.fecha || '')
        ? params.fecha
        : new Date().toISOString().substring(0, 10);
      const r = await sondear(context, fecha);
      context.res = { status: 200, headers: corsHeaders(), body: { ...r, tomo_ms: Date.now() - t0 } };
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

    // ─────────────────────────────────────────────────────────────────
    // MODO CIERREDIA: stock al cierre de una fecha específica (23:59).
    // Replica exactamente lo que hace el script de Google Colab del colega:
    // trae todos los movimientos hasta esa fecha y suma Entrada - Salida
    // agrupado por WhsCode (CLIENTES / RETAIL).
    //
    // Uso: ?modo=cierredia&fecha=2026-05-31
    //
    // Cache de 30 minutos por fecha (los cierres pasados no cambian).
    // ─────────────────────────────────────────────────────────────────
    if (modo === 'cierredia') {
      const fechaCorte = params.fecha || '';
      if (!fechaCorte || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte)) {
        throw new Error("Parámetro 'fecha' es requerido en formato YYYY-MM-DD. Ej: ?modo=cierredia&fecha=2026-05-31");
      }

      // Cache key específica para este modo + fecha + filtros opcionales
      const filtrosCierre = Object.assign({}, filtros, { fechaCorte: fechaCorte });
      const cacheKey = 'cierredia:' + JSON.stringify(filtrosCierre);
      const forceRefresh = params.forceRefresh === '1' || params.refresh === '1';

      if (!forceRefresh) {
        const cached = stockActualCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
          const ageMs = Date.now() - cached.savedAt;
          context.log('[SAP] CACHE HIT cierredia ' + fechaCorte + ' · edad ' + Math.round(ageMs/1000) + 's');
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

      // CACHE MISS: pedir movimientos a SAP hasta la fecha de corte.
      // Usamos baseline 2023 (igual que modo 'actual') o el desde explícito si se pasa.
      const filtrosQuery = Object.assign({}, filtros);
      if (!filtrosQuery.desde) filtrosQuery.desde = '2023-01-01';
      filtrosQuery.hasta = fechaCorte;   // hasta la fecha de corte (inclusive)

      context.log('[SAP] CACHE MISS cierredia ' + fechaCorte + ' · pidiendo a SAP...');
      const rows = await fetchRaw(context, filtrosQuery);

      // Sumar Entrada - Salida agrupado por WhsCode.
      // El campo es 'WhsCode' en SAP y vale "CLIENTES" o "RETAIL".
      let totalClientes = 0;
      let totalRetail   = 0;
      let combClientes  = new Set();
      let combRetail    = new Set();

      for (const r of rows) {
        const tipo = String(r.WhsCode || '').toUpperCase();
        const delta = (Number(r.Entrada) || 0) - (Number(r.Salida) || 0);
        const combKey = r.SL1Code + '|' + r.BinCode + '|' + r.ItemCode;

        if (tipo === 'CLIENTES') {
          totalClientes += delta;
          combClientes.add(combKey);
        } else if (tipo === 'RETAIL') {
          totalRetail += delta;
          combRetail.add(combKey);
        }
      }

      const payload = {
        ok: true,
        modo: 'cierredia',
        fechaCorte: fechaCorte,
        movimientos_procesados: rows.length,
        filtros: filtrosQuery,
        totales_por_tipo: {
          CLIENTES: {
            total_pallets: totalClientes,
            combinaciones: combClientes.size
          },
          RETAIL: {
            total_pallets: totalRetail,
            combinaciones: combRetail.size
          }
        }
      };

      // Cache de 30 minutos. Para fechas de cierre pasadas, el dato no cambia,
      // pero limitamos por si SAP recibe correcciones retroactivas.
      const CIERRE_TTL_MS = 30 * 60 * 1000;
      stockActualCache.set(cacheKey, {
        savedAt: Date.now(),
        expiresAt: Date.now() + CIERRE_TTL_MS,
        payload: payload
      });
      context.log('[SAP] cierredia ' + fechaCorte + ' · Clientes: ' + totalClientes + ' · Retail: ' + totalRetail);

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
      // Baseline configurable para 'acumulado':
      // Originalmente arrancaba en 2023, pero para clientes grandes excedía el
      // timeout de Azure Functions Consumption Plan (~230s) por el volumen de
      // movimientos a procesar. Lo bajamos a 2026 para máximo rendimiento.
      // Si en el futuro el comercial necesita historia más profunda, subir
      // este valor o aceptar el desde= que mande el cliente.
      const BASELINE_ACUMULADO = '2026-01-01';
      if (stockTipo === 'acumulado') {
        if (!filtros.desde) filtros.desde = BASELINE_ACUMULADO;
        if (!filtros.hasta) filtros.hasta = new Date().toISOString().substring(0, 10);
      } else {
        // 'periodo' respeta el rango que mande el usuario; default razonable
        if (!filtros.desde) filtros.desde = BASELINE_ACUMULADO;
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
