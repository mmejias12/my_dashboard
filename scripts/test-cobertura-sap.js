// Pruebas de scripts/cobertura-sap.js — la parte que decide si un mes sirve.
const { veredicto, diasDelMes } = require('./cobertura-sap.js');
let ok = 0, fail = 0;
const t = (n, c) => { c ? ok++ : fail++; console.log((c ? '  ok    ' : '  FALLA ') + n); };
const dias = (mes, desde, hasta) => { const o = []; for (let d = desde; d <= hasta; d++) o.push(mes + '-' + (d < 10 ? '0' : '') + d); return o; };

t('T1 octubre tiene 31 dias y febrero de 2026 tiene 28',
  diasDelMes('2026-10') === 31 && diasDelMes('2026-02') === 28);

t('T2 un mes que llega al cierre y se escribio despues: sirve',
  veredicto('2026-09', dias('2026-09', 1, 30), new Date('2026-10-02T03:00:00Z')).codigo === 0);

// EL CASO REAL que motivo el script: blob escrito a mitad de mes.
t('T3 blob escrito ANTES del cierre del mes se marca INCOMPLETO',
  veredicto('2026-10', dias('2026-10', 1, 21), new Date('2026-10-21T18:00:00Z')).codigo === 2);

t('T4 y el motivo nombra la fecha de escritura, no un diagnostico vago',
  /se escribio el 2026-10-21/.test(veredicto('2026-10', dias('2026-10', 1, 21), new Date('2026-10-21T18:00:00Z')).texto));

t('T5 escrito despues del cierre pero sin documentos al final: se avisa, mas suave',
  veredicto('2026-10', dias('2026-10', 1, 29), new Date('2026-11-03T00:00:00Z')).codigo === 1);

t('T6 un mes sin documentos no se confunde con uno cortado',
  veredicto('2026-10', [], new Date('2026-11-03T00:00:00Z')).codigo === 3);

t('T7 sin fecha de escritura no se inventa el corte',
  veredicto('2026-09', dias('2026-09', 1, 30), null).codigo === 0);

// Un blob escrito el ultimo dia del mes todavia es corte: el dia no cerro.
t('T8 escrito el mismo ultimo dia del mes (mediodia) sigue siendo corte',
  veredicto('2026-10', dias('2026-10', 1, 31), new Date('2026-10-31T12:00:00Z')).codigo === 2);

t('T9 escrito despues del ultimo segundo del mes ya no es corte',
  veredicto('2026-10', dias('2026-10', 1, 31), new Date('2026-11-01T00:00:01Z')).codigo === 0);

console.log('\n' + ok + ' de ' + (ok + fail) + ' pruebas pasan');
process.exit(fail ? 1 : 0);
