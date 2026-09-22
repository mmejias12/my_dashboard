/**
 * conciliacion.js — motor de conciliacion GUIA (RDTOut) vs CAMARA (SPOTVISION).
 *
 * Reglas de negocio que resuelve, en orden:
 *
 *  1. CARGA VIVA. Seccion 7 de la guia de SPOTVISION: total_pallets, total_bultos
 *     y la lista de bultos CRECEN mientras el camion se descarga. Comparar antes
 *     de que la carga cierre produce faltantes falsos. Una carga se considera
 *     cerrada cuando no recibe bultos nuevos hace CIERRE_S segundos.
 *  2. CRUCE. La API no trae numero de guia: la unica llave disponible es
 *     patente + dia. Como un camion tiene VARIOS movimientos en el mismo dia,
 *     el cruce se resuelve como una asignacion, no paso por paso (ver abajo).
 *  3. ESTADO. ok | faltante | sobrante | sin_guia | sin_patente | en_curso
 *     | fuera_alcance (documento que el tablero no compara, ver soloEmisiones)
 *     | comercializacion (pallet que no es de arriendo, ver COLOR mas abajo).
 *
 * ATENCION: `campoConteo` decide si se compara total_pallets o total_bultos.
 * La guia de integracion no explica la diferencia entre ambos (en su ejemplo
 * 10 pallets = 2 bultos). Confirmar con SPOTVISION antes de operar en serio.
 */

/**
 * VENTANA DE CIERRE: segundos sin bultos nuevos para dar la carga por cerrada.
 *
 * La historia del numero importa, porque explica por que estaba tan alto:
 *   25 min  el modelo de DESCARGA de la seccion 7 de la guia de SPOTVISION. Ese
 *           modelo es de recepcion, donde el camion se descarga de a poco. No
 *           aplica a un tunel de salida, que es lo que tenemos.
 *    3 min  primera correccion, ya sabiendo que la pasada dura segundos.
 *   20 s    el numero real, que fija operaciones: la pasada toma 6 a 9 s y el
 *           carro de arrastre suma otros ~9, asi que 20 s cubre camion + carro.
 *           Es ademas el mismo corte que SPOTVISION aplica de su lado para no
 *           partir una unidad en dos cargas (bajaron de 30 s a 20 s).
 *
 * OJO CON LA UNIDAD. Esto se media en MINUTOS con un toFixed(1), o sea en pasos
 * de 6 segundos: pedir 20 s cerraba de verdad a los 24, y 18, 20 y 21 s eran el
 * mismo valor. Por eso el umbral vive en segundos.
 *
 * NUESTRA VENTANA NO PUEDE SER MENOR QUE LA DE SPOTVISION mas su latencia de
 * publicacion: si lo fuera, estariamos comparando una carga que ellos todavia
 * pueden completar. Con las dos en 20 s quedamos al ras, asi que se puede subir
 * sin desplegar con la app setting CIERRE_SEGUNDOS. La senal de que quedo corta
 * es un faltante que se corrige solo en el ciclo siguiente.
 */
const CIERRE_S = Number(process.env.CIERRE_SEGUNDOS) || 20;
const CIERRE_MIN = CIERRE_S / 60;   // se sigue publicando por compatibilidad
const VENTANA_H = 12;       // horas maximas entre emision de guia y llegada
const TOLERANCIA = 0;       // pallets de diferencia que aun se consideran OK

const { revisarCapacidad } = require('./flota');

