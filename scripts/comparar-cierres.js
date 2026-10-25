// ============================================================================
//  scripts/comparar-cierres.js  ·  M3DATA · lo que cambio despues de cerrado
//
//  QUE CONTESTA. Cuanto se movio hacia atras: documentos posteados con fecha
//  vieja despues de que ese dia ya habia cerrado.
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

function veredicto(r) {
  const p = [];
  let limpio = true;
  for (const b of (r || [])) {
    if (!b.ok) { p.push(b.bodega + ': no hay dos copias para comparar todavia (' + b.n + ').'); limpio = false; continue; }
    if (!b.ret.dias) { p.push(b.bodega + ': los ' + b.ret.comparados + ' dias ya cerrados siguen igual.'); continue; }
    limpio = false;
    p.push(b.bodega + ': ' + b.ret.dias + ' dia(s) ya cerrados cambiaron, ' +
           conSigno(b.ret.total) + ' pallets en total — ' +
           b.ret.detalle.slice(0, 3).map(x => x.dia + ' ' + conSigno(x.cambio)).join(', ') +
           '. Se posteo con fecha pasada despues del cierre.');
  }
  if (!p.length) return { nivel: 'sin datos', texto: 'No habia nada que comparar.' };
  return { nivel: limpio ? 'si' : 'revisar', texto: p.join('  ') };
}

module.exports = { parDeCopias, nivelDe, veredicto, OPCIONES };

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
    res.push({ bodega, ok: true, par, ret, nivelAntes: nivelDe(a), nivelAhora: nivelDe(b) });
    console.log('\n  ' + bodega + '   ' + par.antes.fecha + ' → ' + par.ahora.fecha);
    console.log('    nivel de bodega : ' + mil(nivelDe(a)) + ' → ' + mil(nivelDe(b)) +
                '   (' + conSigno(nivelDe(b) - nivelDe(a)) + ', el movimiento del dia)');
    console.log('    dias comparados : ' + ret.comparados);
    if (!ret.dias) console.log('    cambios hacia atras: ninguno — los dias cerrados siguen igual');
    else {
      console.log('    CAMBIOS HACIA ATRAS: ' + ret.dias + ' dia(s), ' + conSigno(ret.total) + ' pallets');
      for (const d of ret.detalle.slice(0, 10))
        console.log('       ' + d.dia + '   ' + mil(d.antes) + ' → ' + mil(d.ahora) +
                    '   ' + conSigno(d.cambio));
    }
  }
  const v = veredicto(res);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);
  console.log('\n  Un dia ya cerrado no deberia cambiar. Cuando cambia, alguien posteo con');
  console.log('  fecha vieja: no es un error del tablero, es informacion que la lectura');
  console.log('  directa de SAP no puede dar porque no guarda memoria del dia anterior.\n');
}

if (require.main === module) main();
