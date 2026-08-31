// ============================================================================
//  scripts/test-talana-integracion.js
//
//  Prueba de EXTREMO A EXTREMO del circuito completo, sin red y sin Azure:
//
//     talana-sync  →  Blob (en memoria)  →  talana-asistencia  →  contrato
//                                                                 del reporte
//
//  Se ejecutan las Functions reales. Lo único simulado son las dos fronteras:
//    · talana-client → devuelve las formas EXACTAS que entregó /_diagnostico
//      contra la cuenta de REDTEC (incluido el 403 de /workShift/).
//    · talana-store.getContainer → un contenedor Blob en memoria.
//
//  Las pruebas unitarias (test-talana-mapeo.js) verifican cada traducción por
//  separado; esto verifica el CABLEADO: que lo que escribe el sync es lo que
//  lee la API, y que lo que sirve la API es lo que el HTML sabe consumir.
//
//  Los datos de personas son inventados: la forma es la real, los RUT, nombres
//  y fechas no, para no dejar datos de trabajadores en el repositorio.
//
//      node scripts/test-talana-integracion.js
// ============================================================================

process.env.TALANA_TOKEN   = 'token-de-prueba';
process.env.OS_INGESTA_KEY = 'llave-de-prueba';
process.env.OS_STORAGE_CONN = 'UseDevelopmentStorage=true';
process.env.TALANA_RPM     = '6000';   // sin espera entre llamadas simuladas

const assert = require('assert');
const path   = require('path');

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nombre); }
  catch (e) { console.error('  ✗ ' + nombre + '\n      ' + e.message); process.exitCode = 1; }
}

// ── Talana simulado, con las formas del diagnóstico real ────────────────────
const HOY = '2026-08-31';   // lunes

const FIXTURES = {
  '/sucursal/': [
    { id: 34733, empresa: 2921, nombre: 'BODEGA SANTIAGO', vigente: true,
      direccionCalle: 'Av Americo Vespucio Norte', direccionNumero: '170', direccionComuna: 371 },
    { id: 34734, empresa: 2921, nombre: 'BODEGA TALCA', vigente: true,
      direccionCalle: 'Longitudinal Sur Km 260 s/n', direccionNumero: 'Cruce Uñihue', direccionComuna: 155 }
  ],
  '/centroCosto/': [
    { id: 280618, parent: null, empresa: 2921, codigo: '1',  nombre: 'Gastos de Administración y Ventas', vigente: true },
    { id: 280625, parent: 280624, empresa: 2921, codigo: '70', nombre: 'Remuneraciones', vigente: true },
    { id: 280805, parent: 280804, empresa: 2921, codigo: '73', nombre: 'Logística Inversa', vigente: true }
  ],
  '/contracts-resumed-paginated/': [
    contrato({ contratoId: 1, personaId: 1475433, rut: '11111111-1', nombre: 'ANA MARIA',
               ap: 'SOTO', am: 'RIVAS', cargo: 'ANALISTA SENIOR EN RRHH',
               razonSocial: 'LOGISTICA Y TRANSPORTES RT SPA', rutEmpresa: '76946183-3',
               cc: { id: 280625, codigo: '70', nombre: 'Remuneraciones' } }),
    contrato({ contratoId: 2, personaId: 3301888, rut: '22222222-2', nombre: 'JUAN CARLOS',
               ap: 'PEREZ', am: 'ORTEGA', cargo: 'JEFE DE SERVICIOS RETAIL',
               razonSocial: 'REDTEC SA', rutEmpresa: '76941810-5',
               cc: { id: 280805, codigo: '73', nombre: 'Logística Inversa' } }),
    // Finiquitado: no debe aparecer como activo en el reporte.
    Object.assign(
      contrato({ contratoId: 3, personaId: 999999, rut: '33333333-3', nombre: 'PEDRO',
                 ap: 'GONZALEZ', am: 'LARA', cargo: 'OPERARIO',
                 razonSocial: 'REDTEC SA', rutEmpresa: '76941810-5',
                 cc: { id: 280805, codigo: '73', nombre: 'Logística Inversa' } }),
      { activo: false, finiquitado: true })
  ],
  // /workShift/ responde 403 en la cuenta de REDTEC (falta de permiso).
  '/workShift/': { error: { status: 403, mensaje: '{"detail":"No tienes permisos para realizar la solicitud"}' } },
  '/rotativeDay/': diasSemana(296456, '12:30', '18:00', 330)
    .concat(diasSemana(296457, '08:00', '17:30', 510)),
  '/specialRotativeDay/': [],
  '/workShiftPersonRange/': [
    { id: 5001, fromDate: '2026-01-01', toDate: null, workShift: 296456, person: 1475433 },
    { id: 5002, fromDate: '2026-01-01', toDate: null, workShift: 296457, person: 3301888 }
  ],
  '/specificDay-paginado/': [],
  '/mark/': [
    marca(9001, 1475433, 'ANA MARIA', 'SOTO', 'RIVAS', '11111111-1', `${HOY} 12:26:04`, 'E', 'ck-1'),
    marca(9002, 1475433, 'ANA MARIA', 'SOTO', 'RIVAS', '11111111-1', `${HOY} 18:11:47`, 'X', 'ck-2'),
    marca(9003, 3301888, 'JUAN CARLOS', 'PEREZ', 'ORTEGA', '22222222-2', `${HOY} 08:14:02`, 'E', 'ck-3'),
    // Marca repetida (mismo checksum): el sync debe deduplicarla.
    marca(9003, 3301888, 'JUAN CARLOS', 'PEREZ', 'ORTEGA', '22222222-2', `${HOY} 08:14:02`, 'E', 'ck-3'),
    // Marca de otro día: entra en la ventana pedida pero debe descartarse.
    marca(9004, 3301888, 'JUAN CARLOS', 'PEREZ', 'ORTEGA', '22222222-2', '2026-08-30 09:00:00', 'E', 'ck-4')
  ],
  '/absentism-resumed/': [
    { persona_id: 3301888, fechaDesde: '2026-08-31', fechaHasta: '2026-08-31', tipo: 'Permiso sin goce' }
  ],
  '/vacations-resumed/': [
    { persona_id: 1475433, desde: '2026-09-10', hasta: '2026-09-20', tipo: 'Vacaciones' }
  ],
  '/administrative-leaves-resumed/': []
};

