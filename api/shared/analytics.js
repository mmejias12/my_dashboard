// ============================================================================
//  shared/analytics.js  ·  Uso de REDTEC OS (administración)
//
//  Registra un evento por cada consulta al asistente (append a un JSONL mensual
//  en Azure Blob) y agrega esos eventos para el panel de administración: quién
//  usa, cuántas consultas, tokens, costo estimado, preguntas más repetidas y
//  tendencia diaria. Solo lo consume la función analytics-proxy (rol admin).
//
//  Blob:  contenedor OS_ANALYTICS_CONTAINER (def. 'redtec-os-analytics')
//         uso/YYYY-MM.jsonl  (una línea JSON por consulta)
//
//  Diseño: el registro es BEST-EFFORT — nunca debe romper el chat. Cualquier
//  error al escribir se traga en silencio.
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.OS_STORAGE_CONN;
const CONTAINER = process.env.OS_ANALYTICS_CONTAINER || 'redtec-os-analytics';

// Precios Claude Sonnet 4.6 (USD por millón de tokens). Para estimar costo.
const PRECIO = { in: 3, out: 15, cacheR: 0.30, cacheW: 3.75 };
function costoUSD(t){
  return ((t.in || 0) * PRECIO.in + (t.out || 0) * PRECIO.out +
          (t.cacheR || 0) * PRECIO.cacheR + (t.cacheW || 0) * PRECIO.cacheW) / 1e6;
}

function contenedor(){ return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER); }
function blobMes(mes){ return `uso/${mes}.jsonl`; }             // mes = 'YYYY-MM'

async function streamToString(readable){
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

// ── Registrar un evento (append). Best-effort: nunca lanza. ──────────────────
async function registrarUso(ev){
  if (!CONN) return;
  try {
    const c = contenedor();
    await c.createIfNotExists();
    const mes = (ev.ts || new Date().toISOString()).slice(0, 7);
    const ab = c.getAppendBlobClient(blobMes(mes));
    await ab.createIfNotExists();
    const linea = JSON.stringify(ev) + '\n';
    await ab.appendBlock(linea, Buffer.byteLength(linea));
  } catch (e) { /* best-effort, no romper el chat */ }
}

function esNoExiste(e){
  const cod = String((e && (e.code || e.errorCode)) || '');
  const msg = String((e && e.message) || '');
  return !!e && (e.statusCode === 404 ||
    /BlobNotFound|ContainerNotFound/i.test(cod) ||
    /BlobNotFound|ContainerNotFound|does not exist|not found/i.test(msg));
}

// ── Leer un mes completo (arreglo de eventos). ───────────────────────────────
async function leerMes(mes){
  const c = contenedor();
  try {
    const dl = await c.getBlobClient(blobMes(mes)).download();
    const txt = await streamToString(dl.readableStreamBody);
    return txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) {
    if (esNoExiste(e)) return [];    // aún no hay datos → vacío, no error
    throw e;
  }
}

// Lista de meses 'YYYY-MM' que cubre el rango [desde, hasta].
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

// Normaliza una pregunta para agrupar las repetidas (minúsculas, sin tildes,
// sin signos, espacios colapsados). No altera el texto guardado, solo agrupa.
function normPregunta(s){
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
}

const reISO  = /^\d{4}-\d{2}-\d{2}$/;
const hoyIso  = () => new Date().toISOString().slice(0, 10);

// ── Agregar: arma el resumen para el panel. ──────────────────────────────────
async function agregar(desde, hasta){
  hasta = reISO.test(hasta || '') ? hasta : hoyIso();
  desde = reISO.test(desde || '') ? desde : hasta.slice(0, 8) + '01';

  let eventos = [];
  for (const mes of mesesDelRango(desde, hasta)) eventos = eventos.concat(await leerMes(mes));
  // Recorte exacto por fecha (el JSONL es mensual).
  eventos = eventos.filter(e => { const d = (e.ts || '').slice(0, 10); return d >= desde && d <= hasta; });

  const tot = { in: 0, out: 0, cacheR: 0, cacheW: 0 };
  const usuarios = {}, preguntas = {}, porDia = {}, porGalaxia = {};
  const usuariosSet = new Set();

  for (const e of eventos) {
    const t = e.tokens || {};
    tot.in += t.in || 0; tot.out += t.out || 0; tot.cacheR += t.cacheR || 0; tot.cacheW += t.cacheW || 0;

    const email = e.email || '(desconocido)';
    usuariosSet.add(email);
    if (!usuarios[email]) usuarios[email] = { email, consultas: 0, tokens_in: 0, tokens_out: 0, costo_usd: 0, ultimo: '' };
    const u = usuarios[email];
    u.consultas += 1; u.tokens_in += t.in || 0; u.tokens_out += t.out || 0;
    u.costo_usd += costoUSD(t);
    if ((e.ts || '') > u.ultimo) u.ultimo = e.ts || '';

    if (e.pregunta) {
      const k = normPregunta(e.pregunta);
      if (k) {
        if (!preguntas[k]) preguntas[k] = { pregunta: e.pregunta, veces: 0 };
        preguntas[k].veces += 1;
      }
    }

    const dia = (e.ts || '').slice(0, 10);
    if (dia) {
      if (!porDia[dia]) porDia[dia] = { dia, consultas: 0, tokens: 0 };
      porDia[dia].consultas += 1; porDia[dia].tokens += (t.in || 0) + (t.out || 0);
    }

    const gs = (e.tools && e.tools.length) ? e.tools : ['(sin herramienta)'];
    for (const g of gs) { porGalaxia[g] = (porGalaxia[g] || 0) + 1; }
  }

  const rank = Object.values(usuarios)
    .map(u => ({ ...u, costo_usd: +u.costo_usd.toFixed(3) }))
    .sort((a, b) => b.consultas - a.consultas);

  return {
    desde, hasta,
    totales: {
      consultas: eventos.length,
      usuarios: usuariosSet.size,
      tokens_in: tot.in, tokens_out: tot.out, tokens_cache_r: tot.cacheR, tokens_cache_w: tot.cacheW,
      tokens_total: tot.in + tot.out + tot.cacheR + tot.cacheW,
      costo_usd: +costoUSD(tot).toFixed(2)
    },
    por_usuario: rank,
    top_preguntas: Object.values(preguntas).sort((a, b) => b.veces - a.veces).slice(0, 25),
    por_dia: Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia)),
    por_galaxia: Object.entries(porGalaxia).map(([k, v]) => ({ galaxia: k, consultas: v })).sort((a, b) => b.consultas - a.consultas)
  };
}

module.exports = { registrarUso, agregar, leerMes, costoUSD, normPregunta };