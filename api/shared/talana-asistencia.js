// ============================================================================
//  shared/talana-asistencia.js  ·  Traducción Talana → contrato del reporte
//
//  El reporte "al día" se escribió contra el modelo de Workera. En vez de
//  reescribir 1.500 líneas de JS de calendario, esta capa traduce Talana a
//  ESE mismo contrato. El HTML sigue viendo:
//
//     employee   { code, name, lastName, identification, branchOffice... }
//     schedule   { date, workshiftCode, workshiftName, scheduleName, start, end }
//     mark       { attendanceDate, employee, checksum, direction }
//     permission { employeeCode, employeeName, start, end, permissionTypeName }
//
//  Equivalencias usadas (developers.talana.com):
//
//   Workera                     Talana
//   ─────────────────────────   ──────────────────────────────────────────────
//   /branchOffice               /sucursal/
//   /department                 /centroCosto/            (árbol de centros)
//   /employee                   /contracts-resumed-paginated/  ← trae persona,
//                                 sucursal, centro de costo, cargo y jefe de
//                                 una sola vez; /personas-paginadas/ no.
//   /attendanceData             /mark/                   (desde / hasta)
//   /workshift/assign           /workShiftPersonRange/
//   /workshift/schedules        (no existe) → se CONSTRUYE cruzando
//                                 workShiftPersonRange × workShift ×
//                                 rotativeDay | specialRotativeDay | specificDay
//   /permission                 /absentism-resumed/, /vacations-resumed/,
//                               /administrative-leaves-resumed/
//                                 (variantes "resumed": sin datos médicos)
//
//  Clave de unión: el id numérico de persona de Talana, que viaja en
//  mark.person.id y en contrato.empleado. Es el que ocupa "code".
// ============================================================================

const talana = require('./talana-client.js');

// ¿Qué día representa numberWorkingDay = 0 en los turnos semanales?
// En Talana lo habitual es lunes; se deja configurable porque el dato no está
// documentado y el diagnóstico permite verificarlo contra la realidad.
const DIA_CERO = (process.env.TALANA_DIA_CERO || 'lunes').toLowerCase();

// Nombres de día como los escribe Talana en rotativeDay.name, sin tildes.
const NOMBRE_A_DIA_JS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6
};
const sinTildes = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// ── helpers de fecha / hora ─────────────────────────────────────────────────
const pad = n => (n < 10 ? '0' + n : '' + n);

function isoDia(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function rangoDias(desde, hasta) {
  const out = [];
  let d = new Date(desde + 'T00:00:00');
  const fin = new Date(hasta + 'T00:00:00');
  while (d <= fin) { out.push(isoDia(d)); d = new Date(d.getTime() + 86400000); }
  return out;
}

function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDia(d);
}

