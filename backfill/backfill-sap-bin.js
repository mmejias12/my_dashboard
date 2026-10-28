// ============================================================================
//  backfill/backfill-sap-bin.js  ·  M3DATA · el movimiento por UBICACION
//
//  QUE RESUELVE. La cantidad de SERV-DIAS-PALLET —el 27,7% de la cartola— es
//  la suma del saldo diario de cada cliente sobre los siete dias de la semana
//  de servicio. Medido el 23-10 contra WAVE: 346 de 807 celdas calzan EXACTO
//  al pallet-dia, trece clientes calzan sus quince semanas enteras y el
//  agregado de 15 semanas cuadra al 99,55%. Este extractor trae ese saldo
//  desde SAP, para que REDTEC deje de depender de un tercero en el concepto
//  mas grande que factura.
//
//  LA CADENA, probada de punta a punta por las tres sondas de este directorio:
//    StockTransfers(DocEntry) -> BinAllocations{BinAbsEntry, Quantity, BinActionType}
//                             -> BinLocations(AbsEntry).Description
//                             -> BPAddresses.AddressName -> CardCode
//  Mapa de ubicaciones: 538 de 539, 99,8%.
//
//  POR QUE DOS FASES, y no es una decision de estilo. El Service Layer NO
//  devuelve las colecciones hijas en una LISTA: pedidas asi vienen vacias, y
//  solo llegan cuando se pide el documento POR SU CLAVE. Medido: DocEntry
//  35058202 trae 0 asignaciones en la lista y 2 por clave. El $expand esta
//  descartado con las palabras del servidor —"Cannot expand invalid navigation
//  property 'StockTransferLines'"— porque las lineas de un documento de B1 no
//  son una propiedad de navegacion, ni en la v1 ni en la v2. NO REINTENTARLO.
//
//  EL COSTO, dicho antes de prometer nada: una peticion por documento. Del
//  orden de 17.700 documentos al mes. El precedente real es
//  backfill-historial.js: 162.075 pedidos a concurrencia 8 en 177 min, o sea
//  ~916/min, que dan ~20 min por mes extraido. El historico completo NO hace
//  falta: el saldo es acumulativo y el saldo inicial sale de la propia OV
//  (PD de una semana sana / 7), que es dato de REDTEC.
//
//  DOS MODOS
//    --maestro   extrae las UBICACIONES de una bodega y las direcciones de los
//                socios, y resuelve el mapa ubicacion -> cliente con la MISMA
//                regla de sonda-sap-ubicacion.js (se la pide prestada; dos
//                copias de una regla es como terminan divergiendo).
//    (default)   extrae los MOVIMIENTOS por ubicacion de los meses pedidos.
//
//  Credenciales SOLO por entorno, falla cerrado nombrando la que falta:
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB · OS_STORAGE_CONN
//
//  Uso (PowerShell):
//    node backfill/backfill-sap-bin.js --maestro
//        El mapa de CLIENTES con los 77 socios de arriendo.
//    node backfill/backfill-sap-bin.js --maestro --bodega=RETAIL --prefijo=R
//        El mapa de RETAIL. --prefijo saca los socios de SAP por el prefijo
//        del CardCode —los clientes son C... y los retailers R...— en vez de
//        una lista fija. Con --maestro --bodega=RETAIL y SIN --prefijo salen
//        CERO de 1.451 atribuidas, porque el indice queda cargado con los
//        socios de arriendo.
//    node backfill/backfill-sap-bin.js 2026-09 2026-10
//    node backfill/backfill-sap-bin.js 2026-09 2026-09 --conc=8 --forzar
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');
const SU = require('./sonda-sap-ubicacion.js');   // el mapa ubicacion -> cliente
const SB = require('./sonda-sap-bin.js');         // que coleccion es "de ubicacion"

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const args = process.argv.slice(2);
const OPCIONES = ['entidad', 'fecha', 'item', 'bodega', 'clientes', 'conc', 'pausa', 'pagina', 'tope',
                  'prefijo', 'desde'];
const BANDERAS = ['maestro', 'forzar', 'crudo'];
const opcion = (n, d) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const flag = n => args.some(a => a === '--' + n);
const meses = args.filter(a => /^\d{4}-\d{2}$/.test(a));

const ENTIDAD = opcion('entidad', 'StockTransfers');
const CAMPO_FECHA = opcion('fecha', 'DocDate');
const ITEM = opcion('item', '11111111110');          // pallet rojo
const BODEGA = opcion('bodega', 'CLIENTES');
const PAGINA = Math.max(20, Math.min(500, parseInt(opcion('pagina', '200'), 10) || 200));
const CONC = Math.max(1, Math.min(32, parseInt(opcion('conc', '8'), 10) || 8));
const PAUSA = Math.max(0, parseInt(opcion('pausa', '120'), 10) || 0);
const FORZAR = flag('forzar');
const VENTANA = opcion('desde', null);   // ventana incremental: YYYY-MM-DD

