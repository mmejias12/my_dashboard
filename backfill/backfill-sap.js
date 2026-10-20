// ============================================================================
//  backfill/backfill-sap.js  ·  M3DATA · extractor del Service Layer de SAP B1
//
//  POR QUE ES GENERICO Y NO UN SCRIPT DE TRANSFERENCIAS
//  El hallazgo del 19-10-2026 fue que StockTransfers (OWTR/WTR1) responde con
//  las credenciales que YA estan en Application Settings, sin la credencial
//  _RO que seguimos esperando. Pero transferencias es un dominio de varios: el
//  cuadre de stock que hoy consumen stocks-unificado y stock-calendario mezcla
//  emisiones, retiros y devoluciones, que en SAP son OTROS tipos de documento
//  (DeliveryNotes, InventoryGenEntries, InventoryGenExits). Un script por
//  entidad serian cuatro copias del mismo codigo; este toma la entidad como
//  parametro y sirve para las ocho de la lista blanca.
//
//  QUE ESCRIBE
//  Un blob por MES en el contenedor redtec-os-sap, prefijo por entidad:
//      <entidad en minuscula>/YYYY-MM.json
//  Mismo criterio que la cartola: son volumenes chicos (ORDR son 12.562 filas
//  en cuatro anios) y la facturacion se razona por periodo, asi que unas
//  decenas de archivos se leen mucho mas rapido que miles de archivitos.
//
//  POR QUE PROYECTA EN LOCAL EN VEZ DE PEDIR $select/$expand
//  El Service Layer de B1 habla un OData antiguo y el $select anidado dentro
//  de un $expand no es confiable entre versiones. Pedir el documento completo
//  y recortar aca no tiene riesgo de dialecto, y de paso captura TODOS los
//  campos de usuario (los U_*) sin tener que enumerarlos: justamente ahi vive
//  lo propio de REDTEC — U_HX_RD_DocNum es el folio del portal y
//  U_HX_RD_TarifaCli es la tarifa estampada en el documento.
//
//  CREDENCIALES SOLO POR ENTORNO, falla cerrado nombrando la que falta y
//  nunca su valor:
//      SAP_LOGIN_URL  https://<host>:50000/b1s/v2/Login
//      SAP_USER · SAP_PASS · SAP_DB
//      OS_STORAGE_CONN
//
//  Uso (PowerShell):
//    cd "...\Documents\GitHub\my_dashboard"
//    npm i @azure/storage-blob --no-save
//    $env:SAP_LOGIN_URL="..."; $env:SAP_USER="..."; $env:SAP_PASS="..."
//    $env:SAP_DB="CLPRDREDTEC"; $env:OS_STORAGE_CONN="..."
//
//    node backfill/backfill-sap.js --probar
//        Preflight: resuelve la raiz, hace login, pide UNA pagina y reporta.
//        CORRERLO PRIMERO. El host de SAP esta publicado en el puerto 50000 y
//        la Function de Azure llega, pero no esta dicho que llegue cualquier
//        maquina: si hay allowlist de IP, esto lo dice en 10 segundos en vez
//        de fallar a la mitad de un barrido.
//
//    node backfill/backfill-sap.js --entidad=StockTransfers 2026-01 2026-10
//    node backfill/backfill-sap.js --entidad=Orders --frescos=2
//    node backfill/backfill-sap.js --entidad=StockTransfers --forzar
// ============================================================================
'use strict';

const https = require('https');
const { URL } = require('url');
// @azure/storage-blob se carga PEREZOSAMENTE, dentro de cliente(). Dos razones:
// el preflight --probar no toca el storage y asi corre sin tener que instalar
// nada, y las pruebas pueden requerir este archivo sin la dependencia.

// El host de SAP usa certificado autofirmado, igual que ya asume
// api/sap-stock-proxy. Queda acotado a este agente y a este host.
const agente = new https.Agent({ rejectUnauthorized: false });

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';

// Las MISMAS ocho de ENTIDADES_SONDA en api/sap-stock-proxy. No se amplia por
// aca: si alguna vez hay que agregar una, se agrega alla y se refleja aqui,
// para que no existan dos listas blancas que puedan divergir.
const ENTIDADES = [
  'DeliveryNotes', 'Invoices', 'PurchaseDeliveryNotes', 'PurchaseInvoices',
  'Orders', 'InventoryGenExits', 'InventoryGenEntries', 'StockTransfers',
];

