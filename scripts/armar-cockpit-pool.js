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
const { mil, conSigno, pct, pct1, esc, clasePos, esNumero, sinBom,
        plantaDeBodega, mesesDeSerie, diasDelMes, resumenDelMes, etiquetaDeMes, relojes, avisoDeFuturo,
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

/*  EL NOMBRE DE CADA ESTADO NO ES UN COLOR.
 *
 *  Se llamaban rojo, amarillo y verde, y en REDTEC el rojo y el verde son
 *  TIPOS DE PALLET: la gente leia "SANTIAGO INSPECCION · rojo" y entendia que
 *  la bodega tenia pallet rojo, no que estaba critica. El estado se nombra por
 *  lo que es, y el color pasa a ser refuerzo del glifo y de la palabra. */
const NOMBRE_SALUD = { critica: 'Crítica', atencion: 'Atención', sana: 'Sana', sindato: 'Sin dato' };

/*  LA SALUD DE UNA BODEGA ES UNA REGLA, NO UNA OPINION.
 *
 *  Un nivel negativo es imposible: no existe media bodega de pallets en menos.
 *  Asi que el semaforo mira exactamente eso y nada mas. Lo que no se puede
 *  evaluar se dice 'sin dato' y no se pinta de sana, que es la forma mas
 *  barata de mentir en un tablero. */
function saludDeBodega(b) {
  const dias = (b && b.dias) || [];
  if (!dias.length) return { nivel: 'sindato', texto: NOMBRE_SALUD.sindato, n: 0, de: 0 };
  const neg = dias.filter(d => Number(d.cierre) < 0).length;
  const parte = neg / dias.length;
  const nivel = neg === 0 ? 'sana' : parte >= 0.5 ? 'critica' : parte > 0 ? 'atencion' : 'sana';
  const texto = NOMBRE_SALUD[nivel];
  return { nivel, texto, n: neg, de: dias.length };
}

const ORDEN_SALUD = { critica: 0, atencion: 1, sana: 2, sindato: 3 };
const GLIFO = { critica: '◆', atencion: '▲', sana: '●', sindato: '○' };


/*  LAS BODEGAS, ORDENADAS POR LO QUE HAY QUE MIRAR PRIMERO.
 *
 *  No por saldo ni por codigo: por salud. Un tablero que pone arriba la bodega
 *  mas grande obliga a buscar el problema; uno que pone arriba la que esta en
 *  critica lo muestra. A igual salud, manda el recorrido. */
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

/*  EL MES CON QUE ABRE EL CAJON DE UNA ESTACION.
 *
 *  No el mes mas nuevo de la pagina: el mes mas nuevo QUE ESA ESTACION TIENE.
 *  Cinco de las nueve cierran su serie en octubre porque SAP no les registro
 *  movimiento despues, asi que abrir siempre en el mes mas nuevo del tablero
 *  les muestra "sin movimiento" — y entre esas cinco estan justamente las tres
 *  que el titular acusa. Cuando la estacion cierra dias bajo cero manda el mes
 *  del peor dia: es el que hay que mirar, no el ultimo. */
function mesDeApertura(bodega) {
  const dias = (bodega && Array.isArray(bodega.dias)) ? bodega.dias : [];
  if (!dias.length) return null;
  let peor = null, ultimo = null;
  for (const d of dias) {
    const m = String(d && d.dia).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    if (ultimo == null || m > ultimo) ultimo = m;
    const c = Number(d.cierre) || 0;
    if (c < 0 && (peor == null || c < peor.c)) peor = { c, m };
  }
  return peor ? peor.m : ultimo;
}

/*  LOS MESES QUE UNA ESTACION TIENE. Los que tiene, no los que el tablero
 *  ofrece: un selector que ofrece un mes vacio miente dos veces, al ofrecerlo
 *  y al no encontrar nada. */
function mesesDeBodega(bodega) {
  const visto = {}, out = [];
  for (const d of ((bodega && bodega.dias) || [])) {
    const m = String(d && d.dia).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m) && !visto[m]) { visto[m] = true; out.push(m); }
  }
  return out.sort();
}

/*  EL NIVEL DIARIO DE LA PLANTA ENTERA.
 *
 *  NO es la suma de las filas que hay cada dia. La serie solo trae los dias en
 *  que una estacion SE MOVIO, asi que un dia en que solo dos estaciones
 *  tuvieron documento tiene dos filas — sumarlas daria un total ridiculo y
 *  parecerian pallets evaporados. Lo que corresponde es arrastrar: una
 *  estacion sin movimiento ese dia sigue con el nivel del dia anterior.
 *
 *  EL PUNTO DE PARTIDA de cada estacion es la apertura de su primer dia, que
 *  es el unico anclaje que el json entrega para lo que habia antes de la
 *  ventana.
 *
 *  LA PRUEBA DE QUE ESTA BIEN es que el ultimo total tiene que dar el mismo
 *  13.607 que SAP: cada estacion cierra su serie en su saldo vivo, asi que la
 *  suma arrastrada tiene que caer exactamente ahi. Si no cae, el numero esta
 *  mal y la pagina lo dice en vez de dibujarlo. */
function nivelDiarioDePlanta(serie) {
  const bs = (Array.isArray(serie) ? serie : [])
    .filter(b => b && b.cod != null && Array.isArray(b.dias) && b.dias.length);
  if (!bs.length) return [];
  const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x);
  const vistos = {}, calendario = [];
  const nivel = {}, porDia = {}, entr = {}, sal = {};
  for (const b of bs) {
    const cod = String(b.cod);
    const ord = b.dias.filter(x => x && fecha(String(x.dia)))
                      .sort((p, q) => String(p.dia) < String(q.dia) ? -1 : 1);
    if (!ord.length) continue;
    nivel[cod] = Number(ord[0].apertura) || 0;
    porDia[cod] = {};
    for (const x of ord) {
      const dia = String(x.dia);
      porDia[cod][dia] = Number(x.cierre) || 0;
      entr[dia] = (entr[dia] || 0) + (Number(x.entradas) || 0);
      sal[dia] = (sal[dia] || 0) + (Number(x.salidas) || 0);
      if (!vistos[dia]) { vistos[dia] = true; calendario.push(dia); }
    }
  }
  calendario.sort();
  const out = [];
  for (const dia of calendario) {
    for (const cod in porDia) if (porDia[cod][dia] != null) nivel[cod] = porDia[cod][dia];
    let total = 0;
    for (const cod in nivel) total += nivel[cod];
    /*  La apertura del agregado no se lleva aparte: sale de la identidad, que
     *  se cumple exacta porque una estacion quieta aporta cero a los dos
     *  movimientos y su nivel no cambia. Llevar un segundo acumulador seria
     *  una segunda fuente para el mismo numero. */
    const e = entr[dia] || 0, sa = sal[dia] || 0;
    out.push({ dia, cierre: total, entradas: e, salidas: sa, apertura: total - e + sa });
  }
  return out;
}

/*  LA ULTIMA SEMANA DE UNA ESTACION.
 *
 *  Los ultimos n dias QUE LA ESTACION TIENE, no los ultimos n del calendario.
 *  Si tiene menos de n devuelve los que hay: una semana corta es un dato, y
 *  rellenarla con ceros seria inventar dias que SAP nunca registro. */
function ultimaSemana(bodega, n) {
  const dias = (bodega && Array.isArray(bodega.dias)) ? bodega.dias : [];
  const cuantos = Number(n) > 0 ? Math.floor(Number(n)) : 7;
  return dias.slice(Math.max(0, dias.length - cuantos))
             .map(d => ({ dia: String(d.dia), cierre: Number(d.cierre) || 0 }));
}

/*  EL CALENDARIO DEL MES.
 *
 *  POR QUE REEMPLAZA A LA BARRITA. La barrita mostraba la forma de la semana
 *  pero no sus numeros: para saber cuanto cerro el martes habia que pasar el
 *  mouse por cada barra, una por una, y nadie hace eso en una reunion. Lo que
 *  se pregunta frente a esta tarjeta no es "como viene la tendencia" sino
 *  "cuanto habia el 29", y esa pregunta se contesta con el numero escrito.
 *
 *  SE PUEDE ELEGIR UN DIA y la tarjeta entera pasa a hablar de ese dia: el
 *  numero grande, las tres filas y el pie. Un calendario que solo se mira
 *  obligaria a abrir otra vista para leer el detalle del dia que llamo la
 *  atencion, que es exactamente el viaje que esta tarjeta existe para evitar. */

/** El dia de la semana, 0 = lunes. Se parsea en UTC a proposito: con el
 *  constructor local, un ISO sin hora se interpreta como medianoche UTC y al
 *  oeste de Greenwich getDay() devuelve el dia ANTERIOR. Esa es la clase de
 *  error que corre el calendario entero una columna sin avisar. */
function diaDeSemana(iso) {
  const t = String(iso == null ? '' : iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const ms = Date.parse(t + 'T00:00:00Z');
  if (!isFinite(ms)) return null;
  return (new Date(ms).getUTCDay() + 6) % 7;
}

const DIA_CORTO = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** Que mes muestra el calendario: el del selector de periodo si hay uno, y
 *  si no el mas reciente que tenga dias. Nunca un mes fijo: con --periodo en
 *  octubre la tarjeta tiene que hablar de octubre. */
function mesDelCalendario(dias, periodo) {
  if (/^\d{4}-\d{2}$/.test(String(periodo == null ? '' : periodo))) return String(periodo);
  let max = null;
  for (const d of (Array.isArray(dias) ? dias : [])) {
    const m = String((d && d.dia) || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m) && (max == null || m > max)) max = m;
  }
  return max;
}

/** La grilla del mes: una fila por semana con dias, una celda por dia habil.
 *
 *  LAS COLUMNAS SALEN DE LOS DIAS QUE HAY, no de un supuesto sobre la semana
 *  laboral. En REDTEC se trabaja el sabado —octubre 2026 tiene cinco— y una
 *  grilla de lunes a viernes los habria escondido sin decir que los escondia.
 *  Las semanas sin ningun dia no se dibujan: una fila vacia se lee como una
 *  semana sin movimiento y lo que pasa es que no existe en la serie. */
function calendarioDeMes(dias, mes) {
  const ms = /^\d{4}-\d{2}$/.test(String(mes == null ? '' : mes)) ? String(mes) : null;
  if (!ms) return null;
  const hay = (Array.isArray(dias) ? dias : [])
    .filter(x => x && String(x.dia || '').slice(0, 7) === ms && diaDeSemana(x.dia) != null);
  if (!hay.length) return null;
  let cols = 5;
  for (const x of hay) { const w = diaDeSemana(x.dia); if (w + 1 > cols) cols = w + 1; }
  const porDia = {};
  for (const x of hay) porDia[String(x.dia)] = x;
  const ultimo = new Date(Date.UTC(Number(ms.slice(0, 4)), Number(ms.slice(5, 7)), 0)).getUTCDate();
  const semanas = [];
  let fila = [], usada = false;
  const limpia = () => { fila = []; for (let i = 0; i < cols; i++) fila.push(null); usada = false; };
  limpia();
  for (let n = 1; n <= ultimo; n++) {
    const iso = ms + '-' + (n < 10 ? '0' + n : String(n));
    const w = diaDeSemana(iso);
    if (w === 0 && usada) { semanas.push(fila); limpia(); }
    if (w >= cols) continue;
    const c = porDia[iso];
    if (!c) continue;
    fila[w] = { dia: iso, num: n, cierre: Number(c.cierre) || 0,
                entradas: Number(c.entradas) || 0, salidas: Number(c.salidas) || 0,
                apertura: Number(c.apertura) || 0 };
    usada = true;
  }
  if (usada) semanas.push(fila);
  return { mes: ms, cols, semanas };
}

/** Las tres filas de la tarjeta PARA UN DIA.
 *
 *  Con un solo transito —el del ultimo cierre— elegir el 29 de octubre
 *  mostraria el stock del 29 al lado del transito de hoy. Son dos dias
 *  distintos en la misma tabla y nadie lo notaria.
 *
 *  CON UN FILTRO DE PLANTA PUESTO NO SE MUESTRAN: el transito se mide sobre
 *  las nueve bodegas juntas, asi que repartirlo entre Santiago y Talca seria
 *  inventar. Se dice en vez de mostrar un numero que no corresponde. */
