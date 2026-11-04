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
//    node scripts/rollup-hist.js 2026-08-12 --explicar               (por qué difiere un día)
//    node scripts/rollup-hist.js 2023-01-01 2026-11-03 --comparar     (resumen por mes)
//    ... --excluir=2024-02-13,2025-02-17   (reconstruye todo menos esos días)
//    node scripts/rollup-hist.js 2024-02-13 --veredicto   (código de salida:
//        0 el cold no viene corto · 3 sigue corto · 4 sin blob)
//    ... --comparar --dias                                            (y día por día)
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

  // Lectura EN PARALELO por lotes, igual que cold.leerRango: tres años de
  // historia leídos día a día en serie son miles de viajes de ida y vuelta.
  // Pero el PROCESO es en orden de fecha a propósito: el dedupe es "gana el
  // primero", así que procesar en orden de llegada haría que el resultado
  // dependiera de qué blob contestó antes.
  const LOTE = Math.max(1, Number(opts.lote) || 24);
  const fechas = cold.rangoDias(desde, hasta);
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const leidos = await Promise.all(grupo.map(f =>
      leerSuave(() => leerDia(container, f), 'no se pudo leer el cold de ' + f).then(arr => ({ f, arr }))));
    for (const { f, arr } of leidos) {
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

  // Días en que el cold trae MENOS que lo guardado. Son los ÚNICOS en que
  // reconstruir desde el cold PIERDE dato, así que no pueden ir mezclados con
  // los demás en una lista de 358 líneas: se separan y se nombran.
  const alaBaja = distintos.filter(d => d.diferencias.some(x => x.dif < 0));

  // Impacto por mes: es lo que hay que poder contarle al área antes de que vea
  // un gráfico moverse.
  const meses = {};
  for (const d of distintos) {
    const m = d.fecha.slice(0, 7);
    const e = meses[m] || (meses[m] = { mes: m, dias: 0, conceptos: {} });
    e.dias++;
    for (const x of d.diferencias) e.conceptos[x.concepto] = (e.conceptos[x.concepto] || 0) + x.dif;
  }

  return Object.assign({}, r, { fechas, iguales, distintos, nuevos, huecos, vacios,
                                alaBaja, meses: Object.keys(meses).sort().map(m => meses[m]) });
}

async function escribir(desde, hasta, opts) {
  opts = opts || {};
  const r = await construir(desde, hasta, opts);
  const cont = opts.contenedorHist !== undefined ? opts.contenedorHist : cache.getContainer();
  const guardar = opts.guardarDia || ((c, f, acc) => cache.guardarDia(c, f, acc));
  // Días que NO se tocan, por decisión explícita: los que ya sabemos que el
  // cold trae cortos. Mejor dejarlos como están y decirlo, que taparlos con una
  // regla automática del tipo "nunca bajar", que congelaría cualquier error.
  const excluidos = new Set((opts.excluir || []).filter(Boolean));
  const todas = diasAEscribir(r.porDia, r.conBlob, desde, hasta);
  const fechas = todas.filter(f => !excluidos.has(f));
  const saltados = todas.filter(f => excluidos.has(f));
  for (const f of fechas) await guardar(cont, f, r.porDia[f]);
  return Object.assign({}, r, { fechas, escritos: fechas.length, saltados });
}

// ── ¿POR QUÉ difiere un día? ────────────────────────────────────────────────
// Una diferencia sin explicación no se puede aprobar ni descartar. Esto toma UN
// día y responde tres cosas con el dato, no con una hipótesis:
//   1. en qué concepto está el delta;
//   2. en qué contrapartes y bodegas está (el detalle que el agregado ya guarda);
//   3. si el agregado guardado se reproduce filtrando las filas por
//      fechaConfirmacion hasta cierto corte — o sea si lo que le sobra al cold
//      son confirmaciones que llegaron DESPUÉS de la última escritura del
//      agregado. El agregado de un día se reescribe mientras cae dentro de la
//      ventana de la corrida diaria, así que su última escritura fue en
//      fecha+VENTANA_DIAS; si ese corte reproduce el número guardado, la
//      explicación está cerrada.
const LADOS = ['clienteOrigen', 'clienteDestino', 'bodegaOrigen', 'bodegaDestino'];

function deltaDetalle(nuevo, viejo, concepto) {
  const dn = (nuevo.detalle && nuevo.detalle[concepto]) || {};
  const dv = (viejo && viejo.detalle && viejo.detalle[concepto]) || {};
  const out = {};
  for (const lado of LADOS) {
    const a = dn[lado] || {}, b = dv[lado] || {};
    const filas = [];
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
      const d = (Number(a[k]) || 0) - (Number(b[k]) || 0);
      if (d) filas.push({ nombre: k, cold: Number(a[k]) || 0, guardado: Number(b[k]) || 0, dif: d });
    }
    if (filas.length) out[lado] = filas.sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  }
  return out;
}

