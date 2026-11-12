#!/usr/bin/env node
// ============================================================================
//  scripts/test-pf-nucleo.js
//
//  Pruebas de api/shared/pf-nucleo.js, con arnés de mutaciones. Sin red: lo que
//  se prueba son las reglas, que es donde vive la verdad.
//
//  Lo que protegen: PF va a crear relocalizaciones reales con esto, y cada una
//  mueve pallets entre bodegas. Un número de bodega mal validado manda pallets
//  a otra empresa; una idempotencia mal decidida los mueve dos veces.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, '..', 'api', 'shared', 'pf-nucleo.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');

function compilar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  m._compile(fuente, RUTA);
  return m.exports;
}

let ok = 0, fallos = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }
function contiene(lista, re, m) {
  if (!(lista || []).some(function (x) { return re.test(x); })) {
    throw new Error((m || 'ningún mensaje calza con ' + re) + ' · vino ' + JSON.stringify(lista));
  }
}

// El payload tal como lo manda PF hoy, con la grafía de C#.
const PF = () => ({ OperacionId: 5, ServicioId: 19, ClienteOrigenId: 499, BodegaOrigenId: 1537,
                    ClienteDestinoId: 499, BodegaDestinoId: 1550, DocumentoId: 5,
                    DocumentoNumero: 45285, Cantidad: 24,
                    ObservacionOrigen: 'relocaliza via API', ModoProduccion: false });
const ID = { bpId: 499, usuarioIngresoId: 740, nombre: 'AAAA_PF_Relocalizaciones' };
const BOD = [{ bodegaiD: 1537, bodegaCliente: 'PF ISUMOS SECOS' },
             { bodegaiD: 1550, bodegaCliente: 'PF TALCA PLANTA ELABORADOS' },
             { bodegaiD: 1528, bodegaCliente: 'PF CENTRO DISTRIBUCION TALCA' }];