/**
 * EL COLOR DEL PALLET DEFINE EL ALCANCE DEL CRUCE.
 *
 * REDTEC corre DOS negocios sobre los mismos camiones y el mismo tunel:
 *   · ARRIENDO de pallets — el pallet ROJO. Se documenta en RDTOut (Redlink) y
 *     es lo que este motor sabe verificar.
 *   · COMERCIALIZACION — compra y venta de pallet blanco. Se documenta en SAP,
 *     no pasa por Redlink, y por lo tanto NUNCA va a tener guia de este lado.
 *
 * MEDIDO DEL 04 AL 17-09-2026, 118 cargas:
 *   · 107 rojas  -> 68 ok, 16 faltante, 9 sobrante, 14 sin guia.
 *   ·  11 blancas -> 10 caian en "sin guia": alerta CRITICA, con sonido y con
 *     correo a operaciones, por un movimiento que esta perfectamente
 *     documentado, solo que en otro sistema.
 *   · Y la blanca numero 11 (BJCL13, 11-09) es el caso que obliga a poner el
 *     filtro ACA y no al final: se cruzo contra una guia y quedo en "ok". El
 *     tablero dio por cuadrado un despacho de arriendo usando el conteo de un
 *     camion de comercializacion. Una alerta de mas molesta; un "ok" inventado
 *     no lo revisa nadie.
 *
 * EL DATO SALE DE LA PROPIA CAMARA. Desde el 05-09 SPOTVISION entrega el color
 * de cada pallet en `detalles`, y spotvision-fetch lo agrega en `colores`. En
 * las 118 cargas medidas no hubo ninguna sin ese dato; aun asi, si faltara, la
 * carga se cruza como siempre: el silencio no se asume.
 *
 * El umbral es holgado a proposito. En lo medido las rojas vienen 100% rojas y
 * las blancas traen 0% o 0,2% de rojo, asi que exigir la mitad deja muchisimo
 * margen antes de clasificar mal una carga mixta. Se puede mover sin desplegar
 * con la app setting UMBRAL_ROJO.
 */
const UMBRAL_ROJO = Number(process.env.UMBRAL_ROJO) || 0.5;

function perfilColor(c) {
  const col = c && c.colores;
  if (!col) return { conocido: false, es_arriendo: true };
  const total = Object.keys(col).reduce((s, k) => s + (Number(col[k]) || 0), 0);
  if (!total) return { conocido: false, es_arriendo: true };
  const rojo = Number(col.rojo) || 0;
  const dominante = Object.keys(col).sort((a, b) => col[b] - col[a])[0];
  return {
    conocido: true,
    total,
    rojo,
    dominante,
    pct_rojo: +(rojo / total).toFixed(3),
    // Sin dato de color se asume arriendo: es el comportamiento de siempre.
    es_arriendo: (rojo / total) >= UMBRAL_ROJO,
  };
}

const ts = (s) => new Date(s).getTime();

/**
 * FUSION DE PASADAS.
 *
 * Un camion cruza el tunel en una rafaga continua: 14 bultos en 2,2 s, 30 en
 * 7,5 s. Cuando en medio de una carga aparece un corte de varios segundos, lo
 * que sigue despues del corte suele ser OTRO camion que la API sumo a la misma
 * carga y le puso la patente del primero.
 *
 * Caso medido el 04-09-2026, carga C1108, patente CCRC36:
 *   12:56:59 - 12:57:02   12 bultos
 *   (corte de 2,2 s)      -> camion y carro de la misma unidad
 *   12:57:04 - 12:57:08   18 bultos
 *   (CORTE DE 9,2 s)
 *   12:57:17 - 12:57:20   14 bultos
 * Total 44 bultos y 791 pallets, cuando CCRC36 no puede llevar mas de 600.
 * Los primeros 30 bultos son 540 (la carga de CCRC36) y los ultimos 14 son
 * 252: exactamente el despacho del LS3119, que operaciones reporto como
 * "salio y la camara no lo detecto". Si salio; quedo dentro de otra carga.
 *
 * La firma es doble y por eso se puede afirmar: un corte largo Y un total que
 * no cabe fisicamente arriba del camion. Un corte solo puede ser el carro de
 * arrastre entrando aparte, que es legitimo.
 */
const CORTE_S = 2;        // separacion minima para considerar que hubo un corte
const CORTE_LARGO_S = 6;  // por sobre esto ya no parece el carro de la misma unidad

