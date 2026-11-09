#!/usr/bin/env node
// ============================================================================
//  scripts/sonda-escritura-redlink.js
//
//  Qué pregunta esta sonda
//  -----------------------
//  La documentación que nos entregó el proveedor (Api Holux) dice, textual:
//  «Se proporcionará sólo la creación de documentos, método POST». Pero el
//  servidor contesta a OPTIONS que /api/FormHeader acepta GET, PATCH, POST y
//  PUT — y PATCH no aparece en NINGÚN otro controlador. Confirmar una
//  transferencia es modificar un documento que ya existe, no crear uno nuevo,
//  así que ese PATCH es el único candidato a la pieza que nos falta para el
//  proyecto Walmart. Esta sonda averigua si lo es, y con qué cuerpo.
//
//  Lo que NO hace
//  --------------
//  No toca productivo. El host está clavado a apidemo.portalredtec.cl y no hay
//  bandera para cambiarlo: si algún día hay que escribir en productivo, eso se
//  decide editando este archivo a conciencia, no pasando un flag de apuro.
//  No envía nada que modifique sin --si; sin esa bandera imprime exactamente
//  lo que mandaría y se detiene.
//  No lee ni imprime credenciales: salen de variables de entorno y el token
//  nunca aparece en la salida.
//
//  Uso
//  ---
//    node scripts/sonda-escritura-redlink.js --catalogo
//        Barrido OPTIONS. No necesita credenciales. Imprime qué verbo acepta
//        cada ruta y señala las asimetrías (un verbo que una ruta tiene y sus
//        hermanas no).
//
//    node scripts/sonda-escritura-redlink.js --leer [--id=N]
//        Pide token y mira la FORMA de un documento: qué campos tiene y cuáles
//        huelen a estado de confirmación.
//
//    node scripts/sonda-escritura-redlink.js --crear [--si]
//        Crea en DEMO una transferencia de prueba, para tener un documento
//        propio sobre el cual probar. Sin --si sólo muestra el cuerpo.
//
//    node scripts/sonda-escritura-redlink.js --confirmar=N [--cantidad=K] [--si]
//        Prueba los cuerpos candidatos de PATCH sobre el documento N.
//
//  Variables de entorno (se cargan afuera; la sonda nunca las imprime):
//    REDLINK_DEMO_CLIENT_SECRET · REDLINK_DEMO_USER · REDLINK_DEMO_PASS
// ============================================================================
'use strict';

const HOST_DEMO  = 'apidemo.portalredtec.cl';
const API_BASE   = 'https://' + HOST_DEMO;
const TOKEN_URL  = 'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const CLIENT_ID  = 'apiportalredtec';

const VARS = ['REDLINK_DEMO_CLIENT_SECRET', 'REDLINK_DEMO_USER', 'REDLINK_DEMO_PASS'];

// Sin plazo, cada error cuesta cinco minutos de espera: ése es el valor por
// omisión de undici para los encabezados. Treinta segundos alcanzan de sobra
// para cualquier respuesta sana y convierten un error en algo que se puede
// repetir diez veces seguidas.
let PLAZO = 30000;

/* ---------------------------------------------------------------- guardas */

// El host está clavado. Esta función existe para que la guarda sea una cosa
// que se puede probar, no un comentario de buena intención.
function esDemo(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return false; }
  return u.protocol === 'https:' && u.hostname.toLowerCase() === HOST_DEMO;
}

// Un valor con <corchetes> es un marcador que alguien pegó literal. Ya nos
// pasó: el error que sale después («Invalid URL», «ENOTFOUND os_storage_conn»)
// no dice nada de la causa, así que lo atajamos acá con el nombre a la vista.
function pintaDeMarcador(v) {
  const s = String(v == null ? '' : v);
  return /[<>]/.test(s) || /^(tu|su|el)[ _-]/i.test(s) || /\.\.\./.test(s);
}

