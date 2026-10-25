// ============================================================================
//  backfill/sonda-sap-bin.js  ·  M3DATA · ¿el movimiento por UBICACION viaja
//  por el Service Layer?
//
//  DE DONDE VIENE. El 23-10-2026 quedo probado que la cantidad de
//  SERV-DIAS-PALLET es la suma del saldo diario por cliente sobre los siete
//  dias de la semana de servicio: 346 de 807 celdas calzan EXACTO al
//  pallet-dia, trece clientes calzan sus quince semanas enteras y el agregado
//  cuadra al 99,55%. Ese saldo se leyo de WAVE, o sea de un tercero.
//
//  sonda-sap-tabla.js probo que HX_BINPALLETS no sale por el Service Layer: el
//  servidor contesta "Service Not Found" y UserTablesMD no la lista. No es una
//  tabla de usuario de B1.
//
//  PERO EL SONDEO DE HANA DEL 20-10 YA HABIA RESPONDIDO LO IMPORTANTE:
//  HX_BINPALLETS es una VISTA sobre tablas ESTANDAR de SAP —
//      ILM1 + OBIN + OBTL + OBTN + OITM + OSRN
//  y las @HX son solo configuracion (la mayor, @HX_SYNC, tiene 606 filas). O
//  sea el portal no guarda un dato propio: arma una vista comoda sobre datos
//  que ya son de REDTEC. No hace falta la vista; hacen falta sus insumos.
//
//  LO QUE ESTA SONDA PREGUNTA, que es lo unico que falta para decidir:
//    1. OBIN sale por el Service Layer como BinLocations —aparecio entre los
//       335 conjuntos y yo lo descarte como ruido en la primera corrida—.
//       ¿Que trae, y alcanza para saber de QUE CLIENTE es cada ubicacion?
//    2. El MOVIMIENTO por ubicacion no es una entidad suelta: en B1 viaja
//       DENTRO de las lineas del documento, en una coleccion anidada de
//       asignaciones por ubicacion. Si esta ahi, backfill-sap.js ya se la esta
//       trayendo y la esta TIRANDO en la proyeccion, porque LIN no la incluye
//       y aplanar() no baja a las colecciones anidadas.
//
//  La diferencia entre las dos respuestas decide el camino: si el movimiento
//  por ubicacion viaja en los documentos, el arriendo se extrae con lo que ya
//  tenemos. Si no, hay que ir por SQL sobre HANA, y eso es otra conversacion
//  —y otro puerto, que no esta dicho que llegue—.
//
//  ─── RESULTADO MEDIDO · 23-oct-2026 · CLPRDREDTEC ──────────────────────────
//  CERRADO. El dato SI sale de SAP y la forma quedo determinada:
//    · CLIENTES tiene gestion por ubicaciones (paso 0).
//    · StockTransfers DocEntry 35058202 -> en la lista: 0 asignaciones,
//      por clave: 2. O sea el Service Layer entrega la coleccion SOLO cuando se
//      pide el documento por su clave.
//    · La asignacion trae lo que hace falta y nada menos:
//        {BinAbsEntry:5271, Quantity:4, BinActionType:'batFromWarehouse', BaseLineNumber:0}
//        {BinAbsEntry:5275, Quantity:4, BinActionType:'batToWarehouse',   BaseLineNumber:0}
//      ubicacion, cantidad y SENTIDO: es el delta_qty de hx_binpallets.
//    · $expand ESTA DESCARTADO, con las palabras del servidor y en las dos
//      versiones:  v1 "Cannot expand invalid navigation property
//      'StockTransferLines/StockTransferLinesBinAllocations'" y v2 "Cannot
//      expand invalid navigation property 'StockTransferLines'". Las LINEAS de
//      un documento de B1 no son una propiedad de navegacion, asi que el
//      expand no puede funcionar ni con la sintaxis de OData v4.
//      NO VOLVER A INTENTARLO.
//  CONSECUENCIA: el extractor necesita DOS FASES —lista para descubrir los
//  DocEntry, despues uno por uno con concurrencia, como backfill-historial.js—.
//  Medido ahi: 162.075 pedidos a concurrencia 8 en 177 min, o sea ~916/min.
//
//  QUEDA UNA PIEZA SIN MEDIR: de BinAbsEntry al CLIENTE. Las vistas del portal
//  juntan OBIN con CRD1 (las direcciones del socio de negocio).
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//  Credenciales SOLO por entorno:  SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-sap-bin.js
//    node backfill/sonda-sap-bin.js --entidades=StockTransfers --crudo
//    node backfill/sonda-sap-bin.js --bodega=RT13-100
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');

