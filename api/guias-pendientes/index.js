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
 */
const { obtenerCargas } = require('../shared/spotvision-fetch');
const { obtenerGuias, normalizarPatente } = require('../shared/guias-fetch');

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

  try {
    const [guias, cargas] = await Promise.all([
      obtenerGuias(fecha, fecha),
      // holgura de un día: el filtro de SPOTVISION usa fecha de registro,
      // no fecha_hora_carga (guía de integración, sección 9)
      obtenerCargas(mover(fecha, -1), mover(fecha, 1)),
    ]);

    // patentes que ya cruzaron el túnel en la fecha consultada
    const yaPasaron = new Set(
      cargas
        .filter(c => c.patente && (c.fecha_hora_carga || '').slice(0, 10) === fecha)
        .map(c => normalizarPatente(c.patente))
    );

    const pendientes = guias
      .filter(g => !yaPasaron.has(g.patente))
      .sort((a, b) => String(a.hora_emision).localeCompare(String(b.hora_emision)));

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
