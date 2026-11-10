/* ===========================================================================
   data/walmart-nucleo.js · el cruce Walmart ↔ Redlink, una sola vez

   Lo usan dos consumidores: la vista confirmaciones-walmart.html (en el
   navegador) y las pruebas de Node. UNA sola copia de la lógica, porque dos
   copias de la misma regla se separan sin que nadie se entere y después nadie
   sabe cuál de las dos es la que corrió.

   Sin dependencias. El .xlsx se lee con DecompressionStream, que existe en
   Chrome desde 2020 y en Node desde la 18: un .xlsx es un ZIP con XML adentro
   y eso se puede abrir sin traer una librería.
   =========================================================================== */
(function (raiz) {
'use strict';

/* ── el .xlsx, que es un ZIP ──────────────────────────────────────────────── */

// El directorio central del ZIP dice dónde empieza cada archivo, pero los
// largos de nombre y extra del ENCABEZADO LOCAL son otros. Usar los del
// directorio para saltar el encabezado es el error clásico, y deja el dato
// corrido unos bytes sin que nada avise.
function entradasZip(buf) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const u8 = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  let fin = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('No parece un .xlsx: no se encontró el final del ZIP');
  const cuantos = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const out = [];
  for (let i = 0; i < cuantos; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const comp   = dv.getUint32(p + 20, true);
    const nLargo = dv.getUint16(p + 28, true);
    const eLargo = dv.getUint16(p + 30, true);
    const cLargo = dv.getUint16(p + 32, true);
    const local  = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLargo));
    const ln = dv.getUint16(local + 26, true);
    const le = dv.getUint16(local + 28, true);
    const dato = local + 30 + ln + le;
    out.push({ nombre: nombre, metodo: metodo, inicio: dato, largo: comp });
    p += 46 + nLargo + eLargo + cLargo;
  }
  return { u8: u8, entradas: out };
}

async function inflar(u8, metodo) {
  if (metodo === 0) return new TextDecoder().decode(u8);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede descomprimir el archivo. Usa Chrome o Edge actualizados.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function leerXlsx(buf) {
  const z = entradasZip(buf);
  const buscar = (n) => z.entradas.find(e => e.nombre === n);
  const hoja = buscar('xl/worksheets/sheet1.xml');
  if (!hoja) throw new Error('El archivo no trae hoja de cálculo');
  const sstE = buscar('xl/sharedStrings.xml');
  const sst = sstE ? leerSharedStrings(await inflar(z.u8.subarray(sstE.inicio, sstE.inicio + sstE.largo), sstE.metodo)) : [];
  return leerHoja(await inflar(z.u8.subarray(hoja.inicio, hoja.inicio + hoja.largo), hoja.metodo), sst);
}

function desescapar(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
}

// Un texto puede venir partido en varios <t> (Excel parte en los formatos).
// Quedarse con el primero corta el valor por la mitad.
function leerSharedStrings(xml) {
  const out = [];
  const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const t = m[1].match(/<t[^>]*>[\s\S]*?<\/t>/g) || [];
    out.push(t.map(x => desescapar(x.replace(/<t[^>]*>/, '').replace(/<\/t>/, ''))).join(''));
  }
  return out;
}

// La referencia de celda manda. Apilar las celdas en orden ignora las vacías,
// que Excel simplemente no escribe, y corre todo hacia la izquierda.
function columnaANumero(ref) {
  const letras = String(ref).replace(/\d+/g, '');
  let n = 0;
  for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}

