#!/usr/bin/env node
'use strict';
// ───────────────────────────────────────────────────────────────────────────────
//  armar-tablero-stock.js  ·  M3DATA
//
//  Convierte lo que emite la cadena de extraccion en el tablero que mira
//  gerencia. Dos salidas de un mismo calculo:
//    · data/datos-stock.json   el dato, para quien quiera consumirlo
//    · stock-flujos-pallets.html   la pagina, ya armada
//
//  POR QUE SE GENERA LA PAGINA EN VEZ DE QUE LA PAGINA LEA EL JSON:
//  la version anterior tenia las cifras escritas a mano en el HTML. Cambiarlo
//  a un fetch desde el navegador parece mas limpio y es peor aca: el sitio
//  esta detras de login, el JSON viviria en otra ruta, y un fetch que falla
//  deja la pagina en blanco justo cuando alguien la abre en una reunion.
//  Generada en el workflow y commiteada, la pagina es un archivo estatico que
//  no depende de nada en tiempo de lectura, igual que los otros tableros del
//  repo. El costo es que hay que volver a generarla para refrescar; eso ya lo
//  hace el workflow todos los dias.
//
//  NINGUNA CIFRA SE ESCRIBE A MANO. Todo numero que aparece en la pagina sale
//  de los JSON de entrada. Lo que todavia no produce la cadena vive en
//  data/tablero-extra.json con su propia fecha de medicion, y si ese archivo
//  no esta, la seccion NO SE DIBUJA. Preferimos un hueco visible a un numero
//  viejo que se lee como de hoy.
//
//  SOLO LEE sus entradas y escribe las dos salidas que se le piden.
//
//  Uso:
//    node scripts/armar-tablero-stock.js \
//      --bodegas=data/bodegas-hoy.json \
//      --retail=data/stock-retail.json \
//      --clientes=data/stock-clientes.json \
//      --extra=data/tablero-extra.json \
//      --datos=data/datos-stock.json \
//      --salida=stock-flujos-pallets.html
// ───────────────────────────────────────────────────────────────────────────────

const OPCIONES = ['bodegas', 'retail', 'clientes', 'extra', 'datos', 'salida'];

// ── las nueve bodegas del indicador de planta ────────────────────────────────
// Enrique definio nueve estaciones como "planta" para el indicador. MERMA,
// EXTRAÑOS y los TRANSITO estan en el pool pero fuera del indicador, y esa
// distincion no la trae SAP: es una decision de negocio y por eso esta
// declarada aca y no deducida.
const NUEVE = new Set(['RT13-100', 'RT13-102', 'RT13-103', 'RT13-105',
                       'RT07-120', 'RT07-122', 'RT07-123', 'RT07-125', 'RT07-126']);

// ── grupos economicos de retail ──────────────────────────────────────────────
// SAP no tiene holding: tiene RUT. La agrupacion es nuestra y esta PENDIENTE
// DE CONFIRMACION de Catalina. Se declara por RUT, no por nombre, porque los
// nombres de SAP cambian y el RUT no. Un RUT que no este aca no se agrupa:
// aparece en la tabla de socios y no en la de concentracion.
const GRUPOS = [
  { nom: 'WALMART',                          ruts: ['R96829710-4', 'R76473580-3'] },
  { nom: 'SMU (Unimarc + Mayorista + Alvi)', ruts: ['R81537600-5', 'R76012676-4', 'R96618540-6'] },
  { nom: 'CENCOSUD',                         ruts: ['R81201000-K'] },
  { nom: 'TOTTUS (Falabella)',               ruts: ['R78627210-6'] },
];

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// ── formato ──────────────────────────────────────────────────────────────────
// El separador de miles es el punto y el decimal la coma: es Chile.
// Number(null) es 0 y Number('') tambien. Un nivel que no vino NO es una
// bodega vacia: es un dato que falta, y la pagina tiene que decir eso.
function esNumero(n) {
  return typeof n === 'number' ? isFinite(n)
       : (typeof n === 'string' && n.trim() !== '' && isFinite(Number(n)));
}
function mil(n) {
  if (!esNumero(n)) return '—';
  return Math.round(Number(n)).toLocaleString('es-CL');
}
// mil() ya trae el signo menos; agregar '-' aca daria '+-6.488'.
function conSigno(n) {
  if (!esNumero(n)) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : '') + mil(v);
}
function clasePos(n) {
  const v = Number(n) || 0;
  return v > 0 ? 'd-pos' : v < 0 ? 'd-neg' : 'd-nul';
}
function pct(parte, total) {
  if (!esNumero(total) || !esNumero(parte)) return null;
  const t = Number(total), p = Number(parte);
  if (t === 0) return null;
  return (p / t) * 100;
}
function pct1(parte, total) {
  const v = pct(parte, total);
  return v == null ? '—' : v.toFixed(1).replace('.', ',') + '%';
}
// Los nombres vienen de SAP. Un '&' o un '<' en una razon social rompe la
// pagina si no se escapa, y nadie lo nota hasta que pasa.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function sinBom(txt) {
  const t = String(txt == null ? '' : txt);
  return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
}

// ── derivaciones ─────────────────────────────────────────────────────────────

// La bodega manda en CUANTOS hay. Aca solo se reparte el total del pool en
// las tres patas del pool: lo que esta en clientes, lo que esta en retail y lo
// que esta en planta. Planta es "todo lo demas", no una lista: si manana
// aparece una bodega nueva, entra sola.
function clasificarPool(bodegas) {
  const filas = Array.isArray(bodegas) ? bodegas : [];
  let clientes = 0, retail = 0, planta = 0, nueve = 0, fuera = 0;
  const dePlanta = [];
  for (const b of filas) {
    const whs = String((b && b.whs) == null ? '' : b.whs).trim();
    const saldo = Number(b && b.saldo) || 0;
    if (whs === 'CLIENTES') { clientes += saldo; continue; }
    if (whs === 'RETAIL')   { retail   += saldo; continue; }
    planta += saldo;
    if (NUEVE.has(whs)) nueve += saldo; else fuera += saldo;
    // Una bodega en cero solo se muestra si es del indicador: que TALCA
    // REPARACION aparezca en 0 es informacion; que aparezcan veintisiete
    // bodegas en cero es ruido.
    if (saldo !== 0 || NUEVE.has(whs))
      dePlanta.push({ cod: whs, nom: String((b && b.nombre) || whs), nivel: saldo, nueve: NUEVE.has(whs) });
  }
  dePlanta.sort((a, b) => b.nivel - a.nivel || (a.cod < b.cod ? -1 : 1));
  return { clientes, retail, planta, nueve, fuera, filas: dePlanta,
           bodegas: filas.length, total: clientes + retail + planta };
}