function analizarDeteccion(bultos, capacidad, contados) {
  // Se ordenan los bultos ENTEROS, no solo sus tiempos: para poder cortar hace
  // falta saber cuantos pallets trae cada grupo, no solo cuantas filas.
  const ord = (bultos || []).slice()
    .sort((x, y) => ts(x.fecha_hora_deteccion) - ts(y.fecha_hora_deteccion));
  const t = ord.map((b) => ts(b.fecha_hora_deteccion));
  if (t.length < 2) return { grupos: [], corte_max_s: 0, posible_fusion: false };

  const pal = (a, b) => ord.slice(a, b).reduce((s, x) => s + (Number(x.pallets_bulto) || 0), 0);
  const filas = (a, b) => ord.slice(a, b).map((x) => Number(x.pallets_bulto) || 0);

  const grupos = [];
  let ini = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] >= CORTE_S * 1000) {
      grupos.push({ bultos: i - ini, pallets: pal(ini, i), filas: filas(ini, i),
                    desde: new Date(t[ini]).toISOString(),
                    hasta: new Date(t[i - 1]).toISOString(),
                    hueco_s: +((t[i] - t[i - 1]) / 1000).toFixed(1) });
      ini = i;
    }
  }
  grupos.push({ bultos: t.length - ini, pallets: pal(ini, t.length), filas: filas(ini, t.length),
                desde: new Date(t[ini]).toISOString(),
                hasta: new Date(t[t.length - 1]).toISOString(), hueco_s: null });

  const corteMax = Math.max(0, ...grupos.map((g) => g.hueco_s || 0));
  const excede = !!(capacidad && contados > capacidad);

  return {
    grupos,
    corte_max_s: corteMax,
    // Se afirma solo con las dos senales juntas.
    posible_fusion: excede && corteMax >= CORTE_LARGO_S && grupos.length > 1,
  };
}

/**
 * SEGMENTACION DE UNA CARGA FUSIONADA.
 *
 * El problema, medido el 22-09-2026 en la carga C1254 (SP3393, guia 72462):
 *   G1   4 bultos    72 pallets
 *   G2  10 bultos   180 pallets   -> acumulado 252
 *   (hueco de 12,6 s)
 *   G3  10 bultos   138 pallets   -> acumulado 390
 * La camara conto 390 y la guia declaraba 252. Un yale paso arrastrando pallets
 * dentro de la ventana de cierre y su carga quedo sumada a la del camion.
 *
 * POR QUE SE PUEDE CORTAR SIN INVENTAR:
 * la decision NO se toma porque asi cuadra con la guia. Se toma porque los
 * 390 pallets NO CABEN: SP3393 es camion simple, tope 320. Un total que no
 * cabe fisicamente arriba no es una diferencia con el documento, es un conteo
 * que mezclo dos cosas. Recien ahi, sabiendo que sobra, la guia sirve para
 * ubicar DONDE cortar.
 *
 * Ese orden importa: si se cortara cada vez que el corte hace cuadrar el
 * numero, el monitor perderia justamente lo que lo hace util — la capacidad de
 * detectar un camion realmente sobrecargado. Por eso el exceso de capacidad es
 * condicion de entrada, no una comprobacion posterior.
 *
 * Nunca se descarta en silencio: la cola excluida se devuelve entera, con sus
 * filas y su horario, para que quien mire pueda darla por buena o rechazarla.
 */
