// ============================================================================
//  scripts/medir-tarifas-sap.js  ·  M3DATA
//
//  LA PREGUNTA QUE RESPONDE, Y POR QUE ES LA PRIMERA
//  En los documentos de SAP la tarifa viene estampada por documento en
//  U_HX_RD_TarifaCli, y eso prometeria medir el descalce de la cartola
//  documento por documento en vez de reconstruirlo desde el total ya neteado.
//  Pero antes de construir NADA encima hay que saber si esa tarifa es la del
//  contrato. La prueba es simple: si para un mismo cliente y un mismo concepto
//  la tarifa es UNA sola todo el mes, es la del contrato. Si varia, es otra
//  cosa y hay que entender que antes de usarla.
//
//  Las tarifas vistas en muestras sueltas fueron 0,07 (Frutale, transferencia),
//  0,03724 (Cambiaso, transferencia), 0,035 (Good Food, confirmacion) y 0,018
//  (Walmart) — y el 0,02662 de IPA que tenemos del maestro de contratos queda
//  muy por debajo del 0,07. Con una fila no se concluye nada: por eso esto
//  cuenta TODO el mes.
//
//  NO TOCA SAP. Lee el blob que ya escribio backfill/backfill-sap.js, asi que
//  se puede correr las veces que haga falta sin pegarle al ERP de produccion.
//
//  Requiere en el entorno:
//      OS_STORAGE_CONN
//
//  Uso (PowerShell, desde la raiz del repo):
//    node scripts/medir-tarifas-sap.js --mes=2026-09
//    node scripts/medir-tarifas-sap.js --mes=2026-09 --tope=30
//    node scripts/medir-tarifas-sap.js --desde=2026-07 --hasta=2026-09
//
//  Deja un CSV con el detalle cliente x concepto x tarifa (punto y coma y BOM,
//  para que Excel en es-CL lo abra sin pelear). Es un archivo de trabajo: no
//  va al repo.
// ============================================================================
'use strict';

const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';

const args   = process.argv.slice(2);
const opcion = (n, def) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : def; };

const ENTIDAD = opcion('entidad', 'StockTransfers');
const TOPE    = Math.max(1, parseInt(opcion('tope', '20'), 10) || 20);

const fmt  = n => Number(n).toLocaleString('es-CL');
const uf   = n => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
const dosD = n => String(n).padStart(2, '0');

function listarMeses(desde, hasta) {
  const out = [];
  let [a, m] = desde.split('-').map(Number);
  const [aF, mF] = hasta.split('-').map(Number);
  while (a < aF || (a === aF && m <= mF)) { out.push(a + '-' + dosD(m)); m++; if (m > 12) { m = 1; a++; } }
  return out;
}

