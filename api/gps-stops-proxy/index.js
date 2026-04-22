const https = require('https');

const API_HOST = 'web1ws.shareservice.co';
// ✅ CORREGIDO: ruta correcta confirmada en pruebas reales
const API_PATH = '/WsReports.asmx/GetStopsDataRangeByPlate';

const LOGIN    = 'redtec chile';
const PASSWORD = 'redtec2023';

// Flota REDTEC - 11 placas (confirmadas)
const FLEET = [
  'BJCL13', 'CCRC36', 'CPVW43', 'FV2792', 'LS3119',
  'NC8771', 'RW5303', 'SP3393', 'VG1943', 'XC9869', 'YG5106'
];

const MAX_CONCURRENT = 2;     // WideTech rate-limit: máx 2 simultáneos
const DELAY_MS       = 800;   // pausa entre tandas
const RETRY_MAX      = 2;     // reintentos por rate-limit
const RETRY_DELAY_MS = 2500;

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

  // Decidir qué placas consultar
  var plates;
  if (q.plate)       plates = [q.plate.trim()];
  else if (q.plates) plates = q.plates.split(',').map(p => p.trim()).filter(Boolean);
  else               plates = FLEET;

  // Rango de fechas — acepta "desde" y "hasta" (formato proxy actual)
  var sStartDate = q.desde || '';
  var sEndDate   = q.hasta || '';
  if (!sStartDate || !sEndDate) {
    var now   = new Date();
    var prior = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    sStartDate = formatDate(prior) + ' 00:00:00';
    sEndDate   = formatDate(now)   + ' 23:59:59';
  }

  // Tiempo mínimo de parada en minutos (parámetro "time" del proxy)
  var iMinStopTime = q.time || '60';

  var startMs  = Date.now();
  var results  = await runWithThrottle(plates, plate =>
    queryPlateWithRetry(plate, sStartDate, sEndDate, iMinStopTime)
  );
  var elapsedMs = Date.now() - startMs;

  var combinedXml  = combineResponses(results, { desde: sStartDate, hasta: sEndDate, time: iMinStopTime, elapsedMs });
  var successCount = results.filter(r => r.ok).length;
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

// ── Throttle: tandas de MAX_CONCURRENT con pausa entre tandas ──────────────
async function runWithThrottle(items, asyncFn) {
  var results = [];
  for (var i = 0; i < items.length; i += MAX_CONCURRENT) {
    var batch       = items.slice(i, i + MAX_CONCURRENT);
    var batchResult = await Promise.all(batch.map(item =>
      asyncFn(item)
        .then(xml  => ({ plate: item, ok: true,  xml }))
        .catch(err => ({ plate: item, ok: false, error: err.message }))
    ));
    results = results.concat(batchResult);
    if (i + MAX_CONCURRENT < items.length) await sleep(DELAY_MS);
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
      if (err.message.includes('Demasiadas') && attempt < RETRY_MAX) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Llamada GET al API (confirmado: funciona con GET, POST con form da 500) ─
// ✅ CORREGIDO: usar GET con query params (sStartDate / sEndDate)
//    igual que las pruebas exitosas, NO POST form-encoded con sStartDate1/2
function queryPlate(plate, sStartDate, sEndDate, iMinStopTime) {
  var params = new URLSearchParams({
    sLogin:      LOGIN,
    sPassword:   PASSWORD,
    sPlate:      plate,
    sStartDate:  sStartDate,   // ✅ nombre correcto (no sStartDate1)
    sEndDate:    sEndDate,     // ✅ nombre correcto (no sStartDate2)
    iMinStopTime: iMinStopTime // ✅ nombre correcto (no iTime)
  });

  var path = API_PATH + '?' + params.toString();

  return new Promise(function(resolve, reject) {
    var options = {
      hostname: API_HOST,
      port:     443,
      path:     path,
      method:   'GET',          // ✅ GET (no POST)
      headers:  { 'Accept': 'text/xml, application/xml' }
    };

    var request = https.request(options, function(res) {
      var chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error('API ' + res.statusCode + ': ' + body.substring(0, 200)));
        }
      });
    });

    request.on('error', e => reject(e));
    request.setTimeout(25000, function() {
      request.destroy();
      reject(new Error('Timeout 25s placa ' + plate));
    });
    request.end();
  });
}

// ── Combinar XMLs de todas las placas en una respuesta unificada ────────────
// ✅ CORREGIDO: regex greedy por placa para capturar todos los <ITEM> adentro
function combineResponses(results, meta) {
  var plateBlocks = [];
  var errors      = [];

  results.forEach(function(r) {
    if (r.ok) {
      // Extraer el bloque <Plate ...>...</Plate> completo
      // Usamos indexOf/lastIndexOf para evitar problemas con regex greedy/lazy
      var xml    = r.xml || '';
      var pStart = xml.indexOf('<Plate ');
      var pEnd   = xml.lastIndexOf('</Plate>');

      if (pStart !== -1 && pEnd !== -1) {
        plateBlocks.push(xml.substring(pStart, pEnd + 8)); // 8 = '</Plate>'.length
      } else if (pStart !== -1 && xml.includes('NoData="true"')) {
        // Self-closing: <Plate id="X" NoData="true" />
        var selfClose = xml.indexOf('>', pStart);
        plateBlocks.push(xml.substring(pStart, selfClose + 1));
      } else {
        // Sin datos para esta placa
        plateBlocks.push('<Plate id="' + r.plate + '" Name="" MobileID="" NoData="true"/>');
      }
    } else {
      errors.push('<Error plate="' + r.plate + '">' + escapeXml(r.error) + '</Error>');
    }
  });

  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<space>\n' +
    '  <Response>\n' +
    '    <Status><code>100</code><description>OK (multi-plate aggregate)</description></Status>\n' +
    '    <Meta desde="' + meta.desde + '" hasta="' + meta.hasta +
         '" time="' + meta.time + '" type="all" elapsedMs="' + meta.elapsedMs + '"/>\n' +
    plateBlocks.map(b => '    ' + b).join('\n') + '\n' +
    (errors.length ? '    <Errors>\n      ' + errors.join('\n      ') + '\n    </Errors>\n' : '') +
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
  return new Promise(resolve => setTimeout(resolve, ms));
}
