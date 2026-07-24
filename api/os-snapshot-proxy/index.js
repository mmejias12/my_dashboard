// ============================================================================
//  api/os-snapshot-proxy  ·  LECTURA del read model
//  Devuelve el snapshot curado (os-snapshot.json) desde Azure Blob Storage.
//  Lo consume buildCtx() en el front (SNAPSHOT_URL = '/api/os-snapshot-proxy').
// ============================================================================
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;                 // connection string
// Azure exige 3-63 caracteres para el nombre de contenedor: 'os' es inválido.
const CONTAINER = process.env.OS_CONTAINER || 'redtec-os';           // contenedor
const BLOB      = process.env.OS_BLOB || 'os-snapshot.json';  // archivo

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Valida el nombre de contenedor antes de llamar a Azure, para dar un error
// entendible en vez del críptico "resource name length is not within limits".
function validarContenedor(nombre) {
  if (!/^[a-z0-9]([a-z0-9-]{1,61})[a-z0-9]$/.test(nombre || '')) {
    throw new Error(
      `OS_CONTAINER inválido: "${nombre}". Azure exige 3-63 caracteres, ` +
      `minúsculas, números o guiones, empezando y terminando en alfanumérico.`
    );
  }
}

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }
  try {
    validarContenedor(CONTAINER);
    const svc = BlobServiceClient.fromConnectionString(CONN);
    const blob = svc.getContainerClient(CONTAINER).getBlobClient(BLOB);
    const dl = await blob.download();
    const body = await streamToString(dl.readableStreamBody);

    context.res = {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        // el snapshot cambia cada pocos minutos: cache corto en el cliente
        'Cache-Control': 'public, max-age=30'
      },
      body // ya es JSON en texto, se devuelve tal cual
    };
  } catch (err) {
    context.log.error('os-snapshot-proxy:', err.message);
    const notFound = /BlobNotFound|ContainerNotFound/.test(err.message);
    context.res = {
      status: notFound ? 404 : 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: notFound ? 'snapshot aún no generado' : 'no se pudo leer el snapshot',
        detail: err.message
      })
    };
  }
};
