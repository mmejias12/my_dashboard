// ============================================================================
//  backfill/sonda-cobertura-docs.js  ·  M3DATA · cuantos documentos hay vs
//  cuantos trajimos
//
//  QUE CONTESTA. Si la fase 1 de backfill-sap-bin.js esta listando TODOS los
//  documentos del mes o se le escapan. Le pregunta a SAP el $count con el
//  mismo filtro que usa la extraccion y lo compara contra el _docs que quedo
//  guardado en el blob. Son dos numeros que tienen que ser iguales.
//
//  POR QUE EXISTE. El movimiento de RETAIL no cuadra contra SAP por 7.886
//  pallets en 2026. Se descartaron, con dato y no con opinion:
//    · faltar tipos de documento      -> OINM solo tiene trans_type 67
//    · ubicaciones de otra bodega     -> el filtro por Warehouse descarto 0
//    · fuga en traspasos internos     -> las lineas internas netean 0, cumple
//    · perder el ultimo dia del mes   -> mayo/julio/septiembre calzan exacto
//      (y los tres TIENEN movimiento ese dia)
//    · blobs viejos                   -> las horas de extraccion no explican nada
//    · filas descartadas o documentos
//      fallidos                       -> el blob dice 0 y 0 en los diez meses
//  Y el dia a dia de febrero dejo 24 de 28 dias EXACTOS, con el hueco casi
//  entero en uno solo (2026-02-02, -2.908). Eso ya no se parece a un error de
//  metodo: se parece a documentos que no llegaron.
//
//  LA PAGINACION ES LA SOSPECHOSA. La fase 1 pide $top=200&$skip=N en un
//  bucle. Si el servidor devuelve menos filas que el $top pedido y el bucle
//  avanza igual de a 200, cada vuelta se salta la diferencia en silencio.
//
//  SOLO LEE. No escribe en SAP ni en el storage.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB · OS_STORAGE_CONN
//
//  Uso (PowerShell):
//    node backfill/sonda-cobertura-docs.js
//    node backfill/sonda-cobertura-docs.js --meses=2026-02
//    node backfill/sonda-cobertura-docs.js --meses=2026-02 --dias
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');

const args = process.argv.slice(2);
const OPCIONES = ['meses', 'entidad', 'fecha'];
const BANDERAS = ['dias'];
const opcion = (n, d) => {
  const p = '--' + n + '=';
  for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length);
  return d;
};
const bandera = n => args.indexOf('--' + n) >= 0;
const CONT = process.env.OS_SAP_CONTAINER || 'redtec-os-sap';
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const conSigno = n => (Number(n) > 0 ? '+' : '') + mil(n);

// ── lo puro ─────────────────────────────────────────────────────────────────

/** La url del $count, con EL MISMO filtro que usa la extraccion. Si el filtro
 *  no fuera identico, la comparacion no probaria nada. */
function urlConteo(raiz, entidad, campoFecha, desde, hasta) {
  if (!raiz || !entidad || !campoFecha || !desde || !hasta) return null;
  const filtro = campoFecha + " ge '" + desde + "' and " + campoFecha + " le '" + hasta + "'";
  return raiz + '/' + entidad + '/$count?$filter=' + encodeURIComponent(filtro);
}

/** El $count vuelve como texto pelado, no como JSON. Un cuerpo que no es un
 *  entero NO es cero: es una respuesta que no entendimos, y hay que decirlo. */
