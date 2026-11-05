'use strict';
/* ===========================================================================
   Pruebas de gestion-operacional.html con Playwright.

   Se sirve la pagina y el JSON de definicion desde un directorio temporal,
   igual que lo hara Azure Static Web Apps (la pagina arriba, el JSON en
   data/). Asi se prueba el camino real: la vista no trae campos escritos en
   el codigo, los lee del JSON, y si el JSON no esta la pagina lo dice.

   Que se prueba, en una linea: que la regla del total se respeta, que los
   campos que Mauro mando sacar no estan, que los renombrados dicen lo que
   tienen que decir, y que enviar NO guarda nada todavia.

   Uso (desde la raiz del repo):
     node scripts/test-gestion-operacional.js              # corre la suite
     node scripts/test-gestion-operacional.js --mutar=H01  # aplica una mutacion
     node scripts/test-gestion-operacional.js --mutaciones # corre todas las mutaciones

   El modo --mutaciones es el que le da valor a la suite: estropea el HTML de
   17 maneras distintas, una por vez, y cada una tiene que hacer fallar alguna
   prueba. Una mutacion que "VIVE" es una linea que nadie esta probando.
   =========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.error('Falta Playwright. Desde la raiz del repo:\n' +
    '  npm i -D playwright\n' +
    '  npx playwright install chromium\n' +
    'y volver a correr: node scripts/test-gestion-operacional.js');
  process.exit(2);
}

const RAIZ = path.join(__dirname, '..');
const ORIGEN_HTML = path.join(RAIZ, 'gestion-operacional.html');
const ORIGEN_JSON = path.join(RAIZ, 'data', 'gestion-operacional.json');
/* Se sirve desde una carpeta temporal del sistema, no del repo: la prueba
   muta el HTML y nada de eso puede terminar tocando el archivo real. */
const SERVIR = fs.mkdtempSync(path.join(os.tmpdir(), 'go-prueba-'));

/* ── Mutaciones ────────────────────────────────────────────────────────────
   Cada una es un cambio chico y plausible en la pagina. Si la suite pasa con
   la mutacion aplicada, la suite no esta probando esa linea.               */
const MUTACIONES = {
  H01: { que: 'la regla del cuadre bloquea tambien cuando la suma es igual al total',
         de: 'pasa: suma > total', a: 'pasa: suma >= total' },
  H02: { que: 'la regla del cuadre nunca marca que se paso',
         de: 'pasa: suma > total', a: 'pasa: false' },
  H03: { que: 'el boton de envio nunca se deshabilita',
         de: 'if (env) env.disabled = pasadas.length > 0;', a: 'if (env) env.disabled = false;' },
  H04: { que: 'enviar() no revisa el cuadre antes de armar el payload',
         de: '  if (revisar().length) return;', a: '  if (false) return;' },
  H05: { que: 'los inputs del cuadre pasado no se marcan en rojo',
         de: "if (inp) inp.classList.toggle('mal', c.pasa);", a: "if (inp) inp.classList.toggle('mal', false);" },
  H06: { que: 'el saldo se calcula al reves',
         de: 'saldo: total - suma', a: 'saldo: suma - total' },
  H07: { que: 'ninguna seccion calcula cuadre',
         de: "  if (!seccion.total || !seccion.distribuyen) return null;", a: '  return null;' },
  H08: { que: 'el payload de consumos manda el area en vez del formulario',
         de: "    formulario: FAM === 'inventario' ? AREA : FORM.formulario,", a: '    formulario: AREA,' },
  H09: { que: 'el payload nunca lleva los materiales consumidos',
         de: '  if (Object.keys(materiales).length) payload.materiales = materiales;', a: '  if (false) payload.materiales = materiales;' },
  H10: { que: 'todos los campos salen marcados "por confirmar"',
         de: '  var chip = campo.inferido\n', a: '  var chip = true\n' },
  H11: { que: 'el aviso de seccion no confirmada sale en todas las areas',
         de: '    (porConfirmar ?', a: '    (true ?' },
  H12: { que: 'el borde de color no distingue pallet REDTEC de RT',
         de: "  var clase = seccion.pallet === 'RT' ? 'rt' : 'redtec';", a: "  var clase = 'redtec';" },
  H13: { que: 'los campos de inventario dejan de ser obligatorios',
         de: "'<input type=\"number\" min=\"0\" step=\"' + paso + '\" required '", a: "'<input type=\"number\" min=\"0\" step=\"' + paso + '\" '" },
  H14: { que: 'los campos de inventario aceptan negativos',
         de: "'<input type=\"number\" min=\"0\" step=\"' + paso + '\" required '", a: "'<input type=\"number\" step=\"' + paso + '\" required '" },
  H15: { que: 'los campos decimales se vuelven enteros',
         de: "var paso = campo.tipo === 'decimal' ? '0.01' : '1';", a: "var paso = '1';" },
  H16: { que: 'el factor del rollo nunca viaja con el dato',
         de: "      if (d && d.unidad === 'rollos' && m.porRollo) d.porRollo = m.porRollo;",
         a: '      if (false) d.porRollo = m.porRollo;' },
  H17: { que: 'el factor del rollo se cuelga tambien de los materiales contados en unidades',
         de: "      if (d && d.unidad === 'rollos' && m.porRollo) d.porRollo = m.porRollo;",
         a: '      if (d && m.porRollo) d.porRollo = m.porRollo;' }
};

