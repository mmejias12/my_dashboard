// ============================================================================
//  api/pf-estado
//
//  POR QUÉ EXISTE. El endpoint de PF descarta en silencio una PF_CLAVES mal
//  formada: para servir pedidos eso es lo correcto —no se le cuenta a nadie por
//  qué falló una clave— pero deja a quien configura sin forma de distinguir
//  "la clave está mal puesta" de "la clave es otra". Las dos se ven igual: 401.
//
//  Esto lo explica, y por eso va detrás del rol admin y NUNCA muestra una clave.
//  Lo que sí muestra es la HUELLA: los primeros 12 caracteres del sha256. Quien
//  configura puede calcular la misma huella de la clave que está mandando y
//  compararlas, sin que ninguna de las dos viaje.
//
//    PowerShell:
//      $k = "<la clave que mandas>"
//      $h = [System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($k))
//      ([BitConverter]::ToString($h) -replace '-','').ToLower().Substring(0,12)
// ============================================================================
'use strict';

const llaves = require('../shared/pf-llaves.js');
const escritura = require('../shared/pf-escritura.js');
const bit = require('../shared/pf-bitacora.js');

const ROLES = ['admin'];

function quien(req) {
  const b64 = (req.headers && (req.headers['x-ms-client-principal'] ||
                               req.headers['X-MS-CLIENT-PRINCIPAL'])) || '';
  if (!b64) return { nombre: '', roles: [] };
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return { nombre: String(p.userDetails || p.userId || ''),
             roles: Array.isArray(p.userRoles) ? p.userRoles.map(String) : [] };
  } catch (e) { return { nombre: '', roles: [] }; }
}

module.exports = async function (context, req) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cab, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');

  const q = quien(req);
  if (!q.roles.some(r => ROLES.indexOf(r) >= 0)) {
    return salir(403, { error: 'sólo admin puede ver el estado de la integración de PF' });
  }

  const falta = escritura.faltantes();
  const diag = llaves.diagnostico();

  return salir(200, {
    claves: diag,
    credenciales: {
      ok: falta.length === 0,
      faltan: falta,
      // Saber contra qué ambiente escribe es la mitad de cualquier diagnóstico.
      redlink: escritura.API_BASE,
      esDemo: /^https:\/\/apidemo\./i.test(String(escritura.API_BASE || ''))
    },
    bitacora: {
      almacenamiento: bit.hayStorage(),
      contenedor: bit.hayStorage() ? bit.CONTAINER : ''
    },
    listoParaRecibir: diag.ok && falta.length === 0
  });
};
