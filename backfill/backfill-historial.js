// ============================================================================
//  backfill/backfill-historial.js  ·  M3DATA · RESCATE del historial por pedido
//
//  Por qué existe, y por qué corre contra el reloj:
//  El historial de RDT (`historialxnropedido`) NO es un dato que Redlink tenga.
//  Es un dato DERIVADO que M2Link fue acumulando: sondea el portal, y cada vez
//  que detecta un cambio escribe una instantánea completa de la operación con su
//  glosa y su fecha. Redlink, en cambio, pisa el registro en su lugar: guarda el
//  estado actual, no el recorrido. Conclusión: cuando M2Link se dé de baja (antes
//  de diciembre de 2026) ese historial NO SE PUEDE RECONSTRUIR desde ninguna otra
//  fuente. Este script lo rescata mientras el API siga viva.
//
//  Cómo encuentra los pedidos: NO hay que descubrirlos. El cold store de
//  operaciones (redtec-os-operaciones) ya tiene todos los folios de 2023 a hoy,
//  un blob por día. Este script recorre ese índice y pide el historial de cada
//  folio. Esa es la ventaja de haber guardado las operaciones primero.
//
//  Trabaja de lo MÁS NUEVO a lo más viejo a propósito: si se acaba el tiempo o
//  el API se cae, lo rescatado es lo que más le importa al negocio.
//
//  Es REANUDABLE a nivel de día: si el blob del día ya está y cubre todos los
//  folios de ese día sin fallas, lo salta. Se puede cortar con Ctrl+C y volver a
//  lanzarlo las veces que haga falta.
//
//  Uso (PowerShell):
//    cd "...\Documents\GitHub\my_dashboard"
//    npm i @azure/storage-blob --no-save
//    $env:OS_STORAGE_CONN = "<cadena del storage redtecos>"
//    $env:REDTEC_API_KEY  = "<llave de RDT>"
//    node backfill/backfill-historial.js                      # todo, nuevo -> viejo
//    node backfill/backfill-historial.js 2026-01-01 2026-12-31  # un año
//    node backfill/backfill-historial.js --conc=12              # más paralelo
//    node backfill/backfill-historial.js --forzar               # reescribe días ya hechos
//
//  OJO con la concurrencia: apirdt1 es del proveedor que se está dando de baja.
//  Por defecto van 8 llamadas en paralelo con una pausa entre lotes. Subirlo
//  acelera, pero no conviene tumbarle el servicio justo ahora.
// ============================================================================
'use strict';

const https = require('https');
const { BlobServiceClient } = require('@azure/storage-blob');

// ── credenciales: SÓLO por entorno. Nunca en el código, nunca por chat. ──────
const CONN    = process.env.OS_STORAGE_CONN;
const API_KEY = process.env.REDTEC_API_KEY;

const API_HOST = process.env.OS_OPS_HOST_RDT || 'apirdt1.azurewebsites.net';
const API_PATH = '/api/RDTOut/historialxnropedido';

const CONT_OPS  = process.env.OS_OPS_CONTAINER || 'redtec-os-operaciones';
const PREF_OPS  = 'operaciones/';
const CONT_HIST = process.env.OS_HISTORIAL_CONTAINER || 'redtec-os-historial';
const PREF_HIST = 'historial/';

const args = process.argv.slice(2);
const flag = n => args.some(a => a === '--' + n);
const opcion = (n, def) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : def;
};
const fechas = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const DESDE = fechas[0] || null;
const HASTA = fechas[1] || null;
const CONC    = Math.max(1, parseInt(opcion('conc', process.env.HIST_CONCURRENCIA || '8'), 10) || 8);
const PAUSA   = Math.max(0, parseInt(opcion('pausa', '120'), 10) || 0);   // ms entre lotes
const FORZAR  = flag('forzar');
const VIEJO_PRIMERO = flag('viejo-primero');