/* ── Preparar lo que se sirve ─────────────────────────────────────────────── */
function preparar(opts) {
  opts = opts || {};
  fs.rmSync(SERVIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(SERVIR, 'data'), { recursive: true });

  let html = fs.readFileSync(ORIGEN_HTML, 'utf8');
  if (opts.mutar) {
    const m = MUTACIONES[opts.mutar];
    if (!m) throw new Error('mutacion desconocida: ' + opts.mutar);
    const partes = html.split(m.de);
    if (partes.length !== 2) {
      throw new Error('la mutacion ' + opts.mutar + ' no calza exactamente una vez (' +
        (partes.length - 1) + ' coincidencias). Patron: ' + JSON.stringify(m.de));
    }
    html = partes[0] + m.a + partes[1];
  }
  fs.writeFileSync(path.join(SERVIR, 'gestion-operacional.html'), html);
  if (!opts.sinJson) fs.copyFileSync(ORIGEN_JSON, path.join(SERVIR, 'data', 'gestion-operacional.json'));
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function servidor() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const limpio = decodeURIComponent(req.url.split('?')[0]);
      const archivo = path.join(SERVIR, path.normalize(limpio).replace(/^(\.\.[\/\\])+/, ''));
      if (!archivo.startsWith(SERVIR) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no esta'); return;
      }
      res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
      res.end(fs.readFileSync(archivo));
    });
    s.listen(0, '127.0.0.1', () => ok({ s, url: 'http://127.0.0.1:' + s.address().port + '/gestion-operacional.html' }));
  });
}

/* ── Utilidades de asercion ──────────────────────────────────────────────── */
function igual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(que + '\n  esperado: ' + b + '\n  obtenido: ' + a);
}
function cierto(v, que) { if (!v) throw new Error(que); }
function contiene(texto, trozo, que) {
  if (String(texto).indexOf(trozo) < 0)
    throw new Error(que + '\n  no contiene: ' + JSON.stringify(trozo) + '\n  texto: ' + JSON.stringify(String(texto).slice(0, 400)));
}
function noContiene(texto, trozo, que) {
  if (String(texto).indexOf(trozo) >= 0)
    throw new Error(que + '\n  contiene y no debia: ' + JSON.stringify(trozo));
}

const sel = (sec, clave) => `input[data-sec="${sec}"][data-clave="${clave}"]`;
const campo = (p, sec, clave) => p.locator(sel(sec, clave));

/* Llena todos los numeros del formulario y la identificacion de texto. */
async function llenarTodo(p, valor) {
  await p.evaluate((v) => {
    const f = document.getElementById('f');
    f.querySelectorAll('input[type=number]').forEach((i) => { i.value = String(v); });
    f.querySelectorAll('input:not([type=number]):not([type=date])').forEach((i) => { i.value = 'Prueba Automatica'; });
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }, valor);
}

