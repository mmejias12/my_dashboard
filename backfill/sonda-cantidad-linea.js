// ============================================================================
//  backfill/sonda-cantidad-linea.js  ·  M3DATA · con QUE numero se mide una
//  linea
//
//  QUE CONTESTA. Cual de los campos numericos de la linea es la cantidad que
//  mueve el stock. No lo elige por nombre: los totaliza TODOS y dice cual da
//  el numero que ya conocemos por otra via.
//
//  POR QUE EXISTE, medido el 2026-10-26. Leyendo InventoryGenExits con el
//  campo Quantity, SANTIAGO INSPECCION daba 5.007 pallets de salida; OINM
//  dice 3.386. Y ninguna bodega calzaba: los factores iban de 1,39 a 1,80,
//  asi que no era un factor unico ni un documento suelto. Dos sospechas:
//
//    a) UNIDAD DE MEDIDA. En SAP una linea tiene Quantity —en la unidad del
//       documento— e InventoryQuantity —en la unidad de inventario—. En un
//       traspaso suelen coincidir, y por eso el contraste de RETAIL dio
//       exacto; en una salida de mercancias pueden no coincidir, y si cada
//       linea usa una unidad distinta el factor agregado sale irregular.
//    b) DOCUMENTOS ANULADOS. Marcelo ya advirtio que OINM no muestra las
//       reversas. Si contamos el original y su anulacion, sumamos de mas.
//
//  Las dos se resuelven con el mismo dato, asi que la sonda las prueba juntas:
//  totaliza cada campo numerico con TODOS los documentos y otra vez SIN los
//  anulados. El campo y el conjunto que den --esperado son la respuesta.
//
//  ELEGIR POR CONTENIDO Y NO POR NOMBRE es la misma regla que uso la sonda de
//  planta, y por una razon medida: ahi los dos campos de bodega empataban en
//  frecuencia, el desempate cayo en el alfabeto y quedo todo invertido.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-cantidad-linea.js --dia=2026-10-26 --entidad=InventoryGenExits --bodega=RT13-100 --esperado=3386
//    node backfill/sonda-cantidad-linea.js --dia=2026-10-26 --entidad=InventoryGenEntries --bodega=RT13-103 --esperado=2434
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');
const B = require('./backfill-sap-bin.js');      // urlLista, urlPorClave: una regla, un lugar

const args = process.argv.slice(2);
const OPCIONES = ['dia', 'hasta', 'entidad', 'bodega', 'filtro', 'esperado', 'item', 'campo', 'conc', 'pausa', 'tope'];
const BANDERAS = ['todos'];
const opcion = (n, d) => { const p = '--' + n + '='; for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length); return d; };
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 3 });

// ── lo puro ─────────────────────────────────────────────────────────────────

/** Si el documento esta anulado. SAP lo dice de mas de una forma segun la
 *  version, asi que se miran las dos y se declara cual contesto. */
function estaAnulado(doc) {
  const d = doc || {};
  if (d.Cancelled === 'tYES' || d.Cancelled === true) return true;
  if (typeof d.DocumentStatus === 'string' && /cancel/i.test(d.DocumentStatus)) return true;
  return false;
}

/** LOS FILTROS, escritos como campo=valor.
 *
 *  POR QUE GENERICO y no un --bodega y nada mas: cuando los totales no
 *  calzaron, la pregunta siguiente fue "y si partimos por TreeType", y
 *  despues va a ser por otro campo. Un filtro que solo sabe de bodegas obliga
 *  a tocar el codigo cada vez que cambia la pregunta. */
function leerFiltros(texto) {
  const out = [];
  for (const parte of String(texto == null ? '' : texto).split(',')) {
    const t = parte.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i <= 0) return { error: 'filtro sin campo=valor: ' + t };
    out.push({ campo: t.slice(0, i).trim(), valor: t.slice(i + 1).trim() });
  }
  return { filtros: out };
}

/** Si la linea pasa todos los filtros. Se compara recortando, porque un codigo
 *  con espacios es el mismo codigo. */
