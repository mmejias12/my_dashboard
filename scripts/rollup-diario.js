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
//  ──────────────────────────────────────────────────────────────────────────
//  LOS RETIROS VAN POR FECHA DE CONFIRMACIÓN (decisión de Mauro, 15-10-2026)
//
//  Hasta acá TODOS los conceptos se anclaban por fechaRequerida, que es lo que
//  hace movimientos.js. Para los retiros eso contesta "cuánto se pidió para
//  ese día", mientras que "Ops x rango de fechas" cuenta por fecha de
//  CONFIRMACIÓN, o sea "cuánto volvió ese día" — y es el criterio que cuadró
//  contra SAP. Las dos vistas mostraban números distintos del mismo día sin
//  que nadie pudiera explicar la diferencia.
//
//  Medido el 15-10-2026 sobre el 13/10: por confirmación 8.142 pallets en 25
//  operaciones; por fecha requerida 5.001 en 17. Los 8.142 se descomponen en
//  5.001 pedidos ese mismo día + 2.440 del 12 (feriado) + 357 del 09 + 254 del
//  08 + 90 del 07. En un rango de 14 días la diferencia cae a 0,4% porque lo
//  que se escapa por un borde entra por el otro; por día llega al 100%.
//
//  DE DÓNDE SALE. Los blobs hist/ guardan agregados, no filas: el detalle para
//  re-fechar un retiro ya no está ahí. La fuente es el cold store de
//  operaciones (redtec-os-operaciones), que guarda las filas crudas y se
//  indexa por fechaRequerida — por eso un retiro confirmado el martes puede
//  vivir en el blob del viernes, y hay que barrer una ventana a cada lado.
//
//  COSTO. Barrer la historia completa son ~1.300 blobs. Como una confirmación
//  llega siempre dentro de pocas semanas, la corrida diaria sólo recalcula los
//  últimos OS_ROLLUP_CONF_DIAS (60 por defecto) y conserva el resto del blob
//  anterior. La primera corrida — o si el blob anterior no trae el criterio
//  nuevo — barre todo sola, para que la serie nunca quede mezclada.
//
//  Se conserva el número viejo en `retiros_req` (por fecha requerida): sirve
//  para comparar, para volver atrás, y para que nadie tenga que adivinar qué
//  cambió.
//  ──────────────────────────────────────────────────────────────────────────
//
//  SALIDA · resumen/diario.json
//      { generado, desde, hasta, criterio_retiros:'confirmacion', conceptos:[...],
//        dias: { "2026-07-15": {emisiones:n, retiros:n, retiros_req:n,
//                               transferencias:n, devoluciones:n, recogida:n,
//                               reparacion:n} } }
//
//  Uso:
//    node scripts/rollup-diario.js                 # 2023-03-20 -> ayer
//    node scripts/rollup-diario.js 2026-09-17
//    node scripts/rollup-diario.js 2026-10-14 --todo   # rebarre toda la historia
//    node scripts/rollup-diario.js 2026-10-14 --dry    # compara y NO escribe
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');
const cache = require('../api/shared/cache-dia.js');
const cold  = require('../api/shared/cold-operaciones.js');
const mov   = require('../api/shared/movimientos.js');

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

const CRITERIO_RETIROS = 'confirmacion';

function entero(v, def) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : def; }
// Días de confirmación que se recalculan en cada corrida.
const VENTANA_CONF    = Math.max(1, entero(process.env.OS_ROLLUP_CONF_DIAS, 60));
// Cuánto hay que leer hacia atrás y hacia adelante para encontrar esas filas:
// el blob se indexa por fecha REQUERIDA, no por la de confirmación.
const BUSCAR_ATRAS    = entero(process.env.OS_ROLLUP_CONF_ATRAS, 60);
const BUSCAR_ADELANTE = entero(process.env.OS_ROLLUP_CONF_ADELANTE, 45);
const LOTE_COLD       = 12;

function ayerIso() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
function sumaDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

function diaVacio() {
  const o = {};
  for (const c of CONCEPTOS) o[c] = 0;
  return o;
}

