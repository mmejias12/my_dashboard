// ============================================================================
//  scripts/saldo-pool.js  ·  M3DATA · cuantos pallets tiene cada quien
//
//  QUE CONTESTA. Cuanto del pool de pallet rojo esta en manos de cada cliente
//  y de cada retailer, en cualquier fecha, calculado desde SAP:
//      nivel(socio, dia) = semilla(socio) + suma de sus deltas hasta ese dia
//
//  Es el mismo modelo del arriendo pero sin la parte dificil: no hay cartola
//  con la que reconciliar, no hay periodos ni pallet-dias. Solo el nivel.
//
//  POR QUE IMPORTA MAS DE LO QUE PARECE. Medido al 2025-12-31, RETAIL sostiene
//  508.422 pallets contra 186.310 de los clientes: 2,7 veces mas. Y WALMART
//  solo tiene 271.505, el 53,4% de todo retail. Un control de stock que no
//  mire a WALMART por separado no esta mirando nada.
//
//  EL CONTROL QUE DE VERDAD VALE es el nivel NEGATIVO. Un socio no puede
//  tener menos de cero pallets: si la serie cruza el cero, la atribucion de
//  alguna ubicacion esta mal, o falta un movimiento. En la semilla de
//  clientes ya hay uno asi —ELABORADORA DE ALIMENTOS FRUTALE en -296— y eso
//  se detecta solo, sin comparar contra nada externo. Es la unica parte de
//  todo esto que no necesita una segunda fuente para encontrar un error.
//
//  LO QUE FALTA PARA CERRAR LA IDENTIDAD DEL POOL:
//      total = clientes + retail + planta + transito
//  Las dos primeras salen de aca. Planta esta pendiente del alcance (ver
//  scripts/alcance-planta.js, que falla cerrado a proposito). Mientras falte,
//  esto NO dice cuantos pallets tiene REDTEC: dice cuantos tiene afuera.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.  OS_STORAGE_CONN · OS_SAP_CONTAINER
//
//  Uso (PowerShell):
//    node scripts/saldo-pool.js --bodega=RETAIL --semilla=backfill/s0-semilla-retail-2025-12-31.json
//    node scripts/saldo-pool.js --bodega=CLIENTES --semilla=backfill/s0-semilla-2025-12-31.json
//    ... --corte=2026-06-30      el nivel a esa fecha en vez de al final
// ============================================================================
'use strict';

const M = require('./medir-emisiones.js');
const V = require('./validar-arriendo-bin.js');

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args = process.argv.slice(2);
const OPCIONES = ['bodega', 'meses', 'semilla', 'tope', 'corte', 'bodegas', 'brecha', 'desfase', 'diario', 'json'];
const BANDERAS = ['negativos'];
const opcion = (n, d) => M.leerOpcion(args, n, d);
const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
// mil() ya trae el '-' de los negativos: agregarle '+' a mano daba '+-6.488'
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** El delta diario de cada socio.
 *
 *  LO NO ATRIBUIDO SE PARTE EN DOS, porque son dos cosas que no se parecen:
 *  una ubicacion que es de ESTA bodega y que nadie atribuyo es un hueco de
 *  atribucion, y hay que cerrarlo; una ubicacion que es de otra bodega es
 *  ruido esperado —el blob de movimientos trae todo junto— y no mide nada.
 *  Sumadas dan un numero enorme que no sirve para decidir nada, y peor: se
 *  lee como si la atribucion estuviera pesima cuando no lo esta.
 *
 *  Sin el set de la bodega no se adivina: va a sinClasificar y se dice. */
