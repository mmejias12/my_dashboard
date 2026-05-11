// ─────────────────────────────────────────────────────────────────────────
// Azure Function: calendario-pallets-proxy
// ─────────────────────────────────────────────────────────────────────────
// Llama al API M3Link (OpsXRangoFechas), filtra transferencias cerradas,
// cruza con la tabla de retención y devuelve datos agregados listos para
// pintar el calendario.
//
// Query params:
//   fechaInicial=DD-MM-YYYY  (rango de Fecha Confirmación)
//   fechaFinal=DD-MM-YYYY
//
// Responde JSON:
//   {
//     ok: true,
//     metadata: { ... },
//     calendario: { "2026-03-25": { total_pallets, total_trf, retails: [...] } },
//     resumen:    { totalPallets, totalTrf, totalDias, fechaMin, fechaMax }
//   }
// ─────────────────────────────────────────────────────────────────────────

var https = require('https');
var retencion = require('./retencion.json');

var API_HOST = 'apirdt1.azurewebsites.net';
var API_PATH = '/api/Operaciones/OpsXRangoFechas';

// ─── Helpers ─────────────────────────────────────────────────────────────

// Convierte "DD-MM-YYYY" o "01-01-2026, 12:00:00 a. m." a Date (UTC mediodía
// para evitar problemas de zona horaria Chile UTC-4)
function parseFechaM3(s) {
  if (!s) return null;
  var clean = String(s).split(',')[0].trim();
  var parts = clean.split('-');
  if (parts.length !== 3) return null;
  var d = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) - 1;
  var y = parseInt(parts[2], 10);
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

