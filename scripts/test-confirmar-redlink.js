#!/usr/bin/env node
// ============================================================================
//  scripts/test-confirmar-redlink.js
//
//  Pruebas de scripts/confirmar-redlink.js, con arnés de mutaciones.
//  Lo que protegen no es un informe: es la única escritura del proyecto que
//  mueve inventario real en SAP. Cada guarda de acá existe porque sin ella
//  una corrida distraída confirma lo que no era.
//
//    node scripts/test-confirmar-redlink.js
//    node scripts/test-confirmar-redlink.js --mutaciones
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const RUTA = path.join(__dirname, 'confirmar-redlink.js');
// El núcleo de las decisiones vive bajo api/ (Static Web Apps despliega sólo
// esa carpeta). Las mutaciones tienen que poder tocarlo: si sólo se mutara el
// script, la mitad de las guardas quedaría sin arnés justo después de moverlas.
const RUTA_N = path.join(__dirname, '..', 'api', 'shared', 'confirmar-nucleo.js');
const RE_NUCLEO = /confirmar-nucleo\.js$/;

function compilar(ruta, fuente, requerir) {
  const m = new Module(ruta, null);
  m.filename = ruta;
  m.paths = Module._nodeModulePaths(path.dirname(ruta));
  if (requerir) m.require = requerir;
  m._compile(fuente, ruta);
  return m.exports;
}

// Carga el script con UN núcleo determinado: el `require` se intercepta para
// que el script reciba el núcleo mutado en vez del del disco. Así cada
// mutación, viva en el archivo que viva, se juzga con TODAS las pruebas.
function cargar(fuente, fuenteNucleo) {
  const nucleo = compilar(RUTA_N, fuenteNucleo === undefined ? FUENTE_N : fuenteNucleo);
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  const propio = Module.prototype.require.bind(m);
  m.require = function (pedido) {
    return RE_NUCLEO.test(pedido) ? nucleo : propio(pedido);
  };
  m._compile(fuente, RUTA);
  return m.exports;
}

const FUENTE = fs.readFileSync(RUTA, 'utf8');
const FUENTE_N = fs.readFileSync(RUTA_N, 'utf8');

let ok = 0, fallos = [];
function prueba(n, fn) { try { fn(); ok++; } catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); } }
const pendientes = [];
// Las pruebas asíncronas se encolan y se esperan al final de correr(), para no
// convertir en async las cuarenta que no lo necesitan.
function pruebaAsync(n, fn) { pendientes.push([n, fn]); }
function igual(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' esperaba ' + y + ' y vino ' + x); }
function cierto(v, m) { if (!v) throw new Error(m || 'esperaba verdadero'); }
function falso(v, m) { if (v) throw new Error(m || 'esperaba falso'); }
const tiene = (lista, trozo) => lista.some(x => String(x).indexOf(trozo) >= 0);

const DOC = {
  formHeaderiD: 684100, folio: 4146335, formId: 6, formMetapaId: 44,
  avanzaEtapa: false, fechaConfirmacion: null, confirmacionVeces: 0, usuarioConfirmaId: null,
  bpOrigenNombre: 'PRODUCTOS FERNANDEZ SA', bpDestinoNombre: 'WALMART CHILE COMERCIAL S.A',
  bodegaDestinoNombre: '00001 EXPS PLAZA LYON',
  formMetapa: { formMetapaiD: 44, nombre: 'Pendiente de Confirmación' },
  formDdetalles: [{ formDdetalleiD: 9, formHeaderId: 684100, itemsId: 1, cantidad: 19, despachado: 19, recepcion: null }],
  formDanexos: [], formDtransportes: [], formDregistros: [], formDinspeccions: []
};
const con = (cambios) => Object.assign({}, DOC, cambios);