function deltaDiario(filas, mapa, deBodega) {
  const porSocio = new Map();
  const binsSinSocio = new Set();
  let sinMapa = 0, palletsSinMapa = 0, sinFecha = 0;
  let sinSocio = 0, palletsSinSocio = 0;
  let deOtraBodega = 0, palletsDeOtraBodega = 0;
  let sinClasificar = 0, palletsSinClasificar = 0;
  const hay = !!(deBodega && deBodega.has);
  for (const f of (filas || [])) {
    if (!f) continue;
    const cod = mapa && mapa.get ? mapa.get(f.BinAbsEntry) : null;
    if (!cod) {
      const q = Math.abs(Number(f.delta) || 0);
      sinMapa++; palletsSinMapa += q;
      if (!hay) { sinClasificar++; palletsSinClasificar += q; }
      else if (deBodega.has(f.BinAbsEntry)) {
        sinSocio++; palletsSinSocio += q; binsSinSocio.add(f.BinAbsEntry);
      } else { deOtraBodega++; palletsDeOtraBodega += q; }
      continue;
    }
    const d = String(f.DocDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { sinFecha++; continue; }
    let s = porSocio.get(cod);
    if (!s) { s = new Map(); porSocio.set(cod, s); }
    s.set(d, (s.get(d) || 0) + (Number(f.delta) || 0));
  }
  return { porSocio, sinMapa, palletsSinMapa, sinFecha,
           sinSocio, palletsSinSocio, binsSinSocio,
           deOtraBodega, palletsDeOtraBodega,
           sinClasificar, palletsSinClasificar };
}

/** EL NIVEL DE UN SOCIO DIA POR DIA, y el minimo que alcanza.
 *
 *  El minimo es el dato que importa: si es negativo, el socio "tuvo" menos de
 *  cero pallets en algun momento, y eso no pasa en la realidad. No hace falta
 *  comparar contra nada: la serie se delata sola. */
function nivelDeSocio(s0, deltaPorDia, dias) {
  let nivel = Number(s0) || 0;
  let min = nivel, minDia = (dias && dias[0]) || null;
  for (const d of (dias || [])) {
    nivel += (deltaPorDia && deltaPorDia.get(d)) || 0;
    if (nivel < min) { min = nivel; minDia = d; }
  }
  return { s0: Number(s0) || 0, nivel, min, minDia, cambio: nivel - (Number(s0) || 0) };
}

/** El nivel de todos los socios de la semilla, mas los que tienen movimiento
 *  y NO estan en la semilla —que son un hallazgo, no un detalle: un socio con
 *  movimiento y sin saldo de partida arranca en cero y su nivel puede quedar
 *  negativo solo por eso. */
function nivelesPool(semilla, dd, dias) {
  const out = [];
  const vistos = new Set();
  for (const [cod, s0] of ((semilla && semilla.porCod) || new Map())) {
    vistos.add(cod);
    out.push(Object.assign({ cod, enSemilla: true },
                           nivelDeSocio(s0, dd && dd.porSocio ? dd.porSocio.get(cod) : null, dias)));
  }
  for (const cod of ((dd && dd.porSocio) ? dd.porSocio.keys() : [])) {
    if (vistos.has(cod)) continue;
    out.push(Object.assign({ cod, enSemilla: false },
                           nivelDeSocio(0, dd.porSocio.get(cod), dias)));
  }
  return out.sort((a, b) => b.nivel - a.nivel);
}

/** El resumen del pool, con la concentracion. Un total sin saber cuanto pesa
 *  el primero esconde justo lo que hay que vigilar. */
function resumenPool(niveles) {
  const n = (niveles || []).filter(Boolean);
  const total = n.reduce((a, x) => a + x.nivel, 0);
  const pos = n.filter(x => x.nivel > 0).sort((a, b) => b.nivel - a.nivel);
  const negativos = n.filter(x => x.min < 0);
  const sinSemilla = n.filter(x => !x.enSemilla);
  return { socios: n.length, conSaldo: pos.length, total,
           mayor: pos.length ? pos[0] : null,
           concentracion: (pos.length && total) ? pos[0].nivel / total : null,
           negativos, sinSemilla };
}

/** El veredicto. La vara se declara antes: un nivel negativo es imposible,
 *  asi que UNO solo ya es un error de atribucion que hay que perseguir. No
 *  hay umbral de tolerancia para lo imposible. */
function veredicto(r) {
  if (!r || !r.socios) return { nivel: 'sin datos', texto: 'No hay socios que medir.' };
  const p = [];
  if (r.negativos.length)
    p.push(r.negativos.length + ' socio(s) con nivel NEGATIVO en algun dia: ' +
           r.negativos.slice(0, 5).map(x => x.cod + ' (' + mil(x.min) + ' el ' + x.minDia + ')').join(', ') +
           '. Un socio no puede tener menos de cero pallets, asi que ahi falta un movimiento o ' +
           'sobra una ubicacion atribuida.');
  if (r.sinSemilla.length)
    p.push(r.sinSemilla.length + ' socio(s) con movimiento y SIN saldo de partida: ' +
           r.sinSemilla.slice(0, 5).map(x => x.cod + ' (' + conSigno(x.cambio) + ')').join(', ') +
           '. Arrancan en cero y su nivel no se puede creer: es una cota inferior, no un saldo. ' +
           'Faltan en la semilla.');
  if (!p.length) return { nivel: 'si',
    texto: 'Todos los niveles se sostienen sobre cero y todos los socios con movimiento tienen ' +
           'saldo de partida. El pool afuera suma ' + mil(r.total) + ' pallets' +
           (r.concentracion != null ? ', y el mayor concentra el ' +
            (100 * r.concentracion).toFixed(1) + '%.' : '.') };
  return { nivel: 'revisar', texto: p.join('  ') };
}

/** LAS UBICACIONES QUE SON DE ESTA BODEGA, con socio o sin el.
 *
 *  FILTRA POR BODEGA DE VERDAD, no por "venir en el maestro". El maestro de
 *  RETAIL trae 1.451 ubicaciones, pero no todas viven en BODEGA RETAILERS:
 *  el maestro se arma desde los SOCIOS, y un socio puede tener ubicaciones en
 *  mas de una bodega. Yo las contaba todas y el resultado se notaba:
 *
 *    OINM, bodega RETAIL, 2026           : +36.438
 *    nuestros socios atribuidos          : +36.541   (+0,28%)
 *    + las 52 ubicaciones "sin socio"    : +28.552   (-21,6%)
 *
 *  Los socios solos reproducen OINM casi exacto; agregarle las otras lo
 *  rompia por 7.886 pallets. No eran ubicaciones sin atribuir de esta bodega:
 *  eran ubicaciones de otra bodega contadas aca.
 *
 *  Si el maestro no trae el campo Warehouse no se adivina: esas van a
 *  sinCampo y se dice, porque excluirlas en silencio seria el mismo error
 *  al reves. Las de sistema no cuentan, igual que en mapaDeMaestro. */
function binsDeBodega(json, whs) {
  const bins = new Set();
  const objetivo = whs == null ? null : String(whs).trim();
  let deOtra = 0, sinCampo = 0, sistema = 0;
  for (const u of ((json && json.ubicaciones) || [])) {
    if (!u || u.AbsEntry == null) continue;
    if (u.IsSystemBin === 'tYES' || u.IsSystemBin === true) { sistema++; continue; }
    const w = u.Warehouse == null ? null : String(u.Warehouse).trim();
    if (objetivo && w) {
      if (w !== objetivo) { deOtra++; continue; }
    } else if (objetivo && !w) {
      sinCampo++;      // no se sabe: entra, pero queda contada y declarada
    }
    bins.add(u.AbsEntry);
  }
  return { bins, total: bins.size, deOtra, sinCampo, sistema };
}

/** El nombre de cada socio segun el maestro. La semilla solo nombra a los que
 *  tienen saldo de partida; los que faltan en ella son justo los que hay que
 *  ir a buscar, y un RUT pelado no se puede llevar a nadie. */
function nombresDeMaestro(json) {
  const m = new Map();
  for (const s of ((json && json.socios) || [])) {
    if (!s || !s.cod) continue;
    const n = String(s.nom == null ? '' : s.nom).trim();
    if (n) m.set(String(s.cod).trim(), n);
  }
  return m;
}

/** LA COTA INFERIOR DE LA SEMILLA. Si el nivel toco el negativo y la serie de
 *  deltas esta bien, entonces lo que estaba mal era la partida, y por cuanto
 *  no es una opinion: tenia que ser al menos |minimo| mas alta. Un numero que
 *  se puede ir a verificar, en vez de un "revisar esto". */
function cotaSemilla(nivel) {
  if (!nivel || nivel.min == null || !isFinite(nivel.min) || nivel.min >= 0) return null;
  const s0 = Number(nivel.s0) || 0;
  return { falta: -nivel.min, cota: s0 - nivel.min };
}

/** LOS QUIETOS: cambio exactamente cero en toda la ventana. Hay dos razones y
 *  son muy distintas. Si el maestro le conoce alguna ubicacion, el socio esta
 *  dormido y el cero es un dato. Si no le conoce ninguna, su nivel es la
 *  semilla congelada y NADA en SAP lo respalda: el numero se arrastra solo. */
function quietos(niveles, conUbicacion) {
  const out = { dormidos: [], sinUbicacion: [] };
  for (const x of (niveles || [])) {
    if (!x || x.cambio !== 0) continue;
    if (conUbicacion && conUbicacion.has && conUbicacion.has(x.cod)) out.dormidos.push(x);
    else out.sinUbicacion.push(x);
  }
  return out;
}

// ── el ancla de bodega: cuantos hay, segun SAP ──────────────────────────────

/** Lee la salida de backfill/sonda-oinm-bodega.js --json.
 *
 *  POR QUE EXISTE. Hasta aca el nivel se armaba sumando deltas sobre una
 *  semilla, y la semilla salia de la capa de ubicaciones, que solo ve los
 *  pallets CON ubicacion asignada. Medido contra SAP, la semilla de retail
 *  estaba corta en 34.928. El nivel de bodega no tiene ese problema: es el
 *  saldo vivo que SAP ya calculo, sin acumular nada. */
function leerBodegas(json) {
  const porWhs = new Map();
  for (const b of ((json && json.bodegas) || [])) {
    if (!b || b.whs == null) continue;
    const v = Number(b.saldo);
    if (!isFinite(v)) continue;
    porWhs.set(String(b.whs).trim(), {
      saldo: v, nombre: b.nombre || null,
      conUbicaciones: b.conUbicaciones === true,
    });
  }
  return { generado: (json && json.generado) || null,
           item: (json && json.item) || null,
           porWhs, n: porWhs.size };
}

/** El delta diario de la bodega ENTERA: todas sus ubicaciones, tengan socio o
 *  no. Es lo que hay que restar para mover el nivel de bodega en el tiempo, y
 *  no es lo mismo que la suma de los socios: las ubicaciones sin atribuir
 *  tambien mueven la bodega. */
function deltaDeBodega(filas, deBodega) {
  const porDia = new Map();
  let usadas = 0;
  for (const f of (filas || [])) {
    if (!f) continue;
    if (!deBodega || !deBodega.has || !deBodega.has(f.BinAbsEntry)) continue;
    const d = String(f.DocDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    porDia.set(d, (porDia.get(d) || 0) + (Number(f.delta) || 0));
    usadas++;
  }
  return { porDia, usadas };
}

/** PowerShell escribe UTF-8 con BOM con Out-File y UTF-16 con '>'. El BOM es
 *  un caracter invisible al principio del archivo que JSON.parse rechaza con
 *  un mensaje que no se parece en nada al problema. Se saca y listo: un
 *  archivo con BOM es el mismo archivo. */
function sinBom(txt) {
  const t = String(txt == null ? '' : txt);
  return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
}

/** EL ANCLA TIENE QUE CAER DENTRO DE LO QUE MEDIMOS, y si no cae se dice.
 *
 *  El nivel de bodega es de HOY; los movimientos llegan hasta el ultimo dia
 *  con dato. Si el ancla es posterior, los dias del medio no los sumo nadie y
 *  restar hacia atras se los come en silencio. No es teorico: entre el
 *  2026-10-23 y el 2026-10-24 se movieron 1.518 pallets.
 *
 *  SE PUEDE TOLERAR, PERO NO CALLAR. Negarse siempre tampoco sirve: 1.518
 *  pallets sobre 579.008 es 0,26%, veinte veces menos que el residuo que se
 *  quiere medir, y rechazar la medicion por eso es cambiar un numero con
 *  incertidumbre conocida por ningun numero. Con brechaMax > 0 la brecha se
 *  acepta Y se marca tolerada, para declararla al lado del resultado. Por
 *  defecto es 0: tolerar es decision de quien corre, no del programa.
 *
 *  Un ancla ANTERIOR a la cobertura nunca se acepta: eso no es una brecha,
 *  es un ancla equivocada. */
function anclaAplicable(fechaAncla, ultimoDia, brechaMax) {
  if (!fechaAncla || !ultimoDia) return { ok: false, brecha: null, tolerada: false,
                                          motivo: 'falta una de las dos fechas' };
  const a = String(fechaAncla).slice(0, 10), u = String(ultimoDia).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(u))
    return { ok: false, brecha: null, tolerada: false, motivo: 'alguna fecha no es legible' };
  const d = Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(u + 'T00:00:00Z')) / 86400000);
  // Math.max(0, ...) es claridad, no comportamiento: para d > 0 un max
  // negativo y un max cero se portan igual, y d <= 0 ya volvio arriba.
  // (Mutante equivalente conocido: sacarle el Math.max.)
  const max = Math.max(0, Number(brechaMax) || 0);
  if (d === 0) return { ok: true, brecha: 0, tolerada: false, motivo: null };
  if (d < 0) return { ok: false, brecha: d, tolerada: false,
    motivo: 'el ancla (' + a + ') es ANTERIOR al ultimo dia con movimiento (' + u + ')' };
  if (d <= max) return { ok: true, brecha: d, tolerada: true,
    motivo: 'brecha de ' + d + ' dia(s) aceptada con --brecha: el nivel no incluye lo que se ' +
            'movio entre el ' + u + ' y el ' + a };
  return { ok: false, brecha: d, tolerada: false,
    motivo: 'el ancla es de ' + a + ' y los movimientos llegan al ' + u + ': ' + d +
            ' dia(s) que nadie sumo' };
}

