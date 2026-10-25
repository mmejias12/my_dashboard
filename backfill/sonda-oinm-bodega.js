// ============================================================================
//  backfill/sonda-oinm-bodega.js  ·  M3DATA · el nivel por bodega, desde SAP
//
//  QUE CONTESTA. Cuantos pallets rojos hay en cada bodega de SAP, sacados por
//  nosotros del Service Layer, sin pasar por WAVE y sin acumular una serie de
//  deltas desde el principio de los tiempos.
//
//  POR QUE HACE FALTA. Medimos el nivel de clientes y retail sumando deltas
//  sobre una semilla, y la semilla salia de la capa de ubicaciones
//  (hx_binpallets). Al 2026-10-23 el movimiento de las dos rutas coincidia
//  —+0,56% en clientes, +4,89% en retail— pero el NIVEL no: -0,64% y -5,73%.
//  Despejando la apertura al 2025-12-31, la semilla estaba corta en 1.522 y
//  34.928 pallets. La causa no es un error de calculo: la capa de ubicaciones
//  solo ve los pallets que TIENEN ubicacion asignada, y los que estan en la
//  bodega sin asignar no aparecen por ninguna parte.
//
//  O SEA: ninguna fuente sola sirve. La bodega manda en CUANTOS hay; la
//  ubicacion manda en DE QUIEN son. Esta sonda trae la primera mitad.
//
//  LA LECCION QUE YA PAGAMOS. sonda-sap-saldo.js dictamino "SI hay camino"
//  porque encontro MaximumQty y MinimumQty y las leyo como saldo: eran
//  limites de capacidad, los dos en cero. Aca las cantidades se reparten
//  antes de mirarlas y SOLO la clase 'saldo' cuenta. Un comprometido no es
//  un saldo y un limite menos todavia.
//
//  SOLO LEE DE SAP. No escribe en SAP ni en el storage. Con --salida escribe
//  un archivo local, que es lo que se le pidio, no un efecto de costado.
//
//  Credenciales SOLO por variable de entorno.
//      SAP_LOGIN_URL · SAP_USER · SAP_PASS · SAP_DB
//
//  Uso (PowerShell):
//    node backfill/sonda-oinm-bodega.js
//    node backfill/sonda-oinm-bodega.js --item=11111111110
//    node backfill/sonda-oinm-bodega.js --todas      (incluye bodegas en cero)
//    node backfill/sonda-oinm-bodega.js --salida=backfill/bodegas-hoy.json
//    node backfill/sonda-oinm-bodega.js --json       (json puro a stdout)
//
//  OJO CON POWERSHELL: '>' escribe UTF-16LE con BOM y eso no es JSON valido.
//  Por eso existe --salida: node escribe UTF-8 sin BOM siempre, y no depende
//  de como este configurada la consola.
// ============================================================================
'use strict';

const S = require('./backfill-sap.js');

const args = process.argv.slice(2);
const OPCIONES = ['item', 'salida'];
const BANDERAS = ['todas', 'json'];
const opcion = (n, d) => {
  const p = '--' + n + '=';
  for (const a of args) if (a.indexOf(p) === 0) return a.slice(p.length);
  return d;
};
const bandera = n => args.indexOf('--' + n) >= 0;
const mil = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 });
// Con --json, stdout es SOLO para la maquina y el reporte se va a stderr. Si
// los dos salieran por stdout, redirigir a un archivo daria texto mezclado
// con json y ningun parser lo leeria —fue exactamente lo que paso la primera
// vez--. El humano igual ve el reporte, por el otro canal.
//
// La decision de canal vive en una funcion aparte para que se pueda probar:
// metida adentro del cierre no habria forma de verificarla sin correr main().
function canalReporte(esJson, escribirOk, escribirErr) { return esJson ? escribirErr : escribirOk; }
const di = (...a) => canalReporte(bandera('json'), console.log, console.error)(...a);

// ── lo puro ─────────────────────────────────────────────────────────────────

