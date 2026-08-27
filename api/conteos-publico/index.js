// ============================================================================
//  api/conteos-publico  —  API DE SOLO LECTURA para consumidores externos
//
//  Lee los MISMOS blobs que ya escribe api/clientes-store
//  (Clientes.json / Calendario.json / Resultados.json en el contenedor
//  redtec-store) y los expone hacia afuera con:
//    · autenticación por API key en header  X-Api-Key
//    · una key distinta por consumidor, revocable de forma independiente
//    · lista blanca de campos (los datos de contacto NO salen por defecto)
//    · acotamiento por cliente (una key puede ver solo sus propios conteos)
//    · filtros, orden y paginación
//    · CORS restringido a los dominios que tú autorices
//    · solo GET — este endpoint no puede escribir nada
//
//  Sin dependencias npm: fetch nativo + crypto (firma Shared Key), igual
//  que clientes-store / historial-proxy.
//
//  ------------------------------------------------------------------------
//  VARIABLES DE ENTORNO (Configuration de la Static Web App)
//  ------------------------------------------------------------------------
//  BLOB_CONNECTION_STRING   (ya existe, la usa clientes-store)
//  BLOB_CONTAINER           (opcional, default "redtec-store")
//
//  CONTEOS_API_KEYS   JSON con una entrada por consumidor. Ejemplo:
//  {
//    "8f2c...clave-larga-aleatoria...": {
//      "nombre":   "Consultora Externa X",
//      "recursos": ["calendario"],
//      "clientes": ["*"],
//      "contacto": false
//    },
//    "otra-clave-para-colgate": {
//      "nombre":   "Colgate Palmolive",
//      "recursos": ["calendario", "resultados"],
//      "clientes": ["COLGATE PALMOLIVE"],
//      "contacto": true
//    }
//  }
//    recursos → cuáles de clientes|calendario|resultados puede leer
//    clientes → ["*"] = todos; o lista de nombres (coincidencia parcial,
//               sin distinguir mayúsculas ni tildes)
//    contacto → true incluye responsable/teléfono/correo (datos personales
//               de terceros: déjalo en false salvo que corresponda)
//    campos   → (opcional) lista blanca propia que reemplaza la default
//
//  CONTEOS_CORS_ORIGINS  (opcional) dominios separados por coma que pueden
//                        llamar desde un navegador. Si no se define, no se
//                        emite CORS: solo se puede consumir servidor a
//                        servidor, que es lo recomendable.
//
//  CONTEOS_RATE_LIMIT    (opcional) máximo de llamadas por minuto y por
//                        key. Default 60.
//
//  ------------------------------------------------------------------------
//  PARÁMETROS DE CONSULTA
//  ------------------------------------------------------------------------
//    recurso     clientes | calendario | resultados   (default calendario)
//    cliente     texto, coincidencia parcial sin tildes
//    estado      Programado | Realizado | Pendientes de respuesta
//    mes         Enero … Diciembre
//    ejecutivo   texto, coincidencia parcial
//    desde/hasta AAAA-MM-DD, filtran por la fecha del conteo
//    sin_fecha   excluir (default) | incluir — qué hacer con los registros
//                que todavía no tienen fecha asignada cuando se usa un rango.
//                Con cualquier rango, la respuesta informa siempre cuántos
//                quedaron fuera en sin_fecha_excluidos.
//    limit       1..500 (default 100)
//    offset      desplazamiento para paginar
// ============================================================================

const crypto = require("crypto");

const CONTAINER = process.env.BLOB_CONTAINER || "redtec-store";

// recurso público -> blob interno
const RECURSOS = {
  clientes:   "Clientes",
  calendario: "Calendario",
  resultados: "Resultados",
};

