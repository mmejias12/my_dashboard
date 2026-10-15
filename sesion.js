/* ============================================================================
 *  sesion.js  ·  Qué pasa cuando la sesión del m3link se acaba
 *
 *  EL PROBLEMA QUE RESUELVE. staticwebapp.config.json manda el 401 a
 *  /login.html con un redirect 302. Para el navegador eso NO es un error: el
 *  fetch sigue la redirección y responde 200 con el HTML del login. La vista
 *  cree que recibió datos, llama a r.json() y revienta con
 *
 *        Error: Unexpected token '<', "<!DOCTYPE"...
 *
 *  que es lo que el usuario terminaba viendo en pantalla. El dato no estaba
 *  malo: la sesión se había caído. Cada vista tendría que detectarlo por su
 *  cuenta en cada uno de sus fetch, así que se hace una sola vez, acá.
 *
 *  QUÉ HACE
 *    1. Envuelve window.fetch y reconoce esa respuesta: HTML donde se pidió
 *       JSON, o un 401 directo. Cuando pasa, levanta el velo y lleva al
 *       usuario a la pantalla de bienvenida en vez de dejar el error crudo.
 *
 *  401 NO ES LO MISMO QUE 403, y tratarlos igual costaba caro. 401 es "esta
 *  sesión no sirve". 403 es "la sesión está perfecta, pero tu rol no alcanza",
 *  y lo devuelven nuestras propias Functions con un JSON {error:'...'}. Al
 *  cerrar también con 403, a quien le faltaba un rol se le decía "tu sesión
 *  expiró" y se le mandaba al login: perdía la pantalla y, peor, el motivo
 *  real — nadie podía adivinar qué rol pedirle al administrador. Ahora un 403
 *  con JSON deja pasar la respuesta (la vista muestra su propio mensaje) y
 *  aparece un aviso al costado; sólo se cierra si el 403 llega como HTML, que
 *  ahí sí es el login disfrazado.
 *    2. Cierra por inactividad, con aviso dos minutos antes. Cualquier
 *       movimiento lo cancela.
 *
 *  DOS MODOS, PORQUE NO TODAS LAS PANTALLAS SON IGUALES
 *    'cerrar'      (por defecto) vistas de consulta: alguien las abre, mira y
 *                  se va. Si la sesión muere, lo mejor es cerrar y saludar.
 *    'reconectar'  pantallas de turno, como el monitor de andén: están puestas
 *                  en un monitor del andén y nadie las toca en ocho horas.
 *                  Cerrarlas por inactividad sería dejar el andén ciego. Estas
 *                  nunca vencen por inactividad y, si la sesión se cae,
 *                  recargan para reautenticarse solas.
 *
 *  Se configura poniendo window.SESION ANTES de cargar este archivo:
 *      <script>window.SESION = {modo:'reconectar'};</script>
 *      <script src="/sesion.js"></script>
 *
 *  LA ACTIVIDAD SE COMPARTE ENTRE PESTAÑAS. El panel abre las vistas en
 *  pestañas internas, así que cada una corre su propia copia de este archivo.
 *  Si cada una llevara su reloj por separado, la que no estás mirando vencería
 *  y cerraría la sesión de todas mientras trabajas en la de al lado. Por eso el
 *  último movimiento se guarda en localStorage, que es común a todas.
 * ========================================================================== */
