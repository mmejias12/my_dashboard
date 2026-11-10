#!/usr/bin/env node
// ============================================================================
//  scripts/confirmar-redlink.js
//
//  CONFIRMA UNA transferencia en Redlink PRODUCTIVO. Escribe de verdad, y esa
//  escritura dispara un ajuste de inventario en SAP que no se deshace.
//
//  Cómo se confirma de verdad
//  --------------------------
//  Son DOS pasos, y el orden importa:
//
//    1. GET  /api/FormHeader/ConfirmarTransferencia/Folio/{folio}/recibido/{n}
//            /original/{marca}/usuarioconfirma/{usersiD}
//       El servidor arma el documento confirmado y lo devuelve.
//    2. PATCH /api/FormHeader  con ESE cuerpo, tal cual vino.
//
//  Durante ocho intentos armamos el cuerpo nosotros y el servidor devolvió 400
//  las ocho veces. No era el avanzaEtapa ni la firma ni el entorno: era que a
//  ese PATCH hay que devolverle el cuerpo que él mismo preparó. La ruta salió
//  de la macro Confirmacion_Ver2.xlsm que el proveedor mandó usar cuando dejó
//  de contestar por la API (10-nov-2026).
//
//  Por qué es de a una
//  -------------------
//  Toma UN folio y UNA cantidad. Sin lotes, sin archivos, sin bucles. La
//  escritura dispara un ajuste de inventario en SAP que no se deshace, así que
//  la primera prueba se hace sobre una transferencia que YA correspondía
//  confirmar por esa misma cantidad: si funciona, se hizo lo correcto; si
//  falla, no pasó nada. Cuando el contrato esté probado, el lote se construye
//  aparte y a conciencia.
//
//  La firma
//  --------
//  La confirmación queda escrita con el usuario que la ejecuta, y esa firma es
//  la trazabilidad que alguien va a mirar en la pantalla de transacciones. Por
//  eso exige las credenciales de M3LinkSystem y se niega a usar el usuario de
//  lectura: confirmar con el usuario equivocado no se corrige después.
//
//  Uso
//  ---
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --preparar
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si
//    node scripts/confirmar-redlink.js --productivo --usuario=M3LinkSystem
//
//  Sin --productivo no hace nada: la bandera está para que nadie llegue acá
//  por inercia. Sin --si ni --preparar muestra el plan y se detiene sin tocar
//  el servidor. Con --preparar pide el documento y lo muestra, sin mandarlo.
//
//  Variables de entorno:
//    REDLINK_CLIENT_SECRET        (el mismo cliente apiportalredtec)
//    REDLINK_M3LINK_USER          (M3LinkSystem)
//    REDLINK_M3LINK_PASS
//    REDLINK_USER                 (sólo para comprobar que no son el mismo)
//    REDLINK_M3LINK_USERSID       (983; se coteja con la API antes de escribir)
//    REDLINK_ORIGEN               (la marca de procedencia; M3LINK)
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const sonda = require(path.join(__dirname, 'sonda-escritura-redlink.js'));
// El lector del CSV es el MISMO que usa verificar-listado-walmart.js. Dos
// parsers del mismo contrato se separan el día que alguien arregla uno.
const listado = require(path.join(__dirname, 'verificar-listado-walmart.js'));
// El núcleo de la confirmación vive bajo api/ porque Static Web Apps despliega
// SÓLO esa carpeta como functions app: una función no puede requerir nada de
// scripts/. La función HTTP y este script usan EL MISMO módulo, no dos copias.
// Las decisiones están ahí; acá queda la red, el disco y la consola.
const N = require(path.join(__dirname, '..', 'api', 'shared', 'confirmar-nucleo.js'));
N.usarMascara(sonda.enmascarar);
const { ETAPAS_CONFIRMABLES, etapaDe, etapaConfirmable, esConfirmada,
        USERSID_M3LINK, NOMBRE_M3LINK, ORIGEN, urlConfirmar, revisarPreparado,
        interpretarUsuario, cotejarFirma, firmaDe, veredictoDeFirma,
        planDeConfirmacion, clasificarEnLote, diferencias, recorteValor,
        COLECCIONES_HIJAS, coleccionesVaciadas, rutaDeUsuario, RE_NOMBRE_USUARIO } = N;

const HOST = 'api.portalredtec.cl';
const API  = 'https://' + HOST;
const TOKEN_URL = 'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const CLIENT_ID = 'apiportalredtec';
const BP_REDTEC = '433';
let PLAZO = 60000;
function fijarPlazo(seg) { const n = parseInt(seg, 10); if (Number.isFinite(n) && n > 0) PLAZO = n * 1000; }

/* ------------------------------------------------- credenciales ---------- */

// Confirmar con el usuario de lectura dejaría la traza a nombre de quien no
// confirmó. Es un error que no se ve hasta que alguien audita, y para entonces
// ya no se puede corregir.
function revisarCredenciales(env) {
  env = env || process.env;
  const problemas = [];
  // Se LEE con el usuario de lectura y se ESCRIBE con M3LinkSystem. Son dos
  // alcances distintos y no hay razón para suponer que el de escritura puede
  // leer el histórico: suponerlo fue lo que hizo fallar la primera corrida.
  ['REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS',
   'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'].forEach(function (k) {
    const v = env[k];
    if (!v || !String(v).trim()) problemas.push('falta ' + k);
    else if (/[<>]/.test(String(v))) problemas.push(k + ' quedó con un marcador pegado literal');
  });
  const u = String(env.REDLINK_M3LINK_USER || '').trim();
  const lectura = String(env.REDLINK_USER || '').trim();
  if (u && lectura && u.toLowerCase() === lectura.toLowerCase()) {
    problemas.push('REDLINK_M3LINK_USER es el MISMO usuario de lectura: la confirmación ' +
                   'quedaría firmada por quien no confirmó');
  }
  return problemas;
}

/* ------------------------------------------------- el plan --------------- */

// El circuito es 37 -> 43 (Pendiente Adjuntar Respaldo) -> 44 (Pendiente de
// Confirmación) -> 46 (Confirmada). La tabla FormMetapa marca con
// Confirmar=true solo la 44, y durante dias se trabajo suponiendo que la 43
// habia que respetarla.
//
// RESUELTO el 9-nov-2026 por Marcelo: en las confirmaciones MASIVAS de Walmart
// no corresponde adjuntar respaldo. Ese paso existe para que la gente de
// logistica no tenga que ir documento por documento; por el camino masivo se
// confirma de una. O sea la 43 TAMBIEN es confirmable en este circuito.
//
// Esto no es "cualquier etapa": la lista es explicita y corta. La 46 y la 49
// ya estan confirmadas y la 47 esta anulada; ninguna de esas se toca.
const CAMPOS_ESTADO = ['formMetapaId', 'avanzaEtapa', 'fechaConfirmacion', 'confirmacionVeces', 'usuarioConfirmaId'];