async function etiquetas(p, fieldset) {
  return p.locator(`fieldset[data-sec="${fieldset}"] label.campo > span`).allTextContents();
}
async function claves(p, fieldset) {
  return p.locator(`fieldset[data-sec="${fieldset}"] input[data-clave]`)
    .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-clave')));
}
async function irArea(p, nombre) {
  await p.locator(`#areas button:has-text("${nombre}")`).first().click();
  await p.locator('#f').waitFor();
}

/* ── La suite ─────────────────────────────────────────────────────────────── */
const PRUEBAS = [];
const prueba = (nombre, fn, opts) => PRUEBAS.push({ nombre, fn, opts: opts || null });

prueba('T01 la pagina declara de donde salen los campos y cuantos faltan confirmar', async (p) => {
  const t = await p.locator('#fuente').textContent();
  contiene(t, 'data/gestion-operacional.json', 'la cabecera debe decir que la definicion sale del JSON');
  contiene(t, '14 secciones', 'debe contar las 14 secciones de inventario');
  contiene(t, '6 campos por confirmar', 'debe contar los 6 campos inferidos');
});

prueba('T02 se listan las 6 areas de inventario y arranca en la primera', async (p) => {
  const b = await p.locator('#areas button').allTextContents();
  igual(b.length, 6, 'deben ser 6 areas de inventario');
  contiene(b.join(' | '), 'Patio Norte', 'falta Patio Norte');
  contiene(b.join(' | '), 'Planta Talca', 'falta Planta Talca');
  cierto(await p.locator('#areas button.on').first().textContent().then((x) => x.includes('Patio Norte')),
    'la primera area debe quedar seleccionada');
  contiene(await p.locator('.chead h2').first().textContent(), 'Patio Norte', 'el formulario debe ser el de Patio Norte');
});

prueba('T03 si la distribucion supera el total: avisa, marca y no deja enviar', async (p) => {
  const S = 'Resultados inspección REDTEC';
  await campo(p, S, 'inspeccionados').fill('100');
  await campo(p, S, 'buenos').fill('60');
  await campo(p, S, 'malos').fill('30');
  await campo(p, S, 'extranos').fill('20');
  const caja = p.locator(`[data-cuadre="${S}"]`);
  const t = await caja.textContent();
  contiene(t, 'Declarado 100', 'debe mostrar el total declarado');
  contiene(t, 'Distribuido 110', 'debe mostrar la suma distribuida');
  contiene(t, 'Se pasa por 10', 'debe decir por cuanto se paso');
  noContiene(t, 'Sin distribuir', 'si se paso, no corresponde hablar de saldo sin distribuir');
  cierto(await caja.evaluate((n) => n.classList.contains('pasa')), 'la caja del cuadre debe marcarse como pasada');
  const malos = await p.locator(`fieldset[data-sec="${S}"] input.mal`).count();
  igual(malos, 4, 'los 4 campos de la seccion (total + los 3 que distribuyen) deben quedar marcados');
  cierto(await p.locator('#enviar').isDisabled(), 'el boton de envio debe quedar deshabilitado');
  contiene(await p.locator('#estado').textContent(), '1 sección', 'el estado debe decir cuantas secciones se pasaron');
});

prueba('T04 si queda saldo sin distribuir: lo informa y deja enviar', async (p) => {
  const S = 'Resultados inspección REDTEC';
  await campo(p, S, 'inspeccionados').fill('100');
  await campo(p, S, 'buenos').fill('60');
  await campo(p, S, 'malos').fill('30');
  await campo(p, S, 'extranos').fill('5');
  const t = await p.locator(`[data-cuadre="${S}"]`).textContent();
  contiene(t, 'Distribuido 95', 'debe mostrar la suma');
  contiene(t, 'Sin distribuir 5', 'el saldo sin distribuir es informativo, no un error');
  noContiene(t, 'Se pasa por', 'no se paso del total');
  igual(await p.locator(`fieldset[data-sec="${S}"] input.mal`).count(), 0, 'no debe marcar campos en rojo');
  cierto(await p.locator('#enviar').isEnabled(), 'con saldo sin distribuir si se puede enviar');
  igual(await p.locator('#estado').textContent(), '', 'no corresponde aviso de error');
});

