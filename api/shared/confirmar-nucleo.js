// ============================================================================
//  api/shared/confirmar-nucleo.js
//
//  EL NÚCLEO PURO de la confirmación de transferencias de Walmart en Redlink.
//  Sin red, sin disco, sin process.argv: sólo las decisiones.
//
//  Vive bajo api/ porque Static Web Apps despliega SÓLO esa carpeta como
//  functions app: una función no puede requerir nada de scripts/ ni de data/.
//  Y lo requieren los dos lados —la función HTTP y scripts/confirmar-redlink.js—
//  justamente para que no haya dos implementaciones del mismo contrato. Ese fue
//  el error que nos costó ocho intentos en otra parte de este mismo problema.
//
//  El enmascarador se INYECTA. Sin él, revisarPreparado no muestra el cuerpo:
//  la función HTTP no tiene por qué devolverle al navegador lo que contestó
//  Redlink, y el script le pasa el de la sonda, que está probado aparte.
// ============================================================================
'use strict';

// El enmascarador se inyecta: sin uno, el cuerpo NO se muestra. Un
// enmascarador propio acá serían dos implementaciones del mismo filtro, y el
// día que una se arregle la otra sigue filtrando el token.
let _mascara = null;
function usarMascara(fn) { _mascara = (typeof fn === 'function') ? fn : null; }
function trozo(crudo) {
  if (!_mascara) return '(no se muestra el cuerpo: no se inyectó un enmascarador)';
  return _mascara(crudo).slice(0, 200);
}

const ETAPAS_CONFIRMABLES = [/pendiente\s+de\s+confirmaci/i, /pendiente\s+adjuntar\s+respaldo/i];
const etapaDe = (doc) => String((doc && doc.formMetapa && doc.formMetapa.nombre) || '');
const etapaConfirmable = (doc) => ETAPAS_CONFIRMABLES.some(re => re.test(etapaDe(doc)));

const esConfirmada = (doc) => {
  const det = (doc && doc.formDdetalles && doc.formDdetalles[0]) || {};
  const n = Number(det.recepcion) || 0;
  return n > 0 && !/^\s*pendiente/i.test(String((doc && doc.formMetapa && doc.formMetapa.nombre) || ''));
};


// Todo lo que tiene que ser cierto ANTES de escribir, junto y nombrado. Un
// solo problema detiene la operación: acá no hay "seguir con lo que se pueda".
//
// Lo que este plan YA NO hace es armar el cuerpo del PATCH. Lo armó durante
// ocho intentos y el servidor devolvió 400 las ocho veces: ese cuerpo lo arma
// el servidor en ConfirmarTransferencia y nosotros se lo devolvemos tal cual.
// Acá sólo se decide si corresponde pedirlo, y con qué número de usuario.
function planDeConfirmacion(doc, cantidad, usersId, origen) {
  const firma = (usersId === undefined || usersId === null) ? USERSID_M3LINK : Number(usersId);
  const problemas = [];
  if (!doc || typeof doc !== 'object') return { ok: false, problemas: ['no se pudo leer el documento'] };

  const det = (doc.formDdetalles || []).filter(d => d && typeof d === 'object');
  const desp = det.length ? Number(det[0].despachado) || 0 : 0;
  const n = Number(cantidad);

  // El número de usuario viaja en la URL: es lo que el servidor usa para saber
  // a nombre de quién preparar la confirmación. Sin él no hay nada que pedir.
  if (!(firma > 0)) problemas.push('no hay usersiD de ' + NOMBRE_M3LINK +
    ': sin ese número el servidor no sabe a nombre de quién preparar la confirmación');
  if (Number(doc.formId) !== 6) problemas.push('no es una transferencia (formId ' + doc.formId + ')');
  const destino = String(doc.bpDestinoNombre || '');
  if (!/walmart/i.test(destino)) problemas.push('el destino no es Walmart: ' + (destino || '(vacío)'));
  if (det.length !== 1) problemas.push('el documento tiene ' + det.length + ' líneas de detalle; esta versión confirma una');
  if (esConfirmada(doc)) problemas.push('la transferencia YA está confirmada');
  else if (!etapaConfirmable(doc)) problemas.push('la etapa es "' + (etapaDe(doc) || '(vacía)') +
    '" y las confirmables son "Pendiente de Confirmación" y "Pendiente Adjuntar Respaldo"');
  if (!Number.isFinite(n) || n <= 0) problemas.push('la cantidad a confirmar tiene que ser un número mayor que cero');
  else if (!desp) problemas.push('la línea no tiene cantidad despachada: no hay contra qué confirmar');
  else if (n > desp) problemas.push('se pide confirmar ' + n + ' y sólo se despacharon ' + desp);

  if (problemas.length) return { ok: false, problemas: problemas };

  // urlConfirmar vuelve a validar los tres números por su cuenta. Que una
  // excepción de armado de URL salga como problema del plan y no como un
  // reventón a mitad de camino.
  let url;
  try { url = urlConfirmar(doc.folio, n, firma, origen || ORIGEN); }
  catch (e) { return { ok: false, problemas: [(e && e.message) || String(e)] }; }

  return {
    ok: true,
    problemas: [],
    usersId: firma,
    origen: String(origen || ORIGEN),
    resumen: {
      folio: doc.folio, id: doc.formHeaderiD,
      cliente: doc.bpOrigenNombre, destino: doc.bpDestinoNombre,
      bodega: doc.bodegaDestinoNombre, etapa: (doc.formMetapa || {}).nombre,
      despachado: desp, aConfirmar: n, porAvisar: 0
    },
    url: url
  };
}


