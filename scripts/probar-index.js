const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const RAIZ=__dirname;
const srv=http.createServer((q,r)=>{const f=path.join(RAIZ,decodeURIComponent(q.url.split('?')[0]));
  if(f.startsWith(RAIZ)&&fs.existsSync(f)&&fs.statSync(f).isFile()){
    r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return r.end(fs.readFileSync(f)); }
  r.writeHead(404); r.end('');});
let BASE='';

const FRESCO = (over) => ({ generado:'2026-11-27T13:00:00Z', hoy:'2026-11-27', hora:10, atrasadas:0,
  fuentes:[
    {id:'ops',n:'Operaciones',vista:'ops',nota:'Cadena diaria',cuando:'2026-11-27',atraso:0,viejo:false,dice:'hoy'},
    {id:'sap',n:'SAP B1',vista:'stocks-unificado',nota:'Stock',cuando:'2026-11-27',atraso:0,viejo:false,dice:'hoy'},
    {id:'walmart',n:'Reporte Walmart',vista:'confirmaciones-walmart',nota:'Reporte diario',cuando:'2026-11-26',atraso:1,viejo:false,dice:'ayer'},
    {id:'talana',n:'Talana',vista:'asistencia-aldia',nota:'Marcas',cuando:'2026-11-27',atraso:0,viejo:false,dice:'hoy'}
  ].map(f => Object.assign(f, (over||{})[f.id] || {})) });

const EVENTOS = (lista) => ({ value: lista });
/* Eventos relativos al reloj: una prueba con horas fijas pasa o falla según
   la hora a la que se corra, que es la peor clase de prueba. */
function local(min){
  const d = new Date(Date.now() + min*60000);
  const p = new Intl.DateTimeFormat('sv-SE',{ timeZone:'America/Santiago',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false })
    .formatToParts(d).reduce((a,x)=>(a[x.type]=x.value,a),{});
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':00.0000000';
}
const EVrel = (desdeMin, hastaMin, tit) => ({ subject:tit,
  start:{dateTime:local(desdeMin),timeZone:'America/Santiago'},
  end:{dateTime:local(hastaMin),timeZone:'America/Santiago'},
  location:{displayName:'Sala'}, isOnlineMeeting:false });
const EV = (h1,h2,tit,lug,online) => ({ subject:tit,
  start:{dateTime:'2026-11-27T'+h1+':00.0000000',timeZone:'America/Santiago'},
  end:{dateTime:'2026-11-27T'+h2+':00.0000000',timeZone:'America/Santiago'},
  location:{displayName:lug||''}, isOnlineMeeting:!!online });

