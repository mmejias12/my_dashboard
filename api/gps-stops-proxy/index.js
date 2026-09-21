const https = require('https');
const cacheGps = require('../shared/cache-gps.js');

const API_HOST = 'web1ws.shareservice.co';
const API_PATH = '/WsReports.asmx/GetStopsDataRangeByPlate';

// Credenciales: viven SÓLO en Application Settings del portal (GPS_LOGIN /
// GPS_PASSWORD). Ya no hay valor de respaldo escrito acá: un fallback silencioso
// haría que el proxy siguiera funcionando con una clave del código y nadie se
// enteraría de que la configuración se perdió. Si faltan, la función responde
// 500 diciendo exactamente qué falta.
const LOGIN    = process.env.GPS_LOGIN    || '';
const PASSWORD = process.env.GPS_PASSWORD || '';
function faltanCredenciales(){
  var faltan = [];
  if (!LOGIN)    faltan.push('GPS_LOGIN');
  if (!PASSWORD) faltan.push('GPS_PASSWORD');
  return faltan;
}

// Flota real. XC9869 e YG5106 NO son vehículos: el API responde a esas dos
// patentes con las paradas de TODA la cuenta (2.945 paradas en agosto 2026,
// idénticas entre sí y superconjunto de las 9 placas reales). Si se dejan en
// la flota, cada consulta duplica el universo completo y todo promedio de
// flota queda inflado. Verificado el 15-09-2026.
const FLEET = ['BJCL13','CCRC36','CPVW43','FV2792','LS3119','NC8771','RW5303','SP3393','VG1943',
               // Talca — identificadas por sus operaciones en RDTOut (Productos
               // Fernández Talca, Dimak Talca, TAK Curicó). CKWR19 reporta normal.
               'CKWR19','GXVL57'];

// Identificadores comodín: devuelven la cuenta completa, no un vehículo.
// Se bloquean salvo que se pidan a propósito con ?cuenta=1.
const CATCH_ALL = ['XC9869','YG5106'];

// ── Límite del proveedor ──────────────────────────────────────────────────
// VERIFICADO EL 16-09-2026. El API responde HTTP 200 con este cuerpo cuando se
// le consulta demasiado seguido:
//     <code>109</code>
//     <description>El tiempo entre consulta debe ser mayor a 20 segundos.</description>
// Antes eso se leía como "el camión no se movió". Era la causa de fondo de
// TODAS las placas que aparecían en cero: con 800 ms entre consultas, sólo la
// primera placa del lote pasaba y las otras diez eran rechazadas en silencio.
//
// Alcance medido: la ventana es POR CUENTA, no por patente — otra patente
// dentro de los 20 s también se rechaza. Pero repetir la MISMA consulta
// (misma patente y mismo rango) devuelve la respuesta cacheada al instante,
// así que la segunda pasada del día es rápida y el costo de 21 s por placa se
// paga sólo en la carga fría.
const PROVIDER_GAP_MS = 21000;

// ── Presupuesto de la función ─────────────────────────────────────────────
// Las funciones administradas de Static Web Apps se cortan a los 45 segundos
// y devuelven 500 "Backend call failure". Con 21 s entre placas, pedir la
// flota completa en una sola llamada (11 × 21 s ≈ 4 min) SIEMPRE muere.
// VERIFICADO EL 16-09-2026: 1 placa responde en 0,6 s; sin ?plate la llamada
// falló a los 45,1 s.
// Por eso el proxy atiende sólo las placas que le caben en el presupuesto y
// devuelve el resto en 'pendientes', para que el cliente siga pidiéndolas.
const FUNCTION_BUDGET_MS = 36000;
var _t0 = 0;
function msRestantes(){ return FUNCTION_BUDGET_MS - (Date.now() - _t0); }
function alcanzaPara(ms){ return msRestantes() > ms; }
const MAX_CONCURRENT = 1;      // serializado a la fuerza: el límite es por cuenta
const DELAY_MS       = PROVIDER_GAP_MS;
const RETRY_MAX      = 2;
const RETRY_DELAY_MS = PROVIDER_GAP_MS;

