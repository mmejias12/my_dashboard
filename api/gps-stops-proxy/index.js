const https = require('https');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/WsReports.asmx/GetStopsDataRangeByPlate';
const LOGIN    = 'redtec chile';
const PASSWORD = 'redtec2023';

const FLEET = ['BJCL13','CCRC36','CPVW43','FV2792','LS3119','NC8771','RW5303','SP3393','VG1943','XC9869','YG5106'];

const MAX_CONCURRENT = 2;
const DELAY_MS       = 800;
const RETRY_MAX      = 2;
const RETRY_DELAY_MS = 2500;

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status:200, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Accept,Content-Type'}, body:'' };
    return;
  }

  var q = req.query || {};
  var plates;
  if (q.plate)       plates = [q.plate.trim()];
  else if (q.plates) plates = q.plates.split(',').map(function(p){return p.trim();}).filter(Boolean);
  else               plates = FLEET;

  var sStartDate1 = q.desde || '';
  var sStartDate2 = q.hasta || '';
  if (!sStartDate1 || !sStartDate2) {
    var now = new Date(); var prior = new Date(now.getTime()-7*24*60*60*1000);
    sStartDate1 = formatDate(prior)+' 00:00:00';
    sStartDate2 = formatDate(now)+' 23:59:59';
  }
  var iTime = q.time || '15';

  var startMs = Date.now();
  var results = await runWithThrottle(plates, function(plate){
    return queryPlateWithRetry(plate, sStartDate1, sStartDate2, iTime);
  });
  var elapsedMs = Date.now() - startMs;

  var allItems = [];
  var errors   = [];
  var okCount  = 0;

  results.forEach(function(r) {
    if (!r.ok) { errors.push({plate:r.plate, error:r.error}); return; }
    var parsed = parsePlateXML(r.xml, r.plate);
    if (parsed.items.length > 0) { okCount++; allItems = allItems.concat(parsed.items); }
  });

  context.res = {
    status: 200,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Access-Control-Allow-Origin':'*',
      'Cache-Control':'no-cache',
      'X-Debug-Plates-Total':String(results.length),
      'X-Debug-Plates-Ok':String(okCount),
      'X-Debug-Plates-Error':String(errors.length),
      'X-Debug-Elapsed-Ms':String(elapsedMs)
    },
    body: JSON.stringify({
      ok:true, desde:sStartDate1, hasta:sStartDate2,
      time:iTime, elapsedMs:elapsedMs,
      total:allItems.length, items:allItems, errors:errors
    })
  };
};

function parsePlateXML(xml, plateId) {
  var result = {plate:plateId, name:'', items:[]};

  // Nombre del chofer desde atributo Name
  var nameM = xml.match(/Name="([^"]*)"/);
  if (nameM) result.name = nameM[1];

  // Si no hay items, retornar vacío
  if (xml.indexOf('<ITEM>') === -1) return result;

  // Dividir por <ITEM> manualmente — más robusto que regex con flags
  var parts = xml.split('<ITEM>');
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i].split('</ITEM>')[0];

    var location = extractTag(block, 'LOCATION');
    var start    = extractTag(block, 'START');
    var end      = extractTag(block, 'END');
    var seconds  = parseInt(extractTag(block, 'SECOND') || '0', 10);
    var type     = extractTag(block, 'TYPE');

    if (!location || !start) continue;

    result.items.push({
      plate:    plateId,
      name:     result.name,
      location: location,
      start:    start,
      end:      end,
      seconds:  seconds,
      type:     type
    });
  }
  return result;
}

// Extraer texto entre <TAG> y </TAG> — sin regex, solo indexOf
function extractTag(text, tag) {
  var open  = '<' + tag + '>';
  var close = '</' + tag + '>';
  var s = text.indexOf(open);
  if (s === -1) return '';
  s += open.length;
  var e = text.indexOf(close, s);
  if (e === -1) return '';
  return text.substring(s, e).trim();
}

async function runWithThrottle(items, asyncFn) {
  var results = [];
  for (var i = 0; i < items.length; i += MAX_CONCURRENT) {
    var batch = items.slice(i, i+MAX_CONCURRENT);
    var batchResult = await Promise.all(batch.map(function(item){
      return asyncFn(item)
        .then(function(xml){return{plate:item,ok:true,xml:xml};})
        .catch(function(err){return{plate:item,ok:false,error:err.message};});
    }));
    results = results.concat(batchResult);
    if (i+MAX_CONCURRENT < items.length) await sleep(DELAY_MS);
  }
  return results;
}

async function queryPlateWithRetry(plate, s1, s2, iTime) {
  var lastErr;
  for (var attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try { return await queryPlate(plate, s1, s2, iTime); }
    catch (err) {
      lastErr = err;
      if (err.message.indexOf('Demasiadas') !== -1 && attempt < RETRY_MAX) {
        await sleep(RETRY_DELAY_MS); continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function queryPlate(plate, s1, s2, iTime) {
  var qs = 'sLogin='+encodeURIComponent(LOGIN)
         +'&sPassword='+encodeURIComponent(PASSWORD)
         +'&sPlate='+encodeURIComponent(plate)
         +'&sStartDate1='+encodeURIComponent(s1)
         +'&sStartDate2='+encodeURIComponent(s2)
         +'&iTime='+encodeURIComponent(iTime)
         +'&sType=';
  return new Promise(function(resolve, reject) {
    var opts = {hostname:API_HOST, port:443, path:API_PATH+'?'+qs, method:'GET', headers:{'Accept':'text/xml,application/xml'}};
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c){chunks.push(c);});
      res.on('end', function(){
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error('API '+res.statusCode+': '+body.substring(0,200)));
      });
    });
    req.on('error', function(e){reject(e);});
    req.setTimeout(90000, function(){req.destroy(); reject(new Error('Timeout 90s '+plate));});
    req.end();
  });
}

function formatDate(d) {
  return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