prueba('T05 si la distribucion calza exacta con el total: se puede enviar', async (p) => {
  const S = 'Resultados inspección REDTEC';
  await campo(p, S, 'inspeccionados').fill('100');
  await campo(p, S, 'buenos').fill('60');
  await campo(p, S, 'malos').fill('30');
  await campo(p, S, 'extranos').fill('10');
  const t = await p.locator(`[data-cuadre="${S}"]`).textContent();
  contiene(t, 'Sin distribuir 0', 'distribuido completo: saldo 0');
  noContiene(t, 'Se pasa por', 'igualar el total NO es pasarse');
  cierto(await p.locator('#enviar').isEnabled(), 'distribuir exactamente el total debe poder enviarse');
  igual(await p.locator(`fieldset[data-sec="${S}"] input.mal`).count(), 0, 'no debe marcar campos');
});

prueba('T06 la regla del total rige igual en la inspeccion RT (Blancos)', async (p) => {
  const S = 'Resultados inspección RT (Blancos)';
  await campo(p, S, 'inspeccionados').fill('50');
  await campo(p, S, 'buenos').fill('30');
  await campo(p, S, 'malos').fill('15');
  await campo(p, S, 'doble_piso').fill('12');
  contiene(await p.locator(`[data-cuadre="${S}"]`).textContent(), 'Se pasa por 7', 'la regla debe aplicar tambien a RT');
  cierto(await p.locator('#enviar').isDisabled(), 'tambien debe bloquear el envio');
});

prueba('T07 inspeccion RT: etiquetas renombradas y pallet doble piso en vez de extranos', async (p) => {
  const S = 'Resultados inspección RT (Blancos)';
  const et = (await etiquetas(p, S)).map((x) => x.replace(/\s*\*\s*/g, '').trim());
  contiene(et.join(' | '), 'Pallets buenos (por pintar)', 'buenos debe decir "(por pintar)"');
  contiene(et.join(' | '), 'Pallets malos (por reparar)', 'malos debe decir "(por reparar)"');
  contiene(et.join(' | '), 'Pallet doble piso', 'debe aparecer Pallet doble piso');
  noContiene(et.join(' | '), 'extraños', 'en RT ya no va "Pallets extraños"');
  igual(await claves(p, S), ['inspeccionados', 'buenos', 'malos', 'doble_piso'], 'las claves de la seccion');
  cierto(await p.locator(`fieldset[data-sec="${S}"]`).evaluate((n) => n.classList.contains('rt')),
    'la seccion RT debe llevar el borde blanco (clase rt)');
  cierto(await p.locator(`fieldset[data-sec="Resultados inspección REDTEC"]`).evaluate((n) => n.classList.contains('redtec')),
    'la seccion REDTEC debe llevar el borde rojo (clase redtec)');
});

prueba('T08 Inventario RT (Blancos) ya no lleva extranos ni disponibilizados', async (p) => {
  igual(await claves(p, 'Inventario RT (Blancos)'), ['stock_inicial', 'lavados', 'por_inspeccionar'],
    'Inventario RT (Blancos) queda con stock inicial, lavados y por inspeccionar');
  const et = (await etiquetas(p, 'Inventario RT (Blancos)')).join(' | ');
  noContiene(et, 'extraños', 'se saco Pallets extranos');
  noContiene(et, 'disponibilizados', 'se saco Pallets disponibilizados');
});

prueba('T09 Planta 1: sin disponibilizados, sin dotacion, sin total reparados; RT con doble piso', async (p) => {
  await irArea(p, 'Planta 1');
  const todas = (await p.locator('#f label.campo > span').allTextContents()).join(' | ');
  noContiene(todas, 'disponibilizados', 'Planta 1 no lleva Pallets disponibilizados');
  noContiene(todas, 'Dotación', 'Planta 1 no lleva Dotacion');
  noContiene(todas, 'Total reparados', 'Planta 1 no lleva Total reparados');
  noContiene(todas, 'extraños', 'en Planta 1 RT ya no va extranos');
  igual(await claves(p, 'Inventario y producción REDTEC'), ['por_reparar', 'reparados', 'por_pintar'],
    'Planta 1 REDTEC');
  igual(await claves(p, 'Inventario y producción RT (Blancos)'), ['por_reparar', 'reparados', 'por_pintar', 'doble_piso'],
    'Planta 1 RT, con doble piso');
});

