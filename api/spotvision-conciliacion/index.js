/**
 * GET /api/spotvision-conciliacion?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Devuelve exactamente el JSON que consume recepcion-conciliacion.html.
 * Une SPOTVISION (conteo por camara) con las guias de RDTOut y corre el
 * motor de conciliacion.
 */
const { obtenerCargas } = require('../shared/spotvision-fetch');
const { obtenerGuias } = require('../shared/guias-fetch');
const { conciliar } = require('../shared/conciliacion');
const { patenteEnAlcance } = require('../shared/flota');

// Seccion 9 de la guia: el filtro de fechas usa la fecha de REGISTRO en
// SPOTVISION, no fecha_hora_carga. Se consulta con holgura y luego se recorta.
const HOLGURA_DIAS = 1;

const dia = (d) => d.toISOString().slice(0, 10);
const mover = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dia(d); };

module.exports = async function (context, req) {
  const hasta = req.query.hasta || dia(new Date());
  const desde = req.query.desde || mover(hasta, -13);

  try {
    const [cargasCrudas, guias] = await Promise.all([
      obtenerCargas(mover(desde, -HOLGURA_DIAS), mover(hasta, HOLGURA_DIAS)),
      obtenerGuias(desde, hasta),
    ]);

    // recorte al rango pedido usando fecha_hora_carga (la de terreno) y
    // descarte de las patentes fuera de alcance (Talca, patente de pruebas).
    const cargas = cargasCrudas.filter((c) => {
      const f = (c.fecha_hora_carga || '').slice(0, 10);
      return f >= desde && f <= hasta && patenteEnAlcance(c.patente);
    });

    const r = conciliar(cargas, guias, {
      cierreMin: Number(req.query.cierre_min) || undefined,
      tolerancia: Number(req.query.tolerancia) || undefined,
      campoConteo: req.query.campo === 'bultos' ? 'total_bultos' : 'total_pallets',
      // ?tipo=emision — lo usa el monitor de andén. El túnel es de salida: la
      // pregunta operativa es si el camión se va con lo que declara la guía.
      // Los retiros llegan con pallets del cliente y se revisan contra la
      // inspección, en otro momento y con otro documento.
      soloEmisiones: req.query.tipo === 'emision',
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        generado: new Date().toISOString(),
        rango: { desde, hasta },
        ...r,
      }),
    };
  } catch (e) {
    context.log.error('spotvision-conciliacion', e);
    context.res = {
      status: e.status && e.status < 500 ? e.status : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