(function () {
  'use strict';

  var CFG = window.SESION || {};
  var MODO        = CFG.modo || 'cerrar';                                  // 'cerrar' | 'reconectar'
  var INACTIVIDAD = CFG.inactividad != null ? CFG.inactividad : 45;         // minutos; 0 = nunca
  var AVISO       = CFG.aviso       != null ? CFG.aviso       : 2;          // minutos de aviso previo
  var CLAVE       = 'm3link.actividad';
  var MOTIVO      = 'm3link.motivo';

  if (MODO === 'reconectar') INACTIVIDAD = 0;   // una pantalla de turno no vence sola

  /* La vista puede estar dentro de una pestaña del panel. Si redirigiéramos
     sólo el iframe, la bienvenida aparecería incrustada dentro de la pestaña,
     con el menú del panel alrededor. Hay que mover la ventana de arriba. */
  function ventanaTop() {
    try { return (window.top && window.top.location.href !== undefined) ? window.top : window; }
    catch (e) { return window; }   // otro origen: no se puede, se navega la propia
  }

  var guardar = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var leer    = function (k)    { try { return localStorage.getItem(k); } catch (e) { return null; } };

  // El aviso previo vive acá arriba porque lo usan los dos lados: el reloj de
  // inactividad lo pone y lo saca, y cerrar() tiene que poder sacarlo tambien.
  var cajaAviso = null;
  function quitarAviso() {
    if (cajaAviso && cajaAviso.parentNode) cajaAviso.parentNode.removeChild(cajaAviso);
    cajaAviso = null;
  }

  /* ---------------------------------------------------------------------- *
   *  Velo
   * ---------------------------------------------------------------------- */
  var TEXTOS = {
    expirada:    ['Tu sesión expiró', 'Volviendo a la pantalla de bienvenida…'],
    inactividad: ['Sesión cerrada por inactividad', 'Volviendo a la pantalla de bienvenida…'],
    reconectar:  ['Sesión expirada', 'Reconectando…'],
  };

  function velo(motivo) {
    var t = TEXTOS[motivo] || TEXTOS.expirada;
    var d = document.createElement('div');
    d.setAttribute('role', 'status');
    d.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;' +
      'background:#0A0C11;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'animation:m3lEntra .18s ease-out';
    d.innerHTML =
      '<style>@keyframes m3lEntra{from{opacity:0}to{opacity:1}}' +
      '@keyframes m3lBarra{from{width:0}to{width:100%}}</style>' +
      '<div style="width:44px;height:3px;border-radius:2px;background:#E02B20;margin-bottom:6px"></div>' +
      '<div style="font-size:20px;font-weight:600;letter-spacing:-.01em">' + t[0] + '</div>' +
      '<div style="font-size:14px;color:#AEB6C4">' + t[1] + '</div>' +
      '<div style="width:190px;height:2px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden;margin-top:10px">' +
      '<div style="height:100%;background:#E02B20;animation:m3lBarra 2.1s linear forwards"></div></div>';
    (document.body || document.documentElement).appendChild(d);
  }

  /* ---------------------------------------------------------------------- *
   *  Cierre
   * ---------------------------------------------------------------------- */
  var cayendo = false;

  function cerrar(motivo) {
    if (cayendo) return;
    cayendo = true;
    quitarAviso();
    try { velo(motivo); } catch (e) {}

    // Por qué se cerró, para que la bienvenida lo pueda decir. Va en
    // sessionStorage y no en la URL: sobrevive al rebote por Entra sin
    // ensuciar el link que después queda en la barra del navegador.
    try { sessionStorage.setItem(MOTIVO, motivo); } catch (e) {}

    var W = ventanaTop();
    setTimeout(function () {
      try {
        if (motivo === 'reconectar') {
          // La sesión de la SWA se renueva sola si Entra sigue viva: recargar
          // dispara ese flujo y la pantalla del andén vuelve sin que nadie
          // tenga que subir a apretar nada.
          W.location.reload();
        } else if (motivo === 'inactividad') {
          // Acá sí se cierra de verdad, que es lo que se pidió: no basta con
          // mostrar la bienvenida si la sesión sigue abierta por detrás.
          W.location.href = '/.auth/logout?post_logout_redirect_uri=' +
                            encodeURIComponent('/login.html?motivo=inactividad');
        } else {
          W.location.href = '/login.html?motivo=expirada';
        }
      } catch (e) { location.href = '/login.html'; }
    }, 2100);
  }

  /* Falta de permiso: ni velo ni redirección. La vista sigue viva y el
     usuario se entera de por qué le falta un pedazo. Uno por página. */
  var avisoPermisoPuesto = false;

  function avisoPermiso() {
    if (avisoPermisoPuesto || cayendo) return;
    avisoPermisoPuesto = true;
    var d = document.createElement('div');
    d.id = 'm3l-sin-permiso';
    d.setAttribute('role', 'status');
    d.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483646;max-width:340px;' +
      'background:#171B24;border:1px solid rgba(224,43,32,.45);border-left:3px solid #E02B20;' +
      'border-radius:10px;padding:13px 16px;color:#fff;font-size:13px;line-height:1.5;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 14px 40px rgba(0,0,0,.55)';
    d.innerHTML =
      '<b style="color:#ff8a80">Tu cuenta no tiene permiso para esta parte</b><br>' +
      'Tu sesión está bien: es el rol el que no alcanza. ' +
      '<span style="color:#AEB6C4">Pídele el rol al administrador del portal.</span>';
    (document.body || document.documentElement).appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 12000);
  }

  /* ---------------------------------------------------------------------- *
   *  1. La respuesta que en realidad era el login
   * ---------------------------------------------------------------------- */
  function esNuestroApi(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return false;          // CDNs y mapas, fuera
      return /^\/(api|proxy)\//.test(u.pathname);
    } catch (e) { return false; }
  }

  function esHtml(r) {
    var ct = (r.headers.get('content-type') || '').toLowerCase();
    return ct.indexOf('text/html') >= 0;
  }

  function sesionCaida(r, url) {
    if (!esNuestroApi(url)) return false;
    if (r.status === 401) return true;              // la sesión no sirve
    // Se exige text/html explícito. Un 204 sin cuerpo (uso-registro), una
    // imagen (spotvision-evidencia) o un JSON normal no entran acá: sólo el
    // HTML del login, que es justo lo que rompe el r.json() de las vistas.
    // Un 403 cae acá igual que cualquier otro estado: sólo cierra si llegó
    // disfrazado de página de login.
    return esHtml(r);
  }

  /* 403 nuestro, con cuerpo JSON: el rol no alcanza. La sesión está viva. */
  function permisoDenegado(r, url) {
    return esNuestroApi(url) && r.status === 403 && !esHtml(r);
  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal === 'function') {
    window.fetch = function (entrada, opciones) {
      return fetchOriginal.apply(this, arguments).then(function (r) {
        try {
          var url = (typeof entrada === 'string') ? entrada
                  : (entrada && entrada.url) ? entrada.url : '';
          if (sesionCaida(r, url)) cerrar(MODO === 'reconectar' ? 'reconectar' : 'expirada');
          else if (permisoDenegado(r, url)) avisoPermiso();
        } catch (e) { /* nunca romper el fetch de la vista */ }
        // Se devuelve la respuesta tal cual. La vista va a fallar igual al
        // parsearla, pero su mensaje de error queda detrás del velo: no se
        // toca el flujo de ninguna pantalla para no romper ninguna.
        return r;
      });
    };
  }

  /* ---------------------------------------------------------------------- *
   *  2. Inactividad
   * ---------------------------------------------------------------------- */
  if (INACTIVIDAD > 0) {
    var MS      = INACTIVIDAD * 60000;
    // El aviso nunca puede arrancar en cero: seria mostrarlo desde el segundo uno.
    var MS_AVISO= Math.max(MS * 0.5, MS - AVISO * 60000);
    var ultimoEscrito = 0;

    function marcar() {
      var t = Date.now();
      // Escribir en cada movimiento del mouse sería castigar al navegador sin
      // necesidad: con una vez cada 5 s alcanza y sobra.
      if (t - ultimoEscrito < 5000) return;
      ultimoEscrito = t;
      guardar(CLAVE, String(t));
      quitarAviso();
    }

    function ultimaActividad() {
      var v = Number(leer(CLAVE));
      return (v && !isNaN(v)) ? v : (ultimoEscrito || Date.now());
    }

    function mostrarAviso(minutosRestantes) {
      if (cajaAviso) return;
      cajaAviso = document.createElement('div');
      cajaAviso.setAttribute('role', 'status');
      cajaAviso.style.cssText =
        'position:fixed;right:18px;bottom:18px;z-index:2147483646;max-width:320px;' +
        'background:#171B24;border:1px solid rgba(250,178,25,.45);border-left:3px solid #fab219;' +
        'border-radius:10px;padding:13px 16px;color:#fff;font-size:13px;line-height:1.5;' +
        'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
        'box-shadow:0 14px 40px rgba(0,0,0,.55)';
      cajaAviso.innerHTML =
        '<b style="color:#f5c95f">Tu sesión está por cerrarse</b><br>' +
        'Se cerrará en ' + minutosRestantes + ' minuto' + (minutosRestantes === 1 ? '' : 's') +
        ' por inactividad. <span style="color:#AEB6C4">Mover el mouse la mantiene abierta.</span>';
      (document.body || document.documentElement).appendChild(cajaAviso);
    }

    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'].forEach(function (ev) {
      window.addEventListener(ev, marcar, { capture: true, passive: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) marcar();
    });

    marcar();

    /* Se compara contra el reloj, no se confía en un setTimeout largo: el
       navegador estrangula los timers de una pestaña en segundo plano, y si el
       computador se suspende toda la noche el timeout no corre. Con la hora
       real, al levantar la tapa la cuenta ya está vencida y se cierra. */
    setInterval(function () {
      if (cayendo) return;
      var inactivo = Date.now() - ultimaActividad();
      if (inactivo >= MS) { cerrar('inactividad'); return; }
      if (inactivo >= MS_AVISO) mostrarAviso(Math.max(1, Math.round((MS - inactivo) / 60000)));
      else quitarAviso();
    }, 15000);
  }

  /* Se expone por si alguna vista quiere cerrar a mano (por ejemplo, un botón
     de "salir" que hoy navega a /logout y no muestra nada mientras tanto). */
  window.cerrarSesionM3Link = cerrar;
})();