function segmentarCarga(deteccion, capacidad, declarado) {
  const g = (deteccion && deteccion.grupos) || [];
  const vacio = { aplicada: false, motivo: null, grupos_camion: null,
                  pallets_camion: null, pallets_excluidos: null, cola: null };

  // Condicion de entrada: tiene que haber mas de un grupo, un corte largo y un
  // total que no quepa arriba del camion. Sin las tres, no se toca nada.
  if (!deteccion || !deteccion.posible_fusion || g.length < 2) return vacio;
  if (!capacidad) return { ...vacio, motivo: 'sin_capacidad_conocida' };

  const total = g.reduce((s, x) => s + (x.pallets || 0), 0);
  if (total <= capacidad) return { ...vacio, motivo: 'cabe_en_el_camion' };

  // Prefijos acumulados: G1, G1+G2, G1+G2+G3...
  const acum = [];
  let a = 0;
  for (const x of g) { a += x.pallets || 0; acum.push(a); }

  // Solo son candidatos los prefijos que caben fisicamente.
  const caben = acum.map((v, i) => ({ i, v })).filter((x) => x.v <= capacidad);
  if (!caben.length) return { ...vacio, motivo: 'ningun_prefijo_cabe' };

  let elegido = null, motivo = null;
  if (declarado > 0) {
    // 1. El prefijo que calza EXACTO con lo declarado. Es el caso limpio.
    const exacto = caben.find((x) => x.v === declarado);
    if (exacto) { elegido = exacto; motivo = 'prefijo_calza_exacto_con_la_guia'; }
    else {
      // 2. Si ninguno calza exacto, el mas cercano a lo declarado, siempre que
      //    quede razonablemente cerca. Si ni eso, no se corta: se prefiere
      //    dejar la diferencia a la vista antes que fabricar un numero.
      const cerca = caben.slice().sort((x, y) =>
        Math.abs(x.v - declarado) - Math.abs(y.v - declarado))[0];
      const margen = Math.max(18, Math.round(declarado * 0.05));
      if (cerca && Math.abs(cerca.v - declarado) <= margen) {
        elegido = cerca; motivo = 'prefijo_mas_cercano_a_la_guia';
      }
    }
  }
  // 3. Sin guia con que comparar, se corta por lo ultimo que cabe arriba.
  if (!elegido) {
    elegido = caben[caben.length - 1];
    motivo = declarado > 0 ? 'ningun_prefijo_se_acerca_a_la_guia' : 'ultimo_prefijo_que_cabe';
  }
  if (motivo === 'ningun_prefijo_se_acerca_a_la_guia') {
    // No se corta: que la diferencia quede visible.
    return { ...vacio, motivo };
  }

  const corte = elegido.i;                       // ultimo grupo que es del camion
  const cola = g.slice(corte + 1);
  if (!cola.length) return { ...vacio, motivo: 'no_sobra_ningun_grupo' };

  return {
    aplicada: true,
    motivo,
    grupos_camion: corte + 1,
    grupos_totales: g.length,
    pallets_camion: elegido.v,
    pallets_excluidos: total - elegido.v,
    capacidad,
    total_camara: total,
    hueco_del_corte_s: g[corte].hueco_s,
    cola: cola.map((x) => ({
      bultos: x.bultos, pallets: x.pallets, filas: x.filas,
      desde: x.desde, hasta: x.hasta,
    })),
  };
}

/**
 * ASIGNACION PATENTE + DIA.
 *
 * Por que no alcanza con recorrer las cargas en orden y que cada una tome la
 * primera guia libre: medido el 01-09-2026, RW5303 paso dos veces. A las 05:42
 * la camara conto 402 y a las 14:42 conto 540; la unica emision del dia
 * (DTE 72183, pedido 4087420, ALIMENTOS ANDINOS) declaraba 540. El recorrido
 * cronologico le entregaba la emision al paso de las 05:42 -- que llegaba
 * primero -- y dejaba al de las 14:42 cruzado contra un retiro de 114, con un
 * "sobrante" de +426 que nunca existio. El paso de las 14:42 calzaba EXACTO
 * con la emision: 30 bultos, 540 pallets, 540 declarados.
 *
 * La cantidad es informacion del cruce, no solo del resultado. Se arman todos
 * los pares posibles dentro de la misma patente y el mismo dia, se ordenan por
 * que tan bien calzan y se asigna de arriba hacia abajo. Un calce exacto le
 * gana siempre a uno que solo llego antes.
 *
 * Criterio de orden, en este orden:
 *   1. tipo de documento (emision primero: el tunel es de salida)
 *   2. diferencia absoluta contra el conteo de la camara
 *   3. cercania en el tiempo, para desempatar
 */