// Un 200 no prueba nada: lo que prueba es el documento releído. Se comparan
// los campos de estado y los de la línea, y se muestran los que cambiaron.
function comparar(antes, despues) {
  const out = [];
  const det = (d) => ((d && d.formDdetalles && d.formDdetalles[0]) || {});
  CAMPOS_ESTADO.forEach(function (k) {
    const a = antes ? antes[k] : undefined, b = despues ? despues[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: k, antes: a, despues: b });
  });
  ['despachado', 'recepcion'].forEach(function (k) {
    const a = det(antes)[k], b = det(despues)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: 'detalle.' + k, antes: a, despues: b });
  });
  const ea = (antes && antes.formMetapa || {}).nombre, ed = (despues && despues.formMetapa || {}).nombre;
  if (ea !== ed) out.push({ campo: 'etapa', antes: ea, despues: ed });
  return out;
}

function leerArgs(argv) {
  const a = { productivo: false, folio: null, cantidad: null, si: false, dias: '30', quien: null,
              usuario: null, preparar: false, tramo: '7', timeout: null,
              candidatos: false, cuantos: '5', diasExplicito: false, origen: null,
              lote: null, tope: null, pausa: '200' };
  for (const x of (argv || [])) {
    if (x === '--productivo') a.productivo = true;
    else if (x === '--si') a.si = true;
    else if (x.indexOf('--folio=') === 0) a.folio = x.slice(8);
    else if (x.indexOf('--cantidad=') === 0) a.cantidad = x.slice(11);
    else if (x.indexOf('--dias=') === 0) { a.dias = x.slice(7); a.diasExplicito = true; }
    else if (x.indexOf('--cuantos=') === 0) a.cuantos = x.slice(10);
    // La marca de procedencia, por línea de comandos. El 10-nov el preparador
    // devolvió el documento SIN TOCAR con la marca M3LINK, y la planilla usa
    // CONFIRMAVER2: poder cambiar sólo eso convierte la sospecha en una
    // medición de una variable.
    else if (x.indexOf('--origen=') === 0) a.origen = x.slice(9);
    else if (x.indexOf('--lote=') === 0) a.lote = x.slice(7);
    else if (x.indexOf('--tope=') === 0) a.tope = x.slice(7);
    else if (x.indexOf('--pausa=') === 0) a.pausa = x.slice(8);
    // --candidatos no escribe nada: busca transferencias de Walmart que hoy
    // SÍ corresponda confirmar y arma la línea de comando para cada una.
    else if (x === '--candidatos') a.candidatos = true;
    else if (x.indexOf('--tramo=') === 0) a.tramo = x.slice(8);
    else if (x.indexOf('--timeout=') === 0) a.timeout = x.slice(10);
    else if (x.indexOf('--quien=') === 0) { a.quien = x.slice(8); a.folio = a.folio || a.quien; }
    else if (x.indexOf('--usuario=') === 0) a.usuario = x.slice(10);
    // --preparar pide el documento al servidor y se detiene antes del PATCH.
    // Es el único paso que permite MIRAR el cuerpo que se va a mandar antes de
    // mandarlo, y por eso es el primer disparo recomendado sobre un folio real.
    else if (x === '--preparar') a.preparar = true;
  }
  return a;
}

async function idDeUsuario(nombre, pedirFn) {
  const p = pedirFn || pedir;
  const ruta = rutaDeUsuario(nombre);
  const n = String(nombre).trim();
  const r = await p(ruta, { method: 'GET' }, 'escritura');
  if (r.status !== 200) {
    return { ok: false, id: null, nombre: '', problemas: ['HTTP ' + r.status + ' al resolver "' + n + '"' +
      (r.texto ? ' · ' + sonda.enmascarar(String(r.texto)).slice(0, 200) : '')] };
  }
  return interpretarUsuario(r.texto, n);
}

// ---- el lote (sólo del lado del script: el archivo es cosa de la consola) --
//
// Tope de seguridad. No es paternalismo: un CSV con 5.000 filas significa que
// algo se rompió aguas arriba, y la forma de que eso se vea es que el lote se
// niegue a correr en vez de confirmar 5.000 transferencias en silencio. Subirlo
// es un argumento explícito en la línea de comandos.
const TOPE_LOTE = 50;

function revisarLote(filas, malas, tope) {
  const problemas = [];
  const t = Math.max(1, parseInt(tope, 10) || TOPE_LOTE);
  // Una línea mal formada NO se saltea. Un CSV con basura adentro quiere decir
  // que el que lo generó falló, y entonces las filas buenas tampoco son de
  // fiar: las dos cosas salieron del mismo lugar.
  (malas || []).forEach(function (m) {
    problemas.push('línea ' + m.linea + ' no se entiende: ' + m.texto);
  });
  const vistos = Object.create(null), repetidos = [];
  (filas || []).forEach(function (f) {
    const k = String(f.folio);
    if (vistos[k]) { if (repetidos.indexOf(k) < 0) repetidos.push(k); }
    vistos[k] = (vistos[k] || 0) + 1;
  });
  // El mismo folio dos veces en el archivo son DOS ajustes de inventario.
  if (repetidos.length) {
    problemas.push('folios repetidos en el archivo: ' + repetidos.join(', '));
  }
  if (!(filas || []).length) problemas.push('el archivo no trae ninguna fila utilizable');
  else if (filas.length > t) {
    problemas.push('el archivo trae ' + filas.length + ' filas y el tope es ' + t +
      '. Si de verdad son todas, pídelo con --tope=' + filas.length);
  }
  return { ok: !problemas.length, problemas: problemas, cuantas: (filas || []).length, tope: t };
}

// Folio -> filas del histórico, en UNA pasada. Buscar folio por folio sobre
// 3.866 operaciones son 135 recorridos del mismo arreglo.
function indicePorFolio(ops) {
  const ix = Object.create(null);
  (ops || []).forEach(function (o) {
    if (!o || typeof o !== 'object') return;
    const f = String(o.folio == null ? '' : o.folio).trim();
    if (!f) return;
    if (!ix[f]) ix[f] = [];
    ix[f].push(o);
  });
  return ix;
}

// El id del documento para un folio, o por qué no se puede escribir.
function idDeFolio(ix, folio) {
  const filas = (ix || Object.create(null))[String(folio)] || [];
  if (!filas.length) return { id: null, motivo: 'no aparece en la ventana leída del histórico' };
  if (filas.length > 1) return { id: null, motivo: 'el folio cae en ' + filas.length + ' operaciones' };
  const id = filas[0].formHeaderiD;
  if (!id) return { id: null, motivo: 'el registro no trae formHeaderiD' };
  return { id: id, motivo: '' };
}

function resumenDeLote(resultados) {
  const r = { confirmadas: 0, saltadas: 0, detenido: null, pendientes: 0 };
  (resultados || []).forEach(function (x) {
    if (x.accion === 'confirmar') r.confirmadas++;
    else if (x.accion === 'saltar') r.saltadas++;
    // Hay a lo sumo UNO: el bucle del lote corta en el primero.
    else if (x.accion === 'detener') r.detenido = x;
  });
  return r;
}

const dormir = (ms) => new Promise(function (ok) { setTimeout(ok, Math.max(0, ms || 0)); });

