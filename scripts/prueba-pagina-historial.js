#!/usr/bin/env node
// ============================================================================
//  scripts/prueba-pagina-historial.js
//
//  Prueba de navegador de historial-confirmaciones.html: sin red real, el
//  /api/confirmaciones-historial se intercepta y contesta a propósito.
//
//  Lo que mira que ninguna prueba de lógica puede mirar: que el calendario
//  caiga en el día correcto, que el color diga la magnitud, que un clic filtre
//  de verdad, que la alarma de pendientes se vea al ABRIR (sin cruzar nada) y
//  que la pestaña de trazabilidad encuentre un pedido y muestre el desajuste.
// ============================================================================
'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  FALLA ' + m); } else console.log('  ok   ' + m); };

const reg = (dia, clase, cantidad, cliente, dif, extra) => Object.assign({
  dia: dia, ts: dia + 'T10:00:00.000Z', clase: clase, cantidad: cantidad,
  diferencia: dif === undefined ? 0 : dif, folio: 4149000 + Math.round(Math.random() * 900),
  quien: 'ana@redtecsa.com',
  reporte: { razonSocial: cliente, rut: '77643296-2', cita: '42759276', po: '2851158713' },
  redlink: { cliente: cliente, bodega: 'ZWM01', despachado: cantidad - (dif || 0), recepcion: cantidad }
}, extra || {});

// Las mismas agregaciones del api, para que la respuesta de mentira sea
// realista: si acá se calcularan distinto, la prueba no diría nada.
const registro = require(path.join(RAIZ, 'api', 'shared', 'confirmaciones-registro.js'));

