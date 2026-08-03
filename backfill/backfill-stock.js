// backfill/backfill-stock.js
// Carga inicial del read model diario de stock (pool rojos) desde RDTOut.
// Freeze total: cada día pasado es definitivo (cierres al 23:59 del día anterior),
// así que NO se re-tocan días ya cacheados. Idempotente y re-ejecutable.
// Uso local (con git pull previo):
//   cd backfill
//   $env:OS_STORAGE_CONN="..."; $env:REDTEC_API_KEY="..."
//   node backfill-stock.js                          # 2023-03-20 -> ayer
//   node backfill-stock.js 2026-01-01 2026-07-31    # rango puntual
const { obtenerDia, existeDia, fechasEntre } = require('../api/shared/stock-dia');

const INICIO_DEFAULT = '2023-03-20';   // igual que la galaxia pallet
const LOTE = 5;                        // días en paralelo (cada día = 2 llamadas)

function ayerIso() {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function p2(n) { return n < 10 ? '0' + n : '' + n; }

async function main() {
  const desde = process.argv[2] || INICIO_DEFAULT;
  const hasta = process.argv[3] || ayerIso();
  const dias = fechasEntre(desde, hasta);
  console.log('[backfill-stock] ' + desde + ' -> ' + hasta + '  (' + dias.length + ' días)');

  let nuevos = 0, saltados = 0, fallidos = 0;
  const t0 = Date.now();
  for (let i = 0; i < dias.length; i += LOTE) {
    const grupo = dias.slice(i, i + LOTE);
    await Promise.all(grupo.map(async (f) => {
      try {
        if (await existeDia(f)) { saltados++; return; }     // freeze: no re-tocar
        const r = await obtenerDia(f, { forzar: true });
        if (r._error_clientes || r._error_retail) fallidos++; else nuevos++;
      } catch (e) { fallidos++; console.warn('  ' + f + ' falló: ' + e.message); }
    }));
    if (((i / LOTE) | 0) % 10 === 0) {
      const pct = Math.round((i + grupo.length) / dias.length * 100);
      console.log('  ' + pct + '%  (' + (i + grupo.length) + '/' + dias.length + ')  nuevos:' + nuevos + ' saltados:' + saltados + ' fallidos:' + fallidos);
    }
  }
  console.log('[backfill-stock] listo en ' + Math.round((Date.now() - t0) / 1000) + 's  nuevos:' + nuevos + ' saltados:' + saltados + ' fallidos:' + fallidos);
}
main().catch(function (e) { console.error(e); process.exit(1); });