function filasDelDia(dia, nivelDia, traDias, filtrado) {
  const c = (Array.isArray(nivelDia) ? nivelDia : []).find(x => x && x.dia === dia);
  if (!c) return null;
  if (filtrado)
    return { aun: 'el tránsito se mide sobre las nueve bodegas juntas, no se reparte por planta' };
  const t = (Array.isArray(traDias) ? traDias : []).find(x => x && x.dia === dia);
  const tp = t && t.pallets != null ? Number(t.pallets) : null;
  return [{ q: 'En planta', v: c.cierre, m: 'lo que hay en bodega' },
          { q: 'En tránsito a cliente', v: tp, m: 'salió, el cliente todavía no lo recibe' },
          { q: 'Por fecha contable', v: tp == null ? null : c.cierre + tp,
            m: 'lo que cuadra con la cartola', pie: true }];
}

/** El pie: como se compuso el cierre del dia elegido, con los cuatro numeros
 *  escritos. Es la pregunta que trajo a alguien a hacer clic en ese dia. */
function pieDeDia(c) {
  if (!c) return '';
  const w = diaDeSemana(c.dia);
  return (w == null ? '' : DIA_CORTO[w] + ' ' + c.num + ' · ') +
         'abre <b>' + mil(c.apertura) + '</b> · entran <b>' + mil(c.entradas) +
         '</b> · salen <b>' + mil(c.salidas) + '</b> · cierra <b>' + mil(c.cierre) + '</b>';
}

/** EL CIERRE DE UNA ESTACION EN UN DIA CUALQUIERA.
 *
 *  Se arrastra con la MISMA regla que nivelDiarioDePlanta: una estacion que
 *  no se movio ese dia no vale cero, vale lo mismo del dia anterior; y antes
 *  de su primer dia vale su apertura. Sin eso, elegir un dia en el calendario
 *  dejaria en cero a las estaciones quietas y la grilla no sumaria el
 *  indicador de ese dia. */
function cierreDeBodegaEn(bodega, dia) {
  const ds = (bodega && Array.isArray(bodega.dias)) ? bodega.dias : [];
  const d = String(dia == null ? '' : dia).slice(0, 10);
  if (!ds.length || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  let mejor = null, val = null, primero = null;
  for (const x of ds) {
    if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.dia))) continue;
    if (primero == null || String(x.dia) < primero.dia) primero = { dia: String(x.dia), x };
    if (String(x.dia) > d) continue;
    if (mejor == null || String(x.dia) > mejor) { mejor = String(x.dia); val = Number(x.cierre) || 0; }
  }
  if (val != null) return val;
  return primero ? (Number(primero.x.apertura) || 0) : null;
}

/*  LAS NUEVE EN UNA SOLA GRILLA.
 *
 *  Antes eran nueve filas, cada una con su mini-serie y su rotulo: el panel
 *  media mas de una pantalla y para comparar dos estaciones habia que
 *  recordar el numero mientras se bajaba. En grilla entran las nueve de una
 *  mirada, que es como se usa: "donde esta el stock hoy". */
function grillaBodegasHtml(filas, total) {
  const fs = (Array.isArray(filas) ? filas : []).filter(Boolean);
  if (!fs.length) return '';
  const H = ['<div class="bgr">'];
  for (const f of fs)
    H.push('<div class="bg"' + (f.cod ? ' data-cod="' + esc(f.cod) + '"' : '') + '>' +
           '<span class="bgn">' + esc(f.a) + '</span>' +
           '<span class="bgc">' + esc(f.b || '') + '</span>' +
           '<b>' + (f.v == null ? '—' : mil(f.v)) + '</b></div>');
  H.push('</div>');
  if (total != null)
    H.push('<div class="bgt"><span>' + esc((total && total.a) || 'Total') + '</span>' +
           '<b>' + mil((total && total.v) || 0) + '</b></div>');
  return H.join('');
}

/** Lo que hay que decir cuando el dia elegido NO es el cierre vigente: que
 *  la cifra grande es de ese dia y cual es el saldo de hoy. Sin esto, elegir
 *  el 29 de octubre deja la tarjeta mostrando 15.045 bajo un titulo que se
 *  lee como el stock de ahora. */
function notaDeDia(dia, hoy, ultimo) {
  if (!dia || !ultimo || dia === ultimo) return '';
  return 'Cierre del ' + dia + '. Hoy SAP tiene ' + mil(Number(hoy) || 0) + '.';
}

/*  EL CALENDARIO DIBUJADO. Cada celda lleva sus numeros en atributos: asi el
 *  navegador repinta la tarjeta al elegir un dia leyendo del DOM, sin volver
 *  a calcular nada y sin una segunda copia de la serie. */
function calendarioHtml(cal, o) {
  const op = o || {}, sel = op.sel, tope = op.tope, traDias = op.tra;
  if (!cal || !cal.semanas || !cal.semanas.length) return '';
  const tra = d => {
    const t = (Array.isArray(traDias) ? traDias : []).find(x => x && x.dia === d);
    return t && t.pallets != null ? String(Number(t.pallets)) : '';
  };
  const H = ['<div class="calen" data-tope="' + (Number(tope) || 0) + '"' +
             ' data-hoy="' + (Number(op.hoy) || 0) + '"' +
             ' data-ult="' + esc(op.ultimo || '') + '">',
             '<div class="cz"><b>' + esc(etiquetaDeMes(cal.mes) || cal.mes) + '</b>' +
             '<span>clic en un día</span></div>',
             '<div class="cg" style="grid-template-columns:repeat(' + cal.cols + ',minmax(0,1fr))">'];
  for (let i = 0; i < cal.cols; i++) H.push('<span class="ch">' + DIA_CORTO[i] + '</span>');
  for (const sem of cal.semanas) {
    for (const c of sem) {
      if (!c) { H.push('<span class="cd vac" aria-hidden="true"></span>'); continue; }
      H.push('<button type="button" class="cd' + (c.dia === sel ? ' sel' : '') +
             (c.cierre < 0 ? ' neg' : '') + '" data-dia="' + esc(c.dia) +
             '" data-ape="' + c.apertura + '" data-ent="' + c.entradas +
             '" data-sal="' + c.salidas + '" data-cie="' + c.cierre +
             '" data-tra="' + tra(c.dia) + '" aria-pressed="' + (c.dia === sel ? 'true' : 'false') +
             '" aria-label="' + esc(c.dia) + ': cierra en ' + mil(c.cierre) + '">' +
             '<span class="cn">' + c.num + '</span><b>' + mil(c.cierre) + '</b>' +
             '<span class="ce">↑' + mil(c.entradas) + '</span>' +
             '<span class="cs">↓' + mil(c.salidas) + '</span></button>');
    }
  }
  H.push('</div>');
  const celSel = [].concat.apply([], cal.semanas).filter(x => x && x.dia === sel)[0] || null;
  H.push('<div class="cpie">' + pieDeDia(celSel) + '</div>');
  H.push('<div class="cdia">' + esc(notaDeDia(sel, op.hoy, op.ultimo)) + '</div>');
  H.push('</div>');
  return H.join('');
}

/*  REPINTAR LA TARJETA CON EL DIA ELEGIDO.
 *
 *  CORRE SOLO EN EL NAVEGADOR —se publica con toString()— y por eso toca el
 *  DOM en vez de devolver HTML. Lee los numeros de los atributos de la celda
 *  y no de una segunda copia de la serie: la celda ya los trae escritos, asi
 *  que no hay forma de que el calendario y el numero grande digan cosas
 *  distintas, que es lo que pasa cuando el mismo dato se calcula dos veces.
 *
 *  Y CAMBIA EL ROTULO cuando el dia elegido no es el ultimo: una tarjeta que
 *  dice "Planta · indicador" mostrando el cierre del 29 de octubre se lee
 *  como el stock de hoy. */
function pintarDia(card, dia, serie) {
  if (!card || !card.querySelector) return false;
  const cal = card.querySelector('.calen');
  if (!cal) return false;
  const cels = cal.querySelectorAll('.cd[data-dia]');
  let sel = null;
  for (let i = 0; i < cels.length; i++) {
    const on = cels[i].getAttribute('data-dia') === dia;
    cels[i].classList.toggle('sel', on);
    cels[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) sel = cels[i];
  }
  if (!sel) return false;
  const n = a => Number(sel.getAttribute(a)) || 0;
  const cie = n('data-cie'), ent = n('data-ent'), sld = n('data-sal'), ape = n('data-ape');
  const crudo = sel.getAttribute('data-tra');
  // Vacio es "ese dia no se puede medir", que NO es cero pallets en el aire.
  const tp = crudo === '' || crudo == null ? null : Number(crudo);

  const kv = card.querySelector('.kv');
  if (kv) kv.innerHTML = mil(cie) + '<small>pallets</small>';
  const barra = card.querySelector('.bullet .fill');
  const tope = Number(cal.getAttribute('data-tope')) || 0;
  if (barra)
    barra.style.width = (tope > 0 ? Math.max(0, Math.min(100, cie / tope * 100)) : 0).toFixed(2) + '%';

  const nums = card.querySelectorAll('table.trio td.num');
  if (nums.length === 3) {
    nums[0].textContent = mil(cie);
    nums[1].textContent = tp == null ? '—' : mil(tp);
    nums[2].textContent = tp == null ? '—' : mil(cie + tp);
  }
  /*  Y LAS NUEVE ESTACIONES, que es la pregunta que trae a alguien a hacer
   *  clic en un dia: no "cuanto habia" sino "donde estaba". */
  const celdasBod = card.querySelectorAll('.bg[data-cod]');
  if (celdasBod.length && Array.isArray(serie)) {
    let suma = 0;
    for (let i = 0; i < celdasBod.length; i++) {
      const cod = celdasBod[i].getAttribute('data-cod');
      const b = serie.filter(x => x && String(x.cod) === cod)[0];
      const v = cierreDeBodegaEn(b, dia);
      const num = celdasBod[i].querySelector('b');
      if (num) num.textContent = v == null ? '—' : mil(v);
      suma += Number(v) || 0;
    }
    const pieG = card.querySelector('.bgt b');
    if (pieG) pieG.textContent = mil(suma);
  }
  const pie = cal.querySelector('.cpie');
  if (pie) pie.innerHTML = pieDeDia({ dia: dia, num: Number(String(dia).slice(8)), cierre: cie,
                                      entradas: ent, salidas: sld, apertura: ape });
  const nota = cal.querySelector('.cdia');
  if (nota)
    nota.textContent = notaDeDia(dia, Number(cal.getAttribute('data-hoy')) || 0,
                                 cal.getAttribute('data-ult') || '');
  return true;
}

/*  CAMBIAR EL MES DEL CALENDARIO DEL CAJON.
 *
 *  El cajon se arma una vez en el servidor y no se rehace al filtrar, asi que
 *  el calendario trae sus propios chips de mes: sin ellos solo se podria
 *  mirar el mes mas nuevo, que a principio de mes son dos dias.
 *
 *  Se RECALCULA con las mismas funciones del servidor en vez de dibujar los
 *  doce meses de antemano y esconder once. */