function correr(S) {
  ok = 0; fallos = [];
  const norm = (extra) => S.normalizar(Object.assign(PF(), extra || {}));
  const val = (extra, id, bod) => S.validar(norm(extra), id === undefined ? ID : id,
                                            bod === undefined ? BOD : bod);

  /* ── normalizar: continuidad con el cliente de PF ───────────────────── */

  prueba('N01 acepta la grafía de C# que PF ya usa', function () {
    const p = norm();
    igual([p.operacionId, p.servicioId, p.cantidad, p.documentoNumero], [5, 19, 24, 45285]);
  });

  prueba('N02 acepta también la grafía en minúscula', function () {
    const p = S.normalizar({ operacionId: 5, servicioId: 19, bodegaOrigenId: 1537,
                             bodegaDestinoId: 1550, documentoId: 5, documentoNumero: 1,
                             cantidad: 3 });
    igual([p.operacionId, p.cantidad, p.bodegaOrigenId], [5, 3, 1537]);
  });

  prueba('N03 un decimal no se redondea a escondidas: queda nulo y se rechaza', function () {
    // Redondear 24.6 a 25 sería inventar pallets.
    igual(S.normalizar({ Cantidad: 24.6 }).cantidad, null);
    contiene(val({ Cantidad: 24.6 }).problemas, /cantidad/, 'tiene que quejarse');
  });

  prueba('N04 un objeto o un booleano en un número no se cuela', function () {
    igual([S.normalizar({ Cantidad: {} }).cantidad, S.normalizar({ Cantidad: true }).cantidad], [null, null]);
  });

  prueba('N05 la observación se limpia y se acota', function () {
    const p = norm({ ObservacionOrigen: 'uno\ndos\t' + 'x'.repeat(400) });
    falso(/[\n\t]/.test(p.observacionOrigen), 'quedó ' + JSON.stringify(p.observacionOrigen.slice(0, 20)));
    cierto(p.observacionOrigen.length <= 250, 'largo ' + p.observacionOrigen.length);
  });

  /* ── validar: lo que no se le cree al llamador ──────────────────────── */

  prueba('V01 el payload de PF tal cual pasa', function () {
    const r = val();
    igual(r.ok, true, JSON.stringify(r.problemas));
  });

  prueba('V02 otra transacción que no sea relocalización se rechaza por nombre', function () {
    contiene(val({ OperacionId: 6 }).problemas, /sólo crea relocalizaciones/);
    contiene(val({ ServicioId: 28 }).problemas, /servicio 19/);
  });

  prueba('V03 una bodega que no es del cliente se rechaza', function () {
    // Sin esto, un número cualquiera manda pallets a otra empresa.
    const r = val({ BodegaDestinoId: 9999 });
    falso(r.ok);
    contiene(r.problemas, /9999 no es una bodega de este cliente/);
  });

  prueba('V04 origen y destino iguales se rechazan', function () {
    contiene(val({ BodegaDestinoId: 1537 }).problemas, /origen y la de destino son la misma/);
  });

  prueba('V05 sin la lista de bodegas NO se valida a ciegas: se detiene', function () {
    // Si la consulta de maestros falló, lo honesto es parar, no asumir que está bien.
    const r = val({}, ID, []);
    falso(r.ok);
    contiene(r.problemas, /no se pudo verificar que las bodegas sean del cliente/);
  });

  prueba('V06 la cantidad tiene piso y techo', function () {
    contiene(val({ Cantidad: 0 }).problemas, /mayor que cero/);
    contiene(val({ Cantidad: -3 }).problemas, /mayor que cero/);
    igual(val({ Cantidad: S.CANTIDAD_MAX }).ok, true, 'el tope exacto sí se acepta');
    contiene(val({ Cantidad: S.CANTIDAD_MAX + 1 }).problemas, /cantidad máxima/);
  });

  prueba('V07 faltan documento o número y lo dice por su nombre', function () {
    contiene(val({ DocumentoId: null }).problemas, /falta documentoId/);
    contiene(val({ DocumentoNumero: 0 }).problemas, /falta documentoNumero/);
  });

  prueba('V08 una llave sin cliente o sin usuario de firma no escribe nada', function () {
    contiene(val({}, { usuarioIngresoId: 740 }).problemas, /no tiene cliente asociado/);
    contiene(val({}, { bpId: 499 }).problemas, /no tiene usuario de firma/);
  });

  prueba('V09 modoProduccion se ignora, pero se AVISA que se ignoró', function () {
    // Silencio acá sería peor: PF creería que mandó algo a Demo.
    contiene(val({ ModoProduccion: true }).avisos, /modoProduccion se ignora/);
    contiene(val({ ModoProduccion: false }).avisos, /modoProduccion se ignora/);
    igual(val({ ModoProduccion: undefined }).avisos.length, 0, 'si no lo mandan, no se avisa nada');
  });

  prueba('V10 un cliente ajeno en el cuerpo no bloquea, pero se avisa', function () {
    const r = val({ ClienteOrigenId: 500 });
    igual(r.ok, true, 'no se rechaza: simplemente no se usa');
    contiene(r.avisos, /clienteOrigenId 500 se ignora/);
  });

  prueba('V11 mandar el propio cliente no genera ruido', function () {
    igual(val({ ClienteOrigenId: 499, ClienteDestinoId: 499, ModoProduccion: undefined }).avisos, []);
  });

  /* ── aFormHeader: la traducción ─────────────────────────────────────── */

  prueba('F01 arma el formHeader nativo que espera Redlink', function () {
    const c = S.aFormHeader(norm(), ID);
    igual([c.formId, c.servicioId], [5, 19]);
    igual(c.formDdetalles, [{ itemsId: 1, cantidad: 24 }], 'la cantidad baja al detalle');
  });

  prueba('F02 firma con el usuario de la llave, NUNCA con uno del cuerpo', function () {
    const c = S.aFormHeader(S.normalizar(Object.assign(PF(), { usuarioIngresoId: 183 })), ID);
    igual(c.usuarioIngresoId, 740, 'tiene que ser el usuario de servicio');
  });

  prueba('F02b normalizar es una LISTA BLANCA: nada del cuerpo se cuela', function () {
    // Ésta es la defensa de verdad. aFormHeader sólo mira el payload normalizado,
    // así que si normalizar dejara pasar campos del llamador, cualquiera podría
    // mandar su propio usuarioIngresoId o su propio bpId.
    const p = S.normalizar(Object.assign(PF(), {
      usuarioIngresoId: 183, bpId: 1, bpOrigenId: 1, formId: 6, itemsId: 9,
      formDdetalles: [{ itemsId: 9, cantidad: 999 }], loQueSea: 'x' }));
    igual(Object.keys(p).sort(),
      ['bodegaDestinoId','bodegaOrigenId','cantidad','clienteDestinoIdPedido','clienteOrigenIdPedido',
       'documentoId','documentoNumero','modoProduccionPedido','observacionOrigen','operacionId','servicioId']);
  });

  prueba('F02c aFormHeader NO depende de que alguien haya validado antes', function () {
    // Defensa en profundidad: si un día lo llama otro camino sin pasar por
    // validar, los ids de la transacción siguen siendo los nuestros.
    const c = S.aFormHeader(S.normalizar(Object.assign(PF(), { OperacionId: 6, ServicioId: 28 })), ID);
    igual([c.formId, c.servicioId], [5, 19], 'los fija el núcleo, no el mensaje');
  });

  prueba('F03 el cliente sale de la identidad en los TRES campos', function () {
    const c = S.aFormHeader(norm({ ClienteOrigenId: 1, ClienteDestinoId: 2 }), ID);
    igual([c.bpId, c.bpOrigenId, c.bpDestinoId], [499, 499, 499]);
  });

  prueba('F04 sin observación no se manda el campo vacío', function () {
    const c = S.aFormHeader(norm({ ObservacionOrigen: '' }), ID);
    falso('observacionOrigen' in c, 'no debería estar la clave');
  });

  prueba('F05 no viaja ningún campo de más al servidor', function () {
    const c = S.aFormHeader(norm(), ID);
    igual(Object.keys(c).sort(),
      ['bodegaDestinoId','bodegaOrigenId','bpDestinoId','bpId','bpOrigenId','documentoId',
       'documentoNumero','formDdetalles','formId','observacionOrigen','servicioId','usuarioIngresoId']);
  });

  /* ── la llave y la decisión ─────────────────────────────────────────── */

  prueba('L01 la llave usa el cliente de la identidad, no el del cuerpo', function () {
    igual(S.llaveDe(499, 5, 45285), '499|5|45285');
    cierto(S.llaveDe(499, 5, 45285) !== S.llaveDe(500, 5, 45285), 'dos clientes no se pisan');
  });

  prueba('D01 sin registro previo se escribe', function () {
    igual(S.decidir(null, norm()).accion, 'escribir');
    igual(S.decidir({}, norm()).accion, 'escribir');
  });

  prueba('D02 si ya se creó, se devuelve el mismo folio y NO se escribe', function () {
    const d = S.decidir({ estado: 'creado', folio: 4150001, huella: S.huellaDe(norm()) }, norm());
    igual([d.accion, d.folio], ['devolver', 4150001]);
  });

  prueba('D03 misma llave con otros datos es CONFLICTO, no un reintento', function () {
    // Devolver el folio viejo convertiría un error de PF en "ya está hecho".
    const previo = { estado: 'creado', folio: 4150001, huella: S.huellaDe(norm()) };
    const d = S.decidir(previo, norm({ Cantidad: 30 }));
    igual(d.accion, 'conflicto');
    cierto(/ya se usó con otros datos/.test(d.motivo), d.motivo);
  });

  prueba('D04 el conflicto se detecta por CUALQUIERA de los campos de intención', function () {
    const base = norm();
    const previo = { estado: 'creado', folio: 1, huella: S.huellaDe(base) };
    [{ Cantidad: 25 }, { BodegaOrigenId: 1528 }, { BodegaDestinoId: 1528 }, { DocumentoId: 1 }]
      .forEach(function (cambio) {
        igual(S.decidir(previo, norm(cambio)).accion, 'conflicto', 'con ' + JSON.stringify(cambio));
      });
  });

  prueba('D05 cambiar sólo la observación NO es conflicto: es el mismo pedido', function () {
    const previo = { estado: 'creado', folio: 7, huella: S.huellaDe(norm()) };
    igual(S.decidir(previo, norm({ ObservacionOrigen: 'otra nota' })).accion, 'devolver');
  });

  prueba('D06 un intento que quedó sin respuesta NO se reescribe: se resuelve', function () {
    // Es la regla que impide duplicar. Si esto escribiera, el corte de red se
    // convertiría en dos relocalizaciones y en doble movimiento de pallets.
    ['intentando', 'en-duda'].forEach(function (e) {
      const d = S.decidir({ estado: e, huella: S.huellaDe(norm()) }, norm());
      igual(d.accion, 'resolver', 'con estado ' + e);
    });
  });

  prueba('D07 lo que Redlink rechazó por contenido sí se puede reintentar', function () {
    // Un rechazo de validación no escribió nada: no hay riesgo de duplicar.
    igual(S.decidir({ estado: 'rechazado', huella: S.huellaDe(norm()) }, norm()).accion, 'escribir');
  });

  prueba('D08 un estado desconocido se trata como duda, no como vía libre', function () {
    igual(S.decidir({ estado: 'loquesea', huella: S.huellaDe(norm()) }, norm()).accion, 'resolver');
  });

  prueba('D09 el mensaje de duda dice qué hacer y por qué no se reintentó', function () {
    const m = S.dudaSinResolver(norm());
    cierto(/45285/.test(m), 'nombra el documento: ' + m);
    cierto(/no se volvió a intentar/.test(m) && /duplicar/.test(m), m);
    cierto(/Vuelve a llamar con los mismos datos/.test(m), 'dice qué hacer: ' + m);
    cierto(/la próxima llamada lo resuelve/.test(m), 'y que eso lo resuelve: ' + m);
  });

  return { ok, fallos };
}

