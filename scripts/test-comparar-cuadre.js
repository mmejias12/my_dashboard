// scripts/test-comparar-cuadre.js
// ============================================================================
//  Pruebas de comparar-cuadre.js. Todo lo que se prueba aca es PURO: ni red ni
//  blob. Lo que toca credenciales (main) no se prueba a proposito — lo que hay
//  que probar es el criterio, no la cañeria.
//
//  Uso:
//    node scripts/test-comparar-cuadre.js
//    node scripts/test-comparar-cuadre.js --mutaciones
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ORIGEN = path.join(__dirname, 'comparar-cuadre.js');

const MUTACIONES = {
  H01: { que: 'la brecha de la identidad sale con el signo al reves',
         de: 'brecha: declarado - calculado,', a: 'brecha: calculado - declarado,' },
  H02: { que: 'la identidad siempre dice que cuadra',
         de: 'cuadra: declarado === calculado', a: 'cuadra: true' },
  H03: { que: 'las entradas de la identidad se calculan con los conceptos que restan',
         de: 'const entradas = s.mas.reduce', a: 'const entradas = s.menos.reduce' },
  H04: { que: 'la diferencia se calcula proveedor menos nuestro',
         de: 'dif: (enP && enN) ? n - p : null,', a: 'dif: (enP && enN) ? p - n : null,' },
  H05: { que: 'un campo que no viene se cuenta como cero',
         de: 'const n = enN ? num(nuestro[k]) : null;', a: 'const n = num(nuestro[k]);' },
  H06: { que: 'los dias que faltan en el blob dejan de explicar la diferencia',
         de: '  if (faltantes && faltantes.length) {', a: '  if (false) {' },
  H07: { que: 'solo se miran las diferencias hacia arriba',
         de: 'const distintos = comparables.filter(f => f.dif !== 0);',
         a: 'const distintos = comparables.filter(f => f.dif > 0);' },
  H08: { que: 'sin respuesta del proveedor igual dice que calza',
         de: "  if (!hayProveedor) return { codigo: 4, texto: 'sin dato del proveedor' };",
         a: "  if (!hayProveedor) return { codigo: 0, texto: 'calza' };" },
  H09: { que: 'la comparacion deja fuera los conceptos y mira solo el nivel',
         de: "    .concat(FLUJOS[universo] || []);", a: '    .concat([]);' },
  H10: { que: 'el tope del proveedor se cree mas chico de lo que es',
         de: 'const MAX_DIAS_PROVEEDOR = 180;', a: 'const MAX_DIAS_PROVEEDOR = 90;' },
  H11: { que: 'el conteo de dias deja de ser inclusivo',
         de: 'return Math.round((b - a) / 86400000) + 1;', a: 'return Math.round((b - a) / 86400000);' },
  H12: { que: 'un valor no numerico pasa como numero',
         de: 'const n = Number(v); return Number.isFinite(n) ? n : 0;', a: 'const n = Number(v); return n;' },
  H13: { que: 'los signos de clientes se presentan como verificados',
         de: '    verificado: false,', a: '    verificado: true,' }
};

/* ── Datos de prueba ───────────────────────────────────────────────────────
   El cierre 2025 de retail que Mauro saco del propio M2LINK. Se usa tal cual
   PORQUE NO CUADRA: es la prueba de que la identidad detecta el defecto del
   proveedor en vez de taparlo.                                              */
const RETAIL_2025 = {
  saldoInicial: 531242, saldoFinal: 532584, diferencia: 1342,
  transferencias: 1071862, salidaPalletReconfirmar: 60912, otrasEntradas: 281,
  entradaPalletReversa: 140708, retiros: 989183, otrasSalidas: 87, reubicacionSistema: 4329
};
/* El mismo, pero arreglado para que cierre: sirve de control positivo. */
function retailQueCuadra() {
  const c = Object.assign({}, RETAIL_2025);
  c.saldoFinal = c.saldoInicial +
    (c.transferencias + c.salidaPalletReconfirmar + c.otrasEntradas) -
    (c.entradaPalletReversa + c.retiros + c.otrasSalidas + c.reubicacionSistema);
  return c;
}

/* ── Aserciones ───────────────────────────────────────────────────────────── */
function igual(a, b, que) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(que + '\n  esperado: ' + y + '\n  obtenido: ' + x);
}
function cierto(v, que) { if (!v) throw new Error(que); }

const PRUEBAS = [];
const prueba = (nombre, fn) => PRUEBAS.push({ nombre, fn });

prueba('T01 la identidad de retail reproduce el defecto del proveedor', (M) => {
  const id = M.identidad('retail', RETAIL_2025);
  igual(id.entradas, 1133055, 'entradas = transferencias + reconfirmar + otras entradas');
  igual(id.salidas, 1134307, 'salidas = reversa + retiros + otras salidas + reubicacion');
  igual(id.calculado, 529990, 'lo que dan sus propias lineas');
  igual(id.declarado, 532584, 'lo que el proveedor declara de cierre');
  igual(id.brecha, 2594, 'la brecha medida, con signo: declara 2.594 de mas');
  cierto(!id.cuadra, 'el cuadre del proveedor NO cuadra consigo mismo y hay que decirlo');
});