// ---- buscar transferencias que hoy corresponda confirmar ----------------
//
// Las filas del histórico crudo y las del /proxy/ops no usan las mismas
// etiquetas para lo mismo. Adivinar UNA sola deja la búsqueda muda: no
// encuentra nada y no dice por qué, que es la peor de las dos respuestas.
const CAMPOS_FILA = {
  folio:    ['folio', 'nroPedido'],
  etapa:    ['etapaOperacion', 'formMetapaNombre', 'etapa', 'nombreEtapa', 'etapaNombre'],
  destino:  ['bpDestinoNombre', 'destino', 'clienteDestino', 'bpDestino', 'destinoNombre'],
  servicio: ['operacion', 'servicio', 'formNombre', 'nombreForm', 'formDescripcion'],
  id:       ['formHeaderiD', 'formHeaderId', 'id']
};
function campoFila(fila, cual) {
  const nombres = CAMPOS_FILA[cual] || [];
  for (let i = 0; i < nombres.length; i++) {
    const v = fila ? fila[nombres[i]] : undefined;
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

// El filtro es el mismo que el del plan, pero sobre la fila del listado: hacia
// Walmart y en una de las dos etapas confirmables. Se cuenta aparte cuántas
// filas no traían etapa, para distinguir "no hay candidatas" de "no supe leer
// el listado" — son dos problemas distintos y mandan a mirar lados distintos.
function candidatosDe(filas) {
  const out = [];
  let sinEtapa = 0;
  (filas || []).forEach(function (f) {
    if (!f || typeof f !== 'object') return;
    const etapa = campoFila(f, 'etapa');
    if (etapa === null) { sinEtapa++; return; }
    if (!/walmart/i.test(String(campoFila(f, 'destino') || ''))) return;
    if (!ETAPAS_CONFIRMABLES.some(re => re.test(String(etapa)))) return;
    out.push({ folio: campoFila(f, 'folio'), id: campoFila(f, 'id'), etapa: String(etapa),
               destino: String(campoFila(f, 'destino') || ''),
               servicio: String(campoFila(f, 'servicio') || '') });
  });
  return { candidatos: out, sinEtapa: sinEtapa, filas: (filas || []).length };
}

/* ------------------------------------------------- red ------------------- */

const USUARIOS = {
  lectura:   { u: 'REDLINK_USER',        p: 'REDLINK_PASS',        quien: 'el usuario de lectura' },
  escritura: { u: 'REDLINK_M3LINK_USER', p: 'REDLINK_M3LINK_PASS', quien: 'M3LinkSystem' }
};
const _tok = {};
async function token(tipo) {
  const cfg = USUARIOS[tipo];
  if (!cfg) throw new Error('tipo de usuario desconocido: ' + tipo);
  if (_tok[tipo]) return _tok[tipo];
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: process.env.REDLINK_CLIENT_SECRET,
      grant_type: 'password', username: process.env[cfg.u],
      password: process.env[cfg.p], scope: 'openid'
    }),
    signal: AbortSignal.timeout(PLAZO)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('No se pudo autenticar como ' + cfg.quien + ' (HTTP ' + r.status + ') ' +
      sonda.leerErrorToken(r.status, t).dice);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('El token de ' + cfg.quien + ' vino sin access_token');
  _tok[tipo] = j.access_token;
  return _tok[tipo];
}

async function pedir(ruta, opciones, tipo) {
  const url = API + ruta;
  const o = Object.assign({}, opciones || {});
  o.headers = Object.assign({ Authorization: 'Bearer ' + (await token(tipo || 'lectura')), Accept: 'application/json' }, o.headers || {});
  if (!o.signal) o.signal = AbortSignal.timeout(PLAZO);
  let r;
  try { r = await fetch(url, o); }
  catch (e) { throw sonda.conHost(e, url); }
  return Object.assign({ status: r.status }, await leerCuerpo(r));
}

// El cuerpo se lee aparte y su falla NO se tapa. Un `.catch(() => '')` acá
// convierte un corte a mitad de descarga en "respondió vacío", que es una
// afirmación distinta y manda a buscar el problema al lado equivocado.
async function leerCuerpo(r) {
  const cab = (n) => (r && r.headers && r.headers.get) ? r.headers.get(n) : null;
  let texto = '', falloCuerpo = null;
  try { texto = await r.text(); }
  catch (e) { falloCuerpo = (e && e.message) ? e.message : String(e); }
  return { texto: texto, falloCuerpo: falloCuerpo,
           largoDeclarado: cab('content-length'), tipo: cab('content-type') };
}

// Qué decir cuando el histórico no trae un JSON utilizable. Separa las tres
// cosas que hasta ahora se contaban como una sola: se cortó la descarga, el
// servidor contestó vacío de verdad, o contestó algo que no es JSON.
function porQueNoHayJson(r) {
  if (r.falloCuerpo) {
    return ['la descarga se CORTÓ a mitad de camino: ' + r.falloCuerpo,
            'no es que no haya datos — no se alcanzó a leer la respuesta',
            'prueba con --dias menor (una ventana más chica baja el tamaño)'];
  }
  const declarado = r.largoDeclarado;
  if (!String(r.texto || '').length) {
    const out = ['el servidor contestó HTTP ' + r.status + ' con el cuerpo vacío'];
    if (declarado && declarado !== '0') {
      out.push('pero declaró content-length ' + declarado + ': el cuerpo se perdió, no vino vacío');
    } else {
      out.push('y declaró content-length ' + (declarado === null ? '(sin dato)' : declarado));
      out.push('suele ser que el usuario de lectura no alcanza a ese BP, o que no hay datos en la ventana');
    }
    return out;
  }
  return ['la respuesta no es JSON (content-type ' + (r.tipo || '(sin dato)') + ')',
          'primeros bytes: ' + sonda.enmascarar(String(r.texto)).slice(0, 200)];
}

const atras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const dos = (n) => String(n).padStart(2, '0');
function aUS(iso) { const p = iso.split('-'); return p[1] + '-' + p[2] + '-' + p[0]; }

// El folio es el número del área; el id del documento es interno. Para escribir
// hace falta el id, así que primero se busca el folio en el histórico.
// Los tramos, del MÁS NUEVO al más viejo. Un folio que se está confirmando hoy
// suele ser de los últimos días, así que buscando desde el presente se encuentra
// en el primer o segundo tramo y no hace falta bajar el resto.
//
// Por qué por tramos y no de una: 31 días del BP 433 son ~17.500 operaciones con
// el registro crudo completo, y esa descarga se corta por timeout. Medido el
// 9-nov-2026: 31 días cortaban, 7 días (4.746 operaciones) entraban sin
// problema. El código del m3link que sí funciona también trocea, en 31 días,
// pero corre dentro de Azure y no sobre la conexión de una oficina.
function tramosHaciaAtras(dias, paso) {
  const total = Math.max(1, parseInt(dias, 10) || 30);
  const p = Math.max(1, parseInt(paso, 10) || 7);
  const out = [];
  for (let fin = 0; fin < total; fin += p) {
    const ini = Math.min(fin + p - 1, total - 1);
    out.push({ desde: atras(ini), hasta: atras(fin) });
  }
  return out;
}

