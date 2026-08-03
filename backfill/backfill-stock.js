// backfill/backfill-stock.js
// Carga inicial del read model diario de stock (pool rojos) desde RDTOut.
// Freeze total: cada día pasado es definitivo (cierres al 23:59 del día anterior),
// así que NO se re-tocan días ya válidos en caché. Idempotente y re-ejecutable.
// Auto-sana: un día cacheado con null/null (fallo previo) se re-consulta.
//
// Requiere en el entorno (misma sesión de PowerShell):
//   $env:OS_STORAGE_CONN="..."      (storage redtecos)
//   $env:REDTEC_API_KEY="..."       (llave de RDTOut; SIN default en stock-fetch)
//
// Uso local (con git pull previo):
//   node backfill-stock.js                          # 2023-03-20 -> ayer
//   node backfill-stock.js 2026-01-01 2026-07-31    # rango puntual
//   node backfill-stock.js --forzar                 # re-consulta todo (ignora caché)
const { obtenerDia, diaValido, fechasEntre } = require('../api/shared/stock-dia');

const INICIO_DEFAULT = '2023-03-20';
const LOTE = 5;
const FORZAR = process.argv.includes('--forzar');
const posic = process.argv.slice(2).filter(function (a) { return a.indexOf('--') !== 0; });

function ayerIso() {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function p2(n) { return n < 10 ? '0' + n : '' + n; }

async function main() {
  const desde = posic[0] || INICIO_DEFAULT;
  const hasta = posic[1] || ayerIso();
  const dias = fechasEntre(desde, hasta);
  console.log('[backfill-stock] ' + desde + ' -> ' + hasta + '  (' + dias.length + ' días)' + (FORZAR ? '  [FORZAR]' : ''));

  let nuevos = 0, saltados = 0, fallidos = 0, ultimoError = '';
  const t0 = Date.now();
  for (let i = 0; i < dias.length; i += LOTE) {
    const grupo = dias.slice(i, i + LOTE);
    await Promise.all(grupo.map(async function (f) {
      try {
        if (!FORZAR && await diaValido(f)) { saltados++; return; }   // freeze: no re-tocar días buenos
        const r = await obtenerDia(f, { forzar: true });
        if (r._error_clientes || r._error_retail) { fallidos++; ultimoError = r._error_clientes || r._error_retail; }
        else nuevos++;
      } catch (e) { fallidos++; ultimoError = e.message; console.warn('  ' + f + ' falló: ' + e.message); }
    }));

    // Fail-fast: si el primer lote falló completo, aborta en vez de moler todo.
    if (i === 0 && nuevos === 0 && saltados === 0 && fallidos === grupo.length) {
      console.error('\n[backfill-stock] ABORTA: el primer lote falló completo.');
      console.error('  Último error: ' + ultimoError);
      if (/REDTEC_API_KEY/i.test(ultimoError)) {
        console.error('  → Falta la llave. En esta misma consola:');
        console.error('    $env:REDTEC_API_KEY="<tu-llave-de-RDTOut>"');
        console.error('    node backfill-stock.js');
      } else {
        console.error('  → Revisa conexión/credenciales a RDTOut y re-ejecuta.');
      }
      process.exit(1);
    }

    if (((i / LOTE) | 0) % 10 === 0) {
      const pct = Math.round((i + grupo.length) / dias.length * 100);
      console.log('  ' + pct + '%  (' + (i + grupo.length) + '/' + dias.length + ')  nuevos:' + nuevos + ' saltados:' + saltados + ' fallidos:' + fallidos);
    }
  }
  const seg = Math.round((Date.now() - t0) / 1000);
  console.log('[backfill-stock] listo en ' + seg + 's  nuevos:' + nuevos + ' saltados:' + saltados + ' fallidos:' + fallidos);
  if (fallidos) console.log('  (último error visto: ' + ultimoError + ')');
}
main().catch(function (e) { console.error(e); process.exit(1); });
