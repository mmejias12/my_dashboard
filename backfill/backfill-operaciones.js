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
//  ──────────────────────────────────────────────────────────────────────────
//  EL MARGEN DE ENTRADA · por qué la consulta empieza ANTES que la escritura
//
//  Redlink filtra su histórico por horaIngreso (cuándo se INGRESÓ la operación)
//  y acá cada fila se archiva bajo su fechaRequerida (cuándo tiene que ocurrir).
//  Son dos fechas distintas y en emisiones se separan mucho: medido el 14-10-2026
//  sobre 3.052 operaciones reales, sólo 10 de 128 emisiones se ingresan el mismo
//  día; 16 van con 1 a 2 días de anticipación, 53 con 3 a 7, 47 con 8 a 30 y 2
//  con más de 30. Transferencias, traspasos y relocalización se ingresan el mismo
//  día casi siempre, y los retiros a lo más un par de días: por eso el defecto
//  sólo se notaba en emisiones.
//
//  Como guardarDia SOBRESCRIBE el blob entero, consultar y escribir el mismo
//  rango borraba de cada día toda operación ingresada ANTES de que abriera la
//  ventana. Medido en producción contra SAP: 59.892 emisiones perdidas sólo en
//  2026 (ene 15.749, ago 31.740, sep 12.403; feb a jul intactos), más ene-2024
//  15.862 y ene-2025 10.816 — siempre en los primeros días de cada rango, que
//  es justo donde muerde el borde.
//
//  El arreglo es pedirle a Redlink desde DESDE−MARGEN_DIAS y seguir escribiendo
//  sólo [DESDE..HASTA]. El margen tiene que cubrir la anticipación máxima: 60
//  días deja holgura sobre los 30 y tantos medidos.
//  ──────────────────────────────────────────────────────────────────────────
//
//  Uso:
//    npm i @azure/storage-blob          (ya lo instala la Action)
//    export OS_STORAGE_CONN="<conn del storage redtecos>"
//    export REDLINK_USER="<usuario>"
//    export REDLINK_PASS="<clave>"
//    export REDLINK_CLIENT_SECRET="<secret del cliente apiportalredtec>"
//    node backfill/backfill-operaciones.js 2026-08-18 2026-10-01   # rango
//    node backfill/backfill-operaciones.js                         # 45 días → hoy
//    OS_BACKFILL_MARGEN_DIAS=90 node backfill/backfill-operaciones.js ...  # más margen
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
// Días que la CONSULTA se adelanta al rango que se ESCRIBE. Ver el bloque del
// encabezado: sin esto el borde de entrada pierde las operaciones programadas con
// anticipación y, como el blob se sobrescribe, las pierde para siempre.
const MARGEN_DIAS = Math.max(0, parseInt(process.env.OS_BACKFILL_MARGEN_DIAS || '60', 10) || 0);

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

// ── recolección ───────────────────────────────────────────────────────────────
// Trae de Redlink todo lo que pueda tener fechaRequerida dentro de [desde..hasta]
// y lo pliega por día, deduplicando por formHeaderiD (un mismo pedido puede venir
// en dos tramos). `consultar` se inyecta en las pruebas para no tocar la red.
async function recolectar(desde, hasta, opts) {
  opts = opts || {};
  const consultar = opts.consultar || ((d, h) => RL.consultarRedlink(d, h, { bp: BP }));
  const margen    = opts.margen === undefined ? MARGEN_DIAS : Math.max(0, opts.margen);
  const tramo     = Math.max(1, opts.tramo || DIAS_TRAMO);
  const log       = opts.log || (() => {});

  // Acá está todo el arreglo: la consulta arranca antes, la escritura no.
  const consultaDesde = addDias(desde, -margen);

  const porDia = {};   // fecha -> Map(formHeaderiD -> fila)
  let leidas = 0, descartadas = 0;
  let ini = consultaDesde;
  while (ini <= hasta) {
    let fin = addDias(ini, tramo - 1); if (fin > hasta) fin = hasta;
    const r = await consultar(ini, fin);
    const filas = (r && r.filas) || [];
    leidas += filas.length;
    for (const fila of filas) {
      const fr = (fila.fechaRequerida || '').slice(0, 10) || 'sin-fecha';
      // Lo que cae fuera del rango pedido se suelta acá mismo: con 60 días de
      // margen encima, guardarlo para filtrarlo al final sería cargar en memoria
      // dos meses de operaciones que esta corrida no va a escribir.
      if (fr < desde || fr > hasta) { descartadas++; continue; }
      if (!porDia[fr]) porDia[fr] = new Map();
      porDia[fr].set(fila.formHeaderiD, fila);
    }
    log(`  ${ini} .. ${fin}  ${fmt(filas.length)} ops  (${((r && r.ms ? r.ms : 0) / 1000).toFixed(1)}s)`);
    ini = addDias(fin, 1);
  }

  // Cuántas de las que SÍ se escriben venían de antes del rango: es la medida de
  // lo que rescata el margen, o sea exactamente lo que se perdía antes.
  let rescatadas = 0, totOps = 0;
  for (const f in porDia) for (const fila of porDia[f].values()) {
    totOps++;
    const ing = String(fila.horaIngreso || '').slice(0, 10);
    if (ing && ing < desde) rescatadas++;
  }
  return { porDia, consultaDesde, leidas, descartadas, rescatadas, totOps };
}

// Los días que esta corrida escribe. El filtro está repetido a propósito: es la
// invariante que importa — nunca escribir un día fuera del rango pedido — y no
// debe depender de que la recolección lo haya aplicado bien.
function diasAEscribir(porDia, desde, hasta) {
  return Object.keys(porDia).filter(f => f >= desde && f <= hasta).sort();
}

module.exports = { recolectar, diasAEscribir, addDias, MARGEN_DIAS, DIAS_TRAMO };

// ── main ──────────────────────────────────────────────────────────────────────
if (require.main === module) (async () => {
  const container = getContainer();
  await container.createIfNotExists();

  console.log(`Operaciones BP ${BP}  ${DESDE} → ${HASTA}  (ventana directa Redlink, contrato RDT)`);
  console.log(`Consulta desde ${addDias(DESDE, -MARGEN_DIAS)} · margen de entrada ${MARGEN_DIAS} días\n`);

  const r = await recolectar(DESDE, HASTA, { log: console.log });

  // un blob por día (sólo días dentro del rango pedido; sobrescribe = idempotente)
  const fechas = diasAEscribir(r.porDia, DESDE, HASTA);
  let escritos = 0, totOps = 0;
  for (const f of fechas) {
    const filas = [...r.porDia[f].values()];
    await guardarDia(container, f, filas);
    totOps += filas.length; escritos++;
  }

  console.log(`\n✓ Operaciones guardadas`);
  console.log(`  Días    : ${fmt(escritos)}  (${fechas[0] || '-'} → ${fechas[fechas.length - 1] || '-'})`);
  console.log(`  Ops tot : ${fmt(totOps)}`);
  console.log(`  Rescatadas por el margen (ingresadas antes del ${DESDE}): ${fmt(r.rescatadas)}`);
  if (MARGEN_DIAS === 0) {
    console.log('  OJO: margen 0 — este rango va a perder lo programado con anticipación.');
  }
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
