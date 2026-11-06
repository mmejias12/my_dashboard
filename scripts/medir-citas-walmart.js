// scripts/medir-citas-walmart.js
// ============================================================================
//  ¿Sirve la CITA como llave para cruzar el reporte diario de Walmart contra
//  nuestras operaciones, y nuestra regla reproduce lo que ya se confirmó?
//
//  QUE SE MIDE Y POR QUE. Hoy el cruce lo hace un módulo del proveedor que se
//  da de baja. Antes de prometer un reemplazo hay que saber dos cosas:
//
//    1. COBERTURA DE LA LLAVE. Walmart manda `appt_nbr` (la cita). Nuestras
//       operaciones traen `nroCita` desde que la extracción pasó a Redlink.
//       ¿Calzan? ¿Cuántas quedan sin match, cuántas matchean más de una?
//    2. SI LA REGLA ES LA CORRECTA. Y acá está lo bueno: el módulo del
//       proveedor VIENE CONFIRMANDO SOLO con un usuario de sistema, así que
//       la respuesta correcta YA ESTA ESCRITA en `cantidadConfirmada`. No hay
//       que adivinar si la regla es la buena: se contrasta contra lo que ya
//       pasó. Una medición con verdad conocida vale mil suposiciones.
//
//  LA REGLA QUE SE CONTRASTA, leída de la pantalla del módulo del proveedor:
//    Walmart aceptó MENOS que lo despachado -> se confirma lo ACEPTADO, y la
//      diferencia queda "por informar" al cliente
//    Walmart aceptó IGUAL o MAS           -> se confirma lo DESPACHADO, y no
//      queda nada por informar
//
//  ESTE SCRIPT NO ESCRIBE NADA. Ni en el storage, ni en Redlink. Sólo lee.
//
//  Uso (desde la raíz del repo):
//    node scripts/medir-citas-walmart.js <Reporte-RedTec.xlsx>
//    node scripts/medir-citas-walmart.js <archivo.xlsx> --dias=30
//    node scripts/medir-citas-walmart.js <archivo.xlsx> --detalle
//
//  Entorno: OS_STORAGE_CONN (el cold store de operaciones). Si falta, para y
//  dice cuál, nunca su valor.
// ============================================================================
'use strict';

const fs = require('fs');
const zlib = require('zlib');

/* ── Lector de .xlsx sin dependencias ──────────────────────────────────────
   Un .xlsx es un ZIP con XML adentro. Se lee a mano a propósito: agregar una
   dependencia a un script que va a correr en la máquina de REDTEC es un
   problema de instalación el día que haga falta, y el formato de este archivo
   es fijo (lo genera Walmart siempre igual).                                */

function entradasZip(buf) {
  // Fin del directorio central: se busca desde atrás porque puede traer comentario.
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('No parece un .xlsx: no se encontró el fin del ZIP');
  const cuantas = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);

  const out = {};
  for (let i = 0; i < cuantas; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP corrupto en la entrada ' + i);
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const nLargo = buf.readUInt16LE(p + 28);
    const eLargo = buf.readUInt16LE(p + 30);
    const cLargo = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nLargo);

    // El encabezado local tiene SUS PROPIOS largos de nombre y extra, que no
    // tienen por qué coincidir con los del directorio central. Usar los del
    // central para calcular el offset del dato es el error clásico.
    const ln = buf.readUInt16LE(local + 26);
    const le = buf.readUInt16LE(local + 28);
    const dato = local + 30 + ln + le;
    const crudo = buf.slice(dato, dato + comprimido);
    out[nombre] = metodo === 0 ? crudo : zlib.inflateRawSync(crudo);
    p += 46 + nLargo + eLargo + cLargo;
  }
  return out;
}

function desescapar(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#\d+);/g, function (m, e) {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    return String.fromCharCode(Number(e.slice(1)));
  });
}

function leerSharedStrings(xml) {
  const out = [];
  // Cada <si> puede traer varios <t> (texto con formato partido en pedazos):
  // se concatenan, si no una celda con dos formatos vuelve cortada.
  const si = String(xml).match(/<si>[\s\S]*?<\/si>/g) || [];
  si.forEach(function (bloque) {
    const t = bloque.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(t.map(x => desescapar(x.replace(/<t[^>]*>/, '').replace(/<\/t>/, ''))).join(''));
  });
  return out;
}