const mil = n => Number(n).toLocaleString('es-CL');

// ── lo puro ─────────────────────────────────────────────────────────────────

/** EL SIGNO. Es la funcion mas importante del archivo: decide si el pallet
 *  entra o sale de la ubicacion, y equivocarla da un saldo con el signo
 *  cambiado que igual "parece" un saldo.
 *
 *  Medido sobre DocEntry 35058202:
 *     {BinAbsEntry:5271, Quantity:4, BinActionType:'batFromWarehouse'}  -> -4
 *     {BinAbsEntry:5275, Quantity:4, BinActionType:'batToWarehouse'}    -> +4
 *
 *  Un BinActionType que no sea uno de esos dos devuelve null y NO se adivina:
 *  se cuenta aparte y sale en el informe. Inventarle un signo a un tipo
 *  desconocido es exactamente como se construye un saldo que nadie puede
 *  auditar. */
function deltaDeAsignacion(a) {
  if (!a) return null;
  const q = Number(a.Quantity);
  if (!isFinite(q)) return null;
  const t = String(a.BinActionType || '').trim();
  if (t === 'batToWarehouse') return q;
  if (t === 'batFromWarehouse') return -q;
  return null;
}

/** Aplana un documento a una fila por asignacion de ubicacion. Solo del item
 *  pedido: traer todo el inventario para quedarse con el pallet rojo es gastar
 *  almacenamiento en algo que nadie va a leer. */
/*  LOS DOS CAMPOS DE BODEGA DE UNA LINEA.
 *
 *  No son un supuesto: los confirmo backfill/sonda-planta-lineas.js contra SAP
 *  el 2026-10-27, buscandolos por CONTENIDO —que campos traian un codigo de
 *  bodega conocido— y no por nombre. Aparecieron en las 835 lineas del dia.
 *  Cual de los dos es el origen lo dice el nombre, y lo confirmo el contraste:
 *  con esta asignacion RETAIL dio entradas 5.127, salidas 4.759 y neto +368,
 *  identico a lo que la capa de ubicaciones ya media por otro camino. Dado
 *  vuelta daba -368.
 *
 *  Si algun dia SAP los renombra, la sonda lo vuelve a decir. Aca quedan
 *  escritos una sola vez para no repetirlos en cada funcion. */
const CAMPO_DESDE = 'FromWarehouseCode';
const CAMPO_HACIA = 'WarehouseCode';

/** EL MOVIMIENTO DE BODEGA DE CADA LINEA, que es lo unico que ve la planta.
 *
 *  POR QUE HACE FALTA. filasDeDocumento() solo produce filas donde hay
 *  ASIGNACION DE UBICACION, y las bodegas de planta —inspeccion, reparacion,
 *  pintura, disponible— no manejan ubicaciones. Resultado: de la planta no
 *  teniamos ni un movimiento, y habia que pedirselo a Datawalt, que lee OINM
 *  y registra una fila por bodega sin decir de donde vino el pallet.
 *
 *  El documento ya venia completo en la misma respuesta: estos tres campos
 *  llegaban y se tiraban.
 *
 *  Una punta ausente queda en null y NO se inventa: hay lineas que mueven
 *  contra algo que no es una bodega, y taparlas seria perder justo la
 *  informacion de que existen. */
function lineasDeDocumento(doc, claveLineas, item) {
  const out = [];
  const lineas = (doc && claveLineas && doc[claveLineas]) || [];
  const lee = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
  for (const l of lineas) {
    if (!l) continue;
    if (item && String(l.ItemCode || '') !== String(item)) continue;
    const q = Number(l.Quantity);
    out.push({ DocEntry: doc.DocEntry, DocNum: doc.DocNum,
               DocDate: String(doc.DocDate || '').slice(0, 10),
               LineNum: l.LineNum, ItemCode: l.ItemCode,
               desde: lee(l[CAMPO_DESDE]), hacia: lee(l[CAMPO_HACIA]),
               cantidad: isFinite(q) ? q : 0 });
  }
  return out;
}

/*  LAS LINEAS VAN EN SU PROPIO BLOB, no dentro de binmov.
 *
 *  Medido: son ~2,5 MB por mes. saldo-pool lee los diez binmov en cada corrida
 *  y dos veces (retail y clientes): meterlas ahi serian 50 MB de descarga por
 *  cierre que ese script no usa para nada. Aparte, binmov no cambia de forma
 *  y lo que ya lo lee sigue igual. */
const PREFIJO_LINEAS = 'lineasbod/';

/** SI EL BLOB DE LINEAS PREVIO SIRVE PARA FUSIONAR CON LA VENTANA.
 *
 *  Un mes extraido ANTES de que se guardaran las lineas no las tiene, y
 *  fusionar la ventana contra el dejaria un mes con lineas solo en los
 *  ultimos dias, haciendose pasar por completo. Eso es peor que no tener
 *  nada: el tablero mostraria una planta que arranca a mitad de mes y nadie
 *  sabria por que. Se para y se dice que hay que rehacer el mes una vez. */