function pintarMes(cont, mes, serie, traDias, hoy, ultimo) {
  if (!cont || !cont.querySelector) return false;
  const viejo = cont.querySelector('.calen');
  if (!viejo) return false;
  const nd = nivelDiarioDePlanta(Array.isArray(serie) ? serie : []);
  const cal = calendarioDeMes(nd, mes);
  if (!cal) return false;
  const cels = [].concat.apply([], cal.semanas).filter(Boolean);
  const sel = cels.length ? cels[cels.length - 1].dia : null;
  const tope = Number(viejo.getAttribute('data-tope')) || 0;
  viejo.outerHTML = calendarioHtml(cal, { sel, tope, tra: traDias, hoy, ultimo });
  const chips = cont.querySelectorAll('[data-pm]');
  for (let i = 0; i < chips.length; i++)
    chips[i].classList.toggle('on', chips[i].getAttribute('data-pm') === mes);
  return pintarDia(cont, sel, serie);
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
/*  CON UN FILTRO DE PLANTA PUESTO, EL TITULAR NO PUEDE SEGUIR DICIENDO EL
 *  POOL. El pool es de toda la empresa: dejarlo en un titular que arriba dice
 *  SANTIAGO invita a leer 808.513 como si fuera de Santiago. Filtrado, el
 *  titular habla solo de lo que el filtro alcanza. */
function titular(d, bodegas, planta) {
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const malas = bs.filter(b => b.salud.nivel === 'critica' || b.salud.nivel === 'atencion');
  const dias = bs.reduce((a, b) => a + b.dias, 0);
  const neg = bs.reduce((a, b) => a + b.salud.n, 0);
  const pool = Number(d && d.pool) || 0;
  const P = planta ? esc(String(planta)) : null;
  const enc = P ? '<em>' + P + '</em> · ' : 'Pool de <em>' + mil(pool) + '</em> pallets; ';
  if (!bs.length)
    return { frase: P ? '<em>' + P + '</em> · sin distribución diaria' :
                        'Pool de <em>' + mil(pool) + '</em> pallets',
             nivel: 'sindato',
             cola: 'sin distribución diaria de planta en esta corrida' };
  if (!malas.length)
    return { frase: enc + '<em>ninguna estación</em> en negativo',
             nivel: 'sana',
             cola: mil(bs.length) + (P ? ' estaciones' : ' bodegas del indicador') +
                   ' · ' + mil(dias) + ' días medidos' };
  /*  El peor cierre y la estacion que lo tiene salen del MISMO registro.
   *  Sacarlos por separado — el minimo por una reduccion y el codigo por la
   *  primera en critica — hace que la cola nombre a una estacion que no es la
   *  dueña del numero: con 23 dias malos TALCA INSPECCION encabeza el orden,
   *  pero el -7.415 es de SANTIAGO INSPECCION. Un numero bien calculado con
   *  la etiqueta equivocada manda a revisar la bodega que no es. */
  const dueno = bs.reduce((a, b) => (b.peor && (a == null || b.peor.cierre < a.peor.cierre)
                                     ? b : a), null);
  return { frase: enc + '<em>' + mil(malas.length) + ' de ' +
                  mil(bs.length) + ' estaciones</em> cierran días en negativo',
           nivel: malas.some(b => b.salud.nivel === 'critica') ? 'critica' : 'atencion',
           cola: mil(neg) + ' de ' + mil(dias) + ' días · peor ' +
                 mil(dueno ? dueno.peor.cierre : 0) +
                 ' en ' + esc(dueno ? dueno.cod : bs[0].cod) };
}

/*  LAS TARJETAS DE "¿COMO ESTAMOS?".
 *
 *  Cada una trae: etiqueta, la formula de donde sale (arriba a la derecha), el
 *  numero con su unidad, una barra cuando hay dos magnitudes que comparar, y
 *  un chip de estado. La tarjeta que no puede calcularse NO sale en cero: sale
 *  diciendo que no se puede, que es lo que hace el tablero de ITL y es lo
 *  correcto. */
/*  CADA TARJETA DECLARA SU ALCANCE.
 *
 *  Solo dos de las ocho son de planta: el indicador y los dias en negativo.
 *  Las otras seis hablan de clientes y retail o son controles de toda la
 *  extraccion, y no tienen version por planta — no existe "la atribucion por
 *  socio de Talca". Con un filtro puesto se atenuan y lo dicen, porque un
 *  numero global al lado de un titulo que dice SANTIAGO se lee como de
 *  Santiago. */
function tarjetas(datos, bodegas, planta, periodo) {
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

  t.push({ clave: 'pool', et: 'Reparto del pool', hint: 'cli / ret / planta', ambito: 'global', kv: mil(d.pool), u: 'pallets',
           stack: [ { v: Number(cli.nivel) || 0, c: 'var(--cli)', nom: 'Clientes' },
                    { v: Number(ret.nivel) || 0, c: 'var(--ret)', nom: 'Retail' },
                    { v: Number(pla.nivel) || 0, c: 'var(--pla)', nom: 'Planta' } ],
           ks: 'de <b>' + mil(d.pool_sap) + '</b> que SAP tiene en bodega · ' +
               mil(d.fuera_del_pool) + ' fuera del indicador no suman',
           chip: null });

  /*  LA SEMANA DE LA PLANTA ENTERA. El nivel diario arrastrado, no la suma de
   *  las filas del dia. Su ultimo valor TIENE que dar el mismo saldo que SAP
   *  publica arriba en la tarjeta: si no da, la tarjeta lo declara en vez de
   *  dibujar una linea que no reconcilia con su propio numero. */
  /*  Con filtro, el indicador es la suma de las estaciones que el filtro
   *  alcanza, y el referencial son las bodegas de ESA planta que no cuentan:
   *  Coquimbo no es el referencial de Talca solo por estar fuera. */
  const filtrado = !!planta;
  const plantas = Array.isArray(d.planta) ? d.planta : [];
  const nivelPla = filtrado ? bs.reduce((a2, x) => a2 + (Number(x.nivel) || 0), 0)
                            : Number(pla.nivel) || 0;
  const fueraPla = filtrado
    ? plantas.filter(x => !x.nueve && plantaDeBodega(x.nom) === planta)
             .reduce((a2, x) => a2 + (Number(x.nivel) || 0), 0)
    : Number(pla.fuera) || 0;
  const sapPla = nivelPla + fueraPla;
  /*  La linea sigue a los DOS filtros: la planta y el periodo.
   *
   *  SE ARRASTRA PRIMERO Y SE RECORTA DESPUES, nunca al reves. Recortar la
   *  serie y arrastrar lo que quedo borra a las estaciones que no tuvieron
   *  movimiento en el periodo —que siguen teniendo su nivel— y el total se
   *  desploma: en noviembre, con cuatro de nueve estaciones con documento,
   *  daba 1.637 en vez de 13.607. El nivel de una estacion quieta no es cero,
   *  es el mismo del dia anterior. */
  const nivelTodo = nivelDiarioDePlanta(
    (Array.isArray(d.planta_dias) ? d.planta_dias : [])
      .filter(x => !planta || plantaDeBodega(x && x.nom) === planta));
  const nivelDia = nivelTodo
    .filter(x => !periodo || String(x.dia).slice(0, String(periodo).length) === String(periodo));
  // El ultimo dia de la serie ENTERA, no el del periodo: es contra ese que se
  // dice si el dia elegido es el cierre vigente o uno del pasado.
  const ultimoDia = nivelTodo.length ? nivelTodo[nivelTodo.length - 1].dia : null;
  /*  EL CALENDARIO NO CABE EN LA TARJETA. Un mes son cinco filas de seis
   *  celdas y la tarjeta mide 343px: quedaba de 751px de alto contra 128 de
   *  sus vecinas, con la fila entera descuadrada y un hueco negro al lado.
   *  Vive en el cajon de detalle, que es ancho. Aca queda la barrita, que
   *  cabe, y las tres filas, que son el dato nuevo. */
  const semPla = ultimaSemana({ dias: nivelDia }, 7);
  let semRot = null;
  if (semPla.length) {
    let lo = Infinity, hi = -Infinity;
    for (const x of semPla) { if (x.cierre < lo) lo = x.cierre; if (x.cierre > hi) hi = x.cierre; }
    const fin = semPla[semPla.length - 1];
    /*  Con un periodo puesto la serie NO tiene por que cerrar en el saldo de
     *  hoy: cierra donde termina ese periodo. Reclamar un descalce ahi seria
     *  una alarma falsa, asi que el rotulo cambia en vez de acusar. */
    const calza = fin.cierre === nivelPla;
    semRot = 'nivel del ' + esc(semPla[0].dia) + ' al ' + esc(fin.dia) +
      '<br>entre <b>' + mil(lo) + '</b> y <b>' + mil(hi) + '</b> · ' +
      (periodo ? 'cierra en <b>' + mil(fin.cierre) + '</b> al ' + esc(fin.dia)
       : calza ? 'cierra en <b>' + mil(fin.cierre) + '</b>, el mismo saldo que SAP'
               : '<span class="malo">la serie cierra en ' + mil(fin.cierre) + ' y SAP dice ' +
                 mil(nivelPla) + ': ' + conSigno(fin.cierre - nivelPla) +
                 ' de diferencia</span>');
  }

  /*  LAS TRES FILAS QUE DEJAN DE ENREDAR A TODO EL MUNDO.
   *
   *  En REDTEC conviven dos lecturas del mismo stock de planta y las dos son
   *  correctas: el pallet sale de la bodega cuando se CREA el documento —el
   *  camion puede seguir en el patio— y la emision se FECHA cuando el cliente
   *  la recibe, que es desde cuando se le cobra arriendo. En el medio el
   *  pallet esta en el aire.
   *
   *  Escribir las tres filas juntas es lo unico que hace falta: operaciones
   *  lee la primera, finanzas la tercera, y la diferencia deja de ser un
   *  misterio porque esta nombrada. */
  const tra = d.planta_transito || null;
  const porCrea = (d.planta_fecha_serie || null) === 'CreaDate';
  let trio = null;
  if (tra && !tra.medible)
    trio = { aun: tra.motivo || 'el tránsito todavía no se puede medir' };
  else if (tra && porCrea && !filtrado)
    trio = [{ q: 'En planta', v: nivelPla, m: 'lo que hay en bodega' },
            { q: 'En tránsito a cliente', v: Number(tra.pallets) || 0,
              m: 'salió, el cliente todavía no lo recibe' },
            { q: 'Por fecha contable', v: nivelPla + (Number(tra.pallets) || 0),
              m: 'lo que cuadra con la cartola', pie: true }];
  else if (tra && porCrea && filtrado)
    trio = { aun: 'el tránsito se mide sobre las nueve bodegas juntas, no se reparte por planta' };

  t.push({ clave: 'planta', et: 'Planta · indicador',
           hint: filtrado ? mil(bs.length) + ' en ' + esc(planta) : 'nueve bodegas',
           kv: mil(nivelPla), u: 'pallets', ambito: 'planta',
           bullet: { v: nivelPla, tope: sapPla, marca: sapPla },
           ks: fueraPla
                 ? '<b>' + mil(fueraPla) + '</b> más en merma, extraños y tránsito ' +
                   '<span class="mut">— referencial, no suman</span>'
                 : '<span class="mut">sin bodegas de referencia fuera del indicador' +
                   (filtrado ? ' en ' + esc(planta) : '') + '</span>',
           sem: semPla, semTipo: 'nivel', semRot, trio,
           nota: periodo ? 'Este saldo es la lectura de hoy en SAP, no el del período: ' +
                           'un saldo no se filtra por fecha. Lo que cambia con el período es el ' +
                           'movimiento — la línea de abajo y los días en negativo.' : null,
           chip: null });

  t.push({ clave: 'atribucion', et: 'Atribución por socio', hint: 'socios / bodega', ambito: 'global', kv: pct1(atrib, (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0)), u: '',
           ks: 'clientes <b>' + pct1(cli.socios, cli.nivel) + '</b> · retail <b>' + pct1(ret.socios, ret.nivel) + '</b>',
           bullet: { v: atrib, tope: (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0),
                     marca: (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0) },
           chip: null });

  t.push({ clave: 'residuo', et: 'Sin ubicación', hint: 'bodega − socios', ambito: 'global', kv: mil(residuo), u: 'pallets',
           ks: 'retail <b>' + mil(ret.residuo) + '</b> · clientes <b>' + mil(cli.residuo) + '</b>' +
               '<br><span class="mut">ubicaciones que existen para el pallet sin dueño identificado</span>',
           chip: residuo > 0 ? { c: 'warn', t: pct1(residuo, d.pool) + ' del pool' } : null });

  const anio = (d && d.anio) || {};
  t.push({ clave: 'anio', et: 'Movimiento del año', hint: 'neto salido', ambito: 'global', kv: conSigno((Number(anio.ret) || 0) + (Number(anio.cli) || 0)), u: 'pallets',
           ks: 'retail <b>' + conSigno(anio.ret) + '</b> · clientes <b>' + conSigno(anio.cli) + '</b>' +
               '<br><span class="mut">positivo = pallet que salió de REDTEC</span>',
           chip: null });

  t.push({ clave: 'negativos', et: 'Días en negativo', hint: 'cierre < 0', ambito: 'planta', kv: mil(neg), u: 'de ' + mil(dias),
           ks: neg ? 'en <b>' + mil(bs.filter(x => x.salud.n).length) + '</b> de ' + mil(bs.length) +
                     ' estaciones<br><span class="mut">es la fecha del documento en SAP, no el cálculo</span>'
                   : 'ninguna estación cierra bajo cero',
           bar: { v: neg, tope: dias, c: neg ? 'var(--crit)' : 'var(--good)' },
           chip: neg ? { c: 'crit', t: pct1(neg, dias) + ' de los días' } : { c: 'good', t: 'sin negativos' } });

  const cob = ctrl.find(c => /cobertura/i.test(c.titulo || ''));
  t.push({ clave: 'cobertura', et: 'Cobertura', hint: 'docs SAP vs nuestros', ambito: 'global', kv: cob ? '100' : '—', u: cob ? '%' : '',
           ks: cob ? esc(recortar(cob.texto, 120))
                   : 'el control de cobertura no vino en esta corrida',
           chip: cob ? { c: 'good', t: 'medido el ' + esc(cob.medido || d.extra_medido || 's/f') }
                     : { c: 'nodata', t: 'sin dato' } });

  t.push({ clave: 'controles', et: 'Controles', hint: 'pasan / total', ambito: 'global', kv: mil(ctrl.length - fallan.length), u: 'de ' + mil(ctrl.length),
           ks: fallan.length ? 'no pasan: <b>' + fallan.map(c => esc(c.titulo)).join('</b>, <b>') + '</b>'
                             : 'todos los controles pasan',
           bar: { v: ctrl.length - fallan.length, tope: ctrl.length || 1,
                  c: fallan.length ? 'var(--warn)' : 'var(--good)' },
           chip: fallan.length ? { c: 'warn', t: mil(fallan.length) + ' sin pasar' } : { c: 'good', t: 'al día' } });

  return t;
}

/*  EL DATO QUE VIAJA AL NAVEGADOR.
 *
 *  Todo menos las dos listas de socios, que son el 80% del json y no las usa
 *  ninguna tarjeta. planta_dias tampoco viaja aca: ya va publicado aparte y
 *  comprimido como PD, y se vuelve a pegar en el navegador. Duplicarlo seria
 *  mandar la misma serie dos veces. */
function datosPublicables(d) {
  const o = {};
  for (const k of Object.keys(d || {}))
    if (k !== 'retail' && k !== 'clientes' && k !== 'planta_dias') o[k] = d[k];
  return o;
}

/*  LOS DIAS Y LOS MESES QUE EL SELECTOR PUEDE OFRECER.
 *
 *  Los que EXISTEN, no los del calendario. Hoy el detalle diario llega hasta
 *  donde se extrajo —dos meses— y el resto del año todavia no esta: un
 *  selector que ofreciera enero devolveria una pagina vacia y se leeria como
 *  "en enero no pasó nada". Por eso el selector dice ademas hasta donde
 *  alcanza el dato, en vez de dejar que el usuario lo descubra. */
function periodosDeSerie(serie) {
  const vistos = {}, dias = [];
  for (const b of (Array.isArray(serie) ? serie : []))
    for (const x of ((b && b.dias) || [])) {
      const f = String(x && x.dia).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(f) && !vistos[f]) { vistos[f] = true; dias.push(f); }
    }
  dias.sort();
  const meses = [];
  for (const f of dias) { const m = f.slice(0, 7); if (meses.indexOf(m) < 0) meses.push(m); }
  return { dias, meses, desde: dias[0] || null, hasta: dias[dias.length - 1] || null };
}

