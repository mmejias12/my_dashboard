/**
 * Proxy: GPS Stops por Placa (multi-vehículo)
 * ─────────────────────────────────────────────────────────────────────────
 * Reemplazo del proxy gps-stops-proxy original que usaba GeofenceReportDataByPlate.
 * Este proxy consume GetStopsDataRangeByPlate del WS de WideTech, que es el
 * servicio idóneo para el reporte "Tiempos en Puntos" según indicación del proveedor.
 *
 * Diferencias clave vs el proxy anterior:
 *   - Itera la flota completa: 1 request SOAP por placa (no había forma de
 *     consultar "todas" en una sola llamada con este servicio).
 *   - Respeta el patrón documentado: max 2 requests simultáneos, 800ms entre batches.
 *   - Usa SOAP 1.1 (verificado funcional con Postman; el WS rechaza HTTP POST/GET directos).
 *
 * Compatibilidad:
 *   - Devuelve el mismo JSON que el proxy anterior: {ok, items:[{plate,name,location,start,end,seconds,type}]}
 *   - El frontend (transportes-tiempos.html) no requiere cambios funcionales,
 *     solo apuntar el fetch a esta nueva ruta.
 *
 * Query params:
 *   - fechainicial (YYYY-MM-DD)  → obligatorio
 *   - fechafinal   (YYYY-MM-DD)  → obligatorio
 *   - iTime        (segundos)    → opcional, default 300 (5 min)
 *   - sType        (IDLE/ON-FF)  → opcional, default vacío (ambos)
 *
 * Nota sobre el rango de fechas:
 *   Igual que el proxy anterior, se consulta desde (fi-1) para capturar paradas
 *   que cruzan medianoche. La consolidación de medianoche y el filtro por
 *   fecha real (r.fecha >= fi) los sigue haciendo el frontend con consolidarMedianoche().
 */

const fs = require('fs');
const path = require('path');

// ── CONFIG ─────────────────────────────────────────────────────────────────
const SOAP_URL  = 'https://web1ws.shareservice.co/ws/wsReports.asmx';
const SOAP_NS   = 'http://tempuri.org/';
const SOAP_OP   = 'GetStopsDataRangeByPlate';

// Credenciales (en producción mover a App Settings: process.env.WIDETECH_LOGIN, etc.)
const LOGIN     = process.env.WIDETECH_LOGIN    || 'redtec';
const PASSWORD  = process.env.WIDETECH_PASSWORD || 'redtec1224';

// Defaults compartidos con el proxy anterior
const DEFAULT_ITIME = 300;   // 5 minutos mínimo de parada
const DEFAULT_STYPE = '';    // vacío = IDLE + ON-OFF

// Procesamiento secuencial: el WS rechaza requests paralelos del mismo usuario
// con código 109 (mensaje engañoso "20 segundos") pero acepta secuenciales sin
// problema, incluso cuando vienen muy rápido. Validado empíricamente con
// 4 consultas seguidas en Postman: todas HTTP 200 código 100, sin esperar.
// Pequeño gap entre requests por seguridad ante posibles ráfagas de cliente.
const REQUEST_GAP = 250;  // ms entre cada request secuencial

// Timeout por request individual (ms)
const REQUEST_TIMEOUT = 25000;

// Cargar lista de placas (una sola vez al iniciar la function)
let FLEET = [];
try {
  const fleetPath = path.join(__dirname, 'fleet.json');
  const raw = fs.readFileSync(fleetPath, 'utf8');
  const parsed = JSON.parse(raw);
  FLEET = (parsed.plates || []).filter(p => p && p.plate);
} catch (e) {
  // Fallback hardcoded por si fleet.json se corrompe — mismo contenido
  FLEET = [
    { plate: 'BJCL13', name: 'ISMAEL CAMPOS' },
    { plate: 'CCRC36', name: 'JUAN CARLOS VEGA' },
    { plate: 'CPVW43', name: 'CRISTOBAL ECHEVERRIA' },
    { plate: 'FV2792', name: 'EMILIO CAULLE' },
    { plate: 'LS3119', name: 'ANTONIO VEGA' },
    { plate: 'NC8771', name: 'JULIO BULNES' },
    { plate: 'RW5303', name: 'GONZALO CAMPOS' },
    { plate: 'SP3393', name: 'CESAR ANABALON' },
    { plate: 'VG1943', name: 'VICTOR VEGA' },
    { plate: 'XC9869', name: 'HUGO NUNEZ' },
    { plate: 'YG5106', name: 'MIGUEL GOMEZ' }
  ];
}

// ── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Extrae el contenido de un tag XML por nombre, sin regex ni DOMParser.
 * Mismo patrón que el proxy anterior (probado contra el XML aplanado de WideTech).
 * Devuelve string vacío si no encuentra el tag.
 */
function extractTag(xml, tagName) {
  if (!xml) return '';
  const open  = '<' + tagName + '>';
  const close = '</' + tagName + '>';
  const i = xml.indexOf(open);
  if (i < 0) return '';
  const start = i + open.length;
  const end = xml.indexOf(close, start);
  if (end < 0) return '';
  return xml.substring(start, end).trim();
}

/**
 * Convierte 'YYYY-MM-DD' a 'YYYY/MM/DD HH:MM:SS' (formato del WS).
 * Si endOfDay=true, usa 23:59:59; sino 00:00:00.
 */
function toSoapDate(yyyymmdd, endOfDay) {
  // Acepta 'YYYY-MM-DD' o 'YYYY/MM/DD'
  const norm = String(yyyymmdd).replace(/-/g, '/').substring(0, 10);
  return norm + (endOfDay ? ' 23:59:59' : ' 00:00:00');
}

/**
 * Resta 1 día a 'YYYY-MM-DD' (para capturar paradas que cruzan medianoche,
 * igual que el proxy anterior — la consolidación la hace el frontend).
 */
function diaAnterior(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T12:00:00'); // mediodía evita issues de UTC-4 Chile
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Construye el sobre SOAP 1.1 para GetStopsDataRangeByPlate.
 * Validado funcional en Postman: HTTP 200 + status code 100 (OK).
 */
function buildEnvelope(plate, sStartDate1, sStartDate2, iTime, sType) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
      '<' + SOAP_OP + ' xmlns="' + SOAP_NS + '">' +
        '<sLogin>' + LOGIN + '</sLogin>' +
        '<sPassword>' + PASSWORD + '</sPassword>' +
        '<sPlate>' + plate + '</sPlate>' +
        '<sStartDate1>' + sStartDate1 + '</sStartDate1>' +
        '<sStartDate2>' + sStartDate2 + '</sStartDate2>' +
        '<iTime>' + iTime + '</iTime>' +
        '<sType>' + (sType || '') + '</sType>' +
      '</' + SOAP_OP + '>' +
    '</soap:Body>' +
    '</soap:Envelope>';
}

/**
 * Llama al WS para una placa. Devuelve {plate, name, status, items[], error?}.
 * Nunca tira excepción: cualquier fallo (HTTP, auth, timeout) queda capturado
 * y reportado en el campo error para no abortar las otras placas del batch.
 */