function ventanaUsable(blob) {
  const b = blob || {};
  if (!Array.isArray(b.lineas))
    return { ok: false, motivo: 'el blob previo no trae lineas de bodega: se extrajo antes de que se guardaran' };
  return { ok: true, motivo: null };
}

function filasDeDocumento(doc, claveLineas, item) {
  const out = [], raros = [];
  const lineas = (doc && claveLineas && doc[claveLineas]) || [];
  for (const l of lineas) {
    if (item && String(l.ItemCode || '') !== String(item)) continue;
    // Que coleccion es "de ubicacion" lo decide sonda-sap-ubicacion.js, no una
    // copia de su expresion regular aca. Es la misma razon por la que el mapa
    // sale de su propagarPorGrupo: una regla, un lugar.
    for (const col of SB.coleccionesDeBin(SB.coleccionesAnidadas(l))) {
      const k = col.clave;
      for (const a of l[k]) {
        const d = deltaDeAsignacion(a);
        if (d == null) { raros.push({ DocEntry: doc.DocEntry, LineNum: l.LineNum, tipo: a && a.BinActionType }); continue; }
        out.push({ DocEntry: doc.DocEntry, DocNum: doc.DocNum,
                   DocDate: String(doc.DocDate || '').slice(0, 10),
                   CardCode: doc.CardCode || null, LineNum: l.LineNum,
                   ItemCode: l.ItemCode, BinAbsEntry: a.BinAbsEntry,
                   Quantity: Number(a.Quantity), delta: d });
      }
    }
  }
  return { filas: out, raros };
}

/** La url de la LISTA, que solo sirve para descubrir los DocEntry. Pagina con
 *  $skip/$top sobre un orden unico por la misma razon que backfill-sap.js: la
 *  clave de continuacion cambia de nombre entre dialectos y seguirla fue como
 *  truncamos un mes entero en silencio. */
/* ── LA VENTANA INCREMENTAL ─────────────────────────────────────────────────
 *  El cierre diario re-extraia el MES ENTERO todos los dias: 15.688 documentos
 *  y 58 minutos para traer, en el fondo, el movimiento de un dia. Con --desde
 *  se trae solo la cola del mes y se fusiona con lo que ya esta en el blob.
 *
 *  LA FASE 1 SIGUE SIENDO DEL MES COMPLETO, y no es un descuido: son 80
 *  peticiones de 15.768, o sea segundos, y es lo unico que deja saber cuantos
 *  documentos tiene el mes de verdad. Sin eso, _docs contaria solo la ventana
 *  y la sonda de cobertura reportaria un faltante que no existe.
 *
 *  POR QUE UNA VENTANA DE VARIOS DIAS Y NO DE UNO: SAP acepta documentos
 *  post-fechados y posteos con fecha vieja. Un dia de ventana se perderia
 *  justamente los que llegan tarde, que son los que interesan.          */

/** Hasta donde llega la ventana dentro de ESTE mes. Devuelve el corte, o dice
 *  por que no hay ninguno. Un mes entero anterior a la ventana no se toca. */
function corteDeVentana(desde, mes) {
  const m = String(mes == null ? '' : mes).trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return { error: 'mes invalido: ' + mes };
  const pri = m + '-01', ult = S.finDeMes(m);
  const d = String(desde == null ? '' : desde).trim();
  if (!d) return { corte: null, completo: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: '--desde no es YYYY-MM-DD: ' + desde };
  if (d <= pri) return { corte: pri, completo: true };   // la ventana cubre el mes entero
  if (d > ult) return { corte: null, fuera: true };      // el mes quedo entero antes de la ventana
  return { corte: d, completo: false };
}

/** Que documentos hay que volver a pedir y cuales quedan como estaban.
 *  Un documento SIN fecha legible se vuelve a pedir: es el lado seguro. */
function partirEntries(entries, corte) {
  const traer = [], antes = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || e.DocEntry == null) continue;
    const f = String(e.DocDate == null ? '' : e.DocDate).slice(0, 10);
    if (!corte || !/^\d{4}-\d{2}-\d{2}$/.test(f) || f >= corte) traer.push(e.DocEntry);
    else antes.push(e.DocEntry);
  }
  return { traer, antes };
}

/** Las filas del blob viejo anteriores al corte, mas las recien traidas.
 *  Se conserva por FECHA y no por DocEntry a proposito: asi, si un documento
 *  de la ventana se anulo en SAP y ya no vuelve, sus filas desaparecen igual.
 *  Una fila vieja sin fecha legible NO se conserva, porque su documento se
 *  vuelve a pedir y quedaria duplicada. */
