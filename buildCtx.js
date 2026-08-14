// ============================================================================
//  REDTEC OS · buildCtx()
//  Arma el `system` del asistente leyendo el read model (snapshot curado).
//  Camino A del híbrido: inyecta un resumen compacto de toda la operación.
//  El snapshot lo genera la Function de ingesta (timer trigger) y lo sirve
//  el proxy liviano api/os-snapshot-proxy (que lee el blob de Azure).
// ============================================================================

// En Azure SWA cada carpeta /api/<nombre> es una Function.
const SNAPSHOT_URL = '/api/os-snapshot-proxy';

// Cache corto: no re-pedir el snapshot en cada mensaje de una misma sesión.
let _snap = null, _snapAt = 0;
const SNAP_TTL_MS = 60 * 1000;

async function loadSnapshot() {
  if (_snap && Date.now() - _snapAt < SNAP_TTL_MS) return _snap;
  const r = await fetch(SNAPSHOT_URL, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('snapshot HTTP ' + r.status);
  _snap = await r.json();
  _snapAt = Date.now();
  return _snap;
}

// Formato chileno de miles.
const _nf = new Intl.NumberFormat('es-CL');
const n = v => (v === null || v === undefined) ? '—' : _nf.format(v);

// ── CONOCIMIENTO BASE ───────────────────────────────────────────────────────
// Hechos DURABLES y VERIFICADOS de la operación. Viajan en cada sesión, así el
// asistente no hay que re-enseñarlos. Agrega aquí solo lo confirmado — nunca lo
// que el chat "supuso" en una conversación, o repetirá errores con seguridad.
const CONOCIMIENTO = [
  // — Negocio —
  'REDTEC tiene dos líneas: (1) Arriendo de Pallets ROJOS, la línea principal — contratos con clientes, facturación semanal a 30 días, pool propio, absorbe los costos fijos; (2) Comercialización de Pallets BLANCOS/VERDES, marginal — venta spot sin contrato, solo costos directos, con una sub-línea de reparación de blancos de muy bajo movimiento.',
  // — Ciclo del pallet rojo —
  'Ciclo del pallet rojo: Redtec EMITE al cliente → el cliente TRANSFIERE al retailer → Redtec RETIRA desde el retailer de vuelta. En paralelo, el cliente puede DEVOLVER directo a Redtec.',
  'Movimientos: EMISIONES (Redtec→cliente), TRANSFERENCIAS (cliente→retailer), RETIROS (retailer→Redtec, es recuperación), DEVOLUCIONES (cliente→Redtec), RECOGIDA. Facturables: emisión, transferencia y devolución. El retiro NO se factura (es recuperación).',
  'REPARACIÓN es una operación aparte (Retiro - Reparación), de la línea de blancos, NO del pool rojo: no se cuenta como retiro operacional. Se reporta como su propio concepto "reparacion".',
  'Regla de equilibrio de volúmenes: en el largo plazo las transferencias deben ser mayores o iguales a los retiros (no se puede retirar del retailer más de lo transferido). Si en un periodo los retiros superan a las transferencias, es stock de periodos anteriores que se está recuperando.',
  // — Transferencias: estados —
  'Las transferencias se registran en REDLINK (portal de clientes) y siguen estados: REGISTRADA → CONFIRMADA (el cliente confirma recepción del retailer; número definitivo, generará un retiro futuro) o REVERSADA/ANULADA (el pallet queda en el cliente; NO se contabiliza).',
  'Se cuentan por fecha requerida y cantidad confirmada. Un periodo reciente puede tener transferencias sin confirmar aún, así que su número puede VARIAR (subir por confirmaciones o bajar por reversas) hasta ~40 días. Con transferencias_provisional=true es provisorio; con false es definitivo.',
  // — Plantas y cobertura —
  'Plantas de operación actuales: Santiago, Talca y Coquimbo. Temuco fue una cuarta planta solo durante 2024: aparece en datos de ese año, pero ya no opera.',
  'Cobertura de datos: hay registros desde el 20-03-2023. Antes de esa fecha no hay datos; dilo con franqueza si preguntan por periodos anteriores.',
  // El equipo agrega aquí hechos nuevos ya confirmados (durables y verificados).
  //POOL / STOCK DE ROJOS
  'El "stock" del pool es saldoFinal: existencias de pallets rojos en poder de  clientes o de retail al cierre de un día. Es un NIVEL, no un flujo: no se suma  entre días. Para el stock actual se usa el último día cerrado (ayer). Dos universos: CLIENTES (rojos que Redtec despachó y aún están en clientes) y  RETAIL (rojos que pasaron de clientes a retailers, pendientes de retiro).',
  'Cuadre: saldoFinal = saldoInicial + entradas − salidas.  Clientes: entradas = emisión, entrada reversa; salidas = devolución,  transferencias, salida reconfirmar.  Retail: entradas = transferencias, salida reconfirmar, otras entradas;  salidas = entrada reversa, retiros, otras salidas, reubicación sistema.- Los saldos de cualquier día pasado son definitivos (cierre 23:59 del día previo).'
];

// Convierte el snapshot en un bloque de texto compacto y legible por el modelo.
function resumen(s) {
  const g = s.galaxias;
  const p = g.pallet, pool = g.pool, rep = g.reparacion,
        cli = g.cliente, tra = g.transporte, col = g.colaborador;
  const per = s.meta.periodo_semana;
  const L = [];

  L.push(`SEMANA ${per.numero} (${per.desde} a ${per.hasta})`);

  L.push(`\n[PALLET · Operaciones · ${p.fuente.join(', ')}]`);
  L.push(`Emisiones ${n(p.semana.emisiones.total)} (Santiago ${n(p.semana.emisiones.santiago)}, Talca ${n(p.semana.emisiones.talca)})`);
  L.push(`Retiros ${n(p.semana.retiros.total)} (Santiago ${n(p.semana.retiros.santiago)}, Talca ${n(p.semana.retiros.talca)})`);
  L.push(`Recogida ${n(p.semana.recogida)} · Devoluciones ${n(p.semana.devoluciones)} · Transferencias ${n(p.semana.transferencias)}`);
  L.push(`Acumulado 2026: emisiones ${n(p.acumulado_2026.emisiones)}, recogidas ${n(p.acumulado_2026.recogidas)}, reparaciones ${n(p.acumulado_2026.reparaciones)}`);

  L.push(`\n[POOL · Operaciones · foto ${pool.foto}]`);
  L.push(`Total ${n(pool.total)} · Disponibles ${n(pool.disponibles)} · Por pintar ${n(pool.por_pintar)} · Por reparar ${n(pool.por_reparar)} · Por inspeccionar ${n(pool.por_inspeccionar)}`);
  L.push(`Ubicación: Redtec ${n(pool.en_redtec)}, Clientes ${n(pool.en_clientes)}, Retail ${n(pool.en_retail)}`);

  L.push(`\n[REPARACIÓN · Log. Inversa]`);
  L.push(`Disponibilizados ${n(rep.semana.disponibilizados)} · Reparados ${n(rep.semana.reparados.total)} (Stgo ${n(rep.semana.reparados.santiago)}, Talca ${n(rep.semana.reparados.talca)})`);
  L.push(`Calidad: índice cambio comp. ${rep.calidad.indice_cambio_componentes} · rep/retiros ${rep.calidad.reparaciones_sobre_retiros} · daño promedio ${rep.dano.promedio}`);

  L.push(`\n[CLIENTE · Comercial]${cli.estado === 'demo' ? ' (datos de ejemplo)' : ''}`);
  L.push(`Mayor crecimiento del mes: ` + cli.crecimiento_mes.map(c => `${c.nombre} ${c.var_pct > 0 ? '+' : ''}${c.var_pct}%`).join(', '));

  L.push(`\n[TRANSPORTE · GPS Condor]${tra.estado === 'demo' ? ' (datos de ejemplo)' : ''}`);
  const sinGps = tra.flota.sin_gps || [];
  L.push(`Flota ${tra.flota.total}: ${tra.flota.en_ruta} en ruta, ${tra.flota.en_planta} en planta, ${sinGps.length} sin GPS` +
         (sinGps.length ? ` (${sinGps.map(c => c.patente).join(', ')})` : ''));

  L.push(`\n[COLABORADOR · RRHH · Workera]`);
  L.push(`Dotación ${col.dotacion.total} (empleados ${col.dotacion.empleados}, honorarios ${col.dotacion.honorarios})`);
  const at = col.asistencia_hoy;
  L.push(`Asistencia hoy: ${n(at.a_tiempo)} a tiempo, ${at.atrasos.cantidad} atrasos (${at.atrasos.planta}), ${at.licencias} licencia(s)`);

  if (s.pulso && s.pulso.length) {
    L.push(`\n[PULSO / ALERTAS]`);
    s.pulso.forEach(a => L.push(`• [${a.galaxia}] ${a.texto}`));
  }
  return L.join('\n');
}

// Devuelve el string `system` listo para el request al endpoint LLM.
// Distingue CUÁNDO se escribió el snapshot de A QUÉ PERIODO corresponde el dato.
// Mientras los refrescadores sean stubs ambas fechas difieren, y el asistente
// no debe presentar datos de hace semanas como si fueran de hoy.
function vigencia(s) {
  const per = s.meta.periodo_semana || {};
  const escrito = new Date(s.meta.generado);
  const cierre  = per.hasta ? new Date(per.hasta + 'T23:59:59Z') : null;
  const diasAtras = cierre ? Math.floor((escrito - cierre) / 86400000) : null;
  return {
    escrito: s.meta.generado,
    periodo: per.desde && per.hasta ? `semana ${per.numero} (${per.desde} a ${per.hasta})` : 'sin periodo declarado',
    desfasado: diasAtras !== null && diasAtras > 8,
    diasAtras
  };
}

async function buildCtx() {
  let datos, v;
  try {
    const s = await loadSnapshot();
    datos = resumen(s);
    v = vigencia(s);
  } catch (e) {
    // Falla suave: el asistente lo admite, no inventa.
    return 'Eres el asistente de REDTEC OS. En este momento no puedo leer los ' +
           'datos de la operación (snapshot no disponible). Indícaselo al usuario ' +
           'con claridad y no entregues cifras.';
  }

  // Fecha REAL (reloj del navegador, hora de Chile). El asistente resuelve
  // "hoy/ayer/esta semana" con ESTO, no con la fecha en que se escribió el snapshot.
  const hoyCL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const _ay = new Date(hoyCL + 'T12:00:00Z'); _ay.setUTCDate(_ay.getUTCDate() - 1);
  const ayerCL = _ay.toISOString().slice(0, 10);

  return `Eres el asistente de REDTEC OS, el sistema de información de REDTEC (logística de pallets, Chile).

REGLAS
- FECHA ACTUAL: hoy es ${hoyCL} (hora de Chile); "ayer" = ${ayerCL}. Interpreta "hoy", "ayer", "esta semana", "este mes" y "este año" SIEMPRE respecto de ESTA fecha real, NO de cuándo se escribió el snapshot. El último día con datos operacionales cerrados es ayer (${ayerCL}); no existe dato del día en curso en tiempo real.
- Responde con los datos entregados abajo. Para PERIODOS HISTÓRICOS que no estén aquí (un día puntual, una semana pasada, un mes, un año — hay datos desde 2023-03-20), usa la herramienta consultar_operacion con el rango en fechas YYYY-MM-DD. Nunca inventes cifras: si ni el contexto ni la herramienta lo cubren, dilo con franqueza.
- Si el resultado de la herramienta trae transferencias_provisional en true, advierte que las transferencias de ese rango están sujetas a confirmación y aún pueden variar (subir por confirmaciones o bajar por reversas).
- OJO CON LAS FECHAS: el snapshot se escribió el ${v.escrito}, pero las cifras operacionales corresponden a la ${v.periodo}. NO son datos de hoy.${v.desfasado ? ` El dato tiene ${v.diasAtras} días de antigüedad: adviértelo cuando entregues cifras.` : ''}
- Si preguntan por "hoy", "ahora" o "esta semana", responde con lo que tienes pero aclara explícitamente a qué periodo corresponde. Nunca presentes una cifra de un periodo pasado como si fuera actual.
- Números en formato chileno (miles con punto). Sé conciso; no vuelques toda la información salvo que la pidan.
- Cierra SIEMPRE tu respuesta con una última línea con este formato exacto, indicando qué galaxias usaste:
  [FUENTES: pallet, pool]
  Claves válidas: pallet, pool, reparacion, cliente, transporte, colaborador. Usa solo las que realmente consultaste. La interfaz convierte esa línea en chips de trazabilidad, así que no la omitas ni cambies su formato.

CONOCIMIENTO BASE
${CONOCIMIENTO.map(x => '- ' + x).join('\n')}

DATOS DE LA OPERACIÓN
${datos}`;
}

// Uso en tu fetch actual (ahora buildCtx es async):
//
//   const system = await buildCtx();
//   fetch('https://redtecagente-....azurewebsites.net/api/chat', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       model: 'claude-sonnet-4-6',
//       max_tokens: 800,
//       system,          // <-- resumen curado de toda la operación
//       messages: hist
//     })
//   });

// Exportar si se usa como módulo.
if (typeof module !== 'undefined') module.exports = { buildCtx, loadSnapshot };