function asignar(cargas, guias, campoConteo, soloEmisiones) {
  const llave = (pat, fechaHora) => `${pat}|${String(fechaHora).slice(0, 10)}`;

  const guiasPorLlave = new Map();
  guias.forEach((g, gi) => {
    const k = llave(g.patente, g.fecha);
    if (!guiasPorLlave.has(k)) guiasPorLlave.set(k, []);
    guiasPorLlave.get(k).push(gi);
  });

  const pares = [];
  cargas.forEach((c, ci) => {
    if (!c.patente) return;
    // Una carga que no es de arriendo no se empareja con NINGUNA guia: su
    // documento vive en SAP. Sin esto, el motor le encontraba una guia roja
    // cualquiera del dia y devolvia un "ok" que nadie iba a revisar.
    if (!perfilColor(c).es_arriendo) return;
    const candidatas = guiasPorLlave.get(llave(c.patente, c.fecha_hora_carga)) || [];
    for (const gi of candidatas) {
      const g = guias[gi];
      if (soloEmisiones && g.tipo !== 'emision') continue;
      pares.push({
        ci, gi,
        rango: g.tipo === 'emision' ? 0 : g.tipo === 'retiro' ? 1 : 2,
        dif: Math.abs((c[campoConteo] ?? 0) - g.pallets_declarados),
        dt: Math.abs(ts(c.fecha_hora_carga) - ts(g.hora_emision)),
      });
    }
  });

  pares.sort((a, b) => a.rango - b.rango || a.dif - b.dif || a.dt - b.dt);

  const guiaDe = new Map();   // indice de carga -> indice de guia
  const cargaDe = new Map();  // indice de guia  -> indice de carga
  for (const p of pares) {
    if (guiaDe.has(p.ci) || cargaDe.has(p.gi)) continue;
    guiaDe.set(p.ci, p.gi);
    cargaDe.set(p.gi, p.ci);
  }
  return { guiaDe, cargaDe, guiasPorLlave, llave };
}

/**
 * CONSOLIDACION: UN CAMION PUEDE SALIR CON VARIAS GUIAS.
 *
 * Caso medido el 08-09-2026. CCRC36 cruzo a las 10:46 con 504 pallets en 28
 * filas. El cruce le asigno la emision 72274 (252 pallets) y reporto un
 * sobrante de +252, mientras la 72275 -- otros 252, para otro cliente --
 * quedaba como "despacho sin registro de camara". Las dos iban en el mismo
 * camion: 252 + 252 = 504, y 28 filas = 14 + 14. No sobraba nada.
 *
 * Antes de acusar una diferencia se busca si alguna COMBINACION de los
 * documentos libres de esa patente y ese dia explica el conteo exacto. Vale
 * para los dos lados: tambien cambia una guia grande mal asignada por dos
 * chicas que suman justo, que es el caso del faltante inventado.
 *
 * Reglas para no inventar explicaciones:
 *  - solo se acepta una combinacion que calce DENTRO DE LA TOLERANCIA. No se
 *    acepta la "mas cercana": si nada calza, la diferencia se informa igual.
 *  - gana la combinacion con MENOS documentos; un solo documento exacto le
 *    gana siempre a dos que sumen lo mismo.
 *  - a igualdad de documentos, gana la que conserva la guia ya asignada.
 *  - maximo MAX_DOCS documentos por carga: mas que eso ya no es un despacho
 *    consolidado, es una coincidencia numerica.
 *  - solo documentos libres: una guia ya cruzada con otro paso no se reutiliza.
 */
const MAX_DOCS = 4;        // documentos que puede llevar un camion en una salida
const MAX_CANDIDATAS = 12; // tope para no disparar la combinatoria

