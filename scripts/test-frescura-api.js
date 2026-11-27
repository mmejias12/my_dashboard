'use strict';
const path = require('path');
let ok=0, mal=0;
const es=(c,q,e,r)=>{const p=JSON.stringify(e)===JSON.stringify(r);p?ok++:mal++;
  console.log((p?'  ok  ':'  MAL ')+c+' · '+q+(p?'':'   esperaba '+JSON.stringify(e)+' / obtuve '+JSON.stringify(r)));};

function fresco(){ // módulo limpio en cada caso: el caché es de proceso
  const k = require.resolve('../api/frescura/index.js');
  delete require.cache[k];
  return require(k);
}
const ctx = () => ({ log:{ error(){} }, res:null });

(async () => {
  /* A · OPTIONS */
  { const m=fresco(), c=ctx(); await m(c,{method:'OPTIONS',query:{}});
    es('A','OPTIONS responde 204',204,c.res.status);
    es('A','trae CORS',true,!!c.res.headers['Access-Control-Allow-Origin']); }

  /* B · GET sin almacén: degrada, no revienta */
  { const m=fresco(), c=ctx(); await m(c,{method:'GET',query:{}});
    const b=JSON.parse(c.res.body);
    es('B','responde 200 igual',200,c.res.status);
    es('B','devuelve las cuatro fuentes',4,b.fuentes.length);
    es('B','todas sin dato',true,b.fuentes.every(f=>f.dice==='sin dato'));
    es('B','no marca error de servidor',undefined,b.error); }

  /* C · el caché: la segunda llamada no recalcula */
  { const m=fresco();
    const c1=ctx(); await m(c1,{method:'GET',query:{}});
    const g1=JSON.parse(c1.res.body).generado;
    await new Promise(r=>setTimeout(r,12));
    const c2=ctx(); await m(c2,{method:'GET',query:{}});
    const b2=JSON.parse(c2.res.body);
    es('C','la segunda viene de caché',true,b2.deCache===true);
    es('C','y es el mismo cálculo',g1,b2.generado);
    const c3=ctx(); await m(c3,{method:'GET',query:{recargar:'1'}});
    const b3=JSON.parse(c3.res.body);
    es('C','recargar=1 lo salta',undefined,b3.deCache);
    es('C','y recalcula',true,b3.generado!==g1); }

  /* D · cada fuente trae lo que la franja necesita para dibujarse */
  { const m=fresco(), c=ctx(); await m(c,{method:'GET',query:{}});
    const f=JSON.parse(c.res.body).fuentes;
    es('D','todas traen nombre',true,f.every(x=>!!x.n));
    es('D','todas traen vista destino',true,f.every(x=>!!x.vista));
    es('D','todas traen el estado',true,f.every(x=>typeof x.viejo==='boolean'));
    es('D','el orden es el del catálogo',['ops','sap','walmart','talana'],f.map(x=>x.id)); }

  console.log('\n' + ok + ' ok · ' + mal + ' mal');
  process.exit(mal?1:0);
})();
