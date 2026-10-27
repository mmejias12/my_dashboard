// ============================================================================
//  backfill/sonda-anatomia-linea.js  ·  M3DATA · que pasa ADENTRO de un
//  documento que no llega a nuestras filas
//
//  QUE CONTESTA. De las lineas de traspaso de un dia, cuantas aportan filas a
//  binmov y cuantas no, y POR QUE no. Y sobre todo: cuantos pallets se mueven
//  en las lineas que no aportan nada.
//
//  POR QUE EXISTE. El movimiento de RETAIL no cuadra contra SAP por 7.886
//  pallets en 2026, y ya se descarto todo lo de afuera:
//    · tipos de documento   -> OINM solo tiene trans_type 67
//    · bodega equivocada    -> el filtro por Warehouse descarto 0
//    · traspasos internos   -> las lineas internas netean 0, cumplen la ley
//    · fin de mes perdido   -> mayo/julio/septiembre calzan con movimiento ese dia
//    · blobs viejos         -> las horas de extraccion no correlacionan
//    · filas o documentos
//      descartados          -> el blob dice 0 y 0 en los diez meses
//    · documentos faltantes -> 190.590 en SAP y 190.590 en los blobs, exacto
//  El dia a dia de febrero dejo 24 de 28 dias EXACTOS y el hueco casi entero
//  en el 2026-02-02 (-2.908). Los documentos estan todos: la perdida es
//  adentro de la linea.
//
//  LOS DOS CAMINOS MUDOS DE filasDeDocumento(). Una linea del item no aporta
//  filas, y no queda contada en ninguna parte, cuando:
//    a) ninguna de sus colecciones matchea RE_BIN (/bin|ubicac/i), o
//    b) la coleccion existe pero viene VACIA.
//  El contador de 'raros' solo cuenta BinActionType desconocido DENTRO de una
//  coleccion reconocida, asi que estos dos casos salen en cero y parecen que
//  no existen. Esta sonda los cuenta y les suma la cantidad.
//
//  SI ES (b), NO ES UN BUG NUESTRO. Significa que SAP movio el pallet a la
//  bodega sin asignarle ubicacion, y entonces la capa de ubicaciones no lo
//  puede ver por construccion. Seria la misma cosa que el residuo de 34.063
//  que ya medimos: pallets en la bodega sin ubicacion asignada.
//
//  Usa la MISMA deteccion de colecciones y la MISMA regla de delta que la
//  extraccion, importadas, no copiadas: si reimplementara cualquiera de las
//  dos estaria midiendo otra cosa.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-anatomia-linea.js --dia=2026-02-02
//    node backfill/sonda-anatomia-linea.js --dia=2026-02-02 --item=11111111110
//    node backfill/sonda-anatomia-linea.js --dia=2026-02-02 --conc=3 --pausa=200
//
//  Si SAP corta la conexion, bajar --conc y subir --pausa. Los reintentos ya
//  estan puestos y un documento que no se pueda leer no mata la corrida: se
//  cuenta, se nombra, y el veredicto avisa que el numero es una cota inferior.
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');
const SB = require('./sonda-sap-bin.js');        // que coleccion es "de ubicacion"
const B = require('./backfill-sap-bin.js');      // urlLista, urlPorClave, deltaDeAsignacion

const args = process.argv.slice(2);
const OPCIONES = ['dia', 'item', 'entidad', 'conc', 'pausa'];
const BANDERAS = [];
const opcion = (n, d) => {
  const p = '--' + n + '=';
  for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length);
  return d;
};
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** LA ANATOMIA DE UNA LINEA. Clasifica por que aporta o por que no, y arrastra
 *  la cantidad para poder decir cuantos pallets se pierden por cada causa. */
function anatomiaDeLinea(linea, item) {
  const l = linea || {};
  const esDelItem = !item || String(l.ItemCode == null ? '' : l.ItemCode) === String(item);
  const todas = SB.coleccionesAnidadas(l);
  const deBin = SB.coleccionesDeBin(todas);
  let asignaciones = 0, filas = 0, raros = 0, neto = 0;
  for (const col of deBin) {
    for (const a of (l[col.clave] || [])) {
      asignaciones++;
      const d = B.deltaDeAsignacion(a);
      if (d == null) raros++; else { filas++; neto += d; }
    }
  }
  let causa = null;
  if (!esDelItem) causa = 'otro item';
  else if (!deBin.length) causa = 'sin coleccion de ubicacion';
  else if (!asignaciones) causa = 'coleccion vacia';
  else if (!filas) causa = 'todas las asignaciones ilegibles';
  return { esDelItem, cantidad: Number(l.Quantity) || 0,
           colecciones: todas.map(c => c.clave), deBin: deBin.map(c => c.clave),
           asignaciones, filas, raros, neto, aporta: filas > 0, causa,
           desde: l.FromWarehouseCode || null, hacia: l.WarehouseCode || null };
}

