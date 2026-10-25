// ============================================================================
//  backfill/sonda-sap-ubicacion.js  ·  M3DATA · de BinAbsEntry al CLIENTE
//
//  LA ULTIMA INCOGNITA. sonda-sap-bin.js dejo probado que el movimiento del
//  arriendo sale de SAP: la asignacion por ubicacion trae
//      {BinAbsEntry:5271, Quantity:4, BinActionType:'batFromWarehouse'}
//  o sea ubicacion, cantidad y sentido. Lo que falta es saber DE QUIEN es la
//  ubicacion 5271, porque sin eso el movimiento no se puede atribuir y el
//  saldo por cliente no se puede armar.
//
//  LA PISTA. Las vistas del portal juntan OBIN con CRD1 —las direcciones del
//  socio de negocio— y los nombres de bodega que se ven en los informes del
//  portal ("GOOD FOOD CD", "INTERCOS COLINA", "PF TALCA PLANTA 2") tienen
//  exactamente la forma de una direccion de cliente. La hipotesis es que
//  Sublevel1 de la ubicacion ES el nombre de una direccion del socio.
//  NO SE AFIRMA: se mide el porcentaje de calce y se informa.
//
//  LA PRUEBA DE ACEPTACION YA EXISTE, y es lo que hace que esto valga la pena:
//  con el saldo leido de WAVE, 346 de 807 celdas cliente-semana calzan EXACTO
//  al pallet-dia y trece clientes calzan sus quince semanas. Si la cadena
//  BinAbsEntry -> OBIN -> cliente reproduce esas mismas celdas, el arriendo
//  queda reproducido con fuente propia. Si no las reproduce, el mapa esta mal
//  y se ve de inmediato.
//
//  LA TRAMPA DE LOS ACENTOS, que ya nos mordio una vez. La primera ubicacion
//  que devolvio SAP es 'CLIENTES-UBICACIÓN-DE-SISTEMA', con tilde. El norm()
//  de medir-emisiones.js BORRA los caracteres acentuados en vez de plegarlos
//  —asi 'AZÚCAR' se volvia 'AZCAR' y el cliente no cruzaba con el maestro de
//  tarifas, en silencio—. Aca el plegado se hace bien (NFD y fuera las marcas
//  de combinacion) y hay pruebas que lo fijan.
//
//  ─── RESULTADO MEDIDO · 23-oct-2026 · CLPRDREDTEC / bodega CLIENTES ────────
//  EL MAPA CIERRA: 538 de 539 ubicaciones atribuidas, 99,8%.
//    · El campo es Description, y ningun otro: BinCode, Sublevel1, Sublevel2 y
//      AlternativeSortCode calzan 0 o 5 de 545.
//    · 515 se atribuyen por su propio nombre y 23 mas por el grupo.
//    · Queda UNA sin atribuir, del grupo LESAFFRE.
//    · El denominador saca las 145 ubicaciones de 68 grupos cuyos clientes NO
//      facturan arriendo (ACMARCA, HENKEL, POLPAICO, ESSITY, IFCO...). Tienen
//      pallets y no pagan dias-pallet: es una pregunta para comercial, no un
//      defecto del mapa.
//
//  LO QUE NO ES: Sublevel1 no identifica al cliente. LESAFFRE junta 51
//  ubicaciones de DOS socios, PUNTOAZUL y LAFHAMBURGO de cuatro cada uno. Es
//  nombre de grupo o de marca. Por eso la propagacion es heuristica y en
//  conflicto no propaga —pero conserva lo que calzo por nombre propio.
//
//  POR QUE EL CRUCE TIENE QUE SER POR SOCIO Y NO POR RAZON SOCIAL: las
//  ubicaciones de ILKO CHILE S.A. se llaman VIRUTEX MELIPILLA, VIRUTEX CD
//  PUDAHUEL, VIRUTEX DUKAY LAMPA. Ningun cruce por nombre las encuentra.
//
//  Y el plegado de acentos se pago solo: 'ALIFRUT VINA DEL MAR' (la ubicacion)
//  calzo con 'ALIFRUT VIÑA DEL MAR' (la direccion). Con el norm() que borra
//  acentuados esa ubicacion se perdia sin un solo aviso.
//
//  LA CADENA COMPLETA, toda de SAP y con las credenciales que ya estan:
//    StockTransfers(DocEntry) -> BinAllocations{BinAbsEntry, Quantity, BinActionType}
//                             -> BinLocations(AbsEntry).Description
//                             -> BPAddresses.AddressName -> CardCode
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//  Credenciales SOLO por entorno:  SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-sap-ubicacion.js
//    node backfill/sonda-sap-ubicacion.js --bodega=RETAIL
//    node backfill/sonda-sap-ubicacion.js --clientes=C91004000-6,C91438000-6 --tope=40
//    node backfill/sonda-sap-ubicacion.js --todos     <- los 77 que facturan arriendo
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');