/*  LA SERIE RECORTADA AL PERIODO.
 *
 *  Un recorte por fecha cambia el MOVIMIENTO, no el saldo: el indicador que
 *  publica la tarjeta es la lectura viva de SAP y no depende de que mes se
 *  este mirando. Eso la pagina lo dice; aca solo se recorta lo que si
 *  corresponde recortar. */
function serieDelPeriodo(serie, periodo) {
  const p = String(periodo || '');
  if (!p) return Array.isArray(serie) ? serie : [];
  return (Array.isArray(serie) ? serie : []).map(b => Object.assign({}, b, {
    dias: ((b && b.dias) || []).filter(x => String(x && x.dia).slice(0, p.length) === p),
  }));
}

/*  Los conteos de los chips de salud son del subconjunto, no del total: con
 *  SANTIAGO puesto, "Crítica 3" seria mentira si Santiago tiene una. */
function contarSalud(bodegas) {
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const out = { '': bs.length };
  for (const k of Object.keys(ORDEN_SALUD)) out[k] = bs.filter(b => b.salud.nivel === k).length;
  return out;
}

/*  LAS DECISIONES.
 *
 *  Un tablero que solo informa deja al lector preguntandose que hacer. Esta
 *  franja sale del dato —los controles que no pasan y las estaciones criticas— mas
 *  los pendientes que el proyecto ya tiene declarados. Lo que sale del dato se
 *  recalcula solo; lo declarado lleva su responsable. */