async function correr(S) {
  pendientes.length = 0;
  ok = 0; fallos = [];

  /* ---- la firma ---------------------------------------------------------- */

  prueba('T01 exige las credenciales de lectura Y las de escritura', () => {
    const p = S.revisarCredenciales({});
    igual(p.length, 5, 'se lee con un usuario y se escribe con otro: ' + JSON.stringify(p));
    ['REDLINK_USER', 'REDLINK_PASS', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS',
     'REDLINK_CLIENT_SECRET'].forEach(k => cierto(tiene(p, k), 'falta reclamar ' + k));
  });
  prueba('T01b la lectura y la escritura usan usuarios distintos a propósito', () => {
    igual(S.USUARIOS.lectura.u, 'REDLINK_USER');
    igual(S.USUARIOS.escritura.u, 'REDLINK_M3LINK_USER');
  });
  prueba('T02 se niega a confirmar con el usuario de lectura', () => {
    const p = S.revisarCredenciales({ REDLINK_CLIENT_SECRET: 'x', REDLINK_M3LINK_USER: 'sapuser',
                                      REDLINK_M3LINK_PASS: 'y', REDLINK_USER: 'sapuser', REDLINK_PASS: 'z' });
    cierto(tiene(p, 'MISMO usuario de lectura'), 'la firma quedaría a nombre de quien no confirmó: ' + JSON.stringify(p));
  });
  prueba('T03 la comparación de usuarios ignora mayúsculas', () => {
    const p = S.revisarCredenciales({ REDLINK_CLIENT_SECRET: 'x', REDLINK_M3LINK_USER: 'SapUser',
                                      REDLINK_M3LINK_PASS: 'y', REDLINK_USER: 'sapuser', REDLINK_PASS: 'z' });
    cierto(tiene(p, 'MISMO usuario'), 'cambiar una mayúscula no es cambiar de usuario');
  });
  prueba('T04 con M3LinkSystem y el de lectura distinto, no reclama', () => {
    igual(S.revisarCredenciales({ REDLINK_CLIENT_SECRET: 'x', REDLINK_M3LINK_USER: 'M3LinkSystem',
                                  REDLINK_M3LINK_PASS: 'y', REDLINK_USER: 'sapuser', REDLINK_PASS: 'z' }), []);
  });
  prueba('T05 detecta un marcador pegado literal', () => {
    const p = S.revisarCredenciales({ REDLINK_CLIENT_SECRET: '<el secreto>', REDLINK_M3LINK_USER: 'M3LinkSystem',
                                      REDLINK_M3LINK_PASS: 'y', REDLINK_USER: 'sapuser', REDLINK_PASS: 'z' });
    cierto(tiene(p, 'marcador'), JSON.stringify(p));
  });

  /* ---- el plan ----------------------------------------------------------- */

  prueba('T06 una transferencia a Walmart pendiente se puede confirmar', () => {
    const p = S.planDeConfirmacion(DOC, 3);
    cierto(p.ok, JSON.stringify(p.problemas));
    igual(p.resumen.aConfirmar, 3);
    igual(p.resumen.despachado, 19);
  });
  prueba('T07 el plan NO arma el cuerpo: arma la URL con la que el servidor lo arma', () => {
    // Ocho intentos armando el cuerpo a mano = ocho 400. El plan entrega la
    // ruta del preparador y nada más; si volviera a traer un cuerpo armado,
    // alguien lo iba a mandar.
    const plan = S.planDeConfirmacion(DOC, 3);
    cierto(plan.ok, (plan.problemas || []).join(' · '));
    igual(plan.cuerpo, undefined, 'el plan no puede traer un cuerpo armado a mano');
    igual(plan.url, '/api/FormHeader/ConfirmarTransferencia/Folio/4146335/recibido/3/original/' +
                    S.ORIGEN + '/usuarioconfirma/' + S.USERSID_M3LINK);
  });
  prueba('T07c urlConfirmar no deja meter nada que no sea un número', () => {
    // Los tres números entran a una ruta. Una cantidad como "3 OR 1=1" o un
    // folio con una barra cambian a qué documento le pega el servidor.
    const malos = [
      ['folio',    ['4a', '', '4/5', ' ', null, '-1', '3.5']],
      ['cantidad', ['3a', '', '3/4', null, '-1', '2,5']],
      ['usersiD',  ['983x', '', 'abc', null, '-9']]
    ];
    malos[0][1].forEach(function (f) {
      let tiro = false; try { S.urlConfirmar(f, 3, 983); } catch (e) { tiro = /folio/.test(e.message); }
      cierto(tiro, 'folio ' + JSON.stringify(f) + ' tendría que rechazarse');
    });
    malos[1][1].forEach(function (c) {
      let tiro = false; try { S.urlConfirmar(4146335, c, 983); } catch (e) { tiro = /cantidad/.test(e.message); }
      cierto(tiro, 'cantidad ' + JSON.stringify(c) + ' tendría que rechazarse');
    });
    malos[2][1].forEach(function (u) {
      let tiro = false; try { S.urlConfirmar(4146335, 3, u); } catch (e) { tiro = /usersiD/.test(e.message); }
      cierto(tiro, 'usersiD ' + JSON.stringify(u) + ' tendría que rechazarse');
    });
  });
  prueba('T07d la marca de origen tampoco entra cruda', () => {
    // Queda escrita del lado del servidor: es la que distingue quién confirmó
    // qué, así que una barra o un espacio ahí rompe la ruta o la traza.
    ['M3 LINK', 'M3/LINK', 'M3?LINK', 'M3#LINK', '../x'].forEach(function (o) {
      let tiro = false;
      try { S.urlConfirmar(4146335, 3, 983, o); } catch (e) { tiro = /origen/.test(e.message); }
      cierto(tiro, 'origen ' + JSON.stringify(o) + ' tendría que rechazarse');
    });
    cierto(S.urlConfirmar(4146335, 3, 983, 'CONFIRMAVER2').indexOf('/original/CONFIRMAVER2/') >= 0);
    // Sin marca cae en la configurada: es el camino normal, no un error.
    cierto(S.urlConfirmar(4146335, 3, 983).indexOf('/original/' + S.ORIGEN + '/') >= 0);
    cierto(S.urlConfirmar(4146335, 3, 983, '').indexOf('/original/' + S.ORIGEN + '/') >= 0);
  });
  prueba('T07b la URL del plan lleva la cantidad PEDIDA, no la despachada', () => {
    // Confirmar 19 cuando se pidió 3 es un ajuste de inventario de más por 16
    // pallets, y no se deshace.
    cierto(S.planDeConfirmacion(DOC, 3).url.indexOf('/recibido/3/') >= 0);
    cierto(S.planDeConfirmacion(DOC, 19).url.indexOf('/recibido/19/') >= 0);
  });
  prueba('T08 no confirma lo que no es una transferencia', () => {
    cierto(tiene(S.planDeConfirmacion(con({ formId: 1 }), 3).problemas, 'no es una transferencia'));
  });
  prueba('T09 no confirma si el destino no es Walmart', () => {
    cierto(tiene(S.planDeConfirmacion(con({ bpDestinoNombre: 'OTRO RETAIL' }), 3).problemas, 'no es Walmart'));
  });
  prueba('T10 no confirma una que ya está confirmada', () => {
    const ya = con({ formMetapa: { nombre: 'Transferencia Confirmada' },
                     formDdetalles: [Object.assign({}, DOC.formDdetalles[0], { recepcion: 19 })] });
    cierto(tiene(S.planDeConfirmacion(ya, 3).problemas, 'YA está confirmada'),
      'repetirla sería un segundo ajuste en SAP');
  });
  prueba('T10b la 43 TAMBIÉN se confirma en el circuito masivo de Walmart', () => {
    // Resuelto por Marcelo el 9-nov-2026: en las confirmaciones masivas de
    // Walmart no corresponde adjuntar respaldo — ese paso existe para que
    // logística no vaya documento por documento. Hasta ese día el script la
    // rechazaba, y habría bloqueado 55 de los 60 folios del primer día real.
    const previa = con({ formMetapaId: 43, formMetapa: { nombre: 'Pendiente Adjuntar Respaldo' } });
    cierto(S.etapaConfirmable(previa), 'la 43 es confirmable por el camino masivo');
    cierto(S.etapaConfirmable(DOC), 'la 44 también');
    falso(tiene(S.planDeConfirmacion(previa, 3).problemas, 'etapa'), 'y no debe quedar como problema');
  });
  prueba('T10b2 pero NO cualquier etapa: cerrada, anulada y reconfirmada quedan fuera', () => {
    [['Transferencia Confirmada', 46], ['Transferencia Anulada', 47],
     ['Transferencia Reconfirmada', 49], ['Transferencia', 37]].forEach(function (par) {
      const d = con({ formMetapaId: par[1], formMetapa: { nombre: par[0] } });
      falso(S.etapaConfirmable(d), par[0] + ' no puede ser confirmable');
    });
  });
  prueba('T10b3 una etapa no confirmable sale como PROBLEMA, no solo como falso', () => {
    const anulada = con({ formMetapaId: 47, formMetapa: { nombre: 'Transferencia Anulada' } });
    cierto(tiene(S.planDeConfirmacion(anulada, 3).problemas, 'Transferencia Anulada'),
      'el plan tiene que negarse, no solo responder que no es confirmable');
  });
  prueba('T10b4 empezar con "Pendiente" NO alcanza: las dos etapas van nombradas', () => {
    // Esta trampa ya mordió una vez: "Pendiente Adjuntar Respaldo" y
    // "Pendiente de Confirmación" empiezan igual, y cualquier etapa futura
    // que arranque con esa palabra no tiene por qué ser confirmable.
    falso(S.etapaConfirmable({ formMetapa: { nombre: 'Pendiente' } }));
    falso(S.etapaConfirmable({ formMetapa: { nombre: 'Pendiente de Aprobacion' } }));
    falso(S.etapaConfirmable({ formMetapa: { nombre: 'Pendiente Reversa' } }));
  });
  prueba('T10g la firma es usuarioIngresoId, NO usuarioConfirmaId', () => {
    // Medido el 9-nov-2026: una confirmación manual real dejó usuarioConfirmaId
    // en null y sobrescribió usuarioIngresoId con el usuario que actuó. Durante
    // días se dijo lo contrario en este mismo proyecto.
    const f = S.firmaDe({ usuarioIngresoId: 6, usuarioIngresoNombre: 'mmesias', usuarioConfirmaId: null });
    igual(f, { id: 6, nombre: 'mmesias', confirmaId: null });
  });
  prueba('T10h sin número útil devuelve null, no un cero disfrazado', () => {
    igual(S.firmaDe({ usuarioIngresoId: 0 }).id, null, 'cero no es un usuario');
    igual(S.firmaDe({ usuarioIngresoId: null }).id, null);
    igual(S.firmaDe({}).id, null);
    igual(S.firmaDe(null), { id: null, nombre: '', confirmaId: null });
    igual(S.firmaDe({ usuarioIngresoId: 'abc' }).id, null, 'texto tampoco');
  });
  prueba('T10i el nombre viaja junto al número: sin él no prueba nada', () => {
    const f = S.firmaDe({ usuarioIngresoId: 42, usuarioIngresoNombre: '  M3LinkSystem  ' });
    igual(f.nombre, 'M3LinkSystem', 'se recorta');
    igual(f.id, 42);
  });
  prueba('T10j un corte de descarga NO se cuenta como "vino vacío"', () => {
    // Son dos cosas distintas y mandan a buscar el problema a lados opuestos:
    // una dice "no hay datos", la otra dice "no alcanzaste a leerlos".
    const d = S.porQueNoHayJson({ status: 200, texto: '', falloCuerpo: 'terminated' });
    cierto(d.join(' ').indexOf('CORTÓ') >= 0, d.join(' '));
    cierto(d.join(' ').indexOf('terminated') >= 0, 'tiene que decir qué falló');
    falso(/no hay datos en esa ventana/.test(d.join(' ')), 'no puede afirmar que no hay datos');
  });
  prueba('T10k un vacío con content-length delata que el cuerpo se perdió', () => {
    const d = S.porQueNoHayJson({ status: 200, texto: '', largoDeclarado: '184233' });
    cierto(d.join(' ').indexOf('184233') >= 0);
    cierto(d.join(' ').indexOf('se perdió') >= 0, d.join(' '));
  });
  prueba('T10l un vacío de verdad nombra las dos causas posibles', () => {
    const d = S.porQueNoHayJson({ status: 200, texto: '', largoDeclarado: '0' });
    cierto(/no alcanza a ese BP/.test(d.join(' ')), d.join(' '));
    cierto(/no hay datos en la ventana/.test(d.join(' ')));
  });
  prueba('T10m si vino algo que no es JSON, se muestra lo que vino', () => {
    const d = S.porQueNoHayJson({ status: 200, texto: '<html>Sign in</html>', tipo: 'text/html' });
    cierto(d.join(' ').indexOf('text/html') >= 0);
    cierto(d.join(' ').indexOf('Sign in') >= 0, 'los primeros bytes tienen que salir');
  });
  prueba('T10n el diagnóstico nunca enseña una credencial', () => {
    const d = S.porQueNoHayJson({ status: 200, texto: '{"password":"abc123","token":"xyz"}', tipo: 'application/json' });
    falso(/abc123|xyz/.test(d.join(' ')), 'se enmascara: ' + d.join(' '));
  });
  pruebaAsync('T10o si el cuerpo se corta, el motivo viaja; no se vuelve vacío', async () => {
    const r = { status: 200, headers: { get: (n) => n === 'content-length' ? '184233' : 'application/json' },
                text: () => Promise.reject(new Error('terminated')) };
    const c = await S.leerCuerpo(r);
    igual(c.texto, '');
    igual(c.falloCuerpo, 'terminated', 'el motivo NO se puede perder');
    igual(c.largoDeclarado, '184233');
  });
  pruebaAsync('T10p un cuerpo que se lee bien no inventa falla', async () => {
    const r = { status: 200, headers: { get: () => null }, text: () => Promise.resolve('[]') };
    const c = await S.leerCuerpo(r);
    igual([c.texto, c.falloCuerpo], ['[]', null]);
  });
  prueba('T10q el número de la firma viaja en la URL del preparador', () => {
    // Es lo que el servidor usa para saber a nombre de quién armar el
    // documento. Sin ese número no hay nada que pedir.
    const plan = S.planDeConfirmacion(DOC, 3);
    cierto(plan.ok, (plan.problemas || []).join(' · '));
    igual(plan.usersId, S.USERSID_M3LINK);
    cierto(plan.url.indexOf('/usuarioconfirma/' + S.USERSID_M3LINK) >= 0, plan.url);
    cierto(S.USERSID_M3LINK > 0, 'tiene que haber un número');
  });
  prueba('T10r sin usersiD el plan se NIEGA: mejor no escribir que no firmar', () => {
    cierto(tiene(S.planDeConfirmacion(DOC, 3, 0).problemas, 'a nombre de quién'),
      'tiene que negarse cuando no hay a nombre de quién firmar');
    cierto(S.planDeConfirmacion(DOC, 3, 983).ok, 'con firma sí procede');
    // Sin pasar nada cae en el número configurado, que es el camino normal.
    igual(S.planDeConfirmacion(DOC, 3).usersId, S.USERSID_M3LINK);
    igual(S.planDeConfirmacion(DOC, 3, null).usersId, S.USERSID_M3LINK);
  });
  prueba('T10s después de escribir, la firma se juzga por el NOMBRE', () => {
    // Un id equivocado no da error: graba otro usuario y queda callado. Lo
    // único que prueba que el número era el correcto es el nombre que volvió.
    const bien = S.veredictoDeFirma({ usuarioIngresoId: S.USERSID_M3LINK, usuarioIngresoNombre: 'M3LinkSystem' });
    cierto(bien.ok, bien.dice);
    const otroNombre = S.veredictoDeFirma({ usuarioIngresoId: S.USERSID_M3LINK, usuarioIngresoNombre: 'Isabel_Navarro' });
    falso(otroNombre.ok, 'el id solo no alcanza');
    cierto(/NO es de ese usuario/.test(otroNombre.dice), otroNombre.dice);
    const otroId = S.veredictoDeFirma({ usuarioIngresoId: 951, usuarioIngresoNombre: 'M2LinkSystem' });
    falso(otroId.ok, 'quedó firmado por otro');
    cierto(/NO quedó firmada/.test(otroId.dice), otroId.dice);
  });
  prueba('T10t una firma vacía después de escribir también es un fracaso', () => {
    const v = S.veredictoDeFirma({});
    falso(v.ok);
    cierto(/\(vacío\)/.test(v.dice), v.dice);
  });
  prueba('T10u el nombre se compara sin importar mayúsculas', () => {
    cierto(S.veredictoDeFirma({ usuarioIngresoId: S.USERSID_M3LINK, usuarioIngresoNombre: 'm3linksystem' }).ok);
  });
  prueba('T10v el veredicto juzga contra el número que SE MANDÓ', () => {
    // Si la API resolvió otro número que el configurado y se escribió con ese,
    // juzgar contra el configurado daría "firma mal" estando bien, o al revés.
    cierto(S.veredictoDeFirma({ usuarioIngresoId: 7, usuarioIngresoNombre: 'M3LinkSystem' }, 7).ok);
    falso(S.veredictoDeFirma({ usuarioIngresoId: S.USERSID_M3LINK, usuarioIngresoNombre: 'M3LinkSystem' }, 7).ok);
  });

  /* ---- a quién firmar, preguntado por nombre ----------------------------- */

  prueba('T11a el usersiD sale del nombre, como en la macro', () => {
    const u = S.interpretarUsuario('[{"usersiD":983,"userName":"M3LinkSystem"}]', 'M3LinkSystem');
    cierto(u.ok, (u.problemas || []).join(' · '));
    igual([u.id, u.nombre], [983, 'M3LinkSystem']);
  });
  prueba('T11b también acepta un objeto suelto, no sólo una lista', () => {
    const u = S.interpretarUsuario('{"usersiD":951,"userName":"M2LinkSystem"}', 'M2LinkSystem');
    cierto(u.ok, (u.problemas || []).join(' · '));
    igual(u.id, 951);
  });
  prueba('T11c si el nombre que vuelve NO es el pedido, el número no sirve', () => {
    // El servidor busca por coincidencia: pedir "M3Link" puede traer otro
    // usuario cuyo nombre lo contenga, y ese número firmaría a quien no fue.
    const u = S.interpretarUsuario('[{"usersiD":12,"userName":"M3LinkPruebas"}]', 'M3LinkSystem');
    falso(u.ok, 'tiene que desconfiar');
    cierto(tiene(u.problemas, 'M3LinkPruebas'), JSON.stringify(u.problemas));
    igual(u.id, 12, 'igual informa el número que vino, para poder mirarlo');
  });
  prueba('T11d con varios candidatos no elige ninguno', () => {
    const u = S.interpretarUsuario('[{"usersiD":1,"userName":"M3LinkA"},{"usersiD":2,"userName":"M3LinkB"}]', 'M3Link');
    falso(u.ok);
    igual(u.id, null, 'elegir uno a ojo firma a quien no fue');
    cierto(tiene(u.problemas, 'no se elige uno'), JSON.stringify(u.problemas));
  });
  prueba('T11e entre varios, la coincidencia exacta gana', () => {
    const u = S.interpretarUsuario('[{"usersiD":1,"userName":"M3LinkSystemViejo"},' +
                                   '{"usersiD":983,"userName":"M3LinkSystem"}]', 'M3LinkSystem');
    cierto(u.ok, (u.problemas || []).join(' · '));
    igual(u.id, 983);
  });
  prueba('T11f un cuerpo vacío o no-JSON no se confunde con "no existe"', () => {
    cierto(tiene(S.interpretarUsuario('', 'x').problemas, 'cuerpo vacío'));
    cierto(tiene(S.interpretarUsuario('<html>', 'x').problemas, 'no es JSON'));
    cierto(tiene(S.interpretarUsuario('[]', 'x').problemas, 'ningún usersiD'));
    cierto(tiene(S.interpretarUsuario('[{"usersiD":0,"userName":"x"}]', 'x').problemas, 'ningún usersiD'));
  });
  prueba('T11g el nombre de usuario no puede meter nada raro en la URL', () => {
    ['../../FormHeader', 'a/b', 'a b', 'a?x=1', '', null].forEach(function (mal) {
      let tiro = false;
      try { S.rutaDeUsuario(mal); } catch (e) { tiro = true; }
      cierto(tiro, 'tendría que rechazar ' + JSON.stringify(mal));
    });
    igual(S.rutaDeUsuario(' M3LinkSystem '), '/api/User/nombreusuario/M3LinkSystem');
    // Y que diga CUÁL de los dos problemas es: faltar no es lo mismo que traer
    // un carácter que no corresponde.
    let msg = '';
    try { S.rutaDeUsuario(''); } catch (e) { msg = e.message; }
    cierto(/falta el nombre/.test(msg), msg);
  });
  pruebaAsync('T11h idDeUsuario pega en la ruta de la macro', async () => {
    const vistas = [];
    const falso_ = (ruta, o, tipo) => { vistas.push([ruta, o.method, tipo]);
      return Promise.resolve({ status: 200, texto: '[{"usersiD":983,"userName":"M3LinkSystem"}]' }); };
    const u = await S.idDeUsuario('M3LinkSystem', falso_);
    igual(vistas, [['/api/User/nombreusuario/M3LinkSystem', 'GET', 'escritura']]);
    igual(u.id, 983);
  });
  pruebaAsync('T11i un HTTP distinto de 200 no se lee como "no existe"', async () => {
    const u = await S.idDeUsuario('M3LinkSystem', () => Promise.resolve({ status: 403, texto: 'Forbidden' }));
    falso(u.ok);
    cierto(tiene(u.problemas, 'HTTP 403'), JSON.stringify(u.problemas));
  });
  pruebaAsync('T11i2 el cuerpo del error no se imprime crudo', async () => {
    // Un 401 del gateway suele devolver el pedido entero, cabecera incluida.
    const u = await S.idDeUsuario('M3LinkSystem', () => Promise.resolve({ status: 401,
      texto: '{"Authorization":"Bearer ey.SECRETO.firmado","client_secret":"abc123"}' }));
    const todo = (u.problemas || []).join(' ');
    falso(/ey\.SECRETO\.firmado/.test(todo), 'se filtró el token: ' + todo);
    falso(/abc123/.test(todo), 'se filtró el secreto: ' + todo);
  });
  prueba('T11j si la API y el número configurado NO coinciden, no se escribe', () => {
    // Es el único caso donde hay dos fuentes y se contradicen. Elegir una a
    // ojo firma a nombre de quien no confirmó, y eso no se corrige después.
    const c = S.cotejarFirma({ ok: true, id: 7, nombre: 'M3LinkSystem' }, 983);
    falso(c.ok, 'tiene que detener la operación');
    igual(c.usar, null);
    cierto(/7/.test(c.dice) && /983/.test(c.dice), c.dice);
  });
  prueba('T11k si coinciden, queda verificado', () => {
    const c = S.cotejarFirma({ ok: true, id: 983, nombre: 'M3LinkSystem' }, 983);
    cierto(c.ok);
    igual([c.usar, c.verificado], [983, true]);
  });
  prueba('T11l si la API no contesta, se sigue con el configurado pero SIN decir verificado', () => {
    // El número tiene confirmación aparte (Marcelo lo leyó en la base) y el
    // documento preparado muestra la firma antes del PATCH. Pero decir
    // "verificado" sin haber verificado es lo que haría que nadie lo mire.
    const c = S.cotejarFirma({ ok: false, problemas: ['HTTP 404 al resolver'] }, 983);
    cierto(c.ok, 'no bloquea');
    igual([c.usar, c.verificado], [983, false]);
    cierto(/no se pudo verificar/.test(c.dice), c.dice);
    cierto(/HTTP 404/.test(c.dice), 'tiene que decir por qué: ' + c.dice);
  });

  /* ---- el documento que prepara el servidor ------------------------------ */

  prueba('T11m un documento preparado correcto pasa', () => {
    const r = S.revisarPreparado(JSON.stringify(con({
      formMetapa: { nombre: 'Transferencia Confirmada' },
      formDdetalles: [{ despachado: 3, recepcion: 3 }]
    })), 4146335, 3);
    cierto(r.ok, (r.problemas || []).join(' · '));
    igual(r.etapa, 'Transferencia Confirmada');
  });
  prueba('T11m2 un cuerpo vacío se nombra como vacío, no como "no es JSON"', () => {
    // Son dos problemas distintos y mandan a mirar lados distintos: uno es que
    // el servidor no contestó nada, el otro que contestó otra cosa.
    const r = S.revisarPreparado('', 4146335, 3);
    falso(r.ok);
    cierto(tiene(r.problemas, 'cuerpo vacío'), JSON.stringify(r.problemas));
    falso(tiene(r.problemas, 'no es JSON'), 'eso es otro problema: ' + JSON.stringify(r.problemas));
  });
  prueba('T11n un 200 con un error adentro NO es un documento', () => {
    const r = S.revisarPreparado('{"error":"no existe"}', 4146335, 3);
    falso(r.ok);
    cierto(tiene(r.problemas, 'no existe'), JSON.stringify(r.problemas));
  });
  prueba('T11o un folio cruzado detiene todo', () => {
    // Mandar de vuelta el documento de otro folio confirma la transferencia
    // equivocada, y el PATCH no pregunta.
    const r = S.revisarPreparado(JSON.stringify(con({ folio: 9999999,
      formDdetalles: [{ despachado: 3, recepcion: 3 }] })), 4146335, 3);
    falso(r.ok);
    cierto(tiene(r.problemas, '9999999'), JSON.stringify(r.problemas));
  });
  prueba('T11p si la recepción preparada no es la pedida, no se manda', () => {
    const r = S.revisarPreparado(JSON.stringify(con({
      formDdetalles: [{ despachado: 19, recepcion: 19 }] })), 4146335, 3);
    falso(r.ok);
    cierto(tiene(r.problemas, 'recepción 19'), JSON.stringify(r.problemas));
  });
  prueba('T11q el preparado muestra qué firma trae, antes de mandarlo', () => {
    const r = S.revisarPreparado(JSON.stringify(con({
      usuarioIngresoId: 983, usuarioIngresoNombre: 'M3LinkSystem',
      formDdetalles: [{ despachado: 3, recepcion: 3 }] })), 4146335, 3);
    igual([r.firma.id, r.firma.nombre], [983, 'M3LinkSystem']);
  });
  pruebaAsync('T11r el preparado se pide con M3LinkSystem, no con el de lectura', async () => {
    const vistas = [];
    const p = (ruta, o, tipo) => { vistas.push(tipo); return Promise.resolve({ status: 200, texto: '{}' }); };
    const r = await S.prepararConfirmacion('/api/x', p);
    igual(vistas, ['escritura']);
    falso(r.conLectura);
  });
  pruebaAsync('T11s si escritura no alcanza, reintenta con lectura y lo dice', async () => {
    // La firma la lleva la URL, no el token: está medido. Que un 403 de
    // permisos no mate la corrida, pero que quede dicho cuál se usó.
    const vistas = [];
    const p = (ruta, o, tipo) => { vistas.push(tipo);
      return Promise.resolve(tipo === 'escritura' ? { status: 403, texto: '' } : { status: 200, texto: '{}' }); };
    const r = await S.prepararConfirmacion('/api/x', p);
    igual(vistas, ['escritura', 'lectura']);
    cierto(r.conLectura);
    igual([r.status, r.statusEscritura], [200, 403]);
  });
  pruebaAsync('T11t un 500 NO se reintenta con otro usuario', async () => {
    // Reintentar un error del servidor con otro usuario esconde el problema y
    // además manda el mismo pedido dos veces.
    const vistas = [];
    const p = (ruta, o, tipo) => { vistas.push(tipo); return Promise.resolve({ status: 500, texto: 'boom' }); };
    const r = await S.prepararConfirmacion('/api/x', p);
    igual(vistas, ['escritura']);
    igual(r.status, 500);
  });
  prueba('T11u --preparar y --si se leen por separado', () => {
    // --preparar tiene que poder mirar sin mandar: si --si se activara solo,
    // el paso de mirar no existiría.
    const a = S.leerArgs(['--productivo', '--folio=1', '--cantidad=2', '--preparar']);
    igual([a.preparar, a.si], [true, false]);
    const b = S.leerArgs(['--productivo', '--folio=1', '--cantidad=2', '--si']);
    igual([b.preparar, b.si], [false, true]);
    igual(S.leerArgs(['--usuario=M3LinkSystem']).usuario, 'M3LinkSystem');
  });
  /* ---- buscar qué corresponde confirmar hoy ----------------------------- */

  const FILA = { folio: 4146335, formHeaderiD: 684100, etapaOperacion: 'Pendiente de Confirmación',
                 bpDestinoNombre: 'WALMART CHILE COMERCIAL S.A', operacion: 'Transferencias' };
  const fila = (c) => Object.assign({}, FILA, c);

  /* ---- el lote ---------------------------------------------------------- */

  prueba('T15a el mismo folio dos veces en el archivo NO se corre', () => {
    // Dos filas con el mismo folio son dos ajustes de inventario sobre la
    // misma transferencia.
    const r = S.revisarLote([{ folio: 1, cantRecibida: 1 }, { folio: 1, cantRecibida: 2 }], [], 50);
    falso(r.ok);
    cierto(tiene(r.problemas, 'repetidos'), JSON.stringify(r.problemas));
  });
  prueba('T15b una línea mal formada detiene el archivo entero', () => {
    // Un CSV con basura adentro quiere decir que el que lo generó falló, y
    // entonces las filas buenas tampoco son de fiar: salieron del mismo lugar.
    const r = S.revisarLote([{ folio: 1, cantRecibida: 1 }], [{ linea: 7, texto: 'basura' }], 50);
    falso(r.ok, 'no se saltea una línea rota');
    cierto(tiene(r.problemas, 'línea 7'), JSON.stringify(r.problemas));
  });
  prueba('T15c un archivo gigante no se corre sin pedirlo', () => {
    const muchas = [];
    for (let i = 0; i < 80; i++) muchas.push({ folio: 4000 + i, cantRecibida: 1 });
    const r = S.revisarLote(muchas, [], null);
    falso(r.ok, '80 filas con tope 50 tiene que negarse');
    cierto(tiene(r.problemas, '--tope=80'), 'y decir cómo pedirlo: ' + JSON.stringify(r.problemas));
    cierto(S.revisarLote(muchas, [], 80).ok, 'pedido explícito, procede');
    igual(S.TOPE_LOTE, 50);
  });
  prueba('T15d un archivo vacío no es un lote de cero', () => {
    const r = S.revisarLote([], [], 50);
    falso(r.ok);
    cierto(tiene(r.problemas, 'ninguna fila utilizable'), JSON.stringify(r.problemas));
  });
  prueba('T15e una ya confirmada se SALTA, no detiene el lote', () => {
    // El módulo del proveedor pudo haberla confirmado mientras corríamos, o es
    // un archivo que se reintenta. Detener ahí dejaría el resto sin hacer por
    // una fila que ya estaba lista.
    const ya = con({ formMetapa: { nombre: 'Transferencia Confirmada' },
                     formDdetalles: [{ despachado: 19, recepcion: 19 }] });
    const c = S.clasificarEnLote(ya, 19, 983);
    igual(c.accion, 'saltar');
    cierto(/ya está confirmada/.test(c.motivo), c.motivo);
  });
  prueba('T15f cualquier otro problema DETIENE el lote', () => {
    // Si el documento no es el que el archivo describe, seguir con los
    // siguientes es confirmar a ciegas.
    igual(S.clasificarEnLote(con({ bpDestinoNombre: 'OTRO RETAIL' }), 3, 983).accion, 'detener');
    igual(S.clasificarEnLote(con({ formId: 1 }), 3, 983).accion, 'detener');
    igual(S.clasificarEnLote(DOC, 99, 983).accion, 'detener', 'más de lo despachado');
    igual(S.clasificarEnLote(null, 3, 983).accion, 'detener');
    igual(S.clasificarEnLote(con({ formMetapa: { nombre: 'Transferencia Anulada' },
                                   formDdetalles: [{ despachado: 19, recepcion: null }] }), 3, 983).accion, 'detener');
  });
  prueba('T15g una que corresponde confirmar trae su plan armado', () => {
    const c = S.clasificarEnLote(DOC, 3, 983);
    igual(c.accion, 'confirmar');
    cierto(c.plan && c.plan.ok, 'tiene que venir con el plan');
    cierto(c.plan.url.indexOf('/recibido/3/') >= 0, c.plan.url);
    cierto(c.plan.url.indexOf('/usuarioconfirma/983') >= 0, c.plan.url);
  });
  prueba('T15h el lote usa la cantidad del ARCHIVO, no la despachada', () => {
    // La del archivo la puso Walmart; la despachada es lo que salió de acá.
    const c = S.clasificarEnLote(DOC, 3, 983);
    cierto(c.plan.url.indexOf('/recibido/3/') >= 0, 'despachado 19, archivo 3: ' + c.plan.url);
    falso(c.plan.url.indexOf('/recibido/19/') >= 0, c.plan.url);
  });
  prueba('T15i el índice agrupa por folio en una pasada', () => {
    const ix = S.indicePorFolio([{ folio: 1, formHeaderiD: 10 }, { folio: 2, formHeaderiD: 20 },
                                 { folio: 1, formHeaderiD: 11 }, null, { formHeaderiD: 99 }]);
    igual(ix['1'].length, 2);
    igual(ix['2'].length, 1);
    igual(Object.keys(ix).sort(), ['1', '2'], 'una fila sin folio no inventa una entrada');
  });
  prueba('T15j un folio duplicado o ausente en el histórico no se escribe', () => {
    const ix = S.indicePorFolio([{ folio: 1, formHeaderiD: 10 }, { folio: 2, formHeaderiD: 20 },
                                 { folio: 2, formHeaderiD: 21 }, { folio: 3 }]);
    igual(S.idDeFolio(ix, 1).id, 10);
    igual(S.idDeFolio(ix, 2).id, null, 'dos operaciones: no se elige una');
    cierto(/2 operaciones/.test(S.idDeFolio(ix, 2).motivo));
    igual(S.idDeFolio(ix, 3).id, null, 'sin formHeaderiD no se puede escribir');
    igual(S.idDeFolio(ix, 9).id, null);
    cierto(/no aparece/.test(S.idDeFolio(ix, 9).motivo));
    igual(S.idDeFolio(null, 1).id, null, 'sin índice tampoco revienta');
  });
  pruebaAsync('T15k los folios del lote se resuelven en una pasada y corta al tenerlos', async () => {
    let bajados = 0;
    const traer = () => { bajados++; return Promise.resolve([{ folio: 1, formHeaderiD: 10 },
                                                             { folio: 2, formHeaderiD: 20 }]); };
    const r = await S.buscarVariosFolios([1, 2], 30, 7, null, traer, null);
    igual(bajados, 1, 'con los dos en el primer tramo no hay por qué seguir');
    igual(r.faltan, []);
    igual(S.idDeFolio(r.indice, 2).id, 20);
  });
  pruebaAsync('T15l si falta uno sigue buscando, y al final lo nombra', async () => {
    let bajados = 0;
    const traer = () => { bajados++; return Promise.resolve([{ folio: 1, formHeaderiD: 10 }]); };
    const r = await S.buscarVariosFolios([1, 777], 30, 7, null, traer, null);
    cierto(bajados > 1, 'tenía que seguir buscando el que falta: ' + bajados);
    igual(r.faltan, ['777'], 'y decir cuál falta, no sólo que faltan');
  });
  prueba('T15m el resumen cuenta y nombra dónde se detuvo', () => {
    const r = S.resumenDeLote([{ accion: 'confirmar', folio: 1 }, { accion: 'saltar', folio: 2 },
                               { accion: 'confirmar', folio: 3 }, { accion: 'detener', folio: 4, motivo: 'x' }]);
    igual([r.confirmadas, r.saltadas], [2, 1]);
    igual(r.detenido.folio, 4);
    igual(S.resumenDeLote([]).detenido, null);
  });
  prueba('T15n el lote lee el mismo CSV que exporta la página', () => {
    // Un segundo parser del mismo contrato se separa del primero el día que
    // alguien arregla uno de los dos.
    const r = S.leerListado('folio;cantRecibida\r\n4149330;1\r\n4149331;2\r\n');
    igual(r.filas, [{ folio: 4149330, cantRecibida: 1 }, { folio: 4149331, cantRecibida: 2 }]);
    igual(r.malas, []);
  });
  prueba('T15o --lote, --tope y --pausa se leen de la línea de comandos', () => {
    const a = S.leerArgs(['--productivo', '--lote=c.csv', '--tope=80', '--pausa=500', '--si']);
    igual([a.lote, a.tope, a.pausa, a.si], ['c.csv', '80', '500', true]);
    igual(S.leerArgs(['--productivo', '--lote=c.csv']).si, false, 'el lote no se dispara sin --si');
  });

  prueba('T14a el diff muestra todo lo que cambió, no una lista conocida', () => {
    // El 10-nov el preparador devolvió el documento sin tocar y la respuesta
    // fue "no sirve". Sin un diff completo no se distingue entre "el servidor
    // no preparó nada" y "preparó algo en un campo que no miramos".
    const d = S.diferencias({ a: 1, inventado: 'x' }, { a: 2, inventado: 'x' });
    igual(d.length, 1);
    igual([d[0].campo, d[0].antes, d[0].despues], ['a', '1', '2']);
  });
  prueba('T14b un campo que sólo está en uno de los dos también sale', () => {
    const d = S.diferencias({ a: 1 }, { a: 1, nuevo: 7 });
    igual(d.length, 1);
    igual([d[0].campo, d[0].antes, d[0].despues], ['nuevo', '(sin el campo)', '7']);
    const e = S.diferencias({ viejo: 7 }, {});
    igual([e[0].campo, e[0].antes, e[0].despues], ['viejo', '7', '(sin el campo)']);
  });
  prueba('T14c dos documentos iguales no tienen diferencias', () => {
    igual(S.diferencias(DOC, JSON.parse(JSON.stringify(DOC))), []);
    igual(S.diferencias(null, null), []);
  });
  prueba('T14d baja a la línea de detalle: ahí vive la cantidad', () => {
    // Arriba formDdetalles sale como un bloque JSON recortado y el campo que
    // importa queda escondido justamente en el recorte.
    const otro = JSON.parse(JSON.stringify(DOC));
    otro.formDdetalles[0].recepcion = 3;
    const d = S.diferencias(DOC, otro);
    cierto(d.some(x => x.campo === 'detalle.recepcion'), JSON.stringify(d.map(x => x.campo)));
    const det = d.filter(x => x.campo === 'detalle.recepcion')[0];
    igual([det.antes, det.despues], ['null', '3']);
  });
  prueba('T14e un valor enorme se recorta, y se ve que está recortado', () => {
    const largo = S.recorteValor('x'.repeat(500));
    cierto(largo.length < 200, 'quedó en ' + largo.length);
    cierto(/…$/.test(largo), 'tiene que verse que hay más: ' + largo.slice(-20));
    igual(S.recorteValor(undefined), '(sin el campo)');
    igual(S.recorteValor(null), 'null', 'un null es un valor, no un campo ausente');
  });
  prueba('T14f la marca de procedencia se puede cambiar por comando', () => {
    // Para medir UNA variable: mismo folio, misma cantidad, sólo la marca.
    // Fue así como se encontró que el servidor sólo prepara con CONFIRMAVER2.
    igual(S.leerArgs(['--origen=M3LINK']).origen, 'M3LINK');
    igual(S.leerArgs([]).origen, null);
    const p = S.planDeConfirmacion(DOC, 3, 983, 'M3LINK');
    cierto(p.url.indexOf('/original/M3LINK/') >= 0, p.url);
    igual(p.origen, 'M3LINK');
    // Sin pedirla, la que el servidor reconoce.
    igual(S.ORIGEN, 'CONFIRMAVER2', 'el valor por omisión tiene que ser el que prepara');
    cierto(S.planDeConfirmacion(DOC, 3, 983).url.indexOf('/original/CONFIRMAVER2/') >= 0);
  });
  prueba('T14g avisa si el PATCH vació una colección del documento', () => {
    // El cuerpo preparado manda formDtransportes y formDregistros como [].
    // Si el servidor los reemplaza, se perdieron registros y nadie lo iba a
    // notar mirando la etapa, que es lo único que se mira cuando sale bien.
    const antes = con({ formDtransportes: [{ formDtransporteiD: 433211 }], formDregistros: [{ x: 1 }] });
    const despues = con({ formDtransportes: [], formDregistros: [{ x: 1 }] });
    igual(S.coleccionesVaciadas(antes, despues), ['formDtransportes']);
    igual(S.coleccionesVaciadas(antes, antes), [], 'si no se vació nada, no se avisa nada');
    // Una colección que ya estaba vacía no se vació ahora.
    igual(S.coleccionesVaciadas(con({ formDtransportes: [] }), con({ formDtransportes: [] })), []);
    igual(S.coleccionesVaciadas(null, null), []);
    cierto(S.COLECCIONES_HIJAS.indexOf('formDtransportes') >= 0);
    cierto(S.COLECCIONES_HIJAS.indexOf('formDregistros') >= 0);
  });

  prueba('T13a encuentra las de Walmart en etapa confirmable', () => {
    const r = S.candidatosDe([fila({}), fila({ folio: 2, etapaOperacion: 'Pendiente Adjuntar Respaldo' })]);
    igual(r.candidatos.length, 2, 'las dos etapas del circuito masivo entran');
    igual(r.candidatos[0].folio, 4146335);
  });
  prueba('T13b no propone las que ya están confirmadas ni las anuladas', () => {
    const r = S.candidatosDe([
      fila({ etapaOperacion: 'Transferencia Confirmada' }),
      fila({ etapaOperacion: 'Transferencia Reconfirmada' }),
      fila({ etapaOperacion: 'Transferencia Anulada' })
    ]);
    igual(r.candidatos.length, 0, 'proponer una confirmada dispara un SEGUNDO ajuste en SAP');
  });
  prueba('T13c no propone las que no van a Walmart', () => {
    igual(S.candidatosDe([fila({ bpDestinoNombre: 'OTRO RETAIL' })]).candidatos.length, 0);
  });
  prueba('T13d una fila sin etapa se CUENTA, no se descarta en silencio', () => {
    // "No hay candidatas" y "no supe leer el listado" son dos respuestas
    // distintas, y una manda a mirar el lado equivocado.
    const r = S.candidatosDe([{ folio: 1, bpDestinoNombre: 'WALMART' }, fila({})]);
    igual([r.sinEtapa, r.candidatos.length, r.filas], [1, 1, 2]);
  });
  prueba('T13e lee la etapa venga con el nombre que venga', () => {
    // El histórico crudo y el /proxy/ops no etiquetan igual lo mismo.
    S.CAMPOS_FILA.etapa.forEach(function (k) {
      const f = { bpDestinoNombre: 'WALMART CHILE', folio: 7 };
      f[k] = 'Pendiente de Confirmación';
      igual(S.candidatosDe([f]).candidatos.length, 1, 'no supo leer la etapa en ' + k);
    });
  });
  prueba('T13f lee el destino y el folio venga con el nombre que venga', () => {
    S.CAMPOS_FILA.destino.forEach(function (k) {
      const f = { etapaOperacion: 'Pendiente de Confirmación', folio: 7 };
      f[k] = 'WALMART CHILE';
      igual(S.candidatosDe([f]).candidatos.length, 1, 'no supo leer el destino en ' + k);
    });
    igual(S.campoFila({ nroPedido: 99 }, 'folio'), 99);
    igual(S.campoFila({ formHeaderId: 5 }, 'id'), 5);
  });
  prueba('T13g un campo vacío no cuenta como presente', () => {
    // Un '' o un null en el primer nombre tiene que dejar probar el siguiente,
    // o el dato queda ilegible estando ahí.
    igual(S.campoFila({ folio: '', nroPedido: 99 }, 'folio'), 99);
    igual(S.campoFila({ folio: null, nroPedido: 99 }, 'folio'), 99);
    igual(S.campoFila({}, 'folio'), null);
    igual(S.campoFila(null, 'folio'), null);
  });
  prueba('T13h la basura del listado no revienta la búsqueda', () => {
    const r = S.candidatosDe([null, 'x', 7, fila({})]);
    igual(r.candidatos.length, 1);
    // Y no se cuentan como "filas que no supe leer": si se contaran, un
    // listado con un null al final diría "no supe leer el histórico", que es
    // una afirmación distinta y manda a revisar los nombres de los campos.
    igual(r.sinEtapa, 0, 'un null no es una fila con la etapa ilegible');
    igual(S.candidatosDe(null).candidatos.length, 0);
  });
  pruebaAsync('T13i2 un tramo con 135 candidatas igual entrega las que se pidieron', async () => {
    // Salió en producción: --cuantos recortaba los tramos pero no la lista, y
    // un tramo de tres días trajo 135 de una. Quien las recibe lee el
    // documento de cada una: 135 consultas para mostrar cinco.
    const muchas = [];
    for (let i = 0; i < 135; i++) muchas.push(fila({ folio: 4149000 + i }));
    const r = await S.buscarCandidatos(3, 7, 5, null, () => Promise.resolve(muchas), null);
    igual(r.candidatos.length, 5, 'tiene que entregar cinco, no ciento treinta y cinco');
    igual(r.hay, 135, 'pero el total se informa, porque es el dato que importa aparte');
  });
  pruebaAsync('T13i corta en cuanto juntó suficientes: no baja 17.000 por gusto', async () => {
    let bajados = 0;
    const traer = () => { bajados++; return Promise.resolve([fila({}), fila({ folio: 2 })]); };
    const r = await S.buscarCandidatos(30, 7, 2, null, traer, null);
    igual(bajados, 1, 'con dos en el primer tramo no hay por qué seguir');
    igual(r.candidatos.length, 2);
  });
  pruebaAsync('T13j si el primer tramo no alcanza, sigue y SUMA lo de los dos', async () => {
    let bajados = 0;
    const traer = () => { bajados++; return Promise.resolve([fila({ folio: bajados })]); };
    const r = await S.buscarCandidatos(30, 7, 2, null, traer, null);
    igual(bajados, 2, 'con una por tramo y meta 2, dos tramos');
    igual(r.candidatos.map(c => c.folio), [1, 2], 'lo del primer tramo no se pierde');
  });
  pruebaAsync('T13j2 un tramo vacío no detiene la búsqueda', async () => {
    let bajados = 0;
    const traer = () => { bajados++; return Promise.resolve(bajados === 1 ? [] : [fila({})]); };
    const r = await S.buscarCandidatos(30, 7, 2, null, traer, null);
    cierto(bajados >= 2, 'tenía que seguir buscando: ' + bajados);
    cierto(r.candidatos.length >= 1);
  });
  prueba('T13l --candidatos mira pocos días por omisión, y respeta --dias', () => {
    // Por omisión tiene que ser una ventana corta: son 4.000 operaciones por
    // semana y la que se va a confirmar hoy es de ayer o de hoy.
    igual(S.diasParaCandidatos(S.leerArgs(['--productivo', '--candidatos'])), S.DIAS_CANDIDATOS);
    cierto(Number(S.DIAS_CANDIDATOS) <= 7, 'una ventana corta: ' + S.DIAS_CANDIDATOS);
    igual(S.diasParaCandidatos(S.leerArgs(['--productivo', '--candidatos', '--dias=45'])), '45');
    igual(S.leerArgs(['--productivo', '--candidatos', '--cuantos=9']).cuantos, '9');
    cierto(S.leerArgs(['--productivo', '--candidatos']).candidatos);
    falso(S.leerArgs(['--productivo']).candidatos);
  });
  pruebaAsync('T13k suma el total leído y las filas que no supo leer', async () => {
    const traer = () => Promise.resolve([{ folio: 1 }, { folio: 2 }]);
    const r = await S.buscarCandidatos(7, 7, 5, null, traer, null);
    igual([r.total, r.sinEtapa, r.candidatos.length], [2, 2, 0]);
  });

  prueba('T12a los tramos van del MÁS NUEVO al más viejo', () => {
    // Un folio que se confirma hoy es de los últimos días: buscando desde el
    // presente aparece en el primer o segundo tramo y el resto no se baja.
    const t = S.tramosHaciaAtras(30, 7);
    cierto(t.length >= 4, 'tiene que trocear: ' + t.length);
    cierto(t[0].hasta > t[1].hasta, 'el primero es el más reciente');
    for (let i = 1; i < t.length; i++) cierto(t[i].hasta < t[i - 1].desde, 'los tramos no se pisan');
  });
  prueba('T12b los tramos cubren la ventana entera, sin huecos', () => {
    const t = S.tramosHaciaAtras(30, 7);
    const dia = 86400000;
    for (let i = 1; i < t.length; i++) {
      const salto = (new Date(t[i - 1].desde) - new Date(t[i].hasta)) / dia;
      igual(salto, 1, 'entre el tramo ' + i + ' y el ' + (i + 1) + ' hay un hueco');
    }
  });
  prueba('T12c ningún tramo es más largo que el paso pedido', () => {
    const dia = 86400000;
    [[30, 7], [31, 7], [7, 7], [1, 7], [90, 10]].forEach(function (par) {
      S.tramosHaciaAtras(par[0], par[1]).forEach(function (x) {
        const largo = (new Date(x.hasta) - new Date(x.desde)) / dia + 1;
        cierto(largo <= par[1], 'tramo de ' + largo + ' días con paso ' + par[1]);
        cierto(largo >= 1, 'tramo vacío');
      });
    });
  });
  prueba('T12d valores raros no rompen el troceo', () => {
    cierto(S.tramosHaciaAtras(0, 0).length >= 1, 'siempre al menos un tramo');
    cierto(S.tramosHaciaAtras(null, null).length >= 1);
    cierto(S.tramosHaciaAtras('30', '7').length >= 4, 'acepta texto, que es como vienen los argumentos');
  });
  prueba('T12e el paso por omisión es 7 días, que es lo que entra sin cortarse', () => {
    // Medido el 9-nov-2026: 31 días (17.525 operaciones) se cortan por timeout;
    // 7 días (4.746) entran. El defecto se quedó callado durante horas.
    igual(S.leerArgs(['--productivo']).tramo, '7');
    igual(S.leerArgs(['--productivo', '--tramo=3']).tramo, '3');
  });
  prueba('T12f el paso POR OMISIÓN también trocea', () => {
    // La mutación que sobrevivía ponía 31 por defecto: con --dias=30 habría
    // vuelto a bajar todo de una y a cortarse, sin que ninguna prueba lo viera.
    const dia = 86400000;
    S.tramosHaciaAtras(30).forEach(function (x) {
      const largo = (new Date(x.hasta) - new Date(x.desde)) / dia + 1;
      cierto(largo <= 7, 'tramo de ' + largo + ' días sin pedir paso');
    });
  });
  prueba('T12g un --dias mal escrito no deja la búsqueda en cero tramos', () => {
    // Los argumentos llegan como texto y un dedazo es posible. Buscar en cero
    // tramos diría "no aparece" sin haber mirado nada.
    cierto(S.tramosHaciaAtras('30x', 7).length >= 1, 'no puede quedar sin tramos');
    cierto(S.tramosHaciaAtras('abc', 7).length >= 1);
  });
  pruebaAsync('T12h deja de bajar tramos apenas encuentra el folio', async () => {
    const vistos = [];
    const falso7 = async (t) => {
      vistos.push(t.desde);
      return vistos.length === 2 ? [{ folio: 4139366, formHeaderiD: 682214 }] : [{ folio: 1 }, { folio: 2 }];
    };
    const r = await S.buscarPorFolio(4139366, 30, 7, null, falso7);
    igual(r.filas.length, 1);
    igual(vistos.length, 2, 'bajó 2 tramos y paró; bajó ' + vistos.length);
    igual(r.tramos, 2);
    igual(r.total, 3, 'cuenta lo que realmente bajó');
  });
  pruebaAsync('T12i si no está, recorre TODOS los tramos antes de decir que no', async () => {
    let n = 0;
    const r = await S.buscarPorFolio(999, 30, 7, null, async () => { n++; return [{ folio: 1 }]; });
    igual(r.filas.length, 0);
    igual(n, S.tramosHaciaAtras(30, 7).length, 'tiene que mirar la ventana entera');
    igual(r.total, n);
  });
  pruebaAsync('T12j el folio se compara como texto, no por tipo', async () => {
    const r = await S.buscarPorFolio('4139366', 30, 7, null,
      async () => [{ folio: 4139366, formHeaderiD: 682214 }]);
    igual(r.filas.length, 1, 'el argumento viene como texto y el dato como número');
  });
  pruebaAsync('T12k avisa tramo por tramo mientras baja', async () => {
    const avisos = [];
    await S.buscarPorFolio(4139366, 21, 7, (x) => avisos.push(x),
      async (t) => t.desde === S.tramosHaciaAtras(21, 7)[1].desde
        ? [{ folio: 4139366 }] : [{ folio: 1 }]);
    igual(avisos.length, 2);
    igual(avisos[0].i, 1);
    igual(avisos[1].encontrado, 1, 'el aviso dice en qué tramo apareció');
    cierto(avisos[0].desde && avisos[0].hasta, 'y de qué fechas era');
  });
  prueba('T13a parte un tramo al medio, sin huecos ni solapes', () => {
    const m = S.partirTramo({ desde: '2026-11-03', hasta: '2026-11-09' });
    igual(m, [{ desde: '2026-11-03', hasta: '2026-11-05' },
              { desde: '2026-11-06', hasta: '2026-11-09' }]);
  });
  prueba('T13b un tramo de un día ya no se parte', () => {
    igual(S.partirTramo({ desde: '2026-11-03', hasta: '2026-11-03' }), null);
  });
  prueba('T13c un tramo de dos días se parte en dos de uno', () => {
    igual(S.partirTramo({ desde: '2026-11-03', hasta: '2026-11-04' }),
          [{ desde: '2026-11-03', hasta: '2026-11-03' }, { desde: '2026-11-04', hasta: '2026-11-04' }]);
  });
  prueba('T13d sólo se parte ante un corte de TIEMPO', () => {
    // Partir ante un 400 o un 500 sería pedir lo mismo dos veces: ahí el
    // problema no se arregla pidiendo menos.
    cierto(S.esCorteDeTiempo(new Error('The operation was aborted due to timeout')));
    cierto(S.esCorteDeTiempo('terminated'));
    cierto(S.esCorteDeTiempo(new Error('ETIMEDOUT')));
    falso(S.esCorteDeTiempo(new Error('HTTP 400 Bad Request')));
    falso(S.esCorteDeTiempo(new Error('No se pudo leer el histórico: HTTP 500')));
    falso(S.esCorteDeTiempo(null));
  });
  pruebaAsync('T13e el tramo partido devuelve TODO, no la mitad', async () => {
    // Si al partir se perdiera una mitad, el folio podría quedar invisible y
    // el script diría "no aparece" sobre datos que sí bajó.
    let n = 0;
    const bajar = async (t) => {
      n++;
      const m = S.partirTramo(t);
      if (n === 1 && m) { const a2 = await bajar(m[0]), b2 = await bajar(m[1]); return a2.concat(b2); }
      return [{ folio: 100 + n }];
    };
    const r = await S.buscarPorFolio(999, 7, 7, null, bajar);
    igual(r.total, 2, 'las dos mitades suman');
  });
  pruebaAsync('T13f al partir se devuelven LAS DOS mitades, no la primera', async () => {
    const pedidos = [];
    const falsoBajar = async (m) => { pedidos.push(m.desde + '..' + m.hasta); return [{ folio: pedidos.length }]; };
    const out = await S.partirYReintentar({ desde: '2026-11-03', hasta: '2026-11-09' },
                                          'timeout', null, falsoBajar);
    igual(pedidos.length, 2, 'tiene que pedir las dos mitades');
    igual(out.length, 2, 'y devolver las dos: perder una haría invisible un folio');
  });
  pruebaAsync('T13g si el tramo ya es de un día, revienta diciendo qué hacer', async () => {
    let e = null;
    try { await S.partirYReintentar({ desde: '2026-11-03', hasta: '2026-11-03' }, 'timeout', null, async () => []); }
    catch (x) { e = x; }
    cierto(e, 'tiene que reventar en vez de devolver vacío en silencio');
    cierto(/UN día/.test(e.message), e.message);
    cierto(/--timeout/.test(e.message), 'y decir cómo salir: ' + e.message);
  });
  pruebaAsync('T13h el aviso del corte dice qué tramo y en qué se parte', async () => {
    const avisos = [];
    await S.partirYReintentar({ desde: '2026-11-03', hasta: '2026-11-09' }, 'timeout',
                              (c) => avisos.push(c), async () => []);
    igual(avisos.length, 1);
    igual(avisos[0].mitades.length, 2);
    igual(avisos[0].tramo.desde, '2026-11-03');
    cierto(/timeout/.test(avisos[0].motivo), 'el motivo viaja');
  });
  prueba('T10c el nombre de la etapa se reconoce con y sin tilde', () => {
    cierto(S.etapaConfirmable({ formMetapa: { nombre: 'Pendiente de Confirmacion' } }));
    cierto(S.etapaConfirmable({ formMetapa: { nombre: 'PENDIENTE DE CONFIRMACIÓN' } }));
    falso(S.etapaConfirmable({ formMetapa: { nombre: '' } }));
    falso(S.etapaConfirmable(null));
  });

  prueba('T11 una etapa "Pendiente" con recepción no cuenta como confirmada', () => {
    const d = con({ formDdetalles: [Object.assign({}, DOC.formDdetalles[0], { recepcion: 19 })] });
    falso(S.esConfirmada(d), 'la etapa manda: hacen falta las dos señales');
  });
  prueba('T12 no confirma más de lo despachado', () => {
    cierto(tiene(S.planDeConfirmacion(DOC, 25).problemas, 'sólo se despacharon 19'));
  });
  prueba('T13 confirmar exactamente lo despachado sí vale', () => {
    cierto(S.planDeConfirmacion(DOC, 19).ok);
  });
  prueba('T14 no confirma cantidades vacías, cero o negativas', () => {
    [0, -3, null, 'x'].forEach(function (v) {
      cierto(tiene(S.planDeConfirmacion(DOC, v).problemas, 'mayor que cero'), 'con ' + JSON.stringify(v));
    });
  });
  prueba('T15 no confirma si la línea no trae despacho', () => {
    const sin = con({ formDdetalles: [Object.assign({}, DOC.formDdetalles[0], { despachado: null })] });
    cierto(tiene(S.planDeConfirmacion(sin, 3).problemas, 'no tiene cantidad despachada'));
  });
  prueba('T16 no confirma un documento con varias líneas', () => {
    const dos = con({ formDdetalles: [DOC.formDdetalles[0], DOC.formDdetalles[0]] });
    cierto(tiene(S.planDeConfirmacion(dos, 3).problemas, '2 líneas'));
  });
  prueba('T17 junta TODOS los problemas, no corta en el primero', () => {
    const malo = con({ formId: 1, bpDestinoNombre: 'OTRO' });
    cierto(S.planDeConfirmacion(malo, 99).problemas.length >= 3,
      'corregir de a uno cuesta una corrida cada vez');
  });
  prueba('T18 un documento ilegible no pasa', () => {
    falso(S.planDeConfirmacion(null, 3).ok);
    falso(S.planDeConfirmacion('x', 3).ok);
  });

  /* ---- la comprobación posterior ----------------------------------------- */

  prueba('T19 si nada cambió, no hay confirmación', () => {
    igual(S.comparar(DOC, DOC), [], 'un 200 sin cambios no es una confirmación');
  });
  prueba('T20 detecta el avance de etapa y la recepción escrita', () => {
    const d = con({ formMetapaId: 46, confirmacionVeces: 1, usuarioConfirmaId: 77,
                    formMetapa: { nombre: 'Transferencia Confirmada' },
                    formDdetalles: [Object.assign({}, DOC.formDdetalles[0], { recepcion: 3 })] });
    const c = S.comparar(DOC, d).map(x => x.campo);
    ['formMetapaId', 'confirmacionVeces', 'usuarioConfirmaId', 'detalle.recepcion', 'etapa'].forEach(function (k) {
      cierto(c.indexOf(k) >= 0, 'falta mirar ' + k + ': ' + c.join(', '));
    });
  });
  prueba('T21 la comparación trae el antes y el después', () => {
    const d = con({ confirmacionVeces: 1 });
    igual(S.comparar(DOC, d), [{ campo: 'confirmacionVeces', antes: 0, despues: 1 }]);
  });
  prueba('T22 null, cero y ausente son tres estados distintos', () => {
    const linea = (v) => { const l = Object.assign({}, DOC.formDdetalles[0]); 
                           if (v === 'sin') delete l.recepcion; else l.recepcion = v; return con({ formDdetalles: [l] }); };
    igual(S.comparar(linea(null), linea(0)).length, 1, 'recepcion null y recepcion 0 no son lo mismo');
    // Y el campo ausente tampoco es null: al verificar una escritura, "el campo
    // apareció" es información, y una comparación floja los da por iguales.
    igual(S.comparar(linea('sin'), linea(null)).length, 1, 'ausente y null no son lo mismo');
  });

  /* ---- argumentos -------------------------------------------------------- */

  prueba('T23 --productivo no está por omisión', () => {
    igual(S.leerArgs([]).productivo, false, 'nadie puede llegar acá por inercia');
    igual(S.leerArgs(['--productivo']).productivo, true);
  });
  prueba('T24 --si no está por omisión', () => {
    igual(S.leerArgs(['--productivo', '--folio=1', '--cantidad=2']).si, false);
  });
  prueba('T25 lee folio, cantidad y días', () => {
    const a = S.leerArgs(['--productivo', '--folio=4146335', '--cantidad=3', '--dias=60', '--si']);
    igual([a.folio, a.cantidad, a.dias, a.si], ['4146335', '3', '60', true]);
  });
  prueba('T26 la fecha para Redlink sale en MM-dd-yyyy', () => {
    igual(S.aUS('2026-11-09'), '11-09-2026');
  });

  for (const [n, fn] of pendientes) {
    try { await fn(); ok++; }
    catch (e) { fallos.push(n + ' -> ' + (e && e.message ? e.message : String(e))); }
  }
  return { ok: ok, fallos: fallos };
}

