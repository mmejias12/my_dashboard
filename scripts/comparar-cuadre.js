// scripts/comparar-cuadre.js
// ============================================================================
//  ¿El cuadre que ya tenemos guardado reproduce el que contesta el proveedor?
//
//  POR QUE EXISTE. El cuadre de rojos (`cuadrerojos{clientes,retail}xrangofechas`
//  de RDTOut) llega hoy por DOS caminos distintos que nadie conecto:
//
//    (a) api/stock-clientes-proxy y api/stock-retail-proxy pegan EN VIVO al
//        proveedor cada vez que alguien abre stocks-unificado.html,
//        stock-calendario.html o "Stock Plantas Respaldo - Copia.html".
//    (b) api/shared/stock-dia.js viene CONGELANDO la misma respuesta, dia por
//        dia, en redtec-os-stock/stock/YYYY-MM-DD.json desde el 2023-03-20, y
//        nunca vuelve a pedir un dia que ya quedo bueno. De ahi leen el chat
//        (consulta-stock.js) y backfill-stock.js.
//
//  O sea: para todo dia ya cerrado, el dato del proveedor YA ES NUESTRO. Lo que
//  falta probar es si sumar los dias guardados da lo mismo que pedirle el rango
//  al proveedor. Si da lo mismo, las tres vistas se salvan apuntando los proxies
//  al blob, sin SAP y sin accesos nuevos; y SAP queda para el dia nuevo, que es
//  otro trabajo.
//
//  ESTE SCRIPT NO ESCRIBE NADA. Solo lee y compara.
//
//  DOS TRAMPAS YA MEDIDAS que hay que tener presentes al leer el resultado:
//    1. El cuadre del proveedor NO CUADRA CONSIGO MISMO. En su cierre 2025 de
//       retail las lineas suman 529.990 y declara 532.584; y declara variacion
//       +1.342 cuando sus entradas menos salidas dan -1.252. La misma brecha de
//       2.594 en los dos lugares. "Equivalente" no puede querer decir "identico".
//    2. El NIVEL ya esta validado por otro camino: la extraccion propia de SAP
//       reconstruye el cierre 2025 de retail con 3 pallets de diferencia contra
//       M2LINK. Lo que no esta probado es el DESGLOSE POR CONCEPTO.
//
//  URGENTE, Y ES POR LA LLAVE. REDTEC_API_KEY es la llave del proveedor que se
//  esta dando de baja. Dos cosas de este archivo SOLO SE PUEDEN HACER MIENTRAS
//  esa llave siga viva, y despues ya no:
//
//    --huecos    dice que dias le faltan al blob. Un dia que no quedo congelado
//                solo se puede rellenar pidiendoselo al proveedor. El dia que la
//                llave muera, ese hueco es permanente. ESTO VA PRIMERO.
//    --capturar  guarda en un archivo las respuestas de los DOS lados. Despues
//                de la baja ya no hay con que comparar: la captura es la unica
//                forma de que la equivalencia se pueda volver a revisar, o de
//                mostrarsela a alguien, cuando el proveedor ya no conteste.
//
//  Uso (desde la raiz del repo):
//    node scripts/comparar-cuadre.js --huecos              # PRIMERO: que falta
//    node scripts/comparar-cuadre.js --solo-nuestro --meses=24   # SIN la llave
//    node scripts/comparar-cuadre.js --meses=24 --capturar=captura-cuadre.json
//    node scripts/comparar-cuadre.js --capturar=captura-cuadre.json
//    node scripts/comparar-cuadre.js --desde-captura=captura-cuadre.json
//    node scripts/comparar-cuadre.js                       # bateria por defecto
//    node scripts/comparar-cuadre.js 2026-01-01 2026-03-31 # un rango puntual
//    node scripts/comparar-cuadre.js --solo-nuestro        # sin tocar al proveedor
//    node scripts/comparar-cuadre.js --universo=retail     # uno solo
//
//  Entorno:
//    OS_STORAGE_CONN   siempre (es donde vive el blob congelado)
//    REDTEC_API_KEY    solo si NO se pasa --solo-nuestro
//  Si falta una, el script para y dice CUAL, nunca su valor.
// ============================================================================
'use strict';

