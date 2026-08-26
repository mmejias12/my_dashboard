/**
 * GET /api/spotvision-evidencia?tipo=bulto|patente&id=45219
 *
 * Unico camino por el que el browser puede ver una evidencia: la API Key
 * no puede viajar dentro de un <img src>. La Function la inyecta y devuelve
 * los bytes de la imagen.
 *
 * Las URLs de SPOTVISION no caducan (seccion 4.2), asi que la respuesta se
 * puede cachear agresivamente en el navegador.
 */
const { obtenerEvidencia } = require('../shared/spotvision-fetch');

module.exports = async function (context, req) {
  const { tipo, id } = req.query;
  if (!tipo || !id) {
    context.res = { status: 422, body: 'faltan parametros tipo e id' };
    return;
  }
  try {
    const { buffer, contentType } = await obtenerEvidencia(tipo, id);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${tipo}-${id}.jpg"`,
      },
      isRaw: true,
      body: buffer,
    };
  } catch (e) {
    context.log.error('spotvision-evidencia', e);
    context.res = { status: e.status === 404 ? 404 : 502, body: e.message };
  }
};
