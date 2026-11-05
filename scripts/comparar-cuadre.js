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
//  Uso (desde la raiz del repo):
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
      falta: !enP ? 'proveedor' : (!enN ? 'nuestro' : null)
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

function diasEntre(desde, hasta) {
  const a = new Date(desde + 'T12:00:00'), b = new Date(hasta + 'T12:00:00');
  return Math.round((b - a) / 86400000) + 1;
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

async function main() {
  const args = process.argv.slice(2);
  const soloNuestro = args.includes('--solo-nuestro');
  const unoSolo = (args.find(a => a.startsWith('--universo=')) || '').split('=')[1];
  const posic = args.filter(a => a.indexOf('--') !== 0);

  exigir('OS_STORAGE_CONN');
  if (!soloNuestro) exigir('REDTEC_API_KEY');

  const { cuadreRango } = require('../api/shared/stock-fetch');
  const { leerRango } = require('../api/shared/stock-dia');

  const hoy = new Date().toISOString().slice(0, 10);
  const rangos = posic.length >= 2
    ? [{ nombre: 'a pedido', desde: posic[0], hasta: posic[1] }]
    : rangosPorDefecto(hoy);
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

  const malos = resultados.filter(r => r.veredicto.codigo === 3);
  console.log('\n' + '='.repeat(70));
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
                   veredicto, rangosPorDefecto, diasEntre, num };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
