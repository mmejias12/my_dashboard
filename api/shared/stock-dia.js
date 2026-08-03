// api/shared/stock-dia.js
// Read model diario del pool (stock rojos) en Azure Blob.
// Un blob por día: stock/YYYY-MM-DD.json con { fecha, clientes:{...}, retail:{...} }
// Contenedor: redtec-os-stock (Azure exige nombre de 3+ chars).
const { BlobServiceClient } = require('@azure/storage-blob');
const { cuadreDia, FLUJOS } = require('./stock-fetch');

const CONTENEDOR = 'redtec-os-stock';
const UNIVERSOS = ['clientes', 'retail'];

function contenedor() {
  const conn = process.env.OS_STORAGE_CONN;
  if (!conn) throw new Error('Falta OS_STORAGE_CONN');
  return BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTENEDOR);
}
function nombreDia(fecha) { return 'stock/' + fecha + '.json'; }

async function leerBlob(cont, nombre) {
  const b = cont.getBlockBlobClient(nombre);
  if (!(await b.exists())) return null;
  const buf = await b.downloadToBuffer();
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
}
async function escribirBlob(cont, nombre, obj) {
  const body = JSON.stringify(obj);
  await cont.getBlockBlobClient(nombre).upload(body, Buffer.byteLength(body),
    { blobHTTPHeaders: { blobContentType: 'application/json' } });
}

// Devuelve la foto de un día. Si no está en caché (o forzar=true), la consulta
// a RDTOut (ambos universos) y la graba. Usado por backfill y por la ingesta.
async function obtenerDia(fecha, opts) {
  opts = opts || {};
  const cont = contenedor();
  await cont.createIfNotExists();
  const nombre = nombreDia(fecha);
  if (!opts.forzar) {
    const cache = await leerBlob(cont, nombre);
    if (cache) return Object.assign({}, cache, { _origen: 'cache' });
  }
  const dia = { fecha: fecha };
  for (const u of UNIVERSOS) {
    try { dia[u] = await cuadreDia(fecha, u); }
    catch (e) { dia[u] = null; dia['_error_' + u] = e.message; }
  }
  await escribirBlob(cont, nombre, dia);
  return Object.assign({}, dia, { _origen: 'vivo' });
}

// Arma un rango SIN sumar saldos: saldoInicial del primer día con dato,
// saldoFinal del último, y suma solo los flujos. Reporta días faltantes en caché.
async function existeDia(fecha) {
  const cont = contenedor();
  return cont.getBlockBlobClient(nombreDia(fecha)).exists();
}

async function leerRango(desde, hasta, universo) {
  const cont = contenedor();
  const serie = [];
  const faltantes = [];
  for (const f of fechasEntre(desde, hasta)) {
    const cache = await leerBlob(cont, nombreDia(f));
    if (cache && cache[universo]) serie.push(Object.assign({ fecha: f }, cache[universo]));
    else faltantes.push(f);
  }
  if (!serie.length) return { serie: [], faltantes: faltantes, resumen: null };
  const primero = serie[0], ultimo = serie[serie.length - 1];
  const resumen = {
    universo: universo,
    desde: primero.fecha, hasta: ultimo.fecha,
    saldoInicial: primero.saldoInicial,
    saldoFinal: ultimo.saldoFinal,          // = stock al cierre del rango
    variacion: ultimo.saldoFinal - primero.saldoInicial
  };
  (FLUJOS[universo] || []).forEach(function (c) {
    resumen[c] = serie.reduce(function (a, d) { return a + (d[c] || 0); }, 0);
  });
  return { serie: serie, faltantes: faltantes, resumen: resumen };
}

function fechasEntre(desde, hasta) {
  const out = [];
  const d = new Date(desde + 'T12:00:00');
  const fin = new Date(hasta + 'T12:00:00');
  while (d <= fin) {
    out.push(d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function p2(n) { return n < 10 ? '0' + n : '' + n; }

module.exports = { obtenerDia, existeDia, leerRango, fechasEntre, CONTENEDOR, UNIVERSOS };
