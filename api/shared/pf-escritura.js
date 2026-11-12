// ============================================================================
//  api/shared/pf-escritura.js  ·  Crear la relocalización en Redlink
//
//  Dos partes: la red (token, POST, búsqueda) y la ORQUESTACIÓN, que es donde
//  vive el flujo de idempotencia. La orquestación recibe sus dependencias, así
//  que se prueba entera sin tocar la red.
//
//  LO QUE MEDIMOS EN DEMO EL 12-NOV Y MANDA ACÁ:
//   · El POST devuelve el `formHeaderiD` (684034), NO el folio (4141185). PF
//     espera el folio —es el "Nro Pedido" que le devolvía el API viejo— así que
//     releer después de escribir no es una precaución: sin eso el contrato no
//     es compatible.
//   · Redlink RECHAZA el documentoNumero repetido con HTTP 400 y el cuerpo
//     ["Al crear....Ya existe Documento"]. Es una red abajo de nuestra bitácora,
//     y además un dato: ese rechazo PRUEBA que el documento ya está, así que
//     sirve para resolver una duda en vez de para fallar.
//
//  LA REGLA QUE SOSTIENE TODO: la única rama que escribe es la que no tiene
//  registro previo. Ante cualquier duda se lee, nunca se reescribe.
// ============================================================================
'use strict';

const N = require('./pf-nucleo.js');
const bit = require('./pf-bitacora.js');

const TOKEN_URL = process.env.REDLINK_TOKEN_URL ||
  'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const API_BASE  = process.env.PF_REDLINK_API_BASE || process.env.REDLINK_API_BASE ||
                  'https://api.portalredtec.cl';
const CLIENT_ID = process.env.REDLINK_CLIENT_ID || 'apiportalredtec';
const PLAZO = Math.max(5000, parseInt(process.env.REDLINK_PLAZO_MS || '25000', 10) || 25000);
// Cuántos días hacia atrás mira la búsqueda por número de documento. La
// relocalización se acaba de crear, así que con poco alcanza; el margen es por
// si el reloj del servidor y el nuestro no coinciden.
const DIAS_BUSQUEDA = Math.max(1, parseInt(process.env.PF_DIAS_BUSQUEDA || '3', 10) || 3);

const CLAVES = ['PF_REDLINK_USER', 'PF_REDLINK_PASS', 'REDLINK_CLIENT_SECRET'];
function faltantes(env) {
  const e = env || process.env;
  return CLAVES.filter(function (k) { return !e[k]; });
}

let _tok = null;
async function token() {
  if (_tok && Date.now() < _tok.vence) return _tok.valor;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: process.env.REDLINK_CLIENT_SECRET || '',
      grant_type: 'password', scope: 'openid',
      username: process.env.PF_REDLINK_USER || '', password: process.env.PF_REDLINK_PASS || ''
    }),
    signal: AbortSignal.timeout(PLAZO)
  });
  if (!r.ok) throw new Error('No se pudo autenticar contra Redlink (HTTP ' + r.status + ')');
  const j = await r.json();
  if (!j.access_token) throw new Error('El token vino sin access_token');
  _tok = { valor: j.access_token, vence: Date.now() + ((j.expires_in || 60) - 15) * 1000 };
  return _tok.valor;
}

async function pedir(ruta, opciones) {
  const o = Object.assign({}, opciones || {});
  o.headers = Object.assign({ Authorization: 'Bearer ' + (await token()), Accept: 'application/json' },
                            o.headers || {});
  o.signal = AbortSignal.timeout(PLAZO);
  const r = await fetch(API_BASE + ruta, o);
  const texto = await r.text().catch(function () { return ''; });
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* no siempre viene JSON */ }
  return { http: r.status, texto: texto, json: json };
}

/* ── lo puro: leer lo que Redlink contesta ─────────────────────────────── */

// El entero del POST es el formHeaderiD, no el folio. Medido en DEMO.
function docIdDe(r) {
  if (r && r.json && typeof r.json === 'object' && !Array.isArray(r.json)) {
    return N.entero(r.json.formHeaderiD || r.json.formHeaderId);
  }
  if (r && typeof r.texto === 'string' && /^\s*\d+\s*$/.test(r.texto)) return N.entero(r.texto.trim());
  return null;
}