// LO QUE PROTEGE ES EL ANCLA, NO EL ORDEN. Conviene decirlo bien porque la
// tentacion es al reves. MinimalStock y MaximalStock contienen la palabra
// Stock —ese fue el error de sonda-sap-saldo.js, leer un limite como saldo—,
// y lo que lo impide es que RE_SALDO exija la cadena COMPLETA: '^stock$' no
// matchea 'MinimalStock'. Como RE_LIMITE exige empezar con min/max, los dos
// patrones son disjuntos: ninguna cadena puede ser exactamente 'stock' y
// empezar con 'min'. El orden entre ellos es cosmetico y da igual.
// Quien le saque el ancla a RE_SALDO rompe esto, y el orden no lo va a
// salvar. Hay una prueba para eso: StockValue tiene que quedar en 'ambigua'.
// (Mutante equivalente conocido: intercambiar limite y saldo. Por lo de
// arriba no puede cambiar ninguna clasificacion.)
const RE_LIMITE     = /^(minimal|maximal|minimum|maximum|min|max)/i;
const RE_COMPROMISO = /^(committed|ordered|reserved|comprometido|pedido)/i;
const RE_SALDO      = /^(instock|in_stock|onhand|on_hand|stock)$/i;
const RE_AMBIGUA    = /(quantity|qty|stock|saldo|existencia)/i;

/** Reparte los campos numericos de una fila de bodega en cuatro clases.
 *  Devuelve TODAS, incluida la ambigua, porque una cantidad que no se supo
 *  clasificar hay que poder verla: callarla es como no haberla encontrado. */
function clasificarCantidades(obj) {
  const out = [];
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    // Un solo guardia: deja fuera nulos, colecciones, textos y —esto importa—
    // un numero que viene como string. Si pasara, el saldo seria '500' y el
    // total lo concatenaria en vez de sumarlo.
    if (typeof v !== 'number') continue;
    let clase = null;
    if (RE_LIMITE.test(k)) clase = 'limite';
    else if (RE_COMPROMISO.test(k)) clase = 'compromiso';
    else if (RE_SALDO.test(k)) clase = 'saldo';
    else if (RE_AMBIGUA.test(k)) clase = 'ambigua';
    if (!clase) continue;
    out.push({ campo: k, valor: v, clase });
  }
  return out.sort((a, b) => a.campo.localeCompare(b.campo));
}

/** El saldo de una fila de bodega: la UNICA clase que dicta es 'saldo'.
 *  Si hay mas de un campo de saldo no se elige uno a dedo: se devuelve null y
 *  se dice, porque adivinar cual de dos es el bueno fue el error anterior. */
function saldoDeFila(obj) {
  const c = clasificarCantidades(obj).filter(x => x.clase === 'saldo');
  if (c.length !== 1) return { saldo: null, motivo: c.length ? 'mas de un campo de saldo: ' +
                                 c.map(x => x.campo).join(', ') : 'ningun campo de saldo' };
  return { saldo: c[0].valor, campo: c[0].campo, motivo: null };
}

/** El nivel por bodega. Una fila sin codigo de bodega no se cuenta en el
 *  total: un saldo que no se sabe donde esta no es un saldo ubicado. */
function nivelPorBodega(filas) {
  const out = [], sinCodigo = [], sinSaldo = [];
  for (const f of (filas || [])) {
    if (!f) continue;
    const whs = f.WarehouseCode == null ? null : String(f.WarehouseCode).trim();
    const s = saldoDeFila(f);
    if (!whs) { sinCodigo.push(s); continue; }
    if (s.saldo == null) { sinSaldo.push({ whs, motivo: s.motivo }); continue; }
    out.push({ whs, saldo: s.saldo, campo: s.campo });
  }
  return { filas: out.sort((a, b) => b.saldo - a.saldo), sinCodigo, sinSaldo };
}

/** El catalogo de bodegas: nombre, si maneja ubicaciones y si esta inactiva.
 *  EnableBinLocations es el campo que explica por que clientes y retail se
 *  pueden abrir por socio y las de planta no. */
function mapaBodegas(filas) {
  const m = new Map();
  for (const w of (filas || [])) {
    if (!w || w.WarehouseCode == null) continue;
    m.set(String(w.WarehouseCode).trim(), {
      nombre: w.WarehouseName == null ? null : String(w.WarehouseName),
      conUbicaciones: w.EnableBinLocations === 'tYES' || w.EnableBinLocations === true,
      inactiva: w.Inactive === 'tYES' || w.Inactive === true,
    });
  }
  return m;
}

/** Junta nivel con catalogo. Una bodega con saldo que NO esta en el catalogo
 *  se marca y no se descarta: es la clase de hueco que despues aparece como
 *  una diferencia que nadie sabe de donde sale. */
function juntar(niveles, mapa) {
  return (niveles || []).map(n => {
    const w = (mapa && mapa.get) ? mapa.get(n.whs) : null;
    return Object.assign({}, n, {
      nombre: (w && w.nombre) || null,
      conUbicaciones: w ? w.conUbicaciones : null,
      inactiva: w ? w.inactiva : null,
      enCatalogo: !!w,
    });
  });
}

