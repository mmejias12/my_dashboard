// ============================================================================
//  api/talana-asistencia  ·  Lo que consume el reporte (trigger HTTP, GET)
//
//  Sustituye a /api/workera-proxy manteniendo SU MISMO contrato, para que el
//  HTML del reporte no tenga que reescribirse:
//
//    GET /api/talana-asistencia?endpoint=/branchOffice
//    GET /api/talana-asistencia?endpoint=/department
//    GET /api/talana-asistencia?endpoint=/employee
//    GET /api/talana-asistencia?endpoint=/workshift/assign&start=&end=
//    GET /api/talana-asistencia?endpoint=/workshift/schedules&start=&end=
//    GET /api/talana-asistencia?endpoint=/attendanceData&start=&end=
//    GET /api/talana-asistencia?endpoint=/permission&start=&end=
//    GET /api/talana-asistencia?endpoint=/todo&start=&end=      ← todo en una
//    GET /api/talana-asistencia?endpoint=/_estado
//    GET /api/talana-asistencia?endpoint=/_diagnostico          ← toca Talana
//
//  Todo sale del snapshot en Blob que deja api/talana-sync: esta Function NO
//  llama a Talana (salvo /_diagnostico), así que el reporte carga al instante y
//  no puede gatillar el bloqueo por exceso de peticiones.
// ============================================================================

