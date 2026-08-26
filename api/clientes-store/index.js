// ============================================================================
//  api/clientes-store  —  Persistencia interna (JSON en Azure Blob)
//  SIN dependencias npm: usa fetch nativo + crypto (firma Shared Key).
//
//  Acciones:
//    GET  ?sheet=Clientes            -> array JSON guardado (o [] si no existe)
//    GET  ?sheet=Clientes&respaldos=1-> lista de respaldos disponibles
//    POST {sheet, data:[...] }       -> sobrescribe el blob (respalda antes)
//    POST {sheet, restaurar:"<id>"}  -> restaura un respaldo (respalda antes)
//
//  sheets: Clientes | Calendario | Resultados
//
//  ------------------------------------------------------------------------
//  PROTECCIÓN DE DATOS  (agregado 2026-08-26)
//  ------------------------------------------------------------------------
//  1. Escritura restringida por rol. Antes cualquier usuario autenticado del
//     portal podía sobrescribir una hoja completa. Ahora el POST exige uno de
//     los roles de CONTEOS_EDIT_ROLES. La regla equivalente en
//     staticwebapp.config.json es la primera barrera; esta es la segunda, para
//     que la Function siga protegida aunque la config cambie.
//  2. Respaldo automático antes de cada sobrescritura, en
//     respaldos/<Sheet>/<timestamp>.json dentro del mismo contenedor.
//  3. Restauración desde respaldo (POST con "restaurar").
//
//  Se recomienda además activar en la Storage Account:
//  blob versioning + soft delete. Son independientes de este código.
//
//  ------------------------------------------------------------------------
//  VARIABLES DE ENTORNO
//  ------------------------------------------------------------------------
//    BLOB_CONNECTION_STRING   (requerida)
//    BLOB_CONTAINER           (opcional, default "redtec-store")
//    CONTEOS_EDIT_ROLES       (opcional, default "admin,conteos")
//                             roles de SWA autorizados a escribir
//    CONTEOS_MAX_RESPALDOS    (opcional, default 60) respaldos que se
//                             conservan por hoja; los más viejos se borran
// ============================================================================

const crypto = require("crypto");

const SHEETS = ["Clientes", "Calendario", "Resultados"];
const CONTAINER = process.env.BLOB_CONTAINER || "redtec-store";
const PREFIJO_RESPALDO = "respaldos";

// ---------------------------------------------------------------------------
//  Conexión y firma Shared Key
// ---------------------------------------------------------------------------

