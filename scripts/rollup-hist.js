// ============================================================================
//  scripts/rollup-hist.js  ·  Agregados diarios SIN pasar por el proveedor
//
//  QUÉ HACE. Reconstruye los agregados hist/YYYY-MM-DD.json (contenedor
//  redtec-os-hist) leyendo el cold store de operaciones redtec-os-operaciones,
//  que backfill-operaciones.js llena DIRECTO de Redlink. Reemplaza al paso 1 de
//  la corrida diaria (backfill/backfill.js), que pedía las mismas filas al API
//  del proveedor que se da de baja.
//
//  POR QUÉ. Los dos almacenes se archivan por la MISMA clave de día
//  (fechaRequerida) y el cold guarda las filas en el contrato RDT, así que los
//  agregados salen de ahí con el mismo agregador (movimientos.js) y sin una
//  segunda llamada a nadie. De paso, resumen/diario.json deja de mezclar dos
//  orígenes: hoy sus agregados vienen del proveedor viejo y sus retiros por
//  confirmación del cold.
//
//  REGLA QUE NO SE NEGOCIA. Un día sin blob en el cold NO se escribe. Podría
//  ser un domingo sin movimiento, pero también un hueco de la ingesta, y
//  escribir ceros encima de un día bueno destruye historia. Se informa y se
//  salta.
//
//  Uso:
//    node scripts/rollup-hist.js 2026-10-01 2026-10-31 --comparar   (no escribe)
//    node scripts/rollup-hist.js 2026-10-01 2026-10-31
//    node scripts/rollup-hist.js                       (ventana de 45 días → ayer)
//
//  Variables: OS_STORAGE_CONN (obligatoria), OS_OPS_HIST_CONTAINER y
//  OS_HIST_CONTAINER si los contenedores no son los de siempre.
// ============================================================================
'use strict';

const cold  = require('../api/shared/cold-operaciones.js');
const cache = require('../api/shared/cache-dia.js');
const mov   = require('../api/shared/movimientos.js');

const VENTANA_DIAS = 45;

// ── "no existe" vs "no pude leer" ───────────────────────────────────────────
// El guard de cache-dia.js y cold-operaciones.js mira el TEXTO del error, y el
// SDK de Azure manda "The specified blob does not exist." sin la palabra
// BlobNotFound: así, un día sin blob se escapaba como excepción y cortaba la
// corrida (medido el 4-nov-2026 en la primera comparación real). Acá se
// clasifica por código Y por texto, y se distingue un día ausente de un
// problema para leer: unas credenciales malas NO pueden parecerse a un día sin
// movimiento, porque entonces el rollup escribiría ceros con toda confianza.
function noExiste(e) {
  if (!e) return false;
  const cod = String((e && e.code) || (e && e.details && e.details.errorCode) || '');
  if (e.statusCode === 404 || cod === 'BlobNotFound' || cod === 'ContainerNotFound') return true;
  return /BlobNotFound|ContainerNotFound|does not exist|no existe/i.test(String(e.message || ''));
}
// Devuelve null si el blob no está; vuelve a lanzar, con contexto, si el
// problema es otro.
async function leerSuave(fn, que) {
  try { return await fn(); }
  catch (e) {
    if (noExiste(e)) return null;
    throw new Error(que + ' · ' + (e && e.message ? e.message.split('\n')[0] : String(e)));
  }
}

function iso(d) { return d.toISOString().slice(0, 10); }
function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d);
}
function ayerCL() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return sumarDias(hoy, -1);
}
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));

// ── Construir los agregados del rango desde el cold ─────────────────────────
// Lee día por día (no leerRango) por dos razones: así se sabe QUÉ día del cold
// faltaba, y no se arrastra el rango entero en memoria.
async function construir(desde, hasta, opts) {
  opts = opts || {};
  const container = opts.container !== undefined ? opts.container : cold.getContainer();
  const leerDia   = opts.leerDia || ((c, f) => cold.leerDia(c, f, { sinRl: true }));
  if (!container) throw new Error('sin cold store: falta OS_STORAGE_CONN');

  const porDia = {}, conBlob = [], faltantes = [];
  let filas = 0, repetidas = 0;
  const vistos = new Set();   // nroPedido ya contado: el cold no deduplica entre días

  for (const f of cold.rangoDias(desde, hasta)) {
    const arr = await leerSuave(() => leerDia(container, f), 'no se pudo leer el cold de ' + f);
    if (!arr) { faltantes.push(f); continue; }
    conBlob.push(f);
    const nuevas = [];
    for (const o of arr) {
      const id = String((o && o.nroPedido) || '');
      if (id && vistos.has(id)) { repetidas++; continue; }
      if (id) vistos.add(id);
      nuevas.push(o);
    }
    filas += nuevas.length;
    mov.agregarPorDiaEn(nuevas, porDia);
  }
  return { porDia, conBlob, faltantes, filas, repetidas };
}