function combinaciones(indices, maxDocs) {
  const salida = [];
  const rec = (desde, actual) => {
    if (actual.length) salida.push(actual.slice());
    if (actual.length === maxDocs) return;
    for (let i = desde; i < indices.length; i++) {
      actual.push(indices[i]);
      rec(i + 1, actual);
      actual.pop();
    }
  };
  rec(0, []);
  return salida;
}

function consolidar(cargas, guias, opts) {
  const { guiaDe, cargaDe, guiasPorLlave, llave, campoConteo, tolerancia, soloEmisiones } = opts;

  // indice de carga -> lista de indices de guia (uno o varios)
  const guiasDe = new Map();
  cargas.forEach((c, ci) => {
    const gi = guiaDe.get(ci);
    if (gi !== undefined) guiasDe.set(ci, [gi]);
  });

  cargas.forEach((c, ci) => {
    if (!c.patente) return;
    if (!perfilColor(c).es_arriendo) return;   // ver asignar(): tampoco se consolida
    const contados = c[campoConteo] ?? 0;
    if (!contados) return;

    const asignada = guiaDe.get(ci);
    const declarado = asignada !== undefined ? guias[asignada].pallets_declarados : 0;
    if (asignada !== undefined && Math.abs(contados - declarado) <= tolerancia) return; // ya calza

    // Candidatas: la ya asignada (se puede cambiar) mas las que nadie tomo.
    const todas = guiasPorLlave.get(llave(c.patente, c.fecha_hora_carga)) || [];
    const pool = todas.filter((gi) => {
      const g = guias[gi];
      if (soloEmisiones && g.tipo !== 'emision') return false;
      if (g.pallets_declarados <= 0) return false;
      return gi === asignada || !cargaDe.has(gi);
    }).slice(0, MAX_CANDIDATAS);
    if (pool.length < 2) return;   // sin nada que combinar

    let mejor = null;
    for (const combo of combinaciones(pool, MAX_DOCS)) {
      if (combo.length < 2 && combo[0] === asignada) continue;   // es lo que ya teniamos
      const suma = combo.reduce((s, gi) => s + guias[gi].pallets_declarados, 0);
      if (Math.abs(contados - suma) > tolerancia) continue;
      const conservaAsignada = asignada !== undefined && combo.includes(asignada) ? 0 : 1;
      const puntaje = [combo.length, conservaAsignada];
      if (!mejor || puntaje[0] < mejor.puntaje[0]
          || (puntaje[0] === mejor.puntaje[0] && puntaje[1] < mejor.puntaje[1])) {
        mejor = { combo, puntaje };
      }
    }
    if (!mejor) return;

    // Se adopta: se libera lo que ya no se usa y se reservan los nuevos.
    for (const gi of (guiasDe.get(ci) || [])) {
      if (!mejor.combo.includes(gi)) cargaDe.delete(gi);
    }
    mejor.combo.forEach((gi) => cargaDe.set(gi, ci));
    guiasDe.set(ci, mejor.combo);
    guiaDe.set(ci, mejor.combo[0]);
  });

  return guiasDe;
}

/** true si los numeros de documento son correlativos (72274, 72275, ...). */
function sonCorrelativas(nums) {
  const n = nums.map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (n.length !== nums.length || n.length < 2) return false;
  return n.every((x, i) => i === 0 || x === n[i - 1] + 1);
}

