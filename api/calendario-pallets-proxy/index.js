// ─────────────────────────────────────────────────────────────────────────
// Azure Function: calendario-pallets-proxy
// ─────────────────────────────────────────────────────────────────────────
// Llama al API M3Link (token-based, mismo patrón que /proxy/ops), filtra
// transferencias cerradas, cruza con la tabla de retención y devuelve datos
// agregados listos para pintar el calendario.
//
// Query params:
//   fechaInicio=YYYY-MM-DD
//   fechaFin=YYYY-MM-DD
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

// Mismo endpoint que usa el dashboard M3Link actual (con token en path)
var API_HOST = 'apirdt1.azurewebsites.net';
var API_PATH = '/api/rdtd9fd8f96a6970ff1e18c510952fddd45cc182e3cdrt/pbi/OpsXRangoFechas';

// ─── Helpers ─────────────────────────────────────────────────────────────

// Convierte el formato del API M3Link (puede venir como "DD-MM-YYYY",
// "DD-MM-YYYY, HH:MM:SS a. m." o ISO) a Date UTC mediodía
function parseFechaM3(s) {
  if (!s) return null;
  var clean = String(s).split(',')[0].trim();
  // Caso 1: ISO "YYYY-MM-DD..."
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    var p = clean.substring(0, 10).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12, 0, 0));
  }
  // Caso 2: "DD-MM-YYYY"
  var parts = clean.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    return new Date(Date.UTC(+parts[2], +parts[1] - 1, +parts[0], 12, 0, 0));
  }
  return null;
}

function fmtISO(d) {
  if (!d) return null;
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

// Resuelve días de retención: lookup exacto → default por retail → default global
function resolverDias(cliente, retail) {
  var def = retencion.metadata.defaultGlobal;
  if (!cliente || !retail) return { dias: def, origen: 'default_global' };
  var c = String(cliente).trim();
  var r = String(retail).trim();
  if (retencion.lookup[c] && retencion.lookup[c][r] != null) {
    return { dias: retencion.lookup[c][r], origen: 'exacto' };
  }
  if (retencion.defaultPorRetail[r] != null) {
    return { dias: retencion.defaultPorRetail[r], origen: 'default_retail' };
  }
  return { dias: def, origen: 'default_global' };
}

function addDays(d, days) {
  var r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

// ─── Llamada al API M3Link ───────────────────────────────────────────────
function fetchM3(fechaInicio, fechaFin) {
  return new Promise(function (resolve, reject) {
    var qs = '?fechaInicio=' + encodeURIComponent(fechaInicio) +
             '&fechaFin='    + encodeURIComponent(fechaFin);
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
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('JSON inválido del API: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, function () { req.destroy(new Error('Timeout API M3Link (120s)')); });
    req.end();
  });
}

// ─── Agregación ──────────────────────────────────────────────────────────
function agregar(items) {
  var calendario = {};
  var totalPallets = 0;
  var totalTrf = 0;
  var fechasSet = new Set();
  var omitidos = { sinFecha: 0, sinPallets: 0, etapaNoCerrada: 0, noTransferencia: 0 };

  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    if (!it.etapaOperacion) { omitidos.etapaNoCerrada++; continue; }
    var etapa = String(it.etapaOperacion).toLowerCase();
    if (etapa.indexOf('cerrada') === -1) { omitidos.etapaNoCerrada++; continue; }
    if (!it.operacion || String(it.operacion).toLowerCase().indexOf('transferencia') === -1) {
      omitidos.noTransferencia++; continue;
    }

    var fConf = parseFechaM3(it.fechaConfirmacion);
    if (!fConf) { omitidos.sinFecha++; continue; }

    var pallets = parseInt(it.cantidadConfirmada, 10);
    if (!pallets || pallets <= 0) { omitidos.sinPallets++; continue; }

    var cliente = it.clienteOrigenStr;
    var retail  = it.clienteDestinoStr;
    var dr = resolverDias(cliente, retail);
    var fechaRetiro = addDays(fConf, dr.dias);
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

    var ckey = cliente + '||' + dr.dias;
    if (!rd._clientes[ckey]) {
      rd._clientes[ckey] = { cliente: cliente, dias: dr.dias, pallets: 0, trf: 0, origen: dr.origen };
    }
    rd._clientes[ckey].pallets += pallets;
    rd._clientes[ckey].trf += 1;

    totalPallets += pallets;
    totalTrf += 1;
  }

  // Convertir objetos a arrays ordenados (mayor volumen primero)
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
    },
    omitidos: omitidos
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────
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

  var fechaInicio = (req.query && req.query.fechaInicio) ? req.query.fechaInicio : '';
  var fechaFin    = (req.query && req.query.fechaFin)    ? req.query.fechaFin    : '';

  if (!fechaInicio || !fechaFin) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: { ok: false, error: 'Faltan parámetros fechaInicio / fechaFin (formato YYYY-MM-DD)' }
    };
    return;
  }

  try {
    context.log('Llamando M3Link:', fechaInicio, 'a', fechaFin);
    var raw = await fetchM3(fechaInicio, fechaFin);
    var items = Array.isArray(raw) ? raw : (raw && raw.data) ? raw.data : [];
    context.log('Registros recibidos del API:', items.length);

    var agg = agregar(items);
    context.log('Procesados:', agg.resumen.totalTrf, 'Omitidos:', JSON.stringify(agg.omitidos));

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
          fechaInicio: fechaInicio,
          fechaFin:    fechaFin,
          tablaRetencion: retencion.metadata,
          registrosCrudos: items.length,
          registrosProcesados: agg.resumen.totalTrf,
          omitidos: agg.omitidos
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
