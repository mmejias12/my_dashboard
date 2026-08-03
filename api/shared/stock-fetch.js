// api/shared/stock-fetch.js
// Consulta el CUADRE de rojos (pool) a RDTOut, por día o por rango.
// Fuente: apirdt1 /api/RDTOut/cuadrerojos{clientes|retail}xrangofechas
// Mismo X-Api-Key (REDTEC_API_KEY) que usa la galaxia pallet. Sin sesión Entra.
const https = require('https');

const API_HOST = 'apirdt1.azurewebsites.net';
const PATHS = {
  clientes: '/api/RDTOut/cuadrerojosclientesxrangofechas',
  retail:   '/api/RDTOut/cuadrerojosretailxrangofechas'
};

// Campos de flujo por universo (definen el desglose y el signo del cuadre).
// Cuadre retail verificado: saldoFinal = saldoInicial
//   + (transferencias + salidaPalletReconfirmar + otrasEntradas)
//   - (entradaPalletReversa + retiros + otrasSalidas + reubicacionSistema)
const FLUJOS = {
  clientes: ['emision', 'entradaPalletReversa', 'devolucion', 'transferencias', 'salidaPalletReconfirmar'],
  retail:   ['transferencias', 'salidaPalletReconfirmar', 'otrasEntradas', 'entradaPalletReversa', 'retiros', 'otrasSalidas', 'reubicacionSistema']
};

function apiKey() {
  const k = process.env.REDTEC_API_KEY;
  if (!k) throw new Error('Falta REDTEC_API_KEY');
  return k;
}
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function normalizar(raw, universo) {
  const o = (raw && raw.data) ? raw.data : (raw || {});
  const out = {
    saldoInicial: num(o.saldoInicial),
    saldoFinal:   num(o.saldoFinal),
    diferencia:   num(o.diferencia),
    totalEntradas: num(o.totalEntradas),
    totalSalida:  num(o.totalSalida)
  };
  (FLUJOS[universo] || []).forEach(function (c) { out[c] = num(o[c]); });
  return out;
}

function pedir(universo, desde, hasta) {
  const path = PATHS[universo];
  if (!path) return Promise.reject(new Error('Universo inválido: ' + universo));
  const q = '?desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta);
  return new Promise(function (resolve, reject) {
    const rq = https.request({
      hostname: API_HOST, port: 443, path: path + q, method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Api-Key': apiKey() }
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('JSON inválido de RDTOut: ' + body.slice(0, 200))); }
        } else {
          reject(new Error('RDTOut ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
      });
    });
    rq.on('error', reject);
    rq.setTimeout(20000, function () { rq.destroy(); reject(new Error('Timeout RDTOut')); });
    rq.end();
  });
}

// Cuadre de UN día (desde=hasta=fecha): nivel + flujos de ese día.
async function cuadreDia(fechaIso, universo) {
  return normalizar(await pedir(universo, fechaIso, fechaIso), universo);
}
// Cuadre de un rango en UNA llamada (usar solo con rangos <=180 días).
async function cuadreRango(desde, hasta, universo) {
  return normalizar(await pedir(universo, desde, hasta), universo);
}

module.exports = { cuadreDia, cuadreRango, normalizar, FLUJOS, PATHS };