// Un corte por tiempo, venga por donde venga: la petición puede abortar al
// conectar (fetch tira) o a mitad de la descarga del cuerpo (falloCuerpo).
const RE_TIEMPO = /abort|timeout|tiempo|ETIMEDOUT|ECONNRESET|terminated/i;
const esCorteDeTiempo = (x) => RE_TIEMPO.test(String((x && x.message) || x || ''));

// Partir un tramo al medio. Devuelve null si ya es de un día: ahí no hay nada
// más que partir y el problema es otro.
function partirTramo(t) {
  const dia = 86400000;
  const d0 = new Date(t.desde + 'T12:00:00'), d1 = new Date(t.hasta + 'T12:00:00');
  const largo = Math.round((d1 - d0) / dia) + 1;
  if (largo <= 1) return null;
  const mitad = Math.floor(largo / 2);
  const corte = new Date(d0.getTime() + (mitad - 1) * dia).toISOString().slice(0, 10);
  const sig = new Date(d0.getTime() + mitad * dia).toISOString().slice(0, 10);
  return [{ desde: t.desde, hasta: corte }, { desde: sig, hasta: t.hasta }];
}

// Un tramo del histórico, ya parseado. Separado para que buscarPorFolio se
// pueda probar sin red.
//
// Si se corta POR TIEMPO, el tramo se parte al medio y se reintenta cada mitad.
// Medido el 9-nov-2026: 31 días cortaban; 7 días entraban a las 15:30 y se
// cortaban a las 17:00 con el mismo tamaño. O sea el umbral no es fijo y
// pedirle al usuario que adivine el --tramo es hacerle perder vueltas. Partir
// sólo ante un corte de TIEMPO, nunca ante un 400 o un 500: ahí el problema no
// se arregla pidiendo menos.
async function traerTramo(t, avisarCorte) {
  const ruta = '/api/FormHeader/historico/' + BP_REDTEC +
               '?fechainicio=' + aUS(t.desde) + '&fechafin=' + aUS(t.hasta);
  let r;
  try { r = await pedir(ruta, { method: 'GET' }, 'lectura'); }
  catch (e) {
    if (!esCorteDeTiempo(e)) throw e;
    return await partirYReintentar(t, (e && e.message) || String(e), avisarCorte, traerTramo);
  }
  if (r.falloCuerpo && esCorteDeTiempo(r.falloCuerpo)) {
    return await partirYReintentar(t, r.falloCuerpo, avisarCorte, traerTramo);
  }
  if (r.status !== 200) throw new Error('No se pudo leer el histórico: HTTP ' + r.status +
    ' · ' + sonda.enmascarar(String(r.texto || '')).slice(0, 200));
  let j;
  try { j = JSON.parse(r.texto); }
  catch (e) {
    throw new Error('El histórico no vino como JSON.\n  ruta: ' + ruta + '\n  ' +
      porQueNoHayJson(r).join('\n  '));
  }
  return Array.isArray(j) ? j : [];
}

async function partirYReintentar(t, motivo, avisarCorte, bajar) {
  const mitades = partirTramo(t);
  if (!mitades) {
    throw new Error('El histórico se cortó por tiempo y el tramo ya es de UN día (' +
      t.desde + ').\n  ' + motivo +
      '\n  Partirlo más no se puede: un solo día no entra en el plazo.' +
      '\n  Sube el plazo con --timeout=120 o prueba desde otra conexión.');
  }
  if (avisarCorte) avisarCorte({ tramo: t, motivo: motivo, mitades: mitades });
  let out = [];
  const traer = bajar || traerTramo;
  for (const m of mitades) out = out.concat(await traer(m, avisarCorte));
  return out;
}

async function buscarPorFolio(folio, dias, paso, alTramo, traer, alCorte) {
  const lista = tramosHaciaAtras(dias, paso);
  const bajar = traer || traerTramo;
  let total = 0;
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    const arr = await bajar(t, alCorte);
    total += arr.length;
    const filas = arr.filter(x => String(x && x.folio) === String(folio));
    if (alTramo) alTramo({ i: i + 1, de: lista.length, desde: t.desde, hasta: t.hasta,
                           registros: arr.length, encontrado: filas.length });
    // En cuanto aparece se corta: bajar los tramos viejos no agrega nada.
    if (filas.length) return { filas: filas, desde: t.desde, hasta: t.hasta,
                               total: total, tramos: i + 1, deTramos: lista.length };
  }
  const ultimo = lista[lista.length - 1] || { desde: '', hasta: '' };
  return { filas: [], desde: ultimo.desde, hasta: (lista[0] || ultimo).hasta,
           total: total, tramos: lista.length, deTramos: lista.length };
}

// El GET que arma el documento. La macro corre todo con una sola sesión, la
// del usuario que confirma, así que esta llamada va con M3LinkSystem: es parte
// de la escritura, no de la lectura del histórico (ese alcance es el otro).
// Si el servidor la rechaza por permisos se reintenta con el usuario de lectura
// y se dice, porque la firma la lleva la URL y no el token — eso está medido.
async function prepararConfirmacion(ruta, pedirFn) {
  const p = pedirFn || pedir;
  const r = await p(ruta, { method: 'GET' }, 'escritura');
  if (r.status !== 401 && r.status !== 403) return Object.assign({}, r, { conLectura: false });
  const otra = await p(ruta, { method: 'GET' }, 'lectura');
  return Object.assign({}, otra, { conLectura: true, statusEscritura: r.status });
}

// Una transferencia que hoy corresponde confirmar es de los últimos días.
// Bajar treinta por omisión es hacer esperar diecisiete mil operaciones para
// nada; si alguien pide --dias se respeta lo que pidió, aunque pida más.
const DIAS_CANDIDATOS = '3';
function diasParaCandidatos(a) {
  return (a && a.diasExplicito) ? a.dias : DIAS_CANDIDATOS;
}

// Igual que buscarPorFolio pero acumula: corta en cuanto juntó suficientes,
// para no bajar diecisiete mil operaciones cuando alcanzan las de ayer.
async function buscarCandidatos(dias, paso, cuantos, alTramo, traer, alCorte) {
  const lista = tramosHaciaAtras(dias, paso);
  const bajar = traer || traerTramo;
  const meta = Math.max(1, parseInt(cuantos, 10) || 5);
  let total = 0, sinEtapa = 0, acum = [];
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    const arr = await bajar(t, alCorte);
    total += arr.length;
    const r = candidatosDe(arr);
    sinEtapa += r.sinEtapa;
    acum = acum.concat(r.candidatos);
    if (alTramo) alTramo({ i: i + 1, de: lista.length, desde: t.desde, hasta: t.hasta,
                           registros: arr.length, encontrado: r.candidatos.length });
    if (acum.length >= meta) break;
  }
  // Recortar ACÁ, no sólo dejar de bajar tramos. Un tramo de tres días trae 135
  // candidatas de una, y quien las reciba va a leer el documento de cada una:
  // 135 consultas para mostrar cinco. `hay` guarda cuántas se vieron, porque el
  // número total es el dato que importa aparte.
  return { candidatos: acum.slice(0, meta), hay: acum.length, total: total,
           sinEtapa: sinEtapa, deTramos: lista.length };
}

