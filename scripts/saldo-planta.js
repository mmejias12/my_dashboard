// ============================================================================
//  scripts/saldo-planta.js  ·  M3DATA · el stock de PLANTA, dia por dia
//
//  QUE CONTESTA. Cuanto pallet hay en cada etapa de planta —inspeccion,
//  reparacion, pintura, disponible— al CIERRE de cada dia, y por donde paso
//  para llegar ahi. O sea: como se disponibiliza el pallet.
//
//  POR QUE NO EXISTIA. Las bodegas de planta no manejan ubicaciones, y la
//  extraccion solo guardaba filas de asignacion de ubicacion: de la planta no
//  teniamos un solo movimiento. Habia que pedirselo a Datawalt, que lee OINM
//  y registra UNA FILA POR BODEGA sin decir de donde vino el pallet —asi que
//  la cadena no se podia dibujar— y encima con la replica atrasada: su
//  27-oct daba CERO salidas en una bodega que despacha 4.000 por dia.
//  Desde el 28-oct-2026 la extraccion guarda el movimiento de bodega por
//  linea en lineasbod/<mes>.json, y esto lo lee.
//
//  EL CIERRE ES AL TERMINO DEL DIA, no a la hora de la corrida. En SAP la
//  fecha del movimiento es FECHA, sin hora: restando del nivel de hoy todos
//  los movimientos posteriores a un dia queda el cierre de ese dia completo,
//  se hayan posteado a las 9 o a las 23. La consecuencia hay que decirla: el
//  cierre de un dia queda FIRME recien al dia siguiente. El ultimo dia de la
//  serie es el dia en curso y va marcado como parcial.
//
//  LA APERTURA DE UN DIA ES EL CIERRE DEL ANTERIOR, por construccion. Se
//  declara igual, para que la igualdad se pueda ver y no haya que creerla.
//
//  SOLO LEE. No escribe en SAP; escribe un json local si se le pide.
//
//  Credenciales SOLO por variable de entorno.
//      OS_STORAGE_CONN
//
//  Uso (PowerShell):
//    node scripts/saldo-planta.js --meses=2026-10
//    node scripts/saldo-planta.js --meses=2026-09,2026-10 --json=data/planta.json
//    node scripts/saldo-planta.js --meses=2026-10 --bodegas=data/bodegas-hoy.json
// ============================================================================
'use strict';

const P = require('./saldo-pool.js');                          // cierreDelDia, sinBom
const A = require('./armar-tablero-stock.js');                 // NUEVE: una regla, un lugar
const L = require('../backfill/sonda-planta-lineas.js');       // netoPorBodega, leyDeDosPuntas

const args = process.argv.slice(2);
const OPCIONES = ['meses', 'bodegas', 'json', 'tope', 'contraste'];
const BANDERAS = ['cadena'];
const opcion = (n, d) => { const p = '--' + n + '='; for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length); return d; };
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** LAS BODEGAS DE PLANTA SON "TODO LO DEMAS", no una lista.
 *
 *  Clientes y retail estan afuera porque tienen ubicaciones y ya se miden por
 *  socio. El resto es REDTEC. Definirlo por exclusion y no por lista es lo
 *  que hace que una bodega nueva entre sola el dia que aparezca, en vez de
 *  quedarse invisible hasta que alguien se acuerde de agregarla. */
function bodegasDePlanta(bodegasHoy) {
  const out = [];
  for (const b of ((bodegasHoy && bodegasHoy.bodegas) || [])) {
    const whs = (b && b.whs != null) ? String(b.whs).trim() : '';
    if (!whs || whs === 'CLIENTES' || whs === 'RETAIL') continue;
    out.push({ whs, nombre: String((b && b.nombre) || whs),
               nivel: Number(b && b.saldo) || 0, indicador: A.NUEVE.has(whs) });
  }
  return out.sort((x, y) => y.nivel - x.nivel || (x.whs < y.whs ? -1 : 1));
}

/** EL MOVIMIENTO DE UNA BODEGA, DIA POR DIA, desde las lineas.
 *
 *  Misma forma que la serie de saldo-pool —dia, entradas, salidas, neto— para
 *  que cierreDelDia() sirva igual para las dos y la caminata hacia atras no
 *  este escrita dos veces. */
