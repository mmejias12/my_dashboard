// ============================================================================
//  seed-snapshot.js  ·  Siembra inicial del read model en Azure Blob.
//  Corre UNA vez para empezar a guardar información ya. Luego la Function
//  os-ingesta lo mantiene fresco por reloj.
//
//  Uso:
//    npm i @azure/storage-blob
//    OS_STORAGE_CONN="<connection string>" node seed-snapshot.js ../os-snapshot.json
// ============================================================================
const fs = require('fs');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
// Azure exige 3-63 caracteres para el nombre de contenedor: 'os' es inválido.
const CONTAINER = process.env.OS_CONTAINER || 'redtec-os';
const BLOB      = process.env.OS_BLOB || 'os-snapshot.json';
const file      = process.argv[2] || path.join(__dirname, '..', 'os-snapshot.json');

(async () => {
  if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  const raw = fs.readFileSync(file, 'utf8');
  const snap = JSON.parse(raw);            // valida que sea JSON
  snap.meta = snap.meta || {};
  snap.meta.generado = snap.meta.generado || new Date().toISOString();
  const body = JSON.stringify(snap, null, 2);

  if (!/^[a-z0-9]([a-z0-9-]{1,61})[a-z0-9]$/.test(CONTAINER)) {
    console.error(`OS_CONTAINER inválido: "${CONTAINER}". Azure exige 3-63 caracteres.`);
    process.exit(1);
  }
  const svc = BlobServiceClient.fromConnectionString(CONN);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  await container.getBlockBlobClient(BLOB).upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
  });

  console.log(`✓ Snapshot sembrado en ${CONTAINER}/${BLOB} (${Buffer.byteLength(body)} bytes)`);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
