// ─────────────────────────────────────────────────────────────────────────
// Azure Function: calendario-pallets-proxy
// VERSION: v10-RDTOut-migration-jun-2026 V5
// ─────────────────────────────────────────────────────────────────────────
// Llama al API M3Link (token-based, mismo patrón que /proxy/ops), filtra
// transferencias cerradas, cruza con la tabla de retención y devuelve datos
// agregados listos para pintar el calendario.
//
// CAMBIO v6: el ESTIMADO calendario ahora se calcula con
//   cantidadDespachada × FACTOR_RETORNO  (sobre TODAS las etapas)
// en vez de cantidadConfirmada solo-Cerrada. Motivo: el encargado de área
// valida mes a mes contra inventario físico que ~94% de lo despachado vuelve
// como retiro. Confirmada dejaba fuera ~50k pallets de transferencias
// pendientes (confirman tarde o en cero). El RETIRO REAL M3Link NO cambia.
//
// PASE 2: además de transferencias, agrupa retiros (operacion=Retiros
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

// Migrado al endpoint nuevo RDTOut (controlador anterior se da de baja).
var API_HOST = 'apirdt1.azurewebsites.net';
var API_PATH = '/api/RDTOut/opsxrangofechas';
var API_KEY  = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';

// Factor de retorno del estimado calendario: % de lo DESPACHADO que
// históricamente vuelve como retiro. Calibrado mes a mes contra inventario
// físico por el encargado de área. Si cambia, ajustar solo esta línea.
var FACTOR_RETORNO = 0.94;

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