function fusionarFilas(viejas, nuevas, corte) {
  const n = Array.isArray(nuevas) ? nuevas.slice() : [];
  if (!corte) return n;
  const conservadas = (Array.isArray(viejas) ? viejas : []).filter(f => {
    const d = f && String(f.DocDate == null ? '' : f.DocDate).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < corte;
  });
  return conservadas.concat(n);
}

function urlLista(raiz, entidad, campoFecha, desde, hasta, top, skip) {
  if (!raiz || !entidad || !campoFecha || !desde || !hasta) return null;
  const filtro = campoFecha + " ge '" + desde + "' and " + campoFecha + " le '" + hasta + "'";
  return raiz + '/' + entidad + '?$filter=' + encodeURIComponent(filtro) +
         '&$orderby=' + encodeURIComponent('DocEntry asc') +
         '&$top=' + (top || 200) + '&$skip=' + (skip || 0);
}

/** La url POR CLAVE, que es la unica que trae las asignaciones. */
function urlPorClave(raiz, entidad, docEntry) {
  if (!raiz || !entidad || docEntry == null || docEntry === '') return null;
  return raiz + '/' + entidad + '(' + encodeURIComponent(String(docEntry)) + ')';
}

/** El saldo por ubicacion que implica un conjunto de filas. */
function saldoPorBin(filas) {
  const m = new Map();
  let total = 0;
  for (const f of (filas || [])) {
    m.set(f.BinAbsEntry, (m.get(f.BinAbsEntry) || 0) + f.delta);
    total += f.delta;
  }
  return { porBin: m, total };
}

/** EL CONTROL DE CORDUA, corregido. La primera version exigia que la suma de
 *  TODOS los deltas del mes diera cero, "porque lo que sale de una ubicacion
 *  entra en otra", y marcaba NO CUADRA en los dos meses extraidos. Estaba mal
 *  yo, no el dato: un traspaso de una bodega CON ubicaciones a una SIN ellas
 *  tiene una sola punta, y entonces el neto del mes NO es cero — es el
 *  crecimiento neto del pool en manos de clientes, que es justo lo que se
 *  quiere medir. Septiembre dio +8.116 pallets y la cartola, por su lado, dice
 *  que el saldo de los clientes crecio unos 11.800 en tres semanas: el mismo
 *  orden de magnitud.
 *
 *  El control que SI vale es por LINEA: si una linea tiene sus dos puntas
 *  —algo salio de una ubicacion y entro en otra— esas dos tienen que netear
 *  cero. Una linea con una sola punta es legitima y se cuenta aparte. */
function controlDePuntas(filas) {
  const porLinea = new Map();
  for (const f of (filas || [])) {
    const k = f.DocEntry + '|' + f.LineNum;
    const e = porLinea.get(k) || { entra: 0, sale: 0, neto: 0, DocEntry: f.DocEntry, LineNum: f.LineNum };
    if (f.delta > 0) e.entra++; else if (f.delta < 0) e.sale++;
    e.neto += f.delta;
    porLinea.set(k, e);
  }
  let dosPuntas = 0, soloSale = 0, soloEntra = 0, ceroNeto = 0;
  const descuadradas = [];
  for (const e of porLinea.values()) {
    if (e.entra && e.sale) {
      dosPuntas++;
      if (e.neto !== 0) descuadradas.push({ DocEntry: e.DocEntry, LineNum: e.LineNum, neto: e.neto });
    } else if (e.sale) soloSale++;
    else if (e.entra) soloEntra++;
    else ceroNeto++;
  }
  return { lineas: porLinea.size, dosPuntas, soloSale, soloEntra, ceroNeto, descuadradas };
}

/** Las filas atribuidas a un cliente con el mapa de ubicaciones. Las que no se
 *  pueden atribuir se devuelven aparte: una fila sin cliente no se descarta en
 *  silencio, porque es justo la que despues no cuadra. */
/** LA URL PARA LISTAR SOCIOS POR PREFIJO DE CardCode.
 *
 *  De donde viene: el maestro de RETAIL salio con CERO ubicaciones
 *  atribuidas de 1.451, porque el indice iba cargado con los 77 socios de
 *  ARRIENDO y las ubicaciones de retail son de los retailers. En SAP el
 *  prefijo los separa: los clientes son C... y los retailers R...
 *
 *  Pasar los 46 codigos a mano con --clientes funcionaria HOY y quedaria
 *  viejo manana, que es justo el problema que tuvimos con el maestro. Asi
 *  que el prefijo se consulta contra SAP y la lista sale derivada.
 *
 *  EL FILTRO ES POR COMPARACION Y NO POR startswith: 'R' <= CardCode < 'S'
 *  dice lo mismo y funciona igual en los dos dialectos de OData que habla el
 *  Service Layer, sin tener que averiguar cual contesta hoy. */