const cliente = require('../shared/talana-client.js');
const mapa    = require('../shared/talana-asistencia.js');
const store   = require('../shared/talana-store.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const JSONH = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  const endpoint = (req.query.endpoint || '').trim();
  if (!endpoint) {
    context.res = {
      status: 400, headers: JSONH,
      body: JSON.stringify({
        error: 'Parámetro "endpoint" requerido',
        endpoints: ['/branchOffice', '/department', '/employee', '/workshift/assign',
                    '/workshift/schedules', '/attendanceData', '/permission',
                    '/todo', '/_estado', '/_diagnostico']
      })
    };
    return;
  }

  const hoy   = store.hoyIso();
  const hasta = normalizarFecha(req.query.end)   || hoy;
  const desde = normalizarFecha(req.query.start) || hasta.slice(0, 7) + '-01';

  try {
    if (endpoint === '/_diagnostico') {
      context.res = {
        status: 200, headers: JSONH,
        body: JSON.stringify(await diagnostico(req.query.recursos))
      };
      return;
    }

    const container = store.getContainer();

    if (endpoint === '/_estado') {
      const [estado, maestros] = await Promise.all([
        store.leerEstado(container), store.leerMaestros(container)
      ]);
      context.res = {
        status: 200, headers: JSONH,
        body: JSON.stringify({
          estado,
          maestros_guardados: maestros ? maestros._guardado : null,
          maestros_vencidos: store.maestrosVencidos(maestros),
          empleados: maestros ? maestros.empleados.length : 0,
          contenedor: store.CONTAINER,
          ventana_gracia_dias: store.VENTANA_GRACIA_DIAS,
          dia_cero: maestros && maestros.turnos ? {
            usado: maestros.turnos.diaCero,
            detectado_del_dato: Boolean(maestros.turnos.diaCeroDetectado),
            votos: maestros.turnos.diaCeroVotos
          } : { usado: mapa.DIA_CERO, detectado_del_dato: false },
          catalogo_turnos_degradado: maestros && maestros.turnos ? maestros.turnos.catalogoDegradado : null,
          degradaciones: (maestros && maestros.degradaciones) || [],
          turnos: maestros && maestros.turnos ? Object.keys(maestros.turnos.catalogo).length : 0,
          asignaciones: maestros ? (maestros.asignaciones || []).length : 0,
          // Sin asignaciones no hay turno para nadie: el reporte sólo puede
          // mostrar marcas, no puntualidad ni ausencias.
          sin_horario_teorico: Boolean(maestros && !(maestros.asignaciones || []).length),
          hoy
        })
      };
      return;
    }

    const maestros = await store.leerMaestros(container);
    if (!maestros) {
      context.res = {
        status: 503, headers: JSONH,
        body: JSON.stringify({
          error: 'Snapshot de Talana todavía no generado',
          detalle: 'Nadie ha ejecutado el sincronizador, así que el contenedor del snapshot está vacío o no existe. ' +
                   'Lanza POST /api/talana-sync con el header X-Ingesta-Key, o el workflow "Asistencia Talana".',
          contenedor: store.CONTAINER
        })
      };
      return;
    }

    let carga;
    switch (endpoint) {
      case '/branchOffice':
        carga = sobre(maestros.sucursales, maestros._guardado);
        break;

      case '/department':
        carga = sobre(maestros.departamentos, maestros._guardado);
        break;

      case '/employee':
        carga = sobre(maestros.empleados, maestros._guardado);
        break;

      case '/workshift/assign':
        carga = sobre(mapa.formatearAsignaciones({
          empleados: maestros.empleados,
          asignaciones: maestros.asignaciones,
          turnos: maestros.turnos,
          desde, hasta
        }), maestros._guardado);
        break;

      case '/workshift/schedules': {
        const h = horarios(maestros, desde, hasta);
        carga = sobre(h.data, maestros._guardado, {
          sin_horario: h.sinHorario.length,
          rotativos_sin_ancla: h.rotativosSinAncla,
          sin_horario_teorico: !(maestros.asignaciones || []).length,
          degradaciones: maestros.degradaciones || []
        });
        break;
      }

      case '/attendanceData': {
        const m = await marcas(container, desde, hasta);
        carga = sobre(m.data, maestros._guardado, { dias_faltantes: m.faltantes });
        break;
      }

      case '/permission': {
        const a = await ausencias(container, desde, hasta);
        carga = sobre(a.data, maestros._guardado, { meses_sin_snapshot: a.mesesFaltantes });
        break;
      }

      case '/todo': {
        const [m, a] = await Promise.all([
          marcas(container, desde, hasta),
          ausencias(container, desde, hasta)
        ]);
        const h = horarios(maestros, desde, hasta);
        carga = {
          rango: { desde, hasta },
          generado: maestros._guardado,
          sucursales: maestros.sucursales,
          departamentos: maestros.departamentos,
          empleados: maestros.empleados,
          asignaciones: mapa.formatearAsignaciones({
            empleados: maestros.empleados, asignaciones: maestros.asignaciones,
            turnos: maestros.turnos, desde, hasta
          }),
          horarios: h.data,
          marcas: m.data,
          permisos: a.data,
          avisos: {
            dias_sin_snapshot: m.faltantes,
            meses_sin_snapshot: a.mesesFaltantes,
            empleados_sin_horario: h.sinHorario.length,
            rotativos_sin_ancla: h.rotativosSinAncla.length
          }
        };
        break;
      }

      default:
        context.res = {
          status: 404, headers: JSONH,
          body: JSON.stringify({ error: `endpoint desconocido: ${endpoint}` })
        };
        return;
    }

    context.res = {
      status: 200,
      headers: { ...JSONH, 'Cache-Control': 'private, max-age=60', 'X-Talana-Snapshot': maestros._guardado || '' },
      body: JSON.stringify(carga)
    };

  } catch (err) {
    context.log.error('talana-asistencia:', err.message);
    context.res = {
      status: 502, headers: JSONH,
      body: JSON.stringify({ error: 'Error sirviendo asistencia', detalle: err.message })
    };
  }
};

// ── armado de respuestas ────────────────────────────────────────────────────

// El reporte espera el sobre de Workera: { data, totalPages, totalResult }.
function sobre(data, generado, extra) {
  return { data, totalPages: 1, totalResult: data.length, _generado: generado || null, ...(extra || {}) };
}

function horarios(maestros, desde, hasta) {
  return mapa.construirHorarios({
    desde, hasta,
    empleados: maestros.empleados,
    asignaciones: maestros.asignaciones,
    turnos: maestros.turnos,
    diasManuales: maestros.diasManuales || {}
  });
}

async function marcas(container, desde, hasta) {
  const fechas = mapa.rangoDias(desde, hasta);
  const { marcas: data, faltantes } = await store.leerMarcasRango(container, fechas);
  data.sort((a, b) => String(a.attendanceDate).localeCompare(String(b.attendanceDate)));
  return { data, faltantes };
}