const args = process.argv.slice(2);
const OPCIONES = ['bodega', 'clientes', 'tope', 'pagina', 'grupo'];
const BANDERAS = ['crudo', 'todos'];
const opcion = (n, d) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const estaPresente = n => args.some(a => a === '--' + n || a.startsWith('--' + n + '='));

// Los campos de OBIN donde PODRIA vivir el vinculo con el cliente. Se miden
// todos antes de elegir: elegir primero es como terminamos cruzando por razon
// social cuando el CardCode estaba ahi al lado.
const CAMPOS_VINCULO = ['BinCode', 'Sublevel1', 'Sublevel2', 'Sublevel3', 'Sublevel4',
  'Description', 'AlternativeSortCode', 'BarCode',
  'Attribute1', 'Attribute2', 'Attribute3', 'Attribute4', 'Attribute5',
  'Attribute6', 'Attribute7', 'Attribute8', 'Attribute9', 'Attribute10'];

// Clientes de referencia: los cuatro que medi a mano mas tres de los trece que
// calzaron sus quince semanas enteras.
const CLIENTES_POR_DEFECTO = ['C91004000-6', 'C91438000-6', 'C96847830-3', 'C76039282-0',
                              'C76697659-K', 'C77699829-K', 'C76522630-9'].join(',');

// Los 77 socios que facturan SERV-DIAS-PALLET, medidos el 23-10 sobre la
// cartola. Con --todos la sonda construye el indice completo y recien ahi el
// porcentaje de ubicaciones atribuidas significa algo.
const CLIENTES_ARRIENDO = ('C83610800-0,C77699829-K,C96955730-4,C76479351-K,C77466945-0,C78926220-9,' +
  'C79746250-0,C93513000-K,C76355360-4,C76528110-5,C76697659-K,C77666850-8,C76077572-K,C86379600-8,' +
  'C90727000-9,C76937235-0,C77961510-3,C84650700-0,C84476300-K,C76099789-7,C91438000-6,C76883510-1,' +
  'C90060000-3,C76493368-0,C81094100-6,C95293000-1,C76121450-0,C77930715-8,C76085332-1,C79862750-3,' +
  'C96847830-3,C969299607,C85833700-3,C85417200-K,C76039282-0,C81852700-4,C90703000-8,C76130385-6,' +
  'C76105584-4,C91004000-6,C76773020-9,C96840350-8,C92956000-0,C76530620-5,C77784563-2,C81860100-K,' +
  'C76541630-2,C76522630-9,C76871186-0,C76072046-1,C76090492-9,C76178838-8,C96557910-9,C96665460-0,' +
  'C76579112-K,C90889000-0,C76487452-8,C90823000-0,C76316386-5,C76549892-9,C76200574-3,C91083000-7,' +
  'C83757200-2,C76524352-1,C76082765-7,C76084413-6,C78382760-3,C78383620-3,C76415269-7,C96529310-8,' +
  'C77278060-5,C92405000-4,C85844100-5,C77316342-1,C96628870-1,C76135736-0,C77517270-3');

// ── lo puro ─────────────────────────────────────────────────────────────────