// Días a tocar: los que tienen blob en el cold Y caen dentro del rango pedido.
// Una fila cuya fechaRequerida cae afuera abre su propio bucket; ese bucket no
// se escribe, porque esta corrida no leyó su día completo y escribirlo dejaría
// un agregado parcial.
function diasAEscribir(porDia, conBlob, desde, hasta) {
  const hay = new Set(conBlob);
  return Object.keys(porDia).filter(f => f >= desde && f <= hasta && hay.has(f)).sort();
}

// ── Comparar contra lo que ya está guardado ─────────────────────────────────
const CAMPOS = ['emisiones', 'retiros', 'devoluciones', 'recogida', 'transferencias', 'reparacion'];
const tot = v => (v && typeof v === 'object') ? Number(v.total) || 0 : Number(v) || 0;

function diferenciasDia(nuevo, viejo) {
  const d = [];
  for (const c of CAMPOS) {
    const a = tot(nuevo[c]), b = tot(viejo ? viejo[c] : 0);
    if (a !== b) d.push({ concepto: c, nuevo: a, guardado: b, dif: a - b });
  }
  return d;
}

// ¿El agregado guardado de un día tiene algo? Sirve para la alarma de abajo.
function tieneMovimiento(dia) {
  if (!dia) return false;
  return CAMPOS.some(c => tot(dia[c]) !== 0);
}

// Lo que decide el veredicto final de la comparación. Vive aparte para que la
// frase que se lee en pantalla sea exactamente lo que se puede probar: un día
// con diferencia O un hueco del cold obligan a revisar antes de conmutar.
const hayQueRevisar = (r) => !!((r.distintos && r.distintos.length) || (r.huecos && r.huecos.length));

async function comparar(desde, hasta, opts) {
  opts = opts || {};
  const r = await construir(desde, hasta, opts);
  const cont = opts.contenedorHist !== undefined ? opts.contenedorHist : cache.getContainer();
  const leer = opts.leerHist || ((c, f) => cache.leerDia(c, f));
  const fechas = diasAEscribir(r.porDia, r.conBlob, desde, hasta);
  const iguales = [], distintos = [], nuevos = [];
  for (const f of fechas) {
    const nuevo = mov.paraCache(r.porDia[f]);
    const viejo = await leerSuave(() => leer(cont, f), 'no se pudo leer el agregado guardado de ' + f);
    if (!viejo) { nuevos.push(f); continue; }
    const d = diferenciasDia(nuevo, viejo);
    (d.length ? distintos : iguales).push({ fecha: f, diferencias: d });
  }

  // LA ALARMA QUE IMPORTA de los días sin blob en el cold. Un domingo sin
  // movimiento no tiene blob y está perfecto; pero si el agregado guardado de
  // ese día SÍ tiene movimiento, entonces al cold le falta un día que el
  // histórico sí vio, y eso hay que resolverlo antes de que el cold sea la
  // única fuente. La regla de no escribirlo protege el dato; esto lo denuncia.
  const huecos = [], vacios = [];
  for (const f of r.faltantes) {
    if (f < desde || f > hasta) continue;
    const viejo = await leerSuave(() => leer(cont, f), 'no se pudo leer el agregado guardado de ' + f);
    if (tieneMovimiento(viejo)) {
      const g = viejo || {};
      huecos.push({ fecha: f, guardado: CAMPOS.reduce((o, c) => { const v = tot(g[c]); if (v) o[c] = v; return o; }, {}) });
    } else vacios.push(f);
  }

  return Object.assign({}, r, { fechas, iguales, distintos, nuevos, huecos, vacios });
}

