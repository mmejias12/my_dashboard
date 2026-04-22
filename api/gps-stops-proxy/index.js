const https = require('https');
const querystring = require('querystring');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/ws/wsReports.asmx/GetStopsDataRangeByPlate';

// Credenciales por defecto (se pueden sobrescribir con query params)
const DEFAULT_LOGIN    = 'redtec chile';
const DEFAULT_PASSWORD = 'redtec2023';

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

  // Parametros con fallbacks sensatos
  var sLogin      = q.login    || DEFAULT_LOGIN;
  var sPassword   = q.password || DEFAULT_PASSWORD;
  var sPlate      = q.plate    || '';              // vacio = todas las placas
  var sStartDate1 = q.desde    || '';              // yyyy/MM/dd HH:mm:ss
  var sStartDate2 = q.hasta    || '';
  var iTime       = q.time     || '300';           // 5 min minimo por defecto
  var sType       = q.type     || '';              // vacio = IDLE + ON-FF

  // Validaciones minimas
  if (!sStartDate1 || !sStartDate2) {
    context.res = {
      status: 400,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Faltan parametros',
        detail: 'Se requieren ?desde=yyyy/MM/dd HH:mm:ss&hasta=yyyy/MM/dd HH:mm:ss',
        ejemplo: '?plate=LS3119&desde=2026/03/01 00:00:00&hasta=2026/03/31 23:59:59&time=300'
      })
    };
    return;
  }

  var formBody = querystring.stringify({
    sLogin:      sLogin,
    sPassword:   sPassword,
    sPlate:      sPlate,
    sStartDate1: sStartDate1,
    sStartDate2: sStartDate2,
    iTime:       iTime,
    sType:       sType
  });

  try {
    var xmlData = await postForm(API_HOST, API_PATH, formBody);
    context.res = {
      status: 200,
      headers: {
        'Content-Type':                'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache'
      },
      body: xmlData
    };
  } catch (err) {
    context.res = {
      status: 502,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Proxy error',
        detail: err.message,
        request: {
          plate: sPlate || '(todas)',
          desde: sStartDate1,
          hasta: sStartDate2,
          time:  iTime,
          type:  sType || '(todas)'
        }
      })
    };
  }
};

function postForm(host, path, body) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: host,
      port:     443,
      path:     path,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept':         'text/xml, application/xml'
      }
    };
    var request = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var responseBody = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseBody);
        } else {
          reject(new Error('API ' + res.statusCode + ': ' + responseBody.substring(0, 300)));
        }
      });
    });
    request.on('error', function(e) { reject(e); });
    request.setTimeout(30000, function() {
      request.destroy();
      reject(new Error('Timeout (30s) consultando shareservice.co'));
    });
    request.write(body);
    request.end();
  });
}