function columnaANumero(ref) {
  const letras = String(ref).replace(/\d+/g, '');
  let n = 0;
  for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}

function leerHoja(xml, sst) {
  const filas = [];
  const brutas = String(xml).match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  brutas.forEach(function (fila) {
    const celdas = [];
    const cs = fila.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || [];
    cs.forEach(function (c) {
      const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1];
      const tipo = (c.match(/t="([^"]+)"/) || [])[1] || 'n';
      const col = ref ? columnaANumero(ref) : celdas.length;
      let v = null;
      if (tipo === 'inlineStr') {
        const t = c.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        v = t ? desescapar(t[1]) : null;
      } else {
        const m = c.match(/<v>([\s\S]*?)<\/v>/);
        if (m) {
          const crudo = desescapar(m[1]);
          if (tipo === 's') v = sst[Number(crudo)];
          else if (tipo === 'b') v = crudo === '1';
          else if (tipo === 'str' || tipo === 'e') v = crudo;
          else v = Number(crudo);      // los números llegan en notación científica: 4.2750687E7
        }
      }
      while (celdas.length < col) celdas.push(null);
      celdas[col] = v;
    });
    filas.push(celdas);
  });
  return filas;
}

/* Serial de Excel -> fecha ISO. El sistema 1900 cuenta desde 1899-12-30 porque
   Excel arrastra el bug del 29-feb-1900 que nunca existió. */
