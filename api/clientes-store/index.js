// ============================================================================
//  api/clientes-store  —  Persistencia interna (JSON en Azure Blob)
//  SIN dependencias npm: usa fetch nativo + crypto (firma Shared Key).
//  Mismo estilo que historial-proxy / cartola-proxy (solo fetch).
//
//  Acciones:
//    GET  ?sheet=Clientes      -> array JSON guardado (o [] si no existe)
//    POST {sheet, data:[...] } -> sobrescribe el blob
//
//  sheets: Clientes | Calendario | Resultados
//  Variable de entorno requerida:
//    BLOB_CONNECTION_STRING  (cadena de conexión de la Storage Account)
//  Opcional:
//    BLOB_CONTAINER          (default "redtec-store")
// ============================================================================

const crypto = require("crypto");

const SHEETS = ["Clientes", "Calendario", "Resultados"];
const CONTAINER = process.env.BLOB_CONTAINER || "redtec-store";

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

// Firma Shared Key para una petición a Blob Storage
function sign(method, account, key, container, blob, headers, contentLength) {
  const ms = "x-ms-blob-type:BlockBlob\n";
  const date = headers["x-ms-date"];
  const ver = headers["x-ms-version"];
  const ct = headers["Content-Type"] || "";
  const cl = contentLength ? String(contentLength) : "";

  // CanonicalizedHeaders (orden alfabético): x-ms-blob-type (solo PUT), x-ms-date, x-ms-version
  const canonHeaders =
    (method === "PUT" ? ms : "") +
    `x-ms-date:${date}\n` +
    `x-ms-version:${ver}\n`;

  const canonResource = `/${account}/${container}/${blob}`;

  // StringToSign para Shared Key
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

function baseHeaders() {
  return {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2021-08-06",
  };
}

async function ensureContainer(account, key, suffix, protocol) {
  const url = `${protocol}://${account}.blob.${suffix}/${CONTAINER}?restype=container`;
  const headers = baseHeaders();
  // firma simple para PUT container (sin blob-type)
  const canon = `x-ms-date:${headers["x-ms-date"]}\nx-ms-version:${headers["x-ms-version"]}\n`;
  const resource = `/${account}/${CONTAINER}\nrestype:container`;
  const sts = ["PUT","","","","","","","","","","",""].join("\n") + "\n" + canon + resource;
  const sig = crypto.createHmac("sha256", Buffer.from(key,"base64")).update(sts,"utf8").digest("base64");
  headers["Authorization"] = `SharedKey ${account}:${sig}`;
  const r = await fetch(url, { method: "PUT", headers });
  // 201 creado, 409 ya existe -> ambos OK
  if (![201, 409].includes(r.status)) {
    const t = await r.text();
    throw new Error(`No se pudo crear el contenedor (HTTP ${r.status}): ${t.slice(0,200)}`);
  }
}

async function readSheet(cfg, sheet) {
  const blob = `${sheet}.json`;
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const headers = baseHeaders();
  headers["Authorization"] = sign("GET", cfg.account, cfg.key, CONTAINER, blob, headers, 0);
  const r = await fetch(url, { method: "GET", headers });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET blob HTTP ${r.status}`);
  const txt = await r.text();
  try { const p = JSON.parse(txt); return Array.isArray(p) ? p : []; }
  catch { return []; }
}

async function writeSheet(cfg, sheet, data) {
  await ensureContainer(cfg.account, cfg.key, cfg.suffix, cfg.protocol);
  const blob = `${sheet}.json`;
  const url = `${cfg.protocol}://${cfg.account}.blob.${cfg.suffix}/${CONTAINER}/${blob}`;
  const body = JSON.stringify(Array.isArray(data) ? data : [], null, 2);
  const len = Buffer.byteLength(body);
  const headers = baseHeaders();
  headers["x-ms-blob-type"] = "BlockBlob";
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Authorization"] = sign("PUT", cfg.account, cfg.key, CONTAINER, blob, headers, len);
  const r = await fetch(url, { method: "PUT", headers, body });
  if (![201, 200].includes(r.status)) {
    const t = await r.text();
    throw new Error(`PUT blob HTTP ${r.status}: ${t.slice(0,200)}`);
  }
}

module.exports = async function (context, req) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  try {
    const conn = process.env.BLOB_CONNECTION_STRING;
    if (!conn) throw new Error("Falta BLOB_CONNECTION_STRING en la configuración de la app.");
    const cfg = parseConn(conn);
    if (!cfg.account || !cfg.key) throw new Error("BLOB_CONNECTION_STRING inválida (faltan AccountName/AccountKey).");

    if (req.method === "GET") {
      const sheet = (req.query.sheet || "").trim();
      if (!SHEETS.includes(sheet)) { context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "sheet inválido" }) }; return; }
      const data = await readSheet(cfg, sheet);
      context.res = { status: 200, headers: cors, body: JSON.stringify(data) };
      return;
    }

    if (req.method === "POST") {
      const payload = req.body || {};
      const sheet = (payload.sheet || "").trim();
      if (!SHEETS.includes(sheet)) { context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "sheet inválido" }) }; return; }
      if (!Array.isArray(payload.data)) { context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "data debe ser un array" }) }; return; }
      await writeSheet(cfg, sheet, payload.data);
      context.res = { status: 200, headers: cors, body: JSON.stringify({ ok: true, count: payload.data.length }) };
      return;
    }

    context.res = { status: 405, headers: cors, body: JSON.stringify({ error: "método no permitido" }) };
  } catch (e) {
    context.log.error("clientes-store error:", e && e.message);
    context.res = { status: 500, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
