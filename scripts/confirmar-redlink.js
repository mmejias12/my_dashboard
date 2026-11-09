#!/usr/bin/env node
// ============================================================================
//  scripts/confirmar-redlink.js
//
//  CONFIRMA UNA transferencia en Redlink PRODUCTIVO. Escribe de verdad, y esa
//  escritura dispara un ajuste de inventario en SAP que no se deshace.
//
//  Por qué existe y por qué es de a una
//  ------------------------------------
//  En DEMO el avance de etapa nunca funcionó: el entorno de pruebas no tiene
//  el proceso de ajuste hacia SAP, así que el guardado fallaba siempre. La
//  única forma de saber si el contrato sirve es ejecutarlo donde ese proceso
//  existe. Para que eso no sea una apuesta, la prueba se hace sobre una
//  transferencia que YA correspondía confirmar por esa misma cantidad: si
//  funciona, se hizo lo correcto; si falla, no pasó nada.
//
//  Por eso toma UN folio y UNA cantidad. Sin lotes, sin archivos, sin bucles.
//  Cuando el contrato esté probado, el lote se construye aparte y a conciencia.
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
//    node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si
//
//  Sin --productivo no hace nada: la bandera está para que nadie llegue acá
//  por inercia. Sin --si muestra el plan completo y se detiene.
//
//  Variables de entorno:
//    REDLINK_CLIENT_SECRET        (el mismo cliente apiportalredtec)
//    REDLINK_M3LINK_USER          (M3LinkSystem)
//    REDLINK_M3LINK_PASS
//    REDLINK_USER                 (sólo para comprobar que no son el mismo)
// ============================================================================
'use strict';

const path = require('path');
const sonda = require(path.join(__dirname, 'sonda-escritura-redlink.js'));

const HOST = 'api.portalredtec.cl';
const API  = 'https://' + HOST;
const TOKEN_URL = 'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const CLIENT_ID = 'apiportalredtec';
const BP_REDTEC = '433';
const PLAZO = 60000;

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
const ETAPAS_CONFIRMABLES = [/pendiente\s+de\s+confirmaci/i, /pendiente\s+adjuntar\s+respaldo/i];
const etapaDe = (doc) => String((doc && doc.formMetapa && doc.formMetapa.nombre) || '');
const etapaConfirmable = (doc) => ETAPAS_CONFIRMABLES.some(re => re.test(etapaDe(doc)));

const esConfirmada = (doc) => {
  const det = (doc && doc.formDdetalles && doc.formDdetalles[0]) || {};
  const n = Number(det.recepcion) || 0;
  return n > 0 && !/^\s*pendiente/i.test(String((doc && doc.formMetapa && doc.formMetapa.nombre) || ''));
};

