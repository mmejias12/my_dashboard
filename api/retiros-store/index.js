// ============================================================================
//  api/retiros-store  ·  Programación de retiros retail (Logística inversa)
//
//  Reemplaza el backend de Google Apps Script de la app "Gestión de Retiros
//  Retail". Mismo dato, pero dentro del portal: la identidad la pone Entra vía
//  el header x-ms-client-principal de SWA, así que ya no hay usuarios ni
//  contraseñas viajando en el HTML del cliente.
//
//  ---------------------------------------------------------------------------
//  QUÉ HACE
//  ---------------------------------------------------------------------------
//    GET  ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD   -> registros del rango
//    GET  ?respaldos=YYYY-MM                   -> respaldos de ese mes
//    POST {accion:'agregar',  registro:{...}}  -> agrega uno
//    POST {accion:'editar',   id, cambios:{}}  -> edita campos permitidos
//    POST {accion:'eliminar', id, mes}         -> elimina uno
//    POST {accion:'restaurar',mes, respaldo}   -> restaura un respaldo del mes
//
//  ---------------------------------------------------------------------------
//  DIFERENCIAS DELIBERADAS CON EL BACKEND DE GOOGLE (y con clientes-store)
//  ---------------------------------------------------------------------------
//  1. ESCRITURA POR REGISTRO, NO POR ALMACÉN COMPLETO. clientes-store recibe
//     el array entero y lo sobrescribe; eso ya provocó una vez un camino de
//     pérdida total. Acá el cliente manda UN registro y el servidor hace
//     leer-modificar-escribir. Un celular con datos viejos no puede borrar
//     lo que registraron los demás.
//  2. CONCURRENCIA OPTIMISTA REAL. Son cuatro ejecutivos guardando al mismo
//     tiempo desde terreno. Se lee el ETag del blob y se escribe con
//     ifMatch; si otro escribió en el intermedio, Azure responde 412 y se
//     reintenta la operación completa (hasta REINTENTOS). Sin esto, dos
//     guardados simultáneos hacen que el segundo pise al primero.
//  3. SHARDING POR MES (retiros/YYYY-MM.json, igual que shared/uso-plataforma).
//     Mantiene los blobs chicos, acota la ventana de conflicto a los que
//     registran el mismo mes, y una consulta por rango lee solo los meses
//     que necesita.
//  4. VALIDACIÓN EN EL SERVIDOR. El backend de Google aceptaba cualquier cosa
//     que llegara en el JSON. Acá hay lista blanca de campos, rangos de fecha
//     y de cantidad, y enums de horario/planta: el navegador no es el lugar
//     donde se valida.
//  5. RESPONDE DE VERDAD. La app de Google hacía POST con mode:'no-cors', así
//     que no podía leer la respuesta y SIEMPRE decía "✓ Retiro guardado",
//     incluso cuando el guardado fallaba. Este endpoint es del mismo origen y
//     devuelve el registro guardado; la vista muestra el error si lo hay.
//
//  ---------------------------------------------------------------------------
//  VARIABLES DE ENTORNO
//  ---------------------------------------------------------------------------
//    BLOB_CONNECTION_STRING   (requerida) la misma de clientes-store
//    RETIROS_CONTAINER        (opc. 'redtec-store')
//    RETIROS_EDIT_ROLES       (opc. 'admin,logistica,retiros')   registrar
//    RETIROS_OFICINA_ROLES    (opc. 'admin,logistica')           ver todo / editar ajeno
//    RETIROS_MAX_RESPALDOS    (opc. 30) respaldos que se conservan por mes
//    RETIROS_DIAS_ATRAS       (opc. 90) tope para fechas de retiro pasadas
//    RETIROS_DIAS_ADELANTE    (opc. 180) tope para fechas programadas
// ============================================================================

const { BlobServiceClient } = require('@azure/storage-blob');

const CONN       = process.env.BLOB_CONNECTION_STRING;
const CONTAINER  = process.env.RETIROS_CONTAINER || 'redtec-store';
const PREFIJO    = 'retiros';
const RESPALDOS  = 'respaldos/retiros';
const REINTENTOS = 5;

const PLANTAS  = ['REDTEC SANTIAGO', 'REDTEC TALCA'];
const HORARIOS = ['AM', 'PM'];