function serialAFecha(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

function leerXlsx(buf) {
  const z = entradasZip(buf);
  const hoja = Object.keys(z).find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  if (!hoja) throw new Error('El .xlsx no trae xl/worksheets/sheet1.xml');
  const sst = z['xl/sharedStrings.xml'] ? leerSharedStrings(z['xl/sharedStrings.xml'].toString('utf8')) : [];
  return leerHoja(z[hoja].toString('utf8'), sst);
}

/* ── El reporte de Walmart ─────────────────────────────────────────────────
   Las columnas se ubican POR NOMBRE, nunca por posición: el día que Walmart
   agregue una columna al medio, un parser por coordenadas lee otra cosa y no
   avisa. Si falta una columna que necesitamos, falla diciendo cuál.         */
const COLUMNAS = {
  cita: 'appt_nbr', rut: 'Rut', cliente: 'Razon Social', cd: 'po_dc_nbr',
  recepcion: 'rcvr_nbr', cuando: 'rcvr_final_ts', tipo: 'cntnr_type_desc',
  total: 'pallet_tot_qty', malos: 'pallet_bad_qty', canje: 'pallet_exch_qty',
  valido: 'valido'
};

function filasWalmart(matriz) {
  if (!matriz.length) throw new Error('La hoja vino vacía');
  const cab = matriz[0].map(x => (x === null || x === undefined) ? '' : String(x).trim());
  const idx = {};
  Object.keys(COLUMNAS).forEach(function (k) {
    const i = cab.indexOf(COLUMNAS[k]);
    if (i < 0) throw new Error('Al reporte de Walmart le falta la columna "' + COLUMNAS[k] + '". Columnas: ' + cab.join(', '));
    idx[k] = i;
  });
  const out = [];
  for (let r = 1; r < matriz.length; r++) {
    const f = matriz[r];
    if (!f || f[idx.cita] === null || f[idx.cita] === undefined || f[idx.cita] === '') continue;
    out.push({
      fila: r + 1,
      cita: String(Math.round(Number(f[idx.cita]))),
      rut: String(f[idx.rut] || '').trim(),
      cliente: String(f[idx.cliente] || '').trim(),
      cd: String(f[idx.cd] === null ? '' : Math.round(Number(f[idx.cd]))),
      recepcion: String(f[idx.recepcion] === null ? '' : Math.round(Number(f[idx.recepcion]))),
      fecha: typeof f[idx.cuando] === 'number' ? serialAFecha(f[idx.cuando]) : String(f[idx.cuando] || '').slice(0, 10),
      tipo: String(f[idx.tipo] || '').trim(),
      total: Number(f[idx.total]) || 0,
      malos: Number(f[idx.malos]) || 0,
      canje: Number(f[idx.canje]) || 0,
      valido: String(f[idx.valido]).toLowerCase() === 'true'
    });
  }
  return out;
}

/* ── La regla de cantidades ────────────────────────────────────────────────
   Leída de la pantalla del módulo del proveedor, no inventada. Las positivas
   (Walmart aceptó MAS de lo despachado) se confirman por lo despachado: no se
   puede confirmar más de lo que salió.                                      */
function reglaCantidad(despachada, aceptadaWM) {
  const d = Number(despachada) || 0, a = Number(aceptadaWM) || 0;
  const aConfirmar = a < d ? a : d;
  return { aConfirmar: aConfirmar, diferencia: a - d, porInformar: a < d ? d - a : 0 };
}

/* ── El cruce ─────────────────────────────────────────────────────────────── */
const norm = (v) => (v === null || v === undefined) ? '' : String(v).trim();

/* Un índice por cita y otro por el texto de la observación. El segundo es el
   camino de respaldo que usa el módulo del proveedor cuando la cita no calza
   exacto; se mide aparte para saber cuánto pesa. */
function indexar(ops) {
  const porCita = new Map(), conObs = [];
  ops.forEach(function (o) {
    const c = norm(o.nroCita);
    if (c) { if (!porCita.has(c)) porCita.set(c, []); porCita.get(c).push(o); }
    const ob = norm(o.observacion);
    if (ob) conObs.push(o);
  });
  return { porCita, conObs };
}

function clasificar(fila, idx) {
  const exactas = idx.porCita.get(fila.cita) || [];
  if (exactas.length === 1) return { estado: 'exacta', ops: exactas };
  if (exactas.length > 1) return { estado: 'duplicada', ops: exactas };
  const porObs = idx.conObs.filter(o => norm(o.observacion).indexOf(fila.cita) >= 0);
  if (porObs.length === 1) return { estado: 'por-observacion', ops: porObs };
  if (porObs.length > 1) return { estado: 'duplicada-observacion', ops: porObs };
  return { estado: 'sin-match', ops: [] };
}

/* Contraste contra la verdad ya escrita. Sólo tiene sentido en operaciones ya
   confirmadas: en las pendientes no hay con qué comparar todavía. */
function contrastar(fila, op) {
  const r = reglaCantidad(op.cantidadDespachada, fila.canje);
  const confirmada = Number(op.cantidadConfirmada) || 0;
  const yaConfirmada = !!op.fechaConfirmacion || confirmada > 0;
  return {
    yaConfirmada: yaConfirmada,
    laRegla: r.aConfirmar,
    loReal: confirmada,
    calza: yaConfirmada ? r.aConfirmar === confirmada : null,
    despachada: Number(op.cantidadDespachada) || 0,
    aceptadaWM: fila.canje,
    porInformar: r.porInformar
  };
}

/* ── Lectura del cold store ───────────────────────────────────────────────── */
function fechasEntre(desde, hasta) {
  const out = [], d = new Date(desde + 'T12:00:00'), f = new Date(hasta + 'T12:00:00');
  while (d <= f) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}
const corrido = (fecha, n) => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function leerCold(desde, hasta) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const cont = BlobServiceClient.fromConnectionString(process.env.OS_STORAGE_CONN)
    .getContainerClient('redtec-os-operaciones');
  const dias = fechasEntre(desde, hasta);
  const ops = [];
  let conBlob = 0;
  const LOTE = 12;
  for (let i = 0; i < dias.length; i += LOTE) {
    const grupo = dias.slice(i, i + LOTE);
    const partes = await Promise.all(grupo.map(async function (f) {
      try {
        const buf = await cont.getBlockBlobClient('operaciones/' + f + '.json').downloadToBuffer();
        const o = JSON.parse(buf.toString('utf8'));
        return (o && o.operaciones) || [];
      } catch (e) { return null; }
    }));
    partes.forEach(function (p) { if (p) { conBlob++; p.forEach(x => { delete x._rl; ops.push(x); }); } });
    process.stdout.write('  leidos ' + Math.min(i + LOTE, dias.length) + '/' + dias.length + ' dias\r');
  }
  console.log('  leidos ' + dias.length + '/' + dias.length + ' dias   ');
  return { ops, dias: dias.length, conBlob };
}

/* ── Credenciales ─────────────────────────────────────────────────────────
   No basta con que la variable EXISTA. Si alguien pega un texto de ejemplo
   —pasa, y ya pasó— la variable queda cargada con basura y el SDK de Azure
   muere con un "Invalid URL" que no dice nada de lo que realmente ocurrio.
   Acá se mira la PINTA de la cadena y se falla diciendo que pasa, sin
   imprimir nunca el valor: del diagnostico sale el largo y nada mas.       */
