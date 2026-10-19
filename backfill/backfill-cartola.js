// ============================================================================
//  backfill/backfill-cartola.js  ·  M3DATA · RESCATE de la cartola diaria
//
//  Qué es y por qué importa: la cartola NO es un registro de operaciones, es el
//  LIBRO DE FACTURACIÓN. Trae cardCode/cardName (código de Business Partner de
//  SAP), el concepto facturado, la cantidad devengada y la plata (tarifaUF,
//  netoUF, netoCLP). Nada de eso existe en Redlink: ahí el precio viene en cero.
//  O sea este dominio NO se puede reemplazar con la API del portal — su origen
//  es SAP, o el proveedor calculándolo. Mientras esa fuente se destraba, lo que
//  sí podemos hacer hoy es quedarnos con el histórico antes de que se vaya.
//
//  Y hay una razón de fondo para hacerlo AHORA: si algún día REDTEC calcula su
//  propia cartola (operaciones propias + maestro de tarifas + reglas de devengo),
//  la ÚNICA manera de demostrar que el cálculo está bien es compararlo contra la
//  cartola real. Esa referencia desaparece cuando se dé de baja el proveedor.
//  Rescatarla ahora preserva para siempre la capacidad de validar.
//
//  Barato, al revés del historial: este endpoint SÍ acepta rango, así que va por
//  MESES — un mes medido son 5.225 filas en 1,2 s. Los ~4 años son ~48 llamadas.
//
//  Por qué un blob por MES y no por día: son pocas filas (~170 al día) y la
//  facturación se razona por período, así que 48 archivos se leen mucho más
//  rápido que 1.400 archivitos. El histórico completo cabe en unos pocos MB.
//
//  Uso (PowerShell):
//    cd "...\Documents\GitHub\my_dashboard"
//    npm i @azure/storage-blob --no-save
//    $env:OS_STORAGE_CONN = "<cadena del storage redtecos>"
//    $env:REDTEC_API_KEY  = "<llave de RDT>"
//    node backfill/backfill-cartola.js                  # 2023-01 -> mes actual
//    node backfill/backfill-cartola.js 2026-01 2026-12  # un rango de meses
//    node backfill/backfill-cartola.js --forzar         # reescribe todo
// ============================================================================
'use strict';

const https = require('https');
const { BlobServiceClient } = require('@azure/storage-blob');

// credenciales SÓLO por entorno, falla cerrado
const CONN    = process.env.OS_STORAGE_CONN;
const API_KEY = process.env.REDTEC_API_KEY;

const API_HOST = process.env.OS_OPS_HOST_RDT || 'apirdt1.azurewebsites.net';
const API_PATH = '/api/RDTOut/cartolasdiariasxrangofechas';

const CONT = process.env.OS_CARTOLA_CONTAINER || 'redtec-os-cartola';
const PREF = 'cartola/';

const args = process.argv.slice(2);
const flag = n => args.some(a => a === '--' + n);
const opcion = (n, def) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : def; };
// acepta YYYY-MM o YYYY-MM-DD
const meses = args.filter(a => /^\d{4}-\d{2}(-\d{2})?$/.test(a)).map(a => a.slice(0, 7));
const FORZAR = flag('forzar');
// Los últimos meses se reescriben siempre: la facturación admite ajustes tardíos
// (fechaFacturacion va después de fecha), así que un mes recién cerrado todavía
// se puede mover. Mismo criterio que la ventana de 45 días del backfill de ops.
const MESES_FRESCOS = Math.max(0, parseInt(opcion('frescos', '2'), 10) || 0);

const fmt = n => Number(n).toLocaleString('es-CL');
const dosD = n => String(n).padStart(2, '0');

function listarMeses(desde, hasta) {
  const out = [];
  let [a, m] = desde.split('-').map(Number);
  const [aF, mF] = hasta.split('-').map(Number);
  while (a < aF || (a === aF && m <= mF)) {
    out.push(a + '-' + dosD(m));
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}
function finDeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return mes + '-' + dosD(new Date(Date.UTC(a, m, 0)).getUTCDate());
}