/** El resumen del dia. Lo que importa es la columna de CANTIDAD de las lineas
 *  que no aportan: ese es el movimiento que SAP tiene y nosotros no. */
function resumirAnatomia(anatomias) {
  const a = (anatomias || []).filter(Boolean);
  const item = a.filter(x => x.esDelItem);
  const porCausa = new Map();
  for (const x of item) {
    if (x.aporta) continue;
    const k = x.causa || 'sin causa';
    const e = porCausa.get(k) || { causa: k, lineas: 0, cantidad: 0 };
    e.lineas++; e.cantidad += x.cantidad;
    porCausa.set(k, e);
  }
  const mudas = [...porCausa.values()].sort((x, y) => y.cantidad - x.cantidad);
  return { lineas: a.length, delItem: item.length,
           aportan: item.filter(x => x.aporta).length,
           mudas, lineasMudas: mudas.reduce((s, x) => s + x.lineas, 0),
           cantidadMuda: mudas.reduce((s, x) => s + x.cantidad, 0),
           filas: item.reduce((s, x) => s + x.filas, 0),
           raros: item.reduce((s, x) => s + x.raros, 0),
           neto: item.reduce((s, x) => s + x.neto, 0) };
}

/** Los nombres de coleccion que aparecen en lineas del item que NO aportan.
 *  Si RE_BIN se esta perdiendo una, el nombre va a estar aca. */
