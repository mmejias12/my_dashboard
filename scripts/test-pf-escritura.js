#!/usr/bin/env node
// ============================================================================
//  scripts/test-pf-escritura.js
//
//  Pruebas de la ORQUESTACIÓN de api/shared/pf-escritura.js, con arnés de
//  mutaciones. Sin red: las dependencias se inyectan, así que se puede exigir
//  lo único que de verdad importa —CUÁNTAS veces se escribe en Redlink— en
//  cada uno de los caminos.
//
//  Lo que protegen: que un corte, un reintento o un blob caído no terminen en
//  dos relocalizaciones. En producción ya pasó una vez (folios 4144642/4144643,
//  2-nov-2026): 5 pallets movidos dos veces.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'pf-escritura.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

function compilar(fuente, parcheNucleo) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  m.require = function (p) {
    // La bitácora real toca el blob: acá sólo hace falta su forma.
    if (/pf-bitacora\.js$/.test(p)) return { leerEstado: async () => null, registrar: async () => ({ ok: true }) };
    // El parche del núcleo existe para UNA cosa: poder romper a propósito la
    // invariante entre `validar` y `llaveUsable` y comprobar que la red de
    // seguridad de `procesar` hace su trabajo. Sin esto esa rama es
    // inalcanzable y no habría forma honesta de probarla.
    if (parcheNucleo && /pf-nucleo\.js$/.test(p)) return Object.assign({}, propio(p), parcheNucleo);
    return propio(p);
  };
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
const pend = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pend.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const ID = { bpId: 499, usuarioIngresoId: 740, nombre: 'PF' };
const BOD = [{ bodegaiD: 1537 }, { bodegaiD: 1550 }];
const PF = () => ({ OperacionId: 5, ServicioId: 19, BodegaOrigenId: 1537, BodegaDestinoId: 1550,
                    DocumentoId: 1, DocumentoNumero: 45285, Cantidad: 24 });

// Un Redlink de mentira al que se le dice cómo portarse.
function mundo(op) {
  const o = op || {};
  const h = { escrituras: 0, busquedas: 0, registros: [], bodegasPedidas: 0 };
  return { hecho: h, deps: {
    bodegas: async function () {
      h.bodegasPedidas++;
      if (o.bodegasFallan) throw new Error('HTTP 502');
      return o.bodegas || BOD;
    },
    leerEstado: async function (llave) {
      h.llaveConsultada = llave;
      if (o.estadoRevienta) throw new Error('AuthorizationFailure');
      return o.previo || null;
    },
    registrar: async function (e) {
      h.registros.push(e);
      if (o.registroFalla && e.estado === 'intentando') return { ok: false, motivo: 'blob caído' };
      return { ok: o.registroCreadoFalla && e.estado === 'creado' ? false : true,
               motivo: o.registroCreadoFalla ? 'blob caído' : '' };
    },
    crear: async function () {
      h.escrituras++;
      if (o.crearCorta) throw new Error('TimeoutError');
      if (o.crearYaExiste) return { http: 400, docId: null, yaExiste: true,
                                    motivo: 'Al crear....Ya existe Documento', ok: false };
      if (o.crearRechaza) return { http: 400, docId: null, yaExiste: false,
                                   motivo: 'la bodega no corresponde', ok: false };
      return { http: 200, docId: 684034, yaExiste: false, motivo: '', ok: true };
    },
    buscar: async function () {
      h.busquedas++;
      if (o.buscarRevienta) throw new Error('HTTP 502');
      const n = o.encuentraDespues === undefined ? !o.noEncuentra : (h.busquedas > o.encuentraDespues);
      return n ? { folio: 4141185, docId: 684034, etapa: 'Confirma Relocaliza', cuantos: 1 } : null;
    }
  } };
}