// Un socio "con saldo" es uno cuyo nivel no es cero. Los negativos cuentan:
// son el sintoma de un dato malo y esconderlos seria tapar el problema.
function cortarSocios(socios, cuantos) {
  const vivos = (Array.isArray(socios) ? socios : [])
    .filter(s => s && Number(s.nivel) !== 0)
    .map(s => ({ cod: String(s.cod == null ? '' : s.cod),
                 nom: String(s.nom == null ? '' : s.nom),
                 nivel: Number(s.nivel) || 0,
                 ini: Number(s.partida) || 0,
                 cambio: (Number(s.nivel) || 0) - (Number(s.partida) || 0) }))
    .sort((a, b) => b.nivel - a.nivel || (a.cod < b.cod ? -1 : 1));
  const n = Math.max(0, Number(cuantos) || 0);
  const top = vivos.slice(0, n), cola = vivos.slice(n);
  // Un nivel negativo es imposible: nadie puede tener menos de cero pallets.
  // Los de la COLA se nombran, porque ahi quedan escondidos dentro de una
  // suma; los que caen en el top ya se ven solos, en rojo, en la tabla.
  const negativos = cola.filter(x => x.nivel < 0)
                        .sort((a, b) => a.nivel - b.nivel).slice(0, 3);
  return { top, conSaldo: vivos.length,
           resto: { n: cola.length, nivel: cola.reduce((a, x) => a + x.nivel, 0), negativos } };
}

// Concentracion por grupo. El denominador es la suma de los socios, NO el
// nivel de la bodega: el residuo sin ubicacion no se le puede atribuir a
// ningun grupo y meterlo en el denominador diluiria los porcentajes con algo
// que no se sabe de quien es.
function porGrupo(socios, grupos) {
  const nivel = new Map();
  for (const s of (Array.isArray(socios) ? socios : []))
    if (s && s.cod != null) nivel.set(String(s.cod).trim(), Number(s.nivel) || 0);
  const total = [...nivel.values()].reduce((a, x) => a + x, 0);
  const out = (Array.isArray(grupos) ? grupos : []).map(g => ({
    nom: String(g && g.nom || ''),
    nivel: (g && Array.isArray(g.ruts) ? g.ruts : [])
             .reduce((a, r) => a + (nivel.get(String(r).trim()) || 0), 0),
    miembros: (g && Array.isArray(g.ruts) ? g.ruts : [])
                .filter(r => nivel.has(String(r).trim())).length,
  })).sort((a, b) => b.nivel - a.nivel);
  const juntos = out.reduce((a, x) => a + x.nivel, 0);
  return { grupos: out, base: total, juntos, parte: pct(juntos, total) };
}

// Los dos meses tienen que quedar alineados o el grafico compara enero de una
// bodega con febrero de la otra. Se usa la union de los meses, no la de una.
function mesesPareados(mensualRet, mensualCli) {
  const lee = a => new Map((Array.isArray(a) ? a : [])
    .filter(x => x && /^\d{4}-\d{2}$/.test(String(x.mes)))
    .map(x => [String(x.mes), Number(x.neto) || 0]));
  const r = lee(mensualRet), c = lee(mensualCli);
  const claves = [...new Set([...r.keys(), ...c.keys()])].sort();
  return claves.map(mes => ({
    mes, etiqueta: MESES[Number(mes.slice(5, 7)) - 1] || mes.slice(5, 7),
    ret: r.get(mes) || 0, cli: c.get(mes) || 0,
  }));
}