(async () => {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const f = path.join(RAIZ, u === '/' ? 'historial-confirmaciones.html' : u);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': u.endsWith('.js') ? 'text/javascript' : 'text/html' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('');
  }).listen(8893);

  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const pedidos = [];
  let REGISTROS = [];
  let ALMACEN = true;
  let HTTP = 200;

  await pg.route('**/api/confirmaciones-historial*', async (route) => {
    const url = new URL(route.request().url());
    pedidos.push([url.searchParams.get('desde'), url.searchParams.get('hasta')]);
    if (HTTP !== 200) return route.fulfill({ status: HTTP, contentType: 'application/json',
                                             body: JSON.stringify({ error: 'no' }) });
    const dentro = REGISTROS.filter(r => r.dia >= url.searchParams.get('desde') &&
                                         r.dia <= url.searchParams.get('hasta'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      almacenamiento: ALMACEN, desde: url.searchParams.get('desde'), hasta: url.searchParams.get('hasta'),
      registros: dentro, dias: registro.porDia(dentro), clientes: registro.porCliente(dentro),
      aviso: ALMACEN ? undefined : 'el api no tiene almacenamiento configurado'
    }) });
  });

  // ── el api de pendientes, para la alarma ────────────────────────────────
  let PEND = { almacenamiento: true, diasParaPreguntar: 7, abiertas: 0, pallets: 0,
               urgentes: 0, citas: [], clientes: [] };
  let PEND_HTTP = 200;
  let pedidosPend = 0;
  await pg.route('**/api/pendientes-cruce*', async (route) => {
    pedidosPend++;
    if (PEND_HTTP !== 200) return route.fulfill({ status: PEND_HTTP, contentType: 'application/json',
                                                  body: JSON.stringify({ error: 'no' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PEND) });
  });

  // ── el api de trazabilidad ──────────────────────────────────────────────
  let TRAZA = null;
  let TRAZA_HTTP = 200;
  const consultas = [];
  await pg.route('**/api/trazabilidad*', async (route) => {
    const url = new URL(route.request().url());
    consultas.push({ q: url.searchParams.get('q'), meses: url.searchParams.get('meses') });
    if (TRAZA_HTTP !== 200) return route.fulfill({ status: TRAZA_HTTP, contentType: 'application/json',
                                                   body: JSON.stringify({ error: 'busca un número de pedido, una cita o un PO' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRAZA) });
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 7);
  REGISTROS = [
    reg(mes + '-03', 'sin-diferencia', 10, 'NUTRISCO CHILE S. A.'),
    reg(mes + '-03', 'sin-diferencia', 8, 'NUTRISCO CHILE S. A.'),
    reg(mes + '-03', 'recibio-menos', 5, 'ALIMENTOS Y FRUTOS S A', -3),
    reg(mes + '-10', 'sin-diferencia', 7, 'NUTRISCO CHILE S. A.'),
    reg(mes + '-10', 'recibio-mas', 4, 'ALIMENTOS Y FRUTOS S A', 2)
  ];

  await pg.goto('http://127.0.0.1:8893/historial-confirmaciones.html');
  await pg.waitForTimeout(400);

  console.log('\n-- arranca en el mes corriente --');
  ok(pedidos.length === 1, 'un solo pedido al abrir');
  ok(pedidos[0][0] === mes + '-01', 'desde el día 1: ' + pedidos[0][0]);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(pedidos[0][1]), 'hasta el último día: ' + pedidos[0][1]);
  ok((await pg.locator('#rotulo-mes').innerText()).length > 4, 'el rótulo dice el mes');

  console.log('\n-- las cifras --');
  ok(await pg.locator('#c-conf').innerText() === '5', 'cinco confirmaciones');
  ok(await pg.locator('#c-igual').innerText() === '3', 'tres sin diferencia');
  ok(await pg.locator('#c-dif').innerText() === '2', 'dos con diferencia');
  ok(await pg.locator('#c-cli').innerText() === '2', 'dos clientes');

  console.log('\n-- el calendario --');
  const cal = await pg.evaluate((m) => {
    const celdas = [...document.querySelectorAll('#cal .dia')];
    const conDato = celdas.filter(c => c.className.indexOf(' hay') >= 0);
    const d3 = conDato.find(c => c.querySelector('.num').textContent === '3');
    const d10 = conDato.find(c => c.querySelector('.num').textContent === '10');
    return {
      conDato: conDato.length,
      d3: d3 ? { cuenta: d3.querySelector('.cuenta').textContent, clase: d3.className,
                 marca: !!d3.querySelector('.marca') } : null,
      d10: d10 ? { cuenta: d10.querySelector('.cuenta').textContent, clase: d10.className } : null,
      // La primera celda de la malla tiene que ser un LUNES.
      primerEncabezado: document.querySelector('#cal-cab div').textContent,
      celdasMultiploDe7: celdas.length % 7 === 0,
      escala: document.getElementById('escala').textContent
    };
  }, mes);
  ok(cal.conDato === 2, 'dos días pintados: ' + cal.conDato);
  ok(cal.d3 && cal.d3.cuenta === '3', 'el día 3 muestra 3 confirmaciones');
  ok(cal.d10 && cal.d10.cuenta === '2', 'el día 10 muestra 2');
  ok(cal.d3 && cal.d3.marca, 'el día 3 tiene marca de diferencias');
  // 3 confirmaciones es el máximo -> nivel 5; 2 cae más abajo. El color tiene
  // que distinguirlos, o la magnitud no está diciendo nada.
  // El máximo del mes tiene que llegar al paso más claro aunque haya pocos
  // tramos: si no, un mes tranquilo se pinta entero oscuro y se lee como
  // "poco" cuando esos días son el máximo de ese mes.
  ok(cal.d3.clase.indexOf('m5') >= 0, 'el día con más va al paso más claro: ' + cal.d3.clase);
  ok(cal.d10.clase.indexOf('m5') < 0, 'y el de menos no: ' + cal.d10.clase);
  const rampa = await pg.evaluate(() => {
    const p = window.__prueba;
    return { unoSolo: p.pasoDe(1, 1), dos: [p.pasoDe(1, 2), p.pasoDe(2, 2)],
             cinco: [1,2,3,4,5].map(i => p.pasoDe(i, 5)), cero: p.pasoDe(0, 5) };
  });
  ok(rampa.dos[1] === 5 && rampa.dos[0] === 1, 'con dos tramos usa los dos extremos: ' + rampa.dos);
  ok(JSON.stringify(rampa.cinco) === '[1,2,3,4,5]', 'con cinco, uno a uno: ' + rampa.cinco);
  ok(rampa.unoSolo === 3, 'con un solo tramo no afirma un máximo: paso ' + rampa.unoSolo);
  ok(rampa.cero === 0, 'un día sin confirmaciones no entra a la rampa');
  ok(cal.primerEncabezado === 'lun', 'la semana empieza en lunes: ' + cal.primerEncabezado);
  ok(cal.celdasMultiploDe7, 'la malla cierra semanas completas');
  ok(/confirmaciones por día/.test(cal.escala), 'hay leyenda de la escala');

  console.log('\n-- por cliente --');
  const filas = await pg.locator('#tb-cli tbody tr').count();
  ok(filas === 2, 'dos clientes en la tabla: ' + filas);
  const primera = await pg.locator('#tb-cli tbody tr').first().innerText();
  ok(/ALIMENTOS/.test(primera), 'el que tiene diferencias va primero: ' + primera.split('\t')[0]);
  ok((await pg.locator('#tb-cli tbody tr').first().locator('.barra i').count()) >= 1,
     'la fila trae su barra de reparto');
  ok(/sin diferencia/.test(await pg.locator('.leyenda').innerText()), 'hay leyenda de estados');

  console.log('\n-- clic en un día filtra de verdad --');
  await pg.evaluate(() => {
    const d = [...document.querySelectorAll('#cal .dia.hay')]
      .find(c => c.querySelector('.num').textContent === '10');
    d.click();
  });
  await pg.waitForTimeout(150);
  ok(pedidos.length === 1, 'filtrar por día NO vuelve a pedir al api');
  ok((await pg.locator('#card-detalle').isVisible()), 'se abre el detalle');
  const det = await pg.locator('#tb-det tbody tr').count();
  ok(det === 2, 'muestra las 2 citas de ese día: ' + det);
  ok(/del /.test(await pg.locator('#t-clientes').innerText()),
     'y el desglose dice que está filtrado: ' + await pg.locator('#t-clientes').innerText());

  console.log('\n-- el detalle trae lo que no está en Redlink --');
  const fila0 = await pg.locator('#tb-det tbody tr').first().innerText();
  ok(/42759276/.test(fila0), 'la cita');
  ok(/2851158713/.test(fila0), 'el PO');

  console.log('\n-- navegar de mes --');
  await pg.locator('#b-ant').click();
  await pg.waitForTimeout(250);
  ok(pedidos.length === 2, 'el mes anterior sí pide al api');
  ok(pedidos[1][0] < pedidos[0][0], 'y pide un mes antes: ' + pedidos[1][0]);
  ok(await pg.locator('#card-detalle').isHidden(), 'cambiar de mes limpia el filtro de día');
  await pg.locator('#b-hoy').click();
  await pg.waitForTimeout(250);
  ok(await pg.locator('#b-sig').isDisabled(), 'no se puede ir al futuro');

  console.log('\n-- sin almacenamiento lo dice con todas sus letras --');
  ALMACEN = false;
  await pg.locator('#b-ant').click();
  await pg.waitForTimeout(250);
  const av = await pg.locator('#av').innerText();
  ok(/NO se están guardando/.test(av), 'avisa que no se guarda: ' + av);
  ok((await pg.locator('#av').getAttribute('class')).indexOf('err') >= 0, 'y se ve como error');
  ALMACEN = true;

  console.log('\n-- 403 y caída del api --');
  HTTP = 403;
  await pg.locator('#b-ant').click();
  await pg.waitForTimeout(250);
  ok(/permiso/.test(await pg.locator('#av').innerText()), 'el 403 se explica');
  HTTP = 200;

  console.log('\n-- la alarma de pendientes se ve al ABRIR, sin cruzar nada --');
  ok(pedidosPend >= 1, 'la página pide los pendientes sola: ' + pedidosPend + ' vez/veces');
  ok(await pg.locator('#alarma').isHidden(), 'sin citas abiertas la banda no molesta');

  PEND = { almacenamiento: true, diasParaPreguntar: 7, abiertas: 24, pallets: 413, urgentes: 0,
           citas: [], clientes: [] };
  await pg.evaluate(() => window.__prueba.cargarAlarma());
  await pg.waitForTimeout(150);
  ok(await pg.locator('#alarma').isVisible(), 'con 24 citas abiertas la banda aparece');
  const alt = await pg.locator('#al-t').innerText();
  ok(/413/.test(alt), 'y dice los pallets: ' + alt);
  const aln = await pg.locator('#al-n').innerText();
  ok(/24/.test(aln) && /413/.test(aln), 'con las tres cifras: ' + aln.replace(/\n/g, ' · '));
  ok((await pg.locator('#alarma').getAttribute('class')).indexOf('urge') < 0,
     'sin urgentes NO se pinta como crítica');

  PEND = Object.assign({}, PEND, { urgentes: 5 });
  await pg.evaluate(() => window.__prueba.cargarAlarma());
  await pg.waitForTimeout(150);
  ok((await pg.locator('#alarma').getAttribute('class')).indexOf('urge') >= 0,
     'con urgentes sí se pinta como crítica');
  ok(/preguntarle al cliente/.test(await pg.locator('#al-c').innerText()),
     'y dice qué hacer, no sólo que hay un problema');

  console.log('\n-- un 403 en pendientes no rompe ni asusta --');
  PEND_HTTP = 403;
  await pg.evaluate(() => window.__prueba.cargarAlarma());
  await pg.waitForTimeout(150);
  ok(await pg.locator('#alarma').isVisible(), 'la banda que ya estaba no se borra por un 403');
  ok(await pg.locator('#card-detalle, .cifras').first().isVisible(), 'y el historial sigue en pie');
  PEND_HTTP = 200;

  console.log('\n-- la pestaña de trazabilidad --');
  ok(await pg.locator('#v-traza').isHidden(), 'arranca cerrada');
  await pg.locator('#p-traza').click();
  await pg.waitForTimeout(150);
  ok(await pg.locator('#v-traza').isVisible(), 'se abre al hacer clic');
  ok(await pg.locator('#v-hist').isHidden(), 'y el historial se guarda');
  ok(await pg.locator('#p-traza').getAttribute('aria-selected') === 'true', 'queda marcada');

  console.log('\n-- buscar un pedido que no existe --');
  TRAZA = { termino: '9999999', almacenamiento: true, meses: 6, citas: [], folios: [],
            apariciones: [], cambios: [], confirmaciones: [], pendientes: [], desajustes: [],
            hallado: false };
  await pg.locator('#q').fill('9999999');
  await pg.locator('#b-buscar').click();
  await pg.waitForTimeout(200);
  ok(consultas.length === 1 && consultas[0].q === '9999999', 'consulta con el término: ' + JSON.stringify(consultas[0]));
  ok(/No hay nada guardado/.test(await pg.locator('#av-tz').innerText()), 'lo dice sin inventar');
  ok(await pg.locator('#card-apar').isHidden(), 'y no deja tablas vacías colgando');

  console.log('\n-- el caso de logística: 9 confirmados, Walmart ahora dice 20 --');
  const d4 = new Date(Date.parse(hoy) - 4 * 86400000).toISOString().slice(0, 10);
  const apT = (dia, canje, total, folio, archivo) => ({
    ts: dia + 'T10:00:00.000Z', dia: dia, archivo: archivo, quien: 'mmejias', cita: '42510877',
    po: '8651142003', rut: '92091000-9', cliente: 'UNILEVER CHILE LIMITADA', cd: '6009',
    recepcion: '7703', fecha: dia, total: total, malos: total - canje, canje: canje,
    folio: folio, bandeja: folio ? 'porConfirmar' : 'excepcion:sin-match' });
  TRAZA = {
    termino: '42510877', almacenamiento: true, meses: 6, hallado: true,
    citas: ['42510877'], folios: ['4149330'],
    apariciones: [apT(hoy, 20, 20, 4149330, 'wm-hoy.xlsx'), apT(d4, 9, 9, 4149330, 'wm-4.xlsx')],
    cambios: [{ cita: '42510877', de: d4, a: hoy, canjeAntes: 9, canjeAhora: 20,
                totalAntes: 9, totalAhora: 20, diferencia: 11 }],
    confirmaciones: [reg(d4, 'sin-diferencia', 9, 'UNILEVER CHILE LIMITADA')],
    pendientes: [],
    desajustes: [{ cita: '42510877', folio: 4149330, declarado: 20, confirmado: 9, faltan: 11,
                   sobran: 0, ultimoReporte: hoy, archivo: 'wm-hoy.xlsx', confirmadoEl: d4,
                   confirmadoPor: 'ana@redtecsa.com' }]
  };
  await pg.locator('#q').fill('42510877');
  await pg.locator('#b-buscar').click();
  await pg.waitForTimeout(250);

  ok(await pg.locator('#card-salto').isVisible(), 'el desajuste es lo PRIMERO que se ve');
  // Verde = "no hay nada que hacer". Con un desajuste abierto, un resumen
  // verde arriba contradice la tarjeta naranja de abajo, y gana el de arriba.
  const clsRes = await pg.locator('#av-tz').getAttribute('class');
  ok(clsRes.indexOf('ok') < 0, 'y el resumen NO se pinta de verde: ' + clsRes);
  ok(/cantidad cambiada/.test(await pg.locator('#av-tz').innerText()),
     'el resumen nombra el desajuste: ' + await pg.locator('#av-tz').innerText());
  ok(/pestaña/.test(await pg.locator('#card-salto p').innerText()),
     'y la tarjeta dice qué hacer, no sólo qué pasó');
  const salto = await pg.locator('#saltos').innerText();
  ok(/faltan 11/.test(salto), 'y dice cuántos faltan: ' + salto.replace(/\n/g, ' · '));
  ok(/4149330/.test(salto), 'con el pedido a confirmar');

  // El desajuste tiene que quedar ARRIBA de las tablas, no al final de la página.
  const yS = (await pg.locator('#card-salto').boundingBox()).y;
  const yA = (await pg.locator('#card-apar').boundingBox()).y;
  ok(yS < yA, 'el aviso va antes de las planillas (' + Math.round(yS) + ' < ' + Math.round(yA) + ')');

  const linea = await pg.locator('#linea .linea').count();
  ok(linea === 4, 'la línea de tiempo junta las 4 cosas que pasaron: ' + linea);
  // Arriba va el cambio de cantidad, no la aparición: es lo que obliga a
  // hacer algo. Después, las apariciones de la más nueva a la más vieja.
  const prim = await pg.locator('#linea .linea').first().innerText();
  ok(/Cambió la cantidad: 9 → 20/.test(prim), 'arriba queda el cambio: ' + prim.replace(/\n/g, ' · '));
  const dias = await pg.locator('#linea .linea .d').allInnerTexts();
  const iHoy = dias.findIndex(t => t.indexOf(hoy) === 0);
  const iViejo = dias.findIndex(t => t.indexOf(d4) === 0);
  ok(iHoy >= 0 && iViejo > iHoy, 'y la aparición de hoy va antes que la de hace 4 días (' +
     iHoy + ' < ' + iViejo + ')');
  const cambio = await pg.locator('#linea .linea.cambio').count();
  ok(cambio === 1, 'el cambio de cantidad se marca aparte: ' + cambio);
  const hito = await pg.locator('#linea .linea.hito').count();
  ok(hito === 1, 'y nuestra confirmación también: ' + hito);

  const apar = await pg.locator('#tb-apar tbody tr').count();
  ok(apar === 2, 'las dos apariciones en planillas: ' + apar);
  const f0 = await pg.locator('#tb-apar tbody tr').first().innerText();
  ok(/wm-hoy\.xlsx/.test(f0), 'con el nombre del archivo: ' + f0.replace(/\t/g, ' | '));
  ok((await pg.locator('#tb-conf tbody tr').count()) === 1, 'y nuestra confirmación en su tabla');
  const chips = await pg.locator('#chips .chip').count();
  ok(chips === 2, 'los chips resumen a qué cita y pedido se llegó: ' + chips);

  console.log('\n-- el enlace queda compartible --');
  ok(/#traza:42510877/.test(pg.url()), 'el hash lleva el término: ' + pg.url().split('#')[1]);

  console.log('\n-- buscar vacío no pega al api --');
  const antes = consultas.length;
  await pg.locator('#q').fill('');
  await pg.locator('#b-buscar').click();
  await pg.waitForTimeout(150);
  ok(consultas.length === antes, 'no se consultó nada');
  ok(/Escribe un número/.test(await pg.locator('#av-tz').innerText()), 'y dice qué poner');

  console.log('\n-- un 400 del api se muestra tal cual --');
  TRAZA_HTTP = 400;
  await pg.locator('#q').fill('12');
  await pg.locator('#b-buscar').click();
  await pg.waitForTimeout(200);
  ok(/un número de pedido/.test(await pg.locator('#av-tz').innerText()),
     'el mensaje del api llega al usuario: ' + await pg.locator('#av-tz').innerText());
  TRAZA_HTTP = 200;

  await pg.screenshot({ path: '/tmp/historial.png', fullPage: false });
  await b.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
