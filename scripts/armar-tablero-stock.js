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

const OPCIONES = ['bodegas', 'retail', 'clientes', 'extra', 'planta', 'datos', 'salida'];

// ── las nueve bodegas del indicador de planta ────────────────────────────────
// Enrique definio nueve estaciones como "planta" para el indicador. MERMA,
// EXTRAÑOS y los TRANSITO estan en el pool pero fuera del indicador, y esa
// distincion no la trae SAP: es una decision de negocio y por eso esta
// declarada aca y no deducida.
const NUEVE = new Set(['RT13-100', 'RT13-102', 'RT13-103', 'RT13-105',
                       'RT07-120', 'RT07-122', 'RT07-123', 'RT07-125', 'RT07-126']);

/*  LA DISTRIBUCION DIARIA DE PLANTA, entrada OPCIONAL.
 *
 *  Viene de saldo-planta.js --json. Se lee con el mismo trato que
 *  tablero-extra.json: si no esta, la seccion no se dibuja y el tablero sale
 *  igual. Un paso que falla no puede dejar la pagina de gerencia a medias.
 *
 *  SOLO LAS NUEVE. Merma, extraños y los transito estan en el pool pero fuera
 *  del indicador, y para leer como se disponibiliza el pallet no aportan: su
 *  nivel no se mueve por el recorrido, se mueve porque alguien declara una
 *  merma. Decision de Mauro el 30-10-2026. Se filtra por NUEVE, que es la
 *  misma regla que ya reparte el saldo de planta mas arriba: una regla, un
 *  lugar. */
function serieDePlanta(planta) {
  const p = planta || {};
  const out = [];
  for (const b of (Array.isArray(p.bodegas) ? p.bodegas : [])) {
    if (!b || !b.whs || !NUEVE.has(String(b.whs).trim())) continue;
    const dias = [];
    for (const d of (Array.isArray(b.dias) ? b.dias : [])) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.dia))) continue;
      dias.push({ dia: String(d.dia), apertura: Number(d.apertura) || 0,
                  entradas: Number(d.entradas) || 0, salidas: Number(d.salidas) || 0,
                  cierre: Number(d.cierre) || 0, firme: d.firme !== false });
    }
    dias.sort((x, y) => x.dia < y.dia ? -1 : x.dia > y.dia ? 1 : 0);
    if (!dias.length) continue;      // una bodega sin dias no es una fila vacia: no va
    out.push({ cod: String(b.whs).trim(), nom: String(b.nombre || b.whs),
               nivel: Number(b.nivel) || 0, dias });
  }
  // El orden del recorrido del pallet, no el alfabetico: inspeccion primero,
  // disponible al final. Alfabetico pondria DISPONIBLE antes que INSPECCION.
  const ETAPAS = ['INSPECCION', 'LAVADO', 'DESARME', 'REPARACION', 'PINTURA', 'DISPONIBLE', 'TRANSITO'];
  const orden = n => {
    const u = String(n).toUpperCase();
    for (let i = 0; i < ETAPAS.length; i++) if (u.indexOf(ETAPAS[i]) >= 0) return i;
    return ETAPAS.length;
  };
  return out.sort((a, b) => orden(a.nom) - orden(b.nom) ||
                            (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0));
}

/*  EL ANCLA DE LA SERIE Y LA DEL TABLERO TIENEN QUE SER LA MISMA.
 *
 *  saldo-planta calcula hacia atras desde el saldo vivo de SAP. Si ese json se
 *  armo con un ancla distinta de la que esta mirando el tablero, los cierres
 *  diarios no son los mismos numeros que el saldo por bodega de mas arriba, y
 *  la pagina se contradice sola. Dentro de cierre-diario.ps1 esto no puede
 *  pasar —el paso del ancla precede— pero una corrida a mano si puede. */
