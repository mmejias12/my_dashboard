#!/usr/bin/env node
// ============================================================================
//  scripts/verificar-listado-walmart.js
//
//  Para qué existe
//  ---------------
//  El listado que produce medir-citas-walmart.js sale del almacén frío, que es
//  una foto diaria. Entre esa foto y el momento en que alguien pega el CSV en
//  el Excel de confirmación pueden pasar horas o días, y el módulo del
//  proveedor sigue corriendo: una transferencia que figuraba pendiente puede
//  estar confirmada ya. Confirmarla de nuevo dispara un SEGUNDO ajuste de
//  inventario en SAP, y eso no se deshace con un ctrl+Z.
//
//  Esta sonda relee Redlink EN VIVO y dice, folio por folio, si todavía
//  corresponde confirmar y si la cantidad sigue siendo la misma.
//
//  Lo que NO hace
//  --------------
//  No escribe nada, en ningún lado. Son consultas GET contra el histórico, el
//  mismo camino que el m3link usa todos los días para leer. Si algún día hace
//  falta escribir, se hace en otro archivo y a conciencia.
//
//  Uso
//  ---
//    node scripts/verificar-listado-walmart.js --listado=confirmar.csv
//    node scripts/verificar-listado-walmart.js --listado=confirmar.csv --salida=confirmar-verificado.csv
//    ... --dias=60      (ventana del histórico; por omisión 45)
//    ... --bp=433       (433 = todos los clientes)
//
//  Credenciales: las mismas Application Settings de producción que ya usa el
//  m3link — REDLINK_CLIENT_SECRET, REDLINK_USER, REDLINK_PASS. Se cargan
//  afuera; esta sonda no las imprime ni las pide por pantalla.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const redlink = require(path.join(__dirname, '..', 'api', 'shared', 'redlink-fetch.js'));

/* ------------------------------------------------- lectura del listado ---- */

// El CSV lo escribimos nosotros, pero puede volver editado a mano desde Excel:
// con comas, con espacios, con una columna de más o con el encabezado borrado.
// Leerlo con un split a secas y confiar sería la forma más tonta de confirmar
// un folio equivocado.
function leerListado(texto) {
  const filas = [], malas = [];
  const lineas = String(texto == null ? '' : texto).split(/\r?\n/);
  lineas.forEach(function (linea, i) {
    const t = linea.trim();
    if (!t) return;
    if (/^folio\s*[;,\t]/i.test(t)) return;                   // encabezado
    const partes = t.split(/[;,\t]/).map(x => x.trim());
    const folio = partes[0], cant = partes[1];
    if (!/^\d+$/.test(folio) || !/^\d+$/.test(cant)) {
      malas.push({ linea: i + 1, texto: t.slice(0, 60) });
      return;
    }
    filas.push({ folio: Number(folio), cantRecibida: Number(cant) });
  });
  return { filas: filas, malas: malas };
}

/* ------------------------------------------------- el veredicto ---------- */

// Mismo criterio que el resto del proyecto: una operación está confirmada si
// tiene cantidad confirmada > 0 Y la etapa no empieza con "Pendiente". Con una
// sola señal ya nos equivocamos una vez.
function estaConfirmada(op) {
  const n = Number(op && op.cantidadConfirmada) || 0;
  return n > 0 && !/^\s*pendiente/i.test(String((op && op.etapaOperacion) || ''));
}

// Las dos etapas desde las que SI se confirma en el circuito masivo de
// Walmart: 44 "Pendiente de Confirmacion" y 43 "Pendiente Adjuntar Respaldo".
// La tabla FormMetapa marca Confirmar=true solo en la 44, y por eso aca se
// exigia; Marcelo lo resolvio el 9-nov-2026: en las confirmaciones masivas no
// corresponde adjuntar respaldo, ese paso existe para que logistica no vaya
// documento por documento. Lista explicita y corta: la 46 y la 49 ya estan
// confirmadas y la 47 esta anulada, ninguna de esas entra.
// OJO: empezar con "Pendiente" no alcanza, porque las dos empiezan igual.
const ETAPAS_CONFIRMABLES = [/pendiente\s+de\s+confirmaci/i, /pendiente\s+adjuntar\s+respaldo/i];
function etapaConfirmable(op) {
  const e = String((op && op.etapaOperacion) || '');
  return ETAPAS_CONFIRMABLES.some(re => re.test(e));
}