// v10: determinar planta dominante de un retail (la que tiene más pallets)
function dominantPlanta(plantasObj) {
  if (!plantasObj) return 'santiago';
  var max = 0, winner = 'santiago';
  var keys = Object.keys(plantasObj);
  for (var i = 0; i < keys.length; i++) {
    if (plantasObj[keys[i]] > max) { max = plantasObj[keys[i]]; winner = keys[i]; }
  }
  return winner;
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
    // API nuevo RDTOut usa parámetros desde/hasta (en lugar de fechaInicial/fechaFinal)
    var qs = '?desde=' + encodeURIComponent(fechaInicio) +
             '&hasta=' + encodeURIComponent(fechaFin);
    var options = {
      host:   API_HOST,
      path:   API_PATH + qs,
      method: 'GET',
      headers: {
        'Accept':    'application/json',
        'X-Api-Key': API_KEY
      }
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
function agregar(items, rangoFin) {
  // rangoFin: 'YYYY-MM-DD' = última fecha del rango consultado. Sirve para
  // detectar la "cola pendiente": transferencias despachadas dentro del rango
  // cuyo retiro proyectado cae DESPUÉS del rango (aún no tocaba retirarlas).
  var calendario = {};
  var totalPallets = 0;
  var totalTrf = 0;
  var totalReversa = 0;       // |cantPendiente negativa| acumulada
  var opsReversa = 0;
  var colaPendiente = 0;      // pallets despachados con retiro fuera del rango
  var opsColaPendiente = 0;
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

    // v6: el estimado ahora considera TODAS las etapas (Cerrada + Pendiente
    // Adjuntar Respaldo + Pendiente Confirmación). Antes solo Cerrada, lo que
    // dejaba fuera ~50k pallets ya despachados pero sin confirmar. El encargado
    // valida con inventario que esos también vuelven como retiro.
    if (!it.etapaOperacion) { omitidos.etapaNoCerrada++; logDescarte('sin etapaOperacion', it); continue; }
    // Aceptamos 2 tipos de operación que conceptualmente son transferencias:
    //   - "Transferencias"     → flujo estándar cliente → retail
    //   - "Trans Diferenciada" → variante operativa, casi exclusiva de WALMART
    //                            (70.345 de 70.356 pallets · 97.5%). Se descartaba
    //                            antes y eso causaba el sub-conteo de WALMART.
    // Ambas aplican retencionDias por cliente-retail igual.
    var opLower = String(it.operacion || '').toLowerCase();
    var esTransferencia = opLower.indexOf('transferencia') !== -1 || opLower.indexOf('trans diferenciada') !== -1;
    if (!it.operacion || !esTransferencia) {
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

    // v6: estimado = cantidadDespachada × FACTOR_RETORNO (antes: cantidadConfirmada).
    // Despachada = lo que físicamente salió hacia el retail. Aplicar el factor
    // de retorno da el pronóstico de cuánto volverá como retiro.
    var despachada = parseInt(it.cantidadDespachada, 10) || 0;
    var pallets = Math.round(despachada * FACTOR_RETORNO);
    if (!pallets || pallets <= 0) { omitidos.sinPallets++; logDescarte('sin pallets despachados', it); continue; }

    var cliente = it.clienteOrigenStr;
    var retail  = it.clienteDestinoStr;
    var dr = resolverDias(cliente, retail);
    var fechaRetiro = addDays(fBase, dr.dias);
    var key = fmtISO(fechaRetiro);
    if (!key) continue;
    fechasSet.add(key);

    // ─── Reversa: cantidadPendiente negativa ──────────────────────────────
    // Ocurre cuando pasan los ~30 días (según cliente) sin justificar la
    // transferencia y se confirma en cero. Esos pallets NO se van a retirar.
    // Ej: Sol 140 · Desp 140 · Conf 0 · Pend -140 → reversa de 140.
    var pend = parseInt(it.cantidadPendiente, 10) || 0;
    var reversaItem = pend < 0 ? Math.abs(pend) : 0;
    if (reversaItem > 0) {
      totalReversa += reversaItem;
      opsReversa += 1;
    }

    // ─── Cola pendiente: despachado en rango con retiro DESPUÉS del rango ──
    // Esto evita el sesgo a la baja: si consultás "hasta 15/05" y un pallet
    // se despachó el 10/05 con 30 días de retención, su retiro cae el 09/06
    // (fuera del rango). Lo contamos aparte como contexto.
    if (rangoFin && key > rangoFin) {
      colaPendiente += pallets;
      opsColaPendiente += 1;
    }

    if (!calendario[key]) {
      calendario[key] = { total_pallets: 0, total_trf: 0, total_reversa: 0, _retails: {} };
    }
    var dia = calendario[key];
    dia.total_pallets += pallets;
    dia.total_reversa += reversaItem;
    dia.total_trf += 1;

    if (!dia._retails[retail]) {
      dia._retails[retail] = { retail: retail, pallets: 0, trf: 0, _clientes: {}, _plantas: {} };
    }
    var rd = dia._retails[retail];
    rd.pallets += pallets;
    rd.trf += 1;
    // v10: trackear planta REDTEC de origen para filtro por planta
    var bodOrigen = (it.bodegaOrigenStr || '').toUpperCase();
    var plantaKey = bodOrigen.indexOf('COQUIMBO') >= 0 ? 'coquimbo' : bodOrigen.indexOf('TALCA') >= 0 ? 'talca' : 'santiago';
    rd._plantas[plantaKey] = (rd._plantas[plantaKey] || 0) + pallets;

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
      return { retail: rd.retail, pallets: rd.pallets, trf: rd.trf, planta: dominantPlanta(rd._plantas), clientes: clis };
    });
    retails.sort(function (a, b) { return b.pallets - a.pallets; });
    calOut[k] = { total_pallets: dia.total_pallets, total_trf: dia.total_trf, total_reversa: dia.total_reversa || 0, retails: retails };
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
  // SEGUNDO PASE: retiros (operacion=Retiro, todas las etapas)
  // Acumulamos DOS métricas simultáneamente:
  //   - confirmado (cantSolicitada): lo que se SOLICITÓ retirar = "confirmado para retiro"
  //                                  Esto es lo que el jefe operacional consulta.
  //   - retirado   (cantConfirmada): lo que ya se RETIRÓ efectivamente
  //
  // Para un día cerrado los dos números son idénticos. Para un día en curso o
  // futuro, "confirmado" es mayor (hay solicitudes que aún no se ejecutan).
  // El frontend muestra ambos para responder "¿cuánto va a retirarse?" y
  // "¿cuánto se retiró efectivamente?".
  var retirosReales = {};
  var totalRetiros = 0;      // suma cantConfirmada (retirado)
  var totalConfirmado = 0;   // suma cantSolicitada (confirmado para retiro)
  var trfRetiros = 0;
  var omitidosRetiros = { sinFecha: 0, sinCantidad: 0, noRetiro: 0 };

  for (var i2 = 0; i2 < items.length; i2++) {
    var ir = items[i2];
    if (!ir.operacion || String(ir.operacion).toLowerCase().indexOf('retiro') === -1) {
      omitidosRetiros.noRetiro++; continue;
    }
    // Filtrar REDTEC S.A. (retiros internos, no son retiros a retail).
    var retailR_raw = ir.clienteOrigenStr || ir.clienteDestinoStr || '';
    if (String(retailR_raw).trim().toUpperCase() === 'REDTEC S.A.') {
      omitidosRetiros.redtecInterno = (omitidosRetiros.redtecInterno || 0) + 1;
      continue;
    }
    var cantR = parseInt(ir.cantidadConfirmada, 10) || 0;   // retirado real
    var cantS = parseInt(ir.cantidadSolicitada, 10) || 0;   // confirmado para retiro
    // Si AMBAS son 0, no aporta info. Si una de las dos > 0, vale la pena contarla.
    if (cantR <= 0 && cantS <= 0) { omitidosRetiros.sinCantidad++; continue; }
    var fReqRaw = ir.fechaRequerida;
    var fReq = fReqRaw ? parseFechaM3(fReqRaw) : null;
    if (!fReq) { omitidosRetiros.sinFecha++; continue; }
    var kR = fmtISO(fReq);
    if (!kR) continue;

    if (!retirosReales[kR]) {
      retirosReales[kR] = { pallets: 0, palletsConfirmado: 0, trf: 0, retails: {} };
    }
    var bucket = retirosReales[kR];
    bucket.pallets += cantR;
    bucket.palletsConfirmado += cantS;
    bucket.trf += 1;

    var retailR = ir.clienteOrigenStr || ir.clienteDestinoStr || '—';
    if (!bucket.retails[retailR]) {
      bucket.retails[retailR] = { pallets: 0, palletsConfirmado: 0, trf: 0, items: [] };
    }
    var rb = bucket.retails[retailR];
    rb.pallets += cantR;
    rb.palletsConfirmado += cantS;
    rb.trf += 1;
    if (rb.items.length < 50) {
      rb.items.push({
        nroPedido: ir.nroPedido || '—',
        bodegaDestino: ir.bodegaDestinoStr || ir.bodegaOrigenStr || '—',
        fechaRequerida: fmtISO(fReq),
        fechaDespacho: ir.fechaDespacho ? fmtISO(parseFechaM3(ir.fechaDespacho)) : null,
        etapaOperacion: ir.etapaOperacion || '—',
        cantidadSolicitada: cantS,
        cantidadConfirmada: cantR
      });
    }
    totalRetiros += cantR;
    totalConfirmado += cantS;
    trfRetiros += 1;
  }

  // Convertir retiros a output ordenado por pallets DESC.
  // Cada bucket trae las DOS métricas (retirado y confirmado-para-retiro).
  // El frontend decide cuál mostrar como principal.
  // Para ordenar por relevancia: usa palletsConfirmado (que captura tanto el
  // 'va a retirarse' del día en curso como el 'ya retirado' del día cerrado).
  var retirosOut = {};
  Object.keys(retirosReales).forEach(function (kk) {
    var b = retirosReales[kk];
    var retArr = Object.keys(b.retails).map(function (rname) {
      var info = b.retails[rname];
      return {
        retail: rname,
        pallets: info.pallets,                    // retirado (cantConfirmada)
        palletsConfirmado: info.palletsConfirmado, // confirmado para retiro (cantSolicitada)
        trf: info.trf,
        items: info.items
      };
    });
    retArr.sort(function (a, b2) {
      // Ordenar por el mayor de los dos (palletsConfirmado generalmente)
      var aMax = Math.max(a.pallets, a.palletsConfirmado);
      var bMax = Math.max(b2.pallets, b2.palletsConfirmado);
      return bMax - aMax;
    });
    retirosOut[kk] = {
      total_pallets: b.pallets,                    // retirado real
      total_palletsConfirmado: b.palletsConfirmado, // confirmado para retiro
      total_trf: b.trf,
      retails: retArr
    };
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
      totalRetiros: totalRetiros,           // suma cantConfirmada
      totalConfirmado: totalConfirmado,     // suma cantSolicitada (NUEVO)
      trfRetiros: trfRetiros,
      // v7: reversa (cantPendiente negativa) y cola pendiente (retiro fuera del rango)
      totalReversa: totalReversa,
      opsReversa: opsReversa,
      colaPendiente: colaPendiente,
      opsColaPendiente: opsColaPendiente,
      estimadoNeto: totalPallets - totalReversa  // estimado descontando reversas
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
        version: 'v10-RDTOut-migration-jun-2026',
        features: ['estimado-despachada-x-94', 'todas-las-etapas', 'trans-diferenciada', 'retiros-reales', 'retiros-confirmados-cantSolicitada', 'reversa-cantPendiente-negativa', 'cola-pendiente-fuera-rango', 'fechaDespacho-fallback', 'descarta-redtec-interno', 'RDTOut-endpoint', 'X-Api-Key-auth'],
        factorRetorno: FACTOR_RETORNO,
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

    var agg = agregar(items, fechaFin);
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
        calendario:    agg.calendario,
        retirosReales: agg.retirosReales,  // ← faltaba: expone los retiros al frontend
        resumen:       agg.resumen
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
