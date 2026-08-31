// ============================================================================
//  api/talana-sync  ·  Sincronización Talana → Blob  (trigger HTTP)
//
//  Static Web Apps sólo admite triggers HTTP en sus Functions gestionadas, así
//  que el agendamiento vive en GitHub Actions (.github/workflows/
//  talana-asistencia.yml), igual que datos-diarios-redtecos.
//
//      POST /api/talana-sync
//      Header:  X-Ingesta-Key: <OS_INGESTA_KEY>
//      Body opcional: { "desde":"2026-08-01", "hasta":"2026-08-31",
//                       "maestros": true, "presupuestoMs": 30000 }
//
//  El trabajo es INCREMENTAL y con presupuesto de tiempo: cada llamada avanza
//  lo que alcanza dentro del límite de ejecución y devuelve cuántos días quedan
//  pendientes. El workflow vuelve a llamar hasta que `pendientes` llega a 0.
//  Así un backfill largo se completa en varias pasadas sin gatillar el bloqueo
//  de 10 minutos que Talana aplica sobre las 50 req/min.
// ============================================================================

const cliente = require('../shared/talana-client.js');
const mapa    = require('../shared/talana-asistencia.js');
const store   = require('../shared/talana-store.js');

const KEY = process.env.OS_INGESTA_KEY;

// Margen bajo el corte de la plataforma para alcanzar a escribir la respuesta.
const PRESUPUESTO_POR_DEFECTO = Number(process.env.TALANA_PRESUPUESTO_MS || 32000);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingesta-Key'
};
const JSONH = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS }; return; }

  if (!KEY) {
    context.res = { status: 500, headers: JSONH, body: JSON.stringify({ error: 'OS_INGESTA_KEY no configurada' }) };
    return;
  }
  if ((req.headers['x-ingesta-key'] || '') !== KEY) {
    context.res = { status: 401, headers: JSONH, body: JSON.stringify({ error: 'no autorizado' }) };
    return;
  }
  if (!cliente.tieneToken()) {
    context.res = {
      status: 500, headers: JSONH,
      body: JSON.stringify({
        error: 'TALANA_TOKEN no configurado',
        detalle: 'Configúralo en Azure → Static Web App → Configuración → Variables de aplicación'
      })
    };
    return;
  }

  const cuerpo = leerCuerpo(req);
  const hoy    = store.hoyIso();
  const hasta  = cuerpo.hasta || hoy;
  const desde  = cuerpo.desde || primerDiaDelMes(hasta);
  const presupuesto = cliente.crearPresupuesto(Number(cuerpo.presupuestoMs) || PRESUPUESTO_POR_DEFECTO);

  const t0 = Date.now();
  const informe = {
    ok: true, desde, hasta,
    maestros: 'omitidos', dias_sincronizados: [], dias_pendientes: [],
    ausencias: [], avisos: []
  };

  try {
    const container = store.getContainer();
    const fallaContenedor = await store.asegurarContenedor(container);
    if (fallaContenedor) {
      context.res = {
        status: 502, headers: JSONH,
        body: JSON.stringify({
          ok: false, error: fallaContenedor,
          detalle: 'Revisa que OS_STORAGE_CONN tenga permiso para crear contenedores, o crea el contenedor a mano en el storage.'
        })
      };
      return;
    }

    // ── 1) Maestros ─────────────────────────────────────────────────────────
    let maestros = await store.leerMaestros(container);
    const hayQueRefrescar = cuerpo.maestros === true || store.maestrosVencidos(maestros);

    if (hayQueRefrescar && !presupuesto.agotado(12000)) {
      const nuevos = await sincronizarMaestros(desde, hasta, presupuesto, informe);
      if (nuevos) {
        maestros = await store.guardarMaestros(container, nuevos);
        informe.maestros = nuevos._completo ? 'actualizados' : 'actualizados (parcial)';
      }
    } else if (maestros) {
      informe.maestros = 'vigentes';
    }

    if (!maestros) {
      informe.ok = false;
      informe.avisos.push('No hay maestros en caché y no alcanzó el presupuesto para traerlos. Vuelve a llamar.');
      context.res = { status: 200, headers: JSONH, body: JSON.stringify({ ...informe, ms: Date.now() - t0, pendientes: 1 }) };
      return;
    }

    // ── 2) Marcas, día por día ──────────────────────────────────────────────
    const fechas = mapa.rangoDias(desde, hasta);
    const pendientes = await store.diasPendientes(container, fechas);
    // Del día más reciente hacia atrás: si el presupuesto se corta, lo primero
    // que queda al día es lo que la gente está mirando ahora.
    pendientes.sort((a, b) => b.localeCompare(a));

    for (const fecha of pendientes) {
      if (presupuesto.agotado(6000)) { informe.dias_pendientes.push(fecha); continue; }
      try {
        const r = await mapa.traerMarcasDia(fecha, { presupuesto });
        if (!r.completo) { informe.dias_pendientes.push(fecha); continue; }
        await store.guardarMarcasDia(container, fecha, r.data, { _crudas: r.crudas });
        informe.dias_sincronizados.push(fecha);
      } catch (e) {
        informe.avisos.push(`marcas ${fecha}: ${e.message.slice(0, 200)}`);
        informe.dias_pendientes.push(fecha);
        if (e.status === 429) break;   // no insistir: hay bloqueo activo
      }
    }

    // ── 3) Ausencias ────────────────────────────────────────────────────────
    // Los endpoints "resumed" ignoran los filtros de fecha y devuelven el
    // histórico completo, así que pedirlos mes a mes traería lo mismo cada vez.
    // Se traen UNA vez y se reparten por mes.
    await sincronizarAusencias(container, desde, hasta, presupuesto, informe);

    await store.guardarEstado(container, {
      ultima_sync: new Date().toISOString(),
      desde, hasta,
      dias_sincronizados: informe.dias_sincronizados.length,
      dias_pendientes: informe.dias_pendientes.length
    });

    context.res = {
      status: 200, headers: JSONH,
      body: JSON.stringify({
        ...informe,
        pendientes: informe.dias_pendientes.length,
        ms: Date.now() - t0
      })
    };

  } catch (err) {
    context.log.error('talana-sync:', err.message);
    context.res = {
      status: 502, headers: JSONH,
      body: JSON.stringify({ ok: false, error: err.message, ms: Date.now() - t0 })
    };
  }
};

