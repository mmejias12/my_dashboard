// scripts/test-medir-citas-walmart.js
// ============================================================================
//  Pruebas de medir-citas-walmart.js. Todo puro: ni red, ni storage, ni Excel
//  de verdad — el .xlsx de prueba se ARMA acá, byte a byte, para que el lector
//  se pruebe contra el formato y no contra un archivo en particular.
//
//  Uso:
//    node scripts/test-medir-citas-walmart.js
//    node scripts/test-medir-citas-walmart.js --mutaciones
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ORIGEN = path.join(__dirname, 'medir-citas-walmart.js');

const MUTACIONES = {
  H01: { que: 'la letra de columna se traduce corrida en uno',
         de: '  return n - 1;', a: '  return n;' },
  H02: { que: 'el serial de Excel se convierte con un dia de diferencia',
         de: 'const ms = Math.round((n - 25569) * 86400000);', a: 'const ms = Math.round((n - 25568) * 86400000);' },
  H03: { que: 'un texto partido en varios <t> se lee cortado',
         de: "    out.push(t.map(x => desescapar(x.replace(/<t[^>]*>/, '').replace(/<\\/t>/, ''))).join(''));",
         a: "    out.push(t.length ? desescapar(t[0].replace(/<t[^>]*>/, '').replace(/<\\/t>/, '')) : '');" },
  H04: { que: 'las celdas se apilan en orden y se ignora su referencia',
         de: '      const col = ref ? columnaANumero(ref) : celdas.length;', a: '      const col = celdas.length;' },
  H05: { que: 'el offset del dato usa los largos del directorio central (el error clasico del ZIP)',
         de: '    const dato = local + 30 + ln + le;', a: '    const dato = local + 30 + nLargo + eLargo;' },
  H06: { que: 'las columnas del reporte se ubican por posicion y no por nombre',
         de: '    const i = cab.indexOf(COLUMNAS[k]);', a: '    const i = Object.keys(COLUMNAS).indexOf(k);' },
  H07: { que: 'se confirma lo que acepto Walmart aunque sea MAS de lo despachado',
         de: '  const aConfirmar = a < d ? a : d;', a: '  const aConfirmar = a;' },
  H08: { que: 'una diferencia positiva tambien deja algo por informar',
         de: '  return { aConfirmar: aConfirmar, diferencia: a - d, porInformar: a < d ? d - a : 0 };',
         a: '  return { aConfirmar: aConfirmar, diferencia: a - d, porInformar: Math.abs(d - a) };' },
  H09: { que: 'una cita que matchea varias operaciones se trata como match exacto',
         de: "  if (exactas.length > 1) return { estado: 'duplicada', ops: exactas };",
         a: "  if (exactas.length > 1) return { estado: 'exacta', ops: [exactas[0]] };" },
  H10: { que: 'no se intenta el respaldo por el texto de la observacion',
         de: '  const porObs = idx.conObs.filter(o => norm(o.observacion).indexOf(fila.cita) >= 0);',
         a: '  const porObs = [];' },
  H11: { que: 'una operacion pendiente se cuenta como que la regla calzo',
         de: '    calza: yaConfirmada ? r.aConfirmar === confirmada : null,', a: '    calza: true,' },
  H26: { que: 'del campo se toma solo la primera cita y se ignoran las demas',
         de: "  const m = String(v || '').match(/\\d{8}/g) || [];",
         a: "  const m = (String(v || '').match(/\\d{8}/) || []).slice(0, 1);" },
  H27: { que: 'se extraen tambien numeros que no tienen largo de cita',
         de: "  const m = String(v || '').match(/\\d{8}/g) || [];",
         a: "  const m = String(v || '').match(/\\d+/g) || [];" },
  H30: { que: 'un dia se da por cerrado aunque falte el reporte del dia de recepcion',
         de: '    for (let i = 0; i <= margen; i++) if (!rep.has(corrido(d, i))) return false;\n    return true;',
         a: '    return true;' },
  H29: { que: 'se comparan tambien dias que Walmart nunca reporto',
         de: '    for (let i = 0; i <= margen; i++) if (rep.has(corrido(f, i))) return true;\n    return false;',
         a: '    return true;' },
  H28: { que: 'una transferencia con dos citas se da por informada solo con la primera',
         de: '  const informada = (o) => citasDeTexto(o.nroCita).some(c => hay.has(c));',
         a: '  const informada = (o) => hay.has(citasDeTexto(o.nroCita)[0]);' },
  H25: { que: 'cualquier numero pasa como cita de Walmart',
         de: "function citaDeWalmart(c) { return /^\\d{8}$/.test(String(c || '').trim()); }",
         a: "function citaDeWalmart(c) { return /^\\d+$/.test(String(c || '').trim()); }" },
  H19: { que: 'una fecha de confirmacion basta para darla por confirmada',
         de: "  return n > 0 && !/^\\s*pendiente/i.test(etapa);", a: '  return true;' },
  H20: { que: 'una etapa pendiente con cantidad se cuenta como confirmada',
         de: "  return n > 0 && !/^\\s*pendiente/i.test(etapa);", a: '  return n > 0;' },
  H21: { que: 'las recepciones de una misma cita no se suman',
         de: '    g.filas++; g.total += f.total; g.malos += f.malos; g.canje += f.canje;',
         a: '    g.filas++; g.total = f.total; g.malos = f.malos; g.canje = f.canje;' },
  H22: { que: 'el cruce inverso toma tambien bodegas que no son de Walmart',
         de: "const esWalmart = (op) => /^\\s*ZWM/i.test(String((op && op.bodegaDestinoStr) || ''));",
         a: 'const esWalmart = (op) => true;' },
  H23: { que: 'las que no tienen cita se cuentan como no informadas por Walmart',
         de: '  const sinCita = candidatas.filter(o => !norm(o.nroCita));', a: '  const sinCita = [];' },
  H24: { que: 'una transferencia que Walmart SI informo igual va al correo',
         de: '    noInformadas: conCita.filter(o => !hay.has(norm(o.nroCita)))',
         a: '    noInformadas: conCita' },
  H17: { que: 'cualquier nombre de cuenta se acepta',
         de: "  return typeof nombre === 'string' && /^[a-z0-9]{3,24}$/.test(nombre);",
         a: "  return typeof nombre === 'string';" },
  H18: { que: 'el nombre de cuenta se busca tambien dentro de la clave',
         de: "  const m = String(v || '').match(/(^|;)\\s*AccountName\\s*=\\s*([^;]*)/i);",
         a: "  const m = String(v || '').match(/AccountName\\s*=\\s*(.*)/i) && [0,0,String(v).split('AccountName=')[1]||''];" },
  H15: { que: 'un 403 de credenciales se trata como un dia sin blob',
         de: '  if (e.statusCode === 404 || cod === ', a: '  if (true || e.statusCode === 404 || cod === ' },
  H16: { que: '"no existe" se decide solo por el texto del mensaje',
         de: "  if (e.statusCode === 404 || cod === 'BlobNotFound' || cod === 'ContainerNotFound') return true;",
         a: '  ;' },
  H13: { que: 'cualquier texto pasa como cadena de conexion',
         de: "  return /(^|;)\\s*(DefaultEndpointsProtocol|AccountName|BlobEndpoint|SharedAccessSignature)\\s*=/i.test(String(v));",
         a: '  return true;' },
  H14: { que: 'alcanza con que la variable no este vacia',
         de: "  if (!v || !String(v).trim()) return false;", a: '  return !!v;' },
  H12: { que: 'las filas sin cita entran igual al cruce',
         de: "    if (!f || f[idx.cita] === null || f[idx.cita] === undefined || f[idx.cita] === '') continue;",
         a: '    if (!f) continue;' }
};