// Lista blanca de campos por recurso. Todo lo que no esté aquí NO sale.
//
// Sobre las llaves de cruce — importante para quien consume los tres recursos:
//   · clientes.id    identifica al cliente dentro de Clientes.json.
//   · calendario.id  identifica la FILA del calendario, no al cliente: un
//                    cliente con dos recintos tiene dos filas. Por eso corre
//                    desfasado respecto de clientes.id y NO sirve para cruzar.
//   · calendario.num es el número de orden del cliente. Coincide con
//                    clientes.id solo por herencia del Excel original; no es
//                    una llave foránea y ya se desalinea con los registros
//                    nuevos. Tampoco sirve para cruzar.
//   · resultados.conteoId -> calendario.id  es la ÚNICA relación real que
//                    existe en los datos guardados.
//
// Para el resto, la API expone cliente_key: el nombre del cliente
// normalizado, calculado igual en los tres recursos. Esa es la llave estable
// para cruzar clientes <-> calendario <-> resultados.
const CAMPOS_PUBLICOS = {
  clientes:   ["id", "cliente", "cliente_key", "ejecutivo", "mes"],
  calendario: ["id", "num", "cliente", "cliente_key", "estado", "recinto",
               "urgencia", "fecha", "fecha_iso", "horario", "ejecutivo", "mes",
               "acceso", "implementos", "obs"],
  resultados: ["id", "conteoId", "cliente", "cliente_key", "fecha", "fecha_iso",
               "ejecutivo", "recinto", "item", "fisico", "sap", "diferencia",
               "porcentaje", "pendientes2024", "difTotal", "obs"],
};

// Campos de contacto: solo si la key los tiene habilitados.
const CAMPOS_CONTACTO = ["responsable", "telefono", "correo"];

// ---------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

const MESES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