function anclaCalza(planta, bodegasHoy) {
  const a = String((planta && planta.ancla) || '').slice(0, 10);
  const b = String((bodegasHoy && bodegasHoy.generado) || '').slice(0, 10);
  const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (!fecha(a) || !fecha(b))
    return { ok: false, motivo: 'no se puede comparar el ancla: ' +
             (fecha(a) ? 'el tablero no trae fecha' : 'la serie de planta no trae ancla') };
  if (a !== b)
    return { ok: false, ancla: a, tablero: b,
             motivo: 'la serie de planta se ancló el ' + a + ' y el tablero el ' + b +
                     ': los cierres diarios no serían los mismos números que el saldo por bodega' };
  /*  QUE LAS DOS FECHAS COINCIDAN NO BASTA.
   *
   *  saldo-planta puede haber calculado la serie con un ancla mas vieja que
   *  las lineas que leyo —pasa si se corre a mano, fuera del cierre diario— y
   *  en ese caso TODA la serie queda corrida aunque el json y el tablero
   *  declaren la misma fecha, porque los dos salen del mismo bodegas-hoy.
   *  Por eso saldo-planta escribe su propio veredicto en ancla_al_dia y aca
   *  se exige. Si el campo no viene, el json es de una version que no lo
   *  declaraba: tampoco se dibuja. Fallar cerrado. */
  if (planta.ancla_al_dia !== true)
    return { ok: false,
             motivo: 'la serie de planta no viene declarada al dia (' +
                     (planta.ancla_al_dia === false
                        ? 'saldo-planta la marcó como corrida'
                        : 'el json no trae ancla_al_dia') +
                     '): habría que volver a anclar y recalcularla' };
  return { ok: true, motivo: null };
}

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
  /*  LAS DEL INDICADOR PRIMERO, DESPUES LAS DE REFERENCIA.
   *
   *  Mezcladas por saldo, MERMA sale tercera y se lee como una estacion mas
   *  del recorrido. Son dos bloques distintos —uno suma al pool y el otro
   *  no— y el orden tiene que decirlo antes que la letra chica. */
  dePlanta.sort((a, b) => (a.nueve === b.nueve ? 0 : a.nueve ? -1 : 1) ||
                          b.nivel - a.nivel || (a.cod < b.cod ? -1 : 1));
  /*  DOS TOTALES, Y LOS DOS SE DECLARAN.
   *
   *  total es lo que SAP tiene en bodega y sirve para cuadrar contra SAP.
   *  rotacion es el pool de verdad: merma, extraños y el transito que no es
   *  del indicador estan en una bodega de SAP pero no son pallet que rote,
   *  y sumarlos infla el pool. Decision de Mauro el 30-10-2026: el indicador
   *  de planta son las nueve y lo demas se muestra, no se suma. */
  return { clientes, retail, planta, nueve, fuera, filas: dePlanta,
           bodegas: filas.length,
           total: clientes + retail + planta,
           rotacion: clientes + retail + nueve };
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
function datos(bod, ret, cli, extra, planta) {
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
    // EL TITULAR ES EL POOL EN ROTACION, no lo que SAP tiene en bodega. Los
    // dos viajan: pool_sap queda para poder cuadrar contra SAP y para que la
    // pagina pueda decir de donde sale la diferencia.
    pool: fl.rotacion,
    pool_sap: fl.total,
    fuera_del_pool: fl.fuera,
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
      // El nivel de planta ES el indicador. Lo que esta fuera se declara
      // aparte y lo que SAP tiene en esas bodegas tambien, pero no suman.
      PLANTA:   { nivel: fl.nueve, fuera: fl.fuera, sap: fl.planta },
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
    // Una nota puede estar en verificacion o ya resuelta. Mientras la unica
    // forma de poner una nota fue gritar "En verificacion", la nota que
    // informa un resultado ya establecido tenia que salir con una alarma que
    // ya no corresponde, o no salir.
    mensual_verificado: !!(extra && extra.mensual_verificado),
    extra_medido: (extra && extra.medido) || null,
    // La distribucion diaria de planta. null cuando el paso no corrio: la
    // seccion no se dibuja y el resto del tablero sale igual.
    planta_dias: planta ? serieDePlanta(planta) : null,
    planta_ancla: (planta && planta.ancla) || null,
    planta_meses: (planta && Array.isArray(planta.meses)) ? planta.meses : null,
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


// ── la distribucion diaria de planta: el bloque visible ──────────────────────

/*  EL SELECTOR SE AGRUPA POR PLANTA; LA SERIE SE ORDENA POR RECORRIDO.
 *
 *  serieDePlanta() ordena por el recorrido del pallet —inspeccion primero,
 *  disponible al final— y eso es lo correcto para LEER la cadena, pero deja
 *  Talca y Santiago intercalados. Quien abre el selector no busca "la etapa
 *  reparacion": busca "la reparacion de Talca". Asi que el selector agrupa por
 *  planta y DENTRO de cada planta respeta el recorrido. Son dos ordenes con
 *  dos trabajos distintos y por eso son dos funciones distintas.
 *
 *  La planta sale del primer token del nombre de SAP ("SANTIAGO INSPECCION").
 *  No hay campo de planta en SAP: el codigo de bodega lleva el recinto (RT13,
 *  RT07) pero esa correspondencia no esta declarada en ninguna parte, y
 *  deducirla seria inventar. El nombre si lo dice. */
function plantaDeBodega(nom) {
  // El separador puede ser un tabulador y no un espacio: los nombres se
  // escriben a mano en SAP. Se normaliza antes de cortar.
  const u = String(nom == null ? '' : nom).trim().toUpperCase().replace(/\s+/g, ' ');
  return u.split(' ')[0] || 'SIN PLANTA';
}

function gruposDeSerie(serie) {
  const filas = Array.isArray(serie) ? serie : [];
  const orden = [], porPlanta = {};
  for (const b of filas) {
    if (!b) continue;
    const p = plantaDeBodega(b.nom);
    if (!porPlanta[p]) { porPlanta[p] = { planta: p, nivel: 0, bodegas: [] }; orden.push(p); }
    porPlanta[p].bodegas.push(b);
    porPlanta[p].nivel += Number(b.nivel) || 0;
  }
  // La planta mas grande primero —Santiago sostiene el grueso del stock y es
  // la que se mira— y a igual nivel, alfabetico, para que el orden no dependa
  // del orden en que SAP devolvio las bodegas.
  return orden.map(p => porPlanta[p])
              .sort((a, b) => b.nivel - a.nivel ||
                              (a.planta < b.planta ? -1 : a.planta > b.planta ? 1 : 0));
}

function etiquetaDeMes(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes == null ? '' : mes));
  if (!m) return String(mes == null ? '' : mes);
  return (MESES[Number(m[2]) - 1] || m[2]) + ' ' + m[1];
}

/*  LOS MESES SALEN DE LOS DIAS QUE HAY, NO DE planta.meses.
 *
 *  saldo-planta declara que meses se le pidieron; esto declara de que meses
 *  hay dias dibujables. Si un mes se pidio y vino vacio —falta su blob de
 *  lineas— el selector no puede ofrecerlo. */
function mesesDeSerie(serie) {
  const vistos = {}, out = [];
  for (const b of (Array.isArray(serie) ? serie : []))
    for (const d of ((b && b.dias) || [])) {
      const m = String(d.dia).slice(0, 7);
      if (!vistos[m]) { vistos[m] = true; out.push(m); }
    }
  return out.sort().map(m => ({ mes: m, etiqueta: etiquetaDeMes(m) }));
}

function diasDelMes(bodega, mes) {
  const p = String(mes == null ? '' : mes);
  return (((bodega && bodega.dias) || [])).filter(d => d && String(d.dia).slice(0, 7) === p);
}

/*  EL NETO DEL MES SE CALCULA DOS VECES A PROPOSITO.
 *
 *  Una vez como cierre menos apertura y otra como entradas menos salidas. Son
 *  el mismo numero por construccion, asi que si no coinciden el json esta
 *  roto, y la pagina prefiere decirlo a mostrar un cuadro que no cuadra. */
