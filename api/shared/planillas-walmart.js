// ============================================================================
//  api/shared/planillas-walmart.js  ·  Cada aparición de una cita en un reporte
//
//  POR QUÉ EXISTE. El reporte de Walmart llega casi a diario y la misma cita
//  aparece en varios. Esa secuencia es el dato que explica el caso que trajo
//  logística el 10-nov: Walmart declara 9 un día y 20 cuatro días después. Sin
//  guardar cada aparición, lo único que se puede decir es lo que dice el último
//  archivo — y la pregunta "¿desde cuándo lo sabíamos?" no tiene respuesta.
//
//  Hasta ahora sólo se guardaban las filas de las citas que NO cruzan
//  (pendientes-cruce.js). Las que cruzan bien no dejaban rastro del reporte,
//  así que el folio confirmado no se podía reconstruir hacia atrás.
//
//  QUÉ NO ES. No es una copia del .xlsx. Se guardan las columnas que sirven
//  para trazar —cita, PO, cliente, CD, cantidades, recepción— y nada más.
//
//  APPEND-ONLY. Una aparición ocurrió: no se edita ni se borra. La misma cita
//  en el mismo archivo se deduplica al LEER, no al escribir, porque dos
//  navegadores pueden subir el mismo reporte y ninguno sabe del otro.
//
//  Blob:  contenedor PLANILLAS_CONTAINER (def. 'redtec-confirmaciones')
//         planillas/YYYY-MM.jsonl
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.PLANILLAS_STORAGE_CONN
          || process.env.CONFIRMACIONES_STORAGE_CONN
          || process.env.BLOB_CONNECTION_STRING
          || process.env.OS_STORAGE_CONN
          || process.env.ANDEN_STORAGE_CONN;
const CONTAINER = process.env.PLANILLAS_CONTAINER || 'redtec-confirmaciones';

// Cuántas filas acepta un cruce. Un reporte diario trae decenas; miles
// significaría que algo se rompió aguas arriba y no hay por qué escribirlo.
const MAX_FILAS = Math.max(1, parseInt(process.env.PLANILLAS_MAX || '3000', 10) || 3000);
const MESES_ATRAS = Math.max(1, parseInt(process.env.PLANILLAS_MESES || '6', 10) || 6);

function contenedor() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes) { return 'planillas/' + mes + '.jsonl'; }
function hayStorage() { return !!CONN; }

async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
function esNoExiste(e) {
  const cod = String((e && (e.code || e.errorCode)) || '');
  const msg = String((e && e.message) || '');
  return !!e && (e.statusCode === 404
    || /BlobNotFound|ContainerNotFound/i.test(cod)
    || /BlobNotFound|ContainerNotFound|does not exist|not found/i.test(msg));
}

const LARGO = 120;
function texto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, LARGO);
}
function entero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && !v.trim()) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
const esCita = (v) => /^\d{8}$/.test(String(v == null ? '' : v).trim());

function armarFila(f, ctx) {
  const c = ctx || {};
  const ts = c.ts || new Date().toISOString();
  return {
    ts: ts, dia: String(ts).slice(0, 10),
    archivo: texto(c.archivo), quien: texto(c.quien),
    cita: texto((f || {}).cita),
    po: texto((f || {}).po),
    rut: texto((f || {}).rut),
    cliente: texto((f || {}).cliente),
    cd: texto((f || {}).cd),
    recepcion: texto((f || {}).recepcion),
    fecha: texto((f || {}).fecha),          // fecha de recepción en el CD
    total: entero((f || {}).total) || 0,
    malos: entero((f || {}).malos) || 0,
    canje: entero((f || {}).canje) || 0,
    // Lo que el cruce resolvió para esa cita ese día. Sin esto la trazabilidad
    // muestra qué dijo Walmart pero no qué hicimos nosotros con eso.
    folio: entero((f || {}).folio),
    bandeja: texto((f || {}).bandeja)       // porConfirmar | avisar | reconfirmar | excepcion
  };
}

