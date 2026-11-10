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

function cargar(fuente) {
  const m = new Module(RUTA, null);
  m.filename = RUTA;
  m.paths = Module._nodeModulePaths(path.dirname(RUTA));
  m._compile(fuente, RUTA);
  return m.exports;
}

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
  // El mecanismo de verdad: la URL que prepara y el cuerpo que se devuelve.
  ['M80 la URL confirma lo despachado y no lo pedido',  /url = urlConfirmar\(doc\.folio, n, firma, ORIGEN\);/, 'url = urlConfirmar(doc.folio, desp, firma, ORIGEN);'],
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

async function mutar() {
  const fuente = fs.readFileSync(RUTA, 'utf8');
  const vivas = [], noAplican = [];
  let muertas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(fuente)) { noAplican.push(nombre); continue; }
    const mutado = fuente.replace(busca, pone);
    if (mutado === fuente) { noAplican.push(nombre); continue; }
    let r;
    try { r = await correr(cargar(mutado)); } catch (e) { muertas++; continue; }
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