// Los folios del lote, resueltos en una pasada por tramo. Corta en cuanto
// encontró todos: un archivo del día se resuelve con el primer tramo.
async function buscarVariosFolios(folios, dias, paso, alTramo, traer, alCorte) {
  const lista = tramosHaciaAtras(dias, paso);
  const bajar = traer || traerTramo;
  const faltan = Object.create(null);
  (folios || []).forEach(function (f) { faltan[String(f)] = 1; });
  let total = 0;
  const ix = Object.create(null);
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    const arr = await bajar(t, alCorte);
    total += arr.length;
    const parcial = indicePorFolio(arr);
    Object.keys(parcial).forEach(function (k) {
      ix[k] = (ix[k] || []).concat(parcial[k]);
      delete faltan[k];
    });
    const quedan = Object.keys(faltan).length;
    if (alTramo) alTramo({ i: i + 1, de: lista.length, desde: t.desde, hasta: t.hasta,
                           registros: arr.length, faltan: quedan });
    if (!quedan) break;
  }
  return { indice: ix, total: total, faltan: Object.keys(faltan) };
}

async function leerDocumento(id) {
  const r = await pedir('/api/FormHeader/' + encodeURIComponent(id), { method: 'GET' }, 'lectura');
  if (r.status !== 200) throw new Error('No se pudo leer el documento ' + id + ': HTTP ' + r.status);
  return JSON.parse(r.texto);
}

/* ------------------------------------------------- principal ------------- */

