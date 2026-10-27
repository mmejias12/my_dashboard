// ============================================================================
//  scripts/comparar-cierres.js  ·  M3DATA · lo que cambio despues de cerrado
//
//  QUE CONTESTA. Cuanto se movio hacia atras: movimiento que aparecio con
//  fecha vieja despues de que ese dia ya habia cerrado.
//
//  POR QUE IMPORTA. El nivel a una fecha medido hoy y medido ayer tienen que
//  dar lo mismo —el cierre del 23 es la apertura del 24, por construccion—.
//  Cuando no dan, es que entre las dos mediciones alguien posteo con fecha
//  pasada. SAP acepta eso sin problema, y lo vimos: el 2026-10-26 ya tenia
//  movimiento el 2026-10-25.
//
//  Y ES LO UNICO QUE UNA LECTURA EN VIVO NO PUEDE VER. Una consulta a SAP
//  devuelve siempre la verdad de ahora, sin memoria: no sabe que ayer decia
//  otra cosa. Por eso el tablero guarda una copia fechada por dia, y por eso
//  el numero que sale de aca no lo tiene nadie en REDTEC hoy.
//
//  SOLO LEE archivos locales. No toca SAP ni el storage.
//
//  Uso (PowerShell):
//    node scripts/comparar-cierres.js --dir=portal/historico
//    node scripts/comparar-cierres.js --dir=portal/historico --hasta=2026-10-25
// ============================================================================
'use strict';

const P = require('./saldo-pool.js');      // posteoRetroactivo y sinBom: una regla, un lugar

const args = process.argv.slice(2);
const OPCIONES = ['dir', 'hasta', 'tope'];
const opcion = (n, d) => {
  const p = '--' + n + '=';
  for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length);
  return d;
};
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** Las dos copias que hay que comparar: la mas nueva y la inmediatamente
 *  anterior. No la primera contra la ultima: lo que se busca es lo que cambio
 *  DESDE LA ULTIMA VEZ QUE MIRAMOS, no desde el principio de los tiempos. */
function parDeCopias(nombres, prefijoBodega, hasta) {
  const re = new RegExp('^(\\d{4}-\\d{2}-\\d{2})-' + prefijoBodega + '\\.json$');
  const f = [];
  for (const n of (nombres || [])) {
    const m = re.exec(String(n || ''));
    if (!m) continue;
    if (hasta && m[1] > String(hasta)) continue;
    f.push({ fecha: m[1], archivo: n });
  }
  f.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  if (f.length < 2) return { ok: false, n: f.length, ahora: f[f.length - 1] || null, antes: null };
  return { ok: true, n: f.length, antes: f[f.length - 2], ahora: f[f.length - 1] };
}

/** El nivel de la bodega en cada copia. Si cambio, no es retroactivo: es que
 *  paso un dia. Lo que se compara son los cierres POR DIA, no el total. */
function nivelDe(json) {
  const n = json && json.nivel;
  return n && n.bodega != null ? Number(n.bodega) : null;
}

/** TODOS los dias que estan en las dos copias, con lo que cambio el cierre
 *  de cada uno —los que no cambiaron tambien, con cambio 0—.
 *
 *  Los dias sin cambio no sobran: sin ellos no hay forma de distinguir un
 *  desplazamiento de la serie entera de un posteo suelto, y esa distincion
 *  es justo lo que hay que hacer. Sin orden garantizado: ordena separarDeriva,
 *  que es quien lo necesita. */
function serieDeCambios(antes, ahora) {
  const a = new Map();
  for (const x of (Array.isArray(antes) ? antes : []))
    if (x && x.dia != null) a.set(String(x.dia), x);
  const out = [], visto = new Set();
  for (const x of (Array.isArray(ahora) ? ahora : [])) {
    if (!x || x.dia == null) continue;
    const k = String(x.dia);
    if (visto.has(k) || !a.has(k)) continue;
    visto.add(k);
    const ant = Number(a.get(k).cierre) || 0, aho = Number(x.cierre) || 0;
    out.push({ dia: k, antes: ant, ahora: aho, cambio: aho - ant });
  }
  return out;
}

