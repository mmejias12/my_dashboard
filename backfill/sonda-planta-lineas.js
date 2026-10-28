// ============================================================================
//  backfill/sonda-planta-lineas.js  ·  M3DATA · el movimiento de PLANTA, que
//  hoy no tenemos
//
//  QUE CONTESTA. Si el documento de traspaso trae, por linea, la bodega de
//  donde sale el pallet y la bodega a donde entra. Si las trae, podemos medir
//  la planta —inspeccion, reparacion, pintura, disponible— con la corrida que
//  ya existe, y ademas dibujar la CADENA: cuantos pallets van de inspeccion a
//  reparacion y cuantos se van derecho a pintura.
//
//  POR QUE EXISTE. Las bodegas de planta NO manejan ubicaciones, y nuestra
//  extraccion solo guarda filas de asignacion de ubicacion. Resultado: de la
//  planta no tenemos ni un movimiento. Hoy ese dato hay que pedirselo a
//  Datawalt, que lee OINM — y OINM registra UNA FILA POR BODEGA, no por
//  traspaso: dice cuanto entro y cuanto salio de cada etapa, nunca de donde
//  vino. Medido en octubre: inspeccion despacha 75.432 y reparacion recibe
//  39.495, pero pintura recibe 83.895. Con los totales por nodo no se puede
//  decir cuanto de lo que sale de inspeccion va a cada lado.
//  Ademas la replica de Datawalt va atrasada: su 27-oct da CERO salidas en
//  una bodega que despacha ~4.000 pallets por dia, y reconstruir desde ahi
//  deja a SANTIAGO INSPECCION con apertura negativa, que es imposible.
//
//  NO ASUME LOS NOMBRES DE LOS CAMPOS. Seria facil escribir FromWarehouseCode
//  y WarehouseCode y dar por hecho que vienen llenos. Esta sonda hace al
//  reves: toma los codigos de bodega que ya conocemos —los de
//  data/bodegas-hoy.json, que escribe la sonda de bodegas— y busca CUALES
//  campos de la linea contienen uno de esos codigos. Si manana SAP cambia el
//  nombre del campo, o si en planta viene vacio, la sonda lo dice en vez de
//  devolver ceros silenciosos.
//
//  LA LEY QUE TIENE QUE CUMPLIR. Un traspaso tiene dos puntas: lo que sale de
//  una bodega entra en otra. Sumando el neto de TODAS las bodegas el total
//  tiene que dar cero. Lo que no cierre son lineas con una sola punta, y esas
//  se cuentan y se nombran aparte en vez de repartirlas.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-planta-lineas.js --dia=2026-10-27
//    node backfill/sonda-planta-lineas.js --dia=2026-10-27 --bodegas=data/bodegas-hoy.json
//    node backfill/sonda-planta-lineas.js --dia=2026-10-27 --conc=3 --pausa=200
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');
const B = require('./backfill-sap-bin.js');      // urlLista, urlPorClave: una regla, un lugar

const args = process.argv.slice(2);
const OPCIONES = ['dia', 'item', 'entidad', 'bodegas', 'conc', 'pausa', 'tope', 'desde', 'hacia'];
const BANDERAS = ['todas'];
const opcion = (n, d) => {
  const p = '--' + n + '=';
  for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length);
  return d;
};
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** Los codigos de bodega que ya conocemos. Salen del json que escribe
 *  sonda-oinm-bodega.js: no hay lista escrita a mano en ninguna parte. */
function codigosDeBodega(json) {
  const s = new Set();
  for (const b of ((json && json.bodegas) || [])) {
    // OJO con la precedencia: `b && b.whs == null ? ...` se lee como
    // `(b && (b.whs == null))`, y con b nulo cae al else y revienta.
    const w = (b && b.whs != null) ? String(b.whs).trim() : '';
    if (w) s.add(w);
  }
  return s;
}