/* ── Un .xlsx de verdad, armado a mano ─────────────────────────────────────
   Se construye el ZIP byte a byte para poder meterle la trampa que importa:
   el encabezado LOCAL lleva un campo "extra" de largo distinto al del
   directorio central. Un lector que calcule el offset del dato con los largos
   del central lee basura. Pasa en archivos reales y es invisible hasta que
   pasa.                                                                     */
function entrada(nombre, datos, extraLocal) {
  const n = Buffer.from(nombre, 'utf8');
  const comp = zlib.deflateRawSync(datos);
  const ex = Buffer.alloc(extraLocal || 0);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22);
  lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(ex.length, 28);
  return { nombre: n, local: Buffer.concat([lh, n, ex, comp]), comp: comp.length, cruda: datos.length };
}

function armarZip(archivos) {
  const partes = [], centrales = [];
  let off = 0;
  archivos.forEach(function (a) {
    const e = entrada(a.nombre, Buffer.from(a.datos, 'utf8'), a.extraLocal);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10); cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(e.comp, 20); cd.writeUInt32LE(e.cruda, 24);
    cd.writeUInt16LE(e.nombre.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(off, 42);
    centrales.push(Buffer.concat([cd, e.nombre]));
    partes.push(e.local); off += e.local.length;
  });
  const dir = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(archivos.length, 8); eocd.writeUInt16LE(archivos.length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(partes), dir, eocd]);
}

const CAB = ['Rut','Razon Social','vend_nbr','po_nbr','appt_nbr','po_dc_nbr','rcvr_nbr','vend_nm',
             'rcvr_final_ts','cntnr_type_cd','cntnr_type_desc','pallet_tot_qty','pallet_bad_qty',
             'pallet_exch_qty','valido','last_chng_userid','last_chng_ts','vendor'];