// ── el dato ──────────────────────────────────────────────────────────────────
// Una sola funcion arma TODO lo que la pagina va a mostrar. La pagina despues
// no calcula nada: si un numero esta mal, esta mal aca, en un solo lugar, y
// hay una prueba que lo agarra.
function datos(bod, ret, cli, extra) {
  const fl = clasificarPool(bod && bod.bodegas);
  const sr = cortarSocios(ret && ret.socios, 25);
  const sc = cortarSocios(cli && cli.socios, 25);
  const gr = porGrupo(ret && ret.socios, GRUPOS);
  const meses = mesesPareados(ret && ret.mensual, cli && cli.mensual);
  const nr = (ret && ret.nivel) || {}, nc = (cli && cli.nivel) || {};
  const vr = (ret && ret.ventana) || {}, vc = (cli && cli.ventana) || {};

  // El total del pool lo dice la sonda; el nivel de cada bodega tambien.
  // Si el nivel que saldo-pool uso como ancla no es el mismo que trae la
  // sonda, los dos lados se leyeron en momentos distintos y hay que decirlo.
  const descalces = [];
  if (nr.bodega != null && Number(nr.bodega) !== fl.retail)
    descalces.push('RETAIL: la sonda dice ' + mil(fl.retail) + ' y saldo-pool anclo en ' + mil(nr.bodega));
  if (nc.bodega != null && Number(nc.bodega) !== fl.clientes)
    descalces.push('CLIENTES: la sonda dice ' + mil(fl.clientes) + ' y saldo-pool anclo en ' + mil(nc.bodega));

  return {
    _que_es: 'Stock de pallet rojo por socio y por bodega, extraido de SAP B1 por M3DATA. ' +
             'La bodega manda en cuantos hay; la ubicacion manda en de quien son.',
    generado: (bod && bod.generado) || new Date().toISOString(),
    pool: fl.total,
    bodegas_cuantas: fl.bodegas,
    // Pallet que existe en SAP sólo como instrumento de recuperación. No
    // vuelve a rotar, así que no es pool en circulación. Se declara en el archivo de extras porque la bodega no
    // lo distingue, es una regla de negocio.
    sistemico: (extra && esNumero(extra.sistemico)) ? Number(extra.sistemico) : null,
    bodegas: {
      CLIENTES: { nivel: fl.clientes, socios: Number(nc.socios) || 0,
                  residuo: Number(nc.residuo) || 0, n: sc.conSaldo,
                  de: ((cli && cli.controles && cli.controles.maestro) || {}).conSocio || null },
      RETAIL:   { nivel: fl.retail, socios: Number(nr.socios) || 0,
                  residuo: Number(nr.residuo) || 0, n: sr.conSaldo,
                  de: ((ret && ret.controles && ret.controles.maestro) || {}).conSocio || null },
      PLANTA:   { nivel: fl.planta, nueve: fl.nueve, fuera: fl.fuera },
    },
    meses,
    anio: { ret: meses.reduce((a, m) => a + m.ret, 0), cli: meses.reduce((a, m) => a + m.cli, 0) },
    retail: sr.top, retail_resto: sr.resto,
    clientes: sc.top, clientes_resto: sc.resto,
    planta: fl.filas,
    grupos: gr,
    flujo: (extra && Array.isArray(extra.flujo_por_bodega)) ? extra.flujo_por_bodega : null,
    controles: (extra && Array.isArray(extra.controles)) ? extra.controles : null,
    aviso_nota: (extra && typeof extra.aviso_nota === 'string' && extra.aviso_nota.trim())
                  ? extra.aviso_nota.trim() : null,
    residuo_detalle: (extra && Array.isArray(extra.residuo_detalle))
                  ? extra.residuo_detalle.filter(x => x && x.que && esNumero(x.cantidad)) : null,
    // Un bloque en verificacion se marca donde esta, no en una nota al pie:
    // quien mira el grafico tiene que ver la advertencia sin bajar la vista.
    mensual_nota: (extra && typeof extra.mensual_nota === 'string' && extra.mensual_nota.trim())
                  ? extra.mensual_nota.trim() : null,
    extra_medido: (extra && extra.medido) || null,
    ventana: { nivel: String((bod && bod.generado) || '').slice(0, 10),
               flujo_desde: vr.desde || vc.desde || null,
               flujo_hasta: vr.hasta || vc.hasta || null,
               desfase_horas: vr.desfaseHoras == null ? null : vr.desfaseHoras },
    descalces,
  };
}

// ── frescura ─────────────────────────────────────────────────────────────────
// La antiguedad NO se puede calcular al armar la pagina. Si el proceso diario
// se cae, la pagina no se vuelve a armar: un cartel escrito en el build se
// congela junto con el dato y sigue diciendo "de hoy" para siempre. Por eso la
// fecha va EMBEBIDA y la cuenta la hace el navegador contra su propio reloj,
// cada vez que alguien abre el tablero. Es el unico pedazo de javascript de
// esta pagina y existe por eso.
function antiguedad(medido, hoy) {
  const m = String(medido || '').slice(0, 10), h = String(hoy || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m) || !/^\d{4}-\d{2}-\d{2}$/.test(h))
    return { dias: null, nivel: 'desconocido',
             texto: 'No se pudo determinar de cuándo es este dato.' };
  const dias = Math.round((Date.parse(h + 'T00:00:00Z') - Date.parse(m + 'T00:00:00Z')) / 86400000);
  // Una fecha futura no es frescura: es un reloj mal puesto o un dato mal
  // fechado, y callarlo seria peor que avisarlo.
  if (dias < 0) return { dias, nivel: 'futuro',
    texto: 'Este tablero dice estar medido el ' + m + ', que es posterior a hoy. Algo está mal fechado.' };
  if (dias <= 1) return { dias, nivel: 'fresco', texto: null };
  if (dias <= 3) return { dias, nivel: 'atrasado',
    texto: 'Este tablero muestra el cierre del ' + m + '. Hace ' + dias + ' días que no se actualiza.' };
  return { dias, nivel: 'viejo',
    texto: 'Este tablero muestra el cierre del ' + m + '. Hace ' + dias +
           ' días que no se actualiza: el proceso diario no está corriendo.' };
}

// ── graficos ─────────────────────────────────────────────────────────────────
// La barra del pool: el ancho de cada tramo es su porcentaje de 1000, menos
// 2 de separacion. Sin esa separacion los tres colores se tocan y el ojo lee
// un solo bloque.
function svgPool(d) {
  const t = Number(d.pool) || 0;
  const tramos = [
    { c: 's-cli', nom: 'Clientes',      v: d.bodegas.CLIENTES.nivel },
    { c: 's-ret', nom: 'Retail',        v: d.bodegas.RETAIL.nivel },
    { c: 's-pla', nom: 'Planta REDTEC', v: d.bodegas.PLANTA.nivel },
  ];
  let x = 0, piezas = '';
  for (const s of tramos) {
    const w = t === 0 ? 0 : (s.v / t) * 1000;
    piezas += '<rect class="' + s.c + '" x="' + x.toFixed(2) + '" y="0" width="' +
              Math.max(0, w - 2).toFixed(2) + '" height="34" rx="3"><title>' +
              esc(s.nom) + ': ' + mil(s.v) + ' (' + pct1(s.v, t) + ')</title></rect>';
    x += w;
  }
  return '<svg viewBox="0 0 1000 34" preserveAspectRatio="none" role="img" ' +
         'aria-label="Reparto del pool">' + piezas + '</svg>';
}

