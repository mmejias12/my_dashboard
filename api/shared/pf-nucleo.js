// ============================================================================
//  api/shared/pf-nucleo.js  ·  Relocalizaciones de PF — las reglas, sin red
//
//  POR QUÉ EXISTE. PF (Productos Fernández) crea relocalizaciones llamando a un
//  API que hoy provee M2LINK. M2LINK muere, así que el m3link tiene que dar esa
//  continuidad. Este archivo tiene TODO lo que se decide, y nada de lo que se
//  conversa por la red: así las reglas se pueden probar de verdad.
//
//  CONTINUIDAD. El payload que entra es el MISMO que PF manda hoy
//  (OperacionId, ServicioId, Cantidad plana…). Acá se traduce al formHeader
//  nativo de Redlink, que es otra forma: la cantidad vive en formDdetalles y
//  los campos se llaman distinto. PF cambia la URL y la autenticación, nada más.
//
//  LO QUE NO SE LE CREE AL LLAMADOR. El cliente, las bodegas y el usuario que
//  firma NO salen del mensaje: salen de la identidad de la llave de API. Un
//  cliente no puede crear documentos a nombre de otro ni siquiera equivocándose,
//  y `ModoProduccion` —que en el API viejo viajaba en el cuerpo y decidía si se
//  escribía en Demo o en Producción— se acepta y se ignora: eso lo fija el
//  ambiente del servidor, no quien llama.
//
//  IDEMPOTENCIA. La llave natural es bpId + documentoId + documentoNumero,
//  porque Redlink ya exige que el número de documento no se repita. Acá vive
//  sólo la DECISIÓN (devolver lo que ya existe, resolver una duda, escribir o
//  rechazar); la bitácora y la red van aparte.
// ============================================================================
'use strict';

// Relocalización y nada más. Este endpoint es "netamente para relocalizaciones":
// si algún día entra otra transacción, tiene que salir nombrada como rechazo y
// no colarse con los ids de otra cosa.
const FORM_ID = 5;
const SERVICIO_ID = 19;
const ITEMS_ID = 1;                 // siempre 1, por contrato de Redlink
const CANTIDAD_MAX = Math.max(1, parseInt(process.env.PF_CANTIDAD_MAX || '540', 10) || 540);
const OBSERVACION_MAX = 250;

function entero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.floor(n) === n ? n : null;
}
function texto(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || OBSERVACION_MAX);
}

// La llave de idempotencia. Va con el bpId de la IDENTIDAD, no con el que
// mandaron: si no, dos clientes podrían pisarse el mismo número de documento.
function llaveDe(bpId, documentoId, documentoNumero) {
  return [entero(bpId), entero(documentoId), entero(documentoNumero)].join('|');
}

// Qué campos del payload definen la INTENCIÓN. Si la llave se repite pero algo
// de esto cambió, no es un reintento: es un número de documento reutilizado por
// error, y devolver el folio viejo lo convertiría en silencio en "ya está hecho".
const CAMPOS_INTENCION = ['bodegaOrigenId', 'bodegaDestinoId', 'cantidad', 'documentoId', 'documentoNumero'];

// El payload de PF llega con los nombres del API viejo. Se acepta en cualquiera
// de las dos grafías porque C# las serializa con mayúscula inicial y JavaScript
// con minúscula, y PF no tiene por qué cambiar su cliente para eso.
function leer(cuerpo, nombre) {
  const c = cuerpo || {};
  const alto = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  return (c[nombre] !== undefined) ? c[nombre] : c[alto];
}

function normalizar(cuerpo) {
  return {
    operacionId:      entero(leer(cuerpo, 'operacionId')),
    servicioId:       entero(leer(cuerpo, 'servicioId')),
    bodegaOrigenId:   entero(leer(cuerpo, 'bodegaOrigenId')),
    bodegaDestinoId:  entero(leer(cuerpo, 'bodegaDestinoId')),
    documentoId:      entero(leer(cuerpo, 'documentoId')),
    documentoNumero:  entero(leer(cuerpo, 'documentoNumero')),
    cantidad:         entero(leer(cuerpo, 'cantidad')),
    observacionOrigen: texto(leer(cuerpo, 'observacionOrigen')),
    // Se leen para poder AVISAR que se ignoran, no para usarlos.
    clienteOrigenIdPedido:  entero(leer(cuerpo, 'clienteOrigenId')),
    clienteDestinoIdPedido: entero(leer(cuerpo, 'clienteDestinoId')),
    modoProduccionPedido:   leer(cuerpo, 'modoProduccion')
  };
}