const fmt = n => Number(n).toLocaleString('es-CL');
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ── storage ─────────────────────────────────────────────────────────────────
function cliente(cont) {
  return BlobServiceClient.fromConnectionString(CONN).getContainerClient(cont);
}
// "No existe" hay que reconocerlo por el CÓDIGO, no por el texto: el SDK de Azure
// manda code='BlobNotFound' pero el message es "The specified blob does not exist."
// Mirar sólo el texto hacía reventar la primera corrida, cuando se pregunta si el
// blob del día ya está para poder reanudar — y justamente todavía no está.
function esNoExiste(e) {
  if (!e) return false;
  if (e.statusCode === 404) return true;
  const code = String(e.code || e.details && e.details.errorCode || '');
  if (code === 'BlobNotFound' || code === 'ContainerNotFound') return true;
  return /BlobNotFound|ContainerNotFound|specified (blob|container) does not exist/i.test(String(e.message || ''));
}

async function leerJson(cc, nombre) {
  try {
    const dl = await cc.getBlobClient(nombre).download();
    const trozos = [];
    for await (const c of dl.readableStreamBody) trozos.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return JSON.parse(Buffer.concat(trozos).toString('utf8'));
  } catch (e) {
    if (esNoExiste(e)) return null;
    throw e;   // un error real (red, permisos) NO se disfraza de "día vacío"
  }
}
async function escribirJson(cc, nombre, obj) {
  const body = JSON.stringify(obj);
  await cc.getBlockBlobClient(nombre).upload(body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
}

// ── una llamada al historial, con reintentos ────────────────────────────────
function pedirHistorial(folio) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST, port: 443, method: 'GET',
      path: API_PATH + '?nroPedido=' + encodeURIComponent(folio),
      headers: { Accept: 'application/json', 'X-Api-Key': API_KEY }
    }, res => {
      const trozos = [];
      res.on('data', c => trozos.push(c));
      res.on('end', () => {
        const cuerpo = Buffer.concat(trozos).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(cuerpo)); }
          catch (e) { reject(Object.assign(new Error('JSON inválido'), { reintentable: false })); }
        } else {
          // 429 y 5xx se reintentan; 4xx (salvo 429) no tiene sentido reintentarlos
          const reintentable = res.statusCode === 429 || res.statusCode >= 500;
          reject(Object.assign(new Error('HTTP ' + res.statusCode + ' ' + cuerpo.slice(0, 120)), { reintentable }));
        }
      });
    });
    req.on('error', e => reject(Object.assign(e, { reintentable: true })));
    req.setTimeout(25000, () => { req.destroy(); reject(Object.assign(new Error('Timeout'), { reintentable: true })); });
    req.end();
  });
}