// El API responde de forma intermitente con 200 y cuerpo vacío (~30 ms, contra
// ~250 ms de una respuesta buena). Antes eso se leía como "el camión no se
// movió". Ahora una respuesta vacía se reintenta y, si nunca llega data, la
// placa se reporta como SIN RESPUESTA, que es distinto de SIN ACTIVIDAD.
const EMPTY_RETRY_MAX   = 2;
const EMPTY_RETRY_DELAY = PROVIDER_GAP_MS;

// Lee el código de estado que devuelve el proveedor, para poder distinguir
// "me estás consultando muy seguido" de "esta patente no tuvo paradas".
function codigoProveedor(xml){
  var m = String(xml||'').match(/<code>\s*(\d+)\s*<\/code>/i);
  return m ? m[1] : null;
}
function mensajeProveedor(xml){
  var m = String(xml||'').match(/<description>([^<]*)<\/description>/i);
  return m ? m[1].trim() : '';
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status:200, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Accept,Content-Type'}, body:'' };
    return;
  }

  var q = req.query || {};
  var verCuenta = q.cuenta === '1' || q.cuenta === 'true';
  var debug     = q.debug  === '1' || q.debug  === 'true';

  // Chequeo de configuración. Con ?diag=1 se puede confirmar desde el navegador
  // que las credenciales están cargadas SIN exponer sus valores.
  var faltan = faltanCredenciales();
  if (q.diag === '1' || q.diag === 'true') {
    context.res = {
      status: faltan.length ? 500 : 200,
      headers: {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'},
      body: JSON.stringify({
        ok: faltan.length === 0,
        credenciales: faltan.length ? 'FALTAN' : 'cargadas desde Application Settings',
        faltan: faltan,
        login_largo: LOGIN.length,          // sólo el largo, nunca el valor
        password_largo: PASSWORD.length,
        gap_proveedor_ms: PROVIDER_GAP_MS,
        flota: FLEET
      })
    };
    return;
  }
  if (faltan.length) {
    context.res = {
      status: 500,
      headers: {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'},
      body: JSON.stringify({
        ok:false,
        error:'Faltan credenciales del GPS en la configuración del sitio: ' + faltan.join(' y ') + '.',
        comoArreglar:'Portal de Azure → Static Web App → Configuración → Application settings. ' +
                     'Agregar GPS_LOGIN y GPS_PASSWORD y guardar. No se vuelve a escribir la clave en el código.'
      })
    };
    return;
  }

  var plates;
  if (q.plate)       plates = [q.plate.trim()];
  else if (q.plates) plates = q.plates.split(',').map(function(p){return p.trim();}).filter(Boolean);
  else               plates = verCuenta ? [CATCH_ALL[0]] : FLEET;

  // Bloqueo de comodines salvo petición explícita
  var bloqueadas = [];
  if (!verCuenta) {
    bloqueadas = plates.filter(function(p){ return CATCH_ALL.indexOf(p.toUpperCase()) !== -1; });
    plates     = plates.filter(function(p){ return CATCH_ALL.indexOf(p.toUpperCase()) === -1; });
  }

  var sStartDate1 = q.desde || '';
  var sStartDate2 = q.hasta || '';
  if (!sStartDate1 || !sStartDate2) {
    var now = new Date(); var prior = new Date(now.getTime()-7*24*60*60*1000);
    sStartDate1 = formatDate(prior)+' 00:00:00';
    sStartDate2 = formatDate(now)+' 23:59:59';
  }
  var iTime = q.time || '15';

  var startMs = Date.now();
  _t0 = startMs;

  // ── CACHÉ ────────────────────────────────────────────────────────────────
  // Un día cerrado ya no cambia, así que se sirve del blob y no se le vuelve a
  // preguntar al proveedor. Sólo los días de la ventana viva se consultan en
  // vivo. Con ?fresco=1 se salta el caché (para comprobar contra la fuente).
  var soloFresco = q.fresco === '1' || q.fresco === 'true';
  var dDesde = String(sStartDate1).slice(0,10).replace(/\//g,'-');
  var dHasta = String(sStartDate2).slice(0,10).replace(/\//g,'-');

  var cacheItems = [], cacheInfo = {usado:false};
  var placasEnVivo = plates;

  if (!soloFresco && !verCuenta && cacheGps.hayStorage()) {
    try {
      var cont = cacheGps.getContainer();
      var lect = await cacheGps.leerRango(cont, plates, dDesde, dHasta);
      cacheItems = lect.items;
      // Una patente se consulta en vivo sólo si le falta algún día cerrado o
      // tiene días dentro de la ventana viva. Si su historia está completa en
      // el caché, no se toca al proveedor: ahí está el ahorro de los 21 s.
      var necesita = {};
      lect.faltantes.forEach(function(x){ necesita[x.placa] = 1; });
      lect.vivos.forEach(function(x){ necesita[x.placa] = 1; });
      placasEnVivo = plates.filter(function(p){ return necesita[p]; });
      cacheInfo = {
        usado: true,
        faltan_cerrados: lect.faltantes.length,
        dias_desde_cache: lect.dias_cache,
        paradas_desde_cache: cacheItems.length,
        placas_resueltas_sin_consultar: plates.length - placasEnVivo.length,
        dias_vivos: cacheGps.DIAS_VIVOS,
        primer_dia_vivo: cacheGps.desdeVivo()
      };
    } catch (e) {
      // El caché NUNCA puede romper la consulta: si falla, se sigue en vivo.
      cacheInfo = {usado:false, faltan_cerrados:-1, error:e.message};
      cacheItems = []; placasEnVivo = plates;
    }
  }

  // Si la parte cerrada del rango ya está completa en el caché, al proveedor
  // sólo se le pide la ventana viva: respuesta más chica y menos carga sobre
  // un API que ya nos limita. Si falta algún día cerrado, se pide el rango
  // entero para poder sembrarlo.
  var vivoDesde = sStartDate1, vivoHasta = sStartDate2;
  if (cacheInfo.usado && cacheInfo.faltan_cerrados === 0 && dHasta >= cacheGps.desdeVivo()) {
    var ini = dDesde > cacheGps.desdeVivo() ? dDesde : cacheGps.desdeVivo();
    vivoDesde = ini.replace(/-/g,'/') + ' 00:00:00';
  }

  var throttled = await runWithThrottle(placasEnVivo, function(plate){
    return queryPlateUntilData(plate, vivoDesde, vivoHasta, iTime);
  });
  var results    = throttled.results;
  var pendientes = throttled.pendientes;
  var elapsedMs  = Date.now() - startMs;

  var allItems  = [];
  var errors    = [];
  var estados   = [];
  var okCount   = 0;
  var vistos    = {};   // dedup por placa|location|start
  var duplicados = 0;

  // Lo que vino del caché entra primero y participa del dedup, para que una
  // parada que esté en ambos lados no se cuente dos veces.
  cacheItems.forEach(function(it){
    var k = it.plate+'|'+it.location+'|'+it.start;
    if (vistos[k]) { duplicados++; return; }
    vistos[k] = 1; allItems.push(it);
  });

  results.forEach(function(r) {
    if (!r.ok) {
      errors.push({plate:r.plate, error:r.error});
      estados.push({plate:r.plate, estado:'error', intentos:r.intentos||0, error:r.error});
      return;
    }
    var parsed = parsePlateXML(r.xml, r.plate);
    if (parsed.items.length > 0) {
      okCount++;
      parsed.items.forEach(function(it){
        var k = it.plate+'|'+it.location+'|'+it.start;
        if (vistos[k]) { duplicados++; return; }
        vistos[k] = 1; allItems.push(it);
      });
      estados.push({plate:r.plate, estado:'con_datos', intentos:r.intentos, paradas:parsed.items.length, chofer:parsed.name});
    } else {
      // Se agotaron los reintentos sin una sola parada: NO afirmamos que no hubo
      // actividad, decimos que el API no entregó datos.
      var e = {plate:r.plate,
               estado: r.limitado ? 'limite_proveedor' : 'sin_respuesta',
               intentos:r.intentos, ms:r.msPorIntento};
      if (r.limitado) e.motivo = r.msgProveedor || 'El proveedor exige más de 20 segundos entre consultas.';
      if (debug) e.muestra = String(r.xml||'').substring(0,200);
      estados.push(e);
    }
  });

  // Patentes que ni se consultaron porque el caché ya las tenía completas.
  var resueltasCache = plates.filter(function(p){ return placasEnVivo.indexOf(p) === -1; });
  resueltasCache.forEach(function(p){
    var n = cacheItems.filter(function(i){ return i.plate === p; }).length;
    var cho = (cacheItems.find(function(i){ return i.plate === p && i.name; })||{}).name || null;
    estados.push({plate:p, estado:'con_datos', origen:'cache', intentos:0, paradas:n, chofer:cho});
    if (n > 0) okCount++;
  });

  bloqueadas.forEach(function(p){
    estados.push({plate:p, estado:'bloqueada', motivo:'identificador comodín: devuelve la cuenta completa, no un vehículo. Usar ?cuenta=1 si se quiere a propósito.'});
  });

  // ── SEMBRAR EL CACHÉ ─────────────────────────────────────────────────────
  // Sólo se guardan los días CERRADOS, y sólo de las patentes que respondieron
  // bien: guardar un día de una patente que falló congelaría un cero falso.
  var guardados = 0;
  if (!soloFresco && !verCuenta && cacheGps.hayStorage()) {
    try {
      var cont2 = cacheGps.getContainer();
      var buenas = {};
      estados.forEach(function(e){ if (e.estado === 'con_datos' && e.origen !== 'cache') buenas[e.plate] = 1; });
      var vivosItems = allItems.filter(function(i){ return buenas[i.plate]; });
      var grupos = cacheGps.agruparPorDia(vivosItems).filter(function(g){ return cacheGps.diaCerrado(g.fecha); });

      // Un día cerrado SIN paradas también hay que guardarlo, si no se vuelve a
      // preguntar por él para siempre. Se completan los días vacíos del rango.
      var conDatos = {};
      grupos.forEach(function(g){ conDatos[g.placa+'|'+g.fecha] = 1; });
      cacheGps.rangoDias(dDesde, dHasta).forEach(function(f){
        if (!cacheGps.diaCerrado(f)) return;
        Object.keys(buenas).forEach(function(p){
          if (!conDatos[p+'|'+f]) grupos.push({placa:p, fecha:f, chofer:null, paradas:[]});
        });
      });

      var LOTE = 16;
      for (var i = 0; i < grupos.length; i += LOTE) {
        if (!alcanzaPara(3000)) break;   // nunca pasarse del presupuesto por guardar
        var lote = grupos.slice(i, i+LOTE);
        await Promise.all(lote.map(function(g){
          return cacheGps.guardarDia(cont2, g.placa, g.fecha, g.paradas, g.chofer).catch(function(){ return null; });
        }));
        guardados += lote.length;
      }
    } catch (e) { /* guardar es best-effort: nunca rompe la respuesta */ }
  }
  cacheInfo.dias_guardados = guardados;

  var sinRespuesta = estados.filter(function(e){return e.estado==='sin_respuesta';}).length;
  var limitadas    = estados.filter(function(e){return e.estado==='limite_proveedor';}).length;

  context.res = {
    status: 200,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Access-Control-Allow-Origin':'*',
      'Cache-Control':'no-cache',
      'X-Debug-Plates-Total':String(results.length),
      'X-Debug-Plates-Ok':String(okCount),
      'X-Debug-Plates-NoData':String(sinRespuesta),
      'X-Debug-Plates-RateLimited':String(limitadas),
      'X-Debug-Plates-Error':String(errors.length),
      'X-Debug-Elapsed-Ms':String(elapsedMs),
      'X-Debug-Plates-Pending':String(pendientes.length)
    },
    body: JSON.stringify({
      ok:true, desde:sStartDate1, hasta:sStartDate2,
      time:iTime, elapsedMs:elapsedMs,
      total:allItems.length, items:allItems, errors:errors,
      cache: cacheInfo,
      // Nuevo: estado por placa. 'sin_respuesta' NO significa que el camión
      // estuvo detenido; significa que el dato no llegó y no se puede concluir.
      placas: estados,
      // Placas que no alcanzaron a consultarse en esta llamada. El cliente
      // debe volver a pedirlas; no son placas sin actividad.
      pendientes: pendientes,
      resumen: {
        consultadas: results.length,
        pendientes: pendientes.length,
        budget_ms: FUNCTION_BUDGET_MS,
        con_datos: okCount,
        sin_respuesta: sinRespuesta,
        limite_proveedor: limitadas,
        con_error: errors.length,
        bloqueadas: bloqueadas.length,
        duplicados_descartados: duplicados,
        gap_proveedor_ms: PROVIDER_GAP_MS,
        confiable: sinRespuesta === 0 && limitadas === 0 && errors.length === 0 && pendientes.length === 0
      }
    })
  };
};

function parsePlateXML(xml, plateId) {
  var result = {plate:plateId, name:'', items:[]};

  var nameM = xml.match(/Name="([^"]*)"/);
  if (nameM) result.name = nameM[1];

  if (xml.indexOf('<ITEM>') === -1) return result;

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
  var i = 0;
  for (; i < items.length; i += MAX_CONCURRENT) {
    var batch = items.slice(i, i+MAX_CONCURRENT);
    var batchResult = await Promise.all(batch.map(function(item){
      return asyncFn(item)
        .then(function(r){return{plate:item,ok:true,xml:r.xml,intentos:r.intentos,msPorIntento:r.ms,
                                 limitado:r.limitado,msgProveedor:r.msgProveedor};})
        .catch(function(err){return{plate:item,ok:false,error:err.message,intentos:err.intentos||0};});
    }));
    results = results.concat(batchResult);
    if (i+MAX_CONCURRENT >= items.length) { i += MAX_CONCURRENT; break; }
    // ¿Alcanza para esperar la ventana del proveedor y atender otra placa?
    // Si no, se corta acá y las que faltan se informan como pendientes: es
    // preferible una respuesta parcial y honesta a un 500 a los 45 segundos.
    if (!alcanzaPara(DELAY_MS + 4000)) { i += MAX_CONCURRENT; break; }
    await sleep(DELAY_MS);
  }
  return {results: results, pendientes: items.slice(i)};
}

// Reintenta mientras la respuesta venga vacía. Devuelve el último XML recibido
// junto con cuántos intentos costó y cuánto demoró cada uno (una respuesta
// vacía de ~30 ms es el síntoma del rechazo del proveedor).
async function queryPlateUntilData(plate, s1, s2, iTime) {
  var ms = [];
  var xml = '';
  var limitado = false, msgProv = '';
  for (var intento = 1; intento <= EMPTY_RETRY_MAX; intento++) {
    var t0 = Date.now();
    xml = await queryPlateWithRetry(plate, s1, s2, iTime);
    ms.push(Date.now()-t0);
    if (xml.indexOf('<ITEM>') !== -1) return {xml:xml, intentos:intento, ms:ms};

    var cod = codigoProveedor(xml);
    if (cod === '109') {
      // Rechazo por frecuencia, no ausencia de datos. Esperar la ventana
      // completa del proveedor antes de volver a preguntar, pero sólo si el
      // presupuesto de la función lo permite: si no, se informa el límite y
      // se devuelve lo que haya, en vez de morir en un 500.
      limitado = true; msgProv = mensajeProveedor(xml);
      if (intento < EMPTY_RETRY_MAX && alcanzaPara(PROVIDER_GAP_MS + 4000)) {
        await sleep(PROVIDER_GAP_MS); continue;
      }
      break;
    } else if (intento < EMPTY_RETRY_MAX && alcanzaPara(EMPTY_RETRY_DELAY + 4000)) {
      await sleep(EMPTY_RETRY_DELAY);
    } else {
      break;
    }
  }
  return {xml:xml, intentos:EMPTY_RETRY_MAX, ms:ms, limitado:limitado, msgProveedor:msgProv};
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