function resumenDelMes(dias) {
  const ds = Array.isArray(dias) ? dias : [];
  if (!ds.length) return null;
  let entradas = 0, salidas = 0, negativos = 0, peor = null, enCurso = false;
  for (const d of ds) {
    entradas += Number(d.entradas) || 0;
    salidas += Number(d.salidas) || 0;
    const c = Number(d.cierre) || 0;
    if (c < 0) { negativos++; if (!peor || c < peor.cierre) peor = { dia: String(d.dia), cierre: c }; }
    if (d.firme === false) enCurso = true;
  }
  const apertura = Number(ds[0].apertura) || 0;
  const cierre = Number(ds[ds.length - 1].cierre) || 0;
  return { n: ds.length, desde: String(ds[0].dia), hasta: String(ds[ds.length - 1].dia),
           apertura, cierre, entradas, salidas,
           neto: cierre - apertura, netoFlujo: entradas - salidas,
           cuadra: (cierre - apertura) === (entradas - salidas),
           negativos, peor, enCurso };
}

/*  DOS GRAFICOS, NO UNO CON DOS ESCALAS.
 *
 *  El flujo del dia (entradas, salidas) es un caudal y el nivel al cierre es
 *  un stock. Superponerlos obliga a dos ejes verticales, y con dos ejes uno
 *  elige la escala que le conviene y el grafico dice lo que uno quiera. Van
 *  separados, uno debajo del otro, compartiendo el eje de dias.
 *
 *  Columnas y no linea: la serie tiene huecos —no hay sabado ni domingo— y
 *  una linea los dibujaria como si el nivel hubiera pasado por ahi. */
/*  UNA BARRA DE CERO PIXELES MIENTE.
 *
 *  Con un dia en -6.151 fijando la escala, un cierre de -6 sale de 0,1 px:
 *  se ve igual que un dia sin dato. Un valor que existe se dibuja con un
 *  minimo visible; el cero exacto se dibuja en cero, que es lo que
 *  corresponde. El numero exacto siempre esta en la tabla y en el tooltip. */
function altoVisible(h, v) {
  if (!v) return 0;
  return Math.max(1.6, h);
}

function ejeDeDias(ds, An, izq, der, Al) {
  const slot = (An - izq - der) / Math.max(1, ds.length);
  // Con muchos dias las etiquetas se pisan: se rotula uno de cada n, y
  // siempre el primero, para que el lector sepa donde empieza el mes.
  const salto = slot >= 26 ? 1 : slot >= 15 ? 2 : slot >= 10 ? 3 : 5;
  let t = '';
  ds.forEach((d, i) => {
    if (i % salto) return;
    t += '<text class="ax" x="' + (izq + i * slot + slot / 2).toFixed(1) + '" y="' + (Al - 7) +
         '" text-anchor="middle">' + esc(String(d.dia).slice(8)) + '</text>';
  });
  return { slot, etiquetas: t };
}

function svgFlujoDia(dias) {
  const ds = Array.isArray(dias) ? dias : [];
  if (!ds.length) return '';
  const An = 760, izq = 52, der = 8, arriba = 12, abajo = 26, mitad = 84;
  const Al = arriba + mitad * 2 + abajo, y0 = arriba + mitad;
  const tope = Math.max(1, ...ds.map(d => Math.max(Number(d.entradas) || 0, Number(d.salidas) || 0)));
  const esc_ = mitad / tope;
  const { slot, etiquetas } = ejeDeDias(ds, An, izq, der, Al);
  const ancho = Math.max(2.5, Math.min(26, slot / 2 - 1.5));   // 1,5px de aire entre las dos barras

  let g = '';
  const linea = (v, y, txt) => '<line class="grid" x1="' + izq + '" y1="' + y.toFixed(1) +
    '" x2="' + (An - der) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (izq - 8) +
    '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(txt) + '</text>';
  g += linea(tope, arriba, mil(tope));
  g += linea(0, y0, '0');
  g += linea(tope, y0 + mitad, mil(tope));

  ds.forEach((d, i) => {
    const x = izq + i * slot + (slot - (2 * ancho + 1.5)) / 2;
    const ent = Number(d.entradas) || 0, sal = Number(d.salidas) || 0;
    const he = altoVisible(ent * esc_, ent), hs = altoVisible(sal * esc_, sal);
    g += '<rect class="b-ent" x="' + x.toFixed(1) + '" y="' + (y0 - he).toFixed(1) +
         '" width="' + ancho.toFixed(1) + '" height="' + he.toFixed(1) + '" rx="2">' +
         '<title>' + esc(d.dia) + ' · entradas ' + mil(ent) + '</title></rect>';
    g += '<rect class="b-sal" x="' + (x + ancho + 1.5).toFixed(1) + '" y="' + y0.toFixed(1) +
         '" width="' + ancho.toFixed(1) + '" height="' + hs.toFixed(1) + '" rx="2">' +
         '<title>' + esc(d.dia) + ' · salidas ' + mil(sal) + '</title></rect>';
  });
  return '<svg viewBox="0 0 ' + An + ' ' + Al + '" role="img" ' +
         'aria-label="Entradas y salidas por dia">' + g + etiquetas + '</svg>';
}

function svgNivelDia(dias) {
  const ds = Array.isArray(dias) ? dias : [];
  if (!ds.length) return '';
  const An = 760, izq = 52, der = 8, arriba = 12, abajo = 26, util = 116;
  const Al = arriba + util + abajo;
  const vals = ds.map(d => Number(d.cierre) || 0);
  // El cero SIEMPRE entra en la escala: es la frontera entre un nivel posible
  // y uno imposible, y es justo lo que hay que poder ver.
  const alto = Math.max(0, ...vals), bajo = Math.min(0, ...vals);
  const rango = (alto - bajo) || 1, esc_ = util / rango;
  const y0 = arriba + alto * esc_;
  const { slot, etiquetas } = ejeDeDias(ds, An, izq, der, Al);
  const ancho = Math.max(2.5, Math.min(48, slot - 3));

  let g = '';
  const linea = (v, cl) => {
    const y = arriba + (alto - v) * esc_;
    return '<line class="' + cl + '" x1="' + izq + '" y1="' + y.toFixed(1) + '" x2="' + (An - der) +
           '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (izq - 8) + '" y="' +
           (y + 4).toFixed(1) + '" text-anchor="end">' + esc(mil(v)) + '</text>';
  };
  if (alto > 0) g += linea(alto, 'grid');
  if (bajo < 0) g += linea(bajo, 'grid');
  g += linea(0, 'cero');

  ds.forEach((d, i) => {
    const v = Number(d.cierre) || 0, h = altoVisible(Math.abs(v) * esc_, v);
    const x = izq + i * slot + (slot - ancho) / 2;
    g += '<rect class="' + (v < 0 ? 'n-neg' : 'n-pos') + '" x="' + x.toFixed(1) + '" y="' +
         (v >= 0 ? y0 - h : y0).toFixed(1) + '" width="' + ancho.toFixed(1) + '" height="' +
         h.toFixed(1) + '" rx="2">' + '<title>' + esc(d.dia) + ' · cierre ' + mil(v) +
         (d.firme === false ? ' (dia en curso)' : '') + '</title></rect>';
  });
  return '<svg viewBox="0 0 ' + An + ' ' + Al + '" role="img" ' +
         'aria-label="Nivel al cierre de cada dia">' + g + etiquetas + '</svg>';
}

