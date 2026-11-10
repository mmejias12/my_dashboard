// ============================================================================
//  api/shared/confirmar-escritura.js
//
//  La ESCRITURA de una confirmación de Walmart en Redlink, del lado del api.
//  Las decisiones viven en confirmar-nucleo.js, el mismo módulo que usa
//  scripts/confirmar-redlink.js. Acá sólo está la red.
//
//  Por qué un token aparte de redlink-fetch.js
//  -------------------------------------------
//  redlink-fetch.js lee con REDLINK_USER. Esto ESCRIBE, y la confirmación tiene
//  que quedar firmada por M3LinkSystem, que es otro usuario y otras
//  credenciales. Compartir el token sería firmar la confirmación con el usuario
//  de lectura, y eso no se corrige después.
//
//  UN FOLIO POR LLAMADA, a propósito
//  ---------------------------------
//  Una función de Static Web Apps se corta a los ~45 segundos. Sesenta folios
//  en un pedido no entran, y un corte a mitad dejaría la mitad confirmada sin
//  que nadie sepa cuál. Un folio por pedido significa además que cada documento
//  se relee justo antes de SU escritura: si el módulo del proveedor confirma
//  uno mientras la página recorre la lista, ese se saltea en vez de recibir un
//  segundo ajuste de inventario.
//
//  Application Settings que hacen falta (ninguna en el código):
//    REDLINK_CLIENT_SECRET      (ya está, el mismo cliente)
//    REDLINK_M3LINK_USER        M3LinkSystem
//    REDLINK_M3LINK_PASS
//    REDLINK_M3LINK_USERSID     983 (se coteja contra la API antes de escribir)
// ============================================================================
'use strict';

const N = require('./confirmar-nucleo.js');

const TOKEN_URL = process.env.REDLINK_TOKEN_URL ||
  'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const API_BASE  = process.env.REDLINK_API_BASE || 'https://api.portalredtec.cl';
const CLIENT_ID = process.env.REDLINK_CLIENT_ID || 'apiportalredtec';
const PLAZO     = Math.max(5000, parseInt(process.env.REDLINK_PLAZO_MS || '25000', 10) || 25000);

const CLAVES = ['REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'];
function faltantes() { return CLAVES.filter(k => !String(process.env[k] || '').trim()); }

// Aparte y exportado: es la línea que decide con qué usuario queda firmada la
// confirmación. Metida adentro del fetch no se puede probar sin red, y un error
// ahí no se ve hasta que alguien audita en el portal.
function cuerpoDeToken() {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: process.env.REDLINK_CLIENT_SECRET,
    grant_type: 'password',
    username: process.env.REDLINK_M3LINK_USER,
    password: process.env.REDLINK_M3LINK_PASS,
    scope: 'openid'
  });
}

let _tok = { valor: null, vence: 0 };
async function token(forzar) {
  if (!forzar && _tok.valor && Date.now() < _tok.vence) return _tok.valor;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: cuerpoDeToken(),
    signal: AbortSignal.timeout(PLAZO)
  });
  if (!r.ok) throw new Error('No se pudo autenticar como M3LinkSystem (HTTP ' + r.status + ')');
  const j = await r.json();
  if (!j.access_token) throw new Error('El token de M3LinkSystem vino sin access_token');
  _tok = { valor: j.access_token, vence: Date.now() + ((j.expires_in || 60) - 15) * 1000 };
  return _tok.valor;
}

// El cuerpo se devuelve como TEXTO, nunca reserializado: el PATCH tiene que
// recibir los mismos bytes que mandó el servidor.
async function pedir(ruta, opciones) {
  const o = Object.assign({}, opciones || {});
  o.headers = Object.assign({ Authorization: 'Bearer ' + (await token()), Accept: 'application/json' },
                            o.headers || {});
  o.signal = AbortSignal.timeout(PLAZO);
  const r = await fetch(API_BASE + ruta, o);
  let texto = '', falloCuerpo = null;
  try { texto = await r.text(); }
  catch (e) { falloCuerpo = (e && e.message) ? e.message : String(e); }
  return { status: r.status, texto: texto, falloCuerpo: falloCuerpo };
}

// La ruta la arma el núcleo, que valida el nombre de forma sincrónica: una
// validación adentro de una async se convierte en una promesa rechazada y se la
// puede tragar quien no la espere.
function rutaDeUsuario(nombre) { return N.rutaDeUsuario(nombre); }

async function idDeUsuario(nombre, pedirFn) {
  const p = pedirFn || pedir;
  const ruta = rutaDeUsuario(nombre);
  const n = String(nombre).trim();
  const r = await p(ruta, { method: 'GET' });
  if (r.status !== 200) {
    return { ok: false, id: null, nombre: '', problemas: ['HTTP ' + r.status + ' al resolver el usuario'] };
  }
  return N.interpretarUsuario(r.texto, n);
}

async function leerDocumento(id, pedirFn) {
  const p = pedirFn || pedir;
  const r = await p('/api/FormHeader/' + encodeURIComponent(id), { method: 'GET' });
  if (r.status !== 200) throw new Error('No se pudo leer el documento ' + id + ' (HTTP ' + r.status + ')');
  let doc;
  try { doc = JSON.parse(r.texto); }
  catch (e) { throw new Error('El documento ' + id + ' no vino como JSON'); }
  return doc;
}