// Formatea Date a "YYYY-MM-DD"
function fmtISO(d) {
  if (!d) return null;
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dd = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// Resuelve días de retención para un par (cliente, retail)
//   1. Lookup exacto en retencion.lookup
//   2. Fallback a defaultPorRetail
//   3. Fallback a defaultGlobal
function resolverDias(cliente, retail) {
  if (!cliente || !retail) return retencion.metadata.defaultGlobal;
  var c = String(cliente).trim();
  var r = String(retail).trim();
  if (retencion.lookup[c] && retencion.lookup[c][r] != null) {
    return { dias: retencion.lookup[c][r], origen: 'exacto' };
  }
  if (retencion.defaultPorRetail[r] != null) {
    return { dias: retencion.defaultPorRetail[r], origen: 'default_retail' };
  }
  return { dias: retencion.metadata.defaultGlobal, origen: 'default_global' };
}

// Suma días a una fecha (UTC para no derrapar por DST)
function addDays(d, days) {
  if (!d) return null;
  var r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

// ─── Llamada al API M3Link ───────────────────────────────────────────────
function fetchM3(fechaInicial, fechaFinal) {
  return new Promise(function (resolve, reject) {
    var qs = '?fechaInicial=' + encodeURIComponent(fechaInicial) +
             '&fechaFinal='   + encodeURIComponent(fechaFinal);
    var options = {
      host:   API_HOST,
      path:   API_PATH + qs,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('M3Link respondió ' + res.statusCode));
        }
        try {
          var body = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON inválido del API: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, function () { req.destroy(new Error('Timeout API M3Link')); });
    req.end();
  });
}

// ─── Agregación ──────────────────────────────────────────────────────────
function agregar(items) {
  // items: array crudo del API M3Link
  // Devuelve { calendario, resumen }

  var calendario = {};         // { fecha: { total_pallets, total_trf, retails: {} } }
  var totalPallets = 0;
  var totalTrf = 0;
  var fechasSet = new Set();

  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    // Filtros
    if (!it.etapaOperacion) continue;
    var etapa = String(it.etapaOperacion).toLowerCase();
    if (etapa.indexOf('cerrada') === -1) continue;          // solo Transferencia Cerrada
    if (!it.operacion || String(it.operacion).toLowerCase().indexOf('transferencia') === -1) continue;

    var fConf = parseFechaM3(it.fechaConfirmacion);
    if (!fConf) continue;

    var cliente = it.clienteOrigenStr;
    var retail  = it.clienteDestinoStr;
    // Solo proyectamos retiro si efectivamente se confirmó la recepción en
    // el retail (Confirmada > 0). Las cerradas con Confirmada=0 son casos
    // de rechazo/rebote y no representan pallets que vayan a retornar.
    var pallets = parseInt(it.cantidadConfirmada, 10);
    if (!pallets || pallets <= 0) continue;

    var dr = resolverDias(cliente, retail);
    var dias = (typeof dr === 'object') ? dr.dias : dr;
    var origenLookup = (typeof dr === 'object') ? dr.origen : 'default_global';

    var fechaRetiro = addDays(fConf, dias);
    var key = fmtISO(fechaRetiro);
    if (!key) continue;
    fechasSet.add(key);

    if (!calendario[key]) {
      calendario[key] = { total_pallets: 0, total_trf: 0, _retails: {} };
    }
    var dia = calendario[key];
    dia.total_pallets += pallets;
    dia.total_trf += 1;

    if (!dia._retails[retail]) {
      dia._retails[retail] = { retail: retail, pallets: 0, trf: 0, _clientes: {} };
    }
    var rd = dia._retails[retail];
    rd.pallets += pallets;
    rd.trf += 1;

    var ckey = cliente + '||' + dias;
    if (!rd._clientes[ckey]) {
      rd._clientes[ckey] = { cliente: cliente, dias: dias, pallets: 0, trf: 0, origen: origenLookup };
    }
    rd._clientes[ckey].pallets += pallets;
    rd._clientes[ckey].trf += 1;

    totalPallets += pallets;
    totalTrf += 1;
  }

  // Convertir objetos a arrays ordenados
  var calOut = {};
  Object.keys(calendario).forEach(function (k) {
    var dia = calendario[k];
    var retails = Object.keys(dia._retails).map(function (r) {
      var rd = dia._retails[r];
      var clis = Object.keys(rd._clientes).map(function (c) { return rd._clientes[c]; });
      clis.sort(function (a, b) { return b.pallets - a.pallets; });
      return { retail: rd.retail, pallets: rd.pallets, trf: rd.trf, clientes: clis };
    });
    retails.sort(function (a, b) { return b.pallets - a.pallets; });
    calOut[k] = { total_pallets: dia.total_pallets, total_trf: dia.total_trf, retails: retails };
  });

  var fechas = Array.from(fechasSet).sort();
  return {
    calendario: calOut,
    resumen: {
      totalPallets: totalPallets,
      totalTrf: totalTrf,
      totalDias: fechas.length,
      fechaMin: fechas[0] || null,
      fechaMax: fechas[fechas.length - 1] || null
    }
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────
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

  var fechaInicial = (req.query && req.query.fechaInicial) ? req.query.fechaInicial : '';
  var fechaFinal   = (req.query && req.query.fechaFinal)   ? req.query.fechaFinal   : '';

  if (!fechaInicial || !fechaFinal) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { ok: false, error: 'Faltan parámetros fechaInicial / fechaFinal (formato DD-MM-YYYY)' }
    };
    return;
  }

  try {
    context.log('Llamando M3Link:', fechaInicial, 'a', fechaFinal);
    var raw = await fetchM3(fechaInicial, fechaFinal);

    // El API M3Link puede devolver array directo o { data: [...] }; normalizar
    var items = Array.isArray(raw) ? raw : (raw && raw.data) ? raw.data : [];
    context.log('Registros recibidos del API:', items.length);

    var agg = agregar(items);

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: {
        ok: true,
        metadata: {
          fechaInicial: fechaInicial,
          fechaFinal:   fechaFinal,
          tablaRetencion: retencion.metadata,
          registrosCrudos: items.length,
          registrosProcesados: agg.resumen.totalTrf
        },
        calendario: agg.calendario,
        resumen:    agg.resumen
      }
    };
  } catch (err) {
    context.log.error('Error proxy:', err);
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { ok: false, error: err.message || 'Error desconocido' }
    };
  }
};