// Las barras mensuales. El cero NO es el borde inferior: un mes negativo tiene
// que caer para abajo o el grafico miente sobre el signo.
function svgMeses(meses) {
  const filas = Array.isArray(meses) ? meses : [];
  if (!filas.length) return '';
  const An = 760, Al = 234, izq = 54, arriba = 14, util = 190, bAncho = 24, bHueco = 5;
  const vals = filas.flatMap(m => [m.ret, m.cli]);
  const alto = Math.max(0, ...vals), bajo = Math.min(0, ...vals);
  const rango = (alto - bajo) || 1;
  const esc_ = util / rango;
  const y0 = arriba + alto * esc_;                     // donde cae el cero
  const slot = (An - izq) / filas.length;
  const margen = (slot - (2 * bAncho + bHueco)) / 2;

  let g = '';
  const linea = (v, txt) => {
    const y = (arriba + (alto - v) * esc_).toFixed(1);
    return '<line class="grid" x1="' + izq + '" y1="' + y + '" x2="' + An + '" y2="' + y + '"/>' +
           '<text class="ax" x="' + (izq - 8) + '" y="' + (Number(y) + 4).toFixed(1) +
           '" text-anchor="end">' + esc(txt) + '</text>';
  };
  if (alto > 0) g += linea(alto, conSigno(alto));
  g += linea(0, '0');
  if (bajo < 0) g += linea(bajo, conSigno(bajo));

  filas.forEach((m, i) => {
    const x = izq + i * slot + margen;
    for (const [j, clave, clase, nom] of [[0, 'ret', 'b-ret', 'RETAIL'], [1, 'cli', 'b-cli', 'CLIENTES']]) {
      const v = Number(m[clave]) || 0, h = Math.abs(v) * esc_;
      const y = v >= 0 ? y0 - h : y0;
      g += '<rect class="' + clase + '" x="' + (x + j * (bAncho + bHueco)).toFixed(1) + '" y="' +
           y.toFixed(1) + '" width="' + bAncho + '" height="' + h.toFixed(1) + '" rx="3">' +
           '<title>' + esc(m.etiqueta) + ' · ' + nom + ': ' + conSigno(v) + '</title></rect>';
    }
    g += '<text class="ax" x="' + (x + bAncho + bHueco / 2).toFixed(1) + '" y="' + (Al - 12) +
         '" text-anchor="middle">' + esc(m.etiqueta) + '</text>';
  });
  return '<svg viewBox="0 0 ' + An + ' ' + Al + '" role="img" ' +
         'aria-label="Movimiento neto mensual">' + g + '</svg>';
}

// ── la pagina ────────────────────────────────────────────────────────────────
const CSS = `
/* Tablero operativo: una fila de cifras, luego las tres patas del pool, luego
   el detalle por socio. Neutros calidos sobre el rojo del pallet. */
:root{
  --bg:#faf8f6; --panel:#ffffff; --linea:#e4ded8; --tinta:#1c1917; --tinta2:#57514b; --tinta3:#8a817a;
  --marca:#b5342a; --cli:#1f6fb2; --ret:#c65a1e; --pla:#0e8f7a;
  --ok:#0e8f7a; --alerta:#b06a00; --grave:#b5342a;
  --f-tit:'Archivo',system-ui,sans-serif; --f-txt:'Source Sans 3',system-ui,sans-serif;
  --f-cod:'IBM Plex Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#171513; --panel:#201d1b; --linea:#332e2a; --tinta:#f2eeea; --tinta2:#b5aca4; --tinta3:#857c74;
  --marca:#e06054; --cli:#4792d2; --ret:#d4762c; --pla:#28a386;
  --ok:#28a386; --alerta:#d99a2b; --grave:#e06054; color-scheme:dark;
}}
:root[data-theme="dark"]{
  --bg:#171513; --panel:#201d1b; --linea:#332e2a; --tinta:#f2eeea; --tinta2:#b5aca4; --tinta3:#857c74;
  --marca:#e06054; --cli:#4792d2; --ret:#d4762c; --pla:#28a386;
  --ok:#28a386; --alerta:#d99a2b; --grave:#e06054; color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--tinta);font:16px/1.55 var(--f-txt);
  font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%}
.wrap{max-width:1120px;margin:0 auto;padding-block:28px 56px;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1{font:600 30px/1.15 var(--f-tit);margin:0;text-wrap:balance;letter-spacing:-.01em}
h2{font:600 19px/1.25 var(--f-tit);margin:0 0 4px;text-wrap:balance}
h3{font:600 14px/1.3 var(--f-tit);margin:0 0 10px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta2)}
p{margin:0 0 10px;max-width:68ch}
.sub{color:var(--tinta2);font-size:14px;margin-top:6px}
.cabe{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;
  border-bottom:2px solid var(--marca);padding-bottom:14px}
.sello{font:500 12px/1 var(--f-cod);color:var(--tinta2);border:1px solid var(--linea);
  border-radius:3px;padding:6px 9px;white-space:nowrap}
section{margin-top:34px}
.panel{background:var(--panel);border:1px solid var(--linea);border-radius:8px;padding:18px}
.rejilla{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-top:14px}
.tile .et{font:600 11px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.09em;color:var(--tinta2)}
.tile .big{font:700 clamp(28px,5vw,40px)/1 var(--f-tit);margin:9px 0 2px;letter-spacing:-.02em}
.tile .pie{font-size:13px;color:var(--tinta2);min-width:0}
.tile{border-left:3px solid var(--linea)}
.t-cli{border-left-color:var(--cli)} .t-ret{border-left-color:var(--ret)} .t-pla{border-left-color:var(--pla)}
.pool{display:block;width:100%;height:34px;margin:4px 0 10px}
.fecha{color:var(--tinta3);font-size:12px;white-space:nowrap}
.malo{color:var(--grave)}
.s-cli{fill:var(--cli)} .s-ret{fill:var(--ret)} .s-pla{fill:var(--pla)}
.leyenda{display:flex;flex-wrap:wrap;gap:16px;font-size:13.5px;color:var(--tinta2);margin-top:2px}
.leyenda b{color:var(--tinta);font-weight:600}
.pt{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:-1px}
.p-cli{background:var(--cli)} .p-ret{background:var(--ret)} .p-pla{background:var(--pla)}
svg{display:block;width:100%;height:auto;max-width:100%}
.b-ret{fill:var(--ret)} .b-cli{fill:var(--cli)}
.grid{stroke:var(--linea);stroke-width:1}
.ax{fill:var(--tinta3);font:500 11px var(--f-cod)}
/* Sin min-width:0 un hijo de grid se estira al ancho de su tabla y el
   overflow-x del contenedor no recorta nada: la pagina entera se va de lado. */
.panel,.dos>*,.rejilla>*,.scroll{min-width:0}
.scroll{overflow-x:auto;margin:0 -4px;padding:0 4px;max-width:100%}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:460px}
th{text-align:left;font:600 11px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.07em;
  color:var(--tinta2);padding:0 10px 8px 0;border-bottom:1px solid var(--linea);white-space:nowrap}
td{padding:6px 10px 6px 0;border-bottom:1px solid var(--linea);vertical-align:middle}
tr:last-child td{border-bottom:none}
.cod{font:400 12px var(--f-cod);color:var(--tinta3);white-space:nowrap}
/* .cod lleva nowrap porque es para RUT y codigos de bodega en tablas. Un
   nombre de campo largo necesita poder cortarse o se lleva la pagina de lado. */
.campo{font:400 12px var(--f-cod);color:var(--tinta2);overflow-wrap:anywhere}
.nom{min-width:0}
.num{text-align:right;white-space:nowrap;font-weight:600}
th.num{text-align:right}
.bar{width:28%;min-width:70px}
.bar span{display:block;height:8px;border-radius:0 3px 3px 0;background:var(--tinta3);opacity:.55}
.t-r .bar span{background:var(--ret);opacity:1}
.t-c .bar span{background:var(--cli);opacity:1}
.t-g .bar span{background:var(--ret);opacity:1}
.d-pos{color:var(--ok)} .d-neg{color:var(--grave)} .d-nul{color:var(--tinta3)}
.chip{font:500 10px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.06em;
  border:1px solid var(--linea);border-radius:999px;padding:3px 7px;color:var(--tinta3);white-space:nowrap}
.enrevision{border:1px dashed var(--alerta);border-radius:6px;background:var(--panel);
  color:var(--tinta2);font-size:13.5px;padding:10px 13px;margin:10px 0 0}
.enrevision b{color:var(--alerta)}
.rancio{border:1px solid var(--alerta);border-left:3px solid var(--alerta);border-radius:6px;
  background:var(--panel);color:var(--alerta);font:600 14px/1.4 var(--f-txt);
  padding:11px 14px;margin-bottom:18px}
.rancio[data-nivel="viejo"],.rancio[data-nivel="futuro"]{border-color:var(--grave);color:var(--grave)}
.aviso{border-left:3px solid var(--alerta);background:var(--panel);border-radius:0 8px 8px 0;
  padding:14px 16px;margin-top:14px}
.aviso h3{color:var(--alerta);margin-bottom:6px}
.dos{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:13.5px}
dt{color:var(--tinta2);white-space:nowrap} dd{margin:0;min-width:0}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--linea);
  font-size:12.5px;color:var(--tinta3)}
@media (max-width:560px){
  .bar,th.bar{display:none}
  table{min-width:330px}
  td,th{padding-right:8px}
}
`;

