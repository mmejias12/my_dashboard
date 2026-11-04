// ============================================================================
//  backfill/respaldo-cold.js  ·  Copia de seguridad de UN día del cold store
//
//  POR QUÉ EXISTE. backfill-operaciones.js reescribe el blob del día COMPLETO
//  (guardarDia sobrescribe), así que repararlo es destructivo por diseño: si
//  Redlink hoy devuelve menos filas que las que el blob ya tiene, la corrida
//  deja el día peor que antes y no hay vuelta atrás. Esto saca la copia antes.
//
//  Guarda en el MISMO contenedor, bajo respaldo/<fecha>-<sello>.json, para no
//  depender de que exista otro contenedor ni de permisos nuevos. El prefijo
//  'respaldo/' no lo lee nadie: cold-operaciones.js sólo mira 'operaciones/'.
//
//  Uso:
//    node backfill/respaldo-cold.js 2024-02-13
//    node backfill/respaldo-cold.js 2024-02-13 2025-02-17     (varios días)
//
//  Variables: OS_STORAGE_CONN (obligatoria), OS_OPS_HIST_CONTAINER si el
//  contenedor no es el de siempre.
//
//  Para volver atrás, el camino es manual y a propósito: bajar el respaldo y
//  subirlo como operaciones/<fecha>.json. No hay un --restaurar porque una
//  restauración a ciegas es justo lo que no se quiere tener a mano.
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_OPS_HIST_CONTAINER || 'redtec-os-operaciones';
const PREFIJO   = 'operaciones/';
const RESPALDO  = 'respaldo/';

const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const sello = (d) => (d || new Date()).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

async function aTexto(readable) {
  const trozos = [];
  for await (const c of readable) trozos.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(trozos).toString('utf8');
}

function contenedor() {
  if (!CONN) throw new Error('Falta OS_STORAGE_CONN');
  return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
}

// Devuelve { fecha, origen, destino, bytes } o { fecha, sin_blob: true }.
async function respaldar(fecha, opts) {
  opts = opts || {};
  if (!esFecha(fecha)) throw new Error('fecha inválida: ' + fecha);
  const cont  = opts.container !== undefined ? opts.container : contenedor();
  const leer  = opts.leer   || (async (nombre) => {
    const dl = await cont.getBlobClient(nombre).download();
    return aTexto(dl.readableStreamBody);
  });
  const subir = opts.subir || (async (nombre, cuerpo) =>
    cont.getBlockBlobClient(nombre).upload(cuerpo, Buffer.byteLength(cuerpo),
      { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }));

  const origen = PREFIJO + fecha + '.json';
  let cuerpo;
  try { cuerpo = await leer(origen); }
  catch (e) {
    const cod = String((e && e.code) || (e && e.details && e.details.errorCode) || '');
    if (e && (e.statusCode === 404 || cod === 'BlobNotFound' || cod === 'ContainerNotFound' ||
              /BlobNotFound|ContainerNotFound|does not exist/i.test(String(e.message || ''))))
      return { fecha, sin_blob: true };
    throw e;
  }
  const destino = RESPALDO + fecha + '-' + sello(opts.ahora) + '.json';
  await subir(destino, cuerpo);
  return { fecha, origen, destino, bytes: Buffer.byteLength(cuerpo) };
}

module.exports = { respaldar, sello, CONTAINER, PREFIJO, RESPALDO };

if (require.main === module) (async () => {
  const dias = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!dias.length) { console.error('Uso: node backfill/respaldo-cold.js AAAA-MM-DD [AAAA-MM-DD ...]'); process.exit(2); }
  const malas = dias.filter(d => !esFecha(d));
  if (malas.length) { console.error('Fecha(s) inválida(s): ' + malas.join(' ')); process.exit(2); }
  if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  let sinBlob = 0;
  for (const d of dias) {
    const r = await respaldar(d);
    if (r.sin_blob) { sinBlob++; console.log('  ' + d + '  sin blob en el cold: nada que respaldar'); }
    else console.log('  ' + d + '  → ' + r.destino + '  (' + Number(r.bytes).toLocaleString('es-CL') + ' bytes)');
  }
  console.log(sinBlob === dias.length ? '\nNo se respaldó nada.' : '\n✓ Respaldo listo');
})().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