// ── Retiros por fecha de CONFIRMACIÓN, desde el cold store ──────────────────
// Devuelve { porDia: {fecha: {total, santiago, ...}}, blobs, filas, ... }.
// Todo es inyectable (container / leerDia) para poder probarlo sin Azure.
async function retirosPorConfirmacion(desde, hasta, opts) {
  opts = opts || {};
  const container = opts.container !== undefined ? opts.container : cold.getContainer();
  const leerDia   = opts.leerDia || ((c, f) => cold.leerDia(c, f, { sinRl: true }));
  const log       = opts.log || (() => {});

  // El blob se indexa por fecha requerida: un retiro confirmado dentro de la
  // ventana puede estar guardado antes (confirmación tardía) o después
  // (confirmado antes de la fecha pedida). Por eso se lee más ancho de lo que
  // se va a escribir, igual que el margen del backfill.
  const barrDesde = sumaDias(desde, -BUSCAR_ATRAS);
  const barrHasta = sumaDias(hasta, BUSCAR_ADELANTE);
  const fechas = cache.rangoDias(barrDesde, barrHasta);
  log(`  retiros por confirmación: ${desde} → ${hasta} (barriendo ${barrDesde} → ${barrHasta}, ${fechas.length} blobs)`);

  const porDia = {};
  const vistos = new Set();     // una operación cuenta una sola vez aunque aparezca en dos blobs
  let blobs = 0, filas = 0, retiros = 0, fuera = 0, sinConfirmar = 0;

  for (let i = 0; i < fechas.length; i += LOTE_COLD) {
    const grupo = fechas.slice(i, i + LOTE_COLD);
    const lote = await Promise.all(grupo.map(f =>
      Promise.resolve(leerDia(container, f)).catch(() => null)));
    for (const ops of lote) {
      if (!ops) continue;
      blobs++;
      for (const o of ops) {
        filas++;
        // Clasificación CANÓNICA: 'reparacion' va antes que 'retiros' en la
        // lista de movimientos.js, así que "Retiro - Reparación" queda fuera
        // del pool sin que haya que repetir esa regla acá.
        if (mov.conceptoDe(o.operacion) !== 'retiros') continue;
        retiros++;
        const fc = String(o.fechaConfirmacion || '').slice(0, 10);
        if (!fc) { sinConfirmar++; continue; }   // sin confirmar no es de ningún día
        if (fc < desde || fc > hasta) { fuera++; continue; }
        const id = o.formHeaderiD || o.nroPedido;
        if (id !== undefined && id !== null && id !== '') {
          const k = String(id);
          if (vistos.has(k)) continue;
          vistos.add(k);
        }
        const v = Number(o.cantidadConfirmada) || 0;
        if (!porDia[fc]) { porDia[fc] = { total: 0 }; for (const p of PLANTAS) porDia[fc][p] = 0; }
        porDia[fc].total += v;
        porDia[fc][mov.plantaDe(o)] += v;
      }
    }
  }
  return { porDia, blobs, filas, retiros, fuera, sinConfirmar, barrido: { desde: barrDesde, hasta: barrHasta } };
}

// Lee el resumen anterior para conservar los días fuera de la ventana.
async function leerPrevio(container) {
  try {
    const dl = await container.getBlobClient(SALIDA).download();
    const chunks = [];
    for await (const c of dl.readableStreamBody) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) { return null; }
}