// Agrega las filas de UN día tomando sólo las confirmadas hasta el corte.
// Las filas sin fechaConfirmacion se cuentan siempre: ya estaban cuando el
// agregado se escribió, no son información nueva.
function agregarHasta(filas, fecha, corte) {
  const usables = corte === null ? filas : filas.filter(o => {
    const fc = String((o && o.fechaConfirmacion) || '').slice(0, 10);
    return !fc || fc <= corte;
  });
  const porDia = mov.agregarPorDiaEn(usables, {});
  return { acc: porDia[fecha] || mov.nuevoAcc(), filas: usables.length };
}

// Cada lado del detalle (clienteOrigen, clienteDestino, bodegaOrigen,
// bodegaDestino) debería sumar el total del concepto: sumarDetalle carga el
// mismo valor en los cuatro. Si un lado suma MENOS, hay filas con ese campo
// vacío — el total del concepto está bien, pero el desglose por contraparte o
// bodega de ese día está corto, y ése es el que alimenta
// resumen/contrapartes.json y las respuestas por cliente del asistente.
function cuadraturaDetalle(dia, concepto) {
  const total = tot(dia && dia[concepto]);
  const d = (dia && dia.detalle && dia.detalle[concepto]) || {};
  return LADOS.map(lado => {
    const suma = Object.keys(d[lado] || {}).reduce((a, k) => a + (Number(d[lado][k]) || 0), 0);
    return { lado, suma, total, falta: total - suma };
  });
}

async function explicar(fecha, opts) {
  opts = opts || {};
  const container = opts.container !== undefined ? opts.container : cold.getContainer();
  const leerDia   = opts.leerDia || ((c, f) => cold.leerDia(c, f, { sinRl: true }));
  const cont      = opts.contenedorHist !== undefined ? opts.contenedorHist : cache.getContainer();
  const leer      = opts.leerHist || ((c, f) => cache.leerDia(c, f));
  if (!container) throw new Error('sin cold store: falta OS_STORAGE_CONN');

  const filas = await leerSuave(() => leerDia(container, fecha), 'no se pudo leer el cold de ' + fecha);
  if (!filas) return { fecha, sin_cold: true };
  const viejo = await leerSuave(() => leer(cont, fecha), 'no se pudo leer el agregado guardado de ' + fecha);
  const nuevo = mov.paraCache(agregarHasta(filas, fecha, null).acc);

  const dif = diferenciasDia(nuevo, viejo);
  const concepto = dif.length ? dif.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))[0].concepto : null;

  // Cortes a probar, en días desde la fecha del día. VENTANA_DIAS es el que
  // corresponde a la última escritura del agregado.
  const dias = [0, 7, 15, 30, 40, VENTANA_DIAS, 60, 90];
  const cortes = dias.map(n => {
    const r = agregarHasta(filas, fecha, sumarDias(fecha, n));
    const a = mov.paraCache(r.acc);
    return { dias: n, corte: sumarDias(fecha, n), filas: r.filas,
             valor: concepto ? tot(a[concepto]) : null };
  });
  const guardado = concepto ? tot(viejo ? viejo[concepto] : 0) : null;
  const calza = cortes.filter(c => c.valor === guardado).map(c => c.dias);

  return { fecha, concepto, guardado, total_cold: concepto ? tot(nuevo[concepto]) : null,
           filas_cold: filas.length, diferencias: dif, cortes, calza,
           detalle: concepto ? deltaDetalle(nuevo, viejo, concepto) : {},
           cuadratura: concepto ? { cold: cuadraturaDetalle(nuevo, concepto),
                                    guardado: cuadraturaDetalle(viejo, concepto) } : null };
}

// ── Veredicto de UN día, para que un script pueda decidir ───────────────────
// Devuelve el código de salida y la razón. Se usa con --veredicto: 0 = el cold
// no viene corto, se puede reconstruir ese día; 3 = sigue corto, NO tocarlo;
// 4 = el cold no tiene blob de ese día.
function veredicto(r) {
  if (!r || r.sin_cold) return { codigo: 4, mensaje: 'sin blob en el cold' };
  const baja = (r.diferencias || []).filter(x => x.dif < 0);
  if (baja.length) return { codigo: 3,
    mensaje: 'el cold sigue corto: ' + baja.map(x => x.concepto + ' ' + x.dif).join(' · ') };
  const alza = (r.diferencias || []).filter(x => x.dif > 0);
  return { codigo: 0, mensaje: alza.length
    ? 'el cold está completo (y trae más: ' + alza.map(x => x.concepto + ' +' + x.dif).join(' · ') + ')'
    : 'el cold coincide con lo guardado' };
}