const MUTACIONES = [
  ['M150 el lote corre con folios repetidos',           /if \(repetidos\.length\) \{/, 'if (false) {'],
  ['M151 el lote se saltea las líneas rotas',           /\(malas \|\| \[\]\)\.forEach\(function \(m\) \{/, '[].forEach(function (m) {'],
  ['M152 el lote no tiene tope',                        /else if \(filas\.length > t\) \{/, 'else if (false) {'],
  ['M153 el tope no dice cómo subirlo',                 /'\. Si de verdad son todas, pídelo con --tope=' \+ filas\.length/, "''"],
  ['M154 un archivo vacío se corre igual',              /if \(!\(filas \|\| \[\]\)\.length\) problemas\.push/, 'if (false) problemas.push'],
  ['M155 el tope por omisión se vuelve enorme',         /const TOPE_LOTE = 50;/, 'const TOPE_LOTE = 100000;'],
  ['M156 una ya confirmada detiene el lote',            /if \(esConfirmada\(doc\)\) \{\n    const det =/, 'if (false) {\n    const det ='],
  ['M157 cualquier problema se salta en vez de detener', /if \(!plan\.ok\) return \{ accion: 'detener', motivo: plan\.problemas\.join\(' · '\) \};/, "if (!plan.ok) return { accion: 'saltar', motivo: plan.problemas.join(' · ') };"],
  ['M158 el lote confirma lo despachado y no lo del archivo', /const plan = planDeConfirmacion\(doc, cantidad, usersId, origen\);/, 'const plan = planDeConfirmacion(doc, ((doc.formDdetalles || [])[0] || {}).despachado, usersId, origen);'],
  ['M160 el índice apila las filas sin folio bajo una clave', /if \(!f\) return;\n    if \(!ix\[f\]\) ix\[f\] = \[\];/, 'if (!ix[f]) ix[f] = [];'],
  ['M161 un folio duplicado en el histórico se escribe igual', /if \(filas\.length > 1\) return \{ id: null/, 'if (false) return { id: null'],
  ['M162 un folio ausente no se distingue de uno hallado', /if \(!filas\.length\) return \{ id: null, motivo: 'no aparece/, "if (false) return { id: null, motivo: 'no aparece"],
  ['M163 un registro sin formHeaderiD pasa',            /if \(!id\) return \{ id: null, motivo: 'el registro no trae formHeaderiD' \};/, ''],
  ['M164 la búsqueda no corta aunque estén todos',      /if \(!quedan\) break;/, ''],
  ['M165 la búsqueda corta en el primer tramo',         /if \(!quedan\) break;/, 'break;'],
  ['M166 no se dice cuáles folios faltaron',            /return \{ indice: ix, total: total, faltan: Object\.keys\(faltan\) \};/, 'return { indice: ix, total: total, faltan: [] };'],
  ['M167 el resumen no marca dónde se detuvo',          /else if \(x\.accion === 'detener'\) r\.detenido = x;/, ''],
  ['M169 --lote no se lee de los argumentos',           /else if \(x\.indexOf\('--lote='\) === 0\) a\.lote = x\.slice\(7\);/, ''],
  ['M140 no avisa si se vació una colección',          /return \(a\.length \|\| 0\) > 0 && \(d\.length \|\| 0\) === 0;/, 'return false;'],
  ['M141 avisa de las que ya estaban vacías',          /return \(a\.length \|\| 0\) > 0 && \(d\.length \|\| 0\) === 0;/, 'return (d.length || 0) === 0;'],
  ['M142 no revisa el transporte',                     /const COLECCIONES_HIJAS = \['formDregistros', 'formDtransportes'/, "const COLECCIONES_HIJAS = ['formDregistros'"],
  ['M143 la marca por omisión vuelve a la que no prepara', /process\.env\.REDLINK_ORIGEN \|\| 'CONFIRMAVER2'\)\.trim\(\) \|\| 'CONFIRMAVER2'/, "process.env.REDLINK_ORIGEN || 'M3LINK').trim() || 'M3LINK'"],
  ['M110 propone confirmar lo que ya está confirmado', /if \(!ETAPAS_CONFIRMABLES\.some\(re => re\.test\(String\(etapa\)\)\)\) return;/, ''],
  ['M111 propone transferencias que no van a Walmart', /if \(!\/walmart\/i\.test\(String\(campoFila\(f, 'destino'\) \|\| ''\)\)\) return;/, ''],
  ['M112 una fila sin etapa se descarta en silencio',  /if \(etapa === null\) \{ sinEtapa\+\+; return; \}/, 'if (etapa === null) { return; }'],
  ['M113 sólo prueba el primer nombre de cada campo',  /for \(let i = 0; i < nombres\.length; i\+\+\) \{/, 'for (let i = 0; i < 1; i++) {'],
  ['M114 un campo vacío se toma por presente',         /if \(v !== undefined && v !== null && String\(v\)\.trim\(\) !== ''\) return v;/, 'if (v !== undefined) return v;'],
  ['M115 la basura del listado revienta la búsqueda',  /if \(!f \|\| typeof f !== 'object'\) return;/, ''],
  ['M116 baja todos los tramos aunque ya tenga',       /if \(acum\.length >= meta\) break;/, ''],
  ['M116b entrega la lista entera sin recortar',        /candidatos: acum\.slice\(0, meta\), hay: acum\.length/, 'candidatos: acum, hay: acum.length'],
  ['M116c el total visto se pierde',                   /hay: acum\.length, total: total,/, 'hay: 0, total: total,'],
  ['M117 corta en el primer tramo tenga o no',         /if \(acum\.length >= meta\) break;/, 'break;'],
  ['M118 no acumula: se queda con el último tramo',    /acum = acum\.concat\(r\.candidatos\);/, 'acum = r.candidatos;'],
  ['M119 no cuenta las filas ilegibles de cada tramo', /sinEtapa \+= r\.sinEtapa;/, ''],
  ['M120 --candidatos baja 30 días por omisión',       /return \(a && a\.diasExplicito\) \? a\.dias : DIAS_CANDIDATOS;/, 'return a.dias;'],
  ['M120b la ventana corta se vuelve larga',           /const DIAS_CANDIDATOS = '3';/, "const DIAS_CANDIDATOS = '30';"],
  ['M121 --dias explícito se ignora',                  /\{ a\.dias = x\.slice\(7\); a\.diasExplicito = true; \}/, '{ a.dias = x.slice(7); }'],
  // El mecanismo de verdad: la URL que prepara y el cuerpo que se devuelve.
  ['M80 la URL confirma lo despachado y no lo pedido',  /url = urlConfirmar\(doc\.folio, n, firma, origen \|\| ORIGEN\);/, 'url = urlConfirmar(doc.folio, desp, firma, origen || ORIGEN);'],
  ['M80b la marca pedida se ignora',                   /url = urlConfirmar\(doc\.folio, n, firma, origen \|\| ORIGEN\);/, 'url = urlConfirmar(doc.folio, n, firma, ORIGEN);'],
  // El diff del preparado: es el instrumento con el que se mide qué hace el servidor.
  ['M130 el diff sólo mira los campos conocidos',      /if \(JSON\.stringify\(x\) === JSON\.stringify\(y\)\) return;/, 'if (true) return;'],
  ['M131 el diff ignora los campos que sólo están en uno', /\[a, b\]\.forEach\(function \(o\) \{/, '[a].forEach(function (o) {'],
  ['M132 el diff no baja a la línea de detalle',        /if \(da \|\| db\) \{/, 'if (false) {'],
  ['M133 un campo ausente se confunde con uno vacío',   /if \(v === undefined\) return '\(sin el campo\)';/, ''],
  ['M134 los valores largos se imprimen enteros',       /return t\.length > 160 \? t\.slice\(0, 160\) \+ '…' : t;/, 'return t;'],
  ['M81 la URL va sin el usuario que firma',            /'\/original\/' \+ o \+ '\/usuarioconfirma\/' \+ u;/, "'/original/' + o;"],
  ['M82 el folio de la URL no se valida',               /if \(!\/\^\\d\+\$\/\.test\(f\)\) throw new Error/, 'if (false) throw new Error'],
  ['M83 la cantidad de la URL no se valida',            /if \(!\/\^\\d\+\$\/\.test\(c\)\) throw new Error/, 'if (false) throw new Error'],
  ['M84 el usersiD de la URL no se valida',             /if \(!\/\^\\d\+\$\/\.test\(u\)\) throw new Error/, 'if (false) throw new Error'],
  ['M85 la marca de origen admite cualquier cosa',      /if \(!\/\^\[A-Za-z0-9_-\]\+\$\/\.test\(o\)\) throw new Error/, 'if (false) throw new Error'],
  ['M86 el plan vuelve a armar un cuerpo a mano',       /usersId: firma,/, "usersId: firma, cuerpo: { formHeaderiD: doc.formHeaderiD, avanzaEtapa: true },"],
  ['M87 se puede pedir sin saber a nombre de quién',    /if \(!\(firma > 0\)\) problemas\.push/, 'if (false) problemas.push'],
  ['M88 un folio cruzado en el preparado se deja pasar', /if \(String\(doc\.folio\) !== String\(folio\)\) \{/, 'if (false) {'],
  ['M89 la recepción preparada no se coteja',           /else if \(Number\(det\[0\]\.recepcion\) !== Number\(cantidad\)\) \{/, 'else if (false) {'],
  ['M90 un error dentro de un 200 se toma por documento', /&& !Array\.isArray\(doc\) && doc\.error\) \{/, '&& !Array.isArray(doc) && false) {'],
  ['M91 un cuerpo vacío del preparador pasa',           /if \(!crudo\.trim\(\)\) return \{ ok: false, problemas: \['el servidor devolvió el cuerpo vacío'\], doc: null \};/, ''],
  ['M92 el preparado no dice qué firma trae',           /firma: firmaDe\(doc\) \};/, "firma: { id: null, nombre: '' } };"],
  // A quién firmar, preguntado por nombre.
  ['M93 el nombre de usuario entra crudo a la URL',     /if \(!RE_NOMBRE_USUARIO\.test\(n\)\) \{/, 'if (false) {'],
  ['M94 un nombre vacío arma la ruta igual',            /if \(!n\) throw new Error\('falta el nombre de usuario'\);/, ''],
  ['M95 el preparado se pide con el usuario de lectura', /const r = await p\(ruta, \{ method: 'GET' \}, 'escritura'\);\n  if \(r\.status !== 401/, "const r = await p(ruta, { method: 'GET' }, 'lectura');\n  if (r.status !== 401"],
  ['M96 cualquier error reintenta con otro usuario',    /if \(r\.status !== 401 && r\.status !== 403\) return/, 'if (r.status === 200) return'],
  ['M97 no se avisa que se usó el usuario de lectura',  /\{ conLectura: true, statusEscritura: r\.status \}/, '{ conLectura: false, statusEscritura: r.status }'],
  ['M98 un HTTP del resolver se lee como "no existe"',  /if \(r\.status !== 200\) \{\n    return \{ ok: false, id: null, nombre: '', problemas: \['HTTP '/, "if (false) {\n    return { ok: false, id: null, nombre: '', problemas: ['HTTP '"],
  ['M99 el error del resolver sale sin enmascarar',     /' · ' \+ sonda\.enmascarar\(String\(r\.texto\)\)\.slice\(0, 200\)/, "' · ' + String(r.texto).slice(0, 200)"],
  ['M100 con varios usuarios elige el primero',         /if \(elegidos\.length > 1\) \{/, 'if (false) {'],
  ['M101 el nombre que vuelve no se compara',           /if \(pedido && encontrado\.toLowerCase\(\) !== pedido\) \{/, 'if (false) {'],
  ['M102 la coincidencia exacta no tiene prioridad',    /const elegidos = exactos\.length \? exactos : conId;/, 'const elegidos = conId;'],
  ['M103 un usersiD cero se toma por válido',           /const conId = lista\.filter\(x => Number\(x\.usersiD\) > 0\);/, 'const conId = lista.slice();'],
  ['M104 la contradicción de números se resuelve a ojo', /if \(Number\(resuelto\.id\) !== Number\(configurado\)\) \{/, 'if (false) {'],
  ['M105 un número sin verificar se canta como verificado', /dice: 'no se pudo verificar por API \('/, "verificado: true, dice: 'no se pudo verificar por API ('"],
  ['M106 el veredicto juzga contra el configurado y no contra el mandado', /const esp = \(esperado === undefined \|\| esperado === null\) \? USERSID_M3LINK : Number\(esperado\);/, 'const esp = USERSID_M3LINK;'],
  ['M67 el tramo de un dia se sigue partiendo',       /if \(largo <= 1\) return null;/, 'if (largo <= 0) return null;'],
  ['M68 las mitades se solapan',                      /const sig = new Date\(d0\.getTime\(\) \+ mitad \* dia\)/, 'const sig = new Date(d0.getTime() + (mitad - 1) * dia)'],
  ['M69 las mitades dejan un hueco',                  /const corte = new Date\(d0\.getTime\(\) \+ \(mitad - 1\) \* dia\)/, 'const corte = new Date(d0.getTime() + (mitad - 2) * dia)'],
  ['M70 se parte ante cualquier error, no solo tiempo', /const esCorteDeTiempo = \(x\) => RE_TIEMPO\.test\(String\(\(x && x\.message\) \|\| x \|\| ''\)\);/, 'const esCorteDeTiempo = () => true;'],
  ['M71 no se reconoce ningun corte de tiempo',        /const esCorteDeTiempo = \(x\) => RE_TIEMPO/, 'const esCorteDeTiempo = (x) => !RE_TIEMPO'],
  ['M72 el tramo partido devuelve solo una mitad',     /for \(const m of mitades\) out = out\.concat\(await traer\(m, avisarCorte\)\);/, 'out = await traer(mitades[0], avisarCorte);'],
  ['M73 el corte en un dia devuelve vacio en silencio', /throw new Error\('El histórico se cortó por tiempo y el tramo ya es de UN día/, "return []; throw new Error('El histórico se cortó por tiempo y el tramo ya es de UN día"],
  ['M74 el aviso del corte se pierde',                 /if \(avisarCorte\) avisarCorte\(\{ tramo: t, motivo: motivo, mitades: mitades \}\);/, ''],
  ['M57 el troceo va del mas viejo al mas nuevo',     /out\.push\(\{ desde: atras\(ini\), hasta: atras\(fin\) \}\);/, 'out.unshift({ desde: atras(ini), hasta: atras(fin) });'],
  ['M58 los tramos se pisan entre si',                /const ini = Math\.min\(fin \+ p - 1, total - 1\);/, 'const ini = Math.min(fin + p, total - 1);'],
  ['M59 el troceo deja huecos',                       /for \(let fin = 0; fin < total; fin \+= p\)/, 'for (let fin = 0; fin < total; fin += p + 1)'],
  ['M60 se baja todo de una, sin trocear',            /const p = Math\.max\(1, parseInt\(paso, 10\) \|\| 7\);/, 'const p = total;'],
  ['M61 el paso por omision se va a 31 dias',         /parseInt\(paso, 10\) \|\| 7\);/, 'parseInt(paso, 10) || 31);'],
  ['M64 el aviso por tramo se pierde',                /if \(alTramo\) alTramo\(\{ i: i \+ 1, de: lista\.length/, 'if (false) alTramo({ i: i + 1, de: lista.length'],
  ['M65 el total cuenta tramos y no registros',       /total \+= arr\.length;/, 'total += 1;'],
  ['M66 el folio se compara por tipo',                /String\(x && x\.folio\) === String\(folio\)/, '(x && x.folio) === folio'],
  ['M62 sigue bajando tramos despues de encontrarlo', /if \(filas\.length\) return \{ filas: filas, desde: t\.desde, hasta: t\.hasta,/, 'if (false) return { filas: filas, desde: t.desde, hasta: t.hasta,'],
  ['M63 el troceo no acepta texto',                   /parseInt\(dias, 10\) \|\| 30\);/, 'dias || 30);'],
  ['M45 el numero de M3LinkSystem cambia',            /parseInt\(process\.env\.REDLINK_M3LINK_USERSID \|\| '983', 10\)/, "parseInt(process.env.REDLINK_M3LINK_USERSID || '951', 10)"],
  ['M34 el corte de descarga se tapa como vacío',     /if \(r\.falloCuerpo\) \{/, 'if (false) {'],
  ['M35 el corte no dice qué falló',                  /'la descarga se CORTÓ a mitad de camino: ' \+ r\.falloCuerpo,/, "'la descarga se CORTÓ a mitad de camino',"],
  ['M36 el content-length deja de mirarse',           /if \(declarado && declarado !== '0'\) \{/, 'if (false) {'],
  ['M37 un cuerpo perdido se da por vacío legítimo',  /'pero declaró content-length ' \+ declarado \+ ': el cuerpo se perdió, no vino vacío'/, "'vacío'"],
  ['M38 lo que no es JSON no se muestra',             /'primeros bytes: ' \+ sonda\.enmascarar\(String\(r\.texto\)\)\.slice\(0, 200\)/, "'primeros bytes: (omitido)'"],
  ['M39 los primeros bytes salen sin enmascarar',     /'primeros bytes: ' \+ sonda\.enmascarar\(String\(r\.texto\)\)/, "'primeros bytes: ' + String(r.texto)"],
  ['M40 el cuerpo se vuelve a tragar',                /catch \(e\) \{ falloCuerpo = \(e && e\.message\) \? e\.message : String\(e\); \}/, 'catch (e) { falloCuerpo = null; }'],
  ['M30 la firma lee el campo que no es',             /const n = Number\(doc\.usuarioIngresoId\);/, 'const n = Number(doc.usuarioConfirmaId);'],
  ['M31 un cero pasa como usuario',                   /id: Number\.isFinite\(n\) && n > 0 \? n : null,/, 'id: Number.isFinite(n) ? n : null,'],
  ['M32 la firma vuelve sin nombre',                  /nombre: String\(doc\.usuarioIngresoNombre \|\| ''\)\.trim\(\),/, "nombre: '',"],
  ['M33 un documento nulo revienta en vez de avisar', /if \(!doc \|\| typeof doc !== 'object'\) return \{ id: null, nombre: '', confirmaId: null \};/, ''],
  ['M01 acepta el usuario de lectura como firmante',  /if \(u && lectura && u\.toLowerCase\(\) === lectura\.toLowerCase\(\)\) \{/, 'if (false) {'],
  ['M02 la comparación de usuarios distingue mayúsculas', /u\.toLowerCase\(\) === lectura\.toLowerCase\(\)/, 'u === lectura'],
  ['M03 no exige las credenciales',                   /if \(!v \|\| !String\(v\)\.trim\(\)\) problemas\.push\('falta ' \+ k\);/, ''],
  ['M23 no exige las credenciales de lectura',        /'REDLINK_CLIENT_SECRET', 'REDLINK_USER', 'REDLINK_PASS',\n   'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'/, "'REDLINK_CLIENT_SECRET', 'REDLINK_M3LINK_USER', 'REDLINK_M3LINK_PASS'"],
  ['M25 confirma desde cualquier etapa pendiente',    /else if \(!etapaConfirmable\(doc\)\) problemas\.push/, 'else if (false) problemas.push'],
  ['M26 cualquier etapa se da por confirmable',       /const ETAPAS_CONFIRMABLES = \[[^\]]*\];/, 'const ETAPAS_CONFIRMABLES = [/./];'],
  ['M26b se pierde la 43, que es la mayoria del dia',  /, \/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, ']'],
  ['M26c se pierde la 44',                             /\[\/pendiente\\s\+de\\s\+confirmaci\/i, /, '['],
  ['M26d basta con que la etapa diga "pendiente"',     /\/pendiente\\s\+adjuntar\\s\+respaldo\/i\]/, '/pendiente/i]'],
  ['M24 escribe con el usuario de lectura',           /escritura: \{ u: 'REDLINK_M3LINK_USER', p: 'REDLINK_M3LINK_PASS'/, "escritura: { u: 'REDLINK_USER', p: 'REDLINK_PASS'"],
  ['M04 no detecta marcadores pegados',               /else if \(\/\[<>\]\/\.test\(String\(v\)\)\)/, 'else if (false)'],
  ['M05 confirma cualquier tipo de formulario',       /if \(Number\(doc\.formId\) !== 6\)/, 'if (false)'],
  ['M06 confirma a destinos que no son Walmart',      /if \(!\/walmart\/i\.test\(destino\)\)/, 'if (false)'],
  ['M07 confirma una ya confirmada',                  /if \(esConfirmada\(doc\)\) problemas\.push\('la transferencia YA está confirmada'\);/, ''],
  ['M08 la etapa deja de pesar en "confirmada"',      /return n > 0 && !\/\^\\s\*pendiente\/i\.test\(String\(\(doc && doc\.formMetapa && doc\.formMetapa\.nombre\) \|\| ''\)\);/, 'return n > 0;'],
  ['M09 confirma más de lo despachado',               /else if \(n > desp\) problemas\.push/, 'else if (false) problemas.push'],
  ['M10 acepta cantidades en cero o negativas',       /if \(!Number\.isFinite\(n\) \|\| n <= 0\)/, 'if (!Number.isFinite(n))'],
  ['M11 confirma sin cantidad despachada',            /else if \(!desp\) problemas\.push/, 'else if (false) problemas.push'],
  ['M12 confirma documentos con varias líneas',       /if \(det\.length !== 1\)/, 'if (false)'],
  ['M13 corta en el primer problema',                 /if \(problemas\.length\) return \{ ok: false, problemas: problemas \};/, 'if (problemas.length) return { ok: false, problemas: [problemas[0]] };'],
  ['M16 la comparación ignora los campos de estado',  /const CAMPOS_ESTADO = \['formMetapaId', 'avanzaEtapa', 'fechaConfirmacion', 'confirmacionVeces', 'usuarioConfirmaId'\];/, 'const CAMPOS_ESTADO = [];'],
  ['M17 la comparación ignora la línea',              /\['despachado', 'recepcion'\]\.forEach/, '[].forEach'],
  ['M18 la comparación ignora el nombre de la etapa', /if \(ea !== ed\) out\.push\(\{ campo: 'etapa', antes: ea, despues: ed \}\);/, ''],
  ['M19 null y cero se confunden al comparar',        /if \(JSON\.stringify\(a\) !== JSON\.stringify\(b\)\) out\.push\(\{ campo: 'detalle\.' \+ k/, 'if (a != b) out.push({ campo: \'detalle.\' + k'],
  ['M20 --productivo queda prendido por omisión',     /const a = \{ productivo: false,/, 'const a = { productivo: true,'],
  ['M21 --si queda prendido por omisión',             /folio: null, cantidad: null, si: false,/, 'folio: null, cantidad: null, si: true,'],
  ['M22 la fecha va en ISO y no en el formato de Redlink', /return p\[1\] \+ '-' \+ p\[2\] \+ '-' \+ p\[0\];/, "return p[0] + '-' + p[1] + '-' + p[2];"]
];

// Cada mutación se aplica al archivo donde vive ese código: primero se prueba
// en el script y, si no está ahí, en el núcleo. Que una mutación no aparezca en
// NINGUNO de los dos sigue siendo un NO APLICA y sigue siendo un fallo: quiere
// decir que el código que decía proteger ya no existe con esa forma.
async function mutar() {
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    let fuente = FUENTE, fuenteN = FUENTE_N, mutado;
    if (busca.test(FUENTE)) {
      mutado = FUENTE.replace(busca, pone);
      if (mutado === FUENTE) { noAplican.push(nombre); continue; }
      fuente = mutado;
    } else if (busca.test(FUENTE_N)) {
      mutado = FUENTE_N.replace(busca, pone);
      if (mutado === FUENTE_N) { noAplican.push(nombre); continue; }
      fuenteN = mutado;
    } else { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(cargar(fuente, fuenteN)); } catch (e) { muertas++; continue; }
    if (r.fallos.length) muertas++; else vivas.push(nombre);
  }
  return { vivas, muertas, noAplican, total: MUTACIONES.length };
}

(async function () {
  const S = require(RUTA);
  const r = await correr(S);
  console.log('\nPruebas: ' + r.ok + ' pasan, ' + r.fallos.length + ' fallan');
  for (const f of r.fallos) console.log('  FALLA ' + f);
  if (!r.fallos.length || process.argv.indexOf('--mutaciones') >= 0) {
    const m = await mutar();
    console.log('\nMutaciones: ' + m.muertas + ' de ' + m.total + ' mueren');
    for (const n of m.noAplican) console.log('  NO APLICA  ' + n);
    for (const n of m.vivas)     console.log('  SOBREVIVE  ' + n);
    if (m.vivas.length || m.noAplican.length) process.exit(1);
  }
  process.exit(r.fallos.length ? 1 : 0);
})();
