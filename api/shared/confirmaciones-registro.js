// ============================================================================
//  api/shared/confirmaciones-registro.js  ·  Historial de confirmaciones
//
//  POR QUÉ EXISTE. En Redlink toda confirmación nuestra queda firmada por
//  M3LinkSystem y con la recepción escrita, así que el QUÉ se puede reconstruir
//  desde ahí. Lo que NO está en Redlink es la CITA de Walmart: vive sólo en el
//  reporte diario y en nuestro cruce. Y el informe al cliente se organiza por
//  cita. Si no se guarda en el momento de confirmar, recuperarla después
//  obliga a volver a cruzar el .xlsx de esa semana a mano.
//
//  Tampoco está en Redlink lo que Walmart DECLARÓ (aceptados, rechazados, PO,
//  la hora de recepción en el CD). Redlink guarda lo que quedó confirmado, no
//  lo que el cliente dijo. La diferencia entre las dos cosas es justamente lo
//  que el informe semanal le muestra al cliente.
//
//  DOS BLOQUES SEPARADOS, A PROPÓSITO. `redlink` es lo que leímos del documento
//  con nuestras credenciales; `reporte` es lo que el navegador dijo que traía
//  el archivo de Walmart. No se mezclan: lo segundo llega desde el cliente y no
//  se usa para decidir nada, sólo para etiquetar. El día que haya que auditar
//  un número, tiene que poder decirse de dónde salió.
//
//  APPEND-ONLY. Una confirmación no se edita ni se borra: ocurrió. Si algo sale
//  mal después, se escribe otra línea.
//
//  Blob:  contenedor CONFIRMACIONES_CONTAINER (def. 'redtec-confirmaciones')
//         confirmaciones/YYYY-MM.jsonl  (una línea JSON por confirmación)
//  Conexión: la misma que ya usan clientes-store, uso-plataforma y el andén.
//            No hay configuración nueva que crear en Azure.
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.CONFIRMACIONES_STORAGE_CONN
          || process.env.BLOB_CONNECTION_STRING
          || process.env.OS_STORAGE_CONN
          || process.env.ANDEN_STORAGE_CONN;
const CONTAINER = process.env.CONFIRMACIONES_CONTAINER || 'redtec-confirmaciones';

function contenedor() { return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes) { return 'confirmaciones/' + mes + '.jsonl'; }   // mes = 'YYYY-MM'
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

/* ------------------------------------------------- armar el registro ----- */

// Lo que llega del navegador se ACOTA antes de guardarlo. No decide nada, pero
// va a un archivo que después alguien lee como si fuera verdad: un campo de
// 50.000 caracteres o un objeto anidado no tienen por qué entrar.
const LARGO = 120;
function texto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, LARGO);
}
// OJO con Number(): `Number(null)` y `Number('')` dan CERO, no NaN. Sin este
// guardia, una cantidad que no vino se guarda como 0 — y un despachado 0 contra
// 5 recibidos sale en el informe al cliente como "recibió 5 de más". Un dato
// que falta tiene que verse como que falta.
function entero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && !v.trim()) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// El día que agrupa el calendario. Es la fecha de la CONFIRMACIÓN (cuándo la
// hicimos), no la de recepción en el CD ni la del despacho: el calendario
// responde "qué se confirmó tal día".
function diaDe(ts) { return String(ts || '').slice(0, 10); }

// La diferencia, calculada acá y no recibida: es el número del que vive el
// informe al cliente, y recibirlo armado sería dejar que lo decida el
// navegador. Negativa = Walmart recibió menos de lo despachado.
function diferenciaDe(despachado, recibido) {
  const d = entero(despachado), r = entero(recibido);
  if (d === null || r === null) return null;
  return r - d;
}

// Las tres categorías del informe, nombradas una sola vez.
function claseDe(dif) {
  if (dif === null) return 'sin-dato';
  if (dif === 0) return 'sin-diferencia';
  return dif < 0 ? 'recibio-menos' : 'recibio-mas';
}

function armarRegistro(datos) {
  const d = datos || {};
  const ts = d.ts || new Date().toISOString();
  const rl = d.redlink || {};
  const rp = d.reporte || {};
  const despachado = entero(rl.despachado);
  const recibido = entero(rl.recepcion);
  const dif = diferenciaDe(despachado, recibido);
  return {
    ts: ts,
    dia: diaDe(ts),
    folio: entero(d.folio),
    docId: entero(d.docId),
    cantidad: entero(d.cantidad),
    quien: texto(d.quien),
    via: texto(d.via) || 'pagina',
    // Lo que leímos nosotros del documento, con nuestras credenciales.
    redlink: {
      cliente: texto(rl.cliente),
      destino: texto(rl.destino),
      bodega: texto(rl.bodega),
      despachado: despachado,
      recepcion: recibido,
      etapaAntes: texto(rl.etapaAntes),
      etapaDespues: texto(rl.etapaDespues),
      firma: texto(rl.firma)
    },
    // Lo que dijo el navegador que traía el reporte de Walmart. Etiqueta, no
    // insumo: no se usó para decidir nada.
    reporte: {
      cita: texto(rp.cita),
      po: texto(rp.po),
      rut: texto(rp.rut),
      razonSocial: texto(rp.razonSocial),
      cd: texto(rp.cd),
      servicio: texto(rp.servicio),
      recepcionWM: entero(rp.recepcionWM),
      aceptados: entero(rp.aceptados),
      rechazados: entero(rp.rechazados),
      cuando: texto(rp.cuando)
    },
    diferencia: dif,
    clase: claseDe(dif)
  };
}

/* ------------------------------------------------- escribir y leer ------- */