/* Arma un xlsx con la cabecera real y las filas que se le pasen. */
function xlsxDePrueba(filas, cabecera) {
  const cab = cabecera || CAB;
  const textos = [];
  const idxTexto = (s) => { const i = textos.indexOf(s); if (i >= 0) return i; textos.push(s); return textos.length - 1; };
  const letra = (i) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const celdas = [];
  cab.forEach((c, i) => celdas.push(`<c r="${letra(i)}1" t="s"><v>${idxTexto(c)}</v></c>`));
  let xml = `<row r="1">${celdas.join('')}</row>`;
  filas.forEach(function (f, r) {
    const cs = f.map(function (v, i) {
      if (v === null || v === undefined) return '';
      const ref = letra(i) + (r + 2);
      return (typeof v === 'number')
        ? `<c r="${ref}" t="n"><v>${v}</v></c>`
        : `<c r="${ref}" t="s"><v>${idxTexto(String(v))}</v></c>`;
    }).join('');
    xml += `<row r="${r + 2}">${cs}</row>`;
  });
  const sst = '<?xml version="1.0"?><sst>' + textos.map(t => '<si><t>' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</t></si>').join('') + '</sst>';
  const hoja = '<?xml version="1.0"?><worksheet><sheetData>' + xml + '</sheetData></worksheet>';
  // extraLocal distinto de cero SOLO en la hoja: es la trampa del offset.
  return armarZip([{ nombre: 'xl/sharedStrings.xml', datos: sst },
                   { nombre: 'xl/worksheets/sheet1.xml', datos: hoja, extraLocal: 6 }]);
}

/* Una fila de Walmart con los valores en su posicion de la cabecera real. */
function filaWM(o) {
  const f = new Array(CAB.length).fill(null);
  f[0] = o.rut || '76000000-0'; f[1] = o.cliente || 'CLIENTE DE PRUEBA';
  f[4] = o.cita; f[5] = o.cd || 6009; f[6] = o.recepcion || 1;
  f[8] = o.serial === undefined ? 46331.09 : o.serial;
  f[10] = 'Pallet Rojo';
  f[11] = o.total; f[12] = o.malos || 0; f[13] = o.canje;
  f[14] = o.valido === undefined ? 'true' : o.valido;
  return f;
}

function igual(a, b, que) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(que + '\n  esperado: ' + y + '\n  obtenido: ' + x);
}
function cierto(v, que) { if (!v) throw new Error(que); }
function lanza(fn, trozo, que) {
  try { fn(); } catch (e) { if (String(e.message).indexOf(trozo) >= 0) return; throw new Error(que + '\n  lanzo otra cosa: ' + e.message); }
  throw new Error(que + '\n  no lanzo nada');
}

const PRUEBAS = [];
const prueba = (nombre, fn) => PRUEBAS.push({ nombre, fn });

prueba('T01 la letra de columna se traduce a indice', (M) => {
  igual([M.columnaANumero('A1'), M.columnaANumero('B2'), M.columnaANumero('Z9')], [0, 1, 25], 'una letra');
  igual([M.columnaANumero('AA1'), M.columnaANumero('AR82')], [26, 43], 'dos letras: el reporte llega hasta R pero el lector no puede romperse en AA');
});

prueba('T02 el serial de Excel da la fecha real del archivo de Walmart', (M) => {
  igual(M.serialAFecha(46331.090162037035), '2026-11-05',
    'ese serial sale del Reporte-RedTec real y es el 5-nov-2026');
  igual(M.serialAFecha(45658), '2025-01-01', 'anio nuevo 2025');
  igual(M.serialAFecha(null), null, 'sin numero no hay fecha');
});

prueba('T03 un texto partido en varios <t> se lee entero', (M) => {
  igual(M.leerSharedStrings('<sst><si><t>Hola</t></si><si><t>DISTRIBUCION </t><t>Y EXCELENCIA</t></si></sst>'),
    ['Hola', 'DISTRIBUCION Y EXCELENCIA'],
    'Excel parte un texto con dos formatos en varios <t>: leer solo el primero lo corta');
  igual(M.leerSharedStrings('<sst><si><t>A &amp; B</t></si></sst>'), ['A & B'], 'las entidades se desescapan');
});

prueba('T04 una fila con huecos respeta la posicion de cada celda', (M) => {
  // B y D con dato, A y C vacias: si se apilan en orden, el dato queda corrido.
  const filas = M.leerHoja('<sheetData><row r="1">' +
    '<c r="B1" t="s"><v>0</v></c><c r="D1" t="n"><v>7.0</v></c></row></sheetData>', ['hola']);
  igual(filas[0], [null, 'hola', null, 7], 'el hueco se rellena con null y el dato queda en su columna');
});

prueba('T05 los numeros llegan en notacion cientifica y hay que leerlos bien', (M) => {
  const filas = M.leerHoja('<sheetData><row r="1"><c r="A1" t="n"><v>4.2750687E7</v></c></row></sheetData>', []);
  igual(filas[0][0], 42750687, 'asi viene la cita en el archivo real: 4.2750687E7');
});

prueba('T06 el lector de xlsx aguanta que el encabezado local traiga "extra"', (M) => {
  const buf = xlsxDePrueba([filaWM({ cita: 42750687, total: 3, canje: 3 })]);
  const m = M.leerXlsx(buf);
  igual(m.length, 2, 'cabecera + una fila');
  igual(m[0][4], 'appt_nbr', 'la cabecera se lee');
  igual(m[1][4], 42750687, 'y la cita tambien, con el campo extra de por medio');
});

