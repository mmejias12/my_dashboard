#!/usr/bin/env node
// ============================================================================
//  scripts/test-pf-endpoint.js
//
//  Pruebas de api/pf-relocalizacion y de api/shared/pf-llaves.js, con arnés de
//  mutaciones. La escritura se sustituye: acá se prueba el portero.
//
//  Lo que protegen: esta ruta es ANÓNIMA para Entra, porque PF es una máquina.
//  El único permiso que existe es la clave de API. Si el portero cede, cualquiera
//  crea relocalizaciones a nombre de PF.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA_F = path.join(__dirname, '..', 'api', 'pf-relocalizacion', 'index.js');
const RUTA_L = path.join(__dirname, '..', 'api', 'shared', 'pf-llaves.js');
const FUENTE_F = fs.readFileSync(RUTA_F, 'utf8');
const FUENTE_L = fs.readFileSync(RUTA_L, 'utf8');

const CLAVE = 'k'.repeat(40);
const OTRA  = 'j'.repeat(40);
const ENV = JSON.stringify([{ clave: CLAVE, bpId: 499, usuarioIngresoId: 740, nombre: 'PF' }]);

let LLAMADAS = [], RESPUESTA = null, REVIENTA = false, FALTAN = [];

function compilarL(fuente) {
  const m = new Module(RUTA_L, null);
  m.filename = RUTA_L;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA_L));
  m._compile(fuente, RUTA_L);
  return m.exports;
}
function compilarF(fuenteF, fuenteL) {
  const m = new Module(RUTA_F, null);
  m.filename = RUTA_F;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA_F));
  const propio = Module.prototype.require.bind(m);
  m.require = function (p) {
    if (/pf-llaves\.js$/.test(p)) return compilarL(fuenteL || FUENTE_L);
    if (/pf-escritura\.js$/.test(p)) return {
      faltantes: () => FALTAN,
      procesar: async function (cuerpo, identidad) {
        LLAMADAS.push({ cuerpo, identidad });
        if (REVIENTA) throw new Error('DETALLE-INTERNO-QUE-NO-DEBE-SALIR');
        return RESPUESTA || { http: 201, estado: 'creada', nroPedido: 4141185, docId: 684034 };
      }
    };
    return propio(p);
  };
  m._compile(fuenteF, RUTA_F);
  return m.exports;
}

let ok = 0, fallos = [];
const pend = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function pruebaAsync(n, fn) { pend.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }

const ctx = () => { const c = { log: function () {} }; c.log.warn = function () {}; c.log.error = function () {}; return c; };
const CUERPO = { OperacionId: 5, ServicioId: 19, BodegaOrigenId: 1537, BodegaDestinoId: 1550,
                 DocumentoId: 1, DocumentoNumero: 45285, Cantidad: 24 };

async function pedir(F, headers, body, metodo) {
  const c = ctx();
  await F(c, { method: metodo || 'POST', headers: headers || {}, body: body === undefined ? CUERPO : body });
  return c.res;
}

