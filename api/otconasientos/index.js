const https = require('https');

const API_HOST = 'apirdt1.azurewebsites.net';
const API_PATH = '/api/RDTOut/otconasientos';

// La API Key se lee desde Application Settings de Azure Static Web Apps.
// En el portal: Configuration -> Application settings -> REDTEC_API_KEY = m2s_live_...
// (es la MISMA key que usa el proxy de opsxrangofechas; no hay que crear otra).
const API_KEY = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';

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

  // otconasientos ya usa desde/hasta (no hay que traducir como en opsxrangofechas).
  // Se pasan tal cual; si faltan, el API aplica su default (últimos 30 días).
  var d1 = (req.query && req.query.desde) ? req.query.desde : '';
  var d2 = (req.query && req.query.hasta) ? req.query.hasta : '';
  var parts = [];
  if (d1) parts.push('desde=' + encodeURIComponent(d1));
  if (d2) parts.push('hasta=' + encodeURIComponent(d2));
  var query = parts.length ? ('?' + parts.join('&')) : '';

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
  return new Promise(function (resolve, reject) {
    var options = {
      hostname: host,
      port:     443,
      path:     path,
      method:   'GET',
      headers:  {
        'Accept':    'application/json',
        'X-Api-Key': API_KEY
      }
    };
    var r = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error('API ' + res.statusCode + ': ' + body.substring(0, 200)));
        }
      });
    });
    r.on('error', function (e) { reject(e); });
    r.setTimeout(20000, function () { r.destroy(); reject(new Error('Timeout')); });
    r.end();
  });
}