function coleccionesNoReconocidas(anatomias) {
  const m = new Map();
  for (const x of (anatomias || [])) {
    if (!x || !x.esDelItem) continue;
    // Una linea que aporta tiene filas, luego asignaciones, luego deBin no
    // vacio: el guardia de abajo ya la saca. Chequear x.aporta aca seria
    // repetir la misma condicion con otras palabras.
    if (x.deBin && x.deBin.length) continue;          // reconocida pero vacia: otro caso
    for (const c of (x.colecciones || [])) m.set(c, (m.get(c) || 0) + 1);
  }
  return [...m.entries()].map(([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n);
}

/** El veredicto. Con documentos fallidos la medicion es una COTA INFERIOR y
 *  hay que decirlo antes que nada: un numero incompleto presentado como
 *  completo es peor que no tenerlo. */
function veredicto(r, noRec, fallidos) {
  const f = Number(fallidos) || 0;
  const aviso = f ? 'OJO: ' + mil(f) + ' documento(s) no se pudieron leer, asi que todo lo que ' +
                    'sigue es una COTA INFERIOR. ' : '';
  if (!r || !r.delItem) return { nivel: 'sin datos',
    texto: aviso + 'Ninguna linea del item en ese dia.' };
  if (!r.lineasMudas) return { nivel: f ? 'revisar' : 'si', texto: aviso +
    'Las ' + mil(r.delItem) + ' lineas del item aportan filas. No se pierde nada adentro del ' +
    'documento, asi que el desajuste contra SAP viene de otro lado.' };
  const p = [aviso + mil(r.lineasMudas) + ' de ' + mil(r.delItem) + ' lineas del item NO aportan ninguna fila, ' +
             'y mueven ' + mil(r.cantidadMuda) + ' pallets que SAP si cuenta.'];
  for (const c of r.mudas)
    p.push('· ' + c.causa + ': ' + mil(c.lineas) + ' lineas, ' + mil(c.cantidad) + ' pallets.');
  if (noRec.length)
    p.push('Colecciones que aparecen en esas lineas y RE_BIN no reconoce: ' +
           noRec.slice(0, 6).map(x => x.clave + ' (' + x.n + ')').join(', ') + '.');
  else
    p.push('Ninguna coleccion sin reconocer: la deteccion por nombre esta bien. Entonces SAP ' +
           'movio el pallet a la bodega SIN asignarle ubicacion, y la capa de ubicaciones no lo ' +
           'puede ver por construccion. Es la misma cosa que el residuo que ya medimos.');
  return { nivel: 'no', texto: p.join('  ') };
}

module.exports = { anatomiaDeLinea, resumirAnatomia, coleccionesNoReconocidas, veredicto,
                   OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const falta = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', '));
    console.error('Se declaran en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const dia = opcion('dia', null);
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    console.error('Falta --dia=YYYY-MM-DD. Esta sonda mira un dia, no un mes:');
    console.error('  node backfill/sonda-anatomia-linea.js --dia=2026-02-02');
    process.exit(1);
  }
  const ITEM = opcion('item', '11111111110');
  const ENTIDAD = opcion('entidad', 'StockTransfers');
  const CONC = Math.max(1, Math.min(16, parseInt(opcion('conc', '6'), 10) || 6));
  const PAUSA = Math.max(0, parseInt(opcion('pausa', '0'), 10) || 0);
  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();

  console.log('Anatomia de linea   ·  ' + dia + '   ·  item ' + ITEM + '   ·  ' + ENTIDAD);
  console.log('SOLO LEE. Usa la misma deteccion de colecciones y la misma regla de delta');
  console.log('que la extraccion, importadas, no copiadas.\n');

  // fase 1: las claves del dia
  const claves = [];
  for (let skip = 0; ; skip += 200) {
    const r = await ses.get(B.urlLista(raiz, ENTIDAD, 'DocDate', dia, dia, 200, skip));
    if (r.status !== 200) { console.error('lista HTTP ' + r.status); process.exit(1); }
    const v = (r.json && r.json.value) || [];
    for (const d of v) claves.push(d.DocEntry);
    // se avanza por lo RECIBIDO, no por lo pedido: si el servidor devuelve
    // menos de lo que se le pidio, saltar de a 200 se come la diferencia
    if (v.length < 200) break;
  }
  console.log('  documentos del dia: ' + mil(claves.length));

  // fase 2: por clave, en tandas. Con reintentos —los de backfill-sap.js, no
  // una copia— y sin que un documento malo se lleve los otros 979.
  const anat = [];
  const fallidos = [];
  let hechos = 0;
  for (let i = 0; i < claves.length; i += CONC) {
    const tanda = claves.slice(i, i + CONC);
    const rs = await Promise.all(tanda.map(async k => {
      try { return { k, r: await S.conReintentos(() => ses.get(B.urlPorClave(raiz, ENTIDAD, k))) }; }
      catch (e) { return { k, error: String(e && e.message || e).slice(0, 60) }; }
    }));
    for (const x of rs) {
      hechos++;
      if (x.error) { fallidos.push({ DocEntry: x.k, error: x.error }); continue; }
      if (x.r.status !== 200 || !x.r.json) {
        fallidos.push({ DocEntry: x.k, error: 'HTTP ' + x.r.status }); continue;
      }
      const lineas = x.r.json.StockTransferLines || x.r.json.DocumentLines || [];
      for (const l of lineas) anat.push(anatomiaDeLinea(l, ITEM));
    }
    if (hechos % 200 < CONC) process.stdout.write('\r  leidos: ' + hechos + '/' + claves.length +
                                                  (fallidos.length ? '  (fallidos ' + fallidos.length + ')' : ''));
    if (PAUSA) await new Promise(r => setTimeout(r, PAUSA));
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  if (fallidos.length) {
    console.log('  documentos que no se pudieron leer: ' + mil(fallidos.length));
    for (const f of fallidos.slice(0, 5)) console.log('     DocEntry ' + f.DocEntry + ': ' + f.error);
  }

  const r = resumirAnatomia(anat);
  const noRec = coleccionesNoReconocidas(anat);

  console.log('\n── LAS LINEAS DEL DIA ' + '─'.repeat(52));
  console.log('  lineas totales            : ' + mil(r.lineas));
  console.log('  del item ' + ITEM + '      : ' + mil(r.delItem));
  console.log('  que aportan filas         : ' + mil(r.aportan));
  console.log('  MUDAS (no aportan nada)   : ' + mil(r.lineasMudas) +
              '   ·  ' + mil(r.cantidadMuda) + ' pallets');
  console.log('  filas generadas           : ' + mil(r.filas) + '   ·  neto ' + conSigno(r.neto));
  if (r.raros) console.log('  asignaciones ilegibles    : ' + mil(r.raros));

  if (r.mudas.length) {
    console.log('\n  por que no aportan:');
    for (const c of r.mudas)
      console.log('    ' + c.causa.padEnd(36) + mil(c.lineas).padStart(8) + ' lineas' +
                  mil(c.cantidad).padStart(10) + ' pallets');
  }
  if (noRec.length) {
    console.log('\n  colecciones que RE_BIN no reconoce, en lineas mudas:');
    for (const c of noRec.slice(0, 15)) console.log('    ' + c.clave.padEnd(40) + mil(c.n).padStart(8));
  }

  const v = veredicto(r, noRec, fallidos.length);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto + '\n');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
