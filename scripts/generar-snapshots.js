// ─────────────────────────────────────────────────────────────────────────
// generar-snapshots.js  (v2 — RDTOut API)
// ─────────────────────────────────────────────────────────────────────────
// Genera data/cierre-ayer.json con el saldo de cierre (23:59) del día
// anterior, consumiendo el API RDTOut/cuadrerojosxrangofechas.
//
// Este API ya entrega saldoFinal directamente — no necesitamos descargar
// el stock completo ni los movimientos como hacíamos con SAP.
//
// Cuando el API de RETAIL esté disponible, se agrega aquí como paso 2.
//
// Se ejecuta desde GitHub Actions (cron) varias veces al día.
// ─────────────────────────────────────────────────────────────────────────

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const API_HOST = 'apirdt1.azurewebsites.net';
const API_KEY = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function fetchJSON(apiPath) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: API_HOST,
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': API_KEY
      }
    };
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error('JSON inválido: ' + body.substring(0, 200))); }
        } else {
          reject(new Error('HTTP ' + res.statusCode + ': ' + body.substring(0, 200)));
        }
      });
    });
    req.on('error', function(e) { reject(e); });
    req.setTimeout(TIMEOUT_MS, function() { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function fetchWithRetry(apiPath) {
  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('  → GET ' + API_HOST + apiPath + ' (intento ' + attempt + '/' + MAX_RETRIES + ')');
      var t0 = Date.now();
      var data = await fetchJSON(apiPath);
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log('    ✓ ' + elapsed + 's');
      return data;
    } catch(err) {
      console.log('    ⚠ Falló (' + err.message + ')' + (attempt < MAX_RETRIES ? '. Reintentando en 5s...' : ''));
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(function(r) { setTimeout(r, 5000); });
    }
  }
}

function writeSnapshot(filename, data, meta) {
  var payload = {
    _meta: Object.assign({
      generadoEn: new Date().toISOString(),
      generadoPor: 'github-actions · scripts/generar-snapshots.js v2 (RDTOut)'
    }, meta || {}),
  };
  Object.assign(payload, data);
  var filepath = path.join(OUT_DIR, filename);
  var json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filepath, json, 'utf8');
  console.log('✓ ' + filename + ' guardado (' + (json.length / 1024).toFixed(1) + ' KB)');
}

function ayerChile() {
  var now = new Date();
  var chile = new Date(now.getTime() - 4 * 3600000);
  chile.setDate(chile.getDate() - 1);
  return chile.toISOString().substring(0, 10);
}

function hoyChile() {
  var now = new Date();
  var chile = new Date(now.getTime() - 4 * 3600000);
  return chile.toISOString().substring(0, 10);
}

// ─── Main ──────────────────────────────────────────────────────────────

(async () => {
  var hoy = hoyChile();
  var ayer = ayerChile();

  console.log('Snapshot Stocks RDTOut · ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════');
  console.log('Hoy (Chile): ' + hoy + ' · Ayer: ' + ayer);

  try {
    // ── 1. Stock CLIENTES — cierre de ayer ──
    console.log('\n[1/2] Stock Clientes (cuadrerojosxrangofechas)...');
    var apiPath = '/api/RDTOut/cuadrerojosxrangofechas?desde=' + ayer + '&hasta=' + ayer;
    var cuadre = await fetchWithRetry(apiPath);

    var cierreClientes = cuadre.saldoFinal;
    var saldoInicial   = cuadre.saldoInicial;
    var completo       = cuadre.completo;

    console.log('    Saldo inicial: ' + (saldoInicial || 0).toLocaleString());
    console.log('    Saldo final (cierre): ' + (cierreClientes || 0).toLocaleString());
    console.log('    Completo: ' + completo);

    if (!completo) {
      console.log('    ⚠ Datos del día NO están completos aún');
    }

    // ── 2. Stock RETAIL — pendiente (API aún no disponible) ──
    console.log('\n[2/2] Stock Retail...');
    var cierreRetail = null;
    // TODO: cuando TI entregue el API de retail, agregar aquí:
    // var apiRetail = '/api/RDTOut/cuadreretailxrangofechas?desde=' + ayer + '&hasta=' + ayer;
    // var cuadreR = await fetchWithRetry(apiRetail);
    // cierreRetail = cuadreR.saldoFinal;
    console.log('    ⏳ API Retail no disponible aún — se omite');

    // ── 3. Escribir cierre-ayer.json ──
    writeSnapshot('cierre-ayer.json', {
      ok: true,
      fechaCierre: ayer,
      totales_por_tipo: {
        CLIENTES: { total_pallets: cierreClientes || 0 },
        RETAIL:   { total_pallets: cierreRetail }
      },
      detalle: {
        saldoInicial_clientes: saldoInicial,
        saldoFinal_clientes: cierreClientes,
        emision: cuadre.emision || 0,
        devolucion: cuadre.devolucion || 0,
        transferencias: cuadre.transferencias || 0,
        diferencia: cuadre.diferencia || 0,
        completo: completo,
        fecha_calculo: hoy,
        retail_disponible: false
      }
    }, {
      fuente: 'RDTOut/cuadrerojosxrangofechas',
      fechaCierre: ayer,
      nota: 'RETAIL pendiente — API en desarrollo'
    });

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' ✓ Snapshot completado');
    console.log('   Clientes: ' + (cierreClientes || 0).toLocaleString());
    console.log('   Retail:   ' + (cierreRetail !== null ? cierreRetail.toLocaleString() : 'pendiente'));
    console.log('═══════════════════════════════════════════════════════');

  } catch (err) {
    console.error('\n✗ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