function decisiones(d, bodegas) {
  const out = [];
  for (const c of (Array.isArray(d && d.controles) ? d.controles : []))
    if (c.estado === 'no pasa')
      out.push({ ico: '!', cls: 'crit', t: String(c.titulo) + ' no pasa',
                 m: recortar(c.texto, 150), v: 'control' });
  for (const b of (Array.isArray(bodegas) ? bodegas : []))
    if (b.salud.nivel === 'critica')
      out.push({ ico: '◆', cls: 'critica', t: b.nom + ' cierra en negativo ' + mil(b.salud.n) + ' de ' + mil(b.salud.de) + ' días',
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
  /*  EL SEMAFORO DE SALUD TIENE SU PROPIA PALETA, fuera del rojo y del verde,
   *  porque esos dos ya significan tipo de pallet. Los valores salen de una
   *  busqueda en OKLCH con tres condiciones duras: contraste >= 4,5:1 contra
   *  la superficie, separacion >= 12 entre los tres estados tambien simulando
   *  deuteranopia, protanopia y tritanopia, y >= 11 de distancia a cada color
   *  ya usado en la pagina (marca, clientes, retail, planta). El violeta puro
   *  NO pasaba: para un dicromata atencion y critica se juntaban en 5,2, asi
   *  que la rampa separa por luminosidad ademas de por tono. */
  --sana:#c6bff8; --atencion:#b07cf7; --critica:#e0529f;
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
  --sana:#8864c0; --atencion:#6331a0; --critica:#3d006f;
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
.dialab{display:inline-flex;align-items:center;gap:6px;font:700 10.5px Inter;letter-spacing:.5px;
  text-transform:uppercase;color:var(--ink3)}
.dialab select{background:var(--card);border:1px solid var(--line);color:var(--ink);
  border-radius:999px;padding:6px 10px;font:600 12px "JetBrains Mono",ui-monospace,monospace;
  min-height:32px;cursor:pointer}
.dialab select:focus-visible{outline:2px solid var(--marca);outline-offset:2px}
/*  Hasta donde llega el dato va escrito al lado del selector, no escondido en
    el metodo: que el selector no ofrezca enero no explica por si solo que
    enero no esta extraido todavia. */
.cobertura{flex-basis:100%;color:var(--ink2);font-size:11.5px;margin-top:3px}
.cobertura b{color:var(--ink2);font-family:"JetBrains Mono",ui-monospace,monospace}

/* los tres relojes: cada pildora dice que gobierna, y la que va mas alla
   de la lectura lleva su marca */
.pill.futura{border-color:color-mix(in srgb,var(--warn) 55%,transparent)}
.pill .av{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;
  background:var(--warn);color:#1a1205;font:700 10px Inter;margin-left:3px}
/*  Las cifras que el filtro de planta NO alcanza se atenuan y lo dicen. El
    rotulo esta siempre en el html y solo se muestra al filtrar: asi una
    pagina sin javascript nunca ensena un numero global disfrazado de local. */
/*  Las tres filas van en tabla y no en prosa: la de abajo es la suma de las
    dos de arriba y eso se lee de una sola mirada en una columna alineada. */
table.trio{width:100%;border-collapse:collapse;margin-top:11px;font-size:12px}
table.trio td{padding:6px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.trio td.num{text-align:right;white-space:nowrap;font-weight:600;
  font-family:"JetBrains Mono",ui-monospace,monospace}
table.trio .m{color:var(--ink3);font-size:10px;margin-top:2px}
table.trio tr.pie td{border-bottom:none;border-top:1.5px solid var(--line2);font-weight:700}
table.trio tr.pie td.num{color:var(--ink)}
.nota-periodo{margin-top:10px;padding:7px 9px;border-radius:8px;background:var(--card2);
  border:1px solid var(--line2);color:var(--ink2);font-size:10.5px;line-height:1.45}
.fuera-de-filtro{display:none;margin-top:10px;padding:8px 10px;border-radius:8px;
  background:var(--card2);border:1px dashed var(--line2);color:var(--ink2);
  font-size:11.5px;line-height:1.5}
/*  animation:none es obligatorio, no decorativo: la entrada escalonada termina
    con opacity:1 en su keyframe y una animacion le gana a una declaracion
    normal, asi que sin esto la tarjeta se queda opaca y el atenuado no se ve. */
.grid.filtrando [data-ambito="global"]{animation:none;opacity:.45;filter:saturate(.35)}
.grid.filtrando [data-ambito="global"]:hover,
.grid.filtrando [data-ambito="global"]:focus-within{opacity:.85;filter:none}
.grid.filtrando [data-ambito="global"] .fuera-de-filtro{display:block}
.aviso-fecha{margin:14px 0 0;padding:10px 13px;border-radius:10px;background:var(--card);
  border:1px solid color-mix(in srgb,var(--warn) 45%,var(--line));color:var(--ink2);
  font-size:12px;line-height:1.55;max-width:96ch}

/* titular */
.headline{margin:16px 0 4px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.headline h2{margin:0;font:700 24px/1.25 Inter,sans-serif;letter-spacing:-.3px;text-wrap:balance}
.headline h2 em{font-style:normal}
.hl-critica em{color:var(--critica)} .hl-atencion em{color:var(--atencion)}
.hl-sana em{color:var(--sana)} .hl-sindato em{color:var(--ink2)}
.headline .sub{color:var(--ink2);font-size:12.5px}

/* franjas y tarjetas */
.band{margin-top:24px}
.bandh{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}
.bandh .num{width:22px;height:22px;border-radius:7px;background:var(--card2);border:1px solid var(--line);
  display:grid;place-items:center;font:700 11px "JetBrains Mono",ui-monospace,monospace;color:var(--marca);flex:none}
.bandh h3{margin:0;font:600 13.5px Inter,sans-serif;letter-spacing:.1px}
.bandh span{color:var(--ink3);font-size:11.5px}
.grid{display:grid;gap:12px}
/*  align-items:start y no el estirado por defecto: la tarjeta de planta mide
    lo que mide su calendario —un mes son cinco filas— y con el estirado las
    otras tres de la fila crecian con ella, dejando 350px de caja vacia cada
    una. Que cada tarjeta mida lo suyo. */
.g4{grid-template-columns:repeat(4,minmax(0,1fr));align-items:start}
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
.card.abre{cursor:pointer}
.abrir{position:absolute;right:11px;bottom:9px;color:var(--ink3);font-size:13px;line-height:1;
  opacity:.55;transition:opacity .2s, color .2s}
.card.abre:hover .abrir,.card.abre:focus-visible .abrir{opacity:1;color:var(--marca)}
.card.abre:focus-visible{outline:2px solid var(--marca);outline-offset:2px}
/* La tabla del desglose: las filas suman y el pie es el total. El pie va con
   linea arriba para que no se lea como una fila mas. */
table.desg{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
table.desg td{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.desg td.num{text-align:right;white-space:nowrap;font-family:"JetBrains Mono",ui-monospace,monospace;
  font-weight:600;width:1%}
table.desg .m{color:var(--ink3);font-size:10.5px;margin-top:3px;line-height:1.4;max-width:58ch}
table.desg tfoot td{border-top:1.5px solid var(--line2);border-bottom:none;padding-top:9px;
  font:700 12px Inter;text-transform:uppercase;letter-spacing:.05em}
table.desg tfoot td.num{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px}
table.desg.ref{color:var(--ink2)}
table.desg.ref tbody td{opacity:.8}
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
/*  Las nueve en una sola grilla: antes eran nueve filas con mini-serie cada
    una y el panel media mas de una pantalla. */
.bgr{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px}
.bg{border:1px solid var(--line);background:var(--card2);border-radius:10px;padding:9px 11px;
  display:flex;flex-direction:column;gap:1px}
.bg .bgn{font:600 11.5px/1.3 Inter;color:var(--ink)}
.bg .bgc{font-size:9.5px;color:var(--ink2)}
.bg b{font:700 17px/1.2 "JetBrains Mono",ui-monospace,monospace;color:var(--ink);margin-top:3px}
.bgt{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:9px;
  padding-top:8px;border-top:1.5px solid var(--line2);font:600 12px Inter;color:var(--ink2)}
.bgt b{font:700 16px "JetBrains Mono",ui-monospace,monospace;color:var(--ink)}
.cmeses{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px}
.calen{margin-top:12px}
.calen .cz{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:5px}
.calen .cz b{font:700 10.5px Inter;letter-spacing:.4px;text-transform:uppercase;color:var(--ink2)}
.calen .cz span{font-size:10px;color:var(--ink2)}
.calen .cg{display:grid;gap:3px}
.calen .ch{font:700 9px Inter;letter-spacing:.4px;text-transform:uppercase;color:var(--ink2);
  text-align:center;padding-bottom:1px}
/*  La celda es un boton de verdad y no un div con onclick: asi entra en el
    orden de tabulacion, responde al Enter y un lector de pantalla la anuncia
    con su dia y su cierre sin que haya que describirla aparte. */
.cd{border:1px solid var(--line);background:var(--card2);border-radius:8px;padding:4px 1px 5px;
  display:flex;flex-direction:column;align-items:center;cursor:pointer;color:inherit;
  font:inherit;text-align:center;min-height:52px;transition:border-color .12s,background .12s}
.cd:hover{border-color:var(--line2)}
.cd:focus-visible{outline:2px solid var(--pla);outline-offset:1px}
.cd.sel{border-color:var(--pla);background:color-mix(in srgb,var(--pla) 15%,var(--card2))}
.cd.vac{border-color:transparent;background:transparent;cursor:default;min-height:0;padding:0}
.cd .cn{font:600 9px/1.2 Inter;color:var(--ink2)}
.cd b{font:700 12px/1.3 "JetBrains Mono",ui-monospace,monospace;color:var(--ink)}
.cd.neg b{color:var(--crit)}
.cd .ce,.cd .cs{font:500 8.5px/1.25 "JetBrains Mono",ui-monospace,monospace;color:var(--ink2)}
.calen .cpie{margin-top:7px;padding:6px 8px;border-radius:8px;background:var(--card2);
  border:1px solid var(--line);color:var(--ink2);font-size:10.5px;line-height:1.5}
.calen .cdia{margin-top:6px;font-size:10.5px;line-height:1.5;color:var(--ink2)}
.calen .cdia:empty{display:none}
.calen .cpie b{color:var(--ink);font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px}
.mtx{display:grid;gap:5px;margin-top:4px;overflow-x:auto}
.mtx .hd{font:700 10px Inter;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);
  display:flex;align-items:center;justify-content:center;text-align:center;padding:4px 2px}
.mtx .rh{justify-content:flex-start;padding-left:2px}
.cel{border-radius:9px;border:1px solid var(--line);background:var(--card2);min-height:52px;
  display:grid;place-items:center;gap:1px;padding:6px 4px;text-align:center;font-size:10.5px}
/*  El glifo se tira hacia la tinta: el color de salud puro sobre su propio
    tinte daba 3,7 de contraste, y a 15px eso no alcanza. La mezcla oscurece
    en claro y aclara en oscuro sin cambiar de que color es. */
.cel b{font:700 15px/1 Inter;display:block;color:color-mix(in srgb,currentColor 78%,var(--ink))}
.cel small{color:var(--ink2);font-size:9.5px;display:block}
.c-sana{background:color-mix(in srgb,var(--sana) 11%,var(--card2));border-color:color-mix(in srgb,var(--sana) 45%,transparent);color:var(--sana)}
.c-atencion{background:color-mix(in srgb,var(--atencion) 11%,var(--card2));border-color:color-mix(in srgb,var(--atencion) 45%,transparent);color:var(--atencion)}
.c-critica{background:color-mix(in srgb,var(--critica) 12%,var(--card2));border-color:color-mix(in srgb,var(--critica) 50%,transparent);color:var(--critica)}
.c-sindato{color:var(--nodata)}
/*  El cruce que NO existe se pinta apagado a proposito —no es una celda sana—
    pero legible: un glifo a 2,5 de contraste no comunica "no existe", se lee
    como un defecto de render. */
.c-vacio{opacity:.55;color:var(--ink2);background:transparent}

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
.i-critica{color:var(--critica)} .i-atencion{color:var(--atencion)}
.i-sana{color:var(--sana)} .i-sindato{color:var(--nodata)}
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
.s-sana{color:var(--sana)} .s-atencion{color:var(--atencion)} .s-critica{color:var(--critica)} .s-sindato{color:var(--nodata)}

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

/* la mini-serie de cierres de la semana, dentro de la fila del desglose */
.sem{display:flex;align-items:center;gap:9px;margin-top:6px;flex-wrap:wrap}
.sem .m{color:var(--ink3);font-size:10.5px;line-height:1.4}
svg.mini{width:122px;height:34px;flex:none;display:block;overflow:visible}
svg.mini .mp{fill:var(--pla)}
svg.mini .mb{fill:var(--crit)}
svg.mini .mej{stroke:var(--line2);stroke-width:1}
svg.mini.nivel .mn{fill:none;stroke:var(--pla);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
svg.mini.nivel .mna{fill:var(--pla);opacity:.15;stroke:none}
svg.mini.nivel .mnp{fill:var(--pla);opacity:.55}
svg.mini.nivel .mnu{fill:var(--pla);stroke:var(--card);stroke-width:1.5}
.card .sem{margin-top:11px;align-items:flex-start}
.card .sem .m{line-height:1.5}

/* los meses del cajon de estacion: solo los que esa estacion tiene */
.dmes{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 2px}
.dmes .chip{padding:5px 11px;min-height:28px;font-size:11.5px}
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

/*  LA TARJETA ABRE SU DESGLOSE.
 *
 *  La flecha de la esquina es la que avisa que hay algo abajo; sin ella nadie
 *  descubre que la tarjeta se puede abrir. Va con role y tabindex porque es un
 *  boton de verdad, aunque se vea como una tarjeta. */
function tarjetaHtml(t, i) {
  const H = ['<div class="card lift rise' + (t.clave ? ' abre' : '') + '"' +
             (t.ambito ? ' data-ambito="' + esc(t.ambito) + '"' : '') +
             (t.clave ? ' data-kpi="' + esc(t.clave) + '" role="button" tabindex="0"' +
                        ' aria-label="Ver cómo se compone: ' + esc(t.et) + '"' : '') +
             ' style="animation-delay:' + (i * 45) + 'ms">'];
  H.push('<div class="ct"><h4>' + esc(t.et) + '</h4><span class="hint">' + esc(t.hint) + '</span></div>');
  if (t.clave) H.push('<span class="abrir" aria-hidden="true">↗</span>');
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
  if (t.trio && Array.isArray(t.trio)) {
    H.push('<table class="trio">' + t.trio.map(r =>
      '<tr' + (r.pie ? ' class="pie"' : '') + '><td>' + esc(r.q) +
      '<div class="m">' + esc(r.m) + '</div></td><td class="num">' +
      (r.v == null ? '—' : mil(r.v)) + '</td></tr>').join('') +
      '</table>');
  } else if (t.trio && t.trio.aun) {
    H.push('<div class="nota-periodo">En tránsito a cliente: ' + esc(t.trio.aun) + '</div>');
  }
  if (t.nota) H.push('<div class="nota-periodo">' + esc(t.nota) + '</div>');
  if (t.sem && t.sem.length)
    H.push('<div class="sem">' +
           (t.semTipo === 'nivel' ? miniNivel(t.sem) : miniSemana(t.sem)) +
           (t.semRot ? '<span class="m">' + t.semRot + '</span>' : '') + '</div>');
  H.push(chipEstado(t.chip));
  /*  El rotulo va escrito siempre y oculto por CSS. Si se armara en el
   *  navegador al filtrar, una pagina con el javascript caido mostraria el
   *  numero global sin el aviso, que es justo el caso peligroso. */
  if (t.ambito === 'global')
    H.push('<div class="fuera-de-filtro">Esta cifra no se filtra por planta: ' +
           'es de clientes y retail o de toda la extracción.</div>');
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
    '<span class="v ' + (x.cls === 'crit' ? 'malo' : x.cls === 'critica' ? 's-critica' : '') +
    '">' + esc(x.v) + '</span></div>').join('') + '</div>';
}

/*  CÓMO SE COMPONE CADA CIFRA PUBLICADA.
 *
 *  Una tarjeta que dice 12.601 y no deja ver de dónde salen obliga a creerle.
 *  Cada tarjeta abre su desglose, y el desglose SUMA: las filas tienen que dar
 *  el total declarado. Cuando no dan —y hay un caso real, el detalle del
 *  residuo, que se midió en otra fecha— el panel dice la diferencia en vez de
 *  mostrar un cuadro que no cuadra.
 *
 *  El bloque 'extra' es para lo que acompaña pero NO suma: ahí van las
 *  bodegas fuera del indicador. Va aparte a propósito, nunca mezclado con las
 *  filas que sí suman. */
function desglose(clave, titulo, kv, u, intro, filas, total, extra, nota) {
  const fs = (filas || []).filter(f => f);
  const numericas = fs.filter(f => f.v != null);
  const suma = numericas.reduce((a, f) => a + (Number(f.v) || 0), 0);
  const t = total || null;
  const cuadra = !t || numericas.length === 0 || suma === Number(t.v);
  return { clave, titulo, kv, u, intro, filas: fs, total: t,
           suma, cuadra, descuadre: t ? suma - Number(t.v) : 0,
           extra: extra || null, nota: nota || null };
}

/*  EL ORDEN DEL RECORRIDO: inspeccion primero, disponible al final, y dentro
 *  de cada etapa la planta grande antes. Es el orden que explica el camino del
 *  pallet, distinto del de la tabla —que ordena por salud, o sea por lo que
 *  hay que mirar primero—. Dos ordenes porque son dos preguntas distintas. */
function porRecorrido(bodegas) {
  const paso = e => { const i = ETAPAS.indexOf(e); return i < 0 ? ETAPAS.length : i; };
  return (Array.isArray(bodegas) ? bodegas : []).slice()
    .sort((a, b) => paso(a.etapa) - paso(b.etapa) || b.nivel - a.nivel ||
                    (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0));
}

function composiciones(datos, bodegas) {
  const d = datos || {};
  const b = d.bodegas || {};
  const cli = b.CLIENTES || {}, ret = b.RETAIL || {}, pla = b.PLANTA || {};
  const bs = Array.isArray(bodegas) ? bodegas : [];
  const plantas = Array.isArray(d.planta) ? d.planta : [];
  const ctrl = Array.isArray(d.controles) ? d.controles : [];
  const fueras = plantas.filter(p => !p.nueve && p.nivel !== 0);
  const bloqueFuera = {
    a: 'Fuera del indicador — no suma',
    filas: fueras.map(p => ({ a: p.nom, b: p.cod, v: p.nivel })),
    v: Number(d.fuera_del_pool) || 0,
  };
  const C = {};

  C.pool = desglose('pool', 'Reparto del pool', mil(d.pool), 'pallets',
    'El pallet rojo que está rotando, repartido en las tres patas. Cada pata es una bodega de SAP ' +
    'y su saldo lo dicta SAP, no un cálculo nuestro.',
    [{ a: 'Clientes', b: 'BODEGA CLIENTES', v: Number(cli.nivel) || 0 },
     { a: 'Retail', b: 'BODEGA RETAILERS', v: Number(ret.nivel) || 0 },
     { a: 'Planta REDTEC', b: 'las nueve bodegas del indicador', v: Number(pla.nivel) || 0 }],
    { a: 'Pool', v: Number(d.pool) || 0 }, bloqueFuera,
    'Contándolos, SAP tiene ' + mil(d.pool_sap) + ' en bodega. No son pallet perdido: están en ' +
    'bodegas de SAP que no participan del recorrido, así que sumarlos infla el pool.');

  /*  La serie cruda por codigo: bodegasDelCockpit resume los dias en un numero
   *  —cuantos hay— y aca hacen falta los dias mismos para la mini-serie. */
  const crudas = {};
  for (const x of (Array.isArray(d.planta_dias) ? d.planta_dias : []))
    if (x && x.cod != null) crudas[String(x.cod)] = x;

  C.planta = desglose('planta', 'Planta · indicador', mil(pla.nivel), 'pallets',
    'Las nueve estaciones del recorrido del pallet, en el orden en que lo atraviesan. ' +
    'La definición de cuáles cuentan es de negocio, no de SAP: está declarada en el código.',
    porRecorrido(bs).map(x => ({ a: x.nom, b: x.cod + ' · ' + x.etapa.charAt(0) + x.etapa.slice(1).toLowerCase(),
                                 cod: x.cod, v: x.nivel })),
    { a: 'Indicador de planta', v: Number(pla.nivel) || 0 }, bloqueFuera,
    'Una estación en cero no es un dato que falte: es una estación vacía, y eso es información. ' +
    'El calendario de abajo deja elegir cualquier día: al hacerlo, la cifra de arriba y las nueve ' +
    'estaciones pasan a mostrar su cierre de ESE día, no el de hoy.');
  /*  LA GRILLA Y EL CALENDARIO VAN EN EL CAJON Y NO EN LA TARJETA. Un mes son
   *  cinco filas de seis celdas: en una tarjeta de 343px quedaba de 751px de
   *  alto contra 128 de sus vecinas. Aca hay ancho de sobra. */
  C.planta.grilla = true;
  const ndPla = nivelDiarioDePlanta(Array.isArray(d.planta_dias) ? d.planta_dias : []);
  C.planta.meses = [];
  for (const x of ndPla) {
    const m = String(x.dia).slice(0, 7);
    if (C.planta.meses.indexOf(m) < 0) C.planta.meses.push(m);
  }
  C.planta.mes = C.planta.meses.length ? C.planta.meses[C.planta.meses.length - 1] : null;
  C.planta.cal = calendarioDeMes(ndPla, C.planta.mes);
  const celPla = C.planta.cal ? [].concat.apply([], C.planta.cal.semanas).filter(Boolean) : [];
  C.planta.calSel = celPla.length ? celPla[celPla.length - 1].dia : null;
  C.planta.calTra = Array.isArray(d.planta_transito_dias) ? d.planta_transito_dias : [];
  C.planta.calHoy = Number(pla.nivel) || 0;
  C.planta.calUlt = ndPla.length ? ndPla[ndPla.length - 1].dia : null;
  C.planta.trio = (d.planta_transito && d.planta_transito.medible &&
                   (d.planta_fecha_serie || null) === 'CreaDate' && C.planta.calSel)
    ? filasDelDia(C.planta.calSel, ndPla, C.planta.calTra, false) : null;

  const atribuido = (Number(cli.socios) || 0) + (Number(ret.socios) || 0);
  const bodega = (Number(cli.nivel) || 0) + (Number(ret.nivel) || 0);
  C.atribucion = desglose('atribucion', 'Atribución por socio', pct1(atribuido, bodega), '',
    'De lo que hay en las dos bodegas de afuera, cuánto se puede decir de quién es. ' +
    'El total lo dicta la bodega; la ubicación sólo lo reparte.',
    [{ a: 'Clientes · atribuido', b: mil(cli.n) + ' socios con saldo', v: Number(cli.socios) || 0 },
     { a: 'Retail · atribuido', b: mil(ret.n) + ' socios con saldo', v: Number(ret.socios) || 0 }],
    { a: 'Atribuido a un socio', v: atribuido },
    { a: 'Sin ubicación — el resto de la bodega',
      filas: [{ a: 'Clientes', b: 'residuo', v: Number(cli.residuo) || 0 },
              { a: 'Retail', b: 'residuo', v: Number(ret.residuo) || 0 }],
      v: (Number(cli.residuo) || 0) + (Number(ret.residuo) || 0) },
    mil(atribuido) + ' de ' + mil(bodega) + ' que suman las dos bodegas: ' +
    pct1(atribuido, bodega) + '.');

  const residuo = (Number(cli.residuo) || 0) + (Number(ret.residuo) || 0);
  const det = Array.isArray(d.residuo_detalle) ? d.residuo_detalle : [];
  C.residuo = desglose('residuo', 'Sin ubicación', mil(residuo), 'pallets',
    'Saldo de bodega menos la suma de los socios. No es pallet perdido ni un error de cálculo: ' +
    'SAP tiene ubicaciones que existen justamente para el pallet sin dueño identificado.',
    [{ a: 'Retail', b: 'BODEGA RETAILERS', v: Number(ret.residuo) || 0 },
     { a: 'Clientes', b: 'BODEGA CLIENTES', v: Number(cli.residuo) || 0 }],
    { a: 'Sin ubicación', v: residuo },
    det.length ? { a: 'Cómo se repartía al ' + esc(String(d.extra_medido || 's/f')) +
                      ' — medido aparte, no se recalcula solo',
                   filas: det.map(x => ({ a: recortar(x.que, 120), b: null, v: Number(x.cantidad) || 0 })),
                   v: det.reduce((a, x) => a + (Number(x.cantidad) || 0), 0) } : null,
    det.length ? 'El desglose se midió el ' + esc(String(d.extra_medido || 's/f')) +
                 ' y suma ' + mil(det.reduce((a, x) => a + (Number(x.cantidad) || 0), 0)) +
                 '; el residuo de hoy es ' + mil(residuo) + '. La corrida diaria rehace el residuo ' +
                 'pero no el reparto, así que esa diferencia es de fecha, no de cálculo.' : null);

  const meses = Array.isArray(d.meses) ? d.meses : [];
  const anio = (Number(d.anio && d.anio.ret) || 0) + (Number(d.anio && d.anio.cli) || 0);
  C.anio = desglose('anio', 'Movimiento del año', conSigno(anio), 'pallets',
    'Cuánto subió o bajó cada bodega, mes a mes. Un valor positivo es pallet que salió de REDTEC ' +
    'hacia el socio; uno negativo es pallet que volvió.',
    meses.map(m => ({ a: esc(m.etiqueta), b: 'retail ' + conSigno(m.ret) + ' · clientes ' + conSigno(m.cli),
                      v: (Number(m.ret) || 0) + (Number(m.cli) || 0) })),
    { a: 'Neto del año', v: anio }, null,
    'Retail ' + conSigno(d.anio && d.anio.ret) + ' y clientes ' + conSigno(d.anio && d.anio.cli) +
    ' en el año. Sale del diario de movimientos de inventario (OINM), agrupado por mes de fecha ' +
    'de documento — por eso un posteo retroactivo mueve un mes ya cerrado.');

  const conNeg = bs.filter(x => x.salud.n > 0);
  const dias = bs.reduce((a, x) => a + x.dias, 0);
  const neg = bs.reduce((a, x) => a + x.salud.n, 0);
  C.negativos = desglose('negativos', 'Días en negativo', mil(neg), 'de ' + mil(dias),
    'Días en que una estación cierra bajo cero. Es imposible —no hay media bodega de pallets en ' +
    'menos— y la causa está identificada: la fecha del documento en SAP.',
    conNeg.map(x => ({ a: x.nom, b: x.cod + ' · de ' + mil(x.dias) + ' días medidos · peor el ' +
                          (x.peor ? x.peor.dia : '—') + ' en ' + mil(x.peor ? x.peor.cierre : 0),
                       v: x.salud.n })),
    { a: 'Días bajo cero', v: neg },
    { a: 'Estaciones que no cierran bajo cero ningún día',
      filas: bs.filter(x => x.salud.n === 0 && x.dias)
               .map(x => ({ a: x.nom, b: x.cod + ' · ' + mil(x.dias) + ' días', v: 0 })), v: 0 },
    'La salida de mercancías queda fechada antes que el traspaso que la alimenta, así que el ' +
    'nivel cae antes de subir. Se verificó contra OINM por otra vía: da los mismos días y los ' +
    'mismos números. Se arregla en SAP, no acá.');

  const cob = ctrl.find(c => /cobertura/i.test(c.titulo || ''));
  C.cobertura = desglose('cobertura', 'Cobertura', cob ? '100' : '—', cob ? '%' : '',
    'Cuántos documentos de SAP llegaron a nuestra extracción. Es el control que dice si falta algo.',
    cob ? [{ a: String(cob.titulo), b: String(cob.texto || ''), v: null }] : [],
    null, null,
    cob ? 'Medido el ' + esc(String(cob.medido || d.extra_medido || 's/f')) + '.'
        : 'El control de cobertura no vino en esta corrida, así que no hay con qué responder. ' +
          'No se inventa un 100%.');

  C.controles = desglose('controles', 'Controles', mil(ctrl.length - ctrl.filter(c => c.estado === 'no pasa').length),
    'de ' + mil(ctrl.length),
    'Cada control con su resultado y la fecha en que se midió. Un control que no pasa no se ' +
    'esconde: se nombra.',
    ctrl.slice().sort((a, x) => (a.estado === 'no pasa' ? 0 : 1) - (x.estado === 'no pasa' ? 0 : 1))
        .map(c => ({ a: String(c.titulo) + (c.estado === 'no pasa' ? ' · NO PASA' : ''),
                     b: String(c.texto || ''), v: null,
                     malo: c.estado === 'no pasa',
                     fecha: String(c.medido || d.extra_medido || 's/f') })),
    null, null, null);

  return C;
}

/*  LA MINI-SERIE DE CIERRES DE LA SEMANA.
 *
 *  Siete barras desde una linea de cero: arriba el cierre positivo, abajo el
 *  negativo. Sirve para ver la FORMA de la semana sin abrir el detalle — que
 *  una estacion viene cayendo, que otra rebota el mismo dia — que es lo que
 *  un numero solo no puede decir.
 *
 *  LA ESCALA ES LA DE CADA ESTACION, no una comun. Una de 7.161 y otra de 100
 *  en la misma escala dejarian la segunda plana, y una linea plana se lee como
 *  "no pasa nada" cuando lo que pasa es que la escala la aplasto. Por eso el
 *  panel lo dice en su nota: estas mini-series se comparan consigo mismas.
 *
 *  UN CIERRE EN CERO SE DIBUJA. Una marca de 1px, no nada: "cerro en cero" y
 *  "no hay dato" no son lo mismo y no pueden verse igual.  */
function miniSemana(dias) {
  const ds = (Array.isArray(dias) ? dias : []).filter(d => d && d.dia != null);
  if (!ds.length) return '';
  const An = 122, Al = 34, w = An / ds.length, hueco = 1.6;
  let tope = 0, hayNeg = false;
  for (const d of ds) {
    const v = Number(d.cierre) || 0;
    if (v < 0) hayNeg = true;
    tope = Math.max(tope, Math.abs(v));
  }
  if (!tope) tope = 1;
  /*  EL EJE BAJA AL PISO CUANDO NO HAY NINGUN CIERRE BAJO CERO. Dejarlo
   *  siempre al medio le quita la mitad del alto a una semana que nunca fue
   *  negativa, y una barra aplastada se lee como "casi nada" cuando puede ser
   *  el maximo de la estacion. La linea de cero va igual en los dos casos, asi
   *  que donde esta el cero se ve: no hay que adivinarlo por la forma. */
  const eje = hayNeg ? Al / 2 : Al - 1;
  const util = Math.max(eje - 1, 1);
  const barras = ds.map((d, i) => {
    const v = Number(d.cierre) || 0;
    const h = v === 0 ? 1 : Math.max(1.6, Math.abs(v) / tope * util);
    const y = v < 0 ? eje : eje - h;
    return '<rect x="' + (i * w + hueco / 2).toFixed(1) + '" y="' + y.toFixed(1) +
           '" width="' + (w - hueco).toFixed(1) + '" height="' + h.toFixed(1) +
           '" class="' + (v < 0 ? 'mb' : 'mp') + '">' +
           '<title>' + esc(d.dia) + ': ' + mil(v) + '</title></rect>';
  }).join('');
  return '<svg class="mini" viewBox="0 0 ' + An + ' ' + Al + '" role="img" aria-label="cierre de ' +
         ds.length + ' días, del ' + esc(ds[0].dia) + ' al ' + esc(ds[ds.length - 1].dia) + '">' +
         '<line x1="0" y1="' + eje + '" x2="' + An + '" y2="' + eje + '" class="mej"/>' +
         barras + '</svg>';
}

/*  LA MINI-SERIE DEL NIVEL DE LA PLANTA ENTERA.
 *
 *  POR QUE NO SON LAS MISMAS BARRAS QUE LAS DE CADA ESTACION. Una estacion
 *  cruza el cero todas las semanas, asi que su barra desde cero dice algo. La
 *  planta entera no: esta semana se movio entre 13.607 y 16.525, nunca cerca
 *  de cero. Dibujada en barras desde cero darian siete barras casi iguales al
 *  98% del alto, y una fila plana se lee como "no se movio" cuando en realidad
 *  oscilo casi tres mil pallets. Es exactamente el error que la escala propia
 *  evita en las estaciones.
 *
 *  ASI QUE LA BANDA ES LA DE LA SEMANA y va escrita al lado, con su minimo y
 *  su maximo: una linea sin su banda declarada puede exagerar cualquier cosa.
 *  El ultimo punto va marcado porque es el numero que la tarjeta publica.  */
function miniNivel(dias) {
  const ds = (Array.isArray(dias) ? dias : []).filter(d => d && d.dia != null);
  if (!ds.length) return '';
  const An = 122, Al = 34, pad = 3.5;
  let min = Infinity, max = -Infinity;
  for (const d of ds) {
    const v = Number(d.cierre) || 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const rango = max - min;
  const x = i => ds.length === 1 ? An / 2 : pad + (i * (An - pad * 2)) / (ds.length - 1);
  // Una semana sin variacion es una linea al medio, no una division por cero.
  const y = v => rango === 0 ? Al / 2
                             : Al - pad - ((Number(v) || 0) - min) / rango * (Al - pad * 2);
  const pts = ds.map((d, i) => x(i).toFixed(1) + ',' + y(d.cierre).toFixed(1));
  const area = 'M' + x(0).toFixed(1) + ',' + (Al - pad).toFixed(1) + ' L' + pts.join(' L') +
               ' L' + x(ds.length - 1).toFixed(1) + ',' + (Al - pad).toFixed(1) + ' Z';
  const puntos = ds.map((d, i) =>
    '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.cierre).toFixed(1) + '" r="' +
    (i === ds.length - 1 ? 3 : 1.9) + '" class="' + (i === ds.length - 1 ? 'mnu' : 'mnp') + '">' +
    '<title>' + esc(d.dia) + ': ' + mil(d.cierre) + '</title></circle>').join('');
  return '<svg class="mini nivel" viewBox="0 0 ' + An + ' ' + Al + '" role="img" ' +
         'aria-label="nivel de la planta en ' + ds.length + ' días, del ' + esc(ds[0].dia) +
         ' al ' + esc(ds[ds.length - 1].dia) + ', entre ' + mil(min) + ' y ' + mil(max) + '">' +
         '<path d="' + area + '" class="mna"/>' +
         '<polyline points="' + pts.join(' ') + '" class="mn"/>' + puntos + '</svg>';
}

/*  EL DESGLOSE DIBUJADO.
 *
 *  Corre en los dos lados: el servidor no lo usa, pero se publica con
 *  toString() y el navegador lo llama tal cual. Si la suma no da, el panel lo
 *  dice en su propia fila: un desglose que no cuadra y no lo declara es peor
 *  que no tener desglose. */
function desgloseHtml(c) {
  if (!c) return '<p class="mut">No hay desglose para esa cifra.</p>';
  const fila = f => '<tr><td>' + esc(f.a) +
    (f.b ? '<div class="m">' + esc(f.b) + '</div>' : '') +
    (f.fecha ? '<div class="m">medido el ' + esc(f.fecha) + '</div>' : '') +
    (f.sem && f.sem.length
      ? '<div class="sem">' + miniSemana(f.sem) + '<span class="m">cierre del ' +
        esc(f.sem[0].dia) + ' al ' + esc(f.sem[f.sem.length - 1].dia) + '</span></div>'
      : '') +
    '</td><td class="num' + (f.malo ? ' malo' : '') + '">' +
    (f.v == null ? '' : mil(f.v)) + '</td></tr>';
  const H = ['<div class="code">' + esc(c.clave) + '</div><h3>' + esc(c.titulo) + '</h3>'];
  H.push('<div class="kv" style="margin-top:6px">' + c.kv +
         (c.u ? '<small>' + esc(c.u) + '</small>' : '') + '</div>');
  if (c.intro) H.push('<p class="mut" style="margin:10px 0 0;max-width:62ch">' + esc(c.intro) + '</p>');
  if (c.filas.length && c.grilla) {
    H.push('<h5>Se compone de</h5>' + grillaBodegasHtml(c.filas, c.total));
  } else if (c.filas.length) {
    H.push('<h5>Se compone de</h5><table class="desg">');
    H.push('<tbody>' + c.filas.map(fila).join('') + '</tbody>');
    if (c.total)
      H.push('<tfoot><tr><td>' + esc(c.total.a) + '</td><td class="num">' + mil(c.total.v) +
             '</td></tr></tfoot>');
    H.push('</table>');
  }
  if (c.filas.length && c.total && !c.cuadra)
    H.push('<p class="malo" style="font-weight:600;margin:10px 0 0">Las filas suman ' +
           mil(c.suma) + ' y el total declarado es ' + mil(c.total.v) + ': ' +
           conSigno(c.descuadre) + ' de diferencia.</p>');
  if (c.trio && Array.isArray(c.trio))
    H.push('<table class="trio">' + c.trio.map(r =>
      '<tr' + (r.pie ? ' class="pie"' : '') + '><td>' + esc(r.q) +
      '<div class="m">' + esc(r.m) + '</div></td><td class="num">' +
      (r.v == null ? '—' : mil(r.v)) + '</td></tr>').join('') + '</table>');
  if (c.extra && c.extra.filas && c.extra.filas.length) {
    H.push('<h5>' + esc(c.extra.a) + '</h5><table class="desg ref">');
    H.push('<tbody>' + c.extra.filas.map(fila).join('') + '</tbody>');
    H.push('<tfoot><tr><td>Suma</td><td class="num">' + mil(c.extra.v) + '</td></tr></tfoot></table>');
  }
  if (c.nota) H.push('<p class="mut" style="margin:14px 0 0;max-width:62ch">' + esc(c.nota) + '</p>');
  /*  EL CALENDARIO VA AL FINAL DE TODO. Arriba esta "cuanto hay" —que es lo
   *  que se viene a buscar—; esto es "como se llego", y se mira despues. */
  if (c.cal) {
    H.push('<h5>Cierre día por día</h5>');
    if (c.meses && c.meses.length > 1)
      H.push('<div class="cmeses">' + c.meses.map(m =>
        '<button type="button" class="chip' + (m === c.mes ? ' on' : '') +
        '" data-pm="' + esc(m) + '">' + esc(etiquetaDeMes(m) || m) + '</button>').join('') + '</div>');
    H.push(calendarioHtml(c.cal, { sel: c.calSel, tope: (c.total && c.total.v) || c.calHoy,
                                   tra: c.calTra, hoy: c.calHoy, ultimo: c.calUlt }));
  }
  return H.join('');
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
  const rel = relojes(d), aviso = avisoDeFuturo(rel);
  const per = periodosDeSerie(serie);
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
  /*  Cada reloj dice que gobierna, en la pildora y en su title. Tres fechas
   *  sueltas en una cabecera se leen como tres versiones del mismo dato. */
  for (const r of rel)
    H.push('  <span class="pill' + (r.futuro ? ' futura' : '') + '" title="' +
           esc(r.etiqueta + ' ' + r.fecha + ' — gobierna ' + r.gobierna) + '">' +
           esc(r.etiqueta) + ' <b class="mono">' + esc(r.fecha) + '</b>' +
           (r.futuro ? '<span class="av" aria-label="fecha posterior a la lectura">!</span>' : '') +
           '</span>');
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
  for (const s of ['critica', 'atencion', 'sana', 'sindato']) {
    const n = cuenta('salud', s);
    if (!n) continue;
    H.push('  <button type="button" class="chip" data-f="salud" data-v="' + s + '">' +
           GLIFO[s] + ' ' + esc(NOMBRE_SALUD[s] || s) + ' <span class="n">' + n + '</span></button>');
  }
  /*  EL PERIODO. Solo los meses y los dias QUE EXISTEN, y la barra dice hasta
   *  donde llega el dato: el resto del año todavia no esta extraido, y un
   *  selector que ofreciera enero devolveria una pagina vacia que se leeria
   *  como "en enero no pasó nada". */
  if (per.meses.length) {
    H.push('  <span class="fsep"></span><span class="flabel">Período</span>');
    H.push('  <button type="button" class="chip on" data-f="periodo" data-v="">Todo <span class="n">' +
           per.dias.length + ' días</span></button>');
    for (const m of per.meses)
      H.push('  <button type="button" class="chip" data-f="periodo" data-v="' + esc(m) + '">' +
             esc(etiquetaDeMes(m)) + ' <span class="n">' +
             per.dias.filter(x => x.slice(0, 7) === m).length + '</span></button>');
    H.push('  <label class="dialab">Día <select id="seldia" aria-label="Validar un día">' +
           '<option value="">—</option>' +
           per.dias.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('') +
           '</select></label>');
    H.push('  <span class="cobertura">dato diario del <b>' + esc(per.desde) + '</b> al <b>' +
           esc(per.hasta) + '</b>; los meses anteriores todavía no están extraídos</span>');
  }
  H.push('</div>');

  // ── titular ──
  if (aviso) H.push('<div class="aviso-fecha">' + esc(aviso) + '</div>');
  H.push('<div class="headline hl-' + esc(tit.nivel) + '" id="titular"><h2>' + tit.frase + '</h2>' +
         '<span class="sub">' + tit.cola + '</span></div>');

  // ── ① ¿Como estamos? ──
  H.push('<section class="band"><div class="bandh"><span class="num">1</span>' +
         '<h3>¿Cómo estamos?</h3><span>clic en una tarjeta para ver cómo se compone esa cifra</span></div>');
  H.push('<div class="grid g4" id="kpis">' + tarjetas(d, bodegas).map(tarjetaHtml).join('') + '</div></section>');

  // ── ② ¿Donde esta el problema? ──
  H.push('<section class="band"><div class="bandh"><span class="num">2</span>' +
         '<h3>¿Dónde está el problema?</h3><span>clic en una celda para ver esa estación día por día</span></div>');
  H.push('<div class="grid g64">');
  H.push('<div class="card rise"><div class="ct"><h4>Planta × etapa del recorrido</h4>' +
         '<span class="hint">días con cierre bajo cero</span></div><div id="matriz">' + matrizHtml(m) + '</div>' +
         '<div class="legend"><span><i class="sw" style="background:var(--sana)"></i>● Sana · ningún día</span>' +
         '<span><i class="sw" style="background:var(--atencion)"></i>▲ Atención · menos de la mitad</span>' +
         '<span><i class="sw" style="background:var(--critica)"></i>◆ Crítica · la mitad o más</span>' +
         '<span><i class="sw" style="background:var(--nodata)"></i>○ Sin dato</span></div>' +
         '<div class="ks">Un nivel bajo cero es imposible: no hay media bodega de pallets en menos. ' +
         'El defecto está en la <b>fecha del documento</b> en SAP —la salida de mercancías queda fechada ' +
         'antes que el traspaso que la alimenta— y se concentra en el ingreso a inspección, no repartido ' +
         'por la planta. <span class="mut">Se arregla en SAP, no acá.</span></div></div>');
  const peores = bodegas.filter(b => b.salud.n > 0)
    .map(b => ({ ico: GLIFO[b.salud.nivel], cls: b.salud.nivel,
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
  const aper = {};
  for (const b of serie) if (b && b.cod != null) aper[String(b.cod)] = mesDeApertura(b);
  H.push(script(serie, mes0, composiciones(d, bodegas), aper, datosPublicables(d)));
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
    '<dt>Las tres fechas</dt><dd>No son tres versiones del mismo dato, son tres relojes. ' +
    '<b>Saldos SAP</b> es el día en que se leyó el saldo vivo: manda sobre el pool, el indicador ' +
    'de planta y la tabla. <b>Clientes y retail · flujos</b> es hasta dónde llega la extracción de ' +
    'movimiento de esas dos bodegas; gobierna el gráfico del año y corta en el último mes cerrado, ' +
    'y no dice nada de la planta. <b>Planta · movimiento</b> es la fecha del último documento de la ' +
    'serie diaria, que es fecha de documento y no de lectura: por eso puede ir más allá del día en ' +
    'que se leyó el saldo sin que haya contradicción — el <code>InStock</code> no mira la fecha, ' +
    'así que ese movimiento ya está contado en el saldo.</dd>' +
    '<dt>Salud de una estación</dt><dd>Mira una sola cosa: cuántos días cierra bajo cero. ' +
    '<b>Sana</b> ninguno, <b>atención</b> menos de la mitad, <b>crítica</b> la mitad o más. Lo que ' +
    'no se puede evaluar dice <b>sin dato</b> y no se pinta de sana. Los estados de salud no se ' +
    'nombran por color a propósito: en REDTEC el rojo y el verde son tipos de pallet, no ' +
    'diagnósticos, y nombrarlos igual hacía leer la salud de una estación como el color de su ' +
    'stock.</dd>' +
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
function script(serie, mes0, desg, aper, datos) {
  /*  SE PUBLICAN LAS FUNCIONES, NO UNA COPIA. El navegador recalcula los dos
   *  filtros con las MISMAS funciones que arman la pagina en el servidor, via
   *  toString(). La alternativa —precalcular cada combinacion— eran tres
   *  plantas por treinta y dos periodos: noventa y seis variantes, o escribir
   *  a mano una segunda version del calculo para el navegador, que es como se
   *  consigue que la carga inicial y el filtro digan cosas distintas. */
  const fns = [esNumero, mil, conSigno, pct, pct1, clasePos, esc, recortar, etiquetaDeMes,
               diasDelMes, resumenDelMes, altoVisible, ejeDeDias, svgFlujoDia, svgNivelDia,
               tablaDeDias, rehidratar, miniSemana, miniNivel, desgloseHtml,
               etapaDeBodega, plantaDeBodega, saludDeBodega, bodegasDelCockpit,
               matrizPlantaEtapa, matrizHtml, filaCartera, listaHtml, chipEstado,
               titular, contarSalud, nivelDiarioDePlanta, ultimaSemana,
               diaDeSemana, mesDelCalendario, calendarioDeMes, filasDelDia, pieDeDia,
               notaDeDia, calendarioHtml, pintarDia, pintarMes,
               cierreDeBodegaEn, grillaBodegasHtml,
               serieDelPeriodo, tarjetas, tarjetaHtml];
  const cuerpo = 'var MESES = ' + jsonSeguro(MESES) + ';\n' +
    'var ETAPAS = ' + jsonSeguro(ETAPAS) + ';\n' +
    'var DIA_CORTO = ' + jsonSeguro(DIA_CORTO) + ';\n' +
    'var ORDEN_SALUD = ' + jsonSeguro(ORDEN_SALUD) + ';\n' +
    'var GLIFO = ' + jsonSeguro(GLIFO) + ';\n' +
    'var NOMBRE_SALUD = ' + jsonSeguro(NOMBRE_SALUD) + ';\n' +
    fns.map(f => f.toString()).join('\n') + '\n' +
    'var PD = rehidratar(' + jsonSeguro(serieCompacta(serie)) + ');\n' +
    'var MES0 = ' + jsonSeguro(mes0) + ';\n' +
    'var APER = ' + jsonSeguro(aper || {}) + ';\n' +
    'var DAT = ' + jsonSeguro(datos || {}) + ';\n' +
    'var DESG = ' + jsonSeguro(desg || {}) + ';\n' + [
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
    '    var filtro = { planta: "", salud: "", periodo: "" };',
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
    // La entrada escalonada es para la primera vez y nada mas. Si la clase se
    // queda puesta, cada cambio de filtro vuelve a animar la rejilla entera y
    // ademas la animacion le gana al atenuado, que entonces parpadea.
    '    function quietas(raiz) {',
    '      [].forEach.call((raiz || document).querySelectorAll(".rise"), function (x) {',
    '        x.classList.remove("rise"); x.style.animationDelay = ""; });',
    '    }',
    '    setTimeout(quietas, 1100);',
    // La entrada escalonada es para la primera vez y nada mas. Si la clase se
    // queda puesta, cada cambio de filtro vuelve a animar la rejilla entera y
    // ademas la animacion le gana al atenuado, que entonces parpadea.
    '    function quietas(raiz) {',
    '      [].forEach.call((raiz || document).querySelectorAll(".rise"), function (x) {',
    '        x.classList.remove("rise"); x.style.animationDelay = ""; });',
    '    }',
    '    setTimeout(quietas, 1100);',
    '',
    // El dato que viaja no trae planta_dias —va aparte y comprimido en PD—,
    // asi que se vuelve a pegar aca antes de recalcular nada.
    '    DAT.planta_dias = PD;',
    '    function serieFiltrada() {',
    '      var s = serieDelPeriodo(PD, filtro.periodo);',
    '      if (!filtro.planta) return s;',
    '      return s.filter(function (b) { return plantaDeBodega(b.nom) === filtro.planta; });',
    '    }',
    '    function recalcular() {',
    '      var bs = bodegasDelCockpit(serieFiltrada());',
    '      var pl = filtro.planta || undefined, pe = filtro.periodo || undefined;',
    '      var t = titular(DAT, bs, pl);',
    '      var cab = $("#titular");',
    '      if (cab) { cab.className = "headline hl-" + t.nivel;',
    '        cab.innerHTML = "<h2>" + t.frase + "</h2><span class=\\"sub\\">" + t.cola + "</span>"; }',
    '      var mz = $("#matriz"); if (mz) mz.innerHTML = matrizHtml(matrizPlantaEtapa(bs));',
    '      if (cuerpoTabla) cuerpoTabla.innerHTML = bs.map(filaCartera).join("");',
    // Las ocho tarjetas se rehacen con la MISMA funcion del servidor: no hay
    // una version para la carga inicial y otra para el filtro.
    '      var tj = tarjetas(DAT, bs, pl, pe), rej = $("#kpis");',
    '      if (rej) { rej.innerHTML = tj.map(tarjetaHtml).join("");',
    '        rej.classList.toggle("filtrando", !!pl); }',
    '      var cs = contarSalud(bs);',
    '      [].forEach.call(filtros.querySelectorAll(\'.chip[data-f="salud"]\'), function (x) {',
    '        var n = x.querySelector(".n"), k = x.getAttribute("data-v");',
    '        if (n && cs[k] != null) n.textContent = cs[k];',
    '        x.hidden = !!(k && !cs[k]);',
    '      });',
    '      quietas();',
    '      aplicar();',
    '    }',
    '    if (filtros) filtros.addEventListener("click", function (e) {',
    '      var c = e.target.closest(".chip"); if (!c) return;',
    '      var f = c.getAttribute("data-f");',
    '      filtro[f] = c.getAttribute("data-v");',
    '      [].forEach.call(filtros.querySelectorAll(\'.chip[data-f="\' + f + \'"]\'), function (x) {',
    '        x.classList.toggle("on", x === c); });',
    // cambiar de planta rehace la tabla, asi que el filtro de salud se vuelve
    // a aplicar despues: si no, las filas nuevas entran todas visibles
    '      if (f === "periodo" && seldia) seldia.value = "";',
    '      recalcular();',
    '    });',
    // El selector de dia y los chips de periodo son el mismo filtro: elegir un
    // dia apaga el chip de mes y viceversa, para que no queden dos periodos
    // puestos diciendo cosas distintas.
    '    var seldia = $("#seldia");',
    '    if (seldia) seldia.addEventListener("change", function () {',
    '      filtro.periodo = seldia.value;',
    '      [].forEach.call(filtros.querySelectorAll(\'.chip[data-f="periodo"]\'), function (x) {',
    '        x.classList.toggle("on", !seldia.value && x.getAttribute("data-v") === ""); });',
    '      recalcular();',
    '    });',
    '',
    '    var drawer = $("#drawer"), scrim = $("#scrim"), dbody = $("#dbody"), ultimo = null;',
    '    function cerrar() {',
    '      drawer.classList.remove("on"); scrim.classList.remove("on");',
    '      if (ultimo && ultimo.focus) ultimo.focus();',
    '    }',
    '    function mesesDe(b) {',
    '      var visto = {}, out = [], i, m;',
    '      for (i = 0; i < b.dias.length; i++) {',
    '        m = String(b.dias[i].dia).slice(0, 7);',
    '        if (!visto[m]) { visto[m] = 1; out.push(m); }',
    '      }',
    '      return out.sort();',
    '    }',
    '    function abrir(cod, mes) {',
    '      var b = null, i;',
    '      for (i = 0; i < PD.length; i++) if (PD[i].cod === cod) b = PD[i];',
    '      if (!b) return;',
    // El mes es el que esa estacion tiene, no el mas nuevo del tablero: pedirle
    // a una estacion que cerro en octubre los dias de noviembre devuelve nada,
    // y eso se lee como "no pasa nada" cuando lo que pasa es que no hay mes.
    '      var ms = mesesDe(b);',
    '      var M = mes || APER[cod] || MES0;',
    '      if (ms.length && ms.indexOf(M) < 0) M = ms[ms.length - 1];',
    '      var ds = diasDelMes(b, M), r = resumenDelMes(ds);',
    '      var H = [\'<div class="code">\' + esc(b.cod) + \'</div><h3>\' + esc(b.nom) + \'</h3>\'];',
    '      if (ms.length > 1) {',
    '        H.push(\'<div class="dmes">\');',
    '        for (i = 0; i < ms.length; i++)',
    '          H.push(\'<button type="button" class="chip\' + (ms[i] === M ? \' on\' : \'\') +',
    '                 \'" data-dc="\' + esc(b.cod) + \'" data-dm="\' + esc(ms[i]) + \'">\' +',
    '                 esc(etiquetaDeMes(ms[i])) + \'</button>\');',
    '        H.push(\'</div>\');',
    '      }',
    '      if (!r) { H.push(\'<p class="mut">Sin movimiento en \' + esc(etiquetaDeMes(M)) + \'.</p>\'); }',
    '      else {',
    '        H.push(\'<div class="mut">\' + esc(etiquetaDeMes(M)) + \' · \' + mil(r.n) +',
    '               (r.n === 1 ? \' día con movimiento, el \' + esc(r.desde) :',
    '                            \' días con movimiento, del \' + esc(r.desde) + \' al \' + esc(r.hasta)) +',
    '               \'</div>\');',
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
    '    function abrirKpi(clave) {',
    '      dbody.innerHTML = desgloseHtml(DESG[clave]);',
    '      drawer.classList.add("on"); scrim.classList.add("on");',
    '      $("#dxc").focus();',
    '    }',
    '    function desde(el) {',
    // La celda del calendario y el chip de mes van PRIMERO: viven dentro del
    // cajon, que esta colgado de un [data-kpi], asi que sin esto un clic en un
    // dia lo volveria a abrir desde cero y perderia el dia elegido.
    '      var cd = el.closest(".cd[data-dia]");',
    '      if (cd) { pintarDia($("#dbody"), cd.getAttribute("data-dia"), PD); return true; }',
    '      var pm = el.closest("[data-pm]");',
    '      if (pm) { pintarMes($("#dbody"), pm.getAttribute("data-pm"), PD,',
    '                          DAT.planta_transito_dias, DESG.planta && DESG.planta.calHoy,',
    '                          DESG.planta && DESG.planta.calUlt); return true; }',
    // El chip de mes vive DENTRO del cajon: va primero, si no lo atrapa el
    // [data-cod] de la fila que lo abrio y el cajon se redibuja en su mes.
    '      var m = el.closest("[data-dm]");',
    '      if (m) { abrir(m.getAttribute("data-dc"), m.getAttribute("data-dm")); return true; }',
    '      var k = el.closest("[data-kpi]"); if (k) { ultimo = k; abrirKpi(k.getAttribute("data-kpi")); return true; }',
    '      var c = el.closest("[data-cod]"); if (c) { ultimo = c; abrir(c.getAttribute("data-cod")); return true; }',
    '      return false;',
    '    }',
    '    document.addEventListener("click", function (e) { desde(e.target); });',
    '    document.addEventListener("keydown", function (e) {',
    '      if (e.key === "Escape") { cerrar(); return; }',
    '      if (e.key !== "Enter" && e.key !== " ") return;',
    '      if (!e.target.closest) return;',
    '      if (desde(e.target)) e.preventDefault();',
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
  console.log('  salud: ' + ['critica', 'atencion', 'sana', 'sindato']
    .map(s => s + ' ' + bs.filter(b => b.salud.nivel === s).length).join(' · '));
  /*  LA LINEA DE LA TARJETA SE COMPRUEBA CONTRA SAP EN CADA CORRIDA. El nivel
   *  diario arrastrado tiene que terminar en el mismo indicador que publica la
   *  tarjeta. Si no termina ahi, la pagina ya lo dice en su propia cara, pero
   *  la corrida tambien lo grita: un grafico que no reconcilia con su numero
   *  es peor que no tener grafico. No mata el cierre —el detalle ya quedo
   *  publicado— pero no pasa en silencio. */
  const nd = nivelDiarioDePlanta(d.planta_dias || []);
  const sap = Number(d.bodegas && d.bodegas.PLANTA && d.bodegas.PLANTA.nivel) || 0;
  if (!nd.length) console.log('  sin serie diaria: la tarjeta de planta va sin su semana');
  else if (nd[nd.length - 1].cierre === sap)
    console.log('  nivel diario arrastrado: ' + nd.length + ' días, cierra en ' +
                mil(sap) + ' = el indicador de SAP');
  else
    console.warn('  AVISO: el nivel diario arrastrado cierra en ' + mil(nd[nd.length - 1].cierre) +
                 ' y SAP dice ' + mil(sap) + ' (' + conSigno(nd[nd.length - 1].cierre - sap) +
                 '). La tarjeta lo declara en la página.');
  console.log('  ' + rSal);
}

module.exports = { ETAPAS, GLIFO, ORDEN_SALUD, HITOS, CSS,
                   etapaDeBodega, saludDeBodega, bodegasDelCockpit, matrizPlantaEtapa,
                   mesDeApertura, mesesDeBodega, ultimaSemana, miniSemana, miniNivel,
                   nivelDiarioDePlanta, diaDeSemana, mesDelCalendario, calendarioDeMes,
                   filasDelDia, pieDeDia, notaDeDia, calendarioHtml, pintarDia, pintarMes,
                   cierreDeBodegaEn, grillaBodegasHtml, DIA_CORTO,
                   titular, tarjetas, decisiones, diasHasta, hitos,
                   desglose, composiciones, desgloseHtml, porRecorrido,
                   recortar, chipEstado, tarjetaHtml, matrizHtml, filaCartera, listaHtml,
                   contarSalud, datosPublicables, periodosDeSerie, serieDelPeriodo,
                   dumbbell, metodo, script, pagina,
                   opcion, opcionesRaras, leerJson, OPCIONES };

if (require.main === module) main();
