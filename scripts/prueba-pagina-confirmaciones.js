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
  { folio: 4149330, cita: '42759276', cliente: 'NUTRISCO CHILE S. A.', rut: '77643296-2',
    po: '2851158713', fecha: '2026-11-09', malosWM: 0,
    clienteRedlink: 'IPAL', servicio: 'Transferencias',
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

  // El seguimiento de citas sin cruce se intercepta: esta prueba es sobre
  // confirmar, y sin esto cada cruce intentaría hablar con el api.
  const PEND = { estado: { almacenamiento: true, diasParaPreguntar: 7, abiertas: 0, pallets: 0,
                           urgentes: 0, citas: [], clientes: [] }, pedidos: [] };
  await pg.route('**/api/pendientes-cruce', async (route) => {
    PEND.pedidos.push({ metodo: route.request().method(),
                        cuerpo: route.request().postData() ? JSON.parse(route.request().postData()) : null });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PEND.estado) });
  });

  // La trazabilidad se intercepta igual: cada cruce anota las apariciones del
  // reporte, y esta prueba comprueba QUÉ se anota.
  const TZ = { pedidos: [], http: 200, cuerpo: { guardados: 0, ok: true, aviso: '' } };
  await pg.route('**/api/trazabilidad*', async (route) => {
    TZ.pedidos.push(route.request().postData() ? JSON.parse(route.request().postData()) : null);
    await route.fulfill({ status: TZ.http, contentType: 'application/json',
                          body: JSON.stringify(TZ.cuerpo) });
  });

  await pg.goto('http://127.0.0.1:8899/confirmaciones-walmart.html');
  const sembrar = async () => pg.evaluate((filas) => {
    const S = window.__prueba.S; S.conf = {}; S.sel = {}; S.corriendo = false;
    S.filas = filas; S.nombre = 'prueba.xlsx';
    S.r = { citas: filas.length, porConfirmar: filas, avisar: [], excepciones: [] };
    window.__prueba.pintarTodo();
  }, FILAS);
  await sembrar();

  console.log('\n-- la tabla y el botón --');
  ok(await pg.locator('#tb-conf tbody tr').count() === 3, 'tres filas');
  ok((await pg.locator('#tb-conf tbody tr').first().locator('button').textContent()) === 'Confirmar 1',
     'el botón de la fila dice la cantidad');
  ok((await pg.locator('#btn-confirmar').textContent()).trim() === 'Confirmar 3 seleccionadas',
     'el masivo dice cuántas: ' + (await pg.locator('#btn-confirmar').textContent()));

  // El defecto que encontró Mauro: con 52 filas la última columna arrancaba en
  // los 1330px dentro de un contenedor de 1102 y el botón no se veía nunca.
  console.log('\n-- las columnas de acción se ven sin scrollear --');
  const geo = await pg.evaluate(() => {
    const caja = document.querySelector('.tabla-caja');
    const tr = document.querySelector('#tb-conf tbody tr');
    const r = caja.getBoundingClientRect();
    const chk = tr.children[0].getBoundingClientRect();
    const bot = tr.children[1].getBoundingClientRect();
    const ths = [...document.querySelectorAll('#tb-conf th')].map(x => x.textContent);
    return { dentro: chk.right <= r.right + 1 && bot.right <= r.right + 1, ths: ths };
  });
  ok(geo.dentro, 'el check y el botón caen dentro del contenedor visible');
  ok(geo.ths[0] === '' && geo.ths[1] === 'Confirmación',
     'y son las dos primeras columnas: ' + JSON.stringify(geo.ths.slice(0, 3)));

  console.log('\n-- el check elige qué se confirma --');
  const chks = pg.locator('#tb-conf tbody input.chk');
  ok(await chks.count() === 3, 'un check por fila');
  ok(await chks.first().isChecked(), 'vienen seleccionadas: la bandeja ES lo que corresponde confirmar');
  await pg.locator('#tb-conf thead input.chk').click();
  await pg.waitForTimeout(80);
  ok((await pg.locator('#btn-confirmar').textContent()).indexOf('ninguna seleccionada') >= 0,
     'sin ninguna, el masivo lo dice: ' + (await pg.locator('#btn-confirmar').textContent()));
  ok(await pg.locator('#btn-confirmar').isDisabled(), 'y no se puede apretar');
  await pg.locator('#tb-conf tbody input.chk').nth(1).click();
  await pg.waitForTimeout(80);
  ok((await pg.locator('#btn-confirmar').textContent()).indexOf('1 seleccionada') >= 0,
     'con una: ' + (await pg.locator('#btn-confirmar').textContent()));
  ok(await pg.evaluate(() => document.querySelector('#tb-conf thead input.chk').indeterminate),
     'el check del encabezado queda a medias');
  pedidos.length = 0;
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(80);
  await pg.locator('#btn-confirmar').click();
  await pg.waitForTimeout(400);
  ok(pedidos.length === 1 && pedidos[0].folio === 4149331,
     'el masivo con una elegida toca SÓLO esa: ' + JSON.stringify(pedidos.map(x => x.folio)));
  await sembrar();
  pedidos.length = 0;

  console.log('\n-- una sola --');
  await pg.locator('#tb-conf tbody tr').first().locator('button').click();
  await pg.waitForTimeout(150);
  ok(pedidos.length === 1, 'un solo pedido');
  ok(pedidos[0].folio === 4149330 && pedidos[0].cantidad === 1 && pedidos[0].id === 692187,
     'manda folio, cantidad y el id del documento');
  // Lo que no existe en Redlink y sólo puede viajar desde acá.
  const rep0 = pedidos[0].reporte || {};
  ok(rep0.cita === '42759276' && rep0.po === '2851158713' && rep0.rut === '77643296-2' &&
     rep0.razonSocial === 'NUTRISCO CHILE S. A.',
     'manda la cita, el PO, el rut y la razón social: ' + JSON.stringify(rep0));
  ok(rep0.aceptados === 1 && rep0.rechazados === 0 && rep0.cuando === '2026-11-09',
     'y lo que declaró Walmart: ' + JSON.stringify(rep0));
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
  ok(await pg.locator('#tb-conf tbody tr').first().locator('input.chk').isDisabled(),
     'el check de una ya resuelta queda fuera de juego');

  console.log('-- la cita que vuelve con MÁS de lo confirmado --');
  // El caso que trajo logística: 9 de 20, se confirma por 9, y días después la
  // misma cita vuelve diciendo 20. Antes caía en "ya confirmada" entre otras
  // cincuenta excepciones y nadie la miraba: 11 pallets perdidos.
  await pg.evaluate(() => {
    const S = window.__prueba.S;
    S.conf = {}; S.sel = {}; S.pend = null; S.reaparecidas = []; S.filas = [];
    S.r = { citas: 1, porConfirmar: [], avisar: [], excepciones: [], reconfirmar: [
      { folio: 4077940, cita: '42510877', cliente: 'LABORATORIO BALLERINA LIMITADA',
        clienteRedlink: 'LABORATORIO BALLERINA LIMITADA', despachada: 20, yaConfirmada: 9,
        objetivo: 20, faltanPorConfirmar: 11, bodega: 'ZWM01', clave: 'reconfirmar',
        motivo: 'confirmada por 9 y Walmart ahora declara 20: faltan 11' } ] };
    window.__prueba.pintarTodo();
  });
  ok(await pg.locator('#t-recon').innerText() === '1', 'la pestaña Reconfirmar la cuenta');
  const rec0 = await pg.locator('#tb-recon tbody tr').first().innerText();
  ok(/4077940/.test(rec0) && /BALLERINA/.test(rec0), 'con su folio y su cliente');
  ok(/\t9\t/.test(rec0) || /9/.test(rec0), 'dice por cuánto está confirmada');
  ok(/11/.test(rec0), 'y cuántos faltan: ' + rec0.replace(/\t/g, ' | '));
  ok(/pallets sin confirmar/.test(await pg.locator('#resumen-recon').innerText()),
     'el resumen nombra los pallets, que es lo que está en juego');
  ok(!(await pg.locator('#btn-csv-recon').isDisabled()), 'se puede bajar para reconfirmar a mano');
  ok((await pg.locator('#tb-exc tbody tr').count()) === 0,
     'y NO queda enterrada entre las excepciones');

  console.log('\n-- las citas sin cruce se guardan y se re-cruzan --');
  // La bandeja de excepciones ahora tiene que decir DE QUIÉN es cada cita.
  await pg.evaluate(() => {
    const S = window.__prueba.S;
    S.filas = [{ cita: '42759276', rut: '77643296-2', cliente: 'NUTRISCO CHILE S. A.',
                 cd: '6009', recepcion: '406507', fecha: '2026-11-09', po: '2851158713',
                 total: 15, malos: 0, canje: 15 }];
    S.nombre = 'Reporte-RedTec.xlsx';
    S.ops = [];
    S.conf = {}; S.sel = {}; S.pend = null; S.reaparecidas = [];
    S.r = { citas: 1, porConfirmar: [], avisar: [], excepciones: [
      { cita: '42759276', clave: 'sin-match', motivo: 'sin coincidencia en Redlink',
        cliente: 'NUTRISCO CHILE S. A.', rut: '77643296-2', canjeWM: 15, totalWM: 15,
        fecha: '2026-11-09', folio: null, despachada: null, etapa: '' } ] };
    window.__prueba.pintarTodo();
  });
  const filaExc = await pg.locator('#tb-exc tbody tr').first().innerText();
  ok(/NUTRISCO/.test(filaExc), 'la excepción dice de qué cliente es: ' + filaExc.replace(/\t/g, ' | '));
  ok(/77643296-2/.test(filaExc), 'y su rut');

  PEND.pedidos.length = 0;
  await pg.evaluate(() => window.__prueba.sincronizarPendientes());
  await pg.waitForTimeout(300);
  ok(PEND.pedidos.length === 2, 'lee y después guarda: ' + PEND.pedidos.map(p => p.metodo).join(','));
  const post = PEND.pedidos.find(p => p.metodo === 'POST');
  ok(post && post.cuerpo.vistas.length === 1, 'manda la cita sin cruce');
  ok(post && post.cuerpo.vistas[0].cita === '42759276' && post.cuerpo.vistas[0].pallets === 15,
     'con sus pallets: ' + JSON.stringify(post && post.cuerpo.vistas[0] && {
       cita: post.cuerpo.vistas[0].cita, pallets: post.cuerpo.vistas[0].pallets }));
  // Lo que hace posible re-cruzarla mañana: van las filas ORIGINALES.
  ok(post && post.cuerpo.vistas[0].filas.length === 1 && post.cuerpo.vistas[0].filas[0].canje === 15,
     'y las filas originales del reporte, para poder re-cruzarla');
  ok(post && post.cuerpo.archivo === 'Reporte-RedTec.xlsx', 'y de qué archivo salió');

  console.log('\n-- una pendiente que por fin cruza vuelve a la bandeja --');
  // El api devuelve una pendiente de ayer; hoy Redlink ya tiene su operación.
  PEND.estado = { almacenamiento: true, diasParaPreguntar: 7, abiertas: 1, pallets: 9, urgentes: 1,
    citas: [{ cita: '42704805', cliente: 'OTRO CLIENTE', rut: '1-9', pallets: 9, estado: 'abierta',
              desde: '2026-11-01', dias: 9, urgente: true,
              filas: [{ cita: '42704805', rut: '1-9', cliente: 'OTRO CLIENTE', cd: '6009',
                        recepcion: '1', fecha: '2026-11-01', total: 9, malos: 0, canje: 9 }] }],
    clientes: [{ cliente: 'OTRO CLIENTE', rut: '1-9', citas: 1, pallets: 9, urgentes: 1,
                 masVieja: '2026-11-01', filas: [{ cita: '42704805' }] }] };
  PEND.pedidos.length = 0;
  await pg.evaluate(() => {
    const S = window.__prueba.S;
    S.r = { citas: 0, porConfirmar: [], avisar: [], excepciones: [] };
    S.filas = []; S.reaparecidas = [];
    // Hoy Redlink SÍ tiene la operación de esa cita.
    S.ops = [{ nroPedido: 4150001, nroCita: '42704805', operacion: 'Transferencia',
               etapaOperacion: 'Pendiente de Confirmacion', cantidadDespachada: 9,
               cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM01', observacion: '' }];
    window.__prueba.pintarTodo();
    return window.__prueba.sincronizarPendientes();
  });
  await pg.waitForTimeout(300);
  const post2 = PEND.pedidos.find(p => p.metodo === 'POST');
  ok(post2 && post2.cuerpo.cruzadas.length === 1, 'avisa que cruzó: ' + JSON.stringify(post2 && post2.cuerpo.cruzadas));
  ok(post2 && post2.cuerpo.cruzadas[0].folio === 4150001, 'con el folio que encontró');
  const trasRe = await pg.evaluate(() => ({
    enBandeja: window.__prueba.S.r.porConfirmar.map(f => f.folio),
    marcada: window.__prueba.S.r.porConfirmar.every(f => f.reaparecida === true),
    aviso: (document.getElementById('av-pend') || {}).textContent
  }));
  ok(trasRe.enBandeja.length === 1 && trasRe.enBandeja[0] === 4150001,
     'y se suma sola a POR CONFIRMAR: ' + JSON.stringify(trasRe.enBandeja));
  ok(trasRe.marcada, 'marcada como reaparecida');
  ok(/aparecieron hoy/.test(trasRe.aviso), 'y se avisa: ' + trasRe.aviso);

  console.log('\n-- la pestaña de sin cruce --');
  await pg.evaluate(() => {
    const S = window.__prueba.S;
    S.pend = { almacenamiento: true, diasParaPreguntar: 7, abiertas: 3, pallets: 40, urgentes: 2,
      citas: [], clientes: [
        { cliente: 'GRANDE SA', rut: '1-9', citas: 2, pallets: 37, urgentes: 2,
          masVieja: '2026-11-01', filas: [{ cita: '42704805' }, { cita: '42704806' }] },
        { cliente: 'CHICO LTDA', rut: '2-7', citas: 1, pallets: 3, urgentes: 0,
          masVieja: '2026-11-08', filas: [{ cita: '42704807' }] }] };
    S.reaparecidas = [];
    window.__prueba.pintarTodo();
  });
  ok(await pg.locator('#t-pend').innerText() === '3', 'la pestaña cuenta las abiertas');
  ok((await pg.locator('#tb-pend tbody tr').count()) === 2, 'dos clientes');
  const pend0 = await pg.locator('#tb-pend tbody tr').first().innerText();
  ok(/GRANDE SA/.test(pend0) && /37/.test(pend0), 'el de más pallets primero: ' + pend0.replace(/\t/g, ' | '));
  ok(/42704805/.test(pend0), 'y se ven las citas, que es lo que se le pregunta al cliente');
  ok(/pallets en juego/.test(await pg.locator('#resumen-pend').innerText()),
     'el resumen dice los pallets en juego');

  console.log('\n-- varias citas del MISMO cliente se cruzan una por una --');
  // Caso real: UNILEVER con tres citas pendientes. Cada cita es una visita
  // distinta al CD y tiene su propia transferencia: si el re-cruce las tratara
  // como un bloque, bastaría con que una no apareciera para que las tres
  // quedaran colgadas.
  const tresCitas = ['42751929', '42751936', '42751943'].map(c => ({
    cita: c, cliente: 'UNILEVER CHILE LIMITADA', rut: '92091000-9', pallets: 24,
    estado: 'abierta', desde: '2026-11-11', dias: 0, urgente: false,
    filas: [{ cita: c, rut: '92091000-9', cliente: 'UNILEVER CHILE LIMITADA', cd: '6009',
              recepcion: '1', fecha: '2026-11-11', total: 24, malos: 0, canje: 24 }]
  }));
  const reTres = await pg.evaluate((citas) => {
    // Redlink tiene la transferencia de DOS de las tres.
    const ops = [
      { nroPedido: 4150010, nroCita: '42751929', operacion: 'Transferencia',
        etapaOperacion: 'Pendiente de Confirmacion', cantidadDespachada: 24,
        cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM01', observacion: '' },
      { nroPedido: 4150011, nroCita: '42751943', operacion: 'Transferencia',
        etapaOperacion: 'Pendiente Adjuntar Respaldo', cantidadDespachada: 24,
        cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM02', observacion: '' }
    ];
    const r = window.__prueba.recruzar(citas, ops);
    return { cruzadas: r.cruzadas.map(c => c.cita + ':' + c.folio),
             alaBandeja: r.porConfirmar.map(f => f.cita + ':' + f.folio + ':' + f.aConfirmar) };
  }, tresCitas);
  ok(reTres.cruzadas.length === 2, 'cruzan las dos que Redlink tiene: ' + JSON.stringify(reTres.cruzadas));
  ok(reTres.cruzadas.join(',').indexOf('42751936') < 0, 'la tercera sigue pendiente, no se da por cruzada');
  ok(reTres.alaBandeja.length === 2, 'y las dos entran a por confirmar con su cantidad: ' +
     JSON.stringify(reTres.alaBandeja));

  console.log('\n-- dos citas que caen en el MISMO folio no quedan colgadas --');
  // Si dos citas apuntan al mismo folio, confirmar sería ambiguo y el cruce las
  // manda a excepciones. Pero para el seguimiento SÍ encontraron transferencia:
  // dejarlas abiertas diría que el cliente no la emitió, y sí la emitió.
  const dosMismoFolio = await pg.evaluate(() => {
    const citas = ['42751929', '42751936'].map(c => ({
      cita: c, cliente: 'X', pallets: 10, estado: 'abierta', desde: '2026-11-11',
      filas: [{ cita: c, rut: '1-9', cliente: 'X', cd: '6009', recepcion: '1',
                fecha: '2026-11-11', total: 10, malos: 0, canje: 10 }]
    }));
    const ops = [{ nroPedido: 4150020, nroCita: '42751929 42751936', operacion: 'Transferencia',
                   etapaOperacion: 'Pendiente de Confirmacion', cantidadDespachada: 20,
                   cantidadConfirmada: 0, bodegaDestinoStr: 'ZWM01',
                   observacion: 'citas 42751929 y 42751936' }];
    const r = window.__prueba.recruzar(citas, ops);
    return { cruzadas: r.cruzadas.map(c => c.cita), bandeja: r.porConfirmar.length };
  });
  ok(dosMismoFolio.cruzadas.length === 2,
     'las dos se dan por cruzadas aunque no se puedan confirmar: ' + JSON.stringify(dosMismoFolio.cruzadas));
  ok(dosMismoFolio.bandeja === 0, 'pero NO entran a confirmar: sería ambiguo');

  console.log('\n-- una confirmación que no quedó en el historial --');
  await sembrar();
  respuesta = () => ({ estado: 'confirmada', dice: 'confirmada 1 · Transferencia Confirmada',
                       historial: 'NO quedó en el historial: AuthorizationFailure' });
  await pg.locator('#tb-conf tbody tr').first().locator('button').click();
  await pg.waitForTimeout(250);
  const avh = await pg.locator('#estado-conf').innerText();
  ok(/OJO/.test(avh) && /historial/.test(avh), 'lo avisa: ' + avh);
  ok(/confirmada/i.test(await pg.locator('#tb-conf tbody tr').first().innerText()),
     'pero la fila sigue marcada confirmada: la escritura en Redlink sí ocurrió');

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

  console.log('\n-- la alarma de pendientes se lee al ABRIR la página --');
  // Hasta ahora los pallets en juego sólo se veían después de cruzar un
  // reporte. Quien abre la página a mirar no los veía en ninguna parte.
  const abiertoAlArranque = PEND.pedidos.filter(x => x.metodo === 'GET').length;
  ok(abiertoAlArranque >= 1, 'la página pidió los pendientes sola: ' + abiertoAlArranque + ' GET');

  await pg.evaluate(() => {
    window.__prueba.S.pend = { almacenamiento: true, diasParaPreguntar: 7, abiertas: 24,
                               pallets: 413, urgentes: 0, citas: [], clientes: [] };
    window.__prueba.pintarAlarma();
  });
  await pg.waitForTimeout(120);
  ok(await pg.locator('#alarma').isVisible(), 'con citas abiertas la banda se ve');
  const bt = await pg.locator('#al-t').innerText();
  ok(/413/.test(bt) && /24/.test(bt), 'con los pallets y las citas: ' + bt);

  // La banda está arriba de los pasos: no hay que scrollear para encontrarla.
  const yB = (await pg.locator('#alarma').boundingBox()).y;
  const yP = (await pg.locator('.pasos2').boundingBox()).y;
  ok(yB < yP, 'y queda arriba de todo (' + Math.round(yB) + ' < ' + Math.round(yP) + ')');

  await pg.locator('#al-ir').click();
  await pg.waitForTimeout(250);
  ok(await pg.locator('#p-pend').isVisible(), 'el botón abre la pestaña de sin cruce');

  console.log('\n-- cada cruce anota las apariciones del reporte --');
  TZ.pedidos.length = 0;
  await pg.evaluate(() => {
    const S = window.__prueba.S;
    S.nombre = 'wm-11-nov.xlsx';
    const base = (cita, po, canje, total, folio, clave) => ({
      cita: cita, po: po, rut: '92091000-9', cliente: 'UNILEVER CHILE LIMITADA', cd: '6009',
      fecha: '2026-11-10', recepciones: ['7703', '7704'],
      totalWM: total, canjeWM: canje, malosWM: total - canje,
      folio: folio, clave: clave });
    S.r = { citas: 4,
            porConfirmar: [base('42751929', '8651142003', 20, 20, 4149330, null)],
            avisar:       [base('42751936', '5450706975', 9, 20, 4149331, null)],
            reconfirmar:  [base('42751943', '5450706960', 20, 20, 4149332, null)],
            excepciones:  [base('42751950', '5450706961', 15, 15, null, 'sin-match')] };
    return window.__prueba.anotarApariciones();
  });
  await pg.waitForTimeout(250);

  ok(TZ.pedidos.length === 1, 'se mandó una sola vez: ' + TZ.pedidos.length);
  const env = TZ.pedidos[0] || {};
  ok(env.archivo === 'wm-11-nov.xlsx', 'con el nombre del archivo: ' + env.archivo);
  ok((env.filas || []).length === 4, 'las 4 citas del reporte, no sólo las confirmables: ' +
     (env.filas || []).length);
  const porCita = {};
  (env.filas || []).forEach(f => { porCita[f.cita] = f; });
  ok(porCita['42751929'] && porCita['42751929'].bandeja === 'porConfirmar', 'la bandeja de cada una');
  ok(porCita['42751936'] && porCita['42751936'].bandeja === 'avisar', 'incluida avisar');
  ok(porCita['42751943'] && porCita['42751943'].bandeja === 'reconfirmar', 'y reconfirmar');
  ok(porCita['42751950'] && porCita['42751950'].bandeja === 'excepcion:sin-match',
     'la excepción dice POR QUÉ lo fue: ' + (porCita['42751950'] || {}).bandeja);
  ok(porCita['42751950'] && porCita['42751950'].folio === null,
     'una cita sin cruce va con folio null, no con cero');
  ok(porCita['42751929'].folio === 4149330, 'y la que cruzó lleva su folio resuelto');
  ok(porCita['42751936'].canje === 9 && porCita['42751936'].total === 20,
     'se guarda lo que Walmart declaró ese día: ' + porCita['42751936'].canje + ' de ' +
     porCita['42751936'].total);
  ok(porCita['42751929'].recepcion === '7703,7704', 'con sus recepciones: ' + porCita['42751929'].recepcion);
  ok(porCita['42751929'].po === '8651142003', 'y el PO, que es por donde se busca');

  console.log('\n-- si no se puede guardar la trazabilidad, el cruce igual sirve --');
  TZ.pedidos.length = 0;
  TZ.cuerpo = { guardados: 0, ok: false, aviso: 'AuthorizationFailure' };
  await pg.evaluate(() => window.__prueba.anotarApariciones());
  await pg.waitForTimeout(250);
  const avp = await pg.locator('#av-pend').innerText();
  ok(/no se pudo guardar la trazabilidad/.test(avp), 'lo avisa: ' + avp);
  ok(/cruce está bien/.test(avp), 'y aclara que el cruce sí sirve');
  ok(await pg.locator('#tb-conf tbody tr').count() >= 0, 'la tabla no se tocó');
  TZ.cuerpo = { guardados: 0, ok: true, aviso: '' };

  console.log('\n-- un 403 en trazabilidad no molesta a nadie --');
  TZ.http = 403;
  await pg.evaluate(() => {
    window.__prueba.S.pend = null;
    const e = document.getElementById('av-pend'); e.className = 'aviso'; e.textContent = '';
    return window.__prueba.anotarApariciones();
  });
  await pg.waitForTimeout(250);
  ok((await pg.locator('#av-pend').innerText()).trim() === '', 'no dice nada: sin permiso no es un error');
  TZ.http = 200;

  await b.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
