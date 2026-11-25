// ============================================================================
//  scripts/cobertura-sap.js  ·  M3DATA · ¿el mes extraido esta COMPLETO?
//
//  NO TOCA SAP. Lee el blob que dejo backfill/backfill-sap.js.
//
//  POR QUE EXISTE. El 24-11-2026 el conteo de filas por mes salio 20.349 (jul),
//  19.808 (ago), 19.654 (sep) y 13.639 (oct). Un mes 30% mas flaco que sus
//  vecinos no es necesariamente menos actividad: puede ser un blob escrito
//  ANTES de que el mes cerrara. La diferencia importa porque una tarifa
//  ponderada sobre medio mes es un numero que se publica con autoridad y esta
//  mal. Esto lo distingue mirando dos cosas que el blob ya tiene: hasta que dia
//  llegan los documentos, y cuando se escribio el blob.
//
//  Uso (PowerShell, desde la raiz del repo):
//    node scripts/cobertura-sap.js --mes=2026-10
//    node scripts/cobertura-sap.js --desde=2026-07 --hasta=2026-10
//
//  Requiere OS_STORAGE_CONN. Si falta, para y lo dice (nunca el valor).
// ============================================================================

// El require de Azure es PEREZOSO (mismo patron que backfill-sap.js): asi las
// funciones puras se pueden probar sin instalar el SDK ni tener credenciales.
const { listarMeses } = require('./medir-tarifas-sap.js');   // una sola definicion de "rango de meses"

const CONT    = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const ENTIDAD = (process.argv.find(a => a.startsWith('--entidad=')) || '').split('=')[1] || 'StockTransfers';

const dosD = n => (n < 10 ? '0' : '') + n;
const fmt  = n => Number(n || 0).toLocaleString('es-CL');
function opcion(n, def) {
  const a = process.argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : def;
}

/** Dias que tiene un mes 'YYYY-MM'. */
function diasDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

/**
 * El veredicto de un mes. Se separan dos causas distintas a proposito:
 *   · el blob se escribio ANTES de que el mes cerrara  -> esta incompleto por
 *     construccion, y se arregla volviendo a extraer;
 *   · faltan dias sueltos en medio -> es otra cosa (feriados reales, o un
 *     hueco de la extraccion) y hay que mirarlo, no re-extraer a ciegas.
 * Un sabado o domingo sin documentos es normal, asi que los dias faltantes se
 * reportan con su dia de semana en vez de contarse como falla.
 */
function veredicto(mes, dias, escrito) {
  const total = diasDelMes(mes);
  const ultimoDelMes = mes + '-' + dosD(total);
  const ultimoConDato = dias.length ? dias[dias.length - 1] : null;
  const finDeMes = new Date(mes + '-' + dosD(total) + 'T23:59:59Z');
  const cortadoAlEscribir = escrito && escrito < finDeMes;

  if (!dias.length) return { codigo: 3, texto: 'sin documentos' };
  if (cortadoAlEscribir) {
    return { codigo: 2, texto: 'INCOMPLETO: el blob se escribio el ' + escrito.toISOString().slice(0, 10) +
             ', antes de que el mes cerrara (' + ultimoDelMes + '). Hay que volver a extraerlo.' };
  }
  if (ultimoConDato < ultimoDelMes) {
    return { codigo: 1, texto: 'el ultimo documento es del ' + ultimoConDato + ' y el mes cierra el ' + ultimoDelMes };
  }
  return { codigo: 0, texto: 'llega hasta el cierre del mes' };
}

async function leerMes(cc, mes) {
  const b = cc.getBlockBlobClient(ENTIDAD.toLowerCase() + '/' + mes + '.json');
  if (!(await b.exists())) return null;
  const props = await b.getProperties();
  const j = JSON.parse((await b.downloadToBuffer()).toString('utf8'));
  return { j, escrito: props.lastModified || null };
}

async function main() {
  if (!process.env.OS_STORAGE_CONN) {
    console.error('Falta la variable de entorno OS_STORAGE_CONN. En esta misma consola:');
    console.error('  $env:OS_STORAGE_CONN="<el valor real>"');
    process.exit(1);
  }
  const unico = opcion('mes', null);
  const meses = unico ? [unico] : listarMeses(opcion('desde', '2026-07'), opcion('hasta', '2026-10'));
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN).getContainerClient(CONT);

  console.log('COBERTURA DE LA EXTRACCION SAP · no escribe nada · no toca SAP');
  console.log('  fuente: ' + CONT + '/' + ENTIDAD.toLowerCase());

  let malos = 0;
  for (const mes of meses) {
    const r = await leerMes(cc, mes);
    if (!r) { console.log('\n── ' + mes + ' · SIN BLOB'); malos++; continue; }
    const filas = r.j.filas || [];
    const porDia = new Map();
    for (const f of filas) {
      const d = String(f.DocDate || '').slice(0, 10);
      if (d) porDia.set(d, (porDia.get(d) || 0) + 1);
    }
    const dias = [...porDia.keys()].sort();
    const v = veredicto(mes, dias, r.escrito);
    if (v.codigo >= 2) malos++;

    console.log('\n── ' + mes + ' · ' + fmt(filas.length) + ' filas · ' + dias.length +
                ' dia(s) con documentos de ' + diasDelMes(mes));
    console.log('   escrito el    : ' + (r.escrito ? r.escrito.toISOString().replace('T', ' ').slice(0, 16) : '—'));
    console.log('   documentos de : ' + (dias[0] || '—') + '  a  ' + (dias[dias.length - 1] || '—'));
    // Los dias sin documentos, con su dia de semana: sabado y domingo explican
    // la mayoria y no son un hueco.
    const SEM = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
    const faltan = [];
    for (let d = 1; d <= diasDelMes(mes); d++) {
      const iso = mes + '-' + dosD(d);
      if (!porDia.has(iso)) faltan.push(iso + '(' + SEM[new Date(iso + 'T12:00:00Z').getUTCDay()] + ')');
    }
    if (faltan.length) console.log('   sin documentos: ' + faltan.join(' '));
    console.log('   VEREDICTO: ' + v.texto);
  }
  console.log('\n' + '='.repeat(70));
  console.log(malos ? 'Hay ' + malos + ' mes(es) que NO sirven para publicar un numero todavia.'
                    : 'Todos los meses revisados llegan al cierre.');
  process.exit(malos ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error('\nError: ' + e.message); process.exit(1); });
module.exports = { veredicto, diasDelMes };