prueba('T07 las columnas se ubican por NOMBRE, no por posicion', (M) => {
  // Se da vuelta la cabecera entera: si el lector va por posicion, lee cualquier cosa.
  const cab = CAB.slice().reverse();
  const f = new Array(CAB.length).fill(null);
  f[CAB.length - 1 - 4] = 42750687;          // appt_nbr, ahora al final
  f[CAB.length - 1 - 11] = 10;               // pallet_tot_qty
  f[CAB.length - 1 - 13] = 9;                // pallet_exch_qty
  f[CAB.length - 1 - 14] = 'true';
  f[CAB.length - 1 - 8] = 46331.09;
  const w = M.filasWalmart(M.leerXlsx(xlsxDePrueba([f], cab)));
  igual(w.length, 1, 'una fila');
  igual([w[0].cita, w[0].total, w[0].canje], ['42750687', 10, 9],
    'con la cabecera dada vuelta tiene que leer igual de bien');
});

prueba('T08 si falta una columna, falla diciendo CUAL', (M) => {
  const cab = CAB.filter(c => c !== 'pallet_exch_qty');
  lanza(() => M.filasWalmart(M.leerXlsx(xlsxDePrueba([], cab))), 'pallet_exch_qty',
    'tiene que nombrar la columna que falta, no fallar en silencio ni leer ceros');
});

prueba('T09 las filas sin cita no entran al cruce', (M) => {
  const buf = xlsxDePrueba([
    filaWM({ cita: 42750687, total: 3, canje: 3 }),
    filaWM({ cita: null, total: 5, canje: 5 })
  ]);
  igual(M.filasWalmart(M.leerXlsx(buf)).length, 1, 'una fila sin cita no se puede cruzar con nada');
});

prueba('T10 la regla: Walmart acepto MENOS que lo despachado', (M) => {
  igual(M.reglaCantidad(24, 20), { aConfirmar: 20, diferencia: -4, porInformar: 4 },
    'se confirma lo aceptado y quedan 4 por informarle al cliente');
});

prueba('T11 la regla: Walmart acepto MAS que lo despachado', (M) => {
  igual(M.reglaCantidad(24, 30), { aConfirmar: 24, diferencia: 6, porInformar: 0 },
    'no se puede confirmar mas de lo que salio, y una diferencia positiva NO deja nada por informar');
});

prueba('T12 la regla: Walmart acepto exactamente lo despachado', (M) => {
  igual(M.reglaCantidad(24, 24), { aConfirmar: 24, diferencia: 0, porInformar: 0 }, 'el caso normal');
});

prueba('T13 el cruce distingue exacta, duplicada, por observacion y sin match', (M) => {
  const ops = [
    { nroPedido: 1, nroCita: '42750687', observacion: '' },
    { nroPedido: 2, nroCita: '42751817', observacion: '' },
    { nroPedido: 3, nroCita: '42751817', observacion: '' },
    { nroPedido: 4, nroCita: '', observacion: 'FACTURA # 472817 cita 42738593' }
  ];
  const idx = M.indexar(ops);
  igual(M.clasificar({ cita: '42750687' }, idx).estado, 'exacta', 'una cita con una sola operacion');
  igual(M.clasificar({ cita: '42751817' }, idx).estado, 'duplicada', 'una cita con dos operaciones');
  igual(M.clasificar({ cita: '42738593' }, idx).estado, 'por-observacion',
    'la cita no esta en nroCita pero si en el texto de la observacion');
  igual(M.clasificar({ cita: '99999999' }, idx).estado, 'sin-match', 'y la que no esta en ninguna parte');
});

prueba('T14 el contraste compara la regla contra lo que YA se confirmo', (M) => {
  const ok = M.contrastar({ canje: 20 },
    { cantidadDespachada: 24, cantidadConfirmada: 20, fechaConfirmacion: '2026-11-06' });
  igual([ok.yaConfirmada, ok.laRegla, ok.loReal, ok.calza, ok.porInformar], [true, 20, 20, true, 4],
    'la regla reproduce lo confirmado');

  const mal = M.contrastar({ canje: 20 },
    { cantidadDespachada: 24, cantidadConfirmada: 24, fechaConfirmacion: '2026-11-06' });
  igual([mal.laRegla, mal.loReal, mal.calza], [20, 24, false],
    'confirmaron lo despachado donde la regla dice lo aceptado: eso es un desacuerdo y hay que verlo');
});

prueba('T15 una operacion pendiente no se cuenta ni a favor ni en contra', (M) => {
  const p = M.contrastar({ canje: 20 },
    { cantidadDespachada: 24, cantidadConfirmada: 0, fechaConfirmacion: null });
  igual(p.yaConfirmada, false, 'todavia no esta confirmada');
  igual(p.calza, null, 'sin verdad escrita no hay nada que contrastar: null, no true');
});

