#!/usr/bin/env node
// ============================================================================
//  scripts/prueba-pagina-historial.js
//
//  Prueba de navegador de historial-confirmaciones.html: sin red real, el
//  /api/confirmaciones-historial se intercepta y contesta a propósito.
//
//  Lo que mira que ninguna prueba de lógica puede mirar: que el calendario
//  caiga en el día correcto, que el color diga la magnitud, y que un clic
//  filtre de verdad.
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

  await pg.screenshot({ path: '/tmp/historial.png', fullPage: false });
  await b.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
