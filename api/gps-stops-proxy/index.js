const https = require('https');
const querystring = require('querystring');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/ws/wsReports.asmx/GetStopsDataRangeByPlate';

// Credenciales hardcodeadas para prueba inicial
const LOGIN    = 'redtec chile';
const PASSWORD = 'redtec2023';

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

  // Parametros de consulta
  var sPlate      = q.plate || '';           // vacio = todas las placas
  var sStartDate1 = q.desde || '';           // yyyy/MM/dd HH:mm:ss
  var sStartDate2 = q.hasta || '';
  var iTime       = q.time  || '300';        // 5 min minimo por defecto
  var sType       = q.type  || '';           // vacio = IDLE + ON-FF

  // Si no vienen fechas, por defecto usa los ultimos 7 dias
  if (!sStartDate1 || !sStartDate2) {
    var now   = new Date();
    var prior = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    sStartDate1 = formatDate(prior) + ' 00:00:00';
    sStartDate2 = formatDate(now)   + ' 23:59:59';
  }

  var formBody = querystring.stringify({
    sLogin:      LOGIN,
    sPassword:   PASSWORD,
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
        'Cache-Control':               'no-cache',
        'X-Debug-Plate':               sPlate || '(todas)',
        'X-Debug-Range':               sStartDate1 + ' -> ' + sStartDate2,
        'X-Debug-Time':                iTime
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

function formatDate(d) {
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return yyyy + '/' + mm + '/' + dd;
}

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