prueba('T16 el rango de dias del cold se arma inclusivo y corrido', (M) => {
  igual(M.fechasEntre('2026-11-04', '2026-11-06'), ['2026-11-04', '2026-11-05', '2026-11-06'], 'inclusivo');
  igual(M.corrido('2026-11-05', -20), '2026-10-16', 'veinte dias atras');
  igual(M.corrido('2026-11-05', 20), '2026-11-25', 'veinte adelante');
  igual(M.corrido('2026-03-01', -1), '2026-02-28', 'cruzando el mes');
});

prueba('T17 una cadena de conexion que no lo es se detecta antes de llamar a Azure', (M) => {
  cierto(M.pintaDeConexion('DefaultEndpointsProtocol=https;AccountName=redtecos;AccountKey=abc==;EndpointSuffix=core.windows.net'),
    'una cadena de verdad tiene que pasar');
  cierto(M.pintaDeConexion('BlobEndpoint=https://x.blob.core.windows.net/;SharedAccessSignature=sv=2022'),
    'la variante con SAS tambien');
  cierto(!M.pintaDeConexion(''), 'vacia no');
  cierto(!M.pintaDeConexion(undefined), 'ausente no');
  cierto(!M.pintaDeConexion('   '), 'solo espacios no');
  cierto(!M.pintaDeConexion('<la misma que usaste para --huecos>'),
    'ESTE es el caso real: un placeholder pegado tal cual. Sin esta prueba el SDK ' +
    'muere con "Invalid URL" y nadie entiende que la variable trae basura');
  cierto(!M.pintaDeConexion('redtecos'), 'el nombre de la cuenta suelto tampoco es una cadena');
});

prueba('T18 "no existe" se reconoce por codigo, no por el texto del mensaje', (M) => {
  cierto(M.noExiste({ statusCode: 404 }), 'un 404 es ausencia');
  cierto(M.noExiste({ code: 'BlobNotFound' }), 'por code');
  cierto(M.noExiste({ details: { errorCode: 'ContainerNotFound' } }), 'por details.errorCode');
  cierto(M.noExiste({ message: 'The specified blob does not exist.' }),
    'asi manda Azure el mensaje: en prosa y sin la palabra BlobNotFound');

  cierto(!M.noExiste({ statusCode: 403, code: 'AuthorizationFailure', message: 'Server failed to authenticate' }),
    'UN 403 NO ES AUSENCIA. Tratarlo como dia vacio convierte una credencial mala ' +
    'en "ese dia no tuvo movimiento", que es el defecto que ya nos mordio antes');
  cierto(!M.noExiste({ statusCode: 500, message: 'Internal error' }), 'un 500 tampoco');
  cierto(!M.noExiste(null), 'sin error no hay ausencia');
});

prueba('T19 el nombre de la cuenta se extrae de la cadena sin tocar la clave', (M) => {
  igual(M.cuentaDe('DefaultEndpointsProtocol=https;AccountName=redtecos;AccountKey=SECRETA==;EndpointSuffix=core.windows.net'),
    'redtecos', 'sale el AccountName');
  igual(M.cuentaDe('BlobEndpoint=https://redtecos.blob.core.windows.net/;SharedAccessSignature=sv=2022'),
    'redtecos', 'y de la variante con BlobEndpoint');
  igual(M.cuentaDe('hola'), null, 'si no hay cuenta, null');
});

prueba('T20 una cuenta imposible se descarta sin salir a la red', (M) => {
  cierto(M.cuentaValida('redtecos'), 'un nombre normal');
  cierto(M.cuentaValida('abc'), 'el minimo son 3');
  cierto(M.cuentaValida('a'.repeat(24)), 'el maximo son 24');

  cierto(!M.cuentaValida('os_storage_conn'),
    'ESTE es el caso real: el guion bajo es imposible en Azure, asi que es detectable ' +
    'antes de gastar un DNS que va a fallar con ENOTFOUND y no decir por que');
  cierto(!M.cuentaValida('REDTECOS'), 'las mayusculas no se admiten');
  cierto(!M.cuentaValida('redtec.os'), 'el punto tampoco');
  cierto(!M.cuentaValida('ab'), 'menos de 3');
  cierto(!M.cuentaValida('a'.repeat(25)), 'mas de 24');
  cierto(!M.cuentaValida('...'), 'un placeholder de ejemplo');
});

prueba('T21 una fecha de confirmacion NO alcanza para dar algo por confirmado', (M) => {
  cierto(!M.estaConfirmada({ cantidadConfirmada: 0, etapaOperacion: 'Pendiente de Confirmación',
                             fechaConfirmacion: '2026-11-06' }),
    'MEDIDO el 6-nov: existe esa combinacion en el dato real. Si se cuenta como confirmada, ' +
    'el contraste compara contra un cero y declara que la regla falla');
  cierto(!M.estaConfirmada({ cantidadConfirmada: 24, etapaOperacion: 'Pendiente Adjuntar Respaldo' }),
    'con cantidad pero etapa pendiente, tampoco');
  cierto(M.estaConfirmada({ cantidadConfirmada: 24, etapaOperacion: 'Transferencia Confirmada' }),
    'cantidad mas etapa confirmada: esa si');
  cierto(!M.estaConfirmada({ cantidadConfirmada: 0, etapaOperacion: 'Transferencia Confirmada' }),
    'confirmada en cero no es una confirmacion');
});