async function fetchStopsForPlate(plateInfo, sStartDate1, sStartDate2, iTime, sType, log) {
  const envelope = buildEnvelope(plateInfo.plate, sStartDate1, sStartDate2, iTime, sType);

  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);

  try {
    const r = await fetch(SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"' + SOAP_NS + SOAP_OP + '"'
      },
      body: envelope,
      signal: ctrl.signal
    });

    if (!r.ok) {
      return { plate: plateInfo.plate, name: plateInfo.name, items: [],
               error: 'HTTP ' + r.status };
    }

    const xml = await r.text();

    // Verificar status del WS (code=100 OK, code=101 auth failed, etc.)
    const statusCode = extractTag(xml, 'code');
    const statusDesc = extractTag(xml, 'description');
    if (statusCode && statusCode !== '100') {
      return { plate: plateInfo.plate, name: plateInfo.name, items: [],
               wsCode: statusCode, error: 'WS ' + statusCode + ': ' + statusDesc };
    }

    // Parseo de ITEMs por split — mismo enfoque que el proxy anterior
    // El XML viene aplanado por el server SOAP, así que regex/DOMParser fallan
    // pero indexOf + substring funciona perfecto.
    const items = [];
    const parts = xml.split('<ITEM>');
    for (let i = 1; i < parts.length; i++) {
      const item = parts[i];
      const start    = extractTag(item, 'START');
      const end      = extractTag(item, 'END');
      const location = extractTag(item, 'LOCATION');
      const time     = extractTag(item, 'TIME');
      const second   = extractTag(item, 'SECOND');
      const type     = extractTag(item, 'TYPE');
      const lat      = extractTag(item, 'LAT');
      const lng      = extractTag(item, 'LNG');
      const zone     = extractTag(item, 'ZONE');

      // Limpia location: el WS devuelve "  B  XYZ  B  " con padding raro
      const locClean = location.replace(/^\s*B\s+/, '').replace(/\s+B\s*$/, '').trim();

      items.push({
        plate:    plateInfo.plate,
        name:     plateInfo.name,
        location: locClean || location.trim(),
        start:    start,
        end:      end,
        time:     time,
        seconds:  parseInt(second, 10) || 0,
        type:     type,
        lat:      parseFloat(lat) || null,
        lng:      parseFloat(lng) || null,
        zone:     zone
      });
    }

    return { plate: plateInfo.plate, name: plateInfo.name, items: items };

  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'timeout' : (err && err.message || 'unknown');
    log && log.warn && log.warn('Plate ' + plateInfo.plate + ' failed: ' + msg);
    return { plate: plateInfo.plate, name: plateInfo.name, items: [], error: msg };
  } finally {
    clearTimeout(tmr);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Procesa la flota completa (o solo una placa filtrada) de forma SECUENCIAL.
 * El WS de WideTech rechaza requests paralelos del mismo usuario con código
 * 109. Las requests secuenciales (incluso muy seguidas) son aceptadas
 * normalmente. Esta validación se hizo empíricamente con Postman.
 */
async function fetchFleetStops(sStartDate1, sStartDate2, iTime, sType, log, plateFilter) {
  // Si viene plateFilter, consulta solo esa placa (o vacío si no está en la flota)
  let fleet = FLEET;
  if (plateFilter) {
    const wanted = plateFilter.toUpperCase();
    fleet = FLEET.filter(p => p.plate.toUpperCase() === wanted);
    if (!fleet.length) {
      return [{ plate: plateFilter, name: '(desconocida)', items: [],
                error: 'Placa no registrada en fleet.json' }];
    }
  }

  const results = [];
  const RETRY_DELAY = 1500;  // ms a esperar antes de reintentar una placa fallida

  for (let i = 0; i < fleet.length; i++) {
    const plate = fleet[i];
    let r = await fetchStopsForPlate(plate, sStartDate1, sStartDate2, iTime, sType, log);

    // Retry si falló con un error potencialmente transitorio:
    // WS 109 (rate-limit), HTTP 5xx, o errores de red/timeout.
    const esTransitorio = r.error && (
      r.wsCode === '109' ||
      /^HTTP 5\d\d/.test(r.error) ||
      r.error === 'timeout' ||
      r.error === 'unknown'
    );

    if (esTransitorio) {
      log && log.warn && log.warn('Reintentando ' + plate.plate + ' tras: ' + r.error);
      await sleep(RETRY_DELAY);
      const r2 = await fetchStopsForPlate(plate, sStartDate1, sStartDate2, iTime, sType, log);
      // Si el retry tuvo éxito, lo usamos. Si no, conservamos el primero.
      if (!r2.error) {
        r = r2;
      } else {
        // Conservamos el resultado original pero anotamos que se intentó 2 veces
        r.error = r.error + ' (retry: ' + r2.error + ')';
      }
    }

    results.push(r);
    // Pequeño gap entre requests (no después de la última)
    if (i < fleet.length - 1) {
      await sleep(REQUEST_GAP);
    }
  }
  return results;
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const t0 = Date.now();
  const q = req.query || {};

  // Acepta dos convenciones de nombres de parámetros para compatibilidad:
  //   - fechainicial/fechafinal/iTime  (formato 'YYYY-MM-DD', minutos en segundos)
  //   - desde/hasta/time               (formato 'YYYY/MM/DD HH:MM:SS', minutos)
  // Esto permite que tanto el dashboard de transportes-tiempos.html como cualquier
  // otra integración futura funcione sin cambios en el cliente.
  let fi = q.fechainicial;
  let ff = q.fechafinal;

  // Si vienen con la convención del dashboard de transportes (desde/hasta con
  // formato 'YYYY/MM/DD HH:MM:SS'), los normalizamos a 'YYYY-MM-DD'.
  if (!fi && q.desde) fi = String(q.desde).replace(/\//g, '-').substring(0, 10);
  if (!ff && q.hasta) ff = String(q.hasta).replace(/\//g, '-').substring(0, 10);

  if (!fi || !ff) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Faltan parámetros: fechainicial/fechafinal o desde/hasta' }
    };
    return;
  }

  // Patrón heredado: consultar desde (fi-1) para capturar cruces de medianoche.
  // El frontend hace el filtro final por r.fecha >= fi y la consolidación.
  const fiMenos1 = diaAnterior(fi);
  const sStartDate1 = toSoapDate(fiMenos1, false);
  const sStartDate2 = toSoapDate(ff, true);

  // iTime: el dashboard de transportes lo manda en MINUTOS (param 'time'),
  // los otros consumidores lo mandan en SEGUNDOS (param 'iTime').
  // Si viene 'time' lo convertimos a segundos.
  let iTime;
  if (q.iTime != null && q.iTime !== '') {
    iTime = parseInt(q.iTime, 10);
  } else if (q.time != null && q.time !== '') {
    iTime = parseInt(q.time, 10) * 60;  // minutos → segundos
  } else {
    iTime = DEFAULT_ITIME;
  }
  iTime = Math.max(0, iTime || DEFAULT_ITIME);

  const sType = (q.sType || q.type || DEFAULT_STYPE).toUpperCase();

  // Filtro opcional por placa específica (cuando el usuario elige una en el dashboard)
  const plateFilter = (q.plate || '').trim();

  context.log('gps-stops-by-plate-proxy: rango=' + sStartDate1 + ' → ' + sStartDate2 +
              ' | iTime=' + iTime + ' | sType=' + (sType||'(both)') +
              (plateFilter ? ' | plate=' + plateFilter : ' | flota=' + FLEET.length));

  let perPlate;
  try {
    perPlate = await fetchFleetStops(sStartDate1, sStartDate2, iTime, sType, context.log, plateFilter);
  } catch (err) {
    context.log.error('Fleet fetch fatal: ' + (err && err.message));
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Error consultando WS', detail: String(err && err.message || err) }
    };
    return;
  }

  // Consolidar todos los items en un array plano (formato esperado por el frontend)
  const allItems = [];
  const errors = [];
  let totalOk = 0;
  perPlate.forEach(r => {
    if (r.error) {
      errors.push({ plate: r.plate, name: r.name, error: r.error, wsCode: r.wsCode });
    } else {
      totalOk++;
    }
    if (r.items && r.items.length) {
      allItems.push(...r.items);
    }
  });

  const elapsed = Date.now() - t0;

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: {
      ok: true,
      items: allItems,
      meta: {
        rangeRequested:  { fechainicial: fi, fechafinal: ff },
        rangeQueried:    { from: sStartDate1, to: sStartDate2 },
        params:          { iTime: iTime, sType: sType || '', plate: plateFilter || null },
        fleetSize:       FLEET.length,
        platesQueried:   perPlate.length,
        platesOk:        totalOk,
        platesFailed:    errors.length,
        totalItems:      allItems.length,
        elapsedMs:       elapsed,
        errors:          errors.length ? errors : undefined
      }
    }
  };
};
