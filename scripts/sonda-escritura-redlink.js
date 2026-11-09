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
// Un 404 de ruta inexistente viene sin cuerpo (o con el HTML genérico del
// servidor). Un 404 que trae un cuerpo nombrando el recurso que buscó —
// {"error":"FormHeader (0) is not found"}— dice otra cosa completamente: el
// verbo corrió, enlazó el cuerpo, fue a la base y no encontró el documento.
// Mirar sólo el número y botar el cuerpo confunde esas dos cosas, que son la
// diferencia entre "no existe la operación" y "existe y le erré al id".
function hablaDelRecurso(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t || /^<!DOCTYPE|^<html/i.test(t)) return false;
  let j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  const dicho = j && typeof j === 'object'
    ? String(j.error || j.message || j.title || j.detail || '')
    : t;
  if (!dicho) return false;
  if (/^not found$/i.test(dicho.trim())) return false;   // el genérico no cuenta
  return /\bis not found\b|\bnot found\b|no (se )?encontr/i.test(dicho) && /[A-Za-z]{3,}/.test(dicho);
}

function clasificar(status, texto) {
  const s = Number(status);
  if (s === 200 || s === 201 || s === 204) return { clave: 'sirve',          verbo: true,  dice: 'el verbo existe y aceptó el cuerpo' };
  if (s === 400 || s === 422)              return { clave: 'cuerpo-malo',    verbo: true,  dice: 'el verbo existe; el cuerpo no es el que espera' };
  if (s === 409)                           return { clave: 'estado-malo',    verbo: true,  dice: 'el verbo existe; el documento no está en estado de recibirlo' };
  if (s === 415)                           return { clave: 'tipo-malo',      verbo: true,  dice: 'el verbo existe; rechaza el Content-Type' };
  if (s === 403)                           return { clave: 'sin-permiso',    verbo: true,  dice: 'el verbo existe; este usuario no tiene el permiso' };
  if (s === 401)                           return { clave: 'no-autenticado', verbo: null,  dice: 'no hay sesión válida — no dice nada del verbo' };
  if (s === 404 && hablaDelRecurso(texto))
                                           return { clave: 'documento-no-esta', verbo: true, dice: 'el verbo CORRIÓ: enlazó el cuerpo, buscó el documento y no lo encontró. Falta el id, no la operación' };
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

// Los candidatos se arman DEVOLVIENDO el documento que el servidor entregó, no
// escribiendo campos de memoria. El servidor fue dictando el contrato de a
// pedazos, y cada paso se ganó con un error distinto:
//
//   "No Tiene Lineas de detalles"  -> el cuerpo debe traer formDdetalles
//   "Falta Cantidad a Despachar"   -> cada línea necesita 'despachado'
//   "Otro usuario Avanzo a etapa"  -> hay que mandar la etapa que leímos
//   "Object reference not set..."  -> pasó la validación y reventó DENTRO del
//                                     manejador: le falta alguna de las otras
//                                     colecciones hijas, que el código recorre
//                                     sin preguntar si vienen
//
// Por eso el cuerpo ahora es un eco completo: todos los escalares del documento
// y TODAS sus colecciones hijas, con las propiedades de navegación quitadas.
// Omitir de a un campo fue lo que nos costó cuatro vueltas.
function idDeDocumento(doc) {
  if (!doc || typeof doc !== 'object') return null;
  for (const k of ['formHeaderiD', 'formHeaderId', 'id']) {
    const v = doc[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

const esEscalar = v => v === null || ['number', 'string', 'boolean'].indexOf(typeof v) >= 0;

// Devuelve la línea tal como vino, con los escalares nada más: las propiedades
// de navegación (items, y cualquier otro objeto anidado) no son parte del
// comando, y mandarlas de vuelta sólo le da al enlazador con qué tropezar.
function lineaParaEnviar(det, despachado, recepcion) {
  const out = {};
  for (const k of Object.keys(det || {})) if (esEscalar(det[k])) out[k] = det[k];
  if (despachado != null) out.despachado = despachado;
  if (recepcion  != null) out.recepcion  = recepcion;
  return out;
}

// La cantidad a confirmar nunca puede superar lo que la línea pide: es la misma
// regla que ya validamos contra Walmart (si aceptaron más de lo despachado, se
// confirma lo despachado).
function cantidadDeLinea(det, pedida) {
  const tope = Number(det && det.cantidad);
  const n = Number(pedida);
  const hayTope = Number.isFinite(tope) && tope > 0;
  if (!Number.isFinite(n) || n <= 0) return hayTope ? tope : null;
  if (hayTope && n > tope) return tope;
  return n;
}

// Una fila cuya clave propia es 0 o nula no es una fila: es un relleno que el
// servidor arrastra. Devolvérsela le pide insertarla, y ahí revienta el guardado
// ("An error occurred while saving the entity changes"). La clave propia es el
// primer campo que termina en iD/Id.
function tieneIdentidad(fila) {
  if (!fila || typeof fila !== 'object') return false;
  const clave = Object.keys(fila).find(k => /i[dD]$/.test(k));
  if (!clave) return true;                 // sin clave reconocible, no la descarto
  const v = Number(fila[clave]);
  return Number.isFinite(v) && v > 0;
}

// El eco: escalares del encabezado + todas las colecciones hijas. Una lista que
// vino vacía se manda vacía, no se omite: omitirla es justamente lo que deja al
// manejador recorriendo un nulo.
function cuerpoEco(doc, opciones) {
  const o = opciones || {};
  const cuerpo = {};
  if (!doc || typeof doc !== 'object') return cuerpo;
  for (const k of Object.keys(doc)) if (esEscalar(doc[k])) cuerpo[k] = doc[k];
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (!Array.isArray(v)) continue;
    const filas = v.filter(x => x && typeof x === 'object' && tieneIdentidad(x));
    if (k === 'formDdetalles') {
      cuerpo[k] = filas.map(d => {
        const n = cantidadDeLinea(d, o.cantidad);
        return lineaParaEnviar(d, o.despachado ? n : null, o.recepcion ? n : null);
      });
    } else {
      cuerpo[k] = filas.map(d => lineaParaEnviar(d, null, null));
    }
  }
  cuerpo.avanzaEtapa = !!o.avanzar;
  return cuerpo;
}

function cuerposCandidatos(doc, cantidad) {
  const lista = [];
  if (idDeDocumento(doc) == null) return lista;
  const eco = (nombre, o) => lista.push({
    nombre: nombre, contentType: 'application/json',
    cuerpo: cuerpoEco(doc, Object.assign({ cantidad: cantidad }, o))
  });

  // 1. Lo que de verdad queremos.
  eco('eco completo · despachado + recepcion + avanzaEtapa', { despachado: true, recepcion: true, avanzar: true });
  // 2. Igual, por si la etapa avanza sola al quedar la recepción completa.
  eco('eco completo · despachado + recepcion, sin avanzar',  { despachado: true, recepcion: true, avanzar: false });
  // 3. Sólo despachado, por si "Por Confirmar" exige primero el despacho.
  eco('eco completo · sólo despachado + avanzaEtapa',        { despachado: true, recepcion: false, avanzar: true });
  // 4. Testigo: el documento devuelto tal cual. Si éste también es aceptado,
  //    un 200 no prueba que se haya confirmado nada.
  eco('testigo · eco completo sin cambios',                  { despachado: false, recepcion: false, avanzar: false });
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

// La API contesta la creación con el id pelado en el cuerpo —684029, sin
// comillas ni objeto— y no con un {"id": ...}. Buscar sólo campos de objeto
// deja tirado justo el dato por el que se hizo la llamada.
// Ojo con formId: ése es el tipo de formulario (1 = Emisión), no el documento.
function idCreado(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  let j = null;
  try { j = JSON.parse(t); } catch (e) { return null; }
  if (typeof j === 'number' && Number.isFinite(j)) return j;
  if (j && typeof j === 'object') {
    for (const k of ['id', 'formHeaderId', 'formHeaderiD', 'nroPedido', 'pedido']) {
      const v = j[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
    }
  }
  return null;
}

/* ---- maestros: descubrir las llaves, no adivinarlas ---------------------- */

// Adivinar que el id se llama "id" y caer en undefined fue exactamente lo que
// pasó la primera vez. Acá se mira qué llaves trae la lista y se elige con una
// regla explícita; además el que llama imprime la primera fila cruda, para que
// la salida sirva aunque esta detección falle.
function detectarCampos(filas) {
  const prim = (filas || []).find(f => f && typeof f === 'object' && !Array.isArray(f));
  if (!prim) return { campos: [], campoId: null, campoNombre: null };
  const campos = Object.keys(prim);
  const esNumero = k => typeof prim[k] === 'number' || (/^\d+$/.test(String(prim[k] == null ? '' : prim[k])) && prim[k] !== '');

  let campoId = campos.find(k => k.toLowerCase() === 'id' && esNumero(k));
  if (!campoId) campoId = campos.find(k => /id$/i.test(k) && esNumero(k));
  if (!campoId) campoId = campos.find(k => esNumero(k)) || null;

  const esTexto = k => typeof prim[k] === 'string';
  // Primero los nombres que se llaman como uno espera; si no hay ninguno
  // —Redlink usa cardName y bodegaCliente—, cualquier texto que no sea el id
  // sirve más que no mostrar nada.
  let campoNombre = campos.find(k => /(nombre|descripcion|descripción|razon|razón|glosa|titulo|título|cardname)/i.test(k) && esTexto(k));
  if (!campoNombre) campoNombre = campos.find(k => k !== campoId && esTexto(k)) || null;
  return { campos: campos, campoId: campoId, campoNombre: campoNombre };
}

/* ---- armado del documento de prueba ------------------------------------- */

const BP_REDTEC = 433;
const TOPE_CANTIDAD = 540;          // lo dice la planilla del proveedor
const OBS_PRUEBA = 'PRUEBA M3LINK - sonda de escritura (DEMO)';

// Se arma a partir de la planilla "API Portal Redtec.xlsx", que es el contrato
// entregado. Valida antes de mandar y NOMBRA lo que falta: un 400 del servidor
// no dice cuál campo es, y adivinar de a uno cuesta una vuelta cada vez.
function armarPayload(o) {
  o = o || {};
  const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };
  const form = n(o.form) || 1;
  if (form !== 1 && form !== 6)
    throw new Error('Esta sonda sólo arma formId 1 (Emisión) y 6 (Transferencia); llegó ' + form);

  const cliente       = n(o.cliente);
  const servicio      = n(o.servicio);
  const usuario       = n(o.usuario);
  const bodegaOrigen  = n(o.bodegaOrigen);
  const bodegaDestino = n(o.bodegaDestino);
  const cantidad      = n(o.cantidad) || 1;

  const falta = [];
  if (!cliente)       falta.push('--cliente (bpId)');
  if (!servicio)      falta.push('--servicio (servicioId)');
  if (!usuario)       falta.push('--usuario (usuarioIngresoId)');
  if (!bodegaOrigen)  falta.push('--bodega-origen');
  if (!bodegaDestino) falta.push('--bodega-destino');
  if (form === 6) {
    if (!n(o.destino))        falta.push('--destino (bpDestinoId del retail)');
    if (!n(o.documento))      falta.push('--documento (documentoId)');
    if (!n(o.documentoNumero))falta.push('--documento-numero');
  }
  if (falta.length) throw new Error('Falta: ' + falta.join(', '));
  if (cantidad < 1 || cantidad > TOPE_CANTIDAD)
    throw new Error('La cantidad tiene que estar entre 1 y ' + TOPE_CANTIDAD + '; llegó ' + cantidad);

  const hoy = (o.fecha && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) ? o.fecha : new Date().toISOString().slice(0, 10);

  const cuerpo = {
    formId: form,
    bpId: cliente,
    servicioId: servicio,
    usuarioIngresoId: usuario,
    fechaRequerida: hoy,
    observacionOrigen: OBS_PRUEBA,
    bpOrigenId: form === 1 ? BP_REDTEC : cliente,
    bodegaOrigenId: bodegaOrigen,
    bpDestinoId: form === 1 ? cliente : n(o.destino),
    bodegaDestinoId: bodegaDestino,
    formDdetalles: [{ itemsId: 1, cantidad: cantidad }]
  };

  if (form === 6) {
    cuerpo.documentoId = n(o.documento);
    cuerpo.documentoNumero = n(o.documentoNumero);
    cuerpo.formDtransportes = [{
      cita: String(o.cita || '').trim() || '00000000',
      citaFecha: hoy,
      patenteCliente: 'XXXX00',
      nombreCliente: 'PRUEBA M3LINK'
    }];
  }

  return cuerpo;
}

// Los campos del encabezado se listan solos, pero los nombres que importan
// —los de las líneas de detalle— viven en las colecciones hijas, y ésas no se
// ven si uno sólo imprime Object.keys del documento. Listar el encabezado y
// callar los hijos fue lo que nos dejó inventando "cantidadConfirmada".
function hijosDelDocumento(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const out = [];
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (Array.isArray(v)) {
      const prim = v.find(x => x && typeof x === 'object');
      out.push({ nombre: k, tipo: 'lista', largo: v.length, campos: prim ? Object.keys(prim) : [], muestra: prim || null });
    } else if (v && typeof v === 'object') {
      out.push({ nombre: k, tipo: 'objeto', largo: null, campos: Object.keys(v), muestra: v });
    }
  }
  return out;
}

/* ---- lo que el servidor dicta en sus errores ---------------------------- */

// Un 400 con mensajes de validación NO es "no concluye nada": es el contrato
// hablando. Decir "el testigo contestó igual, así que no señala ningún campo"
// es cierto sobre la FORMA del cuerpo y falso sobre el CONTENIDO, porque los
// mensajes nombran lo que falta. Esta función los saca a la luz.
function pistaDeContrato(texto) {
  const t = String(texto == null ? '' : texto).trim();
  const out = { comando: null, mensajes: [] };
  if (!t) return out;

  // ASP.NET nombra la clase a la que no pudo convertir el cuerpo: ése es el
  // nombre del contrato que hay que pedir o reproducir.
  const m = t.match(/[A-Za-z0-9_.]*\.Commands\.[A-Za-z0-9_]+/);
  if (m) out.comando = m[0];

  let j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  if (Array.isArray(j)) {
    out.mensajes = j.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean);
  } else if (j && typeof j === 'object' && j.errors && typeof j.errors === 'object') {
    for (const k of Object.keys(j.errors)) {
      const v = j.errors[k];
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.mensajes.push((k === '$' ? '' : k + ': ') + x.trim());
    }
  }
  return out;
}

// Junta las pistas de todos los intentos sin repetir, conservando el orden en
// que aparecieron.
// Un "Object reference not set" no es un cuerpo mal formado: es el manejador
// reventando adentro. Decirlo como "el cuerpo no es el que espera" manda a
// revisar los campos que uno mandó, cuando el problema es uno que NO mandó.
function esFallaInterna(texto) {
  return /object reference not set|nullreference|sequence contains no elements|index .*out of range/i
    .test(String(texto == null ? '' : texto));
}

// La lectura final es lo que la persona va a creer, así que se arma aparte y
// se prueba. Lo que importa es no confundir tres cosas distintas: el verbo no
// existe, el cuerpo no cuadra, y el cuerpo cuadró pero el manejador reventó.
function lecturaDeIntentos(vistos) {
  const v = vistos || [];
  const out = [];
  const sirven = v.filter(x => x && x.cl && x.cl.clave === 'sirve');
  if (sirven.length) {
    for (const x of sirven) out.push(x.c.nombre + ' fue aceptado.');
    out.push('Relee el documento antes de cantar victoria: que haya avanzado de etapa no garantiza que el resto de los campos siga en pie.');
    return out;
  }
  if (v.some(x => esFallaInterna(x && x.texto))) {
    out.push('El cuerpo pasó la validación y la ejecución llegó al manejador, que reventó con un nulo.');
    out.push('No es un campo mal mandado: es uno que falta, y el servidor no dice cuál.');
    return out;
  }
  if (v.some(x => x && x.cl && x.cl.verbo === true)) {
    out.push('PATCH existe y el cuerpo llegó a enlazarse: lo que falló es la validación, no la operación.');
    return out;
  }
  if (v.length) out.push('La ruta no aceptó PATCH. La confirmación no pasa por acá.');
  return out;
}

function juntarPistas(textos) {
  const vistos = Object.create(null);
  const mensajes = [];
  let comando = null;
  for (const t of (textos || [])) {
    const p = pistaDeContrato(t);
    if (!comando && p.comando) comando = p.comando;
    for (const m of p.mensajes) if (!vistos[m]) { vistos[m] = true; mensajes.push(m); }
  }
  return { comando: comando, mensajes: mensajes };
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

// Un barrido de ids tiene que tener tope: sin él, un --hasta mal tipeado son
// diez mil peticiones contra el servidor de otro.
const TOPE_BUSQUEDA = 200;
function rangoBusqueda(desde, hasta, tope) {
  const t = Math.max(1, parseInt(tope, 10) || TOPE_BUSQUEDA);
  const d = Math.max(1, parseInt(desde, 10) || 1);
  let h = parseInt(hasta, 10);
  if (!Number.isFinite(h) || h < d) h = d + t - 1;
  if (h - d + 1 > t) h = d + t - 1;
  return { desde: d, hasta: h, recortado: (parseInt(hasta, 10) || 0) > h };
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
  const cl = clasificar(res.status, res.texto);
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
  const a = { modo: null, id: null, cantidad: null, si: false, bp: '433', dias: '7', todo: false, plazo: null, desde: null, hasta: null,
                 form: '1', cliente: null, servicio: null, usuario: null,
                 bodegaOrigen: null, bodegaDestino: null, destino: null,
                 documento: null, documentoNumero: null, cita: null };
  for (const x of (argv || [])) {
    if (x === '--catalogo') a.modo = 'catalogo';
    else if (x === '--leer') a.modo = 'leer';
    else if (x === '--verbo') a.modo = 'verbo';
    else if (x === '--buscar') a.modo = 'buscar';
    else if (x === '--maestros') a.modo = 'maestros';
    else if (x.indexOf('--form=') === 0) a.form = x.slice(7);
    else if (x.indexOf('--cliente=') === 0) a.cliente = x.slice(10);
    else if (x.indexOf('--servicio=') === 0) a.servicio = x.slice(11);
    else if (x.indexOf('--usuario=') === 0) a.usuario = x.slice(10);
    else if (x.indexOf('--bodega-origen=') === 0) a.bodegaOrigen = x.slice(16);
    else if (x.indexOf('--bodega-destino=') === 0) a.bodegaDestino = x.slice(17);
    else if (x.indexOf('--destino=') === 0) a.destino = x.slice(10);
    else if (x.indexOf('--documento=') === 0) a.documento = x.slice(12);
    else if (x.indexOf('--documento-numero=') === 0) a.documentoNumero = x.slice(19);
    else if (x.indexOf('--cita=') === 0) a.cita = x.slice(7);
    else if (x.indexOf('--desde=') === 0) a.desde = x.slice(8);
    else if (x.indexOf('--hasta=') === 0) a.hasta = x.slice(8);
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
    const cl = clasificar(res.status, res.texto);
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

  if (a.modo === 'maestros') {
    const cli = a.cliente || '499';
    const form = a.form || '1';
    const fuentes = [
      ['Clientes',                 '/api/BusinessPartner/clientesocio/0'],
      ['Retails',                  '/api/BusinessPartner/retail'],
      ['Bodegas de emisión (Redtec)', '/api/Bodega/emision'],
      ['Bodegas del cliente ' + cli, '/api/Bodega/cliente/' + encodeURIComponent(cli)],
      ['Servicios cliente ' + cli + ' / formulario ' + form,
       '/api/Servicio/cliente/' + encodeURIComponent(cli) + '/formulario/' + encodeURIComponent(form)],
      ['Documentos',               '/api/Documento']
    ];
    for (const [titulo, ruta] of fuentes) {
      let r;
      try { r = await pedir(ruta, { method: 'GET', headers: auth }); }
      catch (e) { console.log('\n' + titulo + ': no se pudo (' + describirError(e).split('\n')[0] + ')'); continue; }
      console.log('\n' + titulo + '  ·  ' + ruta + '  ->  HTTP ' + r.status);
      if (r.status !== 200) { console.log('  ' + enmascarar(r.texto).slice(0, 200)); continue; }
      let j; try { j = JSON.parse(r.texto); } catch (e) { j = null; }
      if (!Array.isArray(j)) { console.log('  (no vino una lista) ' + enmascarar(String(r.texto)).slice(0, 160)); continue; }
      const d = detectarCampos(j);
      console.log('  ' + j.length + ' opciones' + (j.length > 15 ? ' (muestro 15)' : ''));
      console.log('  campos: ' + (d.campos.length ? d.campos.join(', ') : '(la lista vino vacía)'));
      if (j.length) console.log('  primera fila cruda: ' + enmascarar(JSON.stringify(j[0])).slice(0, 300));
      if (!d.campoId) {
        console.log('  No reconocí cuál campo es el id. Mira la fila cruda de arriba.');
      } else {
        for (const it of j.slice(0, 15)) {
          const id  = it ? it[d.campoId] : null;
          const nom = (it && d.campoNombre) ? it[d.campoNombre] : '';
          console.log('    ' + String(id) + '  ' + String(nom == null ? '' : nom).slice(0, 60));
        }
        console.log('  (id = ' + d.campoId + (d.campoNombre ? ', nombre = ' + d.campoNombre : '') + ')');
      }
    }
    console.log('');
    return 0;
  }

  if (a.modo === 'crear') {
    let cuerpo;
    try { cuerpo = armarPayload(a); }
    catch (e) {
      console.log('\n' + e.message);
      console.log('Corre --maestros para ver qué ids existen hoy en DEMO.\n');
      return 2;
    }
    console.log('\nPOST /api/FormHeader  (crear en DEMO)');
    console.log('  ' + JSON.stringify(cuerpo));
    if (!a.si) { console.log('\nNo mandé nada: agrega --si para crearlo.\n'); return 0; }
    const r = await pedir('/api/FormHeader', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify(cuerpo)
    });
    console.log('\n  HTTP ' + r.status);
    const txt = enmascarar(r.texto || '').trim();
    if (txt) console.log('  respuesta: ' + txt.slice(0, 500).replace(/\s+/g, ' '));
    const id = idCreado(r.texto);
    if (r.status >= 200 && r.status < 300 && id != null) {
      console.log('\nCreado con id ' + id + '. Ahora:');
      console.log('  node scripts\\sonda-escritura-redlink.js --leer --id=' + id);
      console.log('  node scripts\\sonda-escritura-redlink.js --confirmar=' + id + ' --cantidad=' + (a.cantidad || 1) + '\n');
      return 0;
    }
    if (r.status >= 200 && r.status < 300) {
      console.log('\nAceptado, pero no reconocí el id en la respuesta. Está arriba, en crudo.\n');
      return 0;
    }
    console.log('\nNo se creó. ' + clasificar(r.status, r.texto).dice + '\n');
    return 2;
  }

  if (a.modo === 'buscar') {
    const r = rangoBusqueda(a.desde, a.hasta);
    console.log('\nBuscando documentos en DEMO entre el id ' + r.desde + ' y el ' + r.hasta + ' (sólo GET, no modifica nada)');
    if (r.recortado) console.log('El rango pedido se recortó al tope de ' + TOPE_BUSQUEDA + ' ids.');
    const hallados = [];
    for (let n = r.desde; n <= r.hasta; n++) {
      const res = await pedir('/api/FormHeader/' + n, { method: 'GET', headers: auth });
      if (res.status === 200) { hallados.push(n); if (hallados.length >= 5) break; }
    }
    console.log('');
    if (!hallados.length) {
      console.log('Ninguno en ese rango. Prueba otro con --desde y --hasta.\n');
      return 2;
    }
    console.log('Existen: ' + hallados.join(', '));
    console.log('Mira uno con:  node scripts\\sonda-escritura-redlink.js --leer --id=' + hallados[0] + '\n');
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
      let j;
      try { j = JSON.parse(r.texto); }
      catch (e) {
        // Decir "no es JSON" y callar lo que vino es botar justo el dato que
        // explica por qué. Un 200 con cuerpo vacío y un 200 con una página de
        // login son cosas distintas y se distinguen mirándolas.
        const tipo = (r.headers && r.headers.get) ? (r.headers.get('content-type') || '(sin content-type)') : '(sin cabeceras)';
        const crudo = String(r.texto == null ? '' : r.texto);
        console.log('La respuesta no es JSON.');
        console.log('  content-type: ' + tipo);
        console.log('  largo: ' + crudo.length + ' caracteres');
        console.log('  primeros bytes: ' + (crudo.length ? JSON.stringify(enmascarar(crudo).slice(0, 200)) : '(vacío)'));
        return 2;
      }
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
    const hijos = hijosDelDocumento(doc);
    if (hijos.length) {
      console.log('\nColecciones y objetos hijos (acá viven los nombres de las líneas):');
      for (const h of hijos) {
        const cab = '  ' + h.nombre + ' · ' + h.tipo + (h.tipo === 'lista' ? ' de ' + h.largo : '');
        if (!h.campos.length) { console.log(cab + ' · (vacío)'); continue; }
        console.log(cab);
        console.log('    campos: ' + h.campos.join(', '));
        console.log('    muestra: ' + enmascarar(JSON.stringify(h.muestra)).slice(0, 400));
      }
    }
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
      const cl = imprimirIntento(c, res);
      vistos.push({ c: c, cl: cl, texto: res.texto });
      // Si uno funcionó, el documento YA cambió: seguir mandando los demás
      // sería escribir sobre un documento que está en otro estado, y lo que
      // contestaran no diría nada del cuerpo sino del estado nuevo.
      if (cl.clave === 'sirve') { console.log('  Paré acá: el documento ya cambió.\n'); break; }
    }
    const pistas = juntarPistas(vistos.map(v => v.texto));
    console.log('Lectura:');
    for (const linea of lecturaDeIntentos(vistos)) console.log('  · ' + linea);
    if (pistas.comando) {
      console.log('\nEl servidor nombró el contrato que espera:');
      console.log('  ' + pistas.comando);
    }
    if (pistas.mensajes.length) {
      console.log('\nLo que el servidor pide, en sus palabras:');
      for (const m of pistas.mensajes) console.log('  · ' + m);
      console.log('\nEso no es ruido: cada línea nombra algo que al cuerpo le falta.');
    }
    console.log('');
    return 0;
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
  clasificar, hablaDelRecurso, rangoBusqueda, TOPE_BUSQUEDA,
  idCreado, idDeDocumento, lineaParaEnviar, cantidadDeLinea, cuerpoEco, tieneIdentidad, pistaDeContrato, juntarPistas, esFallaInterna, lecturaDeIntentos, hijosDelDocumento, detectarCampos, armarPayload, BP_REDTEC, TOPE_CANTIDAD, OBS_PRUEBA, leerErrorToken, describirError, conHost, leerFalloRed, aUS, ventana, camposDeEstado, asimetrias, cuerposCandidatos, verbosDe, leerArgs
};