function contrato(o) {
  return {
    id: o.contratoId, persona_rut: o.rut, empleado: o.personaId, codigo: '00' + o.contratoId,
    tipoContrato: { id: 1, nombre: 'Indefinido' },
    empleadorRazonSocial: { id: 9350, rut: o.rutEmpresa, razonSocial: o.razonSocial },
    cargo: o.cargo, fechaContratacion: '2021-08-01', desde: '2026-04-26', hasta: null,
    finiquitado: false, activo: true,
    unidadOrganizacional: { parent: 26337, nombre: 'Recursos Humanos', id: 59518, codigo: 'RH_02' },
    sucursal: { id: 34733, nombre: 'BODEGA SANTIAGO', direccionCalle: 'Av Americo Vespucio Norte' },
    jornada: { id: 1, nombre: 'Lunes a Viernes' }, horasDeLaJornada: 42,
    centroCosto: Object.assign({ parent: null, empresa: 2921 }, o.cc),
    personaDetails: {
      id: o.personaId, rut: o.rut, nombre: o.nombre,
      apellidoPaterno: o.ap, apellidoMaterno: o.am, sexo: 'M',
      fechaNacimiento: '1985-01-15', nacionalidad: 'CL', email: 'correo@ejemplo.cl'
    },
    // Talana devuelve montos de bonos aquí. No deben llegar al navegador.
    userDefinedFields: { BonoGestion: '200000', BonoResponsabilidad: '170000', BonoEspecial: '133333' },
    jefe: { id: 1475329, rut: '44444444-4', nombre: 'ELBA', apellidoPaterno: 'ACEITON', apellidoMaterno: 'CORTES' },
    grupos: [], empresa_id: 2921
  };
}

// numberWorkingDay 0..4 = lunes a viernes (convención confirmada por el `name`).
function diasSemana(workShift, entrada, salida, minutos) {
  const nombres = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return nombres.map((name, i) => ({
    id: workShift * 10 + i, name,
    startSnackHours: null, numberSnackMinutes: 0,
    startWorkingHours: i < 5 ? entrada : null,
    numberWorkingMinutes: i < 5 ? minutos : 0,
    workingDay: i < 5, numberWorkingDay: i, workShift,
    exit_time: i < 5 ? salida : null, exit_snack_time: null
  }));
}