// A DIFERENCIA del andén, acá el fallo al guardar NO puede tumbar la
// operación: cuando esto corre, la confirmación YA se escribió en Redlink y ya
// movió inventario en SAP. Decir "falló" sería mentir sobre lo que pasó y
// provocar justo lo peor, que alguien la reintente.
async function registrar(datos) {
  const ev = armarRegistro(datos);
  if (!CONN) {
    return { ok: false, registro: ev,
             motivo: 'no hay almacenamiento configurado (falta CONFIRMACIONES_STORAGE_CONN o BLOB_CONNECTION_STRING)' };
  }
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const ab = c.getAppendBlobClient(blobMes(String(ev.ts).slice(0, 7)));
    await ab.createIfNotExists();
    const linea = JSON.stringify(ev) + '\n';
    await ab.appendBlock(linea, Buffer.byteLength(linea));
    return { ok: true, registro: ev, motivo: '' };
  } catch (e) {
    return { ok: false, registro: ev, motivo: (e && e.message) ? e.message : String(e) };
  }
}

async function leerMes(mes) {
  if (!CONN) return [];
  const c = contenedor();
  try {
    const dl = await c.getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean)
      .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];
    throw e;
  }
}

// Los meses que toca un rango. Un rango de una semana puede cruzar dos.
//
// El rango al revés se descarta comparando las FECHAS COMPLETAS, no los meses:
// del 9 al 3 del mismo mes tiene los dos meses iguales y pasaría el control.
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
function mesesDe(desde, hasta) {
  const d1 = String(desde || ''), d2 = String(hasta || '');
  if (!RE_DIA.test(d1) || !RE_DIA.test(d2) || d2 < d1) return [];
  const a = d1.slice(0, 7), b = d2.slice(0, 7);
  const out = [];
  let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  for (let i = 0; i < 120; i++) {
    const act = y + '-' + String(m).padStart(2, '0');
    out.push(act);
    if (act >= b) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function leerRango(desde, hasta, leer) {
  const traer = leer || leerMes;
  const meses = mesesDe(desde, hasta);
  let out = [];
  for (const m of meses) out = out.concat(await traer(m));
  // El filtro por día va acá y no en el lector: el blob es por mes y el rango
  // casi nunca empieza el día 1.
  return out.filter(function (r) {
    const d = String((r && r.dia) || '');
    return d >= desde && d <= hasta;
  }).sort(function (a, b) { return String(a.ts || '').localeCompare(String(b.ts || '')); });
}

/* ------------------------------------------------- agregaciones ---------- */

// Por día, para pintar el calendario. Devuelve también el desglose, porque un
// día con 40 confirmaciones sin diferencia no es lo mismo que uno con 40 donde
// 12 llegaron cortas, y el color tiene que poder decirlo.
function porDia(registros) {
  const ix = Object.create(null);
  (registros || []).forEach(function (r) {
    const d = String((r && r.dia) || '');
    if (!d) return;
    if (!ix[d]) ix[d] = { dia: d, n: 0, pallets: 0, sinDiferencia: 0, recibioMenos: 0, recibioMas: 0, sinDato: 0, clientes: {} };
    const x = ix[d];
    x.n++;
    x.pallets += entero(r.cantidad) || 0;
    if (r.clase === 'sin-diferencia') x.sinDiferencia++;
    else if (r.clase === 'recibio-menos') x.recibioMenos++;
    else if (r.clase === 'recibio-mas') x.recibioMas++;
    else x.sinDato++;
    const c = nombreCliente(r);
    if (c) x.clientes[c] = (x.clientes[c] || 0) + 1;
  });
  return Object.keys(ix).sort().map(function (d) {
    const x = ix[d];
    return Object.assign({}, x, { clientes: Object.keys(x.clientes).length });
  });
}

// El nombre del cliente con el que se agrupa. Se prefiere la razón social del
// reporte de Walmart —es la que el cliente reconoce y la que va en el correo—
// y si no vino, el nombre que trae Redlink.
function nombreCliente(r) {
  const rp = (r && r.reporte) || {};
  const rl = (r && r.redlink) || {};
  return texto(rp.razonSocial) || texto(rl.cliente) || '';
}

function porCliente(registros) {
  const ix = Object.create(null);
  (registros || []).forEach(function (r) {
    const c = nombreCliente(r) || '(sin cliente)';
    if (!ix[c]) ix[c] = { cliente: c, rut: texto((r.reporte || {}).rut), n: 0, pallets: 0,
                          sinDiferencia: 0, recibioMenos: 0, recibioMas: 0, sinDato: 0,
                          palletsDiferencia: 0, filas: [] };
    const x = ix[c];
    x.n++;
    x.pallets += entero(r.cantidad) || 0;
    if (r.clase === 'sin-diferencia') x.sinDiferencia++;
    else if (r.clase === 'recibio-menos') { x.recibioMenos++; x.palletsDiferencia += Math.abs(r.diferencia || 0); }
    else if (r.clase === 'recibio-mas') { x.recibioMas++; x.palletsDiferencia += Math.abs(r.diferencia || 0); }
    else x.sinDato++;
    if (!x.rut) x.rut = texto((r.reporte || {}).rut);
    x.filas.push(r);
  });
  // El que tiene más diferencias primero: es el que hay que mirar.
  return Object.keys(ix).map(k => ix[k]).sort(function (a, b) {
    return (b.recibioMenos + b.recibioMas) - (a.recibioMenos + a.recibioMas) || b.n - a.n ||
           a.cliente.localeCompare(b.cliente);
  });
}

module.exports = { registrar, leerMes, leerRango, mesesDe, hayStorage,
                   armarRegistro, diferenciaDe, claseDe, diaDe, texto, entero,
                   porDia, porCliente, nombreCliente, blobMes, esNoExiste, CONTAINER };