// "Ya existe Documento" no es sólo un error: es la PRUEBA de que el documento
// está creado. Distinguirlo permite resolver una duda en vez de fallar.
const RE_YA_EXISTE = /ya\s*existe\s*documento/i;
function yaExiste(r) {
  if (!r) return false;
  const t = (r.json !== null && r.json !== undefined) ? JSON.stringify(r.json) : String(r.texto || '');
  return RE_YA_EXISTE.test(t);
}

// El motivo que Redlink da, en una línea y acotado. El cuerpo viene como lista
// de textos; se arma uno solo para que PF lo pueda leer.
function motivoDe(r) {
  if (!r) return '';
  let t = '';
  if (Array.isArray(r.json)) t = r.json.filter(function (x) { return typeof x === 'string'; }).join(' · ');
  else if (r.json && typeof r.json === 'object') t = String(r.json.mensaje || r.json.message || r.json.error || '');
  if (!t) t = String(r.texto || '');
  return N.texto(t, 300);
}

/* ── la red, envuelta ──────────────────────────────────────────────────── */

const us = (iso) => { const x = String(iso).split('-'); return x[1] + '-' + x[2] + '-' + x[0]; };

async function bodegasDe(bpId, p) {
  const r = await (p || pedir)('/api/Bodega/cliente/' + encodeURIComponent(bpId), { method: 'GET' });
  if (r.http !== 200 || !Array.isArray(r.json)) {
    throw new Error('No se pudo leer el maestro de bodegas (HTTP ' + r.http + ')');
  }
  return r.json;
}

async function crear(cuerpo, p) {
  const r = await (p || pedir)('/api/FormHeader', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
  });
  return { http: r.http, docId: docIdDe(r), yaExiste: yaExiste(r), motivo: motivoDe(r),
           ok: r.http === 200 || r.http === 201 };
}

// La MISMA operación sirve para verificar lo que se escribió y para resolver
// una duda. Por eso es una sola y corre siempre, no sólo cuando algo falla.
async function buscarPorDocumento(bpId, documentoNumero, p) {
  const hasta = new Date();
  const desde = new Date(Date.now() - DIAS_BUSQUEDA * 86400000);
  const r = await (p || pedir)('/api/FormHeader/historico/' + encodeURIComponent(bpId) +
    '?fechainicio=' + us(desde.toISOString().slice(0, 10)) +
    '&fechafin=' + us(hasta.toISOString().slice(0, 10)), { method: 'GET' });
  if (r.http !== 200 || !Array.isArray(r.json)) {
    throw new Error('No se pudo buscar el documento en Redlink (HTTP ' + r.http + ')');
  }
  const hall = r.json.filter(function (x) {
    return String(x && x.documentoNumero) === String(documentoNumero);
  });
  if (!hall.length) return null;
  const x = hall[0];
  return { folio: N.entero(x.folio), docId: N.entero(x.formHeaderiD),
           etapa: N.texto(x.formMetapaNombre, 80), cuantos: hall.length };
}

/* ── LA ORQUESTACIÓN ───────────────────────────────────────────────────── */

const resp = (http, estado, extra) => Object.assign({ http: http, estado: estado }, extra || {});

