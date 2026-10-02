// ============================================================================
//  api/redlink-ops  ·  Endpoint EXPLÍCITO contra Redlink
//
//  Devuelve el contrato de /proxy/ops leyendo de la API del portal (Holux).
//  Toda la lógica vive en shared/redlink-fetch.js, que es la misma que usa
//  /proxy/ops cuando el origen está conmutado: una sola implementación para
//  que los números no se separen.
//
//  Este endpoint se mantiene aparte aunque /proxy/ops ya sepa hablar Redlink,
//  porque sirve para probar y comparar los dos orígenes sin tocar la
//  configuración de nadie.
//
//      /proxy/redlink-ops?fechaInicio=2026-09-01&fechaFin=2026-09-30
//      ...&crudo=1   payload de Redlink sin traducir
//      ...&diag=1    sólo tiempos y conteos por tramo, sin traer datos
// ============================================================================
'use strict';

const RL = require('../shared/redlink-fetch.js');
const PRESUP = Math.max(1000, parseInt(process.env.REDLINK_PRESUPUESTO_MS || '30000', 10) || 30000);

module.exports = async function (context, req) {
  const res = (status, body, extra) => {
    context.res = {
      status: status,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8',
                               'Cache-Control': 'no-cache' }, extra || {}),
      body: typeof body === 'string' ? body : JSON.stringify(body)
    };
  };
  if (req.method === 'OPTIONS') { res(200, ''); return; }

  const q = req.query || {};
  try {
    const r = await RL.consultarRedlink(q.fechaInicio, q.fechaFin, {
      bp: q.bp, presupuestoMs: PRESUP, crudo: !!q.crudo, soloMedir: !!q.diag
    });
    const cab = { 'X-Redlink-Ms': String(r.ms), 'X-Redlink-Tramos': String(r.tramos.length),
                  'X-Redlink-Bp': r.bp };
    if (q.diag) { res(200, { bp: r.bp, ms: r.ms, tramos: r.tramos }, cab); return; }
    res(200, r.filas, cab);
  } catch (e) {
    if (e.noConfigurado) { res(503, { error: 'Servicio no configurado', detalle: e.message }); return; }
    if (e.agotado)       { res(504, { error: 'La consulta no alcanzó a completarse dentro del presupuesto de tiempo',
                                      detalle: e.message, tramos: e.tramos }); return; }
    if (/debe venir como|no existe|anterior a/.test(e.message)) { res(400, { error: e.message }); return; }
    res(502, { error: 'Error consultando Redlink', detalle: e.message });
  }
};