function pintaDeConexion(v) {
  if (!v || !String(v).trim()) return false;
  return /(^|;)\s*(DefaultEndpointsProtocol|AccountName|BlobEndpoint|SharedAccessSignature)\s*=/i.test(String(v));
}

function exigirConexion() {
  const v = process.env.OS_STORAGE_CONN;
  if (!v) {
    console.error('Falta la variable de entorno OS_STORAGE_CONN. En esta misma consola:');
    console.error('  $env:OS_STORAGE_CONN="<la cadena real del storage>"');
    process.exit(1);
  }
  if (!pintaDeConexion(v)) {
    console.error('OS_STORAGE_CONN esta cargada pero NO parece una cadena de conexion de Azure.');
    console.error('  largo: ' + String(v).length + ' caracteres' +
      (String(v) !== String(v).trim() ? '  ·  OJO: trae espacios en los bordes' : ''));
    console.error('  (el valor no se imprime, a proposito)');
    console.error('  Una cadena valida arranca con DefaultEndpointsProtocol= o BlobEndpoint=.');
    console.error('  Si pegaste un texto de ejemplo entre < >, carga la cadena de verdad.');
    process.exit(1);
  }
}

/* ── Corrida ──────────────────────────────────────────────────────────────── */
const miles = (n) => Number(n || 0).toLocaleString('es-CL');