const args = process.argv.slice(2);
const OPCIONES = ['entidades', 'docs', 'bodega'];
const BANDERAS = ['crudo'];
const opcion = (n, d) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const estaPresente = n => args.some(a => a === '--' + n || a.startsWith('--' + n + '='));

const ENTIDADES_BIN = ['StockTransfers', 'InventoryGenEntries', 'InventoryGenExits'];
const RE_BIN = /bin|ubicac/i;

// ── lo puro ─────────────────────────────────────────────────────────────────

/** Las propiedades de un objeto que son COLECCIONES. Es lo que la proyeccion
 *  de backfill-sap.js no mira: soloPresentes() copia escalares y camposUsuario()
 *  descarta a proposito todo lo que no sea escalar, asi que una coleccion
 *  anidada pasa por ahi sin dejar rastro. */
function coleccionesAnidadas(obj) {
  const out = [];
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (Array.isArray(v)) out.push({ clave: k, n: v.length });
  }
  return out.sort((a, b) => a.clave.localeCompare(b.clave));
}

/** Cuales de esas colecciones son de ubicaciones. Se decide por el NOMBRE y se
 *  dice asi: es una heuristica, no una lectura del modelo de datos. */
function coleccionesDeBin(cols) {
  return (cols || []).filter(c => RE_BIN.test(c.clave));
}

/** Las claves de una fila de asignacion por ubicacion, separadas en las que
 *  sirven para reconstruir el saldo y el resto. Sin cantidad y sin ubicacion
 *  la coleccion existe y no alcanza, que es un resultado distinto de que no
 *  exista. */
function utilesDeBin(fila) {
  const k = Object.keys(fila || {});
  const cantidad = k.filter(x => /quantity|cantidad/i.test(x));
  const ubicacion = k.filter(x => /bin(abs|code|entry)?$/i.test(x) || /^BinAbs/i.test(x));
  return { claves: k, cantidad, ubicacion, sirve: cantidad.length > 0 && ubicacion.length > 0 };
}

/** Si una bodega tiene gestion por ubicaciones. Sin eso las lineas no llevan
 *  asignacion y la coleccion vacia no prueba nada: es lo esperado. El nombre
 *  del campo cambia entre versiones, asi que se aceptan los dos. */
function binHabilitado(wh) {
  const v = wh && (wh.EnableBinLocations != null ? wh.EnableBinLocations : wh.BinLocationsEnabled);
  if (v == null) return null;
  return v === true || v === 'tYES' || v === 'Y' || v === 1;
}

/** Cuantas asignaciones por ubicacion trae un documento entero, sumando todas
 *  sus lineas. Es el numero que se compara entre las dos formas de pedirlo. */
function totalBin(doc, claveLineas) {
  const lineas = (doc && claveLineas && doc[claveLineas]) || [];
  let filas = 0, con = 0;
  for (const l of lineas) {
    for (const c of coleccionesDeBin(coleccionesAnidadas(l))) { filas += c.n; if (c.n) con++; }
  }
  return { lineas: lineas.length, filas, lineasConBin: con };
}

/** LA TRAMPA QUE ESTA SONDA EXISTE PARA CAZAR. El Service Layer no devuelve lo
 *  mismo cuando se pide una LISTA (/StockTransfers?$top=3) que cuando se pide
 *  UN documento por su clave (/StockTransfers(695032)): en la lista las
 *  colecciones hijas pueden venir vacias para aligerar la respuesta. Si uno
 *  mira solo la lista concluye que el dato no existe, y existe.
 *
 *  La diferencia no es un detalle tecnico: si el dato solo viene por clave, el
 *  extractor necesita UNA peticion POR DOCUMENTO en vez de paginas de 200, y
 *  eso cambia el costo de la extraccion en dos ordenes de magnitud. */
function compararFormas(porLista, porClave) {
  const a = porLista || { filas: 0 }, b = porClave || { filas: 0 };
  if (a.filas > 0) return { veredicto: 'la lista ya lo trae', lista: a.filas, clave: b.filas };
  if (b.filas > 0) return { veredicto: 'SOLO por clave', lista: a.filas, clave: b.filas };
  return { veredicto: 'vacio en las dos formas', lista: a.filas, clave: b.filas };
}

/** La url que pide la lista TRAYENDO las colecciones hijas. Es el tercer
 *  camino y el que decide el costo: si $expand funciona, la extraccion vuelve
 *  a ser paginas de 200 en vez de una peticion por documento.
 *
 *  El encabezado de backfill-sap.js ya advierte que el $select ANIDADO dentro
 *  de un $expand no es confiable en el OData viejo de B1. Por eso aca se pide
 *  el expand PELADO, sin $select adentro: es la forma que mas chance tiene de
 *  responder, y si igual falla se sabra por el status y no por una suposicion. */
