// ============================================================================
//  api/pendientes-cruce
//
//  GET   devuelve las citas que todavía no cruzan, por cliente.
//  POST  recibe el resultado de un cruce: las que aparecieron sin transferencia
//        ('vista'), las que por fin la encontraron ('cruzo') y las que alguien
//        cierra a mano ('cerrada'). Devuelve el estado ya recalculado.
//
//  Por qué POST y no PUT/DELETE: esto es una bitácora, no una tabla. Nada se
//  edita ni se borra — se escribe un evento encima y el estado vigente es el
//  último de la cadena. Así se puede reconstruir qué se supo y cuándo.
//
//  El POST NO decide nada sobre Redlink: el cruce lo hizo el navegador con el
//  mismo módulo que usan las pruebas, y acá sólo se anota el resultado. Por eso
//  los campos se acotan y se validan como lo que son — texto que llegó de
//  afuera y va a un archivo que después alguien lee como si fuera verdad.
// ============================================================================
'use strict';

const pend = require('../shared/pendientes-cruce.js');

const ROLES = ['admin', 'logistica', 'jefatura'];
const MAX_EVENTOS = 500;

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

function eventosDe(cuerpo, nombre) {
  const c = cuerpo || {};
  const archivo = c.archivo;
  const out = [];
  const sumar = (lista, accion) => {
    (Array.isArray(lista) ? lista : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      out.push(Object.assign({}, x, { accion: accion, archivo: archivo, quien: nombre }));
    });
  };
  sumar(c.vistas, 'vista');
  sumar(c.cruzadas, 'cruzo');
  sumar(c.cerradas, 'cerrada');
  return out.slice(0, MAX_EVENTOS);
}

async function responder(hoy) {
  const estados = await pend.leerEstado(hoy);
  const abiertas = pend.abiertas(estados);
  return {
    almacenamiento: true,
    diasParaPreguntar: pend.DIAS_PARA_PREGUNTAR,
    abiertas: abiertas.length,
    pallets: abiertas.reduce(function (a, e) { return a + (e.pallets || 0); }, 0),
    urgentes: abiertas.filter(function (e) { return e.urgente; }).length,
    citas: abiertas,
    clientes: pend.porCliente(estados)
  };
}

module.exports = async function (context, req) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const salir = (status, cuerpo) => { context.res = { status: status, headers: cab, body: cuerpo }; };

  if (req.method === 'OPTIONS') return salir(204, '');

  const q = quien(req);
  if (!q.roles.some(r => ROLES.indexOf(r) >= 0)) {
    return salir(403, { error: 'no tienes permiso para ver las citas pendientes de cruce' });
  }

  if (!pend.hayStorage()) {
    // No es "no hay pendientes": es que no se están guardando. Confundir las
    // dos cosas haría creer que está todo cruzado.
    return salir(200, { almacenamiento: false, abiertas: 0, pallets: 0, urgentes: 0,
      citas: [], clientes: [], diasParaPreguntar: pend.DIAS_PARA_PREGUNTAR,
      aviso: 'el api no tiene almacenamiento configurado: las citas sin cruce no se están guardando' });
  }

  const hoy = new Date().toISOString().slice(0, 10);
  try {
    if (req.method === 'POST') {
      const evs = eventosDe(req.body, q.nombre);
      const r = await pend.registrar(evs);
      const estado = await responder(hoy);
      // Un fallo al guardar NO se esconde, pero tampoco tumba la respuesta: el
      // cruce ya se mostró en pantalla y la persona ya está trabajando con él.
      if (!r.ok) estado.aviso = 'no se pudo guardar el seguimiento: ' + r.motivo;
      estado.guardados = r.escritos;
      return salir(200, estado);
    }
    return salir(200, await responder(hoy));
  } catch (e) {
    context.log.error('pendientes-cruce: ' + ((e && e.message) || e));
    return salir(502, { error: 'no se pudo leer las citas pendientes; revisar el log de la función' });
  }
};
