#!/usr/bin/env node
'use strict';
// ───────────────────────────────────────────────────────────────────────────────
//  COCKPIT DEL POOL  ·  prototipo
//
//  QUE ES. La misma data que ya arma stock-flujos-pallets.html, contada como la
//  cuenta el tablero ejecutivo de ITL: una narrativa de franjas numeradas, cada
//  una con una pregunta por titulo, y un titular que dice la conclusion en una
//  frase antes de que nadie mire un grafico.
//
//  NO LEE SAP NI EL STORAGE. Lee data/datos-stock.json, que ya escribio
//  armar-tablero-stock.js en el mismo cierre. Si ese json no esta, no hay
//  pagina: no se inventa nada.
//
//  POR QUE EN PARALELO Y NO ENCIMA. stock-flujos-pallets.html es la vista de
//  detalle, con sus tablas y sus controles, y gerencia ya la usa. Esta es la
//  lectura de arriba. Conviven.
//
//  Uso:
//    node scripts/armar-cockpit-pool.js \
//      --datos=data/datos-stock.json \
//      --salida=cockpit-pool.html
// ───────────────────────────────────────────────────────────────────────────────

const T = require('./armar-tablero-stock.js');
const { mil, conSigno, pct1, esc, clasePos, esNumero, sinBom,
        plantaDeBodega, mesesDeSerie, diasDelMes, resumenDelMes, etiquetaDeMes,
        svgFlujoDia, svgNivelDia, tablaDeDias, sinCierreDeScript, jsonSeguro,
        serieCompacta, rehidratar, altoVisible, ejeDeDias, MESES } = T;

const OPCIONES = ['datos', 'salida'];

/*  EL RECORRIDO DEL PALLET.
 *
 *  El orden importa y no es el alfabetico: un pallet entra por inspeccion y
 *  sale por disponible. La etapa se saca del nombre de SAP porque SAP no tiene
 *  campo de etapa, igual que la planta. */
const ETAPAS = ['INSPECCION', 'LAVADO', 'DESARME', 'REPARACION', 'PINTURA', 'DISPONIBLE', 'TRANSITO'];

function etapaDeBodega(nom) {
  const u = String(nom == null ? '' : nom).trim().toUpperCase();
  for (const e of ETAPAS) if (u.indexOf(e) >= 0) return e;
  return 'OTRA';
}

/*  LA SALUD DE UNA BODEGA ES UNA REGLA, NO UNA OPINION.
 *
 *  Un nivel negativo es imposible: no existe media bodega de pallets en menos.
 *  Asi que el semaforo mira exactamente eso y nada mas. Lo que no se puede
 *  evaluar se dice 'sin dato' y no se pinta de verde, que es la forma mas
 *  barata de mentir en un tablero. */
function saludDeBodega(b) {
  const dias = (b && b.dias) || [];
  if (!dias.length) return { nivel: 'sindato', texto: 'Sin dato', n: 0, de: 0 };
  const neg = dias.filter(d => Number(d.cierre) < 0).length;
  const parte = neg / dias.length;
  const nivel = neg === 0 ? 'verde' : parte >= 0.5 ? 'rojo' : parte > 0 ? 'amarillo' : 'verde';
  const texto = neg === 0 ? 'Verde' : parte >= 0.5 ? 'Rojo' : 'Amarillo';
  return { nivel, texto, n: neg, de: dias.length };
}

const ORDEN_SALUD = { rojo: 0, amarillo: 1, verde: 2, sindato: 3 };
const GLIFO = { rojo: '◆', amarillo: '▲', verde: '●', sindato: '○' };

/*  LAS BODEGAS, ORDENADAS POR LO QUE HAY QUE MIRAR PRIMERO.
 *
 *  No por saldo ni por codigo: por salud. Un tablero que pone arriba la bodega
 *  mas grande obliga a buscar el problema; uno que pone arriba la que esta en
 *  rojo lo muestra. A igual salud, manda el recorrido. */
function bodegasDelCockpit(serie) {
  const out = [];
  for (const b of (Array.isArray(serie) ? serie : [])) {
    if (!b || !b.cod) continue;
    const dias = Array.isArray(b.dias) ? b.dias : [];
    const s = saludDeBodega(b);
    let entradas = 0, salidas = 0;
    for (const d of dias) { entradas += Number(d.entradas) || 0; salidas += Number(d.salidas) || 0; }
    out.push({ cod: String(b.cod), nom: String(b.nom || b.cod), nivel: Number(b.nivel) || 0,
               planta: plantaDeBodega(b.nom), etapa: etapaDeBodega(b.nom),
               dias: dias.length, entradas, salidas, salud: s,
               peor: dias.reduce((a, d) => (a == null || Number(d.cierre) < a.cierre
                                            ? { dia: String(d.dia), cierre: Number(d.cierre) || 0 } : a), null) });
  }
  const paso = e => { const i = ETAPAS.indexOf(e); return i < 0 ? ETAPAS.length : i; };
  return out.sort((a, b) => ORDEN_SALUD[a.salud.nivel] - ORDEN_SALUD[b.salud.nivel] ||
                            paso(a.etapa) - paso(b.etapa) ||
                            (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0));
}

/*  LA MATRIZ PLANTA x ETAPA.
 *
 *  Es el grafico que contesta "¿donde esta el problema?" sin que nadie tenga
 *  que leer una tabla: con los dias en negativo pintados por estacion, se ve
 *  de una que el defecto esta en el ingreso a inspeccion y no repartido por la
 *  planta. Cada celda lleva ademas su glifo, asi que no depende del color. */
function matrizPlantaEtapa(bodegas) {
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const plantas = [], etapas = [];
  for (const b of bs) {
    if (plantas.indexOf(b.planta) < 0) plantas.push(b.planta);
    if (etapas.indexOf(b.etapa) < 0) etapas.push(b.etapa);
  }
  const paso = e => { const i = ETAPAS.indexOf(e); return i < 0 ? ETAPAS.length : i; };
  etapas.sort((a, b) => paso(a) - paso(b) || (a < b ? -1 : 1));
  plantas.sort();
  const celdas = [];
  for (const p of plantas) for (const e of etapas) {
    const b = bs.find(x => x.planta === p && x.etapa === e) || null;
    celdas.push({ planta: p, etapa: e, bodega: b,
                  salud: b ? b.salud : { nivel: 'vacio', texto: 'No existe', n: 0, de: 0 } });
  }
  return { plantas, etapas, celdas };
}

/*  EL TITULAR DICE LA CONCLUSION, NO EL DATO.
 *
 *  "Pool 808.183" es un dato; "4 de 9 estaciones cierran dias en negativo" es
 *  una conclusion. El titular de un tablero que mira gerencia tiene que ser lo
 *  segundo, con lo primero al lado. Se calcula, no se escribe a mano: el dia
 *  que no haya negativos, el titular lo dice solo. */
function titular(d, bodegas) {
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const malas = bs.filter(b => b.salud.nivel === 'rojo' || b.salud.nivel === 'amarillo');
  const dias = bs.reduce((a, b) => a + b.dias, 0);
  const neg = bs.reduce((a, b) => a + b.salud.n, 0);
  const pool = Number(d && d.pool) || 0;
  if (!bs.length)
    return { frase: 'Pool de <em>' + mil(pool) + '</em> pallets', nivel: 'sindato',
             cola: 'sin distribución diaria de planta en esta corrida' };
  if (!malas.length)
    return { frase: 'Pool de <em>' + mil(pool) + '</em> pallets; <em>ninguna estación</em> en negativo',
             nivel: 'verde',
             cola: mil(bs.length) + ' bodegas del indicador · ' + mil(dias) + ' días medidos' };
  return { frase: 'Pool de <em>' + mil(pool) + '</em> pallets; <em>' + mil(malas.length) + ' de ' +
                  mil(bs.length) + ' estaciones</em> cierran días en negativo',
           nivel: malas.some(b => b.salud.nivel === 'rojo') ? 'rojo' : 'amarillo',
           cola: mil(neg) + ' de ' + mil(dias) + ' días · peor ' +
                 mil(bs.reduce((a, b) => (b.peor && (a == null || b.peor.cierre < a) ? b.peor.cierre : a), null)) +
                 ' en ' + esc((bs.find(b => b.salud.nivel === 'rojo') || bs[0]).cod) };
}