prueba('T10 Planta 2 quedo igual que Planta 1', async (p) => {
  await irArea(p, 'Planta 2');
  const todas = (await p.locator('#f label.campo > span').allTextContents()).join(' | ');
  noContiene(todas, 'disponibilizados', 'Planta 2 no lleva Pallets disponibilizados');
  noContiene(todas, 'Dotación', 'Planta 2 no lleva Dotacion');
  noContiene(todas, 'Total reparados', 'Planta 2 no lleva Total reparados');
  noContiene(todas, 'extraños', 'en Planta 2 RT ya no va extranos');
  igual(await claves(p, 'Inventario y producción RT (Blancos)'), ['por_reparar', 'reparados', 'por_pintar', 'doble_piso'],
    'Planta 2 RT, con doble piso');
});

prueba('T11 Despacho Transporte: sin disponibilizados en ninguno de los dos pallets', async (p) => {
  await irArea(p, 'Despacho Transporte');
  noContiene((await p.locator('#f label.campo > span').allTextContents()).join(' | '),
    'disponibilizados', 'Despacho Transporte no lleva Pallets disponibilizados');
  igual(await claves(p, 'Inventario REDTEC'), ['disponibles', 'por_reparar'], 'Despacho REDTEC');
  igual(await claves(p, 'Inventario RT (Blancos)'), ['disponibles', 'por_reparar'], 'Despacho RT');
});

prueba('T12 consumos: fabricacion por operador, identificacion completa y materiales', async (p) => {
  await p.locator('#familias button[data-fam="consumos"]').click();
  await p.locator('#f').waitFor();
  contiene((await p.locator('#areas button').allTextContents()).join(' | '),
    'Fabricación por operador', 'el formulario se llama Fabricacion por operador');
  contiene(await p.locator('.chead h2').first().textContent(), 'Fabricación por operador', 'titulo del formulario');
  noContiene(await p.locator('#formulario').textContent(), 'consolidada', 'ya no se llama produccion consolidada');
  for (const n of ['_fecha', '_supervisor', '_centro', '_area', '_operador'])
    igual(await p.locator(`#f [name="${n}"]`).count(), 1, 'falta el campo de identificacion ' + n);
  igual(await p.locator('#f [name="_centro"] option').allTextContents(), ['Santiago', 'Talca'], 'los dos centros');
  igual(await p.locator('#f [name="_area"] option').allTextContents(), ['Planta 1', 'Planta 2', 'Planta Talca'],
    'las areas donde se fabrica');
  igual(await p.locator('#f [name="uni|madera"] option').allTextContents(), ['Unidades'], 'la madera va en unidades');
  igual(await p.locator('#f [name="uni|clavos"] option').allTextContents(), ['Unidades', 'Rollos'],
    'los clavos van en unidades o rollos');
});

prueba('T13 inventario: enviar NO guarda, solo muestra el payload', async (p, ctx) => {
  await llenarTodo(p, 7);
  await campo(p, 'Resultados inspección REDTEC', 'inspeccionados').fill('100');
  await campo(p, 'Resultados inspección RT (Blancos)', 'inspeccionados').fill('100');
  ctx.pedidos.length = 0;
  await p.locator('#enviar').click();
  await p.locator('#json').waitFor();
  const payload = JSON.parse(await p.locator('#json').textContent());
  igual(payload.familia, 'inventario', 'la familia del payload');
  igual(payload.formulario, 'patio-norte', 'el formulario es el area');
  igual(payload.identificacion.supervisor, 'Prueba Automatica', 'el supervisor va en identificacion');
  cierto(/^\d{4}-\d{2}-\d{2}$/.test(payload.identificacion.fecha), 'la fecha viene en ISO: ' + payload.identificacion.fecha);
  igual(Object.keys(payload.valores).sort(), ['REDTEC', 'RT'], 'los valores van agrupados por pallet');
  igual(Object.keys(payload.valores.RT).sort(),
    ['buenos', 'doble_piso', 'inspeccionados', 'lavados', 'malos', 'por_inspeccionar', 'stock_inicial'],
    'las claves del pallet RT');
  igual(payload.valores.REDTEC.inspeccionados, '100', 'el valor declarado viaja tal cual');
  cierto(!('materiales' in payload), 'un inventario no lleva materiales');
  contiene(await p.locator('#salida').textContent(), 'Todavía no se guarda nada',
    'la pagina debe decir que no guarda');
  contiene(await p.locator('#salida').textContent(), 'OS_STORAGE_CONN',
    'debe quedar anotado el destino cuando se conecte');
  igual(ctx.pedidos, [], 'enviar no debe generar ningun pedido a la red: ' + JSON.stringify(ctx.pedidos));
});