async function correr(S, L, fuenteL) {
  const FL = fuenteL || FUENTE_L;
  ok = 0; fallos = []; pend.length = 0;
  LLAMADAS = []; RESPUESTA = null; REVIENTA = false; FALTAN = [];
  process.env.PF_CLAVES = ENV;

  /* ── el portero ──────────────────────────────────────────────────────── */

  pruebaAsync('P01 con la clave correcta pasa y devuelve el folio', async function () {
    const r = await pedir(S, { 'x-api-key': CLAVE });
    igual([r.status, r.body.estado, r.body.nroPedido], [201, 'creada', 4141185]);
    igual(LLAMADAS[0].identidad, { bpId: 499, usuarioIngresoId: 740, nombre: 'PF' },
          'la identidad sale de la clave, no del cuerpo');
  });

  pruebaAsync('P02 sin clave no entra, y no se llama a Redlink', async function () {
    for (const h of [{}, { 'x-api-key': '' }, { 'x-api-key': OTRA }, { authorization: 'Bearer ' + OTRA }]) {
      LLAMADAS = [];
      const r = await pedir(S, h);
      igual(r.status, 401, 'con ' + JSON.stringify(h));
      igual(LLAMADAS.length, 0, 'no puede tocar Redlink');
    }
  });

  pruebaAsync('P03 el 401 no dice POR QUÉ falló', async function () {
    // "la clave existe pero venció" ayudaría a adivinar.
    const r = await pedir(S, { 'x-api-key': OTRA });
    const t = JSON.stringify(r.body);
    falso(/venc|existe|larg|corto/i.test(t), t);
  });

  pruebaAsync('P04 la clave también se acepta como Bearer', async function () {
    const r = await pedir(S, { authorization: 'Bearer ' + CLAVE });
    igual(r.status, 201);
  });

  pruebaAsync('P05 la clave NO viaja de vuelta en ninguna respuesta', async function () {
    for (const h of [{ 'x-api-key': CLAVE }, { 'x-api-key': OTRA }]) {
      const r = await pedir(S, h);
      falso(JSON.stringify(r.body).indexOf(CLAVE) >= 0, 'se filtró la clave');
      falso(JSON.stringify(r.body).indexOf(OTRA) >= 0, 'se filtró la clave probada');
    }
  });

  /* ── el cuerpo ───────────────────────────────────────────────────────── */

  pruebaAsync('P06 sólo POST', async function () {
    igual((await pedir(S, { 'x-api-key': CLAVE }, undefined, 'GET')).status, 405);
    igual((await pedir(S, {}, undefined, 'OPTIONS')).status, 204, 'OPTIONS no pide clave');
  });

  pruebaAsync('P07 un cuerpo que no es objeto se rechaza antes de todo', async function () {
    for (const b of [null, 'texto', [1, 2], 5]) {
      LLAMADAS = [];
      const r = await pedir(S, { 'x-api-key': CLAVE }, b);
      igual(r.status, 400, 'con ' + JSON.stringify(b));
      igual(LLAMADAS.length, 0);
    }
  });

  pruebaAsync('P08 un cuerpo gigante se corta por tamaño', async function () {
    LLAMADAS = [];
    const r = await pedir(S, { 'x-api-key': CLAVE, 'content-length': String(S.MAX_CUERPO + 1) });
    igual(r.status, 413);
    igual(LLAMADAS.length, 0);
  });

  pruebaAsync('P09 sin credenciales contra Redlink se avisa, no se intenta', async function () {
    FALTAN = ['PF_REDLINK_USER'];
    try {
      LLAMADAS = [];
      const r = await pedir(S, { 'x-api-key': CLAVE });
      igual(r.status, 503);
      igual(LLAMADAS.length, 0);
      falso(/PF_REDLINK_USER/.test(JSON.stringify(r.body)), 'no se nombran las variables al cliente');
    } finally { FALTAN = []; }
  });

  /* ── respuestas ──────────────────────────────────────────────────────── */

  pruebaAsync('P10 el http del núcleo se respeta y no viaja dentro del cuerpo', async function () {
    for (const e of [{ http: 200, estado: 'ya-existia', nroPedido: 1, repetido: true },
                     { http: 409, estado: 'conflicto', dice: 'x' },
                     { http: 503, estado: 'en-duda', dice: 'y' },
                     { http: 400, estado: 'rechazado', problemas: ['z'] }]) {
      RESPUESTA = e;
      const r = await pedir(S, { 'x-api-key': CLAVE });
      igual(r.status, e.http, 'con ' + e.estado);
      igual(r.body.estado, e.estado);
      falso('http' in r.body, 'el http no se repite adentro del cuerpo');
    }
    RESPUESTA = null;
  });

  pruebaAsync('P11 un error inesperado no filtra el detalle', async function () {
    REVIENTA = true;
    try {
      const r = await pedir(S, { 'x-api-key': CLAVE });
      igual(r.status, 500);
      falso(/DETALLE-INTERNO/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
      cierto(/revisar el log/.test(r.body.dice), r.body.dice);
    } finally { REVIENTA = false; }
  });

  /* ── las llaves ──────────────────────────────────────────────────────── */

  prueba('P12 una clave corta no se acepta ni configurada', function () {
    const env = { PF_CLAVES: JSON.stringify([{ clave: 'abc', bpId: 499, usuarioIngresoId: 740 }]) };
    igual(L.configuradas(env), [], 'no entra al listado');
    igual(L.identificar('abc', env), null);
  });

  prueba('P13 una configuración incompleta se descarta entera', function () {
    [[{ clave: 'k'.repeat(30), bpId: 0, usuarioIngresoId: 740 }],
     [{ clave: 'k'.repeat(30), bpId: 499 }],
     [{ bpId: 499, usuarioIngresoId: 740 }]].forEach(function (lista) {
      igual(L.configuradas({ PF_CLAVES: JSON.stringify(lista) }), [], JSON.stringify(lista));
    });
  });

  prueba('P14 un PF_CLAVES roto no tumba nada: simplemente no hay claves', function () {
    igual(L.configuradas({ PF_CLAVES: 'no soy json' }), []);
    igual(L.configuradas({ PF_CLAVES: '{"a":1}' }), []);
    igual(L.configuradas({}), []);
  });

  prueba('P15 dos clientes con claves distintas no se confunden', function () {
    const env = { PF_CLAVES: JSON.stringify([
      { clave: 'a'.repeat(30), bpId: 499, usuarioIngresoId: 740, nombre: 'PF' },
      { clave: 'b'.repeat(30), bpId: 500, usuarioIngresoId: 741, nombre: 'OTRO' }]) };
    igual(L.identificar('a'.repeat(30), env).bpId, 499);
    igual(L.identificar('b'.repeat(30), env).bpId, 500);
  });

  prueba('P16 la comparación no se hace con ===', function () {
    // Es una propiedad de TIEMPO, no de resultado: comparar con === da la misma
    // respuesta pero filtra, por lo que tarda, en qué carácter dejó de coincidir.
    // Por eso se mira el código y no la salida.
    cierto(/timingSafeEqual/.test(FL), 'tiene que usar timingSafeEqual');
    falso(/===\s*String\(b\)/.test(FL), 'no puede comparar las claves con ===');
    cierto(L.comparar('abc', 'abc'));
    falso(L.comparar('abc', 'abd'));
    falso(L.comparar('abc', 'abcd'), 'ni con largos distintos');
  });

  prueba('P17 la clave no se acepta por query string', function () {
    // Ahí quedaría en los registros del servidor y en el historial del navegador.
    igual(L.claveDe({ headers: {}, query: { clave: CLAVE, apikey: CLAVE } }), '');
    falso(/req\.query/.test(FL), 'pf-llaves no debe mirar la query');
  });

  prueba('P17b el recorrido de claves no se corta al primer acierto', function () {
    // También es de tiempo: cortar haría que la respuesta tarde distinto según
    // en qué posición de la lista esté la clave, y eso se puede medir.
    falso(/break;/.test(FL), 'no puede haber un break en la búsqueda de la clave');
    cierto(/lista\.forEach/.test(FL), 'se recorre entera');
  });

  prueba('P18 la cabecera se lee sin importar las mayúsculas', function () {
    igual(L.claveDe({ headers: { 'X-API-Key': ' k ' } }), 'k');
    igual(L.claveDe({ headers: { 'x-api-key': 'k' } }), 'k');
  });

  for (const [n, fn] of pend) {
    try { await fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok, fallos };
}

const MUT_F = [
  ['F01 cualquiera entra sin clave',       /if \(!identidad\) \{[\s\S]*?\n  \}/, ''],
  ['F02 se acepta cualquier método',       /if \(req\.method !== 'POST'\) \{[\s\S]*?\n  \}/, ''],
  ['F03 el cuerpo no se valida',           /if \(!req\.body \|\| typeof req\.body !== 'object' \|\| Array\.isArray\(req\.body\)\) \{[\s\S]*?\n  \}/, ''],
  ['F04 una lista cuenta como objeto',     /\|\| Array\.isArray\(req\.body\)/, ''],
  ['F05 no hay tope de tamaño',            /if \(tamanoDe\(req\) > MAX_CUERPO\) \{[\s\S]*?\n  \}/, ''],
  ['F06 sin credenciales se intenta igual', /if \(falta\.length\) \{[\s\S]*?\n  \}/, ''],
  ['F07 las variables faltantes se le dicen al cliente', /dice: 'el servicio no tiene cargadas sus credenciales contra Redlink' \}\);/, "dice: 'faltan ' + falta.join(', ') });"],
  ['F08 el http del núcleo se ignora',     /return salir\(r\.http, cuerpo\);/, 'return salir(200, cuerpo);'],
  ['F09 el http se filtra dentro del cuerpo', /delete cuerpo\.http;/, ''],
  ['F10 el detalle del error se filtra',   /dice: 'la solicitud falló de forma inesperada; revisar el log de la función' \}\);/, 'dice: String((e && e.message) || e) });'],
  ['F11 el 401 explica por qué',           /dice: 'clave de API no reconocida' \}\);/, "dice: 'clave de API no reconocida o vencida: largo ' + llaves.claveDe(req).length });"],
  ['F12 OPTIONS exige clave',              /if \(req\.method === 'OPTIONS'\) return salir\(204, ''\);/, '']
];
const MUT_L = [
  // L01 ("se aceptan claves cortas" en identificar) se RETIRÓ: era equivalente.
  // configuradas() ya descarta las claves de menos de 24, así que una corta no
  // está en la lista y identificar devuelve null igual. El chequeo se deja como
  // defensa en profundidad; lo que de verdad cuida el piso es L02.
  ['L02 se configuran claves cortas',      /typeof x\.clave === 'string' && x\.clave\.length >= 24/, "typeof x.clave === 'string'"],
  ['L03 se acepta una entrada sin cliente', /Number\(x\.bpId\) > 0 && Number\(x\.usuarioIngresoId\) > 0/, 'true'],
  ['L04 la comparación es con ===',        /return crypto\.timingSafeEqual\(hx, hy\);/, 'return String(a) === String(b);'],
  ['L05 se corta al primer acierto',       /lista\.forEach\(function \(x\) \{ if \(comparar\(x\.clave, c\)\) hallada = x; \}\);/, 'for (const x of lista) { if (comparar(x.clave, c)) { hallada = x; break; } }'],
  ['L06 un PF_CLAVES roto revienta',       /try \{ lista = JSON\.parse\(crudo\); \} catch \(e\) \{ return \[\]; \}/, 'lista = JSON.parse(crudo);'],
  ['L07 un PF_CLAVES que no es lista pasa', /if \(!Array\.isArray\(lista\)\) return \[\];/, ''],
  ['L08 la clave se lee de la query',      /const propia = get\('x-api-key'\);/, "const propia = get('x-api-key') || ((req && req.query) || {}).clave;"],
  ['L09 el Bearer no se reconoce',         /const m = auth\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\);/, 'const m = null;'],
  ['L10 la cabecera no se recorta',        /return String\(propia\)\.trim\(\);/, 'return String(propia);']
];

async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  const casos = MUT_F.map(x => ['F', x]).concat(MUT_L.map(x => ['L', x]));
  for (const [cual, [nombre, busca, pone]] of casos) {
    const fuente = cual === 'F' ? FUENTE_F : FUENTE_L;
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try {
      r = cual === 'F' ? await correr(compilarF(mutado, FUENTE_L), compilarL(FUENTE_L), FUENTE_L)
                       : await correr(compilarF(FUENTE_F, mutado), compilarL(mutado), mutado);
    } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: casos.length };
}

(async function () {
  const r = await correr(compilarF(FUENTE_F, FUENTE_L), compilarL(FUENTE_L), FUENTE_L);
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