// ── storage ─────────────────────────────────────────────────────────────────
function cliente() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONT); }
// "No existe" se reconoce por CÓDIGO, nunca por el texto del mensaje: el SDK manda
// code='BlobNotFound' pero message="The specified blob does not exist."
function esNoExiste(e) {
  if (!e) return false;
  if (e.statusCode === 404) return true;
  const code = String(e.code || e.details && e.details.errorCode || '');
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

// ── una llamada por mes, con reintentos ─────────────────────────────────────
function pedirCartola(desde, hasta) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST, port: 443, method: 'GET',
      path: API_PATH + '?desde=' + desde + '&hasta=' + hasta,
      headers: { Accept: 'application/json', 'X-Api-Key': API_KEY }
    }, res => {
      const t = [];
      res.on('data', c => t.push(c));
      res.on('end', () => {
        const cuerpo = Buffer.concat(t).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { const j = JSON.parse(cuerpo); resolve(Array.isArray(j) ? j : (j ? [j] : [])); }
          catch (e) { reject(Object.assign(new Error('JSON inválido'), { reintentable: false })); }
        } else {
          reject(Object.assign(new Error('HTTP ' + res.statusCode + ' ' + cuerpo.slice(0, 120)),
            { reintentable: res.statusCode === 429 || res.statusCode >= 500 }));
        }
      });
    });
    req.on('error', e => reject(Object.assign(e, { reintentable: true })));
    req.setTimeout(60000, () => { req.destroy(); reject(Object.assign(new Error('Timeout'), { reintentable: true })); });
    req.end();
  });
}
async function conReintentos(d, h) {
  let ultimo = null;
  for (let i = 1; i <= 3; i++) {
    try { return await pedirCartola(d, h); }
    catch (e) { ultimo = e; if (!e.reintentable) break; await new Promise(r => setTimeout(r, 600 * i * i)); }
  }
  throw ultimo;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!CONN)    { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  if (!API_KEY) { console.error('Falta REDTEC_API_KEY'); process.exit(1); }

  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const mesActual = hoy.getFullYear() + '-' + dosD(hoy.getMonth() + 1);
  const DESDE = meses[0] || '2023-01';
  const HASTA = meses[1] || mesActual;

  const cc = cliente();
  await cc.createIfNotExists();

  const lista = listarMeses(DESDE, HASTA).reverse();   // del más nuevo al más viejo
  // los N meses más recientes se rehacen siempre (ajustes tardíos de facturación)
  const frescos = new Set(listarMeses(DESDE, HASTA).slice(-MESES_FRESCOS));

  console.log('Rescate de la cartola  ·  ' + lista.length + ' meses  ·  ' + HASTA + ' -> ' + DESDE);
  console.log('Origen ' + API_HOST + '  ·  destino ' + CONT +
              (MESES_FRESCOS ? '  ·  rehace siempre los últimos ' + MESES_FRESCOS + ' meses' : '') + '\n');

  const t0 = Date.now();
  let hechos = 0, saltados = 0, totFilas = 0, totCLP = 0;
  const avisos = [];

  for (const mes of lista) {
    const nombre = PREF + mes + '.json';
    if (!FORZAR && !frescos.has(mes) && await existeBlob(cc, nombre)) { saltados++; continue; }

    const d = mes + '-01', h = finDeMes(mes);
    const tm = Date.now();
    let filas;
    try { filas = await conReintentos(d, h); }
    catch (e) { avisos.push(mes + ': ' + String(e.message).slice(0, 120)); console.log('  ' + mes + '  ⚠ ' + e.message.slice(0, 80)); continue; }

    // control de cordura: que lo devuelto caiga DENTRO del mes pedido
    const dias = new Set(filas.map(f => String(f.fecha || '').slice(0, 10)).filter(Boolean));
    const fuera = [...dias].filter(x => x.slice(0, 7) !== mes);
    if (fuera.length) avisos.push(mes + ': ' + fuera.length + ' día(s) fuera del mes pedido');

    const conceptos = {};
    let clp = 0;
    for (const f of filas) {
      const k = String(f.operacion || '(sin concepto)').trim();
      conceptos[k] = (conceptos[k] || 0) + 1;
      clp += Number(f.netoCLP) || 0;
    }

    await escribirJson(cc, nombre, {
      mes, desde: d, hasta: h,
      filas,
      _filas: filas.length,
      _dias: dias.size,
      _conceptos: conceptos,
      _neto_clp: Math.round(clp),
      _guardado: new Date().toISOString(),
      _fuente: API_HOST + API_PATH
    });

    hechos++; totFilas += filas.length; totCLP += clp;
    console.log('  ' + mes + '  ' + String(filas.length).padStart(6) + ' filas  ' +
      String(dias.size).padStart(2) + ' días  neto $' + fmt(Math.round(clp)) +
      '  ' + ((Date.now() - tm) / 1000).toFixed(1) + 's');
  }

  console.log('\n✓ Listo');
  console.log('  Meses escritos : ' + fmt(hechos) + '   (saltados por ya estar: ' + fmt(saltados) + ')');
  console.log('  Filas          : ' + fmt(totFilas));
  console.log('  Neto CLP total : $' + fmt(Math.round(totCLP)) + '   ← contrastable con Finanzas');
  console.log('  Tiempo         : ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (avisos.length) { console.log('\n⚠  Avisos:'); avisos.slice(0, 20).forEach(a => console.log('   - ' + a)); }
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