function faltantes(env) {
  env = env || process.env;
  const out = [];
  for (const k of VARS) {
    const v = env[k];
    if (!v || !String(v).trim()) out.push(k + ' (no está)');
    else if (pintaDeMarcador(v)) out.push(k + ' (parece un marcador pegado literal, no un valor)');
  }
  return out;
}

// Nada de lo que imprime esta sonda debe llevar el token. Se enmascara al
// salir, no al armar, para que un camino nuevo no se escape por olvido.
function enmascarar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/("?(?:access_token|refresh_token|id_token|client_secret|password)"?\s*[:=]\s*"?)[^"&,\s}]+/gi, '$1***');
}

/* ------------------------------------------------- lectura de respuestas  */

// El sentido de toda la sonda está en esta tabla. Un 400 NO es un fracaso:
// significa que la ruta aceptó el verbo y discutió el cuerpo, que es
// exactamente lo que queríamos saber. Un 405 sí es un no.
function clasificar(status) {
  const s = Number(status);
  if (s === 200 || s === 201 || s === 204) return { clave: 'sirve',          verbo: true,  dice: 'el verbo existe y aceptó el cuerpo' };
  if (s === 400 || s === 422)              return { clave: 'cuerpo-malo',    verbo: true,  dice: 'el verbo existe; el cuerpo no es el que espera' };
  if (s === 409)                           return { clave: 'estado-malo',    verbo: true,  dice: 'el verbo existe; el documento no está en estado de recibirlo' };
  if (s === 415)                           return { clave: 'tipo-malo',      verbo: true,  dice: 'el verbo existe; rechaza el Content-Type' };
  if (s === 403)                           return { clave: 'sin-permiso',    verbo: true,  dice: 'el verbo existe; este usuario no tiene el permiso' };
  if (s === 401)                           return { clave: 'no-autenticado', verbo: null,  dice: 'no hay sesión válida — no dice nada del verbo' };
  if (s === 404)                           return { clave: 'no-existe',      verbo: null,  dice: 'no hay ruta ahí, o el documento no existe' };
  if (s === 405)                           return { clave: 'no-permitido',   verbo: false, dice: 'la ruta existe pero NO acepta este verbo' };
  if (s >= 500)                            return { clave: 'error-servidor', verbo: null,  dice: 'falló el servidor' };
  return { clave: 'otro', verbo: null, dice: 'respuesta no prevista' };
}

const RE_ESTADO = /(confirm|estado|etapa|autoriz|aprob|cantidad|fecha)/i;

// Qué campos de un documento huelen a "estado de confirmación". No adivina
// cuál es: los nombra para que la decisión la tome alguien mirando.
function camposDeEstado(doc) {
  const out = [];
  const ver = (obj, prefijo) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const ruta = prefijo ? prefijo + '.' + k : k;
      if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object') ver(v[0], ruta + '[0]'); continue; }
      if (v && typeof v === 'object') { ver(v, ruta); continue; }
      if (RE_ESTADO.test(k)) out.push({ campo: ruta, valor: v });
    }
  };
  ver(doc, '');
  return out;
}

// La asimetría es el hallazgo: todos los controladores son CRUD parejos y uno
// solo tiene un verbo de más. Esta función la busca sin que haya que mirar a
// ojo una tabla de veinte filas.
function asimetrias(mapa) {
  const rutas = Object.keys(mapa);
  const cuenta = {};
  for (const r of rutas) for (const v of (mapa[r] || [])) cuenta[v] = (cuenta[v] || 0) + 1;
  const out = [];
  for (const v of Object.keys(cuenta)) {
    if (cuenta[v] === 1 && rutas.length > 1) {
      out.push({ verbo: v, ruta: rutas.find(r => (mapa[r] || []).indexOf(v) >= 0) });
    }
  }
  return out.sort((a, b) => a.verbo.localeCompare(b.verbo));
}

/* ------------------------------------------------- cuerpos candidatos     */