async function historialConReintentos(folio) {
  let ultimo = null;
  for (let intento = 1; intento <= 3; intento++) {
    try { return await pedirHistorial(folio); }
    catch (e) {
      ultimo = e;
      if (!e.reintentable) break;
      await dormir(400 * intento * intento);   // 0,4s · 1,6s
    }
  }
  throw ultimo;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!CONN)    { console.error('Falta OS_STORAGE_CONN');  process.exit(1); }
  if (!API_KEY) { console.error('Falta REDTEC_API_KEY (no se lee de ningún otro lado a propósito)'); process.exit(1); }

  const ccOps  = cliente(CONT_OPS);
  const ccHist = cliente(CONT_HIST);
  await ccHist.createIfNotExists();

  // 1) índice de días desde el cold store de operaciones
  const dias = [];
  for await (const b of ccOps.listBlobsFlat({ prefix: PREF_OPS })) {
    const m = b.name.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    if (DESDE && m[1] < DESDE) continue;
    if (HASTA && m[1] > HASTA) continue;
    dias.push(m[1]);
  }
  dias.sort();
  if (!VIEJO_PRIMERO) dias.reverse();     // lo más nuevo primero, a propósito

  if (!dias.length) { console.log('No hay días que procesar en', CONT_OPS); return; }

  console.log('Rescate del historial por pedido  ·  ' + fmt(dias.length) + ' días  ·  ' +
              dias[0] + ' -> ' + dias[dias.length - 1] +
              (VIEJO_PRIMERO ? '  (viejo primero)' : '  (nuevo primero)'));
  console.log('Origen ' + API_HOST + '  ·  destino ' + CONT_HIST + '  ·  concurrencia ' + CONC + '\n');

  const t0 = Date.now();
  let diasHechos = 0, diasSaltados = 0, totPedidos = 0, totEntradas = 0, totFallidos = 0;

  for (const fecha of dias) {
    const ops = await leerJson(ccOps, PREF_OPS + fecha + '.json');
    const folios = [...new Set((ops && ops.operaciones || [])
      .map(o => o.nroPedido).filter(f => f !== null && f !== undefined && f !== ''))];
    if (!folios.length) { diasSaltados++; continue; }

    // ¿ya está completo? (reanudable)
    if (!FORZAR) {
      const previo = await leerJson(ccHist, PREF_HIST + fecha + '.json');
      if (previo && previo.pedidos) {
        const faltan = folios.filter(f => !(String(f) in previo.pedidos));
        const fallidosPrevios = (previo._fallidos || []).length;
        if (!faltan.length && !fallidosPrevios) {
          diasSaltados++;
          continue;
        }
      }
    }

    const tDia = Date.now();
    const pedidos = {}, fallidos = [];
    let entradas = 0;

    for (let i = 0; i < folios.length; i += CONC) {
      const lote = folios.slice(i, i + CONC);
      const res = await Promise.all(lote.map(f =>
        historialConReintentos(f).then(h => ({ f, h })).catch(e => ({ f, err: e.message }))));
      for (const r of res) {
        if (r.err) { fallidos.push({ folio: r.f, error: String(r.err).slice(0, 160) }); continue; }
        const arr = Array.isArray(r.h) ? r.h : (r.h ? [r.h] : []);
        pedidos[String(r.f)] = arr;
        entradas += arr.length;
      }
      if (PAUSA) await dormir(PAUSA);
    }

    await escribirJson(ccHist, PREF_HIST + fecha + '.json', {
      fecha,
      pedidos,
      _pedidos: Object.keys(pedidos).length,
      _entradas: entradas,
      _fallidos: fallidos,
      _guardado: new Date().toISOString(),
      _fuente: API_HOST + API_PATH
    });

    diasHechos++; totPedidos += Object.keys(pedidos).length;
    totEntradas += entradas; totFallidos += fallidos.length;

    const seg = (Date.now() - tDia) / 1000;
    const restantes = dias.length - (diasHechos + diasSaltados);
    const ritmo = (Date.now() - t0) / 1000 / Math.max(1, diasHechos);
    const eta = restantes * ritmo;
    console.log('  ' + fecha + '  ' + String(Object.keys(pedidos).length).padStart(4) + ' pedidos  ' +
      String(entradas).padStart(5) + ' entradas  ' + seg.toFixed(1) + 's' +
      (fallidos.length ? '  ⚠ ' + fallidos.length + ' fallidos' : '') +
      '   [' + diasHechos + '/' + dias.length + ' · faltan ~' + (eta / 3600).toFixed(1) + ' h]');
  }

  console.log('\n✓ Listo');
  console.log('  Días escritos  : ' + fmt(diasHechos) + '   (saltados por estar completos o vacíos: ' + fmt(diasSaltados) + ')');
  console.log('  Pedidos        : ' + fmt(totPedidos));
  console.log('  Entradas       : ' + fmt(totEntradas));
  console.log('  Fallidos       : ' + fmt(totFallidos) + (totFallidos ? '  (vuelve a correr el script: reintenta sólo los días con fallas)' : ''));
  console.log('  Tiempo         : ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min');
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