/** LA FLOTA, partida por si la bodega maneja ubicaciones o no. Ese corte es
 *  el que importa: lo que esta en una bodega CON ubicaciones se puede abrir
 *  por socio, lo que esta en una SIN ubicaciones nunca se va a poder. */
function totalFlota(filas) {
  const f = (filas || []).filter(Boolean);
  const con = f.filter(x => x.conUbicaciones === true);
  const sin = f.filter(x => x.conUbicaciones === false);
  const desc = f.filter(x => x.conUbicaciones == null);
  const sum = xs => xs.reduce((a, x) => a + (Number(x.saldo) || 0), 0);
  return { total: sum(f), bodegas: f.length,
           conUbicaciones: sum(con), nConUbicaciones: con.length,
           sinUbicaciones: sum(sin), nSinUbicaciones: sin.length,
           desconocidas: sum(desc), nDesconocidas: desc.length,
           negativas: f.filter(x => x.saldo < 0) };
}

/** EL CONTROL. La bodega dice cuantos hay; las ubicaciones dicen de quien son.
 *  Lo que sobra son pallets en la bodega sin ubicacion asignada: no es un
 *  error que haya, es una categoria que existe. El error seria no mostrarla.
 *  Un residuo NEGATIVO si es imposible: las ubicaciones no pueden sumar mas
 *  que la bodega que las contiene. */
function residuo(nivelBodega, sumaUbicaciones) {
  // Number(null) es 0 y Number('') tambien: sin este guardia una bodega SIN
  // nivel se leeria como una bodega EN CERO, y el control dispararia
  // "imposible" por un dato que falta en vez de por un dato que esta mal.
  const crudo = [nivelBodega, sumaUbicaciones];
  if (crudo.some(x => x == null || x === '' || typeof x === 'boolean')) return null;
  const b = Number(nivelBodega), u = Number(sumaUbicaciones);
  if (!isFinite(b) || !isFinite(u)) return null;
  const r = b - u;
  return { bodega: b, ubicaciones: u, residuo: r,
           porcentaje: b ? r / b : null,
           imposible: r < 0 };
}

function veredicto(t, rutas) {
  if (!t || !t.bodegas) return { nivel: 'no', texto:
    'Ninguna bodega devolvio saldo. ' +
    (rutas && rutas.length ? 'Rutas probadas: ' + rutas.map(r => r.url + ' -> ' + r.estado).join(' · ')
                           : 'No se probo ninguna ruta.') };
  const p = [];
  p.push('SI hay camino propio al nivel por bodega: ' + t.bodegas + ' bodegas con saldo, ' +
         mil(t.total) + ' pallets en total.');
  p.push(mil(t.conUbicaciones) + ' estan en bodegas CON ubicaciones (' + t.nConUbicaciones +
         '), que se pueden abrir por socio; ' + mil(t.sinUbicaciones) + ' en bodegas SIN ubicaciones (' +
         t.nSinUbicaciones + '), que no se van a poder abrir nunca.');
  if (t.nDesconocidas)
    p.push(t.nDesconocidas + ' bodega(s) con saldo no estan en el catalogo de bodegas (' +
           mil(t.desconocidas) + ' pallets): no se sabe si manejan ubicaciones.');
  if (t.negativas.length)
    p.push('OJO: ' + t.negativas.length + ' bodega(s) con saldo NEGATIVO (' +
           t.negativas.map(x => x.whs + ' ' + mil(x.saldo)).join(', ') +
           '). Una bodega no puede tener menos de cero.');
  return { nivel: 'si', texto: p.join('  ') };
}

/** Las rutas al nivel por bodega, en orden de preferencia. La primera que
 *  conteste manda; las demas se reportan igual, porque saber cual NO sirve
 *  vale tanto como saber cual si. */
/** La fila que se imprime de muestra. La primera que venga suele ser una
 *  bodega vacia —'01 ALMACEN POR DEFECTO' con todo en cero— y entonces el
 *  bloque de clases no muestra ningun valor de verdad: se ve igual que si la
 *  ruta no hubiera traido nada. Se elige la de mayor saldo en valor absoluto,
 *  que es la que permite ver que campo es cual. */
function filaMuestra(filas) {
  let mejor = null, max = -1;
  for (const f of (filas || [])) {
    if (!f) continue;
    if (!mejor) mejor = f;
    const s = saldoDeFila(f).saldo;
    if (s == null) continue;
    const a = Math.abs(s);
    if (a > max) { max = a; mejor = f; }
  }
  return mejor;
}