// Una transferencia ANULADA no espera ningun respaldo, y una relocalizacion
// no es una transferencia. Meter las tres cosas en un solo veredicto y
// rotularlo con una sola causa es afirmar lo que no se sabe: la etapa viene en
// el dato, asi que se nombra tal cual en vez de interpretarla.
const RE_ANULADA = /anulad/i;
// Los dos servicios del circuito de Walmart, por nombre exacto. "Trans
// Diferenciada" (servicioId 70) es el mas grande hacia bodegas ZWM* y un
// regex /transferenc/i la dejaba fuera entera. Lista explicita a proposito:
// un servicio nuevo tiene que salir nombrado, no colarse.
const SERVICIOS_TRANSFERENCIA = ['transferencia', 'transferencias', 'trans diferenciada'];
const esAnulada = (op) => RE_ANULADA.test(String((op && op.etapaOperacion) || ''));
const esTransferencia = (op) => {
  const n = String((op && op.operacion) || '').trim().toLowerCase();
  return SERVICIOS_TRANSFERENCIA.indexOf(n) >= 0;
};

const VEREDICTOS = {
  confirmar:    'sigue pendiente, la cantidad calza',
  anulada:      'ANULADA — sacar del listado',
  noEsTransferencia: 'la cita cayo en una operacion que NO es transferencia',
  etapaNoConfirmable: 'la etapa no es la confirmable',
  recalcular:   'sigue pendiente pero lo despachado cambió',
  yaConfirmada: 'YA fue confirmada — sacar del listado',
  noAparece:    'no aparece en la ventana consultada',
  duplicada:    'el folio aparece en mas de una operacion'
};

function verificar(filas, ops, exigirEtapa) {
  const porFolio = new Map();
  (ops || []).forEach(function (o) {
    const f = Number(o && o.nroPedido);
    // Number(null) y Number('') dan CERO, no NaN: sin el > 0, toda operación
    // sin folio queda apilada bajo el folio 0 y el veredicto sale de basura.
    if (!Number.isFinite(f) || f <= 0) return;
    if (!porFolio.has(f)) porFolio.set(f, []);
    porFolio.get(f).push(o);
  });

  return (filas || []).map(function (l) {
    const ops = porFolio.get(l.folio) || [];
    if (!ops.length)     return Object.assign({}, l, { veredicto: 'noAparece' });
    if (ops.length > 1)  return Object.assign({}, l, { veredicto: 'duplicada', operaciones: ops.length });
    const op = ops[0];
    const desp = Number(op.cantidadDespachada) || 0;
    const base = Object.assign({}, l, {
      despachada: desp,
      confirmada: Number(op.cantidadConfirmada) || 0,
      etapa: op.etapaOperacion || ''
    });
    if (esAnulada(op)) return Object.assign(base, { veredicto: 'anulada' });
    if (op.operacion && !esTransferencia(op)) return Object.assign(base, { veredicto: 'noEsTransferencia' });
    if (estaConfirmada(op)) return Object.assign(base, { veredicto: 'yaConfirmada' });
    if (exigirEtapa && !etapaConfirmable(op)) return Object.assign(base, { veredicto: 'etapaNoConfirmable' });
    // Si lo despachado cambió, la cantidad del listado se calculó contra otro
    // número y hay que rehacerla: no se recorta en silencio.
    if (l.cantRecibida > desp) return Object.assign(base, { veredicto: 'recalcular' });
    return Object.assign(base, { veredicto: 'confirmar' });
  });
}