const { FLUJOS } = require('../api/shared/stock-fetch');

/* ── Los signos del cuadre ─────────────────────────────────────────────────
   RETAIL esta VERIFICADO y documentado en stock-fetch.js:
     saldoFinal = saldoInicial + (transferencias + salidaPalletReconfirmar +
                  otrasEntradas) - (entradaPalletReversa + retiros +
                  otrasSalidas + reubicacionSistema)

   CLIENTES es HIPOTESIS MIA, no dato: los nombres de los conceptos estan
   escritos desde la vereda de CLIENTES (por eso "salidaPalletReconfirmar"
   SUMA en retail: lo que sale de clientes entra a retail). Si eso es cierto,
   para clientes emision y entradaPalletReversa suman, y devolucion,
   transferencias y salidaPalletReconfirmar restan.

   El script NO da por buena la hipotesis: la PRUEBA contra cada rango y dice
   si se sostiene. Una hipotesis que nadie contrasta es una suposicion con
   mejor letra.                                                              */
const SIGNOS = {
  retail: {
    verificado: true,
    mas:   ['transferencias', 'salidaPalletReconfirmar', 'otrasEntradas'],
    menos: ['entradaPalletReversa', 'retiros', 'otrasSalidas', 'reubicacionSistema']
  },
  clientes: {
    verificado: false,
    mas:   ['emision', 'entradaPalletReversa'],
    menos: ['devolucion', 'transferencias', 'salidaPalletReconfirmar']
  }
};

const UNIVERSOS = ['clientes', 'retail'];
const MAX_DIAS_PROVEEDOR = 180;   // lo dice el encabezado de stock-fetch.js

/* ── Funciones puras (lo que se prueba sin red) ───────────────────────────── */

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ¿El cuadre cierra consigo mismo? Se aplica a CADA lado por separado: es la
   unica forma de saber si una diferencia es nuestra o venia de origen.      */
function identidad(universo, c) {
  const s = SIGNOS[universo];
  if (!s || !c) return null;
  const entradas = s.mas.reduce((a, k) => a + num(c[k]), 0);
  const salidas  = s.menos.reduce((a, k) => a + num(c[k]), 0);
  const calculado = num(c.saldoInicial) + entradas - salidas;
  const declarado = num(c.saldoFinal);
  return {
    entradas, salidas, calculado, declarado,
    brecha: declarado - calculado,
    cuadra: declarado === calculado
  };
}

/* Campos a comparar: el nivel, los totales y los conceptos del universo. */
function camposDe(universo) {
  return ['saldoInicial', 'saldoFinal', 'diferencia', 'totalEntradas', 'totalSalida']
    .concat(FLUJOS[universo] || []);
}

/* Compara campo por campo. `nuestro` puede no traer totalEntradas/totalSalida:
   leerRango no los suma. Un campo ausente de UN lado se informa como tal, no
   se cuenta como cero: cero y "no viene" son cosas distintas y confundirlas
   es justo como se inventa una diferencia que no existe.                    */
function comparar(provee, nuestro, universo) {
  return camposDe(universo).map(function (k) {
    const enP = provee  && Object.prototype.hasOwnProperty.call(provee, k);
    const enN = nuestro && Object.prototype.hasOwnProperty.call(nuestro, k);
    const p = enP ? num(provee[k])  : null;
    const n = enN ? num(nuestro[k]) : null;
    return {
      campo: k,
      proveedor: p,
      nuestro: n,
      dif: (enP && enN) ? n - p : null,
      falta: (!enP && !enN) ? 'los dos' : (!enP ? 'proveedor' : (!enN ? 'nuestro' : null))
    };
  });
}

