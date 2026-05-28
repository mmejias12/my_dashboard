// ============================================================================
//  api/clientes-store  —  Proxy de persistencia interna (reemplazo Google Sheets)
//  Guarda/lee la data como JSON de texto en Azure Blob Storage.
//
//  Patrón: igual que kpi-proxy / gps-stops-proxy (authLevel anonymous, GET+POST).
//
//  Acciones:
//    GET  ?sheet=Clientes        -> devuelve el array JSON guardado (o [] si no existe)
//    POST {sheet, data:[...] }   -> sobrescribe el blob con el array recibido
//
//  "sheet" admitidos: Clientes | Calendario | Resultados
//  Cada uno se guarda en su propio blob: redtec-store/Clientes.json, etc.
//
//  Variable de entorno requerida (Azure Static Web Apps > Configuration):
//    BLOB_CONNECTION_STRING = cadena de conexión de la Storage Account
//  Opcional:
//    BLOB_CONTAINER         = nombre del contenedor (default "redtec-store")
// ============================================================================

const { BlobServiceClient } = require("@azure/storage-blob");

const SHEETS = ["Clientes", "Calendario", "Resultados"];
const CONTAINER = process.env.BLOB_CONTAINER || "redtec-store";

// ---- helpers ---------------------------------------------------------------

function getContainerClient() {
  const conn = process.env.BLOB_CONNECTION_STRING;
  if (!conn) throw new Error("Falta BLOB_CONNECTION_STRING en la configuración de la app.");
  const svc = BlobServiceClient.fromConnectionString(conn);
  return svc.getContainerClient(CONTAINER);
}

async function streamToString(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", (d) => chunks.push(d instanceof Buffer ? d : Buffer.from(d)));
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    readable.on("error", reject);
  });
}

async function readSheet(container, sheet) {
  const blob = container.getBlockBlobClient(`${sheet}.json`);
  if (!(await blob.exists())) return [];
  const dl = await blob.download();
  const txt = await streamToString(dl.readableStreamBody);
  try {
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSheet(container, sheet, data) {
  await container.createIfNotExists();
  const blob = container.getBlockBlobClient(`${sheet}.json`);
  // Guardado como texto JSON plano (lo que pediste): todo serializado a string.
  const body = JSON.stringify(Array.isArray(data) ? data : [], null, 2);
  await blob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
  });
}

// ---- handler ---------------------------------------------------------------

module.exports = async function (context, req) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: cors };
    return;
  }

  try {
    const container = getContainerClient();

    if (req.method === "GET") {
      const sheet = (req.query.sheet || "").trim();
      if (!SHEETS.includes(sheet)) {
        context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "sheet inválido" }) };
        return;
      }
      const data = await readSheet(container, sheet);
      context.res = { status: 200, headers: cors, body: JSON.stringify(data) };
      return;
    }

    if (req.method === "POST") {
      const payload = req.body || {};
      const sheet = (payload.sheet || "").trim();
      if (!SHEETS.includes(sheet)) {
        context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "sheet inválido" }) };
        return;
      }
      if (!Array.isArray(payload.data)) {
        context.res = { status: 400, headers: cors, body: JSON.stringify({ error: "data debe ser un array" }) };
        return;
      }
      await writeSheet(container, sheet, payload.data);
      context.res = { status: 200, headers: cors, body: JSON.stringify({ ok: true, count: payload.data.length }) };
      return;
    }

    context.res = { status: 405, headers: cors, body: JSON.stringify({ error: "método no permitido" }) };
  } catch (e) {
    context.log.error(e);
    context.res = {
      status: 500,
      headers: cors,
      body: JSON.stringify({ error: String(e.message || e) }),
    };
  }
};