// TODAS las diferencias entre dos documentos, sin lista blanca de campos. La
// pregunta del 10-nov es justamente QUÉ cambia el servidor cuando le pedimos el
// documento preparado, y una lista de campos conocidos sólo muestra lo que ya
// esperábamos encontrar: si cambia algo que no está en la lista, no se ve.
const recorteValor = (v) => {
  if (v === undefined) return '(sin el campo)';
  const t = JSON.stringify(v);
  if (t === undefined) return '(no serializable)';
  return t.length > 160 ? t.slice(0, 160) + '…' : t;
};
function diferencias(a, b) {
  const out = [];
  const vistas = Object.create(null);
  const claves = [];
  [a, b].forEach(function (o) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) { if (!vistas[k]) { vistas[k] = 1; claves.push(k); } });
  });
  claves.sort().forEach(function (k) {
    const x = (a || {})[k], y = (b || {})[k];
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    out.push({ campo: k, antes: recorteValor(x), despues: recorteValor(y) });
  });
  // La línea de detalle aparte: es donde vive la cantidad, y como arriba sale
  // como un bloque JSON recortado, el campo que importa queda escondido.
  const da = ((a || {}).formDdetalles || [])[0], db = ((b || {}).formDdetalles || [])[0];
  if (da || db) {
    diferencias(da, db).forEach(function (d) {
      out.push({ campo: 'detalle.' + d.campo, antes: d.antes, despues: d.despues });
    });
  }
  return out;
}


// Las colecciones hijas que el cuerpo preparado manda VACÍAS. Medido el
// 10-nov: el documento 692187 tenía un formDtransportes (433211) y un
// formDregistros, y el preparado los manda como []. Si el PATCH reemplaza esas
// colecciones en vez de ignorarlas, esos registros se borran.
//
// La planilla manda exactamente este cuerpo desde siempre y el portal sigue
// funcionando, así que aparentemente el servidor las ignora. Pero
// "aparentemente" no es una medición: se revisa DESPUÉS de escribir y se dice.
const COLECCIONES_HIJAS = ['formDregistros', 'formDtransportes', 'formDanexos', 'formDinspeccions'];
function coleccionesVaciadas(antes, despues) {
  return COLECCIONES_HIJAS.filter(function (k) {
    const a = (antes && antes[k]) || [], d = (despues && despues[k]) || [];
    return (a.length || 0) > 0 && (d.length || 0) === 0;
  });
}


// El usersiD numérico de M3LinkSystem en PRODUCCIÓN, que Marcelo confirmó el
// 9-nov-2026. Es lo que se escribe en `usuarioIngresoId` para que la
// confirmación quede firmada por el usuario de sistema del m3link.
//
// OJO: este número es de PRODUCCIÓN. DEMO es otra base y su id puede ser otro;
// escribir el de DEMO acá firmaría con el usuario equivocado.
// Patrón de control: M2LinkSystem, el usuario del módulo viejo, es 951.
const USERSID_M3LINK = Math.max(0, parseInt(process.env.REDLINK_M3LINK_USERSID || '983', 10) || 0);
const NOMBRE_M3LINK = 'M3LinkSystem';

