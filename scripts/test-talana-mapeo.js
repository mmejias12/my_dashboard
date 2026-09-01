// ============================================================================
//  scripts/test-talana-mapeo.js
//
//  Pruebas del mapeo Talana → contrato del reporte, con datos simulados.
//  No toca la red ni Azure: se puede correr en cualquier parte.
//
//      node scripts/test-talana-mapeo.js
// ============================================================================

const assert = require('assert');
const mapa = require('../api/shared/talana-asistencia.js');

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nombre); }
  catch (e) { console.error('  ✗ ' + nombre + '\n      ' + e.message); process.exitCode = 1; }
}

console.log('\nHoras y fechas');

prueba('aMinutos acepta los formatos que devuelve Talana', () => {
  assert.strictEqual(mapa.aMinutos('08:00:00'), 480);
  assert.strictEqual(mapa.aMinutos('08:30'), 510);
  assert.strictEqual(mapa.aMinutos('1900-01-01T22:15:00'), 1335);
  assert.strictEqual(mapa.aMinutos(null), null);
  assert.strictEqual(mapa.aMinutos('sin hora'), null);
});

prueba('fechaHora arma un instante completo y desborda al día siguiente', () => {
  assert.strictEqual(mapa.fechaHora('2026-08-31', 480), '2026-08-31T08:00:00');
  // Turno nocturno: 22:00 + 8 h → 06:00 del día siguiente (1800 min).
  assert.strictEqual(mapa.fechaHora('2026-08-31', 1800), '2026-09-01T06:00:00');
});

prueba('indiceDiaSemana usa lunes = 0 por defecto', () => {
  assert.strictEqual(mapa.indiceDiaSemana('2026-08-31'), 0); // lunes
  assert.strictEqual(mapa.indiceDiaSemana('2026-09-06'), 6); // domingo
});