prueba('T02 un cuadre bien armado cuadra', (M) => {
  const id = M.identidad('retail', retailQueCuadra());
  cierto(id.cuadra, 'con el cierre despejado de sus propias lineas tiene que cuadrar');
  igual(id.brecha, 0, 'sin brecha');
});

prueba('T03 clientes usa sus propios signos y estan marcados como hipotesis', (M) => {
  cierto(M.SIGNOS.retail.verificado, 'retail esta verificado y documentado en stock-fetch');
  cierto(!M.SIGNOS.clientes.verificado, 'clientes es hipotesis: no puede ir marcado como verificado');
  const id = M.identidad('clientes', {
    saldoInicial: 100, saldoFinal: 140,
    emision: 70, entradaPalletReversa: 10,          // suman 80
    devolucion: 20, transferencias: 15, salidaPalletReconfirmar: 5  // restan 40
  });
  igual(id.entradas, 80, 'emision + reversa');
  igual(id.salidas, 40, 'devolucion + transferencias + reconfirmar');
  igual(id.calculado, 140, '100 + 80 - 40');
  cierto(id.cuadra, 'con la hipotesis puesta, este caso cierra');
});

prueba('T04 los signos cubren exactamente los conceptos de stock-fetch', (M) => {
  const { FLUJOS } = require('../api/shared/stock-fetch');
  M.UNIVERSOS.forEach(function (u) {
    const s = M.SIGNOS[u];
    const declarados = s.mas.concat(s.menos).sort();
    igual(declarados, (FLUJOS[u] || []).slice().sort(),
      'los conceptos con signo de ' + u + ' tienen que ser los mismos de FLUJOS: si alguien ' +
      'agrega un flujo y no le da signo, la identidad queda corta y nadie se entera');
    igual(s.mas.filter(k => s.menos.indexOf(k) >= 0), [],
      'ningun concepto puede sumar y restar a la vez en ' + u);
  });
});

prueba('T05 la comparacion incluye el nivel, los totales y los conceptos', (M) => {
  const c = M.camposDe('retail');
  ['saldoInicial', 'saldoFinal', 'diferencia', 'totalEntradas', 'totalSalida',
   'transferencias', 'retiros', 'reubicacionSistema'].forEach(function (k) {
    cierto(c.indexOf(k) >= 0, 'falta el campo ' + k);
  });
});

prueba('T06 la diferencia es nuestro menos proveedor', (M) => {
  const f = M.comparar({ saldoFinal: 100 }, { saldoFinal: 112 }, 'retail')
    .find(x => x.campo === 'saldoFinal');
  igual(f.proveedor, 100, 'el valor del proveedor');
  igual(f.nuestro, 112, 'el nuestro');
  igual(f.dif, 12, 'positivo = nosotros traemos mas, igual que en rollup-hist');
});

prueba('T07 un campo que no viene no es un cero', (M) => {
  const f = M.comparar({ totalEntradas: 500 }, { saldoFinal: 1 }, 'retail')
    .find(x => x.campo === 'totalEntradas');
  igual(f.nuestro, null, 'leerRango no suma totalEntradas: eso NO es cero');
  igual(f.dif, null, 'sin los dos lados no hay diferencia que calcular');
  igual(f.falta, 'nuestro', 'tiene que decir de que lado falta');
  const g = M.comparar({ saldoFinal: 1 }, { retiros: 9 }, 'retail').find(x => x.campo === 'retiros');
  igual(g.falta, 'proveedor', 'y al reves tambien');
});

prueba('T08 veredicto: calza cuando todo lo comparable es identico', (M) => {
  const filas = M.comparar(RETAIL_2025, RETAIL_2025, 'retail');
  igual(M.veredicto(filas, [], true).codigo, 0, 'dos lados identicos calzan');
});

prueba('T09 veredicto: difiere cuando un concepto no coincide', (M) => {
  const otro = Object.assign({}, RETAIL_2025, { retiros: RETAIL_2025.retiros + 7 });
  const v = M.veredicto(M.comparar(RETAIL_2025, otro, 'retail'), [], true);
  igual(v.codigo, 3, 'un concepto distinto es diferencia de verdad');
});

prueba('T10 veredicto: una diferencia hacia abajo cuenta igual', (M) => {
  const otro = Object.assign({}, RETAIL_2025, { retiros: RETAIL_2025.retiros - 7 });
  igual(M.veredicto(M.comparar(RETAIL_2025, otro, 'retail'), [], true).codigo, 3,
    'traer de MENOS es tan diferencia como traer de mas');
});