function parseConn(conn) {
  const out = {};
  (conn || "").split(";").forEach(kv => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return {
    account: out.AccountName,
    key: out.AccountKey,
    suffix: out.EndpointSuffix || "core.windows.net",
    protocol: out.DefaultEndpointsProtocol || "https",
  };
}

function baseHeaders() {
  return {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2021-08-06",
  };
}

// Firma Shared Key para una petición a un blob.
function sign(method, account, key, container, blob, headers, contentLength) {
  const ms = "x-ms-blob-type:BlockBlob\n";
  const date = headers["x-ms-date"];
  const ver = headers["x-ms-version"];
  const ct = headers["Content-Type"] || "";
  const cl = contentLength ? String(contentLength) : "";

  const canonHeaders =
    (method === "PUT" ? ms : "") +
    `x-ms-date:${date}\n` +
    `x-ms-version:${ver}\n`;

  const canonResource = `/${account}/${container}/${blob}`;

  const stringToSign = [
    method, "", "", cl, "", ct, "", "", "", "", "", "",
    canonHeaders + canonResource
  ].join("\n");

  const sig = crypto
    .createHmac("sha256", Buffer.from(key, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");

  return `SharedKey ${account}:${sig}`;
}

// Firma para operaciones sobre el contenedor (crear, listar).
// paramsCanon: pares "nombre:valor" YA ordenados alfabéticamente.
function signContainer(method, account, key, paramsCanon) {
  const headers = baseHeaders();
  const canon =
    `x-ms-date:${headers["x-ms-date"]}\n` +
    `x-ms-version:${headers["x-ms-version"]}\n`;
  const resource = `/${account}/${CONTAINER}` +
    (paramsCanon.length ? "\n" + paramsCanon.join("\n") : "");
  const sts = [method, "", "", "", "", "", "", "", "", "", "", ""].join("\n") +
    "\n" + canon + resource;
  headers["Authorization"] = "SharedKey " + account + ":" +
    crypto.createHmac("sha256", Buffer.from(key, "base64"))
          .update(sts, "utf8").digest("base64");
  return headers;
}

async function ensureContainer(cfg) {
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}?restype=container`;
  const headers = signContainer("PUT", cfg.account, cfg.key, ["restype:container"]);
  const r = await fetch(url, { method: "PUT", headers });
  if (![201, 409].includes(r.status)) {
    const t = await r.text();
    throw new Error(`No se pudo crear el contenedor (HTTP ${r.status}): ${t.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
//  Lectura / escritura de blobs
// ---------------------------------------------------------------------------

async function leerBlobCrudo(cfg, blob) {
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const headers = baseHeaders();
  headers["Authorization"] = sign("GET", cfg.account, cfg.key, CONTAINER, blob, headers, 0);
  const r = await fetch(url, { method: "GET", headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET blob HTTP ${r.status}`);
  return await r.text();
}

async function escribirBlobCrudo(cfg, blob, texto) {
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const len = Buffer.byteLength(texto);
  const headers = baseHeaders();
  headers["x-ms-blob-type"] = "BlockBlob";
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Authorization"] = sign("PUT", cfg.account, cfg.key, CONTAINER, blob, headers, len);
  const r = await fetch(url, { method: "PUT", headers, body: texto });
  if (![201, 200].includes(r.status)) {
    const t = await r.text();
    throw new Error(`PUT blob HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
}

async function borrarBlob(cfg, blob) {
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const headers = baseHeaders();
  headers["Authorization"] = sign("DELETE", cfg.account, cfg.key, CONTAINER, blob, headers, 0);
  const r = await fetch(url, { method: "DELETE", headers });
  return [202, 404].includes(r.status);
}

function comoArray(txt) {
  if (txt == null) return [];
  try { const p = JSON.parse(txt); return Array.isArray(p) ? p : []; }
  catch { return []; }
}

async function readSheet(cfg, sheet) {
  return comoArray(await leerBlobCrudo(cfg, `${sheet}.json`));
}

// ---------------------------------------------------------------------------
//  Respaldos
// ---------------------------------------------------------------------------

// 2026-08-26T15-04-05-123Z  (sin ":" para que sea seguro en la ruta del blob)
function sello() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function listarRespaldos(cfg, sheet) {
  const prefix = `${PREFIJO_RESPALDO}/${sheet}/`;
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}` +
    `?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`;
  // Orden alfabético de los parámetros: comp, prefix, restype
  const headers = signContainer("GET", cfg.account, cfg.key, [
    "comp:list",
    `prefix:${prefix}`,
    "restype:container",
  ]);
  const r = await fetch(url, { method: "GET", headers });
  if (!r.ok) throw new Error(`List blobs HTTP ${r.status}`);
  const xml = await r.text();

  const items = [];
  const re = /<Blob>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<Last-Modified>([^<]*)<\/Last-Modified>[\s\S]*?<Content-Length>(\d*)<\/Content-Length>[\s\S]*?<\/Blob>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push({ id: m[1], modificado: m[2], bytes: Number(m[3]) || 0 });
  }
  // Más reciente primero (el nombre lleva el timestamp, así que ordena solo)
  items.sort((a, b) => (a.id < b.id ? 1 : -1));
  return items;
}

// Copia el estado actual de la hoja a respaldos/. Devuelve el id o null.
async function respaldar(cfg, sheet, context) {
  try {
    const actual = await leerBlobCrudo(cfg, `${sheet}.json`);
    if (actual == null) return null;               // nada que respaldar todavía
    const id = `${PREFIJO_RESPALDO}/${sheet}/${sello()}.json`;
    await escribirBlobCrudo(cfg, id, actual);
    return id;
  } catch (e) {
    context.log.error(`clientes-store: falló el respaldo de ${sheet}:`, e && e.message);
    return null;
  }
}

async function podarRespaldos(cfg, sheet, context) {
  try {
    const max = Number(process.env.CONTEOS_MAX_RESPALDOS || 60);
    const lista = await listarRespaldos(cfg, sheet);
    const sobran = lista.slice(max);
    for (const b of sobran) await borrarBlob(cfg, b.id);
    if (sobran.length) context.log.info(`clientes-store: podados ${sobran.length} respaldos de ${sheet}`);
  } catch (e) {
    context.log.error("clientes-store: falló la poda de respaldos:", e && e.message);
  }
}

// ---------------------------------------------------------------------------
//  Identidad y roles (SWA: header x-ms-client-principal)
// ---------------------------------------------------------------------------

function principal(req) {
  const b64 = req.headers && (req.headers["x-ms-client-principal"] || req.headers["X-MS-CLIENT-PRINCIPAL"]);
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { return null; }
}

function rolesEdicion() {
  return (process.env.CONTEOS_EDIT_ROLES || "admin,conteos")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

function puedeEscribir(p) {
  if (!p) return false;
  const permitidos = rolesEdicion();
  const suyos = (p.userRoles || []).map(r => String(r).toLowerCase());
  return suyos.some(r => permitidos.includes(r));
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------

module.exports = async function (context, req) {
  // Mismo origen: no se emiten headers CORS. Este endpoint es solo para el
  // portal, no para consumo externo (para eso está api/conteos-publico).
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const responder = (status, body) => {
    context.res = { status, headers, body: JSON.stringify(body) };
  };

  if (req.method === "OPTIONS") { context.res = { status: 204, headers }; return; }

  try {
    const conn = process.env.BLOB_CONNECTION_STRING;
    if (!conn) throw new Error("Falta BLOB_CONNECTION_STRING en la configuración de la app.");
    const cfg = parseConn(conn);
    if (!cfg.account || !cfg.key) throw new Error("BLOB_CONNECTION_STRING inválida (faltan AccountName/AccountKey).");

    // ---------------- GET: leer hoja o listar respaldos ----------------
    if (req.method === "GET") {
      const sheet = (req.query.sheet || "").trim();
      if (!SHEETS.includes(sheet)) return responder(400, { error: "sheet inválido" });

      if (req.query.respaldos) {
        const p = principal(req);
        if (!puedeEscribir(p)) {
          return responder(403, { error: "no tienes permiso para ver los respaldos" });
        }
        return responder(200, { sheet, respaldos: await listarRespaldos(cfg, sheet) });
      }

      return responder(200, await readSheet(cfg, sheet));
    }

    // ---------------- POST: escribir o restaurar ----------------
    if (req.method === "POST") {
      const p = principal(req);
      if (!puedeEscribir(p)) {
        context.log.warn(
          `clientes-store: escritura rechazada para ${p ? p.userDetails : "anónimo"} ` +
          `(roles: ${p ? (p.userRoles || []).join("|") : "ninguno"})`
        );
        return responder(403, {
          error: "no tienes permiso para modificar esta información. " +
                 "Solicita el rol correspondiente al administrador."
        });
      }

      const payload = req.body || {};
      const sheet = (payload.sheet || "").trim();
      if (!SHEETS.includes(sheet)) return responder(400, { error: "sheet inválido" });

      await ensureContainer(cfg);

      // --- restaurar un respaldo ---
      if (payload.restaurar) {
        const id = String(payload.restaurar);
        if (!id.startsWith(`${PREFIJO_RESPALDO}/${sheet}/`) || id.includes("..")) {
          return responder(400, { error: "identificador de respaldo inválido" });
        }
        const txt = await leerBlobCrudo(cfg, id);
        if (txt == null) return responder(404, { error: "ese respaldo ya no existe" });
        const datos = comoArray(txt);

        const previo = await respaldar(cfg, sheet, context);   // red de seguridad
        await escribirBlobCrudo(cfg, `${sheet}.json`, JSON.stringify(datos, null, 2));
        await podarRespaldos(cfg, sheet, context);
        context.log.info(`clientes-store: ${p.userDetails} restauró ${sheet} desde ${id}`);
        return responder(200, { ok: true, restaurado: id, count: datos.length, respaldoPrevio: previo });
      }

      // --- sobrescribir con datos nuevos ---
      if (!Array.isArray(payload.data)) {
        return responder(400, { error: "data debe ser un array" });
      }

      const antes = await readSheet(cfg, sheet);
      const respaldo = await respaldar(cfg, sheet, context);

      // No bloquea, pero deja rastro de una caída brusca de registros.
      if (antes.length >= 10 && payload.data.length < antes.length * 0.5) {
        context.log.warn(
          `clientes-store: ATENCIÓN — ${sheet} pasa de ${antes.length} a ` +
          `${payload.data.length} registros (usuario: ${p.userDetails}). Respaldo: ${respaldo}`
        );
      }

      await escribirBlobCrudo(cfg, `${sheet}.json`, JSON.stringify(payload.data, null, 2));
      await podarRespaldos(cfg, sheet, context);

      context.log.info(`clientes-store: ${p.userDetails} guardó ${sheet} (${payload.data.length} registros)`);
      return responder(200, {
        ok: true,
        count: payload.data.length,
        anterior: antes.length,
        respaldo,
      });
    }

    return responder(405, { error: "método no permitido" });

  } catch (e) {
    context.log.error("clientes-store error:", e && e.message);
    return responder(500, { error: String(e.message || e) });
  }
};