/*  LAS TARJETAS DE "¿COMO ESTAMOS?".
 *
 *  Cada una trae: etiqueta, la formula de donde sale (arriba a la derecha), el
 *  numero con su unidad, una barra cuando hay dos magnitudes que comparar, y
 *  un chip de estado. La tarjeta que no puede calcularse NO sale en cero: sale
 *  diciendo que no se puede, que es lo que hace el tablero de ITL y es lo
 *  correcto. */
function tarjetas(datos, bodegas) {
  const d = datos || {};
  const b = d.bodegas || {};
  const cli = b.CLIENTES || {}, ret = b.RETAIL || {}, pla = b.PLANTA || {};
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const dias = bs.reduce((a, x) => a + x.dias, 0);
  const neg = bs.reduce((a, x) => a + x.salud.n, 0);
  const residuo = (Number(cli.residuo) || 0) + (Number(ret.residuo) || 0);
  const atrib = (Number(cli.socios) || 0) + (Number(ret.socios) || 0);
  const ctrl = Array.isArray(d && d.controles) ? d.controles : [];
  const fallan = ctrl.filter(c => c.estado === 'no pasa');
  const t = [];

  t.push({ et: 'Reparto del pool', hint: 'cli / ret / planta', kv: mil(d.pool), u: 'pallets',
           stack: [ { v: Number(cli.nivel) || 0, c: 'var(--cli)', nom: 'Clientes' },
                    { v: Number(ret.nivel) || 0, c: 'var(--ret)', nom: 'Retail' },
                    { v: Number(pla.nivel) || 0, c: 'var(--pla)', nom: 'Planta' } ],
           ks: 'de <b>' + mil(d.pool_sap) + '</b> que SAP tiene en bodega · ' +
               mil(d.fuera_del_pool) + ' fuera del indicador no suman',
           chip: null });

  t.push({ et: 'Planta · indicador', hint: 'nueve bodegas', kv: mil(pla.nivel), u: 'pallets',
           bullet: { v: Number(pla.nivel) || 0, tope: Number(pla.sap) || 0, marca: Number(pla.sap) || 0 },
           ks: '<b>' + mil(pla.fuera) + '</b> más en merma, extraños y tránsito ' +
               '<span class="mut">— referencial, no suman</span>',
           chip: null });

  t.push({ et: 'Atribución por socio', hint: 'socios / bodega', kv: pct1(atrib, (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0)), u: '',
           ks: 'clientes <b>' + pct1(cli.socios, cli.nivel) + '</b> · retail <b>' + pct1(ret.socios, ret.nivel) + '</b>',
           bullet: { v: atrib, tope: (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0),
                     marca: (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0) },
           chip: null });

  t.push({ et: 'Sin ubicación', hint: 'bodega − socios', kv: mil(residuo), u: 'pallets',
           ks: 'retail <b>' + mil(ret.residuo) + '</b> · clientes <b>' + mil(cli.residuo) + '</b>' +
               '<br><span class="mut">ubicaciones que existen para el pallet sin dueño identificado</span>',
           chip: residuo > 0 ? { c: 'warn', t: pct1(residuo, d.pool) + ' del pool' } : null });

  const anio = (d && d.anio) || {};
  t.push({ et: 'Movimiento del año', hint: 'neto salido', kv: conSigno((Number(anio.ret) || 0) + (Number(anio.cli) || 0)), u: 'pallets',
           ks: 'retail <b>' + conSigno(anio.ret) + '</b> · clientes <b>' + conSigno(anio.cli) + '</b>' +
               '<br><span class="mut">positivo = pallet que salió de REDTEC</span>',
           chip: null });

  t.push({ et: 'Días en negativo', hint: 'cierre < 0', kv: mil(neg), u: 'de ' + mil(dias),
           ks: neg ? 'en <b>' + mil(bs.filter(x => x.salud.n).length) + '</b> de ' + mil(bs.length) +
                     ' estaciones<br><span class="mut">es la fecha del documento en SAP, no el cálculo</span>'
                   : 'ninguna estación cierra bajo cero',
           bar: { v: neg, tope: dias, c: neg ? 'var(--crit)' : 'var(--good)' },
           chip: neg ? { c: 'crit', t: pct1(neg, dias) + ' de los días' } : { c: 'good', t: 'sin negativos' } });

  const cob = ctrl.find(c => /cobertura/i.test(c.titulo || ''));
  t.push({ et: 'Cobertura', hint: 'docs SAP vs nuestros', kv: cob ? '100' : '—', u: cob ? '%' : '',
           ks: cob ? esc(recortar(cob.texto, 120))
                   : 'el control de cobertura no vino en esta corrida',
           chip: cob ? { c: 'good', t: 'medido el ' + esc(cob.medido || d.extra_medido || 's/f') }
                     : { c: 'nodata', t: 'sin dato' } });

  t.push({ et: 'Controles', hint: 'pasan / total', kv: mil(ctrl.length - fallan.length), u: 'de ' + mil(ctrl.length),
           ks: fallan.length ? 'no pasan: <b>' + fallan.map(c => esc(c.titulo)).join('</b>, <b>') + '</b>'
                             : 'todos los controles pasan',
           bar: { v: ctrl.length - fallan.length, tope: ctrl.length || 1,
                  c: fallan.length ? 'var(--warn)' : 'var(--good)' },
           chip: fallan.length ? { c: 'warn', t: mil(fallan.length) + ' sin pasar' } : { c: 'good', t: 'al día' } });

  return t;
}

/*  LAS DECISIONES.
 *
 *  Un tablero que solo informa deja al lector preguntandose que hacer. Esta
 *  franja sale del dato —los controles que no pasan y las bodegas en rojo— mas
 *  los pendientes que el proyecto ya tiene declarados. Lo que sale del dato se
 *  recalcula solo; lo declarado lleva su responsable. */
function decisiones(d, bodegas) {
  const out = [];
  for (const c of (Array.isArray(d && d.controles) ? d.controles : []))
    if (c.estado === 'no pasa')
      out.push({ ico: '!', cls: 'crit', t: String(c.titulo) + ' no pasa',
                 m: recortar(c.texto, 150), v: 'control' });
  for (const b of (Array.isArray(bodegas) ? bodegas : []))
    if (b.salud.nivel === 'rojo')
      out.push({ ico: '◆', cls: 'crit', t: b.nom + ' cierra en negativo ' + mil(b.salud.n) + ' de ' + mil(b.salud.de) + ' días',
                 m: 'peor ' + mil(b.peor ? b.peor.cierre : 0) + ' el ' + (b.peor ? b.peor.dia : '—') +
                    ' · la salida queda fechada antes que el traspaso que la alimenta',
                 v: b.cod });
  return out;
}

/*  LO QUE VIENE. Fechas duras del proyecto, declaradas aca porque no salen de
 *  ningun json: son compromisos, no mediciones. Cada una con los dias que
 *  faltan calculados contra el ancla, no escritos. */
const HITOS = [
  { t: 'Baja de M2LINK', m: 'la extracción propia tiene que sostener sola el stock', f: '2026-12-01' },
  { t: 'Corregir los RUT en @HX_OPERARIOS', m: 'campo U_RUT nuevo; la OT guarda el Code, así que arregla hacia atrás', f: '2026-11-15' },
  { t: 'Migrar las tres vistas que usan RDTOut', m: 'stocks-unificado, stock-calendario y Stock Plantas Respaldo', f: '2026-11-30' },
  { t: 'Rotar la clave de SAP', m: 'está en texto plano en el notebook de Colab', f: '2026-11-07' },
];