// ── agregacion (pura, para poder probarla sin Azure) ────────────────────────
//
// Tres niveles, y cada uno responde algo distinto:
//   porTarifa  cliente x concepto x tarifa  -> el detalle que va al CSV
//   porCombo   cliente x concepto           -> CUANTAS tarifas distintas tiene
//   porTipo    concepto                     -> el total en UF, comparable con
//                                              el netoUF de la cartola
function agregar(filas) {
  const porTarifa = new Map();
  const porCombo  = new Map();
  const porTipo   = new Map();
  const monedas   = new Map();
  const docsVistos = new Set();
  let sinTarifa = 0, sinCantidad = 0;

  for (const f of filas) {
    const cod  = String(f.CardCode || '(sin codigo)');
    const nom  = String(f.CardName || '(sin nombre)').trim();
    const tipo = String(f.U_HX_RD_TransType || '(sin tipo)').trim();
    const ori  = String(f.FromWarehouse || '').trim();
    const des  = String(f.ToWarehouse || '').trim();
    const cant = Number(f.Quantity) || 0;
    const tieneTarifa = f.U_HX_RD_TarifaCli !== undefined && f.U_HX_RD_TarifaCli !== null;
    const tar  = tieneTarifa ? Number(f.U_HX_RD_TarifaCli) : null;

    if (!tieneTarifa) sinTarifa++;
    if (!cant) sinCantidad++;

    const mon = String(f.U_HX_RD_Moneda || '(sin moneda)').trim();
    monedas.set(mon, (monedas.get(mon) || 0) + 1);

    // La tarifa vive en la CABECERA y la cantidad en la LINEA, asi que las UF
    // del movimiento son cantidad x tarifa fila por fila.
    const ufFila = (tar === null) ? 0 : cant * tar;

    const kT = cod + '|' + tipo + '|' + ori + '>' + des + '|' + (tar === null ? 'null' : tar);
    let rT = porTarifa.get(kT);
    if (!rT) { rT = { cod, nom, tipo, ori, des, tar, docs: new Set(), filas: 0, cant: 0, uf: 0 }; porTarifa.set(kT, rT); }
    rT.filas++; rT.cant += cant; rT.uf += ufFila;
    if (f.DocEntry != null) rT.docs.add(f.DocEntry);

    const kC = cod + '|' + tipo;
    let rC = porCombo.get(kC);
    if (!rC) { rC = { cod, nom, tipo, tarifas: new Map(), filas: 0, cant: 0, uf: 0 }; porCombo.set(kC, rC); }
    rC.filas++; rC.cant += cant; rC.uf += ufFila;
    const claveTar = (tar === null ? 'null' : String(tar));
    rC.tarifas.set(claveTar, (rC.tarifas.get(claveTar) || 0) + 1);

    let rP = porTipo.get(tipo);
    if (!rP) { rP = { tipo, filas: 0, cant: 0, uf: 0, clientes: new Set() }; porTipo.set(tipo, rP); }
    rP.filas++; rP.cant += cant; rP.uf += ufFila; rP.clientes.add(cod);

    if (f.DocEntry != null) docsVistos.add(f.DocEntry);
  }

  return { porTarifa, porCombo, porTipo, monedas, sinTarifa, sinCantidad, docs: docsVistos.size };
}

/** El veredicto: de los combos cliente x concepto, cuantos tienen UNA sola
 *  tarifa. Es la unica pregunta que decide si se puede seguir. */
function veredicto(porCombo) {
  const unaSola = [], varias = [], soloNull = [];
  for (const r of porCombo.values()) {
    const claves = [...r.tarifas.keys()];
    const conValor = claves.filter(k => k !== 'null');
    if (!conValor.length) soloNull.push(r);
    else if (conValor.length === 1 && claves.length === 1) unaSola.push(r);
    else varias.push(r);
  }
  varias.sort((a, b) => b.filas - a.filas);
  return { unaSola, varias, soloNull, total: porCombo.size };
}

// ── main ────────────────────────────────────────────────────────────────────
async function leerMes(cc, mes) {
  const nombre = ENTIDAD.toLowerCase() + '/' + mes + '.json';
  const b = cc.getBlobClient(nombre);
  if (!(await b.exists())) return null;
  const buf = await b.downloadToBuffer();
  return JSON.parse(buf.toString('utf8'));
}