/** QUE CAMPOS DE LA LINEA TRAEN UN CODIGO DE BODEGA.
 *
 *  Recorre las claves de primer nivel de cada linea y se queda con las que
 *  contienen un codigo conocido. Devuelve con que frecuencia aparece cada
 *  una y un par de valores de muestra, para poder elegir cual es el origen y
 *  cual el destino mirando el dato y no el nombre. */
function camposConBodega(lineas, conocidas) {
  const m = new Map();
  const set = conocidas instanceof Set ? conocidas : new Set(conocidas || []);
  for (const l of (lineas || [])) {
    if (!l || typeof l !== 'object') continue;
    for (const k of Object.keys(l)) {
      const v = l[k];
      if (typeof v !== 'string' || !set.has(v.trim())) continue;
      const e = m.get(k) || { campo: k, veces: 0, valores: new Set() };
      e.veces++;
      if (e.valores.size < 5) e.valores.add(v.trim());
      m.set(k, e);
    }
  }
  return [...m.values()]
    .map(e => ({ campo: e.campo, veces: e.veces, valores: [...e.valores].sort() }))
    .sort((a, b) => b.veces - a.veces || (a.campo < b.campo ? -1 : 1));
}

/** La arista de una linea: de donde sale y a donde entra, con su cantidad.
 *  Una punta ausente NO se inventa: queda en null y la linea se cuenta como
 *  de una sola punta, que es informacion y no un caso a tapar. */
function aristaDeLinea(linea, campoDesde, campoHacia, item) {
  const l = linea || {};
  if (item && String(l.ItemCode == null ? '' : l.ItemCode) !== String(item)) return null;
  const lee = c => {
    const v = c ? l[c] : null;
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  };
  const q = Number(l.Quantity);
  return { desde: lee(campoDesde), hacia: lee(campoHacia),
           cantidad: isFinite(q) ? q : 0 };
}

/** Las aristas del dia, agrupadas. Una arista es un par origen→destino. */
function aristasDeLineas(lineas, campoDesde, campoHacia, item) {
  const m = new Map();
  let unaPunta = 0, cantidadUnaPunta = 0, sinCantidad = 0;
  for (const l of (lineas || [])) {
    const a = aristaDeLinea(l, campoDesde, campoHacia, item);
    if (!a) continue;
    if (!a.cantidad) sinCantidad++;
    if (!a.desde || !a.hacia) { unaPunta++; cantidadUnaPunta += a.cantidad; }
    const k = (a.desde || '?') + '→' + (a.hacia || '?');
    const e = m.get(k) || { desde: a.desde, hacia: a.hacia, lineas: 0, cantidad: 0 };
    e.lineas++; e.cantidad += a.cantidad;
    m.set(k, e);
  }
  const aristas = [...m.values()].sort((x, y) => y.cantidad - x.cantidad ||
      ((x.desde || '') + (x.hacia || '') < (y.desde || '') + (y.hacia || '') ? -1 : 1));
  return { aristas, unaPunta, cantidadUnaPunta, sinCantidad,
           lineas: aristas.reduce((s, x) => s + x.lineas, 0) };
}

/** El neto por bodega que implican las aristas. Esto es lo que hoy nos falta:
 *  cuanto se movio cada etapa de planta en el dia. */
function netoPorBodega(aristas) {
  const m = new Map();
  const toca = (w, campo, q) => {
    if (!w) return;
    const e = m.get(w) || { bodega: w, entra: 0, sale: 0 };
    e[campo] += q;
    m.set(w, e);
  };
  for (const a of (aristas || [])) {
    if (!a) continue;
    const q = Number(a.cantidad) || 0;
    toca(a.desde, 'sale', q);
    toca(a.hacia, 'entra', q);
  }
  return [...m.values()]
    .map(e => ({ ...e, neto: e.entra - e.sale }))
    .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto) || (a.bodega < b.bodega ? -1 : 1));
}

/** LA LEY DE LAS DOS PUNTAS. Sumando el neto de todas las bodegas tiene que
 *  dar cero: lo que sale de una entra en otra. Lo que sobre es exactamente el
 *  movimiento de las lineas a las que les falta una punta. */