async function construir(hasta, log, opts) {
  log = log || console.log;
  opts = opts || {};
  const container = opts.container !== undefined ? opts.container : cache.getContainer();
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

  // ── Re-fechado de los retiros ─────────────────────────────────────────────
  const previo = opts.previo !== undefined ? opts.previo : await leerPrevio(container);
  const sirvePrevio = !!(previo && previo.criterio_retiros === CRITERIO_RETIROS && previo.dias);
  const completo = !!opts.todo || !sirvePrevio;
  if (!sirvePrevio && !opts.todo) {
    log('  (el resumen anterior no trae el criterio de confirmación: se rebarre la historia completa)');
  }
  const confDesde = completo ? INICIO : sumaDias(hasta, -(VENTANA_CONF - 1));
  const conf = await retirosPorConfirmacion(confDesde, hasta, Object.assign({ log }, opts.cold || {}));

  const claves = new Set(Object.keys(dias).concat(Object.keys(conf.porDia)));
  let diasMovidos = 0, sumaReq = 0, sumaConf = 0, mayor = null;
  for (const f of claves) {
    if (f < INICIO || f > hasta) continue;
    let o = dias[f];
    if (!o) o = dias[f] = diaVacio();           // día que sólo existe por una confirmación
    o.retiros_req = Number(o.retiros) || 0;     // lo que decía antes, por fecha requerida
    if (f >= confDesde) {
      const c = conf.porDia[f];
      o.retiros = c ? c.total : 0;
      const p = {};
      if (c) for (const k of PLANTAS) if (c[k]) p[k] = c[k];
      if (Object.keys(p).length) o.retiros_planta = p; else delete o.retiros_planta;
    } else {
      const ant = previo.dias[f];
      o.retiros = ant ? (Number(ant.retiros) || 0) : 0;
      if (ant && ant.retiros_planta) o.retiros_planta = ant.retiros_planta; else delete o.retiros_planta;
    }
    sumaReq += o.retiros_req; sumaConf += o.retiros;
    const d = Math.abs(o.retiros - o.retiros_req);
    if (d) {
      diasMovidos++;
      if (!mayor || d > mayor.dif) mayor = { fecha: f, dif: d, req: o.retiros_req, conf: o.retiros };
    }
  }

  const claves2 = Object.keys(dias).sort();
  return {
    generado: new Date().toISOString(),
    desde: claves2[0], hasta: claves2[claves2.length - 1],
    dias_leidos: leidos, dias_con_datos: claves2.length, dias_en_cero: vacios,
    criterio_retiros: CRITERIO_RETIROS,
    conceptos: CONCEPTOS, plantas: PLANTAS,
    retiros_refechados: {
      desde: confDesde, completo, ventana_dias: VENTANA_CONF,
      blobs_leidos: conf.blobs, filas_leidas: conf.filas, retiros_vistos: conf.retiros,
      sin_confirmar: conf.sinConfirmar, fuera_de_ventana: conf.fuera,
      dias_que_cambian: diasMovidos, suma_requerida: sumaReq, suma_confirmacion: sumaConf,
      mayor_diferencia: mayor,
    },
    dias,
  };
}

module.exports = { construir, diaPlano, retirosPorConfirmacion, sumaDias, CONCEPTOS, PLANTAS, CRITERIO_RETIROS };

if (require.main === module) {
  (async () => {
    if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
    const args = process.argv.slice(2);
    const dry  = args.includes('--dry');
    const todo = args.includes('--todo');
    const hasta = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || ayerIso();
    const roll = await construir(hasta, console.log, { todo });
    const r = roll.retiros_refechados;
    console.log(`\n  retiros re-fechados desde ${r.desde}${r.completo ? ' (historia completa)' : ''}: `
      + `${r.blobs_leidos} blobs, ${r.retiros_vistos.toLocaleString('es-CL')} retiros, `
      + `${r.sin_confirmar.toLocaleString('es-CL')} sin confirmar`);
    console.log(`  días que cambian: ${r.dias_que_cambian} · suma por requerida ${r.suma_requerida.toLocaleString('es-CL')} `
      + `vs por confirmación ${r.suma_confirmacion.toLocaleString('es-CL')} `
      + `(${((r.suma_confirmacion - r.suma_requerida) / (r.suma_requerida || 1) * 100).toFixed(2)}%)`);
    if (r.mayor_diferencia) {
      const m = r.mayor_diferencia;
      console.log(`  mayor diferencia en un día: ${m.fecha} · requerida ${m.req.toLocaleString('es-CL')} `
        + `vs confirmación ${m.conf.toLocaleString('es-CL')}`);
    }
    if (dry) { console.log('\n--dry: no se escribió nada.'); return; }
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