function pasaFiltros(linea, filtros) {
  for (const f of (filtros || [])) {
    if (!f || !f.campo) continue;
    const v = (linea || {})[f.campo];
    if (v == null) return false;
    if (String(v).trim() !== String(f.valor).trim()) return false;
  }
  return true;
}

/** Las lineas del item que pasan los filtros, con la marca de anulado del
 *  documento al que pertenecen. Sin filtros entran todas. */
function lineasDeInteres(docs, item, filtros) {
  const out = [];
  for (const doc of (docs || [])) {
    if (!doc) continue;
    const anulado = estaAnulado(doc);
    const lineas = doc.StockTransferLines || doc.DocumentLines || [];
    for (const l of lineas) {
      if (!l) continue;
      if (item && String(l.ItemCode == null ? '' : l.ItemCode) !== String(item)) continue;
      if (!pasaFiltros(l, filtros)) continue;
      out.push({ linea: l, anulado, DocEntry: doc.DocEntry, DocNum: doc.DocNum });
    }
  }
  return out;
}

/** TOTALIZA TODOS LOS CAMPOS NUMERICOS. No se elige ninguno: se suman todos y
 *  despues se mira cual da el numero que buscamos. Solo cuentan los que SAP
 *  manda como numero; un codigo que parece numero —el ItemCode, sin ir mas
 *  lejos— no es una cantidad y sumarlo seria ruido. */
