// ============================================================================
//  audit-operaciones.js  ·  Audita la cobertura de redtec-os-operaciones
//
//  Lista los blobs del contenedor (sin descargar su contenido) y reporta:
//   - total de dias con blob y el rango (primer -> ultimo dia)
//   - el ULTIMO dia (= cutoff para el diseno hot/cold)
//   - dias faltantes entre 2023-01-02 y ayer (los de ene-2023 suelen ser dias
//     con 0 operaciones reales, sin blob; lo que importa es que no falte nada
//     en los ultimos 90 dias)
//
//  Uso (PowerShell):
//    cd "...\Documents\GitHub\my_dashboard"
//    npm i @azure/storage-blob --no-save        # si no esta instalado
//    $env:OS_STORAGE_CONN = "<tu cadena del storage redtecos>"
//    node audit-operaciones.js
// ============================================================================
'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.OS_STORAGE_CONN;
const CONT = process.env.OS_OPS_CONTAINER || 'redtec-os-operaciones';

(async () => {
  if (!CONN) { console.error('Falta la variable OS_STORAGE_CONN'); process.exit(1); }

  const cc = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONT);

  const fechas = new Set();
  for await (const b of cc.listBlobsFlat({ prefix: 'operaciones/' })) {
    const m = b.name.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) fechas.add(m[1]);
  }

  const arr = [...fechas].sort();
  if (!arr.length) { console.log('El contenedor', CONT, 'no tiene blobs en operaciones/'); return; }

  const iso = d => d.toISOString().slice(0, 10);
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);

  const faltan = [];
  for (let d = new Date('2023-01-02T00:00:00Z'); iso(d) <= iso(ayer); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!fechas.has(iso(d))) faltan.push(iso(d));
  }
  const lim90 = iso(new Date(ayer.getTime() - 90 * 86400000));
  const faltanRecientes = faltan.filter(x => x >= lim90);

  console.log('Contenedor               :', CONT);
  console.log('Dias con blob            :', arr.length);
  console.log('Rango                    :', arr[0], '->', arr[arr.length - 1]);
  console.log('Ultimo dia (= cutoff)    :', arr[arr.length - 1]);
  console.log('Faltantes totales        :', faltan.length, '(ene-2023 trae dias con 0 ops reales, sin blob)');
  console.log('Faltantes ultimos 90 dias:', faltanRecientes.length ? faltanRecientes.join(', ') : 'NINGUNO (ok)');
  console.log('Ultimos 10 dias          :', arr.slice(-10).join(', '));
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