// ASP.NET Core tiene dos PATCH distintos y se distinguen por el Content-Type:
// JsonPatch (una lista de operaciones, application/json-patch+json) y merge
// patch (un objeto parcial, application/json). Probar uno solo y concluir
// sería el mismo error de siempre: confundir "no contestó" con "no existe".
function cuerposCandidatos(doc, cantidad) {
  const id  = doc && (doc.id != null ? doc.id : doc.formHeaderId);
  const det = (doc && Array.isArray(doc.formDdetalles) && doc.formDdetalles[0]) || null;
  const n   = Number(cantidad);
  const cant = Number.isFinite(n) && n > 0 ? n : null;
  const lista = [];

  if (cant != null) {
    lista.push({
      nombre: 'merge · cantidadConfirmada en el encabezado',
      contentType: 'application/json',
      cuerpo: { id: id, cantidadConfirmada: cant }
    });
    lista.push({
      nombre: 'json-patch · replace /cantidadConfirmada',
      contentType: 'application/json-patch+json',
      cuerpo: [{ op: 'replace', path: '/cantidadConfirmada', value: cant }]
    });
    if (det) {
      lista.push({
        nombre: 'merge · cantidadConfirmada en el detalle',
        contentType: 'application/json',
        cuerpo: { id: id, formDdetalles: [{ id: det.id, cantidad: det.cantidad, cantidadConfirmada: cant }] }
      });
    }
  }

  for (const campo of ['estadoId', 'estado', 'etapaOperacionId']) {
    if (doc && Object.prototype.hasOwnProperty.call(doc, campo)) {
      lista.push({
        nombre: 'json-patch · replace /' + campo,
        contentType: 'application/json-patch+json',
        cuerpo: [{ op: 'replace', path: '/' + campo, value: doc[campo] }]
      });
    }
  }

  // Un cuerpo vacío no confirma nada y sirve de testigo: si éste también
  // contesta 400, el 400 de los otros no prueba que el campo sea el correcto.
  lista.push({
    nombre: 'testigo · cuerpo vacío',
    contentType: 'application/json',
    cuerpo: {}
  });

  return lista;
}

// undici tira un TypeError seco, «fetch failed», y mete el motivo de verdad en
// e.cause — a veces dos niveles abajo. Imprimir sólo el mensaje de arriba deja
// al que mira sin saber si fue DNS, certificado, proxy o timeout. Es el mismo
// defecto que tiene Emisiones_Detalle.html cuando se queda con r.status y bota
// el detail del servidor.
function describirError(e) {
  const partes = [];
  let x = e, n = 0;
  while (x && n++ < 6) {
    const msg = (x && x.message) ? x.message : String(x);
    const cod = (x && x.code) ? ' [' + x.code + ']' : '';
    partes.push(msg + cod);
    x = x && x.cause;
  }
  return partes.join('\n  causa: ');
}

// Un fallo de red sin decir contra qué host se intentó obliga a adivinar. Esto
// pega el host al error en el momento en que se pierde, no después.
function conHost(e, url) {
  // El mensaje sólo nombra el host: la cadena la recorre describirError una
  // sola vez, al imprimir. Si la describiera acá además, cada causa saldría
  // dos veces.
  const nuevo = new Error('No se pudo hablar con ' + url);
  nuevo.cause = e;
  return nuevo;
}

// Un timeout de encabezados NO es lo mismo que un host caído: la conexión se
// aceptó y el servidor se quedó pensando. En una ruta de colección eso suele
// significar que está tratando de devolver la tabla entera.
function leerFalloRed(e) {
  const t = describirError(e);
  if (/UND_ERR_HEADERS_TIMEOUT|HeadersTimeout|TimeoutError|ABORT_ERR/i.test(t))
    return 'El servidor aceptó la conexión y no contestó dentro del plazo. En una ruta de colección casi siempre es que intenta devolver la tabla completa: pide un documento puntual con --id, o sube el plazo con --timeout.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(t))
    return 'No se resolvió el nombre del host. Es DNS o red, no credenciales.';
  if (/ECONNREFUSED/i.test(t))
    return 'El host existe pero rechazó la conexión en ese puerto.';
  if (/ECONNRESET|EPIPE/i.test(t))
    return 'La conexión se cortó a mitad de camino.';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(t))
    return 'Falló la validación del certificado: suele ser un proxy de la empresa interceptando TLS.';
  return null;
}

