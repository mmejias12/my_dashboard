// ============================================================================
//  scripts/rollup-transferencias.js  ·  Índice de transferencias por estado
//
//  QUÉ RESUELVE. Una transferencia tiene dos números distintos y hasta ahora
//  sólo guardábamos uno:
//     despachado  · lo que el cliente sacó hacia el retail
//     confirmado  · lo que el retail reconoció haber recibido
//  El resto de la plataforma cuenta SIEMPRE lo confirmado (movimientos.js usa
//  cantidadConfirmada). Eso está bien como cifra de cumplimiento, pero deja sin
//  respuesta "¿cuánto salió?" y "¿cuánto falta por confirmar?".
//
//  Medido el 17-09-2026 sobre 13 meses: despachado 1.244.892 vs confirmado
//  1.159.895 en total. La tasa real varía por retail entre 92,2% y 98,9%, así
//  que estimar la confirmación con un factor único se equivoca en los dos
//  sentidos según el cliente.
//
//  POR QUÉ LEE DE RDTOut Y NO DE LOS BLOBS DIARIOS. Los blobs se escriben una
//  vez y el backfill nocturno sólo revisa 45 días hacia atrás. Una transferencia
//  de octubre que el retail confirma en enero nunca se vuelve a leer: queda
//  congelada en el número viejo. Medido: para Walmart en 12 meses, el índice
//  guardado decía 394.742 y el recálculo en vivo 398.116 — 3.374 confirmaciones
//  tardías que se habían perdido. Por eso este rollup va a la fuente.
//
//  EL CRITERIO ES PRESTADO, NO COPIADO. El concepto y la fecha de anclaje salen
//  de shared/movimientos.js. Si acá se reimplantaran, los números se separarían
//  del resto del tablero de a poco y sin que nadie se entere.
//
//  SALIDA · resumen/transferencias.json
//    { generado, desde, hasta, meses:[...],
//      total:    { "2026-07": [desp, conf, movs] },
//      etapas:   { "Transferencia Cerrada": { "2026-07": [desp, conf, movs] } },
//      destinos: { "WALMART...": { mes:{...}, origenes:{ "CLIENTE": {mes:[d,c,n]} } } } }
//
//  Uso:
//    node scripts/rollup-transferencias.js                    # 2023-01-01 → hoy
//    node scripts/rollup-transferencias.js 2025-01-01 2026-09-16
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const { partirRango } = require('../api/shared/rangos.js');
const { consultarOps } = require('../api/shared/ops-fetch.js');
const mov = require('../api/shared/movimientos.js');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const SALIDA    = 'resumen/transferencias.json';
const INICIO    = '2023-01-01';

const hoyIso = () => new Date().toISOString().slice(0, 10);
const fmt = n => Number(n).toLocaleString('es-CL');

// Balde para las filas sin cliente origen. Con nombre visible a propósito: si
// alguna vez crece, tiene que notarse en el pop-up, no esconderse.
const SIN_ORIGEN = '(sin cliente origen)';

/** Suma [desp, conf, movs] dentro de un mapa mes -> tripleta. */
function sumarMes(mapa, mes, d, c) {
  const t = mapa[mes] || (mapa[mes] = [0, 0, 0]);
  t[0] += d; t[1] += c; t[2] += 1;
}

function nuevoIndice() {
  return { total: {}, dias: {}, etapas: {}, destinos: {} };
}

/**
 * Acumula una tanda de filas crudas de RDTOut dentro del índice.
 * Expuesta aparte para poder probarla sin red.
 */
