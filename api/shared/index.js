// ============================================================================
//  os-ingesta  ·  trigger TIMER (cada 15 min)
//
//  ⚠ Esta función va en el Function App (redtecagente-...azurewebsites.net),
//    NO en la Static Web App: las Functions gestionadas de SWA solo admiten
//    triggers HTTP y el build falla con un timerTrigger.
//
//  La lógica vive en ../shared/ingesta-core.js (copia idéntica a la de la SWA).
// ============================================================================
const { runIngesta } = require('../shared/ingesta-core.js');

module.exports = async function (context, myTimer) {
  if (myTimer && myTimer.isPastDue) context.log.warn('ingesta atrasada, ejecutando igual');
  try {
    const snap = await runIngesta(context);
    context.log(`ok · generado ${snap.meta.generado} · refrescadas [${(snap.meta.refrescadas || []).join(', ')}]`);
  } catch (err) {
    context.log.error('os-ingesta falló:', err.message);
    throw err; // que quede registrado como fallo de ejecución
  }
};
