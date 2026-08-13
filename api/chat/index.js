// ============================================================================
//  chat/index.js  ·  Asistente REDTEC OS con tool use
//  (va en el Function App redtecagente, reemplaza al relay actual)
//
//  Antes:  front → chat → Anthropic → front           (una pasada)
//  Ahora:  front → chat → Anthropic ⇄ herramienta → front
//
//  La herramienta `consultar_operacion` responde cualquier rango histórico
//  combinando el caché diario (redtec-os-hist) con consultas en vivo a RDTOut.
//  El contrato con el front NO cambia: recibe { model, max_tokens, system,
//  messages } y devuelve la respuesta de Anthropic tal cual (content[]).
//
//  App settings necesarias en ESTE Function App:
//    ANTHROPIC_API_KEY   (la que ya usa el relay actual)
//    OS_STORAGE_CONN     (la misma del storage redtecos)
//    REDTEC_API_KEY      (la de RDTOut; hay default en ops-fetch)
// ============================================================================

const { consultarOperacion } = require('../shared/consulta-historico.js');
const { consultarStock, TOOL_SCHEMA: STOCK_TOOL } = require('../shared/consulta-stock.js');
const { consultarCliente, TOOL_SCHEMA: CLIENTE_TOOL } = require('../shared/consulta-cliente.js');
const finanzas = require('../shared/consulta-finanzas.js');
const resumenOps = require('../shared/resumen-operaciones.js');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_VUELTAS   = 4;     // tope de idas y vueltas de herramienta

// Roles autorizados a ver FINANZAS (configurable con la app setting FINANZAS_ROLES;
// deben coincidir con los roles asignados en Entra/SWA). Sin uno de estos, la
// galaxia Finanzas no existe para ese usuario (ni herramienta ni contexto).
const FIN_ROLES = (process.env.FINANZAS_ROLES || 'Presidencia,Gerencia,Finanzas')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Roles del usuario logueado, desde el header que inyecta Static Web Apps.
function rolesDe(req) {
  try {
    const h = req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
    if (!h) return [];
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return (p.userRoles || []).map(r => String(r).toLowerCase());
  } catch (e) { return []; }
}

// Resumen de facturación del mes en curso, cacheado por instancia (TTL 30 min)
// para no golpear la cartola en cada mensaje. Solo se usa para autorizados.
let _finMes = { mes: null, texto: null, ts: 0 };
async function bloqueFinanzasMes(context) {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = hoy.slice(0, 7);
    if (_finMes.mes === mes && (Date.now() - _finMes.ts) < 30 * 60 * 1000) return _finMes.texto;
    const r = await finanzas.resumenMensual(hoy);
    const txt = finanzas.formatoContextoMes(r);
    _finMes = { mes, texto: txt, ts: Date.now() };
    return txt;
  } catch (e) { context.log.warn('finanzas mes: ' + e.message); return null; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// ── La herramienta que se le declara a Claude ───────────────────────────────
const TOOLS = [{
  name: 'consultar_operacion',
  description:
    'Consulta el movimiento de pallets de REDTEC (emisiones, retiros, ' +
    'transferencias, devoluciones, recogida) para un rango de fechas, con ' +
    'desglose por planta (Santiago, Talca, Coquimbo). Hay datos desde ' +
    '2023-03-20. Úsala para CUALQUIER periodo que no esté en el contexto: un ' +
    'día puntual, una semana pasada, un mes, un año. Si el usuario dice ' +
    '"semana 20" o "marzo", convierte tú el periodo a fechas concretas. NO la ' +
    'uses para la semana en curso ni el acumulado del año: eso ya viene en el ' +
    'contexto. Si `transferencias_provisional` llega en true, advierte que ' +
    'las transferencias del rango están sujetas a confirmación. Si el ' +
    'usuario pregunta A QUÉ BODEGA o A QUÉ CLIENTE (destino u origen) de un ' +
    'movimiento, pasa `desglose: true` y usa el objeto `desglose` de la ' +
    'respuesta (top por concepto con clienteDestino/clienteOrigen/' +
    'bodegaDestino/bodegaOrigen). Para emisiones interesa el DESTINO; para ' +
    'retiros y devoluciones, el ORIGEN.',
  input_schema: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Inicio del rango, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Fin del rango, YYYY-MM-DD' },
      desglose: { type: 'boolean', description: 'Si true, incluye el desglose por cliente y bodega (origen y destino) de cada concepto. Úsalo cuando pregunten "a qué bodega/cliente".' }
    },
    required: ['desde', 'hasta']
  }
}, STOCK_TOOL, CLIENTE_TOOL];