/** EL NETO DE LA BODEGA, MES A MES.
 *
 *  Un total que no cuadra no dice donde se rompio; una serie mensual si. Si
 *  la diferencia contra SAP esta en un solo mes, ese blob se re-extrae y
 *  listo. Si esta repartida en los diez, el problema es de metodo y hay que
 *  cambiar otra cosa. Son dos arreglos distintos y conviene saber cual antes
 *  de tocar nada. */
function netoPorMes(porDia) {
  const m = new Map();
  for (const [d, v] of (porDia || new Map())) {
    const k = String(d).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    m.set(k, (m.get(k) || 0) + (Number(v) || 0));
  }
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
                         .map(([mes, neto]) => ({ mes, neto }));
}

/** LA SERIE DIARIA DE UN MES. El paso siguiente cuando el mensual ya dijo
 *  que mes mirar: si la diferencia cae en uno o dos dias, se van a buscar los
 *  documentos de esos dias; si esta repartida en los treinta, no son
 *  documentos sueltos sino algo sistematico. Los dias SIN movimiento tambien
 *  salen: que un dia este en cero es un dato, y si el otro lado tiene
 *  movimiento ese dia, ahi esta el hueco. */
function serieDiaria(porDia, mes) {
  const m = String(mes || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return [];
  const out = [];
  for (const [d, v] of (porDia || new Map()))
    if (String(d).slice(0, 7) === m) out.push({ dia: String(d).slice(0, 10), neto: Number(v) || 0 });
  return out.sort((a, b) => a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0);
}

/** ENTRADAS Y SALIDAS BRUTAS POR DIA, no solo el neto.
 *
 *  El neto de un dia puede ser cero y haberse movido medio pool: eso es
 *  justo lo que el reporte de stock tiene que mostrar. Y el bruto es lo que
 *  permite leer la operacion —un dia de despacho fuerte contra uno de
 *  recuperacion— que el neto esconde. */
function movimientoPorDia(filas, deBodega) {
  const hay = !!(deBodega && deBodega.has);
  const m = new Map();
  for (const f of (filas || [])) {
    if (!f) continue;
    if (!hay || !deBodega.has(f.BinAbsEntry)) continue;
    const d = String(f.DocDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const v = Number(f.delta) || 0;
    const e = m.get(d) || { dia: d, entradas: 0, salidas: 0, neto: 0, filas: 0 };
    if (v > 0) e.entradas += v; else e.salidas += -v;
    e.neto += v; e.filas++;
    m.set(d, e);
  }
  return [...m.values()].sort((a, b) => a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0);
}

/** EL CIERRE DE UN DIA. Lo que pidio operaciones: con cuanto cerro el dia y
 *  con cuanto amanecio el siguiente. En una serie acumulada son el MISMO
 *  numero por construccion —el nivel al cierre del 23 es el nivel con el que
 *  arranca el 24—, asi que si alguna vez difieren no es un redondeo: es que
 *  entre una medicion y otra se posteo un documento con fecha vieja. */
function cierreDelDia(serieDiaria, nivelFinal) {
  const s = (serieDiaria || []).slice().sort((a, b) => a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0);
  const out = [];
  let acum = Number(nivelFinal);
  if (!isFinite(acum)) return out;
  // se camina hacia atras desde el nivel final, que es el que SAP confirma
  for (let i = s.length - 1; i >= 0; i--) {
    out.unshift({ dia: s[i].dia, cierre: acum,
                  entradas: s[i].entradas, salidas: s[i].salidas, neto: s[i].neto });
    acum -= s[i].neto;
  }
  // la apertura de cada dia es el cierre del anterior: se declara para que la
  // igualdad se pueda ver, no para que haya que confiar en ella
  for (let i = 0; i < out.length; i++) out[i].apertura = out[i].cierre - out[i].neto;
  return out;
}

/** DOS MEDICIONES DEL MISMO DIA, hechas en momentos distintos. Si no dan lo
 *  mismo, se posteo algo con fecha pasada despues de la primera. Ese numero
 *  no lo puede ver una consulta en vivo a SAP: hace falta haber guardado el
 *  cierre de ayer. Es el valor que tiene el snapshot sobre la lectura viva. */
function posteoRetroactivo(antes, ahora) {
  const a = new Map((antes || []).filter(Boolean).map(x => [x.dia, x]));
  const dif = [];
  for (const x of (ahora || [])) {
    if (!x) continue;
    const v = a.get(x.dia);
    if (!v) continue;
    const d = (Number(x.cierre) || 0) - (Number(v.cierre) || 0);
    if (d) dif.push({ dia: x.dia, antes: Number(v.cierre) || 0, ahora: Number(x.cierre) || 0, cambio: d });
  }
  return { dias: dif.length, total: dif.reduce((s, x) => s + x.cambio, 0),
           comparados: [...a.keys()].filter(k => (ahora || []).some(x => x && x.dia === k)).length,
           detalle: dif.sort((p, q) => Math.abs(q.cambio) - Math.abs(p.cambio)) };
}

/** LA SALIDA COMPLETA, la que lee el tablero.
 *
 *  Va TODO: los socios enteros, no un top. Un tablero que recorta la cola
 *  obliga a volver a correr el script cada vez que alguien pregunta por un
 *  socio chico, y esa pregunta siempre llega.
 *
 *  Lleva ademas los controles adentro. Un numero sin su control es una cifra
 *  que hay que creer; con el control al lado es una cifra que se puede
 *  verificar, y esa es toda la diferencia con el reporte que reemplaza. */
function salidaJson(o) {
  const b = o || {};
  const cu = b.cuadratura || {};
  return {
    _que_es: 'Nivel de pallet por socio y por bodega, extraido de SAP por M3DATA. ' +
             'El total de la bodega lo dicta SAP; las ubicaciones solo lo reparten.',
    _como_leerlo: 'cierre de un dia = apertura del siguiente, por construccion. Si dos ' +
                  'mediciones del mismo dia no coinciden, se posteo un documento con fecha ' +
                  'pasada entre una y otra: eso es posteoRetroactivo, y una consulta en vivo ' +
                  'a SAP no lo puede ver.',
    generado: b.generado || new Date().toISOString(),
    bodega: b.bodega || null,
    ventana: b.ventana || null,
    nivel: { bodega: cu.bodega == null ? null : cu.bodega,
             socios: cu.socios == null ? null : cu.socios,
             residuo: cu.residuo == null ? null : cu.residuo,
             atribuido: cu.cubierto == null ? null : cu.cubierto },
    socios: (b.niveles || []).map(x => ({
      cod: x.cod, nom: (b.nombre ? b.nombre(x.cod) : null), partida: x.s0, nivel: x.nivel,
      cambio: x.cambio, minimo: x.min, minimoDia: x.minDia, enSemilla: !!x.enSemilla })),
    mensual: b.mensual || [],
    dias: b.dias || [],
    sinSocio: b.sinSocio || null,
    controles: b.controles || null,
  };
}

/** EL FLUJO LINEA POR LINEA, Y LA LEY QUE TIENE QUE CUMPLIR.
 *
 *  Un traspaso tiene dos puntas. Si las dos caen DENTRO de la misma bodega,
 *  el movimiento neto de esa bodega por esa linea es CERO: el pallet se movio
 *  de un rack a otro y la bodega tiene los mismos que antes. Esa es una ley,
 *  no una estimacion, y se verifica sin mirar ninguna otra fuente.
 *
 *  POR QUE HIZO FALTA. Cuatro mediciones del movimiento de RETAIL en 2026:
 *      OINM, la bodega                  +36.438
 *      WAVE, capa de ubicaciones        +35.798
 *      nuestros socios atribuidos       +36.541
 *      nuestras TODAS las ubicaciones   +28.552   <- el unico que se va
 *  Las tres primeras caen en un rango de 2,1%. La cuarta se va 7.246 abajo, y
 *  la diferencia es justo el neto de las 52 ubicaciones sin socio (-7.989).
 *  Si las lineas internas no netean cero, ahi esta la fuga: son traspasos de
 *  rack a rack donde una de las dos puntas no quedo en nuestra extraccion.
 *
 *  LO QUE DEVUELVE. El movimiento de la bodega es cruzada + unaPunta; las
 *  internas aportan cero SI la ley se cumple. El descuadre de las internas es
 *  el numero a perseguir. */
function flujoPorLinea(filas, deBodega) {
  const hay = !!(deBodega && deBodega.has);
  const porLinea = new Map();
  for (const f of (filas || [])) {
    if (!f) continue;
    const k = f.DocEntry + '|' + f.LineNum;
    let e = porLinea.get(k);
    if (!e) { e = { dentro: 0, fuera: 0, neto: 0 }; porLinea.set(k, e); }
    const d = Number(f.delta) || 0;
    if (hay && deBodega.has(f.BinAbsEntry)) { e.dentro++; e.neto += d; }
    else e.fuera++;
  }
  const z = () => ({ n: 0, neto: 0 });
  const out = { lineas: porLinea.size, interna: z(), cruzada: z(), unaPunta: z(), fuera: z() };
  for (const e of porLinea.values()) {
    let c;
    if (!e.dentro) c = out.fuera;
    else if (e.fuera) c = out.cruzada;
    else if (e.dentro >= 2) c = out.interna;
    else c = out.unaPunta;
    c.n++; c.neto += e.neto;
  }
  out.netoBodega = out.interna.neto + out.cruzada.neto + out.unaPunta.neto;
  // La ley: las internas tienen que dar cero. Lo que den de mas es la fuga.
  out.descuadre = out.interna.neto;
  out.cumpleLey = out.interna.neto === 0;
  return out;
}

/** EL RESUMEN DE LAS UBICACIONES SIN SOCIO de esta bodega.
 *
 *  Dejo de ser una curiosidad cuando el numero no cuadro. En RETAIL, los
 *  socios atribuidos reproducen el movimiento de OINM con 0,28% de error;
 *  sumarle estas ubicaciones lo lleva a -21,6%. O sea que su movimiento NO
 *  esta en el libro de la bodega, aunque el maestro las ponga ahi. Hasta
 *  saber que son, el numero que hay que mirar es el neto de ellas, y por eso
 *  se calcula y se muestra en vez de quedar adentro de un total. */
function resumenSinSocio(detalle) {
  const d = (detalle || []).filter(Boolean);
  return { n: d.length,
           filas: d.reduce((a, x) => a + (Number(x.filas) || 0), 0),
           pallets: d.reduce((a, x) => a + (Number(x.pallets) || 0), 0),
           neto: d.reduce((a, x) => a + (Number(x.neto) || 0), 0),
           // d ya es un arreglo nuevo: .filter(Boolean) copia, asi que ordenarlo
           // no puede tocar el que nos pasaron. Un .slice() aca seria adorno.
           mayores: d.sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto)) };
}