function urlSociosPorPrefijo(raiz, prefijo, top, skip) {
  const p = String(prefijo == null ? '' : prefijo).trim();
  if (!raiz || !p) return null;
  const sig = p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);
  const filtro = "CardCode ge '" + p + "' and CardCode lt '" + sig + "'";
  return raiz + '/BusinessPartners?$filter=' + encodeURIComponent(filtro) +
         '&$orderby=' + encodeURIComponent('CardCode asc') +
         '&$top=' + (top || 200) + '&$skip=' + (skip || 0);
}

function atribuir(filas, mapa) {
  const con = [], sin = [];
  for (const f of (filas || [])) {
    const cod = mapa && mapa.get ? mapa.get(f.BinAbsEntry) : null;
    if (cod) con.push(Object.assign({ CardCodeBin: cod }, f));
    else sin.push(f);
  }
  return { con, sin };
}

module.exports = { corteDeVentana, partirEntries, fusionarFilas, deltaDeAsignacion, filasDeDocumento,
                   lineasDeDocumento, ventanaUsable, CAMPO_DESDE, CAMPO_HACIA, PREFIJO_LINEAS, urlLista, urlPorClave,
                   saldoPorBin, atribuir, controlDePuntas, urlSociosPorPrefijo,
                   OPCIONES, BANDERAS };