// `bodegas` son las del cliente, traídas de /api/Bodega/cliente/{bpId}. Se pasan
// como argumento para que esto siga sin red: quien las trae es la capa de arriba.
function validar(p, identidad, bodegas) {
  const id = identidad || {};
  const problemas = [];
  const suyas = {};
  (bodegas || []).forEach(function (b) {
    const n = entero(b && (b.bodegaiD !== undefined ? b.bodegaiD : b.bodegaId));
    if (n !== null) suyas[n] = (b && (b.bodegaCliente || b.nombreBodega)) || '';
  });

  if (p.operacionId !== null && p.operacionId !== FORM_ID) {
    problemas.push('este endpoint sólo crea relocalizaciones (operacionId ' + FORM_ID +
                   '), y vino ' + p.operacionId);
  }
  if (p.servicioId !== null && p.servicioId !== SERVICIO_ID) {
    problemas.push('la relocalización usa el servicio ' + SERVICIO_ID + ', y vino ' + p.servicioId);
  }
  if (p.documentoId === null || p.documentoId <= 0) problemas.push('falta documentoId');
  if (p.documentoNumero === null || p.documentoNumero <= 0) problemas.push('falta documentoNumero');
  if (p.cantidad === null || p.cantidad <= 0) {
    problemas.push('la cantidad tiene que ser un entero mayor que cero');
  } else if (p.cantidad > CANTIDAD_MAX) {
    problemas.push('la cantidad máxima por documento es ' + CANTIDAD_MAX + ' y vinieron ' + p.cantidad);
  }
  if (p.bodegaOrigenId === null)  problemas.push('falta bodegaOrigenId');
  if (p.bodegaDestinoId === null) problemas.push('falta bodegaDestinoId');
  if (p.bodegaOrigenId !== null && p.bodegaOrigenId === p.bodegaDestinoId) {
    problemas.push('la bodega de origen y la de destino son la misma (' + p.bodegaOrigenId + ')');
  }
  // Las bodegas se validan contra las del cliente, no contra lo que diga el
  // mensaje. Sin esto, un número cualquiera mandaría pallets a otra empresa.
  if (bodegas && bodegas.length) {
    [['bodegaOrigenId', p.bodegaOrigenId], ['bodegaDestinoId', p.bodegaDestinoId]].forEach(function (par) {
      if (par[1] !== null && !(par[1] in suyas)) {
        problemas.push('la ' + par[0] + ' ' + par[1] + ' no es una bodega de este cliente');
      }
    });
  } else {
    problemas.push('no se pudo verificar que las bodegas sean del cliente');
  }
  if (!id.bpId) problemas.push('la llave de API no tiene cliente asociado');
  if (!id.usuarioIngresoId) problemas.push('la llave de API no tiene usuario de firma asociado');

  // Avisos: no impiden nada, pero quedan en la respuesta para que PF sepa que
  // mandó algo que no se usó, en vez de creer que surtió efecto.
  const avisos = [];
  if (p.modoProduccionPedido !== undefined && p.modoProduccionPedido !== null) {
    avisos.push('modoProduccion se ignora: el ambiente lo fija el servidor');
  }
  [['clienteOrigenId', p.clienteOrigenIdPedido], ['clienteDestinoId', p.clienteDestinoIdPedido]]
    .forEach(function (par) {
      if (par[1] !== null && par[1] !== id.bpId) {
        avisos.push(par[0] + ' ' + par[1] + ' se ignora: se usa el cliente de la llave (' + id.bpId + ')');
      }
    });

  return { ok: problemas.length === 0, problemas: problemas, avisos: avisos };
}

// La traducción al formHeader nativo. El cliente, las bodegas ya validadas y el
// usuario que firma salen de la identidad; la cantidad baja a formDdetalles.
function aFormHeader(p, identidad) {
  const id = identidad || {};
  const cuerpo = {
    formId: FORM_ID,
    bpId: id.bpId,
    servicioId: SERVICIO_ID,
    usuarioIngresoId: id.usuarioIngresoId,
    bpOrigenId: id.bpId,
    bodegaOrigenId: p.bodegaOrigenId,
    bpDestinoId: id.bpId,          // en relocalización el cliente es el mismo
    bodegaDestinoId: p.bodegaDestinoId,
    documentoId: p.documentoId,
    documentoNumero: p.documentoNumero,
    formDdetalles: [{ itemsId: ITEMS_ID, cantidad: p.cantidad }]
  };
  if (p.observacionOrigen) cuerpo.observacionOrigen = p.observacionOrigen;
  return cuerpo;
}

function huellaDe(p) {
  const out = {};
  CAMPOS_INTENCION.forEach(function (k) { out[k] = p[k]; });
  return out;
}
function mismaIntencion(previo, p) {
  const a = (previo && previo.huella) || {};
  const b = huellaDe(p);
  return CAMPOS_INTENCION.every(function (k) { return a[k] === b[k]; });
}

// LA DECISIÓN. Mirando sólo lo que ya sabemos de esta llave, ¿qué corresponde?
// La única rama que escribe es la que no tiene registro previo: por construcción
// no puede duplicar.
function decidir(previo, p) {
  if (!previo || !previo.estado) return { accion: 'escribir', motivo: '' };

  if (!mismaIntencion(previo, p)) {
    return { accion: 'conflicto',
             motivo: 'el documento ' + p.documentoNumero + ' ya se usó con otros datos' };
  }
  if (previo.estado === 'creado') {
    return { accion: 'devolver', folio: previo.folio,
             motivo: 'este documento ya se había creado' };
  }
  if (previo.estado === 'rechazado') {
    // Lo rechazó Redlink por su contenido: reintentar lo mismo vuelve a fallar,
    // pero no hay riesgo de duplicar, así que se deja pasar y que conteste él.
    return { accion: 'escribir', motivo: '' };
  }
  // 'intentando' o 'en-duda': hubo una escritura que no sabemos cómo terminó.
  // NUNCA se escribe acá: primero se va a mirar a Redlink.
  return { accion: 'resolver', motivo: 'un intento anterior quedó sin respuesta' };
}

// Qué contestarle a PF cuando la duda no se pudo resolver. Se separa para que
// el texto no se invente en dos lugares distintos.
function dudaSinResolver(p) {
  return 'no se sabe si el documento ' + p.documentoNumero + ' alcanzó a crearse en Redlink y ' +
         'no se volvió a intentar para no duplicarlo. Vuelve a llamar con los mismos datos: ' +
         'la próxima llamada lo resuelve.';
}

module.exports = {
  FORM_ID, SERVICIO_ID, ITEMS_ID, CANTIDAD_MAX, CAMPOS_INTENCION,
  entero, texto, leer, normalizar, llaveDe, validar, aFormHeader,
  huellaDe, mismaIntencion, decidir, dudaSinResolver
};