// El id del documento a partir del folio, por el histórico de ese día. La
// página ya sabe el formHeaderiD de su propio cruce, así que el camino normal
// es que lo mande; esto es el respaldo para cuando sólo tiene el folio.
async function idDeFolio(folio, desdeIso, hastaIso, pedirFn) {
  const p = pedirFn || pedir;
  const us = (iso) => { const x = String(iso).split('-'); return x[1] + '-' + x[2] + '-' + x[0]; };
  const bp = process.env.REDLINK_BP || '433';
  const r = await p('/api/FormHeader/historico/' + bp +
                    '?fechainicio=' + us(desdeIso) + '&fechafin=' + us(hastaIso), { method: 'GET' });
  if (r.status !== 200) throw new Error('No se pudo leer el histórico (HTTP ' + r.status + ')');
  let arr;
  try { arr = JSON.parse(r.texto); } catch (e) { throw new Error('El histórico no vino como JSON'); }
  const filas = (Array.isArray(arr) ? arr : []).filter(x => String(x && x.folio) === String(folio));
  if (!filas.length) return { id: null, motivo: 'el folio no aparece en la ventana consultada' };
  if (filas.length > 1) return { id: null, motivo: 'el folio cae en ' + filas.length + ' operaciones' };
  if (!filas[0].formHeaderiD) return { id: null, motivo: 'el registro no trae formHeaderiD' };
  return { id: filas[0].formHeaderiD, motivo: '' };
}

// Confirma UNA transferencia. Devuelve siempre la misma forma, pase lo que
// pase: { estado, dice, folio, etapa, firma, ... }. `estado` es lo que la
// página mira, y son tres: 'confirmada', 'saltada' (ya estaba) y 'detener'.
//
// NUNCA devuelve el cuerpo que contestó Redlink. Lo que entra al navegador es
// lo que decidimos nosotros, no lo que llegó de afuera.
async function confirmarUna(folio, cantidad, opciones) {
  const o = opciones || {};
  const p = o.pedir || pedir;
  const leer = o.leerDocumento || ((id) => leerDocumento(id, p));
  const resp = (estado, dice, extra) => Object.assign({ estado: estado, dice: dice, folio: folio,
                                                        cantidad: cantidad }, extra || {});

  const falta = faltantes();
  if (falta.length) return resp('detener', 'el api no tiene cargadas las credenciales de escritura (' +
    falta.join(', ') + ')');

  // A nombre de quién, preguntado por nombre y cotejado con lo configurado.
  const resuelto = await idDeUsuario(N.NOMBRE_M3LINK, p)
    .catch(e => ({ ok: false, id: null, nombre: '', problemas: [(e && e.message) || String(e)] }));
  const cotejo = N.cotejarFirma(resuelto, N.USERSID_M3LINK);
  if (!cotejo.ok) return resp('detener', cotejo.dice);

  let id = o.id;
  if (!id) {
    const hoy = new Date().toISOString().slice(0, 10);
    const antes = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const r = await idDeFolio(folio, antes, hoy, p);
    if (!r.id) return resp('detener', r.motivo);
    id = r.id;
  }

  // Releído ACÁ, justo antes de su propia escritura.
  const doc = await leer(id);
  if (String(doc && doc.folio) !== String(folio)) {
    return resp('detener', 'el documento ' + id + ' es del folio ' + (doc && doc.folio) +
      ', no del ' + folio);
  }
  const c = N.clasificarEnLote(doc, cantidad, cotejo.usar, o.origen);
  if (c.accion === 'saltar') return resp('saltada', c.motivo, { etapa: N.etapaDe(doc) });
  if (c.accion === 'detener') return resp('detener', c.motivo, { etapa: N.etapaDe(doc) });

  const prep = await p(c.plan.url, { method: 'GET' });
  if (prep.falloCuerpo) return resp('detener', 'la descarga del documento preparado se cortó');
  if (prep.status !== 200) return resp('detener', 'el servidor no preparó el documento (HTTP ' + prep.status + ')');
  const rev = N.revisarPreparado(prep.texto, doc.folio, cantidad);
  if (!rev.ok) return resp('detener', 'el documento preparado no sirve: ' + rev.problemas.join(' · '));

  const res = await p('/api/FormHeader', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: prep.texto                      // los MISMOS bytes, sin reserializar
  });

  const despues = await leer(id);
  const etapa = N.etapaDe(despues);
  const v = N.veredictoDeFirma(despues, cotejo.usar);
  const vaciadas = N.coleccionesVaciadas(doc, despues);
  const problemas = [];
  if (res.status !== 200) problemas.push('el PATCH devolvió HTTP ' + res.status);
  if (!/confirmada/i.test(etapa)) problemas.push('la etapa quedó en "' + (etapa || '(vacía)') + '"');
  if (!v.ok) problemas.push(v.dice);
  if (vaciadas.length) problemas.push('se vaciaron colecciones del documento: ' + vaciadas.join(', '));
  if (problemas.length) {
    return resp('detener', problemas.join(' · '), { id: id, etapa: etapa, firma: v.dice,
                                                    vaciadas: vaciadas, http: res.status });
  }
  return resp('confirmada', 'confirmada ' + cantidad + ' · ' + etapa,
              { id: id, etapa: etapa, firma: v.dice, http: res.status });
}

module.exports = { confirmarUna, cuerpoDeToken, rutaDeUsuario, idDeUsuario, idDeFolio, leerDocumento, pedir, faltantes, CLAVES };
