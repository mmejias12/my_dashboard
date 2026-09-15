// ============================================================================
//  shared/anden-registro.js  ·  Bitácora del monitor de andén
//
//  Deja registro DURABLE Y ATRIBUIBLE de lo que el Supervisor de Despacho
//  decide sobre un Evento de Control: clasificarlo como RELOCALIZACIÓN INTERNA,
//  marcarlo atendido, retener el camión, o revertir cualquiera de las tres.
//
//  POR QUÉ EXISTE. Hasta ahora eso vivía sólo en el localStorage del navegador:
//  sin quién lo hizo, con la hora del computador del operador, y sin que la
//  pantalla del turno siguiente — o la de otro equipo en el mismo andén — se
//  enterara de nada. La regla de RELOCALIZACIÓN INTERNA pide expresamente dejar
//  registro de patente, fecha y hora, usuario que confirma, clasificación y la
//  confirmación de que el vehículo no saldrá de las instalaciones. Nada de eso
//  se puede sostener desde una pestaña del navegador.
//
//  APPEND-ONLY, A PROPÓSITO. Una clasificación no se borra ni se edita nunca.
//  Si el supervisor se equivoca, se escribe encima un evento 'reversion' y el
//  estado vigente es el último de la cadena. Así la bitácora sirve de respaldo
//  ante una auditoría: se puede reconstruir qué se decidió, cuándo y quién.
//
//  Blob:  contenedor ANDEN_CONTAINER (def. 'redtec-anden')
//         anden/YYYY-MM.jsonl  (una línea JSON por evento)
//  Conexión: ANDEN_STORAGE_CONN || BLOB_CONNECTION_STRING (la misma de
//            clientes-store y uso-plataforma) || OS_STORAGE_CONN.
//            No hay configuración nueva que crear en Azure.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.ANDEN_STORAGE_CONN
          || process.env.BLOB_CONNECTION_STRING
          || process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.ANDEN_CONTAINER || 'redtec-anden';

/** Acciones que el monitor puede registrar. Cualquier otra se rechaza. */
const ACCIONES = new Set(['relocalizacion_interna', 'atendida', 'retenido', 'reversion']);

function contenedor() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes) { return `anden/${mes}.jsonl`; }     // mes = 'YYYY-MM'

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

// ── Escribir. A DIFERENCIA de uso-plataforma.js, este registro NO es
//    best-effort: si no se puede escribir, el que confirma tiene que
//    enterarse. Por eso lanza y la Function devuelve el error al monitor.
async function registrar(ev) {
  if (!CONN) {
    const e = new Error('La bitácora del andén no tiene almacenamiento configurado '
      + '(falta ANDEN_STORAGE_CONN o BLOB_CONNECTION_STRING en las app settings).');
    e.status = 503;
    throw e;
  }
  const c = contenedor();
  await c.createIfNotExists();
  const mes = String(ev.ts || new Date().toISOString()).slice(0, 7);
  const ab = c.getAppendBlobClient(blobMes(mes));
  await ab.createIfNotExists();
  const linea = JSON.stringify(ev) + '\n';
  await ab.appendBlock(linea, Buffer.byteLength(linea));
  return ev;
}

async function leerMes(mes) {
  if (!CONN) return [];
  const c = contenedor();
  try {
    const dl = await c.getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];
    throw e;
  }
}

/**
 * REDUCTOR (puro, testeable sin Blob).
 *
 * Aplana la cadena append-only al estado VIGENTE de cada carga. El orden es
 * por `ts`, no por el orden del archivo: dos supervisores en dos computadores
 * escriben en el mismo blob y el append no garantiza orden cronológico.
 *
 * Una 'reversion' no borra nada: devuelve la carga a su estado anterior y deja
 * en el registro quién revirtió y cuándo.
 */
function estadoVigente(eventos) {
  const orden = eventos.slice().sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const estado = {};
  for (const ev of orden) {
    const id = ev.carga_id;
    if (!id) continue;
    const e = estado[id] || (estado[id] = {
      carga_id: id, patente: ev.patente || null,
      clasificacion: null, atendida: false, retenido: false,
      usuario: null, ts: null, detalle: null, no_sale: false,
      estado_previo: null, revertida_por: null, revertida_en: null,
    });
    if (ev.patente && !e.patente) e.patente = ev.patente;

    if (ev.accion === 'relocalizacion_interna') {
      e.clasificacion = 'relocalizacion_interna';
      e.atendida = true;
      e.usuario = ev.usuario || null;
      e.ts = ev.ts || null;
      e.detalle = ev.detalle || null;
      e.no_sale = ev.no_sale === true;
      e.estado_previo = ev.estado_previo || null;
      e.revertida_por = null;
      e.revertida_en = null;
    } else if (ev.accion === 'atendida') {
      e.atendida = true;
      if (!e.usuario) { e.usuario = ev.usuario || null; e.ts = ev.ts || null; }
    } else if (ev.accion === 'retenido') {
      e.atendida = true;
      e.retenido = true;
      if (!e.usuario) { e.usuario = ev.usuario || null; e.ts = ev.ts || null; }
    } else if (ev.accion === 'reversion') {
      e.clasificacion = null;
      e.atendida = false;
      e.retenido = false;
      e.no_sale = false;
      e.detalle = null;
      e.revertida_por = ev.usuario || null;
      e.revertida_en = ev.ts || null;
    }
  }
  return estado;
}

const reISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lo del día. Se filtra por el DÍA DEL PASO (fecha_carga), no por la hora en
 * que se confirmó: una relocalización de las 23:50 que el supervisor cierra a
 * las 00:10 pertenece al día del camión, no al del clic.
 */
async function delDia(fecha) {
  if (!reISO.test(fecha || '')) throw Object.assign(new Error('fecha inválida'), { status: 400 });
  // Se leen el mes del día y el siguiente: una confirmación de la medianoche
  // del día 31 queda escrita en el blob del mes siguiente.
  const meses = new Set([fecha.slice(0, 7)]);
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  meses.add(d.toISOString().slice(0, 7));

  let todos = [];
  for (const m of meses) todos = todos.concat(await leerMes(m));

  const eventos = todos.filter((ev) => String(ev.fecha_carga || ev.ts || '').slice(0, 10) === fecha);
  return { fecha, eventos, estado: estadoVigente(eventos) };
}

module.exports = { registrar, leerMes, delDia, estadoVigente, hayStorage, ACCIONES };