/** CUANDO SE EXTRAJO LA COBERTURA QUE IMPORTA. Los meses viejos no cambian;
 *  el que tiene que estar fresco es el ultimo, porque es el que cubre los dias
 *  que se le restan al ancla. */
function frescuraCobertura(coberturas) {
  let mejor = null;
  for (const c of (coberturas || [])) {
    if (!c || !c.mes || !c.guardado) continue;
    if (!mejor || String(c.mes) > String(mejor.mes)) mejor = c;
  }
  return mejor ? { mes: mejor.mes, guardado: mejor.guardado } : null;
}

/** EL DESFASE ENTRE LAS DOS LECTURAS, que es el control que de verdad importa.
 *
 *  Estuve midiendo lo incorrecto. Comparaba la fecha del ancla contra la
 *  ULTIMA FECHA DE DOCUMENTO, y eso no dice nada util: SAP acepta documentos
 *  con fecha futura, asi que la cobertura puede terminar despues del ancla sin
 *  que haya ningun problema —esos movimientos estan posteados, o binmov no los
 *  habria leido, asi que YA estan dentro del saldo vivo y restarlos es
 *  correcto—. Y al revés tampoco servia: si alguien postea hoy un documento
 *  con fecha de la semana pasada, la ultima fecha no se mueve y el hueco pasa
 *  desapercibido.
 *
 *  Lo que importa es CUANDO SE LEYERON las dos cosas. El error es exactamente
 *  el movimiento que ocurrio entre las dos lecturas, en cualquiera de los dos
 *  ordenes:
 *    cobertura despues del ancla  -> le restamos al ancla cosas que no incluia
 *    ancla despues de la cobertura -> el ancla incluye cosas que no restamos
 *  Por eso se mide el desfase en horas, sin importar la direccion, y se
 *  declara. */