// Keycloak distingue entre "el cliente no me cuadra" y "el usuario no me
// cuadra", y son dos arreglos completamente distintos. Decir sólo "HTTP 401"
// manda a revisar la contraseña cuando el problema es el secreto del cliente.
function leerErrorToken(status, texto) {
  const t = String(texto == null ? '' : texto);
  if (/unauthorized_client|invalid_client/i.test(t))
    return { causa: 'cliente', dice: 'Keycloak rechaza el CLIENTE, no al usuario: el client_secret no sirve — mal copiado, o rotado desde que se armó la colección. El client_id es ' + CLIENT_ID + '.' };
  if (/invalid_grant|invalid user credentials/i.test(t))
    return { causa: 'usuario', dice: 'El cliente pasa; lo que no pasa es el usuario o su clave.' };
  if (/unsupported_grant_type/i.test(t))
    return { causa: 'flujo', dice: 'El cliente existe pero no tiene habilitado el flujo de password.' };
  if (Number(status) >= 500)
    return { causa: 'servidor', dice: 'Falló el servidor de token; no dice nada de las credenciales.' };
  return { causa: 'otra', dice: 'Respuesta no prevista del servidor de token.' };
}

/* ------------------------------------------------- red                    */

let _tok = null;
async function token(fetchFn) {
  if (_tok) return _tok;
  const falta = faltantes();
  if (falta.length) {
    throw new Error('Faltan variables de entorno: ' + falta.join(', ') +
      '. Cárgalas en tu sesión; la sonda nunca las imprime ni las pide por pantalla.');
  }
  let r;
  try {
  r = await (fetchFn || fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: process.env.REDLINK_DEMO_CLIENT_SECRET,
      grant_type: 'password',
      username: process.env.REDLINK_DEMO_USER,
      password: process.env.REDLINK_DEMO_PASS,
      scope: 'openid'
    })
  });
  } catch (e) { throw conHost(e, TOKEN_URL); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = leerErrorToken(r.status, t);
    throw new Error('No se pudo obtener el token de DEMO (HTTP ' + r.status + ')\n  ' + e.dice +
      '\n  respuesta: ' + enmascarar(t).slice(0, 160));
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('El token vino sin access_token');
  _tok = j.access_token;
  return _tok;
}

async function pedir(ruta, opciones, fetchFn) {
  const url = API_BASE + ruta;
  if (!esDemo(url)) throw new Error('Esta sonda sólo habla con ' + HOST_DEMO + '; se intentó ' + url);
  const o = Object.assign({}, opciones || {});
  if (!o.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) o.signal = AbortSignal.timeout(PLAZO);
  let r;
  try { r = await (fetchFn || fetch)(url, o); }
  catch (e) { throw conHost(e, url); }
  const texto = await r.text().catch(() => '');
  return { status: r.status, texto: texto, headers: r.headers };
}

/* ---- fechas: Redlink espera MM-dd-yyyy, no ISO --------------------------- */
const dos = n => String(n).padStart(2, '0');
function aUS(f) { return dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate()) + '-' + f.getUTCFullYear(); }
function ventana(dias) {
  const d = Math.max(1, parseInt(dias, 10) || 7);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - (d - 1) * 86400000);
  return { desde: aUS(desde), hasta: aUS(hasta) };
}

/* ------------------------------------------------- pasos                  */