// Campos de cabecera que se conservan si vienen. La lista es deliberadamente
// comun a los tipos de documento; lo especifico de cada uno entra por los U_*.
const CAB = [
  'DocEntry', 'DocNum', 'DocDate', 'TaxDate', 'DueDate', 'CreationDate',
  'CreateDate', 'UpdateDate', 'CardCode', 'CardName', 'Comments', 'JournalMemo',
  'FromWarehouse', 'ToWarehouse', 'ShipToCode', 'FolioNumber', 'VehiclePlate',
  'DocumentStatus', 'DocTotal', 'DocCurrency', 'DocRate', 'Series', 'BPLID',
];

// Campos de linea que se conservan si vienen.
const LIN = [
  'LineNum', 'ItemCode', 'ItemDescription', 'Dscription', 'Quantity',
  'WarehouseCode', 'FromWarehouseCode', 'Price', 'PriceAfterVAT',
  'PriceBefDiscount', 'LineTotal', 'U_HX_RD_TarifaCli',
];

const args   = process.argv.slice(2);
const flag   = n => args.some(a => a === '--' + n);
const opcion = (n, def) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : def; };
const meses  = args.filter(a => /^\d{4}-\d{2}(-\d{2})?$/.test(a)).map(a => a.slice(0, 7));

const ENTIDAD = opcion('entidad', 'StockTransfers');
const CAMPO_FECHA = opcion('fecha', 'DocDate');
const PAGINA  = Math.max(20, parseInt(opcion('pagina', '200'), 10) || 200);
const FORZAR  = flag('forzar');
const CRUDO   = flag('crudo');
// Los meses recientes se rehacen siempre: UpdateDate viene poblado, o sea el
// documento se puede modificar despues de cerrado el mes. Mismo criterio que
// los 2 meses de la cartola y la ventana de 45 dias de operaciones.
const FRESCOS = Math.max(0, parseInt(opcion('frescos', '2'), 10) || 0);

const fmt  = n => Number(n).toLocaleString('es-CL');
const dosD = n => String(n).padStart(2, '0');

function faltanVars(extra) {
  const req = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].concat(extra || []);
  return req.filter(k => !process.env[k]);
}

function listarMeses(desde, hasta) {
  const out = [];
  let [a, m] = desde.split('-').map(Number);
  const [aF, mF] = hasta.split('-').map(Number);
  while (a < aF || (a === aF && m <= mF)) { out.push(a + '-' + dosD(m)); m++; if (m > 12) { m = 1; a++; } }
  return out;
}
function finDeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return mes + '-' + dosD(new Date(Date.UTC(a, m, 0)).getUTCDate());
}

// ── HTTP contra el Service Layer ────────────────────────────────────────────
function pedirHttp(metodo, url, cabeceras, cuerpo) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: metodo, hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, headers: Object.assign({}, cabeceras),
      agent: agente, timeout: 120000,
    };
    let body = null;
    if (cuerpo) {
      body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(opts, res => {
      const t = [];
      res.on('data', c => t.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(t).toString('utf8');
        let json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* se reporta como texto */ }
        resolve({ status: res.statusCode, headers: res.headers, body: txt, json });
      });
    });
    req.on('error', e => reject(Object.assign(e, { reintentable: true })));
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('Timeout 120s contra SAP'), { reintentable: true })); });
    if (body) req.write(body);
    req.end();
  });
}

// La raiz de datos se deduce de la URL de login: .../b1s/v2/Login -> .../b1s/v1
function raizDatos(login) {
  let raiz = login.replace(/\/b1s\/v\d+\/Login\/?$/i, '/b1s/v1');
  if (raiz !== login) return raiz;
  const i = login.toLowerCase().indexOf('/b1s/');
  if (i < 0) throw new Error('SAP_LOGIN_URL no parece del Service Layer: falta /b1s/');
  return login.slice(0, i) + '/b1s/v1';
}

function crearSesion() {
  let actual = null;
  async function login() {
    const r = await pedirHttp('POST', process.env.SAP_LOGIN_URL, { Accept: 'application/json' }, {
      CompanyDB: process.env.SAP_DB, UserName: process.env.SAP_USER, Password: process.env.SAP_PASS,
    });
    if (r.status !== 200) throw new Error('Login SAP HTTP ' + r.status + ' ' + String(r.body).slice(0, 200));
    let id = null, routeId = null;
    (r.headers['set-cookie'] || []).forEach(c => {
      const a = c.match(/B1SESSION=([^;]+)/); if (a) id = a[1];
      const b = c.match(/ROUTEID=([^;]+)/);   if (b) routeId = b[1];
    });
    if (!id && r.json && r.json.SessionId) id = r.json.SessionId;
    if (!id) throw new Error('Login OK pero sin B1SESSION');
    actual = { id, routeId };
    return actual;
  }
  function cookie() { return 'B1SESSION=' + actual.id + (actual.routeId ? '; ROUTEID=' + actual.routeId : ''); }
  // Una sesion de B1 dura ~30 min. En vez de llevar el reloj, se reacciona al
  // 401: es lo unico que de verdad dice que vencio.
  async function get(url) {
    if (!actual) await login();
    let r = await pedirHttp('GET', url, {
      Cookie: cookie(), Accept: 'application/json',
      Prefer: 'odata.maxpagesize=' + PAGINA,
    });
    if (r.status === 401) {
      await login();
      r = await pedirHttp('GET', url, {
        Cookie: cookie(), Accept: 'application/json',
        Prefer: 'odata.maxpagesize=' + PAGINA,
      });
    }
    return r;
  }
  return { login, get };
}

