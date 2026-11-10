#!/usr/bin/env node
// ============================================================================
//  scripts/test-confirmar-escritura.js
//
//  Pruebas de api/shared/confirmar-escritura.js y de api/confirmar-walmart,
//  con arnés de mutaciones. Sin red: el `pedir` se inyecta.
//
//  Lo que protegen: la única escritura del m3link que mueve inventario real en
//  SAP, ahora disparable desde una página web por tres roles distintos.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA   = path.join(__dirname, '..', 'api', 'shared', 'confirmar-escritura.js');
const RUTA_F = path.join(__dirname, '..', 'api', 'confirmar-walmart', 'index.js');
const FUENTE   = fs.readFileSync(RUTA, 'utf8');
const FUENTE_F = fs.readFileSync(RUTA_F, 'utf8');

function compilar(ruta, fuente) {
  const m = new Module(ruta, null);
  m.filename = ruta;
  m.paths = Module._nodeModulePaths(path.dirname(ruta));
  m._compile(fuente, ruta);
  return m.exports;
}

let ok = 0, fallos = [];
const pendientes = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pendientes.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const DOC = {
  formHeaderiD: 692187, folio: 4149330, formId: 6, formMetapaId: 43,
  bpOrigenNombre: 'INDUSTRIAS PRODUCTOS ALIMENTICIOS SA',
  bpDestinoNombre: 'WALMART CHILE COMERCIAL S.A',
  bodegaDestinoNombre: 'ZWM11 CD WM EL PEÑON',
  formMetapa: { formMetapaiD: 43, nombre: 'Pendiente Adjuntar Respaldo' },
  usuarioIngresoId: 60, usuarioIngresoNombre: 'dpalma', usuarioConfirmaId: null,
  formDdetalles: [{ formDdetalleiD: 691020, despachado: 1, recepcion: null }],
  formDregistros: [{ x: 1 }], formDtransportes: [{ formDtransporteiD: 433211 }]
};
const con = (c) => Object.assign({}, DOC, c);
const USUARIO_OK = '[{"usersiD":983,"userName":"M3LinkSystem"}]';

// Un servidor de mentira que contesta por ruta. Devuelve además la bitácora de
// lo que se le pidió, que es donde se ve si el cuerpo viajó intacto.
function servidor(opciones) {
  const o = opciones || {};
  const visto = [];
  const preparado = o.preparado !== undefined ? o.preparado : JSON.stringify(con({
    formMetapaId: 44, avanzaEtapa: true, filler: 'CONFNORMAL',
    usuarioIngresoId: 983, usuarioConfirmaId: 983,
    formDdetalles: [{ formDdetalleiD: 691020, despachado: 1, recepcion: 1 }],
    formDregistros: [], formDtransportes: []
  }));
  const despues = o.despues !== undefined ? o.despues : con({
    formMetapaId: 46, formMetapa: { formMetapaiD: 46, nombre: 'Transferencia Confirmada' },
    usuarioIngresoId: 983, usuarioIngresoNombre: 'M3LinkSystem', usuarioConfirmaId: 983,
    formDdetalles: [{ formDdetalleiD: 691020, despachado: 1, recepcion: 1 }]
  });
  let leidas = 0;
  const pedir = function (ruta, op) {
    visto.push({ ruta: ruta, metodo: (op || {}).method, cuerpo: (op || {}).body });
    if (ruta.indexOf('/api/User/nombreusuario/') === 0) {
      return Promise.resolve({ status: o.statusUsuario || 200, texto: o.usuario !== undefined ? o.usuario : USUARIO_OK });
    }
    if (ruta.indexOf('/api/FormHeader/ConfirmarTransferencia/') === 0) {
      return Promise.resolve({ status: o.statusPreparado || 200, texto: preparado,
                               falloCuerpo: o.falloPreparado || null });
    }
    if (ruta === '/api/FormHeader' && (op || {}).method === 'PATCH') {
      return Promise.resolve({ status: o.statusPatch || 200, texto: '{}' });
    }
    if (ruta.indexOf('/api/FormHeader/historico/') === 0) {
      return Promise.resolve({ status: 200, texto: JSON.stringify(o.historico || [{ folio: 4149330, formHeaderiD: 692187 }]) });
    }
    if (ruta.indexOf('/api/FormHeader/') === 0) {
      if (o.fallaDocumento) return Promise.resolve({ status: 500, texto: 'boom' });
      leidas++;
      const doc = (leidas === 1) ? (o.antes !== undefined ? o.antes : DOC) : despues;
      return Promise.resolve({ status: 200, texto: JSON.stringify(doc) });
    }
    return Promise.resolve({ status: 404, texto: '' });
  };
  return { pedir: pedir, visto: visto };
}

