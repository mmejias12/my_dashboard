// ============================================================================
//  validate-operaciones.js  ·  Valida el re-backfill de redtec-os-operaciones
//
//  Revisa TRES cosas despues del re-backfill:
//   1) COBERTURA  · dias con blob, rango, cutoff, faltantes ultimos 90 dias
//   2) FORMA      · muestrea 1 blob por mes y verifica que quedaron en el
//                   contrato NUEVO (_contrato:'rdt', filas con nroPedido /
//                   operacion / _rl), no en el aplanar viejo
//   3) FRESCURA   · el _guardado de cada muestra, para confirmar que el
//                   re-backfill efectivamente los reescribio (fecha de hoy)
//
//  Uso (PowerShell), misma sesion donde tienes la cadena del storage:
//    cd "...\Documents\GitHub\my_dashboard"
//    npm i @azure/storage-blob --no-save        # si no esta
//    $env:OS_STORAGE_CONN = "<cadena del storage redtecos>"
//    node validate-operaciones.js
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.OS_STORAGE_CONN;
const CONT = process.env.OS_OPS_CONTAINER || 'redtec-os-operaciones';
const PREFIJO = 'operaciones/';

function iso(d) { return d.toISOString().slice(0, 10); }
async function streamToString(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
async function leerBlob(cc, fecha) {
  const dl = await cc.getBlobClient(`${PREFIJO}${fecha}.json`).download();
  return JSON.parse(await streamToString(dl.readableStreamBody));
}

// Clasifica un payload: 'nuevo' (contrato RDT), 'viejo' (aplanar) o 'raro'.
function clasificar(p) {
  const op0 = (p.operaciones && p.operaciones[0]) || null;
  if (!op0) return { tipo: 'vacio', detalle: '0 ops' };
  const esNuevo = p._contrato === 'rdt' && ('nroPedido' in op0) && ('operacion' in op0);
  const esViejo = !('nroPedido' in op0) && (('servicioNombre' in op0) || ('cantidad' in op0));
  if (esNuevo) return { tipo: 'nuevo', detalle: '', op0 };
  if (esViejo) return { tipo: 'viejo', detalle: 'aplanar (folio/servicioNombre/cantidad)', op0 };
  return { tipo: 'raro', detalle: 'claves=' + Object.keys(op0).slice(0, 6).join(','), op0 };
}

(async () => {
  if (!CONN) { console.error('Falta OS_STORAGE_CONN'); process.exit(1); }
  const cc = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONT);

  // -- 1) cobertura ----------------------------------------------------------
  const fechas = new Set();
  for await (const b of cc.listBlobsFlat({ prefix: PREFIJO })) {
    const m = b.name.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) fechas.add(m[1]);
  }
  const arr = [...fechas].sort();
  if (!arr.length) { console.log('El contenedor', CONT, 'no tiene blobs en', PREFIJO); return; }

  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  const faltan = [];
  for (let d = new Date('2023-01-02T00:00:00Z'); iso(d) <= iso(ayer); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!fechas.has(iso(d))) faltan.push(iso(d));
  }
  const lim90 = iso(new Date(ayer.getTime() - 90 * 86400000));
  const faltan90 = faltan.filter(x => x >= lim90);

  console.log('════════ COBERTURA ════════');
  console.log('Contenedor               :', CONT);
  console.log('Dias con blob            :', arr.length);
  console.log('Rango                    :', arr[0], '->', arr[arr.length - 1]);
  console.log('Ultimo dia (cutoff)      :', arr[arr.length - 1]);
  console.log('Faltantes ultimos 90 dias:', faltan90.length ? faltan90.join(', ') : 'NINGUNO (ok)');

  // -- 2+3) forma y frescura: 1 blob por mes --------------------------------
  const porMes = {};                       // 'YYYY-MM' -> primer dia presente
  for (const f of arr) { const k = f.slice(0, 7); if (!porMes[k]) porMes[k] = f; }
  const muestras = Object.values(porMes);
  if (arr[arr.length - 1] !== muestras[muestras.length - 1]) muestras.push(arr[arr.length - 1]); // + el ultimo dia real

  const res = [];
  const LOTE = 16;
  for (let i = 0; i < muestras.length; i += LOTE) {
    const grupo = muestras.slice(i, i + LOTE);
    const r = await Promise.all(grupo.map(f =>
      leerBlob(cc, f).then(p => ({ f, p })).catch(e => ({ f, err: e.message }))));
    res.push(...r);
  }

  let nuevos = 0, viejos = 0, otros = 0, conRL = 0;
  const problemas = [];
  const guardados = [];
  for (const { f, p, err } of res) {
    if (err) { problemas.push(`${f}: ERROR ${err}`); otros++; continue; }
    const c = clasificar(p);
    if (p._guardado) guardados.push(p._guardado.slice(0, 10));
    if (c.tipo === 'nuevo') {
      nuevos++;
      if (c.op0 && '_rl' in c.op0) conRL++;
      else problemas.push(`${f}: contrato nuevo pero SIN _rl`);
    } else if (c.tipo === 'viejo') { viejos++; problemas.push(`${f}: AUN EN FORMA VIEJA (${c.detalle})`); }
    else { otros++; problemas.push(`${f}: ${c.tipo} ${c.detalle}`); }
  }
  guardados.sort();

  console.log('\n════════ FORMA (1 blob por mes) ════════');
  console.log('Muestras revisadas       :', res.length);
  console.log('Contrato NUEVO (rdt)     :', nuevos);
  console.log('  de esos, con _rl       :', conRL, conRL === nuevos ? '(todos ok)' : '(¡faltan _rl!)');
  console.log('Forma VIEJA (aplanar)    :', viejos, viejos ? '← RE-BACKFILL INCOMPLETO' : '(ninguno, ok)');
  console.log('Otros / vacios / error   :', otros);

  console.log('\n════════ FRESCURA (_guardado) ════════');
  if (guardados.length) {
    const min = guardados[0], max = guardados[guardados.length - 1];
    const cnt = {}; guardados.forEach(g => cnt[g] = (cnt[g] || 0) + 1);
    console.log('Rango de _guardado       :', min, '->', max);
    console.log('Por fecha                :', Object.entries(cnt).map(([k, v]) => `${k}:${v}`).join('  '));
  }

  if (problemas.length) {
    console.log('\n⚠  PROBLEMAS (' + problemas.length + '):');
    problemas.slice(0, 40).forEach(p => console.log('  -', p));
  }

  const ok = viejos === 0 && otros === 0 && nuevos === conRL && nuevos > 0;
  console.log('\n════════ RESULTADO ════════');
  console.log(ok
    ? '✓ TODO OK · todas las muestras en contrato nuevo con _rl, sin forma vieja'
    : '✗ REVISAR · hay muestras fuera del contrato nuevo (ver arriba)');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