// ── proyeccion: documento completo -> una fila por linea ────────────────────
function soloPresentes(obj, claves) {
  const o = {};
  for (const k of claves) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}
function camposUsuario(obj) {
  const o = {};
  for (const k of Object.keys(obj)) {
    if (k.indexOf('U_') !== 0) continue;
    const v = obj[k];
    if (v === null || typeof v === 'object') continue;   // los U_ son escalares
    o[k] = v;
  }
  return o;
}
/** Encuentra el arreglo de lineas sin saber como se llama en esta entidad
 *  (StockTransferLines, DocumentLines, ...). Medido: la sonda de StockTransfers
 *  devolvio las lineas en StockTransferLines con 47 campos. */
function nombreLineas(doc) {
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null) return k;
  }
  return null;
}
function aplanar(doc) {
  const cab = Object.assign(soloPresentes(doc, CAB), camposUsuario(doc));
  const nk = nombreLineas(doc);
  const lineas = nk ? doc[nk] : [];
  if (!lineas.length) return [Object.assign({ _sin_lineas: true }, cab)];
  return lineas.map(l => Object.assign({}, cab, soloPresentes(l, LIN), camposUsuario(l), { _linea: nk }));
}

// ── storage ─────────────────────────────────────────────────────────────────
function cliente() {
  const { BlobServiceClient } = require('@azure/storage-blob');
  return BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);
}
// "No existe" se reconoce por CODIGO, nunca por el texto: el SDK manda
// code='BlobNotFound' con un message amistoso. Esto ya mordio una vez.
function esNoExiste(e) {
  if (!e) return false;
  if (e.statusCode === 404) return true;
  const code = String(e.code || (e.details && e.details.errorCode) || '');
  if (code === 'BlobNotFound' || code === 'ContainerNotFound') return true;
  return /BlobNotFound|ContainerNotFound|specified (blob|container) does not exist/i.test(String(e.message || ''));
}
async function existeBlob(cc, nombre) {
  try { await cc.getBlobClient(nombre).getProperties(); return true; }
  catch (e) { if (esNoExiste(e)) return false; throw e; }
}
async function escribirJson(cc, nombre, obj) {
  const body = JSON.stringify(obj);
  await cc.getBlockBlobClient(nombre).upload(body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
}

// ── un mes, paginando con $skip/$top explicito ─────────────────────
//
// LA PRIMERA VERSION SEGUIA @odata.nextLink Y TRUNCO EN SILENCIO.
// Medido el 19-10-2026: septiembre devolvio 200 documentos en UNA pagina con
// --pagina=200. Que el total calce exacto con el tamano de pagina no es
// coincidencia: el Service Layer de B1 es OData v3, donde la clave de
// continuacion es "odata.nextLink" SIN arroba, asi que leer
// r.json['@odata.nextLink'] (que es la forma de OData v4) daba undefined y el
// bucle se creia terminado. El mes quedaba cortado al primer lote y el blob se
// escribia igual, sin un solo aviso. Es el mismo vicio que ya nos mordio en
// cold-operaciones.js: confundir "no hay mas" con "no supe preguntar".
//
// El arreglo no es cambiar la clave: es no depender de ella. Se pagina con
// $skip/$top sobre un orden ESTABLE y UNICO (DocEntry asc), que es
// deterministico y no depende del dialecto.
//
// Y queda imposible truncar en silencio: cuando una pagina viene CORTA, eso
// puede ser el final de verdad o un tope del servidor mas chico que el $top
// pedido. Son cosas distintas y se distinguen preguntando: una sonda de una
// fila con $skip detras de lo ya traido. Si vuelve vacia, era el final; si
// vuelve con algo, el servidor topea ahi y se sigue con ese paso.
async function traerMes(ses, raiz, mes) {
  const d = mes + '-01', h = finDeMes(mes);
  const filtro = CAMPO_FECHA + " ge '" + d + "' and " + CAMPO_FECHA + " le '" + h + "'";
  const base = raiz + '/' + ENTIDAD
             + '?$filter=' + encodeURIComponent(filtro)
             + '&$orderby=' + encodeURIComponent('DocEntry asc');

  async function pagina(top, skip) {
    const r = await ses.get(base + '&$top=' + top + '&$skip=' + skip);
    if (r.status !== 200) {
      throw Object.assign(new Error('SAP ' + r.status + ' en ' + ENTIDAD + ' ' + mes +
        ' (skip ' + skip + ') :: ' + String(r.body).slice(0, 200)),
        { reintentable: r.status === 429 || r.status >= 500 });
    }
    return (r.json && r.json.value) || [];
  }

  const docs = [];
  let paso = PAGINA, skip = 0, pedidos = 0;
  for (;;) {
    const val = await pagina(paso, skip);
    pedidos++;
    docs.push.apply(docs, val);
    if (!val.length) break;

    if (val.length < paso) {
      // Pagina corta: final de verdad o tope del servidor. Se pregunta.
      const sonda = await pagina(1, skip + val.length);
      pedidos++;
      if (!sonda.length) break;          // era el final
      paso = val.length;                 // el servidor topea aca
    }
    skip += val.length;
    if (pedidos > 5000) throw new Error('Mas de 5000 peticiones en ' + mes + ': revisar el orden o el filtro');
  }
  return { docs, pedidos, paso, desde: d, hasta: h };
}
async function conReintentos(fn) {
  let ultimo = null;
  for (let i = 1; i <= 3; i++) {
    try { return await fn(); }
    catch (e) { ultimo = e; if (!e.reintentable) break; await new Promise(r => setTimeout(r, 800 * i * i)); }
  }
  throw ultimo;
}

// ── preflight ───────────────────────────────────────────────────────────────
async function probar() {
  const faltan = faltanVars();
  if (faltan.length) { console.error('Faltan variables de entorno: ' + faltan.join(', ')); process.exit(1); }
  const raiz = raizDatos(process.env.SAP_LOGIN_URL);
  console.log('Raiz de datos : ' + raiz);
  console.log('Base          : ' + process.env.SAP_DB);
  const ses = crearSesion();
  const t0 = Date.now();
  await ses.login();
  console.log('Login         : OK en ' + (Date.now() - t0) + ' ms');
  const r = await ses.get(raiz + '/' + ENTIDAD + '?$top=1&$orderby=' + encodeURIComponent('DocEntry desc'));
  console.log('Entidad       : ' + ENTIDAD + ' -> HTTP ' + r.status);
  if (r.status !== 200) { console.error('Detalle: ' + String(r.body).slice(0, 400)); process.exit(1); }
  const doc = ((r.json && r.json.value) || [])[0];
  if (!doc) { console.log('Respondio 200 pero sin documentos. Probar sin filtro o con otra entidad.'); return; }
  const filas = aplanar(doc);
  console.log('Documento     : DocNum ' + doc.DocNum + '  ' + String(doc.DocDate).slice(0, 10) +
              '  ' + (doc.CardName || '(sin BP)'));
  console.log('Lineas        : ' + (nombreLineas(doc) || '(ninguna)') + '  ->  ' + filas.length + ' fila(s)');
  console.log('Campos U_     : ' + Object.keys(camposUsuario(doc)).length + ' en cabecera');
  console.log('\nPrimera fila proyectada:');
  console.log(JSON.stringify(filas[0], null, 2).slice(0, 1200));
}

// ── main ────────────────────────────────────────────────────────────────────
// Va detras de require.main a proposito: asi el archivo se puede requerir
// desde las pruebas sin que arranque el barrido ni llame a process.exit.
// Mismo patron que backfill-operaciones.js, que exporta recolectar() para
// poder probarse sin red.
async function main() {
  if (ENTIDADES.indexOf(ENTIDAD) < 0) {
    console.error('Entidad no permitida: ' + ENTIDAD + '\nPermitidas: ' + ENTIDADES.join(', '));
    process.exit(1);
  }
  if (flag('probar')) return probar();

  const faltan = faltanVars(['OS_STORAGE_CONN']);
  if (faltan.length) { console.error('Faltan variables de entorno: ' + faltan.join(', ')); process.exit(1); }

  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const mesActual = hoy.getFullYear() + '-' + dosD(hoy.getMonth() + 1);
  const DESDE = meses[0] || '2023-01';
  const HASTA = meses[1] || mesActual;

  const raiz = raizDatos(process.env.SAP_LOGIN_URL);
  const ses  = crearSesion();
  const cc   = cliente();
  await cc.createIfNotExists();

  const todos  = listarMeses(DESDE, HASTA);
  const lista  = todos.slice().reverse();                 // del mas nuevo al mas viejo
  const frescos = new Set(todos.slice(-FRESCOS));
  const PREF = ENTIDAD.toLowerCase() + '/';

  console.log('Extractor SAP · ' + ENTIDAD + ' · ' + lista.length + ' meses · ' + HASTA + ' -> ' + DESDE);
  console.log('Raiz ' + raiz + ' · destino ' + CONT + '/' + PREF +
              ' · pagina ' + PAGINA + (FRESCOS ? ' · rehace los ultimos ' + FRESCOS + ' meses' : '') + '\n');

  const t0 = Date.now();
  let hechos = 0, saltados = 0, totDocs = 0, totFilas = 0;
  const avisos = [];

  for (const mes of lista) {
    const nombre = PREF + mes + '.json';
    if (!FORZAR && !frescos.has(mes) && await existeBlob(cc, nombre)) { saltados++; continue; }

    const tm = Date.now();
    let res;
    try { res = await conReintentos(() => traerMes(ses, raiz, mes)); }
    catch (e) { avisos.push(mes + ': ' + String(e.message).slice(0, 160)); console.log('  ' + mes + '  ⚠ ' + String(e.message).slice(0, 90)); continue; }

    const filas = [];
    for (const d of res.docs) filas.push.apply(filas, aplanar(d));

    // Control de cordura: que lo devuelto caiga DENTRO del mes pedido. Si el
    // filtro de fecha no se aplicara (ya nos paso con RDTOut, que ignoraba el
    // 'hasta'), esto lo grita en vez de dejarlo pasar en silencio.
    const dias = new Set(res.docs.map(d => String(d[CAMPO_FECHA] || '').slice(0, 10)).filter(Boolean));
    const fuera = [...dias].filter(x => x.slice(0, 7) !== mes);
    if (fuera.length) avisos.push(mes + ': ' + fuera.length + ' dia(s) fuera del mes pedido (' + fuera.slice(0, 3).join(', ') + ')');

    const tipos = {};
    let cantidad = 0;
    for (const f of filas) {
      const k = String(f.U_HX_RD_TransType || f.U_IndTraslado || '(sin tipo)').trim();
      tipos[k] = (tipos[k] || 0) + 1;
      cantidad += Number(f.Quantity) || 0;
    }

    const payload = {
      entidad: ENTIDAD, mes, desde: res.desde, hasta: res.hasta, campo_fecha: CAMPO_FECHA,
      filas,
      _docs: res.docs.length, _filas: filas.length, _peticiones: res.pedidos, _paso: res.paso,
      _tipos: tipos, _cantidad: Math.round(cantidad),
      _guardado: new Date().toISOString(),
      _fuente: raiz + '/' + ENTIDAD,
    };
    if (CRUDO) payload._crudo = res.docs;

    await escribirJson(cc, nombre, payload);
    hechos++; totDocs += res.docs.length; totFilas += filas.length;
    // Se imprimen los TIPOS porque es la senal de cordura que de verdad sirve:
    // dice de una si los conceptos que trae SAP son los mismos de la cartola.
    const topTipos = Object.keys(tipos).sort((a, b) => tipos[b] - tipos[a]).slice(0, 4)
      .map(k => k + ' ' + fmt(tipos[k])).join(' | ');
    console.log('  ' + mes + '  ' + String(res.docs.length).padStart(6) + ' docs  ' +
      String(filas.length).padStart(7) + ' filas  ' + String(res.pedidos).padStart(3) + ' req  ' +
      'cant ' + fmt(Math.round(cantidad)) + '  ' + ((Date.now() - tm) / 1000).toFixed(1) + 's');
    if (topTipos) console.log('          ' + topTipos);
  }

  console.log('\n✓ Listo · ' + ENTIDAD);
  console.log('  Meses escritos : ' + fmt(hechos) + '   (saltados por ya estar: ' + fmt(saltados) + ')');
  console.log('  Documentos     : ' + fmt(totDocs));
  console.log('  Filas          : ' + fmt(totFilas));
  console.log('  Tiempo         : ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (avisos.length) { console.log('\n⚠  Avisos:'); avisos.slice(0, 20).forEach(a => console.log('   - ' + a)); }
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}

module.exports = {
  aplanar, nombreLineas, camposUsuario, listarMeses, finDeMes, raizDatos,
  traerMes, ENTIDADES, CAB, LIN,
};