// LA RUTA QUE FALTABA. Sacada de la macro Confirmacion_Ver2.xlsm que el
// proveedor mandó usar como reemplazo (10-nov-2026). El servidor ARMA el
// documento a confirmar y lo devuelve; nosotros sólo se lo devolvemos tal cual
// por PATCH. Durante ocho intentos armamos el cuerpo a mano, que es por lo que
// siempre dio 400: le mandabamos a ese endpoint un cuerpo que no era el suyo.
//
// El segmento `original/` NO es una marca libre de procedencia. Eso supuse, y
// está medido que no: con M3LINK el servidor devuelve el documento SIN TOCAR
// —misma etapa, recepción null, la firma del usuario anterior— y con
// CONFIRMAVER2 devuelve el documento preparado (etapa 44, avanzaEtapa true,
// filler "CONFNORMAL", claveFrontend nueva, recepción y firma puestas).
// Medido el 10-nov-2026 sobre el folio 4149330, cambiando SÓLO ese segmento.
//
// Así que el valor por omisión es el que el servidor reconoce, no el que nos
// gustaría que reconociera. La traza de quién confirmó no se pierde por eso:
// viaja en usuarioIngresoId y usuarioConfirmaId, que el preparado deja en 983.
// Qué otros valores acepta es una pregunta abierta para Luis Macri.
const ORIGEN = String(process.env.REDLINK_ORIGEN || 'CONFIRMAVER2').trim() || 'CONFIRMAVER2';

function urlConfirmar(folio, cantidad, usersId, origen) {
  const f = String(folio == null ? '' : folio).trim();
  const c = String(cantidad == null ? '' : cantidad).trim();
  const u = String(usersId == null ? '' : usersId).trim();
  const o = String(origen || ORIGEN).trim();
  if (!/^\d+$/.test(f)) throw new Error('el folio tiene que ser un número: ' + JSON.stringify(folio));
  if (!/^\d+$/.test(c)) throw new Error('la cantidad tiene que ser un número: ' + JSON.stringify(cantidad));
  if (!/^\d+$/.test(u)) throw new Error('el usersiD tiene que ser un número: ' + JSON.stringify(usersId));
  if (!/^[A-Za-z0-9_-]+$/.test(o)) throw new Error('la marca de origen sólo admite letras, números, guion y guion bajo: ' + JSON.stringify(o));
  return '/api/FormHeader/ConfirmarTransferencia/Folio/' + f +
         '/recibido/' + c + '/original/' + o + '/usuarioconfirma/' + u;
}


// Lo que devuelve esa ruta antes de mandarlo de vuelta. Un 200 con la palabra
// "error" adentro NO es un documento: la macro hace esta misma comprobación.
function revisarPreparado(texto, folio, cantidad) {
  const crudo = String(texto == null ? '' : texto);
  const problemas = [];
  if (!crudo.trim()) return { ok: false, problemas: ['el servidor devolvió el cuerpo vacío'], doc: null };
  let doc = null;
  try { doc = JSON.parse(crudo); }
  catch (e) { return { ok: false, problemas: ['la respuesta no es JSON: ' + trozo(crudo)], doc: null }; }
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && doc.error) {
    return { ok: false, problemas: ['el servidor contestó un error: ' + String(doc.error).slice(0, 200)], doc: doc };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, problemas: ['la respuesta no es un documento'], doc: doc };
  }
  // Que el documento que volvió sea el que pedimos: un folio cruzado acá
  // confirmaría la transferencia equivocada.
  if (String(doc.folio) !== String(folio)) {
    problemas.push('el documento que volvió es del folio ' + doc.folio + ' y pedimos el ' + folio);
  }
  const det = (doc.formDdetalles || []).filter(d => d && typeof d === 'object');
  if (det.length !== 1) problemas.push('el documento trae ' + det.length + ' líneas de detalle; esta versión confirma una');
  else if (Number(det[0].recepcion) !== Number(cantidad)) {
    problemas.push('el documento viene con recepción ' + det[0].recepcion + ' y pedimos ' + cantidad);
  }
  return { ok: !problemas.length, problemas: problemas, doc: doc,
           etapa: String((doc.formMetapa || {}).nombre || ''), firma: firmaDe(doc) };
}