// "10 ago 2026" | "5 mar 2026" | "2026-08-10"  ->  "2026-08-10" (o null)
function aISO(fecha) {
  const f = String(fecha || "").trim();
  if (!f) return null;

  const iso = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const m = norm(f).match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  if (m) {
    const mes = MESES[m[2].slice(0, 4)] || MESES[m[2].slice(0, 3)];
    if (mes) {
      return `${m[3]}-${String(mes).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
  }
  return null;
}

// Llave de cruce estable entre los tres recursos: el nombre del cliente
// normalizado. Sin tildes, sin mayúsculas, sin puntuación, espacios colapsados.
//   "ALD LOGISTICA SpA."                    -> "ald-logistica-spa"
//   "Comercial Rocky S.A."                  -> "comercial-rocky-s-a"
//   "ELABORADORA ... LIMITADA (Castano)"    -> "elaboradora-...-limitada-castano"
function claveCliente(nombre) {
  const base = norm(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || null;
}

function esFechaValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

// Comparación en tiempo constante para no filtrar la key por timing.
function keySegura(recibida, candidatas) {
  const buf = Buffer.from(String(recibida || ""), "utf8");
  for (const k of candidatas) {
    const kb = Buffer.from(k, "utf8");
    if (kb.length === buf.length && crypto.timingSafeEqual(kb, buf)) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Rate limit (best-effort: en memoria, por instancia)
// ---------------------------------------------------------------------------

const golpes = new Map();

function excedeLimite(key, max) {
  const ahora = Date.now();
  const ventana = Math.floor(ahora / 60000);
  const id = `${key}:${ventana}`;
  const n = (golpes.get(id) || 0) + 1;
  golpes.set(id, n);
  if (golpes.size > 500) {
    for (const k of golpes.keys()) {
      if (Number(k.split(":").pop()) < ventana) golpes.delete(k);
    }
  }
  return n > max;
}

// ---------------------------------------------------------------------------
//  Lectura del blob (Shared Key, mismo esquema que clientes-store)
// ---------------------------------------------------------------------------

function parseConn(conn) {
  const out = {};
  (conn || "").split(";").forEach(kv => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return {
    account:  out.AccountName,
    key:      out.AccountKey,
    suffix:   out.EndpointSuffix || "core.windows.net",
    protocol: out.DefaultEndpointsProtocol || "https",
  };
}

async function leerBlob(cfg, nombre) {
  const blob = `${nombre}.json`;
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const headers = {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2021-08-06",
  };
  const canon = `x-ms-date:${headers["x-ms-date"]}\nx-ms-version:${headers["x-ms-version"]}\n`;
  const sts = ["GET", "", "", "", "", "", "", "", "", "", "", ""].join("\n") +
              "\n" + canon + `/${cfg.account}/${CONTAINER}/${blob}`;
  headers["Authorization"] = "SharedKey " + cfg.account + ":" +
    crypto.createHmac("sha256", Buffer.from(cfg.key, "base64"))
          .update(sts, "utf8").digest("base64");

  const r = await fetch(url, { method: "GET", headers });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET blob HTTP ${r.status}`);
  try {
    const p = JSON.parse(await r.text());
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------

module.exports = async function (context, req) {
  const origenes = (process.env.CONTEOS_CORS_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const origen = req.headers && (req.headers.origin || req.headers.Origin);

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origen && origenes.includes(origen)) {
    headers["Access-Control-Allow-Origin"] = origen;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "X-Api-Key, Content-Type";
    headers["Vary"] = "Origin";
  }

  const responder = (status, body) => {
    context.res = { status, headers, body: JSON.stringify(body, null, 2) };
  };

  if (req.method === "OPTIONS") { context.res = { status: 204, headers }; return; }

  try {
    // --- 1. Autenticación ---------------------------------------------------
    let catalogo;
    try {
      catalogo = JSON.parse(process.env.CONTEOS_API_KEYS || "{}");
    } catch {
      context.log.error("conteos-publico: CONTEOS_API_KEYS no es JSON válido");
      return responder(503, { error: "servicio no configurado" });
    }
    const claves = Object.keys(catalogo);
    if (!claves.length) {
      context.log.error("conteos-publico: no hay CONTEOS_API_KEYS definidas");
      return responder(503, { error: "servicio no configurado" });
    }

    const recibida = (req.headers && (req.headers["x-api-key"] || req.headers["X-Api-Key"])) || "";
    const clave = keySegura(recibida, claves);
    if (!clave) {
      context.log.warn("conteos-publico: intento con API key inválida o ausente");
      return responder(401, { error: "API key inválida o ausente (header X-Api-Key)" });
    }
    const perfil = catalogo[clave] || {};
    const etiqueta = perfil.nombre || "sin-nombre";

    // --- 2. Rate limit ------------------------------------------------------
    const max = Number(process.env.CONTEOS_RATE_LIMIT || 60);
    if (excedeLimite(clave, max)) {
      headers["Retry-After"] = "60";
      return responder(429, { error: `límite de ${max} solicitudes por minuto excedido` });
    }

    // --- 3. Recurso solicitado ---------------------------------------------
    const q = req.query || {};
    const recurso = norm(q.recurso || "calendario");
    if (!RECURSOS[recurso]) {
      return responder(400, {
        error: "recurso inválido",
        recursos_validos: Object.keys(RECURSOS),
      });
    }
    const permitidos = Array.isArray(perfil.recursos) ? perfil.recursos.map(norm) : ["calendario"];
    if (!permitidos.includes(recurso)) {
      context.log.warn(`conteos-publico: ${etiqueta} pidió recurso no autorizado "${recurso}"`);
      return responder(403, { error: `esta API key no tiene acceso al recurso "${recurso}"` });
    }

    // --- 4. Lectura ---------------------------------------------------------
    const conn = process.env.BLOB_CONNECTION_STRING;
    if (!conn) throw new Error("Falta BLOB_CONNECTION_STRING en la configuración de la app.");
    const cfg = parseConn(conn);
    if (!cfg.account || !cfg.key) throw new Error("BLOB_CONNECTION_STRING inválida.");

    let filas = await leerBlob(cfg, RECURSOS[recurso]);

    // --- 5. Acotamiento por cliente (según la key) --------------------------
    const alcance = Array.isArray(perfil.clientes) ? perfil.clientes : ["*"];
    const todos = alcance.some(c => String(c).trim() === "*");
    if (!todos) {
      const patrones = alcance.map(norm).filter(Boolean);
      filas = filas.filter(f => patrones.some(p => norm(f.cliente).includes(p)));
    }

    // --- 6. Filtros de la consulta -----------------------------------------
    if (q.cliente) {
      const p = norm(q.cliente);
      filas = filas.filter(f => norm(f.cliente).includes(p));
    }
    if (q.estado) {
      const p = norm(q.estado);
      filas = filas.filter(f => norm(f.estado) === p);
    }
    if (q.mes) {
      const p = norm(q.mes);
      filas = filas.filter(f => norm(f.mes) === p);
    }
    if (q.ejecutivo) {
      const p = norm(q.ejecutivo);
      filas = filas.filter(f => norm(f.ejecutivo).includes(p));
    }

    const desde = String(q.desde || "").trim();
    const hasta = String(q.hasta || "").trim();
    if ((desde && !esFechaValida(desde)) || (hasta && !esFechaValida(hasta))) {
      return responder(400, { error: "desde/hasta deben tener formato AAAA-MM-DD" });
    }

    // Muchos conteos todavía no tienen fecha asignada (típicamente los que
    // están "Pendientes de respuesta"). Un filtro por rango los dejaba fuera
    // en silencio, y quien paginara por mes nunca los veía. Ahora:
    //   · sin_fecha=incluir  los trae igual dentro del rango
    //   · y la respuesta SIEMPRE informa cuántos se dejaron fuera
    const rango = Boolean(desde || hasta);
    const incluirSinFecha = norm(q.sin_fecha) === "incluir";
    let sinFechaExcluidos = 0;

    if (rango) {
      filas = filas.filter(f => {
        const iso = aISO(f.fecha);
        if (!iso) {
          if (incluirSinFecha) return true;
          sinFechaExcluidos++;
          return false;
        }
        if (desde && iso < desde) return false;
        if (hasta && iso > hasta) return false;
        return true;
      });
    }

    // --- 7. Proyección: solo los campos autorizados -------------------------
    let campos = Array.isArray(perfil.campos) && perfil.campos.length
      ? perfil.campos.slice()
      : CAMPOS_PUBLICOS[recurso].slice();
    if (perfil.contacto === true) {
      CAMPOS_CONTACTO.forEach(c => { if (!campos.includes(c)) campos.push(c); });
    }

    const total = filas.length;

    // --- 8. Orden y paginación ---------------------------------------------
    filas.sort((a, b) => {
      const fa = aISO(a.fecha) || "";
      const fb = aISO(b.fecha) || "";
      if (fa !== fb) return fa < fb ? 1 : -1;         // más reciente primero
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const pagina = filas.slice(offset, offset + limit);

    const data = pagina.map(f => {
      const o = {};
      const iso = aISO(f.fecha);
      for (const c of campos) {
        if (c === "fecha_iso")   { o.fecha_iso = iso; continue; }
        if (c === "cliente_key") { o.cliente_key = claveCliente(f.cliente); continue; }
        if (!Object.prototype.hasOwnProperty.call(f, c)) continue;
        if (c === "conteoId") {
          // Se guarda como texto desde el <select> del formulario, mientras que
          // calendario.id es número. Se normaliza acá para que el cruce
          // resultados.conteoId -> calendario.id funcione sin convertir tipos.
          const n = Number(f.conteoId);
          o.conteoId = (String(f.conteoId).trim() !== "" && Number.isFinite(n)) ? n : f.conteoId;
          continue;
        }
        o[c] = f[c];
      }
      return o;
    });

    context.log.info(
      `conteos-publico: ${etiqueta} -> ${recurso} (${data.length}/${total})`
    );

    const cuerpo = {
      recurso,
      generado: new Date().toISOString(),
      total,
      count: data.length,
      offset,
      limit,
    };
    if (rango) {
      // Nunca se descarta nada en silencio: si hay registros sin fecha que
      // quedaron fuera del rango, la respuesta lo dice.
      cuerpo.sin_fecha_excluidos = sinFechaExcluidos;
      if (sinFechaExcluidos > 0) {
        cuerpo.aviso = `${sinFechaExcluidos} registro(s) sin fecha asignada quedaron ` +
          `fuera de este rango. Agrega sin_fecha=incluir para traerlos, o consulta sin desde/hasta.`;
      }
    }
    cuerpo.data = data;
    return responder(200, cuerpo);

  } catch (e) {
    context.log.error("conteos-publico error:", e && e.message);
    // No devolvemos el detalle interno hacia afuera.
    return responder(500, { error: "error interno" });
  }
};
