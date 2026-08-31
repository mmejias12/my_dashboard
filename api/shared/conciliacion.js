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
 *     patente + ventana horaria. La guia debe estar emitida ANTES de la llegada
 *     y dentro de VENTANA_H horas. Cada guia se consume una sola vez.
 *  3. ESTADO. ok | faltante | sobrante | sin_guia | sin_patente | en_curso.
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

function conciliar(cargas, guias, opts = {}) {
  const {
    cierreMin = CIERRE_MIN,
    ventanaH = VENTANA_H,
    tolerancia = TOLERANCIA,
    campoConteo = 'total_pallets',
    ahora = Date.now(),
  } = opts;

  // indice de guias por patente + fecha
  const idx = new Map();
  for (const g of guias) {
    const k = `${g.patente}|${g.fecha}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(g);
  }
  const usadas = new Set();

  const salida = cargas.map((c) => {
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

    // --- cruce con la guia ---
    let guia = null, alternativas = [];
    if (c.patente) {
      const cand = idx.get(`${c.patente}|${c.fecha_hora_carga.slice(0, 10)}`) || [];
      // UN CAMION TIENE VARIOS MOVIMIENTOS EN EL MISMO DIA. Medido el 28-08:
      // siete de las siete patentes con movimiento tenian dos o tres. NC8771
      // llego con un retiro (doc 80717024, 512) y salio con una emision
      // (DTE 72137, 540); el cruce elegia el retiro y reportaba el documento
      // equivocado. Como el tunel es de salida, la emision tiene prioridad;
      // entre candidatas del mismo tipo gana la mas cercana en el tiempo.
      const libres = cand.filter((g) => !usadas.has(g.numero));
      const rango = (g) => (g.tipo === 'emision' ? 0 : g.tipo === 'retiro' ? 1 : 2);
      libres.sort((x, y) => rango(x) - rango(y)
        || Math.abs(t0 - ts(x.hora_emision)) - Math.abs(t0 - ts(y.hora_emision)));
      if (libres.length) { guia = libres[0]; usadas.add(guia.numero); }
      // El resto queda a mano: el operador puede ver contra qué otro documento
      // se podria haber cruzado sin salir de la pantalla.
      alternativas = libres.slice(1).map((g) => ({
        numero: g.numero, nro_pedido: g.nro_pedido, tipo: g.tipo,
        pallets_declarados: g.pallets_declarados, operacion: g.operacion,
      }));
    }

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
      guias_alternativas: typeof alternativas !== 'undefined' ? alternativas : [],
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
    guias_sin_carga: guias.filter((g) => !usadas.has(g.numero)),
    parametros: { cierre_min: cierreMin, ventana_h: ventanaH, tolerancia_pallets: tolerancia, campo_conteo: campoConteo },
  };
}

module.exports = { conciliar, CIERRE_MIN, VENTANA_H, TOLERANCIA };
