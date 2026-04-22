const https = require('https');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/WsReports.asmx/GetStopsDataRangeByPlate';

// Credenciales hardcodeadas para prueba
const LOGIN    = 'redtec chile';
const PASSWORD = 'redtec2023';

// Flota REDTEC - 11 placas
const FLEET = [
  'BJCL13', 'CCRC36', 'CPVW43', 'FV2792', 'LS3119',
  'NC8771', 'RW5303', 'SP3393', 'VG1943', 'XC9869', 'YG5106'
];

// Concurrencia y throttle (el API de WideTech rechaza rafagas)
const MAX_CONCURRENT  = 2;     // maximo 2 requests al mismo tiempo
const DELAY_MS        = 800;   // pausa entre tandas de requests
const RETRY_MAX       = 2;     // reintentos si sale rate-limited
const RETRY_DELAY_MS  = 2500;  // pausa antes de reintentar

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type'
      },
      body: ''
    };
    return;
  }

  var q = req.query || {};

  // Decidir que placas consultar
  var plates;
  if (q.plate) {
    plates = [q.plate];
  } else if (q.plates) {
    plates = q.plates.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
  } else {
    plates = FLEET;
  }

  // Rango de fechas (default: ultimos 7 dias)
  var sStartDate = q.desde || '';
  var sEndDate   = q.hasta || '';
  if (!sStartDate || !sEndDate) {
    var now   = new Date();
    var prior = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    sStartDate = formatDate(prior) + ' 00:00:00';
    sEndDate   = formatDate(now)   + ' 23:59:59';
  }

  var iMinStopTime = q.time || '60';


  // Ejecutar las consultas con concurrencia limitada + reintentos
  var startMs = Date.now();
  var results = await runWithThrottle(plates, function(plate) {
    return queryPlateWithRetry(plate, sStartDate, sEndDate, iMinStopTime);
  });
  var elapsedMs = Date.now() - startMs;

  var combinedXml = combineResponses(results, {
    desde: sStartDate,
    hasta: sEndDate,
    time:  iMinStopTime,
    elapsedMs: elapsedMs
  });

  var successCount = results.filter(function(r) { return r.ok; }).length;
  var errorCount   = results.length - successCount;

  context.res = {
    status: 200,
    headers: {
      'Content-Type':                'application/xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-cache',
      'X-Debug-Plates-Total':        String(results.length),
      'X-Debug-Plates-Ok':           String(successCount),
      'X-Debug-Plates-Error':        String(errorCount),
      'X-Debug-Elapsed-Ms':          String(elapsedMs)
    },
    body: combinedXml
  };
};

/**
 * Ejecuta una funcion async sobre cada item con concurrencia maxima,
 * separando tandas con un delay para respetar rate limits.
 */
async function runWithThrottle(items, asyncFn) {
  var results = [];
  for (var i = 0; i < items.length; i += MAX_CONCURRENT) {
    var batch = items.slice(i, i + MAX_CONCURRENT);
    var batchResults = await Promise.all(batch.map(function(item) {
      return asyncFn(item)
        .then(function(xml) { return { plate: item, ok: true, xml: xml }; })
        .catch(function(err) { return { plate: item, ok: false, error: err.message }; });
    }));
    results = results.concat(batchResults);
    // Pausa antes de la siguiente tanda (si queda alguna)
    if (i + MAX_CONCURRENT < items.length) {
      await sleep(DELAY_MS);
    }
  }
  return results;
}

async function queryPlateWithRetry(plate, sStartDate, sEndDate, iMinStopTime) {
  var lastErr;
  for (var attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      return await queryPlate(plate, sStartDate, sEndDate, iMinStopTime);
    } catch (err) {
      lastErr = err;
      // Reintentar solo si es rate limit
      if (err.message.indexOf('Demasiadas solicitudes') !== -1 && attempt < RETRY_MAX) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function queryPlate(plate, sStartDate, sEndDate, iMinStopTime) {
  // GET con query params — confirmado en pruebas reales (POST con sStartDate1 da 500)
  var qs = 'sLogin='      + encodeURIComponent(LOGIN)
         + '&sPassword='  + encodeURIComponent(PASSWORD)
         + '&sPlate='     + encodeURIComponent(plate)
         + '&sStartDate1=' + encodeURIComponent(sStartDate)
         + '&sStartDate2=' + encodeURIComponent(sEndDate)
         + '&iTime='       + encodeURIComponent(iMinStopTime)
         + '&sType=';

  return new Promise(function(resolve, reject) {
    var options = {
      hostname: API_HOST,
      port:     443,
      path:     API_PATH + '?' + qs,
      method:   'GET',
      headers:  { 'Accept': 'text/xml, application/xml' }
    };
    var request = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error('API ' + res.statusCode + ': ' + body.substring(0, 200)));
        }
      });
    });
    request.on('error', function(e) { reject(e); });
    request.setTimeout(25000, function() {
      request.destroy();
      reject(new Error('Timeout 25s placa ' + plate));
    });
    request.end();
  });
}

function combineResponses(results, meta) {
  var plateBlocks = []; var errors = [];
  results.forEach(function(r) {
    if (r.ok) {
      var xml = r.xml || '';
      // indexOf/lastIndexOf evita el bug del regex lazy con múltiples placas
      var pStart = xml.indexOf('<Plate ');
      var pEnd   = xml.lastIndexOf('</Plate>');
      if (pStart !== -1 && pEnd !== -1) {
        plateBlocks.push(xml.substring(pStart, pEnd + 8));
      } else if (pStart !== -1) {
        // Self-closing: <Plate ... />
        plateBlocks.push(xml.substring(pStart, xml.indexOf('>', pStart) + 1));
      } else {
        plateBlocks.push('<Plate id="' + r.plate + '" Name="" MobileID="" NoData="true"/>');
      }
    } else {
      errors.push('<Error plate="' + r.plate + '">' + escapeXml(r.error) + '</Error>');
    }
  });

  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<space>\n' +
    '  <Response>\n' +
    '    <Status>\n' +
    '      <code>100</code>\n' +
    '      <description>OK (multi-plate aggregate)</description>\n' +
    '    </Status>\n' +
    '    <Meta desde="' + meta.desde + '" hasta="' + meta.hasta +
          '" time="' + meta.time + '" type="' + (meta.type || 'all') +
          '" elapsedMs="' + meta.elapsedMs + '" />\n' +
    plateBlocks.join('\n') + '\n' +
    (errors.length ? '    <Errors>\n' + errors.join('\n') + '\n    </Errors>\n' : '') +
    '  </Response>\n' +
    '</space>';
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return yyyy + '/' + mm + '/' + dd;
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}