async function main() {
  const args = process.argv.slice(2);
  const archivo = args.find(a => a.indexOf('--') !== 0);
  const dias = Number((args.find(a => a.startsWith('--dias=')) || '').split('=')[1]) || 20;
  const detalle = args.includes('--detalle');
  if (!archivo) { console.error('Falta el archivo. Uso: node scripts/medir-citas-walmart.js <Reporte-RedTec.xlsx>'); process.exit(1); }
  exigirConexion();

  const wm = filasWalmart(leerXlsx(fs.readFileSync(archivo)));
  const fechas = wm.map(f => f.fecha).filter(Boolean).sort();
  const desde = corrido(fechas[0], -dias), hasta = corrido(fechas[fechas.length - 1], dias);

  console.log('MEDIR CITAS WALMART · no escribe nada');
  console.log('  reporte : ' + archivo);
  console.log('  filas   : ' + wm.length + ' · citas distintas: ' + new Set(wm.map(f => f.cita)).size);
  console.log('  recibido: ' + fechas[0] + ' .. ' + fechas[fechas.length - 1]);
  console.log('  cold    : ' + desde + ' .. ' + hasta + ' (+-' + dias + ' dias)');

  const { ops, dias: nDias, conBlob } = await leerCold(desde, hasta);
  console.log('  operaciones leidas: ' + miles(ops.length) + ' en ' + conBlob + ' de ' + nDias + ' dias con blob');

  const conCita = ops.filter(o => norm(o.nroCita)).length;
  console.log('  de esas, con nroCita: ' + miles(conCita) + ' (' + (ops.length ? (conCita / ops.length * 100).toFixed(1) : 0) + '%)');

  const idx = indexar(ops);
  const res = wm.map(function (f) {
    const c = clasificar(f, idx);
    const op = c.ops.length === 1 ? c.ops[0] : null;
    return { f, estado: c.estado, ops: c.ops, op, cmp: op ? contrastar(f, op) : null };
  });

  const cuenta = {};
  res.forEach(r => { cuenta[r.estado] = (cuenta[r.estado] || 0) + 1; });

  console.log('\n' + '='.repeat(70));
  console.log('COBERTURA DE LA LLAVE');
  ['exacta', 'por-observacion', 'duplicada', 'duplicada-observacion', 'sin-match'].forEach(function (k) {
    if (cuenta[k]) console.log('  ' + k.padEnd(24) + String(cuenta[k]).padStart(4) + '  (' + (cuenta[k] / wm.length * 100).toFixed(0) + '%)');
  });

  const unicos = res.filter(r => r.op);
  const confirmados = unicos.filter(r => r.cmp.yaConfirmada);
  const calzan = confirmados.filter(r => r.cmp.calza);
  console.log('\nCONTRASTE CONTRA LO YA CONFIRMADO  (la verdad que dejó el proveedor)');
  console.log('  con match unico            ' + String(unicos.length).padStart(4));
  console.log('  de esos, ya confirmados    ' + String(confirmados.length).padStart(4));
  console.log('  la regla da lo mismo en    ' + String(calzan.length).padStart(4) +
              (confirmados.length ? '  (' + (calzan.length / confirmados.length * 100).toFixed(1) + '%)' : ''));

  const fallan = confirmados.filter(r => !r.cmp.calza);
  if (fallan.length) {
    console.log('\n  DONDE LA REGLA NO REPRODUCE LO CONFIRMADO:');
    fallan.slice(0, 25).forEach(function (r) {
      console.log('    cita ' + r.f.cita + ' · ped ' + r.op.nroPedido + ' · ' + (r.f.cliente || '').slice(0, 26).padEnd(26) +
        ' desp ' + String(r.cmp.despachada).padStart(4) + ' · WM ' + String(r.cmp.aceptadaWM).padStart(4) +
        ' · regla ' + String(r.cmp.laRegla).padStart(4) + ' · real ' + String(r.cmp.loReal).padStart(4));
    });
    if (fallan.length > 25) console.log('    ... y ' + (fallan.length - 25) + ' mas');
  }

  const pendientes = unicos.filter(r => !r.cmp.yaConfirmada);
  console.log('\n  pendientes de confirmar    ' + String(pendientes.length).padStart(4) +
              (pendientes.length ? '  (son las que haria el reemplazo)' : ''));

  const porInformar = unicos.filter(r => r.cmp.porInformar > 0);
  console.log('  con diferencia a informar  ' + String(porInformar.length).padStart(4) +
              '  (' + miles(porInformar.reduce((a, r) => a + r.cmp.porInformar, 0)) + ' pallets)');

  if (detalle) {
    console.log('\nQUE OPERACIONES SON (las que matchearon)');
    const tipos = {}, bodegas = {}, etapas = {};
    unicos.forEach(function (r) {
      tipos[r.op.operacion] = (tipos[r.op.operacion] || 0) + 1;
      bodegas[r.op.bodegaDestinoStr] = (bodegas[r.op.bodegaDestinoStr] || 0) + 1;
      etapas[r.op.etapaOperacion] = (etapas[r.op.etapaOperacion] || 0) + 1;
    });
    [['tipo de operacion', tipos], ['bodega destino', bodegas], ['etapa', etapas]].forEach(function (par) {
      console.log('  ' + par[0] + ':');
      Object.keys(par[1]).sort((a, b) => par[1][b] - par[1][a]).slice(0, 12)
        .forEach(k => console.log('    ' + String(par[1][k]).padStart(4) + '  ' + k));
    });
    const sin = res.filter(r => r.estado === 'sin-match');
    if (sin.length) {
      console.log('\n  CITAS SIN MATCH (las primeras 20):');
      sin.slice(0, 20).forEach(r => console.log('    ' + r.f.cita + ' · ' + r.f.fecha + ' · CD ' + r.f.cd + ' · ' +
        (r.f.cliente || '').slice(0, 34).padEnd(34) + ' ' + r.f.canje + ' pallets'));
    }
  }

  console.log('\n' + '='.repeat(70));
  const cob = ((cuenta['exacta'] || 0) + (cuenta['por-observacion'] || 0)) / wm.length;
  if (cob >= 0.95 && confirmados.length && calzan.length === confirmados.length) {
    console.log('VEREDICTO: la cita sirve de llave y la regla reproduce lo ya confirmado.');
    console.log('El reemplazo es mecanico; el trabajo esta en las bandejas de excepcion.');
  } else if (cob < 0.8) {
    console.log('VEREDICTO: la cita NO alcanza como llave (' + (cob * 100).toFixed(0) + '% de cobertura).');
    console.log('El cruce ES el proyecto, no un detalle. Hay que entender que les falta.');
  } else {
    console.log('VEREDICTO: cobertura ' + (cob * 100).toFixed(0) + '%' +
      (confirmados.length ? ', la regla calza en ' + (calzan.length / confirmados.length * 100).toFixed(0) + '% de lo ya confirmado' : '') + '.');
    console.log('Mirar arriba donde falla antes de decidir el alcance.');
  }
}

module.exports = { entradasZip, leerSharedStrings, leerHoja, columnaANumero, serialAFecha,
                   leerXlsx, filasWalmart, reglaCantidad, indexar, clasificar, contrastar,
                   fechasEntre, corrido, COLUMNAS, pintaDeConexion };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