prueba('T22 varias recepciones de una misma cita se suman antes de cruzar', (M) => {
  // Caso real: la cita 42748849 de CMPC TISSUE vino en tres filas.
  const g = M.agruparPorCita([
    { cita: '42748849', cliente: 'CMPC TISSUE SA', rut: '1-9', cd: '6009', fecha: '2026-11-05', total: 37, malos: 0, canje: 37, recepcion: '404073' },
    { cita: '42748849', cliente: 'CMPC TISSUE SA', rut: '1-9', cd: '6009', fecha: '2026-11-05', total: 10, malos: 0, canje: 10, recepcion: '404074' },
    { cita: '42748849', cliente: 'CMPC TISSUE SA', rut: '1-9', cd: '6009', fecha: '2026-11-05', total: 6, malos: 1, canje: 5, recepcion: '404075' },
    { cita: '42750687', cliente: 'TUCAPEL', rut: '2-7', cd: '6009', fecha: '2026-11-05', total: 3, malos: 0, canje: 3, recepcion: '404426' }
  ]);
  igual(g.length, 2, 'dos citas distintas');
  const c = g.find(x => x.cita === '42748849');
  igual([c.filas, c.total, c.malos, c.canje], [3, 53, 1, 52],
    'las tres recepciones se suman: del lado de Redlink esa cita es UNA transferencia, ' +
    'y comparar 37 contra 53 inventaria una diferencia que no existe');
  igual(c.recepciones.length, 3, 'se guardan los numeros de recepcion');
});

prueba('T23 el cruce al reves encuentra lo nuestro que Walmart no informo', (M) => {
  const ops = [
    { nroPedido: 1, nroCita: '42750687', bodegaDestinoStr: 'ZWM01 CD WM LO AGUIRRE SECO', fechaDespacho: '2026-11-05', cantidadDespachada: 3 },
    { nroPedido: 2, nroCita: '99999999', bodegaDestinoStr: 'ZWM11 CD WM EL PEÑON',        fechaDespacho: '2026-11-05', cantidadDespachada: 20 },
    { nroPedido: 3, nroCita: '',         bodegaDestinoStr: 'ZWM02 CD WM QUILICURA FRIO',  fechaDespacho: '2026-11-05', cantidadDespachada: 7 },
    { nroPedido: 4, nroCita: '42750688', bodegaDestinoStr: 'CENCOSUD LO ESPEJO',          fechaDespacho: '2026-11-05', cantidadDespachada: 9 },
    { nroPedido: 5, nroCita: '42750689', bodegaDestinoStr: 'ZWM01 CD WM LO AGUIRRE SECO', fechaDespacho: '2026-09-01', cantidadDespachada: 5 }
  ];
  const r = M.cruceInverso(ops, ['42750687'], ['2026-11-05'], 3);
  igual(r.candidatas, 3,
    'solo las ZWM dentro de la ventana: el pedido 4 va a otro retail y el 5 se despacho en septiembre');
  igual(r.informadas.concat(r.noInformadas).concat(r.sinCita).map(o => o.nroPedido).sort(), [1, 2, 3],
    'y las tres candidatas quedan clasificadas, ninguna se pierde por el camino');
});

prueba('T25 el cruce inverso separa "no informada" de "sin cita nuestra"', (M) => {
  const ops = [
    { nroPedido: 1, nroCita: '42750687', bodegaDestinoStr: 'ZWM01', fechaDespacho: '2026-11-05', cantidadDespachada: 3 },
    { nroPedido: 2, nroCita: '99999999', bodegaDestinoStr: 'ZWM11', fechaDespacho: '2026-11-05', cantidadDespachada: 20 },
    { nroPedido: 3, nroCita: '',         bodegaDestinoStr: 'ZWM02', fechaDespacho: '2026-11-05', cantidadDespachada: 7 }
  ];
  const r = M.cruceInverso(ops, ['42750687'], ['2026-11-05'], 1);
  igual(r.informadas.map(o => o.nroPedido), [1], 'Walmart la informo');
  igual(r.noInformadas.map(o => o.nroPedido), [2],
    'tiene cita y Walmart no la mando: ESTE es el caso que va al correo al cliente');
  igual(r.sinCita.map(o => o.nroPedido), [3],
    'sin cita no se puede ni buscar: es un problema de dato nuestro, no de Walmart, ' +
    'y mezclarlo con lo anterior da un numero que no se puede accionar');
  igual(r.candidatas, 3, 'las tres son candidatas');

  /* Una transferencia que cubre DOS citas se informa con que venga cualquiera
     de las dos. Mirar solo la primera la manda al correo sin motivo. */
  const dos = [{ nroPedido: 9, nroCita: '42713735 - 42716539', bodegaDestinoStr: 'ZWM01',
                 fechaDespacho: '2026-11-05', cantidadDespachada: 12 }];
  igual(M.cruceInverso(dos, ['42716539'], ['2026-11-05'], 1).informadas.map(o => o.nroPedido), [9],
    'Walmart informo la SEGUNDA de sus dos citas: igual esta informada');
  igual(M.cruceInverso(dos, ['42713735'], ['2026-11-05'], 1).informadas.map(o => o.nroPedido), [9],
    'y con la primera tambien');
  igual(M.cruceInverso(dos, ['99999999'], ['2026-11-05'], 1).noInformadas.map(o => o.nroPedido), [9],
    'con ninguna de las dos, ahi si va al correo');
});

