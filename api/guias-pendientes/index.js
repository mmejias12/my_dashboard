/**
 * GET /api/guias-pendientes
 *
 * Devuelve las guías emitidas del día que TODAVÍA no han cruzado el túnel.
 * Es la columna izquierda del monitor de andén.
 *
 * El filtrado se hace acá y no en el navegador a propósito: si el operador
 * recarga la página, los camiones que ya pasaron no deben reaparecer como
 * pendientes. El estado vive en el servidor, no en la pestaña.
 *
 * Parámetros opcionales:
 *   fecha=YYYY-MM-DD   por defecto, hoy en America/Santiago
 *   tipo=emision       sólo despachos (lo que usa el monitor de andén)
 *   arrastre=N         además del día pedido, revisa los N días anteriores y
 *                      devuelve las emisiones de esos días que nunca cruzaron.
 *                      Sin esto, una guía que no salió simplemente desaparecía
 *                      de la pantalla a la medianoche.
 */
const { obtenerCargas } = require('../shared/spotvision-fetch');
const { obtenerGuias } = require('../shared/guias-fetch');
const { conciliar } = require('../shared/conciliacion');

/** Fecha de hoy en Santiago, sin depender de la zona horaria del host. */
function hoySantiago() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

const mover = (s, n) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

module.exports = async function (context, req) {
  const fecha = req.query.fecha || hoySantiago();
  // Arrastre: cuántos días hacia atrás se revisan además del día pedido.
  const arrastre = Math.min(Math.max(Number(req.query.arrastre) || 0, 0), 7);
  const desde = mover(fecha, -arrastre);

  try {
    const [guias, cargas] = await Promise.all([
      obtenerGuias(desde, fecha),
      // holgura de un día: el filtro de SPOTVISION usa fecha de registro,
      // no fecha_hora_carga (guía de integración, sección 9)
      obtenerCargas(mover(desde, -1), mover(fecha, 1)),
    ]);

    // ?tipo=emision — el monitor de andén espera despachos, no retiros. Sin
    // este recorte la columna de espera se llena de solicitudes de retiro en
    // etapa de inspección (el 01-09 eran 15 de 17) que nunca son un despacho.
    const soloEmisiones = req.query.tipo === 'emision';

    // QUÉ CUENTA COMO "YA PASÓ". Antes se descartaba por PATENTE: bastaba que
    // el camión cruzara una vez para que todas sus guías del día salieran de la
    // espera. Con dos emisiones en un día eso escondía la segunda — el 01-09,
    // SP3393 tenía la 72179 y la 72172, cruzó una y la otra desapareció de la
    // pantalla sin haber salido nunca. Ahora se corre el mismo motor de cruce
    // que usa el monitor y quedan pendientes exactamente las guías que ninguna
    // carga se llevó.
    const delDia = cargas.filter((c) => {
      const f = (c.fecha_hora_carga || '').slice(0, 10);
      return c.patente && f >= desde && f <= fecha;
    });

    const { guias_sin_carga } = conciliar(delDia, guias, { soloEmisiones });

    // El orden que importa en el andén es por DÍA DE DESPACHO: primero lo que
    // quedó atrasado de días anteriores, después lo de hoy. Ordenar por
    // hora_emision ponía arriba documentos creados hace semanas.
    const pendientes = guias_sin_carga.sort((a, b) =>
      String(a.fecha).localeCompare(String(b.fecha)) ||
      String(a.hora_emision).localeCompare(String(b.hora_emision)));

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(pendientes.map(g => ({
        numero: g.numero,
        patente: g.patente,
        chofer: g.chofer,
        cliente: g.cliente,
        bodega: g.bodega,
        pallets_declarados: g.pallets_declarados,
        filas: g.filas ?? null,
        pallets_por_fila: g.pallets_por_fila ?? null,
        hora_emision: g.hora_emision,
        // Días de atraso respecto del día operativo pedido. 0 = le toca hoy.
        // Es el dato que la pantalla necesita para distinguir "programado para
        // hoy" de "debió salir ayer y no salió"; hora_emision no sirve para eso
        // porque es cuándo se CREÓ el documento, no cuándo debe despacharse.
        dias_atraso: g.fecha
          ? Math.round((Date.parse(fecha + 'T12:00:00Z') - Date.parse(g.fecha + 'T12:00:00Z')) / 86400000)
          : null,
        // se devuelven para poder diagnosticar el cruce desde el navegador
        fecha: g.fecha,
        operacion: g.operacion,
        tipo: g.tipo,
        etapa: g.etapa,
        // true = RDTOut ya cerró y confirmó el despacho, así que el camión
        // salió: lo que falta no es el camión, es el registro de la cámara.
        despacho_cerrado: !!g.despacho_cerrado,
        nro_pedido: g.nro_pedido,
        cantidad_solicitada: g.cantidad_solicitada,
        cantidad_despachada: g.cantidad_despachada,
        cantidad_confirmada: g.cantidad_confirmada,
      }))),
    };
  } catch (e) {
    context.log.error('guias-pendientes', e);
    context.res = {
      status: e.status && e.status < 500 ? e.status : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