/** La salida para otro programa. La sonda no escribe archivos —eso es trabajo
 *  de un backfill— pero imprimir en stdout deja que la redirija quien la
 *  corre, sin que este script toque el disco ni el storage. */
function salidaJson(filas, total, item, generado) {
  return {
    _que_es: 'Nivel de pallet por bodega leido del Service Layer de SAP (InStock). ' +
             'Es el saldo vivo, no una serie acumulada: no depende de ninguna semilla.',
    _ojo: 'Es el nivel de HOY. Para una fecha pasada hay que restarle los movimientos ' +
          'desde esa fecha; ItemWarehouseInfoCollection no guarda historia.',
    item: item || null,
    generado: generado || new Date().toISOString(),
    flota: total ? total.total : null,
    conUbicaciones: total ? total.conUbicaciones : null,
    sinUbicaciones: total ? total.sinUbicaciones : null,
    bodegas: (filas || []).map(f => ({
      whs: f.whs, nombre: f.nombre, saldo: f.saldo,
      conUbicaciones: f.conUbicaciones, inactiva: f.inactiva, enCatalogo: f.enCatalogo,
    })),
  };
}

function urlsNivel(raiz, item) {
  const i = String(item == null ? '' : item).trim();
  if (!raiz || !i) return [];
  const q = "Items('" + i.replace(/'/g, "''") + "')";
  return [raiz + '/' + q + '/ItemWarehouseInfoCollection',
          raiz + '/' + q + '?$select=ItemCode,ItemName,ItemWarehouseInfoCollection',
          raiz + '/' + q];
}

function urlBodegas(raiz, top, skip) {
  if (!raiz) return null;
  return raiz + '/Warehouses?$select=' +
         encodeURIComponent('WarehouseCode,WarehouseName,EnableBinLocations,Inactive') +
         '&$orderby=' + encodeURIComponent('WarehouseCode asc') +
         '&$top=' + (top || 200) + '&$skip=' + (skip || 0);
}

/** De lo que conteste el Service Layer, sacar la lista de bodegas, venga
 *  envuelta en 'value', colgada del item, o pelada. */
function filasDeRespuesta(json) {
  if (!json) return null;
  if (Array.isArray(json.value)) return json.value;
  if (Array.isArray(json.ItemWarehouseInfoCollection)) return json.ItemWarehouseInfoCollection;
  if (Array.isArray(json)) return json;
  return null;
}