/** Normaliza un nombre de ubicacion o de direccion para compararlos.
 *
 *  PLIEGA los acentos en vez de borrarlos: 'UBICACIÓN' -> 'UBICACION', no
 *  'UBICACIN'. Es el defecto que encontre en norm() de medir-emisiones.js, que
 *  hacia que 'PAN DE AZÚCAR' no cruzara con el maestro de tarifas sin que nada
 *  avisara. Tambien colapsa guiones y espacios, porque el portal escribe
 *  'PF TALCA PLANTA 2' y la ubicacion 'PF-TALCA-PLANTA-2'. */
function normUbic(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Cuantas ubicaciones tienen cada campo poblado y cuantos valores DISTINTOS
 *  trae. Un campo lleno en las 500 con un solo valor distinto no vincula nada;
 *  uno lleno en las 500 con 56 distintos, con 56 clientes, es la respuesta. */
function poblacionDeCampos(bins, campos) {
  const out = [];
  for (const c of (campos || [])) {
    let llenos = 0;
    const vistos = new Set();
    for (const b of (bins || [])) {
      const v = b && b[c];
      if (v == null || String(v).trim() === '') continue;
      llenos++; vistos.add(String(v).trim());
    }
    out.push({ campo: c, llenos, distintos: vistos.size });
  }
  return out.filter(x => x.llenos > 0).sort((a, b) => b.distintos - a.distintos);
}

/** Los nombres de direccion de un socio de negocio, que es lo que vive en
 *  CRD1. Se devuelven con su tipo porque una direccion de despacho y una de
 *  facturacion no son lo mismo. */
function direccionesDe(bp) {
  const v = (bp && (bp.BPAddresses || bp.bPAddresses)) || [];
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const d of v) {
    const n = d && (d.AddressName || d.AddressName2 || d.Street);
    if (n) out.push({ nombre: String(n), tipo: String((d && d.AddressType) || '') });
  }
  return out;
}

/** Empareja las ubicaciones de una bodega con las direcciones de un cliente,
 *  por el campo que se le indique. Devuelve los calces y lo que sobro de cada
 *  lado: una direccion sin ubicacion y una ubicacion sin direccion son dos
 *  problemas distintos. */
function emparejar(bins, direcciones, campo) {
  const porNombre = new Map();
  for (const d of (direcciones || [])) porNombre.set(normUbic(d.nombre), d);
  const calzan = [], sinDireccion = [];
  const usadas = new Set();
  for (const b of (bins || [])) {
    const k = normUbic(b && b[campo]);
    if (k && porNombre.has(k)) { calzan.push({ bin: b, direccion: porNombre.get(k) }); usadas.add(k); }
    else sinDireccion.push(b);
  }
  const sinBin = [...porNombre.keys()].filter(k => !usadas.has(k)).map(k => porNombre.get(k));
  return { calzan, sinDireccion, sinBin };
}

/** El indice inverso: nombre de direccion -> socios que la tienen. Es lo que
 *  convierte una ubicacion en un cliente.
 *
 *  Informa las COLISIONES aparte. Dos socios con una direccion del mismo
 *  nombre hacen que esa ubicacion sea de los dos, y atribuirla a uno al azar
 *  es inventarse un saldo. Prefiero que salga en el informe. */
function indiceDirecciones(entradas) {
  const idx = new Map();
  for (const e of (entradas || [])) {
    for (const d of (e.dirs || [])) {
      const k = normUbic(d.nombre);
      if (!k) continue;
      const a = idx.get(k) || [];
      if (a.indexOf(e.cod) < 0) a.push(e.cod);
      idx.set(k, a);
    }
  }
  const colisiones = [...idx.entries()].filter(([, v]) => v.length > 1)
    .map(([k, v]) => ({ nombre: k, socios: v }));
  return { indice: idx, colisiones };
}

/** Cuantas ubicaciones quedan atribuidas con ese indice, y las tres formas de
 *  no quedar: sin nombre en el campo, con nombre que no esta en el indice, y
 *  con nombre que esta en DOS socios. Las tres se arreglan distinto. */
