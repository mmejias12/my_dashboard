// ============================================================================
//  api/redlink-ops  ·  Espejo del contrato de /proxy/ops, leyendo de REDLINK
//
//  PARA QUÉ. Hoy todas las vistas del m3link leen /proxy/ops, que pega al API
//  del proveedor M2Data (apirdt1), que se da de baja antes de diciembre de
//  2026. Esta Function habla DIRECTO con la API del portal (Holux) y devuelve
//  exactamente las mismas claves, para que una vista cambie de origen tocando
//  una constante y nada más.
//
//  POR QUÉ SE PUEDE. Medido el 1-oct-2026 sobre 11.351 operaciones: Redlink
//  entrega los MISMOS 12 servicios, las MISMAS etapas y la MISMA matriz de
//  lados que RDT (Transferencias externo→externo, Relocalización externo→externo
//  más la interna REDTEC→REDTEC, Retiro y Devolución externo→REDTEC, todas las
//  Emisiones REDTEC→externo). Redlink es la fuente aguas arriba de RDT.
//
//  LO QUE NO RESUELVE, para que nadie se ilusione leyendo el código: el precio
//  viene en CERO en el 100% de los registros, y todo el bloque SAP (sapDocNum,
//  sapDocEntry, enviadoSap) y los links de factura vienen vacíos. Esta API da
//  el MOVIMIENTO, no la facturación.
//
//  CREDENCIALES. Ninguna va en el código. Se leen de Application Settings y si
//  falta una la Function responde 503 diciendo cuál falta — nunca su valor.
//  Esto es a propósito: api/ops y shared/ops-fetch.js todavía traen la
//  REDTEC_API_KEY escrita en duro como respaldo y eso es justamente lo que la
//  auditoría pidió sacar.
//      REDLINK_CLIENT_SECRET   (obligatoria)
//      REDLINK_USER            (obligatoria)
//      REDLINK_PASS            (obligatoria)
//      REDLINK_CLIENT_ID       (opcional, default apiportalredtec)
//      REDLINK_TOKEN_URL       (opcional)
//      REDLINK_API_BASE        (opcional, default https://api.portalredtec.cl)
//      REDLINK_BP              (opcional, default 433 = REDTEC = todos)
//      REDLINK_TRAMO_DIAS      (opcional, default 31)
//      REDLINK_PRESUPUESTO_MS  (opcional, default 30000)
//
//  USO
//      /proxy/redlink-ops?fechaInicio=2026-09-01&fechaFin=2026-09-30
//      ...&crudo=1   devuelve el JSON de Redlink sin traducir
//      ...&diag=1    no trae datos: sólo tiempos y conteos por tramo
// ============================================================================
'use strict';

const TOKEN_URL = process.env.REDLINK_TOKEN_URL ||
  'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const API_BASE  = process.env.REDLINK_API_BASE || 'https://api.portalredtec.cl';
const CLIENT_ID = process.env.REDLINK_CLIENT_ID || 'apiportalredtec';
const BP_DEF    = process.env.REDLINK_BP || '433';
const TRAMO     = Math.max(1, parseInt(process.env.REDLINK_TRAMO_DIAS || '31', 10));
// Piso de 1 s: suficiente para rechazar una configuración absurda (0, vacío,
// texto) sin volver la guarda imposible de probar en un test.
const PRESUP    = Math.max(1000, parseInt(process.env.REDLINK_PRESUPUESTO_MS || '30000', 10) || 30000);
const MAX_DIAS  = 400;

/* ---- token: se guarda entre invocaciones mientras la instancia viva -------
   El token de Keycloak es corto; se reusa hasta 15 s antes de su vencimiento
   y, si la API igual responde 401, se pide uno nuevo y se reintenta UNA vez. */
let _tok = { valor: null, vence: 0 };

function faltantes() {
  return ['REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS'].filter(k => !process.env[k]);
}

async function token(forzar) {
  if (!forzar && _tok.valor && Date.now() < _tok.vence) return _tok.valor;
  const cuerpo = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: process.env.REDLINK_CLIENT_SECRET,
    grant_type: 'password',
    username: process.env.REDLINK_USER,
    password: process.env.REDLINK_PASS,
    scope: 'openid'
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: cuerpo
  });
  if (!r.ok) {
    // El cuerpo de un error de Keycloak no lleva secretos, pero igual se recorta.
    const t = await r.text().catch(() => '');
    throw new Error('No se pudo obtener el token (HTTP ' + r.status + ') ' + t.slice(0, 120));
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('El token vino sin access_token');
  _tok = { valor: j.access_token, vence: Date.now() + ((j.expires_in || 60) - 15) * 1000 };
  return _tok.valor;
}