function urlExpand(raiz, entidad, claveLineas, claveBin, top) {
  if (!raiz || !entidad || !claveLineas || !claveBin) return null;
  return raiz + '/' + entidad + '?$top=' + (top || 2) +
         '&$orderby=' + encodeURIComponent('DocEntry desc') +
         '&$expand=' + encodeURIComponent(claveLineas + '/' + claveBin);
}

/** La raiz en la version 2 del Service Layer. backfill-sap.js reescribe el
 *  Login a /b1s/v1 a proposito —ahi vive el OData v3 que ya conocemos— pero el
 *  servidor publica las dos, y la v2 habla OData v4. */
function raizV2(raiz) {
  const r = String(raiz || '');
  if (!r) return null;
  return /\/b1s\/v\d+$/.test(r) ? r.replace(/\/b1s\/v\d+$/, '/b1s/v2') : null;
}

/** El expand ANIDADO, que es sintaxis de OData v4 y por eso no se le puede
 *  pedir a la v1. La v1 contesta "Cannot expand invalid navigation property"
 *  porque en v3 el expand no se encadena con barra.
 *
 *  Por que importa tanto: si la v2 lo acepta, una pagina de 200 documentos
 *  trae sus asignaciones y la extraccion cuesta lo mismo que hoy. Si no, hay
 *  que pedir documento por documento y son dos ordenes de magnitud mas. */
function urlExpandAnidado(raiz, entidad, claveLineas, claveBin, top) {
  const r2 = raizV2(raiz);
  if (!r2 || !entidad || !claveLineas || !claveBin) return null;
  return r2 + '/' + entidad + '?$top=' + (top || 2) +
         '&$orderby=' + encodeURIComponent('DocEntry desc') +
         '&$expand=' + encodeURIComponent(claveLineas + '($expand=' + claveBin + ')');
}

/** El veredicto. Tres respuestas distintas y cada una lleva a otra parte:
 *  la coleccion esta y sirve -> se extrae con lo que ya tenemos;
 *  esta y viene vacia -> la gestion por ubicaciones no se usa en ese documento;
 *  no esta -> el Service Layer no entrega el movimiento por ubicacion. */
function veredictoBin(hallazgos) {
  const h = hallazgos || [];
  if (!h.length) return { nivel: 'sin datos', texto: 'No se pudo leer ningun documento.' };
  const sirven = h.filter(x => x.sirve);
  if (sirven.length) return { nivel: 'si', entidades: sirven.map(x => x.entidad),
    texto: 'EL MOVIMIENTO POR UBICACION VIAJA EN LOS DOCUMENTOS. backfill-sap.js ya se los ' +
           'trae y la proyeccion los descarta: el arreglo es agregar la coleccion a la ' +
           'proyeccion, no una fuente nueva.' };
  const conExpand = h.filter(x => x.sirveConExpand);
  if (conExpand.length) return { nivel: 'con expand', entidades: conExpand.map(x => x.entidad),
    texto: 'EL DATO VIENE EN LA LISTA SI SE PIDE CON $expand. Es el mejor caso: se extrae ' +
           'paginando como hoy, sin una peticion por documento. Hay que verificar que el ' +
           '$expand no corte la pagina ni pierda lineas antes de confiar en el.' };
  const porClave = h.filter(x => x.sirvePorClave);
  if (porClave.length) return { nivel: 'solo por clave', entidades: porClave.map(x => x.entidad),
    texto: 'EL DATO ESTA, pero solo cuando se pide el documento POR SU CLAVE: en la lista las ' +
           'colecciones hijas vienen vacias. Se puede extraer, y cuesta UNA peticion por ' +
           'documento en vez de paginas de 200. Hay que decir ese costo antes de prometer nada.' };
  const vacias = h.filter(x => x.tieneColeccion);
  if (vacias.length) return { nivel: 'vacia', entidades: vacias.map(x => x.entidad),
    texto: 'La coleccion de ubicaciones EXISTE pero vino vacia o sin cantidad. Hay que mirar ' +
           'un documento que si use ubicaciones antes de concluir: una muestra de uno no basta.' };
  return { nivel: 'no', entidades: [],
    texto: 'Los documentos no traen asignacion por ubicacion. El movimiento por ubicacion vive ' +
           'en ILM1/OBTL y esas no son entidades del Service Layer: el camino es SQL sobre HANA.' };
}