async function escribir(desde, hasta, opts) {
  opts = opts || {};
  const r = await construir(desde, hasta, opts);
  const cont = opts.contenedorHist !== undefined ? opts.contenedorHist : cache.getContainer();
  const guardar = opts.guardarDia || ((c, f, acc) => cache.guardarDia(c, f, acc));
  const fechas = diasAEscribir(r.porDia, r.conBlob, desde, hasta);
  for (const f of fechas) await guardar(cont, f, r.porDia[f]);
  return Object.assign({}, r, { fechas, escritos: fechas.length });
}

module.exports = { construir, diasAEscribir, diferenciasDia, tieneMovimiento, hayQueRevisar, comparar, escribir, noExiste, VENTANA_DIAS };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const soloComparar = args.includes('--comparar');
  const libres = args.filter(a => !a.startsWith('--'));
  const hasta = esFecha(libres[1]) ? libres[1] : (esFecha(libres[0]) ? libres[0] : ayerCL());
  const desde = esFecha(libres[1]) ? libres[0]
              : (esFecha(libres[0]) ? sumarDias(libres[0], -(VENTANA_DIAS - 1)) : sumarDias(hasta, -(VENTANA_DIAS - 1)));
  if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) {
    console.error('Rango inválido: ' + desde + ' .. ' + hasta); process.exit(2);
  }
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  const n = x => Number(x).toLocaleString('es-CL');
  console.log((soloComparar ? 'COMPARAR (no escribe)' : 'RECONSTRUIR') + '  ' + desde + ' .. ' + hasta +
              '\nFuente: ' + cold.CONTAINER + '  →  destino: ' + cache.CONTAINER + '\n');

  if (soloComparar) {
    const r = await comparar(desde, hasta);
    console.log('Días con blob en el cold : ' + r.conBlob.length + (r.faltantes.length ? '   (sin blob: ' + r.faltantes.length + ')' : ''));
    console.log('Filas agregadas          : ' + n(r.filas) + (r.repetidas ? '   (repetidas descartadas: ' + n(r.repetidas) + ')' : ''));
    console.log('Días iguales             : ' + r.iguales.length);
    console.log('Días que no existían     : ' + r.nuevos.length + (r.nuevos.length ? '  → ' + r.nuevos.join(' ') : ''));
    console.log('Días con diferencia      : ' + r.distintos.length);
    for (const d of r.distintos) {
      console.log('\n  ' + d.fecha);
      for (const x of d.diferencias) {
        console.log('    ' + x.concepto.padEnd(16) + 'cold ' + n(x.nuevo).padStart(9) +
                    '   guardado ' + n(x.guardado).padStart(9) +
                    '   dif ' + (x.dif > 0 ? '+' : '') + n(x.dif));
      }
    }
    if (r.vacios.length) console.log('\nSin blob en el cold y sin movimiento guardado (normal): ' + r.vacios.join(' '));
    if (r.huecos.length) {
      console.log('\n*** HUECOS DEL COLD · días sin blob cuyo agregado guardado SÍ tiene movimiento:');
      for (const h of r.huecos) console.log('    ' + h.fecha + '  ' +
        Object.keys(h.guardado).map(k => k + ' ' + n(h.guardado[k])).join(' · '));
      console.log('    Al cold le falta historia que el agregado sí vio: hay que rellenarlo');
      console.log('    (backfill-operaciones.js para esos días) antes de que sea la única fuente.');
    }
    console.log('\n' + (hayQueRevisar(r)
      ? 'HAY DIFERENCIAS: revisarlas antes de conmutar el paso 1.'
      : 'Los agregados del cold reproducen lo guardado.'));
    process.exit(0);
  }

  const r = await escribir(desde, hasta);
  console.log('Días con blob en el cold : ' + r.conBlob.length);
  console.log('Filas agregadas          : ' + n(r.filas) + (r.repetidas ? '   (repetidas descartadas: ' + n(r.repetidas) + ')' : ''));
  console.log('Días escritos            : ' + r.escritos + (r.escritos ? '  (' + r.fechas[0] + ' → ' + r.fechas[r.fechas.length - 1] + ')' : ''));
  if (r.faltantes.length) console.log('Sin blob en el cold (NO se escribieron): ' + r.faltantes.join(' '));
  console.log('\n✓ Agregados reconstruidos sin consultar al proveedor');
})().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