async function procesar(cuerpo, identidad, deps) {
  const d = Object.assign({
    bodegas: bodegasDe, crear: crear, buscar: buscarPorDocumento,
    leerEstado: bit.leerEstado, registrar: bit.registrar
  }, deps || {});

  const p = N.normalizar(cuerpo);

  let bodegas;
  try { bodegas = await d.bodegas(identidad.bpId); }
  catch (e) {
    return resp(503, 'no-disponible',
      { dice: 'no se pudo verificar el maestro de bodegas en Redlink; no se escribió nada' });
  }

  const v = N.validar(p, identidad, bodegas);
  if (!v.ok) return resp(400, 'rechazado', { problemas: v.problemas, avisos: v.avisos });

  const llave = N.llaveDe(identidad.bpId, p.documentoId, p.documentoNumero);
  const huella = N.huellaDe(p);

  let previo;
  try { previo = await d.leerEstado(llave); }
  catch (e) {
    // No saber qué hay NO autoriza a escribir.
    return resp(503, 'no-disponible',
      { dice: 'no se pudo consultar el registro de idempotencia; no se escribió nada' });
  }

  const dec = N.decidir(previo, p);
  if (dec.accion === 'conflicto') {
    return resp(409, 'conflicto', { dice: dec.motivo, avisos: v.avisos });
  }
  if (dec.accion === 'devolver') {
    return resp(200, 'ya-existia',
      { nroPedido: previo.folio, docId: previo.docId, repetido: true,
        dice: dec.motivo, avisos: v.avisos });
  }

  // Un intento anterior quedó sin respuesta: se MIRA, no se reescribe.
  if (dec.accion === 'resolver') {
    let hall = null;
    try { hall = await d.buscar(identidad.bpId, p.documentoNumero); }
    catch (e) {
      await d.registrar({ llave, estado: 'en-duda', bpId: identidad.bpId, huella,
                          quien: identidad.nombre, detalle: 'no se pudo consultar Redlink' });
      return resp(503, 'en-duda', { dice: N.dudaSinResolver(p), avisos: v.avisos });
    }
    if (hall) {
      await d.registrar({ llave, estado: 'creado', folio: hall.folio, docId: hall.docId,
                          bpId: identidad.bpId, huella, quien: identidad.nombre,
                          detalle: 'resuelto releyendo tras un intento sin respuesta' });
      return resp(200, 'ya-existia',
        { nroPedido: hall.folio, docId: hall.docId, etapa: hall.etapa, repetido: true,
          dice: 'el intento anterior sí había alcanzado a crearse', avisos: v.avisos });
    }
    // No estaba: aquel intento no escribió. Se sigue y se crea.
  }

  // Queda anotado ANTES de escribir. Si esto falla no se escribe, porque nadie
  // sabría después que lo intentamos.
  const marca = await d.registrar({ llave, estado: 'intentando', bpId: identidad.bpId,
                                    huella, quien: identidad.nombre });
  if (!marca.ok) {
    return resp(503, 'no-disponible',
      { dice: 'no se pudo anotar el intento; no se escribió nada para no arriesgar un duplicado' });
  }

  let r;
  try { r = await d.crear(N.aFormHeader(p, identidad)); }
  catch (e) {
    await d.registrar({ llave, estado: 'en-duda', bpId: identidad.bpId, huella,
                        quien: identidad.nombre, detalle: 'la escritura se cortó' });
    return resp(503, 'en-duda', { dice: N.dudaSinResolver(p), avisos: v.avisos });
  }

  // Un rechazo que NO es "ya existe" no escribió nada: se puede corregir y repetir.
  if (!r.ok && !r.yaExiste) {
    await d.registrar({ llave, estado: 'rechazado', bpId: identidad.bpId, huella,
                        quien: identidad.nombre, detalle: r.motivo });
    return resp(400, 'rechazado',
      { dice: 'Redlink no aceptó la relocalización', problemas: [r.motivo], avisos: v.avisos });
  }

  // Haya salido bien o haya dicho "ya existe", el folio sólo sale de releer: el
  // POST devuelve el formHeaderiD y PF necesita el folio.
  let hall = null;
  try { hall = await d.buscar(identidad.bpId, p.documentoNumero); }
  catch (e) { hall = null; }

  if (hall) {
    const g = await d.registrar({ llave, estado: 'creado', folio: hall.folio, docId: hall.docId,
                                  bpId: identidad.bpId, huella, quien: identidad.nombre,
                                  detalle: r.yaExiste ? 'ya existía en Redlink' : '' });
    return resp(r.yaExiste ? 200 : 201, r.yaExiste ? 'ya-existia' : 'creada',
      { nroPedido: hall.folio, docId: hall.docId, etapa: hall.etapa,
        repetido: !!r.yaExiste, avisos: v.avisos,
        registro: g.ok ? undefined : 'quedó creada pero no se pudo guardar el registro' });
  }

  // Se escribió (o ya estaba) y no lo encontramos: eso NO se reintenta solo.
  await d.registrar({ llave, estado: 'en-duda', bpId: identidad.bpId, huella,
                      quien: identidad.nombre,
                      detalle: r.yaExiste ? 'Redlink dice que ya existe pero no aparece en el histórico'
                                          : 'se escribió pero no aparece todavía' });
  return resp(503, 'en-duda', { dice: N.dudaSinResolver(p), avisos: v.avisos });
}

module.exports = { procesar, crear, buscarPorDocumento, bodegasDe, pedir, faltantes,
                   docIdDe, yaExiste, motivoDe, RE_YA_EXISTE, CLAVES, DIAS_BUSQUEDA, API_BASE };