async function llamarClaude(body) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(data).slice(0, 200));
  return data;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  try {
    const { model, max_tokens, system, messages } = req.body || {};
    if (!Array.isArray(messages)) throw new Error('faltan messages');

    // Galaxia Finanzas: solo para roles autorizados (dato sensible).
    const roles = rolesDe(req);
    const puedeFinanzas = roles.some(r => FIN_ROLES.includes(r));
    const tools = puedeFinanzas ? [...TOOLS, finanzas.TOOL_SCHEMA] : TOOLS;
    let sys = system || '';
    // Histórico precargado (comparaciones de años/meses sin leer cientos de días). Para todos.
    const opsResumen = await resumenOps.bloqueContexto(context);
    if (opsResumen) sys += (sys ? '\n\n' : '') + opsResumen;
    // Facturación del mes en curso, solo para autorizados.
    if (puedeFinanzas) {
      const finBloque = await bloqueFinanzasMes(context);
      if (finBloque) sys += (sys ? '\n\n' : '') + finBloque;
    }

    const convo = [...messages];
    let resp;

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      resp = await llamarClaude({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1024,
        system: sys, messages: convo, tools
      });

      if (resp.stop_reason !== 'tool_use') break;   // respuesta final

      // Claude pidió la herramienta: ejecutar y devolverle el resultado.
      convo.push({ role: 'assistant', content: resp.content });
      const resultados = [];
      for (const bloque of resp.content) {
        if (bloque.type !== 'tool_use') continue;
        let out;
        try {
          if (bloque.name === 'consultar_operacion') {
            const t0 = Date.now();
            out = await consultarOperacion(bloque.input, context);
            context.log(`tool consultar_operacion ${bloque.input.desde}..${bloque.input.hasta} ` +
                        `(${Date.now() - t0}ms, cache:${out._origen.cache_dias}d vivo:${out._origen.vivo_dias}d)`);
          } else if (bloque.name === 'consultar_stock') {
            const t0 = Date.now();
            out = await consultarStock(bloque.input);
            context.log(`tool consultar_stock ${bloque.input.desde}..${bloque.input.hasta} ` +
                        `[${bloque.input.universo || 'ambos'}] (${Date.now() - t0}ms)`);
          } else if (bloque.name === 'consultar_cliente') {
            const t0 = Date.now();
            out = await consultarCliente(bloque.input, context);
            context.log(`tool consultar_cliente "${bloque.input.entidad}" ${bloque.input.desde}..${bloque.input.hasta} ` +
                        `(${Date.now() - t0}ms, ${out.total_operaciones} ops)`);
          } else if (bloque.name === 'consultar_finanzas') {
            if (!puedeFinanzas) { out = { error: 'sin autorización para datos financieros' }; }
            else {
              const t0 = Date.now();
              out = await finanzas.consultarFinanzas(bloque.input, context);
              context.log(`tool consultar_finanzas ${bloque.input.desde}..${bloque.input.hasta}` +
                          `${bloque.input.entidad ? ' ["' + bloque.input.entidad + '"]' : ''} (${Date.now() - t0}ms)`);
            }
          } else {
            out = { error: 'herramienta desconocida: ' + bloque.name };
          }
        } catch (e) {
          context.log.warn('tool error: ' + e.message);
          out = { error: 'no se pudo consultar: ' + e.message };
        }
        resultados.push({
          type: 'tool_result',
          tool_use_id: bloque.id,
          content: JSON.stringify(out)
        });
      }
      convo.push({ role: 'user', content: resultados });
    }

    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(resp)
    };
  } catch (err) {
    context.log.error('chat:', err.message);
    context.res = {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'asistente no disponible', detail: err.message })
    };
  }
};