module.exports = { coleccionesAnidadas, coleccionesDeBin, utilesDeBin, veredictoBin,
                   binHabilitado, totalBin, compararFormas, urlExpand,
                   raizV2, urlExpandAnidado,
                   ENTIDADES_BIN, RE_BIN, OPCIONES, BANDERAS };

// Mensaje corto del error de B1, para no imprimir el JSON entero en el informe.
function mensajeCorto(body) {
  try {
    const o = typeof body === 'string' ? JSON.parse(body) : body;
    const m = o && o.error && o.error.message;
    return String((m && m.value) || m || '').slice(0, 160);
  } catch (e) { return String(body == null ? '' : body).replace(/\s+/g, ' ').slice(0, 160); }
}

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

  const entidades = String(opcion('entidades', ENTIDADES_BIN.join(','))).split(',').map(s => s.trim()).filter(Boolean);
  const nDocs = Math.max(1, Math.min(10, parseInt(opcion('docs', '3'), 10) || 3));
  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  console.log('Raiz de datos : ' + raiz);
  console.log('Base          : ' + process.env.SAP_DB);
  console.log('SOLO LECTURA.\n');
  const ses = S.crearSesion();
  await ses.login();
  console.log('Login         : OK');

  // ── 0 · ¿la bodega tiene gestion por ubicaciones? ─────────────────────────
  // Sin esto, una coleccion vacia es lo ESPERADO y no prueba nada.
  const bodega = opcion('bodega', 'CLIENTES');
  console.log('\n── 0 · LA BODEGA ' + '─'.repeat(57));
  try {
    const r = await ses.get(raiz + "/Warehouses('" + encodeURIComponent(bodega) + "')");
    const b = binHabilitado(r.json);
    console.log('  ' + bodega + '   HTTP ' + r.status + '   gestion por ubicaciones: ' +
                (b === null ? 'el campo no vino' : (b ? 'SI' : 'NO')));
    if (b === false) console.log('  OJO: sin gestion por ubicaciones la coleccion vacia es lo normal, no un hallazgo.');
  } catch (e) { console.log('  error: ' + e.message); }

  // ── 1 · OBIN por el Service Layer ─────────────────────────────────────────
  console.log('\n── 1 · BinLocations (OBIN) ' + '─'.repeat(47));
  try {
    const r = await ses.get(raiz + '/BinLocations?$top=3');
    console.log('  HTTP ' + r.status);
    const v = (r.json && r.json.value) || [];
    console.log('  filas en la muestra: ' + v.length);
    if (v[0]) {
      console.log('  columnas: ' + Object.keys(v[0]).filter(k => k.indexOf('odata') < 0).join(', '));
      console.log('  primera: ' + JSON.stringify(v[0]).slice(0, 500));
    }
  } catch (e) { console.log('  error: ' + e.message); }

  // ── 2 · el movimiento por ubicacion dentro de los documentos ──────────────
  console.log('\n── 2 · ¿LAS LINEAS TRAEN ASIGNACION POR UBICACION? ' + '─'.repeat(23));
  const hallazgos = [];
  for (const ent of entidades) {
    let r;
    try { r = await ses.get(raiz + '/' + ent + '?$top=' + nDocs + '&$orderby=' + encodeURIComponent('DocEntry desc')); }
    catch (e) { console.log('  ' + ent.padEnd(22) + 'error: ' + e.message); continue; }
    if (r.status !== 200) { console.log('  ' + ent.padEnd(22) + 'HTTP ' + r.status); continue; }
    const docs = (r.json && r.json.value) || [];
    console.log('\n  ' + ent + '   ·  ' + docs.length + ' documento(s)');
    let tieneColeccion = false, sirve = false, ejemplo = null;
    for (const doc of docs) {
      const kl = S.nombreLineas(doc);
      const lineas = kl ? (doc[kl] || []) : [];
      console.log('     DocNum ' + doc.DocNum + '  ' + String(doc.DocDate).slice(0, 10) +
                  '  lineas: ' + lineas.length + ' (en ' + (kl || '(ninguna)') + ')');
      const cc = coleccionesAnidadas(doc).filter(c => c.clave !== kl);
      if (cc.length) console.log('        colecciones de cabecera: ' +
        cc.map(c => c.clave + '[' + c.n + ']').join(', '));
      for (const l of lineas.slice(0, 2)) {
        const col = coleccionesAnidadas(l);
        const bin = coleccionesDeBin(col);
        console.log('        linea ' + l.LineNum + ' · colecciones: ' +
          (col.length ? col.map(c => c.clave + '[' + c.n + ']').join(', ') : '(ninguna)'));
        for (const b of bin) {
          tieneColeccion = true;
          if (!b.n) { console.log('           ' + b.clave + ' esta pero VACIA'); continue; }
          const u = utilesDeBin(l[b.clave][0]);
          if (u.sirve) { sirve = true; if (!ejemplo) ejemplo = l[b.clave][0]; }
          console.log('           ' + b.clave + '[' + b.n + ']  cantidad: ' +
            (u.cantidad.join('/') || 'NO') + '   ubicacion: ' + (u.ubicacion.join('/') || 'NO') +
            '   ->  ' + (u.sirve ? 'SIRVE' : 'no alcanza'));
          console.log('           claves: ' + u.claves.join(', '));
        }
      }
    }
    // LA COMPARACION QUE DECIDE: el mismo documento pedido por su clave.
    let sirvePorClave = false;
    const primero = docs[0];
    if (primero && primero.DocEntry != null) {
      const kl = S.nombreLineas(primero);
      const porLista = totalBin(primero, kl);
      let porClave = null;
      try {
        const r2 = await ses.get(raiz + '/' + ent + '(' + primero.DocEntry + ')');
        if (r2.status === 200 && r2.json) porClave = totalBin(r2.json, S.nombreLineas(r2.json) || kl);
        else console.log('     por clave: HTTP ' + r2.status);
      } catch (e) { console.log('     por clave: error ' + e.message); }
      if (porClave) {
        const cmp = compararFormas(porLista, porClave);
        console.log('     DocEntry ' + primero.DocEntry + ' · asignaciones por ubicacion  ' +
                    'en la lista: ' + cmp.lista + '   ·  por clave: ' + cmp.clave +
                    '   ->  ' + cmp.veredicto);
        if (cmp.veredicto === 'SOLO por clave') sirvePorClave = true;
      }
      // QUE TRAE la asignacion. Sin ver los campos no se sabe si alcanza para
      // reconstruir el saldo: hace falta la ubicacion, la cantidad y el SENTIDO.
      if (sirvePorClave) {
        try {
          const r3 = await ses.get(raiz + '/' + ent + '(' + primero.DocEntry + ')');
          const kl3 = S.nombreLineas(r3.json);
          for (const l of ((kl3 && r3.json[kl3]) || [])) {
            for (const c of coleccionesDeBin(coleccionesAnidadas(l))) {
              if (!c.n) continue;
              for (const fila of l[c.clave]) console.log('        ' + c.clave + ' -> ' + JSON.stringify(fila));
            }
          }
        } catch (e) { console.log('     no se pudo releer por clave: ' + e.message); }
      }
    }

    // ── el tercer camino: la lista CON $expand ────────────────────────────
    let sirveConExpand = false;
    const klx = primero ? S.nombreLineas(primero) : null;
    const colBin = primero && klx && (primero[klx] || []).length
      ? (coleccionesDeBin(coleccionesAnidadas(primero[klx][0]))[0] || {}).clave : null;
    let formaExpand = null;
    const formas = [
      { que: 'v1 $expand con barra ', url: urlExpand(raiz, ent, klx, colBin, 2) },
      { que: 'v2 $expand anidado   ', url: urlExpandAnidado(raiz, ent, klx, colBin, 2) },
    ];
    for (const f of formas) {
      if (!f.url) continue;
      try {
        const rx = await ses.get(f.url);
        if (rx.status !== 200) {
          console.log('     ' + f.que + ': HTTP ' + rx.status + '   ' +
                      mensajeCorto(rx.json || rx.body));
          continue;
        }
        const dx = (rx.json && rx.json.value) || [];
        let n = 0; for (const d of dx) n += totalBin(d, S.nombreLineas(d) || klx).filas;
        console.log('     ' + f.que + ': ' + dx.length + ' documento(s), ' + n + ' asignacion(es)');
        if (n > 0 && !sirveConExpand) { sirveConExpand = true; formaExpand = f.que.trim(); }
      } catch (e) { console.log('     ' + f.que + ': error ' + e.message); }
    }
    if (formaExpand) console.log('     -> la forma que sirve: ' + formaExpand);
    hallazgos.push({ entidad: ent, tieneColeccion, sirve, sirvePorClave, sirveConExpand });
    if (ejemplo && estaPresente('crudo')) console.log('     ejemplo: ' + JSON.stringify(ejemplo, null, 2).replace(/\n/g, '\n     '));
  }

  const ver = veredictoBin(hallazgos);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + ver.texto);
  if (ver.entidades && ver.entidades.length) console.log('  entidades: ' + ver.entidades.join(', '));
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
