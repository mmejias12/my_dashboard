const { execSync } = require('child_process');
const fs = require('fs');
const R = __dirname + '/index-nuevo.html';
const O = fs.readFileSync(R, 'utf8');
const TODAS = [
  ['la hora se reinterpreta como UTC (el defecto de 3 horas)',
   "if (String(t.timeZone || '').toUpperCase() !== 'UTC') return s.slice(11, 16);", ""],
  ['abre ventana cuando el silencio falla',
   "$('cal').innerHTML = '';\n    return;\n  }\n  try {\n    var hoy", "tok = await app.loginPopup(pide);\n  }\n  try {\n    var hoy"],
  ['token en sessionStorage (se pierde al cerrar la pestaña)',
   "cacheLocation:'localStorage'", "cacheLocation:'sessionStorage'"],
  ['sin loginHint', "Object.assign({ loginHint: YO.correo }, pide)", "pide"],
  ['llave de tema distinta a la del panel', "var LLAVE = 'ops_theme';", "var LLAVE = 'index_theme';"],
  ['no filtra las fuentes por área', "var fs = d.fuentes.filter(function (f) { return miras[f.id]; });", "var fs = d.fuentes;"],
  ['la franja se dibuja aunque el endpoint falle', "caja.innerHTML = '';\n  }\n}", "caja.innerHTML = '<span class=\"leyenda\">todo al día</span>';\n  }\n}"],
  ['el popup de OS vuelve a 520px', "var OS_ANCHO = 900", "var OS_ANCHO = 520"],
  /* RETIRADA — mutación equivalente, no prueba floja.
     ['no escapa el html del buscador', "if (i < 0 || !t) return esc(txt);", "if (i < 0 || !t) return txt;"]
     Esa rama de resaltar() solo se alcanza cuando el término NO aparece en el
     título del resultado, y los títulos se arman con constantes nuestras más,
     a lo más, dígitos ya filtrados por /^\d{6,8}$/. No existe entrada que
     lleve html del usuario hasta ahí, así que ninguna prueba honesta la mata.
     El esc() se queda igual: es defensa en profundidad para el día en que a
     alguien se le ocurra poner texto libre en un título. */
  ['el calendario corre sin sesión', "if (!YO.correo) return;", ""],
  ['muestra el día entero y no lo que queda', "return finEnMs(e) >= ahora;", "return true;"],
  ['sin tope de eventos', "eventos.slice(0, CAL.tope)", "eventos.slice(0, 99)"]
];
const MUT = TODAS.slice(Number(process.argv[2]||0), Number(process.argv[3]||99));
let vivas = 0;
for (const [n, de, a] of MUT) {
  if (!O.includes(de)) { console.log('  ??     ' + n + ' — ancla perdida'); vivas++; continue; }
  fs.writeFileSync(R, O.replace(de, a));
  let murio = false;
  try { execSync('node ' + __dirname + '/probar-index.js', { stdio:'pipe' }); } catch (e) { murio = true; }
  console.log((murio ? '  muere  ' : '  VIVE   ') + n);
  if (!murio) vivas++;
}
fs.writeFileSync(R, O);
console.log('\n' + (MUT.length - vivas) + '/' + MUT.length + ' mutaciones muertas');
