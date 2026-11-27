'use strict';
/* Cada mutación tiene que matar al menos una prueba. La que sobrevive señala
   una prueba que no está mirando nada. */
const { execSync } = require('child_process');
const fs = require('fs');
const RUTA = __dirname + '/../api/shared/frescura.js';
const ORIG = fs.readFileSync(RUTA, 'utf8');

const MUT = [
  ['tolerancia horaria fuera', "viejo = !(atraso - def.tolera === 1 && hora < def.desdeHora);", "viejo = true;"],
  ['tolerancia siempre activa', "viejo = !(atraso - def.tolera === 1 && hora < def.desdeHora);", "viejo = false;"],
  ['misma hora para todas',     "hora < def.desdeHora", "hora < 8"],
  ['sin dato pasa por bueno',   "cuando:null, atraso:null, viejo:true", "cuando:null, atraso:null, viejo:false"],
  ['no camina hacia atrás',     "for (let i = 0; i <= (maxAtras || 6); i++) {", "for (let i = 0; i <= 0; i++) {"],
  ['resta de días al revés',    "return Math.round((B - A) / 86400000);", "return Math.round((A - B) / 86400000);"],
  ['zona horaria ignorada',     "timeZone:'America/Santiago'", "timeZone:'UTC'"],
  ['la sonda que explota tumba todo', "try { hay = await existe(f); } catch (e) { hay = false; }", "hay = await existe(f);"],
  ['atraso de 2 días perdonado', "else if (atraso > def.tolera) {", "else if (atraso > def.tolera + 1) {"]
];

let vivas = 0;
for (const [nombre, de, a] of MUT) {
  if (!ORIG.includes(de)) { console.log('  ??   ' + nombre + ' — el ancla ya no existe'); vivas++; continue; }
  fs.writeFileSync(RUTA, ORIG.replace(de, a));
  let murio = false;
  try { execSync('node ' + __dirname + '/test-frescura.js', { stdio:'pipe' }); }
  catch (e) { murio = true; }
  console.log((murio ? '  muere  ' : '  VIVE   ') + nombre);
  if (!murio) vivas++;
}
fs.writeFileSync(RUTA, ORIG);
console.log('\n' + (MUT.length - vivas) + '/' + MUT.length + ' mutaciones muertas');
process.exit(vivas ? 1 : 0);