/** SEPARA EL DESPLAZAMIENTO DE TODA LA SERIE DE LOS POSTEOS DE VERDAD.
 *
 *  POR QUE HACE FALTA, medido el 27-10-2026: la comparacion cruda reporto
 *  "297 dias cambiaron, -183.987 pallets". Mirando el detalle, 296 de esos
 *  dias habian cambiado exactamente -613 y uno solo -2.539. Un posteo con
 *  fecha vieja no mueve 297 dias en la misma cantidad; -183.987 no es ningun
 *  pallet, es un numero que asusta sin informar.
 *
 *  LA ARITMETICA. El nivel se calcula hacia atras:
 *      nivel(t) = ancla − suma de los movimientos posteriores a t
 *  Entonces, entre dos mediciones:
 *      cambio(t) = Δancla − suma de los Δmovimiento posteriores a t
 *  y restando dos dias consecutivos se despeja el movimiento de uno solo:
 *      Δmovimiento(t) = cambio(t) − cambio(t anterior)
 *  Eso es exacto, no es una estimacion: no hay promedio ni mediana ni umbral
 *  que elegir. Un Δmovimiento distinto de cero es un dia cuyo movimiento se
 *  reescribio despues de cerrado, y ese si es el posteo retroactivo.
 *
 *  LA DERIVA es lo que queda: el cambio del dia MAS VIEJO de la serie, que
 *  ningun movimiento posterior explica. Es cuanto se movio el ancla sin que
 *  la capa de ubicaciones registrara la fila correspondiente. No es ruido, es
 *  otra medicion, y se reparte identica sobre todos los dias hacia atras.
 *
 *  LEY QUE TIENE QUE CUMPLIR:  deriva + suma de los Δmovimiento = cambio del
 *  dia mas nuevo. Las dos puntas de la serie tienen que cerrar contra el
 *  medio; si no cierran, la descomposicion esta mal. */
function separarDeriva(serie) {
  const xs = (Array.isArray(serie) ? serie : [])
    .filter(d => d && d.dia != null && isFinite(Number(d.cambio)))
    .sort((p, q) => String(p.dia) < String(q.dia) ? -1 : String(p.dia) > String(q.dia) ? 1 : 0);
  if (!xs.length) return { deriva: 0, dias: [], total: 0, n: 0 };
  const dias = [];
  for (let i = 1; i < xs.length; i++) {
    const real = Number(xs[i].cambio) - Number(xs[i - 1].cambio);
    if (real) dias.push({ dia: xs[i].dia, antes: xs[i].antes, ahora: xs[i].ahora,
                          cambio: Number(xs[i].cambio), real });
  }
  dias.sort((p, q) => Math.abs(q.real) - Math.abs(p.real) ||
                      (String(p.dia) < String(q.dia) ? -1 : String(p.dia) > String(q.dia) ? 1 : 0));
  return { deriva: Number(xs[0].cambio), dias, n: xs.length,
           total: dias.reduce((s, d) => s + d.real, 0) };
}

function veredicto(r) {
  const p = [];
  let limpio = true;
  for (const b of (r || [])) {
    if (!b.ok) { p.push(b.bodega + ': no hay dos copias para comparar todavia (' + b.n + ').'); limpio = false; continue; }
    const s = b.sep || { deriva: 0, dias: [], total: 0, n: 0 };
    const partes = [];
    if (s.deriva) partes.push('deriva de ' + conSigno(s.deriva) +
        ' en los ' + s.n + ' dias: movimiento de bodega que la capa de ubicaciones no vio');
    if (s.dias.length) partes.push(s.dias.length + ' dia(s) reescritos despues de cerrados, ' +
        conSigno(s.total) + ' pallets — ' +
        s.dias.slice(0, 3).map(x => x.dia + ' ' + conSigno(x.real)).join(', ') +
        '. Se posteo con fecha pasada despues del cierre');
    if (!partes.length) partes.push('los ' + s.n + ' dias ya cerrados siguen igual');
    else limpio = false;
    p.push(b.bodega + ': ' + partes.join('; ') + '.');
  }
  if (!p.length) return { nivel: 'sin datos', texto: 'No habia nada que comparar.' };
  return { nivel: limpio ? 'si' : 'revisar', texto: p.join('  ') };
}