function tablaDeDias(dias) {
  const ds = Array.isArray(dias) ? dias : [];
  let f = '';
  for (const d of ds) {
    const neto = (Number(d.entradas) || 0) - (Number(d.salidas) || 0);
    const c = Number(d.cierre) || 0;
    f += '<tr><td class="cod">' + esc(d.dia) +
         (d.firme === false ? ' <span class="chip">en curso</span>' : '') +
         '</td><td class="num">' + mil(d.apertura) + '</td><td class="num">' + mil(d.entradas) +
         '</td><td class="num">' + mil(d.salidas) + '</td><td class="num ' + clasePos(neto) + '">' +
         conSigno(neto) + '</td><td class="num' + (c < 0 ? ' malo' : '') + '">' + mil(c) +
         '</td></tr>';
  }
  return '<div class="scroll"><table>\n' +
    '<thead><tr><th>Día</th><th class="num">Apertura</th><th class="num">Entradas</th>' +
    '<th class="num">Salidas</th><th class="num">Neto</th><th class="num">Cierre</th></tr></thead>\n' +
    '<tbody>' + f + '</tbody></table></div>';
}

/*  EL PANEL DE UNA BODEGA EN UN MES.
 *
 *  Esta funcion corre en los dos lados: el script la usa para dejar escrito el
 *  panel por defecto —asi la pagina sirve sin javascript— y el navegador la
 *  usa tal cual, publicada con toString(), para los otros. Es la misma
 *  funcion, no una copia: no pueden divergir. */
function panelDeMes(bodega, mes) {
  if (!bodega) return '<p class="sub">No hay datos de esa bodega.</p>';
  const ds = diasDelMes(bodega, mes);
  const r = resumenDelMes(ds);
  const titulo = '<h3>' + esc(bodega.nom) + ' <span class="cod">' + esc(bodega.cod) + '</span></h3>';
  if (!r)
    return titulo + '<p class="sub">Sin movimiento registrado en ' + esc(etiquetaDeMes(mes)) +
           '. El saldo de la bodega no cambió ningún día de ese mes, o ese mes no entró en la corrida.</p>';

  const H = [titulo];
  H.push('<div class="sub">' + esc(etiquetaDeMes(mes)) + ' · ' + mil(r.n) + ' día' +
         (r.n === 1 ? '' : 's') + ' con movimiento, del ' + esc(r.desde) + ' al ' + esc(r.hasta) +
         '</div>');
  H.push('<div class="rejilla rejilla-4">');
  for (const [et, val, pie, cl] of [
    ['Apertura', mil(r.apertura), 'con lo que abrió el ' + r.desde, r.apertura < 0 ? 't-mal' : ''],
    ['Entradas', mil(r.entradas), 'pallets que llegaron en el mes', 't-ent'],
    ['Salidas', mil(r.salidas), 'pallets que se fueron en el mes', 't-sal'],
    ['Cierre', mil(r.cierre), 'con lo que cerró el ' + r.hasta +
      (r.enCurso ? ' (día en curso)' : ''), r.cierre < 0 ? 't-mal' : ''],
  ])
    H.push('<div class="panel tile' + (cl ? ' ' + cl : '') + '"><div class="et">' + et + '</div><div class="big">' +
           val + '</div><div class="pie">' + esc(pie) + '</div></div>');
  H.push('</div>');
  H.push('<p class="sub">Movió <b class="' + clasePos(r.neto) + '">' + conSigno(r.neto) +
         '</b> en el mes' + (r.cuadra ? '' : ' — pero entradas menos salidas da ' +
         conSigno(r.netoFlujo) + ', y cierre menos apertura da ' + conSigno(r.neto) +
         ': el json viene roto y este panel no se puede leer') + '.</p>');

  H.push('<h4>Entradas y salidas de cada día</h4>');
  H.push('<div class="leyenda" style="margin:0 0 8px">' +
         '<span><i class="pt p-ent"></i>Entradas <b>' + mil(r.entradas) + '</b> en el mes</span>' +
         '<span><i class="pt p-sal"></i>Salidas <b>' + mil(r.salidas) + '</b> en el mes</span></div>');
  H.push('<div class="scroll grafdia">' + svgFlujoDia(ds) + '</div>');

  H.push('<h4>Nivel con el que cerró cada día</h4>');
  H.push('<div class="scroll grafdia">' + svgNivelDia(ds) + '</div>');
  if (r.negativos)
    H.push('<div class="enrevision"><b>' + mil(r.negativos) + ' de los ' + mil(r.n) +
           ' días cierran en negativo</b>, el peor el ' + esc(r.peor.dia) + ' en ' +
           mil(r.peor.cierre) + '. No es un error del cálculo: SAP tiene esos días en negativo ' +
           'y la causa es la fecha del documento —la salida de mercancías queda fechada antes ' +
           'que el traspaso que la alimenta—. Se arregla en SAP, no acá.</div>');

  H.push('<h4>Día por día</h4>');
  H.push(tablaDeDias(ds));
  return H.join('\n');
}