const MUTACIONES = [
  ['X01 acepta cualquier transacción, no sólo relocalización', /p\.operacionId !== null && p\.operacionId !== FORM_ID/, 'false'],
  ['X02 acepta cualquier servicio',            /p\.servicioId !== null && p\.servicioId !== SERVICIO_ID/, 'false'],
  ['X03 no valida que la bodega sea del cliente', /if \(par\[1\] !== null && !\(par\[1\] in suyas\)\)/, 'if (false)'],
  ['X04 sin maestro de bodegas deja pasar',    /problemas\.push\('no se pudo verificar que las bodegas sean del cliente'\);/, ''],
  ['X05 permite origen igual a destino',       /if \(p\.bodegaOrigenId !== null && p\.bodegaOrigenId === p\.bodegaDestinoId\)/, 'if (false)'],
  ['X06 no hay tope de cantidad',              /\} else if \(p\.cantidad > CANTIDAD_MAX\) \{/, '} else if (false) {'],
  ['X07 el tope es exclusivo y rechaza el máximo', /p\.cantidad > CANTIDAD_MAX/, 'p.cantidad >= CANTIDAD_MAX'],
  ['X08 acepta cantidad cero o negativa',      /p\.cantidad === null \|\| p\.cantidad <= 0/, 'false'],
  ['X09 no exige documentoNumero',             /if \(p\.documentoNumero === null \|\| p\.documentoNumero <= 0\) problemas\.push\('falta documentoNumero'\);/, ''],
  ['X10 no exige documentoId',                 /if \(p\.documentoId === null \|\| p\.documentoId <= 0\) problemas\.push\('falta documentoId'\);/, ''],
  ['X11 una llave sin cliente igual escribe',  /if \(!id\.bpId\) problemas\.push\('la llave de API no tiene cliente asociado'\);/, ''],
  ['X12 una llave sin usuario de firma igual escribe', /if \(!id\.usuarioIngresoId\) problemas\.push\('la llave de API no tiene usuario de firma asociado'\);/, ''],
  ['X13 modoProduccion se ignora EN SILENCIO', /avisos\.push\('modoProduccion se ignora: el ambiente lo fija el servidor'\);/, ''],
  ['X14 avisa de modoProduccion aunque no lo manden', /if \(p\.modoProduccionPedido !== undefined && p\.modoProduccionPedido !== null\)/, 'if (true)'],
  ['X15 el cliente ajeno se ignora en silencio', /if \(par\[1\] !== null && par\[1\] !== id\.bpId\)/, 'if (false)'],
  ['X16 un decimal se redondea a escondidas',  /Number\.isFinite\(n\) && Math\.floor\(n\) === n \? n : null/, 'Number.isFinite(n) ? Math.round(n) : null'],
  ['X17 un objeto cuenta como número',         /if \(typeof v === 'boolean' \|\| typeof v === 'object'\) return null;/, ''],
  ['X18 la observación no se limpia ni se acota', /return String\(v\)\.replace\(\/\[\\u0000-\\u001f\]\+\/g, ' '\)\.trim\(\)\.slice\(0, max \|\| OBSERVACION_MAX\);/, 'return String(v);'],
  ['X19 no acepta la grafía de C#',            /return \(c\[nombre\] !== undefined\) \? c\[nombre\] : c\[alto\];/, 'return c[nombre];'],
  // X20 ("firma con el usuario que mande el cuerpo") se RETIRÓ: era equivalente.
  // normalizar() es una lista blanca, así que p.usuarioIngresoId no existe nunca
  // y la mutación no cambiaba ninguna salida. La defensa real es la lista blanca,
  // y eso lo cubre X20b.
  ['X20b normalizar deja pasar lo que mande el llamador', /function normalizar\(cuerpo\) \{\n  return \{/, 'function normalizar(cuerpo) {\n  return Object.assign({}, cuerpo, {'],
  ['X21 el cliente destino sale del cuerpo',   /bpDestinoId: id\.bpId,/, 'bpDestinoId: p.clienteDestinoIdPedido || id.bpId,'],
  ['X22 el formId del cuerpo manda',           /formId: FORM_ID,/, 'formId: p.operacionId,'],
  ['X23 la cantidad no baja a formDdetalles',  /formDdetalles: \[\{ itemsId: ITEMS_ID, cantidad: p\.cantidad \}\]/, 'formDdetalles: [{ itemsId: ITEMS_ID, cantidad: 1 }]'],
  ['X24 itemsId deja de ser 1',                /const ITEMS_ID = 1;/, 'const ITEMS_ID = 0;'],
  ['X25 manda la observación vacía igual',     /if \(p\.observacionOrigen\) cuerpo\.observacionOrigen = p\.observacionOrigen;/, 'cuerpo.observacionOrigen = p.observacionOrigen;'],
  ['X26 la llave ignora el cliente',           /return \[entero\(bpId\), entero\(documentoId\), entero\(documentoNumero\)\]\.join\('\|'\);/, "return [entero(documentoId), entero(documentoNumero)].join('|');"],
  ['X27 un estado en duda se reescribe',       /return \{ accion: 'resolver', motivo: 'un intento anterior quedó sin respuesta' \};/, "return { accion: 'escribir', motivo: '' };"],
  ['X28 lo ya creado se vuelve a escribir',    /if \(previo\.estado === 'creado'\) \{/, 'if (false) {'],
  ['X29 el conflicto no se detecta',           /if \(!mismaIntencion\(previo, p\)\) \{/, 'if (false) {'],
  ['X30 el conflicto se mide sólo por la cantidad', /const CAMPOS_INTENCION = \['bodegaOrigenId', 'bodegaDestinoId', 'cantidad', 'documentoId', 'documentoNumero'\];/, "const CAMPOS_INTENCION = ['cantidad'];"],
  ['X31 la observación entra en la intención', /'cantidad', 'documentoId', 'documentoNumero'\];/, "'cantidad', 'documentoId', 'documentoNumero', 'observacionOrigen'];"],
  ['X32 un rechazo previo bloquea el reintento', /if \(previo\.estado === 'rechazado'\) \{\n    \/\/ Lo rechazó Redlink[\s\S]*?\n    return \{ accion: 'escribir', motivo: '' \};\n  \}/, ''],
  ['X33 el mensaje de duda no dice qué hacer', /'la próxima llamada lo resuelve\.'/, "''"],
  ['X34 el mensaje de duda no nombra el documento', /'no se sabe si el documento ' \+ p\.documentoNumero \+ ' alcanzó a crearse en Redlink y '/, "'no se sabe si el documento alcanzó a crearse en Redlink y '"]
];

function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(FUENTE)) { noAplican.push(nombre); continue; }
    const mutado = FUENTE.replace(busca, pone);
    if (mutado === FUENTE) { noAplican.push(nombre); continue; }
    let r;
    try { r = correr(compilar(mutado)); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

const r = correr(compilar(FUENTE));
console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
for (const f of r.fallos) console.log('  FALLA ' + f);
if (!r.fallos.length || process.argv.indexOf('--mutaciones') >= 0) {
  const m = mutar();
  console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
  for (const n of m.noAplican) console.log('  NO APLICA  ' + n);
  for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n);
  if (m.vivas.length || m.noAplican.length) process.exit(1);
}
process.exit(r.fallos.length ? 1 : 0);