function cobertura(bins, indice, campo) {
  let atribuidas = 0;
  const ambiguas = [], sueltas = [], sinCampo = [];
  for (const b of (bins || [])) {
    const k = normUbic(b && b[campo]);
    if (!k) { sinCampo.push(b); continue; }
    const v = indice && indice.get ? indice.get(k) : null;
    if (!v || !v.length) { sueltas.push(b); continue; }
    if (v.length > 1) { ambiguas.push(b); continue; }
    atribuidas++;
  }
  return { atribuidas, ambiguas, sueltas, sinCampo, total: (bins || []).length };
}

/** PROPAGA la atribucion dentro del grupo de ubicaciones de un mismo cliente.
 *
 *  POR QUE. Las ubicaciones vienen numeradas por cliente —ALIFRUT-000 a
 *  ALIFRUT-018— y comparten Sublevel1. Si alguna del grupo calzo con un socio
 *  por su Description, TODAS son de ese socio: la 3614 no calza por su nombre
 *  y es de ALIFRUT igual. Sin esto el saldo de un cliente queda incompleto por
 *  una direccion mal escrita, que es justo lo que no puede pasar al facturar.
 *
 *  Y DONDE FALLA, medido: Sublevel1 NO es estrictamente el cliente. El grupo
 *  LESAFFRE junta 51 ubicaciones de DOS socios, y PUNTOAZUL y LAFHAMBURGO
 *  juntan cuatro cada uno. Es un nombre de grupo o de marca, no una identidad.
 *  Por eso la propagacion es una HEURISTICA y no una regla: cuando el grupo
 *  apunta a varios socios no se propaga, porque repartir pallets ajenos es
 *  peor que no saber. Pero las que calzaron por su propio nombre se conservan:
 *  esas no dependen del grupo. */
function propagarPorGrupo(bins, indice, campoNombre, campoGrupo) {
  const grupos = new Map();
  let sinGrupo = 0;
  for (const b of (bins || [])) {
    const g = normUbic(b && b[campoGrupo]);
    if (!g) { sinGrupo++; continue; }
    const a = grupos.get(g) || [];
    a.push(b); grupos.set(g, a);
  }
  const detalle = [], conflictos = [], sinSocio = [];
  // El MAPA por ubicacion sale de aca y no de una copia de esta regla en el
  // extractor: dos implementaciones de la misma regla es como terminamos con
  // dos listas blancas que divergen.
  const asignacion = new Map();
  let directas = 0, propagadas = 0, sinPropagar = 0;
  for (const [g, lista] of grupos) {
    const socios = new Set();
    const propias = [];
    let conNombre = 0;
    for (const b of lista) {
      const k = normUbic(b && b[campoNombre]);
      const v = k && indice && indice.get ? indice.get(k) : null;
      if (v && v.length === 1) {
        socios.add(v[0]); conNombre++;
        if (b && b.AbsEntry != null) asignacion.set(b.AbsEntry, v[0]);
      } else propias.push(b);
    }
    // LA ATRIBUCION DIRECTA VALE SIEMPRE, pase lo que pase con el grupo.
    // La primera version tiraba el grupo ENTERO cuando estaba en conflicto y
    // se llevaba puestas atribuciones que eran correctas: 515 por nombre
    // bajaron a 462 al "mejorar" con la propagacion. Que una ubicacion vecina
    // apunte a otro socio no invalida a la que calzo con el suyo.
    directas += conNombre;
    const resto = lista.length - conNombre;
    if (socios.size > 1) {
      conflictos.push({ grupo: g, socios: [...socios], bins: lista.length, directas: conNombre });
      sinPropagar += resto;
      continue;
    }
    if (!socios.size) { sinSocio.push({ grupo: g, bins: lista.length }); continue; }
    const unico = [...socios][0];
    for (const b of propias) if (b && b.AbsEntry != null) asignacion.set(b.AbsEntry, unico);
    propagadas += resto;
    detalle.push({ grupo: g, socio: [...socios][0], bins: lista.length, directas: conNombre });
  }
  return { detalle, conflictos, sinSocio, sinGrupo, sinPropagar, asignacion,
           atribuidas: directas + propagadas, directas, propagadas,
           grupos: grupos.size };
}