// Las filas donde lo que se va a confirmar NO es todo lo despachado son las
// unicas donde el listado puede discrepar del proceso real: MEDIDO sobre lo ya
// confirmado, en las diferencias negativas se confirmo lo aceptado en 33 casos
// y lo despachado en 10. Acá el dato de despacho viene de Redlink en vivo, que
// es mejor que el del almacén frío, así que es el mejor lugar para separarlas.
function conDiferencia(filas) {
  return (filas || []).filter(f => f.veredicto === 'confirmar' && f.cantRecibida !== f.despachada);
}

// Con --sin-diferencia el archivo que se pega lleva SOLO las que confirman
// todo lo despachado, que son las que nadie puede discutir. Las otras salen en
// su propio archivo, con el detalle para decidirlas. Editar a mano un CSV de
// cien filas antes de pegarlo en algo que mueve inventario es exactamente
// donde se cuela el error que despues nadie puede explicar.
function csvDelVerificado(filas, opciones) {
  const o = opciones || {};
  const out = ['folio;cantRecibida'];
  (filas || [])
    .filter(f => f.veredicto === 'confirmar')
    .filter(f => !o.sinDiferencia || f.cantRecibida === f.despachada)
    .forEach(f => out.push(String(f.folio) + ';' + String(f.cantRecibida)));
  return out.join('\r\n') + '\r\n';
}

function csvParaRevisar(filas) {
  const out = ['folio;despachada;aConfirmar;porInformar'];
  conDiferencia(filas).forEach(f => out.push([f.folio, f.despachada, f.cantRecibida,
    f.despachada - f.cantRecibida].join(';')));
  return out.join('\r\n') + '\r\n';
}

function resumen(filas) {
  const c = {};
  (filas || []).forEach(f => { c[f.veredicto] = (c[f.veredicto] || 0) + 1; });
  return c;
}

/* ------------------------------------------------- principal ------------- */