async function main() {
  const a = leerArgs(process.argv.slice(2));
  if (a.timeout) fijarPlazo(a.timeout);
  console.log('CONFIRMAR EN REDLINK · ' + HOST + ' · PRODUCTIVO');
  // Cuando un tramo se corta por tiempo y se parte, se dice: si no, el usuario
  // ve una pausa larga sin explicación y cree que se colgó.
  const alCorte = (c) => console.log('  · el tramo ' + c.tramo.desde + ' a ' + c.tramo.hasta +
    ' se cortó por tiempo; lo parto en ' + c.mitades.map(m => m.desde + '..' + m.hasta).join(' y '));
  // Cada tramo se canta mientras baja: si uno se corta, se ve cuál y dónde iba.
  const eco = (t) => console.log('  tramo ' + t.i + '/' + t.de + '  ' + t.desde + ' a ' + t.hasta +
    ': ' + t.registros.toLocaleString('es-CL') + ' operaciones' + (t.encontrado ? '  <- acá está' : ''));


  if (!a.productivo) {
    console.log('\nEste script escribe en producción y dispara un ajuste de inventario en SAP.');
    console.log('Para usarlo hay que pedirlo explícitamente con --productivo.');
    console.log('');
    console.log('  1) mirar el documento que el servidor prepara, SIN mandarlo:');
    console.log('     node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --preparar');
    console.log('  2) confirmar de verdad:');
    console.log('     node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si');
    console.log('');
    console.log('  De a muchas, desde el CSV de la página (folio;cantRecibida):');
    console.log('     node scripts/confirmar-redlink.js --productivo --lote=confirmar.csv');
    console.log('     node scripts/confirmar-redlink.js --productivo --lote=confirmar.csv --si');
    console.log('');
    console.log('Para sólo MIRAR, sin escribir nada:');
    console.log('  --candidatos     qué transferencias de Walmart corresponde confirmar hoy');
    console.log('  --origen=MARCA   cambia la marca de procedencia (por omisión ' + ORIGEN + ')');
    console.log('  --quien=N        quién firmó el documento de ese folio');
    console.log('  --usuario=NOMBRE qué usersiD tiene ese usuario según la API');
    console.log('\nSi el histórico se corta por tiempo se parte solo; --timeout=120 le da más plazo.\n');
    return 2;
  }

  // --usuario SOLO PREGUNTA un nombre. Es la forma de comprobar el número de
  // la firma sin tocar ninguna transferencia.
  if (a.usuario) {
    // Pregunta con el usuario de escritura, así que pide SÓLO esas credenciales:
    // bloquear una consulta de lectura por una variable que no usa manda a
    // buscar el problema al lado equivocado.
    const faltan = ['REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS']
      .filter(k => !String(process.env[k] || '').trim());
    if (faltan.length) {
      console.log('\nPara preguntar por un usuario falta: ' + faltan.join(', ') + '\n');
      return 2;
    }
    const u = await idDeUsuario(a.usuario);
    console.log('');
    console.log('  GET /api/User/nombreusuario/' + a.usuario);
    if (!u.ok && u.id === null) {
      u.problemas.forEach(x => console.log('  · ' + x));
      console.log('');
      return 2;
    }
    console.log('  usersiD   ' + u.id);
    console.log('  userName  ' + (u.nombre || '(sin nombre)'));
    u.problemas.forEach(x => console.log('  · ' + x));
    if (String(a.usuario).trim().toLowerCase() === NOMBRE_M3LINK.toLowerCase()) {
      console.log('  configurado acá: ' + USERSID_M3LINK +
                  (Number(u.id) === USERSID_M3LINK ? '  (coinciden)' : '  <- NO COINCIDE'));
    }
    console.log('\n  Sólo pregunté. No mandé nada.\n');
    return u.ok ? 0 : 1;
  }
  // ---- el lote ----------------------------------------------------------
  //
  // Lo que define este modo no es que escriba varias: es DÓNDE relee. Cada
  // folio se relee justo antes de su propia escritura, no todos al empezar. Si
  // el lote leyera 135 documentos al principio y escribiera durante diez
  // minutos, el módulo del proveedor puede confirmar uno en el medio y le
  // mandamos un segundo ajuste de inventario encima.
  if (a.lote) {
    // El archivo PRIMERO, antes de las credenciales: revisarlo no necesita
    // ninguna, y así quien está armando el CSV puede corregirlo sin tener las
    // de escritura cargadas.
    let texto;
    try { texto = fs.readFileSync(a.lote, 'utf8'); }
    catch (e) { console.log('\nNo pude leer ' + a.lote + ': ' + ((e && e.message) || e) + '\n'); return 2; }
    const l = listado.leerListado(texto);
    const rev = revisarLote(l.filas, l.malas, a.tope);
    console.log('  archivo: ' + a.lote);
    console.log('  filas utilizables: ' + rev.cuantas + '  ·  tope ' + rev.tope);
    if (!rev.ok) {
      console.log('\nEl archivo no sirve para correr un lote:');
      rev.problemas.forEach(x => console.log('  · ' + x));
      console.log('');
      return 2;
    }
    const mal = revisarCredenciales();
    if (mal.length) {
      console.log('\nEl archivo está bien, pero no se puede confirmar:');
      mal.forEach(m => console.log('  · ' + m));
      console.log('');
      return 2;
    }

    const resuelto0 = await idDeUsuario(NOMBRE_M3LINK).catch(e => ({ ok: false, id: null, nombre: '',
      problemas: [(e && e.message) || String(e)] }));
    const cot = cotejarFirma(resuelto0, USERSID_M3LINK);
    console.log('  firma: ' + cot.dice);
    if (!cot.ok) { console.log(''); return 2; }

    const ecoLote = (t) => console.log('  tramo ' + t.i + '/' + t.de + '  ' + t.desde + ' a ' + t.hasta +
      ': ' + t.registros.toLocaleString('es-CL') + ' operaciones' +
      (t.faltan ? '  (faltan ' + t.faltan + ' folios)' : '  (están todos)'));
    const b = await buscarVariosFolios(l.filas.map(f => f.folio), a.dias, a.tramo, ecoLote, null, alCorte);
    console.log('  histórico: ' + b.total.toLocaleString('es-CL') + ' operaciones');
    if (b.faltan.length) {
      console.log('\n' + b.faltan.length + ' folios del archivo no aparecen en ' + a.dias + ' días:');
      console.log('  ' + b.faltan.slice(0, 20).join(', ') + (b.faltan.length > 20 ? ' …' : ''));
      console.log('Un folio que no se encuentra no se puede escribir, y un archivo a medias');
      console.log('no se corre a medias. Revisa el listado o prueba --dias mayor.\n');
      return 2;
    }

    console.log('');
    if (!a.si) console.log('  ENSAYO: releo cada documento y digo qué haría. No escribo nada.\n');
    const hechos = [];
    for (const f of l.filas) {
      const r = idDeFolio(b.indice, f.folio);
      if (!r.id) {
        hechos.push({ accion: 'detener', folio: f.folio, motivo: r.motivo });
        console.log('  ' + f.folio + '  DETENER: ' + r.motivo);
        break;
      }
      // Releído ACÁ, folio por folio.
      let doc;
      try { doc = await leerDocumento(r.id); }
      catch (e) {
        hechos.push({ accion: 'detener', folio: f.folio, motivo: 'no se pudo leer: ' + ((e && e.message) || e) });
        console.log('  ' + f.folio + '  DETENER: no se pudo leer el documento ' + r.id);
        break;
      }
      const c = clasificarEnLote(doc, f.cantRecibida, cot.usar, a.origen);
      if (c.accion === 'saltar') {
        hechos.push({ accion: 'saltar', folio: f.folio, motivo: c.motivo });
        console.log('  ' + f.folio + '  salto: ' + c.motivo);
        continue;
      }
      if (c.accion === 'detener') {
        hechos.push({ accion: 'detener', folio: f.folio, motivo: c.motivo });
        console.log('  ' + f.folio + '  DETENER: ' + c.motivo);
        break;
      }
      if (!a.si) {
        hechos.push({ accion: 'confirmar', folio: f.folio, motivo: '' });
        console.log('  ' + f.folio + '  confirmaría ' + f.cantRecibida + ' de ' +
                    c.plan.resumen.despachado + '  ·  ' + c.plan.resumen.etapa);
        continue;
      }

      const prep = await prepararConfirmacion(c.plan.url);
      if (prep.status !== 200 || prep.falloCuerpo) {
        const por = prep.falloCuerpo ? 'la descarga se cortó: ' + prep.falloCuerpo : 'HTTP ' + prep.status;
        hechos.push({ accion: 'detener', folio: f.folio, motivo: 'el preparado falló (' + por + ')' });
        console.log('  ' + f.folio + '  DETENER: el preparado falló (' + por + ')');
        break;
      }
      const rp = revisarPreparado(prep.texto, doc.folio, f.cantRecibida);
      if (!rp.ok) {
        hechos.push({ accion: 'detener', folio: f.folio, motivo: rp.problemas.join(' · ') });
        console.log('  ' + f.folio + '  DETENER: el preparado no sirve: ' + rp.problemas.join(' · '));
        break;
      }
      const res = await pedir('/api/FormHeader', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: prep.texto
      }, 'escritura');
      const despues = await leerDocumento(r.id);
      const etapaFin = etapaDe(despues);
      const v = veredictoDeFirma(despues, cot.usar);
      const vaciadas = coleccionesVaciadas(doc, despues);
      const problemas = [];
      if (res.status !== 200) problemas.push('el PATCH devolvió HTTP ' + res.status + ': ' +
        sonda.enmascarar(String(res.texto || '')).slice(0, 200).replace(/\s+/g, ' '));
      if (!/confirmada/i.test(etapaFin)) problemas.push('la etapa quedó en "' + (etapaFin || '(vacía)') + '"');
      if (!v.ok) problemas.push(v.dice);
      if (vaciadas.length) problemas.push('se VACIARON colecciones: ' + vaciadas.join(', '));
      if (problemas.length) {
        hechos.push({ accion: 'detener', folio: f.folio, motivo: problemas.join(' · ') });
        console.log('  ' + f.folio + '  DETENER tras escribir:');
        problemas.forEach(x => console.log('      · ' + x));
        break;
      }
      hechos.push({ accion: 'confirmar', folio: f.folio, motivo: '' });
      console.log('  ' + f.folio + '  confirmada ' + f.cantRecibida + '  ·  ' + etapaFin);
      await dormir(parseInt(a.pausa, 10));
    }

    const R2 = resumenDeLote(hechos);
    const faltaron = l.filas.length - hechos.length;
    console.log('');
    console.log('  ' + (a.si ? 'confirmadas' : 'confirmaría') + ': ' + R2.confirmadas +
                '   saltadas: ' + R2.saltadas + '   sin tocar: ' + faltaron);
    if (R2.detenido) {
      console.log('');
      console.log('  SE DETUVO en el folio ' + R2.detenido.folio + '.');
      console.log('  Las ' + faltaron + ' que quedan NO se tocaron. Resuelve eso y vuelve a correr el');
      console.log('  mismo archivo: las ya confirmadas se saltan solas.');
      console.log('');
      return 1;
    }
    if (!a.si) {
      console.log('\n  Fue un ensayo. Agrega --si para confirmar de verdad.\n');
      return 0;
    }
    console.log('\n  Verificar en el portal y revisar los ajustes en SAP.\n');
    return 0;
  }

  // --candidatos SOLO LEE. Existe para el primer disparo: en vez de pedirle a
  // alguien que saque un folio del Excel y lo tipee, el script busca las que
  // hoy corresponde confirmar, las pasa por las mismas guardas del plan y
  // escribe la línea de comando de cada una.
  if (a.candidatos) {
    const dias = diasParaCandidatos(a);
    const r = await buscarCandidatos(dias, a.tramo, a.cuantos, eco, null, alCorte);
    console.log('  histórico: ' + r.total.toLocaleString('es-CL') + ' operaciones en ' + dias + ' días');
    if (r.hay > r.candidatos.length) {
      console.log('  ' + r.hay.toLocaleString('es-CL') + ' en etapa confirmable; muestro ' +
                  r.candidatos.length + ' (--cuantos=N para más)');
    }
    if (r.sinEtapa === r.total && r.total > 0) {
      console.log('\nNinguna fila del histórico trae un campo de etapa que sepa leer.');
      console.log('No es que no haya candidatas: no supe leer el listado.');
      console.log('Los campos que busco: ' + CAMPOS_FILA.etapa.join(', ') + '\n');
      return 2;
    }
    if (!r.candidatos.length) {
      console.log('\nNo hay transferencias de Walmart en etapa confirmable en ' + dias + ' días.');
      console.log('Prueba --dias mayor.\n');
      return 2;
    }
    console.log('');
    let sirven = 0;
    for (const c of r.candidatos) {
      if (!c.id) { console.log('  folio ' + c.folio + ': la fila no trae formHeaderiD'); continue; }
      // Se lee el documento de cada una: la fila del listado no alcanza para
      // saber qué cantidad corresponde, y ese número es el que mueve stock.
      let doc;
      try { doc = await leerDocumento(c.id); }
      catch (e) { console.log('  folio ' + c.folio + ': no se pudo leer (' + ((e && e.message) || e) + ')'); continue; }
      const det = (doc.formDdetalles || [])[0] || {};
      const desp = Number(det.despachado) || 0;
      const plan = planDeConfirmacion(doc, desp, USERSID_M3LINK);
      if (!plan.ok) {
        console.log('  folio ' + c.folio + ' — NO: ' + plan.problemas.join(' · '));
        continue;
      }
      sirven++;
      console.log('  folio ' + c.folio + '  ·  despachado ' + desp + '  ·  ' + plan.resumen.etapa);
      console.log('    ' + plan.resumen.destino + ' · ' + (plan.resumen.bodega || '(sin bodega)'));
      console.log('    node scripts/confirmar-redlink.js --productivo --folio=' + c.folio +
                  ' --cantidad=' + desp + ' --preparar');
    }
    console.log('');
    console.log(sirven ? '  ' + sirven + ' sirven. La cantidad de arriba es la DESPACHADA: si Walmart ' +
                         'recibió menos,\n  hay que poner lo que recibió, no lo despachado.'
                       : '  Ninguna pasó las guardas del plan.');
    console.log('\n  Sólo leí. No mandé nada.\n');
    return sirven ? 0 : 2;
  }

  // --quien SOLO LEE: ni pide la cantidad ni exige las credenciales de
  // escritura, porque no va a escribir nada.
  if (a.quien) {
    const b0 = await buscarPorFolio(a.quien, a.dias, a.tramo, eco, null, alCorte);
    console.log('  histórico: ' + b0.total.toLocaleString('es-CL') + ' operaciones en ' +
                b0.tramos + ' de ' + b0.deTramos + ' tramos');
    if (!b0.filas.length) { console.log('\nEl folio ' + a.quien + ' no aparece en ' + a.dias + ' días. Prueba --dias mayor.\n'); return 2; }
    if (b0.filas.length > 1) { console.log('\nEl folio ' + a.quien + ' cae en ' + b0.filas.length + ' operaciones.\n'); return 2; }
    const id0 = b0.filas[0].formHeaderiD;
    if (!id0) { console.log('\nEl registro no trae formHeaderiD.\n'); return 2; }
    const doc0 = await leerDocumento(id0);
    const f = firmaDe(doc0);
    console.log('');
    console.log('  folio ' + a.quien + '  (documento ' + id0 + ')');
    const d0 = (doc0.formDdetalles || [])[0] || {};
    console.log('  etapa                  ' + ((doc0.formMetapa || {}).nombre || '(vacía)'));
    // Las cantidades van acá porque es la única señal de si alguien ya
    // confirmó: la etapa sola no alcanza y el 10-nov hizo falta justo esto
    // para saber si un GET había dejado algo escrito.
    console.log('  despachado / recepción ' + JSON.stringify(d0.despachado) + ' / ' + JSON.stringify(d0.recepcion));
    console.log('  formMetapaId           ' + JSON.stringify(doc0.formMetapaId));
    console.log('  usuarioIngresoNombre   ' + (f.nombre || '(vacío)'));
    console.log('  usuarioIngresoId       ' + (f.id === null ? '(vacío)' : f.id) + '   <- el número que se firma');
    console.log('  usuarioConfirmaId      ' + (f.confirmaId === null ? '(null)' : f.confirmaId) +
                '   (no se usa: una confirmación real lo deja en null)');
    console.log('\n  Sólo leí. No mandé nada.\n');
    return 0;
  }

  if (!a.folio || !a.cantidad) { console.log('\nFaltan --folio=N y --cantidad=K\n'); return 2; }

  const mal = revisarCredenciales();
  if (mal.length) {
    console.log('\nNo se puede confirmar:');
    mal.forEach(m => console.log('  · ' + m));
    console.log('\nLa confirmación tiene que quedar firmada por M3LinkSystem.\n');
    return 2;
  }

  const b = await buscarPorFolio(a.folio, a.dias, a.tramo, eco, null, alCorte);
  console.log('  histórico: ' + b.total.toLocaleString('es-CL') + ' operaciones en ' +
              b.tramos + ' de ' + b.deTramos + ' tramos');
  if (!b.filas.length) { console.log('\nEl folio ' + a.folio + ' no aparece en ' + a.dias + ' días. Prueba --dias mayor.\n'); return 2; }
  if (b.filas.length > 1) { console.log('\nEl folio ' + a.folio + ' cae en ' + b.filas.length + ' operaciones. No se elige una.\n'); return 2; }

  const id = b.filas[0].formHeaderiD;
  if (!id) { console.log('\nEl registro no trae formHeaderiD: sin el id no se puede escribir.\n'); return 2; }

  const antes = await leerDocumento(id);

  // El número de la firma se pregunta por nombre antes de armar nada. Si la
  // API contesta otro número que el configurado, no se escribe: elegir uno de
  // los dos a ojo firma a nombre de quien no confirmó y eso no se corrige.
  const resuelto = await idDeUsuario(NOMBRE_M3LINK).catch(e => ({ ok: false, id: null, nombre: '',
    problemas: [(e && e.message) || String(e)] }));
  const cotejo = cotejarFirma(resuelto, USERSID_M3LINK);
  console.log('  firma: ' + cotejo.dice);
  if (!cotejo.ok) { console.log(''); return 2; }

  const plan = planDeConfirmacion(antes, a.cantidad, cotejo.usar, a.origen);
  if (!plan.ok) {
    console.log('\nNo se puede confirmar el folio ' + a.folio + ':');
    plan.problemas.forEach(p => console.log('  · ' + p));
    console.log('');
    return 2;
  }

  const R = plan.resumen;
  console.log('');
  console.log('  folio ' + R.folio + '  (documento ' + R.id + ')');
  console.log('  cliente   ' + R.cliente);
  console.log('  destino   ' + R.destino + ' · ' + R.bodega);
  console.log('  etapa     ' + R.etapa);
  console.log('  despachado ' + R.despachado + '  ->  a confirmar ' + R.aConfirmar);
  console.log('');
  console.log('');
  console.log('  marca de procedencia: ' + plan.origen +
              (plan.origen === 'CONFIRMAVER2'
                ? '  (la única que el servidor prepara; medido 10-nov)'
                : '  <- OJO: con otra que no sea CONFIRMAVER2 el servidor devolvió el documento sin tocar'));
  console.log('  El cuerpo del PATCH lo arma el servidor. Se le pide con:');
  console.log('    GET ' + plan.url);

  if (!a.si && !a.preparar) {
    console.log('\n  No mandé nada.');
    console.log('  --preparar  pide ese documento y lo muestra, sin confirmar.');
    console.log('  --si        pide ese documento y lo devuelve por PATCH: eso confirma.\n');
    return 0;
  }

  // Hasta no haberla visto funcionar una vez, esta ruta no se llama sin que
  // alguien lo pida: se llama ConfirmarTransferencia y nadie midió todavía si
  // sólo prepara o si además deja algo escrito. Por eso --preparar es un paso
  // aparte y no parte del plan.
  const prep = await prepararConfirmacion(plan.url);
  console.log('');
  console.log('  GET preparado  ->  HTTP ' + prep.status +
              (prep.conLectura ? '  (con el usuario de lectura: escritura dio ' + prep.statusEscritura + ')' : ''));
  if (prep.falloCuerpo) {
    console.log('  la descarga se cortó: ' + prep.falloCuerpo);
    console.log('');
    return 2;
  }
  if (prep.status !== 200) {
    console.log('  ' + sonda.enmascarar(String(prep.texto || '(cuerpo vacío)')).slice(0, 300).replace(/\s+/g, ' '));
    console.log('');
    return 2;
  }

  const rev = revisarPreparado(prep.texto, antes.folio, R.aConfirmar);
  console.log('  cuerpo: ' + String(prep.texto || '').length.toLocaleString('es-CL') + ' bytes');
  if (rev.doc) {
    console.log('  trae etapa      ' + (rev.etapa || '(vacía)'));
    console.log('  trae recepción  ' + JSON.stringify(((rev.doc.formDdetalles || [])[0] || {}).recepcion));
    console.log('  trae firma      ' + (rev.firma.id === null ? '(vacío)' : rev.firma.id) +
                ' / "' + (rev.firma.nombre || '(vacío)') + '"');
    // QUÉ cambió el servidor respecto del documento que ya teníamos. Sin esto
    // la respuesta es "no sirve" y no se sabe si el servidor no preparó nada o
    // si preparó algo en un campo que no estábamos mirando.
    const d = diferencias(antes, rev.doc);
    console.log('');
    if (!d.length) {
      console.log('  El preparado es IDÉNTICO al documento que ya teníamos.');
      console.log('  El servidor no preparó nada: con la marca "' + plan.origen + '" este GET sólo lee.');
    } else {
      console.log('  Qué trae distinto del documento actual (' + d.length + ' campos):');
      d.forEach(x => console.log('    ' + x.campo + ': ' + x.antes + '  ->  ' + x.despues));
    }
  }
  if (!rev.ok) {
    console.log('');
    console.log('  El documento preparado no sirve para mandarlo:');
    rev.problemas.forEach(x => console.log('    · ' + x));
    console.log('');
    return 2;
  }

  if (!a.si) {
    console.log('');
    console.log('  No mandé el PATCH. Este es el cuerpo que se devolvería tal cual.');
    console.log('  Agrega --si para confirmar de verdad.\n');
    return 0;
  }

  // El cuerpo va EXACTO como vino. Ni reserializado ni retocado: ocho intentos
  // con el cuerpo armado a mano dieron 400, y la diferencia entre el que falla
  // y el que sirve puede ser un campo que no sabemos leer.
  const res = await pedir('/api/FormHeader', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: prep.texto
  }, 'escritura');       // la escritura SI va firmada por M3LinkSystem
  const cl = sonda.clasificar(res.status, res.texto);
  console.log('\n  PATCH /api/FormHeader  ->  HTTP ' + res.status + '  ·  ' + cl.dice);
  const cuerpo = sonda.enmascarar(res.texto || '').trim();
  if (cuerpo) console.log('  respuesta: ' + cuerpo.slice(0, 300).replace(/\s+/g, ' '));

  const despues = await leerDocumento(id);
  // Diff COMPLETO, no una lista de campos conocidos: el cuerpo que se mandó
  // trae cosas que no pusimos nosotros (claveFrontend, filler, colecciones
  // vacías) y lo que importa es qué hizo el servidor con todas ellas.
  const cambios = diferencias(antes, despues);
  console.log('');
  if (!cambios.length) {
    console.log('  El documento NO cambió. Un 200 sin cambios no es una confirmación.');
  } else {
    console.log('  Qué cambió en el documento (' + cambios.length + ' campos):');
    cambios.forEach(c => console.log('    ' + c.campo + ': ' + c.antes + '  ->  ' + c.despues));
    const etapa = (despues.formMetapa || {}).nombre || '';
    console.log('');
    console.log(/confirmada/i.test(etapa)
      ? '  CONFIRMADA. Verificar en el portal y revisar que el ajuste en SAP se haya generado.'
      : '  Cambió, pero la etapa quedó en "' + etapa + '". Revisar antes de repetir.');
  }

  // El cuerpo preparado manda las colecciones hijas vacías. Si el servidor las
  // reemplaza, se perdieron registros del documento y nadie lo iba a notar
  // mirando la etapa, que es lo único que se mira cuando sale bien.
  const vaciadas = coleccionesVaciadas(antes, despues);
  if (vaciadas.length) {
    console.log('');
    console.log('  OJO: se VACIARON colecciones del documento: ' + vaciadas.join(', '));
    console.log('  El cuerpo preparado las manda como [] y el servidor las reemplazó.');
    console.log('  NO confirmar más folios hasta resolver esto.');
  }

  // La firma se revisa SIEMPRE, haya cambiado el documento o no: un id
  // equivocado no da error, graba otro usuario y se queda callado.
  const v = veredictoDeFirma(despues, cotejo.usar);
  console.log('');
  console.log(v.ok ? '  Firma: ' + v.dice : '  FIRMA MAL: ' + v.dice);
  console.log('');
  return v.ok ? 0 : 1;
}