function leyDeDosPuntas(netos, cantidadUnaPunta) {
  const suma = (netos || []).reduce((s, x) => s + (Number(x && x.neto) || 0), 0);
  const esperado = Number(cantidadUnaPunta) || 0;
  return { suma, cumple: suma === 0,
           explicadoPorUnaPunta: Math.abs(suma) <= esperado };
}

function veredicto(campos, r, ley) {
  const c = campos || [];
  if (!c.length) return { nivel: 'no',
    texto: 'Ninguna linea trae un codigo de bodega conocido. O el dia no tiene ' +
           'movimiento, o el campo se llama de otra forma y no contiene el codigo: ' +
           'en cualquier caso, la planta NO se puede medir desde la linea.' };
  if (c.length < 2) return { nivel: 'revisar',
    texto: 'Las lineas traen UNA sola punta (' + c[0].campo + '). Con una punta se ' +
           'puede saber cuanto entro o salio de cada bodega, pero no la cadena: ' +
           'de donde vino cada pallet queda sin responder.' };
  const p = ['Las lineas traen las dos puntas: ' + c[0].campo + ' y ' + c[1].campo +
             '. La planta se puede medir desde la corrida diaria, sin fuente nueva.'];
  if (r && r.unaPunta)
    p.push(mil(r.unaPunta) + ' linea(s) con una sola punta, ' + mil(r.cantidadUnaPunta) +
           ' pallets: son movimientos contra algo que no es una bodega conocida.');
  if (ley && !ley.cumple)
    p.push('OJO: el neto de todas las bodegas da ' + conSigno(ley.suma) + ' en vez de cero' +
           (ley.explicadoPorUnaPunta ? ', y lo explican las lineas de una punta.'
                                     : ', y las lineas de una punta NO alcanzan a explicarlo.'));
  return { nivel: (ley && ley.cumple) || (ley && ley.explicadoPorUnaPunta) ? 'si' : 'revisar',
           texto: p.join('  ') };
}