async function ausencias(container, desde, hasta) {
  const meses = store.mesesDelRango(desde, hasta);
  const bloques = await Promise.all(meses.map(m =>
    store.leerAusenciasMes(container, m).then(b => ({ m, b })).catch(() => ({ m, b: null }))
  ));

  const todas = [];
  const mesesFaltantes = [];
  for (const { m, b } of bloques) {
    if (b && Array.isArray(b.ausencias)) todas.push(...b.ausencias);
    else mesesFaltantes.push(m);   // un mes sin sincronizar no puede pasar callado
  }

  // Un permiso de varios meses aparece en más de un bloque: deduplicar.
  const vistos = new Set();
  const data = todas.filter(p => {
    const k = `${p.employeeCode}|${p.start}|${p.end}|${p.permissionTypeName}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return p.start <= hasta && p.end >= desde;
  });
  return { data, mesesFaltantes };
}

// ── diagnóstico: única ruta que toca Talana en vivo ─────────────────────────
// Trae una muestra pequeña de cada recurso para verificar credenciales, forma
// de los datos y, sobre todo, la convención de numberWorkingDay de los turnos
// semanales (que la documentación no especifica).
// Cada llamada gasta ~3,3 s de espaciado, así que en una invocación no caben
// los once recursos. Van ordenados por criticidad y se puede acotar con
// ?recursos=mark,workShiftPersonRange para probar sólo lo que falta.
const PRUEBAS = [
  ['mark',                         '/mark/',                          () => ({ desde: store.hoyIso(), hasta: store.hoyIso() })],
  ['workShiftPersonRange',         '/workShiftPersonRange/',          () => ({})],
  ['rotativeDay',                  '/rotativeDay/',                   () => ({})],
  ['contracts-resumed-paginated',  '/contracts-resumed-paginated/',   () => ({ 'solo-activos': 'true' })],
  ['absentism-resumed',            '/absentism-resumed/',             () => ({})],
  ['vacations-resumed',            '/vacations-resumed/',             () => ({})],
  ['administrative-leaves-resumed','/administrative-leaves-resumed/', () => ({})],
  ['workShift',                    '/workShift/',                     () => ({})],
  ['specialRotativeDay',           '/specialRotativeDay/',            () => ({})],
  ['sucursal',                     '/sucursal/',                      () => ({})],
  ['centroCosto',                  '/centroCosto/',                   () => ({})]
];

async function diagnostico(filtro) {
  if (!cliente.tieneToken()) {
    return { ok: false, error: 'TALANA_TOKEN no configurado' };
  }
  const pedidos = (filtro || '').split(',').map(s => s.trim()).filter(Boolean);
  const pruebas = pedidos.length
    ? PRUEBAS.filter(([n]) => pedidos.includes(n))
    : PRUEBAS;

  const presupuesto = cliente.crearPresupuesto(38000);
  const salida = {
    ok: true,
    host: cliente.HOST, base: cliente.BASE, rpm: cliente.RPM,
    dia_cero_configurado: mapa.DIA_CERO,
    probados: pruebas.map(([n]) => n),
    recursos: {}
  };

  for (const [nombre, recurso, params] of pruebas) {
    if (presupuesto.agotado(4500)) {
      salida.recursos[nombre] = { estado: 'omitido (presupuesto) — repite con ?recursos=' + nombre };
      continue;
    }
    try {
      const r = await cliente.get(recurso, { ...params(), page_size: 3 }, { presupuesto });
      const items = cliente.extraerItems(r.json);
      salida.recursos[nombre] = {
        http: r.status,
        total: (r.json && !Array.isArray(r.json) && r.json.count) || items.length,
        muestra: items.slice(0, 2),
        error: r.status === 200 ? undefined : String(r.cuerpo).slice(0, 200)
      };
      // El propio dato dice qué día es numberWorkingDay = 0.
      if (nombre === 'rotativeDay' && items.length) {
        salida.dia_cero_detectado = mapa.detectarDiaCero(items);
      }
    } catch (e) {
      salida.recursos[nombre] = { estado: 'error', error: e.message.slice(0, 240) };
    }
  }

  salida.nota = 'Los que dicen "omitido (presupuesto)" no fallaron: no alcanzó el tiempo. ' +
                'Vuelve a llamar con ?endpoint=/_diagnostico&recursos=<nombre> para probarlos.';
  return salida;
}

function normalizarFecha(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
