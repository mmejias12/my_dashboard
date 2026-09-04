/**
 * conciliacion.js — motor de conciliacion GUIA (RDTOut) vs CAMARA (SPOTVISION).
 *
 * Reglas de negocio que resuelve, en orden:
 *
 *  1. CARGA VIVA. Seccion 7 de la guia de SPOTVISION: total_pallets, total_bultos
 *     y la lista de bultos CRECEN mientras el camion se descarga. Comparar antes
 *     de que la carga cierre produce faltantes falsos. Una carga se considera
 *     cerrada cuando no recibe bultos nuevos hace CIERRE_MIN minutos.
 *  2. CRUCE. La API no trae numero de guia: la unica llave disponible es
 *     patente + dia. Como un camion tiene VARIOS movimientos en el mismo dia,
 *     el cruce se resuelve como una asignacion, no paso por paso (ver abajo).
 *  3. ESTADO. ok | faltante | sobrante | sin_guia | sin_patente | en_curso
 *     | fuera_alcance (documento que el tablero no compara, ver soloEmisiones).
 *
 * ATENCION: `campoConteo` decide si se compara total_pallets o total_bultos.
 * La guia de integracion no explica la diferencia entre ambos (en su ejemplo
 * 10 pallets = 2 bultos). Confirmar con SPOTVISION antes de operar en serio.
 */

const CIERRE_MIN = 3;       // minutos sin bultos nuevos para dar la carga por cerrada.
                            // El paso por el tunel dura ~4 s (medido en C920), asi que
                            // 3 min es holgado; los 25 originales venian del modelo de
                            // descarga de la seccion 7, que no aplica a un tunel de salida.
const VENTANA_H = 12;       // horas maximas entre emision de guia y llegada
const TOLERANCIA = 0;       // pallets de diferencia que aun se consideran OK

const { revisarCapacidad } = require('./flota');

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
  const t = (bultos || []).map((b) => ts(b.fecha_hora_deteccion)).sort((a, b) => a - b);
  if (t.length < 2) return { grupos: [], corte_max_s: 0, posible_fusion: false };

  const grupos = [];
  let ini = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] >= CORTE_S * 1000) {
      grupos.push({ bultos: i - ini, desde: new Date(t[ini]).toISOString(),
                    hasta: new Date(t[i - 1]).toISOString(),
                    hueco_s: +((t[i] - t[i - 1]) / 1000).toFixed(1) });
      ini = i;
    }
  }
  grupos.push({ bultos: t.length - ini, desde: new Date(t[ini]).toISOString(),
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

function conciliar(cargas, guias, opts = {}) {
  const {
    cierreMin = CIERRE_MIN,
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

  const { guiaDe, cargaDe, guiasPorLlave, llave } =
    asignar(cargas, guias, campoConteo, soloEmisiones);

  const salida = cargas.map((c, ci) => {
    const t0 = ts(c.fecha_hora_carga);
    const tiempos = (c.bultos || []).map((b) => ts(b.fecha_hora_deteccion));
    const ultimo = tiempos.length ? Math.max(...tiempos) : t0;

    const duracionMin = +((ultimo - t0) / 60000).toFixed(1);
    const minutosSinBultos = +((ahora - ultimo) / 60000).toFixed(1);
    const cerrada = minutosSinBultos >= cierreMin;

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

    // Los demas documentos de esa patente ese dia. Se devuelven SIEMPRE, incluso
    // los ya asignados, con la hora del paso que se los llevo: es lo que permite
    // entender un cruce raro sin salir de la pantalla.
    const alternativas = (guiasPorLlave.get(llave(c.patente, c.fecha_hora_carga)) || [])
      .filter((x) => x !== gi)
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
    const detectados = c[campoConteo];
    let estado, diferencia = null;
    if (!cerrada) estado = 'en_curso';
    else if (!c.patente) estado = 'sin_patente';
    else if (!guia) estado = 'sin_guia';
    else {
      diferencia = detectados - guia.pallets_declarados;
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
      guias_alternativas: alternativas,
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
    parametros: {
      cierre_min: cierreMin, ventana_h: ventanaH, tolerancia_pallets: tolerancia,
      campo_conteo: campoConteo, solo_emisiones: soloEmisiones,
    },
  };
}

module.exports = {
  conciliar, asignar, analizarDeteccion,
  CIERRE_MIN, VENTANA_H, TOLERANCIA, CORTE_S, CORTE_LARGO_S,
};