module.exports = { parDeCopias, nivelDe, serieDeCambios, separarDeriva, veredicto, OPCIONES };

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const fs = require('fs'), path = require('path');
  const dir = opcion('dir', 'portal/historico');
  const hasta = opcion('hasta', null);
  let nombres = [];
  try { nombres = fs.readdirSync(dir); }
  catch (e) { console.error('No se pudo leer ' + dir + ': ' + e.message); process.exit(1); }

  console.log('\n── LO QUE CAMBIO DESPUES DE CERRADO ' + '─'.repeat(38));
  const res = [];
  for (const [bodega, pref] of [['RETAIL', 'stock-retail'], ['CLIENTES', 'stock-clientes']]) {
    const par = parDeCopias(nombres, pref, hasta);
    if (!par.ok) { res.push({ bodega, ok: false, n: par.n }); continue; }
    const leer = f => JSON.parse(P.sinBom(fs.readFileSync(path.join(dir, f), 'utf8')));
    let a, b;
    try { a = leer(par.antes.archivo); b = leer(par.ahora.archivo); }
    catch (e) { console.error('  ' + bodega + ': no se pudo leer una copia: ' + e.message); continue; }
    const ret = P.posteoRetroactivo(a.dias, b.dias);
    const serie = serieDeCambios(a.dias, b.dias);
    const sep = separarDeriva(serie);
    res.push({ bodega, ok: true, par, ret, sep, nivelAntes: nivelDe(a), nivelAhora: nivelDe(b) });

    console.log('\n  ' + bodega + '   ' + par.antes.fecha + ' → ' + par.ahora.fecha);
    console.log('    nivel de bodega : ' + mil(nivelDe(a)) + ' → ' + mil(nivelDe(b)) +
                '   (' + conSigno(nivelDe(b) - nivelDe(a)) + ', el movimiento del dia)');
    console.log('    dias comparados : ' + sep.n + '   ·   con otro numero: ' + ret.dias);
    if (ret.comparados !== sep.n)
      console.log('    OJO: dos conteos distintos de dias comparados (' + ret.comparados +
                  ' vs ' + sep.n + '). Hay dias repetidos en una de las copias.');

    if (sep.deriva) {
      console.log('    DERIVA DE LA SERIE: ' + conSigno(sep.deriva) + ' en los ' + sep.n + ' dias.');
      console.log('      No es posteo retroactivo: es movimiento de bodega que la capa de');
      console.log('      ubicaciones no vio, y el calculo hacia atras lo reparte en toda la serie.');
    } else {
      console.log('    deriva de la serie: ninguna — el ancla y las ubicaciones se movieron igual');
    }
    if (!sep.dias.length) console.log('    posteo retroactivo: ninguno — ningun dia cambio su propio movimiento');
    else {
      console.log('    POSTEO RETROACTIVO: ' + sep.dias.length + ' dia(s), ' +
                  conSigno(sep.total) + ' pallets (movimiento reescrito despues del cierre)');
      for (const d of sep.dias.slice(0, 10))
        console.log('       ' + d.dia + '   cierre ' + mil(d.antes) + ' → ' + mil(d.ahora) +
                    '   ·   su movimiento del dia cambio ' + conSigno(d.real));
    }
  }
  const v = veredicto(res);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);
  console.log('\n  Un dia ya cerrado no deberia cambiar su movimiento. Cuando cambia, alguien');
  console.log('  posteo con fecha vieja: no es un error del tablero, es informacion que la');
  console.log('  lectura directa de SAP no puede dar porque no guarda memoria de ayer.\n');
}

if (require.main === module) main();