async function abrir(b, o){
  o = o || {};
  const p = await b.newPage({ viewport:{width:1420,height:1000}, timezoneId:'America/Santiago' });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const visto = { uso:0, graph:0, me:0 };
  await p.addInitScript((cfg) => {
    /* MSAL no se baja de internet en las pruebas: se reemplaza por un doble
       que deja elegir si el silencio alcanza o no. */
    if (cfg.msal === 'no') { window.msal = undefined; return; }
    const tok = { accessToken:'tok', account:{username:'p@redtecsa.com'} };
    window.msal = { PublicClientApplication: function(c){
      window.__cfgMsal = c;
      this.initialize = async () => {};
      this.getAllAccounts = () => cfg.msal === 'cache' ? [{username:'p@redtecsa.com'}] : [];
      this.acquireTokenSilent = async () => { if (cfg.msal==='falla') throw new Error('x'); return tok; };
      this.ssoSilent = async (r) => { window.__hint = r.loginHint;
        if (cfg.msal==='falla') { const e=new Error('x'); e.errorCode='consent_required'; throw e; }
        if (cfg.msal==='mal_config') { const e=new Error("AADSTS90002: Tenant 'x' not found.");
          e.errorCode='invalid_request'; throw e; }
        return tok; };
      this.loginPopup = async () => { window.__huboPopup = true; return tok; };
      this.acquireTokenPopup = async () => { window.__popupCal = (window.__popupCal||0) + 1;
        if (cfg.popup === 'rechaza') throw new Error('user_cancelled');
        return tok; };
    }};
    window.__popups = [];
    const wo = window.open;
    window.open = function(u, n, f){ window.__popups.push({u:u,n:n,f:f}); return { focus(){} }; };
  }, { msal: o.msal || 'cache', popup: o.popup || '' });

  await p.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.includes('/.auth/me')) { visto.me++; return route.fulfill({status:200,contentType:'application/json',
      body: JSON.stringify(o.me === null ? {} :
        { clientPrincipal:{ userDetails: o.correo || 'm.cantos@redtecsa.com',
                            userRoles: o.roles || ['logistica'], identityProvider:'aad', userId:'x' } })}); }
    if (u.includes('/api/frescura')) {
      if (o.frescuraFalla) return route.fulfill({ status:500, body:'' });
      return route.fulfill({status:200,contentType:'application/json',
        body: JSON.stringify(o.frescura || FRESCO())}); }
    if (u.includes('/api/uso-registro')) { visto.uso++; return route.fulfill({status:204,body:''}); }
    if (u.includes('graph.microsoft.com')) {
      visto.graph++;
      if (u.includes('/me?')) return route.fulfill({status:200,contentType:'application/json',
        body: JSON.stringify({ givenName:'Mónica', displayName:'Mónica Cantos' })});
      return route.fulfill({status:200,contentType:'application/json',
        body: JSON.stringify(EVENTOS(o.eventos || []))}); }
    if (u.includes('mindicador')) return route.fulfill({status:200,contentType:'application/json',
      body: JSON.stringify({ uf:{valor:39282.13}, dolar:{valor:948.7} })});
    if (u.startsWith(BASE)) return route.continue();
    return route.fulfill({status:200,contentType:'text/plain',body:''});
  });
  await p.goto(BASE + '/index-nuevo.html');
  await p.waitForTimeout(900);
  return { p, errs, visto };
}