prueba('T14 solo los campos reconstruidos salen marcados "por confirmar"', async (p) => {
  igual(await p.locator('#f .chip').count(), 6, 'en Patio Norte son 6 campos inferidos');
  igual(await p.locator('fieldset[data-sec="Resultados inspección REDTEC"] .chip').count(), 0,
    'los campos de inspeccion si estan confirmados');
  await irArea(p, 'Planta 1');
  igual(await p.locator('#f .chip').count(), 0, 'en Planta 1 no hay campos por confirmar');
});

prueba('T15 el aviso de area no confirmada sale solo donde corresponde', async (p) => {
  igual(await p.locator('#f, .porconfirmar').locator('.porconfirmar').count(), 0, 'Patio Norte esta confirmada');
  igual(await p.locator('.porconfirmar').count(), 0, 'Patio Norte no debe mostrar el aviso');
  await irArea(p, 'Bodega Pintura');
  igual(await p.locator('.porconfirmar').count(), 1, 'Bodega Pintura si debe avisar que no esta confirmada');
  contiene(await p.locator('.porconfirmar').textContent(), 'no está confirmada', 'texto del aviso');
});

prueba('T16 cambiar de area limpia el payload mostrado', async (p) => {
  await llenarTodo(p, 1);
  await campo(p, 'Resultados inspección REDTEC', 'inspeccionados').fill('10');
  await campo(p, 'Resultados inspección RT (Blancos)', 'inspeccionados').fill('10');
  await p.locator('#enviar').click();
  await p.locator('#json').waitFor();
  await irArea(p, 'Planta 2');
  igual(await p.locator('#json').count(), 0, 'al cambiar de area no debe quedar el payload anterior a la vista');
});

prueba('T17 forzar el submit con el cuadre pasado tampoco arma payload', async (p) => {
  const S = 'Resultados inspección REDTEC';
  await llenarTodo(p, 1);
  await campo(p, S, 'inspeccionados').fill('1');
  await campo(p, S, 'buenos').fill('5');
  cierto(await p.locator('#enviar').isDisabled(), 'el boton debe estar deshabilitado');
  await p.evaluate(() => document.getElementById('f').requestSubmit());
  await p.waitForTimeout(120);
  igual(await p.locator('#json').count(), 0, 'enviar() tiene que revisar el cuadre por su cuenta, no confiar en el boton');
});

prueba('T18 con campos vacios o negativos el navegador frena el envio', async (p) => {
  /* La identificacion se llena y los numeros quedan vacios a proposito: asi se
     prueba que son los campos de inventario los que frenan el envio, y no el
     supervisor, que es obligatorio por su cuenta. */
  await p.evaluate(() => {
    document.getElementById('f')
      .querySelectorAll('input:not([type=number]):not([type=date])')
      .forEach((i) => { i.value = 'Prueba Automatica'; });
  });
  cierto(!(await campo(p, 'Inventario REDTEC', 'lavados').evaluate((n) => n.checkValidity())),
    'un campo de inventario vacio no es valido: son obligatorios');
  await p.locator('#enviar').click();
  await p.waitForTimeout(120);
  igual(await p.locator('#json').count(), 0, 'con campos de inventario vacios no se arma payload');
  await llenarTodo(p, 3);
  await campo(p, 'Resultados inspección REDTEC', 'inspeccionados').fill('100');
  await campo(p, 'Resultados inspección RT (Blancos)', 'inspeccionados').fill('100');
  await campo(p, 'Inventario REDTEC', 'lavados').fill('-5');
  cierto(!(await campo(p, 'Inventario REDTEC', 'lavados').evaluate((n) => n.checkValidity())),
    'un valor negativo no es valido: no hay pallets negativos');
  await p.locator('#enviar').click();
  await p.waitForTimeout(120);
  igual(await p.locator('#json').count(), 0, 'con un negativo no se arma payload');
});