function totalesNumericos(lineas, soloVivas) {
  const m = new Map();
  for (const x of (lineas || [])) {
    if (!x || !x.linea) continue;
    if (soloVivas && x.anulado) continue;
    for (const k of Object.keys(x.linea)) {
      const v = x.linea[k];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const e = m.get(k) || { campo: k, veces: 0, total: 0 };
      e.veces++; e.total += v;
      m.set(k, e);
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total || (a.campo < b.campo ? -1 : 1));
}

/** Los campos de texto y sus valores distintos. Aca es donde aparece la
 *  unidad de medida si hay mas de una conviviendo. */
function valoresDeTexto(lineas, tope) {
  const m = new Map();
  const max = Number(tope) > 0 ? Number(tope) : 6;
  for (const x of (lineas || [])) {
    if (!x || !x.linea) continue;
    for (const k of Object.keys(x.linea)) {
      const v = x.linea[k];
      if (typeof v !== 'string' || !v.trim()) continue;
      const e = m.get(k) || { campo: k, veces: 0, valores: new Set() };
      e.veces++;
      if (e.valores.size < max) e.valores.add(v.trim());
      m.set(k, e);
    }
  }
  return [...m.values()]
    .map(e => ({ campo: e.campo, veces: e.veces, distintos: e.valores.size, valores: [...e.valores].sort() }))
    .filter(e => e.distintos > 1)                 // un valor unico no distingue nada
    .sort((a, b) => b.distintos - a.distintos || (a.campo < b.campo ? -1 : 1));
}

/** El --esperado, o NaN si no vino.
 *
 *  OJO: Number(null) es 0, que es finito. Sin esta funcion, no pasar
 *  --esperado se leia como "espero cero" y el veredicto dictaminaba sobre un
 *  numero que nadie dio. Un cero EXPLICITO si es un esperado valido. */
function numeroEsperado(x) {
  if (x === null || x === undefined || String(x).trim() === '') return NaN;
  return Number(x);
}

/** Que campos dan EXACTAMENTE el numero que ya conocemos por otra via. */
function candidatos(totales, esperado) {
  // Sin guardia para el esperado ausente a proposito: numeroEsperado devuelve
  // NaN y ninguna comparacion con NaN es verdadera, asi que la lista sale
  // vacia sola. Un if aparte seria codigo que nunca decide nada.
  const e = numeroEsperado(esperado);
  return (totales || []).filter(t => t && Number(t.total) === e).map(t => t.campo);
}

function veredicto(conAnulados, sinAnulados, esperado, anuladas, totales) {
  const e = numeroEsperado(esperado);
  if (!isFinite(e)) return { nivel: 'sin esperado',
    texto: 'Sin --esperado no hay con que comparar: la sonda muestra los totales y la ' +
           'eleccion queda a ojo, que es justo lo que no queremos.' };
  if (conAnulados.length && sinAnulados.length && conAnulados.join() === sinAnulados.join())
    return { nivel: 'si', texto: 'El campo es ' + conAnulados.join(' o ') + ': da ' + mil(e) +
             ' con y sin los anulados, asi que la anulacion no entra en juego aca.' };
  if (sinAnulados.length)
    return { nivel: 'si', texto: 'El campo es ' + sinAnulados.join(' o ') + ', pero SOLO descontando ' +
             'los documentos anulados (' + mil(anuladas) + ' linea(s)). Las dos cosas a la vez: ' +
             'ese campo y ese filtro.' };
  if (conAnulados.length)
    return { nivel: 'si', texto: 'El campo es ' + conAnulados.join(' o ') + ', contando todos los ' +
             'documentos. Los anulados, si los hay, ya estan compensados por su reversa.' };
  const cerca = (totales || []).filter(t => t && Math.abs(t.total - e) / (e || 1) < 0.05)
                               .map(t => t.campo + ' (' + mil(t.total) + ')');
  return { nivel: 'no',
    texto: 'NINGUN campo da ' + mil(e) + ', ni contando todo ni descontando anulados. ' +
           (cerca.length ? 'Los mas cercanos: ' + cerca.join(', ') + '. ' : '') +
           'La diferencia no es unidad de medida ni anulacion: hay que mirar que documentos ' +
           'estamos trayendo de mas o de menos antes de construir nada encima.' };
}

module.exports = { estaAnulado, leerFiltros, pasaFiltros, lineasDeInteres, totalesNumericos, valoresDeTexto,
                   numeroEsperado, candidatos, veredicto, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = args.filter(x => String(x).startsWith('--') &&
    !OPCIONES.some(o => String(x).startsWith('--' + o + '=')) && !BANDERAS.some(o => x === '--' + o));
  if (malas.length) { console.error('Opcion no reconocida: ' + malas.join('  ')); process.exit(1); }
  const falta = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', '));
    console.error('Se declaran en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const dia = opcion('dia', null);
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) { console.error('Falta --dia=YYYY-MM-DD'); process.exit(1); }
  // Una ventana, no un dia suelto: contra el nivel de la bodega un solo dia no
  // zanja nada —las lecturas son a horas distintas y el margen se come la
  // diferencia—, y sobre un mes entero el mismo margen es despreciable.
  const hasta = opcion('hasta', dia);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < dia) {
    console.error('--hasta no es YYYY-MM-DD posterior o igual a --dia: ' + hasta); process.exit(1);
  }
  const ENTIDAD = opcion('entidad', 'InventoryGenExits');
  const ITEM = opcion('item', '11111111110');
  const BODEGA = opcion('bodega', null);
  const CAMPO = opcion('campo', 'WarehouseCode');
  const lf = leerFiltros(opcion('filtro', ''));
  if (lf.error) { console.error(lf.error); process.exit(1); }
  const FILTROS = (BODEGA ? [{ campo: CAMPO, valor: BODEGA }] : []).concat(lf.filtros);
  const ESPERADO = opcion('esperado', null);
  const CONC = Math.max(1, Math.min(16, parseInt(opcion('conc', '6'), 10) || 6));
  const PAUSA = Math.max(0, parseInt(opcion('pausa', '0'), 10) || 0);
  const TOPE = Math.max(1, parseInt(opcion('tope', '6'), 10) || 6);

  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();
  console.log('Con que numero se mide una linea   ·  ' + dia +
              (hasta !== dia ? ' a ' + hasta : '') + '   ·  ' + ENTIDAD);
  console.log('Raiz: ' + raiz + '   ·  base ' + process.env.SAP_DB);
  console.log('SOLO LEE. Totaliza TODOS los campos numericos; no elige ninguno por su nombre.');
  console.log('item ' + ITEM + (FILTROS.length ? '   ·  ' + FILTROS.map(f => f.campo + '=' + f.valor).join('  ') : '') +
              (ESPERADO != null ? '   ·  esperado ' + mil(ESPERADO) : '   ·  SIN --esperado') + '\n');

  const claves = [];
  for (let skip = 0; ; skip += 200) {
    const r = await ses.get(B.urlLista(raiz, ENTIDAD, 'DocDate', dia, hasta, 200, skip));
    if (r.status !== 200) { console.error('lista HTTP ' + r.status); process.exit(1); }
    const v = (r.json && r.json.value) || [];
    for (const d of v) claves.push(d.DocEntry);
    if (v.length < 200) break;      // se avanza por lo RECIBIDO, no por lo pedido
  }
  console.log('  documentos en la ventana: ' + mil(claves.length));

  const docs = [], fallidos = [];
  let hechos = 0;
  for (let i = 0; i < claves.length; i += CONC) {
    const rs = await Promise.all(claves.slice(i, i + CONC).map(async k => {
      try { return { k, r: await S.conReintentos(() => ses.get(B.urlPorClave(raiz, ENTIDAD, k))) }; }
      catch (e) { return { k, error: String(e && e.message || e).slice(0, 60) }; }
    }));
    for (const x of rs) {
      hechos++;
      if (x.error || x.r.status !== 200 || !x.r.json) {
        fallidos.push({ DocEntry: x.k, error: x.error || ('HTTP ' + x.r.status) }); continue;
      }
      docs.push(x.r.json);
    }
    if (PAUSA) await new Promise(r => setTimeout(r, PAUSA));
  }
  if (fallidos.length) {
    console.log('  documentos que no se pudieron leer: ' + mil(fallidos.length) + '   ← cota inferior');
    for (const f of fallidos.slice(0, 5)) console.log('     DocEntry ' + f.DocEntry + ': ' + f.error);
  }

  const lineas = lineasDeInteres(docs, ITEM, FILTROS);
  const anuladas = lineas.filter(x => x.anulado).length;
  const docsAnulados = docs.filter(estaAnulado).length;
  console.log('  lineas que entran: ' + mil(lineas.length) +
              '   ·  de documentos anulados: ' + mil(anuladas) +
              ' (' + mil(docsAnulados) + ' documento(s))\n');
  if (!lineas.length) {
    console.log('  No hay lineas que cumplan el filtro. Revisa --bodega y --filtro.\n');
    return;
  }

  const todos = totalesNumericos(lineas, false);
  const vivos = totalesNumericos(lineas, true);
  const mapaVivos = new Map(vivos.map(t => [t.campo, t.total]));
  const candTodos = candidatos(todos, ESPERADO);
  const candVivos = candidatos(vivos, ESPERADO);

  console.log('── CADA CAMPO NUMERICO, TOTALIZADO ' + '─'.repeat(39));
  console.log('  ' + 'campo'.padEnd(28) + 'lineas'.padStart(8) + 'total'.padStart(14) +
              'sin anulados'.padStart(16));
  for (const t of todos) {
    const sv = mapaVivos.has(t.campo) ? mil(mapaVivos.get(t.campo)) : '0';
    const marca = (candTodos.indexOf(t.campo) >= 0 ? '  ← ES ESTE' : '') ||
                  (candVivos.indexOf(t.campo) >= 0 ? '  ← ES ESTE, sin anulados' : '');
    console.log('  ' + t.campo.slice(0, 27).padEnd(28) + mil(t.veces).padStart(8) +
                mil(t.total).padStart(14) + sv.padStart(16) + marca);
  }

  const txt = valoresDeTexto(lineas, TOPE);
  if (txt.length) {
    console.log('\n── CAMPOS DE TEXTO CON MAS DE UN VALOR ' + '─'.repeat(35));
    console.log('  (aca aparece la unidad de medida si hay mas de una conviviendo)');
    for (const t of txt.slice(0, bandera('todos') ? txt.length : 12))
      console.log('  ' + t.campo.slice(0, 27).padEnd(28) + (t.distintos + ' distintos').padStart(14) +
                  '   ·  ' + t.valores.slice(0, TOPE).join(', '));
  }

  const v = veredicto(candTodos, candVivos, ESPERADO, anuladas, todos);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto + '\n');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
