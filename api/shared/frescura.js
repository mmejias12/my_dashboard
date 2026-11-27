// ============================================================================
//  shared/frescura.js  ·  ¿De cuándo es el dato que estás mirando?
//
//  Un dato viejo que se ve fresco es peor que no tener el dato. Esto responde,
//  por fuente, cuál es el último día que tenemos y si eso ya cuenta como atraso.
//
//  La parte con criterio es "desdeHora": cada fuente llega a una hora distinta,
//  así que no tener lo de hoy a las 06:00 no es lo mismo para la cadena diaria
//  (que corre 06:12) que para el reporte de Walmart (que llega de noche).
//  Sin esa tolerancia la franja gritaría "atrasado" todas las mañanas, y una
//  alarma que suena siempre deja de mirarse.
// ============================================================================
'use strict';

const CATALOGO = [
  { id:'ops',     n:'Operaciones', vista:'ops',
    desdeHora:8,  tolera:0, nota:'Cadena diaria de operaciones' },
  { id:'sap',     n:'SAP B1',      vista:'stocks-unificado',
    desdeHora:8,  tolera:0, nota:'Stock por bodega' },
  { id:'walmart', n:'Reporte Walmart', vista:'confirmaciones-walmart',
    desdeHora:21, tolera:0, nota:'Reporte diario que manda Walmart' },
  { id:'talana',  n:'Talana',      vista:'asistencia-aldia',
    desdeHora:9,  tolera:0, nota:'Marcas de asistencia' }
];

/* Chile. No se usa toLocaleString con zona porque el runtime de Functions
   puede no traer la base de zonas; el offset de Santiago se resuelve con
   Intl, y si tampoco está, se cae a UTC-3 que es el caso del verano austral. */
function ahoraEnChile(d) {
  const base = d || new Date();
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    }).formatToParts(base).reduce((a,p)=>(a[p.type]=p.value,a),{});
    return { fecha: f.year+'-'+f.month+'-'+f.day, hora: Number(f.hour) };
  } catch (e) {
    const t = new Date(base.getTime() - 3*3600*1000);
    return { fecha: t.toISOString().slice(0,10), hora: t.getUTCHours() };
  }
}

function diasEntre(a, b) {
  const A = Date.parse(a + 'T00:00:00Z'), B = Date.parse(b + 'T00:00:00Z');
  if (isNaN(A) || isNaN(B)) return null;
  return Math.round((B - A) / 86400000);
}

function restar(fecha, n) {
  const t = new Date(Date.parse(fecha + 'T00:00:00Z') - n*86400000);
  return t.toISOString().slice(0,10);
}

/* Decide el estado de UNA fuente a partir del último día que tiene.
   Separada a propósito: es la única parte con reglas, y se prueba sin red. */
function evaluar(def, ultimo, hoy, hora) {
  if (!ultimo) {
    return { id:def.id, n:def.n, vista:def.vista, nota:def.nota,
             cuando:null, atraso:null, viejo:true, dice:'sin dato' };
  }
  const atraso = diasEntre(ultimo, hoy);
  // Al día: el último dato es de hoy.
  let viejo = false;
  if (atraso === null) viejo = true;
  else if (atraso > def.tolera) {
    // Todavía no es hora de exigirle lo de hoy: un día de atraso se perdona
    // hasta la hora en que esa fuente suele llegar.
    viejo = !(atraso - def.tolera === 1 && hora < def.desdeHora);
  }
  return { id:def.id, n:def.n, vista:def.vista, nota:def.nota,
           cuando:ultimo, atraso:atraso, viejo:viejo,
           dice: atraso === 0 ? 'hoy' : atraso === 1 ? 'ayer' : 'hace ' + atraso + ' días' };
}

/* Busca hacia atrás el último día con dato. `existe` es una función
   async (fecha) => bool, para no amarrar esto a ningún almacén. */
async function ultimoDia(existe, hoy, maxAtras) {
  for (let i = 0; i <= (maxAtras || 6); i++) {
    const f = restar(hoy, i);
    let hay = false;
    try { hay = await existe(f); } catch (e) { hay = false; }
    if (hay) return f;
  }
  return null;
}

async function armar(sondas, ahora) {
  const { fecha, hora } = ahoraEnChile(ahora);
  const fuentes = [];
  for (const def of CATALOGO) {
    const sonda = sondas[def.id];
    let ultimo = null;
    if (typeof sonda === 'function') {
      try { ultimo = await ultimoDia(sonda, fecha, 6); } catch (e) { ultimo = null; }
    }
    fuentes.push(evaluar(def, ultimo, fecha, hora));
  }
  return { generado: new Date().toISOString(), hoy: fecha, hora: hora, fuentes: fuentes,
           atrasadas: fuentes.filter(f => f.viejo).length };
}

module.exports = { CATALOGO, ahoraEnChile, diasEntre, restar, evaluar, ultimoDia, armar };