function leerHoja(xml, sst) {
  const filas = [];
  const reFila = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let f;
  while ((f = reFila.exec(xml))) {
    const celdas = [];
    // La celda AUTOCERRADA va primero en la alternancia. Al revés, <c r="B1"/>
    // lo muerde la primera rama (el "/" entra en [^>]*) y el cuerpo se come la
    // celda siguiente: la fila queda corrida sin que nada avise.
    const reC = /<c([^>]*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    while ((c = reC.exec(f[1]))) {
      const attrs = c[1] !== undefined ? c[1] : (c[2] || '');
      const cuerpo = c[3] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const tipo = (attrs.match(/t="([^"]+)"/) || [])[1];
      const col = ref ? columnaANumero(ref) : celdas.length;
      let v = null;
      const mv = cuerpo.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      const mis = cuerpo.match(/<is[^>]*>([\s\S]*?)<\/is>/);
      if (tipo === 's' && mv) v = sst[Number(mv[1])];
      else if (tipo === 'inlineStr' && mis) v = desescapar((mis[1].match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else if (mv) { const n = Number(mv[1]); v = isNaN(n) ? desescapar(mv[1]) : n; }
      while (celdas.length < col) celdas.push(null);
      celdas[col] = v;
    }
    filas.push(celdas);
  }
  return filas;
}

// Los seriales de Excel cuentan días desde 1900 con el bisiesto fantasma que
// Lotus se inventó: 25569 es el desfase contra la época de Unix.
function serialAFecha(n) {
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/* ── las columnas del reporte, por NOMBRE ─────────────────────────────────── */

// Columnas OPCIONALES: su ausencia no invalida el reporte. El PO sirve para el
// informe al cliente, pero un reporte sin esa columna sigue siendo un reporte
// válido y confirmable — exigirla haría que un archivo bueno se rechace entero
// por una columna que no decide nada.
const COLUMNAS_OPCIONALES = { po: 'po_nbr' };

const COLUMNAS = {
  cita: 'appt_nbr', rut: 'Rut', cliente: 'Razon Social', cd: 'po_dc_nbr',
  recepcion: 'rcvr_nbr', cuando: 'rcvr_final_ts', tipo: 'cntnr_type_desc',
  total: 'pallet_tot_qty', malos: 'pallet_bad_qty', canje: 'pallet_exch_qty',
  valido: 'valido'
};

// Por nombre y no por posición: el día que Walmart agregue una columna al
// medio, un lector por coordenadas lee otra cosa y no avisa.
function filasWalmart(matriz) {
  if (!matriz.length) throw new Error('La hoja vino vacía');
  const cab = matriz[0].map(x => (x === null || x === undefined) ? '' : String(x).trim());
  const idx = {};
  Object.keys(COLUMNAS).forEach(function (k) {
    const i = cab.indexOf(COLUMNAS[k]);
    if (i < 0) throw new Error('Al reporte le falta la columna "' + COLUMNAS[k] + '"');
    idx[k] = i;
  });
  Object.keys(COLUMNAS_OPCIONALES).forEach(function (k) {
    idx[k] = cab.indexOf(COLUMNAS_OPCIONALES[k]);   // -1 cuando no viene
  });
  const out = [];
  for (let r = 1; r < matriz.length; r++) {
    const f = matriz[r];
    if (!f || f[idx.cita] === null || f[idx.cita] === undefined || f[idx.cita] === '') continue;
    out.push({
      cita: String(Math.round(Number(f[idx.cita]))),
      // El PO va en el informe al cliente, y como todo lo que viene del reporte
      // no existe en Redlink: si no se arrastra desde acá, después no hay de
      // dónde sacarlo salvo volver a cruzar el .xlsx.
      po: idx.po < 0 ? '' : String(f[idx.po] === null || f[idx.po] === undefined ? '' : f[idx.po]).trim(),
      rut: String(f[idx.rut] || '').trim(),
      cliente: String(f[idx.cliente] || '').trim(),
      cd: String(f[idx.cd] === null ? '' : Math.round(Number(f[idx.cd]))),
      recepcion: String(f[idx.recepcion] === null ? '' : Math.round(Number(f[idx.recepcion]))),
      fecha: typeof f[idx.cuando] === 'number' ? serialAFecha(f[idx.cuando]) : String(f[idx.cuando] || '').slice(0, 10),
      total: Number(f[idx.total]) || 0,
      malos: Number(f[idx.malos]) || 0,
      canje: Number(f[idx.canje]) || 0
    });
  }
  return out;
}

/* ── el cruce ─────────────────────────────────────────────────────────────── */

const norm = (v) => (v === null || v === undefined) ? '' : String(v).trim();

// El campo de cita es libre y trae de todo: "42704805-42710381",
// "42713735 - 42716539", "42710724.". Las citas de verdad son de OCHO dígitos.
function citasDeTexto(v) { return Array.from(new Set(String(v || '').match(/\d{8}/g) || [])); }

// El reporte trae de vez en cuando filas de resumen con un número corto en la
// columna de cita y sin cliente (38046, 38044). No son citas: nombrarlas como
// "sin coincidencia en Redlink" manda a alguien a buscar en Redlink algo que
// nunca existió.
function esCita(v) { return /^\d{8}$/.test(String(v || '')); }

// Una misma cita puede venir en VARIAS filas del reporte, una por recepción.
// Del lado de Redlink esa cita es UNA transferencia, así que comparar fila por
// fila inventa diferencias que no existen.
function agruparPorCita(filas) {
  const m = new Map();
  (filas || []).forEach(function (f) {
    if (!m.has(f.cita)) m.set(f.cita, { cita: f.cita, filas: 0, total: 0, malos: 0, canje: 0,
                                        cliente: f.cliente, rut: f.rut, cd: f.cd, fecha: f.fecha,
                                        po: f.po || '', recepciones: [] });
    const g = m.get(f.cita);
    g.filas++; g.total += f.total; g.malos += f.malos; g.canje += f.canje;
    if (f.recepcion) g.recepciones.push(f.recepcion);
    if (f.fecha && (!g.fecha || f.fecha < g.fecha)) g.fecha = f.fecha;
  });
  return Array.from(m.values());
}

function indexar(ops) {
  const porCita = new Map(), conObs = [];
  (ops || []).forEach(function (o) {
    citasDeTexto(o.nroCita).forEach(function (c) {
      if (!porCita.has(c)) porCita.set(c, []);
      porCita.get(c).push(o);
    });
    if (norm(o.observacion)) conObs.push(o);
  });
  return { porCita: porCita, conObs: conObs };
}

function clasificar(grupo, idx) {
  const exactas = idx.porCita.get(grupo.cita) || [];
  if (exactas.length === 1) return { estado: 'exacta', ops: exactas };
  if (exactas.length > 1) return { estado: 'duplicada', ops: exactas };
  const porObs = idx.conObs.filter(o => norm(o.observacion).indexOf(grupo.cita) >= 0);
  if (porObs.length === 1) return { estado: 'por-observacion', ops: porObs };
  if (porObs.length > 1) return { estado: 'duplicada-observacion', ops: porObs };
  return { estado: 'sin-match', ops: [] };
}

/* ── las reglas, confirmadas por el área el 9-nov-2026 ─────────────────────── */

// CUANTO SE CONFIRMA: si Walmart recibió menos, lo recibido; si recibió más, lo
// despachado, porque no se puede confirmar más de lo que salió.
// QUE SE LE AVISA AL CLIENTE: las POSITIVAS. Si despachó 10 y Walmart dice 15,
// se confirman 10 y hay que avisarle para que emita otra transferencia por los
// 5 que faltan — esos pallets están en Walmart sin respaldo.
function reglaCantidad(despachada, recibidaWM) {
  const d = Number(despachada) || 0, a = Number(recibidaWM) || 0;
  return { aConfirmar: a < d ? a : d, diferencia: a - d, porAvisar: a > d ? a - d : 0 };
}

// Las dos etapas desde las que SÍ se confirma en el circuito masivo de
// Walmart: 44 "Pendiente de Confirmación" y 43 "Pendiente Adjuntar Respaldo".
// La tabla FormMetapa marca Confirmar=true sólo en la 44, y por eso durante
// días se trató la 43 como un paso pendiente del cliente. Lo resolvió Marcelo
// el 9-nov-2026: en las confirmaciones MASIVAS de Walmart no corresponde
// adjuntar respaldo — ese paso existe para que logística no vaya documento por
// documento; por el camino masivo se confirma de una.
// Lista explícita y corta: la 46 y la 49 ya están confirmadas y la 47 está
// anulada. Y empezar con "Pendiente" no alcanza, porque las dos empiezan igual.
const ETAPAS_CONFIRMABLES = [/pendiente\s+de\s+confirmaci/i, /pendiente\s+adjuntar\s+respaldo/i];
const RE_ANULADA = /anulad/i;
// Los servicios que van a Walmart por el circuito de transferencia, por NOMBRE
// exacto y no por un regex que adivine. Medido en vivo el 9-nov sobre 14.430
// operaciones: "Transferencias" (servicioId 28, 731 a bodegas ZWM*) y
// "Trans Diferenciada" (servicioId 70, 1.061 a ZWM*) usan la MISMA máquina de
// etapas —43 Pendiente Respaldo, 44 Pendiente de Confirmación, 46 Confirmada,
// 47 Anulada, 49 Reconfirmada— y "Trans Diferenciada" ya acumulaba 698
// confirmadas por 12.519 pallets. Un regex /transferenc/i dejaba fuera a la
// más grande de las dos.
// Lista explícita a propósito: cuando aparezca un servicio nuevo tiene que
// salir como excepción CON SU NOMBRE, no colarse ni desaparecer en silencio.
const SERVICIOS_TRANSFERENCIA = ['transferencia', 'transferencias', 'trans diferenciada'];
const etapaDe = (op) => String((op && op.etapaOperacion) || '');
const etapaConfirmable = (op) => { const e = etapaDe(op); return ETAPAS_CONFIRMABLES.some(re => re.test(e)); };
const esAnulada = (op) => RE_ANULADA.test(etapaDe(op));
const esTransferencia = (op) => {
  const n = norm(op && op.operacion).toLowerCase();
  return !n || SERVICIOS_TRANSFERENCIA.indexOf(n) >= 0;
};

// Dos señales independientes, porque con una sola ya nos equivocamos: una
// operación en etapa "Pendiente" puede traer fecha de confirmación con la
// cantidad en cero.
function estaConfirmada(op) {
  const n = Number(op && op.cantidadConfirmada) || 0;
  return n > 0 && !/^\s*pendiente/i.test(etapaDe(op));
}

/* ── el resultado: tres bandejas ──────────────────────────────────────────── */

// Nada desaparece en silencio. Toda cita entra a alguna bandeja con su motivo,
// porque una fila que falta en una lista que alguien va a ejecutar no se nota
// hasta que el cliente reclama.
function cruzar(filasWM, ops, opciones) {
  const o = opciones || {};
  const grupos = agruparPorCita(filasWM);
  const idx = indexar(ops);
  const porConfirmar = [], excepciones = [], avisar = [];
  const vistos = Object.create(null);

  grupos.forEach(function (g) {
    const c = clasificar(g, idx);
    const base = { cita: g.cita, cliente: g.cliente, rut: g.rut, cd: g.cd, fecha: g.fecha,
                   po: g.po || '',
                   recepciones: g.recepciones, totalWM: g.total, canjeWM: g.canje, malosWM: g.malos };

    if (!esCita(g.cita)) { excepciones.push(Object.assign(base, { clave: 'cita-invalida', motivo: 'el número de cita no tiene 8 dígitos: no es una cita de Walmart' })); return; }
    if (c.estado === 'sin-match') { excepciones.push(Object.assign(base, { clave: 'sin-match', motivo: 'sin coincidencia en Redlink' })); return; }
    if (c.ops.length !== 1) {
      excepciones.push(Object.assign(base, { clave: 'cita-ambigua', motivo: 'la cita cae en ' + c.ops.length + ' operaciones' }));
      return;
    }
    const op = c.ops[0];
    const fila = Object.assign(base, {
      folio: op.nroPedido, etapa: etapaDe(op), operacion: op.operacion || '',
      docId: op.formHeaderiD, clienteRedlink: op.clienteOrigenStr || '',
      servicio: norm(op.operacion),
      despachada: Number(op.cantidadDespachada) || 0,
      confirmada: Number(op.cantidadConfirmada) || 0,
      bodega: op.bodegaDestinoStr || '', via: c.estado
    });
    const r = reglaCantidad(fila.despachada, g.canje);
    fila.aConfirmar = r.aConfirmar;
    fila.diferencia = r.diferencia;
    fila.porAvisar = r.porAvisar;

    if (r.porAvisar > 0) avisar.push(fila);

    if (esAnulada(op))            { excepciones.push(Object.assign({}, fila, { clave: 'anulada', motivo: 'transferencia anulada' })); return; }
    if (!esTransferencia(op))     { excepciones.push(Object.assign({}, fila, { clave: 'no-transferencia', motivo: 'la operación no es una transferencia: ' + fila.operacion })); return; }
    if (estaConfirmada(op))       { excepciones.push(Object.assign({}, fila, { clave: 'ya-confirmada', motivo: 'ya estaba confirmada' })); return; }
    if (o.exigirEtapa && !etapaConfirmable(op)) {
      excepciones.push(Object.assign({}, fila, { clave: 'etapa', motivo: 'etapa "' + fila.etapa + '": todavía no es confirmable' }));
      return;
    }
    if (!(r.aConfirmar > 0))      { excepciones.push(Object.assign({}, fila, { clave: 'cantidad-cero', motivo: 'la cantidad a confirmar da cero' })); return; }
    if (fila.folio == null)       { excepciones.push(Object.assign({}, fila, { clave: 'sin-folio', motivo: 'la operación no trae folio' })); return; }

    vistos[fila.folio] = (vistos[fila.folio] || 0) + 1;
    porConfirmar.push(fila);
  });

  // Dos citas que caen en el mismo folio confirmarían dos veces la misma
  // transferencia. No se suman ni se elige una: salen las dos, nombradas.
  const limpias = [];
  porConfirmar.forEach(function (f) {
    if (vistos[f.folio] > 1) excepciones.push(Object.assign({}, f, { clave: 'folio-repetido', motivo: 'el mismo folio sale de ' + vistos[f.folio] + ' citas' }));
    else limpias.push(f);
  });
  limpias.sort((a, b) => Number(a.folio) - Number(b.folio));
  avisar.sort((a, b) => b.porAvisar - a.porAvisar);
  excepciones.sort((a, b) => String(a.motivo).localeCompare(String(b.motivo)));

  return { porConfirmar: limpias, excepciones: excepciones, avisar: avisar, citas: grupos.length };
}

const FAMILIAS = {
  'ya-confirmada':   'ya confirmadas',
  'sin-match':       'sin coincidencia en Redlink',
  'etapa':           'esperan respaldo',
  'anulada':         'anuladas',
  'no-transferencia':'no son transferencias',
  'cita-ambigua':    'la cita cae en varias operaciones',
  'folio-repetido':  'el folio sale de varias citas',
  'cita-invalida':   'el número no es una cita',
  'cantidad-cero':   'la cantidad da cero',
  'sin-folio':       'la operación no trae folio'
};

// De mayor a menor, y con empate resuelto por nombre para que dos corridas del
// mismo reporte no muestren el mismo resumen en distinto orden.
function resumenMotivos(excepciones) {
  const cuenta = new Map();
  (excepciones || []).forEach(function (e) {
    const k = e && e.clave ? e.clave : 'otro';
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
  });
  return Array.from(cuenta.entries())
    .map(([clave, n]) => ({ clave: clave, n: n, texto: FAMILIAS[clave] || clave }))
    .sort((a, b) => (b.n - a.n) || a.texto.localeCompare(b.texto));
}

// Partir la ventana de consulta en tramos. Medido el 10-nov-2026: con Redlink
// lento, 2 días responden en 1 segundo y 10 días mueren a los 21 con un 502
// del proxy. La página pedía ~40 días de una, así que en un día malo no
// funcionaba. El umbral no es fijo: depende de cómo esté el servidor.
function ventanasDe(desde, hasta, dias) {
  const paso = Math.max(1, parseInt(dias, 10) || 5);
  const d0 = new Date(String(desde) + 'T12:00:00'), d1 = new Date(String(hasta) + 'T12:00:00');
  // Explícito aunque el for tampoco correría: una guarda que se lee vale más
  // que un vacío que hay que deducir.
  if (isNaN(d0) || isNaN(d1) || d1 < d0) return [];
  const DIA = 86400000, out = [];
  for (let t = d0.getTime(); t <= d1.getTime(); t += paso * DIA) {
    const fin = Math.min(t + (paso - 1) * DIA, d1.getTime());
    out.push({ desde: new Date(t).toISOString().slice(0, 10),
               hasta: new Date(fin).toISOString().slice(0, 10) });
  }
  return out;
}

// ¿Dos rangos de fecha se pisan? Sirve para decidir si un tramo que no se pudo
// traer importa o no: /proxy/ops sirve los días cerrados desde nuestro blob
// (instantáneo) y sólo los últimos 2 en vivo contra Redlink, que es la parte
// que falla. Un hueco en esa cola viva no afecta a un reporte de Walmart cuyas
// recepciones son de hace días: esas transferencias se despacharon antes y
// salen del blob.
function seSolapan(a, b) {
  if (!a || !b || !a.desde || !a.hasta || !b.desde || !b.hasta) return false;
  return String(a.desde) <= String(b.hasta) && String(b.desde) <= String(a.hasta);
}

function csvDeConfirmar(filas) {
  const out = ['folio;cantRecibida'];
  (filas || []).forEach(f => out.push(String(f.folio) + ';' + String(f.aConfirmar)));
  return out.join('\r\n') + '\r\n';
}
function tsvDeConfirmar(filas) {
  return (filas || []).map(f => String(f.folio) + '\t' + String(f.aConfirmar)).join('\n');
}

// La ventana de operaciones tiene que cubrir las fechas del reporte más un
// margen: una transferencia despachada el día anterior aparece en el reporte
// de hoy, y sin el margen no cruza.
function ventanaDeReporte(filasWM, margen) {
  const m = Number.isFinite(Number(margen)) ? Number(margen) : 20;
  const fechas = (filasWM || []).map(f => f.fecha).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  if (!fechas.length) return null;
  const corrido = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  return { desde: corrido(fechas[0], -m), hasta: corrido(fechas[fechas.length - 1], m) };
}

const API = { entradasZip, leerXlsx, leerSharedStrings, leerHoja, columnaANumero, serialAFecha,
              COLUMNAS, COLUMNAS_OPCIONALES, filasWalmart, citasDeTexto, esCita, agruparPorCita, indexar, clasificar,
              SERVICIOS_TRANSFERENCIA, ETAPAS_CONFIRMABLES,
              reglaCantidad, etapaConfirmable, esAnulada, esTransferencia, estaConfirmada,
              cruzar, FAMILIAS, resumenMotivos, csvDeConfirmar, tsvDeConfirmar, ventanaDeReporte,
              ventanasDe, seSolapan };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else raiz.WalmartNucleo = API;

})(typeof self !== 'undefined' ? self : this);
