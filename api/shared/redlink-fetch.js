// ============================================================================
//  shared/redlink-fetch.js  ·  Cliente único de la API del portal (Holux)
//
//  Fuente ÚNICA para hablar con Redlink. La usan api/redlink-ops (el endpoint
//  explícito, para probar) y api/ops + shared/ops-fetch.js (el camino normal,
//  cuando el origen está conmutado). Si cada uno reimplantara el token y el
//  mapeo, los números se separarían de a poco y sin que nadie se entere — el
//  mismo criterio que ya está escrito en rollup-transferencias.js.
//
//  Credenciales: SÓLO por Application Settings. Nunca en el código.
// ============================================================================
'use strict';

const TOKEN_URL = process.env.REDLINK_TOKEN_URL ||
  'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const API_BASE  = process.env.REDLINK_API_BASE || 'https://api.portalredtec.cl';
const CLIENT_ID = process.env.REDLINK_CLIENT_ID || 'apiportalredtec';
const BP_DEF    = process.env.REDLINK_BP || '433';
const TRAMO     = Math.max(1, parseInt(process.env.REDLINK_TRAMO_DIAS || '31', 10) || 31);

let _tok = { valor: null, vence: 0 };

function faltantes() {
  return ['REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS'].filter(k => !process.env[k]);
}
function configurado() { return faltantes().length === 0; }

async function token(forzar) {
  if (!forzar && _tok.valor && Date.now() < _tok.vence) return _tok.valor;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: process.env.REDLINK_CLIENT_SECRET,
      grant_type: 'password',
      username: process.env.REDLINK_USER,
      password: process.env.REDLINK_PASS,
      scope: 'openid'
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('No se pudo obtener el token (HTTP ' + r.status + ') ' + t.slice(0, 120));
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('El token vino sin access_token');
  _tok = { valor: j.access_token, vence: Date.now() + ((j.expires_in || 60) - 15) * 1000 };
  return _tok.valor;
}

/* ---- fechas: la entrada es ISO; Redlink espera MM-dd-yyyy (americano) ----- */
const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function validarIso(s, nombre) {
  if (!RE_ISO.test(String(s || ''))) throw new Error('Parámetro ' + nombre + ' debe venir como YYYY-MM-DD');
  const p = String(s).split('-').map(Number);
  const f = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (f.getUTCFullYear() !== p[0] || f.getUTCMonth() !== p[1] - 1 || f.getUTCDate() !== p[2])
    throw new Error('La fecha ' + nombre + ' no existe: ' + s);
  return f;
}
const dos = n => String(n).padStart(2, '0');
function aUS(f)  { return dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate()) + '-' + f.getUTCFullYear(); }
function aIso(f) { return f.getUTCFullYear() + '-' + dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate()); }
function tramos(desde, hasta, dias) {
  dias = dias || TRAMO;
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

/* ---- traducción Redlink -> contrato de RDT ------------------------------- */
const txt = v => (v === null || v === undefined) ? '' : String(v).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function traducir(reg) {
  const det = (reg.formDdetalles && reg.formDdetalles[0]) || {};
  const tr  = (reg.formDtransportes && reg.formDtransportes[0]) || {};
  // La patente casi nunca está en la cabecera (3,3%): el grueso viaja en
  // transporte.patenteCliente (24,4%). Sin la cascada se pierde el 90%.
  const patente = txt(reg.patente) || txt(tr.camionPatente) || txt(tr.patenteCliente);
  const chofer  = txt(reg.choferNombre) || txt(tr.choferNombre) || txt(tr.nombreCliente);

  return {
    nroPedido:          reg.folio,
    dteNro:             txt(reg.folioDte) || null,
    // "Devolucion " llega CON espacio al final; sin el trim se rompe todo ===
    operacion:          txt(reg.servicioNombre),
    etapaOperacion:     txt(reg.formMetapaNombre),
    horaIngreso:        reg.fechaIngresoHora || reg.fechaIngreso || null,
    clienteOrigenStr:   txt(reg.bpOrigenNombre),
    bodegaOrigenStr:    txt(reg.bodegaOrigenNombre),
    clienteDestinoStr:  txt(reg.bpDestinoNombre),
    bodegaDestinoStr:   txt(reg.bodegaDestinoNombre),
    direccion:          txt(reg.direccion),
    // RDT manda 0 donde Redlink manda null; el espejo normaliza y el valor
    // crudo se conserva en recepcionCruda.
    cantidadSolicitada: num(reg.cantidad),
    cantidadDespachada: num(reg.despachado),
    cantidadConfirmada: num(reg.recepcion),
    cantidadPendiente:  num(reg.pendiente),
    fechaRequerida:     reg.fechaRequerida || null,
    fechaDespacho:      reg.fechaDespacho || null,
    fechaConfirmacion:  reg.fechaConfirmacion || null,
    nroCita:            txt(reg.cita) || txt(tr.cita) || null,
    tipoDocumento:      txt(reg.documentoNombre),
    nroDocumento:       txt(reg.documentoNumero),
    patente:            patente,
    chofer:             chofer,
    usuario:            txt(reg.usuarioIngresoNombre),
    observacion:        txt(reg.observacionOrigen),

    // ---- lo que Redlink agrega; claves nuevas, nadie se rompe por ellas ---
    formHeaderiD:       reg.formHeaderiD,
    contratoId:         reg.contratoId || null,
    servicioId:         reg.servicioId,
    formMetapaId:       reg.formMetapaId,
    bpId:               reg.bpId,
    bpOrigenId:         reg.bpOrigenId,
    bpDestinoId:        reg.bpDestinoId,
    bodegaOrigenId:     reg.bodegaOrigenId,
    bodegaDestinoId:    reg.bodegaDestinoId,
    confirmacionVeces:  reg.confirmacionVeces,
    recepcionAnterior:  det.recepcionAnterior,
    citaFecha:          tr.citaFecha || null,
    linkGuia:           reg.linkGuia || null,
    abierto:            reg.abierto,
    recepcionCruda:     (reg.recepcion === null || reg.recepcion === undefined) ? null : num(reg.recepcion),

    // ---- comerciales / SAP (promovidos arriba, fáciles de consultar) ------
    // No los usa ninguna vista HOY, pero con ellos arriba un KPI futuro los lee
    // directo (sin escarbar en _rl). Van crudos, igual que el aplanar viejo.
    itemCode:           det.itemCode,
    itemName:           det.itemName,
    precio:             det.precio,
    arriendo:           det.arriendo,
    linkFactura:        reg.linkFactura || null,
    sapObjType:         tr.sapObjType,
    sapDocEntry:        tr.sapDocEntry,
    sapDocNum:          tr.sapDocNum,
    folioGuiaDte:       tr.folioGuiaDte,
    enviadoSap:         tr.enviadoSap,

    // ---- registro Redlink COMPLETO (nada se pierde) -----------------------
    // Se guarda el reg crudo entero — incluye formDdetalles/formDtransportes
    // completos (todos los ítems/transportes, no solo el [0]) — para armar
    // cualquier KPI a futuro sobre "esta vista" sin tener que re-extraer de
    // Redlink. Las vistas lo ignoran; sólo ocupa espacio en el blob.
    _rl:                reg
  };
}

async function traerTramo(bp, t) {
  const url = API_BASE + '/api/formheader/historico/' + encodeURIComponent(bp) +
              '?fechainicio=' + aUS(t.desde) + '&fechafin=' + aUS(t.hasta);
  let tk = await token(false);
  let r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } });
  if (r.status === 401) {                      // el token pudo vencer a mitad de camino
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
  return (data && (data.value || data.data)) || [];
}