function conciliar(cargas, guias, opts = {}) {
  const {
    // En segundos. `cierreMin` se sigue aceptando para no romper a quien ya
    // llamaba con ?cierre_min=, pero si viene, manda.
    cierreS = CIERRE_S,
    cierreMin = null,
    ventanaH = VENTANA_H,
    tolerancia = TOLERANCIA,
    campoConteo = 'total_pallets',
    // El monitor de anden mira solo emisiones: el tunel es de salida y la
    // pregunta operativa es si el camion se va con lo que dice la guia. Los
    // retiros llegan con pallets del cliente y se revisan contra la inspeccion,
    // que es otro flujo y otro momento.
    soloEmisiones = false,
    ahora = Date.now(),
  } = opts;

  const cierre = Number.isFinite(Number(cierreMin)) && Number(cierreMin) > 0
    ? Number(cierreMin) * 60
    : cierreS;

  const { guiaDe, cargaDe, guiasPorLlave, llave } =
    asignar(cargas, guias, campoConteo, soloEmisiones);

  // Segunda pasada: antes de acusar una diferencia, ver si el camion salio con
  // mas de un documento y entre todos explican el conteo.
  const guiasDe = consolidar(cargas, guias, {
    guiaDe, cargaDe, guiasPorLlave, llave, campoConteo, tolerancia, soloEmisiones,
  });

  const salida = cargas.map((c, ci) => {
    const t0 = ts(c.fecha_hora_carga);
    const tiempos = (c.bultos || []).map((b) => ts(b.fecha_hora_deteccion));
    const ultimo = tiempos.length ? Math.max(...tiempos) : t0;

    const duracionMin = +((ultimo - t0) / 60000).toFixed(1);
    // En segundos: con una ventana de 20 s, redondear a decimas de minuto
    // (pasos de 6 s) hacia imposible expresar el umbral.
    const segundosSinBultos = +((ahora - ultimo) / 1000).toFixed(1);
    const minutosSinBultos = +(segundosSinBultos / 60).toFixed(1);
    const cerrada = segundosSinBultos >= cierre;

    // pausa mas larga entre detecciones consecutivas: el tiempo muerto real
    const serie = [t0, ...tiempos].sort((a, b) => a - b);
    let pausaMax = 0;
    for (let i = 1; i < serie.length; i++) {
      pausaMax = Math.max(pausaMax, (serie[i] - serie[i - 1]) / 60000);
    }

    const cap = revisarCapacidad(c.patente, c[campoConteo], null);
    const deteccion = analizarDeteccion(c.bultos, cap?.capacidad_total, c[campoConteo]);

    const gi = guiaDe.get(ci);
    const guia = gi === undefined ? null : guias[gi];
    // Documentos que viajaron en esta carga. Normalmente uno; a veces varios.
    const docs = (guiasDe.get(ci) || []).map((x) => guias[x]);
    const declaradoTotal = docs.reduce((s, g) => s + g.pallets_declarados, 0);

    // Los demas documentos de esa patente ese dia. Se devuelven SIEMPRE, incluso
    // los ya asignados, con la hora del paso que se los llevo: es lo que permite
    // entender un cruce raro sin salir de la pantalla.
    const usados = new Set(guiasDe.get(ci) || []);
    const alternativas = (guiasPorLlave.get(llave(c.patente, c.fecha_hora_carga)) || [])
      .filter((x) => !usados.has(x))
      .map((x) => {
        const g = guias[x];
        const otra = cargaDe.get(x);
        return {
          numero: g.numero, nro_pedido: g.nro_pedido, tipo: g.tipo,
          pallets_declarados: g.pallets_declarados, operacion: g.operacion,
          asignada_a: otra === undefined ? null : cargas[otra].fecha_hora_carga,
        };
      });

    // --- estado ---
    // Si la carga mezclo dos pasadas, el estado se calcula sobre lo que SI es
    // del camion. El total en crudo se sigue publicando aparte: nadie deberia
    // tener que confiar a ciegas en que el corte estuvo bien hecho.
    const segmento = segmentarCarga(deteccion, cap?.capacidad_total, declaradoTotal);
    const detectadosCrudo = c[campoConteo];
    const detectados = segmento.aplicada ? segmento.pallets_camion : detectadosCrudo;
    const perfil = perfilColor(c);
    let estado, diferencia = null;
    if (!cerrada) estado = 'en_curso';
    // Va antes que sin_patente y que sin_guia: si el pallet no es de arriendo,
    // que la camara haya leido o no la patente da lo mismo — no hay con que
    // cruzarlo de este lado.
    else if (!perfil.es_arriendo) estado = 'comercializacion';
    else if (!c.patente) estado = 'sin_patente';
    else if (!guia) estado = 'sin_guia';
    else {
      // Se compara contra la SUMA de los documentos que lleva el camion.
      diferencia = detectados - declaradoTotal;
      estado = Math.abs(diferencia) <= tolerancia ? 'ok'
             : diferencia < 0 ? 'faltante' : 'sobrante';
    }

    return {
      ...c,
      guia,
      estado,
      diferencia,
      cerrada,
      duracion_min: duracionMin,
      segundos_sin_bultos: segundosSinBultos,
      minutos_sin_bultos: minutosSinBultos,
      pausa_max_min: +pausaMax.toFixed(1),
      ritmo_bultos_min: duracionMin > 0 ? +((c.bultos || []).length / duracionMin).toFixed(2) : null,
      tipo: guia?.tipo ?? null,
      // Contraste contra la capacidad física del camión. Un conteo por sobre el
      // tope no cabe arriba, así que no es una diferencia con el documento sino
      // un problema del conteo mismo.
      capacidad: revisarCapacidad(c.patente, c[campoConteo], guia?.tipo),
      // Como llegaron los bultos en el tiempo, y si el corte + el exceso de
      // capacidad apuntan a que aca hay mas de un camion sumado.
      deteccion,
      // Cuando la carga venia fusionada: que parte se le atribuyo al camion,
      // que quedo fuera, y por que. Con aplicada:false no se toco nada.
      segmento,
      // El conteo SIN segmentar, siempre. Si el corte estuvo mal, este numero
      // es el que permite darse cuenta.
      pallets_camara_crudo: detectadosCrudo,
      pallets_camara: detectados,
      // Que vio la camara en cuanto a color, y si eso cae dentro del arriendo.
      perfil_color: perfil,
      guias_alternativas: alternativas,
      // Cuando el camion sale con varios documentos, aca van todos y el total
      // contra el que se comparo. `correlativas` corrobora el caso tipico: dos
      // guias emitidas una tras otra para el mismo viaje.
      guias: docs,
      pallets_declarados_total: docs.length ? declaradoTotal : null,
      consolidada: docs.length > 1,
      correlativas: docs.length > 1 && sonCorrelativas(docs.map((g) => g.numero)),
      nro_pedido: guia?.nro_pedido ?? null,
      etapa: guia?.etapa ?? null,
      transportista: guia?.transportista ?? null,
      cliente: guia?.cliente ?? null,
      bodega: guia?.bodega ?? null,
      bultos_sin_foto: (c.bultos || []).filter((b) => !b.foto_bulto_url).length,
    };
  });

  salida.sort((a, b) => a.fecha_hora_carga.localeCompare(b.fecha_hora_carga));

  return {
    cargas: salida,
    // guias emitidas cuyo camion nunca aparecio en el tunel (o cuya patente no se leyo)
    guias_sin_carga: guias.filter((g, gi) =>
      !cargaDe.has(gi) && (!soloEmisiones || g.tipo === 'emision')),
    parametros_consolidacion: { max_documentos: MAX_DOCS },
    parametros: {
      cierre_s: cierre, cierre_min: +(cierre / 60).toFixed(2),
      umbral_rojo: UMBRAL_ROJO,
      ventana_h: ventanaH, tolerancia_pallets: tolerancia,
      campo_conteo: campoConteo, solo_emisiones: soloEmisiones,
    },
  };
}

module.exports = {
  conciliar, asignar, analizarDeteccion, segmentarCarga, consolidar, sonCorrelativas,
  perfilColor, UMBRAL_ROJO,
  CIERRE_S, CIERRE_MIN, VENTANA_H, TOLERANCIA, CORTE_S, CORTE_LARGO_S,
};