async function main() {
  if (!process.env.OS_STORAGE_CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  const unico = opcion('mes', null);
  const meses = unico ? [unico] : listarMeses(opcion('desde', '2026-09'), opcion('hasta', '2026-09'));

  const filas = [];
  const leidos = [];
  for (const mes of meses) {
    const j = await leerMes(cc, mes);
    if (!j) { console.log('  (sin blob para ' + mes + ')'); continue; }
    leidos.push(mes + ' · ' + fmt(j._filas || (j.filas || []).length) + ' filas');
    for (const f of (j.filas || [])) filas.push(f);
  }
  if (!filas.length) { console.error('No se leyo ninguna fila. Revisar entidad/mes.'); process.exit(1); }

  console.log('\nFuente: ' + CONT + '/' + ENTIDAD.toLowerCase() + '  ·  ' + leidos.join('  |  '));
  console.log('Filas leidas: ' + fmt(filas.length) + '\n');

  const ag = agregar(filas);
  const v  = veredicto(ag.porCombo);

  console.log('── Monedas ' + '─'.repeat(50));
  for (const [m, n] of [...ag.monedas].sort((a, b) => b[1] - a[1])) console.log('  ' + m + '  ' + fmt(n) + ' filas');
  if (ag.sinTarifa)   console.log('  filas SIN tarifa   : ' + fmt(ag.sinTarifa));
  if (ag.sinCantidad) console.log('  filas con cantidad 0: ' + fmt(ag.sinCantidad));

  console.log('\n── Por concepto ' + '─'.repeat(46));
  console.log('  ' + 'concepto'.padEnd(26) + 'filas'.padStart(8) + 'cantidad'.padStart(12) +
              'UF'.padStart(14) + '  clientes');
  for (const r of [...ag.porTipo.values()].sort((a, b) => b.filas - a.filas)) {
    console.log('  ' + r.tipo.padEnd(26) + fmt(r.filas).padStart(8) + fmt(r.cant).padStart(12) +
                uf(r.uf).padStart(14) + '  ' + r.clientes.size);
  }

  console.log('\n── VEREDICTO · la tarifa es estable por cliente y concepto? ' + '─'.repeat(3));
  const pct = x => (100 * x / v.total).toFixed(1) + '%';
  console.log('  combos cliente x concepto : ' + fmt(v.total));
  console.log('  con UNA sola tarifa       : ' + fmt(v.unaSola.length) + '  (' + pct(v.unaSola.length) + ')');
  console.log('  con VARIAS tarifas        : ' + fmt(v.varias.length) + '  (' + pct(v.varias.length) + ')');
  console.log('  sin tarifa en ninguna fila: ' + fmt(v.soloNull.length) + '  (' + pct(v.soloNull.length) + ')');

  if (v.varias.length) {
    console.log('\n  Los ' + Math.min(TOPE, v.varias.length) + ' combos con varias tarifas que mas filas mueven:');
    console.log('  ' + 'cliente'.padEnd(34) + 'concepto'.padEnd(24) + 'filas'.padStart(7) + '  tarifas');
    for (const r of v.varias.slice(0, TOPE)) {
      const tars = [...r.tarifas.entries()].sort((a, b) => b[1] - a[1])
        .map(([t, n]) => t + ' (' + n + ')').join('  ');
      console.log('  ' + r.nom.slice(0, 33).padEnd(34) + r.tipo.slice(0, 23).padEnd(24) +
                  fmt(r.filas).padStart(7) + '  ' + tars.slice(0, 90));
    }
  }

  if (v.soloNull.length) {
    const tipos = {};
    for (const r of v.soloNull) tipos[r.tipo] = (tipos[r.tipo] || 0) + 1;
    console.log('\n  Conceptos sin tarifa (esperable en los que no se facturan):');
    for (const t of Object.keys(tipos).sort((a, b) => tipos[b] - tipos[a])) console.log('    ' + t + '  ' + tipos[t] + ' combos');
  }

  // ── CSV con el detalle ────────────────────────────────────────────────────
  const fs = require('fs');
  const salida = opcion('salida', 'tarifas_' + ENTIDAD.toLowerCase() + '_' + meses.join('_') + '.csv');
  const esc = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const num = n => String(n).replace('.', ',');     // es-CL
  const lineas = ['cliente_codigo;cliente;concepto;bodega_origen;bodega_destino;tarifa_uf;docs;filas;cantidad;uf'];
  const detalle = [...ag.porTarifa.values()].sort((a, b) =>
    a.nom.localeCompare(b.nom) || a.tipo.localeCompare(b.tipo) || (a.tar || 0) - (b.tar || 0));
  for (const r of detalle) {
    lineas.push([esc(r.cod), esc(r.nom), esc(r.tipo), esc(r.ori), esc(r.des),
      r.tar === null ? '' : num(r.tar), r.docs.size, r.filas, num(r.cant), num(r.uf.toFixed(5))].join(';'));
  }
  fs.writeFileSync(salida, '﻿' + lineas.join('\r\n'), 'utf8');
  console.log('\n✓ Detalle escrito en ' + salida + '  (' + fmt(detalle.length) + ' combinaciones)');
  console.log('  Es archivo de trabajo: no lo commitees.');
}

if (require.main === module) {
  main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
}

module.exports = { agregar, veredicto, listarMeses };