prueba('T19 los litros de pintura admiten decimales', async (p) => {
  await irArea(p, 'Bodega Pintura');
  const litros = campo(p, 'Pintura REDTEC', 'litros_pintura');
  igual(await litros.getAttribute('step'), '0.01', 'los litros son decimales');
  await litros.fill('12.5');
  cierto(await litros.evaluate((n) => n.checkValidity()), '12,5 litros debe ser un valor valido');
  igual(await campo(p, 'Pintura REDTEC', 'pintados').getAttribute('step'), '1', 'los pallets pintados son enteros');
});

prueba('T20 consumos: el payload lleva formulario, operador y materiales', async (p, ctx) => {
  await p.locator('#familias button[data-fam="consumos"]').click();
  await p.locator('#f').waitFor();
  await llenarTodo(p, 4);
  ctx.pedidos.length = 0;
  await p.locator('#enviar').click();
  await p.locator('#json').waitFor();
  const payload = JSON.parse(await p.locator('#json').textContent());
  igual(payload.familia, 'consumos', 'la familia');
  igual(payload.formulario, 'fabricacion-operador', 'el formulario, no el area');
  igual(payload.identificacion.operador, 'Prueba Automatica', 'el operador va en identificacion');
  igual(payload.identificacion.area, 'planta-1', 'el area elegida');
  igual(Object.keys(payload.valores), ['REDTEC'], 'la fabricacion es de pallet REDTEC');
  igual(payload.materiales.madera, { cantidad: '4', unidad: 'unidades' }, 'madera con su unidad');
  igual(payload.materiales.clavos, { cantidad: '4', unidad: 'unidades' }, 'clavos con su unidad');
  cierto(!('porRollo' in payload.materiales.clavos), 'en unidades no corresponde el factor del rollo');
  igual(ctx.pedidos, [], 'tampoco acá se manda nada a la red');
});

prueba('T22 si los clavos se cuentan en rollos, el factor declarado viaja con el dato', async (p) => {
  await p.locator('#familias button[data-fam="consumos"]').click();
  await p.locator('#f').waitFor();
  await llenarTodo(p, 4);
  await p.locator('#f [name="uni|clavos"]').selectOption('rollos');
  await p.locator('#enviar').click();
  await p.locator('#json').waitFor();
  const payload = JSON.parse(await p.locator('#json').textContent());
  igual(payload.materiales.clavos, { cantidad: '4', unidad: 'rollos', porRollo: 3000 },
    'el factor del rollo viaja con el dato, sin convertir: todavia esta por confirmar');
  igual(payload.materiales.madera, { cantidad: '4', unidad: 'unidades' },
    'la madera no declara factor y no debe inventarsele uno');
});

prueba('T23 los materiales no se pintan como una seccion de pallet', async (p) => {
  await p.locator('#familias button[data-fam="consumos"]').click();
  await p.locator('#f').waitFor();
  const fs = p.locator('#f fieldset').filter({ hasText: 'Materiales consumidos' }).first();
  cierto(!(await fs.evaluate((n) => n.classList.contains('redtec') || n.classList.contains('rt'))),
    'el borde de color indica tipo de pallet y los materiales no son pallets');
  noContiene(await fs.locator('legend').textContent(), 'base en unidades',
    'la pagina no convierte unidades, asi que no debe decir que todo va en una base');
});

prueba('T21 sin el JSON de definicion la pagina lo dice y no inventa campos', async (p) => {
  contiene(await p.locator('#formulario').textContent(), 'Falta la definición de los formularios',
    'debe avisar que falta el archivo de definicion');
  contiene(await p.locator('#formulario').textContent(), 'data/gestion-operacional.json', 'debe nombrar el archivo');
  igual(await p.locator('#f').count(), 0, 'sin definicion no se pinta ningun formulario');
  igual(await p.locator('#areas button').count(), 0, 'tampoco areas');
  contiene(await p.locator('#fuente').textContent(), 'no se pudo leer', 'la cabecera lo refleja');
}, { sinJson: true, consolaEsperada: /404|Failed to load resource/ });

