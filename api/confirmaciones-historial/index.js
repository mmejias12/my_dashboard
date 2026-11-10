// ============================================================================
//  api/confirmaciones-historial  ·  GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//
//  Lee el historial de confirmaciones. SÓLO LEE: no hay ninguna ruta para
//  editar ni borrar un registro, y eso es a propósito — una confirmación
//  ocurrió, movió inventario en SAP, y un historial que se puede editar no
//  sirve para lo único que tiene que servir, que es responderle a un cliente.
//
//  Devuelve tres cosas sobre los mismos datos:
//    registros  la lista cruda del rango
//    dias       para pintar el calendario
//    clientes   el desglose que va al informe
//
//  Van juntas a propósito: si cada vista las agregara por su cuenta, dos
//  pantallas podrían mostrar números distintos del mismo día.
//
//  `almacenamiento: false` dice que no hay dónde guardar. Es la señal de salud
//  que hace falta ANTES de confirmar en masa: sin ella, la única forma de
//  enterarse es confirmar cincuenta y leer cincuenta avisos.
// ============================================================================
'use strict';

const historial = require('../shared/confirmaciones-registro.js');

const ROLES = ['admin', 'logistica', 'jefatura', 'comercial'];
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;

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

const dia = (d) => new Date(d + 'T00:00:00Z');
function diasEntre(a, b) { return Math.round((dia(b) - dia(a)) / 86400000) + 1; }

// Que tenga la FORMA de una fecha no la hace una fecha: '2026-13-40' pasa el
// patrón y después se compara como texto, así que el 13 de mes 40 salía
// rechazado por "el rango está al revés" — un mensaje que manda a mirar al
// lado equivocado. Se comprueba el viaje de ida y vuelta.
function esDiaReal(d) {
  if (!RE_DIA.test(d)) return false;
  const f = dia(d);
  return !isNaN(f.getTime()) && f.toISOString().slice(0, 10) === d;
}

// Por omisión, el mes corriente: es lo que la página pide al abrir.
function rangoDe(q) {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = String((q && q.desde) || '') || hoy.slice(0, 8) + '01';
  const hasta = String((q && q.hasta) || '') || hoy;
  if (!esDiaReal(desde) || !esDiaReal(hasta)) {
    return { error: 'desde y hasta tienen que venir como YYYY-MM-DD y ser fechas que existan' };
  }
  if (hasta < desde) return { error: 'el rango está al revés: ' + desde + ' a ' + hasta };
  // Un rango enorme lee muchos blobs y tarda; que se vea el límite en vez de
  // que la petición muera por tiempo sin decir por qué.
  if (diasEntre(desde, hasta) > MAX_DIAS) {
    return { error: 'el rango no puede pasar de ' + MAX_DIAS + ' días' };
  }
  return { desde: desde, hasta: hasta };
}

module.exports = async function (context, req) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cab, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');

  const q = quien(req);
  if (!q.roles.some(r => ROLES.indexOf(r) >= 0)) {
    return salir(403, { error: 'no tienes permiso para ver el historial de confirmaciones' });
  }

  const r = rangoDe(req.query || {});
  if (r.error) return salir(400, { error: r.error });

  if (!historial.hayStorage()) {
    // No es un error de quien pregunta: es que falta configuración. Se
    // distingue de "no hubo confirmaciones", que es una respuesta legítima.
    return salir(200, { almacenamiento: false, desde: r.desde, hasta: r.hasta,
      registros: [], dias: [], clientes: [],
      aviso: 'el api no tiene almacenamiento configurado: las confirmaciones no se están guardando' });
  }

  try {
    const registros = await historial.leerRango(r.desde, r.hasta);
    return salir(200, {
      almacenamiento: true, desde: r.desde, hasta: r.hasta,
      registros: registros,
      dias: historial.porDia(registros),
      clientes: historial.porCliente(registros)
    });
  } catch (e) {
    context.log.error('confirmaciones-historial: ' + ((e && e.message) || e));
    return salir(502, { error: 'no se pudo leer el historial; revisar el log de la función' });
  }
};
