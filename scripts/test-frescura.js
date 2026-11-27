'use strict';
const F = require('../api/shared/frescura.js');
let ok=0, mal=0;
function es(c,q,e,r){ const p=JSON.stringify(e)===JSON.stringify(r); p?ok++:mal++;
  console.log((p?'  ok  ':'  MAL ')+c+' · '+q+(p?'':'   esperaba '+JSON.stringify(e)+' / obtuve '+JSON.stringify(r))); }

const ops = F.CATALOGO.find(x=>x.id==='ops');        // desdeHora 8
const wm  = F.CATALOGO.find(x=>x.id==='walmart');    // desdeHora 21
const HOY = '2026-11-27';

/* A · fechas */
es('A','resta de días',3, F.diasEntre('2026-11-24','2026-11-27'));
es('A','cruza fin de mes','2026-10-31', F.restar('2026-11-02',2));
es('A','fecha basura no revienta',null, F.diasEntre('xx','2026-11-27'));

/* B · zona horaria: 00:30 UTC sigue siendo el día anterior en Chile */
es('B','01:00Z del 28 es el 27 en Chile','2026-11-27', F.ahoraEnChile(new Date('2026-11-28T01:00:00Z')).fecha);
es('B','13:05Z son las 10 en Chile',10, F.ahoraEnChile(new Date('2026-11-27T13:05:00Z')).hora);

/* C · al día */
{ const r = F.evaluar(ops, HOY, HOY, 10);
  es('C','dato de hoy no está viejo',false,r.viejo);
  es('C','lo dice en palabras','hoy',r.dice);
  es('C','atraso cero',0,r.atraso); }

/* D · LA TOLERANCIA: a las 06:00 todavía no se le exige lo de hoy */
{ const temprano = F.evaluar(ops, '2026-11-26', HOY, 6);
  es('D','06:00 con el dato de ayer: aún no es atraso',false,temprano.viejo);
  const tarde = F.evaluar(ops, '2026-11-26', HOY, 10);
  es('D','10:00 con el dato de ayer: sí es atraso',true,tarde.viejo);
  es('D','y lo dice','ayer',tarde.dice); }

/* E · cada fuente con su propia hora: el reporte de Walmart llega de noche */
{ es('E','Walmart a las 10 con el de ayer: normal',false,
     F.evaluar(wm,'2026-11-26',HOY,10).viejo);
  es('E','Walmart a las 22 con el de ayer: atrasado',true,
     F.evaluar(wm,'2026-11-26',HOY,22).viejo);
  es('E','ops a las 10 con el de ayer: atrasado',true,
     F.evaluar(ops,'2026-11-26',HOY,10).viejo); }

/* F · dos días de atraso no se perdona a ninguna hora */
es('F','dos días atrás a las 05:00 igual es atraso',true, F.evaluar(ops,'2026-11-25',HOY,5).viejo);
es('F','lo dice en días','hace 2 días', F.evaluar(ops,'2026-11-25',HOY,5).dice);

/* G · sin dato */
{ const r = F.evaluar(ops, null, HOY, 10);
  es('G','sin dato cuenta como viejo',true,r.viejo);
  es('G','no inventa fecha',null,r.cuando);
  es('G','lo dice','sin dato',r.dice); }

/* H · ultimoDia camina hacia atrás */
(async () => {
  es('H','encuentra hoy','2026-11-27', await F.ultimoDia(async f=>f==='2026-11-27',HOY,6));
  es('H','camina hasta antier','2026-11-25', await F.ultimoDia(async f=>f==='2026-11-25',HOY,6));
  es('H','se rinde después del tope',null, await F.ultimoDia(async f=>f==='2026-11-01',HOY,6));
  es('H','una sonda que explota no voltea todo',null, await F.ultimoDia(async()=>{throw new Error('x')},HOY,2));

  /* I · armar() completo */
  const r = await F.armar({
    ops:     async f => f === HOY,
    sap:     async f => f === HOY,
    walmart: async f => f === '2026-11-26',
    talana:  async f => f === HOY
  }, new Date('2026-11-27T13:05:00Z'));   // 10:00 en Chile
  es('I','devuelve las cuatro fuentes',4,r.fuentes.length);
  es('I','a las 10 Walmart de ayer no alarma',0,r.atrasadas);
  es('I','conserva el orden del catálogo',['ops','sap','walmart','talana'],r.fuentes.map(x=>x.id));
  es('I','cada fuente trae su vista',true,r.fuentes.every(x=>!!x.vista));

  const r2 = await F.armar({
    ops: async f => f === '2026-11-25', sap: async f => f === HOY,
    walmart: async f => f === HOY,      talana: async f => f === HOY
  }, new Date('2026-11-27T13:05:00Z'));
  es('I','una fuente atrasada se cuenta',1,r2.atrasadas);
  es('I','y es la correcta','ops',r2.fuentes.filter(x=>x.viejo)[0].id);

  const r3 = await F.armar({}, new Date('2026-11-27T13:05:00Z'));
  es('I','sin sondas: todo sin dato, sin reventar',4,r3.atrasadas);

  console.log('\n' + ok + ' ok · ' + mal + ' mal');
  process.exit(mal?1:0);
})();