function marca(id, personaId, nombre, ap, am, rut, ts, direction, checksum) {
  return {
    id, person: { id: personaId, nombre, rut, apellidoPaterno: ap, apellidoMaterno: am, sexo: 'M' },
    office: 34733, photo: null, TS: ts, direction, message: '', checksum,
    lat: null, lng: null, sourceMark: null, markingMethod: 'reloj', phoneModel: null
  };
}

// ── Parcheo de las dos fronteras ────────────────────────────────────────────
const cliente = require(path.join(__dirname, '../api/shared/talana-client.js'));

const llamadas = [];
cliente.listar = async function (recurso) {
  llamadas.push(recurso);
  const f = FIXTURES[recurso];
  if (f && f.error) {
    const e = new Error(`Talana ${recurso} → HTTP ${f.error.status}: ${f.error.mensaje}`);
    e.status = f.error.status;
    throw e;
  }
  return { items: f || [], completo: true, paginas: 1, status: 200 };
};

// Contenedor Blob en memoria, con la misma superficie que usa talana-store.
const BLOBS = new Map();
const contenedorFalso = {
  createIfNotExists: async () => ({}),
  getBlobClient: clave => ({
    download: async () => {
      if (!BLOBS.has(clave)) { const e = new Error('BlobNotFound'); throw e; }
      return { readableStreamBody: (async function* () { yield Buffer.from(BLOBS.get(clave)); })() };
    }
  }),
  getBlockBlobClient: clave => ({
    upload: async cuerpo => { BLOBS.set(clave, cuerpo); return {}; }
  })
};

// El SDK de Azure sólo existe cuando la Function App instala sus dependencias.
// Se sustituye para que esta prueba corra en cualquier parte, incluido un
// checkout limpio sin npm install.
const Module = require('module');
const cargarOriginal = Module._load;
Module._load = function (peticion) {
  if (peticion === '@azure/storage-blob') {
    return { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => contenedorFalso }) } };
  }
  return cargarOriginal.apply(this, arguments);
};

const store = require(path.join(__dirname, '../api/shared/talana-store.js'));
store.getContainer = () => contenedorFalso;
store.hoyIso = () => HOY;

const sync    = require(path.join(__dirname, '../api/talana-sync/index.js'));
const servir  = require(path.join(__dirname, '../api/talana-asistencia/index.js'));

const ctx = () => ({ res: null, log: Object.assign(() => {}, { error: () => {} }) });

async function llamarSync(cuerpo) {
  const c = ctx();
  await sync(c, { method: 'POST', headers: { 'x-ingesta-key': 'llave-de-prueba' }, body: cuerpo || {}, query: {} });
  return { status: c.res.status, json: JSON.parse(c.res.body) };
}

async function llamarApi(endpoint, query) {
  const c = ctx();
  await servir(c, { method: 'GET', headers: {}, query: Object.assign({ endpoint }, query || {}) });
  return { status: c.res.status, json: JSON.parse(c.res.body), headers: c.res.headers };
}

