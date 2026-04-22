const https = require('https');
const querystring = require('querystring');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/ws/wsReports.asmx/GetStopsDataRangeByPlate';

// Credenciales hardcodeadas para prueba
const LOGIN    = 'redtec chile';
const PASSWORD = 'redtec2023';

// Flota REDTEC - 11 placas
const FLEET = [
  'BJCL13', 'CCRC36', 'CPVW43', 'FV2792', 'LS3119',
  'NC8771', 'RW5303', 'SP3393', 'VG1943', 'XC9869', 'YG5106'
];

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
    // Singular: una sola placa
    plates = [q.plate];
  } else if (q.plates) {
    // Plural: lista separada por coma
    plates = q.plates.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
  } else {
    // Sin parametro: usar toda la flota
    plates = FLEET;
  }

  // Rango de fechas (default: ultimos 7 dias)
  var sStartDate1 = q.desde || '';
  var sStartDate2 = q.hasta || '';
  if (!sStartDate1 || !sStartDate2) {
    var now   = new Date();
    var prior = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    sStartDate1 = formatDate(prior) + ' 00:00:00';
    sStartDate2 = formatDate(now)   + ' 23:59:59';
  }

  var iTime = q.time || '300';
  var sType = q.type || '';

  // Disparar todas las consultas en paralelo
  var startMs = Date.now();
  var results = await Promise.all(plates.map(function(plate) {
    return queryPlate(plate, sStartDate1, sStartDate2, iTime, sType)
      .then(function(xml) {
        return { plate: plate, ok: true, xml: xml };
      })
      .catch(function(err) {
        return { plate: plate, ok: false, error: err.message };
      });
  }));
  var elapsedMs = Date.now() - startMs;

  // Combinar los XMLs en uno solo
  var combinedXml = combineResponses(results, {
    desde: sStartDate1,
    hasta: sStartDate2,
    time:  iTime,
    type:  sType,
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

function queryPlate(plate, sStartDate1, sStartDate2, iTime, sType) {
  var formBody = querystring.stringify({
    sLogin:      LOGIN,
    sPassword:   PASSWORD,
    sPlate:      plate,
    sStartDate1: sStartDate1,
    sStartDate2: sStartDate2,
    iTime:       iTime,
    sType:       sType
  });

  return new Promise(function(resolve, reject) {
    var options = {
      hostname: API_HOST,
      port:     443,
      path:     API_PATH,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody),
        'Accept':         'text/xml, application/xml'
      }
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
      reject(new Error('Timeout 25s'));
    });
    request.write(formBody);
    request.end();
  });
}

function combineResponses(results, meta) {
  // Extraer nodo <Plate>...</Plate> de cada XML exitoso
  var plateBlocks = [];
  var errors = [];

  results.forEach(function(r) {
    if (r.ok) {
      var match = r.xml.match(/<Plate[\s\S]*?<\/Plate>/);
      if (match) {
        plateBlocks.push(match[0]);
      } else {
        // El XML vino bien pero sin bloque Plate (probablemente sin data)
        plateBlocks.push(
          '<Plate id="' + r.plate + '" Name="" MobileID="" NoData="true" />'
        );
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
