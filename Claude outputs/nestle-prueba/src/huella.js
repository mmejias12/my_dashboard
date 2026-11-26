/**
 * Huella de un movimiento: su identidad en los términos del cliente.
 *
 * La bitácora guardaba sólo id → folio. Con eso, si Nestlé reusa un
 * id_solicitud para un movimiento distinto, la respuesta es DUPLICADA con el
 * folio de la operación anterior, y el acuse le dice "cursada, folio N" por
 * un movimiento que nunca se creó. Pasó con el id 34: quedó registrado el 18
 * contra el folio 4141195 y volvió el 24 apuntando a otro traslado.
 *
 * Es el mismo guardia que redlink.js ya tiene para documentoNumero cuando el
 * portal responde "Ya existe Documento": comparar antes de dar por buena la
 * operación que ya estaba. A la bitácora le faltaba.
 *
 * Se guardan los códigos del cliente (NESTLE-0xx), no las bodegaId: los ids
 * de bodega cambian entre demo y producción, y el mismo movimiento tendría
 * dos huellas distintas según dónde se haya cursado.
 */

'use strict';

const CAMPOS = [
  ['tipo', 'tipo'],
  ['fecha', 'fecha requerida'],
  ['origen', 'centro origen'],
  ['destino', 'centro destino'],
  ['cantidad', 'cantidad de pallets'],
  ['documento', 'documento'],
];

/** Construye la huella a partir de los datos ya validados. */
function huellaDe(datos) {
  return {
    tipo: datos.tipo || null,
    fecha: datos.fechaRequerida || null,
    origen: datos.centroOrigen || null,
    destino: datos.centroDestino || null,
    cantidad: Number.isFinite(datos.cantidad) ? datos.cantidad : null,
    documento: datos.documentoNumero !== undefined && datos.documentoNumero !== null
      ? `${datos.tipoDocumento || 'DOC'} ${datos.documentoNumero}`
      : null,
  };
}

/**
 * Compara la huella que llega contra la guardada.
 *
 * comparable=false cuando el registro previo es anterior a este control: no
 * hay con qué contrastar, y entonces no se puede afirmar ni que sea el mismo
 * movimiento ni que sea otro. Ese caso se informa, no se adivina.
 */
function compararHuellas(nueva, previa) {
  if (!previa || typeof previa !== 'object') return { comparable: false, difs: [] };

  const difs = [];
  let comparados = 0;
  for (const [campo, etiqueta] of CAMPOS) {
    const antes = normalizar(previa[campo]);
    const ahora = normalizar(nueva[campo]);
    if (antes === null && ahora === null) continue;
    comparados += 1;
    if (antes !== ahora) difs.push(`${etiqueta}: antes ${mostrar(antes)}, ahora ${mostrar(ahora)}`);
  }
  return { comparable: comparados > 0, difs };
}

function normalizar(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return String(valor).trim().toUpperCase();
}

function mostrar(valor) {
  return valor === null ? '(vacío)' : valor;
}

module.exports = { huellaDe, compararHuellas, CAMPOS };
