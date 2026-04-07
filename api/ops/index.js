const https = require('https');
const http  = require('http');

const API_HOST = 'apirdt1.azurewebsites.net';
const API_PATH = '/api/rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/OpsXRangoFechas';

module.exports = async function (context, req) {

  // Responder preflight OPTIONS de inmediato
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

  // Armar query string con los parámetros que lleguen (fechaInicio, fechaFin, etc.)
  var query = '';
  if (req.query && Object.keys(req.query).length > 0) {
    query = '?' + Object.keys(req.query)
      .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(req.query[k]); })
      .join('&');
  }

  var fullPath = API_PATH + query;

  try {
    var data = await fetchJSON(API_HOST, fullPath);
    context.res = {
      status: 200,
      headers: {
        'Content-Type':                 'application/json',
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control':                'no-cache'
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

function fetchJSON(host, path) {
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
          reject(new Error('API responded ' + res.statusCode + ': ' + body.substring(0, 200)));
        }
      });
    });

    req.on('error', function(e) { reject(e); });
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
