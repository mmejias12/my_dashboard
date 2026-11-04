// api/shared/consulta-stock-mensual.js
// Wrapper para el tool use de api/chat: devuelve el SALDO DE STOCK AL CIERRE DE
// CADA MES de un rango, en UNA sola llamada. Nació porque preguntar "saldo de
// clientes 2026 mes a mes" se resolvía llamando consultar_stock mes por mes, y
// el loop de herramientas corta a las 4 vueltas (MAX_VUELTAS): con 12 meses el
// asistente quedaba pegado a mitad de año. Acá los 12 cierres salen de una.
//
// "Cierre de mes" = saldoFinal del ÚLTIMO día del mes CON dato en caché (si el
// último día calendario no está, se toma el último disponible del mes, y se
// informa la fecha real del cierre). El mes en curso cierra en ayer.
//
// Lee los días desde el mismo read model diario (redtec-os-stock) que
// consultar_stock, en paralelo, y auto-sana el día de cierre si falta.
const { leerRango, obtenerDia } = require('./stock-dia');

function p2(n) { return n < 10 ? '0' + n : '' + n; }

function ayerIso() {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function menor(a, b) { return a < b ? a : b; }
function mayor(a, b) { return a > b ? a : b; }

// Último día calendario del mes 'YYYY-MM' (ISO).
function finDeMes(ym) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);   // m: 1..12
  const d = new Date(y, m, 0);                       // día 0 del mes siguiente = último del mes
  return y + '-' + p2(m) + '-' + p2(d.getDate());
}
// Primer día del mes 'YYYY-MM'.
function inicioDeMes(ym) { return ym + '-01'; }

// Lista de meses 'YYYY-MM' entre dos fechas ISO, inclusive.
function mesesEntre(desde, hasta) {
  const out = [];
  let y = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const yf = +hasta.slice(0, 4), mf = +hasta.slice(5, 7);
  while (y < yf || (y === yf && m <= mf)) {
    out.push(y + '-' + p2(m));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Cierre de UN universo para UN mes: saldoFinal del último día con dato dentro
// de la ventana [inicio de mes (o 'desde'), fin de mes (o 'hasta'/ayer)].
async function cierreMesUniverso(ym, universo, desde, hasta) {
  const topeMes = menor(finDeMes(ym), hasta);
  const ini = mayor(inicioDeMes(ym), desde);
  if (ini > topeMes) return null;                    // el mes cae fuera del rango pedido

  let r = await leerRango(ini, topeMes, universo);
  // Si el día de cierre exacto no está, intentar sanarlo una vez (acotado: 1 día
  // por mes y universo). Solo si no hubo NINGÚN día con dato en la ventana.
  if (!r.resumen) {
    try { await obtenerDia(topeMes); } catch (e) {}
    r = await leerRango(ini, topeMes, universo);
  }
  if (!r.resumen) return null;
  return { saldo: r.resumen.saldoFinal, fecha: r.resumen.hasta };
}

// desde/hasta ISO (YYYY-MM-DD); universo: 'clientes' | 'retail' | 'ambos'.
async function consultarStockMensual(args) {
  let desde = args.desde;
  let hasta = menor(args.hasta, ayerIso());          // hoy aún no cierra
  const universo = args.universo || 'ambos';
  if (desde > hasta) desde = hasta;

  const quiereClientes = universo === 'clientes' || universo === 'ambos';
  const quiereRetail   = universo === 'retail'   || universo === 'ambos';

  const lista = mesesEntre(desde, hasta);
  const tareas = lista.map(async (ym) => {
    const fila = { mes: ym };
    const [cCli, cRet] = await Promise.all([
      quiereClientes ? cierreMesUniverso(ym, 'clientes', desde, hasta) : null,
      quiereRetail   ? cierreMesUniverso(ym, 'retail',   desde, hasta) : null
    ]);
    const fechas = [];
    if (quiereClientes) {
      fila.saldo_clientes = cCli ? cCli.saldo : null;
      if (cCli) fechas.push(cCli.fecha);
    }
    if (quiereRetail) {
      fila.saldo_retail = cRet ? cRet.saldo : null;
      if (cRet) fechas.push(cRet.fecha);
    }
    // Fecha real del cierre del mes (la mayor de los universos pedidos).
    fila.cierre = fechas.length ? fechas.sort()[fechas.length - 1] : null;
    return fila;
  });

  const meses = (await Promise.all(tareas)).filter(f => f.cierre !== null);
  const out = { desde: desde, hasta: hasta, universo: universo, meses: meses };

  // Advertir si algún mes del rango quedó sin dato (no se pudo determinar cierre).
  const sinDato = lista.length - meses.length;
  if (sinDato > 0) out.advertencia = sinDato + ' mes(es) del rango sin dato de stock en caché.';
  // Advertir cuando un cierre no cayó en el último día calendario del mes.
  const aprox = meses.filter(f => f.cierre && f.cierre < menor(finDeMes(f.mes), hasta));
  if (aprox.length) {
    out.nota_cierres = 'Cierre tomado del último día con dato del mes en: ' +
      aprox.map(f => f.mes + ' (' + f.cierre + ')').join(', ') + '.';
  }
  return out;
}

const TOOL_SCHEMA = {
  name: 'consultar_stock_mensual',
  description: 'Saldo de STOCK del pool de pallets ROJOS AL CIERRE DE CADA MES de un rango, en UNA sola llamada. ÚSALA SIEMPRE que pidan el stock/saldo "mes a mes", "mensual", "por mes" o "el cierre de cada mes" en un periodo de varios meses (p. ej. "saldo de clientes 2026 mes a mes"): devuelve la serie mensual completa de una vez. NO llames consultar_stock mes por mes para esto. Devuelve meses[]: { mes:"YYYY-MM", cierre:"YYYY-MM-DD" (día real del cierre), saldo_clientes, saldo_retail }. El saldo es el STOCK (existencias) al cierre del mes, no un flujo. El mes en curso cierra en ayer. universo: "clientes", "retail" o "ambos" (default ambos). Para un único día o el stock actual usa consultar_stock.',
  input_schema: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicio del rango YYYY-MM-DD (se consideran todos los meses tocados)' },
      hasta: { type: 'string', description: 'Fecha fin del rango YYYY-MM-DD' },
      universo: { type: 'string', enum: ['clientes', 'retail', 'ambos'], description: 'Universo del pool. Default ambos.' }
    },
    required: ['desde', 'hasta']
  }
};

module.exports = { consultarStockMensual, TOOL_SCHEMA };