module.exports = { clasificarCantidades, saldoDeFila, nivelPorBodega, mapaBodegas,
                   juntar, totalFlota, residuo, veredicto, urlsNivel, urlBodegas,
                   filaMuestra, salidaJson, canalReporte,
                   filasDeRespuesta, RE_LIMITE, RE_COMPROMISO, RE_SALDO, RE_AMBIGUA,
                   OPCIONES, BANDERAS };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const falta = ['SAP_LOGIN_URL', 'SAP_USER', 'SAP_PASS', 'SAP_DB'].filter(k => !process.env[k]);
  if (falta.length) {
    console.error('Faltan variables de entorno: ' + falta.join(', '));
    console.error('Se declaran en la sesion, nunca en el codigo.');
    process.exit(1);
  }
  const item = opcion('item', '11111111110');
  const raiz = S.raizDatos(process.env.SAP_LOGIN_URL);
  const ses = S.crearSesion();

  di('Sonda OINM por bodega   ·  item ' + item + '   ·  base ' + process.env.SAP_DB);
  di('Raiz: ' + raiz);
  di('SOLO LEE. No escribe en SAP ni en el storage.\n');

  // ── el nivel por bodega ───────────────────────────────────────────────────
  const rutas = [];
  let crudas = null, rutaBuena = null;
  for (const u of urlsNivel(raiz, item)) {
    let estado = '?';
    try {
      const r = await ses.get(u);
      estado = 'HTTP ' + r.status;
      if (r.status === 200) {
        const f = filasDeRespuesta(r.json);
        if (f && f.length) { crudas = f; rutaBuena = u; estado += ' · ' + f.length + ' filas'; }
        else estado += ' · vino sin filas: no dice nada';
      }
    } catch (e) { estado = 'error ' + String(e.message || e).slice(0, 80); }
    rutas.push({ url: u.replace(raiz, '…'), estado });
    if (crudas) break;
  }
  di('── RUTAS AL NIVEL ' + '─'.repeat(56));
  for (const r of rutas) console.log('  ' + r.estado.padEnd(34) + r.url);

  if (!crudas) {
    const v = veredicto(null, rutas);
    di('\n── VEREDICTO ' + '─'.repeat(61) + '\n  ' + v.texto + '\n');
    process.exit(1);
  }

  // Que campos trajo de verdad, repartidos. Esto se imprime SIEMPRE: es la
  // parte que la vez pasada no mire y por eso dictamine mal.
  const muestra = clasificarCantidades(filaMuestra(crudas));
  di('\n── LAS CANTIDADES QUE TRAE CADA FILA ' + '─'.repeat(37));
  for (const c of muestra)
    di('  ' + c.clase.padEnd(12) + c.campo.padEnd(28) + String(c.valor).padStart(12));
  if (!muestra.some(c => c.clase === 'saldo'))
    di('  (ninguna de clase saldo: el nivel no se puede leer de aca)');

  const niv = nivelPorBodega(crudas);
  if (niv.sinCodigo.length) console.log('\n  ' + niv.sinCodigo.length + ' fila(s) sin codigo de bodega: no entran al total.');
  if (niv.sinSaldo.length) {
    di('\n  ' + niv.sinSaldo.length + ' bodega(s) sin saldo legible:');
    for (const x of niv.sinSaldo.slice(0, 10)) console.log('     ' + x.whs.padEnd(14) + x.motivo);
  }

  // ── el catalogo de bodegas ────────────────────────────────────────────────
  const cat = [];
  for (let skip = 0; ; skip += 200) {
    const r = await ses.get(urlBodegas(raiz, 200, skip));
    if (r.status !== 200) { console.log('\n  catalogo de bodegas: HTTP ' + r.status); break; }
    const f = filasDeRespuesta(r.json) || [];
    cat.push.apply(cat, f);
    if (f.length < 200) break;
  }
  const mapa = mapaBodegas(cat);
  const filas = juntar(niv.filas, mapa);
  const t = totalFlota(filas);

  di('\n── EL NIVEL POR BODEGA ' + '─'.repeat(51));
  di('  ' + 'bodega'.padEnd(12) + 'nombre'.padEnd(32) + 'saldo'.padStart(11) + '   ubicaciones');
  for (const f of filas) {
    if (!bandera('todas') && f.saldo === 0) continue;
    di('  ' + f.whs.padEnd(12) + String(f.nombre || '(sin catalogo)').slice(0, 31).padEnd(32) +
                mil(f.saldo).padStart(11) + '   ' +
                (f.conUbicaciones === null ? '?' : f.conUbicaciones ? 'si' : 'no') +
                (f.inactiva ? '   (inactiva)' : ''));
  }
  if (!bandera('todas')) {
    const ceros = filas.filter(f => f.saldo === 0).length;
    if (ceros) console.log('  ... y ' + ceros + ' bodega(s) en cero (--todas para verlas)');
  }

  di('\n  flota: ' + mil(t.total) + ' pallets en ' + t.bodegas + ' bodegas');
  di('    con ubicaciones (' + t.nConUbicaciones + '): ' + mil(t.conUbicaciones) +
              '   ← se puede abrir por socio');
  di('    sin ubicaciones (' + t.nSinUbicaciones + '): ' + mil(t.sinUbicaciones) +
              '   ← nunca se va a poder abrir por socio');
  if (t.nDesconocidas) console.log('    fuera del catalogo (' + t.nDesconocidas + '): ' + mil(t.desconocidas));

  if (bandera('json')) {
    // El json va a stdout SIEMPRE y por el canal crudo: es lo unico que tiene
    // que salir por ahi cuando alguien redirige. El titulo va por el otro
    // canal, porque es decoracion para el humano y basura para el parser.
    di('\n── JSON (a stdout) ' + '─'.repeat(55));
    process.stdout.write(JSON.stringify(salidaJson(filas, t, item), null, 2) + '\n');
  }

  const salida = opcion('salida', null);
  if (salida) {
    require('fs').writeFileSync(salida, JSON.stringify(salidaJson(filas, t, item), null, 2) + '\n',
                                { encoding: 'utf8' });
    di('\n  escrito: ' + salida + '   (UTF-8 sin BOM)');
  }

  const v = veredicto(t, rutas);
  di('\n── VEREDICTO ' + '─'.repeat(61));
  di('  ' + v.texto);
  di('\n  La bodega manda en CUANTOS hay. La ubicacion manda en DE QUIEN son.');
  di('  El que sobra entre las dos son pallets en la bodega sin ubicacion asignada,');
  di('  y esa categoria hay que mostrarla, no repartirla.\n');
}

if (require.main === module) main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
