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

// Índice de día de semana según la convención configurada.
// JS getDay(): 0=domingo … 6=sábado.
function indiceDiaSemana(fecha) {
  const js = new Date(fecha + 'T00:00:00').getDay();
  return DIA_CERO === 'domingo' ? js : (js + 6) % 7;   // lunes = 0
}

const soloFecha = s => (s ? String(s).slice(0, 10) : '');

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
      lastName:          [p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' '),
      identification:    c.persona_rut || p.rut || '',
      email:             p.email || null,
      branchOffice:      suc.id ? String(suc.id) : '',
      branchOfficeName:  suc.nombre || '',
      department:        cc.codigo || (cc.id ? String(cc.id) : ''),
      departmentName:    cc.nombre || uo.nombre || '',
      gerencia:          uo.nombre || '',
      position:          c.cargo || '',
      jornada:           (c.jornada && c.jornada.nombre) || '',
      horasJornada:      c.horasDeLaJornada || null,
      tipoContrato:      (c.tipoContrato && c.tipoContrato.nombre) || '',
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
  const turnos = await talana.listar('/workShift/', {}, opts);
  const semanales = await talana.listar('/rotativeDay/', {}, opts);
  const rotativos = await talana.listar('/specialRotativeDay/', {}, opts);

  const catalogo = {};
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

  return {
    catalogo, diasSemanales, diasRotativos,
    completo: turnos.completo && semanales.completo && rotativos.completo
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

/** Asignaciones persona ↔ turno ↔ rango de fechas. */
async function traerAsignaciones(opts) {
  const { items, completo } = await talana.listar('/workShiftPersonRange/', {}, opts);
  const data = items.map(a => ({
    id: a.id,
    person: a.person,
    workShift: a.workShift,
    fromDate: soloFecha(a.fromDate),
    toDate: soloFecha(a.toDate)
  }));
  return { data, completo };
}

/** Días de turnos manuales dentro de un rango. */
async function traerDiasManuales(desde, hasta, opts) {
  const { items, completo } = await talana.listar(
    '/specificDay-paginado/', { min_date: desde, max_date: hasta }, opts
  );
  const porTurnoFecha = {};   // "workShiftId|fecha" → definicion
  for (const d of items) {
    porTurnoFecha[`${d.workShift}|${soloFecha(d.date)}`] = normalizarDia(d);
  }
  return { data: porTurnoFecha, completo };
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
  // TS puede venir como "2026-08-31T07:58:12" o "2026-08-31 07:58:12".
  const ts = String(m.TS || m.ts || '').replace(' ', 'T');
  return {
    id: m.id,
    attendanceDate: ts,                      // el reporte lee este campo
    employee: {
      code: String(p.id || ''),
      personaId: p.id || null,
      name: p.nombre || '',
      lastName: [p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' '),
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

async function traerAusencias(desde, hasta, opts = {}) {
  const fuentes = [
    { recurso: '/absentism-resumed/',            etiqueta: 'Licencia/Permiso' },
    { recurso: '/vacations-resumed/',            etiqueta: 'Vacaciones' },
    { recurso: '/administrative-leaves-resumed/', etiqueta: 'Día administrativo' }
  ];

  const data = [];
  const fallos = [];
  let completo = true;

  for (const f of fuentes) {
    try {
      const r = await talana.listar(f.recurso, { desde, hasta, since: desde, to: hasta }, opts);
      if (!r.completo) completo = false;
      for (const a of r.items) data.push(mapearAusencia(a, f.etiqueta));
    } catch (e) {
      // Un token sin permiso sobre un módulo no debe tumbar el resto.
      fallos.push(`${f.recurso}: ${e.message.slice(0, 160)}`);
    }
  }

  // Recortar al rango pedido.
  const dentro = data.filter(p => p.start && p.end && p.start <= hasta && p.end >= desde);
  dentro.sort((a, b) => a.start.localeCompare(b.start));
  return { data: dentro, completo, fallos };
}

function mapearAusencia(a, etiquetaPorDefecto) {
  // Los recursos "resumed" no comparten nombres de campo al 100 %; se aceptan
  // las variantes conocidas y se cae con elegancia si aparece una nueva.
  const persona = a.persona || a.employee || a.empleado || a.detallesTrabajador || {};
  const personaId = a.persona_id || a.personaId || a.empleado ||
                    (typeof persona === 'object' ? persona.id : persona) || null;
  const tipo = a.tipo || a.type || a.tipoAusencia ||
               (a.absenceType && (a.absenceType.nombre || a.absenceType.name)) ||
               etiquetaPorDefecto;

  return {
    employeeCode: personaId !== null ? String(personaId) : '',
    employeeName: typeof persona === 'object'
      ? [persona.nombre, persona.apellidoPaterno, persona.apellidoMaterno].filter(Boolean).join(' ')
      : '',
    identification: (typeof persona === 'object' && (persona.rut || '')) || a.rut || '',
    start: soloFecha(a.fechaDesde || a.desde || a.start || a.startDate || a.fecha_desde),
    end:   soloFecha(a.fechaHasta || a.hasta || a.end   || a.endDate   || a.fecha_hasta),
    permissionTypeName: String(tipo),
    dias: a.numeroDias || a.dias || null,
    medioDia: Boolean(a.mediosDias || a.medioDia),
    jornada: a.jornada || null
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
        def = semana[String(indiceDiaSemana(fecha))] || null;
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
  // Exportados para poder probar el mapeo sin salir a la red:
  mapearMarca, mapearAusencia, normalizarDia,
  DIA_CERO
};