prueba('T30 un dia que Walmart NO reporto no entra al cruce inverso', (M) => {
  /* El caso real: los 8 reportes cubren 23,26,27,28,30,31-oct y 1 y 5-nov.
     Faltan el 24, 25 y 29. Lo despachado esos dias NO se puede comparar
     contra nada, y contarlo como "no informado" seria inventar un reclamo. */
  const ops = [
    { nroPedido: 1, nroCita: '11111111', bodegaDestinoStr: 'ZWM01', fechaDespacho: '2026-10-28', cantidadDespachada: 5 },
    { nroPedido: 2, nroCita: '22222222', bodegaDestinoStr: 'ZWM01', fechaDespacho: '2026-10-29', cantidadDespachada: 5 },
    { nroPedido: 3, nroCita: '33333333', bodegaDestinoStr: 'ZWM01', fechaDespacho: '2026-10-24', cantidadDespachada: 5 }
  ];
  const reportados = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30'];
  const r = M.cruceInverso(ops, [], reportados, 0);
  igual(r.candidatas, 1, 'solo la del 28, que si fue reportado');
  igual(r.noInformadas.map(o => o.nroPedido), [1], 'y es la unica que puede ir al correo');

  // Con un dia de desfase, la del 29 entra: pudo recibirse el 30, que si se reporto.
  const c = M.cruceInverso(ops, [], reportados, 1);
  igual(c.candidatas, 2, 'con desfase de 1 entra tambien la del 29 (se pudo recibir el 30)');
  igual(c.noInformadas.map(o => o.nroPedido).sort(), [1, 2], 'las dos comparables');
});

prueba('T24 una bodega que no es de Walmart no entra al cruce inverso', (M) => {
  cierto(M.esWalmart({ bodegaDestinoStr: 'ZWM08 WM RENTAPACK SANTIAGO' }), 'las ZWM si');
  cierto(M.esWalmart({ bodegaDestinoStr: 'zwm01 minuscula' }), 'sin importar mayusculas');
  cierto(!M.esWalmart({ bodegaDestinoStr: 'CENCOSUD LO ESPEJO' }), 'otro retail no');
  cierto(!M.esWalmart({ bodegaDestinoStr: '' }), 'sin bodega no');
  cierto(!M.esWalmart({}), 'sin el campo tampoco');
  igual(M.fechaDeOp({ fechaDespacho: '2026-11-05T10:00:00', fechaRequerida: '2026-11-04' }), '2026-11-05',
    'manda el despacho, que es cuando salio');
  igual(M.fechaDeOp({ fechaRequerida: '2026-11-04' }), '2026-11-04', 'y si no hay despacho, la requerida');
});

prueba('T26 una cita que no tiene forma de cita de Walmart se detecta', (M) => {
  cierto(M.citaDeWalmart('42743424'), 'ocho digitos: una cita de verdad');
  cierto(M.citaDeWalmart(' 42749532 '), 'con espacios tambien');

  // Los tres salieron del dato real el 6-nov, en transferencias a Walmart.
  cierto(!M.citaDeWalmart('123456'), 'relleno tipeado a mano');
  cierto(!M.citaDeWalmart('654321'), 'otro relleno');
  cierto(!M.citaDeWalmart('1378358'), 'siete digitos: no es una cita de Walmart');
  cierto(!M.citaDeWalmart(''), 'vacia');
  cierto(!M.citaDeWalmart('427434241'), 'nueve digitos tampoco');
  cierto(!M.citaDeWalmart('4274342A'), 'con letras menos');
});

prueba('T27 del campo de cita se extraen TODAS las citas que traiga', (M) => {
  // Los cuatro primeros salieron del dato real el 6-nov.
  igual(M.citasDeTexto('42704805-42710381'), ['42704805', '42710381'], 'dos citas pegadas con guion');
  igual(M.citasDeTexto('42713735 - 42716539'), ['42713735', '42716539'], 'dos con espacios');
  igual(M.citasDeTexto('42710724.'), ['42710724'], 'una con un punto pegado');
  igual(M.citasDeTexto('42723068 - 42723070'), ['42723068', '42723070'], 'otro par');

  igual(M.citasDeTexto('42750687'), ['42750687'], 'el caso normal');
  igual(M.citasDeTexto('5994-5992-6004'), [], 'numeros cortos: no hay ninguna cita adentro');
  igual(M.citasDeTexto('1'), [], 'ni acá');
  igual(M.citasDeTexto(''), [], 'vacio');
  igual(M.citasDeTexto('42750687 42750687'), ['42750687'], 'la misma repetida cuenta una vez');
});