// ── maestros: sucursales, centros de costo, personas, turnos, asignaciones ──
async function sincronizarMaestros(desde, hasta, presupuesto, informe) {
  const opts = { presupuesto };
  let completo = true;
  const marca = r => { if (!r.completo) completo = false; return r; };

  const sucursales = marca(await mapa.traerSucursales(opts));
  const centros    = marca(await mapa.traerCentrosCosto(opts));
  const empleados  = marca(await mapa.traerEmpleados(opts));
  const turnos     = await mapa.traerTurnos(opts);
  if (!turnos.completo) completo = false;
  const asignaciones = marca(await mapa.traerAsignaciones(opts));

  // Los días manuales dependen del rango; se traen con holgura de un mes para
  // que un cambio de mes en el reporte no obligue a resincronizar.
  const manuales = marca(await mapa.traerDiasManuales(
    mapa.sumarDias(desde, -31), mapa.sumarDias(hasta, 31), opts
  ));

  if (!completo) informe.avisos.push('Maestros incompletos: se agotó el presupuesto, se completarán en la siguiente pasada.');

  // Recursos del módulo de Turnos que el token puede no cubrir. No detienen la
  // sincronización, pero sí hay que decirlo fuerte: sin ellos no hay horario
  // teórico, y sin horario teórico no hay atrasos ni ausencias, sólo marcas.
  const degradaciones = [turnos.catalogoDegradado, asignaciones.degradado, manuales.degradado].filter(Boolean);
  if (degradaciones.length) informe.avisos.push(...degradaciones);
  if (asignaciones.degradado) {
    informe.avisos.push(
      'SIN HORARIO TEÓRICO: /workShiftPersonRange/ no está disponible, así que ningún ' +
      'trabajador tiene turno asignado. El reporte mostrará marcas reales pero no ' +
      'podrá calcular atrasos ni detectar ausencias. Pide a Talana lectura sobre el módulo de Turnos.'
    );
  }

  return {
    sucursales: sucursales.data,
    departamentos: centros.data,
    empleados: empleados.data,
    turnos,
    asignaciones: asignaciones.data,
    diasManuales: manuales.data,
    rangoDiasManuales: { desde: mapa.sumarDias(desde, -31), hasta: mapa.sumarDias(hasta, 31) },
    degradaciones,
    _completo: completo
  };
}

// ── ausencias: una traída, repartida por mes ────────────────────────────────
async function sincronizarAusencias(container, desde, hasta, presupuesto, informe) {
  const meses = store.mesesDelRango(desde, hasta);

  // ¿Hace falta ir a Talana? Sólo si a algún mes del rango le falta el bloque
  // o ya venció.
  let hayQueTraer = false;
  for (const mes of meses) {
    const previo = await store.leerAusenciasMes(container, mes).catch(() => null);
    if (!previo || store.ausenciasVencidas(previo, mes)) { hayQueTraer = true; break; }
  }
  if (!hayQueTraer) { informe.ausencias.push('vigentes'); return; }

  if (presupuesto.agotado(10000)) {
    informe.ausencias.push('pendientes (sin presupuesto en esta pasada)');
    informe.avisos.push('Ausencias no sincronizadas: vuelve a llamar para completarlas.');
    return;
  }

  let r;
  try {
    r = await mapa.traerAusencias({ presupuesto });
  } catch (e) {
    informe.avisos.push(`ausencias: ${e.message.slice(0, 200)}`);
    return;
  }

  // Escribir bloques a medias sería peor que no escribir: el reporte los vería
  // como completos y mostraría permisos faltantes como ausencias injustificadas.
  if (!r.completo) {
    informe.ausencias.push('incompletas (se completarán en la siguiente pasada)');
    informe.avisos.push('Ausencias incompletas: no se guardaron para no dejar meses a medias.');
    return;
  }

  // Un permiso puede cruzar meses: entra en cada mes que toca. Los meses
  // pedidos se escriben aunque queden vacíos, para que no figuren como
  // "sin snapshot" cuando la verdad es que no hubo ausencias.
  const porMes = new Map(meses.map(m => [m, []]));
  for (const a of r.data) {
    for (const mes of store.mesesDelRango(a.start, a.end)) {
      if (!porMes.has(mes)) porMes.set(mes, []);
      porMes.get(mes).push(a);
    }
  }

  const entradas = [...porMes.entries()];
  const LOTE = 12;
  for (let i = 0; i < entradas.length; i += LOTE) {
    await Promise.all(entradas.slice(i, i + LOTE).map(([mes, lista]) =>
      store.guardarAusenciasMes(container, mes, lista, { _fallos: r.fallos })
    ));
  }

  informe.ausencias.push(`${r.data.length} registros en ${entradas.length} meses`);
  if (r.descartadas) informe.avisos.push(`${r.descartadas} ausencias sin fechas utilizables, descartadas.`);
  if (r.fallos.length) informe.avisos.push(...r.fallos);
}

// ── utilidades ──────────────────────────────────────────────────────────────
function leerCuerpo(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

const primerDiaDelMes = fecha => fecha.slice(0, 7) + '-01';
