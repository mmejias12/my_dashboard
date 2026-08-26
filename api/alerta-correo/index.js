/**
 * POST /api/alerta-correo
 *
 * Recibe una alerta del monitor de andén y la envía por correo vía Microsoft
 * Graph (misma cuenta de servicio que ya usan los demás envíos de M3link).
 *
 * App settings:
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   ALERTA_REMITENTE        buzón desde el que sale el correo
 *   ALERTA_DESTINO_CRITICA  destinatarios de faltante / camión sin guía (coma)
 *   ALERTA_DESTINO_AVISO    destinatarios de sobrante y avisos (coma)
 *
 * El monitor sólo pide envío para faltante, sobrante y sin_guia; el resto de
 * los estados se queda en pantalla para no volver ruido la casilla.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function token() {
  const t = process.env.GRAPH_TENANT_ID;
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID,
    client_secret: process.env.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST', body,
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

const esc = (s) => String(s ?? '—').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

const TITULO = {
  faltante: 'Camión con menos pallets de los declarados',
  sobrante: 'Camión con más pallets de los declarados',
  sin_guia: 'Camión sin guía emitida',
};

function cuerpo(a) {
  const critica = a.nivel === 'critica';
  const color = critica ? '#c0392b' : '#b8860b';
  const fila = a.fila_afectada
    ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Fila afectada</td><td><b>Fila ${esc(a.fila_afectada)}</b></td></tr>`
    : `<tr><td style="padding:4px 12px 4px 0;color:#666">Fila afectada</td><td>no identificable con los datos actuales</td></tr>`;

  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:560px">
    <div style="border-left:4px solid ${color};padding:10px 16px;background:#faf9f8">
      <div style="font-size:16px;font-weight:600;color:${color}">${esc(TITULO[a.tipo] || a.tipo)}</div>
      <div style="font-size:26px;font-weight:700;letter-spacing:2px;margin:8px 0 2px">${esc(a.patente)}</div>
      <div style="color:#666">${esc(a.chofer)}${a.guia ? ' · guía ' + esc(a.guia) : ''}</div>
    </div>
    <table style="margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Guía declara</td><td><b>${esc(a.declarados)}</b> pallets</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Cámara cuenta</td><td><b>${esc(a.detectados)}</b> pallets</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Diferencia</td>
          <td style="color:${color}"><b>${a.diferencia > 0 ? '+' : ''}${esc(a.diferencia)}</b> pallets</td></tr>
      ${fila}
      <tr><td style="padding:4px 12px 4px 0;color:#666">Carga</td><td>${esc(a.carga_id)} · ${esc(a.hora)}</td></tr>
    </table>
    <div style="padding:10px 16px;background:#fff4f4;border:1px solid #f0d0d0;border-radius:6px">
      <b>Acción:</b> ${esc(a.accion)}
    </div>
    <div style="margin-top:14px;color:#888;font-size:12px">
      Generado automáticamente por el monitor de andén · REDTEC
    </div>
  </div>`;
}

module.exports = async function (context, req) {
  const a = req.body;
  if (!a || !a.tipo || !a.patente) {
    context.res = { status: 422, body: 'payload incompleto: se requieren tipo y patente' };
    return;
  }

  const destino = (a.nivel === 'critica'
    ? process.env.ALERTA_DESTINO_CRITICA
    : process.env.ALERTA_DESTINO_AVISO || process.env.ALERTA_DESTINO_CRITICA || '');
  const para = destino.split(',').map((s) => s.trim()).filter(Boolean);

  if (!para.length) {
    context.res = { status: 500, body: 'no hay destinatarios configurados' };
    return;
  }

  try {
    const t = await token();
    const remitente = process.env.ALERTA_REMITENTE;
    const r = await fetch(`${GRAPH}/users/${encodeURIComponent(remitente)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `[${a.nivel === 'critica' ? 'ALERTA' : 'Aviso'}] ${a.patente} · ${TITULO[a.tipo] || a.tipo}`,
          importance: a.nivel === 'critica' ? 'high' : 'normal',
          body: { contentType: 'HTML', content: cuerpo(a) },
          toRecipients: para.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    if (!r.ok) throw new Error(`sendMail ${r.status}: ${await r.text()}`);

    context.res = { status: 202, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enviado: true, destinatarios: para.length }) };
  } catch (e) {
    context.log.error('alerta-correo', e);
    context.res = { status: 502, body: e.message };
  }
};
