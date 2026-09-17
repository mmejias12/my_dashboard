// ============================================================================
//  scripts/rollup-contrapartes.js  ·  Índice de operaciones POR CONTRAPARTE
//
//  EL PROBLEMA QUE RESUELVE
//  ------------------------
//  "¿Cuántas transferencias se emitieron a Walmart?" hoy no se puede responder
//  sin leer el dato crudo, y el dato crudo no cabe. Medido contra producción el
//  17-09-2026 sobre /proxy/ops (RDTOut):
//
//        1 día    0,78 MB     1.180 filas    1,5 s
//        7 días   3,23 MB     4.871 filas    1,4 s
//       30 días  12,76 MB    19.131 filas    3,2 s
//       90 días      —            —          502 Timeout a los 20 s
//      180 días      —            —          502 Timeout a los 20 s
//      365 días      —            —          502, RDTOut responde 400: rechaza
//                                            el rango de un año
//
//  O sea ~0,42 MB y ~640 filas por día. Un año son unos 155 MB y 233 mil filas
//  viajando enteras al navegador para, al final, contar cuántas son de Walmart.
//  El corte "después de los 180 días" que se vio en la reunión es real, y el
//  límite verdadero está entre 30 y 90 días.
//
//  LA PARTE BUENA: EL DATO YA ESTÁ
//  -------------------------------
//  El job nocturno ya guarda un blob por día, y ese blob ya trae el desglose
//  por contraparte — movimientos.js lo arma en `sumarDetalle()` y lo persiste
//  en `paraCache()`:
//
//      detalle[concepto] = { clienteDestino:{}, clienteOrigen:{},
//                            bodegaDestino:{},  bodegaOrigen:{} }
//
//  Lo que pasa es que rollup-operaciones.js lo IGNORA: suma sólo los escalares
//  (emisiones, retiros, transferencias…) y bota `detalle`. Por eso el resumen
//  precalculado sabe cuántas transferencias hubo en un mes, pero no a quién.
//  Sin esa dimensión, el asistente no encuentra la respuesta hecha, cae a
//  consultar en vivo, y se pega.
//
//  Este script NO necesita backfill ni tocar la ingesta diaria: relee los
//  mismos blobs que ya existen desde 2023 y arma el índice que faltaba.
//
//  SALIDA · resumen/contrapartes.json
//      { generado, desde, hasta, dias_leidos, meses:[...],
//        clientes: { "WALMART CHILE S.A.": {
//                      destino: { transferencias:{"2026-09":1234, ...}, ... },
//                      origen:  { ... } } },
//        bodegas:  { ... igual ... } }
//
//  Se guardan los dos lados (origen y destino) a propósito, igual que hace
//  movimientos.js: en una emisión la contraparte va en el destino y en un
//  retiro va en el origen, así que quien consulta elige el lado que le sirve
//  en vez de que el rollup decida por él.
//
//  Uso:
//    node scripts/rollup-contrapartes.js                # 2023-03-20 -> ayer
//    node scripts/rollup-contrapartes.js 2026-09-16     # hasta una fecha
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const cache = require('../api/shared/cache-dia.js');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_HIST_CONTAINER || 'redtec-os-hist';
const INICIO    = '2023-03-20';
const LOTE      = 30;
const SALIDA    = 'resumen/contrapartes.json';

// Los cuatro lados que el blob diario guarda por concepto.
const LADOS = ['clienteDestino', 'clienteOrigen', 'bodegaDestino', 'bodegaOrigen'];

function ayerIso() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

/**
 * Acumula un día dentro del índice.
 *
 * Estructura: entidad -> lado -> concepto -> mes -> cantidad.
 * Se indexa por MES y no por día porque la pregunta que hay que responder es
 * "los últimos 12 meses"; guardar día a día multiplicaría por 30 el tamaño
 * para una precisión que nadie pidió.
 */
function acumular(indice, mes, detalle) {
  for (const concepto in (detalle || {})) {
    for (const lado of LADOS) {
      const mapa = detalle[concepto][lado];
      if (!mapa) continue;
      const esCliente = lado.indexOf('cliente') === 0;
      const cara = lado.indexOf('Destino') > 0 ? 'destino' : 'origen';
      const destino = esCliente ? indice.clientes : indice.bodegas;
      for (const nombre in mapa) {
        const v = mapa[nombre];
        if (!v) continue;
        const e = destino[nombre] || (destino[nombre] = {});
        const c = e[cara] || (e[cara] = {});
        const k = c[concepto] || (c[concepto] = {});
        k[mes] = (k[mes] || 0) + v;
      }
    }
  }
}

/** Nombres comparables: sin tildes, sin puntuación, sin razón social. */
function normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L\.?|CHILE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

async function construir(hasta, log) {
  log = log || console.log;
  const container = cache.getContainer();
  const fechas = cache.rangoDias(INICIO, hasta);
  log(`Rollup contrapartes ${INICIO} → ${hasta}  (${fechas.length} días)`);

  const indice = { clientes: {}, bodegas: {} };
  const meses = {};
  let leidos = 0, sinDetalle = 0;

  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const dias = await Promise.all(grupo.map(f =>
      cache.leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of dias) {
      if (!d) continue;
      leidos++;
      // Un día sin `detalle` es un blob viejo, anterior a que la ingesta
      // guardara el desglose. Se cuenta aparte para que el resumen diga hasta
      // dónde llega el índice de verdad, en vez de mostrar ceros silenciosos.
      if (!d.detalle || !Object.keys(d.detalle).length) { sinDetalle++; continue; }
      const mes = f.slice(0, 7);
      meses[mes] = (meses[mes] || 0) + 1;
      acumular(indice, mes, d.detalle);
    }
    if (process.stdout.isTTY) process.stdout.write(`  ${Math.min(i + LOTE, fechas.length)}/${fechas.length}\r`);
  }

  // Un alias normalizado por entidad, para que quien consulte pueda escribir
  // "walmart" y encontrar "WALMART CHILE S.A." sin saber la razón social.
  const alias = {};
  for (const grupo of ['clientes', 'bodegas']) {
    for (const nombre in indice[grupo]) {
      const n = normalizar(nombre);
      if (!n) continue;
      (alias[n] || (alias[n] = [])).push(nombre);
    }
  }

  return {
    generado: new Date().toISOString(),
    desde: INICIO, hasta: fechas[fechas.length - 1],
    dias_leidos: leidos,
    dias_sin_detalle: sinDetalle,
    meses: Object.keys(meses).sort(),
    clientes: indice.clientes,
    bodegas: indice.bodegas,
    alias,
  };
}

module.exports = { construir, acumular, normalizar, LADOS };

if (require.main === module) {
  (async () => {
    if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
    const hasta = process.argv[2] || ayerIso();
    const roll = await construir(hasta);
    const body = JSON.stringify(roll);
    const c = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
    await c.createIfNotExists();
    await c.getBlockBlobClient(SALIDA).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    });
    console.log(`\n✓ ${SALIDA}: ${Object.keys(roll.clientes).length} clientes, `
      + `${Object.keys(roll.bodegas).length} bodegas, ${roll.meses.length} meses, `
      + `${roll.dias_leidos} días leídos`
      + (roll.dias_sin_detalle ? ` (${roll.dias_sin_detalle} sin desglose)` : '')
      + ` · ${(Buffer.byteLength(body) / 1048576).toFixed(1)} MB`);
  })().catch(e => { console.error('\nError:', e.message); process.exit(1); });
}
