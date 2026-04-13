const https = require('https');

const API_HOST = 'apirdt1.azurewebsites.net';
const API_PATH = '/api/rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/CartolaDiariasXRangoFechas';

module.exports = async function (context, req) {
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

  var fechainicial = (req.query && req.query.fechainicial) ? req.query.fechainicial : '';
  var fechafinal   = (req.query && req.query.fechafinal)   ? req.query.fechafinal   : '';
  var query = '?fechainicial=' + fechainicial + '&fechafinal=' + fechafinal;

  try {
    var data = await fetchData(API_HOST, API_PATH + query);
    context.res = {
      status: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache'
      },
      body: data
    };
  } catch (err) {
    context.res = {
      status: 502,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Proxy error', detail: err.message })
    };
  }
};

function fetchData(host, path) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: host,
      port:     443,
      path:     path,
      method:   'GET',
      headers:  { 'Accept': 'application/json' }
    };
    var req = https.request(options, function(res) {
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
    req.on('error', function(e) { reject(e); });
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