(async () => {
  await new Promise(r => srv.listen(0,'127.0.0.1',r));
  BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  let ok=0, mal=0;
  const es=(c,q,e,r)=>{const t=JSON.stringify(e)===JSON.stringify(r);t?ok++:mal++;
    console.log((t?'  ok  ':'  MAL ')+c+' · '+q+(t?'':'   esperaba '+JSON.stringify(e)+' / obtuve '+JSON.stringify(r)));};
  const txt = (p,s) => p.innerText(s).catch(()=> '');

  /* A · logística */
  { const {p,errs,visto} = await abrir(b,{roles:['logistica'],correo:'m.cantos@redtecsa.com'});
    es('A','sin errores de js',0,errs.length);
    es('A','saluda por el nombre del correo',true,/M Cantos|Mónica/.test(await txt(p,'#nom')));
    es('A','el rótulo es su área','logística inversa',(await txt(p,'#rol')).trim().toLowerCase());
    es('A','muestra el correo en el menú','m.cantos@redtecsa.com',(await txt(p,'#correo')).trim());
    es('A','registró el ingreso',true,visto.uso>0);
    /* El nombre y el rol son dos líneas, no un "MmejiasADMINISTRADOR" pegado.
       Es la tercera vez en este index que dos span inline se juntan; por eso
       la prueba mira la geometría y no el texto. */
    { const a = await p.locator('#nom').boundingBox(), b2 = await p.locator('#rol').boundingBox();
      es('A','nombre y rol en líneas distintas',true, b2.y >= a.y + a.height - 1); }
    const ac = await txt(p,'#accesos');
    es('A','trae Confirmaciones Walmart',true,/Confirmaciones Walmart/.test(ac));
    es('A','trae Gestión de clientes e inventario',true,/Gestión de clientes e inventario/.test(ac));
    es('A','NO trae vistas de otra área',false,/Cartola|Asistencia|Pagos SPOT/.test(ac));
    const f = await txt(p,'#fuentes');
    es('A','ve sus dos fuentes',true,/Operaciones/.test(f)&&/Reporte Walmart/.test(f));
    es('A','no ve las que no le tocan',false,/Talana|SAP B1/.test(f));
    await p.close(); }

  /* B · transportes */
  { const {p,errs} = await abrir(b,{roles:['transportes'],correo:'a.garcia@redtecsa.com'});
    es('B','sin errores de js',0,errs.length);
    const ac = await txt(p,'#accesos');
    es('B','trae Retiros del día',true,/Retiros del día/.test(ac));
    es('B','NO trae Programación de retiros, que es de logística',false,/Programación de retiros/.test(ac));
    es('B','no ve el reporte de Walmart',false,/Reporte Walmart/.test(await txt(p,'#fuentes')));
    await p.close(); }

  /* C · admin ve de todo */
  { const {p} = await abrir(b,{roles:['admin'],correo:'mmejias@redtecsa.com'});
    es('C','el rótulo es Administrador','administrador',(await txt(p,'#rol')).trim().toLowerCase());
    es('C','ve las cuatro fuentes',4,await p.locator('#fuentes .fu').count());
    await p.close(); }

  /* D · una fuente atrasada */
  { const {p} = await abrir(b,{roles:['admin'],
      frescura: FRESCO({ walmart:{ viejo:true, dice:'ayer', atraso:1 } }) });
    es('D','la atrasada es enlace',1,await p.locator('#fuentes a.fu.viejo').count());
    es('D','las sanas no son enlace',0,await p.locator('#fuentes a.fu:not(.viejo)').count());
    es('D','lo dice en la leyenda',true,/1 fuente atrasada/.test(await txt(p,'#fuentes')));
    es('D','el enlace lleva a su vista',true,
       /abrir=confirmaciones-walmart/.test(await p.getAttribute('#fuentes a.fu.viejo','href')));
    await p.close(); }

  /* E · el endpoint se cae: la franja no miente, desaparece */
  { const {p,errs} = await abrir(b,{roles:['admin'],frescuraFalla:true});
    es('E','sin errores de js',0,errs.length);
    es('E','no dibuja franja a medias','',(await txt(p,'#fuentes')).trim());
    es('E','el resto de la página sigue viva',true,(await txt(p,'#accesos')).length>10);
    await p.close(); }

  /* F · buscador */
  { const {p} = await abrir(b,{roles:['admin']});
    const buscar = async (q) => { await p.fill('#q',q); await p.waitForTimeout(160); return txt(p,'#res'); };
    es('F','8 dígitos → cita',true,/Cita Walmart 42768970/.test(await buscar('42768970')));
    es('F','7 dígitos → folio',true,/Folio \/ nro de pedido 4157023/.test(await buscar('4157023')));
    es('F','texto → cliente y vista',true,/Cliente Walmart/.test(await buscar('walm')));
    es('F','nombre de vista',true,/Programación de retiros/.test(await buscar('retiros')));
    es('F','basura avisa',true,/Nada reconocido/.test(await buscar('zzzz')));
    await p.fill('#q','42768970'); await p.waitForTimeout(160);
    es('F','el enlace lleva el filtro',true,
       /abrir=confirmaciones-walmart&cita=42768970/.test(await p.getAttribute('#res a','href')));
    await p.fill('#q','<img src=x onerror=alert(1)>'); await p.waitForTimeout(160);
    es('F','no inyecta html',0,await p.locator('#res img').count());
    await p.close(); }

  /* G · calendario: silencio OK */
  /* Las horas van relativas al reloj. Antes estaban fijas al 2026-11-27 y la
     prueba empezó a fallar sola al día siguiente: el filtro de "lo que queda
     del día" las mandaba al pasado. Una prueba que caduca es ruido. */
  { const hhmm = (min) => local(min).slice(11,16);
    const {p,errs,visto} = await abrir(b,{roles:['logistica'],msal:'cache',
      eventos:[EVrel(-120,-90,'Revisión STOCK PLANTAS'),
               EVrel(90,120,'Cierre del día')]});
    es('G','sin errores de js',0,errs.length);
    es('G','consultó Graph',true,visto.graph>0);
    const c = await txt(p,'#cal');
    es('G','pinta el bloque',true,/MI DÍA|Mi día/i.test(c));
    { const esperada = local(90).slice(11,16);
      es('G','hora sin correr 3 horas',true,c.includes(esperada)); }
    es('G','no abrió ninguna ventana',0,(await p.evaluate(()=>window.__popups.length)));
    es('G','usa localStorage para el token','localStorage',
       await p.evaluate(()=>window.__cfgMsal.cache.cacheLocation));
    es('G','el nombre se actualiza desde Graph','Mónica Cantos',(await txt(p,'#nom')).trim());
    await p.close(); }

  /* H · el silencio NO alcanza (iframe bloqueado por cookies de terceros):
     aparece la tarjeta para autorizar a mano, y NADA se abre solo. */
  { const {p,errs} = await abrir(b,{roles:['logistica'],msal:'falla'});
    es('H','sin errores de js',0,errs.length);
    es('H','no abre ventana al entrar',0,await p.evaluate(()=>window.__popupCal||0));
    es('H','ofrece conectar',1,await p.locator('#conectarCal').count());
    es('H','explica por qué',true,/autorizarla una vez/.test(await txt(p,'#cal')));
    es('H','el resto sigue vivo',true,(await txt(p,'#accesos')).length>10);
    await p.close(); }

  /* H2 · un clic y queda */
  { const {p} = await abrir(b,{roles:['logistica'],msal:'falla',
      eventos:[EVrel(60,90,'Reunión de prueba')]});
    await p.click('#conectarCal'); await p.waitForTimeout(500);
    es('H2','abrió la ventana solo al apretar',1,await p.evaluate(()=>window.__popupCal||0));
    es('H2','ya no ofrece conectar',0,await p.locator('#conectarCal').count());
    es('H2','pinta la agenda',true,/Reunión de prueba/.test(await txt(p,'#cal')));
    await p.close(); }

  /* H3 · si la rechaza, vuelve la tarjeta y no insiste */
  { const {p,errs} = await abrir(b,{roles:['logistica'],msal:'falla',popup:'rechaza'});
    await p.click('#conectarCal'); await p.waitForTimeout(400);
    es('H3','sin errores de js',0,errs.length);
    es('H3','la tarjeta vuelve',1,await p.locator('#conectarCal').count());
    es('H3','no reabre sola',1,await p.evaluate(()=>window.__popupCal||0));
    await p.close(); }

  /* I · sin MSAL en absoluto (CDN caído) */
  { const {p,errs} = await abrir(b,{roles:['logistica'],msal:'no'});
    es('I','sin errores de js',0,errs.length);
    es('I','la página funciona igual',true,(await txt(p,'#accesos')).length>10);
    await p.close(); }

  /* J · ssoSilent recibe a quién buscar */
  { const {p} = await abrir(b,{roles:['logistica'],msal:'sso',correo:'m.cantos@redtecsa.com'});
    es('J','le pasa el loginHint','m.cantos@redtecsa.com',await p.evaluate(()=>window.__hint));
    await p.close(); }

  /* K · tema compartido con el panel */
  { const {p} = await abrir(b,{roles:['admin']});
    es('K','arranca oscuro','dark',await p.getAttribute('html','data-theme'));
    await p.click('#btema'); await p.waitForTimeout(120);
    es('K','cambia a claro','light',await p.getAttribute('html','data-theme'));
    es('K','guarda en la MISMA llave del panel','light',
       await p.evaluate(()=>localStorage.getItem('ops_theme')));
    await p.close(); }

  /* L · REDTEC OS */
  { const {p} = await abrir(b,{roles:['logistica']});
    await p.click('#abrirOS'); await p.waitForTimeout(120);
    const w = await p.evaluate(()=>window.__popups[0]);
    es('L','abre redtec-os.html',true,/redtec-os\.html/.test(w.u));
    es('L','misma ventana nombrada','redtecos',w.n);
    es('L','ancho ≥ 860 para que se vea Recientes',true,
       Number((w.f.match(/width=(\d+)/)||[])[1]) >= 860);
    const qs = await p.locator('#preguntas .pre').count();
    es('L','trae preguntas del área',true,qs>0);
    await p.locator('#preguntas .pre').first().click(); await p.waitForTimeout(120);
    es('L','la pregunta viaja en ?q=',true,
       /\?q=/.test((await p.evaluate(()=>window.__popups[1])).u));
    await p.close(); }

  /* M · sin sesión: no revienta */
  { const {p,errs,visto} = await abrir(b,{me:null});
    es('M','sin errores de js',0,errs.length);
    es('M','no inventa un nombre','Usuario',(await txt(p,'#nom')).trim());
    es('M','no pide el calendario de nadie',0,visto.graph);
    await p.close(); }

  /* N · solo lo que QUEDA del día */
  { const {p} = await abrir(b,{roles:['logistica'],msal:'cache',
      eventos:[ EVrel(-180,-120,'Reunión que ya pasó'),
                EVrel(-60,-30,'Otra que ya pasó'),
                EVrel(60,90,'La que viene') ]});
    const c = await txt(p,'#cal');
    es('N','muestra la que viene',true,/La que viene/.test(c));
    es('N','esconde las que ya pasaron',false,/ya pasó/.test(c));
    es('N','queda una sola fila',1,await p.locator('#cal li').count());
    await p.close(); }

  { const {p} = await abrir(b,{roles:['logistica'],msal:'cache',
      eventos:[ EVrel(-180,-120,'Pasó una'), EVrel(-90,-60,'Pasó otra') ]});
    const c = await txt(p,'#cal');
    es('N','jornada cumplida: sin filas',0,await p.locator('#cal li').count());
    es('N','y lo dice contando las que hubo',true,/resto del día/.test(c) && /2/.test(c));
    await p.close(); }

  /* O · el tope de cinco */
  { const {p} = await abrir(b,{roles:['logistica'],msal:'cache',
      eventos:[30,60,90,120,150,180,210,240].map((m,i)=>EVrel(m,m+20,'Reunión '+(i+1)))});
    es('O','pinta cinco, no ocho',5,await p.locator('#cal li').count());
    const c = await txt(p,'#cal');
    es('O','avisa cuántas quedan fuera',true,/3 reuniones más hoy/.test(c));
    es('O','con enlace a Outlook',true,/verlas en Outlook/.test(c));
    await p.close(); }

  /* P · el id del inquilino, clavado.
     Lo escribí mal una vez leyéndolo de una captura: ceros por des, es por des.
     Este valor sale de
     login.microsoftonline.com/redtecsa.com/v2.0/.well-known/openid-configuration
     y esta prueba existe para que no vuelva a cambiarse a ojo. */
  { const src = require('fs').readFileSync(__dirname + '/index-nuevo.html','utf8');
    es('P','inquilino de REDTEC',true, src.includes("inquilino:'1bdfd00d-fe9e-40e9-8cbe-3c0978861728'"));
    es('P','aplicación m3link – calendario',true, src.includes("cliente:  '7feaad18-de29-4586-906f-fe074b401bd1'")); }

  /* Q · un error de CONFIGURACIÓN no se disfraza de "falta autorizar" */
  { const {p,errs} = await abrir(b,{roles:['logistica'],msal:'mal_config'});
    es('Q','sin errores de js',0,errs.length);
    es('Q','NO ofrece un botón que no serviría',0,await p.locator('#conectarCal').count());
    const t = await txt(p,'#cal');
    es('Q','dice que está mal configurado',true,/mal configurado/.test(t));
    es('Q','no culpa a Chrome',false,/Chrome bloquea/.test(t));
    await p.close(); }

  console.log('\n' + ok + ' ok · ' + mal + ' mal');
  await b.close(); srv.close();
  process.exit(mal?1:0);
})();