function bloqueDePlanta(d) {
  const serie = (d && d.planta_dias) || null;
  const grupos = gruposDeSerie(serie);
  const meses = mesesDeSerie(serie);
  // Sin un solo dia dibujable no hay bloque: un selector sin nada que mostrar
  // es peor que no tener seccion. Esta guarda cubre tambien el caso de que no
  // venga la serie, porque sin serie tampoco hay meses.
  if (!meses.length) return '';
  // Por defecto, el mes mas reciente y la primera bodega del recorrido de la
  // planta mas grande: donde entra el pallet.
  const mes0 = meses[meses.length - 1].mes;
  const bod0 = grupos[0].bodegas[0];

  const H = [];
  H.push('<section>\n  <h2>Distribución diaria en planta</h2>');
  H.push('  <p>Cómo se mueve cada estación día por día: con qué nivel abrió, cuánto entró, ' +
         'cuánto salió y con qué nivel cerró. Son las ' + mil(serie.length) + ' bodegas del ' +
         'indicador: merma, extraños y los tránsito están en el pool pero su nivel no lo mueve ' +
         'el recorrido del pallet.</p>');
  H.push('  <div class="panel">');
  H.push('    <div class="filtros">');
  H.push('      <label for="pd-bod">Bodega<select id="pd-bod">');
  for (const g of grupos) {
    H.push('        <optgroup label="' + esc(g.planta) + '">');
    for (const b of g.bodegas)
      H.push('          <option value="' + esc(b.cod) + '"' + (b.cod === bod0.cod ? ' selected' : '') +
             '>' + esc(b.nom) + ' · ' + esc(b.cod) + '</option>');
    H.push('        </optgroup>');
  }
  H.push('      </select></label>');
  H.push('      <label for="pd-mes">Mes<select id="pd-mes">');
  for (const m of meses)
    H.push('        <option value="' + esc(m.mes) + '"' + (m.mes === mes0 ? ' selected' : '') +
           '>' + esc(m.etiqueta) + '</option>');
  H.push('      </select></label>');
  H.push('    </div>');
  // El panel por defecto va escrito: la pagina tiene que servir sin javascript.
  H.push('    <div id="pd-panel">' + panelDeMes(bod0, mes0) + '</div>');
  H.push('    <p class="sub">Los cierres se calculan hacia atrás desde el saldo vivo de SAP del ' +
         esc(String(d.planta_ancla || '').slice(0, 10)) + ', restando los movimientos de cada día. ' +
         'El cierre del último día es, por construcción, el saldo que muestra la tabla de más ' +
         'arriba.</p>');
  H.push('  </div>\n</section>\n');
  return H.join('\n');
}

/*  LA SERIE QUE VIAJA AL NAVEGADOR.
 *
 *  Compacta a proposito: 349 dias con las claves largas son 60 KB de pagina
 *  para gerencia. Las claves cortas y el firme solo cuando es false lo dejan
 *  en un tercio. La forma la rearma rehidratar() del otro lado. */
function serieCompacta(serie) {
  return (Array.isArray(serie) ? serie : []).map(b => ({
    c: b.cod, n: b.nom, v: b.nivel,
    d: (b.dias || []).map(x => x.firme === false
      ? [x.dia, x.apertura, x.entradas, x.salidas, x.cierre, 0]
      : [x.dia, x.apertura, x.entradas, x.salidas, x.cierre]),
  }));
}

function rehidratar(compacta) {
  return (Array.isArray(compacta) ? compacta : []).map(b => ({
    cod: b.c, nom: b.n, nivel: b.v,
    dias: (b.d || []).map(x => ({ dia: x[0], apertura: x[1], entradas: x[2],
                                  salidas: x[3], cierre: x[4], firme: x.length < 6 })),
  }));
}


/*  UN NOMBRE DE SAP NO PUEDE CERRAR EL SCRIPT.
 *
 *  Dentro de un <script> el parser de html no entiende javascript: corta en la
 *  primera "</script" que vea, venga de donde venga. Un nombre de bodega con
 *  eso adentro —que en SAP nadie impide— partiria la pagina en dos. esc() no
 *  sirve aca: esto viaja dentro de un string de javascript, no de html. Se
 *  escapa solo esa secuencia y no todo "</": un "</" dentro de una expresion
 *  regular del codigo publicado —y hay varias— se rompe si se le mete una
 *  barra invertida. */
/*  UN DATO QUE VIAJA ADENTRO DE UN <script> NO PUEDE TRAER UN '<' CRUDO.
 *
 *  Adentro de un script el parser de html no corta solo en "</script": la
 *  secuencia "<!--<script" tambien lo mete en otro estado y a partir de ahi
 *  deja de leer lo que uno cree. Escapar el '<' como \u003c en el json
 *  elimina la familia entera de casos de una, sigue siendo json valido y se
 *  parsea identico. Es mas barato que enumerar las secuencias peligrosas. */
function jsonSeguro(x) {
  return JSON.stringify(x).replace(/</g, '\\u003c');
}

function sinCierreDeScript(js) {
  return String(js == null ? '' : js).replace(/<\/(script)/gi, '<\\/$1');
}

/*  EL JAVASCRIPT DEL SELECTOR.
 *
 *  No se escribe a mano una copia de panelDeMes() para el navegador: se
 *  publica la MISMA funcion con toString(), junto con todo lo que necesita.
 *  Es la regla que ya seguia antiguedad(). Dos copias de una funcion de
 *  formato divergen, y el dia que divergen la pagina muestra un numero
 *  distinto del que probo el test.
 *
 *  Lo que viaja es la serie compacta, no el html de los dieciocho paneles:
 *  armarlos todos en el servidor eran 180 KB de pagina para que se mire uno.
 *  El panel por defecto si va escrito, asi que sin javascript la pagina
 *  igual se lee: lo que se pierde es poder cambiar de bodega. */
function jsDePlanta(d) {
  const serie = (d && d.planta_dias) || null;
  if (!serie || !serie.length) return '';
  const fns = [esNumero, mil, conSigno, clasePos, esc, etiquetaDeMes, diasDelMes,
               resumenDelMes, altoVisible, ejeDeDias, svgFlujoDia, svgNivelDia, tablaDeDias,
               panelDeMes, rehidratar];
  return '\nvar MESES = ' + jsonSeguro(MESES) + ';\n' +
         fns.map(f => f.toString()).join('\n') + '\n' +
         'var PD = rehidratar(' + jsonSeguro(serieCompacta(serie)) + ');\n' + [
    '(function () {',
    '  try {',
    '    var b = document.getElementById("pd-bod"), m = document.getElementById("pd-mes"),',
    '        caja = document.getElementById("pd-panel");',
    '    if (!b || !m || !caja) return;',
    '    function pintar() {',
    '      var hay = null;',
    '      for (var i = 0; i < PD.length; i++) if (PD[i].cod === b.value) hay = PD[i];',
    '      caja.innerHTML = panelDeMes(hay, m.value);',
    '    }',
    '    b.addEventListener("change", pintar);',
    '    m.addEventListener("change", pintar);',
    '  } catch (e) { /* el panel por defecto ya esta escrito: sin js igual se lee */ }',
    '})();',
  ].join('\n');
}

