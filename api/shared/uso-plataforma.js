// ============================================================================
//  shared/uso-plataforma.js  ·  Uso del m3link (quién usa la plataforma)
//
//  Registra un evento por cada vista abierta en el m3link (app-open, cambio de
//  vista interna y apertura de pestañas de módulos) y agrega esos eventos para
//  la página "Uso de la plataforma": usuarios activos, vistas más usadas,
//  actividad por usuario / área / día.
//
//  Blob:  contenedor USO_CONTAINER (def. 'redtec-uso')
//         uso/YYYY-MM.jsonl  (una línea JSON por evento)
//  Conexión: USO_STORAGE_CONN || BLOB_CONNECTION_STRING (la misma de
//            clientes-store) || OS_STORAGE_CONN. No requiere config nueva.
//
//  Diseño: el registro es BEST-EFFORT — nunca debe romper la navegación.
//  Cualquier error al escribir se traga en silencio.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.USO_STORAGE_CONN || process.env.BLOB_CONNECTION_STRING || process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.USO_CONTAINER || 'redtec-uso';

function contenedor(){ return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes){ return `uso/${mes}.jsonl`; }   // mes = 'YYYY-MM'

async function streamToString(readable){
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// ── Registrar un evento (append). Best-effort: nunca lanza. ──────────────────
async function registrar(ev){
  if (!CONN) return;
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const mes = (ev.ts || new Date().toISOString()).slice(0, 7);
    const ab = c.getAppendBlobClient(blobMes(mes));
    await ab.createIfNotExists();
    const linea = JSON.stringify(ev) + '\n';
    await ab.appendBlock(linea, Buffer.byteLength(linea));
  } catch (e) { /* best-effort */ }
}

function esNoExiste(e){
  const cod = String((e && (e.code || e.errorCode)) || '');
  const msg = String((e && e.message) || '');
  return !!e && (e.statusCode === 404 ||
    /BlobNotFound|ContainerNotFound/i.test(cod) ||
    /BlobNotFound|ContainerNotFound|does not exist|not found/i.test(msg));
}

async function leerMes(mes){
  const c = contenedor();
  try {
    const dl = await c.getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];
    throw e;
  }
}

function mesesDelRango(desde, hasta){
  const out = [];
  let y = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const fy = +hasta.slice(0, 4), fm = +hasta.slice(5, 7);
  while (y < fy || (y === fy && m <= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const reISO  = /^\d{4}-\d{2}-\d{2}$/;
const hoyIso = () => new Date().toISOString().slice(0, 10);

// ── Agregación PURA (testeable sin Blob): resumen del panel. ─────────────────
function agregarEventos(eventos, desde, hasta){
  eventos = eventos.filter(e => { const d = (e.ts || '').slice(0, 10); return d >= desde && d <= hasta; });

  const usuarios = {};        // email -> {email,nombre,roles,eventos,vistas:Set,ultimo}
  const vistas   = {};        // vista -> {vista, eventos, users:Set}
  const areas    = {};        // area  -> {area, eventos, users:Set}
  const porDia   = {};        // dia   -> {dia, eventos, users:Set}
  const usuariosSet = new Set();

  for (const e of eventos){
    const email = e.email || '(anónimo)';
    usuariosSet.add(email);
    if (!usuarios[email]) usuarios[email] = { email, nombre: e.nombre || '', roles: e.roles || [], eventos: 0, vistas: {}, ultimo: '' };
    const u = usuarios[email];
    u.eventos += 1;
    if (e.nombre && !u.nombre) u.nombre = e.nombre;
    if (e.roles && e.roles.length) u.roles = e.roles;
    if ((e.ts || '') > u.ultimo) u.ultimo = e.ts || '';
    const vv = e.vista || '(sin vista)';
    u.vistas[vv] = (u.vistas[vv] || 0) + 1;

    if (!vistas[vv]) vistas[vv] = { vista: vv, eventos: 0, users: new Set() };
    vistas[vv].eventos += 1; vistas[vv].users.add(email);

    const ar = e.area || '(sin área)';
    if (!areas[ar]) areas[ar] = { area: ar, eventos: 0, users: new Set() };
    areas[ar].eventos += 1; areas[ar].users.add(email);

    const dia = (e.ts || '').slice(0, 10);
    if (dia){
      if (!porDia[dia]) porDia[dia] = { dia, eventos: 0, users: new Set() };
      porDia[dia].eventos += 1; porDia[dia].users.add(email);
    }
  }

  const por_usuario = Object.values(usuarios).map(u => ({
    email: u.email, nombre: u.nombre, roles: u.roles, eventos: u.eventos, ultimo: u.ultimo,
    top_vistas: Object.entries(u.vistas).map(([v,n]) => ({ vista: v, eventos: n })).sort((a,b)=>b.eventos-a.eventos).slice(0,6)
  })).sort((a,b)=> b.eventos - a.eventos);

  const por_vista = Object.values(vistas).map(v => ({ vista: v.vista, eventos: v.eventos, usuarios: v.users.size }))
    .sort((a,b)=> b.eventos - a.eventos);
  const por_area = Object.values(areas).map(a => ({ area: a.area, eventos: a.eventos, usuarios: a.users.size }))
    .sort((a,b)=> b.eventos - a.eventos);
  const por_dia = Object.values(porDia).map(d => ({ dia: d.dia, eventos: d.eventos, usuarios: d.users.size }))
    .sort((a,b)=> a.dia.localeCompare(b.dia));

  return {
    desde, hasta,
    totales: { eventos: eventos.length, usuarios: usuariosSet.size, vistas_distintas: por_vista.length },
    por_usuario, por_vista, por_area, por_dia
  };
}

async function agregar(desde, hasta){
  hasta = reISO.test(hasta || '') ? hasta : hoyIso();
  desde = reISO.test(desde || '') ? desde : hasta.slice(0, 8) + '01';
  let eventos = [];
  for (const mes of mesesDelRango(desde, hasta)) eventos = eventos.concat(await leerMes(mes));
  return agregarEventos(eventos, desde, hasta);
}

module.exports = { registrar, agregar, leerMes, agregarEventos };