/** El veredicto del mapa. El umbral se declara ANTES de ver el resultado: con
 *  menos del 80% de las ubicaciones atribuidas el saldo por cliente queda
 *  incompleto y no sirve para facturar. */
function veredictoMapa(resumen) {
  const r = resumen || {};
  const total = r.bins || 0, atribuidos = r.atribuidos || 0;
  const dirs = r.direcciones || 0, conUbic = r.conUbicacion || 0;
  if (!total) return { nivel: 'sin datos', pct: 0, pctDir: 0,
    texto: 'No se leyo ninguna ubicacion: sin eso no hay mapa que medir.' };
  const pct = 100 * atribuidos / total;
  const pctDir = dirs ? 100 * conUbic / dirs : 0;
  // SON DOS PREGUNTAS Y YO LAS HABIA MEZCLADO. "¿el campo vincula?" se responde
  // del lado de las DIRECCIONES: de las que tengo, cuantas encontraron
  // ubicacion. "¿alcanza para facturar?" se responde del lado de las
  // UBICACIONES: de las 684 de la bodega, cuantas quedan atribuidas. Con un
  // indice de 7 clientes el segundo cociente es chico POR CONSTRUCCION y no
  // dice nada; informarlo como veredicto fue un error de diseno mio.
  if (!r.completo) return { nivel: 'piso', pct, pctDir,
    texto: 'EL CAMPO VINCULA: ' + conUbic + ' de ' + dirs + ' direcciones encontraron su ubicacion (' +
           pctDir.toFixed(1) + '%). El ' + pct.toFixed(1) + '% de ubicaciones atribuidas NO es el ' +
           'veredicto: el indice es de unos pocos clientes y las ubicaciones son de todos. ' +
           'Correr con --todos para que ese numero signifique algo.' };
  if (pct >= 80) return { nivel: 'si', pct, pctDir,
    texto: 'EL MAPA CIERRA. La ubicacion se atribuye al cliente por este campo, y el saldo ' +
           'por cliente se puede armar desde SAP. Verificarlo contra las 346 celdas exactas ' +
           'que ya se midieron antes de darlo por bueno.' };
  if (pct > 0) return { nivel: 'parcial', pct, pctDir,
    texto: 'El campo vincula a algunos y no a todos. Un saldo incompleto no sirve para ' +
           'facturar: hay que ver QUE ubicaciones quedan sueltas antes de elegir este camino.' };
  return { nivel: 'no', pct, pctDir,
    texto: 'Este campo no vincula con las direcciones del socio. Mirar la tabla de poblacion ' +
           'del paso 1: el vinculo puede estar en otro campo, o no estar en OBIN.' };
}

