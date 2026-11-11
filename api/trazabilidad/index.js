// ============================================================================
//  api/trazabilidad
//
//  GET   busca un pedido y devuelve TODO lo que sabemos de él, sin depender de
//        que hoy cruce con nada: cada vez que apareció en un reporte de
//        Walmart, qué confirmamos nosotros y si está esperando transferencia.
//  POST  anota las apariciones del reporte que se acaba de cruzar.
//
//  POR QUÉ EXISTE. Es el módulo "Trazabilidad" que logística usa en M2LINK:
//  se pega un número y se ve la historia. La pregunta real que vienen a
//  hacerle es la del 10-nov: "Walmart dijo 9, confirmamos 9, y ahora dice 20
//  — ¿desde cuándo?". Eso no se contesta con el estado actual de nada; se
//  contesta con la secuencia.
//
//  QUÉ NO HACE. No consulta Redlink. Buscar un pedido tiene que responder al
//  instante, y el histórico de Redlink tarda segundos y a veces devuelve 502.
//  La foto de Redlink que sí viaja es la que guardamos al confirmar, que es la
//  que importa para auditar: lo que el documento decía cuando lo tocamos.
//
//  El POST es append-only (ver planillas-walmart.js) y nunca decide nada: el
//  cruce lo hizo el navegador con el mismo módulo que usan las pruebas.
// ============================================================================
'use strict';

const planillas = require('../shared/planillas-walmart.js');
const confirmaciones = require('../shared/confirmaciones-registro.js');
const pendientes = require('../shared/pendientes-cruce.js');

const ROLES = ['admin', 'logistica', 'jefatura', 'comercial'];
const MAX_FILAS_POST = 3000;
// Cuánto mira hacia atrás una búsqueda. Seis meses son unos pocos MB de JSONL
// y cubren de sobra el caso que motivó esto (reaparecer a los días).
const MESES_DEF = 6;
const MESES_TOPE = 24;
const MAX_RESULTADOS = 400;

function quien(req) {
  const b64 = (req.headers && (req.headers['x-ms-client-principal'] ||
                               req.headers['X-MS-CLIENT-PRINCIPAL'])) || '';
  if (!b64) return { nombre: '', roles: [] };
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return { nombre: String(p.userDetails || p.userId || ''),
             roles: Array.isArray(p.userRoles) ? p.userRoles.map(String) : [] };
  } catch (e) { return { nombre: '', roles: [] }; }
}

// Lo que se escribe en la búsqueda. Puede ser un folio, una cita o un PO:
// los tres son números y la persona no tiene por qué saber cuál es cuál.
function termino(q) {
  const t = String(q == null ? '' : q).trim();
  if (!/^[A-Za-z0-9-]{3,30}$/.test(t)) return { ok: false, t: '', motivo: 'busca un número de pedido, una cita o un PO' };
  return { ok: true, t: t, motivo: '' };
}

// Una fila "calza" si el término es su folio o su PO. La cita NO se compara
// acá a propósito: un término de ocho dígitos ya se toma como cita más abajo,
// y así una cita que todavía no tiene ninguna fila guardada (confirmada antes
// de que existiera este registro) igual se encuentra.
function coincide(f, t) {
  return String(f.folio) === t || String(f.po) === t;
}

function mesesPedidos(q) {
  const n = parseInt(q, 10);
  if (!Number.isFinite(n) || n < 1) return MESES_DEF;
  return Math.min(n, MESES_TOPE);
}

async function leerPlanillas(hoy, meses, leer) {
  const traer = leer || planillas.leerMes;
  let out = [];
  for (const m of planillas.mesesRecientes(hoy, meses)) out = out.concat(await traer(m));
  return out;
}