module.exports = Object.assign({}, N, { revisarCredenciales, USUARIOS, ETAPAS_CONFIRMABLES, etapaConfirmable, etapaDe, firmaDe, porQueNoHayJson, leerCuerpo,
  USERSID_M3LINK, NOMBRE_M3LINK, veredictoDeFirma, tramosHaciaAtras, buscarPorFolio,
  partirTramo, esCorteDeTiempo, partirYReintentar, ORIGEN, urlConfirmar, revisarPreparado,
  interpretarUsuario, idDeUsuario, rutaDeUsuario, cotejarFirma, prepararConfirmacion,
  CAMPOS_FILA, campoFila, candidatosDe, buscarCandidatos, diasParaCandidatos, DIAS_CANDIDATOS,
  diferencias, recorteValor, COLECCIONES_HIJAS, coleccionesVaciadas,
  TOPE_LOTE, revisarLote, clasificarEnLote, indicePorFolio, idDeFolio, resumenDeLote, leerListado: listado.leerListado,
  buscarVariosFolios, dormir,
  comparar, leerArgs, CAMPOS_ESTADO, aUS, RE_NOMBRE_USUARIO });

if (require.main === module) {
  main().then(c => { process.exitCode = c || 0; }).catch(e => {
    console.error('\n' + sonda.enmascarar(sonda.describirError(e)) + '\n');
    process.exitCode = 2;
  });
}