function movimientoDeBodega(lineas, whs) {
  const w = String(whs == null ? '' : whs).trim();
  const m = new Map();
  // Sin guardia para w vacio a proposito: una bodega vacia no calza con
  // ninguna punta y el bucle devuelve la lista vacia solo. Un if aparte seria
  // codigo que nunca decide nada.
  for (const l of (lineas || [])) {
    if (!l) continue;
    const d = String(l.DocDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const q = Number(l.cantidad) || 0;
    const entra = l.hacia === w, sale = l.desde === w;
    if (!entra && !sale) continue;
    const e = m.get(d) || { dia: d, entradas: 0, salidas: 0, neto: 0, lineas: 0 };
    // Una linea de la bodega a si misma —un traspaso interno— entra y sale: no
    // mueve el nivel y no tiene por que ensuciar ni entradas ni salidas.
    if (entra && sale) { e.lineas++; m.set(d, e); continue; }
    if (entra) { e.entradas += q; e.neto += q; } else { e.salidas += q; e.neto -= q; }
    e.lineas++;
    m.set(d, e);
  }
  return [...m.values()].sort((a, b) => a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0);
}

/** MARCA CUAL CIERRE ES FIRME. El de un dia ya pasado lo es; el del dia en
 *  curso no, porque todavia le pueden entrar movimientos. Decirlo es la
 *  diferencia entre un cierre y una foto de las cinco de la tarde. */
function marcarFirmes(serie, fechaAncla) {
  const f = String(fechaAncla || '').slice(0, 10);
  return (serie || []).map(d => ({ ...d, firme: /^\d{4}-\d{2}-\d{2}$/.test(f) ? d.dia < f : null }));
}

/** LA CADENA: las aristas que tocan la planta, partidas en tres.
 *
 *  Adentro son los pasos entre etapas —lo que responde como se disponibiliza
 *  el pallet—. Las que entran y las que salen son la frontera con clientes y
 *  retail. Mezclarlas daria un numero mas grande que no significa nada. */
function cadenaDePlanta(lineas, conjunto) {
  const s = conjunto instanceof Set ? conjunto : new Set(conjunto || []);
  const m = new Map();
  let sinFecha = 0;
  for (const l of (lineas || [])) {
    if (!l) continue;
    // Misma puerta que movimientoDeBodega: una linea sin fecha utilizable no
    // se puede poner en ningun dia. Si la cadena la contara igual, los totales
    // de las dos vistas no cerrarian y nadie sabria por que.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.DocDate || '').slice(0, 10))) { sinFecha++; continue; }
    const dentroD = l.desde != null && s.has(l.desde);
    const dentroH = l.hacia != null && s.has(l.hacia);
    if (!dentroD && !dentroH) continue;
    const tipo = dentroD && dentroH ? 'adentro' : (dentroH ? 'entra' : 'sale');
    const k = tipo + '|' + (l.desde || '(fuera)') + '|' + (l.hacia || '(fuera)');
    const e = m.get(k) || { tipo, desde: l.desde, hacia: l.hacia, lineas: 0, cantidad: 0 };
    e.lineas++; e.cantidad += Number(l.cantidad) || 0;
    m.set(k, e);
  }
  const todas = [...m.values()].sort((a, b) => b.cantidad - a.cantidad ||
      ((a.desde || '') + (a.hacia || '') < (b.desde || '') + (b.hacia || '') ? -1 : 1));
  const suma = t => todas.filter(x => x.tipo === t).reduce((a, x) => a + x.cantidad, 0);
  return { aristas: todas, adentro: suma('adentro'), entra: suma('entra'), sale: suma('sale'), sinFecha };
}

/** UN NIVEL NEGATIVO ES IMPOSIBLE y es el unico control que encuentra un
 *  error sin segunda fuente: una bodega no puede tener menos de cero. */
function nivelesImposibles(series) {
  const out = [];
  for (const s of (series || [])) {
    let peor = null;
    for (const d of (s.dias || [])) if (peor === null || d.cierre < peor.cierre) peor = d;
    if (peor && peor.cierre < 0) out.push({ whs: s.whs, nombre: s.nombre, cierre: peor.cierre, dia: peor.dia });
  }
  return out.sort((a, b) => a.cierre - b.cierre);
}

function veredicto(series, imposibles, ley) {
  const p = [];
  if (!series || !series.length)
    return { nivel: 'sin datos', texto: 'No hay bodegas de planta con movimiento en la ventana pedida.' };
  if (imposibles && imposibles.length)
    p.push(imposibles.length + ' bodega(s) con nivel NEGATIVO en algun dia: ' +
           imposibles.slice(0, 4).map(x => x.whs + ' (' + mil(x.cierre) + ' el ' + x.dia + ')').join(', ') +
           '. Una bodega no puede tener menos de cero: falta movimiento o sobra una linea.');
  if (ley && !ley.cumple && !ley.explicadoPorUnaPunta)
    p.push('La suma de los netos de TODAS las bodegas da ' + conSigno(ley.suma) +
           ' en vez de cero, y las lineas de una sola punta no alcanzan a explicarlo.');
  if (!p.length)
    return { nivel: 'si', texto: 'Las ' + series.length + ' bodegas de planta cierran dia a dia sin ' +
             'niveles imposibles, y lo que sale de una bodega entra en otra.' };
  return { nivel: 'revisar', texto: p.join('  ') };
}

module.exports = { bodegasDePlanta, movimientoDeBodega, marcarFirmes, cadenaDePlanta,
                   nivelesImposibles, veredicto, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const malas = args.filter(x => String(x).startsWith('--') &&
    !OPCIONES.some(o => String(x).startsWith('--' + o + '=')) && !BANDERAS.some(o => x === '--' + o));
  if (malas.length) { console.error('Opcion no reconocida: ' + malas.join('  ')); process.exit(1); }
  if (!process.env.OS_STORAGE_CONN) {
    console.error('Falta la variable de entorno: OS_STORAGE_CONN');
    console.error('Se declara en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const fs = require('fs');
  const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
  const meses = String(opcion('meses', '')).split(',').map(x => x.trim()).filter(Boolean);
  if (!meses.length) { console.error('Falta --meses=YYYY-MM[,YYYY-MM]'); process.exit(1); }
  const TOPE = Math.max(1, parseInt(opcion('tope', '20'), 10) || 20);

  const rutaBod = opcion('bodegas', 'data/bodegas-hoy.json');
  let bod;
  try { bod = JSON.parse(P.sinBom(fs.readFileSync(rutaBod, 'utf8'))); }
  catch (e) {
    console.error('No se pudo leer ' + rutaBod + ': ' + e.message);
    console.error('Corre antes: node backfill/sonda-oinm-bodega.js --salida=data/bodegas-hoy.json');
    process.exit(1);
  }
  const planta = bodegasDePlanta(bod);
  const fechaAncla = String(bod.generado || '').slice(0, 10);

  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  console.log('Stock de planta dia por dia   ·  meses ' + meses.join(', '));
  console.log('Ancla: ' + rutaBod + ' · leida ' + (bod.generado || '?') + '   ·  ' +
              planta.length + ' bodegas de planta');
  console.log('SOLO LEE. El cierre de cada dia es al TERMINO del dia; el del dia en curso va marcado.\n');

  let lineas = [];
  for (const mes of meses) {
    const nombre = 'lineasbod/' + mes + '.json';
    const b = cc.getBlobClient(nombre);
    if (!await b.exists()) {
      console.error('No esta ' + CONT + '/' + nombre + '.');
      console.error('  Ese mes se extrajo antes de que se guardaran las lineas de bodega.');
      console.error('  Corre: node backfill/backfill-sap-bin.js ' + mes + ' ' + mes + ' --forzar');
      process.exit(1);
    }
    const j = JSON.parse((await b.downloadToBuffer()).toString('utf8'));
    const n = (j && j.lineas) || [];
    console.log('  ' + nombre + ': ' + mil(n.length) + ' lineas   ·  extraido ' +
                String(j._guardado || '?').slice(0, 16).replace('T', ' '));
    lineas = lineas.concat(n);
  }
  console.log('  total: ' + mil(lineas.length) + ' lineas de bodega\n');

  const conjunto = new Set(planta.map(x => x.whs));
  const series = [];
  for (const b of planta) {
    const mov = movimientoDeBodega(lineas, b.whs);
    if (!mov.length && !b.nivel) continue;
    series.push({ whs: b.whs, nombre: b.nombre, indicador: b.indicador, nivel: b.nivel,
                  dias: marcarFirmes(P.cierreDelDia(mov, b.nivel), fechaAncla) });
  }

  const ultimoFirme = (s) => {
    const f = (s.dias || []).filter(d => d.firme);
    return f.length ? f[f.length - 1] : null;
  };
  console.log('── EL CIERRE FIRME MAS RECIENTE ' + '─'.repeat(42));
  let nueve = 0, resto = 0, diaFirme = null;
  for (const s of series) {
    const u = ultimoFirme(s);
    if (u) { diaFirme = diaFirme && diaFirme > u.dia ? diaFirme : u.dia; }
    const v = u ? u.cierre : s.nivel;
    if (s.indicador) nueve += v; else resto += v;
  }
  console.log('  al cierre del ' + (diaFirme || '?') + '   ·  indicador de planta: ' + mil(nueve) +
              '   ·  fuera del indicador: ' + mil(resto));
  console.log('  ' + 'bodega'.padEnd(12) + 'nombre'.padEnd(24) + 'cierre'.padStart(10) +
              'hoy'.padStart(10) + '   ');
  for (const s of series) {
    const u = ultimoFirme(s);
    console.log('  ' + (s.indicador ? '* ' : '  ') + s.whs.padEnd(10) + s.nombre.slice(0, 23).padEnd(24) +
                (u ? mil(u.cierre) : '—').padStart(10) + mil(s.nivel).padStart(10));
  }

  for (const s of series) {
    if (!s.dias.length) continue;
    console.log('\n── ' + s.whs + ' · ' + s.nombre + ' ' + '─'.repeat(Math.max(0, 50 - s.nombre.length)));
    console.log('  ' + 'dia'.padEnd(13) + 'apertura'.padStart(10) + 'entradas'.padStart(10) +
                'salidas'.padStart(10) + 'cierre'.padStart(10));
    for (const d of s.dias.slice(-TOPE))
      console.log('  ' + d.dia.padEnd(13) + mil(d.apertura).padStart(10) + mil(d.entradas).padStart(10) +
                  mil(d.salidas).padStart(10) + mil(d.cierre).padStart(10) +
                  (d.firme === false ? '   ← dia en curso, parcial' : ''));
  }

  if (bandera('cadena')) {
    const c = cadenaDePlanta(lineas, conjunto);
    console.log('\n── LA CADENA ' + '─'.repeat(61));
    console.log('  entra a planta: ' + mil(c.entra) + '   ·  entre etapas: ' + mil(c.adentro) +
                '   ·  sale de planta: ' + mil(c.sale) +
                (c.sinFecha ? '   ·  ' + mil(c.sinFecha) + ' linea(s) sin fecha utilizable, fuera' : ''));
    console.log('  ' + 'tipo'.padEnd(10) + 'origen'.padEnd(12) + 'destino'.padEnd(12) +
                'lineas'.padStart(8) + 'pallets'.padStart(11));
    for (const a of c.aristas.slice(0, TOPE))
      console.log('  ' + a.tipo.padEnd(10) + String(a.desde || '(fuera)').padEnd(12) +
                  String(a.hacia || '(fuera)').padEnd(12) + mil(a.lineas).padStart(8) +
                  mil(a.cantidad).padStart(11));
  }

  // CONTRASTE: el mismo calculo sobre RETAIL, que ya medimos por otro camino.
  // Si no calza, lo de planta tampoco vale, y es mejor saberlo aca.
  const ruta = opcion('contraste', 'data/stock-retail.json');
  try {
    const sr = JSON.parse(P.sinBom(fs.readFileSync(ruta, 'utf8')));
    const mov = movimientoDeBodega(lineas, 'RETAIL');
    const porDia = new Map(mov.map(d => [d.dia, d]));
    let comparados = 0, distintos = [];
    for (const d of (sr.dias || [])) {
      const m = porDia.get(d.dia);
      if (!m) continue;
      comparados++;
      if (m.neto !== d.neto) distintos.push({ dia: d.dia, lineas: m.neto, ubicaciones: d.neto });
    }
    console.log('\n── CONTRASTE CONTRA LA CAPA DE UBICACIONES ' + '─'.repeat(31));
    console.log('  RETAIL, ' + mil(comparados) + ' dia(s) comparados contra ' + ruta);
    if (!distintos.length) console.log('  los ' + mil(comparados) + ' dias dan el mismo neto por los dos caminos');
    else {
      console.log('  ' + mil(distintos.length) + ' dia(s) NO calzan:');
      for (const x of distintos.slice(0, 10))
        console.log('     ' + x.dia + '   lineas ' + conSigno(x.lineas) + '   ubicaciones ' + conSigno(x.ubicaciones));
    }
  } catch (e) { console.log('\n  (sin contraste: no se pudo leer ' + ruta + ')'); }

  const ley = L.leyDeDosPuntas(L.netoPorBodega(lineas), 0);
  const imp = nivelesImposibles(series);
  const v = veredicto(series, imp, ley);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);

  const salida = opcion('json', null);
  if (salida) {
    fs.writeFileSync(salida, JSON.stringify({
      _que_es: 'Stock de planta por bodega y por dia. El cierre de cada dia es al termino del dia; ' +
               'el del dia en curso va con firme:false porque todavia le pueden entrar movimientos.',
      generado: new Date().toISOString(), ancla: bod.generado || null, meses,
      indicador: nueve, fueraDelIndicador: resto, cierreFirme: diaFirme,
      bodegas: series, cadena: cadenaDePlanta(lineas, conjunto).aristas,
    }, null, 1), 'utf8');
    console.log('\n  escrito: ' + salida);
  }
  console.log('');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