// El corazón: puro, sin red, para poder probarlo entero.
function armar(t, filas, confs, estados) {
  const directas = (filas || []).filter(function (f) { return coincide(f, t); });

  // El término se resuelve a un conjunto de citas y folios. Buscar "4149330"
  // (un folio) tiene que traer la historia COMPLETA de su cita, incluidas las
  // apariciones de los días en que todavía no tenía folio asignado.
  const citas = {}, folios = {};
  directas.forEach(function (f) {
    if (f.cita) citas[String(f.cita)] = 1;
    if (f.folio) folios[String(f.folio)] = 1;
  });
  // Si lo que se buscó es un folio que nunca llegó a planillas (por ejemplo de
  // antes de que empezáramos a guardarlas), igual sirve como folio.
  if (/^\d+$/.test(t)) folios[t] = 1;
  if (/^\d{8}$/.test(t)) citas[t] = 1;

  // El guardia importa: apariciones() con una lista vacía significa "sin
  // filtro" y devolvería los seis meses completos. Un folio que no figura en
  // ninguna planilla tiene que dar cero apariciones, no todas.
  const listaCitas = Object.keys(citas);
  const apar = listaCitas.length
    ? planillas.apariciones(filas, listaCitas).slice(0, MAX_RESULTADOS)
    : [];
  // Si la cita aparece bajo otro folio en algún reporte, ese folio también es
  // parte de su historia: así se encuentran las confirmaciones hechas sobre él.
  apar.forEach(function (f) { if (f.folio) folios[String(f.folio)] = 1; });

  const mias = (confs || []).filter(function (r) {
    return folios[String(r.folio)] || (r.reporte && citas[String(r.reporte.cita)]);
  }).sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); })
    .slice(0, MAX_RESULTADOS);

  const esperando = pendientes.abiertas(estados || [])
    .filter(function (e) { return citas[String(e.cita)]; });

  // Lo que se confirmó, por cita, para poder contrastarlo con lo último que
  // dijo Walmart. Es el caso de la reconfirmación: 9 confirmados contra 20
  // declarados ahora.
  // mias ya viene de la más nueva a la más vieja: la primera de cada cita es
  // la última que se hizo.
  const confirmadoPorCita = {};
  mias.forEach(function (r) {
    const c = String((r.reporte && r.reporte.cita) || '');
    if (!c || confirmadoPorCita[c]) return;
    confirmadoPorCita[c] = { ts: r.ts, cantidad: r.cantidad, folio: r.folio, quien: r.quien };
  });

  const ultima = {};
  apar.forEach(function (f) { if (!ultima[f.cita]) ultima[f.cita] = f; });  // apar viene de la más nueva

  const desajustes = Object.keys(ultima).map(function (c) {
    const u = ultima[c], k = confirmadoPorCita[c];
    if (!k) return null;
    const declarado = Number(u.canje) || 0;
    const confirmado = Number(k.cantidad) || 0;
    if (declarado === confirmado) return null;
    return { cita: c, folio: k.folio, declarado: declarado, confirmado: confirmado,
             faltan: declarado > confirmado ? declarado - confirmado : 0,
             sobran: confirmado > declarado ? confirmado - declarado : 0,
             ultimoReporte: u.dia, archivo: u.archivo, confirmadoEl: String(k.ts).slice(0, 10),
             confirmadoPor: k.quien };
  }).filter(Boolean);

  return {
    termino: t,
    citas: Object.keys(citas).sort(),
    folios: Object.keys(folios).sort(),
    apariciones: apar,
    cambios: planillas.cambios(apar),
    confirmaciones: mias,
    pendientes: esperando,
    desajustes: desajustes,
    hallado: !!(apar.length || mias.length || esperando.length)
  };
}

function filasDelPost(cuerpo) {
  const c = cuerpo || {};
  return (Array.isArray(c.filas) ? c.filas : []).slice(0, MAX_FILAS_POST);
}

module.exports = async function (context, req) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cab, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');

  const q = quien(req);
  if (!q.roles.some(r => ROLES.indexOf(r) >= 0)) {
    return salir(403, { error: 'no tienes permiso para ver la trazabilidad' });
  }

  const hoy = new Date().toISOString().slice(0, 10);

  try {
    if (req.method === 'POST') {
      // Escribir las apariciones es sólo para quien cruza, no para quien mira.
      if (!q.roles.some(r => ['admin', 'logistica', 'jefatura'].indexOf(r) >= 0)) {
        return salir(403, { error: 'no tienes permiso para anotar apariciones' });
      }
      const filas = filasDelPost(req.body);
      const r = await planillas.registrar(filas, {
        archivo: (req.body || {}).archivo, quien: q.nombre
      });
      // Un fallo acá NO tumba nada: el cruce ya está en pantalla y la persona
      // ya está confirmando. Se devuelve el motivo para que se vea.
      return salir(200, { guardados: r.escritos, ok: r.ok,
                          aviso: r.ok ? '' : 'no se pudieron guardar las apariciones: ' + r.motivo });
    }

    const t = termino((req.query || {}).q);
    if (!t.ok) return salir(400, { error: t.motivo });

    if (!planillas.hayStorage()) {
      return salir(200, { termino: t.t, almacenamiento: false, hallado: false,
        citas: [], folios: [], apariciones: [], cambios: [], confirmaciones: [],
        pendientes: [], desajustes: [],
        aviso: 'el api no tiene almacenamiento configurado: no hay historia que buscar' });
    }

    const meses = mesesPedidos((req.query || {}).meses);
    const filas = await leerPlanillas(hoy, meses);
    const desde = planillas.mesesRecientes(hoy, meses)[0] + '-01';
    const confs = await confirmaciones.leerRango(desde, hoy);
    const estados = await pendientes.leerEstado(hoy);

    const r = armar(t.t, filas, confs, estados);
    r.almacenamiento = true;
    r.meses = meses;
    r.desde = desde;
    return salir(200, r);
  } catch (e) {
    context.log.error('trazabilidad: ' + ((e && e.message) || e));
    return salir(502, { error: 'no se pudo leer la trazabilidad; revisar el log de la función' });
  }
};

module.exports.armar = armar;
module.exports.termino = termino;
module.exports.coincide = coincide;
module.exports.mesesPedidos = mesesPedidos;
module.exports.filasDelPost = filasDelPost;
module.exports.leerPlanillas = leerPlanillas;
module.exports.ROLES = ROLES;
module.exports.MESES_DEF = MESES_DEF;
module.exports.MESES_TOPE = MESES_TOPE;
module.exports.MAX_FILAS_POST = MAX_FILAS_POST;