/* ---- fechas --------------------------------------------------------------
   La entrada es YYYY-MM-DD, igual que /proxy/ops. Redlink espera MM-dd-yyyy,
   que es el formato americano: un dd-MM-yyyy pasa silenciosamente como otra
   fecha cuando el día es <= 12, así que la entrada se valida estricta y la
   conversión es explícita. */
const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function validarIso(s, nombre) {
  if (!RE_ISO.test(String(s || ''))) throw new Error('Parámetro ' + nombre + ' debe venir como YYYY-MM-DD');
  const [a, m, d] = s.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d)
    throw new Error('La fecha ' + nombre + ' no existe: ' + s);
  return f;
}
function aUS(f) {
  const p = n => String(n).padStart(2, '0');
  return p(f.getUTCMonth() + 1) + '-' + p(f.getUTCDate()) + '-' + f.getUTCFullYear();
}
function aIso(f) {
  const p = n => String(n).padStart(2, '0');
  return f.getUTCFullYear() + '-' + p(f.getUTCMonth() + 1) + '-' + p(f.getUTCDate());
}
function tramos(desde, hasta, dias) {
  const out = [];
  let ini = new Date(desde.getTime());
  while (ini <= hasta) {
    let fin = new Date(ini.getTime() + (dias - 1) * 86400000);
    if (fin > hasta) fin = new Date(hasta.getTime());
    out.push({ desde: ini, hasta: fin });
    ini = new Date(fin.getTime() + 86400000);
  }
  return out;
}

/* ---- traducción Redlink -> contrato de /proxy/ops ------------------------- */
const txt = v => (v === null || v === undefined) ? '' : String(v).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function traducir(reg) {
  const det = (reg.formDdetalles && reg.formDdetalles[0]) || {};
  const tr  = (reg.formDtransportes && reg.formDtransportes[0]) || {};

  /* La patente casi nunca está en la cabecera (3,3%): el grueso viaja en
     transporte.patenteCliente (24,4%). Sin esta cascada se pierde el 90% de
     las patentes y Pagos SPOT deja de ver los viajes. */
  const patente = txt(reg.patente) || txt(tr.camionPatente) || txt(tr.patenteCliente);
  const chofer  = txt(reg.choferNombre) || txt(tr.choferNombre) || txt(tr.nombreCliente);

  return {
    // ---- el contrato que ya consumen las vistas -------------------------
    nroPedido:         reg.folio,
    dteNro:            txt(reg.folioDte) || null,
    // "Devolucion " llega CON espacio al final en Redlink. Sin el trim,
    // cualquier comparación por === en las vistas viejas deja de calzar.
    operacion:         txt(reg.servicioNombre),
    etapaOperacion:    txt(reg.formMetapaNombre),
    horaIngreso:       reg.fechaIngresoHora || reg.fechaIngreso || null,
    clienteOrigenStr:  txt(reg.bpOrigenNombre),
    bodegaOrigenStr:   txt(reg.bodegaOrigenNombre),
    clienteDestinoStr: txt(reg.bpDestinoNombre),
    bodegaDestinoStr:  txt(reg.bodegaDestinoNombre),
    direccion:         txt(reg.direccion),
    // RDT entrega 0 donde Redlink entrega null. El espejo normaliza para que
    // las vistas no cambien, y el valor crudo se conserva más abajo.
    cantidadSolicitada: num(reg.cantidad),
    cantidadDespachada: num(reg.despachado),
    cantidadConfirmada: num(reg.recepcion),
    cantidadPendiente:  num(reg.pendiente),
    fechaRequerida:    reg.fechaRequerida || null,
    fechaDespacho:     reg.fechaDespacho || null,
    fechaConfirmacion: reg.fechaConfirmacion || null,
    nroCita:           txt(reg.cita) || txt(tr.cita) || null,
    tipoDocumento:     txt(reg.documentoNombre),
    nroDocumento:      txt(reg.documentoNumero),
    patente:           patente,
    chofer:            chofer,
    usuario:           txt(reg.usuarioIngresoNombre),
    observacion:       txt(reg.observacionOrigen),

    // ---- lo que Redlink agrega y RDT nunca tuvo -------------------------
    // Son claves NUEVAS: una vista que no las conoce las ignora.
    formHeaderiD:      reg.formHeaderiD,
    contratoId:        reg.contratoId || null,
    servicioId:        reg.servicioId,
    formMetapaId:      reg.formMetapaId,
    bpId:              reg.bpId,
    bpOrigenId:        reg.bpOrigenId,
    bpDestinoId:       reg.bpDestinoId,
    bodegaOrigenId:    reg.bodegaOrigenId,
    bodegaDestinoId:   reg.bodegaDestinoId,
    confirmacionVeces: reg.confirmacionVeces,
    recepcionAnterior: det.recepcionAnterior,
    citaFecha:         tr.citaFecha || null,
    linkGuia:          reg.linkGuia || null,
    abierto:           reg.abierto,
    // Distingue "confirmado en 0" de "todavía sin confirmar", que es la
    // diferencia que RDT pierde al mandar 0 en los dos casos.
    recepcionCruda:    (reg.recepcion === null || reg.recepcion === undefined) ? null : num(reg.recepcion)
  };
}