module.exports = { codigosDeBodega, camposConBodega, aristaDeLinea, aristasDeLineas,
                   netoPorBodega, leyDeDosPuntas, veredicto, OPCIONES, BANDERAS };

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
    console.error('Falta --dia=YYYY-MM-DD'); process.exit(1);
  }
  const ITEM = opcion('item', '11111111110');
  const ENTIDAD = opcion('entidad', 'StockTransfers');
  const CONC = Math.max(1, Math.min(16, parseInt(opcion('conc', '6'), 10) || 6));
  const PAUSA = Math.max(0, parseInt(opcion('pausa', '0'), 10) || 0);
  const TOPE = Math.max(1, parseInt(opcion('tope', '25'), 10) || 25);

  const fs = require('fs');
  const rutaBod = opcion('bodegas', 'data/bodegas-hoy.json');
  let conocidas = new Set(), nombre = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(rutaBod, 'utf8').replace(/^﻿/, ''));
    conocidas = codigosDeBodega(j);
    for (const b of (j.bodegas || [])) if (b && b.whs) nombre.set(String(b.whs).trim(), b.nombre || '');
  } catch (e) {
    console.error('No se pudo leer ' + rutaBod + ': ' + e.message);
    console.error('Corre antes: node backfill/sonda-oinm-bodega.js --salida=data/bodegas-hoy.json');
    process.exit(1);
  }

  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();
  console.log('Sonda de lineas de planta   ·  ' + dia + '   ·  item ' + ITEM + '   ·  ' + ENTIDAD);
  console.log('Raiz: ' + raiz + '   ·  base ' + process.env.SAP_DB);
  console.log('SOLO LEE. Busca los campos de bodega por su CONTENIDO, no por su nombre.');
  console.log('Bodegas conocidas: ' + conocidas.size + '   (de ' + rutaBod + ')\n');

  const claves = [];
  for (let skip = 0; ; skip += 200) {
    const r = await ses.get(B.urlLista(raiz, ENTIDAD, 'DocDate', dia, dia, 200, skip));
    if (r.status !== 200) { console.error('lista HTTP ' + r.status); process.exit(1); }
    const v = (r.json && r.json.value) || [];
    for (const d of v) claves.push(d.DocEntry);
    if (v.length < 200) break;      // se avanza por lo RECIBIDO, no por lo pedido
  }
  console.log('  documentos del dia: ' + mil(claves.length));

  const lineas = [], fallidos = [];
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
      for (const l of (x.r.json.StockTransferLines || x.r.json.DocumentLines || [])) lineas.push(l);
    }
    if (hechos % 200 < CONC) process.stdout.write('\r  leidos: ' + hechos + '/' + claves.length);
    if (PAUSA) await new Promise(r => setTimeout(r, PAUSA));
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  if (fallidos.length) {
    console.log('  documentos que no se pudieron leer: ' + mil(fallidos.length) +
                '   ← lo que sigue es una cota inferior');
    for (const f of fallidos.slice(0, 5)) console.log('     DocEntry ' + f.DocEntry + ': ' + f.error);
  }
  console.log('  lineas leidas: ' + mil(lineas.length) + '\n');

  const campos = camposConBodega(lineas, conocidas);
  console.log('── LOS CAMPOS DE LA LINEA QUE TRAEN UNA BODEGA ' + '─'.repeat(27));
  if (!campos.length) console.log('  ninguno');
  for (const c of campos)
    console.log('  ' + c.campo.padEnd(26) + mil(c.veces).padStart(8) + ' lineas   ·  ej: ' +
                c.valores.slice(0, 3).join(', '));

  const campoDesde = opcion('desde', campos[1] ? campos[1].campo : null);
  const campoHacia = opcion('hacia', campos[0] ? campos[0].campo : null);
  console.log('\n  tomando ORIGEN = ' + (campoDesde || '(ninguno)') +
              '   ·  DESTINO = ' + (campoHacia || '(ninguno)'));

  const r = aristasDeLineas(lineas, campoDesde, campoHacia, ITEM);
  const netos = netoPorBodega(r.aristas);
  const ley = leyDeDosPuntas(netos, r.cantidadUnaPunta);

  console.log('\n── LA CADENA DEL DIA ' + '─'.repeat(53));
  console.log('  ' + 'origen'.padEnd(12) + 'destino'.padEnd(12) + 'lineas'.padStart(8) + 'pallets'.padStart(11));
  for (const a of r.aristas.slice(0, bandera('todas') ? r.aristas.length : TOPE))
    console.log('  ' + String(a.desde || '(fuera)').padEnd(12) + String(a.hacia || '(fuera)').padEnd(12) +
                mil(a.lineas).padStart(8) + mil(a.cantidad).padStart(11));
  if (!bandera('todas') && r.aristas.length > TOPE)
    console.log('  ... y ' + (r.aristas.length - TOPE) + ' mas (--todas)');

  console.log('\n── EL MOVIMIENTO DE CADA BODEGA ' + '─'.repeat(42));
  console.log('  ' + 'bodega'.padEnd(12) + 'nombre'.padEnd(26) + 'entra'.padStart(10) +
              'sale'.padStart(10) + 'neto'.padStart(10));
  for (const n of netos)
    console.log('  ' + n.bodega.padEnd(12) + String(nombre.get(n.bodega) || '').slice(0, 25).padEnd(26) +
                mil(n.entra).padStart(10) + mil(n.sale).padStart(10) + conSigno(n.neto).padStart(10));

  console.log('\n  ley de las dos puntas: la suma de todos los netos deberia dar 0');
  console.log('    suma: ' + conSigno(ley.suma) +
              (ley.cumple ? '   ← cumple'
                          : '   ·  lineas con una sola punta: ' + mil(r.unaPunta) +
                            ' (' + mil(r.cantidadUnaPunta) + ' pallets)'));

  const v = veredicto(campos, r, ley);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto + '\n');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