// El nombre entra a una URL, así que se valida ANTES y de forma sincrónica:
// una validación adentro de una async se convierte en una promesa rechazada y
// se la puede tragar quien no la espere. Está acá y no en cada lado porque los
// dos la necesitan: el script y la función HTTP.
const RE_NOMBRE_USUARIO = /^[A-Za-z0-9_.-]+$/;
function rutaDeUsuario(nombre) {
  const n = String(nombre == null ? '' : nombre).trim();
  if (!n) throw new Error('falta el nombre de usuario');
  if (!RE_NOMBRE_USUARIO.test(n)) {
    throw new Error('el nombre de usuario sólo admite letras, números, punto, guion y guion bajo: ' + JSON.stringify(nombre));
  }
  return '/api/User/nombreusuario/' + encodeURIComponent(n);
}

// ---- a quién firmar, preguntado por nombre --------------------------------
//
// La macro no lleva el número escrito: pregunta por el nombre y usa lo que el
// servidor contesta. Es mejor que un número a mano por una razón concreta: el
// nombre es lo que una persona puede verificar mirando el portal, el número no.
//
// El servidor busca por coincidencia, así que pedir "M3Link" puede traer otro
// usuario cuyo nombre lo contenga. Si el nombre que vuelve no es exactamente
// el que se pidió, el número no es el que se cree que es.
function interpretarUsuario(texto, nombre) {
  const crudo = String(texto == null ? '' : texto);
  const nada = { ok: false, id: null, nombre: '' };
  if (!crudo.trim()) return Object.assign({ problemas: ['el servidor devolvió el cuerpo vacío'] }, nada);
  let j;
  try { j = JSON.parse(crudo); }
  catch (e) {
    return Object.assign({ problemas: ['la respuesta no es JSON: ' + trozo(crudo)] }, nada);
  }
  const lista = (Array.isArray(j) ? j : [j]).filter(x => x && typeof x === 'object');
  const conId = lista.filter(x => Number(x.usersiD) > 0);
  if (!conId.length) {
    return Object.assign({ problemas: ['no vino ningún usersiD para "' + nombre + '"'] }, nada);
  }
  const pedido = String(nombre || '').trim().toLowerCase();
  const exactos = conId.filter(x => String(x.userName || '').trim().toLowerCase() === pedido);
  const elegidos = exactos.length ? exactos : conId;
  if (elegidos.length > 1) {
    return Object.assign({ problemas: ['el nombre "' + nombre + '" devolvió ' + elegidos.length +
      ' usuarios (' + elegidos.map(x => String(x.userName || '?') + '=' + x.usersiD).join(', ') +
      '): no se elige uno'] }, nada);
  }
  const u = elegidos[0];
  const encontrado = String(u.userName || '').trim();
  const problemas = [];
  if (pedido && encontrado.toLowerCase() !== pedido) {
    problemas.push('se pidió "' + nombre + '" y el servidor devolvió "' + (encontrado || '(sin nombre)') + '"');
  }
  return { ok: !problemas.length, problemas: problemas, id: Number(u.usersiD), nombre: encontrado };
}

// El nombre entra a una URL, así que se valida ANTES y de forma sincrónica:
// una validación adentro de una async se convierte en una promesa rechazada y
// se la puede tragar quien no la espere.

// Quien firma un documento. Es `usuarioIngresoId`, no `usuarioConfirmaId`:
// medido el 9-nov-2026, una confirmacion manual real dejo usuarioConfirmaId en
// null y sobrescribio usuarioIngresoId con el usuario que actuo. El servidor
// NO lo deduce del token, guarda lo que se le manda.
//
// Para que esto sirva hay que leer un documento que el usuario HAYA TOCADO:
// el nombre confirma de quien es el numero, y sin el nombre el numero no
// prueba nada.
function firmaDe(doc) {
  if (!doc || typeof doc !== 'object') return { id: null, nombre: '', confirmaId: null };
  const n = Number(doc.usuarioIngresoId);
  return {
    id: Number.isFinite(n) && n > 0 ? n : null,
    nombre: String(doc.usuarioIngresoNombre || '').trim(),
    confirmaId: (doc.usuarioConfirmaId === null || doc.usuarioConfirmaId === undefined)
      ? null : Number(doc.usuarioConfirmaId)
  };
}


