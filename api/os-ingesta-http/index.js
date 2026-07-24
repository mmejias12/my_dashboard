// ============================================================================
//  api/os-ingesta-http  ·  ESCRITURA del read model (trigger HTTP)
//
//  Versión compatible con Azure Static Web Apps, que SOLO admite triggers HTTP
//  en sus Functions gestionadas. Hace exactamente lo mismo que os-ingesta:
//  refresca las galaxias y escribe el snapshot en Blob (estrategia patch).
//
//  Usa la lógica compartida de shared/ingesta-core.js.
//  Se dispara con POST. Protegido por secreto compartido para que no quede
//  abierto al mundo (escribe datos).
//
//    POST /api/os-ingesta-http
//    Header:  X-Ingesta-Key: <valor de OS_INGESTA_KEY>
//
//  Para agendarlo, apúntale cualquier scheduler externo, o mejor: usa la
//  versión timer (carpeta os-ingesta) dentro del Function App redtecagente.
// ============================================================================
const { runIngesta } = require('../shared/ingesta-core.js');

const KEY = process.env.OS_INGESTA_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingesta-Key'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  // Sin llave configurada no se ejecuta: evita dejar la escritura abierta.
  if (!KEY) {
    context.res = {
      status: 500, headers: CORS,
      body: JSON.stringify({ error: 'OS_INGESTA_KEY no configurada' })
    };
    return;
  }
  if ((req.headers['x-ingesta-key'] || '') !== KEY) {
    context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: 'no autorizado' }) };
    return;
  }

  const t0 = Date.now();
  try {
    const snap = await runIngesta(context);
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: true,
        generado: snap.meta.generado,
        refrescadas: snap.meta.refrescadas,
        ms: Date.now() - t0
      })
    };
  } catch (err) {
    context.log.error('os-ingesta-http:', err.message);
    context.res = {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