async function correr(S, hacerF) {
  const F = hacerF();
  pendientes.length = 0;
  ok = 0; fallos = [];

  const entorno = { REDLINK_CLIENT_SECRET: 'x', REDLINK_M3LINK_USER: 'M3LinkSystem', REDLINK_M3LINK_PASS: 'y' };
  const conEntorno = (fn) => {
    const previo = {};
    Object.keys(entorno).forEach(k => { previo[k] = process.env[k]; process.env[k] = entorno[k]; });
    const devolver = () => Object.keys(previo).forEach(k => {
      if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k];
    });
    const r = fn();
    return (r && typeof r.then === 'function') ? r.then(x => { devolver(); return x; },
                                                        e => { devolver(); throw e; })
                                               : (devolver(), r);
  };

  /* ---- las credenciales -------------------------------------------------- */

  prueba('E01 exige las credenciales de ESCRITURA, no las de lectura', () => {
    // redlink-fetch.js lee con REDLINK_USER. Esto escribe, y la confirmación
    // tiene que quedar firmada por M3LinkSystem: otro usuario, otra clave.
    igual(S.CLAVES, ['REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS']);
    falso(S.CLAVES.indexOf('REDLINK_USER') >= 0, 'el usuario de lectura no firma confirmaciones');
  });
  pruebaAsync('E02 sin credenciales no intenta escribir: lo dice y se detiene', async () => {
    const s = servidor();
    const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
    igual(r.estado, 'detener');
    cierto(/credenciales/.test(r.dice), r.dice);
    igual(s.visto.length, 0, 'no puede haber tocado el servidor');
  });

  /* ---- el camino completo ------------------------------------------------ */

  pruebaAsync('E03 una confirmación real: cuatro pasos en orden', async () => {
    await conEntorno(async () => {
      const s = servidor();
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'confirmada', r.dice);
      igual(r.etapa, 'Transferencia Confirmada');
      const rutas = s.visto.map(v => v.metodo + ' ' + v.ruta.split('?')[0]);
      igual(rutas, [
        'GET /api/User/nombreusuario/M3LinkSystem',
        'GET /api/FormHeader/692187',
        'GET /api/FormHeader/ConfirmarTransferencia/Folio/4149330/recibido/1/original/CONFIRMAVER2/usuarioconfirma/983',
        'PATCH /api/FormHeader',
        'GET /api/FormHeader/692187'
      ], 'el orden de los pasos ES el mecanismo');
    });
  });
  pruebaAsync('E04 el PATCH manda los MISMOS bytes que devolvió el preparador', async () => {
    // Ocho intentos con el cuerpo armado a mano dieron 400. Un JSON.parse +
    // stringify cambia orden de claves, decimales y fechas.
    await conEntorno(async () => {
      // Escrito a mano CON espacios: si alguien reserializa, los bytes cambian
      // y se ve. Un JSON.stringify de ida y vuelta sobre algo que ya salió de
      // JSON.stringify vuelve idéntico y no probaría nada.
      const crudo = '{\n  "folio": 4149330,\n  "formMetapaId": 44,\n  "avanzaEtapa": true,\n' +
                    '  "filler": "CONFNORMAL",\n  "usuarioIngresoId": 983,\n' +
                    '  "formDdetalles": [ { "formDdetalleiD": 691020, "despachado": 1, "recepcion": 1 } ]\n}';
      const s = servidor({ preparado: crudo });
      await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      const patch = s.visto.filter(v => v.metodo === 'PATCH')[0];
      igual(patch.cuerpo, crudo, 'el cuerpo tiene que viajar idéntico, byte por byte');
      cierto(typeof patch.cuerpo === 'string', 'como texto, no como objeto');
      cierto(patch.cuerpo.indexOf('\n') >= 0, 'con su formato original adentro');
    });
  });
  pruebaAsync('E05 el documento se relee ANTES y DESPUÉS de escribir', async () => {
    await conEntorno(async () => {
      const s = servidor();
      await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      const lecturas = s.visto.filter(v => v.ruta === '/api/FormHeader/692187');
      igual(lecturas.length, 2, 'una para decidir, otra para verificar');
    });
  });
  pruebaAsync('E06 una ya confirmada se SALTA y no se toca el servidor de escritura', async () => {
    await conEntorno(async () => {
      const ya = con({ formMetapa: { nombre: 'Transferencia Confirmada' },
                       formDdetalles: [{ despachado: 1, recepcion: 1 }] });
      const s = servidor({ antes: ya });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'saltada', r.dice);
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0, 'un segundo ajuste en SAP no se deshace');
    });
  });
  pruebaAsync('E07 si el documento no es del folio pedido, no se escribe', async () => {
    await conEntorno(async () => {
      const s = servidor({ antes: con({ folio: 9999999 }) });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      // El mensaje tiene que ser el de ESTA guarda: que el documento no sea del
      // folio pedido se detecta ANTES de pedirle nada al preparador.
      cierto(/es del folio 9999999, no del 4149330/.test(r.dice), r.dice);
      igual(s.visto.filter(v => v.ruta.indexOf('ConfirmarTransferencia') >= 0).length, 0,
        'no tendría que haber llegado ni a pedir el preparado');
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0);
    });
  });
  prueba('E07b el nombre de usuario no puede meter nada en la URL', () => {
    // idDeUsuario se llama con una constante, pero está exportada: la guarda
    // existe para el día que alguien la llame con algo que vino de afuera.
    ['../../FormHeader', 'a/b', 'a b', ''].forEach(function (mal) {
      let tiro = false;
      try { S.rutaDeUsuario(mal); }
      catch (e) { tiro = true; }
      cierto(tiro, 'tendría que rechazar ' + JSON.stringify(mal));
    });
  });
  prueba('E07c el cuerpo del token lleva el usuario de ESCRITURA', () => {
    // Es la línea que decide con qué usuario queda firmada la confirmación, y
    // sin probarla el error no se ve hasta que alguien audita en el portal.
    const previo = { u: process.env.REDLINK_M3LINK_USER, l: process.env.REDLINK_USER };
    process.env.REDLINK_M3LINK_USER = 'M3LinkSystem';
    process.env.REDLINK_USER = 'sapuser';
    const q = S.cuerpoDeToken();
    if (previo.u === undefined) delete process.env.REDLINK_M3LINK_USER; else process.env.REDLINK_M3LINK_USER = previo.u;
    if (previo.l === undefined) delete process.env.REDLINK_USER; else process.env.REDLINK_USER = previo.l;
    igual(q.get('username'), 'M3LinkSystem');
    falso(q.get('username') === 'sapuser', 'el usuario de lectura no firma confirmaciones');
    igual(q.get('grant_type'), 'password');
    igual(q.get('scope'), 'openid');
  });
  pruebaAsync('E08 si la API resuelve otro usersiD, no se escribe', async () => {
    await conEntorno(async () => {
      const s = servidor({ usuario: '[{"usersiD":7,"userName":"M3LinkSystem"}]' });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/No se elige uno de los dos/.test(r.dice), r.dice);
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0);
    });
  });
  pruebaAsync('E09 un preparado sin la recepción pedida no se manda', async () => {
    await conEntorno(async () => {
      const s = servidor({ preparado: JSON.stringify(con({ formDdetalles: [{ despachado: 1, recepcion: null }] })) });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/no sirve/.test(r.dice), r.dice);
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0);
    });
  });
  pruebaAsync('E10 si la etapa final no dice confirmada, se detiene', async () => {
    await conEntorno(async () => {
      const s = servidor({ despues: con({ formMetapa: { nombre: 'Pendiente Adjuntar Respaldo' },
                                          usuarioIngresoId: 983, usuarioIngresoNombre: 'M3LinkSystem',
                                          formDdetalles: [{ despachado: 1, recepcion: 1 }] }) });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/etapa quedó/.test(r.dice), r.dice);
    });
  });
  pruebaAsync('E11 si la firma final no es M3LinkSystem, se detiene', async () => {
    await conEntorno(async () => {
      const s = servidor({ despues: con({ formMetapa: { nombre: 'Transferencia Confirmada' },
                                          usuarioIngresoId: 60, usuarioIngresoNombre: 'dpalma',
                                          formDdetalles: [{ despachado: 1, recepcion: 1 }] }) });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/NO quedó firmada/.test(r.dice), r.dice);
    });
  });
  pruebaAsync('E12 si se vació una colección del documento, se detiene', async () => {
    await conEntorno(async () => {
      const s = servidor({ despues: con({ formMetapa: { nombre: 'Transferencia Confirmada' },
                                          usuarioIngresoId: 983, usuarioIngresoNombre: 'M3LinkSystem',
                                          formDdetalles: [{ despachado: 1, recepcion: 1 }],
                                          formDtransportes: [] }) });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/vaciaron/.test(r.dice), r.dice);
      igual(r.vaciadas, ['formDtransportes']);
    });
  });
  pruebaAsync('E13 un PATCH que no da 200 se detiene aunque el documento cambie', async () => {
    await conEntorno(async () => {
      const s = servidor({ statusPatch: 400 });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/HTTP 400/.test(r.dice), r.dice);
    });
  });
  pruebaAsync('E14 un preparado que no viene 200 se detiene', async () => {
    await conEntorno(async () => {
      const s = servidor({ statusPreparado: 500 });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/no preparó/.test(r.dice), r.dice);
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0);
    });
  });
  pruebaAsync('E15 una descarga cortada no se confunde con un cuerpo vacío', async () => {
    await conEntorno(async () => {
      const s = servidor({ falloPreparado: 'terminated' });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/se cortó/.test(r.dice), r.dice);
    });
  });
  pruebaAsync('E16 sin id, lo resuelve por el folio en el histórico', async () => {
    await conEntorno(async () => {
      const s = servidor();
      const r = await S.confirmarUna(4149330, 1, { pedir: s.pedir });
      igual(r.estado, 'confirmada', r.dice);
      cierto(s.visto.some(v => v.ruta.indexOf('/api/FormHeader/historico/') === 0), 'tenía que buscarlo');
    });
  });
  pruebaAsync('E17 un folio duplicado en el histórico no se escribe', async () => {
    await conEntorno(async () => {
      const s = servidor({ historico: [{ folio: 4149330, formHeaderiD: 1 }, { folio: 4149330, formHeaderiD: 2 }] });
      const r = await S.confirmarUna(4149330, 1, { pedir: s.pedir });
      igual(r.estado, 'detener');
      cierto(/2 operaciones/.test(r.dice), r.dice);
      igual(s.visto.filter(v => v.metodo === 'PATCH').length, 0);
    });
  });
  pruebaAsync('E18 la respuesta NUNCA trae el cuerpo que contestó Redlink', async () => {
    // Lo que entra al navegador es lo que decidimos nosotros. La respuesta de
    // Redlink puede traer cualquier cosa adentro.
    await conEntorno(async () => {
      const s = servidor({ statusPatch: 500 });
      const r = await S.confirmarUna(4149330, 1, { id: 692187, pedir: s.pedir });
      const texto = JSON.stringify(r);
      falso(/CONFNORMAL/.test(texto), 'se filtró el cuerpo preparado: ' + texto.slice(0, 200));
      falso(/claveFrontend/.test(texto), 'se filtró el cuerpo preparado');
    });
  });

  /* ---- la función HTTP --------------------------------------------------- */

  const principal = (roles, nombre) => Buffer.from(JSON.stringify({
    userDetails: nombre || 'alguien@redtec.cl', userRoles: roles || []
  })).toString('base64');
  const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };

  pruebaAsync('F01 sin rol no se puede confirmar', async () => {
    const c = ctx();
    await F(c, { method: 'POST', headers: { 'x-ms-client-principal': principal(['authenticated']) },
                 body: { folio: 4149330, cantidad: 1 } });
    igual(c.res.status, 403);
  });
  pruebaAsync('F02 sin principal tampoco', async () => {
    const c = ctx();
    await F(c, { method: 'POST', headers: {}, body: { folio: 4149330, cantidad: 1 } });
    igual(c.res.status, 403, 'una llamada sin identidad no escribe inventario');
  });
  pruebaAsync('F03 logistica, jefatura y admin sí pasan el control de rol', async () => {
    for (const rol of ['logistica', 'jefatura', 'admin']) {
      const c = ctx();
      await F(c, { method: 'POST', headers: { 'x-ms-client-principal': principal([rol, 'authenticated']) },
                   body: { folio: 0, cantidad: 1 } });
      igual(c.res.status, 400, 'con rol ' + rol + ' tiene que llegar a validar el cuerpo');
    }
  });
  pruebaAsync('F04 folio y cantidad tienen que ser enteros mayores que cero', async () => {
    const malos = [{ folio: 0, cantidad: 1 }, { folio: 4149330, cantidad: 0 },
                   { folio: 'x', cantidad: 1 }, { folio: 4149330, cantidad: -3 },
                   { folio: 4149330, cantidad: 1.5 }, {}];
    for (const body of malos) {
      const c = ctx();
      await F(c, { method: 'POST', headers: { 'x-ms-client-principal': principal(['admin']) }, body: body });
      igual(c.res.status, 400, 'tendría que rechazar ' + JSON.stringify(body));
    }
  });
  pruebaAsync('F05 el preflight no escribe nada', async () => {
    const c = ctx();
    await F(c, { method: 'OPTIONS', headers: {}, body: {} });
    igual(c.res.status, 204);
  });
  pruebaAsync('F06 un principal corrupto no pasa como autorizado', async () => {
    const c = ctx();
    await F(c, { method: 'POST', headers: { 'x-ms-client-principal': 'no-es-base64-valido!!' },
                 body: { folio: 4149330, cantidad: 1 } });
    igual(c.res.status, 403);
  });
  pruebaAsync('F08 si algo revienta, el navegador NO recibe el detalle', async () => {
    // La excepción puede traer adentro la respuesta de Redlink, y ahí va
    // cualquier cosa. Lo que sale al navegador es lo que decidimos nosotros.
    const c = ctx();
    await conEntorno(async () => {
      const Ffalla = hacerF({ fallaDocumento: true });
      await Ffalla(c, { method: 'POST', headers: { 'x-ms-client-principal': principal(['admin']) },
                        body: { folio: 4149330, cantidad: 1 } });
    });
    igual(c.res.status, 502);
    const texto = JSON.stringify(c.res.body);
    falso(/No se pudo leer el documento/.test(texto), 'se filtró el error interno: ' + texto);
    cierto(/revisar el log/.test(texto), texto);
  });
  pruebaAsync('F07 queda registrado QUIÉN lo pidió: en Redlink dice M3LinkSystem', async () => {
    // Sin esto, "lo confirmó el m3link" es todo lo que se podría averiguar.
    const c = ctx();
    const dichos = [];
    c.log = function (m) { dichos.push(String(m)); };
    c.log.warn = function () {}; c.log.error = function () {};
    await F(c, { method: 'POST', headers: { 'x-ms-client-principal': principal(['admin'], 'mauro@redtec.cl') },
                 body: { folio: 4149330, cantidad: 1 } });
    cierto(dichos.join(' ').indexOf('mauro@redtec.cl') >= 0, 'el log tiene que nombrar a la persona: ' + dichos.join(' '));
    cierto((c.res.body.pedidoPor || '').indexOf('mauro@redtec.cl') >= 0, 'y la respuesta también');
  });

  for (const [n, fn] of pendientes.slice()) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUTACIONES = [
  ['X01 el cuerpo del PATCH se reserializa',            /body: prep\.texto {22}\/\/ los MISMOS bytes, sin reserializar/, 'body: JSON.stringify(JSON.parse(prep.texto))'],
  ['X02 no se relee el documento después de escribir',  /const despues = await leer\(id\);/, 'const despues = JSON.parse(prep.texto);'],
  ['X03 no se verifica la etapa final',                 /if \(!\/confirmada\/i\.test\(etapa\)\) problemas\.push/, 'if (false) problemas.push'],
  ['X04 no se verifica la firma final',                  /if \(!v\.ok\) problemas\.push\(v\.dice\);/, ''],
  ['X05 no se verifica si se vaciaron colecciones',      /if \(vaciadas\.length\) problemas\.push/, 'if (false) problemas.push'],
  ['X06 un PATCH que no da 200 pasa como confirmado',    /if \(res\.status !== 200\) problemas\.push\('el PATCH devolvió HTTP ' \+ res\.status\);/, ''],
  ['X07 una ya confirmada se vuelve a confirmar',        /if \(c\.accion === 'saltar'\) return resp\('saltada'/, "if (false) return resp('saltada'"],
  ['X08 se escribe sin cotejar el usersiD',              /if \(!cotejo\.ok\) return resp\('detener', cotejo\.dice\);/, ''],
  ['X09 se escribe sin comprobar que el documento es del folio', /if \(String\(doc && doc\.folio\) !== String\(folio\)\) \{/, 'if (false) {'],
  ['X10 se escribe sin credenciales cargadas',           /if \(falta\.length\) return resp\('detener'/, "if (false) return resp('detener'"],
  ['X11 un preparado que no da 200 se manda igual',      /if \(prep\.status !== 200\) return resp\('detener', 'el servidor no preparó/, "if (false) return resp('detener', 'el servidor no preparó"],
  ['X12 una descarga cortada se toma por buena',          /if \(prep\.falloCuerpo\) return resp\('detener'/, "if (false) return resp('detener'"],
  ['X13 el preparado no se revisa antes de mandarlo',     /if \(!rev\.ok\) return resp\('detener', 'el documento preparado no sirve: '/, "if (false) return resp('detener', 'el documento preparado no sirve: '"],
  ['X14 un folio duplicado en el histórico se escribe',   /if \(filas\.length > 1\) return \{ id: null, motivo: 'el folio cae en '/, "if (false) return { id: null, motivo: 'el folio cae en '"],
  ['X15 el api escribe con el usuario de lectura',        /username: process\.env\.REDLINK_M3LINK_USER,/, 'username: process.env.REDLINK_USER,'],
  ['X15b el token va sin el scope openid',               /scope: 'openid'\n  \}\);/, "scope: ''\n  });"],
  ['X16 las credenciales exigidas son las de lectura',    /const CLAVES = \['REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'\];/, "const CLAVES = ['REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS'];"],
  ['X17 el nombre de usuario entra crudo a la URL',       /function rutaDeUsuario\(nombre\) \{ return N\.rutaDeUsuario\(nombre\); \}/, "function rutaDeUsuario(nombre) { return '/api/User/nombreusuario/' + nombre; }"],
  ['X20 la función no mira los roles',                    /if \(!q\.roles\.some\(r => ROLES\.indexOf\(r\) >= 0\)\) \{/, 'if (false) {'],
  ['X21 cualquier autenticado puede confirmar',           /const ROLES = \['admin', 'logistica', 'jefatura'\];/, "const ROLES = ['admin', 'logistica', 'jefatura', 'authenticated'];"],
  ['X22 un principal corrupto se toma por válido',        /catch \(e\) \{ return \{ nombre: '', roles: \[\] \}; \}/, "catch (e) { return { nombre: '', roles: ['admin'] }; }"],
  ['X23 folio y cantidad no se validan',                  /if \(!folio \|\| !cantidad\) \{/, 'if (false) {'],
  ['X24 un decimal pasa como cantidad',                   /return Number\.isInteger\(n\) && n > 0 \? n : null;/, 'return n > 0 ? n : null;'],
  ['X25 un cero pasa como folio',                         /return Number\.isInteger\(n\) && n > 0 \? n : null;/, 'return Number.isInteger(n) ? n : null;'],
  ['X26 no se registra quién lo pidió',                   /context\.log\('confirmar-walmart: ' \+ q\.nombre/, "context.log('confirmar-walmart: ' + ''"],
  ['X27 el preflight escribe',                            /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, ''],
  ['X28 el detalle del error se le manda al navegador',   /dice: 'la confirmación falló antes de completarse; revisar el log de la función'/, "dice: String((e && e.message) || e)"]
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    let fuente = FUENTE, fuenteF = FUENTE_F;
    if (busca.test(FUENTE)) {
      const m = FUENTE.replace(busca, pone);
      if (m === FUENTE) { noAplican.push(nombre); continue; }
      fuente = m;
    } else if (busca.test(FUENTE_F)) {
      const m = FUENTE_F.replace(busca, pone);
      if (m === FUENTE_F) { noAplican.push(nombre); continue; }
      fuenteF = m;
    } else { noAplican.push(nombre); continue; }
    let r;
    try {
      const S = compilar(RUTA, fuente);
      r = await correr(S, fabrica(fuenteF, S));
    } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

// La función HTTP requiere el módulo de escritura: se intercepta para que
// reciba el mutado, y para que use el servidor de mentira en vez de la red.
function compilarFuncion(fuente, escrituraMutada, opcionesServidor) {
  const m = new Module(RUTA_F, null);
  m.filename = RUTA_F;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA_F));
  const propio = Module.prototype.require.bind(m);
  m.require = function (pedido) {
    if (/confirmar-escritura\.js$/.test(pedido)) {
      const s = servidor(opcionesServidor);
      return Object.assign({}, escrituraMutada, {
        confirmarUna: (folio, cantidad, o) => escrituraMutada.confirmarUna(folio, cantidad,
          Object.assign({}, o, { pedir: s.pedir }))
      });
    }
    return propio(pedido);
  };
  m._compile(fuente, RUTA_F);
  return m.exports;
}
const fabrica = (fuenteF, S) => (op) => compilarFuncion(fuenteF, S, op);

(async function () {
  // Las credenciales NO se cargan globalmente: cada prueba que las necesita las
  // pone y las saca. Si estuvieran puestas todo el tiempo, la prueba de "sin
  // credenciales no escribe" pasaría por el camino equivocado y no probaría nada.
  const S = compilar(RUTA, FUENTE);
  const r = await correr(S, fabrica(FUENTE_F, S));
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