module.exports = { construir, diasAEscribir, diferenciasDia, tieneMovimiento, hayQueRevisar,
                   comparar, escribir, explicar, agregarHasta, deltaDetalle, cuadraturaDetalle,
                   veredicto, noExiste, VENTANA_DIAS };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const soloComparar = args.includes('--comparar');
  const soloExplicar = args.includes('--explicar');
  const verDias = args.includes('--dias');
  const soloVeredicto = args.includes('--veredicto');
  const argExcluir = args.find(a => a.startsWith('--excluir='));
  const excluir = argExcluir ? argExcluir.slice('--excluir='.length).split(',').map(x => x.trim()).filter(esFecha) : [];
  const libres = args.filter(a => !a.startsWith('--'));
  const hasta = esFecha(libres[1]) ? libres[1] : (esFecha(libres[0]) ? libres[0] : ayerCL());
  const desde = esFecha(libres[1]) ? libres[0]
              : (esFecha(libres[0]) ? sumarDias(libres[0], -(VENTANA_DIAS - 1)) : sumarDias(hasta, -(VENTANA_DIAS - 1)));
  if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) {
    console.error('Rango inválido: ' + desde + ' .. ' + hasta); process.exit(2);
  }
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }

  const n = x => Number(x).toLocaleString('es-CL');

  if (soloVeredicto) {
    const dia = esFecha(libres[0]) ? libres[0] : hasta;
    const v = veredicto(await explicar(dia));
    console.log(dia + ': ' + v.mensaje);
    process.exit(v.codigo);
  }

  if (soloExplicar) {
    const dia = esFecha(libres[0]) ? libres[0] : hasta;
    console.log('EXPLICAR  ' + dia + '\n');
    const r = await explicar(dia);
    if (r.sin_cold) { console.log('El cold no tiene blob de ese día.'); process.exit(0); }
    console.log('Filas en el cold: ' + n(r.filas_cold));
    if (!r.diferencias.length) { console.log('\nNo hay diferencia con el agregado guardado.'); process.exit(0); }
    console.log('\nDiferencias por concepto:');
    for (const d of r.diferencias) console.log('  ' + d.concepto.padEnd(16) + 'cold ' + n(d.nuevo).padStart(9) +
      '   guardado ' + n(d.guardado).padStart(9) + '   dif ' + (d.dif > 0 ? '+' : '') + n(d.dif));

    console.log('\n¿Se reproduce el guardado cortando por fecha de confirmación?  (' + r.concepto + ', guardado ' + n(r.guardado) + ')');
    for (const c of r.cortes) console.log('  hasta ' + c.corte + ' (+' + String(c.dias).padStart(2) + 'd)  ' +
      n(c.valor).padStart(9) + '   ' + n(c.filas).padStart(6) + ' filas' + (c.valor === r.guardado ? '   ← calza' : ''));
    console.log(r.calza.length
      ? '\nCALZA con el corte de +' + r.calza.join(' / +') + ' días: lo que le sobra al cold son\n' +
        'confirmaciones que llegaron después de esa fecha, o sea después de la última\n' +
        'escritura del agregado. El cold está más completo, no distinto.'
      : '\nNINGÚN corte por fecha de confirmación reproduce el guardado: la diferencia NO\n' +
        'se explica por confirmaciones tardías. Hay que mirar el detalle de abajo.');

    const malos = (r.cuadratura ? r.cuadratura.cold.concat(r.cuadratura.guardado) : []).filter(x => x.falta);
    if (malos.length) {
      console.log('\n¿El desglose cuadra con el total de ' + r.concepto + '?');
      for (const lado of ['cold', 'guardado'])
        for (const x of r.cuadratura[lado].filter(y => y.falta))
          console.log('    ' + lado.padEnd(9) + x.lado.padEnd(15) + 'suma ' + n(x.suma).padStart(9) +
                      '   total ' + n(x.total).padStart(9) + '   falta ' + n(x.falta));
      console.log('    Un lado que suma menos que el total son filas con ESE CAMPO VACÍO: el');
      console.log('    total del concepto está bien, pero el desglose por contraparte o bodega');
      console.log('    de ese día queda corto (y es el que alimenta resumen/contrapartes.json).');
    }

    const lados = Object.keys(r.detalle);
    if (lados.length) {
      console.log('\nDónde está el delta de ' + r.concepto + ':');
      for (const lado of lados) {
        console.log('  ' + lado);
        for (const f of r.detalle[lado].slice(0, 8))
          console.log('    ' + String(f.nombre).slice(0, 44).padEnd(46) + 'cold ' + n(f.cold).padStart(8) +
                      '  guardado ' + n(f.guardado).padStart(8) + '  dif ' + (f.dif > 0 ? '+' : '') + n(f.dif));
      }
    }
    process.exit(0);
  }
  console.log((soloComparar ? 'COMPARAR (no escribe)' : 'RECONSTRUIR') + '  ' + desde + ' .. ' + hasta +
              '\nFuente: ' + cold.CONTAINER + '  →  destino: ' + cache.CONTAINER + '\n');

  if (soloComparar) {
    const r = await comparar(desde, hasta);
    console.log('Días con blob en el cold : ' + r.conBlob.length + (r.faltantes.length ? '   (sin blob: ' + r.faltantes.length + ')' : ''));
    console.log('Filas agregadas          : ' + n(r.filas) + (r.repetidas ? '   (repetidas descartadas: ' + n(r.repetidas) + ')' : ''));
    console.log('Días iguales             : ' + r.iguales.length);
    console.log('Días que no existían     : ' + r.nuevos.length + (r.nuevos.length ? '  → ' + r.nuevos.join(' ') : ''));
    console.log('Días con diferencia      : ' + r.distintos.length);
    if (r.distintos.length) {
      const suma = {};
      for (const d of r.distintos) for (const x of d.diferencias) suma[x.concepto] = (suma[x.concepto] || 0) + x.dif;
      console.log('\nSuma de las diferencias: ' + Object.keys(suma).map(c => c + ' ' + (suma[c] > 0 ? '+' : '') + n(suma[c])).join('  ·  '));
    }

    // Los días en que el cold trae MENOS van primero y aparte: son los únicos
    // en que reconstruir pierde dato.
    if (r.alaBaja.length) {
      console.log('\n*** EL COLD TRAE MENOS en ' + r.alaBaja.length + ' día(s) · reconstruir ahí PIERDE dato:');
      for (const d of r.alaBaja) for (const x of d.diferencias.filter(y => y.dif < 0))
        console.log('    ' + d.fecha + '  ' + x.concepto.padEnd(16) + 'cold ' + n(x.nuevo).padStart(9) +
                    '   guardado ' + n(x.guardado).padStart(9) + '   dif ' + n(x.dif));
      console.log('    Revisar con --explicar y, si el origen todavía los tiene, rellenar');
      console.log('    esos días con backfill-operaciones.js antes de reconstruir.');
    }

    // Tabla por mes: el impacto que hay que poder contar, sin leer 358 líneas.
    if (r.meses.length > 1) {
      const cols = [...new Set(r.meses.flatMap(m => Object.keys(m.conceptos)))].sort();
      console.log('\nImpacto por mes' + (verDias ? '' : '   (--dias para ver día por día)'));
      console.log('  mes       días  ' + cols.map(c => c.slice(0, 14).padStart(15)).join(''));
      for (const m of r.meses) console.log('  ' + m.mes + '  ' + String(m.dias).padStart(4) + '  ' +
        cols.map(c => (m.conceptos[c] === undefined ? '' : (m.conceptos[c] > 0 ? '+' : '') + n(m.conceptos[c])).padStart(15)).join(''));
      const porAnio = {};
      for (const m of r.meses) for (const c of Object.keys(m.conceptos))
        (porAnio[m.mes.slice(0,4)] = porAnio[m.mes.slice(0,4)] || {})[c] = (porAnio[m.mes.slice(0,4)][c] || 0) + m.conceptos[c];
      console.log('\n  por año');
      for (const a of Object.keys(porAnio).sort()) console.log('  ' + a + '      ' +
        Object.keys(porAnio[a]).sort().map(c => c + ' ' + (porAnio[a][c] > 0 ? '+' : '') + n(porAnio[a][c])).join('  ·  '));
    }

    if (verDias || r.meses.length <= 1) for (const d of r.distintos) {
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

  if (excluir.length) console.log('Días excluidos a mano    : ' + excluir.join(' ') + '\n');
  const r = await escribir(desde, hasta, { excluir });
  console.log('Días con blob en el cold : ' + r.conBlob.length);
  console.log('Filas agregadas          : ' + n(r.filas) + (r.repetidas ? '   (repetidas descartadas: ' + n(r.repetidas) + ')' : ''));
  console.log('Días escritos            : ' + r.escritos + (r.escritos ? '  (' + r.fechas[0] + ' → ' + r.fechas[r.fechas.length - 1] + ')' : ''));
  if (r.faltantes.length) console.log('Sin blob en el cold (NO se escribieron): ' + r.faltantes.join(' '));
  if (r.saltados.length) console.log('Excluidos (quedaron como estaban)     : ' + r.saltados.join(' '));
  console.log('\n✓ Agregados reconstruidos sin consultar al proveedor');
})().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