// Campos que el cliente puede mandar al crear. Todo lo que no esté acá se
// descarta en silencio; los de servidor (id, creado, usuario…) se ignoran si
// vienen, para que nadie se atribuya un registro ajeno.
const CAMPOS_CLIENTE = [
  'ref',                                   // llave de idempotencia del cliente
  'clave', 'recinto', 'cadena', 'retail_legal',
  'fecha_retiro', 'horario', 'cantidad', 'dispersos', 'planta', 'observaciones',
  'direccion', 'comuna', 'region', 'zona',
];
// Lo que se puede cambiar después. El recinto no: si se equivocaron de bodega
// se elimina y se registra de nuevo, así no queda un registro cuya dirección
// ya no corresponde al recinto.
const CAMPOS_EDITABLES = ['fecha_retiro', 'horario', 'cantidad', 'dispersos', 'planta', 'observaciones'];

const LARGOS = {
  ref: 40,
  clave: 80, recinto: 160, cadena: 120, retail_legal: 120,
  observaciones: 500, direccion: 200, comuna: 80, region: 60, zona: 60,
};

// ---------------------------------------------------------------------------
//  Fechas en hora de Chile
//  No se usa toISOString(): convierte a UTC y en Chile, pasadas las ~21:00,
//  "hoy" sale como mañana. Es el mismo bug que ya apareció en
//  transportes-tiempos y transportes-pagos.
// ---------------------------------------------------------------------------
const FMT_CL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
});
function hoyCL() { return FMT_CL.format(new Date()); }          // YYYY-MM-DD
function esISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function diasEntre(a, b) {                                      // b - a, en días
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function fechaValida(s) {
  if (!esISO(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function mesDe(iso) { return iso.slice(0, 7); }
function mesesDelRango(desde, hasta) {
  const out = [];
  let [y, m] = desde.split('-').slice(0, 2).map(Number);
  const [hy, hm] = hasta.split('-').slice(0, 2).map(Number);
  // tope duro: 24 meses, para que un rango absurdo no dispare 700 lecturas
  while ((y < hy || (y === hy && m <= hm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Blob
// ---------------------------------------------------------------------------
function contenedor() {
  return BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER);
}
function blobMes(mes) { return `${PREFIJO}/${mes}.json`; }
function esNoExiste(e) {
  return e && (e.statusCode === 404 || e.code === 'BlobNotFound' || e.details?.errorCode === 'BlobNotFound');
}
async function aTexto(readable) {
  const p = [];
  for await (const c of readable) p.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(p).toString('utf8');
}

// Devuelve { registros, etag }. etag null = el blob todavía no existe.
async function leerMes(mes) {
  try {
    const blob = contenedor().getBlockBlobClient(blobMes(mes));
    const r = await blob.download();
    const txt = await aTexto(r.readableStreamBody);
    let arr = [];
    try { const p = JSON.parse(txt); arr = Array.isArray(p) ? p : []; } catch { arr = []; }
    return { registros: arr, etag: r.etag, crudo: txt };
  } catch (e) {
    if (esNoExiste(e)) return { registros: [], etag: null, crudo: null };
    throw e;
  }
}

// Escribe con ifMatch. Devuelve false si otro escribió primero (412).
async function escribirMes(mes, registros, etag) {
  const cont = contenedor();
  await cont.createIfNotExists();
  const body = JSON.stringify(registros, null, 2);
  const opts = {
    blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
  };
  try {
    await cont.getBlockBlobClient(blobMes(mes)).upload(body, Buffer.byteLength(body), opts);
    return true;
  } catch (e) {
    if (e && (e.statusCode === 412 || e.statusCode === 409)) return false;  // alguien más escribió
    throw e;
  }
}

function sello() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function respaldar(mes, crudo, log) {
  if (crudo == null) return null;                    // nada que respaldar aún
  try {
    const id = `${RESPALDOS}/${mes}/${sello()}.json`;
    await contenedor().getBlockBlobClient(id)
      .upload(crudo, Buffer.byteLength(crudo),
        { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
    return id;
  } catch (e) {
    log.error('retiros-store: falló el respaldo de ' + mes + ': ' + (e && e.message));
    return null;                                     // el respaldo no bloquea el guardado
  }
}

async function listarRespaldos(mes) {
  const out = [];
  for await (const b of contenedor().listBlobsFlat({ prefix: `${RESPALDOS}/${mes}/` })) {
    out.push({ id: b.name, modificado: b.properties.lastModified, bytes: b.properties.contentLength || 0 });
  }
  out.sort((a, b) => (a.id < b.id ? 1 : -1));        // el nombre lleva el sello, ordena solo
  return out;
}

async function podarRespaldos(mes, log) {
  try {
    const max = Number(process.env.RETIROS_MAX_RESPALDOS || 30);
    const sobran = (await listarRespaldos(mes)).slice(max);
    for (const b of sobran) await contenedor().getBlockBlobClient(b.id).deleteIfExists();
    if (sobran.length) log.info(`retiros-store: podados ${sobran.length} respaldos de ${mes}`);
  } catch (e) {
    log.error('retiros-store: falló la poda: ' + (e && e.message));
  }
}

// ---------------------------------------------------------------------------
//  Identidad y roles (SWA)
// ---------------------------------------------------------------------------
function principal(req) {
  const h = req.headers || {};
  const b64 = h['x-ms-client-principal'] || h['X-MS-CLIENT-PRINCIPAL'];
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { return null; }
}
function roles(p) { return ((p && p.userRoles) || []).map(r => String(r).toLowerCase()); }
function lista(env, def) {
  return (process.env[env] || def).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function puedeRegistrar(p) {
  return roles(p).some(r => lista('RETIROS_EDIT_ROLES', 'admin,logistica,retiros').includes(r));
}
function esOficina(p) {
  return roles(p).some(r => lista('RETIROS_OFICINA_ROLES', 'admin,logistica').includes(r));
}
function quien(p) { return (p && (p.userDetails || p.userId)) || 'anónimo'; }

// ---------------------------------------------------------------------------
//  Validación
// ---------------------------------------------------------------------------
function limpiaTexto(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}
function entero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

// Devuelve { ok:true, campos } o { ok:false, error }
function validar(entrada, parcial) {
  const campos = {};
  const permitidos = parcial ? CAMPOS_EDITABLES : CAMPOS_CLIENTE;
  for (const k of permitidos) {
    if (!(k in entrada)) continue;
    campos[k] = entrada[k];
  }
  if (parcial && Object.keys(campos).length === 0) {
    return { ok: false, error: 'no mandaste ningún campo editable' };
  }

  // textos
  for (const [k, max] of Object.entries(LARGOS)) {
    if (k in campos) campos[k] = limpiaTexto(campos[k], max);
  }

  // obligatorios al crear
  if (!parcial) {
    for (const [k, etiqueta] of [['clave', 'Recinto'], ['recinto', 'Recinto'],
      ['fecha_retiro', 'Fecha de retiro'], ['planta', 'Planta de destino']]) {
      if (!campos[k]) return { ok: false, error: `falta ${etiqueta}` };
    }
    if (campos.cantidad === undefined || campos.cantidad === '') {
      return { ok: false, error: 'falta Pallets para retiro' };
    }
  }

  // fecha
  if ('fecha_retiro' in campos) {
    const f = campos.fecha_retiro;
    if (!fechaValida(f)) return { ok: false, error: 'la fecha de retiro no es una fecha válida (YYYY-MM-DD)' };
    const hoy = hoyCL();
    const atras = Number(process.env.RETIROS_DIAS_ATRAS || 90);
    const adelante = Number(process.env.RETIROS_DIAS_ADELANTE || 180);
    const d = diasEntre(hoy, f);
    if (d < -atras) return { ok: false, error: `la fecha de retiro está más de ${atras} días en el pasado` };
    if (d > adelante) return { ok: false, error: `la fecha de retiro está más de ${adelante} días en el futuro` };
  }

  // horario
  if ('horario' in campos) {
    const h = String(campos.horario || '').toUpperCase().trim();
    if (!HORARIOS.includes(h)) return { ok: false, error: 'el horario debe ser AM o PM' };
    campos.horario = h;
  }

  // cantidades
  for (const k of ['cantidad', 'dispersos']) {
    if (!(k in campos)) continue;
    if (campos[k] === '' || campos[k] == null) { campos[k] = 0; continue; }
    const n = entero(campos[k]);
    if (!Number.isFinite(n)) return { ok: false, error: `${k} tiene que ser un número` };
    if (n < 0) return { ok: false, error: `${k} no puede ser negativo` };
    if (n > 10000) return { ok: false, error: `${k}: ${n} pallets no es una cantidad razonable, revisa el dato` };
    campos[k] = n;
  }

  // planta
  if ('planta' in campos) {
    const permitidas = (process.env.RETIROS_PLANTAS || PLANTAS.join(',')).split(',').map(s => s.trim());
    if (!permitidas.includes(campos.planta)) {
      return { ok: false, error: `planta de destino no reconocida (${permitidas.join(' / ')})` };
    }
  }

  return { ok: true, campos };
}

function nuevoId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
//  Operaciones con reintento por conflicto de escritura
// ---------------------------------------------------------------------------
// fn(registros) -> { registros, resultado } | { error }
async function mutarMes(mes, fn, log, conRespaldo) {
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    const { registros, etag, crudo } = await leerMes(mes);
    const r = fn(registros.slice());
    if (r.error) return { error: r.error, status: r.status || 400 };

    // un reenvío idempotente no cambia nada: no se respalda ni se reescribe
    if (r.idempotente) return { resultado: r.resultado, total: r.registros.length, idempotente: true };

    if (conRespaldo) await respaldar(mes, crudo, log);
    if (await escribirMes(mes, r.registros, etag)) {
      if (conRespaldo) await podarRespaldos(mes, log);
      return { resultado: r.resultado, total: r.registros.length };
    }
    log.warn(`retiros-store: conflicto de escritura en ${mes}, intento ${intento}/${REINTENTOS}`);
    await new Promise(s => setTimeout(s, 80 * intento + Math.random() * 120));
  }
  return { error: 'el almacén está recibiendo varios guardados a la vez; reintenta en unos segundos', status: 503 };
}

// Busca un registro por id. No se recibe el mes del cliente para eliminar o
// editar: si el registro cambió de mes (se corrigió la fecha) el mes que
// manda el cliente puede estar equivocado y el registro quedaría duplicado.
async function ubicar(id, mesSugerido) {
  const candidatos = [];
  if (mesSugerido && /^\d{4}-\d{2}$/.test(mesSugerido)) candidatos.push(mesSugerido);
  const hoy = hoyCL();
  let [y, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
  for (let i = -6; i <= 6; i++) {                     // ventana de ±6 meses
    let mm = m + i, yy = y;
    while (mm < 1) { mm += 12; yy--; }
    while (mm > 12) { mm -= 12; yy++; }
    const k = `${yy}-${String(mm).padStart(2, '0')}`;
    if (!candidatos.includes(k)) candidatos.push(k);
  }
  for (const mes of candidatos) {
    const { registros } = await leerMes(mes);
    if (registros.some(r => r.id === id)) return mes;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------
module.exports = async function (context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const responder = (status, body) => { context.res = { status, headers, body: JSON.stringify(body) }; };
  const log = context.log;

  if (req.method === 'OPTIONS') { context.res = { status: 204, headers }; return; }

  try {
    if (!CONN) throw new Error('Falta BLOB_CONNECTION_STRING en la configuración de la app.');
    const p = principal(req);
    if (!p) return responder(401, { error: 'sesión no válida' });

    // ----------------------------------------------------------- GET
    if (req.method === 'GET') {
      const q = req.query || {};

      if (q.respaldos) {
        if (!esOficina(p)) return responder(403, { error: 'solo oficina puede ver los respaldos' });
        const mes = String(q.respaldos);
        if (!/^\d{4}-\d{2}$/.test(mes)) return responder(400, { error: 'respaldos=YYYY-MM' });
        return responder(200, { mes, respaldos: await listarRespaldos(mes) });
      }

      const hoy = hoyCL();
      const desde = esISO(q.desde) ? q.desde : hoy;
      const hasta = esISO(q.hasta) ? q.hasta : desde;
      if (hasta < desde) return responder(400, { error: 'el rango está invertido' });

      const meses = mesesDelRango(mesDe(desde), mesDe(hasta));
      let registros = [];
      const fallidos = [];
      for (const mes of meses) {
        try {
          const { registros: rs } = await leerMes(mes);
          registros = registros.concat(rs);
        } catch (e) {
          // Un mes que no responde NO se puede leer como "ese mes no hubo
          // nada": se informa aparte para que la vista lo diga.
          fallidos.push(mes);
          log.error(`retiros-store: no se pudo leer ${mes}: ${e && e.message}`);
        }
      }
      registros = registros.filter(r => r && r.fecha_retiro >= desde && r.fecha_retiro <= hasta);

      // Un ejecutivo ve solo lo suyo; oficina ve todo.
      const todo = esOficina(p);
      if (!todo) {
        const yo = String(quien(p)).toLowerCase();
        registros = registros.filter(r => String(r.usuario || '').toLowerCase() === yo);
      }
      registros.sort((a, b) => (b.fecha_retiro || '').localeCompare(a.fecha_retiro || '') ||
                               (b.creado || '').localeCompare(a.creado || ''));

      return responder(200, {
        registros,
        meta: {
          desde, hasta, hoy, meses, total: registros.length,
          alcance: todo ? 'todos' : 'propios',
          usuario: quien(p), oficina: todo, puede_registrar: puedeRegistrar(p),
          meses_sin_respuesta: fallidos,
        },
      });
    }

    // ---------------------------------------------------------- POST
    if (req.method !== 'POST') return responder(405, { error: 'método no permitido' });

    const cuerpo = req.body || {};
    const accion = String(cuerpo.accion || 'agregar');

    // -- agregar --------------------------------------------------------
    if (accion === 'agregar') {
      if (!puedeRegistrar(p)) {
        log.warn(`retiros-store: registro rechazado para ${quien(p)} (roles: ${roles(p).join('|') || 'ninguno'})`);
        return responder(403, { error: 'no tienes permiso para registrar retiros. Pídele el rol al administrador.' });
      }
      const v = validar(cuerpo.registro || {}, false);
      if (!v.ok) return responder(400, { error: v.error });

      const rec = Object.assign({}, v.campos, {
        id: nuevoId(),
        creado: new Date().toISOString(),
        usuario: quien(p),
        usuario_roles: roles(p),
      });
      if (rec.dispersos === undefined) rec.dispersos = 0;

      const mes = mesDe(rec.fecha_retiro);
      const r = await mutarMes(mes, (registros) => {
        // IDEMPOTENCIA. El cliente manda un 'ref' propio por cada retiro que
        // el ejecutivo guarda una vez. Si llega dos veces el mismo ref, es el
        // MISMO retiro reenviado, no dos retiros: se devuelve el que ya está.
        //
        // Pasa de verdad en terreno: el celular sube la cola de pendientes,
        // el POST llega al servidor pero la respuesta se pierde en el camino,
        // el celular lo da por fallido y lo reenvía. Sin esta llave quedaban
        // dos retiros del mismo recinto y se mandaba un camión de más.
        if (rec.ref) {
          const ya = registros.find(x => x.ref && x.ref === rec.ref);
          if (ya) return { registros, resultado: ya, idempotente: true };
        }
        // Aviso de duplicado: mismo recinto, misma fecha, mismo horario.
        // No se bloquea (puede haber dos camiones), pero se devuelve para
        // que la vista lo pregunte antes de dejarlo pasar.
        const dup = registros.find(x => x.clave === rec.clave &&
          x.fecha_retiro === rec.fecha_retiro && x.horario === rec.horario);
        if (dup && !cuerpo.confirmar_duplicado) {
          return { error: `ya hay un retiro de ${rec.recinto} para el ${rec.fecha_retiro} ${rec.horario} ` +
                          `(${dup.cantidad} pallets, ${dup.usuario}). Confirma si de verdad son dos.`,
                   status: 409 };
        }
        registros.push(rec);
        return { registros, resultado: rec };
      }, log, true);

      if (r.error) return responder(r.status, { error: r.error, duplicado: r.status === 409 });
      if (r.idempotente) {
        log.info(`retiros-store: ref repetido ${rec.ref}, se devuelve el registro ya guardado`);
        return responder(200, { ok: true, registro: r.resultado, mes, idempotente: true });
      }
      log.info(`retiros-store: ${quien(p)} registró ${rec.recinto} ${rec.fecha_retiro} ${rec.horario} (${rec.cantidad} pallets)`);
      return responder(200, { ok: true, registro: r.resultado, mes, total_mes: r.total });
    }

    // -- editar ---------------------------------------------------------
    if (accion === 'editar') {
      const id = String(cuerpo.id || '');
      if (!id) return responder(400, { error: 'falta el id' });
      const v = validar(cuerpo.cambios || {}, true);
      if (!v.ok) return responder(400, { error: v.error });

      const mes = await ubicar(id, cuerpo.mes);
      if (!mes) return responder(404, { error: 'ese registro ya no existe' });

      // Si la fecha nueva cae en otro mes, el registro cambia de blob: se
      // hace como eliminar + agregar para no dejarlo duplicado en los dos.
      const mesDestino = v.campos.fecha_retiro ? mesDe(v.campos.fecha_retiro) : mes;

      let sacado = null;
      const r1 = await mutarMes(mes, (registros) => {
        const i = registros.findIndex(x => x.id === id);
        if (i < 0) return { error: 'ese registro ya no existe', status: 404 };
        const actual = registros[i];
        if (!esOficina(p) && String(actual.usuario || '').toLowerCase() !== String(quien(p)).toLowerCase()) {
          return { error: 'solo puedes editar los retiros que registraste tú', status: 403 };
        }
        const actualizado = Object.assign({}, actual, v.campos, {
          editado: { por: quien(p), cuando: new Date().toISOString() },
        });
        if (mesDestino !== mes) { sacado = actualizado; registros.splice(i, 1); }
        else { registros[i] = actualizado; }
        return { registros, resultado: actualizado };
      }, log, true);
      if (r1.error) return responder(r1.status, { error: r1.error });

      if (mesDestino !== mes && sacado) {
        const r2 = await mutarMes(mesDestino, (registros) => {
          registros.push(sacado);
          return { registros, resultado: sacado };
        }, log, true);
        if (r2.error) {
          // Se saca de un mes y no entra en el otro: hay que decirlo, no
          // dejar que el registro desaparezca en silencio.
          log.error(`retiros-store: ${id} salió de ${mes} y NO entró en ${mesDestino}: ${r2.error}`);
          return responder(500, {
            error: 'la fecha se cambió de mes y el registro no alcanzó a guardarse en el mes nuevo. ' +
                   'Está en el respaldo de ' + mes + '; avísale a TI antes de volver a registrarlo.',
          });
        }
      }
      log.info(`retiros-store: ${quien(p)} editó ${id} (${mes}${mesDestino !== mes ? ' -> ' + mesDestino : ''})`);
      return responder(200, { ok: true, registro: r1.resultado, mes: mesDestino });
    }

    // -- eliminar -------------------------------------------------------
    if (accion === 'eliminar') {
      const id = String(cuerpo.id || '');
      if (!id) return responder(400, { error: 'falta el id' });
      const mes = await ubicar(id, cuerpo.mes);
      if (!mes) return responder(404, { error: 'ese registro ya no existe' });

      const r = await mutarMes(mes, (registros) => {
        const i = registros.findIndex(x => x.id === id);
        if (i < 0) return { error: 'ese registro ya no existe', status: 404 };
        if (!esOficina(p) && String(registros[i].usuario || '').toLowerCase() !== String(quien(p)).toLowerCase()) {
          return { error: 'solo puedes eliminar los retiros que registraste tú', status: 403 };
        }
        const fuera = registros.splice(i, 1)[0];
        return { registros, resultado: fuera };
      }, log, true);

      if (r.error) return responder(r.status, { error: r.error });
      log.info(`retiros-store: ${quien(p)} eliminó ${id} de ${mes}`);
      return responder(200, { ok: true, eliminado: r.resultado, mes, total_mes: r.total });
    }

    // -- restaurar ------------------------------------------------------
    if (accion === 'restaurar') {
      if (!esOficina(p)) return responder(403, { error: 'solo oficina puede restaurar respaldos' });
      const mes = String(cuerpo.mes || '');
      const id = String(cuerpo.respaldo || '');
      if (!/^\d{4}-\d{2}$/.test(mes)) return responder(400, { error: 'mes inválido' });
      if (!id.startsWith(`${RESPALDOS}/${mes}/`) || id.includes('..')) {
        return responder(400, { error: 'identificador de respaldo inválido' });
      }
      let datos;
      try {
        const r = await contenedor().getBlockBlobClient(id).download();
        datos = JSON.parse(await aTexto(r.readableStreamBody));
        if (!Array.isArray(datos)) throw new Error('el respaldo no es un array');
      } catch (e) {
        if (esNoExiste(e)) return responder(404, { error: 'ese respaldo ya no existe' });
        return responder(400, { error: 'no se pudo leer el respaldo: ' + (e && e.message) });
      }
      const r = await mutarMes(mes, () => ({ registros: datos, resultado: datos.length }), log, true);
      if (r.error) return responder(r.status, { error: r.error });
      log.info(`retiros-store: ${quien(p)} restauró ${mes} desde ${id} (${datos.length} registros)`);
      return responder(200, { ok: true, mes, restaurado: id, count: datos.length });
    }

    return responder(400, { error: 'acción desconocida: ' + accion });

  } catch (e) {
    context.log.error('retiros-store error: ' + (e && e.message));
    return responder(500, { error: String((e && e.message) || e) });
  }
};
