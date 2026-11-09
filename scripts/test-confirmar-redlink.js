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
  prueba('T07 el cuerpo lleva avanzaEtapa y las dos cantidades', () => {
    const c = S.planDeConfirmacion(DOC, 3).cuerpo;
    igual(c.avanzaEtapa, true);
    igual(c.formDdetalles[0].despachado, 3);
    igual(c.formDdetalles[0].recepcion, 3);
    igual(c.formHeaderiD, 684100);
    igual(c.formMetapaId, 44, 'la etapa leída va en el cuerpo, contra el control de concurrencia');
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
  prueba('T10q el cuerpo del PATCH lleva la firma de M3LinkSystem', () => {
    // Sin esto la confirmación queda a nombre de quien tocó el documento antes
    // y nadie se entera de que la hizo el m3link.
    const plan = S.planDeConfirmacion(DOC, 3);
    cierto(plan.ok, (plan.problemas || []).join(' · '));
    igual(plan.cuerpo.usuarioIngresoId, S.USERSID_M3LINK);
    cierto(S.USERSID_M3LINK > 0, 'tiene que haber un número');
  });
  prueba('T10r sin usersiD el plan se NIEGA: mejor no escribir que no firmar', () => {
    cierto(tiene(S.planDeConfirmacion(DOC, 3, 0).problemas, 'sin firma'),
      'tiene que negarse cuando no hay a nombre de quién firmar');
    cierto(S.planDeConfirmacion(DOC, 3, 983).ok, 'con firma sí procede');
    // Sin pasar nada cae en el número configurado, que es el camino normal.
    igual(S.planDeConfirmacion(DOC, 3).cuerpo.usuarioIngresoId, S.USERSID_M3LINK);
    igual(S.planDeConfirmacion(DOC, 3, null).cuerpo.usuarioIngresoId, S.USERSID_M3LINK);
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
  prueba('T10v --sin-firma saca la firma del cuerpo y NO se queja', () => {
    // El experimento es justamente mandar sin firma: si el plan se negara,
    // no habría forma de aislar la variable.
    const plan = S.planDeConfirmacion(DOC, 3, null, { sinFirma: true });
    cierto(plan.ok, (plan.problemas || []).join(' · '));
    igual(plan.cuerpo.usuarioIngresoId, DOC.usuarioIngresoId,
      'sin firma el cuerpo devuelve la que ya tenía el documento');
    igual(plan.cuerpo.avanzaEtapa, true, 'pero sigue pidiendo avanzar');
  });
  prueba('T10w --sin-avanzar deja la firma y saca el avance', () => {
    const plan = S.planDeConfirmacion(DOC, 3, null, { sinAvanzar: true });
    cierto(plan.ok, (plan.problemas || []).join(' · '));
    igual(plan.cuerpo.usuarioIngresoId, S.USERSID_M3LINK, 'la firma se mantiene');
    igual(plan.cuerpo.avanzaEtapa, false);
  });
  prueba('T10x sin banderas el cuerpo lleva las dos cosas', () => {
    const plan = S.planDeConfirmacion(DOC, 3);
    igual(plan.cuerpo.usuarioIngresoId, S.USERSID_M3LINK);
    igual(plan.cuerpo.avanzaEtapa, true);
  });
  prueba('T10y las dos banderas juntas sacan las dos variables', () => {
    const plan = S.planDeConfirmacion(DOC, 3, null, { sinFirma: true, sinAvanzar: true });
    cierto(plan.ok);
    igual(plan.cuerpo.avanzaEtapa, false);
    igual(plan.cuerpo.usuarioIngresoId, DOC.usuarioIngresoId);
  });
  prueba('T10z las banderas se leen de la línea de comandos', () => {
    const a = S.leerArgs(['--productivo', '--folio=1', '--cantidad=2', '--sin-firma']);
    igual([a.sinFirma, a.sinAvanzar], [true, false]);
    const b = S.leerArgs(['--productivo', '--folio=1', '--cantidad=2', '--sin-avanzar']);
    igual([b.sinFirma, b.sinAvanzar], [false, true]);
    const c = S.leerArgs(['--productivo', '--folio=1', '--cantidad=2']);
    igual([c.sinFirma, c.sinAvanzar], [false, false]);
  });
  prueba('T11a --sin-firma NO dice que el documento queda a medio camino', () => {
    // Salió en producción: la continuación del aviso de --sin-avanzar estaba
    // fuera de su if y se imprimía siempre. Con --sin-firma la etapa SÍ avanza
    // y la confirmación queda completa; decir lo contrario asusta justo cuando
    // hay que decidir si disparar.
    const l = S.avisosDeAislamiento({ sinFirma: true }, 'Eliecer_Baeza').join(' ');
    cierto(/COMPLETA/.test(l), l);
    cierto(/Eliecer_Baeza/.test(l), 'tiene que decir a nombre de quién queda');
    falso(/MEDIO CAMINO/i.test(l), 'esa frase es de la otra bandera: ' + l);
  });
  prueba('T11b --sin-avanzar SÍ avisa que queda a medio camino', () => {
    const l = S.avisosDeAislamiento({ sinAvanzar: true }, 'Eliecer_Baeza').join(' ');
    cierto(/MEDIO CAMINO/i.test(l), l);
    falso(/COMPLETA/.test(l), 'esa no completa nada');
  });
  prueba('T11c sin banderas no se avisa nada', () => {
    igual(S.avisosDeAislamiento({}, 'x'), []);
    igual(S.avisosDeAislamiento(null, 'x'), []);
  });
  prueba('T11d con las dos banderas salen los dos avisos, cada uno entero', () => {
    const l = S.avisosDeAislamiento({ sinFirma: true, sinAvanzar: true }, 'Eliecer_Baeza');
    igual(l.length, 4);
    cierto(/COMPLETA/.test(l.join(' ')));
    cierto(/MEDIO CAMINO/i.test(l.join(' ')));
  });
  prueba('T11e sin nombre anterior no inventa uno', () => {
    cierto(/\(el anterior\)/.test(S.avisosDeAislamiento({ sinFirma: true }, '').join(' ')));
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
  ['M53 el aviso de medio camino vuelve a salir siempre', /if \(a && a\.sinAvanzar\) \{/, 'if (true) {'],
  ['M54 --sin-firma no avisa a nombre de quién queda',    /out\.push\('      pero a nombre de "' \+ \(nombreActual \|\| '\(el anterior\)'\) \+ '"'\);/, ''],
  ['M55 --sin-firma no avisa nada',                       /if \(a && a\.sinFirma\) \{/, 'if (false) {'],
  ['M56 el aviso de --sin-firma dice que queda incompleta', /la confirmación queda COMPLETA/, 'el documento queda A MEDIO CAMINO'],
  ['M46 --sin-firma igual manda la firma',            /const firma = o\.sinFirma \? 0/, 'const firma = false ? 0'],
  ['M47 --sin-avanzar igual pide avanzar',            /const avanzar = !o\.sinAvanzar;/, 'const avanzar = true;'],
  ['M48 --sin-avanzar nunca pide avanzar',            /const avanzar = !o\.sinAvanzar;/, 'const avanzar = false;'],
  ['M49 --sin-firma se queja y no deja aislar',       /if \(!o\.sinFirma && !\(firma > 0\)\)/, 'if (!(firma > 0))'],
  ['M50 el cuerpo ignora la bandera de avance',       /avanzar: avanzar, usuario: firma/, 'avanzar: true, usuario: firma'],
  ['M51 --sin-firma no se lee de los argumentos',     /else if \(x === '--sin-firma'\) a\.sinFirma = true;/, ''],
  ['M52 --sin-avanzar no se lee de los argumentos',   /else if \(x === '--sin-avanzar'\) a\.sinAvanzar = true;/, ''],
  ['M41 el cuerpo va sin firma',                      /avanzar: avanzar, usuario: firma \}\)/, 'avanzar: avanzar })'],
  ['M42 se escribe aunque no haya a quién firmar',    /if \(!o\.sinFirma && !\(firma > 0\)\) problemas\.push/, 'if (false) problemas.push'],
  ['M42b la firma inyectada se ignora',               /\(\(usersId === undefined \|\| usersId === null\) \? USERSID_M3LINK : Number\(usersId\)\);/, 'USERSID_M3LINK;'],
  ['M43 la firma se juzga sólo por el número',        /if \(f\.id === USERSID_M3LINK && f\.nombre\.toLowerCase\(\) === NOMBRE_M3LINK\.toLowerCase\(\)\)/, 'if (f.id === USERSID_M3LINK)'],
  ['M44 la firma se da por buena siempre',            /function veredictoDeFirma\(docDespues\) \{\n  const f = firmaDe\(docDespues\);/, "function veredictoDeFirma(docDespues) {\n  return { ok: true, dice: 'ok' };\n  const f = firmaDe(docDespues);"],
  ['M45 el numero de M3LinkSystem cambia',            /parseInt\(process\.env\.REDLINK_M3LINK_USERSID \|\| '983', 10\)/, "parseInt(process.env.REDLINK_M3LINK_USERSID || '951', 10)"],
  ['M34 el corte de descarga se tapa como vacío',     /if \(r\.falloCuerpo\) \{/, 'if (false) {'],
  ['M35 el corte no dice qué falló',                  /'la descarga se CORTÓ a mitad de camino: ' \+ r\.falloCuerpo,/, "'la descarga se CORTÓ a mitad de camino',"],
  ['M36 el content-length deja de mirarse',           /if \(declarado && declarado !== '0'\) \{/, 'if (false) {'],
  ['M37 un cuerpo perdido se da por vacío legítimo',  /'pero declaró content-length ' \+ declarado \+ ': el cuerpo se perdió, no vino vacío'/, "'vacío'"],
  ['M38 lo que no es JSON no se muestra',             /'primeros bytes: ' \+ sonda\.enmascarar\(String\(r\.texto\)\)\.slice\(0, 200\)/, "'primeros bytes: (omitido)'"],
  ['M39 los primeros bytes salen sin enmascarar',     /sonda\.enmascarar\(String\(r\.texto\)\)\.slice\(0, 200\)/, 'String(r.texto).slice(0, 200)'],
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
  ['M14 el cuerpo no pide avanzar de etapa',          /const avanzar = !o\.sinAvanzar;/, 'const avanzar = Boolean(o.sinAvanzar);'],
  ['M15 el cuerpo no escribe la recepción',           /despachado: true, recepcion: true,/, 'despachado: true, recepcion: false,'],
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