// Todo lo que tiene que ser cierto ANTES de escribir, junto y nombrado. Un
// solo problema detiene la operación: acá no hay "seguir con lo que se pueda".
function planDeConfirmacion(doc, cantidad, usersId, opciones) {
  const o = opciones || {};
  const firma = o.sinFirma ? 0
    : ((usersId === undefined || usersId === null) ? USERSID_M3LINK : Number(usersId));
  const avanzar = !o.sinAvanzar;
  const problemas = [];
  if (!doc || typeof doc !== 'object') return { ok: false, problemas: ['no se pudo leer el documento'] };

  const det = (doc.formDdetalles || []).filter(d => d && typeof d === 'object');
  const desp = det.length ? Number(det[0].despachado) || 0 : 0;
  const n = Number(cantidad);

  // Con --sin-firma el experimento ES mandar sin firma, así que no se objeta;
  // el aviso de que quedará a nombre de otro lo da main() antes de escribir.
  if (!o.sinFirma && !(firma > 0)) problemas.push('no hay usersiD de ' + NOMBRE_M3LINK +
    ': sin firma la confirmación quedaría a nombre de quien tocó el documento antes');
  if (Number(doc.formId) !== 6) problemas.push('no es una transferencia (formId ' + doc.formId + ')');
  const destino = String(doc.bpDestinoNombre || '');
  if (!/walmart/i.test(destino)) problemas.push('el destino no es Walmart: ' + (destino || '(vacío)'));
  if (det.length !== 1) problemas.push('el documento tiene ' + det.length + ' líneas de detalle; esta versión confirma una');
  if (esConfirmada(doc)) problemas.push('la transferencia YA está confirmada');
  else if (!etapaConfirmable(doc)) problemas.push('la etapa es "' + (etapaDe(doc) || '(vacía)') +
    '" y las confirmables son "Pendiente de Confirmación" y "Pendiente Adjuntar Respaldo"');
  if (!Number.isFinite(n) || n <= 0) problemas.push('la cantidad a confirmar tiene que ser un número mayor que cero');
  else if (!desp) problemas.push('la línea no tiene cantidad despachada: no hay contra qué confirmar');
  else if (n > desp) problemas.push('se pide confirmar ' + n + ' y sólo se despacharon ' + desp);

  if (problemas.length) return { ok: false, problemas: problemas };

  return {
    ok: true,
    problemas: [],
    resumen: {
      folio: doc.folio, id: doc.formHeaderiD,
      cliente: doc.bpOrigenNombre, destino: doc.bpDestinoNombre,
      bodega: doc.bodegaDestinoNombre, etapa: (doc.formMetapa || {}).nombre,
      despachado: desp, aConfirmar: n, porAvisar: 0
    },
    // Sin `usuario`, cuerpoEco devuelve el usuarioIngresoId que YA tenía el
    // documento: la confirmación quedaría firmada por quien lo tocó antes y
    // nadie sabría que la hizo el m3link.
    cuerpo: sonda.cuerpoEco(doc, { cantidad: n, despachado: true, recepcion: true,
                                   avanzar: avanzar, usuario: firma })
  };
}

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
              sinFirma: false, sinAvanzar: false, tramo: '7' };
  for (const x of (argv || [])) {
    if (x === '--productivo') a.productivo = true;
    else if (x === '--si') a.si = true;
    else if (x.indexOf('--folio=') === 0) a.folio = x.slice(8);
    else if (x.indexOf('--cantidad=') === 0) a.cantidad = x.slice(11);
    else if (x.indexOf('--dias=') === 0) a.dias = x.slice(7);
    else if (x.indexOf('--tramo=') === 0) a.tramo = x.slice(8);
    else if (x.indexOf('--quien=') === 0) { a.quien = x.slice(8); a.folio = a.folio || a.quien; }
    // Las dos banderas de AISLAMIENTO. El cuerpo lleva dos cosas que nunca se
    // vieron grabar: avanzaEtapa (siete intentos fallidos en DEMO) y la firma
    // (nueva). Un 400 no dice cuál de las dos fue. Estas banderas sacan una
    // por vez para que el experimento tenga una sola variable.
    else if (x === '--sin-firma') a.sinFirma = true;
    else if (x === '--sin-avanzar') a.sinAvanzar = true;
  }
  return a;
}

// El usersiD numérico de M3LinkSystem en PRODUCCIÓN, que Marcelo confirmó el
// 9-nov-2026. Es lo que se escribe en `usuarioIngresoId` para que la
// confirmación quede firmada por el usuario de sistema del m3link.
//
// OJO: este número es de PRODUCCIÓN. DEMO es otra base y su id puede ser otro;
// escribir el de DEMO acá firmaría con el usuario equivocado.
// Patrón de control: M2LinkSystem, el usuario del módulo viejo, es 951.
const USERSID_M3LINK = Math.max(0, parseInt(process.env.REDLINK_M3LINK_USERSID || '983', 10) || 0);
const NOMBRE_M3LINK = 'M3LinkSystem';