function acumular(idx, filas) {
  let usadas = 0, sinFecha = 0;
  for (const f of filas) {
    if (mov.conceptoDe(f.operacion) !== 'transferencias') continue;
    const fecha = mov.fechaDe(f);          // fechaRequerida, con confirmación de respaldo
    if (!fecha) { sinFecha++; continue; }
    const mes = fecha.slice(0, 7);

    const d = Number(f.cantidadDespachada) || 0;
    const c = Number(f.cantidadConfirmada) || 0;
    // Una fila sin movimiento en ninguno de los dos lados no aporta nada y sólo
    // infla el índice con nombres que nunca se van a consultar.
    if (!d && !c) continue;
    usadas++;

    sumarMes(idx.total, mes, d, c);
    // También por DÍA. El tablero corta por día, semana, mes o lo que se le
    // ocurra al gerente; si el despachado sólo existiera por mes, apretar
    // "Despachado" cambiaría la granularidad del gráfico a mitad de camino y
    // la comparación dejaría de ser una comparación. Son ~40 KB.
    sumarMes(idx.dias, fecha, d, c);

    const etapa = String(f.etapaOperacion || '(sin etapa)').trim();
    const e = idx.etapas[etapa] || (idx.etapas[etapa] = {});
    sumarMes(e, mes, d, c);

    const destino = String(f.clienteDestinoStr || '').trim();
    if (!destino) continue;
    const dst = idx.destinos[destino] || (idx.destinos[destino] = { mes: {}, origenes: {} });
    sumarMes(dst.mes, mes, d, c);

    // El par origen → destino es lo que responde "¿quién le transfirió a este
    // retail?". Se guarda anidado bajo el destino para no repetir su nombre en
    // cada par: son ~44 destinos contra cientos de orígenes.
    //
    // Si la fila no trae cliente origen NO se descarta: va a un balde con
    // nombre propio. Saltársela dejaría un desglose que no suma el total de su
    // propio encabezado, y esa diferencia no se ve — el que mira el pop-up
    // cree que está viendo todo.
    const origen = String(f.clienteOrigenStr || '').trim() || SIN_ORIGEN;
    const o = dst.origenes[origen] || (dst.origenes[origen] = {});
    sumarMes(o, mes, d, c);
  }
  return { usadas, sinFecha };
}

async function construir(desde, hasta, log) {
  log = log || console.log;
  const trozos = partirRango(desde, hasta);
  log(`Transferencias ${desde} → ${hasta}  ·  ${trozos.length} trozos`);

  const idx = nuevoIndice();
  let filasTot = 0, usadasTot = 0;

  for (let i = 0; i < trozos.length; i++) {
    const t = trozos[i];
    const t0 = Date.now();
    const filas = await consultarOps(t.desde, t.hasta);
    const { usadas } = acumular(idx, filas);
    filasTot += filas.length; usadasTot += usadas;
    log(`  [${i + 1}/${trozos.length}] ${t.desde}..${t.hasta}  `
      + `${fmt(filas.length)} filas, ${fmt(usadas)} transferencias  `
      + `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const meses = Object.keys(idx.total).sort();
  const tot = meses.reduce((s, m) => [s[0] + idx.total[m][0], s[1] + idx.total[m][1]], [0, 0]);

  return {
    generado: new Date().toISOString(),
    desde: meses[0], hasta: meses[meses.length - 1],
    consultado: { desde, hasta },
    filas_leidas: filasTot, transferencias: usadasTot,
    despachado_total: tot[0], confirmado_total: tot[1],
    // La tasa se publica calculada para que nadie tenga que estimarla con un
    // factor de memoria: es exactamente lo que pasó.
    tasa_confirmacion: tot[0] ? +(tot[1] / tot[0]).toFixed(4) : null,
    meses,
    total: idx.total, dias: idx.dias, etapas: idx.etapas, destinos: idx.destinos,
  };
}

module.exports = { construir, acumular, nuevoIndice };

if (require.main === module) {
  (async () => {
    if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
    const desde = process.argv[2] || INICIO;
    const hasta = process.argv[3] || hoyIso();
    const roll = await construir(desde, hasta);
    const body = JSON.stringify(roll);

    const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
    await c.createIfNotExists();
    await c.getBlockBlobClient(SALIDA).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    });

    console.log(`\n✓ ${SALIDA}`);
    console.log(`  Meses          : ${roll.meses.length}  (${roll.desde} → ${roll.hasta})`);
    console.log(`  Transferencias : ${fmt(roll.transferencias)} movimientos`);
    console.log(`  Despachado     : ${fmt(roll.despachado_total)} pallets`);
    console.log(`  Confirmado     : ${fmt(roll.confirmado_total)} pallets `
      + `(${(roll.tasa_confirmacion * 100).toFixed(2)}%)`);
    console.log(`  Destinos       : ${Object.keys(roll.destinos).length}`);
    console.log(`  Tamaño         : ${(Buffer.byteLength(body) / 1048576).toFixed(2)} MB`);
  })().catch(e => { console.error('\nError:', e.message); process.exit(1); });
}