/**
 * Trae un rango completo, ya traducido al contrato de RDT.
 * @param desdeIso,hastaIso  'YYYY-MM-DD'
 * @param opts  { bp, presupuestoMs, crudo, onTramo }
 *   presupuestoMs: si se agota se LANZA un error que dice hasta dónde llegó.
 *   Nunca se devuelve una respuesta parcial que parezca completa.
 */
async function consultarRedlink(desdeIso, hastaIso, opts) {
  opts = opts || {};
  const faltan = faltantes();
  if (faltan.length) {
    const e = new Error('Faltan Application Settings: ' + faltan.join(', '));
    e.noConfigurado = true;
    throw e;
  }
  const desde = validarIso(desdeIso, 'fechaInicio');
  const hasta = validarIso(hastaIso, 'fechaFin');
  if (hasta < desde) throw new Error('fechaFin es anterior a fechaInicio');

  const bp = /^\d+$/.test(String(opts.bp || '')) ? String(opts.bp) : BP_DEF;
  const lista = tramos(desde, hasta, opts.tramoDias);
  const presup = opts.presupuestoMs;
  const t0 = Date.now();
  const medidas = [];
  let out = [];

  for (let i = 0; i < lista.length; i++) {
    if (presup && i > 0 && (Date.now() - t0) > presup) {
      const e = new Error('La consulta no alcanzó a completarse dentro del presupuesto de tiempo: ' +
        'se leyeron ' + i + ' de ' + lista.length + ' tramos (' + aIso(desde) + ' a ' +
        aIso(lista[i - 1].hasta) + ') en ' + (Date.now() - t0) + ' ms. Pedí una ventana más corta.');
      e.agotado = true; e.tramos = medidas;
      throw e;
    }
    const ti = Date.now();
    const lote = await traerTramo(bp, lista[i]);
    medidas.push({ desde: aIso(lista[i].desde), hasta: aIso(lista[i].hasta),
                   registros: lote.length, ms: Date.now() - ti });
    if (opts.onTramo) opts.onTramo(medidas[medidas.length - 1]);
    if (!opts.soloMedir) out = out.concat(lote);
  }
  return { bp: bp, ms: Date.now() - t0, tramos: medidas,
           filas: opts.crudo ? out : out.map(traducir) };
}

module.exports = { consultarRedlink, traducir, tramos, aUS, aIso, validarIso,
                   faltantes, configurado, TRAMO, BP_DEF };