/* ── Corredor ─────────────────────────────────────────────────────────────── */
async function correr(opts) {
  opts = opts || {};
  const navegador = await chromium.launch();
  const resultados = [];
  let srv = null;

  try {
    for (const t of PRUEBAS) {
      const sinJson = !!(t.opts && t.opts.sinJson);
      preparar({ mutar: opts.mutar, sinJson });
      if (srv) await new Promise((r) => srv.s.close(r));
      srv = await servidor();

      const ctx = { pedidos: [] };
      const pagina = await navegador.newPage();
      pagina.on('request', (r) => {
        const u = r.url();
        if (u === srv.url || u.endsWith('/data/gestion-operacional.json')) return;
        if (u.startsWith('data:')) return;
        ctx.pedidos.push(r.method() + ' ' + u);
      });
      /* Un error de consola hace fallar la prueba: una pagina que se rompe a
         medias igual puede pasar las aserciones. La unica excepcion es el 404
         que una prueba provoca a proposito, y lo declara. */
      const esperada = (t.opts && t.opts.consolaEsperada) || null;
      const consola = [];
      const anotar = (x) => { if (!esperada || !esperada.test(x)) consola.push(x); };
      pagina.on('pageerror', (e) => anotar('pageerror: ' + e.message));
      pagina.on('console', (m) => { if (m.type() === 'error') anotar('console: ' + m.text()); });

      try {
        await pagina.goto(srv.url, { waitUntil: 'load' });
        if (sinJson) await pagina.locator('#formulario .card').waitFor({ timeout: 5000 });
        else await pagina.locator('#f').waitFor({ timeout: 5000 });
        await t.fn(pagina, ctx);
        if (consola.length) throw new Error('la pagina reporto errores: ' + consola.join(' · '));
        resultados.push({ nombre: t.nombre, ok: true });
      } catch (e) {
        resultados.push({ nombre: t.nombre, ok: false, error: e.message + (consola.length ? '\n  consola: ' + consola.join(' · ') : '') });
      }
      await pagina.close();
    }
  } finally {
    if (srv) await new Promise((r) => srv.s.close(r));
    await navegador.close();
  }
  return resultados;
}

(async function principal() {
  const args = process.argv.slice(2);
  const unaMutacion = (args.find((a) => a.startsWith('--mutar=')) || '').split('=')[1];
  const todas = args.includes('--mutaciones');

  if (todas) {
    console.log('MUTACIONES · cada una debe hacer FALLAR al menos una prueba\n');
    let sobrevivientes = 0;
    for (const id of Object.keys(MUTACIONES)) {
      let r;
      try { r = await correr({ mutar: id }); }
      catch (e) { console.log(id + '  ERROR al aplicar: ' + e.message); sobrevivientes++; continue; }
      const fallan = r.filter((x) => !x.ok);
      const estado = fallan.length ? 'MUERTA ' : 'VIVE   ';
      if (!fallan.length) sobrevivientes++;
      console.log(estado + id + '  ' + MUTACIONES[id].que);
      console.log('        ' + (fallan.length
        ? 'la detectan: ' + fallan.map((x) => x.nombre.split(' ')[0]).join(', ')
        : '*** NINGUNA PRUEBA LA DETECTA ***'));
    }
    console.log('\nMutaciones vivas: ' + sobrevivientes + ' de ' + Object.keys(MUTACIONES).length);
    process.exit(sobrevivientes ? 1 : 0);
  }

  const r = await correr({ mutar: unaMutacion || null });
  if (unaMutacion) console.log('MUTACION APLICADA: ' + unaMutacion + ' · ' + MUTACIONES[unaMutacion].que + '\n');
  r.forEach((x) => {
    console.log((x.ok ? '  ok   ' : '  FALLA') + ' ' + x.nombre);
    if (!x.ok) console.log('         ' + x.error.split('\n').join('\n         '));
  });
  const malas = r.filter((x) => !x.ok).length;
  console.log('\n' + (r.length - malas) + ' de ' + r.length + ' pruebas pasan' + (malas ? ' · ' + malas + ' fallan' : ''));
  process.exit(malas ? 1 : 0);
})();