// Después de escribir, lo único que prueba que el número era el correcto es el
// NOMBRE que devolvió el servidor. Un id equivocado no da error: graba otro
// usuario y queda igual de callado.
function veredictoDeFirma(docDespues, esperado) {
  const esp = (esperado === undefined || esperado === null) ? USERSID_M3LINK : Number(esperado);
  const f = firmaDe(docDespues);
  if (f.id === esp && f.nombre.toLowerCase() === NOMBRE_M3LINK.toLowerCase()) {
    return { ok: true, dice: 'firmada por ' + f.nombre + ' (' + f.id + ')' };
  }
  if (f.id === esp) {
    return { ok: false, dice: 'el id ' + f.id + ' quedó grabado pero el nombre es "' +
      (f.nombre || '(vacío)') + '", no ' + NOMBRE_M3LINK + ': el número NO es de ese usuario' };
  }
  return { ok: false, dice: 'se mandó ' + esp + ' y quedó ' +
    (f.id === null ? '(vacío)' : f.id) + ' / "' + (f.nombre || '(vacío)') +
    '": la confirmación NO quedó firmada por ' + NOMBRE_M3LINK };
}


// Qué hacer con UN folio del lote, decidido sobre el documento recién releído.
//
// La distinción que importa: una transferencia que YA está confirmada no es una
// anomalía, es una fila que ya se hizo — el módulo del proveedor pudo haberla
// confirmado mientras corríamos, o es un archivo que se reintenta. Esas se
// saltan y el lote sigue. Cualquier otra cosa detiene el lote, porque significa
// que el documento no es el que el archivo describe.
function clasificarEnLote(doc, cantidad, usersId, origen) {
  // Un documento ilegible no necesita guarda propia: planDeConfirmacion ya lo
  // nombra, y una guarda que no cambia el resultado es código sin prueba.
  if (esConfirmada(doc)) {
    const det = (doc.formDdetalles || [])[0] || {};
    return { accion: 'saltar', motivo: 'ya está confirmada (recepción ' +
      JSON.stringify(det.recepcion) + ', etapa "' + etapaDe(doc) + '")' };
  }
  const plan = planDeConfirmacion(doc, cantidad, usersId, origen);
  if (!plan.ok) return { accion: 'detener', motivo: plan.problemas.join(' · ') };
  return { accion: 'confirmar', motivo: '', plan: plan };
}


// Qué decir cuando la API y el número configurado no coinciden. No se elige
// uno: un número de usuario equivocado firma a otra persona y no da error.
function cotejarFirma(resuelto, configurado) {
  if (!resuelto || !resuelto.ok) {
    return { ok: true, usar: configurado, verificado: false,
             dice: 'no se pudo verificar por API (' + (((resuelto || {}).problemas || ['sin detalle'])[0]) +
                   '); se usa el ' + configurado + ' configurado' };
  }
  if (Number(resuelto.id) !== Number(configurado)) {
    return { ok: false, usar: null, verificado: true,
             dice: 'la API dice que ' + NOMBRE_M3LINK + ' es ' + resuelto.id + ' y acá está configurado ' +
                   configurado + '. No se elige uno de los dos: hay que resolver cuál es antes de firmar' };
  }
  return { ok: true, usar: configurado, verificado: true,
           dice: 'verificado: ' + (resuelto.nombre || NOMBRE_M3LINK) + ' es ' + configurado };
}
module.exports = {
  usarMascara,
  ETAPAS_CONFIRMABLES, etapaDe, etapaConfirmable, esConfirmada,
  USERSID_M3LINK, NOMBRE_M3LINK, ORIGEN,
  urlConfirmar, revisarPreparado,
  interpretarUsuario, cotejarFirma, rutaDeUsuario, RE_NOMBRE_USUARIO,
  firmaDe, veredictoDeFirma,
  planDeConfirmacion, clasificarEnLote,
  diferencias, recorteValor,
  COLECCIONES_HIJAS, coleccionesVaciadas
};
