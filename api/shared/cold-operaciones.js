// ============================================================================
//  shared/cold-operaciones.js  ·  Histórico COMPLETO de operaciones (cold store)
//
//  Lee el histórico de operaciones desde el contenedor redtec-os-operaciones,
//  que backfill-operaciones.js llena a diario DIRECTO de Redlink (un blob por
//  día). Las filas ya vienen en el CONTRATO RDT (el mismo que produce traducir()
//  de redlink-fetch.js), así que se sirven tal cual a las vistas — este módulo
//  nunca traduce ni escribe: es sólo lectura.
//
//  Por qué existe: la API de Redlink es lenta (~8-19 s por tramo de 31 días), así
//  que pedir historia en vivo desde una vista no escala (el corte de Static Web
//  Apps es de 45 s). Con TODA la historia en Blob, un rango de cualquier largo se
//  arma leyendo días (instantáneo) y sólo HOY se pide en vivo.
//
//  Un blob por día:  operaciones/YYYY-MM-DD.json  ->  { fecha, operaciones:[...] }
//  Clave de día: la misma fechaRequerida con que backfill agrupa al escribir.
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');
// Reutilizamos dedup y diasDeOp de cache-ops: un solo criterio para todo el ops
// path (dedupe por nroPedido, día por las tres fechas del contrato RDT).
const { dedup, diasDeOp } = require('./cache-ops.js');

const CONN      = process.env.OS_STORAGE_CONN;
// Contenedor del histórico de Redlink. Debe apuntar al MISMO que escribe la
// Action (OS_OPS_CONTAINER=redtec-os-operaciones); se deja su propia variable
// para no pisar la de cache-ops (que usa redtec-os-hist).
const CONTAINER = process.env.OS_OPS_HIST_CONTAINER || 'redtec-os-operaciones';
const PREFIJO   = 'operaciones/';

function hayStorage() { return !!CONN; }
const claveBlob = f => `${PREFIJO}${f}.json`;

let _container = null;
function getContainer() {
  if (!CONN) return null;
  if (!_container) _container = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
  return _container;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// Lista de fechas 'YYYY-MM-DD' entre desde y hasta, inclusive.
function rangoDias(desde, hasta) {
  const out = [];
  let d = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (d <= fin) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// Lee un día. Devuelve el arreglo de operaciones, o null si el blob no existe
// (día sin movimiento: feriado / fin de semana sin ops, o fuera del histórico).
async function leerDia(container, fecha) {
  if (!container) return null;
  try {
    const dl = await container.getBlobClient(claveBlob(fecha)).download();
    const j = JSON.parse(await streamToString(dl.readableStreamBody));
    return Array.isArray(j.operaciones) ? j.operaciones : [];
  } catch (e) {
    if (/BlobNotFound|ContainerNotFound|AuthenticationFailed/.test(e.message)) return null;
    throw e;
  }
}

// Lee un rango del histórico. Devuelve { ops, faltantes, dias }.
//  - ops      : operaciones del rango (sin dedupe; el llamador deduplica al unir
//               con lo vivo).
//  - faltantes: días sin blob. Son, casi siempre, días con 0 operaciones
//               (feriado/fin de semana sin movimiento); el llamador normalmente
//               los ignora, porque pedirlos en vivo devolvería 0 igual.
//  - dias     : días con blob leídos.
// Lectura EN PARALELO por lotes: un año no se lee día a día en serie.
async function leerRango(container, desde, hasta) {
  const fechas = rangoDias(desde, hasta);
  const ops = [], faltantes = [];
  if (!container) return { ops, faltantes: fechas, dias: 0, sin_storage: true };
  const LOTE = 24;
  let dias = 0;
  for (let i = 0; i < fechas.length; i += LOTE) {
    const grupo = fechas.slice(i, i + LOTE);
    const res = await Promise.all(grupo.map(f =>
      leerDia(container, f).then(d => ({ f, d })).catch(() => ({ f, d: null }))));
    for (const { f, d } of res) {
      if (d) { ops.push(...d); dias++; } else faltantes.push(f);
    }
  }
  return { ops, faltantes, dias, sin_storage: false };
}

module.exports = {
  getContainer, hayStorage, leerDia, leerRango, rangoDias,
  dedup, diasDeOp, claveBlob, CONTAINER, PREFIJO
};