// Las rutas van de a pares: la colección y su /{id}. Si se mira una sola
// forma, DELETE aparece como "asimetría" nada más porque no tiene con quién
// compararse, y el hallazgo real se pierde entre el ruido.
const RUTAS_CATALOGO = [
  '/api/FormHeader', '/api/Form', '/api/FormDdetalle', '/api/Transporte',
  '/api/Item', '/api/Bodega', '/api/BusinessPartner', '/api/Camion',
  '/api/Chofer', '/api/Documento', '/api/Servicio',
  '/api/FormHeader/1', '/api/Form/1', '/api/FormDdetalle/1',
  '/api/Transporte/1', '/api/Item/1', '/api/Documento/1',
  '/api/FormHeader/historico/433'
];

function verbosDe(headers) {
  const h = headers && typeof headers.get === 'function'
    ? (headers.get('allow') || headers.get('access-control-allow-methods') || '')
    : '';
  return String(h).split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
}

async function pasoCatalogo(fetchFn) {
  const mapa = {};
  for (const ruta of RUTAS_CATALOGO) {
    try {
      const r = await pedir(ruta, { method: 'OPTIONS' }, fetchFn);
      mapa[ruta] = verbosDe(r.headers);
    } catch (e) { mapa[ruta] = []; }
  }
  return mapa;
}

/* ------------------------------------------------- salida                 */

function imprimirCatalogo(mapa) {
  console.log('\nQué verbo acepta cada ruta (OPTIONS, sin credenciales, no modifica nada)\n');
  const ancho = Math.max.apply(null, Object.keys(mapa).map(s => s.length));
  for (const ruta of Object.keys(mapa)) {
    const v = mapa[ruta];
    console.log('  ' + ruta.padEnd(ancho) + '  ' + (v.length ? v.join(', ') : '(sin respuesta)'));
  }
  const asim = asimetrias(mapa);
  console.log('');
  if (!asim.length) {
    console.log('  No hay ningún verbo que aparezca en una sola ruta.');
  } else {
    console.log('  Verbos que aparecen en UNA sola ruta — ahí está lo interesante:');
    for (const a of asim) console.log('    ' + a.verbo + '  ·  ' + a.ruta);
  }
}

function imprimirIntento(c, res) {
  const cl = clasificar(res.status);
  console.log('  ' + c.nombre);
  console.log('    Content-Type: ' + c.contentType);
  console.log('    HTTP ' + res.status + '  ->  ' + cl.clave + ' · ' + cl.dice);
  const cuerpo = enmascarar(res.texto || '').trim();
  if (cuerpo) console.log('    respuesta: ' + cuerpo.slice(0, 300).replace(/\s+/g, ' '));
  console.log('');
  return cl;
}

/* ------------------------------------------------- principal              */

function leerArgs(argv) {
  const a = { modo: null, id: null, cantidad: null, si: false, bp: '433', dias: '7', todo: false, plazo: null };
  for (const x of (argv || [])) {
    if (x === '--catalogo') a.modo = 'catalogo';
    else if (x === '--leer') a.modo = 'leer';
    else if (x === '--verbo') a.modo = 'verbo';
    else if (x === '--crear') a.modo = 'crear';
    else if (x.indexOf('--confirmar=') === 0) { a.modo = 'confirmar'; a.id = x.slice(12); }
    else if (x.indexOf('--id=') === 0) a.id = x.slice(5);
    else if (x.indexOf('--cantidad=') === 0) a.cantidad = x.slice(11);
    else if (x.indexOf('--bp=') === 0) a.bp = x.slice(5);
    else if (x.indexOf('--dias=') === 0) a.dias = x.slice(7);
    else if (x.indexOf('--timeout=') === 0) a.plazo = x.slice(10);
    else if (x === '--todo') a.todo = true;
    else if (x === '--si') a.si = true;
  }
  if (!a.modo) a.modo = 'catalogo';
  return a;
}