module.exports = { normUbic, poblacionDeCampos, direccionesDe, emparejar, veredictoMapa,
                   indiceDirecciones, cobertura, propagarPorGrupo,
                   CAMPOS_VINCULO, CLIENTES_POR_DEFECTO, CLIENTES_ARRIENDO, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = args.filter(x => String(x).startsWith('--') &&
    !OPCIONES.some(o => String(x).startsWith('--' + o + '=')) &&
    !BANDERAS.some(o => x === '--' + o));
  if (malas.length) {
    console.error('Opcion no reconocida: ' + malas.join('  '));
    console.error('Con valor: ' + OPCIONES.map(o => '--' + o + '=').join('  '));
    console.error('Banderas : ' + BANDERAS.map(o => '--' + o).join('  '));
    process.exit(1);
  }
  const faltan = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (faltan.length) { console.error('Faltan variables de entorno: ' + faltan.join(', ')); process.exit(1); }

  const bodega = opcion('bodega', 'CLIENTES');
  const todos = estaPresente('todos');
  const clientes = String(opcion('clientes', todos ? CLIENTES_ARRIENDO : CLIENTES_POR_DEFECTO))
    .split(',').map(s => s.trim()).filter(Boolean);
  const tope = Math.max(5, Math.min(200, parseInt(opcion('tope', '20'), 10) || 20));
  const pagina = Math.max(20, Math.min(500, parseInt(opcion('pagina', '200'), 10) || 200));
  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  console.log('Raiz de datos : ' + raiz);
  console.log('Base          : ' + process.env.SAP_DB);
  console.log('Bodega        : ' + bodega + '   ·  clientes de referencia: ' + clientes.length);
  console.log('SOLO LECTURA.\n');
  const ses = S.crearSesion();
  await ses.login();
  console.log('Login         : OK');

  // ── 1 · todas las ubicaciones de la bodega ────────────────────────────────
  // Se pagina con $skip/$top sobre un orden unico, por lo mismo que en
  // backfill-sap.js: la clave de continuacion cambia de nombre entre dialectos
  // y seguirla fue como truncamos un mes entero en silencio.
  const bins = [];
  const base = raiz + '/BinLocations?$filter=' + encodeURIComponent("Warehouse eq '" + bodega + "'") +
               '&$orderby=' + encodeURIComponent('AbsEntry asc');
  let skip = 0;
  for (;;) {
    const r = await ses.get(base + '&$top=' + pagina + '&$skip=' + skip);
    if (r.status !== 200) {
      console.log('\n  BinLocations HTTP ' + r.status + '  ' + String(r.body == null ? '' : r.body).slice(0, 200));
      break;
    }
    const v = (r.json && r.json.value) || [];
    bins.push.apply(bins, v);
    if (!v.length || v.length < pagina) break;
    skip += v.length;
    if (skip > 100000) { console.log('  OJO: mas de 100.000 ubicaciones, se corta aca.'); break; }
  }
  console.log('\n── 1 · LAS UBICACIONES DE ' + bodega + ' ' + '─'.repeat(Math.max(4, 44 - bodega.length)));
  console.log('  ubicaciones: ' + bins.length);
  if (!bins.length) { console.log('  Sin ubicaciones no hay mapa. ¿La bodega se llama asi?'); return; }
  console.log('\n  ' + 'campo'.padEnd(22) + 'poblados'.padStart(10) + 'distintos'.padStart(11) + '   nota');
  for (const p of poblacionDeCampos(bins, CAMPOS_VINCULO)) {
    const nota = p.distintos === 1 ? 'un solo valor: no vincula nada'
      : p.distintos === bins.length ? 'distinto en cada una'
      : '';
    console.log('  ' + p.campo.padEnd(22) + String(p.llenos).padStart(10) +
                String(p.distintos).padStart(11) + '   ' + nota);
  }
  console.log('\n  primeras ' + Math.min(tope, bins.length) + ' ubicaciones:');
  for (const b of bins.slice(0, tope))
    console.log('     ' + String(b.AbsEntry).padStart(7) + '  ' + String(b.BinCode || '').slice(0, 60).padEnd(62) +
                (b.IsSystemBin === 'tYES' || b.IsSystemBin === true ? '[sistema]' : ''));

  // ── 2 · las direcciones de los clientes de referencia ─────────────────────
  // Por CLAVE, no por lista: la leccion de sonda-sap-bin.js es que las
  // colecciones hijas vienen vacias cuando se piden en una lista.
  console.log('\n── 2 · LAS DIRECCIONES DEL SOCIO (CRD1) ' + '─'.repeat(34));
  const dirsPorCliente = new Map();
  for (const cod of clientes) {
    let r;
    try { r = await ses.get(raiz + "/BusinessPartners('" + encodeURIComponent(cod) + "')"); }
    catch (e) { console.log('  ' + cod.padEnd(14) + 'error: ' + e.message); continue; }
    if (r.status !== 200) { console.log('  ' + cod.padEnd(14) + 'HTTP ' + r.status); continue; }
    const d = direccionesDe(r.json);
    dirsPorCliente.set(cod, { cod, nom: (r.json && r.json.CardName) || cod, dirs: d });
    console.log('  ' + cod.padEnd(14) + String((r.json && r.json.CardName) || '').slice(0, 34).padEnd(36) +
                d.length + ' direccion(es)');
    if (!todos) for (const x of d.slice(0, 6)) console.log('        ' + x.nombre.slice(0, 50).padEnd(52) + x.tipo);
  }

  // ── 3 · el calce, campo por campo ─────────────────────────────────────────
  console.log('\n── 3 · QUE CAMPO VINCULA LA UBICACION CON EL CLIENTE ' + '─'.repeat(21));
  const todas = [];
  for (const { dirs } of dirsPorCliente.values()) todas.push.apply(todas, dirs);
  console.log('  direcciones de referencia: ' + todas.length + '   ·  ubicaciones: ' + bins.length);
  const porCampo = [];
  for (const campo of ['BinCode', 'Sublevel1', 'Sublevel2', 'Description', 'AlternativeSortCode']) {
    const e = emparejar(bins, todas, campo);
    porCampo.push({ campo, calzan: e.calzan.length, sinBin: e.sinBin.length });
    console.log('  ' + campo.padEnd(22) + 'ubicaciones que calzan: ' + String(e.calzan.length).padStart(5) +
                '   ·  direcciones sin ubicacion: ' + e.sinBin.length);
  }
  const mejor = porCampo.slice().sort((a, b) => b.calzan - a.calzan)[0];
  console.log('\n  el campo que mas calza: ' + mejor.campo + '  (' + mejor.calzan + ')');
  const ej = emparejar(bins, todas, mejor.campo);
  for (const c of ej.calzan.slice(0, tope))
    console.log('     ' + String(c.bin.AbsEntry).padStart(7) + '  ' +
                String(c.bin[mejor.campo] || '').slice(0, 44).padEnd(46) + '->  ' + c.direccion.nombre.slice(0, 40));
  if (ej.sinBin.length) {
    console.log('\n  direcciones SIN ubicacion (' + ej.sinBin.length + '), las primeras:');
    for (const d of ej.sinBin.slice(0, 10)) console.log('     ' + d.nombre.slice(0, 60) + '   [' + d.tipo + ']');
  }

  // ── 4 · el indice inverso y la cobertura real ────────────────────────────
  // La ubicacion generica 'CLIENTES-UBICACION-DE-SISTEMA' no es de nadie y no
  // cuenta en el denominador.
  const propias = bins.filter(b => !(b.IsSystemBin === 'tYES' || b.IsSystemBin === true));
  const { indice, colisiones } = indiceDirecciones([...dirsPorCliente.values()]);
  const cob = cobertura(propias, indice, mejor.campo);
  console.log('\n── 4 · DE LA UBICACION AL CLIENTE ' + '─'.repeat(39));
  console.log('  indice: ' + indice.size + ' nombres de direccion de ' + dirsPorCliente.size + ' socios');
  if (colisiones.length) {
    console.log('  OJO: ' + colisiones.length + ' nombre(s) de direccion en MAS DE UN socio. Esas');
    console.log('  ubicaciones no se pueden atribuir sin inventar un saldo:');
    for (const c of colisiones.slice(0, 10)) console.log('     ' + c.nombre + '  ->  ' + c.socios.join(', '));
  } else console.log('  sin colisiones: ningun nombre de direccion esta en dos socios.');
  console.log('  ubicaciones (sin la de sistema): ' + cob.total);
  console.log('     atribuidas a un socio : ' + cob.atribuidas);
  console.log('     ambiguas (dos socios) : ' + cob.ambiguas.length);
  console.log('     sin nombre en el campo: ' + cob.sinCampo.length);
  console.log('     con nombre que no esta en el indice: ' + cob.sueltas.length);
  if (cob.sueltas.length && !todos) {
    console.log('     las primeras, para mirarlas:');
    for (const b of cob.sueltas.slice(0, 8)) console.log('        ' + String(b[mejor.campo] || '').slice(0, 60));
  }

  // ── 5 · propagar dentro del grupo de cada cliente ────────────────────────
  const campoGrupo = opcion('grupo', 'Sublevel1');
  const pr = propagarPorGrupo(propias, indice, mejor.campo, campoGrupo);
  console.log('\n── 5 · PROPAGAR POR ' + campoGrupo + ' ' + '─'.repeat(Math.max(4, 52 - campoGrupo.length)));
  console.log('  Las ubicaciones vienen numeradas por cliente y comparten ' + campoGrupo + ':');
  console.log('  si una del grupo identifica al socio, todas las del grupo son suyas.\n');
  console.log('  grupos: ' + pr.grupos + '   ·  sin ' + campoGrupo + ': ' + pr.sinGrupo);
  console.log('     atribuidas por nombre propio : ' + pr.directas);
  console.log('     atribuidas por el grupo      : ' + pr.propagadas);
  console.log('     TOTAL atribuidas             : ' + pr.atribuidas + ' de ' + propias.length);
  console.log('     grupos con socios EN CONFLICTO: ' + pr.conflictos.length +
              '   (no se propagan: seria repartir pallets ajenos)');
  for (const c of pr.conflictos.slice(0, 10))
    console.log('        ' + c.grupo + '  ->  ' + c.socios.join(', ') + '   (' + c.bins +
                ' ubicaciones, ' + c.directas + ' con nombre propio)');
  console.log('        de esos grupos, ' + pr.sinPropagar + ' ubicaciones quedan sin atribuir');
  console.log('        (las que SI calzaron por su nombre se conservan: no dependen del grupo)');
  const binsSinSocio = pr.sinSocio.reduce((a, x) => a + x.bins, 0);
  console.log('     grupos sin ningun socio del indice: ' + pr.sinSocio.length +
              '   (' + binsSinSocio + ' ubicaciones)');
  console.log('        son clientes que NO facturan arriendo, o que faltan en el indice:');
  for (const g of pr.sinSocio.slice(0, Math.min(tope, 25))) console.log('        ' + g.grupo + '  (' + g.bins + ')');

  // ── el veredicto ──────────────────────────────────────────────────────────
  const ejProp = emparejar(propias, todas, mejor.campo);
  // El denominador honesto son las ubicaciones de los clientes QUE FACTURAN
  // arriendo. Las de un cliente que no esta en el indice no tienen por que
  // atribuirse, y contarlas como falla es el mismo error de denominador de la
  // corrida anterior, una capa mas abajo.
  const delUniverso = propias.length - binsSinSocio;
  const ver = veredictoMapa({ bins: delUniverso, atribuidos: pr.atribuidas,
                              direcciones: todas.length, conUbicacion: ejProp.calzan.length,
                              completo: todos });
  // Las direcciones de FACTURACION no tienen ubicacion y no tienen por que
  // tenerla: se informan aparte para no inflar el numerador ni el denominador.
  const sinUbicFact = ejProp.sinBin.filter(d => /BillTo/i.test(d.tipo || '')).length;
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  del lado de las DIRECCIONES : ' + ejProp.calzan.length + ' de ' + todas.length +
              ' encontraron ubicacion  (' + ver.pctDir.toFixed(1) + '%)');
  console.log('     de las ' + ejProp.sinBin.length + ' que no, ' + sinUbicFact +
              ' son de FACTURACION y no corresponde que tengan ubicacion');
  console.log('  del lado de las UBICACIONES, solo por nombre : ' + cob.atribuidas + ' de ' + propias.length);
  console.log('  del lado de las UBICACIONES, con el grupo    : ' + pr.atribuidas + ' de ' + delUniverso +
              '  (' + ver.pct.toFixed(1) + '%)');
  console.log('     el denominador saca las ' + binsSinSocio + ' ubicaciones de clientes que no facturan arriendo');
  console.log('  ' + ver.texto);
  if (estaPresente('crudo') && bins[0]) console.log('\n  ubicacion cruda: ' + JSON.stringify(bins[0], null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