async function registrar(filas, ctx) {
  const fs = (Array.isArray(filas) ? filas : []).slice(0, MAX_FILAS)
    .map(function (f) { return armarFila(f, ctx); })
    .filter(function (f) { return esCita(f.cita); });
  if (!fs.length) return { ok: true, escritos: 0, motivo: '' };
  if (!CONN) return { ok: false, escritos: 0, motivo: 'no hay almacenamiento configurado' };
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const porMes = Object.create(null);
    fs.forEach(function (f) {
      const m = String(f.ts).slice(0, 7);
      (porMes[m] = porMes[m] || []).push(JSON.stringify(f));
    });
    for (const m of Object.keys(porMes)) {
      const ab = c.getAppendBlobClient(blobMes(m));
      await ab.createIfNotExists();
      const bloque = porMes[m].join('\n') + '\n';
      await ab.appendBlock(bloque, Buffer.byteLength(bloque));
    }
    return { ok: true, escritos: fs.length, motivo: '' };
  } catch (e) {
    return { ok: false, escritos: 0, motivo: (e && e.message) ? e.message : String(e) };
  }
}

async function leerMes(mes) {
  if (!CONN) return [];
  try {
    const dl = await contenedor().getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean)
      .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];
    throw e;
  }
}

function mesesRecientes(hoy, cuantos) {
  const base = String(hoy || new Date().toISOString().slice(0, 10)).slice(0, 7);
  let y = Number(base.slice(0, 4)), m = Number(base.slice(5, 7));
  const out = [];
  for (let i = 0; i < Math.max(1, cuantos || MESES_ATRAS); i++) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m--; if (m < 1) { m = 12; y--; }
  }
  return out.reverse();
}

// Las apariciones de unas citas, de la MÁS NUEVA a la más vieja — igual que la
// trazabilidad de M2LINK, porque lo último que dijo Walmart es lo que manda.
//
// Se deduplica acá y no al escribir: dos personas pueden subir el mismo reporte
// y ninguna sabe de la otra. Dos filas del mismo archivo, misma cita y mismas
// cantidades son la misma aparición contada dos veces.
function apariciones(filas, citas) {
  const quiero = Object.create(null);
  (citas || []).forEach(function (c) { quiero[String(c).trim()] = 1; });
  const hay = Object.keys(quiero).length;
  const vistas = Object.create(null);
  const out = [];
  (filas || []).forEach(function (f) {
    if (!f || !esCita(f.cita)) return;
    if (hay && !quiero[String(f.cita)]) return;
    const llave = [f.cita, f.archivo, f.dia, f.total, f.malos, f.canje, f.recepcion].join('|');
    if (vistas[llave]) return;
    vistas[llave] = 1;
    out.push(f);
  });
  return out.sort(function (a, b) {
    return String(b.ts || '').localeCompare(String(a.ts || '')) ||
           String(a.cita).localeCompare(String(b.cita));
  });
}

// Lo que cambió entre una aparición y la siguiente. Es la pregunta que trajo
// logística: la misma cita vuelve con otra cantidad.
function cambios(apar) {
  const porCita = Object.create(null);
  (apar || []).forEach(function (f) { (porCita[f.cita] = porCita[f.cita] || []).push(f); });
  const out = [];
  Object.keys(porCita).forEach(function (c) {
    // apariciones() entrega de la más nueva a la más vieja: se recorre al revés
    // para comparar cada una con la anterior en el tiempo.
    const lista = porCita[c].slice().reverse();
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1], b = lista[i];
      if (a.canje === b.canje && a.total === b.total) continue;
      out.push({ cita: c, de: a.dia, a: b.dia,
                 canjeAntes: a.canje, canjeAhora: b.canje,
                 totalAntes: a.total, totalAhora: b.total,
                 diferencia: b.canje - a.canje });
    }
  });
  return out.sort(function (x, y) { return String(y.a).localeCompare(String(x.a)); });
}

module.exports = { registrar, leerMes, mesesRecientes, apariciones, cambios, armarFila,
                   hayStorage, blobMes, esNoExiste, esCita, texto, entero,
                   MAX_FILAS, MESES_ATRAS, CONTAINER };