async function principal() {
  const a = leerArgs(process.argv.slice(2));
  if (a.plazo) { const n = parseInt(a.plazo, 10); if (n > 0) PLAZO = n * 1000; }
  console.log('Sonda de escritura en Redlink · ' + HOST_DEMO + ' (DEMO — nunca productivo)');

  if (a.modo === 'catalogo') {
    imprimirCatalogo(await pasoCatalogo());
    console.log('\nUn 405 dice que la ruta no acepta ese verbo. Que lo acepte no dice todavía');
    console.log('qué cuerpo espera: eso lo averigua --confirmar.\n');
    return 0;
  }

  const t = await token();
  const auth = { Authorization: 'Bearer ' + t, Accept: 'application/json' };

  if (a.modo === 'verbo') {
    // No necesita ningún documento: un cuerpo vacío no puede identificar uno,
    // así que no puede modificar nada. Lo único que se mira es si la ruta
    // discute el cuerpo (el verbo existe) o lo rechaza de plano (no existe).
    if (!a.si) {
      console.log('\nMandaría PATCH /api/FormHeader con el cuerpo {} y nada más.');
      console.log('Un cuerpo vacío no identifica ningún documento, así que no puede modificar nada.');
      console.log('Agrega --si para que lo haga.\n');
      return 0;
    }
    const res = await pedir('/api/FormHeader', {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: '{}'
    });
    const cl = clasificar(res.status);
    console.log('\nPATCH /api/FormHeader  {}  ->  HTTP ' + res.status);
    console.log('  ' + cl.clave + ' · ' + cl.dice);
    const cuerpo = enmascarar(res.texto || '').trim();
    if (cuerpo) console.log('  respuesta: ' + cuerpo.slice(0, 400).replace(/\s+/g, ' '));
    console.log('');
    if (cl.verbo === true)  console.log('Lectura: el verbo existe. Falta el contrato del cuerpo.\n');
    if (cl.verbo === false) console.log('Lectura: la ruta no acepta PATCH. La confirmación no pasa por acá.\n');
    if (cl.verbo === null)  console.log('Lectura: no concluye nada todavía.\n');
    return 0;
  }

  if (a.modo === 'leer') {
    if (!a.id && !a.todo) {
      const v = ventana(a.dias);
      const ruta = '/api/FormHeader/historico/' + encodeURIComponent(a.bp) +
                   '?fechainicio=' + v.desde + '&fechafin=' + v.hasta;
      const r = await pedir(ruta, { method: 'GET', headers: auth });
      console.log('\nGET ' + ruta + '  ->  HTTP ' + r.status);
      if (r.status !== 200) { console.log(enmascarar(r.texto).slice(0, 400)); return 2; }
      let j; try { j = JSON.parse(r.texto); } catch (e) { console.log('La respuesta no es JSON.'); return 2; }
      const filas = Array.isArray(j) ? j : [j];
      console.log('Registros en los últimos ' + v.desde + ' a ' + v.hasta + ': ' + filas.length);
      if (!filas.length) { console.log('DEMO no tiene movimiento en esa ventana. Prueba con --dias mayor o con --bp de otro cliente.\n'); return 2; }
      const doc = filas[0];
      console.log('\nCampos del primer registro (' + Object.keys(doc).length + '):');
      console.log('  ' + Object.keys(doc).join(', '));
      const est = camposDeEstado(doc);
      console.log('\nCampos que huelen a estado de confirmación:');
      if (!est.length) console.log('  ninguno — eso ya es un dato.');
      for (const e of est) console.log('  ' + e.campo + ' = ' + JSON.stringify(e.valor));
      console.log('');
      return 0;
    }
    if (a.todo) console.log('\nAviso: --todo pide la colección entera y es justo lo que se cuelga. Usa --timeout si hace falta.');
    const ruta = a.id ? '/api/FormHeader/' + encodeURIComponent(a.id) : '/api/FormHeader';
    const r = await pedir(ruta, { method: 'GET', headers: auth });
    console.log('\nGET ' + ruta + '  ->  HTTP ' + r.status);
    if (r.status !== 200) { console.log(enmascarar(r.texto).slice(0, 400)); return 2; }
    let j; try { j = JSON.parse(r.texto); } catch (e) { console.log('La respuesta no es JSON.'); return 2; }
    const doc = Array.isArray(j) ? j[0] : j;
    if (!doc) { console.log('Vino vacío: no hay documentos que mirar en DEMO.'); return 2; }
    console.log('\nCampos del documento (' + Object.keys(doc).length + '):');
    console.log('  ' + Object.keys(doc).join(', '));
    const est = camposDeEstado(doc);
    console.log('\nCampos que huelen a estado de confirmación:');
    if (!est.length) console.log('  ninguno — eso ya es un dato.');
    for (const e of est) console.log('  ' + e.campo + ' = ' + JSON.stringify(e.valor));
    console.log('');
    return 0;
  }

  if (a.modo === 'confirmar') {
    if (!a.id) { console.log('Falta el documento: --confirmar=<id>'); return 2; }
    const r = await pedir('/api/FormHeader/' + encodeURIComponent(a.id), { method: 'GET', headers: auth });
    if (r.status !== 200) { console.log('No se pudo leer el documento ' + a.id + ': HTTP ' + r.status); return 2; }
    let doc; try { doc = JSON.parse(r.texto); } catch (e) { console.log('El documento no vino como JSON.'); return 2; }
    const lista = cuerposCandidatos(doc, a.cantidad);
    console.log('\nDocumento ' + a.id + ' · ' + lista.length + ' cuerpos candidatos\n');
    if (!a.si) {
      for (const c of lista) {
        console.log('  ' + c.nombre + '  [' + c.contentType + ']');
        console.log('    ' + JSON.stringify(c.cuerpo));
      }
      console.log('\nEsto es lo que mandaría. No mandé nada: agrega --si para que lo haga.\n');
      return 0;
    }
    const vistos = [];
    for (const c of lista) {
      const res = await pedir('/api/FormHeader', {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': c.contentType }, auth),
        body: JSON.stringify(c.cuerpo)
      });
      vistos.push({ c: c, cl: imprimirIntento(c, res) });
    }
    const sirven = vistos.filter(v => v.cl.clave === 'sirve');
    const testigo = vistos.find(v => /testigo/.test(v.c.nombre));
    console.log('Lectura:');
    if (sirven.length) {
      for (const v of sirven) console.log('  · ' + v.c.nombre + ' fue aceptado. Verificar en el portal que el documento quedó confirmado.');
    } else if (vistos.some(v => v.cl.verbo === true)) {
      console.log('  · PATCH existe en la ruta, pero ninguno de estos cuerpos es el que espera.');
      if (testigo && testigo.cl.verbo === true) {
        console.log('    El testigo vacío contestó igual, así que el error no señala ningún campo en particular.');
      }
      console.log('    Lo que falta es el contrato del cuerpo: eso se pide, no se adivina.');
    } else {
      console.log('  · La ruta no aceptó PATCH. La confirmación no pasa por acá.');
    }
    console.log('');
    return 0;
  }

  if (a.modo === 'crear') {
    console.log('\n--crear todavía no arma el cuerpo solo: necesita cliente, bodegas y servicio de DEMO.');
    console.log('Usa --leer para ver un documento que ya exista y --confirmar=<id> sobre ése.\n');
    return 2;
  }

  return 0;
}

// No se llama a process.exit(): en Windows, salir mientras undici todavía tiene
// un socket vivo revienta con «Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)» de libuv. Se fija el código y se deja que el proceso
// termine solo cuando no queda nada pendiente.
if (require.main === module) {
  principal().then(c => { process.exitCode = c || 0; }).catch(e => {
    const lectura = leerFalloRed(e);
    console.error('\n' + enmascarar(describirError(e)));
    if (lectura) console.error('\n  ' + lectura);
    console.error('');
    process.exitCode = 2;
  });
}

module.exports = {
  HOST_DEMO, VARS, esDemo, pintaDeMarcador, faltantes, enmascarar,
  clasificar, leerErrorToken, describirError, conHost, leerFalloRed, aUS, ventana, camposDeEstado, asimetrias, cuerposCandidatos, verbosDe, leerArgs
};