function desfaseLecturas(tAncla, tCobertura, horasMax) {
  const a = Date.parse(String(tAncla || '')), c = Date.parse(String(tCobertura || ''));
  if (!isFinite(a) || !isFinite(c))
    return { ok: false, horas: null, direccion: null, motivo: 'falta la hora de una de las dos lecturas' };
  const h = (a - c) / 3600000;
  const max = Math.max(0, Number(horasMax == null ? 24 : horasMax) || 0);
  const dir = h > 0 ? 'el ancla se leyo despues' : h < 0 ? 'la cobertura se extrajo despues' : 'a la misma hora';
  const abs = Math.abs(h);
  if (abs <= max) return { ok: true, horas: h, direccion: dir, motivo: null };
  return { ok: false, horas: h, direccion: dir,
           motivo: dir + ' por ' + abs.toFixed(1) + ' horas (tope ' + max + '): todo el ' +
                   'movimiento de ese rato queda mal contado' };
}

/** Los movimientos con fecha POSTERIOR a un tope. No son un error —SAP acepta
 *  documentos post-fechados— pero un nivel "al" dia siguiente no es una
 *  medicion, es una proyeccion, y conviene no presentarlo como lo primero. */
function movimientoDespuesDe(fechas, tope) {
  const t = String(tope || '').slice(0, 10);
  const out = [];
  for (const f of (fechas || [])) {
    const d = String(f || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (t && d > t) out.push(d);
  }
  const u = [...new Set(out)].sort();
  return { fechas: u, filas: out.length, hasta: u.length ? u[u.length - 1] : null };
}

/** EL NIVEL HACIA ATRAS. En vez de sumar hacia adelante desde una semilla
 *  prestada, se resta hacia atras desde el saldo que SAP da hoy. Lo unico que
 *  hace falta es la serie de deltas, que es nuestra. */
function nivelHaciaAtras(nivelAncla, deltaPorDia, diasPosteriores) {
  const a = Number(nivelAncla);
  if (nivelAncla == null || !isFinite(a)) return null;
  let suma = 0;
  for (const d of (diasPosteriores || [])) suma += (deltaPorDia && deltaPorDia.get(d)) || 0;
  return { ancla: a, movido: suma, nivel: a - suma, dias: (diasPosteriores || []).length };
}

/** LA CUADRATURA. La bodega dice cuantos hay; los socios dicen de quien son.
 *  Lo que sobra son pallets en la bodega sin ubicacion asignada: es una
 *  categoria real y hay que mostrarla. Lo que NO puede pasar es que sobre
 *  negativo —los socios no pueden tener mas que la bodega que los contiene—
 *  y eso se encuentra sin comparar contra nada. */
/** Lo que suma la semilla. Se usa para medirla contra SAP en vez de contra
 *  otra atribucion. */
function sumaSemilla(sem) {
  let t = 0;
  for (const v of (((sem && sem.porCod) || new Map()).values())) t += Number(v) || 0;
  return t;
}

function cuadrar(nivelBodega, sumaSocios) {
  if (nivelBodega == null || sumaSocios == null) return null;
  const b = Number(nivelBodega), so = Number(sumaSocios);
  if (!isFinite(b) || !isFinite(so)) return null;
  const r = b - so;
  return { bodega: b, socios: so, residuo: r,
           porcentaje: b ? r / b : null,
           cubierto: b ? so / b : null,
           imposible: r < 0 };
}

module.exports = { deltaDiario, nivelDeSocio, nivelesPool, resumenPool, veredicto,
                   binsDeBodega, nombresDeMaestro, cotaSemilla, quietos,
                   leerBodegas, deltaDeBodega, anclaAplicable, nivelHaciaAtras, cuadrar,
                   sumaSemilla, sinBom, frescuraCobertura, desfaseLecturas, conSigno,
                   resumenSinSocio, flujoPorLinea, netoPorMes, serieDiaria,
                   movimientoPorDia, cierreDelDia, posteoRetroactivo, salidaJson,
                   movimientoDespuesDe,
                   OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = M.opcionesDesconocidas(args, OPCIONES, BANDERAS);
  if (malas.length) {
    console.error('Opcion no reconocida: ' + malas.join('  '));
    console.error('Con valor: ' + OPCIONES.map(o => '--' + o + '=').join('  '));
    process.exit(1);
  }
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  const bodega = opcion('bodega', 'CLIENTES');
  const rutaSemilla = opcion('semilla', null);
  if (!rutaSemilla) {
    console.error('Falta --semilla. Sin saldo de partida el nivel no se puede calcular:\n' +
                  '  --semilla=backfill/s0-semilla-2025-12-31.json         (CLIENTES)\n' +
                  '  --semilla=backfill/s0-semilla-retail-2025-12-31.json  (RETAIL)');
    process.exit(1);
  }

  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);
  async function leer(nombre) {
    const b = cc.getBlobClient(nombre);
    if (!(await b.exists())) return null;
    return JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  }

  const maestro = await leer('binmaestro/' + bodega + '.json');
  if (!maestro) {
    console.error('Falta binmaestro/' + bodega + '.json.\n' +
                  '  node backfill/backfill-sap-bin.js --maestro --bodega=' + bodega +
                  (bodega === 'RETAIL' ? ' --prefijo=R' : ''));
    process.exit(1);
  }
  const mapa = V.mapaDeMaestro(maestro);
  const bd = binsDeBodega(maestro, bodega);
  const deBodega = bd.bins;
  const nomMaestro = nombresDeMaestro(maestro);
  const em = V.edadMaestro(maestro, new Date().toISOString().slice(0, 10));

  const lista = String(opcion('meses', '2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10'))
    .split(',').map(x => x.trim()).filter(Boolean);
  const filas = [], con = [], sin = [], cob = [];
  for (const m of lista) {
    const j = await leer('binmov/' + m + '.json');
    if (!j) { sin.push(m); continue; }
    con.push(m);
    cob.push({ mes: m, desde: j.desde, hasta: j.hasta, guardado: j._guardado || null,
               // el blob ya cuenta lo que la extraccion NO pudo leer: filas con
               // BinActionType desconocido y documentos que fallaron. Nunca los
               // habia mirado desde aca, y son justo la primera explicacion de
               // un mes que sale corto.
               raros: Number(j._tipos_desconocidos) || 0,
               fallidos: Array.isArray(j._fallidos) ? j._fallidos.length : (Number(j._fallidos) || 0),
               filas: Number(j._filas) || 0, docs: Number(j._docs) || 0 });
    for (const f of (j.filas || [])) filas.push(f);
  }
  if (!con.length) { console.error('No hay ningun blob binmov de ' + lista.join(', ')); process.exit(1); }

  let js = null;
  try { js = JSON.parse(sinBom(require('fs').readFileSync(rutaSemilla, 'utf8'))); }
  catch (e) { console.error('No se pudo leer la semilla ' + rutaSemilla + ': ' + e.message); process.exit(1); }
  const sem = V.leerSemilla(js);

  const fechas = filas.map(f => String(f.DocDate || '').slice(0, 10)).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const vn = V.ventana(cob, fechas);
  const corte = opcion('corte', null) || vn.hasta;
  const dias = V.diasDeVentana(vn.desde, corte);
  const ap = V.semillaAplicable(sem.fecha, vn.desde);

  console.log('Bodega  : ' + bodega + '   ·  maestro ' + mil(mapa.size) + ' ubicaciones con socio' +
              (em.ubicaciones != null ? ' de ' + mil(em.ubicaciones) : '') +
              (em.generado ? '   ·  armado ' + String(em.generado).slice(0, 10) : ''));
  console.log('Bin     : binmov ' + con.join(' + ') + ' · ' + mil(filas.length) + ' filas' +
              (sin.length ? '   (sin blob: ' + sin.join(', ') + ')' : ''));
  console.log('Ubicac. : ' + mil(bd.total) + ' en ' + bodega +
              (bd.deOtra ? '   ·  ' + mil(bd.deOtra) + ' del maestro viven en OTRA bodega y no se cuentan' : '') +
              (bd.sinCampo ? '   ·  ' + mil(bd.sinCampo) + ' sin campo Warehouse: entran igual' : '') +
              (bd.sistema ? '   ·  ' + mil(bd.sistema) + ' de sistema' : ''));
  console.log('Semilla : ' + rutaSemilla + ' · ' + sem.fecha + ' · ' + sem.n + ' socios');
  console.log('Ventana : ' + vn.desde + ' a ' + corte + '   ·  ' + dias.length + ' dias');
  if (!ap.ok) {
    console.error('\nLA SEMILLA NO PEGA CON LA VENTANA: ' + ap.motivo);
    console.error('Un dia de hueco es un dia de movimientos que nadie sumo. No se calcula nada.');
    process.exit(1);
  }

  const dd = deltaDiario(filas, mapa, deBodega);
  const niveles = nivelesPool(sem, dd, dias);
  const r = resumenPool(niveles);

  // ── EL ANCLA DE BODEGA ────────────────────────────────────────────────────
  // Si vino, el nivel de la bodega lo dicta SAP y los socios solo lo reparten.
  // Si no vino, se dice que el total hereda el error de la semilla en vez de
  // presentarlo como si fuera medido.
  let anc = null;
  const rutaBod = opcion('bodegas', null);
  if (rutaBod) {
    let jb = null;
    try { jb = JSON.parse(sinBom(require('fs').readFileSync(rutaBod, 'utf8'))); }
    catch (e) { console.error('No se pudo leer ' + rutaBod + ': ' + e.message); process.exit(1); }
    const bod = leerBodegas(jb);
    const w = bod.porWhs.get(bodega);
    if (!w) {
      console.error('\n' + rutaBod + ' no trae la bodega ' + bodega + '. Trae: ' +
                    [...bod.porWhs.keys()].slice(0, 12).join(', '));
      process.exit(1);
    }
    const fechaAncla = String(bod.generado || '').slice(0, 10);
    // EL CONTROL ES EL DESFASE ENTRE LAS DOS LECTURAS, no las fechas de
    // documento: SAP acepta documentos post-fechados y la ultima fecha no
    // dice nada de cuando se leyo cada cosa.
    const fr = frescuraCobertura(cob);
    const des = desfaseLecturas(bod.generado, fr && fr.guardado, opcion('desfase', 24));
    // los post-fechados no son un error, pero un nivel "al" dia siguiente es
    // una proyeccion y no se presenta como medicion
    const post = movimientoDespuesDe(fechas, fechaAncla);
    const db = deltaDeBodega(filas, deBodega);
    const posteriores = V.diasDeVentana(corte, vn.hasta).filter(d => d > corte);
    const hacia = nivelHaciaAtras(w.saldo, db.porDia, posteriores);
    anc = { ruta: rutaBod, bod, w, fechaAncla, fr, des, post, db, hacia };
  }

  console.log('\n── EL NIVEL AL ' + corte + ' ' + '─'.repeat(45));
  console.log('  socios con saldo: ' + r.conSaldo + ' de ' + r.socios +
              '   ·  total ' + mil(r.total) + ' pallets');
  if (r.mayor) console.log('  el mayor: ' + r.mayor.cod + ' con ' + mil(r.mayor.nivel) +
                           '   (' + (100 * r.concentracion).toFixed(1) + '% del total)');
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
  console.log('  filas de ubicaciones de ' + bodega + ' SIN socio: ' + mil(dd.sinSocio) +
              '  (' + pct(dd.sinSocio, filas.length) + ' de las filas · ' +
              mil(dd.binsSinSocio.size) + ' ubicaciones)   ← el hueco de atribucion');
  console.log('  filas de ubicaciones de otra bodega: ' + mil(dd.deOtraBodega) +
              '  (' + pct(dd.deOtraBodega, filas.length) + ')   ← ruido esperado, el blob trae todo junto');
  if (dd.sinClasificar) console.log('  filas sin clasificar (no vino el set de la bodega): ' +
                                    mil(dd.sinClasificar));
  if (dd.sinFecha) console.log('  filas sin fecha legible: ' + mil(dd.sinFecha));

  const nom = c => { const x = (js.saldos || []).find(y => y && y.cod === c);
                     return (x && x.nom) || nomMaestro.get(c) || c; };
  console.log('\n  ' + 'socio'.padEnd(16) + 'nombre'.padEnd(34) + 'partida'.padStart(11) +
              'nivel'.padStart(11) + 'cambio'.padStart(11) + 'minimo'.padStart(11));
  for (const x of niveles.slice(0, TOPE))
    console.log('  ' + x.cod.padEnd(16) + String(nom(x.cod)).slice(0, 33).padEnd(34) +
                mil(x.s0).padStart(11) + mil(x.nivel).padStart(11) +
                mil(x.cambio).padStart(11) + mil(x.min).padStart(11) +
                (x.min < 0 ? '  (!)' : '') + (x.enSemilla ? '' : '  (sin semilla)'));
  if (niveles.length > TOPE) console.log('  ... y ' + (niveles.length - TOPE) + ' socios mas');

  if (r.negativos.length) {
    console.log('\n  NIVEL NEGATIVO · un socio no puede tener menos de cero pallets:');
    for (const x of r.negativos.slice(0, TOPE)) {
      const c = cotaSemilla(x);
      console.log('     ' + x.cod.padEnd(16) + String(nom(x.cod)).slice(0, 33).padEnd(34) +
                  mil(x.min).padStart(11) + '   el ' + x.minDia +
                  (c ? '   ·  semilla >= ' + mil(c.cota) + ' (corta en ' + mil(c.falta) + ')' : ''));
    }
    console.log('     Ahi falta un movimiento o sobra una ubicacion atribuida a ese socio.');
    console.log('     Si la serie esta bien, lo que estaba mal es la partida, y por cuanto no es');
    console.log('     una opinion: tenia que ser al menos |minimo| mas alta.');
    console.log('     Es el unico control de todo esto que encuentra un error sin segunda fuente.');
  }

  // LOS QUIETOS. Cambio cero en toda la ventana es una de dos cosas, y la
  // diferencia decide si el numero vale: dormido, o semilla congelada que
  // nada en SAP respalda.
  const q = quietos(niveles, new Set(mapa.values()));
  if (q.sinUbicacion.length) {
    console.log('\n  SEMILLA CONGELADA · cambio cero y el maestro no les conoce NINGUNA ubicacion:');
    for (const x of q.sinUbicacion.slice(0, TOPE))
      console.log('     ' + x.cod.padEnd(16) + String(nom(x.cod)).slice(0, 33).padEnd(34) +
                  mil(x.nivel).padStart(11));
    console.log('     Su nivel es la semilla arrastrada tal cual. Nada de SAP lo confirma ni lo');
    console.log('     desmiente: no es un saldo medido, es un numero heredado.');
  }
  if (q.dormidos.length)
    console.log('\n  dormidos (cambio cero, pero con ubicacion propia en el maestro): ' +
                q.dormidos.length + '   ·  ' + mil(q.dormidos.reduce((a, x) => a + x.nivel, 0)) + ' pallets');

  // ── LAS UBICACIONES SIN SOCIO, UNA POR UNA ────────────────────────────────
  // Mientras el movimiento de la bodega no cuadre, estas son las sospechosas
  // y hay que poder mirarlas por nombre, no como un total.
  const det = V.detalleSinAtribuir(filas, mapa, maestro);
  const rs = resumenSinSocio(det);
  if (rs.n) {
    console.log('\n── LAS ' + rs.n + ' UBICACIONES DE ' + bodega + ' SIN SOCIO ' + '─'.repeat(30));
    console.log('  ' + 'AbsEntry'.padEnd(10) + 'BinCode'.padEnd(26) + 'Description'.padEnd(30) +
                'filas'.padStart(8) + 'neto'.padStart(10));
    for (const b of rs.mayores.slice(0, TOPE))
      console.log('  ' + String(b.AbsEntry).padEnd(10) + String(b.BinCode || '').slice(0, 25).padEnd(26) +
                  String(b.Description || '').slice(0, 29).padEnd(30) +
                  mil(b.filas).padStart(8) + conSigno(b.neto).padStart(10));
    if (rs.n > TOPE) console.log('  ... y ' + (rs.n - TOPE) + ' mas');
    console.log('  neto de todas: ' + conSigno(rs.neto) + '   ·  ' + mil(rs.filas) + ' filas · ' +
                mil(rs.pallets) + ' pallets movidos en valor absoluto');
  }

  // ── LA LEY DE LAS LINEAS INTERNAS ─────────────────────────────────────────
  const fl = flujoPorLinea(filas, deBodega);
  console.log('\n── EL FLUJO LINEA POR LINEA ' + '─'.repeat(46));
  console.log('  un traspaso con las DOS puntas dentro de ' + bodega + ' tiene que netear cero:');
  console.log('    internas  (las dos puntas adentro) : ' + mil(fl.interna.n).padStart(8) +
              ' lineas   neto ' + conSigno(fl.interna.neto).padStart(10) +
              (fl.cumpleLey ? '   ← cumple la ley' : '   ← DESCUADRE'));
  console.log('    cruzadas  (una adentro, una afuera): ' + mil(fl.cruzada.n).padStart(8) +
              ' lineas   neto ' + conSigno(fl.cruzada.neto).padStart(10));
  console.log('    una punta (la otra bodega no tiene): ' + mil(fl.unaPunta.n).padStart(8) +
              ' lineas   neto ' + conSigno(fl.unaPunta.neto).padStart(10));
  console.log('    de otra bodega                     : ' + mil(fl.fuera.n).padStart(8) + ' lineas');
  console.log('    movimiento de ' + bodega + ' = cruzadas + una punta + internas = ' +
              conSigno(fl.netoBodega));
  if (!fl.cumpleLey) {
    console.log('\n  LAS INTERNAS NO NETEAN CERO: ' + conSigno(fl.descuadre) + '.');
    console.log('  Un pallet que va de un rack a otro de la MISMA bodega no cambia cuantos');
    console.log('  hay en ella. Si el neto no es cero, a esas lineas les falta una punta en');
    console.log('  nuestra extraccion, y ese es el numero que no cuadra contra SAP.');
  }

  // ── EL NETO MES A MES, CON LA HORA EN QUE SE EXTRAJO CADA BLOB ────────────
  if (anc) {
    const pm = netoPorMes(anc.db.porDia);
    const guard = new Map(cob.map(c => [c.mes, c.guardado]));
    console.log('\n── EL NETO DE ' + bodega + ' MES A MES ' + '─'.repeat(39));
    const info = new Map(cob.map(c => [c.mes, c]));
    console.log('  ' + 'mes'.padEnd(10) + 'neto'.padStart(12) + '   ' + 'extraido'.padEnd(18) +
                'raros'.padStart(7) + 'fallidos'.padStart(10));
    let totRaros = 0, totFall = 0;
    for (const x of pm) {
      const c = info.get(x.mes) || {};
      totRaros += c.raros || 0; totFall += c.fallidos || 0;
      console.log('  ' + x.mes.padEnd(10) + conSigno(x.neto).padStart(12) + '   ' +
                  String(guard.get(x.mes) || '(sin hora)').slice(0, 16).replace('T', ' ').padEnd(18) +
                  String(c.raros == null ? '?' : c.raros).padStart(7) +
                  String(c.fallidos == null ? '?' : c.fallidos).padStart(10));
    }
    if (totRaros || totFall) {
      console.log('\n  OJO: ' + mil(totRaros) + ' fila(s) con BinActionType que la extraccion no supo');
      console.log('  leer y ' + mil(totFall) + ' documento(s) fallidos. Eso es movimiento real que');
      console.log('  SAP tiene y nosotros no: explica un mes corto sin necesidad de otra teoria.');
    }
    console.log('  ' + 'suma'.padEnd(10) + conSigno(pm.reduce((a, x) => a + x.neto, 0)).padStart(12));
    console.log('  Si la diferencia contra SAP esta en UN mes, ese blob se re-extrae y listo.');
    console.log('  Si esta repartida en los diez, el problema es de metodo.');
  }

  // ── LA SERIE DIARIA DE UN MES ─────────────────────────────────────────────
  const mesDiario = opcion('diario', null);
  if (anc && mesDiario) {
    const sd = serieDiaria(anc.db.porDia, mesDiario);
    console.log('\n── ' + bodega + ' DIA A DIA EN ' + mesDiario + ' ' + '─'.repeat(40));
    if (!sd.length) console.log('  (sin movimiento de esta bodega en ese mes, o el mes no es legible)');
    for (const x of sd) console.log('  ' + x.dia + '   ' + conSigno(x.neto).padStart(10));
    console.log('  ' + 'suma'.padEnd(10) + conSigno(sd.reduce((a, x) => a + x.neto, 0)).padStart(13));
  }

  // ── LA CUADRATURA ─────────────────────────────────────────────────────────
  if (anc) {
    console.log('\n── LA BODEGA CONTRA SUS SOCIOS ' + '─'.repeat(43));
    console.log('  ancla     : ' + anc.ruta + ' · leida ' +
                String(anc.bod.generado || '?').slice(0, 16).replace('T', ' ') +
                ' · ' + bodega + ' = ' + mil(anc.w.saldo) + ' pallets (SAP, saldo vivo)');
    console.log('  cobertura : binmov ' + (anc.fr ? anc.fr.mes + ' extraido ' +
                String(anc.fr.guardado).slice(0, 16).replace('T', ' ') : '(sin hora de extraccion)'));
    if (anc.post.filas)
      console.log('  post-fechados: ' + mil(anc.post.filas) + ' filas con fecha posterior al ' +
                  anc.fechaAncla + ' (hasta ' + anc.post.hasta + '). SAP los acepta; ya estan ' +
                  'dentro del saldo vivo, asi que restarlos es correcto.');

    if (!anc.des.ok) {
      console.error('\n  LAS DOS LECTURAS NO SON DEL MISMO MOMENTO: ' + anc.des.motivo);
      console.error('  El error es exactamente el movimiento de ese rato, y no lo medimos.');
      console.error('\n  COMO SE ARREGLA: los dos comandos seguidos, sin nada en el medio.');
      console.error('    1.  node backfill/backfill-sap-bin.js ' + String(corte).slice(0, 7) + ' --forzar');
      console.error('    2.  node backfill/sonda-oinm-bodega.js --salida=' + anc.ruta);
      console.error('    3.  este mismo comando');
      console.error('  Si el desfase es inevitable, --desfase=<horas> lo acepta y lo declara.');
    } else {
      if (Math.abs(anc.des.horas) > 0.01)
        console.log('  desfase   : ' + anc.des.horas.toFixed(1) + ' h (' + anc.des.direccion +
                    '). El movimiento de ese rato queda mal contado.');
      console.log('\n  movimiento de la bodega entera despues del ' + corte + ': ' +
                  conSigno(anc.hacia.movido) + '   (' + anc.hacia.dias + ' dias · ' +
                  mil(anc.db.usadas) + ' filas de todas sus ubicaciones)');
      // el contraste que destapo el problema: los socios por un lado, las
      // ubicaciones sin socio por el otro
      const movSocios = r.total - sumaSemilla(sem);
      console.log('\n  movimiento en la ventana, partido:');
      console.log('    socios atribuidos            : ' + conSigno(movSocios).padStart(12));
      console.log('    ubicaciones sin socio        : ' + conSigno(rs.neto).padStart(12));
      console.log('    suma (todas las ubicaciones) : ' + conSigno(movSocios + rs.neto).padStart(12) +
                  '   ← esto es lo que tiene que dar el movimiento de la bodega en SAP');
      const cua = cuadrar(anc.hacia.nivel, r.total);
      console.log('\n  nivel de bodega al ' + corte + ' : ' + mil(cua.bodega).padStart(12) +
                  '   ← SAP, restando hacia atras. Sin semilla.');
      console.log('  suma de los socios        : ' + mil(cua.socios).padStart(12) +
                  '   ← la capa de ubicaciones');
      console.log('  residuo                   : ' + mil(cua.residuo).padStart(12) +
                  '   ← en la bodega SIN ubicacion asignada (' +
                  (cua.porcentaje == null ? '-' : (100 * cua.porcentaje).toFixed(1) + '%') + ')');
      console.log('  atribuido                 : ' +
                  (cua.cubierto == null ? '-' : (100 * cua.cubierto).toFixed(1) + '%'));
      if (cua.imposible) {
        console.log('\n  RESIDUO NEGATIVO · los socios suman MAS que la bodega que los contiene.');
        console.log('  Eso es imposible: sobra atribucion o falta nivel. Se encuentra sin');
        console.log('  comparar contra ninguna otra fuente.');
      } else {
        console.log('\n  El residuo no es un error: son pallets que estan en la bodega y que');
        console.log('  nadie asigno a una ubicacion. La capa de ubicaciones no los puede ver.');
      }
      const atras = nivelHaciaAtras(anc.w.saldo, anc.db.porDia,
                                    V.diasDeVentana(sem.fecha, vn.hasta).filter(d => d > sem.fecha));
      if (atras) {
        console.log('\n  y al ' + sem.fecha + ' (la fecha de la semilla) la bodega tenia ' +
                    mil(atras.nivel) + ';');
        console.log('  la semilla suma ' + mil(sumaSemilla(sem)) + ', o sea esta corta en ' +
                    mil(atras.nivel - sumaSemilla(sem)) + '.');
      }
    }
  } else {
    console.log('\n  (sin --bodegas el total sale de la semilla, y hereda su error.');
    console.log('   node backfill/sonda-oinm-bodega.js --json > backfill/bodegas-hoy.json)');
  }

  // ── LA SALIDA PARA EL TABLERO ─────────────────────────────────────────────
  const rutaJson = opcion('json', null);
  if (rutaJson) {
    if (!anc) {
      console.error('\n--json necesita --bodegas: sin el ancla de SAP el nivel sale de la');
      console.error('semilla y el tablero mostraria un numero que hereda su error.');
      process.exit(1);
    }
    const mov = movimientoPorDia(filas, deBodega);
    const cua2 = cuadrar(anc.hacia.nivel, r.total);
    const js2 = salidaJson({
      generado: new Date().toISOString(), bodega,
      ventana: { desde: vn.desde, hasta: corte, dias: dias.length,
                 ancla: anc.bod.generado, cobertura: anc.fr ? anc.fr.guardado : null,
                 desfaseHoras: anc.des.horas },
      cuadratura: cua2, niveles, nombre: nom,
      mensual: netoPorMes(anc.db.porDia),
      dias: cierreDelDia(mov, cua2.bodega),
      sinSocio: { ubicaciones: rs.n, filas: rs.filas, neto: rs.neto,
                  detalle: rs.mayores.slice(0, 60) },
      controles: {
        negativos: r.negativos.map(x => ({ cod: x.cod, min: x.min, dia: x.minDia })),
        sinSemilla: r.sinSemilla.map(x => ({ cod: x.cod, cambio: x.cambio })),
        congeladas: q.sinUbicacion.map(x => ({ cod: x.cod, nivel: x.nivel })),
        lineasInternasNetean: fl.cumpleLey, descuadreInterno: fl.descuadre,
        maestro: { ubicaciones: bd.total, conSocio: mapa.size, deOtraBodega: bd.deOtra },
      },
    });
    require('fs').writeFileSync(rutaJson, JSON.stringify(js2, null, 1) + '\n', { encoding: 'utf8' });
    console.log('\n  tablero: ' + rutaJson + '   ·  ' + js2.socios.length + ' socios · ' +
                js2.dias.length + ' dias · UTF-8 sin BOM');
  }

  const v = veredicto(r);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);
  console.log('');
  console.log('  Esto es lo que esta AFUERA. La identidad del pool es');
  console.log('      total = clientes + retail + planta + transito');
  console.log('  y planta sigue pendiente del alcance: ver scripts/alcance-planta.js.');
  console.log('  Mientras falte, esto NO dice cuantos pallets tiene REDTEC.');
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
