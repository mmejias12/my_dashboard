// ============================================================================
//  backfill/backfill-operaciones.js  ·  M3DATA · dominio OPERACIONES (pool)
//
//  Baja las operaciones del pool DIRECTO desde la API productiva del portal
//  (Holux / Redlink) y las escribe a Azure Blob, un archivo por día. Reemplaza
//  la dependencia de M2LINK/RDTOut para este dominio.
//
//  El token, el troceo y el mapeo a contrato RDT viven en UN solo lugar:
//  api/shared/redlink-fetch.js (consultarRedlink → filas ya traducidas). Acá
//  NO se reimplanta nada de eso: así el backfill guarda EXACTAMENTE la misma
//  forma que sirven las vistas (/proxy/ops) y que lee el cold store
//  (shared/cold-operaciones.js). Si divergieran, al prender OPS_COLD las vistas
//  recibirían filas con otra forma y se romperían.
//
//  Fuente (dentro de redlink-fetch):
//    token : POST https://accounts.portalredtec.cl/realms/Redtec/.../token  (Keycloak)
//    datos : GET  https://api.portalredtec.cl/api/formheader/historico/433
//    BP 433 = REDTEC (todos los clientes).
//
//  Por qué ventana de 45 días en el diario: las operaciones quedan ABIERTAS y
//  su confirmación (recepcion/pendiente) llega tardía — la ventana de gracia de
//  transferencias es de 40 días. Releer 45 días hacia atrás y sobrescribir el
//  blob del día (idempotente, clave formHeaderiD) captura esas confirmaciones.
//
//  Uso:
//    npm i @azure/storage-blob          (ya lo instala la Action)
//    export OS_STORAGE_CONN="<conn del storage redtecos>"
//    export REDLINK_USER="<usuario>"
//    export REDLINK_PASS="<clave>"
//    export REDLINK_CLIENT_SECRET="<secret del cliente apiportalredtec>"
//    node backfill/backfill-operaciones.js 2026-08-18 2026-10-01   # rango
//    node backfill/backfill-operaciones.js                         # 45 días → hoy
//
//  Secrets que deben existir en el repo (Settings → Secrets and variables):
//    OS_STORAGE_CONN         (ya existe)
//    REDLINK_USER, REDLINK_PASS, REDLINK_CLIENT_SECRET   (ya existen)
//    REDLINK_CLIENT_ID       (opcional, default apiportalredtec)
//    OS_OPS_CONTAINER        (opcional, default redtec-os-operaciones)
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
// Cliente único de Redlink: token + troceo + traducción al contrato RDT.
const RL = require('../api/shared/redlink-fetch.js');

const BP          = process.env.REDLINK_BP || '433';
const CONTAINER   = process.env.OS_OPS_CONTAINER || 'redtec-os-operaciones';
const PREFIJO     = 'operaciones/';
const DIAS_TRAMO  = Math.max(1, parseInt(process.env.OS_BACKFILL_TRAMO_DIAS || '31', 10) || 31);
const VENTANA_DIAS = 45;        // ventana del diario (cubre confirmaciones tardías)

// ── fechas ──────────────────────────────────────────────────────────────────
function hoyChile() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
}
function iso(d) { return d.toISOString().slice(0, 10); }
function addDias(isoStr, n) { const d = new Date(isoStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); }

const DESDE = process.argv[2] || addDias(iso(hoyChile()), -VENTANA_DIAS);
const HASTA = process.argv[3] || iso(hoyChile());

function fmt(n) { return Number(n).toLocaleString('es-CL'); }

// ── blob ─────────────────────────────────────────────────────────────────────
function getContainer() {
  if (!process.env.OS_STORAGE_CONN) throw new Error('Falta OS_STORAGE_CONN');
  return BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONTAINER);
}
async function guardarDia(container, fecha, filas) {
  const payload = {
    fecha,
    operaciones: filas,
    _total: filas.length,
    _guardado: new Date().toISOString(),
    _contrato: 'rdt',          // filas en contrato RDT (traducir); mismo que las vistas
    _fuente: 'portalredtec/formheader/historico/' + BP + ' (via redlink-fetch)'
  };
  const body = JSON.stringify(payload);
  await container.getBlockBlobClient(`${PREFIJO}${fecha}.json`).upload(
    body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  const container = getContainer();
  await container.createIfNotExists();

  console.log(`Operaciones BP ${BP}  ${DESDE} → ${HASTA}  (ventana directa Redlink, contrato RDT)\n`);

  // 1) traer por tramos, acumulando por día de fechaRequerida (dedupe por formHeaderiD).
  //    Se trocea en memoria (DIAS_TRAMO): consultarRedlink devuelve el tramo ya
  //    traducido, lo plegamos a porDia y lo soltamos antes de pedir el siguiente.
  const porDia = {};   // fecha -> Map(formHeaderiD -> fila)
  let ini = DESDE;
  while (ini <= HASTA) {
    const fin = addDias(ini, DIAS_TRAMO - 1) > HASTA ? HASTA : addDias(ini, DIAS_TRAMO - 1);
    const r = await RL.consultarRedlink(ini, fin, { bp: BP });   // filas ya en contrato RDT
    for (const fila of r.filas) {
      const fr = (fila.fechaRequerida || '').slice(0, 10) || 'sin-fecha';
      (porDia[fr] || (porDia[fr] = new Map())).set(fila.formHeaderiD, fila);
    }
    console.log(`  ${ini} .. ${fin}  ${fmt(r.filas.length)} ops  (${(r.ms / 1000).toFixed(1)}s)`);
    ini = addDias(fin, 1);
  }

  // 2) un blob por día (solo días dentro del rango pedido; sobrescribe = idempotente)
  const fechas = Object.keys(porDia).filter(f => f >= DESDE && f <= HASTA).sort();
  let escritos = 0, totOps = 0;
  for (const f of fechas) {
    const filas = [...porDia[f].values()];
    await guardarDia(container, f, filas);
    totOps += filas.length; escritos++;
  }

  console.log(`\n✓ Operaciones guardadas`);
  console.log(`  Días    : ${fmt(escritos)}  (${fechas[0] || '-'} → ${fechas[fechas.length - 1] || '-'})`);
  console.log(`  Ops tot : ${fmt(totOps)}`);
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
