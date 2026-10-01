// ============================================================================
//  backfill/backfill-operaciones.js  ·  M3DATA · dominio OPERACIONES (pool)
//
//  Baja las operaciones del pool DIRECTO desde la API productiva del portal
//  (Holux / Redlink) y las escribe a Azure Blob, un archivo por día. Reemplaza
//  la dependencia de M2LINK/RDTOut para este dominio.
//
//  Fuente:
//    token : POST https://accounts.portalredtec.cl/realms/Redtec/.../token  (Keycloak)
//    datos : GET  https://api.portalredtec.cl/api/formheader/historico/433
//                 ?fechainicio=MM-dd-yyyy&fechafin=MM-dd-yyyy
//    BP 433 = REDTEC (todos los clientes).  Formato de fecha: MM-dd-yyyy.
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
//    REDLINK_USER, REDLINK_PASS, REDLINK_CLIENT_SECRET   (nuevos)
//    REDLINK_CLIENT_ID       (opcional, default apiportalredtec)
//    OS_OPS_CONTAINER        (opcional, default redtec-os-operaciones)
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const TOKEN_URL = process.env.REDLINK_TOKEN_URL
  || 'https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token';
const API_BASE  = process.env.REDLINK_API_BASE || 'https://api.portalredtec.cl';
const BP        = process.env.REDLINK_BP || '433';
const CONTAINER = process.env.OS_OPS_CONTAINER || 'redtec-os-operaciones';
const PREFIJO   = 'operaciones/';
const DIAS_TRAMO = 31;          // la API trae todo el rango; se parte por memoria
const VENTANA_DIAS = 45;        // ventana del diario (cubre confirmaciones tardías)

// ── fechas ──────────────────────────────────────────────────────────────────
function hoyChile() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
}
function iso(d) { return d.toISOString().slice(0, 10); }
function mmddyyyy(isoStr) { const [y, m, d] = isoStr.split('-'); return `${m}-${d}-${y}`; }
function addDias(isoStr, n) { const d = new Date(isoStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); }

const DESDE = process.argv[2] || addDias(iso(hoyChile()), -VENTANA_DIAS);
const HASTA = process.argv[3] || iso(hoyChile());

function fmt(n) { return Number(n).toLocaleString('es-CL'); }

// ── token Keycloak (password grant) ─────────────────────────────────────────
async function getToken() {
  const user = process.env.REDLINK_USER;
  const pass = process.env.REDLINK_PASS;
  const cid  = process.env.REDLINK_CLIENT_ID || 'apiportalredtec';
  const sec  = process.env.REDLINK_CLIENT_SECRET;
  if (!user || !pass || !sec) throw new Error('Faltan REDLINK_USER / REDLINK_PASS / REDLINK_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: cid, client_secret: sec, grant_type: 'password',
    username: user, password: pass, scope: 'openid'
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!r.ok) throw new Error(`Token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

// ── un tramo de historico ───────────────────────────────────────────────────
async function traerTramo(token, desdeIso, hastaIso) {
  const url = `${API_BASE}/api/formheader/historico/${BP}`
    + `?fechainicio=${mmddyyyy(desdeIso)}&fechafin=${mmddyyyy(hastaIso)}`;
  let r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {                 // el token dura 60s; renovar y reintentar
    token = await getToken();
    r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!r.ok) throw new Error(`historico ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let data = await r.json();
  if (!Array.isArray(data)) data = data.value || data.data || [];
  return { data, token };
}

// ── aplanado 1:1 (mismo esquema que el extractor Python) ────────────────────
function v(o, k) { return (o && typeof o === 'object') ? o[k] : undefined; }
function aplanar(reg) {
  const det = (reg.formDdetalles && reg.formDdetalles[0]) || {};
  const tr  = (reg.formDtransportes && reg.formDtransportes[0]) || {};
  return {
    formHeaderiD: reg.formHeaderiD, folio: reg.folio, formId: reg.formId,
    servicioId: reg.servicioId, servicioNombre: reg.servicioNombre,
    contratoId: reg.contratoId, tipoProductoId: reg.tipoProductoId,
    formMetapaId: reg.formMetapaId, formMetapaNombre: reg.formMetapaNombre, abierto: reg.abierto,
    cantidad: reg.cantidad, despachado: reg.despachado, recepcion: reg.recepcion,
    pendiente: reg.pendiente, confirmacionVeces: reg.confirmacionVeces,
    fechaIngreso: reg.fechaIngreso, fechaRequerida: reg.fechaRequerida,
    fechaDespacho: reg.fechaDespacho, fechaConfirmacion: reg.fechaConfirmacion, fechaCierre: reg.fechaCierre,
    bpId: reg.bpId, bpNombre: reg.bpNombre,
    bpOrigenId: reg.bpOrigenId, bpOrigenNombre: reg.bpOrigenNombre,
    bodegaOrigenId: reg.bodegaOrigenId, bodegaOrigenNombre: reg.bodegaOrigenNombre,
    bpDestinoId: reg.bpDestinoId, bpDestinoNombre: reg.bpDestinoNombre,
    bodegaDestinoId: reg.bodegaDestinoId, bodegaDestinoNombre: reg.bodegaDestinoNombre,
    usuarioIngresoId: reg.usuarioIngresoId, usuarioIngresoNombre: reg.usuarioIngresoNombre,
    documentoId: reg.documentoId, documentoNombre: reg.documentoNombre,
    documentoNumero: reg.documentoNumero, folioDte: reg.folioDte,
    linkGuia: reg.linkGuia, linkFactura: reg.linkFactura,
    itemCode: v(det, 'itemCode'), itemName: v(det, 'itemName'),
    precio: v(det, 'precio'), arriendo: v(det, 'arriendo'),
    cita: reg.cita || v(tr, 'cita'), citaFecha: v(tr, 'citaFecha'),
    patente: reg.patente || v(tr, 'camionPatente') || v(tr, 'patenteCliente'),
    choferNombre: reg.choferNombre || v(tr, 'choferNombre') || v(tr, 'nombreCliente'),
    sapObjType: v(tr, 'sapObjType'), sapDocEntry: v(tr, 'sapDocEntry'),
    sapDocNum: v(tr, 'sapDocNum'), folioGuiaDte: v(tr, 'folioGuiaDte'), enviadoSap: v(tr, 'enviadoSap')
  };
}

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
    _fuente: 'portalredtec/formheader/historico/' + BP
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

  console.log(`Operaciones BP ${BP}  ${DESDE} → ${HASTA}  (ventana directa Redlink)\n`);
  let token = await getToken();

  // 1) traer por tramos, acumulando por día de fechaRequerida (dedupe por formHeaderiD)
  const porDia = {};   // fecha -> Map(formHeaderiD -> fila)
  let ini = DESDE;
  while (ini <= HASTA) {
    const fin = addDias(ini, DIAS_TRAMO - 1) > HASTA ? HASTA : addDias(ini, DIAS_TRAMO - 1);
    const t0 = Date.now();
    const res = await traerTramo(token, ini, fin); token = res.token;
    for (const reg of res.data) {
      const fila = aplanar(reg);
      const fr = (fila.fechaRequerida || '').slice(0, 10) || 'sin-fecha';
      (porDia[fr] || (porDia[fr] = new Map())).set(fila.formHeaderiD, fila);
    }
    console.log(`  ${ini} .. ${fin}  ${fmt(res.data.length)} ops  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
