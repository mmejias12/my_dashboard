#!/usr/bin/env node
/**
 * Rellena las huellas que le faltan a una bitácora anterior al control de
 * reuso de id_solicitud.
 *
 *   node src/cli-huellas.js <bitacora.json> <archivo.csv> [más archivos...]
 *
 * Las entradas viejas guardan sólo id → folio. Sin huella no se puede saber
 * si un id que vuelve es un reenvío o un número reusado, y la solicitud sale
 * DUPLICADA avisando que no se pudo verificar. Esto cierra el hueco leyendo
 * los archivos que ya se procesaron.
 *
 * Reglas, porque esto escribe sobre el registro de lo ya cursado:
 *   - sólo agrega huella a entradas que ya existen y no la tienen;
 *   - no toca folios, tipo ni registradoEn;
 *   - si un id aparece en dos archivos con datos distintos, no escribe nada
 *     y lo informa: adivinar cuál era el bueno es peor que no hacer nada;
 *   - sin --escribir sólo muestra lo que haría.
 *
 * La huella se arma desde las columnas del CSV, no desde validarSolicitud:
 * así no depende de que el recinto exista en el ambiente actual (los del 18
 * eran de demo y hoy sólo están en producción).
 */

'use strict';

const fs = require('fs');
const { parsearCsv } = require('./parser');
const { aIso } = require('./validador');
const { compararHuellas } = require('./huella');

function huellaDesdeFila(fila) {
  const tipo = (fila.tipo || '').trim().toUpperCase();
  const fecha = (fila.fecha_requerida || '').trim();
  const numDoc = (fila.numero_documento || '').trim();
  const tipoDoc = (fila.tipo_documento || '').trim().toUpperCase();
  const cantidad = Number.parseInt((fila.cantidad_pallets || '').trim(), 10);
  const origen = (fila.centro_origen || '').trim().toUpperCase();
  const destino = (fila.centro_destino || '').trim().toUpperCase();

  return {
    tipo: tipo || null,
    fecha: aIso(fecha) || fecha || null,
    origen: origen || null,
    destino: destino || null,
    cantidad: Number.isFinite(cantidad) ? cantidad : null,
    documento: numDoc ? `${tipoDoc || 'DOC'} ${Number.parseInt(numDoc, 10)}` : null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const escribir = args.includes('--escribir');
  const [rutaBitacora, ...archivos] = args.filter((a) => a !== '--escribir');

  if (!rutaBitacora || !archivos.length) {
    console.error('Uso: node src/cli-huellas.js <bitacora.json> <archivo.csv> [...] [--escribir]');
    process.exit(2);
  }

  const bitacora = JSON.parse(fs.readFileSync(rutaBitacora, 'utf8'));

  // id → { huella, origenes: [archivos] }
  const candidatas = new Map();
  const choques = [];

  for (const ruta of archivos) {
    const parseo = parsearCsv(fs.readFileSync(ruta, 'utf8'));
    if (!parseo.ok) {
      console.log(`  se omite ${ruta}: no tiene el encabezado de solicitudes`);
      continue;
    }
    for (const fila of parseo.registros) {
      const id = String((fila.id_solicitud || '').trim());
      if (!id) continue;
      const huella = huellaDesdeFila(fila);
      const previa = candidatas.get(id);
      if (!previa) { candidatas.set(id, { huella, origenes: [ruta] }); continue; }
      const { difs } = compararHuellas(huella, previa.huella);
      if (difs.length) choques.push({ id, difs, origenes: [...previa.origenes, ruta] });
      else previa.origenes.push(ruta);
    }
  }

  const aEscribir = [];
  const yaTenian = [];
  const sinDato = [];

  for (const id of Object.keys(bitacora)) {
    if (bitacora[id].huella) { yaTenian.push(id); continue; }
    const c = candidatas.get(String(id));
    if (!c) { sinDato.push(id); continue; }
    if (choques.some((ch) => ch.id === String(id))) continue;
    aEscribir.push({ id, huella: c.huella, origenes: c.origenes });
  }

  console.log(`\nBitácora: ${rutaBitacora}`);
  console.log(`Entradas: ${Object.keys(bitacora).length} · con huella: ${yaTenian.length} · por rellenar: ${aEscribir.length}\n`);

  for (const e of aEscribir) {
    const h = e.huella;
    console.log(`  ${e.id}  folio ${(bitacora[e.id].folios || []).join(' / ')}`);
    console.log(`        ${h.tipo} ${h.fecha} ${h.origen || '(sin origen)'} → ${h.destino} · ${h.cantidad} pallets · ${h.documento || 'sin documento'}`);
    console.log(`        desde ${e.origenes.join(', ')}`);
  }
  for (const id of sinDato) {
    console.log(`  ${id}  SIN DATO: no aparece en los archivos entregados, queda sin huella`);
  }
  for (const ch of choques) {
    console.log(`  ${ch.id}  CHOQUE entre archivos, no se escribe: ${ch.difs.join('; ')}`);
    console.log(`        ${ch.origenes.join(', ')}`);
  }

  if (!escribir) {
    console.log('\nEnsayo. Para escribir de verdad, agrega --escribir\n');
    return;
  }
  if (!aEscribir.length) {
    console.log('\nNada que escribir.\n');
    return;
  }

  for (const e of aEscribir) bitacora[e.id].huella = e.huella;
  const tmp = `${rutaBitacora}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bitacora, null, 2), 'utf8');
  fs.renameSync(tmp, rutaBitacora);
  console.log(`\n${aEscribir.length} huella(s) escritas en ${rutaBitacora}\n`);
}

main();