// ── Ejecución ───────────────────────────────────────────────────────────────
(async () => {

console.log('\nSeguridad del sincronizador');

{
  const c = ctx();
  await sync(c, { method: 'POST', headers: {}, body: {}, query: {} });
  prueba('sin la llave compartida, talana-sync responde 401', () => {
    assert.strictEqual(c.res.status, 401);
  });
}

console.log('\nAntes del primer sync');

{
  const r = await llamarApi('/employee');
  prueba('sin snapshot la API responde 503 con instrucciones, no 500', () => {
    assert.strictEqual(r.status, 503);
    assert.ok(/talana-sync/.test(r.json.detalle), 'el mensaje debe decir qué ejecutar: ' + r.json.detalle);
  });
}

console.log('\nSincronización');

const rs = await llamarSync({ desde: HOY, hasta: HOY, maestros: true });

prueba('el sync termina sin días pendientes', () => {
  assert.strictEqual(rs.status, 200);
  assert.strictEqual(rs.json.ok, true);
  assert.strictEqual(rs.json.pendientes, 0, JSON.stringify(rs.json.avisos));
  assert.deepStrictEqual(rs.json.dias_sincronizados, [HOY]);
});

prueba('el 403 de /workShift/ no detiene la sincronización', () => {
  assert.ok(llamadas.includes('/workShift/'), 'debió intentarse');
  assert.strictEqual(rs.json.maestros.indexOf('actualizados'), 0, rs.json.maestros);
});

prueba('quedaron escritos los blobs esperados', () => {
  assert.ok(BLOBS.has('talana/maestros.json'));
  assert.ok(BLOBS.has(`talana/marcas/${HOY}.json`));
  assert.ok(BLOBS.has('talana/ausencias/2026-08.json'));
  assert.ok(BLOBS.has('talana/estado.json'));
});

console.log('\nEstado');

{
  const r = await llamarApi('/_estado');
  prueba('/_estado informa la convención deducida del dato', () => {
    assert.strictEqual(r.json.dia_cero.usado, 'lunes');
    assert.strictEqual(r.json.dia_cero.detectado_del_dato, true);
  });
  prueba('/_estado avisa que el catálogo de turnos quedó degradado', () => {
    assert.ok(r.json.catalogo_turnos_degradado, 'debe reportar el 403 de /workShift/');
    assert.ok(/403/.test(r.json.catalogo_turnos_degradado), r.json.catalogo_turnos_degradado);
  });
  prueba('/_estado cuenta turnos y asignaciones', () => {
    assert.strictEqual(r.json.turnos, 2, 'los dos turnos reconstruidos desde rotativeDay');
    assert.strictEqual(r.json.asignaciones, 2);
  });
}

console.log('\nContrato que consume el reporte');

{
  const r = await llamarApi('/employee');
  const emps = r.json.data;
  prueba('/employee usa el sobre de Workera { data, totalPages, totalResult }', () => {
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.totalPages, 1);
    assert.strictEqual(r.json.totalResult, emps.length);
  });
  prueba('empActivo() del reporte deja pasar a los vigentes y filtra al finiquitado', () => {
    const activos = emps.filter(e => String(e.employeeStatus).toUpperCase() === 'ACTIVO');
    assert.strictEqual(activos.length, 2, 'los dos vigentes');
    const fin = emps.find(e => e.code === '999999');
    assert.strictEqual(fin.employeeStatus, 'INACTIVO');
  });
  prueba('el selector de empresa encuentra las dos razones sociales', () => {
    const empresas = [...new Set(emps.map(e => e.empresa))].sort();
    assert.deepStrictEqual(empresas, ['LOGISTICA Y TRANSPORTES RT SPA', 'REDTEC SA']);
  });
  prueba('ningún monto de bono viaja en la respuesta', () => {
    const txt = JSON.stringify(r.json);
    for (const campo of ['BonoGestion', 'BonoResponsabilidad', 'BonoEspecial', 'userDefinedFields']) {
      assert.ok(!txt.includes(campo), 'se filtró ' + campo);
    }
  });
}

{
  const r = await llamarApi('/attendanceData', { start: HOY, end: HOY });
  const marcas = r.json.data;
  prueba('/attendanceData deduplica y descarta las marcas de otro día', () => {
    assert.strictEqual(marcas.length, 3, 'dos de Ana y una de Juan');
    assert.ok(marcas.every(m => m.attendanceDate.slice(0, 10) === HOY));
  });
  prueba('attendanceDate lleva la T que parsea el reporte', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(marcas[0].attendanceDate), marcas[0].attendanceDate);
  });
  prueba('el sentido de la marca viene de Talana, no de una suposición', () => {
    const ana = marcas.filter(m => m.employee.code === '1475433');
    assert.deepStrictEqual(ana.map(m => m.tipo), ['ENTRADA', 'SALIDA']);
  });
  prueba('cada marca trae el empleado anidado que el reporte lee', () => {
    assert.ok(marcas.every(m => m.employee && m.employee.code && m.employee.identification));
  });
}

{
  const r = await llamarApi('/workshift/schedules', { start: HOY, end: HOY });
  const filas = r.json.data;
  const ana = filas.find(x => x.employee.code === '1475433');
  prueba('el horario teórico se construye pese al 403 del catálogo', () => {
    assert.strictEqual(ana.schedules.length, 1);
    assert.strictEqual(ana.schedules[0].date, HOY);
  });
  prueba('el lunes toma el horario del lunes, no el de otro día', () => {
    assert.strictEqual(ana.schedules[0].start, `${HOY}T12:30:00`);
    assert.strictEqual(ana.schedules[0].end,   `${HOY}T18:00:00`);
  });
  prueba('sin /workShift/, el turno se nombra por su horario', () => {
    assert.ok(/12:30/.test(ana.schedules[0].workshiftName), ana.schedules[0].workshiftName);
  });
  prueba('no quedan trabajadores en rotativos_sin_ancla', () => {
    assert.deepStrictEqual(r.json.rotativos_sin_ancla, []);
  });
}