// ── infraestructura ─────────────────────────────────────────────────────────
function faltanVars(extra) {
  const req = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].concat(extra || []);
  return req.filter(k => !process.env[k]);
}
function cliente() {
  const { BlobServiceClient } = require('@azure/storage-blob');
  return BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);
}
// "No existe" se reconoce por CODIGO, nunca por el texto del mensaje: el SDK
// de Azure manda code='BlobNotFound' y un message amistoso, y buscar el texto
// fue lo que mato la primera corrida de backfill-historial.js.
function esNoExiste(e) {
  if (!e) return false;
  if (e.statusCode === 404 || e.code === 'BlobNotFound') return true;
  if (e.details && e.details.errorCode === 'BlobNotFound') return true;
  return /BlobNotFound/.test(String(e.message || ''));
}
async function existeBlob(cc, nombre) {
  try { return await cc.getBlobClient(nombre).exists(); }
  catch (e) { if (esNoExiste(e)) return false; throw e; }
}
async function leerJson(cc, nombre) {
  const buf = await cc.getBlobClient(nombre).downloadToBuffer();
  return JSON.parse(buf.toString('utf8'));
}
async function escribirJson(cc, nombre, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  await cc.getBlockBlobClient(nombre).upload(buf, buf.length,
    { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
  return buf.length;
}
async function conReintentos(fn) {
  let ultimo = null;
  for (let i = 1; i <= 3; i++) {
    try { return await fn(); }
    catch (e) { ultimo = e; if (!e.reintentable) break; await new Promise(r => setTimeout(r, 800 * i * i)); }
  }
  throw ultimo;
}
function errorSap(r, donde) {
  return Object.assign(new Error('SAP ' + r.status + ' en ' + donde + ' :: ' +
    String(r.body == null ? '' : r.body).slice(0, 200)),
    { reintentable: r.status === 429 || r.status >= 500 });
}

// ── modo maestro ────────────────────────────────────────────────────────────
async function maestro(ses, raiz, cc) {
  // --prefijo manda sobre --clientes: la lista sale de SAP y no de una
  // constante que envejece. Sin ninguno de los dos, los 77 de arriendo.
  const PREFIJO = opcion('prefijo', null);
  let clientes;
  if (PREFIJO) {
    clientes = [];
    let sk = 0;
    for (;;) {
      const u = urlSociosPorPrefijo(raiz, PREFIJO, PAGINA, sk);
      const r = await conReintentos(async () => {
        const x = await ses.get(u);
        if (x.status !== 200) throw errorSap(x, 'BusinessPartners prefijo ' + PREFIJO);
        return x;
      });
      const v = (r.json && r.json.value) || [];
      for (const b of v) if (b && b.CardCode) clientes.push(String(b.CardCode).trim());
      if (!v.length || v.length < PAGINA) break;
      sk += v.length;
      if (sk > 20000) throw new Error('Mas de 20.000 socios con prefijo ' + PREFIJO);
    }
    console.log('Socios con CardCode que empieza con "' + PREFIJO + '": ' + clientes.length +
                '   (derivados de SAP, no de una lista fija)');
    if (!clientes.length) { console.error('Ningun socio con ese prefijo. Revisar el prefijo.'); process.exit(1); }
  } else {
    clientes = String(opcion('clientes', SU.CLIENTES_ARRIENDO)).split(',').map(x => x.trim()).filter(Boolean);
  }
  console.log('Maestro de ubicaciones de ' + BODEGA + '   ·  ' + clientes.length + ' socios');

  const bins = [];
  let skip = 0;
  for (;;) {
    const u = raiz + '/BinLocations?$filter=' + encodeURIComponent("Warehouse eq '" + BODEGA + "'") +
              '&$orderby=' + encodeURIComponent('AbsEntry asc') + '&$top=' + PAGINA + '&$skip=' + skip;
    const r = await conReintentos(async () => {
      const x = await ses.get(u);
      if (x.status !== 200) throw errorSap(x, 'BinLocations');
      return x;
    });
    const v = (r.json && r.json.value) || [];
    bins.push.apply(bins, v);
    if (!v.length || v.length < PAGINA) break;
    skip += v.length;
  }
  console.log('  ubicaciones: ' + mil(bins.length));

  const entradas = [];
  for (const cod of clientes) {
    const r = await conReintentos(async () => {
      const x = await ses.get(raiz + "/BusinessPartners('" + encodeURIComponent(cod) + "')");
      if (x.status !== 200 && x.status !== 404) throw errorSap(x, 'BusinessPartners ' + cod);
      return x;
    });
    if (r.status !== 200) { console.log('  ' + cod + ': HTTP ' + r.status); continue; }
    entradas.push({ cod, nom: (r.json && r.json.CardName) || cod, dirs: SU.direccionesDe(r.json) });
  }
  console.log('  socios leidos: ' + entradas.length);

  const { indice, colisiones } = SU.indiceDirecciones(entradas);
  const pr = SU.propagarPorGrupo(bins.filter(b => b.IsSystemBin !== 'tYES' && b.IsSystemBin !== true),
                                 indice, 'Description', 'Sublevel1');
  console.log('  mapa: ' + pr.asignacion.size + ' ubicaciones atribuidas' +
              '   ·  directas ' + pr.directas + '   ·  por grupo ' + pr.propagadas);
  if (colisiones.length) console.log('  nombres de direccion en mas de un socio: ' + colisiones.length);
  if (pr.conflictos.length) console.log('  grupos en conflicto (no propagan): ' + pr.conflictos.length);
  console.log('  grupos sin socio del indice: ' + pr.sinSocio.length);

  const payload = {
    bodega: BODEGA, generado: new Date().toISOString(),
    _fuente: 'Service Layer ' + process.env.SAP_DB + ' · BinLocations + BusinessPartners',
    _ubicaciones: bins.length, _atribuidas: pr.asignacion.size,
    _directas: pr.directas, _porGrupo: pr.propagadas,
    ubicaciones: bins.map(b => ({ AbsEntry: b.AbsEntry, BinCode: b.BinCode, Warehouse: b.Warehouse,
                                  Sublevel1: b.Sublevel1, Description: b.Description,
                                  IsSystemBin: b.IsSystemBin,
                                  CardCode: pr.asignacion.get(b.AbsEntry) || null })),
    socios: entradas.map(e => ({ cod: e.cod, nom: e.nom, dirs: e.dirs.map(d => d.nombre) })),
    colisiones, conflictos: pr.conflictos, sinSocio: pr.sinSocio,
  };
  const nombre = 'binmaestro/' + BODEGA + '.json';
  const n = await escribirJson(cc, nombre, payload);
  console.log('  escrito ' + CONT + '/' + nombre + '   ·  ' + mil(n) + ' bytes');
}

// ── modo movimientos ────────────────────────────────────────────────────────
async function unMes(ses, raiz, cc, mes) {
  const desde = mes + '-01', hasta = S.finDeMes(mes);
  const nombre = 'binmov/' + mes + '.json';
  const nombreL = PREFIJO_LINEAS + mes + '.json';

  const v = corteDeVentana(VENTANA, mes);
  if (v.error) { console.error(v.error); process.exit(1); }
  if (v.fuera) { console.log(mes + ': entero antes de la ventana --desde, se deja como esta'); return null; }
  const corte = v.completo ? null : v.corte;
  let viejas = null, viejasLineas = null;
  if (corte) {
    // Sin blob previo no hay con que fusionar, y escribir solo la ventana
    // dejaria un mes incompleto haciendose pasar por completo.
    if (!await existeBlob(cc, nombre)) {
      console.error(mes + ': --desde necesita el blob del mes ya extraido, y no esta.');
      console.error('  Corre el mes completo una vez (sin --desde) y despues incremental.');
      process.exit(1);
    }
    const j = await leerJson(cc, nombre);
    const jl = await existeBlob(cc, nombreL) ? await leerJson(cc, nombreL) : null;
    const us = ventanaUsable(jl);
    if (!us.ok) {
      console.error(mes + ': no se puede usar --desde porque ' + us.motivo + '.');
      console.error('  Corre ese mes una vez SIN --desde (con --forzar) y despues incremental.');
      process.exit(1);
    }
    viejas = (j && j.filas) || [];
    viejasLineas = (jl && jl.lineas) || [];
    console.log(mes + ': ventana desde ' + corte + ' · blob previo con ' + mil(viejas.length) +
                ' filas y ' + mil(viejasLineas.length) + ' lineas de bodega');
  } else if (!FORZAR && await existeBlob(cc, nombre)) {
    console.log(mes + ': ya esta, se salta (--forzar para rehacer)'); return null;
  }

  // FASE 1 · descubrir los DocEntry
  const entries = [];
  let skip = 0, paso = PAGINA, pedidos = 0;
  for (;;) {
    const u = urlLista(raiz, ENTIDAD, CAMPO_FECHA, desde, hasta, paso, skip);
    const r = await conReintentos(async () => {
      const x = await ses.get(u);
      if (x.status !== 200) throw errorSap(x, ENTIDAD + ' ' + mes + ' skip ' + skip);
      return x;
    });
    pedidos++;
    const pag = (r.json && r.json.value) || [];
    // la FECHA tambien, que es lo que decide si el documento entra en la ventana
    for (const d of pag) entries.push({ DocEntry: d.DocEntry, DocDate: d[CAMPO_FECHA] });
    if (!pag.length) break;
    if (pag.length < paso) {
      // pagina corta: final de verdad o tope del servidor. Se pregunta.
      const s = await ses.get(urlLista(raiz, ENTIDAD, CAMPO_FECHA, desde, hasta, 1, skip + pag.length));
      pedidos++;
      if (!((s.json && s.json.value) || []).length) break;
      paso = pag.length;
    }
    skip += pag.length;
    if (pedidos > 5000) throw new Error('Mas de 5000 peticiones listando ' + mes);
  }
  console.log(mes + ': ' + mil(entries.length) + ' documentos (fase 1, ' + pedidos + ' peticiones)');
  if (!entries.length) return { mes, desde, hasta, filas: [], lineas: [], docs: 0, fallidos: [], raros: [], corte };

  // FASE 2 solo sobre la ventana. La fase 1 ya recorrio el mes entero, asi que
  // _docs sigue siendo el total del mes y la sonda de cobertura sigue valiendo.
  const part = partirEntries(entries, corte);
  const aPedir = part.traer;
  if (corte) console.log('  ' + mil(aPedir.length) + ' documentos en la ventana · ' +
                         mil(part.antes.length) + ' quedan como estaban');
  if (!aPedir.length) {
    const solo = fusionarFilas(viejas, [], corte);
    const soloL = fusionarFilas(viejasLineas, [], corte);
    return { mes, desde, hasta, filas: solo, lineas: soloL, docs: entries.length,
             fallidos: [], raros: [], corte, conservadas: solo.length, nuevas: 0 };
  }

  // FASE 2 · uno por uno, que es la unica forma de que vengan las asignaciones
  const filas = [], lineas = [], fallidos = [], raros = [];
  let hechos = 0, t0 = Date.now();
  for (let i = 0; i < aPedir.length; i += CONC) {
    const lote = aPedir.slice(i, i + CONC);
    await Promise.all(lote.map(async de => {
      try {
        const r = await conReintentos(async () => {
          const x = await ses.get(urlPorClave(raiz, ENTIDAD, de));
          if (x.status !== 200) throw errorSap(x, ENTIDAD + '(' + de + ')');
          return x;
        });
        const doc = r.json;
        const kl = S.nombreLineas(doc);
        const res = filasDeDocumento(doc, kl, ITEM);
        filas.push.apply(filas, res.filas);
        raros.push.apply(raros, res.raros);
        // El movimiento de bodega de la linea, que es lo unico que ve la planta.
        lineas.push.apply(lineas, lineasDeDocumento(doc, kl, ITEM));
      } catch (e) { fallidos.push({ DocEntry: de, error: String(e.message).slice(0, 200) }); }
    }));
    hechos += lote.length;
    if (PAUSA) await new Promise(r => setTimeout(r, PAUSA));
    if (hechos % (CONC * 25) === 0 || hechos === aPedir.length) {
      const seg = (Date.now() - t0) / 1000;
      process.stdout.write('\r  ' + mil(hechos) + '/' + mil(aPedir.length) +
        '   ' + (seg ? (hechos / seg * 60).toFixed(0) : '0') + '/min   filas: ' + mil(filas.length) + '   ');
    }
  }
  process.stdout.write('\n');
  const todas = fusionarFilas(viejas, filas, corte);
  const todasL = fusionarFilas(viejasLineas, lineas, corte);
  return { mes, desde, hasta, filas: todas, lineas: todasL, docs: entries.length, fallidos, raros,
           corte, conservadas: todas.length - filas.length, nuevas: filas.length };
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
  const faltan = faltanVars(['OS_STORAGE_CONN']);
  if (faltan.length) { console.error('Faltan variables de entorno: ' + faltan.join(', ')); process.exit(1); }

  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();
  await ses.login();
  const cc = cliente();
  console.log('Raiz: ' + raiz + '   ·  base: ' + process.env.SAP_DB + '   ·  contenedor: ' + CONT);

  if (flag('maestro')) return maestro(ses, raiz, cc);

  if (!meses.length) { console.error('Faltan los meses. Ej: node backfill/backfill-sap-bin.js 2026-09 2026-10'); process.exit(1); }
  const lista = S.listarMeses(meses[0], meses[1] || meses[0]).reverse();   // del mas nuevo al mas viejo
  console.log('Meses: ' + lista.join(', ') + '   ·  item ' + ITEM + '   ·  concurrencia ' + CONC + '\n');

  let totFilas = 0, totDocs = 0, totFall = 0, totRaros = 0;
  for (const mes of lista) {
    const res = await unMes(ses, raiz, cc, mes);
    if (!res) continue;
    const sb = saldoPorBin(res.filas);
    const cp = controlDePuntas(res.filas);
    const payload = {
      mes: res.mes, desde: res.desde, hasta: res.hasta,
      _fuente: 'Service Layer ' + process.env.SAP_DB + ' · ' + ENTIDAD + ' por clave',
      _item: ITEM, _docs: res.docs, _filas: res.filas.length,
      _ubicaciones: sb.porBin.size, _suma_delta: sb.total,
      _lineas: cp.lineas, _dos_puntas: cp.dosPuntas, _solo_sale: cp.soloSale,
      _solo_entra: cp.soloEntra, _descuadradas: cp.descuadradas,
      _fallidos: res.fallidos, _tipos_desconocidos: res.raros.length,
      _lineas_bodega: (res.lineas || []).length,
      _lineas_bodega_en: PREFIJO_LINEAS + res.mes + '.json',
      _guardado: new Date().toISOString(),
      _desde_ventana: res.corte || null,
      _filas_conservadas: res.corte ? (res.conservadas || 0) : null,
      _filas_nuevas: res.corte ? (res.nuevas || 0) : null,
      filas: res.filas,
    };
    const n = await escribirJson(cc, 'binmov/' + res.mes + '.json', payload);
    // El movimiento de bodega linea por linea, en su propio blob: es lo que
    // deja medir la planta, que no tiene ubicaciones y hasta ahora no veiamos.
    const nl = await escribirJson(cc, PREFIJO_LINEAS + res.mes + '.json', {
      mes: res.mes, desde: res.desde, hasta: res.hasta,
      _que_es: 'Movimiento de bodega por linea de documento: de que bodega sale y a cual entra. ' +
               'Es la unica via a las bodegas de planta, que no manejan ubicaciones.',
      _campos_sap: CAMPO_DESDE + ' (origen) / ' + CAMPO_HACIA + ' (destino)',
      _confirmado: 'backfill/sonda-planta-lineas.js contra SAP el 2026-10-27',
      _item: ITEM, _docs: res.docs, _lineas: (res.lineas || []).length,
      _guardado: new Date().toISOString(),
      _desde_ventana: res.corte || null,
      lineas: res.lineas || [],
    });
    console.log('  ' + res.mes + ': ' + mil(res.filas.length) + ' filas · ' +
                mil(sb.porBin.size) + ' ubicaciones · ' + mil(n) + ' bytes' +
                (res.fallidos.length ? '   ·  FALLIDOS: ' + res.fallidos.length : '') +
                (res.raros.length ? '   ·  BinActionType desconocido: ' + res.raros.length : ''));
    // El control es POR LINEA. El neto del mes no es cero y no tiene por que
    // serlo: es el crecimiento neto del pool en manos de clientes.
    console.log('  ' + res.mes + ': ' + mil((res.lineas || []).length) + ' lineas de bodega · ' +
                mil(nl) + ' bytes   ·  ' + PREFIJO_LINEAS + res.mes + '.json');
    console.log('     lineas: ' + mil(cp.lineas) + '   ·  con las dos puntas: ' + mil(cp.dosPuntas) +
                '   ·  solo sale: ' + mil(cp.soloSale) + '   ·  solo entra: ' + mil(cp.soloEntra));
    console.log('     neto del mes: ' + mil(sb.total) + ' pallets' +
                '   (lo que entro al pool menos lo que salio; NO tiene que dar cero)');
    if (cp.descuadradas.length) {
      console.log('     OJO: ' + cp.descuadradas.length + ' linea(s) con las dos puntas que NO netean cero.');
      for (const d of cp.descuadradas.slice(0, 5))
        console.log('        DocEntry ' + d.DocEntry + ' linea ' + d.LineNum + '  neto ' + d.neto);
    } else console.log('     las lineas con las dos puntas netean cero: cuadra');
    totFilas += res.filas.length; totDocs += res.docs;
    totFall += res.fallidos.length; totRaros += res.raros.length;
  }
  console.log('\nTotal: ' + mil(totDocs) + ' documentos · ' + mil(totFilas) + ' filas' +
              (totFall ? ' · ' + totFall + ' FALLIDOS' : ' · sin fallidos') +
              (totRaros ? ' · ' + totRaros + ' asignaciones con tipo desconocido' : ''));
  if (totRaros) console.log('Un BinActionType que no es batToWarehouse ni batFromWarehouse NO se interpreta:\nqueda contado y fuera de las filas, para que no entre un signo inventado al saldo.');
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}