function diasHasta(fecha, hoy) {
  const a = Date.parse(String(fecha) + 'T00:00:00Z'), b = Date.parse(String(hoy) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function hitos(hoy) {
  return HITOS.map(h => {
    const n = diasHasta(h.f, hoy);
    return { t: h.t, m: h.m, f: h.f, dias: n,
             cls: n == null ? 'nodata' : n < 0 ? 'crit' : n <= 14 ? 'warn' : 'good',
             v: n == null ? 's/f' : n < 0 ? mil(n) + ' d' : '+' + mil(n) + ' d' };
  }).sort((a, b) => (a.dias == null ? 1e9 : a.dias) - (b.dias == null ? 1e9 : b.dias));
}

/*  LA MARCA ES LA DEL M3LINK, NO LA DEL TABLERO DEL QUE SE COPIO LA ESTRUCTURA.
 *
 *  Inter y JetBrains Mono son las del portal. Los grises y el verde de acento
 *  tambien. El naranjo del tablero de ITL se reemplaza por el rojo de la R de
 *  REDTEC, que es la marca: va en el logo, en el numero de cada franja, en el
 *  control segmentado activo y en el borde de la tarjeta al pasar por encima.
 *
 *  LOS TRES COLORES DE LAS PATAS DEL POOL estan validados con el validador de
 *  paletas en los dos modos: banda de luminosidad, piso de croma, separacion
 *  para daltonismo (ΔE 14,5 deutan en oscuro; 13,8 protan en claro) y
 *  contraste contra la superficie. No se eligieron a ojo.
 *
 *  EL SEMAFORO NUNCA VA SOLO EN COLOR: cada celda y cada fila llevan ademas su
 *  glifo (◆ ▲ ● ○) y su palabra. */
const CSS = `
:root{
  --marca:#C0170C; --r:13px;
  --good:#4ade80; --warn:#fcd34d; --crit:#f87171; --nodata:#6f7c93;
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0f1117; --bg2:#141822;
  --card:#181b23; --card2:#1e222d; --line:rgba(255,255,255,.07); --line2:rgba(255,255,255,.14);
  --ink:#e8eaf0; --ink2:#9da3b4; --ink3:#5a6070;
  --cli:#4b8fdd; --ret:#d1721f; --pla:#16a89a;
  --glow:0 0 0 1px rgba(255,255,255,.04), 0 10px 30px -14px rgba(0,0,0,.7);
  --glowh:0 0 0 1px rgba(192,23,12,.40), 0 18px 40px -16px rgba(192,23,12,.35);
}
:root[data-theme="light"]{
  color-scheme:light;
  --bg:#f2f4f8; --bg2:#eaedf3;
  --card:#ffffff; --card2:#f6f8fb; --line:rgba(16,24,40,.10); --line2:rgba(16,24,40,.18);
  --ink:#101420; --ink2:#495261; --ink3:#757e8c;
  --cli:#2a78d6; --ret:#d9641e; --pla:#0f9b8a;
  --good:#15803d; --warn:#a16207; --crit:#b91c1c; --nodata:#757e8c;
  --glow:0 1px 2px rgba(16,24,40,.05), 0 8px 24px -16px rgba(16,24,40,.20);
  --glowh:0 0 0 1px rgba(192,23,12,.35), 0 16px 34px -18px rgba(192,23,12,.30);
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);
  font:13px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh;background:
  radial-gradient(1100px 560px at 88% -12%, rgba(192,23,12,.10), transparent 62%),
  radial-gradient(900px 480px at -12% 18%, rgba(75,143,221,.09), transparent 62%), var(--bg)}
:root[data-theme="light"] body{background:var(--bg)}
button,select{font-family:inherit}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}
.wrap{max-width:1440px;margin:0 auto;
  padding:18px max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px))}

/* cabecera */
.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.logo{width:38px;height:38px;border-radius:11px;background:var(--card);border:1px solid var(--line);
  display:grid;place-items:center;flex:none;box-shadow:0 8px 20px -10px rgba(192,23,12,.55)}
.logo img{width:24px;height:24px;object-fit:contain;display:block}
.brand h1{margin:0;font:700 18px/1.15 Inter,sans-serif;letter-spacing:-.2px}
.brand small{display:block;color:var(--ink2);font:500 11.5px Inter;margin-top:2px}
.spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;
  background:var(--card);border:1px solid var(--line);color:var(--ink2);font-size:11.5px;
  font-weight:600;white-space:nowrap}
.pill b{color:var(--ink)}
.pill .mono{font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.seg{display:inline-flex;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:3px}
.seg button{border:0;background:transparent;color:var(--ink2);font-size:11.5px;font-weight:600;
  padding:6px 10px;border-radius:7px;cursor:pointer;transition:.2s}
.seg button.on{background:var(--marca);color:#fff}
.seg button:focus-visible,.chip:focus-visible,.cart tbody tr:focus-visible,.dx:focus-visible{
  outline:2px solid var(--marca);outline-offset:2px}

/* filtros */
.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0 6px}
.flabel{font:700 10.5px Inter;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);margin-right:2px}
.chip{border:1px solid var(--line);background:var(--card);color:var(--ink2);border-radius:999px;
  padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;
  display:inline-flex;align-items:center;gap:6px;min-height:32px}
.chip:hover{border-color:var(--line2);color:var(--ink)}
.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip .n{font:600 10.5px "JetBrains Mono",ui-monospace,monospace;opacity:.72}
.fsep{width:1px;height:22px;background:var(--line);margin:0 6px}

/* titular */
.headline{margin:16px 0 4px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.headline h2{margin:0;font:700 24px/1.25 Inter,sans-serif;letter-spacing:-.3px;text-wrap:balance}
.headline h2 em{font-style:normal}
.hl-rojo em{color:var(--crit)} .hl-amarillo em{color:var(--warn)}
.hl-verde em{color:var(--good)} .hl-sindato em{color:var(--ink2)}
.headline .sub{color:var(--ink2);font-size:12.5px}

/* franjas y tarjetas */
.band{margin-top:24px}
.bandh{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}
.bandh .num{width:22px;height:22px;border-radius:7px;background:var(--card2);border:1px solid var(--line);
  display:grid;place-items:center;font:700 11px "JetBrains Mono",ui-monospace,monospace;color:var(--marca);flex:none}
.bandh h3{margin:0;font:600 13.5px Inter,sans-serif;letter-spacing:.1px}
.bandh span{color:var(--ink3);font-size:11.5px}
.grid{display:grid;gap:12px}
.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.g64{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 15px;
  box-shadow:var(--glow);position:relative;overflow:hidden;min-width:0;
  transition:transform .25s ease, box-shadow .25s ease, border-color .25s}
.card.lift:hover{transform:translateY(-2px);box-shadow:var(--glowh);border-color:rgba(192,23,12,.35)}
.ct{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.ct h4{margin:0;font:700 10.5px Inter;letter-spacing:.55px;text-transform:uppercase;color:var(--ink2)}
.ct .hint{font-size:10.5px;color:var(--ink3);white-space:nowrap}
.kv{font:700 28px/1 Inter,sans-serif;letter-spacing:-.8px}
.kv small{font:600 12px Inter;color:var(--ink2);margin-left:5px;letter-spacing:0}
.ks{font-size:11px;color:var(--ink2);margin-top:7px;line-height:1.4}
.ks b{color:var(--ink)} .ks .mut,.mut{color:var(--ink3)}
.stat{display:inline-flex;align-items:center;gap:5px;font:700 10.5px Inter;padding:2px 8px;
  border-radius:999px;border:1px solid currentColor;margin-top:8px}
.st-good{color:var(--good)} .st-warn{color:var(--warn)}
.st-crit{color:var(--crit)} .st-nodata{color:var(--nodata)}

/* barras */
.stack{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--card2);gap:2px;margin-top:10px}
.stack i{display:block;height:100%}
.legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:10.5px;color:var(--ink2)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend .sw{width:9px;height:9px;border-radius:3px;flex:none}
.bullet{position:relative;height:12px;border-radius:999px;background:var(--card2);margin-top:12px}
.bullet .fill{position:absolute;left:0;top:2px;bottom:2px;border-radius:999px;background:var(--pla)}
.bullet .mark{position:absolute;top:-3px;bottom:-3px;width:3px;border-radius:2px;background:var(--ink2);opacity:.75}
.barra{height:8px;border-radius:999px;background:var(--card2);margin-top:11px;overflow:hidden}
.barra i{display:block;height:100%;border-radius:999px}

/* matriz planta x etapa */
.mtx{display:grid;gap:5px;margin-top:4px;overflow-x:auto}
.mtx .hd{font:700 10px Inter;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);
  display:flex;align-items:center;justify-content:center;text-align:center;padding:4px 2px}
.mtx .rh{justify-content:flex-start;padding-left:2px}
.cel{border-radius:9px;border:1px solid var(--line);background:var(--card2);min-height:52px;
  display:grid;place-items:center;gap:1px;padding:6px 4px;text-align:center;font-size:10.5px}
.cel b{font:700 15px/1 Inter;display:block}
.cel small{color:var(--ink2);font-size:9.5px;display:block}
.c-verde{background:color-mix(in srgb,var(--good) 20%,var(--card2));border-color:color-mix(in srgb,var(--good) 45%,transparent);color:var(--good)}
.c-amarillo{background:color-mix(in srgb,var(--warn) 20%,var(--card2));border-color:color-mix(in srgb,var(--warn) 45%,transparent);color:var(--warn)}
.c-rojo{background:color-mix(in srgb,var(--crit) 22%,var(--card2));border-color:color-mix(in srgb,var(--crit) 50%,transparent);color:var(--crit)}
.c-sindato{color:var(--nodata)}
.c-vacio{opacity:.35;color:var(--ink3)}

/* listas de la franja de decisiones */
.list{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;margin:0 -4px;padding:0 4px}
.li{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 6px;border-radius:9px}
.li:hover{background:var(--card2)}
.li .t{font-size:12px;line-height:1.35;color:var(--ink);overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.li .m{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.li .m{font-size:10.5px;color:var(--ink3);margin-top:3px;line-height:1.35}
.li .v{font:600 11.5px "JetBrains Mono",ui-monospace,monospace;white-space:nowrap;text-align:right}
.ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font:800 12px Inter;flex:none;
  border:1px solid currentColor}
.i-crit{color:var(--crit)} .i-warn{color:var(--warn)} .i-good{color:var(--good)} .i-nodata{color:var(--nodata)}
.empty{padding:22px 6px;color:var(--ink3);font-size:12px;text-align:center}

/* cartera */
.tblwrap{overflow:auto;max-height:520px;margin:0 -15px -14px;padding:0 15px}
table.cart{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;min-width:760px}
.cart th{font:700 10px Inter;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);text-align:left;
  padding:8px 10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card);z-index:1;white-space:nowrap}
.cart th.num,.cart td.num{text-align:right}
.cart td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}
.cart tbody tr{cursor:pointer;transition:background .2s}
.cart tbody tr:hover,.cart tbody tr.hl{background:var(--card2)}
.cart tbody tr.hl td:first-child{box-shadow:inset 3px 0 0 var(--marca)}
.cart .pn{font-weight:600;color:var(--ink)}
.cart .pc{font:500 10.5px "JetBrains Mono",ui-monospace,monospace;color:var(--ink3);margin-top:2px}
.cart .num{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600}
.minib{position:relative;width:110px;height:8px;border-radius:999px;background:var(--card2);display:inline-block;vertical-align:middle}
.minib .fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--pla)}
.salud{display:inline-flex;align-items:center;gap:6px;font:700 11px Inter}
.salud i{font-style:normal;font-size:11px}
.s-verde{color:var(--good)} .s-amarillo{color:var(--warn)} .s-rojo{color:var(--crit)} .s-sindato{color:var(--nodata)}

/* cajon de detalle */
.scrim{position:fixed;inset:0;background:rgba(3,7,15,.55);backdrop-filter:blur(3px);opacity:0;
  pointer-events:none;transition:opacity .3s;z-index:40}
.scrim.on{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(880px,96vw);background:var(--bg2);
  border-left:1px solid var(--line);box-shadow:-30px 0 60px -24px rgba(0,0,0,.6);
  transform:translateX(102%);transition:transform .45s cubic-bezier(.2,.8,.2,1);z-index:50;
  overflow:auto;padding:20px 22px 34px;overscroll-behavior:contain}
.drawer.on{transform:none}
.dx{position:absolute;top:14px;right:16px;border:1px solid var(--line2);background:var(--card);
  color:var(--ink);width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:16px;line-height:1}
.drawer h3{margin:4px 44px 2px 0;font:700 20px/1.2 Inter,sans-serif}
.drawer .code{font:600 11px "JetBrains Mono",ui-monospace,monospace;color:var(--marca)}
.drawer h5{margin:20px 0 8px;font:700 10.5px Inter;letter-spacing:.55px;text-transform:uppercase;color:var(--ink2)}
.k4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}
.k4 .card{padding:11px 12px} .k4 .kv{font-size:20px}

/* los dos graficos del dia, publicados desde armar-tablero-stock.js */
.scroll{overflow-x:auto;margin:0 -4px;padding:0 4px;max-width:100%}
.scroll svg{display:block;width:100%;height:auto;min-width:620px}
.scroll.dbl svg{min-width:0}
.b-ent{fill:var(--pla)} .b-sal{fill:var(--ret)}
.b-ret{fill:var(--ret)} .b-cli{fill:var(--cli)}
.n-pos{fill:var(--pla)} .n-neg{fill:var(--crit)}
.grid-l{stroke:var(--line2);stroke-width:1} line.grid{stroke:var(--line2);stroke-width:1}
.cero{stroke:var(--ink2);stroke-width:1.5}
.ax{fill:var(--ink3);font:500 11px "JetBrains Mono",ui-monospace,monospace}
.drawer table{width:100%;border-collapse:collapse;font-size:12px;min-width:520px}
.drawer th{text-align:left;font:700 10px Inter;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);
  padding:0 10px 7px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.drawer td{padding:6px 10px 6px 0;border-bottom:1px solid var(--line)}
.drawer .num{text-align:right;font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600;white-space:nowrap}
.drawer th.num{text-align:right}
.cod{font:400 11px "JetBrains Mono",ui-monospace,monospace;color:var(--ink3);white-space:nowrap}
.malo{color:var(--crit)}
.d-pos{color:var(--good)} .d-neg{color:var(--crit)} .d-nul{color:var(--ink3)}

/* metodo y pie */
details.metodo{margin-top:24px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:13px 16px;color:var(--ink2);font-size:12px;line-height:1.6}
details.metodo summary{cursor:pointer;font-weight:700;color:var(--ink)}
details.metodo dt{color:var(--ink);font-weight:600;margin-top:10px}
details.metodo dd{margin:2px 0 0}
details.metodo code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;color:var(--ink)}
.foot{margin-top:16px;color:var(--ink3);font-size:11px;display:flex;justify-content:space-between;
  flex-wrap:wrap;gap:8px;border-top:1px solid var(--line);padding-top:14px}
.foot a{color:var(--ink2)}

/* entrada escalonada */
.rise{opacity:0;transform:translateY(10px);animation:rise .55s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}

@media (max-width:1100px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.g64,.g3{grid-template-columns:minmax(0,1fr)}}
@media (max-width:620px){
  .fsep{display:none}.wrap{padding:14px 16px 30px}.g4{grid-template-columns:minmax(0,1fr)}
  .k4{grid-template-columns:repeat(2,minmax(0,1fr))}.headline h2{font-size:19px}
  .drawer{padding:16px 16px 28px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

// ── piezas de html ───────────────────────────────────────────────────────────

/*  RECORTAR POR PALABRA.
 *
 *  Cortar en el caracter 120 deja "calculadas hacia atrás y hac", que se lee
 *  como un error de la pagina. Se corta en el ultimo espacio y se avisa con
 *  puntos suspensivos que hay mas. */
function recortar(txt, n) {
  const t = String(txt == null ? '' : txt).trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n);
  const esp = corte.lastIndexOf(' ');
  return (esp > n * 0.6 ? corte.slice(0, esp) : corte).replace(/[.,;:·\s]+$/, '') + '…';
}

function chipEstado(c) {
  if (!c) return '';
  return '<span class="stat st-' + esc(c.c) + '">' + esc(c.t) + '</span>';
}

function tarjetaHtml(t, i) {
  const H = ['<div class="card lift rise" style="animation-delay:' + (i * 45) + 'ms">'];
  H.push('<div class="ct"><h4>' + esc(t.et) + '</h4><span class="hint">' + esc(t.hint) + '</span></div>');
  H.push('<div class="kv">' + t.kv + (t.u ? '<small>' + esc(t.u) + '</small>' : '') + '</div>');
  if (t.stack) {
    const tot = t.stack.reduce((a, s) => a + s.v, 0) || 1;
    H.push('<div class="stack">' + t.stack.map(s =>
      '<i style="width:' + ((s.v / tot) * 100).toFixed(2) + '%;background:' + s.c + '"></i>').join('') + '</div>');
    H.push('<div class="legend">' + t.stack.map(s =>
      '<span><i class="sw" style="background:' + s.c + '"></i>' + esc(s.nom) + ' <b>' + mil(s.v) + '</b> · ' +
      pct1(s.v, tot) + '</span>').join('') + '</div>');
  }
  if (t.bullet) {
    const tope = Number(t.bullet.tope) || 1;
    H.push('<div class="bullet"><span class="fill" style="width:' +
           Math.max(0, Math.min(100, (t.bullet.v / tope) * 100)).toFixed(2) + '%"></span>' +
           '<span class="mark" style="left:' +
           Math.max(0, Math.min(100, (t.bullet.marca / tope) * 100)).toFixed(2) + '%"></span></div>');
  }
  if (t.bar) {
    const tope = Number(t.bar.tope) || 1;
    H.push('<div class="barra"><i style="width:' +
           Math.max(0, Math.min(100, (t.bar.v / tope) * 100)).toFixed(2) +
           '%;background:' + t.bar.c + '"></i></div>');
  }
  if (t.ks) H.push('<div class="ks">' + t.ks + '</div>');
  H.push(chipEstado(t.chip));
  return H.join('') + '</div>';
}

/*  LA MATRIZ SE DIBUJA CON GRID Y NO CON SVG a proposito: asi cada celda es un
 *  elemento con su texto, se lee con un lector de pantalla y se puede hacer
 *  clic sin inventar geometria. */
function matrizHtml(m) {
  const cols = m.plantas.length + 1;
  const H = ['<div class="mtx" style="grid-template-columns:120px repeat(' + m.plantas.length +
             ',minmax(72px,1fr));min-width:' + (120 + m.plantas.length * 90) + 'px">'];
  H.push('<div class="hd rh"></div>');
  for (const p of m.plantas) H.push('<div class="hd">' + esc(p) + '</div>');
  for (const e of m.etapas) {
    H.push('<div class="hd rh">' + esc(e) + '</div>');
    for (const p of m.plantas) {
      const c = m.celdas.find(x => x.planta === p && x.etapa === e);
      const s = c ? c.salud : { nivel: 'vacio', texto: 'No existe', n: 0, de: 0 };
      const b = c && c.bodega;
      H.push('<div class="cel c-' + esc(s.nivel) + '"' +
             (b ? ' data-cod="' + esc(b.cod) + '" role="button" tabindex="0"' : '') +
             ' title="' + esc((b ? b.nom : p + ' · ' + e) + ' — ' + s.texto +
                              (s.de ? ': ' + s.n + ' de ' + s.de + ' días en negativo' : '')) + '">' +
             '<b>' + (GLIFO[s.nivel] || '·') + '</b>' +
             (b ? '<small>' + (s.de ? mil(s.n) + '/' + mil(s.de) : esc(s.texto)) + '</small>' : '') +
             '</div>');
    }
  }
  H.push('</div>');
  return H.join('');
}

function filaCartera(b) {
  const flujo = b.entradas + b.salidas;
  return '<tr data-cod="' + esc(b.cod) + '" data-planta="' + esc(b.planta) + '" data-etapa="' + esc(b.etapa) +
         '" data-salud="' + esc(b.salud.nivel) + '" tabindex="0">' +
    '<td><div class="pn">' + esc(b.nom) + '</div><div class="pc">' + esc(b.cod) + '</div></td>' +
    '<td>' + esc(b.planta) + '</td>' +
    '<td>' + esc(b.etapa.charAt(0) + b.etapa.slice(1).toLowerCase()) + '</td>' +
    '<td class="num">' + mil(b.nivel) + '</td>' +
    '<td class="num">' + mil(b.entradas) + '</td>' +
    '<td class="num">' + mil(b.salidas) + '</td>' +
    '<td class="num ' + clasePos(b.entradas - b.salidas) + '">' + conSigno(b.entradas - b.salidas) + '</td>' +
    '<td class="num">' + (b.salud.n ? mil(b.salud.n) + ' / ' + mil(b.salud.de) : '—') + '</td>' +
    '<td><span class="salud s-' + esc(b.salud.nivel) + '"><i>' + (GLIFO[b.salud.nivel] || '·') + '</i>' +
      esc(b.salud.texto) + '</span></td></tr>';
}

function listaHtml(items, vacio) {
  if (!items || !items.length) return '<div class="empty">' + esc(vacio) + '</div>';
  return '<div class="list">' + items.map(x =>
    '<div class="li"><span class="ico i-' + esc(x.cls) + '">' + esc(x.ico) + '</span>' +
    '<div><div class="t">' + esc(x.t) + '</div><div class="m">' + esc(x.m) + '</div></div>' +
    '<span class="v ' + (x.cls === 'crit' ? 'malo' : '') + '">' + esc(x.v) + '</span></div>').join('') + '</div>';
}

/*  LA R DE REDTEC.
 *
 *  Es el mismo PNG que el portal usa de logo y de favicon. Va embebido para
 *  que la pagina sirva igual abierta fuera del portal, donde /icons no
 *  resuelve. Si la constante llega vacia, la pagina sale sin logo antes que
 *  con un cuadro roto. */
const LOGO_R = require('./marca-redtec.js').logoR;

function pagina(d) {
  const serie = (d && d.planta_dias) || [];
  const bodegas = bodegasDelCockpit(serie);
  const m = matrizPlantaEtapa(bodegas);
  const tit = titular(d, bodegas);
  const meses = mesesDeSerie(serie);
  const mes0 = meses.length ? meses[meses.length - 1].mes : null;
  const hoy = String((d && d.ventana && d.ventana.nivel) || '').slice(0, 10);
  const H = [];

  H.push('<!doctype html>\n<html lang="es" data-theme="dark">\n<head>\n<meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  H.push('<title>Cockpit del Pool · Pallet Rojo</title>');
  H.push('<meta name="description" content="Lectura ejecutiva del pool de pallet rojo de REDTEC: reparto, salud por estación y distribución diaria de planta. Extracción propia M3DATA desde SAP B1.">');
  if (LOGO_R) H.push('<link rel="icon" type="image/png" href="' + LOGO_R + '">');
  H.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  H.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  H.push('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700' +
         '&family=JetBrains+Mono:wght@400;500;600&display=swap">');
  H.push('<script src="/sesion.js"><\/script>');
  H.push('<style>' + CSS + '</style>\n</head>\n<body>\n<div class="wrap">');

  // ── cabecera ──
  H.push('<header class="top">');
  H.push('  <div class="brand">' +
         (LOGO_R ? '<span class="logo"><img src="' + LOGO_R + '" alt="REDTEC"></span>' : '') +
         '<div><h1>Cockpit del Pool</h1>' +
         '<small>Pallet rojo 1,00 × 1,20 · SKU 11111111110 · extracción propia M3DATA desde SAP B1</small>' +
         '</div></div>');
  H.push('  <span class="spacer"></span>');
  H.push('  <span class="pill">Saldos al <b class="mono">' + esc(hoy) + '</b></span>');
  if (d.cierreFirme || (d.ventana && d.ventana.flujo_hasta))
    H.push('  <span class="pill">Flujos hasta <b class="mono">' + esc(d.ventana.flujo_hasta) + '</b></span>');
  H.push('  <div class="seg" id="tema" role="group" aria-label="Tema">' +
         '<button type="button" data-t="dark" class="on">Oscuro</button>' +
         '<button type="button" data-t="light">Claro</button></div>');
  H.push('  <a class="pill" href="m3link_dashboard_dark.html">‹ Panel M3LINK</a>');
  H.push('</header>');

  // ── filtros ──
  const cuenta = (campo, v) => bodegas.filter(b => (campo === 'salud' ? b.salud.nivel : b[campo]) === v).length;
  H.push('<div class="filters" id="filtros">');
  H.push('  <span class="flabel">Planta</span>');
  H.push('  <button type="button" class="chip on" data-f="planta" data-v="">Todas <span class="n">' +
         bodegas.length + '</span></button>');
  for (const p of m.plantas)
    H.push('  <button type="button" class="chip" data-f="planta" data-v="' + esc(p) + '">' + esc(p) +
           ' <span class="n">' + cuenta('planta', p) + '</span></button>');
  H.push('  <span class="fsep"></span><span class="flabel">Salud</span>');
  H.push('  <button type="button" class="chip on" data-f="salud" data-v="">Todas <span class="n">' +
         bodegas.length + '</span></button>');
  for (const s of ['rojo', 'amarillo', 'verde', 'sindato']) {
    const n = cuenta('salud', s);
    if (!n) continue;
    H.push('  <button type="button" class="chip" data-f="salud" data-v="' + s + '">' +
           GLIFO[s] + ' ' + s.charAt(0).toUpperCase() + s.slice(1) + ' <span class="n">' + n + '</span></button>');
  }
  H.push('</div>');

  // ── titular ──
  H.push('<div class="headline hl-' + esc(tit.nivel) + '"><h2>' + tit.frase + '</h2>' +
         '<span class="sub">' + tit.cola + '</span></div>');

  // ── ① ¿Como estamos? ──
  H.push('<section class="band"><div class="bandh"><span class="num">1</span>' +
         '<h3>¿Cómo estamos?</h3><span>valor · comparación · estado</span></div>');
  H.push('<div class="grid g4">' + tarjetas(d, bodegas).map(tarjetaHtml).join('') + '</div></section>');

  // ── ② ¿Donde esta el problema? ──
  H.push('<section class="band"><div class="bandh"><span class="num">2</span>' +
         '<h3>¿Dónde está el problema?</h3><span>clic en una celda para ver esa estación día por día</span></div>');
  H.push('<div class="grid g64">');
  H.push('<div class="card rise"><div class="ct"><h4>Planta × etapa del recorrido</h4>' +
         '<span class="hint">días con cierre bajo cero</span></div>' + matrizHtml(m) +
         '<div class="legend"><span><i class="sw" style="background:var(--good)"></i>● Verde · ningún día</span>' +
         '<span><i class="sw" style="background:var(--warn)"></i>▲ Amarillo · menos de la mitad</span>' +
         '<span><i class="sw" style="background:var(--crit)"></i>◆ Rojo · la mitad o más</span>' +
         '<span><i class="sw" style="background:var(--nodata)"></i>○ Sin dato</span></div>' +
         '<div class="ks">Un nivel bajo cero es imposible: no hay media bodega de pallets en menos. ' +
         'El defecto está en la <b>fecha del documento</b> en SAP —la salida de mercancías queda fechada ' +
         'antes que el traspaso que la alimenta— y se concentra en el ingreso a inspección, no repartido ' +
         'por la planta. <span class="mut">Se arregla en SAP, no acá.</span></div></div>');
  const peores = bodegas.filter(b => b.salud.n > 0)
    .map(b => ({ ico: GLIFO[b.salud.nivel], cls: b.salud.nivel === 'rojo' ? 'crit' : 'warn',
                 t: b.nom, m: mil(b.salud.n) + ' de ' + mil(b.salud.de) + ' días bajo cero · peor el ' +
                    (b.peor ? b.peor.dia : '—'), v: mil(b.peor ? b.peor.cierre : 0) }));
  H.push('<div class="card rise"><div class="ct"><h4>Estaciones con días imposibles</h4>' +
         '<span class="hint">peor cierre</span></div>' +
         listaHtml(peores, 'Ninguna estación cierra bajo cero.') + '</div>');
  H.push('</div></section>');

  // ── ③ ¿Hacia donde vamos? ──
  H.push('<section class="band"><div class="bandh"><span class="num">3</span>' +
         '<h3>¿Hacia dónde vamos?</h3><span>movimiento del año y del mes en curso</span></div>');
  H.push('<div class="grid g64">');
  H.push('<div class="card rise"><div class="ct"><h4>Movimiento neto por mes</h4>' +
         '<span class="hint">positivo = salió de REDTEC</span></div>' +
         '<div class="scroll">' + T.svgMeses(d.meses || []) + '</div>' +
         '<div class="legend"><span><i class="sw" style="background:var(--ret)"></i>Retail <b>' +
         conSigno(d.anio ? d.anio.ret : 0) + '</b> en el año</span>' +
         '<span><i class="sw" style="background:var(--cli)"></i>Clientes <b>' +
         conSigno(d.anio ? d.anio.cli : 0) + '</b> en el año</span></div></div>');
  H.push('<div class="card rise"><div class="ct"><h4>Apertura → cierre del mes</h4>' +
         '<span class="hint">' + esc(mes0 ? etiquetaDeMes(mes0) : 's/d') + '</span></div>' +
         dumbbell(serie, bodegas, mes0) + '</div>');
  H.push('</div></section>');

  // ── ④ ¿Que hay que decidir? ──
  H.push('<section class="band"><div class="bandh"><span class="num">4</span>' +
         '<h3>¿Qué hay que decidir?</h3><span>lo que el dato pide y lo que el proyecto comprometió</span></div>');
  H.push('<div class="grid g3">');
  H.push('<div class="card rise"><div class="ct"><h4>Lo que el dato pide</h4>' +
         '<span class="hint">controles y estaciones</span></div>' +
         listaHtml(decisiones(d, bodegas), 'Nada pendiente: todos los controles pasan.') + '</div>');
  const hs = hitos(hoy);
  H.push('<div class="card rise"><div class="ct"><h4>Compromisos del proyecto</h4>' +
         '<span class="hint">vencidos primero</span></div>' +
         listaHtml(hs.map(h => ({ ico: h.cls === 'crit' ? '!' : h.cls === 'warn' ? '▲' : '●',
                                  cls: h.cls, t: h.t, m: h.m + ' · ' + h.f, v: h.v })),
                   'Sin compromisos declarados.') + '</div>');
  const ctrl = Array.isArray(d.controles) ? d.controles : [];
  H.push('<div class="card rise"><div class="ct"><h4>Controles que pasan</h4>' +
         '<span class="hint">con su fecha</span></div>' +
         listaHtml(ctrl.filter(c => c.estado !== 'no pasa').map(c => ({
           ico: '●', cls: 'good', t: String(c.titulo),
           m: recortar(c.texto, 110), v: esc(String(c.medido || d.extra_medido || 's/f')) })),
           'No vinieron controles en esta corrida.') + '</div>');
  H.push('</div></section>');

  // ── ⑤ la cartera ──
  H.push('<section class="band"><div class="bandh"><span class="num">5</span>' +
         '<h3>Las nueve estaciones</h3><span>clic en una fila para ver su mes día por día</span></div>');
  H.push('<div class="card"><div class="tblwrap"><table class="cart">' +
         '<thead><tr><th>Estación</th><th>Planta</th><th>Etapa</th><th class="num">Saldo</th>' +
         '<th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Neto</th>' +
         '<th class="num">Días &lt; 0</th><th>Salud</th></tr></thead><tbody id="cartera">' +
         bodegas.map(filaCartera).join('') + '</tbody></table></div>' +
         '<div class="empty" id="sinfilas" hidden>Ninguna estación con ese filtro.</div></div></section>');

  // ── el metodo ──
  H.push(metodo(d));
  H.push('<div class="foot"><span>Extracción propia M3DATA desde SAP B1 · base CLPRDREDTEC · ' +
         'saldos al ' + esc(hoy) + ' · página armada por <code>scripts/armar-cockpit-pool.js</code>, ' +
         'ninguna cifra escrita a mano.</span>' +
         '<span><a href="stock-flujos-pallets.html">Ver el detalle completo ›</a></span></div>');
  H.push('</div>');

  // ── el cajon ──
  H.push('<div class="scrim" id="scrim"></div>');
  H.push('<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Detalle de la estación">' +
         '<button class="dx" id="dxc" type="button" aria-label="Cerrar">✕</button>' +
         '<div id="dbody"></div></aside>');
  H.push(script(serie, mes0));
  H.push('</body>\n</html>\n');
  return H.join('\n');
}

/*  APERTURA → CIERRE DEL MES, EN MANCUERNA.
 *
 *  Una barra sola no dice de donde vino el nivel. La mancuerna pone los dos
 *  extremos en el mismo eje y la linea entre ellos ES el movimiento del mes:
 *  se lee la direccion sin leer un numero. Es el mismo grafico con que el
 *  tablero de ITL muestra inicial → actual → meta.
 *
 *  El eje incluye el cero siempre, por lo mismo que la serie diaria: es la
 *  frontera entre un nivel posible y uno imposible. */
function dumbbell(serie, bodegas, mes) {
  const filas = [];
  for (const b of (Array.isArray(bodegas) ? bodegas : [])) {
    const fuente = (Array.isArray(serie) ? serie : []).find(x => x && String(x.cod) === b.cod);
    const r = resumenDelMes(diasDelMes(fuente, mes));
    if (r) filas.push({ cod: b.cod, nom: b.nom, a: r.apertura, c: r.cierre, salud: b.salud.nivel });
  }
  if (!filas.length) return '<div class="empty">Sin movimiento en el mes.</div>';
  const An = 640, izq = 128, der = 62, arriba = 14, alto = filas.length * 26, abajo = 24;
  const Al = arriba + alto + abajo;
  const vals = filas.flatMap(f => [f.a, f.c]).concat([0]);
  const max = Math.max(...vals), min = Math.min(...vals);
  const rango = (max - min) || 1, x = v => izq + ((v - min) / rango) * (An - izq - der);
  let g = '';
  const x0 = x(0);
  g += '<line class="cero" x1="' + x0.toFixed(1) + '" y1="' + arriba + '" x2="' + x0.toFixed(1) +
       '" y2="' + (arriba + alto) + '"/>';
  g += '<text class="ax" x="' + x0.toFixed(1) + '" y="' + (Al - 8) + '" text-anchor="middle">0</text>';
  filas.forEach((f, i) => {
    const y = arriba + i * 26 + 13;
    const xa = x(f.a), xc = x(f.c);
    g += '<text class="ax" x="' + (izq - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(f.cod) + '</text>';
    g += '<line x1="' + Math.min(xa, xc).toFixed(1) + '" y1="' + y + '" x2="' + Math.max(xa, xc).toFixed(1) +
         '" y2="' + y + '" stroke="var(--line2)" stroke-width="3" stroke-linecap="round"/>';
    g += '<circle cx="' + xa.toFixed(1) + '" cy="' + y + '" r="5" fill="var(--card)" stroke="var(--ink3)" stroke-width="2">' +
         '<title>' + esc(f.nom) + ' · abrió en ' + mil(f.a) + '</title></circle>';
    g += '<circle cx="' + xc.toFixed(1) + '" cy="' + y + '" r="6" fill="var(--' +
         (f.c < 0 ? 'crit' : 'pla') + ')">' +
         '<title>' + esc(f.nom) + ' · cerró en ' + mil(f.c) + '</title></circle>';
    g += '<text class="ax" x="' + (An - der + 8) + '" y="' + (y + 4) + '">' + esc(mil(f.c)) + '</text>';
  });
  return '<div class="scroll dbl"><svg viewBox="0 0 ' + An + ' ' + Al + '" role="img" ' +
         'aria-label="Apertura y cierre del mes por estación">' + g + '</svg></div>' +
         '<div class="legend"><span><i class="sw" style="background:transparent;border:2px solid var(--ink3)"></i>' +
         'Abrió el mes</span><span><i class="sw" style="background:var(--pla)"></i>Cerró</span>' +
         '<span><i class="sw" style="background:var(--crit)"></i>Cerró bajo cero</span></div>';
}

/*  DE DONDE SALE CADA NUMERO. Cerrado por defecto: quien mira el tablero no
 *  necesita abrirlo, pero quien duda de una cifra tiene que poder llegar a la
 *  definicion sin preguntarle a nadie. */
function metodo(d) {
  return '<details class="metodo"><summary>¿De dónde sale cada número?</summary><dl>' +
    '<dt>Pool</dt><dd>Clientes + retail + las nueve bodegas del indicador de planta. Merma, extraños ' +
    'y el tránsito que no es del indicador están en una bodega de SAP pero no son pallet que rote: ' +
    'se muestran como referencia y no suman. SAP tiene <code>' + mil(d.pool_sap) + '</code> en bodega.</dd>' +
    '<dt>Saldo por bodega</dt><dd>SAP B1 Service Layer, <code>ItemWarehouseInfoCollection.InStock</code>. ' +
    'Es el saldo que SAP ya tiene calculado, sin acumular series.</dd>' +
    '<dt>Distribución diaria</dt><dd>Se calcula <b>hacia atrás</b> desde ese saldo vivo, restando el ' +
    'movimiento de cada día: <code>nivel(t) = ancla − Σ movimientos posteriores</code>. Por ' +
    'construcción, el cierre del último día es el saldo de la tabla.</dd>' +
    '<dt>Salud de una estación</dt><dd>Mira una sola cosa: cuántos días cierra bajo cero. ' +
    '<b>Verde</b> ninguno, <b>amarillo</b> menos de la mitad, <b>rojo</b> la mitad o más. Lo que no ' +
    'se puede evaluar dice <b>sin dato</b> y no se pinta de verde.</dd>' +
    '<dt>Niveles negativos</dt><dd>No son un error del cálculo: SAP los tiene así. La causa es la ' +
    'fecha del documento —la salida de mercancías queda fechada antes que el traspaso que la ' +
    'alimenta—. Se verificó contra OINM calculado por otra vía: da los mismos días y los mismos ' +
    'números. Se arregla en SAP.</dd>' +
    '<dt>Atribución por socio</dt><dd>Serie de movimientos por ubicación, repartida con el maestro ' +
    'de ubicaciones. El total lo dicta la bodega; la ubicación sólo lo reparte. Lo que no se puede ' +
    'ubicar es el residuo, y no es pallet perdido.</dd>' +
    '<dt>Esta página</dt><dd>No consulta SAP ni ningún API: lee <code>data/datos-stock.json</code>, ' +
    'que escribe el cierre diario. Si ese archivo no está, no hay página.</dd>' +
    '</dl></details>';
}

/*  EL JAVASCRIPT.
 *
 *  Tres cosas y ninguna mas: el tema, los filtros de la tabla y el cajon de
 *  detalle. El cajon dibuja con las MISMAS funciones probadas que usa
 *  stock-flujos-pallets.html, publicadas con toString(), no con una copia
 *  escrita a mano. */
function script(serie, mes0) {
  const fns = [esNumero, mil, conSigno, clasePos, esc, etiquetaDeMes, diasDelMes, resumenDelMes,
               altoVisible, ejeDeDias, svgFlujoDia, svgNivelDia, tablaDeDias, rehidratar];
  const cuerpo = 'var MESES = ' + jsonSeguro(MESES) + ';\n' +
    fns.map(f => f.toString()).join('\n') + '\n' +
    'var PD = rehidratar(' + jsonSeguro(serieCompacta(serie)) + ');\n' +
    'var MES0 = ' + jsonSeguro(mes0) + ';\n' + [
    '(function () {',
    '  function $(s, r) { return (r || document).querySelector(s); }',
    '  try {',
    '    var tema = $("#tema");',
    '    if (tema) tema.addEventListener("click", function (e) {',
    '      var b = e.target.closest("button[data-t]"); if (!b) return;',
    '      document.documentElement.setAttribute("data-theme", b.getAttribute("data-t"));',
    '      [].forEach.call(tema.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });',
    '      try { localStorage.setItem("cockpit-tema", b.getAttribute("data-t")); } catch (e2) {}',
    '    });',
    '    try {',
    '      var g = localStorage.getItem("cockpit-tema");',
    '      if (g === "light" || g === "dark") {',
    '        document.documentElement.setAttribute("data-theme", g);',
    '        [].forEach.call(tema.querySelectorAll("button"), function (x) {',
    '          x.classList.toggle("on", x.getAttribute("data-t") === g); });',
    '      }',
    '    } catch (e3) {}',
    '',
    '    var filtro = { planta: "", salud: "" };',
    '    var filtros = $("#filtros"), cuerpoTabla = $("#cartera"), sinfilas = $("#sinfilas");',
    '    function aplicar() {',
    '      var hay = 0;',
    '      [].forEach.call(cuerpoTabla.rows, function (tr) {',
    '        var ok = (!filtro.planta || tr.getAttribute("data-planta") === filtro.planta) &&',
    '                 (!filtro.salud  || tr.getAttribute("data-salud")  === filtro.salud);',
    '        tr.hidden = !ok; if (ok) hay++;',
    '      });',
    '      if (sinfilas) sinfilas.hidden = hay > 0;',
    '    }',
    '    if (filtros) filtros.addEventListener("click", function (e) {',
    '      var c = e.target.closest(".chip"); if (!c) return;',
    '      var f = c.getAttribute("data-f");',
    '      filtro[f] = c.getAttribute("data-v");',
    '      [].forEach.call(filtros.querySelectorAll(\'.chip[data-f="\' + f + \'"]\'), function (x) {',
    '        x.classList.toggle("on", x === c); });',
    '      aplicar();',
    '    });',
    '',
    '    var drawer = $("#drawer"), scrim = $("#scrim"), dbody = $("#dbody"), ultimo = null;',
    '    function cerrar() {',
    '      drawer.classList.remove("on"); scrim.classList.remove("on");',
    '      if (ultimo && ultimo.focus) ultimo.focus();',
    '    }',
    '    function abrir(cod) {',
    '      var b = null, i;',
    '      for (i = 0; i < PD.length; i++) if (PD[i].cod === cod) b = PD[i];',
    '      if (!b) return;',
    '      var ds = diasDelMes(b, MES0), r = resumenDelMes(ds);',
    '      var H = [\'<div class="code">\' + esc(b.cod) + \'</div><h3>\' + esc(b.nom) + \'</h3>\'];',
    '      if (!r) { H.push(\'<p class="mut">Sin movimiento en \' + esc(etiquetaDeMes(MES0)) + \'.</p>\'); }',
    '      else {',
    '        H.push(\'<div class="mut">\' + esc(etiquetaDeMes(MES0)) + \' · \' + mil(r.n) +',
    '               \' días con movimiento, del \' + esc(r.desde) + \' al \' + esc(r.hasta) + \'</div>\');',
    '        H.push(\'<div class="k4">\');',
    '        H.push(tile("Apertura", mil(r.apertura), r.apertura < 0));',
    '        H.push(tile("Entradas", mil(r.entradas), false));',
    '        H.push(tile("Salidas", mil(r.salidas), false));',
    '        H.push(tile("Cierre", mil(r.cierre), r.cierre < 0));',
    '        H.push(\'</div>\');',
    '        if (r.negativos) H.push(\'<p class="malo" style="margin:14px 0 0;font-weight:600">\' +',
    '          mil(r.negativos) + \' de \' + mil(r.n) + \' días cierran bajo cero, el peor el \' +',
    '          esc(r.peor.dia) + \' en \' + mil(r.peor.cierre) + \'.</p>\');',
    '        H.push(\'<h5>Entradas y salidas de cada día</h5><div class="scroll">\' + svgFlujoDia(ds) + \'</div>\');',
    '        H.push(\'<h5>Nivel con el que cerró cada día</h5><div class="scroll">\' + svgNivelDia(ds) + \'</div>\');',
    '        H.push(\'<h5>Día por día</h5>\' + tablaDeDias(ds));',
    '      }',
    '      dbody.innerHTML = H.join("");',
    '      drawer.classList.add("on"); scrim.classList.add("on");',
    '      $("#dxc").focus();',
    '    }',
    '    function tile(et, v, malo) {',
    '      return \'<div class="card"><div class="ct"><h4>\' + esc(et) + \'</h4></div><div class="kv\' +',
    '             (malo ? \' malo\' : \'\') + \'">\' + v + \'</div></div>\';',
    '    }',
    '    document.addEventListener("click", function (e) {',
    '      var t = e.target.closest("[data-cod]"); if (!t) return;',
    '      ultimo = t; abrir(t.getAttribute("data-cod"));',
    '    });',
    '    document.addEventListener("keydown", function (e) {',
    '      if (e.key === "Escape") { cerrar(); return; }',
    '      if (e.key !== "Enter" && e.key !== " ") return;',
    '      var t = e.target.closest && e.target.closest("[data-cod]");',
    '      if (t) { e.preventDefault(); ultimo = t; abrir(t.getAttribute("data-cod")); }',
    '    });',
    '    $("#dxc").addEventListener("click", cerrar);',
    '    scrim.addEventListener("click", cerrar);',
    '  } catch (e) { /* sin interaccion es mejor que sin pagina */ }',
    '})();',
  ].join('\n');
  return '<script>\n' + sinCierreDeScript(cuerpo) + '\n<\/script>';
}

// ── opciones y main ──────────────────────────────────────────────────────────
function opcion(nombre, porDefecto, argv) {
  const a = (argv || process.argv.slice(2)).find(x => x.indexOf('--' + nombre + '=') === 0);
  return a ? a.slice(nombre.length + 3) : porDefecto;
}
function opcionesRaras(argv) {
  return (argv || process.argv.slice(2))
    .filter(a => !OPCIONES.some(o => a.indexOf('--' + o + '=') === 0));
}
function leerJson(ruta) {
  const fs = require('fs');
  if (!fs.existsSync(ruta)) return null;
  return JSON.parse(sinBom(fs.readFileSync(ruta, 'utf8')));
}

function main() {
  const raras = opcionesRaras();
  if (raras.length) {
    console.error('Opciones que no conozco: ' + raras.join(' '));
    console.error('Las que acepto: ' + OPCIONES.map(o => '--' + o + '=').join(' '));
    process.exit(1);
  }
  const rDat = opcion('datos', 'data/datos-stock.json');
  const rSal = opcion('salida', 'cockpit-pool.html');
  const d = leerJson(rDat);
  // Fallar cerrado: sin el json no hay pagina. Una pagina a medias se lee como
  // una pagina al dia.
  if (!d) { console.error('Falta ' + rDat + '. Corre antes armar-tablero-stock.js.'); process.exit(1); }
  require('fs').writeFileSync(rSal, pagina(d), { encoding: 'utf8' });
  const bs = bodegasDelCockpit(d.planta_dias || []);
  console.log('Cockpit armado.');
  console.log('  pool ' + mil(d.pool) + '  ·  ' + bs.length + ' estaciones  ·  ' +
              bs.reduce((a, b) => a + b.dias, 0) + ' días');
  console.log('  salud: ' + ['rojo', 'amarillo', 'verde', 'sindato']
    .map(s => s + ' ' + bs.filter(b => b.salud.nivel === s).length).join(' · '));
  console.log('  ' + rSal);
}

module.exports = { ETAPAS, GLIFO, ORDEN_SALUD, HITOS, CSS,
                   etapaDeBodega, saludDeBodega, bodegasDelCockpit, matrizPlantaEtapa,
                   titular, tarjetas, decisiones, diasHasta, hitos,
                   recortar, chipEstado, tarjetaHtml, matrizHtml, filaCartera, listaHtml,
                   dumbbell, metodo, script, pagina,
                   opcion, opcionesRaras, leerJson, OPCIONES };

if (require.main === module) main();