/* ---- consulta ------------------------------------------------------------ */
async function traerTramo(bp, t) {
  const url = API_BASE + '/api/formheader/historico/' + encodeURIComponent(bp) +
              '?fechainicio=' + aUS(t.desde) + '&fechafin=' + aUS(t.hasta);
  let tk = await token(false);
  let r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } });
  if (r.status === 401) {                       // token vencido a mitad de camino
    tk = await token(true);
    r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } });
  }
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error('Redlink respondió HTTP ' + r.status + ' en ' +
      aIso(t.desde) + '..' + aIso(t.hasta) + ' ' + cuerpo.slice(0, 150));
  }
  const data = await r.json();
  if (Array.isArray(data)) return data;
  return data && (data.value || data.data) || [];
}

module.exports = async function (context, req) {
  const res = (status, body, extra) => {
    context.res = {
      status: status,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8',
                               'Cache-Control': 'no-cache' }, extra || {}),
      body: typeof body === 'string' ? body : JSON.stringify(body)
    };
  };

  if (req.method === 'OPTIONS') { res(200, ''); return; }

  // Sin configuración NO se adivina nada: se falla cerrado y se dice qué falta.
  const falta = faltantes();
  if (falta.length) {
    res(503, { error: 'Servicio no configurado',
               detalle: 'Faltan Application Settings: ' + falta.join(', ') });
    return;
  }

  const q = req.query || {};
  let desde, hasta;
  try {
    desde = validarIso(q.fechaInicio, 'fechaInicio');
    hasta = validarIso(q.fechaFin, 'fechaFin');
  } catch (e) { res(400, { error: e.message }); return; }
  if (hasta < desde) { res(400, { error: 'fechaFin es anterior a fechaInicio' }); return; }

  const dias = Math.round((hasta - desde) / 86400000) + 1;
  if (dias > MAX_DIAS) {
    res(400, { error: 'Ventana demasiado larga', detalle: dias + ' días; el tope es ' + MAX_DIAS });
    return;
  }

  const bp = /^\d+$/.test(String(q.bp || '')) ? String(q.bp) : BP_DEF;
  const lista = tramos(desde, hasta, TRAMO);
  const t0 = Date.now();
  const medidas = [];
  let crudo = [];

  try {
    for (let i = 0; i < lista.length; i++) {
      if (i > 0 && (Date.now() - t0) > PRESUP) {
        /* No se devuelve un resultado parcial en silencio: media respuesta que
           parece completa es peor que un error. Se dice exactamente hasta dónde
           se alcanzó a leer. */
        res(504, {
          error: 'La consulta no alcanzó a completarse dentro del presupuesto de tiempo',
          detalle: 'Se leyeron ' + i + ' de ' + lista.length + ' tramos (' +
                   aIso(desde) + ' a ' + aIso(lista[i - 1].hasta) + ') en ' +
                   (Date.now() - t0) + ' ms. Pedí una ventana más corta.',
          tramos: medidas
        });
        return;
      }
      const ti = Date.now();
      const lote = await traerTramo(bp, lista[i]);
      medidas.push({ desde: aIso(lista[i].desde), hasta: aIso(lista[i].hasta),
                     registros: lote.length, ms: Date.now() - ti });
      if (!q.diag) crudo = crudo.concat(lote);
    }
  } catch (e) {
    res(502, { error: 'Error consultando Redlink', detalle: e.message, tramos: medidas });
    return;
  }

  const ms = Date.now() - t0;
  const cab = { 'X-Redlink-Ms': String(ms), 'X-Redlink-Tramos': String(lista.length), 'X-Redlink-Bp': bp };

  if (q.diag) { res(200, { bp: bp, dias: dias, ms: ms, tramos: medidas }, cab); return; }
  if (q.crudo) { res(200, crudo, cab); return; }
  res(200, crudo.map(traducir), cab);
};

// Expuesto para las pruebas; no lo usa la Function en producción.
module.exports.traducir   = traducir;
module.exports.tramos     = tramos;
module.exports.aUS        = aUS;
module.exports.validarIso = validarIso;
module.exports.faltantes  = faltantes;