prueba('T11 veredicto: los dias que faltan en el blob explican la diferencia', (M) => {
  const otro = Object.assign({}, RETAIL_2025, { retiros: RETAIL_2025.retiros - 500 });
  const v = M.veredicto(M.comparar(RETAIL_2025, otro, 'retail'), ['2026-03-01', '2026-03-02'], true);
  igual(v.codigo, 2, 'con dias faltantes la diferencia esta explicada, no es un defecto del metodo');
  cierto(/2 dia/.test(v.texto), 'y dice cuantos: ' + v.texto);
});

prueba('T12 veredicto: si solo difieren los totales se dice aparte', (M) => {
  const filas = M.comparar(
    Object.assign({}, RETAIL_2025, { totalEntradas: 1133055 }),
    Object.assign({}, RETAIL_2025, { totalEntradas: 0 }), 'retail');
  igual(M.veredicto(filas, [], true).codigo, 1,
    'leerRango no suma los totales: eso es cañeria conocida, no desacuerdo de dato');
});

prueba('T13 veredicto: sin proveedor no se puede decir que calza', (M) => {
  const filas = M.comparar(null, RETAIL_2025, 'retail');
  igual(M.veredicto(filas, [], false).codigo, 4, 'sin el otro lado no hay veredicto posible');
});

prueba('T14 la bateria por defecto cubre los casos que pueden fallar distinto', (M) => {
  const r = M.rangosPorDefecto('2026-11-05');
  igual(r.length, 5, 'cinco rangos');
  r.forEach(function (x) {
    cierto(x.desde <= x.hasta, 'el rango ' + x.nombre + ' esta al reves: ' + x.desde + '..' + x.hasta);
    cierto(/^\d{4}-\d{2}-\d{2}$/.test(x.desde) && /^\d{4}-\d{2}-\d{2}$/.test(x.hasta),
      'fechas ISO en ' + x.nombre);
  });
  const cruza = r.find(x => x.nombre === 'cruzando el mes');
  cierto(cruza.desde.slice(0, 7) !== cruza.hasta.slice(0, 7),
    'el rango que cruza el mes tiene que cruzarlo de verdad: ' + cruza.desde + '..' + cruza.hasta);
  const tope = r.find(x => x.nombre === 'tope del proveedor');
  igual(M.diasEntre(tope.desde, tope.hasta), M.MAX_DIAS_PROVEEDOR,
    'el rango tope tiene que medir exactamente el tope que declara stock-fetch');
});

prueba('T17 el tope de dias es el que declara stock-fetch, no uno inventado', (M) => {
  /* La prueba de arriba comparaba el tope CONSIGO MISMO, asi que pasaba con
     cualquier valor. El tope no es una preferencia nuestra: lo declara el
     encabezado de stock-fetch.js ("usar solo con rangos <=180 dias"). Se
     amarra a esa fuente para que cambiarlo de un lado rompa aca. */
  igual(M.MAX_DIAS_PROVEEDOR, 180, 'el tope que declara stock-fetch');
  const texto = fs.readFileSync(path.join(__dirname, '..', 'api', 'shared', 'stock-fetch.js'), 'utf8');
  cierto(texto.indexOf(String(M.MAX_DIAS_PROVEEDOR)) >= 0,
    'stock-fetch.js ya no menciona ' + M.MAX_DIAS_PROVEEDOR + ': el tope cambio en el origen ' +
    'y hay que actualizarlo aca, no al reves');
});

prueba('T15 el conteo de dias es inclusivo', (M) => {
  igual(M.diasEntre('2026-11-05', '2026-11-05'), 1, 'un solo dia es un dia, no cero');
  igual(M.diasEntre('2026-11-01', '2026-11-30'), 30, 'noviembre entero');
  igual(M.diasEntre('2026-02-28', '2026-03-01'), 2, 'cruzando el mes');
});

prueba('T16 un valor que no es numero vale cero', (M) => {
  igual(M.num(''), 0, 'vacio');
  igual(M.num(null), 0, 'nulo');
  igual(M.num('no soy un numero'), 0, 'texto');
  igual(M.num('12'), 12, 'texto numerico si vale');
  igual(M.num(0), 0, 'el cero explicito sigue siendo cero');
});

/* ── Corredor ─────────────────────────────────────────────────────────────── */
function cargar(mutar) {
  let src = fs.readFileSync(ORIGEN, 'utf8');
  if (mutar) {
    const m = MUTACIONES[mutar];
    const partes = src.split(m.de);
    if (partes.length !== 2) {
      throw new Error('la mutacion ' + mutar + ' no calza exactamente una vez (' +
        (partes.length - 1) + '). Patron: ' + JSON.stringify(m.de));
    }
    src = partes[0] + m.a + partes[1];
  }
  const tmp = path.join(__dirname, '.comparar-cuadre.prueba.js');
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
