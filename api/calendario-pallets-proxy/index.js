// ─────────────────────────────────────────────────────────────────────────
// Azure Function: calendario-pallets-proxy
// VERSION: v2-retiros-reales-ok-14may-2026
// ─────────────────────────────────────────────────────────────────────────
// Llama al API M3Link (token-based, mismo patrón que /proxy/ops), filtra
// transferencias cerradas, cruza con la tabla de retención y devuelve datos
// agregados listos para pintar el calendario.
//
// PASE 2 (NUEVO): además de transferencias, agrupa retiros (operacion=Retiros
// + todas las etapas + cantConfirmada por fechaRequerida) y los devuelve como
// `retirosReales` en la respuesta. Esto permite al frontend mostrar
// "estimado vs real" en cada día del calendario.
//
// Query params:
//   fechaInicio=YYYY-MM-DD
//   fechaFin=YYYY-MM-DD
//
// Responde JSON:
//   {
//     ok: true,
//     metadata: { ... },
//     calendario:    { "2026-03-25": { total_pallets, total_trf, retails: [...] } },
//     retirosReales: { "2026-03-25": { total_pallets, total_trf, retails: [...] } },  ← NUEVO
//     resumen:       { totalPallets, totalTrf, totalDias, fechaMin, fechaMax,
//                      totalRetiros, trfRetiros }  ← NUEVOS últimos 2 campos
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
    // IMPORTANTE: el dashboard usa fechaInicio/fechaFin pero el API real
    // espera fechaInicial/fechaFinal. Esta traducción es la misma que hace
    // el proxy /api/ops existente. Sin esto el API ignora el rango y
    // devuelve solo los últimos registros del día más reciente.
    var qs = '?fechaInicial=' + encodeURIComponent(fechaInicio) +
             '&fechaFinal='   + encodeURIComponent(fechaFin);
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
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          // Capturar el body de error para devolver mensaje útil
          var snippet = body.substring(0, 200).replace(/\s+/g, ' ').trim();
          return reject(new Error('API M3Link respondió ' + res.statusCode +
            (snippet ? ' (' + snippet + ')' : '')));
        }
        // Validar que la respuesta sea JSON antes de parsear
        var trimmed = body.trim();
        if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) {
          var snip = trimmed.substring(0, 150).replace(/\s+/g, ' ');
          return reject(new Error('API M3Link devolvió respuesta no-JSON: "' + snip + '". ' +
            'Probablemente el servicio backend está caído.'));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON inválido del API M3Link: ' + e.message));
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
  var descartes = []; // log detallado de los primeros 10 descartes

  function logDescarte(razon, item) {
    if (descartes.length < 10) {
      descartes.push({
        razon: razon,
        operacion: item.operacion,
        etapaOperacion: item.etapaOperacion,
        cantidadConfirmada: item.cantidadConfirmada,
        cantidadDespachada: item.cantidadDespachada,
        fechaDespacho: item.fechaDespacho || item.fechaEmision || item.fechaEnvio || null,
        fechaConfirmacion: item.fechaConfirmacion,
        clienteOrigenStr: item.clienteOrigenStr,
        clienteDestinoStr: item.clienteDestinoStr
      });
    }
  }

  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    if (!it.etapaOperacion) { omitidos.etapaNoCerrada++; logDescarte('sin etapaOperacion', it); continue; }
    var etapa = String(it.etapaOperacion).toLowerCase();
    if (etapa.indexOf('cerrada') === -1) { omitidos.etapaNoCerrada++; logDescarte('etapa no cerrada: '+it.etapaOperacion, it); continue; }
    if (!it.operacion || String(it.operacion).toLowerCase().indexOf('transferencia') === -1) {
      omitidos.noTransferencia++; logDescarte('no es transferencia: '+it.operacion, it); continue;
    }

    // ────────────────────────────────────────────────────────────────────
    // CÁLCULO BASE: usar fecha DESPACHO (no confirmación)
    // ────────────────────────────────────────────────────────────────────
    // El comercial pidió calcular días de retención desde la fecha en que
    // el pedido sale físicamente hacia el retail, no desde la confirmación
    // (que puede ser muy posterior y deformar el cálculo del retiro).
    // Si fechaDespacho no viene en la respuesta, fallback a confirmación.
    // Posibles nombres del campo en el API: fechaDespacho, fechaEmision,
    // fechaEnvio. Si tu API usa otro nombre, agregarlo aquí abajo.
    var rawDespacho = it.fechaDespacho || it.fechaEmision || it.fechaEnvio || null;
    var fDesp = rawDespacho ? parseFechaM3(rawDespacho) : null;
    var fConf = parseFechaM3(it.fechaConfirmacion);

    // La fecha base es despacho si existe; si no, fallback a confirmación
    var fBase = fDesp || fConf;
    if (!fBase) { omitidos.sinFecha++; logDescarte('sin fecha válida (despacho ni confirmación): desp='+rawDespacho+' conf='+it.fechaConfirmacion, it); continue; }

    var pallets = parseInt(it.cantidadConfirmada, 10);
    if (!pallets || pallets <= 0) { omitidos.sinPallets++; logDescarte('sin pallets confirmados', it); continue; }

    var cliente = it.clienteOrigenStr;
    var retail  = it.clienteDestinoStr;
    var dr = resolverDias(cliente, retail);
    var fechaRetiro = addDays(fBase, dr.dias);
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
      rd._clientes[ckey] = {
        cliente: cliente,
        dias: dr.dias,
        pallets: 0,
        trf: 0,
        origen: dr.origen,
        _detalle: []  // detalle de cada transferencia para el modal
      };
    }
    rd._clientes[ckey].pallets += pallets;
    rd._clientes[ckey].trf += 1;
    rd._clientes[ckey]._detalle.push({
      bodegaOrigen:      it.bodegaOrigenStr  || '—',
      bodegaDestino:     it.bodegaDestinoStr || '—',
      nroPedido:         it.nroPedido        || '—',
      // Ambas fechas para que el modal pueda mostrar la principal + tooltip
      fechaDespacho:     fDesp ? fmtISO(fDesp) : null,
      fechaConfirmacion: fConf ? fmtISO(fConf) : null,
      // 'fechaBase' marca cuál se usó para el cálculo (debugging)
      fechaBase:         fDesp ? 'despacho' : 'confirmacion',
      pallets:           pallets
    });

    totalPallets += pallets;
    totalTrf += 1;
  }

  // Convertir objetos a arrays ordenados (mayor volumen primero)
  var calOut = {};
  Object.keys(calendario).forEach(function (k) {
    var dia = calendario[k];
    var retails = Object.keys(dia._retails).map(function (r) {
      var rd = dia._retails[r];
      var clis = Object.keys(rd._clientes).map(function (c) {
        var ci = rd._clientes[c];
        // Ordenar el detalle por bodega origen y luego por nro pedido
        ci._detalle.sort(function (a, b) {
          if (a.bodegaOrigen !== b.bodegaOrigen) {
            return a.bodegaOrigen.localeCompare(b.bodegaOrigen);
          }
          return String(a.nroPedido).localeCompare(String(b.nroPedido));
        });
        return {
          cliente: ci.cliente, dias: ci.dias, pallets: ci.pallets,
          trf: ci.trf, origen: ci.origen, detalle: ci._detalle
        };
      });
      clis.sort(function (a, b) { return b.pallets - a.pallets; });
      return { retail: rd.retail, pallets: rd.pallets, trf: rd.trf, clientes: clis };
    });
    retails.sort(function (a, b) { return b.pallets - a.pallets; });
    calOut[k] = { total_pallets: dia.total_pallets, total_trf: dia.total_trf, retails: retails };
  });

  var fechas = Array.from(fechasSet).sort();

  // ────────────────────────────────────────────────────────────────────────
  // SEGUNDO PASE: retiros reales (operacion=Retiros, todas las etapas)
  // ────────────────────────────────────────────────────────────────────────
  // El comercial validó contra SAP que este filtro coincide 1:1:
  //   operacion = "Retiros"
  //   etapaOperacion = TODAS (sin filtrar)
  //   suma cantidadConfirmada
  //   agrupado por fechaRequerida
  // Ejemplo verificado: 01-may a 13-may → 38.390 pallets (coincide con SAP).
  //
  // Este dato es independiente del calendario de transferencias. Se devuelve
  // por separado para que el frontend lo cruce por fecha y muestre como
  // "real retirado" junto al estimado.
  var retirosReales = {};   // { 'YYYY-MM-DD': { pallets, trf, retails:{ retail: { pallets, trf, items:[...] } } } }
  var totalRetiros = 0;
  var trfRetiros = 0;
  var omitidosRetiros = { sinFecha: 0, sinCantidad: 0, noRetiro: 0 };

  for (var i2 = 0; i2 < items.length; i2++) {
    var ir = items[i2];
    if (!ir.operacion || String(ir.operacion).toLowerCase().indexOf('retiro') === -1) {
      omitidosRetiros.noRetiro++; continue;
    }
    var cantR = parseInt(ir.cantidadConfirmada, 10);
    if (!cantR || cantR <= 0) { omitidosRetiros.sinCantidad++; continue; }
    var fReqRaw = ir.fechaRequerida;
    var fReq = fReqRaw ? parseFechaM3(fReqRaw) : null;
    if (!fReq) { omitidosRetiros.sinFecha++; continue; }
    var kR = fmtISO(fReq);
    if (!kR) continue;

    if (!retirosReales[kR]) {
      retirosReales[kR] = { pallets: 0, trf: 0, retails: {} };
    }
    var bucket = retirosReales[kR];
    bucket.pallets += cantR;
    bucket.trf += 1;

    var retailR = ir.clienteOrigenStr || ir.clienteDestinoStr || '—';
    if (!bucket.retails[retailR]) {
      bucket.retails[retailR] = { pallets: 0, trf: 0, items: [] };
    }
    var rb = bucket.retails[retailR];
    rb.pallets += cantR;
    rb.trf += 1;
    if (rb.items.length < 50) {
      rb.items.push({
        nroPedido: ir.nroPedido || '—',
        bodegaDestino: ir.bodegaDestinoStr || ir.bodegaOrigenStr || '—',
        fechaRequerida: fmtISO(fReq),
        fechaDespacho: ir.fechaDespacho ? fmtISO(parseFechaM3(ir.fechaDespacho)) : null,
        etapaOperacion: ir.etapaOperacion || '—',
        cantidad: cantR
      });
    }
    totalRetiros += cantR;
    trfRetiros += 1;
  }

  // Convertir retiros a output ordenado por pallets DESC
  var retirosOut = {};
  Object.keys(retirosReales).forEach(function (kk) {
    var b = retirosReales[kk];
    var retArr = Object.keys(b.retails).map(function (rname) {
      var info = b.retails[rname];
      return { retail: rname, pallets: info.pallets, trf: info.trf, items: info.items };
    });
    retArr.sort(function (a, b2) { return b2.pallets - a.pallets; });
    retirosOut[kk] = { total_pallets: b.pallets, total_trf: b.trf, retails: retArr };
  });

  return {
    calendario: calOut,
    retirosReales: retirosOut,
    resumen: {
      totalPallets: totalPallets,
      totalTrf: totalTrf,
      totalDias: fechas.length,
      fechaMin: fechas[0] || null,
      fechaMax: fechas[fechas.length - 1] || null,
      totalRetiros: totalRetiros,
      trfRetiros: trfRetiros
    },
    omitidos: omitidos,
    omitidosRetiros: omitidosRetiros,
    descartes: descartes
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

  // Endpoint de versión: /api/calendario-pallets-proxy?version=1
  // Devuelve la versión sin tocar API M3Link (útil para validar deploy).
  if (req.query && req.query.version === '1') {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: {
        ok: true,
        version: 'v2-retiros-reales-ok-14may-2026',
        features: ['transferencias-cerradas', 'retiros-reales', 'fechaDespacho-fallback'],
        timestamp: new Date().toISOString()
      }
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

    // Modo debug: si llega ?debug=1 incluir muestra cruda y razón de descarte
    var debug = (req.query && req.query.debug == '1');
    var debugInfo = null;
    if (debug) {
      debugInfo = {
        muestraCruda: items.slice(0, 3),
        camposPrimerRegistro: items.length ? Object.keys(items[0]) : [],
        razonesDescarte: agg.descartes ? agg.descartes.slice(0, 10) : []
      };
    }

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
        debug: debugInfo,
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