const hoyIso = () => new Date().toISOString().slice(0, 10);
const atras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const val = (p) => (args.find(a => a.startsWith(p)) || '').split('=').slice(1).join('=');
  const ruta = val('--listado=');
  if (!ruta) {
    console.error('Falta --listado=<archivo.csv>, el que produce medir-citas-walmart.js');
    process.exit(2);
  }
  const falta = redlink.faltantes();
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', ') +
      '. Cárgalas en tu sesión; esta sonda nunca las imprime.');
    process.exit(2);
  }

  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); }
  catch (e) { console.error('No se pudo leer ' + ruta + ': ' + (e.code || e.message)); process.exit(2); }

  const { filas, malas } = leerListado(texto);
  console.log('VERIFICAR LISTADO · sólo lectura, no escribe nada');
  console.log('  listado: ' + ruta + '  ->  ' + filas.length + ' folios');
  if (malas.length) {
    console.log('  líneas que no se pudieron leer: ' + malas.length);
    malas.slice(0, 10).forEach(m => console.log('    línea ' + m.linea + ': ' + m.texto));
    console.log('  Esas NO se verificaron y no van a salir en la salida.');
  }
  if (!filas.length) { console.log('  No hay nada que verificar.'); process.exit(2); }

  const dias = Number(val('--dias=')) || 45;
  const desde = atras(dias), hasta = hoyIso();
  const bp = val('--bp=') || '433';
  console.log('  Redlink en vivo: BP ' + bp + ' · ' + desde + ' a ' + hasta + ' (' + dias + ' días)');

  let r;
  try { r = await redlink.consultarRedlink(desde, hasta, { bp: bp }); }
  catch (e) {
    console.error('\nNo se pudo consultar Redlink: ' + (e && e.message ? e.message : String(e)));
    process.exit(2);
  }
  console.log('  operaciones leídas: ' + r.filas.length + ' en ' + r.ms + ' ms');

  // El filtro por etapa queda DETRAS de una bandera hasta que se compruebe en
  // el portal si la etapa 43 es confirmable para transferencias. Dejarlo
  // prendido por omision vaciaria el listado por una regla deducida de la
  // tabla y nunca vista operar.
  const exigirEtapa = args.indexOf('--exigir-etapa') >= 0;
  const res = verificar(filas, r.filas, exigirEtapa);
  const c = resumen(res);
  console.log('');
  Object.keys(VEREDICTOS).forEach(function (k) {
    if (c[k]) console.log('  ' + String(c[k]).padStart(4) + '  ' + VEREDICTOS[k]);
  });

  const problemas = res.filter(f => f.veredicto !== 'confirmar');
  if (problemas.length) {
    console.log('');
    console.log('  Las que NO hay que pegar, una por una:');
    problemas.forEach(f => console.log('    folio ' + f.folio + '  pedía ' + f.cantRecibida +
      (f.despachada != null ? '  desp ' + f.despachada : '') +
      (f.confirmada ? '  confirmada ' + f.confirmada : '') +
      '  ' + VEREDICTOS[f.veredicto] + (f.etapa ? '  · etapa: ' + f.etapa : '')));
  }

  const dif = conDiferencia(res);
  const confirmables = res.filter(f => f.veredicto === 'confirmar');
  if (dif.length) {
    console.log('');
    console.log('  OJO: ' + dif.length + ' de ' + confirmables.length + ' confirman MENOS de lo despachado.');
    console.log('  Sobre lo ya confirmado, en esos casos el proceso real confirmo lo ACEPTADO en 33');
    console.log('  y lo DESPACHADO en 10. Son las unicas filas donde el listado puede no coincidir');
    console.log('  con lo que se hace hoy, y cada una mueve inventario:');
    dif.forEach(f => console.log('    folio ' + f.folio + '  desp ' + f.despachada +
      ' · listado ' + f.cantRecibida + ' · quedan ' + (f.despachada - f.cantRecibida) + ' por informar'));
  } else if (confirmables.length) {
    console.log('');
    console.log('  Las ' + confirmables.length + ' confirman exactamente lo despachado: no hay diferencia que discutir.');
  }

  const salida = val('--salida=');
  const sinDif = args.indexOf('--sin-diferencia') >= 0;
  if (salida) {
    fs.writeFileSync(salida, csvDelVerificado(res, { sinDiferencia: sinDif }), 'utf8');
    const cuantas = (c.confirmar || 0) - (sinDif ? dif.length : 0);
    console.log('');
    console.log('  LISTADO VERIFICADO -> ' + salida + '  (' + cuantas + ' folios' +
      (sinDif ? ', sin las que tienen diferencia' : '') + ')');
    if (sinDif && dif.length) {
      const revisar = val('--revisar=') || salida.replace(/(\.csv)?$/i, '') + '-revisar.csv';
      fs.writeFileSync(revisar, csvParaRevisar(res), 'utf8');
      console.log('  PARA REVISAR     -> ' + revisar + '  (' + dif.length + ' folios con diferencia)');
    }
  } else {
    console.log('');
    console.log('  Agrega --salida=<archivo.csv> para escribir el listado ya depurado.');
    console.log('  Agrega --exigir-etapa para dejar fuera las que no estan en "Pendiente de');
    console.log('  Confirmacion" (sin comprobar todavia si esa etapa es la unica confirmable).');
    console.log('  Agrega ademas --sin-diferencia para dejar fuera las que confirman menos de');
    console.log('  lo despachado; esas van a su propio archivo, para decidirlas aparte.');
  }
  console.log('');
}

module.exports = { leerListado, estaConfirmada, verificar, conDiferencia, csvDelVerificado, csvParaRevisar, etapaConfirmable, ETAPAS_CONFIRMABLES, SERVICIOS_TRANSFERENCIA, esTransferencia, resumen, VEREDICTOS };

if (require.main === module) {
  main().then(() => { process.exitCode = 0; }).catch(e => {
    console.error('\n' + (e && e.message ? e.message : String(e)) + '\n');
    process.exitCode = 2;
  });
}