{
  const r = await llamarApi('/permission', { start: HOY, end: HOY });
  prueba('/permission entrega las ausencias del mes sincronizado', () => {
    assert.strictEqual(r.json.data.length, 1);
    const p = r.json.data[0];
    assert.strictEqual(p.employeeCode, '3301888');
    assert.strictEqual(p.start, HOY);
    assert.strictEqual(p.permissionTypeName, 'Permiso sin goce');
    assert.deepStrictEqual(r.json.meses_sin_snapshot, []);
  });
  prueba('no viaja información médica ni número de licencia', () => {
    const txt = JSON.stringify(r.json);
    for (const campo of ['numeroLicencia', 'medicoLicencia', 'enfermedades_cronicas', 'alergias', 'medicamentos']) {
      assert.ok(!txt.includes(campo), 'se filtró ' + campo);
    }
  });

  // Sólo se sincronizó agosto. Al pedir septiembre las vacaciones del fixture
  // no están, y eso NO puede quedar callado: sin aviso, un permiso ausente se
  // ve en el calendario como una falta injustificada.
  const sep = await llamarApi('/permission', { start: HOY, end: '2026-09-30' });
  prueba('un mes sin sincronizar se declara en meses_sin_snapshot', () => {
    assert.deepStrictEqual(sep.json.meses_sin_snapshot, ['2026-09']);
  });

  const todo = await llamarApi('/todo', { start: HOY, end: '2026-09-30' });
  prueba('/todo también arrastra el aviso de cobertura incompleta', () => {
    assert.deepStrictEqual(todo.json.avisos.meses_sin_snapshot, ['2026-09']);
    assert.ok(todo.json.avisos.dias_sin_snapshot.length > 0, 'septiembre tampoco tiene marcas');
  });
}

{
  const r = await llamarApi('/branchOffice');
  const s = await llamarApi('/department');
  const a = await llamarApi('/workshift/assign', { start: HOY, end: HOY });
  prueba('sucursales, centros de costo y asignaciones responden con code y name', () => {
    assert.strictEqual(r.json.data.length, 2);
    assert.ok(r.json.data.every(x => x.code && x.name));
    assert.strictEqual(s.json.data.length, 3);
    assert.ok(s.json.data.every(x => x.code && x.name));
    assert.strictEqual(a.json.data.length, 2);
    assert.ok(a.json.data.every(x => x.employee && x.workshiftName && x.period));
  });
}

{
  const r = await llamarApi('/todo', { start: HOY, end: HOY });
  prueba('/todo entrega todo el rango en una sola respuesta', () => {
    for (const k of ['sucursales', 'departamentos', 'empleados', 'asignaciones', 'horarios', 'marcas', 'permisos']) {
      assert.ok(Array.isArray(r.json[k]), 'falta ' + k);
    }
    assert.strictEqual(r.json.avisos.dias_sin_snapshot.length, 0);
  });
}

console.log('\nSegunda pasada (idempotencia y ventana de gracia)');

{
  const llamadasAntes = llamadas.length;
  const r2 = await llamarSync({ desde: HOY, hasta: HOY });
  prueba('el segundo sync no repite los maestros ni deja pendientes', () => {
    assert.strictEqual(r2.json.maestros, 'vigentes');
    assert.strictEqual(r2.json.pendientes, 0);
  });
  prueba('reconsulta el día de hoy porque sigue dentro de la ventana de gracia', () => {
    assert.ok(llamadas.slice(llamadasAntes).includes('/mark/'),
      'un día abierto debe reconsultarse: pueden subir marcas atrasadas');
  });
}

console.log(`\n${ok} pruebas de integración pasaron${process.exitCode ? ' (con fallos)' : ''}.\n`);

})().catch(e => { console.error('\nFALLO NO CAPTURADO:\n', e); process.exitCode = 1; });