// Quien firma un documento. Es `usuarioIngresoId`, no `usuarioConfirmaId`:
// medido el 9-nov-2026, una confirmacion manual real dejo usuarioConfirmaId en
// null y sobrescribio usuarioIngresoId con el usuario que actuo. El servidor
// NO lo deduce del token, guarda lo que se le manda.
//
// Para que esto sirva hay que leer un documento que el usuario HAYA TOCADO:
// el nombre confirma de quien es el numero, y sin el nombre el numero no
// prueba nada.
function firmaDe(doc) {
  if (!doc || typeof doc !== 'object') return { id: null, nombre: '', confirmaId: null };
  const n = Number(doc.usuarioIngresoId);
  return {
    id: Number.isFinite(n) && n > 0 ? n : null,
    nombre: String(doc.usuarioIngresoNombre || '').trim(),
    confirmaId: (doc.usuarioConfirmaId === null || doc.usuarioConfirmaId === undefined)
      ? null : Number(doc.usuarioConfirmaId)
  };
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

// Después de escribir, lo único que prueba que el número era el correcto es el
// NOMBRE que devolvió el servidor. Un id equivocado no da error: graba otro
// usuario y queda igual de callado.
function veredictoDeFirma(docDespues) {
  const f = firmaDe(docDespues);
  if (f.id === USERSID_M3LINK && f.nombre.toLowerCase() === NOMBRE_M3LINK.toLowerCase()) {
    return { ok: true, dice: 'firmada por ' + f.nombre + ' (' + f.id + ')' };
  }
  if (f.id === USERSID_M3LINK) {
    return { ok: false, dice: 'el id ' + f.id + ' quedó grabado pero el nombre es "' +
      (f.nombre || '(vacío)') + '", no ' + NOMBRE_M3LINK + ': el número NO es de ese usuario' };
  }
  return { ok: false, dice: 'se mandó ' + USERSID_M3LINK + ' y quedó ' +
    (f.id === null ? '(vacío)' : f.id) + ' / "' + (f.nombre || '(vacío)') +
    '": la confirmación NO quedó firmada por ' + NOMBRE_M3LINK };
}

// Cada aviso dice lo que hace SU bandera y nada más. La continuación del aviso
// de --sin-avanzar estaba fuera de su `if` y salía siempre: con --sin-firma
// avisaba "queda a medio camino", que es justo lo contrario — esa bandera SÍ
// avanza la etapa, la confirmación queda completa y lo único que falta es la
// firma. Un aviso que afirma de más asusta en el momento equivocado.
function avisosDeAislamiento(a, nombreActual) {
  const out = [];
  if (a && a.sinFirma) {
    out.push('    · va SIN firma: si graba, la confirmación queda COMPLETA');
    out.push('      pero a nombre de "' + (nombreActual || '(el anterior)') + '"');
  }
  if (a && a.sinAvanzar) {
    out.push('    · va SIN avanzar de etapa: si graba, escribe la recepción');
    out.push('      y el documento queda A MEDIO CAMINO');
  }
  return out;
}

// Qué decir cuando el histórico no trae un JSON utilizable. Separa las tres
// cosas que hasta ahora se contaban como una sola: se cortó la descarga, el
// servidor contestó vacío de verdad, o contestó algo que no es JSON.
function porQueNoHayJson(r) {
  if (r.falloCuerpo) {
    return ['la descarga se CORTÓ a mitad de camino: ' + r.falloCuerpo,
            'no es que no haya datos — no se alcanzó a leer la respuesta',
            'probá con --dias menor (una ventana más chica baja el tamaño)'];
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

// Un tramo del histórico, ya parseado. Separado para que buscarPorFolio se
// pueda probar sin red.
async function traerTramo(t) {
  const ruta = '/api/FormHeader/historico/' + BP_REDTEC +
               '?fechainicio=' + aUS(t.desde) + '&fechafin=' + aUS(t.hasta);
  const r = await pedir(ruta, { method: 'GET' }, 'lectura');
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

async function buscarPorFolio(folio, dias, paso, alTramo, traer) {
  const lista = tramosHaciaAtras(dias, paso);
  const bajar = traer || traerTramo;
  let total = 0;
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    const arr = await bajar(t);
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

async function leerDocumento(id) {
  const r = await pedir('/api/FormHeader/' + encodeURIComponent(id), { method: 'GET' }, 'lectura');
  if (r.status !== 200) throw new Error('No se pudo leer el documento ' + id + ': HTTP ' + r.status);
  return JSON.parse(r.texto);
}

/* ------------------------------------------------- principal ------------- */

async function main() {
  const a = leerArgs(process.argv.slice(2));
  console.log('CONFIRMAR EN REDLINK · ' + HOST + ' · PRODUCTIVO');
  // Cada tramo se canta mientras baja: si uno se corta, se ve cuál y dónde iba.
  const eco = (t) => console.log('  tramo ' + t.i + '/' + t.de + '  ' + t.desde + ' a ' + t.hasta +
    ': ' + t.registros.toLocaleString('es-CL') + ' operaciones' + (t.encontrado ? '  <- acá está' : ''));


  if (!a.productivo) {
    console.log('\nEste script escribe en producción y dispara un ajuste de inventario en SAP.');
    console.log('Para usarlo hay que pedirlo explícitamente con --productivo.');
    console.log('  node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K');
    console.log('\nPara sólo MIRAR quién firmó un documento, sin escribir nada:');
    console.log('  node scripts/confirmar-redlink.js --productivo --quien=N\n');
    return 2;
  }
  // --quien SOLO LEE: ni pide la cantidad ni exige las credenciales de
  // escritura, porque no va a escribir nada.
  if (a.quien) {
    const b0 = await buscarPorFolio(a.quien, a.dias, a.tramo, eco);
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
    console.log('  etapa                  ' + ((doc0.formMetapa || {}).nombre || '(vacía)'));
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

  const b = await buscarPorFolio(a.folio, a.dias, a.tramo, eco);
  console.log('  histórico: ' + b.total.toLocaleString('es-CL') + ' operaciones en ' +
              b.tramos + ' de ' + b.deTramos + ' tramos');
  if (!b.filas.length) { console.log('\nEl folio ' + a.folio + ' no aparece en ' + a.dias + ' días. Prueba --dias mayor.\n'); return 2; }
  if (b.filas.length > 1) { console.log('\nEl folio ' + a.folio + ' cae en ' + b.filas.length + ' operaciones. No se elige una.\n'); return 2; }

  const id = b.filas[0].formHeaderiD;
  if (!id) { console.log('\nEl registro no trae formHeaderiD: sin el id no se puede escribir.\n'); return 2; }

  const antes = await leerDocumento(id);
  const plan = planDeConfirmacion(antes, a.cantidad, null, { sinFirma: a.sinFirma, sinAvanzar: a.sinAvanzar });
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

  if (a.sinFirma || a.sinAvanzar) {
    console.log('');
    console.log('  AISLANDO UNA VARIABLE — este cuerpo no es el definitivo:');
    avisosDeAislamiento(a, firmaDe(antes).nombre).forEach(l => console.log(l));
  }

  if (!a.si) {
    console.log('\n  No mandé nada. Agrega --si para confirmar.');
    console.log('  Esto escribe en Redlink y mueve inventario en SAP.\n');
    return 0;
  }

  const res = await pedir('/api/FormHeader', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan.cuerpo)
  }, 'escritura');       // la escritura SI va firmada por M3LinkSystem
  const cl = sonda.clasificar(res.status, res.texto);
  console.log('\n  PATCH /api/FormHeader  ->  HTTP ' + res.status + '  ·  ' + cl.dice);
  const cuerpo = sonda.enmascarar(res.texto || '').trim();
  if (cuerpo) console.log('  respuesta: ' + cuerpo.slice(0, 300).replace(/\s+/g, ' '));

  const despues = await leerDocumento(id);
  const cambios = comparar(antes, despues);
  console.log('');
  if (!cambios.length) {
    console.log('  El documento NO cambió. Un 200 sin cambios no es una confirmación.');
  } else {
    console.log('  Qué cambió en el documento:');
    cambios.forEach(c => console.log('    ' + c.campo + ': ' + JSON.stringify(c.antes) + '  ->  ' + JSON.stringify(c.despues)));
    const etapa = (despues.formMetapa || {}).nombre || '';
    console.log('');
    console.log(/confirmada/i.test(etapa)
      ? '  CONFIRMADA. Verificar en el portal y revisar que el ajuste en SAP se haya generado.'
      : '  Cambió, pero la etapa quedó en "' + etapa + '". Revisar antes de repetir.');
  }

  // La firma se revisa SIEMPRE, haya cambiado el documento o no: un id
  // equivocado no da error, graba otro usuario y se queda callado.
  if (a.sinFirma) {
    const f = firmaDe(despues);
    console.log('');
    console.log('  Firma: se mandó SIN firma a propósito; quedó ' +
                (f.id === null ? '(vacío)' : f.id) + ' / "' + (f.nombre || '(vacío)') + '"');
    console.log('');
    return 0;
  }
  const v = veredictoDeFirma(despues);
  console.log('');
  console.log(v.ok ? '  Firma: ' + v.dice : '  FIRMA MAL: ' + v.dice);
  console.log('');
  return v.ok ? 0 : 1;
}

module.exports = { revisarCredenciales, USUARIOS, ETAPAS_CONFIRMABLES, etapaConfirmable, etapaDe, firmaDe, porQueNoHayJson, leerCuerpo,
  USERSID_M3LINK, NOMBRE_M3LINK, veredictoDeFirma, avisosDeAislamiento, tramosHaciaAtras, buscarPorFolio, planDeConfirmacion, comparar, leerArgs, esConfirmada, CAMPOS_ESTADO, aUS };

if (require.main === module) {
  main().then(c => { process.exitCode = c || 0; }).catch(e => {
    console.error('\n' + sonda.enmascarar(sonda.describirError(e)) + '\n');
    process.exitCode = 2;
  });
}
