// ============================================================================
//  backfill/backfill.js  ·  Carga inicial del histórico diario (una vez)
//
//  Barre un rango grande en trozos de <=180 días (lo máximo que aguanta
//  RDTOut), acumula TODO por día en memoria (solo agregados, liviano) y al
//  final escribe un blob por día. Acumular antes de escribir evita que un día
//  en el borde de dos trozos se pise: se suma correcto.
//
//  Uso (PowerShell):
//    cd backfill
//    npm i @azure/storage-blob
//    $env:OS_STORAGE_CONN = "<conn>"
//    $env:REDTEC_API_KEY  = "<key>"        # opcional (hay default)
//    node backfill.js                      # 2023-01-01 → hoy
//    node backfill.js 2024-01-01 2024-12-31   # o un rango puntual (reanudar)
// ============================================================================

const { partirRango } = require('../api/shared/rangos.js');
const mov   = require('../api/shared/movimientos.js');
const cache = require('../api/shared/cache-dia.js');
const { consultarOps } = require('../api/shared/ops-fetch.js');

const DESDE = process.argv[2] || '2023-01-01';
const HASTA = process.argv[3] || new Date().toISOString().slice(0, 10);

function fmt(n) { return n.toLocaleString('es-CL'); }

(async () => {
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  const container = cache.getContainer();
  await container.createIfNotExists();

  const trozos = partirRango(DESDE, HASTA);
  console.log(`Backfill ${DESDE} → ${HASTA}  ·  ${trozos.length} trozos de ~175 días\n`);

  // 1) Consultar todos los trozos, acumulando por día en memoria.
  const porDia = {};
  for (let i = 0; i < trozos.length; i++) {
    const t = trozos[i];
    process.stdout.write(`[${i + 1}/${trozos.length}] ${t.desde} .. ${t.hasta}  … `);
    const t0 = Date.now();
    const filas = await consultarOps(t.desde, t.hasta);
    mov.agregarPorDiaEn(filas, porDia);
    console.log(`${fmt(filas.length)} filas  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  // 2) Escribir un blob por día.
  const fechas = Object.keys(porDia).sort();
  console.log(`\nGuardando ${fmt(fechas.length)} días…`);
  let escritos = 0, emiTot = 0;
  for (const f of fechas) {
    await cache.guardarDia(container, f, porDia[f]);
    emiTot += porDia[f].emisiones.total;
    if (++escritos % 100 === 0) process.stdout.write(`  ${escritos}/${fechas.length}\r`);
  }

  console.log(`\n\n✓ Backfill completo`);
  console.log(`  Días guardados : ${fmt(fechas.length)}  (${fechas[0]} → ${fechas[fechas.length - 1]})`);
  console.log(`  Emisiones tot. : ${fmt(emiTot)} pallets`);
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