/* El veredicto de un rango, en un solo numero para no leer tablas al vuelo.
     0 calza        · todos los campos comparables son identicos
     1 solo totales · difieren totalEntradas/totalSalida, que leerRango no suma
     2 huecos       · al blob le faltan dias del rango: la diferencia se explica
     3 difiere      · hay conceptos distintos con el rango completo
     4 sin dato     · un lado no contesto                                     */
function veredicto(filas, faltantes, hayProveedor) {
  if (!hayProveedor) return { codigo: 4, texto: 'sin dato del proveedor' };
  const comparables = filas.filter(f => f.dif !== null);
  if (!comparables.length) return { codigo: 4, texto: 'nada comparable' };
  const distintos = comparables.filter(f => f.dif !== 0);
  if (!distintos.length) return { codigo: 0, texto: 'calza' };
  if (faltantes && faltantes.length) {
    return { codigo: 2, texto: 'al blob le faltan ' + faltantes.length + ' dia(s) del rango' };
  }
  const soloTotales = distintos.every(f => f.campo === 'totalEntradas' || f.campo === 'totalSalida');
  if (soloTotales) return { codigo: 1, texto: 'solo difieren los totales (leerRango no los suma)' };
  return { codigo: 3, texto: distintos.length + ' campo(s) distinto(s)' };
}

/* La bateria por defecto. Rangos elegidos para que cada uno pueda fallar por
   una razon distinta: una semana (el caso de las vistas), un mes calendario,
   un rango que CRUZA el cambio de mes (donde un cierre mal fechado se nota),
   un trimestre y el tope de 180 dias del proveedor.                         */
function rangosPorDefecto(hoy) {
  const d = new Date(hoy + 'T12:00:00');
  const iso = (x) => x.toISOString().slice(0, 10);
  const atras = (n) => { const y = new Date(d); y.setDate(y.getDate() - n); return iso(y); };
  const primerDiaDe = (n) => { const y = new Date(d); y.setMonth(y.getMonth() - n, 1); return iso(y); };
  const ultimoDiaDe = (n) => { const y = new Date(d); y.setMonth(y.getMonth() - n + 1, 0); return iso(y); };
  return [
    { nombre: 'ultima semana',        desde: atras(7),         hasta: atras(1) },
    { nombre: 'mes anterior',         desde: primerDiaDe(1),   hasta: ultimoDiaDe(1) },
    { nombre: 'cruzando el mes',      desde: atras(45),        hasta: atras(15) },
    { nombre: 'trimestre',            desde: atras(90),        hasta: atras(1) },
    { nombre: 'tope del proveedor',   desde: atras(MAX_DIAS_PROVEEDOR), hasta: atras(1) }
  ];
}

/* Un rango por mes calendario, del mas viejo al mas nuevo, terminando en el mes
   en curso hasta `hoy`. Es la bateria que conviene CAPTURAR mientras la llave
   viva: las vistas piden rangos cualesquiera, y cinco muestras prueban poco
   sobre eso. Un mes por llamada entra holgado en el tope de 180 dias.        */
function rangosDeMeses(hoy, n) {
  const d = new Date(hoy + 'T12:00:00');
  const iso = (x) => x.toISOString().slice(0, 10);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ini = new Date(d.getFullYear(), d.getMonth() - i, 1, 12);
    const fin = new Date(d.getFullYear(), d.getMonth() - i + 1, 0, 12);
    const hasta = iso(fin) > hoy ? hoy : iso(fin);
    if (iso(ini) > hoy) continue;
    out.push({ nombre: iso(ini).slice(0, 7), desde: iso(ini), hasta: hasta });
  }
  return out;
}

function diasEntre(desde, hasta) {
  const a = new Date(desde + 'T12:00:00'), b = new Date(hasta + 'T12:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

/* ── Huecos del blob ───────────────────────────────────────────────────────
   Un dia sin congelar solo se recupera pidiendoselo al proveedor. Con la llave
   dada de baja el hueco pasa a ser permanente, asi que esto se mira AHORA.

   Hay dos clases de hueco y la segunda es la traicionera:
     sinBlob   · el dia no existe en el almacen
     parcial   · el dia existe pero un universo quedo en null. Pasa cuando
                 RDTOut fallo para uno solo: stock-dia graba igual con tal de
                 que UN universo haya contestado. leerRango se lo salta para
                 ese universo y la suma del rango queda corta sin avisar.      */

function fechaDeNombre(nombre) {
  const m = String(nombre || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function fechasDeNombres(nombres) {
  const vistas = new Set();
  (nombres || []).forEach(function (n) { const f = fechaDeNombre(n); if (f) vistas.add(f); });
  return Array.from(vistas).sort();
}

/* Agrupa fechas sueltas en tramos continuos, para no escupir 400 comandos de un
   dia cada uno cuando lo que falta son tres pedazos. */
function tramos(fechas) {
  const orden = (fechas || []).slice().sort();
  const out = [];
  orden.forEach(function (f) {
    const ultimo = out[out.length - 1];
    if (ultimo && diasEntre(ultimo.hasta, f) === 2) ultimo.hasta = f;
    else out.push({ desde: f, hasta: f });
  });
  return out;
}

/* `contenido` es { fecha: {clientes:bool, retail:bool} } solo de los dias que SI
   tienen blob. Los dias sin blob no aparecen ahi y por eso se calculan aparte. */
function huecos(desde, hasta, presentes, contenido) {
  const todas = [];
  { const d = new Date(desde + 'T12:00:00'), f = new Date(hasta + 'T12:00:00');
    while (d <= f) { todas.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } }
  const hay = new Set(presentes || []);
  const sinBlob = todas.filter(f => !hay.has(f));
  const parciales = {};
  UNIVERSOS.forEach(function (u) {
    parciales[u] = todas.filter(f => hay.has(f) && !((contenido || {})[f] || {})[u]);
  });
  return { desde, hasta, dias: todas.length, sinBlob, parciales };
}

/* El comando exacto para rellenar, listo para copiar. No lo corre: rellenar
   escribe, y este script no escribe.

   LOS DOS TIPOS DE HUECO NECESITAN COMANDOS DISTINTOS, y confundirlos deja el
   hueco igual de abierto pero con cara de arreglado:
     sin blob  · backfill-stock.js lo toma solo, porque diaValido() da false
     parcial   · diaValido() da TRUE con un solo universo con dato, asi que el
                 freeze lo SALTA. Sin --forzar ese dia no se rellena nunca.
   Van en listas separadas a proposito: --forzar sobre un tramo largo de dias
   sanos los vuelve a pedir al proveedor, y con la llave fallando eso es la
   forma de pisar un dia bueno con uno a medias.                              */
function comandosParaRellenar(h) {
  const out = [];
  tramos(h.sinBlob).forEach(function (t) {
    out.push('node backfill/backfill-stock.js ' + t.desde + ' ' + t.hasta +
             '   # ' + diasEntre(t.desde, t.hasta) + ' dia(s) sin blob');
  });
  const parc = new Set();
  UNIVERSOS.forEach(u => (h.parciales[u] || []).forEach(f => parc.add(f)));
  tramos(Array.from(parc)).forEach(function (t) {
    out.push('node backfill/backfill-stock.js ' + t.desde + ' ' + t.hasta + ' --forzar' +
             '   # ' + diasEntre(t.desde, t.hasta) + ' dia(s) a medias: sin --forzar el freeze los salta');
  });
  return out;
}

/* ── El resumen cuando NO se consulta al proveedor ─────────────────────────
   Sin el proveedor no hay nada contra que comparar, pero NO es que no se pueda
   verificar nada. El resumen de un rango mezcla dos cosas de origen distinto:

     saldoInicial y saldoFinal  · son numeros del proveedor, congelados tal cual
                                  en el blob del primer y del ultimo dia
     los flujos                 · los sumamos NOSOTROS dia por dia

   Si la identidad del cuadre cierra —inicial + entradas - salidas = final— es
   que la suma de dias reproduce la contabilidad del proveedor: dos cosas que
   no se calcularon juntas dan lo mismo. Eso es evidencia de verdad y no pide
   la llave. Lo que NO prueba es que el proveedor haga la misma aritmetica con
   su propio endpoint de rango; para eso si hay que preguntarle.             */
function resumenSoloNuestro(resultados) {
  const conIdentidad = resultados.filter(r => r.identidadNuestro);
  return {
    total: resultados.length,
    medidos: conIdentidad.length,
    cuadran: conIdentidad.filter(r => r.identidadNuestro.cuadra).length,
    noCuadran: conIdentidad.filter(r => !r.identidadNuestro.cuadra)
      .map(r => ({ universo: r.universo, nombre: r.nombre, brecha: r.identidadNuestro.brecha })),
    sinDato: resultados.filter(r => !r.identidadNuestro).map(r => r.universo + ' · ' + r.nombre)
  };
}

/* ── Presentacion ─────────────────────────────────────────────────────────── */

const miles = (n) => (n === null ? '—' : Number(n).toLocaleString('es-CL'));

function pintarRango(r) {
  const l = [];
  l.push('');
  l.push('── ' + r.universo.toUpperCase() + ' · ' + r.nombre + ' · ' + r.desde + ' .. ' + r.hasta +
         '  (' + diasEntre(r.desde, r.hasta) + ' dias)');
  if (r.error) { l.push('   ERROR: ' + r.error); return l.join('\n'); }

  l.push('   ' + 'campo'.padEnd(26) + 'proveedor'.padStart(14) + 'nuestro'.padStart(14) + 'dif'.padStart(12));
  r.filas.forEach(function (f) {
    const marca = f.falta ? '  (no viene de: ' + f.falta + ')' : (f.dif ? '   <<<' : '');
    l.push('   ' + f.campo.padEnd(26) + miles(f.proveedor).padStart(14) +
           miles(f.nuestro).padStart(14) + miles(f.dif).padStart(12) + marca);
  });

  [['proveedor', r.identidadProveedor], ['nuestro', r.identidadNuestro]].forEach(function (par) {
    const id = par[1];
    if (!id) return;
    l.push('   identidad ' + par[0].padEnd(11) +
           (id.cuadra ? 'CUADRA' : 'NO CUADRA por ' + miles(id.brecha)) +
           '  (inicial + ' + miles(id.entradas) + ' - ' + miles(id.salidas) + ' = ' + miles(id.calculado) +
           ', declara ' + miles(id.declarado) + ')');
  });
  if (!SIGNOS[r.universo].verificado) {
    l.push('   OJO: los signos de ' + r.universo + ' son HIPOTESIS. Si la identidad de los DOS');
    l.push('        lados no cuadra, lo mas probable es que la hipotesis este mal, no el dato.');
  }
  if (r.faltantes && r.faltantes.length) {
    l.push('   dias que el blob NO tiene: ' + r.faltantes.length +
           ' (' + r.faltantes.slice(0, 6).join(', ') + (r.faltantes.length > 6 ? ', ...' : '') + ')');
  }
  l.push('   VEREDICTO: ' + r.veredicto.texto);
  return l.join('\n');
}

/* ── Corrida ──────────────────────────────────────────────────────────────── */

function exigir(nombre) {
  if (!process.env[nombre]) {
    console.error('Falta la variable de entorno ' + nombre + '. En esta misma consola:');
    console.error('  $env:' + nombre + '="<valor>"');
    process.exit(1);
  }
}

/* Mira el almacen y dice que dias le faltan. Solo necesita OS_STORAGE_CONN:
   ENCONTRAR los huecos no pide la llave; rellenarlos si, y por eso corre antes. */
async function mirarHuecos(desde, hasta) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { CONTENEDOR } = require('../api/shared/stock-dia');
  const cont = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN)
    .getContainerClient(CONTENEDOR);

  console.log('Listando ' + CONTENEDOR + '/stock/ ...');
  const nombres = [];
  for await (const b of cont.listBlobsFlat({ prefix: 'stock/' })) nombres.push(b.name);
  const presentes = fechasDeNombres(nombres).filter(f => f >= desde && f <= hasta);
  console.log('  ' + nombres.length + ' blobs, ' + presentes.length + ' dias dentro del rango pedido');

  /* El hueco parcial obliga a abrir cada dia: por fuera se ve igual que uno
     sano. Se leen de a 24 en paralelo, como rollup-hist. */
  const contenido = {};
  const LOTE = 24;
  for (let i = 0; i < presentes.length; i += LOTE) {
    const grupo = presentes.slice(i, i + LOTE);
    await Promise.all(grupo.map(async function (f) {
      try {
        const buf = await cont.getBlockBlobClient('stock/' + f + '.json').downloadToBuffer();
        const o = JSON.parse(buf.toString('utf8'));
        contenido[f] = { clientes: !!o.clientes, retail: !!o.retail };
      } catch (e) { contenido[f] = { clientes: false, retail: false, _error: e.message }; }
    }));
    if (i % (LOTE * 10) === 0) process.stdout.write('  leidos ' + Math.min(i + LOTE, presentes.length) + '/' + presentes.length + '\r');
  }
  console.log('  leidos ' + presentes.length + '/' + presentes.length + '    ');
  return huecos(desde, hasta, presentes, contenido);
}

function pintarHuecos(h) {
  const l = [''];
  l.push('HUECOS DEL ALMACEN CONGELADO · ' + h.desde + ' .. ' + h.hasta + '  (' + h.dias + ' dias)');
  l.push('');
  l.push('  dias SIN blob          : ' + h.sinBlob.length);
  UNIVERSOS.forEach(u => l.push('  dias con ' + u.padEnd(9) + ' en null: ' + h.parciales[u].length));
  const muestra = (t, a) => { if (a.length) { l.push(''); l.push('  ' + t + ':');
    tramos(a).slice(0, 25).forEach(x => l.push('    ' + (x.desde === x.hasta ? x.desde : x.desde + ' .. ' + x.hasta)));
    if (tramos(a).length > 25) l.push('    ... y ' + (tramos(a).length - 25) + ' tramo(s) mas'); } };
  muestra('sin blob', h.sinBlob);
  UNIVERSOS.forEach(u => muestra('sin ' + u, h.parciales[u]));

  const cmd = comandosParaRellenar(h);
  l.push('');
  if (!cmd.length) {
    l.push('  No falta ningun dia. El almacen cubre el rango entero y la baja del');
    l.push('  proveedor no se lleva nada de la historia.');
  } else {
    l.push('  PARA RELLENAR, MIENTRAS LA LLAVE SIGA VIVA (esto SI escribe):');
    cmd.slice(0, 20).forEach(c => l.push('    ' + c));
    if (cmd.length > 20) l.push('    ... y ' + (cmd.length - 20) + ' comando(s) mas');
    l.push('');
    l.push('  Un dia que no se rellene antes de la baja queda perdido para siempre:');
    l.push('  el proveedor es el unico que lo tiene.');
  }
  return l.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const soloNuestro = args.includes('--solo-nuestro');
  const unoSolo = (args.find(a => a.startsWith('--universo=')) || '').split('=')[1];
  const capturarEn = (args.find(a => a.startsWith('--capturar=')) || '').split('=')[1];
  const desdeCaptura = (args.find(a => a.startsWith('--desde-captura=')) || '').split('=')[1];
  const posic = args.filter(a => a.indexOf('--') !== 0);

  /* Volver a comparar desde una captura no toca ni el almacen ni al proveedor:
     es para despues de la baja, cuando ya no hay con que medir de nuevo. */
  if (desdeCaptura) {
    const fs = require('fs');
    const cap = JSON.parse(fs.readFileSync(desdeCaptura, 'utf8'));
    console.log('COMPARAR CUADRE · desde la captura ' + desdeCaptura);
    console.log('  capturada el ' + cap.generado + ' · ' + cap.rangos.length + ' rango(s)');
    let malos = 0;
    cap.rangos.forEach(function (r) {
      const fila = Object.assign({}, r);
      fila.filas = comparar(r.proveedor, r.nuestro, r.universo);
      fila.identidadProveedor = r.proveedor ? identidad(r.universo, r.proveedor) : null;
      fila.identidadNuestro = r.nuestro ? identidad(r.universo, r.nuestro) : null;
      fila.veredicto = veredicto(fila.filas, r.faltantes, !!r.proveedor);
      if (fila.veredicto.codigo === 3) malos++;
      console.log(pintarRango(fila));
    });
    console.log('\n' + '='.repeat(70));
    console.log('Rangos en la captura: ' + cap.rangos.length + '  ·  difieren: ' + malos);
    process.exit(malos ? 1 : 0);
  }

  exigir('OS_STORAGE_CONN');

  if (args.includes('--huecos')) {
    const hoy = new Date(); hoy.setDate(hoy.getDate() - 1);
    const h = await mirarHuecos(posic[0] || '2023-03-20', posic[1] || hoy.toISOString().slice(0, 10));
    console.log(pintarHuecos(h));
    process.exit((h.sinBlob.length || UNIVERSOS.some(u => h.parciales[u].length)) ? 1 : 0);
  }

  if (!soloNuestro) exigir('REDTEC_API_KEY');

  const { cuadreRango } = require('../api/shared/stock-fetch');
  const { leerRango } = require('../api/shared/stock-dia');

  const hoy = new Date().toISOString().slice(0, 10);
  const meses = Number((args.find(a => a.startsWith('--meses=')) || '').split('=')[1]) || 0;
  const rangos = posic.length >= 2
    ? [{ nombre: 'a pedido', desde: posic[0], hasta: posic[1] }]
    : (meses > 0 ? rangosDeMeses(hoy, meses) : rangosPorDefecto(hoy));
  const universos = unoSolo ? [unoSolo] : UNIVERSOS;

  console.log('COMPARAR CUADRE · no escribe nada');
  console.log('  guardado : redtec-os-stock/stock/YYYY-MM-DD.json (via stock-dia.leerRango)');
  console.log('  proveedor: ' + (soloNuestro ? 'NO se consulta (--solo-nuestro)' : 'apirdt1 (via stock-fetch.cuadreRango)'));

  const resultados = [];
  for (const universo of universos) {
    if (!SIGNOS[universo]) { console.error('Universo invalido: ' + universo); process.exit(1); }
    for (const r of rangos) {
      const fila = { universo, nombre: r.nombre, desde: r.desde, hasta: r.hasta };
      try {
        if (diasEntre(r.desde, r.hasta) > MAX_DIAS_PROVEEDOR && !soloNuestro) {
          fila.nombre += ' (sobre el tope de ' + MAX_DIAS_PROVEEDOR + ' dias)';
        }
        const nuestroTodo = await leerRango(r.desde, r.hasta, universo);
        const nuestro = nuestroTodo.resumen;
        const provee = soloNuestro ? null : await cuadreRango(r.desde, r.hasta, universo);
        fila.faltantes = nuestroTodo.faltantes;
        fila.proveedorCrudo = provee;
        fila.nuestroCrudo = nuestro;
        fila.filas = comparar(provee, nuestro, universo);
        fila.identidadProveedor = provee ? identidad(universo, provee) : null;
        fila.identidadNuestro = nuestro ? identidad(universo, nuestro) : null;
        fila.veredicto = veredicto(fila.filas, fila.faltantes, !!provee);
      } catch (e) {
        fila.error = e.message;
        fila.veredicto = { codigo: 4, texto: 'error' };
      }
      console.log(pintarRango(fila));
      resultados.push(fila);
    }
  }

  if (capturarEn) {
    const fs = require('fs');
    fs.writeFileSync(capturarEn, JSON.stringify({
      generado: new Date().toISOString(),
      nota: 'Respuestas de los dos lados, guardadas mientras la llave del proveedor seguia viva. ' +
            'Se vuelve a comparar con: node scripts/comparar-cuadre.js --desde-captura=' + capturarEn,
      rangos: resultados.map(r => ({
        universo: r.universo, nombre: r.nombre, desde: r.desde, hasta: r.hasta,
        proveedor: r.proveedorCrudo || null, nuestro: r.nuestroCrudo || null, faltantes: r.faltantes || []
      }))
    }, null, 2));
    console.log('\nCaptura guardada en ' + capturarEn + '. Eso sobrevive a la baja del proveedor.');
  }

  console.log('\n' + '='.repeat(70));

  if (soloNuestro) {
    const res = resumenSoloNuestro(resultados);
    console.log('SIN CONSULTAR AL PROVEEDOR · se verifico la identidad del cuadre');
    console.log('  rangos medidos : ' + res.medidos + ' de ' + res.total);
    console.log('  la identidad cierra en: ' + res.cuadran + ' de ' + res.medidos);
    if (res.sinDato.length) {
      console.log('  sin dato en el almacen: ' + res.sinDato.length);
      res.sinDato.slice(0, 10).forEach(x => console.log('    ' + x));
    }
    if (res.noCuadran.length) {
      console.log('\n  NO CIERRAN:');
      res.noCuadran.forEach(x => console.log('    ' + x.universo + ' · ' + x.nombre + ' · por ' + miles(x.brecha)));
      console.log('\n  Sumar los dias NO reproduce la contabilidad del proveedor en esos');
      console.log('  rangos. Antes de apuntar los proxies al blob hay que entender por que.');
    } else if (res.medidos) {
      console.log('\n  En todos los rangos medidos, el saldo final que el proveedor dejo');
      console.log('  congelado coincide con el que sale del inicial mas los flujos que');
      console.log('  sumamos nosotros dia por dia. Son dos numeros de origen distinto y');
      console.log('  dan lo mismo: la suma de dias reproduce su contabilidad.');
      console.log('  LO QUE ESTO NO PRUEBA: que su endpoint de rango haga la misma');
      console.log('  aritmetica. Eso solo se sabe preguntandole, y para eso hace falta');
      console.log('  la llave que se esta dando de baja.');
    }
    process.exit(res.noCuadran.length ? 1 : 0);
  }

  const malos = resultados.filter(r => r.veredicto.codigo === 3);
  console.log('Rangos comparados: ' + resultados.length +
              '  ·  calzan: ' + resultados.filter(r => r.veredicto.codigo === 0).length +
              '  ·  difieren: ' + malos.length);
  if (malos.length) {
    console.log('\nNO alcanza para apuntar los proxies al blob todavia. Difieren:');
    malos.forEach(r => console.log('  ' + r.universo + ' · ' + r.nombre + ' · ' + r.veredicto.texto));
  }
  process.exit(malos.length ? 1 : 0);
}

module.exports = { SIGNOS, UNIVERSOS, MAX_DIAS_PROVEEDOR, identidad, camposDe, comparar,
                   veredicto, resumenSoloNuestro, rangosPorDefecto, rangosDeMeses, diasEntre, num,
                   fechaDeNombre, fechasDeNombres, tramos, huecos, comandosParaRellenar };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
