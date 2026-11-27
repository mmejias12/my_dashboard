const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

/* Se sirve por http y no por file://: el panel hace fetch('/.auth/me'), que en
   file:// se resuelve a file:///.auth/me y falla antes de llegar al recorte por
   rol. Con file:// la suite entera daba verde sin haber probado el candado. */
const RAIZ = __dirname;
const srv = http.createServer((req, res) => {
  const f = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (f.startsWith(RAIZ) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('');
});
let RUTA = '';

function me(roles){
  return { clientPrincipal: { userDetails:'prueba@redtecsa.com', userRoles: roles,
                              identityProvider:'aad', userId:'x' } };
}

async function abrir(b, roles, query){
  const p = await b.newPage({ viewport:{width:1500,height:900} });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  let vioAuth = false;
  await p.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.includes('/.auth/me')) { vioAuth = true; return route.fulfill({ status:200,
      contentType:'application/json', body: JSON.stringify(me(roles)) }); }
    if (u.startsWith(RUTA.split('/m3link')[0])) {
      if (u.includes('/api/') || u.includes('/proxy/')) return route.fulfill({ status:200,
        contentType:'application/json', body:'[]' });
      return route.continue();
    }
    return route.fulfill({ status:200, contentType:'text/plain', body:'' });
  });
  p.__vioAuth = () => vioAuth;
  await p.addInitScript(() => { try{ localStorage.clear(); }catch(e){} });
  await p.goto(RUTA + (query || ''));
  await p.waitForTimeout(1800);
  return { p, errs, vioAuth: p.__vioAuth() };
}

const pestanas = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.tabchip:not(.home)')].map(c => (c.querySelector('.tc-lbl')||{}).textContent || ''));
const activa = (p) => p.evaluate(() => {
  const a = document.querySelector('.tabchip.active');
  return a ? (a.querySelector('.tc-lbl')||{}).textContent : null; });

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  RUTA = 'http://127.0.0.1:' + srv.address().port + '/m3link_dashboard_dark.html';
  const b = await chromium.launch();
  let ok=0, mal=0;
  const es=(c,q,e,r)=>{const pass=JSON.stringify(e)===JSON.stringify(r);pass?ok++:mal++;
    console.log((pass?'  ok  ':'  MAL ')+c+' · '+q+(pass?'':'   esperaba '+JSON.stringify(e)+' / obtuve '+JSON.stringify(r)));};

  /* A · sin ?abrir=, nada cambia */
  { const {p,errs,vioAuth} = await abrir(b, ['admin'], '');
    es('A','el arnés sí entregó la identidad',true,vioAuth);
    es('A','el recorte por rol corrió',true,
       await p.evaluate(()=>document.body.getAttribute('data-role-scoped')===null));
    es('A','sin errores de js',0,errs.length);
    es('A','no abre ninguna pestaña',0,(await pestanas(p)).length);
    es('A','queda en Inicio','Inicio',await activa(p));
    await p.close(); }

  /* B · admin abre una página del menú */
  { const {p,errs} = await abrir(b, ['admin'], '?abrir=confirmaciones-walmart');
    es('B','sin errores de js',0,errs.length);
    const t = await pestanas(p);
    es('B','abre exactamente una pestaña',1,t.length);
    es('B','es la de Walmart',true,/walmart/i.test(t[0]||''));
    es('B','el rótulo no trae las pastillas del menú',false,/↔|nuevo|próx/i.test(t[0]||''));
    es('B','queda activa',true,/walmart/i.test(await activa(p)||''));
    await p.close(); }

  /* C · acepta el nombre con .html */
  { const {p} = await abrir(b, ['admin'], '?abrir=confirmaciones-walmart.html');
    es('C','mismo resultado con .html',1,(await pestanas(p)).length);
    await p.close(); }

  /* D · EL CANDADO: transportes NO puede abrir una vista de otra área */
  { const {p,errs} = await abrir(b, ['transportes'], '?abrir=confirmaciones-walmart');
    es('D','sin errores de js',0,errs.length);
    es('D','el menú quedó recortado por rol','1',
       await p.evaluate(()=>document.body.getAttribute('data-role-scoped')));
    es('D','no abre nada',0,(await pestanas(p)).length);
    es('D','se queda en Inicio','Inicio',await activa(p));
    await p.close(); }

  /* E · pero sí puede abrir la suya.
     OJO: "Programación de retiros" NO es de transportes, vive en Logística
     inversa. Lo de transportes es "Retiros del día". La maqueta le daba a
     Ángelo cuatro accesos y dos eran de otra área. */
  { const {p} = await abrir(b, ['transportes'], '?abrir=transporte-retiros');
    es('E','transportes sí abre lo suyo',1,(await pestanas(p)).length);
    await p.close(); }

  { const {p} = await abrir(b, ['transportes'], '?abrir=retiros-programacion');
    es('E2','y NO abre Programación de retiros, que es de logística',0,(await pestanas(p)).length);
    await p.close(); }

  /* I · las dos vistas que el index enlaza y no estaban en el menú */
  { const {p} = await abrir(b, ['logistica'], '?abrir=clientes-conteos');
    es('I','logística abre Gestión de clientes e inventario',1,(await pestanas(p)).length);
    await p.close(); }
  { const {p} = await abrir(b, ['logistica'], '?abrir=historial-confirmaciones');
    es('I','logística abre Historial y trazabilidad',1,(await pestanas(p)).length);
    await p.close(); }
  { const {p} = await abrir(b, ['comercial'], '?abrir=clientes-conteos');
    es('I','comercial NO las abre',0,(await pestanas(p)).length);
    await p.close(); }

  /* F · vista interna del shell */
  { const {p,errs} = await abrir(b, ['admin'], '?abrir=ops');
    es('F','sin errores de js',0,errs.length);
    es('F','no crea pestaña (es del propio shell)',0,(await pestanas(p)).length);
    es('F','el breadcrumb apunta a Ops',true,
       /Ops x rango fechas/i.test(await p.evaluate(()=>{const b=document.querySelector('.breadcrumb');return b?b.textContent:'';})));
    await p.close(); }

  /* J · nombre PARCIAL: no se adivina.
     "walmart" es pedazo de confirmaciones-walmart.html y "retiros" es pedazo
     de tres vistas distintas. Abrir "la que se parezca" es abrir la equivocada
     en algún caso; el index genera estos enlaces y sabe el nombre exacto. */
  { const {p} = await abrir(b, ['admin'], '?abrir=walmart');
    es('J','un pedazo del nombre no abre nada',0,(await pestanas(p)).length);
    await p.close(); }
  { const {p} = await abrir(b, ['admin'], '?abrir=retiros');
    es('J','un pedazo ambiguo tampoco',0,(await pestanas(p)).length);
    await p.close(); }

  /* G · valor inventado: no revienta */
  { const {p,errs} = await abrir(b, ['admin'], '?abrir=no-existe-esta-vista');
    es('G','sin errores de js',0,errs.length);
    es('G','no abre nada',0,(await pestanas(p)).length);
    await p.close(); }

  /* H · intento de salirse por la ruta */
  { const {p,errs} = await abrir(b, ['admin'], '?abrir=' + encodeURIComponent('../../etc/passwd'));
    es('H','sin errores de js',0,errs.length);
    es('H','no abre nada',0,(await pestanas(p)).length);
    await p.close(); }

  console.log('\n' + ok + ' ok · ' + mal + ' mal');
  await b.close(); srv.close();
  process.exit(mal?1:0);
})();