function filaSocio(s) {
  return '<tr><td class="cod">' + esc(s.cod) + '</td><td class="nom">' + esc(s.nom) + '</td>' +
         '<td class="num">' + mil(s.nivel) + '</td>' +
         '<td class="num ' + clasePos(s.cambio) + '">' + conSigno(s.cambio) + '</td></tr>';
}

function tablaSocios(titulo, clase, corte, resto, nota) {
  return '<div class="panel">\n      <h3>' + esc(titulo) + '</h3>\n' +
    '      <div class="scroll"><table class="' + clase + '">\n' +
    '        <thead><tr><th>RUT</th><th>Socio</th><th class="num">Nivel</th><th class="num">Año</th></tr></thead>\n' +
    '        <tbody>' + corte.map(filaSocio).join('') + '</tbody>\n      </table></div>\n' +
    '      <p class="sub">Los otros ' + mil(resto.n) + ' socios suman <b>' + mil(resto.nivel) + '</b>.' +
    (nota ? ' ' + esc(nota) : '') + '</p>\n    </div>';
}

function notaImposibles(resto) {
  const ns = (resto && resto.negativos) || [];
  if (!ns.length) return null;
  return 'Incluye ' + ns.map(x => x.cod + ' "' + x.nom + '" en ' + mil(x.nivel)).join(', ') +
         ', que ' + (ns.length > 1 ? 'son saldos imposibles' : 'es un saldo imposible') +
         ' y esta en revision.';
}

