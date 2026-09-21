// ============================================================================
//  scripts/rollup-operaciones.js  ·  Precalcula el resumen mensual/anual
//
//  Lee UNA vez todos los blobs diarios (redtec-os-hist) y escribe un resumen
//  compacto en resumen/operaciones.json (mismo container). Ese archivo lo carga
//  el asistente para responder comparaciones de años/meses SIN leer cientos de
//  días en vivo. Es idempotente: se puede re-correr cuando quieras (y va en el
//  job diario).
//
//  Uso (PowerShell), en la misma sesión donde ya seteaste OS_STORAGE_CONN:
//    cd scripts
//    node rollup-operaciones.js                 # 2023-03-20 -> ayer
//    node rollup-operaciones.js 2026-08-12      # hasta una fecha puntual
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const cache = require('../api/shared/cache-dia.js');
const mov   = require('../api/shared/movimientos.js');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const INICIO    = '2023-03-20';
const PLANTAS   = mov.PLANTAS;
const LOTE      = 30;

function ayerIso() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

function nuevoBucket() {
  const z = () => { const o = { total: 0 }; for (const p of PLANTAS) o[p] = 0; return o; };
  return { emisiones: z(), retiros: z(), devoluciones: 0, recogida: 0, transferencias: 0, reparacion: 0, dias: 0 };
}
function sumaDia(b, d) {
  for (const p of ['total', ...PLANTAS]) {
    b.emisiones[p] += (d.emisiones && d.emisiones[p]) || 0;
    b.retiros[p]   += (d.retiros   && d.retiros[p])   || 0;
  }
  b.devoluciones   += d.devoluciones || 0;
  b.recogida       += d.recogida || 0;
  b.transferencias += d.transferencias || 0;
  b.reparacion     += d.reparacion || 0;
  b.dias           += 1;
}

(async () => {
  if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  const hasta = process.argv[2] || ayerIso();
  const container = cache.getContainer();
  const fechas = cache.rangoDias(INICIO, hasta);
  console.log(`Rollup operaciones ${INICIO} → ${hasta}  (${fechas.length} días)`);

  const anual = {}, mensual = {};
  let leidos = 0;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const dias = await Promise.all(grupo.map(f =>
      cache.leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of dias) {
      if (!d) continue;
      leidos++;
      const y = f.slice(0, 4), m = f.slice(0, 7);
      if (!anual[y]) anual[y] = nuevoBucket();  sumaDia(anual[y], d);
      if (!mensual[m]) mensual[m] = nuevoBucket();  sumaDia(mensual[m], d);
    }
    process.stdout.write(`  ${Math.min(i + LOTE, fechas.length)}/${fechas.length}\r`);
  }

  const roll = {
    generado: new Date().toISOString(),
    desde: INICIO, hasta: fechas[fechas.length - 1],
    dias_leidos: leidos, anual, mensual
  };
  const body = JSON.stringify(roll);
  const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  await c.createIfNotExists();
  await c.getBlockBlobClient('resumen/operaciones.json').upload(
    body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } }
  );
  console.log(`\n✓ Rollup escrito: ${Object.keys(anual).length} años, ${Object.keys(mensual).length} meses, ${leidos} días leídos.`);
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });