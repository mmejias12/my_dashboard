// ─────────────────────────────────────────────────────────────────────────
// generar-snapshots.js
// ─────────────────────────────────────────────────────────────────────────
// Llama al sap-stock-proxy en producción y genera 2 archivos JSON:
//   data/stocks-actual.json     → snapshot del stock actual por cliente/bodega
//   data/movimientos-2026.json  → movimientos individuales del año 2026
//
// Estos archivos se sirven desde el repo (Azure Static Web Apps los expone
// como assets estáticos), permitiendo que el frontend los lea en <100ms en
// lugar de esperar el cold start del Function App (~30s).
//
// Se ejecuta desde GitHub Actions 3 veces al día.
// ─────────────────────────────────────────────────────────────────────────

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = process.env.STATIC_WEB_APP_URL || 'https://ashy-island-0089d900f.2.azurestaticapps.net';
const OUT_DIR = path.join(__dirname, '..', 'data');
const TIMEOUT_MS = 120000; // 2 minutos por llamada
const MAX_RETRIES = 3;

// Asegurar carpeta data/
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`✓ Creada carpeta ${OUT_DIR}`);
}

// ─── Helper: fetch JSON con retry ────────────────────────────────────────
function fetchJSON(url, intento = 1) {
  return new Promise((resolve, reject) => {
    console.log(`  → GET ${url} (intento ${intento}/${MAX_RETRIES})`);
    const inicio = Date.now();
    const req = https.get(url, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const seg = ((Date.now() - inicio) / 1000).toFixed(1);
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          const snippet = body.substring(0, 200).replace(/\s+/g, ' ').trim();
          return reject(new Error(`HTTP ${res.statusCode} (${seg}s): ${snippet}`));
        }
        try {
          const data = JSON.parse(body);
          console.log(`    ✓ ${seg}s · ${(body.length / 1024).toFixed(1)} KB`);
          resolve(data);
        } catch (e) {
          reject(new Error(`JSON inválido: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout ${TIMEOUT_MS / 1000}s`));
    });
  }).catch((err) => {
    if (intento < MAX_RETRIES) {
      console.warn(`    ⚠ Falló (${err.message}). Reintentando en 5s...`);
      return new Promise((r) => setTimeout(r, 5000)).then(() => fetchJSON(url, intento + 1));
    }
    throw err;
  });
}

// ─── Generar JSON con metadata ───────────────────────────────────────────
function writeSnapshot(nombre, payload, metadata = {}) {
  const json = {
    _meta: {
      generadoEn: new Date().toISOString(),
      generadoPor: 'github-actions · scripts/generar-snapshots.js',
      ...metadata
    },
    ...payload
  };
  const filepath = path.join(OUT_DIR, nombre);
  fs.writeFileSync(filepath, JSON.stringify(json, null, 2));
  const kb = (fs.statSync(filepath).size / 1024).toFixed(1);
  console.log(`✓ ${nombre} guardado (${kb} KB)`);
  return filepath;
}

// ─── Main ────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Snapshot Stocks SAP · ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════');

  try {
    // 1. Stock actual (forceRefresh para que el proxy llame fresco al SAP)
    console.log('\n[1/2] Stock actual...');
    const urlStock = `${BASE}/api/sap-stock-proxy?modo=actual&forceRefresh=1`;
    const stockData = await fetchJSON(urlStock);
    writeSnapshot('stocks-actual.json', stockData, {
      fuente: 'sap-stock-proxy?modo=actual',
      total_combinaciones: stockData.total || (stockData.items || []).length
    });

    // 2. Movimientos 2026 (para filtro de fecha de corte)
    console.log('\n[2/2] Movimientos 2026...');
    const hoy = new Date().toISOString().substring(0, 10);
    const urlMovs = `${BASE}/api/sap-stock-proxy?modo=movimientos&desde=2026-01-01&hasta=${hoy}`;
    const movsData = await fetchJSON(urlMovs);
    writeSnapshot('movimientos-2026.json', movsData, {
      fuente: 'sap-stock-proxy?modo=movimientos',
      rango: { desde: '2026-01-01', hasta: hoy },
      total_movimientos: (movsData.items || movsData.data || []).length
    });

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' ✓ Snapshot completado');
    console.log('═══════════════════════════════════════════════════════');
  } catch (err) {
    console.error('\n✗ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
