// ============================================================================
//  scripts/rollup-diario.js  ·  Serie DIARIA de operaciones, 2023 → hoy
//
//  PARA QUÉ. El tablero de gerencia tiene que dejar armar cualquier período y
//  comparar años, y eso sólo se puede hacer bien con el dato día a día. Pedirlo
//  en vivo no es opción: medido el 17-09-2026 contra /proxy/ops, 30 días son
//  12,8 MB y a los 90 la consulta ya responde 502 por timeout.
//
//  LA GRACIA DEL TAMAÑO. El total por día y concepto son seis números diarios.
//  Medido: 0,29 KB por día, o sea bajo 400 KB por tres años y medio (y gzip lo
//  deja en una fracción). El tablero se lo baja UNA vez y
//  después arma cualquier corte — día, semana, mes, año, o el período que se le
//  ocurra al gerente — sin volver a preguntar nada. Lo que no cabe es el cruce
//  por cliente día a día (145 clientes x 1.266 días x 6 conceptos), y para eso
//  está el índice mensual de resumen/contrapartes.json.
//
//  Lee los mismos blobs diarios que ya existen; no toca la ingesta ni necesita
//  backfill.
//
//  SALIDA · resumen/diario.json
//      { generado, desde, hasta, conceptos:[...],
//        dias: { "2026-07-15": {emisiones:n, retiros:n, transferencias:n,
//                               devoluciones:n, recogida:n, reparacion:n} } }
//
//  Uso:
//    node scripts/rollup-diario.js              # 2023-03-20 -> ayer
//    node scripts/rollup-diario.js 2026-09-17
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const cache = require('../api/shared/cache-dia.js');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const INICIO    = '2023-03-20';
const LOTE      = 30;
const SALIDA    = 'resumen/diario.json';

// Los seis conceptos que movimientos.js sabe resolver. Emisiones y retiros
// vienen abiertos por planta en el blob; acá se guarda el total y también el
// desglose, porque "¿cuánto salió de Talca?" es una pregunta de gerencia.
const CONCEPTOS = ['emisiones', 'retiros', 'transferencias', 'devoluciones', 'recogida', 'reparacion'];
const PLANTAS   = ['santiago', 'talca', 'coquimbo', 'temuco'];

function ayerIso() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

/** Aplana un día del caché a la forma que consume el tablero. */
function diaPlano(d) {
  const o = {};
  let algo = false;
  for (const c of CONCEPTOS) {
    const v = d[c];
    // emisiones y retiros son objetos {total, santiago, talca...}; el resto
    // son escalares. Se normalizan los dos casos a un número.
    const n = (v && typeof v === 'object') ? (Number(v.total) || 0) : (Number(v) || 0);
    if (n) algo = true;
    o[c] = n;
  }
  // Desglose por planta sólo donde existe, y sólo si hay algo: repetir cuatro
  // ceros por concepto y por día triplicaría el archivo sin decir nada.
  for (const c of ['emisiones', 'retiros']) {
    const v = d[c];
    if (!v || typeof v !== 'object') continue;
    const p = {};
    for (const k of PLANTAS) if (Number(v[k])) p[k] = Number(v[k]);
    if (Object.keys(p).length) o[c + '_planta'] = p;
  }
  return algo ? o : null;
}

async function construir(hasta, log) {
  log = log || console.log;
  const container = cache.getContainer();
  const fechas = cache.rangoDias(INICIO, hasta);
  log(`Rollup diario ${INICIO} → ${hasta}  (${fechas.length} días)`);

  const dias = {};
  let leidos = 0, vacios = 0;

  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const lote = await Promise.all(grupo.map(f =>
      cache.leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of lote) {
      if (!d) continue;
      leidos++;
      const plano = diaPlano(d);
      // Un día leído pero en cero no se guarda como cero: se omite, y el
      // tablero lo muestra como día sin operación en vez de como un cero real.
      if (plano) dias[f] = plano; else vacios++;
    }
    if (process.stdout.isTTY) process.stdout.write(`  ${Math.min(i + LOTE, fechas.length)}/${fechas.length}\r`);
  }

  const claves = Object.keys(dias).sort();
  return {
    generado: new Date().toISOString(),
    desde: claves[0], hasta: claves[claves.length - 1],
    dias_leidos: leidos, dias_con_datos: claves.length, dias_en_cero: vacios,
    conceptos: CONCEPTOS, plantas: PLANTAS,
    dias,
  };
}

module.exports = { construir, diaPlano, CONCEPTOS, PLANTAS };

if (require.main === module) {
  (async () => {
    if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
    const roll = await construir(process.argv[2] || ayerIso());
    const body = JSON.stringify(roll);
    const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
    await c.createIfNotExists();
    await c.getBlockBlobClient(SALIDA).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    });
    console.log(`\n✓ ${SALIDA}: ${roll.dias_con_datos} días con datos `
      + `(${roll.desde} → ${roll.hasta}), ${roll.dias_en_cero} en cero · `
      + `${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
  })().catch(e => { console.error('\nError:', e.message); process.exit(1); });
}