function pagina(d) {
  const b = d.bodegas, v = d.ventana;
  const atrib = (x) => pct1(x.socios, x.nivel);
  const H = [];
  H.push('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  H.push('<title>Stock y Flujos de Pallets</title>');
  H.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  H.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  H.push('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700' +
         '&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">');
  H.push('<style>' + CSS + '</style>\n</head>\n<body>\n<div class="wrap">\n');

  H.push('<div class="rancio" id="rancio" hidden></div>');
  H.push('<header class="cabe">\n  <div>\n    <h1>Stock y Flujos de Pallets</h1>');
  H.push('    <div class="sub">Pallet rojo 1,00 × 1,20 · SKU 11111111110 · extracción propia desde SAP B1</div>');
  H.push('  </div>\n  <div class="sello" data-medido="' + esc(v.nivel) + '">Saldos al ' + esc(v.nivel) +
         (v.flujo_hasta ? '<br>Flujos ' + esc(String(v.flujo_desde || '').slice(0, 4)) + ' al ' + esc(v.flujo_hasta) : '') +
         '</div>\n</header>\n');

  // ── el pool ──
  H.push('<section>\n  <h2>El pool</h2>');
  H.push('  <p>Todo el pallet rojo que SAP tiene registrado, en las ' + mil(d.bodegas_cuantas) +
         ' bodegas de la empresa, repartido en las tres patas del pool.</p>');
  H.push('  <div class="panel">\n    <div class="tile" style="border:none;padding:0">');
  H.push('      <div class="et">Pool total</div>\n      <div class="big">' + mil(d.pool) + '</div>');
  H.push('      <div class="pie">pallets, leídos del saldo vivo de SAP' +
         (d.sistemico ? '<br>de los cuales <b>' + mil(d.sistemico) + '</b> son sistémicos y no rotan: ' +
                        'el pool en rotación es <b>' + mil(d.pool - d.sistemico) + '</b>' : '') +
         '</div>\n    </div>');
  H.push('    <div class="pool">' + svgPool(d) + '</div>\n    <div class="leyenda">');
  for (const [cl, nom, val] of [['p-cli', 'Clientes', b.CLIENTES.nivel],
                                ['p-ret', 'Retail', b.RETAIL.nivel],
                                ['p-pla', 'Planta REDTEC', b.PLANTA.nivel]])
    H.push('      <span><i class="pt ' + cl + '"></i>' + nom + ' <b>' + mil(val) + '</b> · ' +
           pct1(val, d.pool) + '</span>');
  H.push('    </div>\n  </div>\n');
  H.push('  <div class="rejilla">');
  H.push('    <div class="panel tile t-cli">\n      <div class="et">Clientes</div><div class="big">' +
         mil(b.CLIENTES.nivel) + '</div>\n      <div class="pie"><b>' + atrib(b.CLIENTES) +
         '</b> atribuido a ' + mil(b.CLIENTES.n) + ' socios<br>\n      residuo sin ubicación: ' +
         mil(b.CLIENTES.residuo) + '</div>\n    </div>');
  H.push('    <div class="panel tile t-ret">\n      <div class="et">Retail</div><div class="big">' +
         mil(b.RETAIL.nivel) + '</div>\n      <div class="pie"><b>' + atrib(b.RETAIL) +
         '</b> atribuido a ' + mil(b.RETAIL.n) + ' socios<br>\n      residuo sin ubicación: ' +
         mil(b.RETAIL.residuo) + '</div>\n    </div>');
  H.push('    <div class="panel tile t-pla">\n      <div class="et">Planta REDTEC</div><div class="big">' +
         mil(b.PLANTA.nivel) + '</div>\n      <div class="pie">' + mil(b.PLANTA.nueve) +
         ' en las nueve bodegas del indicador<br>\n      ' + mil(b.PLANTA.fuera) +
         ' en merma, extraños y tránsito</div>\n    </div>');
  H.push('  </div>\n</section>\n');

  // ── movimiento mensual ──
  if (d.meses.length) {
    H.push('<section>\n  <h2>Movimiento neto por mes</h2>');
    H.push('  <p>Cuánto subió o bajó cada bodega en el año. Un valor positivo es pallet que salió de ' +
           'REDTEC hacia el socio; uno negativo es pallet que volvió.</p>');
    if (d.mensual_nota)
      H.push('  <div class="enrevision"><b>En verificación.</b> ' + esc(d.mensual_nota) + '</div>');
    H.push('  <div class="panel">\n    <div class="leyenda" style="margin-bottom:10px">');
    H.push('      <span><i class="pt p-ret"></i>Retail <b>' + conSigno(d.anio.ret) + '</b> en el año</span>');
    H.push('      <span><i class="pt p-cli"></i>Clientes <b>' + conSigno(d.anio.cli) + '</b> en el año</span>');
    H.push('    </div>\n    <div class="scroll">' + svgMeses(d.meses) + '</div>\n  </div>\n</section>\n');
  }

  // ── quien tiene los pallets ──
  H.push('<section>\n  <h2>Quién tiene los pallets</h2>\n  <div class="dos" style="margin-top:14px">\n    ');
  H.push(tablaSocios('Retail · top ' + d.retail.length + ' de ' + mil(b.RETAIL.n) + ' con saldo',
                     't-r', d.retail, d.retail_resto, notaImposibles(d.retail_resto)));
  H.push('\n    ');
  H.push(tablaSocios('Clientes · top ' + d.clientes.length + ' de ' + mil(b.CLIENTES.n) + ' con saldo',
                     't-c', d.clientes, d.clientes_resto, notaImposibles(d.clientes_resto)));
  H.push('\n  </div>\n</section>\n');

  // ── concentracion ──
  const g = d.grupos;
  if (g && g.grupos.length) {
    H.push('<section>\n  <h2>Concentración en retail</h2>');
    H.push('  <p>Por grupo económico, no por RUT. ' + mil(g.grupos.length) +
           ' grupos sostienen el ' + pct1(g.juntos, g.base) + ' del pallet atribuido en retail.</p>');
    H.push('  <div class="panel">\n    <div class="scroll"><table class="t-g">');
    H.push('      <thead><tr><th>Grupo</th><th class="num">Nivel</th><th class="bar"></th>' +
           '<th class="num">Participación</th></tr></thead>');
    const tope = Math.max(1, ...g.grupos.map(x => x.nivel));
    H.push('      <tbody>' + g.grupos.map(x =>
      '<tr><td class="nom">' + esc(x.nom) + '</td><td class="num">' + mil(x.nivel) +
      '</td><td class="bar"><span style="width:' + ((x.nivel / tope) * 100).toFixed(2) +
      '%"></span></td><td class="num">' + pct1(x.nivel, g.base) + '</td></tr>').join('') + '</tbody>');
    H.push('    </table></div>');
    H.push('    <p class="sub">Las barras van solo acá: entre los grupos el rango es comparable y la ' +
           'barra informa. En las tablas de socios, con el primero en ' + mil(d.retail[0] ? d.retail[0].nivel : 0) +
           ', la cola quedaba en marcas invisibles.<br>El denominador es el pallet atribuido (' +
           mil(g.base) + '), no el saldo de la bodega: el residuo sin ubicación no se le puede ' +
           'asignar a ningún grupo. La agrupación por holding es nuestra y está pendiente de ' +
           'confirmación comercial.</p>\n  </div>\n</section>\n');
  }

  // ── planta ──
  H.push('<section>\n  <h2>Planta REDTEC</h2>');
  H.push('  <p>El stock en planta es chico al lado de lo que está afuera, pero el flujo que lo ' +
         'atraviesa no lo es: cada estación procesa cientos de miles de pallets al año para ' +
         'sostener un par de miles en cualquier momento dado.</p>');
  H.push('  <div class="dos" style="margin-top:14px">');
  H.push('    <div class="panel">\n      <h3>Saldo por bodega</h3>\n      <div class="scroll"><table>');
  H.push('        <thead><tr><th>Código</th><th>Bodega</th><th class="num">Saldo</th></tr></thead>');
  H.push('        <tbody>' + d.planta.map(p =>
    '<tr><td class="cod">' + esc(p.cod) + '</td><td class="nom">' + esc(p.nom) +
    (p.nueve ? '' : ' <span class="chip">fuera del indicador</span>') +
    '</td><td class="num">' + mil(p.nivel) + '</td></tr>').join('') + '</tbody>');
  H.push('      </table></div>\n    </div>');

  // El flujo por bodega todavia no lo produce la cadena diaria: viene de
  // tablero-extra.json con su propia fecha. Si no esta, no se dibuja — una
  // cifra de hace un mes presentada como de hoy es peor que un hueco.
  if (d.flujo && d.flujo.length) {
    H.push('    <div class="panel">\n      <h3>Flujo del año por bodega</h3>\n      <div class="scroll"><table>');
    H.push('        <thead><tr><th>Código</th><th>Bodega</th><th class="num">Entradas</th>' +
           '<th class="num">Salidas</th><th class="num">Neto</th></tr></thead>');
    H.push('        <tbody>' + d.flujo.map(f => {
      const [cod, nom, ent, sal] = f;
      const neto = (Number(ent) || 0) - (Number(sal) || 0);
      return '<tr><td class="cod">' + esc(cod) + '</td><td class="nom">' + esc(nom) +
             '</td><td class="num">' + mil(ent) + '</td><td class="num">' + mil(sal) +
             '</td><td class="num ' + clasePos(neto) + '">' + conSigno(neto) + '</td></tr>';
    }).join('') + '</tbody>');
    H.push('      </table></div>');
    H.push('      <p class="sub">Medido al ' + esc(d.extra_medido || 'sin fecha') +
           '. Esta tabla todavía no se recalcula sola: es la única del tablero que no viene de la ' +
           'corrida de hoy.</p>\n    </div>');
  }
  H.push('  </div>\n</section>\n');

  // ── que sostiene estas cifras ──
  H.push('<section>\n  <h2>Qué sostiene estas cifras</h2>\n  <div class="dos" style="margin-top:14px">');
  H.push('    <div class="panel">\n      <h3>De dónde sale cada número</h3>\n      <dl>');
  H.push('        <dt>Saldo por bodega</dt><dd>SAP B1 Service Layer, ' +
         '<code class="campo">ItemWarehouseInfoCollection.InStock</code>. Es el saldo que SAP ya ' +
         'tiene calculado, sin acumular series.</dd>');
  H.push('        <dt>Nivel por socio</dt><dd>Serie de movimientos por ubicación extraída de SAP, ' +
         'repartida con el maestro de ubicaciones. El total lo dicta la bodega; la ubicación sólo ' +
         'lo reparte.</dd>');
  H.push('        <dt>Flujo mensual</dt><dd>Diario de movimientos de inventario (OINM), agrupado ' +
         'por mes de fecha de documento.</dd>');
  H.push('        <dt>Residuo</dt><dd>Saldo de bodega menos suma de los socios. No es un error de ' +
         'cálculo ni pallet perdido: son dos ubicaciones de SAP que existen justamente para el ' +
         'pallet que no tiene dueño identificado.</dd>');
  H.push('      </dl>\n    </div>');
  if (d.controles && d.controles.length) {
    // "Controles que paso" era el titulo. Un panel que solo sabe decir que todo
    // paso miente el dia que algo deja de pasar, y ese dia llego: la
    // conservacion del pool se rompio el 27-10. Cada control dice si pasa.
    H.push('    <div class="panel">\n      <h3>Controles</h3>\n      <dl>');
    // Cada control con SU fecha, no una sola para todos. Se habian mezclado
    // controles medidos en dias distintos bajo un unico "medidos al ...", y eso
    // envejece mal: el que se recalcula todos los dias se lee tan viejo como el
    // que no se toca hace una semana, o al reves.
    for (const c of d.controles) {
      const malo = c.estado === 'no pasa';
      H.push('        <dt' + (malo ? ' class="malo"' : '') + '>' + esc(c.titulo) +
             (malo ? ' · NO PASA' : '') + '</dt><dd>' + esc(c.texto) +
             ' <span class="fecha">medido el ' + esc(c.medido || d.extra_medido || 'sin fecha') +
             '</span></dd>');
    }
    H.push('      </dl>\n    </div>');
  }
  H.push('  </div>\n');

  // El aviso sale del dato de hoy: si el residuo baja, el aviso baja con el.
  const rr = b.RETAIL.residuo;
  if (rr > 0) {
    H.push('  <div class="aviso">\n    <h3>Lo que falta resolver</h3>');
    H.push('    <p><b>' + mil(rr) + ' pallets de BODEGA RETAILERS sin retailer identificado</b> (' +
           pct1(rr, b.RETAIL.nivel) + ' del retail). No están perdidos ni mal registrados: SAP los ' +
           'tiene en ubicaciones que existen para eso.</p>');
    // El desglose viene del dato medido, con su fecha, no de una explicacion
    // escrita a mano: si manana cambia el reparto, cambia el texto.
    if (d.residuo_detalle && d.residuo_detalle.length) {
      H.push('    <dl style="margin:8px 0">');
      for (const x of d.residuo_detalle)
        H.push('      <dt>' + mil(x.cantidad) + '</dt><dd>' + esc(x.que) +
               ' <span class="fecha">medido el ' + esc(x.medido || d.extra_medido || 'sin fecha') +
               '</span></dd>');
      H.push('    </dl>');
      // EL DESGLOSE NO SE RECALCULA SOLO y el residuo si. El dia que dejen de
      // sumar lo mismo, el lector ve dos numeros que no cuadran y no sabe cual
      // creer. Se dice aca, con la resta hecha, antes de que lo note el.
      const sd = d.residuo_detalle.reduce((a, x) => a + Number(x.cantidad), 0);
      if (sd !== rr)
        H.push('    <p>El desglose suma <b>' + mil(sd) + '</b> y el residuo de hoy es <b>' +
               mil(rr) + '</b>: ' + conSigno(rr - sd) + ' de diferencia. El desglose se midió ' +
               'aparte y la corrida diaria no lo rehace, así que el reparto que se ve es el de ' +
               'su fecha, no el de hoy.</p>');
    }
    if (d.aviso_nota) H.push('    <p style="margin-bottom:0">' + esc(d.aviso_nota) + '</p>');
    H.push('\n  </div>');
  }
  // Un descalce entre la sonda y el ancla no se esconde: invalida la pagina.
  if (d.descalces && d.descalces.length) {
    H.push('  <div class="aviso">\n    <h3>Lecturas que no coinciden</h3>');
    for (const t of d.descalces) H.push('    <p>' + esc(t) + '</p>');
    H.push('    <p style="margin-bottom:0">Las dos lecturas se tomaron en momentos distintos. ' +
           'Mientras esto aparezca, los niveles por socio no cuadran con el saldo de bodega.</p>\n  </div>');
  }
  H.push('</section>\n');

  H.push('<footer>\n  Extracción propia M3DATA desde SAP B1 · base CLPRDREDTEC · saldos al ' +
         esc(v.nivel) + (v.flujo_hasta ? ',\n  flujos del ' + esc(v.flujo_desde) + ' al ' +
         esc(v.flujo_hasta) + '.' : '.') +
         '\n  Saldo de bodega leído de SAP el ' + esc(String(d.generado).slice(0, 16).replace('T', ' ')) +
         ' UTC.\n  Página armada por scripts/armar-tablero-stock.js: ninguna cifra está escrita a mano.' +
         '\n</footer>\n');
  // El unico javascript de la pagina. Se embebe la MISMA funcion que esta
  // probada en el test —no una copia escrita a mano para el navegador— para
  // que no puedan divergir: toString() publica el codigo tal cual.
  H.push('<script>\n' + antiguedad.toString() + '\n' + [
    '(function () {',
    '  try {',
    '    var s = document.querySelector(".sello[data-medido]");',
    '    var c = document.getElementById("rancio");',
    '    if (!s || !c) return;',
    '    var d = new Date();',
    '    var hoy = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +',
    '              "-" + String(d.getDate()).padStart(2, "0");',
    '    var a = antiguedad(s.getAttribute("data-medido"), hoy);',
    '    if (!a.texto) return;',
    '    c.textContent = a.texto;',
    '    c.setAttribute("data-nivel", a.nivel);',
    '    c.hidden = false;',
    '  } catch (e) { /* sin aviso es mejor que sin pagina */ }',
    '})();',
  ].join('\n') + '\n<\/script>');
  H.push('</div>\n</body>\n</html>\n');
  return H.join('\n');
}

// ── opciones y main ──────────────────────────────────────────────────────────
function opcion(nombre, porDefecto, argv) {
  const args = argv || process.argv.slice(2);
  const pre = '--' + nombre + '=';
  for (const a of args) if (a.startsWith(pre)) return a.slice(pre.length);
  return porDefecto;
}
function opcionesRaras(argv) {
  const args = argv || process.argv.slice(2);
  return args.filter(a => {
    const m = /^--([^=]+)=/.exec(a);
    return !m || !OPCIONES.includes(m[1]);
  });
}
function leerJson(ruta, obligatorio) {
  const fs = require('fs');
  if (!fs.existsSync(ruta)) {
    if (obligatorio) { console.error('No existe el archivo de entrada: ' + ruta); process.exit(1); }
    return null;
  }
  try { return JSON.parse(sinBom(fs.readFileSync(ruta, 'utf8'))); }
  catch (e) { console.error('No se pudo leer ' + ruta + ': ' + e.message); process.exit(1); }
}

function main() {
  const raras = opcionesRaras();
  if (raras.length) {
    console.error('Opciones que no conozco: ' + raras.join(' '));
    console.error('Las que acepto: ' + OPCIONES.map(o => '--' + o + '=').join(' '));
    process.exit(1);
  }
  const rBod = opcion('bodegas', 'data/bodegas-hoy.json');
  const rRet = opcion('retail', 'data/stock-retail.json');
  const rCli = opcion('clientes', 'data/stock-clientes.json');
  const rExt = opcion('extra', 'data/tablero-extra.json');
  const rDat = opcion('datos', 'data/datos-stock.json');
  const rSal = opcion('salida', 'stock-flujos-pallets.html');

  const bod = leerJson(rBod, true), ret = leerJson(rRet, true), cli = leerJson(rCli, true);
  const ext = leerJson(rExt, false);
  if (!ext) console.error('Aviso: no hay ' + rExt + '. Las secciones que dependen de el no se dibujan.');

  const d = datos(bod, ret, cli, ext);
  const fs = require('fs');
  fs.writeFileSync(rDat, JSON.stringify(d, null, 1) + '\n', { encoding: 'utf8' });
  fs.writeFileSync(rSal, pagina(d), { encoding: 'utf8' });

  console.log('Tablero armado.');
  console.log('  pool ' + mil(d.pool) + '  =  clientes ' + mil(d.bodegas.CLIENTES.nivel) +
              ' + retail ' + mil(d.bodegas.RETAIL.nivel) + ' + planta ' + mil(d.bodegas.PLANTA.nivel));
  console.log('  socios con saldo: retail ' + d.bodegas.RETAIL.n + ', clientes ' + d.bodegas.CLIENTES.n);
  console.log('  año: retail ' + conSigno(d.anio.ret) + ', clientes ' + conSigno(d.anio.cli));
  console.log('  ' + rDat);
  console.log('  ' + rSal);
  if (d.descalces.length) {
    for (const t of d.descalces) console.error('  DESCALCE · ' + t);
    process.exit(1);   // el tablero queda escrito, pero el workflow tiene que verlo rojo
  }
}

module.exports = { esNumero, mil, conSigno, clasePos, pct, pct1, esc, sinBom,
                   NUEVE, GRUPOS, MESES, OPCIONES,
                   clasificarPool, cortarSocios, porGrupo, mesesPareados, datos,
                   antiguedad, svgPool, svgMeses, filaSocio, tablaSocios, notaImposibles, pagina,
                   opcion, opcionesRaras, leerJson, CSS };

if (require.main === module) main();