// ── la pagina ────────────────────────────────────────────────────────────────
const CSS = `
/* Tablero operativo: una fila de cifras, luego las tres patas del pool, luego
   el detalle por socio. Neutros calidos sobre el rojo del pallet. */
:root{
  --bg:#faf8f6; --panel:#ffffff; --linea:#e4ded8; --tinta:#1c1917; --tinta2:#57514b; --tinta3:#8a817a;
  --marca:#b5342a; --cli:#1f6fb2; --ret:#c65a1e; --pla:#0e8f7a;
  --ent:#0e8f7a; --sal:#7d5ba6;
  --ok:#0e8f7a; --alerta:#b06a00; --grave:#b5342a;
  --f-tit:'Archivo',system-ui,sans-serif; --f-txt:'Source Sans 3',system-ui,sans-serif;
  --f-cod:'IBM Plex Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#171513; --panel:#201d1b; --linea:#332e2a; --tinta:#f2eeea; --tinta2:#b5aca4; --tinta3:#857c74;
  --marca:#e06054; --cli:#4792d2; --ret:#d4762c; --pla:#28a386;
  --ent:#28a386; --sal:#a384c9;
  --ok:#28a386; --alerta:#d99a2b; --grave:#e06054; color-scheme:dark;
}}
:root[data-theme="dark"]{
  --bg:#171513; --panel:#201d1b; --linea:#332e2a; --tinta:#f2eeea; --tinta2:#b5aca4; --tinta3:#857c74;
  --marca:#e06054; --cli:#4792d2; --ret:#d4762c; --pla:#28a386;
  --ent:#28a386; --sal:#a384c9;
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
h4{font:600 12px/1.3 var(--f-tit);margin:22px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:var(--tinta2)}
p{margin:0 0 10px;max-width:68ch}
.sub{color:var(--tinta2);font-size:14px;margin-top:6px}
/* La migaja ubica la vista dentro del portal. El unico enlace de la pagina:
   el camino de vuelta al panel. */
.migaja{font-size:12px;color:var(--tinta3);margin-top:7px}
.migaja a{color:var(--tinta2);text-decoration:none;border-bottom:1px solid var(--linea)}
.migaja a:hover{color:var(--marca);border-bottom-color:var(--marca)}
.cabe{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;
  border-bottom:2px solid var(--marca);padding-bottom:14px}
.sello{font:500 12px/1 var(--f-cod);color:var(--tinta2);border:1px solid var(--linea);
  border-radius:3px;padding:6px 9px;white-space:nowrap}
section{margin-top:34px}
.panel{background:var(--panel);border:1px solid var(--linea);border-radius:8px;padding:18px}
.rejilla{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-top:14px}
.rejilla-4{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.rejilla-4 .big{font-size:clamp(22px,3.4vw,30px)}
/* Los filtros van en una fila, arriba de lo que filtran. 44px de alto
   minimo: abajo de eso el dedo no acierta en un telefono. */
.filtros{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end;margin-bottom:4px}
.filtros label{display:flex;flex-direction:column;gap:6px;min-width:0;
  font:600 11px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.08em;color:var(--tinta2)}
.filtros select{font:400 15px var(--f-txt);color:var(--tinta);background:var(--panel);
  border:1px solid var(--linea);border-radius:6px;padding:9px 11px;min-height:44px;
  min-width:min(100%,250px);max-width:100%}
.filtros select:focus-visible{outline:2px solid var(--marca);outline-offset:2px}
/* Un grafico de 25 dias encogido al ancho de un telefono deja las etiquetas
   en 5px: ilegibles. Con min-width el .scroll hace su trabajo y se desplaza. */
.grafdia svg{min-width:620px}
.tile .et{font:600 11px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.09em;color:var(--tinta2)}
.tile .big{font:700 clamp(28px,5vw,40px)/1 var(--f-tit);margin:9px 0 2px;letter-spacing:-.02em}
.tile .pie{font-size:13px;color:var(--tinta2);min-width:0}
.tile{border-left:3px solid var(--linea)}
.t-cli{border-left-color:var(--cli)} .t-ret{border-left-color:var(--ret)} .t-pla{border-left-color:var(--pla)}
.t-ent{border-left-color:var(--ent)} .t-sal{border-left-color:var(--sal)} .t-mal{border-left-color:var(--grave)}
.t-mal .big{color:var(--grave)}
.pool{display:block;width:100%;height:34px;margin:4px 0 10px}
.fecha{color:var(--tinta3);font-size:12px;white-space:nowrap}
.malo{color:var(--grave)}
.s-cli{fill:var(--cli)} .s-ret{fill:var(--ret)} .s-pla{fill:var(--pla)}
.leyenda{display:flex;flex-wrap:wrap;gap:16px;font-size:13.5px;color:var(--tinta2);margin-top:2px}
.leyenda b{color:var(--tinta);font-weight:600}
.pt{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:-1px}
.p-cli{background:var(--cli)} .p-ret{background:var(--ret)} .p-pla{background:var(--pla)}
.p-ent{background:var(--ent)} .p-sal{background:var(--sal)}
svg{display:block;width:100%;height:auto;max-width:100%}
.b-ret{fill:var(--ret)} .b-cli{fill:var(--cli)}
.b-ent{fill:var(--ent)} .b-sal{fill:var(--sal)}
.n-pos{fill:var(--pla)} .n-neg{fill:var(--grave)}
/* El cero del grafico de nivel no es una linea de reja mas: es la frontera
   entre un nivel posible y uno imposible. Se dibuja mas firme. */
.cero{stroke:var(--tinta2);stroke-width:1.5}
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
/* El subtotal cierra su bloque: linea arriba y peso, para que no se lea como
   una bodega mas. El bloque referencial va atenuado porque no suma. */
tr.tot td{border-top:1.5px solid var(--linea);border-bottom:none;
  font:600 13px/1.3 var(--f-tit);text-transform:uppercase;letter-spacing:.06em;padding-top:8px}
tbody.ref{color:var(--tinta2)}
tbody.ref td{opacity:.78}
tbody.ref tr.tot td{opacity:1}
.chip{font:500 10px/1 var(--f-tit);text-transform:uppercase;letter-spacing:.06em;
  border:1px solid var(--linea);border-radius:999px;padding:3px 7px;color:var(--tinta3);white-space:nowrap}
.enrevision{border:1px dashed var(--alerta);border-radius:6px;background:var(--panel);
  color:var(--tinta2);font-size:13.5px;padding:10px 13px;margin:10px 0 0}
.enrevision b{color:var(--alerta)}
.resuelto{border:1px solid var(--linea);border-radius:6px;background:var(--panel);
  color:var(--tinta2);font-size:13.5px;padding:10px 13px;margin:10px 0 0}
.resuelto b{color:var(--ok)}
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

/*  EL SALDO POR BODEGA, EN DOS BLOQUES CON SUS SUBTOTALES.
 *
 *  Una tabla corrida de doce bodegas suma 16.990 y el titular dice 12.601.
 *  Quien la sume con el dedo encuentra una diferencia que la pagina no le
 *  explico. Van las nueve con su subtotal —que es el indicador— y despues las
 *  de referencia con el suyo, marcado como que no suma. */
function tablaDePlanta(filas) {
  const todas = Array.isArray(filas) ? filas : [];
  const nueve = todas.filter(p => p.nueve), resto = todas.filter(p => !p.nueve);
  const suma = fs => fs.reduce((a, p) => a + (Number(p.nivel) || 0), 0);
  const fila = p => '<tr><td class="cod">' + esc(p.cod) + '</td><td class="nom">' + esc(p.nom) +
                    '</td><td class="num">' + mil(p.nivel) + '</td></tr>';
  const total = (txt, v, cl) => '<tr class="tot"><td class="cod"></td><td class="nom ' + cl + '">' +
                    esc(txt) + '</td><td class="num ' + cl + '">' + mil(v) + '</td></tr>';
  let t = '<div class="scroll"><table>\n' +
          '        <thead><tr><th>Código</th><th>Bodega</th><th class="num">Saldo</th></tr></thead>\n' +
          '        <tbody>' + nueve.map(fila).join('') +
          total('Indicador de planta', suma(nueve), '') + '</tbody>';
  if (resto.length)
    t += '\n        <tbody class="ref">' + resto.map(fila).join('') +
         total('Referencial — no suma', suma(resto), 'malo') + '</tbody>';
  return t + '\n      </table></div>';
}

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
  /*  LA PAGINA VIVE DENTRO DEL PORTAL.
   *
   *  sesion.js es lo que cierra por inactividad y reconoce el login
   *  disfrazado de 200. Esta pagina no hace ni un fetch, asi que esa parte le
   *  sobra, pero una vista del portal que no vence cuando las demas vencen es
   *  una vista que queda abierta toda la noche en un monitor. Servida fuera
   *  del portal el script no resuelve y la pagina sale igual. */
  H.push('<script src="/sesion.js"><\/script>');
  H.push('<style>' + CSS + '</style>\n</head>\n<body>\n<div class="wrap">\n');

  H.push('<div class="rancio" id="rancio" hidden></div>');
  H.push('<header class="cabe">\n  <div>\n    <h1>Stock y Flujos de Pallets</h1>');
  H.push('    <div class="migaja"><a href="m3link_dashboard_dark.html">Panel M3LINK</a> › ' +
         'Stock SAP › Stock y Flujos de Pallets · extracción propia M3DATA</div>');
  H.push('    <div class="sub">Pallet rojo 1,00 × 1,20 · SKU 11111111110 · extracción propia desde SAP B1</div>');
  H.push('  </div>\n  <div class="sello" data-medido="' + esc(v.nivel) + '">Saldos al ' + esc(v.nivel) +
         (v.flujo_hasta ? '<br>Flujos ' + esc(String(v.flujo_desde || '').slice(0, 4)) + ' al ' + esc(v.flujo_hasta) : '') +
         '</div>\n</header>\n');

  // ── el pool ──
  H.push('<section>\n  <h2>El pool</h2>');
  H.push('  <p>El pallet rojo que está rotando, repartido en las tres patas del pool. Lo que ' +
         'SAP tiene en bodega y no rota —merma, extraños y el tránsito que no es del indicador— ' +
         'se muestra aparte y no suma. SAP registra el pallet rojo en ' + mil(d.bodegas_cuantas) +
         ' bodegas de la empresa.</p>');
  H.push('  <div class="panel">\n    <div class="tile" style="border:none;padding:0">');
  H.push('      <div class="et">Pool</div>\n      <div class="big">' + mil(d.pool) + '</div>');
  H.push('      <div class="pie">pallets de pool, leídos del saldo vivo de SAP' +
         (d.sistemico ? '<br>de los cuales <b>' + mil(d.sistemico) + '</b> son sistémicos y no vuelven ' +
                        'a rotar: en circulación quedan <b>' + mil(d.pool - d.sistemico) + '</b>' : '') +
         '</div>\n    </div>');
  H.push('    <div class="pool">' + svgPool(d) + '</div>\n    <div class="leyenda">');
  for (const [cl, nom, val] of [['p-cli', 'Clientes', b.CLIENTES.nivel],
                                ['p-ret', 'Retail', b.RETAIL.nivel],
                                ['p-pla', 'Planta REDTEC', b.PLANTA.nivel]])
    H.push('      <span><i class="pt ' + cl + '"></i>' + nom + ' <b>' + mil(val) + '</b> · ' +
           pct1(val, d.pool) + '</span>');
  H.push('    </div>');
  /*  LO QUE NO SUMA SE DICE DONDE ESTA EL TOTAL, no en una nota al pie.
   *
   *  Quien sume las bodegas de SAP va a obtener 4.389 mas que el titular.
   *  Tiene que poder ver de donde sale la diferencia en el mismo lugar donde
   *  lee el numero, o va a concluir que faltan pallets. */
  const fueras = (d.planta || []).filter(p => !p.nueve && p.nivel !== 0);
  if (d.fuera_del_pool > 0)
    H.push('    <p class="sub" style="margin:12px 0 0">Fuera del indicador, referencial ' +
           '—<b>no suma</b>—: ' + mil(d.fuera_del_pool) + ' en ' +
           (fueras.length
              ? fueras.map(p => esc(p.nom.toLowerCase()) + ' (' + mil(p.nivel) + ')').join(', ')
              : 'merma, extraños y tránsito') +
           '. Contándolos, SAP tiene <b>' + mil(d.pool_sap) + '</b> en bodega.</p>');
  H.push('  </div>\n');
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
         mil(b.PLANTA.nivel) + '</div>\n      <div class="pie">en las nueve bodegas del indicador' +
         '<br>\n      ' + mil(b.PLANTA.fuera) + ' más en merma, extraños y tránsito, que no suman' +
         '</div>\n    </div>');
  H.push('  </div>\n</section>\n');

  // ── movimiento mensual ──
  if (d.meses.length) {
    H.push('<section>\n  <h2>Movimiento neto por mes</h2>');
    H.push('  <p>Cuánto subió o bajó cada bodega en el año. Un valor positivo es pallet que salió de ' +
           'REDTEC hacia el socio; uno negativo es pallet que volvió.</p>');
    if (d.mensual_nota)
      H.push('  <div class="' + (d.mensual_verificado ? 'resuelto' : 'enrevision') + '">' +
             (d.mensual_verificado ? '<b>Verificado.</b> ' : '<b>En verificación.</b> ') +
             esc(d.mensual_nota) + '</div>');
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
         'sostener un par de miles en cualquier momento dado. El indicador son las nueve ' +
         'estaciones del recorrido del pallet; merma, extraños y el tránsito que no es del ' +
         'indicador se muestran como referencia y no entran en el pool.</p>');
  H.push('  <div class="dos" style="margin-top:14px">');
  H.push('    <div class="panel">\n      <h3>Saldo por bodega</h3>');
  H.push('      ' + tablaDePlanta(d.planta));
  H.push('    </div>');

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

  // ── la distribucion diaria de planta ──
  // Vacio si no vino el json: un paso que falla no deja la pagina a medias.
  // Se empuja solo si trae algo: un push vacio deja una linea en blanco de
  // mas, y entonces la pagina SIN planta ya no es la misma que la de antes.
  const bloque = bloqueDePlanta(d);
  if (bloque) H.push(bloque);

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
  H.push('<script>\n' + sinCierreDeScript(antiguedad.toString() + '\n' + [
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
  ].join('\n') + jsDePlanta(d)) + '\n<\/script>');
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
  const rPla = opcion('planta', 'data/planta.json');
  const rDat = opcion('datos', 'data/datos-stock.json');
  const rSal = opcion('salida', 'stock-flujos-pallets.html');

  const bod = leerJson(rBod, true), ret = leerJson(rRet, true), cli = leerJson(rCli, true);
  const ext = leerJson(rExt, false);
  if (!ext) console.error('Aviso: no hay ' + rExt + '. Las secciones que dependen de el no se dibujan.');

  // La distribucion diaria de planta es OPCIONAL y se valida antes de usarla:
  // una serie anclada en otra fecha haria que la pagina se contradiga sola.
  let pla = leerJson(rPla, false);
  if (!pla) console.error('Aviso: no hay ' + rPla + '. La distribucion diaria de planta no se dibuja.');
  else {
    const ac = anclaCalza(pla, bod);
    if (!ac.ok) {
      console.error('Aviso: ' + ac.motivo + '. Se ignora ' + rPla + '.');
      pla = null;
    }
  }

  const d = datos(bod, ret, cli, ext, pla);
  const fs = require('fs');
  fs.writeFileSync(rDat, JSON.stringify(d, null, 1) + '\n', { encoding: 'utf8' });
  fs.writeFileSync(rSal, pagina(d), { encoding: 'utf8' });

  console.log('Tablero armado.');
  console.log('  pool ' + mil(d.pool) + '  =  clientes ' + mil(d.bodegas.CLIENTES.nivel) +
              ' + retail ' + mil(d.bodegas.RETAIL.nivel) + ' + planta ' + mil(d.bodegas.PLANTA.nivel));
  console.log('  socios con saldo: retail ' + d.bodegas.RETAIL.n + ', clientes ' + d.bodegas.CLIENTES.n);
  console.log('  año: retail ' + conSigno(d.anio.ret) + ', clientes ' + conSigno(d.anio.cli));
  if (d.planta_dias)
    console.log('  planta dia a dia: ' + d.planta_dias.length + ' bodegas del indicador · ' +
                d.planta_dias.reduce((a, b) => a + b.dias.length, 0) + ' dias · anclada ' +
                String(d.planta_ancla || '?').slice(0, 10));
  else console.log('  planta dia a dia: no disponible');
  console.log('  ' + rDat);
  console.log('  ' + rSal);
  if (d.descalces.length) {
    for (const t of d.descalces) console.error('  DESCALCE · ' + t);
    process.exit(1);   // el tablero queda escrito, pero el workflow tiene que verlo rojo
  }
}

module.exports = { esNumero, mil, conSigno, clasePos, pct, pct1, esc, sinBom,
                   serieDePlanta, anclaCalza,
                   plantaDeBodega, gruposDeSerie, etiquetaDeMes, mesesDeSerie,
                   diasDelMes, resumenDelMes, altoVisible, ejeDeDias, svgFlujoDia, svgNivelDia,
                   tablaDeDias, panelDeMes, bloqueDePlanta,
                   serieCompacta, rehidratar, jsonSeguro, sinCierreDeScript, jsDePlanta,
                   NUEVE, GRUPOS, MESES, OPCIONES,
                   clasificarPool, cortarSocios, porGrupo, mesesPareados, datos,
                   antiguedad, svgPool, svgMeses, tablaDePlanta, filaSocio, tablaSocios, notaImposibles, pagina,
                   opcion, opcionesRaras, leerJson, CSS };

if (require.main === module) main();