// "08:00:00" | "08:00" | "1900-01-01T08:00:00" → minutos desde medianoche
function aMinutos(hora) {
  if (hora === null || hora === undefined) return null;
  const s = String(hora);
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// fecha 'YYYY-MM-DD' + minutos → 'YYYY-MM-DDTHH:MM:SS' (desborda de día si toca)
function fechaHora(fecha, minutos) {
  if (minutos === null || minutos === undefined) return null;
  const diasExtra = Math.floor(minutos / 1440);
  const resto = ((minutos % 1440) + 1440) % 1440;
  const base = diasExtra ? sumarDias(fecha, diasExtra) : fecha;
  return `${base}T${pad(Math.floor(resto / 60))}:${pad(resto % 60)}:00`;
}

// Índice de día de semana según la convención de Talana.
// JS getDay(): 0=domingo … 6=sábado.
function indiceDiaSemana(fecha, diaCero) {
  const js = new Date(fecha + 'T00:00:00').getDay();
  return (diaCero || DIA_CERO) === 'domingo' ? js : (js + 6) % 7;   // lunes = 0
}

/**
 * Deduce si numberWorkingDay = 0 es lunes o domingo, leyendo el `name` que
 * Talana pone en cada día del turno ("Lunes", "Martes", …).
 *
 * La documentación no lo especifica, y equivocarse corre TODOS los horarios un
 * día sin que nada falle de forma visible. Como el propio dato lo dice, se
 * prefiere deducirlo antes que confiar en una variable de entorno.
 * Si los nombres no son reconocibles, cae en TALANA_DIA_CERO.
 */
function detectarDiaCero(diasCrudos) {
  const votos = { lunes: 0, domingo: 0 };
  for (const d of diasCrudos || []) {
    const dow = NOMBRE_A_DIA_JS[sinTildes(d.name)];
    if (dow === undefined || d.numberWorkingDay === null || d.numberWorkingDay === undefined) continue;
    const n = Number(d.numberWorkingDay);
    if ((n + 1) % 7 === dow % 7) votos.lunes++;      // 0=lunes → dow 1
    if (n % 7 === dow % 7) votos.domingo++;          // 0=domingo → dow 0
  }
  if (votos.lunes === 0 && votos.domingo === 0) return { diaCero: DIA_CERO, detectado: false, votos };
  const diaCero = votos.lunes >= votos.domingo ? 'lunes' : 'domingo';
  return { diaCero, detectado: true, votos };
}

const soloFecha = s => (s ? String(s).slice(0, 10) : '');

// ── hora de pared local ─────────────────────────────────────────────────────
// Talana entrega el TS de las marcas con desfase horario y a veces con
// microsegundos: "2026-08-31T09:06:32.979284-04:00". El horario teórico, en
// cambio, es hora de pared sin desfase ("2026-08-31T12:30:00"), porque un turno
// "entra a las 12:30" y punto.
//
// El reporte resta ambos para calcular atrasos, y restar un instante absoluto
// contra una hora flotante da resultados distintos según la zona del navegador
// que abra la página. Para que la comparación sea siempre la misma, las marcas
// se normalizan a hora de pared de Chile antes de guardarlas.
const TZ = process.env.TALANA_TZ || 'America/Santiago';
const FMT_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function aHoraLocal(ts) {
  if (!ts) return '';
  const s = String(ts).trim().replace(' ', 'T');
  // Sin desfase: ya viene como hora de pared, sólo se recorta el sobrante.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, 19);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 19);
  const p = {};
  for (const { type, value } of FMT_LOCAL.formatToParts(d)) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  MAESTROS
// ════════════════════════════════════════════════════════════════════════════

async function traerSucursales(opts) {
  const { items, completo } = await talana.listar('/sucursal/', {}, opts);
  const data = items
    .filter(s => s.vigente !== false)
    .map(s => ({
      id: s.id,
      code: String(s.id),
      name: s.nombre || ('Sucursal ' + s.id),
      comuna: s.direccionComuna || null,
      direccion: [s.direccionCalle, s.direccionNumero].filter(Boolean).join(' ')
    }));
  return { data, completo };
}

async function traerCentrosCosto(opts) {
  const { items, completo } = await talana.listar('/centroCosto/', {}, opts);
  const data = items.map(c => ({
    id: c.id,
    code: c.codigo || String(c.id),
    name: c.nombre || c.codigo || ('CC ' + c.id),
    parent: c.parent || null
  }));
  return { data, completo };
}

/**
 * Empleados vigentes, desde los contratos resumidos.
 * `activo_en` (YYYY-MM-DD) acota a quienes tenían contrato vigente ese día;
 * si se omite, se piden sólo los activos hoy.
 */
async function traerEmpleados(opts = {}) {
  const params = { 'solo-activos': 'true' };
  if (opts.activoEn) params.active_on = String(opts.activoEn).replace(/-/g, '');

  const { items, completo } = await talana.listar('/contracts-resumed-paginated/', params, opts);

  // Una persona puede tener más de un contrato: nos quedamos con el más reciente.
  const porPersona = new Map();
  for (const c of items) {
    const id = c.empleado || (c.personaDetails && c.personaDetails.id);
    if (!id) continue;
    const previo = porPersona.get(id);
    if (!previo || String(c.desde || '') > String(previo.desde || '')) porPersona.set(id, c);
  }

  const data = [...porPersona.values()].map(c => {
    const p = c.personaDetails || {};
    const suc = c.sucursal || {};
    const cc  = c.centroCosto || {};
    const uo  = c.unidadOrganizacional || {};
    return {
      code:              String(c.empleado || p.id),
      personaId:         c.empleado || p.id,
      contratoId:        c.id,
      name:              p.nombre || '',
      lastName:          p.apellidoPaterno || '',
      secondLastName:    p.apellidoMaterno || '',
      identification:    c.persona_rut || p.rut || '',
      // El reporte filtra por employeeStatus === 'ACTIVO'. Es un campo que venía
      // de Workera: si no se emite, el calendario sale vacío sin dar ningún error.
      employeeStatus:    (c.activo && !c.finiquitado) ? 'ACTIVO' : 'INACTIVO',
      birthDate:         soloFecha(p.fechaNacimiento),
      genre:             p.sexo === 'M' ? 'Masculino' : p.sexo === 'F' ? 'Femenino' : (p.sexo || ''),
      personalMail:      p.email || '',
      personalPhone:     '',            // no viene en contracts-resumed-paginated
      email:             p.email || null,
      branchOffice:      suc.id ? String(suc.id) : '',
      branchOfficeCode:  suc.id ? String(suc.id) : '',
      branchOfficeName:  suc.nombre || '',
      department:        cc.codigo || (cc.id ? String(cc.id) : ''),
      departmentCode:    cc.codigo || (cc.id ? String(cc.id) : ''),
      departmentName:    cc.nombre || uo.nombre || '',
      gerencia:          uo.nombre || '',
      position:          c.cargo || '',
      jornada:           (c.jornada && c.jornada.nombre) || '',
      horasJornada:      c.horasDeLaJornada || null,
      tipoContrato:      (c.tipoContrato && c.tipoContrato.nombre) || '',
      // REDTEC opera con dos razones sociales; el reporte filtra por esto.
      empresa:           (c.empleadorRazonSocial && c.empleadorRazonSocial.razonSocial) || '',
      empresaRut:        (c.empleadorRazonSocial && c.empleadorRazonSocial.rut) || '',
      fechaContratacion: soloFecha(c.fechaContratacion),
      desde:             soloFecha(c.desde),
      hasta:             soloFecha(c.hasta),
      finiquitado:       Boolean(c.finiquitado),
      jefe:              c.jefe ? [c.jefe.nombre, c.jefe.apellidoPaterno].filter(Boolean).join(' ') : ''
    };
  });

  data.sort((a, b) => (a.lastName + a.name).localeCompare(b.lastName + b.name, 'es'));
  return { data, completo };
}

/**
 * Catálogo de turnos + la definición de sus días.
 *   workShiftType: 'W' semanal, 'R' rotativo, 'M' manual
 *   /rotativeDay/         → días de los turnos semanales  (numberWorkingDay 0..6)
 *   /specialRotativeDay/  → días de los turnos rotativos  (dayNumber en el ciclo)
 *   /specificDay-paginado/→ días de los turnos manuales   (date concreta)
 */
async function traerTurnos(opts = {}) {
  // /workShift/ es el catálogo (nombre, tipo, tolerancia). El token de REDTEC
  // recibe 403 en este recurso, así que NO puede ser obligatorio: si falla, el
  // catálogo se reconstruye a partir de los días, que sí responden. Se pierde
  // el nombre real del turno y la tolerancia, no el horario.
  let catalogo = {};
  let catalogoDegradado = null;
  let turnosCompleto = true;
  try {
    const turnos = await talana.listar('/workShift/', {}, opts);
    turnosCompleto = turnos.completo;
    for (const t of turnos.items) {
      catalogo[String(t.id)] = {
        id: t.id,
        name: t.name || ('Turno ' + t.id),
        type: t.workShiftType || 'W',
        tolerance: Number(t.tolerance || 0),
        snackDuration: t.snackDuration || null,
        schedule: t.schedule || '',
        publicId: t.publicId || null
      };
    }
  } catch (e) {
    catalogoDegradado = `/workShift/ → ${e.status || 'error'}: ${e.message.slice(0, 160)}`;
  }

  const semanales = await talana.listar('/rotativeDay/', {}, opts);
  const rotativos = await talana.listar('/specialRotativeDay/', {}, opts);

  // Convención de días deducida del propio dato, no adivinada.
  const dc = detectarDiaCero(semanales.items);

  const diasSemanales = {};   // workShiftId → { indiceDia: definicion }
  for (const d of semanales.items) {
    const k = String(d.workShift);
    (diasSemanales[k] = diasSemanales[k] || {})[String(d.numberWorkingDay)] = normalizarDia(d);
  }

  const diasRotativos = {};   // workShiftId → [definiciones ordenadas por dayNumber]
  for (const d of rotativos.items) {
    const k = String(d.workShift);
    (diasRotativos[k] = diasRotativos[k] || []).push(normalizarDia(d, d.dayNumber));
  }
  for (const k of Object.keys(diasRotativos)) {
    diasRotativos[k].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }

  // Turnos que aparecen en los días pero no en el catálogo (por el 403, o
  // porque el catálogo llegó incompleto): se infiere el tipo de dónde salieron.
  for (const k of Object.keys(diasSemanales)) {
    if (!catalogo[k]) catalogo[k] = turnoInferido(k, 'W', diasSemanales[k]);
  }
  for (const k of Object.keys(diasRotativos)) {
    if (!catalogo[k]) catalogo[k] = turnoInferido(k, 'R');
  }

  return {
    catalogo, diasSemanales, diasRotativos,
    diaCero: dc.diaCero,
    diaCeroDetectado: dc.detectado,
    diaCeroVotos: dc.votos,
    catalogoDegradado,
    completo: turnosCompleto && semanales.completo && rotativos.completo
  };
}

// Turno reconstruido cuando /workShift/ no está disponible. El nombre sale del
// horario que realmente cumple, que es más útil que "Turno 296456".
function turnoInferido(id, tipo, dias) {
  let etiqueta = 'Turno ' + id;
  if (dias) {
    const laborables = Object.values(dias).filter(d => d.trabaja && d.inicio !== null);
    if (laborables.length) {
      const d = laborables[0];
      const hhmm = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
      etiqueta = `${hhmm(d.inicio)}–${hhmm(d.fin)} (${laborables.length}d)`;
    }
  }
  return {
    id: Number(id), name: etiqueta, type: tipo,
    tolerance: 0, snackDuration: null, schedule: '', publicId: null,
    inferido: true
  };
}

function normalizarDia(d, orden) {
  const inicio = aMinutos(d.startWorkingHours);
  let fin = aMinutos(d.exit_time);
  // Si Talana no calculó exit_time, derivarlo de la duración.
  if (fin === null && inicio !== null && d.numberWorkingMinutes) {
    fin = inicio + Number(d.numberWorkingMinutes);
  }
  // Turno nocturno: la salida cae al día siguiente.
  if (inicio !== null && fin !== null && fin <= inicio) fin += 1440;
  return {
    nombre: d.name || '',
    trabaja: d.workingDay !== false,
    inicio, fin,
    colacionInicio: aMinutos(d.startSnackHours),
    colacionMin: d.numberSnackMinutes || null,
    orden: orden !== undefined ? Number(orden || 0) : Number(d.numberWorkingDay || 0)
  };
}

/**
 * Asignaciones persona ↔ turno ↔ rango de fechas.
 *
 * Un 403 aquí NO puede tumbar la sincronización: las marcas, las personas y las
 * sucursales sí se pueden traer, y el reporte todavía sirve para ver quién marcó
 * y a qué hora. Lo que se pierde es el horario teórico, o sea la puntualidad y
 * la detección de ausencias. Se devuelve vacío y se declara la degradación.
 */
async function traerAsignaciones(opts) {
  try {
    const { items, completo } = await talana.listar('/workShiftPersonRange/', {}, opts);
    const data = items.map(a => ({
      id: a.id,
      person: a.person,
      workShift: a.workShift,
      fromDate: soloFecha(a.fromDate),
      toDate: soloFecha(a.toDate)
    }));
    return { data, completo, degradado: null };
  } catch (e) {
    return {
      data: [], completo: true,
      degradado: `/workShiftPersonRange/ → ${e.status || 'error'}: ${e.message.slice(0, 160)}`
    };
  }
}

/** Días de turnos manuales dentro de un rango. Mismo criterio ante un 403. */
async function traerDiasManuales(desde, hasta, opts) {
  try {
    const { items, completo } = await talana.listar(
      '/specificDay-paginado/', { min_date: desde, max_date: hasta }, opts
    );
    const porTurnoFecha = {};   // "workShiftId|fecha" → definicion
    for (const d of items) {
      porTurnoFecha[`${d.workShift}|${soloFecha(d.date)}`] = normalizarDia(d);
    }
    return { data: porTurnoFecha, completo, degradado: null };
  } catch (e) {
    return {
      data: {}, completo: true,
      degradado: `/specificDay-paginado/ → ${e.status || 'error'}: ${e.message.slice(0, 160)}`
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  MARCAS
// ════════════════════════════════════════════════════════════════════════════

// direction de Talana: E = entrada, X = salida, O = otra (colación, salida
// transitoria). Workera no traía este dato — su attendanceType venía siempre
// en 0 y el reporte tenía que adivinar por cercanía al horario teórico.
const DIRECCION = { E: 'ENTRADA', X: 'SALIDA', O: 'INTERMEDIA' };

/**
 * Marcas de un día. Se pide una ventana de un día extra porque los parámetros
 * `desde`/`hasta` de /mark/ filtran por fecha de CREACIÓN del registro y una
 * marca puede subir al sistema después (reloj sin red, corrección manual);
 * luego se filtra por TS, que es la hora real de la marca.
 */
async function traerMarcasDia(fecha, opts = {}) {
  const holgura = Number(process.env.TALANA_MARCAS_HOLGURA_DIAS || 1);
  const { items, completo } = await talana.listar(
    '/mark/',
    { desde: sumarDias(fecha, -holgura), hasta: sumarDias(fecha, holgura) },
    opts
  );

  const data = items
    .map(mapearMarca)
    .filter(m => m.attendanceDate && m.attendanceDate.slice(0, 10) === fecha);

  // Deduplicar por checksum (Talana puede repetir una marca reprocesada).
  const vistos = new Set();
  const unicas = [];
  for (const m of data) {
    const k = m.checksum || `${m.employee.code}|${m.attendanceDate}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    unicas.push(m);
  }
  unicas.sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate));
  return { data: unicas, completo, crudas: items.length };
}

function mapearMarca(m) {
  const p = m.person || {};
  // TS real de Talana: "2026-08-31T10:28:43-04:00" o con microsegundos,
  // "2026-08-31T09:06:32.979284-04:00". Se normaliza a hora de pared de Chile.
  const ts = aHoraLocal(m.TS || m.ts);
  return {
    id: m.id,
    attendanceDate: ts,                      // el reporte lee este campo
    tsOriginal: m.TS || null,                // se conserva por trazabilidad
    employee: {
      code: String(p.id || ''),
      personaId: p.id || null,
      name: p.nombre || '',
      lastName: p.apellidoPaterno || '',
      secondLastName: p.apellidoMaterno || '',
      identification: p.rut || ''
    },
    checksum: m.checksum || null,
    direction: m.direction || null,          // E | X | O
    tipo: DIRECCION[m.direction] || null,    // ENTRADA | SALIDA | INTERMEDIA
    attendanceType: m.direction === 'E' ? 1 : m.direction === 'X' ? 2 : 0,
    markingMethod: m.markingMethod || null,
    office: m.office || null,
    lat: m.lat || null,
    lng: m.lng || null,
    message: m.message || ''
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  AUSENCIAS  (variantes "resumed": sin número de licencia ni datos médicos)
// ════════════════════════════════════════════════════════════════════════════

// Las tres fuentes "resumed" NO comparten nombres de campo. Verificado contra
// la cuenta de REDTEC:
//
//   /absentism-resumed/             fechaDesde / fechaHasta / tipoAusencia
//   /vacations-resumed/             vacacionesDesde / vacacionesHasta / tipoVacaciones
//   /administrative-leaves-resumed/ desde / hasta / administrative_type
//
// Las tres anidan al trabajador en `empleado` como OBJETO (no como id).
const FUENTES_AUSENCIA = [
  {
    recurso: '/absentism-resumed/',
    etiqueta: 'Licencia/Permiso',
    desde: a => a.fechaDesde,
    hasta: a => a.fechaHasta,
    // Aquí el tipo ya es descriptivo: "falta injustificada", "permiso sin goce".
    tipo: a => a.tipoAusencia
  },
  {
    recurso: '/vacations-resumed/',
    etiqueta: 'Vacaciones',
    desde: a => a.vacacionesDesde,
    hasta: a => a.vacacionesHasta,
    // tipoVacaciones vale "normales" y solo no dice nada: se compone.
    tipo: a => (a.tipoVacaciones && a.tipoVacaciones !== 'normales')
      ? `Vacaciones (${a.tipoVacaciones})` : 'Vacaciones'
  },
  {
    recurso: '/administrative-leaves-resumed/',
    etiqueta: 'Día administrativo',
    desde: a => a.desde,
    hasta: a => a.hasta,
    tipo: a => (a.administrative_type && a.administrative_type !== 'anual')
      ? `Día administrativo (${a.administrative_type})` : 'Día administrativo'
  }
];

/**
 * Trae TODAS las ausencias resumidas. No acepta rango porque los endpoints
 * devuelven el histórico completo (1.425 ausencias, 2.615 vacaciones en REDTEC)
 * ignorando los filtros de fecha: pedirlas mes a mes traería lo mismo cada vez.
 * Se traen una vez y el sincronizador las reparte por mes.
 */
async function traerAusencias(opts = {}, avance = null) {
  // Son ~4.000 registros repartidos en decenas de páginas: no caben en el
  // presupuesto de una sola invocación de la Function. Por eso la traída es
  // REANUDABLE: cada pasada continúa donde quedó la anterior, guardando lo ya
  // leído y el cursor de cada fuente. Sin esto, cada pasada volvería a empezar
  // de la página 1 y la sincronización nunca terminaría.
  const previo = avance || { data: [], cursores: {}, fallos: [] };
  const data = previo.data.slice();
  const cursores = { ...previo.cursores };
  const fallos = previo.fallos.slice();
  let completo = true;

  for (const f of FUENTES_AUSENCIA) {
    const cursor = cursores[f.recurso];
    if (cursor === 'listo') continue;              // esta fuente ya terminó

    if (opts.presupuesto && opts.presupuesto.agotado(6000)) { completo = false; continue; }

    try {
      const r = await talana.listar(f.recurso, {}, {
        ...opts,
        // Estos recursos son grandes: páginas más gruesas = menos peticiones.
        pageSize: Number(process.env.TALANA_PAGE_SIZE_AUSENCIAS || 500),
        desdePath: typeof cursor === 'string' ? cursor : undefined
      });
      for (const a of r.items) data.push(mapearAusencia(a, f));
      if (r.completo) {
        cursores[f.recurso] = 'listo';
      } else {
        cursores[f.recurso] = r.siguiente || cursor || null;
        completo = false;
      }
    } catch (e) {
      // Un token sin permiso sobre un módulo no debe tumbar el resto.
      fallos.push(`${f.recurso}: ${e.message.slice(0, 160)}`);
      cursores[f.recurso] = 'listo';
    }
  }

  const avanceNuevo = { data, cursores, fallos };

  if (!completo) return { data: [], completo: false, fallos, avance: avanceNuevo, descartadas: 0 };

  const conFechas = data.filter(p => p.start && p.end);
  conFechas.sort((a, b) => a.start.localeCompare(b.start));
  return {
    data: conFechas, completo: true, fallos,
    descartadas: data.length - conFechas.length, avance: null
  };
}

// Una ausencia que Talana marca como injustificada NO es un permiso: si el
// reporte la pintara como licencia, una falta quedaría tapada como si fuera
// justificada. Se etiqueta para que el calendario la muestre como ausencia.
const esInjustificada = tipo => /injustificad/i.test(tipo || '');

/**
 * Generaliza el tipo de ausencia antes de que salga al navegador.
 *
 * Talana distingue "licencia medica" de "licencia maternal". El reporte sólo
 * necesita saber que la persona está justificadamente ausente; el motivo de
 * salud no aporta nada a la asistencia y quedaría a la vista de cualquiera que
 * abra el calendario, junto al nombre y el RUT. Se colapsan a "Licencia".
 *
 * Si RR.HH. necesita el detalle, TALANA_DETALLE_AUSENCIA=1 lo devuelve tal cual.
 */
const DETALLE_AUSENCIA = process.env.TALANA_DETALLE_AUSENCIA === '1';

function categoriaAusencia(tipo) {
  const t = sinTildes(tipo);
  if (!t) return 'Ausencia';
  if (DETALLE_AUSENCIA) return String(tipo);
  if (/injustificad/.test(t)) return 'Falta injustificada';
  // Vacaciones y días administrativos conservan su subtipo: "progresivas" o
  // "anual" son categorías legales, no información de salud.
  if (/vacacion/.test(t) || /administrativ/.test(t)) return String(tipo);
  if (/licencia/.test(t))     return 'Licencia';      // sin el motivo médico
  if (/permiso/.test(t))      return /sin goce/.test(t) ? 'Permiso sin goce' : 'Permiso';
  return String(tipo).charAt(0).toUpperCase() + String(tipo).slice(1);
}

/**
 * Vuelve a aplicar la política de tipos sobre una ausencia YA guardada.
 *
 * El snapshot puede haberse escrito con una versión anterior del mapeo, y los
 * bloques mensuales sólo se reescriben cuando vencen. Si la generalización
 * viviera únicamente en la escritura, un cambio de política tardaría horas en
 * llegar al navegador. Aplicarla también al servir hace que lo que sale sea
 * siempre lo vigente, sin depender de la antigüedad del snapshot.
 *
 * Es idempotente: una categoría ya normalizada vuelve a dar la misma.
 */
function normalizarAusenciaServida(p) {
  if (!p) return p;
  const crudo = p.permissionTypeName;
  return {
    ...p,
    permissionTypeName: categoriaAusencia(crudo),
    justificada: typeof p.justificada === 'boolean' ? p.justificada : !esInjustificada(crudo)
  };
}

function mapearAusencia(a, fuente) {
  const f = fuente || {};
  const bruto = a.empleado ?? a.persona ?? a.employee ?? a.detallesTrabajador;
  const persona = (bruto && typeof bruto === 'object') ? bruto : {};

  // `empleado` viene como objeto en los tres recursos, pero otros endpoints de
  // Talana lo mandan como id suelto. Sólo se toma como id si es un número.
  let personaId = null;
  if (typeof bruto === 'number') personaId = bruto;
  else if (persona.id !== undefined && persona.id !== null) personaId = persona.id;
  else if (a.persona_id ?? a.personaId) personaId = a.persona_id ?? a.personaId;

  const tipoCrudo = String(
    (f.tipo && f.tipo(a)) || a.tipo || a.type || a.tipoAusencia || f.etiqueta || 'Ausencia'
  );
  // La categoría es lo que viaja al navegador; el crudo sólo sirve para decidir
  // si la ausencia es justificada, y no sale de aquí.
  const tipo = categoriaAusencia(tipoCrudo);

  return {
    employeeCode: personaId !== null ? String(personaId) : '',
    employeeName: [persona.nombre, persona.apellidoPaterno, persona.apellidoMaterno]
      .filter(Boolean).join(' '),
    identification: persona.rut || a.rut || '',
    start: soloFecha((f.desde && f.desde(a)) || a.fechaDesde || a.desde || a.start || a.startDate),
    end:   soloFecha((f.hasta && f.hasta(a)) || a.fechaHasta || a.hasta || a.end   || a.endDate),
    permissionTypeName: tipo,
    justificada: !esInjustificada(tipoCrudo),
    dias: a.numeroDias || a.dias || null,
    medioDia: Boolean(a.mediosDias || a.medioDia),
    jornada: a.jornada || null,
    estado: a.estado || null
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HORARIO TEÓRICO  (lo que Workera servía en /workshift/schedules)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Expande turnos a horario por empleado y día.
 *
 * Talana NO expone un endpoint de "horario programado por día": hay que
 * cruzar la asignación (workShiftPersonRange) con la definición del turno.
 *
 *   W (semanal)  → rotativeDay indexado por día de la semana. Resuelto.
 *   M (manual)   → specificDay con fecha concreta. Resuelto.
 *   R (rotativo) → specialRotativeDay define el ciclo (día 1, día 2, …) pero
 *                  la API pública NO expone la fecha ancla del ciclo de cada
 *                  persona, así que no se puede saber en qué día del ciclo
 *                  cae una fecha. Esos empleados quedan sin horario teórico y
 *                  el reporte los resuelve con su heurística de primera marca
 *                  = entrada / última = salida. Se informan en `sinHorario`.
 */
function construirHorarios({ desde, hasta, empleados, asignaciones, turnos, diasManuales }) {
  const fechas = rangoDias(desde, hasta);
  const porPersona = new Map();
  for (const e of empleados) porPersona.set(String(e.code), e);

  // Asignaciones agrupadas por persona.
  const asigPorPersona = new Map();
  for (const a of asignaciones) {
    const k = String(a.person);
    if (!asigPorPersona.has(k)) asigPorPersona.set(k, []);
    asigPorPersona.get(k).push(a);
  }

  const salida = [];
  const sinHorario = new Set();
  const rotativosSinAncla = new Set();

  for (const [code, emp] of porPersona) {
    const asigs = asigPorPersona.get(code) || [];
    if (!asigs.length) { sinHorario.add(code); continue; }

    const schedules = [];
    for (const fecha of fechas) {
      // Asignación vigente ese día (toDate vacío = abierta).
      const asig = asigs.find(a =>
        (!a.fromDate || a.fromDate <= fecha) && (!a.toDate || a.toDate >= fecha)
      );
      if (!asig) continue;

      const turno = turnos.catalogo[String(asig.workShift)];
      if (!turno) continue;

      let def = null;
      if (turno.type === 'M') {
        def = diasManuales[`${asig.workShift}|${fecha}`] || null;
      } else if (turno.type === 'R') {
        rotativosSinAncla.add(code);
        continue;                       // sin ancla de ciclo no es determinable
      } else {
        const semana = turnos.diasSemanales[String(asig.workShift)] || {};
        def = semana[String(indiceDiaSemana(fecha, turnos.diaCero))] || null;
      }

      if (!def || !def.trabaja || def.inicio === null) continue;

      schedules.push({
        date: fecha,
        workshiftCode: String(turno.id),
        workshiftName: turno.name,
        scheduleName: def.nombre || turno.schedule ||
                      `${fechaHora(fecha, def.inicio).slice(11, 16)}–${fechaHora(fecha, def.fin).slice(11, 16)}`,
        start: fechaHora(fecha, def.inicio),
        end:   fechaHora(fecha, def.fin),
        tolerance: turno.tolerance,
        colacionMin: def.colacionMin,
        shiftType: turno.type
      });
    }

    if (!schedules.length) sinHorario.add(code);

    salida.push({
      employee: {
        code: emp.code,
        name: emp.name,
        lastName: emp.lastName,
        secondLastName: emp.secondLastName,
        identification: emp.identification,
        branchOffice: emp.branchOffice,
        branchOfficeName: emp.branchOfficeName,
        department: emp.department,
        departmentName: emp.departmentName
      },
      schedules
    });
  }

  return {
    data: salida,
    sinHorario: [...sinHorario],
    rotativosSinAncla: [...rotativosSinAncla]
  };
}

/** Asignaciones con el formato que el reporte espera en /workshift/assign. */
function formatearAsignaciones({ empleados, asignaciones, turnos, desde, hasta }) {
  const porPersona = new Map();
  for (const e of empleados) porPersona.set(String(e.code), e);

  return asignaciones
    .filter(a => (!a.fromDate || a.fromDate <= hasta) && (!a.toDate || a.toDate >= desde))
    .map(a => {
      const emp = porPersona.get(String(a.person));
      const turno = turnos.catalogo[String(a.workShift)];
      if (!emp || !turno) return null;
      return {
        id: a.id,
        employee: {
          code: emp.code, name: emp.name, lastName: emp.lastName,
          identification: emp.identification,
          branchOfficeName: emp.branchOfficeName
        },
        workshiftCode: String(turno.id),
        workshiftName: turno.name,
        shiftType: turno.type,
        period: `${a.fromDate || '—'} → ${a.toDate || 'indefinido'}`,
        start: a.fromDate,
        end: a.toDate
      };
    })
    .filter(Boolean);
}

module.exports = {
  traerSucursales, traerCentrosCosto, traerEmpleados, traerTurnos,
  traerAsignaciones, traerDiasManuales, traerMarcasDia, traerAusencias,
  construirHorarios, formatearAsignaciones,
  rangoDias, sumarDias, isoDia, indiceDiaSemana, aMinutos, fechaHora,
  detectarDiaCero,
  // Exportados para poder probar el mapeo sin salir a la red:
  mapearMarca, mapearAusencia, normalizarDia, turnoInferido, aHoraLocal,
  normalizarAusenciaServida, categoriaAusencia,
  FUENTES_AUSENCIA, DIA_CERO
};
