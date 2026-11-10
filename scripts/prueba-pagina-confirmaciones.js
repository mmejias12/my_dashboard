// Prueba de navegador de la confirmación en la página: sin red real, el
// /api/confirmar-walmart se intercepta y se le hace contestar a propósito.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = '/home/claude/w/repo';
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  FALLA ' + m); } else console.log('  ok   ' + m); };

const FILAS = [
  { folio: 4149330, cita: '12345678', clienteRedlink: 'IPAL', servicio: 'Transferencias',
    despachada: 1, canjeWM: 1, diferencia: 0, aConfirmar: 1, etapa: 'Pendiente Adjuntar Respaldo',
    bodega: 'ZWM11', docId: 692187 },
  { folio: 4149331, cita: '12345679', clienteRedlink: 'IPAL', servicio: 'Trans Diferenciada',
    despachada: 5, canjeWM: 4, diferencia: -1, aConfirmar: 4, etapa: 'Pendiente de Confirmación',
    bodega: 'ZWM01', docId: 692188 },
  { folio: 4149332, cita: '12345680', clienteRedlink: 'IPAL', servicio: 'Transferencias',
    despachada: 3, canjeWM: 3, diferencia: 0, aConfirmar: 3, etapa: 'Pendiente Adjuntar Respaldo',
    bodega: 'ZWM02', docId: 692189 }
];

(async () => {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const f = path.join(RAIZ, u === '/' ? 'confirmaciones-walmart.html' : u);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': u.endsWith('.js') ? 'text/javascript' : 'text/html' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('');
  }).listen(8899);

  const b = await chromium.launch();
  const pg = await b.newPage();
  const pedidos = [];
  let respuesta = () => ({ estado: 'confirmada', dice: 'confirmada 1 · Transferencia Confirmada' });

  await pg.route('**/api/confirmar-walmart', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    pedidos.push(body);
    const r = respuesta(body, pedidos.length);
    await route.fulfill({ status: r.http || 200, contentType: 'application/json',
                          body: JSON.stringify(r.cuerpo || r) });
  });

  await pg.goto('http://127.0.0.1:8899/confirmaciones-walmart.html');
  const sembrar = async () => pg.evaluate((filas) => {
    const S = window.__prueba.S; S.conf = {}; S.corriendo = false;
    S.filas = filas; S.nombre = 'prueba.xlsx';
    S.r = { citas: filas.length, porConfirmar: filas, avisar: [], excepciones: [] };
    window.__prueba.pintarTodo();
  }, FILAS);
  await sembrar();

  console.log('\n-- la tabla y el botón --');
  ok(await pg.locator('#tb-conf tbody tr').count() === 3, 'tres filas');
  ok((await pg.locator('#tb-conf tbody tr').first().locator('button').textContent()) === 'Confirmar 1',
     'el botón de la fila dice la cantidad');
  ok((await pg.locator('#btn-confirmar').textContent()).trim() === 'Confirmar 3', 'el masivo dice cuántas');

  console.log('\n-- una sola --');
  await pg.locator('#tb-conf tbody tr').first().locator('button').click();
  await pg.waitForTimeout(150);
  ok(pedidos.length === 1, 'un solo pedido');
  ok(pedidos[0].folio === 4149330 && pedidos[0].cantidad === 1 && pedidos[0].id === 692187,
     'manda folio, cantidad y el id del documento: ' + JSON.stringify(pedidos[0]));
  ok(/confirmada/i.test(await pg.locator('#tb-conf tbody tr').first().innerText()),
     'la fila queda marcada confirmada');
  ok((await pg.locator('#tb-conf tbody tr').first().locator('button').count()) === 0,
     'y ya no se puede volver a apretar');
  ok((await pg.locator('#btn-confirmar').textContent()).indexOf('2') >= 0,
     'el masivo baja a 2: ' + (await pg.locator('#btn-confirmar').textContent()));

  console.log('\n-- el masivo necesita dos clics --');
  pedidos.length = 0;
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(100);
  ok(pedidos.length === 0, 'el primer clic NO escribe');
  ok((await pg.locator('#btn-confirmar').textContent()).indexOf('Sí, confirmar') >= 0,
     'el primer clic arma el botón: ' + (await pg.locator('#btn-confirmar').textContent()));
  ok((await pg.locator('#btn-confirmar').getAttribute('class')).indexOf('armado') >= 0, 'y se ve distinto');
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(400);
  ok(pedidos.length === 2, 'el segundo clic confirma las dos que faltaban, de a una: ' + pedidos.length);
  ok(pedidos[0].folio === 4149331 && pedidos[1].folio === 4149332, 'en orden');

  console.log('\n-- se detiene en la primera que falla --');
  await sembrar();
  pedidos.length = 0;
  respuesta = (body, n) => n === 2
    ? { http: 409, cuerpo: { estado: 'detener', dice: 'la transferencia cambió de etapa' } }
    : { estado: 'confirmada', dice: 'ok' };
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(100);
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(500);
  ok(pedidos.length === 2, 'no siguió con la tercera: ' + pedidos.length);
  const estado = await pg.locator('#estado-conf').innerText();
  ok(estado.indexOf('SE DETUVO') >= 0 && estado.indexOf('4149331') >= 0, 'dice dónde se detuvo: ' + estado);
  ok((await pg.locator('#tb-conf tbody tr').nth(2).locator('button').count()) === 1,
     'la tercera sigue sin tocar, con su botón');

  console.log('\n-- 403: el rol no alcanza --');
  await sembrar();
  pedidos.length = 0;
  respuesta = () => ({ http: 403, cuerpo: { estado: 'detener', dice: 'sin permiso' } });
  await pg.locator('#tb-conf tbody tr').first().locator('button').click();
  await pg.waitForTimeout(200);
  ok((await pg.locator('#estado-conf').innerText()).indexOf('permiso') >= 0,
     'lo dice con palabras: ' + (await pg.locator('#estado-conf').innerText()));

  console.log('\n-- la red se cae --');
  await sembrar();
  await pg.route('**/api/confirmar-walmart', (r) => r.abort());
  await pg.locator('#tb-conf tbody tr').first().locator('button').click();
  await pg.waitForTimeout(300);
  const t = await pg.locator('#estado-conf').innerText();
  ok(/No se sabe si alcanzó a escribir/.test(t), 'no dice que salió bien ni que salió mal: ' + t);

  await b.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