function leerConteo(cuerpo) {
  const t = String(cuerpo == null ? '' : cuerpo).trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** CUANTOS DOCUMENTOS NUEVOS CABEN entre la extraccion y esta consulta.
 *
 *  POR QUE HACE FALTA, medido el 27-10-2026: esta sonda dijo "LA FASE 1 SE
 *  ESTA SALTANDO DOCUMENTOS: faltan 2 en 2026-10". El blob se habia guardado
 *  minutos antes y el mes venia corriendo a decenas de documentos por hora:
 *  dos documentos en esos minutos es lo que se espera de un mes ABIERTO, no
 *  un defecto. Acusar paginacion con ese dato era afirmar mas de lo medido.
 *
 *  Y NO ES UNA EXCUSA QUE TAPE TODO: la corrida anterior tenia un hueco de
 *  251 con ~19 esperados. El mismo criterio que hoy absuelve, ese dia acusa.
 *
 *  COMO SE CALCULA. La tasa del propio mes —sus documentos divididos por lo
 *  que llevaba corrido cuando se extrajo— multiplicada por el rato en que el
 *  mes siguio ABIERTO entre la extraccion y ahora. Para un mes ya cerrado ese
 *  solape es cero y no se perdona nada: un mes cerrado que crece es un
 *  posteo con fecha vieja o un documento que no llego, y las dos cosas hay
 *  que mirarlas. */
function huecoEsperado(docs, desde, hasta, guardado, ahora) {
  const d = Number(docs);
  if (!isFinite(d) || d <= 0) return null;
  const t0 = Date.parse(String(desde || '') + 'T00:00:00Z');
  const tf = Date.parse(String(hasta || '') + 'T00:00:00Z') + 86400000;  // fin del ultimo dia
  const t1 = Date.parse(String(guardado || ''));
  const t2 = Date.parse(String(ahora || ''));
  // Las dos comparaciones de abajo ya descartan cualquier NaN: una fecha que no
  // se pudo leer hace falsas las dos, y entonces se devuelve null. Un isFinite
  // aparte seria codigo que nunca decide nada.
  if (!(tf > t0) || !(t2 >= t1)) return null;
  const corrido = Math.min(t1, tf) - t0;        // cuanto del mes llevaba andado al extraer
  if (!(corrido > 0)) return null;
  const solape = Math.max(0, Math.min(t2, tf) - Math.max(t1, t0));
  return Math.ceil((d / corrido) * solape);
}

/** Compara lo que dice SAP contra lo que quedo en el blob. */
function comparar(filas) {
  const out = [];
  for (const f of (filas || [])) {
    if (!f || !f.mes) continue;
    const sap = f.sap == null ? null : Number(f.sap);
    const nuestro = f.nuestro == null ? null : Number(f.nuestro);
    const falta = (sap == null || nuestro == null) ? null : sap - nuestro;
    const esperado = huecoEsperado(nuestro, f.desde, f.hasta, f.guardado, f.ahora);
    // Un mes ya CERRADO cuyo blob se saco antes de que cerrara no cubre el mes,
    // y eso no es una estimacion: le faltan dias enteros por construccion. No
    // hay que explicarlo con el reloj ni acusar paginacion, hay que re-extraerlo.
    const tf = Date.parse(String(f.hasta || '') + 'T00:00:00Z') + 86400000;
    const tA = Date.parse(String(f.ahora || '')), tG = Date.parse(String(f.guardado || ''));
    const cerrado = (isFinite(tf) && isFinite(tA)) ? tA >= tf : null;
    const incompleto = cerrado === true && isFinite(tG) && tG < tf;
    out.push({ mes: f.mes, sap, nuestro, falta, esperado, cerrado, incompleto,
               explicado: cerrado === false && falta != null && falta > 0 &&
                          esperado != null && falta <= esperado,
               medible: sap != null && nuestro != null });
  }
  return out.sort((a, b) => a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0);
}

function resumen(comp) {
  const c = (comp || []).filter(x => x && x.medible);
  const incompletos = c.filter(x => x.incompleto);
  const cortos = c.filter(x => x.falta > 0 && !x.explicado && !x.incompleto);
  const explicados = c.filter(x => x.falta > 0 && x.explicado);
  const sobran = c.filter(x => x.falta < 0 && !x.incompleto);
  return { medidos: c.length, noMedibles: (comp || []).length - c.length,
           cortos, sobran, explicados, incompletos,
           faltanDocs: cortos.reduce((a, x) => a + x.falta, 0),
           sapTotal: c.reduce((a, x) => a + x.sap, 0),
           nuestroTotal: c.reduce((a, x) => a + x.nuestro, 0) };
}

function veredicto(r) {
  if (!r || !r.medidos) return { nivel: 'sin datos',
    texto: 'No se pudo comparar ningun mes: falta el conteo de SAP o el blob.' };
  const p = [];
  const expl = (r.explicados || []), inc = (r.incompletos || []);
  if (inc.length)
    p.push('BLOB SACADO ANTES DE QUE EL MES CERRARA, en ' + inc.length + ' mes(es) — ' +
           inc.slice(0, 6).map(x => x.mes).join(', ') +
           '. No cubren el mes completo por construccion, no por paginacion: hay que ' +
           're-extraerlos antes de poder juzgar nada ahi.');
  if (r.cortos.length)
    p.push('FALTAN DOCUMENTOS: ' + mil(r.faltanDocs) + ' en ' +
           r.cortos.length + ' mes(es) — ' +
           r.cortos.slice(0, 6).map(x => x.mes + ' ' + conSigno(-x.falta) +
             (x.esperado != null ? ' (el tiempo transcurrido explica ' + mil(x.esperado) + ')' : '')).join(', ') +
           '. Existen en SAP y no estan en el blob, y es mas de lo que explica el rato ' +
           'que paso desde la extraccion. O la fase 1 se salta paginas, o se posteo con ' +
           'fecha vieja despues de extraer: para distinguirlo, re-extraer ese mes y volver a comparar.');
  if (r.sobran.length)
    p.push('Y en ' + r.sobran.length + ' mes(es) el blob tiene MAS documentos que SAP (' +
           r.sobran.slice(0, 6).map(x => x.mes + ' ' + conSigno(-x.falta)).join(', ') +
           '). Eso no es un faltante: o el blob quedo de una corrida con otro filtro, o ' +
           'se borraron documentos en SAP despues de extraerlos.');
  if (r.noMedibles)
    p.push(r.noMedibles + ' mes(es) sin comparar por falta de conteo o de blob.');
  if (!p.length) {
    const cola = expl.length
      ? '  En ' + expl.length + ' mes(es) SAP cuenta unos pocos mas (' +
        expl.map(x => x.mes + ' ' + conSigno(-x.falta)).join(', ') +
        '), y caben de sobra en el rato que paso desde la extraccion. Mientras el mes ' +
        'siga abierto el conteo no lo puede juzgar; se zanja cuando cierre.'
      : '';
    return { nivel: 'si',
      texto: 'Los ' + r.medidos + ' meses cuadran al documento: ' + mil(r.sapTotal) +
             ' en SAP y ' + mil(r.nuestroTotal) + ' en los blobs. La fase 1 no pierde nada, ' +
             'asi que lo que falta se pierde DENTRO del documento: lineas o asignaciones ' +
             'de ubicacion que la respuesta no trajo.' + cola };
  }
  return { nivel: 'no', texto: p.join('  ') };
}

module.exports = { urlConteo, leerConteo, huecoEsperado, comparar, resumen, veredicto, OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const falta = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB', 'OS_STORAGE_CONN']
    .filter(k => !process.env[k]);
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', '));
    console.error('Se declaran en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const ENTIDAD = opcion('entidad', 'StockTransfers');
  const CAMPO = opcion('fecha', 'DocDate');
  const meses = String(opcion('meses',
    '2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10'))
    .split(',').map(x => x.trim()).filter(Boolean);

  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cc = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN)
    .getContainerClient(CONT);

  console.log('Sonda de cobertura de documentos   ·  ' + ENTIDAD + ' por ' + CAMPO);
  console.log('Raiz: ' + raiz + '   ·  base ' + process.env.SAP_DB);
  console.log('SOLO LEE. Compara el $count de SAP contra el _docs del blob.\n');

  const filas = [];
  for (const mes of meses) {
    const desde = mes + '-01', hasta = S.finDeMes(mes);
    let sap = null;
    const u = urlConteo(raiz, ENTIDAD, CAMPO, desde, hasta);
    try {
      const r = await ses.get(u);
      if (r.status === 200) sap = leerConteo(r.body != null ? r.body : r.json);
      else console.log('  ' + mes + ': $count HTTP ' + r.status);
    } catch (e) { console.log('  ' + mes + ': $count error ' + String(e.message || e).slice(0, 60)); }

    let nuestro = null, guardado = null;
    try {
      const b = cc.getBlobClient('binmov/' + mes + '.json');
      if (await b.exists()) {
        const j = JSON.parse((await b.downloadToBuffer()).toString('utf8'));
        nuestro = Number(j._docs);
        if (!isFinite(nuestro)) nuestro = null;
        guardado = j._guardado || null;
      }
    } catch (e) { console.log('  ' + mes + ': blob error ' + String(e.message || e).slice(0, 60)); }

    filas.push({ mes, sap, nuestro, desde, hasta, guardado, ahora: new Date().toISOString() });
  }

  const comp = comparar(filas);
  const r = resumen(comp);

  console.log('── DOCUMENTOS POR MES ' + '─'.repeat(52));
  console.log('  ' + 'mes'.padEnd(10) + 'SAP'.padStart(10) + 'blob'.padStart(10) +
              'faltan'.padStart(10) + '   lo que explica el reloj');
  for (const x of comp)
    console.log('  ' + x.mes.padEnd(10) +
                (x.sap == null ? '?' : mil(x.sap)).padStart(10) +
                (x.nuestro == null ? '?' : mil(x.nuestro)).padStart(10) +
                (x.falta == null ? '?' : (x.falta ? conSigno(-x.falta) : '0')).padStart(10) +
                (x.falta > 0 && x.esperado != null
                   ? '   hasta ' + mil(x.esperado) + (x.explicado ? '  ← alcanza' : '  ← NO alcanza')
                   : ''));
  if (r.medidos)
    console.log('  ' + 'suma'.padEnd(10) + mil(r.sapTotal).padStart(10) +
                mil(r.nuestroTotal).padStart(10) +
                conSigno(r.nuestroTotal - r.sapTotal).padStart(10));

  const v = veredicto(r);
  console.log('\n── VEREDICTO ' + '─'.repeat(61));
  console.log('  ' + v.texto);
  console.log('');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