async function correr(S, fuente) {
  ok = 0; fallos = []; pend.length = 0;

  /* ── el camino feliz ─────────────────────────────────────────────────── */

  pruebaAsync('E01 crea, relee y devuelve el FOLIO, no el id del documento', async function () {
    // Medido en DEMO: el POST devuelve 684034 y el folio es 4141185. PF espera
    // el folio, que es el "Nro Pedido" que le daba el API viejo.
    const m = mundo();
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [201, 'creada']);
    igual(r.nroPedido, 4141185, 'tiene que ser el folio de la relectura');
    igual(r.docId, 684034);
    igual(m.hecho.escrituras, 1);
    cierto(m.hecho.busquedas >= 1, 'releyó');
  });

  pruebaAsync('E01b la llave sale del cliente y del documento de ESTA llamada', async function () {
    // Si la llave no distinguiera documentos, dos relocalizaciones distintas
    // compartirían estado y la segunda se devolvería como repetida.
    const m = mundo();
    await S.procesar(PF(), ID, m.deps);
    igual(m.hecho.llaveConsultada, '499|1|45285');
    igual(m.hecho.registros.map(x => x.llave), ['499|1|45285', '499|1|45285'],
          'y es la misma que se guarda');

    const m2 = mundo();
    await S.procesar(Object.assign(PF(), { DocumentoNumero: 45286 }), ID, m2.deps);
    igual(m2.hecho.llaveConsultada, '499|1|45286', 'otro documento, otra llave');
  });

  pruebaAsync('E02 deja la huella: intentando y después creado', async function () {
    const m = mundo();
    await S.procesar(PF(), ID, m.deps);
    igual(m.hecho.registros.map(x => x.estado), ['intentando', 'creado'],
          'el intento queda anotado ANTES de escribir');
    igual(m.hecho.registros[1].folio, 4141185);
  });

  /* ── no escribir dos veces: el corazón ───────────────────────────────── */

  pruebaAsync('E03 si la llave ya tiene folio, NO se escribe y se devuelve el mismo', async function () {
    const m = mundo({ previo: { estado: 'creado', folio: 4141185, docId: 684034,
                                huella: { bodegaOrigenId: 1537, bodegaDestinoId: 1550,
                                          cantidad: 24, documentoId: 1, documentoNumero: 45285 } } });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado, r.nroPedido, r.repetido], [200, 'ya-existia', 4141185, true]);
    igual(m.hecho.escrituras, 0, 'NI UNA escritura');
  });

  pruebaAsync('E04 un intento sin respuesta se RESUELVE leyendo, nunca reescribiendo', async function () {
    // Es la regla que evita el caso de producción del 2-nov.
    for (const estado of ['intentando', 'en-duda']) {
      const m = mundo({ previo: { estado, huella: { bodegaOrigenId: 1537, bodegaDestinoId: 1550,
                                  cantidad: 24, documentoId: 1, documentoNumero: 45285 } } });
      const r = await S.procesar(PF(), ID, m.deps);
      igual(m.hecho.escrituras, 0, 'con estado ' + estado + ' no se puede escribir');
      igual([r.http, r.estado, r.nroPedido], [200, 'ya-existia', 4141185], 'con estado ' + estado);
    }
  });

  pruebaAsync('E05 si el intento anterior NO había escrito, recién ahí se escribe', async function () {
    const m = mundo({ previo: { estado: 'en-duda', huella: { bodegaOrigenId: 1537, bodegaDestinoId: 1550,
                                cantidad: 24, documentoId: 1, documentoNumero: 45285 } },
                      encuentraDespues: 1 });
    const r = await S.procesar(PF(), ID, m.deps);
    igual(m.hecho.escrituras, 1, 'una sola');
    igual([r.http, r.nroPedido], [201, 4141185]);
  });

  pruebaAsync('E06 misma llave con otros datos: conflicto, sin escribir', async function () {
    const m = mundo({ previo: { estado: 'creado', folio: 1,
                                huella: { bodegaOrigenId: 1537, bodegaDestinoId: 1550,
                                          cantidad: 99, documentoId: 1, documentoNumero: 45285 } } });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [409, 'conflicto']);
    igual(m.hecho.escrituras, 0);
  });

  /* ── cuando algo se cae ──────────────────────────────────────────────── */

  pruebaAsync('E07 si no se puede consultar el registro, NO se escribe', async function () {
    // No saber qué hay no autoriza a escribir.
    const m = mundo({ estadoRevienta: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'no-disponible']);
    igual(m.hecho.escrituras, 0);
  });

  pruebaAsync('E08 si no se puede anotar el intento, NO se escribe', async function () {
    const m = mundo({ registroFalla: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'no-disponible']);
    igual(m.hecho.escrituras, 0, 'nadie sabría después que lo intentamos');
    cierto(/no se escribió nada/.test(r.dice), r.dice);
  });

  pruebaAsync('E09 si la escritura se corta, queda en duda y NO se reintenta', async function () {
    const m = mundo({ crearCorta: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'en-duda']);
    igual(m.hecho.escrituras, 1, 'una sola, y no se repite');
    igual(m.hecho.registros.map(x => x.estado), ['intentando', 'en-duda']);
    cierto(/Vuelve a llamar/.test(r.dice), r.dice);
  });

  pruebaAsync('E10 "ya existe documento" NO es un fallo: es la prueba de que está', async function () {
    // Medido en DEMO: HTTP 400 con ["Al crear....Ya existe Documento"].
    const m = mundo({ crearYaExiste: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado, r.nroPedido, r.repetido], [200, 'ya-existia', 4141185, true]);
    igual(m.hecho.registros[1].estado, 'creado');
  });

  pruebaAsync('E11 un rechazo por contenido sí es un fallo, y dice el motivo de Redlink', async function () {
    const m = mundo({ crearRechaza: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [400, 'rechazado']);
    igual(r.problemas, ['la bodega no corresponde']);
    igual(m.hecho.registros[1].estado, 'rechazado', 'queda como rechazado, que SÍ se puede reintentar');
  });

  pruebaAsync('E12 si escribió pero no aparece al releer, queda en duda', async function () {
    const m = mundo({ noEncuentra: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'en-duda']);
    igual(m.hecho.registros[1].estado, 'en-duda');
  });

  pruebaAsync('E13 si la relectura revienta tras escribir, también queda en duda', async function () {
    const m = mundo({ buscarRevienta: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'en-duda']);
    igual(m.hecho.escrituras, 1);
  });

  pruebaAsync('E14 si no se puede leer el maestro de bodegas, no se valida a ciegas', async function () {
    const m = mundo({ bodegasFallan: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'no-disponible']);
    igual(m.hecho.escrituras, 0);
  });

  pruebaAsync('E15 si queda creada pero no se pudo registrar, se dice sin fallar', async function () {
    // Ya está escrita en Redlink: decir "falló" invitaría a reintentar.
    const m = mundo({ registroCreadoFalla: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado, r.nroPedido], [201, 'creada', 4141185]);
    cierto(/no se pudo guardar el registro/.test(r.registro || ''), r.registro);
  });

  /* ── la bitácora se resuelve ANTES de salir a la red ─────────────────── */

  pruebaAsync('E21 un documento YA CREADO se devuelve aunque Redlink esté caído', async function () {
    // El caso del 24-nov-2026: accounts.portalredtec.cl inalcanzable desde
    // Azure. El folio está guardado en la bitácora; preguntarle el maestro a
    // Redlink para poder devolverlo no tiene sentido, y rompía la instrucción
    // que le damos a PF —"ante un corte, vuelve a llamar con los mismos datos".
    const m = mundo({ bodegasFallan: true,
                      previo: { estado: 'creado', folio: 4157023, docId: 699891,
                                huella: null } });
    m.deps.leerEstado = async function (llave) {
      m.hecho.llaveConsultada = llave;
      const N = require('../api/shared/pf-nucleo.js');
      return { estado: 'creado', folio: 4157023, docId: 699891, huella: N.huellaDe(N.normalizar(PF())) };
    };
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado, r.nroPedido, r.repetido], [200, 'ya-existia', 4157023, true]);
    igual(m.hecho.escrituras, 0, 'no escribe');
    igual(m.hecho.bodegasPedidas, 0, 'y ni siquiera le pregunta el maestro a Redlink');
  });

  pruebaAsync('E22 el conflicto también se resuelve con Redlink caído', async function () {
    // Mismo número de documento con otra cantidad. Tampoco necesita el maestro:
    // no se va a escribir nada en ninguno de los dos casos.
    const m = mundo({ bodegasFallan: true });
    m.deps.leerEstado = async function () {
      const N = require('../api/shared/pf-nucleo.js');
      const otro = N.normalizar(Object.assign(PF(), { Cantidad: 99 }));
      return { estado: 'creado', folio: 4157023, docId: 699891, huella: N.huellaDe(otro) };
    };
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [409, 'conflicto']);
    igual(m.hecho.escrituras, 0);
    igual(m.hecho.bodegasPedidas, 0);
  });

  pruebaAsync('E23 un documento NUEVO sí necesita el maestro antes de escribir', async function () {
    // La contracara de E21: saltarse el maestro sólo vale para lo que NO
    // escribe. Si no hay registro previo, hay que validar las bodegas.
    const m = mundo({ bodegasFallan: true });
    const r = await S.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado], [503, 'no-disponible']);
    cierto(/maestro de bodegas/.test(r.dice || ''), r.dice);
    igual(m.hecho.escrituras, 0);
    igual(m.hecho.bodegasPedidas, 1, 'lo pidió');
  });

  pruebaAsync('E24 sin número de documento no se consulta la bitácora, se rechaza', async function () {
    // La llave sería basura. Se cae por el camino normal de validación.
    const m = mundo();
    const r = await S.procesar(Object.assign(PF(), { DocumentoNumero: 0 }), ID, m.deps);
    igual([r.http, r.estado], [400, 'rechazado']);
    igual(m.hecho.escrituras, 0);
    igual(m.hecho.llaveConsultada, undefined, 'ni siquiera consultó la bitácora');
    cierto(/documentoNumero/.test(r.problemas.join(' ')), r.problemas.join(' '));
  });

  pruebaAsync('E25 si la invariante se rompiera, igual se mira la bitácora antes de escribir', async function () {
    // `validar` y `llaveUsable` exigen lo mismo, así que esta rama hoy no se
    // alcanza. Se prueba igual porque el día que alguien toque una de las dos
    // y no la otra, lo que está en juego es escribir sin consultar la
    // idempotencia: dos relocalizaciones y pallets movidos dos veces.
    const S2 = compilar(fuente || FUENTE, { llaveUsable: function () { return false; } });
    const m = mundo();
    m.deps.leerEstado = async function (llave) {
      m.hecho.llaveConsultada = llave;
      const N = require('../api/shared/pf-nucleo.js');
      return { estado: 'creado', folio: 4157023, docId: 699891, huella: N.huellaDe(N.normalizar(PF())) };
    };
    const r = await S2.procesar(PF(), ID, m.deps);
    igual([r.http, r.estado, r.nroPedido], [200, 'ya-existia', 4157023]);
    igual(m.hecho.escrituras, 0, 'no escribió pese a saltarse la consulta temprana');
    igual(m.hecho.llaveConsultada, '499|1|45285', 'la consultó en la red de seguridad');
  });

  /* ── validación y avisos ─────────────────────────────────────────────── */

  pruebaAsync('E16 un payload inválido se rechaza ANTES de tocar Redlink', async function () {
    const m = mundo();
    const r = await S.procesar(Object.assign(PF(), { BodegaDestinoId: 9999 }), ID, m.deps);
    igual([r.http, r.estado], [400, 'rechazado']);
    igual(m.hecho.escrituras, 0);
    cierto(/no es una bodega de este cliente/.test(r.problemas.join(' ')), r.problemas.join(' '));
  });

  pruebaAsync('E17 los avisos viajan en todas las respuestas, no sólo en la buena', async function () {
    for (const op of [{}, { crearRechaza: true }, { noEncuentra: true }]) {
      const m = mundo(op);
      const r = await S.procesar(Object.assign(PF(), { ModoProduccion: true }), ID, m.deps);
      cierto((r.avisos || []).some(x => /modoProduccion/.test(x)),
             'faltó el aviso con ' + JSON.stringify(op) + ': ' + JSON.stringify(r.avisos));
    }
  });

  /* ── lectura de lo que Redlink contesta ──────────────────────────────── */

  prueba('E18 el entero del POST se lee como formHeaderiD', function () {
    igual(S.docIdDe({ texto: '684034' }), 684034);
    igual(S.docIdDe({ json: { formHeaderiD: 684034 } }), 684034);
    igual(S.docIdDe({ json: ['Al crear....Ya existe Documento'] }), null, 'una lista de errores no es un id');
    igual(S.docIdDe({ texto: 'no soy un numero' }), null);
    // Sólo dígitos. Sin el filtro, Number() aceptaría notaciones que no son un
    // id: '1e3' se leería como 1000 y '0x10' como 16.
    igual([S.docIdDe({ texto: '1e3' }), S.docIdDe({ texto: '0x10' })], [null, null]);
  });

  prueba('E19 "ya existe documento" se reconoce aunque cambie el formato', function () {
    cierto(S.yaExiste({ json: ['Al crear....Ya existe Documento'] }));
    cierto(S.yaExiste({ texto: 'ya existe documento' }));
    cierto(S.yaExiste({ json: { mensaje: 'Ya Existe Documento' } }));
    falso(S.yaExiste({ json: ['la bodega no corresponde'] }));
    falso(S.yaExiste(null));
  });

  prueba('E20 el motivo se arma legible y acotado', function () {
    igual(S.motivoDe({ json: ['uno', 'dos'] }), 'uno · dos');
    igual(S.motivoDe({ json: { mensaje: 'x' } }), 'x');
    cierto(S.motivoDe({ texto: 'y'.repeat(900) }).length <= 300);
  });

  for (const [n, fn] of pend) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['V01 se escribe aunque ya exista folio',        /if \(dec\.accion === 'devolver'\) \{/, 'if (false) {'],
  ['V02 se escribe aunque haya un intento en vilo', /if \(dec\.accion === 'resolver'\) \{/, 'if (false) {'],
  ['V03 el conflicto no detiene nada',             /if \(dec\.accion === 'conflicto'\) \{/, 'if (false) {'],
  ['V04 se escribe sin poder consultar el registro', /  catch \(e\) \{\n    \/\/ No saber qué hay NO autoriza a escribir\.[\s\S]*?\n  \}/, '  catch (e) { previo = null; }'],
  ['V05 se escribe sin poder anotar el intento',   /if \(!marca\.ok\) \{[\s\S]*?\n  \}/, ''],
  ['V06 un corte al escribir se reintenta',        /    await d\.registrar\(\{ llave, estado: 'en-duda', bpId: identidad\.bpId, huella,\n                        quien: identidad\.nombre, detalle: 'la escritura se cortó' \}\);\n    return resp\(503, 'en-duda'/, "    r = await d.crear(N.aFormHeader(p, identidad));\n    return resp(503, 'en-duda'"],
  ['V07 el folio sale del POST y no de la relectura', /\{ nroPedido: hall\.folio, docId: hall\.docId, etapa: hall\.etapa,/, '{ nroPedido: r.docId, docId: hall.docId, etapa: hall.etapa,'],
  ['V08 no se relee después de escribir',          /  let hall = null;\n  try \{ hall = await d\.buscar\(identidad\.bpId, p\.documentoNumero\); \}\n  catch \(e\) \{ hall = null; \}/, '  let hall = { folio: r.docId, docId: r.docId, etapa: "" };'],
  ['V09 "ya existe" se trata como rechazo',        /if \(!r\.ok && !r\.yaExiste\) \{/, 'if (!r.ok) {'],
  ['V10 un rechazo de contenido se trata como "ya existe"', /if \(!r\.ok && !r\.yaExiste\) \{[\s\S]*?\n  \}/, ''],
  ['V11 no encontrar tras escribir se canta como éxito', /  await d\.registrar\(\{ llave, estado: 'en-duda', bpId: identidad\.bpId, huella,\n                      quien: identidad\.nombre,\n                      detalle: r\.yaExiste[\s\S]*?\n  return resp\(503, 'en-duda', \{ dice: N\.dudaSinResolver\(p\), avisos: avisos \}\);/, "  return resp(201, 'creada', { nroPedido: null });"],
  ['V12 la validación no detiene nada',            /if \(!v\.ok\) return resp\(400, 'rechazado', \{ problemas: v\.problemas, avisos: avisos \}\);/, ''],
  ['V13 sin maestro de bodegas se sigue igual',    /  catch \(e\) \{\n    return resp\(503, 'no-disponible',\n      \{ dice: 'no se pudo verificar el maestro de bodegas en Redlink; no se escribió nada' \}\);\n  \}/, '  catch (e) { bodegas = []; }'],
  ['V14 la llave ignora el documento',             /const llave = N\.llaveDe\(identidad\.bpId, p\.documentoId, p\.documentoNumero\);/, 'const llave = N.llaveDe(identidad.bpId, 0, 0);'],
  ['V15 el estado creado no guarda el folio',      /\{ llave, estado: 'creado', folio: hall\.folio, docId: hall\.docId,\n                                  bpId: identidad\.bpId/, "{ llave, estado: 'creado', docId: hall.docId,\n                                  bpId: identidad.bpId"],
  ['V16 un fallo al registrar lo creado tumba la respuesta', /registro: g\.ok \? undefined : 'quedó creada pero no se pudo guardar el registro'/, "registro: undefined"],
  ['V17 los avisos no viajan en el rechazo',       /\{ dice: 'Redlink no aceptó la relocalización', problemas: \[r\.motivo\], avisos: avisos \}/, "{ dice: 'Redlink no aceptó la relocalización', problemas: [r.motivo] }"],
  // V18 ("el entero del POST se confunde con una lista") se RETIRÓ: era
  // equivalente. Una lista no tiene formHeaderiD, así que con o sin el guardia
  // de Array.isArray el resultado es null. El guardia se deja igual porque
  // expresa la intención y no cuesta nada.
  ['V18 cualquier texto se lee como id',           /\/\^\\s\*\\d\+\\s\*\$\/\.test\(r\.texto\)/, 'true'],
  ['V19 "ya existe" se reconoce sólo exacto',      /\/ya\\s\*existe\\s\*documento\/i/, '/^Ya existe Documento$/'],
  ['V20 el motivo no se acota',                    /return N\.texto\(t, 300\);/, 'return t;'],
  ['V22 la bitácora se consulta sólo después del maestro', /  let paso = null;\n  if \(N\.llaveUsable\(p\)\) \{\n    paso = await idempotencia\(d, p, llave, avisos\);\n    if \(paso\.resp\) return paso\.resp;\n  \}/, '  let paso = null;'],
  ['V23 la red de seguridad no mira la bitácora', /  if \(!paso\) \{\n    paso = await idempotencia\(d, p, llave, avisos\);\n    if \(paso\.resp\) return paso\.resp;\n  \}/, '  if (!paso) { paso = { dec: { accion: "escribir" }, previo: null }; }'],
  ['V24 cualquier llave se considera usable',      /if \(N\.llaveUsable\(p\)\) \{/, 'if (true) {'],
  ['V21 el intento se anota DESPUÉS de escribir',  /  const marca = await d\.registrar\(\{ llave, estado: 'intentando', bpId: identidad\.bpId,\n                                    huella, quien: identidad\.nombre \}\);/, '  const marca = { ok: true };']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(compilar(mutado), mutado); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  const r = await correr(compilar(FUENTE), FUENTE);
  console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
  for (const f of r.fallos) console.log('  FALLA ' + f);
  if (!r.fallos.length || process.argv.indexOf('--mutaciones') >= 0) {
    const m = await mutar();
    console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
    for (const n of m.noAplican) console.log('  NO APLICA  ' + n);
    for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n);
    if (m.vivas.length || m.noAplican.length) process.exit(1);
  }
  process.exit(r.fallos.length ? 1 : 0);
})();