prueba('T28 una operacion con dos citas se encuentra por cualquiera de las dos', (M) => {
  const ops = [{ nroPedido: 7, nroCita: '42713735 - 42716539', observacion: '' }];
  const idx = M.indexar(ops);
  igual(idx.multiples, 1, 'se cuenta que trae mas de una');
  igual(M.clasificar({ cita: '42713735' }, idx).estado, 'exacta', 'por la primera');
  igual(M.clasificar({ cita: '42716539' }, idx).estado, 'exacta', 'y por la segunda');
  igual(M.clasificar({ cita: '42716539' }, idx).ops[0].nroPedido, 7, 'y es la misma operacion');
});

prueba('T29 un campo del que no se puede extraer nada se cuenta aparte', (M) => {
  const idx = M.indexar([{ nroPedido: 1, nroCita: '5994-5992-6004', observacion: '' },
                         { nroPedido: 2, nroCita: '', observacion: '' }]);
  igual(idx.sinExtraer, 1, 'el campo con texto pero sin cita adentro se cuenta; el vacio no');
  igual(idx.porCita.size, 0, 'y no queda indexado bajo nada');
});

prueba('T31 solo son dias "cerrados" aquellos cuyo dia de recepcion tambien se reporto', (M) => {
  // Los 8 reportes reales: 23, 26, 27, 28, 30, 31-oct, 1 y 5-nov.
  const rep = ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28',
               '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-05'];
  igual(M.diasCerrados(rep, 0), rep, 'sin desfase, todo dia reportado es cerrado');
  igual(M.diasCerrados(rep, 1), ['2026-10-26', '2026-10-27', '2026-10-30', '2026-10-31'],
    'con un dia de desfase solo sirven aquellos cuyo dia siguiente TAMBIEN se reporto: ' +
    'el 23 no (falta el 24), el 28 no (falta el 29), el 1 no (falta el 2), el 5 no (falta el 6)');
  igual(M.diasCerrados([], 1), [], 'sin reportes no hay dias cerrados');
});

/* ── Corredor ─────────────────────────────────────────────────────────────── */
function cargar(mutar) {
  let src = fs.readFileSync(ORIGEN, 'utf8');
  if (mutar) {
    const m = MUTACIONES[mutar];
    const partes = src.split(m.de);
    if (partes.length !== 2) {
      throw new Error('la mutacion ' + mutar + ' no calza exactamente una vez (' + (partes.length - 1) + '). Patron: ' + JSON.stringify(m.de));
    }
    src = partes[0] + m.a + partes[1];
  }
  const tmp = path.join(__dirname, '.medir-citas.prueba.js');
  fs.writeFileSync(tmp, src);
  try { delete require.cache[require.resolve(tmp)]; return require(tmp); }
  finally { setTimeout(() => { try { fs.unlinkSync(tmp); } catch (e) {} }, 0); }
}

function correr(mutar) {
  let M;
  try { M = cargar(mutar); }
  catch (e) { return PRUEBAS.map(p => ({ nombre: p.nombre, ok: false, error: 'no carga: ' + e.message })); }
  return PRUEBAS.map(function (p) {
    try { p.fn(M); return { nombre: p.nombre, ok: true }; }
    catch (e) { return { nombre: p.nombre, ok: false, error: e.message }; }
  });
}

const args = process.argv.slice(2);
if (args.includes('--mutaciones')) {
  console.log('MUTACIONES · cada una debe hacer FALLAR al menos una prueba\n');
  let vivas = 0;
  for (const id of Object.keys(MUTACIONES)) {
    const r = correr(id);
    const fallan = r.filter(x => !x.ok);
    if (!fallan.length) vivas++;
    console.log((fallan.length ? 'MUERTA ' : 'VIVE   ') + id + '  ' + MUTACIONES[id].que);
    console.log('        ' + (fallan.length
      ? 'la detectan: ' + fallan.map(x => x.nombre.split(' ')[0]).join(', ')
      : '*** NINGUNA PRUEBA LA DETECTA ***'));
  }
  console.log('\nMutaciones vivas: ' + vivas + ' de ' + Object.keys(MUTACIONES).length);
  process.exit(vivas ? 1 : 0);
} else {
  const r = correr(null);
  r.forEach(x => {
    console.log((x.ok ? '  ok   ' : '  FALLA') + ' ' + x.nombre);
    if (!x.ok) console.log('         ' + x.error.split('\n').join('\n         '));
  });
  const malas = r.filter(x => !x.ok).length;
  console.log('\n' + (r.length - malas) + ' de ' + r.length + ' pruebas pasan' + (malas ? ' · ' + malas + ' fallan' : ''));
  process.exit(malas ? 1 : 0);
}
