// ============================================================================
//  api/shared/pf-bitacora.js  ·  Qué pasó con cada intento de relocalización
//
//  POR QUÉ EXISTE. Redlink exige que el número de documento no se repita, pero
//  nadie sabe qué hace si se repite igual (se le preguntó a Marcelo el 11-nov y
//  no lo sabía). Así que asumimos lo peor —que acepta el duplicado y crea un
//  segundo documento— y esta bitácora pasa a ser la ÚNICA defensa, no un atajo.
//
//  Cada relocalización mueve pallets entre bodegas y eso termina en SAP. Crear
//  dos por un reintento es mover el doble.
//
//  APPEND-ONLY. Un intento ocurrió: no se edita ni se borra. El estado vigente
//  de una llave es el último evento de su cadena, y la cadena completa queda
//  para poder reconstruir qué se supo y cuándo.
//
//  LOS ESTADOS, y por qué son esos:
//    intentando → se mandó el POST y todavía no sabemos cómo terminó
//    creado     → verificado leyendo el documento de vuelta en Redlink
//    rechazado  → Redlink lo rechazó por su contenido; no escribió nada
//    en-duda    → el intento se cortó y tampoco pudimos resolverlo mirando
//
//  "intentando" y "en-duda" son la misma orden para quien decide: NO escribir.
//  Se distinguen porque cuentan historias distintas al leer la bitácora después.
//
//  Blob:  contenedor PF_CONTAINER (def. 'redtec-confirmaciones')
//         pf/relocalizaciones/YYYY-MM.jsonl
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.PF_STORAGE_CONN
          || process.env.CONFIRMACIONES_STORAGE_CONN
          || process.env.BLOB_CONNECTION_STRING
          || process.env.OS_STORAGE_CONN
          || process.env.ANDEN_STORAGE_CONN;
const CONTAINER = process.env.PF_CONTAINER || 'redtec-confirmaciones';
const PREFIJO = 'pf/relocalizaciones/';

// Hasta dónde protege la idempotencia hacia atrás. PF hizo ~700 relocalizaciones
// en 20 meses (medido sobre el reporte de uso que mandó Marcelo), o sea unas 35
// al mes: leer seis meses son un par de cientos de líneas.
const MESES_ATRAS = Math.max(1, parseInt(process.env.PF_MESES || '6', 10) || 6);

const ESTADOS = ['intentando', 'creado', 'rechazado', 'en-duda'];
// Los dos que significan "hubo una escritura que no sabemos cómo terminó".
const ESTADOS_EN_VILO = ['intentando', 'en-duda'];

function contenedor() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes) { return PREFIJO + mes + '.jsonl'; }
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

function texto(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 300);
}
function entero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function armarEvento(e) {
  const d = e || {};
  const ts = d.ts || new Date().toISOString();
  return {
    ts: ts,
    dia: String(ts).slice(0, 10),
    llave: texto(d.llave, 60),
    // Un estado inventado NO se guarda como tal: se degrada a la opción
    // prudente. Un estado que no entendemos no puede dar vía libre a escribir.
    estado: ESTADOS.indexOf(d.estado) >= 0 ? d.estado : 'en-duda',
    folio: entero(d.folio),
    docId: entero(d.docId),
    bpId: entero(d.bpId),
    quien: texto(d.quien, 80),
    detalle: texto(d.detalle),
    // La huella de la intención: con esto se detecta que alguien reutilizó el
    // número de documento para otra cosa.
    huella: (d.huella && typeof d.huella === 'object') ? d.huella : null
  };
}

async function registrar(evento) {
  const ev = armarEvento(evento);
  if (!ev.llave) return { ok: false, motivo: 'el evento no trae llave' };
  if (!CONN) return { ok: false, motivo: 'no hay almacenamiento configurado' };
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const ab = c.getAppendBlobClient(blobMes(String(ev.ts).slice(0, 7)));
    await ab.createIfNotExists();
    const linea = JSON.stringify(ev) + '\n';
    await ab.appendBlock(linea, Buffer.byteLength(linea));
    return { ok: true, motivo: '', evento: ev };
  } catch (e) {
    return { ok: false, motivo: (e && e.message) ? e.message : String(e) };
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

// El reductor: por llave, gana el evento más NUEVO. Se ordena por ts y no por
// el orden del archivo, porque dos funciones pueden escribir a la vez y el
// append no garantiza el orden entre ellas.
function estadoVigente(eventos) {
  const out = Object.create(null);
  // El filtro va ANTES de ordenar: un evento nulo (línea vacía, registro a
  // medias) reventaba el comparador y se llevaba puesto el reductor entero —
  // o sea la consulta de idempotencia, que es justo lo que no puede fallar.
  (eventos || [])
    .filter(function (e) { return e && e.llave; })
    .sort(function (a, b) { return String(a.ts || '').localeCompare(String(b.ts || '')); })
    .forEach(function (e) { out[e.llave] = e; });
  return out;
}

async function leerEstado(llave, hoy, leer) {
  const traer = leer || leerMes;
  let ev = [];
  for (const m of mesesRecientes(hoy, MESES_ATRAS)) ev = ev.concat(await traer(m));
  const vig = estadoVigente(ev);
  return vig[llave] || null;
}

// Para la vista de soporte: qué quedó en el aire y hay que mirar a mano.
function enVilo(vigentes) {
  return Object.keys(vigentes || {})
    .map(function (k) { return vigentes[k]; })
    .filter(function (e) { return ESTADOS_EN_VILO.indexOf(e.estado) >= 0; })
    .sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); });
}

module.exports = { registrar, leerMes, leerEstado, estadoVigente, enVilo, armarEvento,
                   mesesRecientes, hayStorage, blobMes, esNoExiste, texto, entero,
                   ESTADOS, ESTADOS_EN_VILO, MESES_ATRAS, CONTAINER, PREFIJO };