prueba('rangoDias y sumarDias cruzan el fin de mes', () => {
  assert.deepStrictEqual(mapa.rangoDias('2026-08-30', '2026-09-01'),
    ['2026-08-30', '2026-08-31', '2026-09-01']);
  assert.strictEqual(mapa.sumarDias('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(mapa.sumarDias('2026-09-01', -1), '2026-08-31');
});

console.log('\nMarcas');

prueba('una marca de Talana se traduce al contrato del reporte', () => {
  const m = mapa.mapearMarca({
    id: 91, TS: '2026-08-31 07:58:12', direction: 'E', checksum: 'abc123',
    markingMethod: 'reloj',
    person: { id: 4471, nombre: 'Ana', apellidoPaterno: 'Soto', apellidoMaterno: 'Rivas', rut: '12345678-9' }
  });
  assert.strictEqual(m.attendanceDate, '2026-08-31T07:58:12'); // la T que espera el reporte
  assert.strictEqual(m.employee.code, '4471');
  // Los apellidos van separados porque empNombreCompleto() del reporte junta
  // lastName + secondLastName y evita repetir si ya vienen unidos.
  assert.strictEqual(m.employee.lastName, 'Soto');
  assert.strictEqual(m.employee.secondLastName, 'Rivas');
  assert.strictEqual(m.employee.identification, '12345678-9');
  assert.strictEqual(m.tipo, 'ENTRADA');
});

prueba('direction X y O se traducen a salida e intermedia', () => {
  assert.strictEqual(mapa.mapearMarca({ TS: '2026-08-31T17:02:00', direction: 'X', person: {} }).tipo, 'SALIDA');
  assert.strictEqual(mapa.mapearMarca({ TS: '2026-08-31T13:00:00', direction: 'O', person: {} }).tipo, 'INTERMEDIA');
  assert.strictEqual(mapa.mapearMarca({ TS: '2026-08-31T13:00:00', person: {} }).tipo, null);
});

console.log('\nAusencias · las tres fuentes usan nombres de campo distintos');

const fuente = rec => mapa.FUENTES_AUSENCIA.find(f => f.recurso === rec);

prueba('/absentism-resumed/ · fechaDesde / fechaHasta / tipoAusencia', () => {
  const a = mapa.mapearAusencia({
    empleado: { id: 4014326, rut: '18756239-2', nombre: 'DANIEL', apellidoPaterno: 'CARRASCO', apellidoMaterno: 'RIELOFF' },
    fechaDesde: '2026-05-14', fechaHasta: '2026-05-15', numeroDias: 2,
    tipoAusencia: 'permiso sin goce', estado: 'Aprobada'
  }, fuente('/absentism-resumed/'));
  assert.strictEqual(a.employeeCode, '4014326');
  assert.strictEqual(a.start, '2026-05-14');
  assert.strictEqual(a.end, '2026-05-15');
  assert.strictEqual(a.permissionTypeName, 'Permiso sin goce');   // categoría, no el crudo
  assert.strictEqual(a.justificada, true);
});

prueba('/vacations-resumed/ · vacacionesDesde / vacacionesHasta', () => {
  // Con los nombres genéricos anteriores estas fechas salían vacías y las 2.615
  // vacaciones de REDTEC se descartaban enteras.
  const a = mapa.mapearAusencia({
    empleado: { id: 3757882, rut: '15332012-8', nombre: 'ADOLFO', apellidoPaterno: 'GARCIA' },
    vacacionesDesde: '2026-09-04', vacacionesHasta: '2026-09-04',
    numeroDias: 1, tipoVacaciones: 'normales'
  }, fuente('/vacations-resumed/'));
  assert.strictEqual(a.employeeCode, '3757882');
  assert.strictEqual(a.start, '2026-09-04');
  assert.strictEqual(a.end, '2026-09-04');
  assert.strictEqual(a.permissionTypeName, 'Vacaciones');
});

prueba('un tipo de vacaciones distinto de "normales" se conserva', () => {
  const a = mapa.mapearAusencia({
    empleado: { id: 1 }, vacacionesDesde: '2026-09-04', vacacionesHasta: '2026-09-05',
    tipoVacaciones: 'progresivas'
  }, fuente('/vacations-resumed/'));
  assert.strictEqual(a.permissionTypeName, 'Vacaciones (progresivas)');
});

prueba('/administrative-leaves-resumed/ · desde / hasta / administrative_type', () => {
  const a = mapa.mapearAusencia({
    id: 686022, empleado: { id: 1475541, rut: '7103442-9', nombre: 'CLAUDIO', apellidoPaterno: 'REYES' },
    desde: '2025-11-07', hasta: '2025-11-07', administrative_type: 'anual'
  }, fuente('/administrative-leaves-resumed/'));
  assert.strictEqual(a.employeeCode, '1475541');
  assert.strictEqual(a.start, '2025-11-07');
  assert.strictEqual(a.permissionTypeName, 'Día administrativo');
});

prueba('`empleado` anidado como objeto NO se convierte en el código', () => {
  // Las tres fuentes anidan al trabajador como objeto. Tomarlo como id daba
  // employeeCode = "[object Object]" y ningún permiso calzaba con su persona.
  for (const f of mapa.FUENTES_AUSENCIA) {
    const a = mapa.mapearAusencia({
      empleado: { id: 777, nombre: 'X' },
      fechaDesde: '2026-01-01', fechaHasta: '2026-01-01',
      vacacionesDesde: '2026-01-01', vacacionesHasta: '2026-01-01',
      desde: '2026-01-01', hasta: '2026-01-01'
    }, f);
    assert.strictEqual(a.employeeCode, '777', 'falló en ' + f.recurso);
  }
});

prueba('un `empleado` que sí viene como id suelto se sigue aceptando', () => {
  const a = mapa.mapearAusencia({ empleado: 555, desde: '2026-01-01', hasta: '2026-01-01' },
                                fuente('/administrative-leaves-resumed/'));
  assert.strictEqual(a.employeeCode, '555');
});

prueba('una falta injustificada no se marca como permiso justificado', () => {
  // Talana las devuelve por el mismo endpoint que los permisos. Si el calendario
  // las pintara como licencia, una falta quedaría tapada como justificada.
  const a = mapa.mapearAusencia({
    empleado: { id: 4014326 }, fechaDesde: '2026-06-03', fechaHasta: '2026-06-03',
    tipoAusencia: 'falta injustificada'
  }, fuente('/absentism-resumed/'));
  assert.strictEqual(a.justificada, false);
  assert.strictEqual(a.permissionTypeName, 'Falta injustificada');
});


console.log('\nEl motivo médico no sale al navegador');

prueba('"licencia maternal" y "licencia medica" se colapsan a "Licencia"', () => {
  // Talana distingue el motivo; el reporte sólo necesita saber que la ausencia
  // está justificada. El detalle de salud quedaría a la vista de cualquiera que
  // abra el calendario, junto al nombre y el RUT.
  for (const crudo of ['licencia medica', 'licencia maternal', 'LICENCIA MÉDICA']) {
    const a = mapa.mapearAusencia({
      empleado: { id: 1 }, fechaDesde: '2026-09-01', fechaHasta: '2026-09-05', tipoAusencia: crudo
    }, fuente('/absentism-resumed/'));
    assert.strictEqual(a.permissionTypeName, 'Licencia', 'falló con: ' + crudo);
    assert.strictEqual(a.justificada, true);
  }
});

prueba('las categorías que el calendario distingue se conservan', () => {
  const de = (crudo, f) => mapa.mapearAusencia({
    empleado: { id: 1 }, fechaDesde: '2026-09-01', fechaHasta: '2026-09-01',
    vacacionesDesde: '2026-09-01', vacacionesHasta: '2026-09-01',
    desde: '2026-09-01', hasta: '2026-09-01', tipoAusencia: crudo
  }, f).permissionTypeName;
  assert.strictEqual(de('falta injustificada', fuente('/absentism-resumed/')), 'Falta injustificada');
  assert.strictEqual(de('permiso sin goce',    fuente('/absentism-resumed/')), 'Permiso sin goce');
  assert.strictEqual(de(null, fuente('/vacations-resumed/')), 'Vacaciones');
  assert.strictEqual(de(null, fuente('/administrative-leaves-resumed/')), 'Día administrativo');
});

prueba('la falta injustificada se sigue detectando sobre el tipo crudo', () => {
  // La categoría se calcula antes; si `justificada` mirara la categoría en vez
  // del crudo, el orden de las reglas podría invertir el resultado.
  const a = mapa.mapearAusencia({
    empleado: { id: 1 }, fechaDesde: '2026-09-01', fechaHasta: '2026-09-01',
    tipoAusencia: 'inasistencia injustificada'
  }, fuente('/absentism-resumed/'));
  assert.strictEqual(a.justificada, false);
});

console.log('\nHorario teórico');

// ── escenario común a las pruebas de horario ────────────────────────────────
const empleados = [
  { code: '1', name: 'Ana',  lastName: 'Soto',  identification: '1-9', branchOffice: '10', branchOfficeName: 'Planta', department: 'OP', departmentName: 'Operaciones' },
  { code: '2', name: 'Luis', lastName: 'Pérez', identification: '2-7', branchOffice: '10', branchOfficeName: 'Planta', department: 'OP', departmentName: 'Operaciones' },
  { code: '3', name: 'Rosa', lastName: 'Díaz',  identification: '3-5', branchOffice: '10', branchOfficeName: 'Planta', department: 'OP', departmentName: 'Operaciones' },
  { code: '4', name: 'Juan', lastName: 'Vega',  identification: '4-3', branchOffice: '10', branchOfficeName: 'Planta', department: 'OP', departmentName: 'Operaciones' }
];

const asignaciones = [
  { id: 100, person: 1, workShift: 50, fromDate: '2026-01-01', toDate: '' },        // semanal, abierta
  { id: 101, person: 2, workShift: 51, fromDate: '2026-01-01', toDate: '' },        // manual
  { id: 102, person: 3, workShift: 52, fromDate: '2026-01-01', toDate: '' },        // rotativo
  { id: 103, person: 4, workShift: 50, fromDate: '2026-01-01', toDate: '2026-08-30' } // ya vencida
];

const turnos = {
  catalogo: {
    '50': { id: 50, name: 'Diurno L-V', type: 'W', tolerance: 10, snackDuration: 30, schedule: '' },
    '51': { id: 51, name: 'Manual',     type: 'M', tolerance: 5,  snackDuration: null, schedule: '' },
    '52': { id: 52, name: 'Rotativo 4x4', type: 'R', tolerance: 0, snackDuration: null, schedule: '' }
  },
  diasSemanales: {
    '50': {
      '0': { nombre: 'Lunes',     trabaja: true,  inicio: 480, fin: 1050, colacionInicio: 780, colacionMin: 30, orden: 0 },
      '1': { nombre: 'Martes',    trabaja: true,  inicio: 480, fin: 1050, colacionInicio: 780, colacionMin: 30, orden: 1 },
      '5': { nombre: 'Sábado',    trabaja: false, inicio: null, fin: null, colacionInicio: null, colacionMin: null, orden: 5 },
      '6': { nombre: 'Domingo',   trabaja: false, inicio: null, fin: null, colacionInicio: null, colacionMin: null, orden: 6 }
    }
  },
  diasRotativos: { '52': [] }
};

const diasManuales = {
  '51|2026-08-31': { nombre: 'Extra', trabaja: true, inicio: 1320, fin: 1800, colacionInicio: null, colacionMin: null, orden: 0 }
};

const r = mapa.construirHorarios({
  desde: '2026-08-31', hasta: '2026-09-01',
  empleados, asignaciones, turnos, diasManuales
});
const de = code => r.data.find(x => x.employee.code === code);

prueba('turno semanal: expande lunes y martes con el horario del día', () => {
  const ana = de('1');
  assert.strictEqual(ana.schedules.length, 2);
  assert.strictEqual(ana.schedules[0].date, '2026-08-31');
  assert.strictEqual(ana.schedules[0].start, '2026-08-31T08:00:00');
  assert.strictEqual(ana.schedules[0].end,   '2026-08-31T17:30:00');
  assert.strictEqual(ana.schedules[0].workshiftName, 'Diurno L-V');
  assert.strictEqual(ana.schedules[0].tolerance, 10);
});

prueba('turno manual: sólo el día que Talana define, y cruza la medianoche', () => {
  const luis = de('2');
  assert.strictEqual(luis.schedules.length, 1);
  assert.strictEqual(luis.schedules[0].start, '2026-08-31T22:00:00');
  assert.strictEqual(luis.schedules[0].end,   '2026-09-01T06:00:00'); // nocturno
});

prueba('turno rotativo: queda sin horario y se informa, no se inventa', () => {
  assert.strictEqual(de('3').schedules.length, 0);
  assert.ok(r.rotativosSinAncla.includes('3'),
    'el rotativo debe declararse como no determinable, para que el reporte use la heurística de primera/última marca');
  assert.ok(r.sinHorario.includes('3'));
});

prueba('una asignación vencida no genera horario', () => {
  assert.strictEqual(de('4').schedules.length, 0);
});

prueba('el empleado viaja con sucursal y área, que el reporte usa para filtrar', () => {
  assert.strictEqual(de('1').employee.branchOfficeName, 'Planta');
  assert.strictEqual(de('1').employee.departmentName, 'Operaciones');
});

console.log('\nAsignaciones');

prueba('formatearAsignaciones entrega el periodo que muestra el reporte', () => {
  const filas = mapa.formatearAsignaciones({
    empleados, asignaciones, turnos, desde: '2026-08-31', hasta: '2026-09-01'
  });
  const ana = filas.find(f => f.employee.code === '1');
  assert.strictEqual(ana.workshiftName, 'Diurno L-V');
  assert.strictEqual(ana.period, '2026-01-01 → indefinido');
  // La de Juan venció el 2026-08-30: fuera del rango pedido.
  assert.ok(!filas.find(f => f.employee.code === '4'));
});

console.log('\nnormalizarDia');

prueba('deriva la salida desde la duración cuando Talana no manda exit_time', () => {
  const d = mapa.normalizarDia({ startWorkingHours: '09:00:00', numberWorkingMinutes: 480, workingDay: true });
  assert.strictEqual(d.inicio, 540);
  assert.strictEqual(d.fin, 1020);
});

prueba('corrige el turno nocturno sumando un día a la salida', () => {
  const d = mapa.normalizarDia({ startWorkingHours: '22:00:00', exit_time: '06:00:00', workingDay: true });
  assert.strictEqual(d.inicio, 1320);
  assert.strictEqual(d.fin, 1800);
});


console.log('\nCasos reales del diagnóstico de REDTEC');

prueba('numberWorkingDay = 0 con name "Lunes" se detecta como convención lunes', () => {
  // Muestra literal de /rotativeDay/ en la cuenta de REDTEC.
  const r = mapa.detectarDiaCero([
    { name: 'Lunes',  numberWorkingDay: 0, workShift: 296456 },
    { name: 'Martes', numberWorkingDay: 1, workShift: 296456 }
  ]);
  assert.strictEqual(r.diaCero, 'lunes');
  assert.strictEqual(r.detectado, true);
});

prueba('la convención domingo también se detecta, sin depender de la variable', () => {
  const r = mapa.detectarDiaCero([
    { name: 'Domingo', numberWorkingDay: 0 },
    { name: 'Lunes',   numberWorkingDay: 1 }
  ]);
  assert.strictEqual(r.diaCero, 'domingo');
});

prueba('con nombres irreconocibles cae en la configuración, sin inventar', () => {
  const r = mapa.detectarDiaCero([{ name: 'Turno A', numberWorkingDay: 0 }]);
  assert.strictEqual(r.detectado, false);
  assert.strictEqual(r.diaCero, mapa.DIA_CERO);
});

prueba('indiceDiaSemana respeta la convención que se le pasa', () => {
  assert.strictEqual(mapa.indiceDiaSemana('2026-08-31', 'lunes'), 0);   // lunes
  assert.strictEqual(mapa.indiceDiaSemana('2026-08-31', 'domingo'), 1);
});

prueba('el horario real 12:30–18:00 del turno 296456 se expande bien', () => {
  const def = mapa.normalizarDia({
    id: 1416177, name: 'Lunes', startSnackHours: null, numberSnackMinutes: 0,
    startWorkingHours: '12:30', numberWorkingMinutes: 330, workingDay: true,
    numberWorkingDay: 0, workShift: 296456, exit_time: '18:00'
  });
  assert.strictEqual(def.inicio, 750);
  assert.strictEqual(def.fin, 1080);
  assert.strictEqual(mapa.fechaHora('2026-08-31', def.inicio), '2026-08-31T12:30:00');
  assert.strictEqual(mapa.fechaHora('2026-08-31', def.fin),    '2026-08-31T18:00:00');
});

prueba('sin catálogo de turnos (403 en /workShift/) se infiere uno usable', () => {
  const t = mapa.turnoInferido('296456', 'W', {
    '0': { trabaja: true, inicio: 750, fin: 1080 },
    '1': { trabaja: true, inicio: 750, fin: 1080 }
  });
  assert.strictEqual(t.type, 'W');
  assert.strictEqual(t.inferido, true);
  assert.ok(/12:30/.test(t.name), 'el nombre debe describir el horario: ' + t.name);
});

console.log('\nCampos que el reporte exige del empleado');

prueba('empleado sin employeeStatus vaciaría el calendario: el mapeo lo emite', () => {
  // El reporte filtra con employeeStatus === 'ACTIVO'. Es un campo de Workera
  // que Talana no tiene; se deriva de contrato.activo y contrato.finiquitado.
  const requeridos = ['code','name','lastName','secondLastName','identification',
                      'employeeStatus','branchOfficeCode','branchOfficeName',
                      'departmentCode','departmentName','genre','personalMail',
                      'birthDate','empresa'];
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../api/shared/talana-asistencia.js'), 'utf8');
  const bloque = fuente.slice(fuente.indexOf('const data = [...porPersona.values()]'),
                              fuente.indexOf('data.sort('));
  for (const campo of requeridos) {
    assert.ok(new RegExp('\\b' + campo + '\\s*:').test(bloque),
      'falta el campo ' + campo + ' en traerEmpleados');
  }
});

prueba('los montos de bonos de userDefinedFields no salen al dashboard', () => {
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../api/shared/talana-asistencia.js'), 'utf8');
  assert.ok(!/userDefinedFields/.test(fuente),
    'contracts-resumed-paginated trae BonoGestion, BonoResponsabilidad y BonoEspecial: no deben viajar al navegador');
});


console.log('\nTS real de Talana (con desfase horario)');

prueba('el desfase -04:00 se normaliza a hora de pared, sin cambiar la hora', () => {
  // Muestra literal de /mark/ en la cuenta de REDTEC.
  const m = mapa.mapearMarca({
    id: 289216699, TS: '2026-08-31T10:28:43-04:00', direction: 'X',
    checksum: 'd353575c:yg4j8', person: { id: 2691016, nombre: 'JESUS', apellidoPaterno: 'IBARRA' }
  });
  assert.strictEqual(m.attendanceDate, '2026-08-31T10:28:43');
  assert.strictEqual(m.tipo, 'SALIDA');
});

prueba('los microsegundos se recortan', () => {
  const m = mapa.mapearMarca({
    TS: '2026-08-31T09:06:32.979284-04:00', direction: 'E', person: { id: 1475433 }
  });
  assert.strictEqual(m.attendanceDate, '2026-08-31T09:06:32');
});

prueba('un TS en UTC se convierte a hora de Chile, no se recorta a lo bruto', () => {
  // 13:28 UTC = 09:28 en Chile (UTC-4). Recortar sin convertir daría 13:28 y
  // todos los atrasos saldrían con cuatro horas de más.
  const m = mapa.mapearMarca({ TS: '2026-08-31T13:28:43Z', direction: 'E', person: { id: 1 } });
  assert.strictEqual(m.attendanceDate, '2026-08-31T09:28:43');
});

prueba('un TS sin desfase se deja tal cual', () => {
  const m = mapa.mapearMarca({ TS: '2026-08-31 07:58:12', direction: 'E', person: { id: 1 } });
  assert.strictEqual(m.attendanceDate, '2026-08-31T07:58:12');
});

prueba('el formato normalizado es el que el reporte sabe parsear', () => {
  const m = mapa.mapearMarca({ TS: '2026-08-31T10:28:43-04:00', direction: 'X', person: { id: 1 } });
  // obtenerFechaMarca() usa substring(0,10) y obtenerHoraMarca() substring(11,19).
  assert.strictEqual(m.attendanceDate.substring(0, 10), '2026-08-31');
  assert.strictEqual(m.attendanceDate.substring(11, 19), '10:28:43');
});

console.log('\nSin permiso sobre el módulo de Turnos');

prueba('sin asignaciones nadie tiene horario, y se declara', () => {
  const r = mapa.construirHorarios({
    desde: '2026-08-31', hasta: '2026-08-31',
    empleados: [{ code: '1', name: 'Ana', lastName: 'Soto', identification: '1-9' }],
    asignaciones: [],          // esto es lo que deja un 403 en /workShiftPersonRange/
    turnos: { catalogo: {}, diasSemanales: {}, diasRotativos: {}, diaCero: 'lunes' },
    diasManuales: {}
  });
  assert.strictEqual(r.data.length, 0, 'sin asignación el empleado no aporta filas de horario');
  assert.deepStrictEqual(r.sinHorario, ['1']);
});

console.log(`\n${ok} pruebas pasaron${process.exitCode ? ' (con fallos)' : ''}.\n`);
