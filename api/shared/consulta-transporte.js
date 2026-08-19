// ============================================================================
//  shared/consulta-transporte.js  ·  Galaxia TRANSPORTE (pagos a transportistas)
//
//  Réplica EXACTA del motor del dashboard "Transportes · Pagos" (front): calcula
//  cuánto le paga REDTEC a cada transportista por los viajes de un rango. Toma los
//  viajes de RDTOut (mismo endpoint OpsXRangoFechas que usa el dashboard, con el
//  mismo contrato fechaInicial/fechaFinal para traer patente/observación) y, por
//  cada viaje: patente → capacidad (252/540) y razón social; la operación define
//  la bodega tarifable; se busca su tarifa por pallet (t252/t540) y se multiplica
//  por los pallets confirmados. Agrega por transportista, patente, zona y línea.
//
//  Dato SENSIBLE (lo que se paga a terceros): en api/chat se expone por ROL, con
//  el mismo gating que Finanzas. Este módulo solo consulta y agrega.
//
//  IMPORTANTE · mantención: las tablas CAMIONES y TARIFAS son copia de las del
//  dashboard (transportespagos.html). Si allá cambian tarifas o camiones, hay que
//  actualizarlas aquí también para que el asistente y el dashboard coincidan.
// ============================================================================

const OPS_HOST = process.env.OS_OPS_HOST || 'https://apirdt1.azurewebsites.net';
const OPS_PATH = process.env.OS_TRANSP_PATH || '/api/RDTOut/OpsXRangoFechas';
const RDT_KEY  = process.env.REDTEC_API_KEY || 'm2s_live_ORA0CGEE3oowJ7gc2xYNqTOWmbYS8kMdD-l7hlAxvmE';
const IVA      = 0.19;

// Trae los viajes crudos del rango (mismo contrato que /api/m3link-viajes-proxy).
async function traerViajes(desde, hasta) {
  const url = `${OPS_HOST}${OPS_PATH}?fechaInicial=${encodeURIComponent(desde)}&fechaFinal=${encodeURIComponent(hasta)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Api-Key': RDT_KEY } });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`RDTOut ${r.status} (${desde}..${hasta}) ${cuerpo.slice(0, 120)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : (data.items || data.data || [data]);
}

const CAMIONES = {
  'BJCL13': {chofer:'ISMAEL CAMPOS', razonSocial:'ISMAEL CAMPOS', capacidad:252},
  'CCRC36': {chofer:'JUAN CARLOS VEGA', razonSocial:'TRANSPORTES CHOVELLEN SPA', capacidad:540},
  'CPVW43': {chofer:'CRISTOBAL ECHEVERRIA', razonSocial:'TRANSPORTES CHOVELLEN SPA', capacidad:540},
  'FV2792': {chofer:'EMILIO CAULLE', razonSocial:'TRANSPORTES CHOVELLEN SPA', capacidad:540},
  'LS3119': {chofer:'ANTONIO VEGA', razonSocial:'VICTOR ALEJANDRO VEGA LEAL', capacidad:252},
  'NC8771': {chofer:'JULIO BULNES', razonSocial:'TRANSPORTES CHOVELLEN SPA', capacidad:540},
  'RW5303': {chofer:'GONZALO CAMPOS', razonSocial:'SOCIEDAD CAMPOS TORRES LTDA.', capacidad:540},
  'SP3393': {chofer:'CESAR ANABALON', razonSocial:'JUAN CARLOS VEGA PAVEZ', capacidad:252},
  'VG1943': {chofer:'VICTOR VEGA', razonSocial:'TRANSPORTES CHOVELLEN SPA', capacidad:540},
  'XC9869': {chofer:'ALEJANDRO PENDOLA', razonSocial:'CARMEN GLORIA VALDEBENITO', capacidad:540},
  'YG5106': {chofer:'MIGUEL GOMEZ', razonSocial:'', capacidad:540}
};

const TARIFAS = [{"key":"00041 HIPER HUECHURABA","nombre":"00041 HIPER HUECHURABA","recinto":"00041 HIPER HUECHURABA","comuna":"HUECHURABA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"00041 HIPER HUECHURABA","nombre":"00041 HIPER HUECHURABA","recinto":"00041 HIPER HUECHURABA","comuna":"HUECHURABA","region":"RM","zona":"P5","t252":247,"t540":214},{"key":"00049 HIPER QUILICURA OHIGGINS","nombre":"00049 HIPER QUILICURA Ohiggins","recinto":"00049 HIPER QUILICURA Ohiggins","comuna":"QUILICURA","region":"RM","zona":"P3","t252":187,"t540":172},{"key":"00076 HIPER DEPARTAMENTAL","nombre":"00076 HIPER DEPARTAMENTAL","recinto":"00076 HIPER DEPARTAMENTAL","comuna":"LA FLORIDA","region":"RM","zona":"P18","t252":188,"t540":173},{"key":"00086 HIPER RECOLETA","nombre":"00086 HIPER RECOLETA","recinto":"00086 HIPER RECOLETA","comuna":"RECOLETA","region":"RM","zona":"P6","t252":236,"t540":210},{"key":"00671 HIPER QUILICURA MARCOLETA","nombre":"00671 HIPER QUILICURA Marcoleta","recinto":"00671 HIPER QUILICURA Marcoleta","comuna":"QUILICURA","region":"RM","zona":"P3","t252":187,"t540":172},{"key":"00682 HIPER SAN JOAQUIN","nombre":"00682 HIPER SAN JOAQUIN","recinto":"00682 HIPER SAN JOAQUIN","comuna":"SAN JOAQUIN","region":"RM","zona":"P18","t252":188,"t540":173},{"key":"00693 HIPER LA PINTANA","nombre":"00693 HIPER LA PINTANA","recinto":"00693 HIPER LA PINTANA","comuna":"LA PINTANA","region":"RM","zona":"P16","t252":309,"t540":257},{"key":"00748 HIPER RENCA","nombre":"00748 HIPER RENCA","recinto":"00748 HIPER RENCA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"ACONCAGUA FOODS","nombre":"ACONCAGUA FOODS","recinto":"ACONCAGUA FOODS S.A","comuna":"BUIN","region":"RM","zona":"P31","t252":334,"t540":285},{"key":"ALIFRUT RENGO PLANTA","nombre":"ALIFRUT RENGO PLANTA","recinto":"ALIMENTOS Y FRUTOS SA - ALIFRUT","comuna":"RENGO","region":"VI REGIÓN","zona":"P27","t252":746,"t540":640},{"key":"ALIMENTOS ANDINO RENCA","nombre":"ALIMENTOS ANDINO RENCA","recinto":"ALIMENTOS ANDINOS SPA.","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"ARCOR CERRILLOS GRAL. VELASQUEZ 9309","nombre":"ARCOR CERRILLOS Gral. Velasquez 9309","recinto":"INDUSTRIA DE ALIMENTOS DOS EN UNO SA","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"BALLERINA PLANTA CERRILLOS","nombre":"BALLERINA Planta Cerrillos","recinto":"LABORATORIO BALLERINA LIMITADA","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"BODEGA SOFTYS SAN ANTONIO ULOG","nombre":"BODEGA SOFTYS SAN ANTONIO ULOG","recinto":"SOFTYS CHILE SPA ULOG","comuna":"SAN ANTONIO","region":"V REGIÓN","zona":"P28","t252":629,"t540":581},{"key":"BRÜGGEN RENCA","nombre":"Brüggen Renca","recinto":"BRUEGGEN","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"CAMBIASO VALPARAISO CD","nombre":"CAMBIASO Valparaiso CD","recinto":"CAMBIASO VALPARAISO CD","comuna":"PLACILLA","region":"V REGIÓN","zona":"P29","t252":669,"t540":591},{"key":"CASTANO QUILICURA","nombre":"CASTANO QUILICURA","recinto":"CASTAÑO CD QULICURA","comuna":"QUILICURA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"CD FASA","nombre":"CD FASA","recinto":"CD FASA","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"CD PRE-UNIC","nombre":"CD PRE-UNIC","recinto":"CD PRE-UNIC","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"COLGATE - IMO CBP","nombre":"COLGATE - IMO CBP","recinto":"COLGATE - BUNKER CALYCO (IMO)","comuna":"LAMPA","region":"RM","zona":"P19","t252":167,"t540":170},{"key":"COLGATE INOCUO CBP","nombre":"COLGATE INOCUO CBP","recinto":"COLGATE-CALYCO CBP (INOCUO)","comuna":"PUDAHUEL","region":"RM","zona":"P17","t252":148,"t540":151},{"key":"COMERCIAL ANDEN SALZ PLANTA","nombre":"COMERCIAL ANDEN SALZ PLANTA","recinto":"COMERCIAL ANDEN SALZ LIMITADA","comuna":"MAIPU","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"COMERCIAL CANADA QUILICURA","nombre":"COMERCIAL CANADA Quilicura","recinto":"COMERCIAL CANADA SPA","comuna":"COLINA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"COMERCIAL CASTRO CD CERRILLOS","nombre":"COMERCIAL CASTRO CD CERRILLOS","recinto":"COMERCIAL CASTRO CD CERRILLOS","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"COMERCIAL ECCSA SAN BERNARDO","nombre":"COMERCIAL ECCSA San Bernardo","recinto":"COMERCIAL ECCSA S.A.","comuna":"SAN BERNARDO","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"COMERCIAL NABEK SPA","nombre":"COMERCIAL NABEK SPA","recinto":"COMERCIAL NABEK SPA","comuna":"LA PINTANA","region":"RM","zona":"P15","t252":224,"t540":190},{"key":"COMERCIAL ROCKY S.A.","nombre":"COMERCIAL ROCKY S.A.","recinto":"COMERCIAL ROCKY S.A.","comuna":"HIJUELAS","region":"V REGIÓN","zona":"P30","t252":713,"t540":608},{"key":"COMERCIALIZADORA PANOR","nombre":"COMERCIALIZADORA PANOR","recinto":"COMERCIALIZADORA PANOR SPA","comuna":"VALPARAISO","region":"V REGIÓN","zona":"P29","t252":669,"t540":591},{"key":"DEMARIA CD SANTIAGO","nombre":"DEMARIA CD Santiago","recinto":"DEMARIA CD SANTIAGO","comuna":"QUILICURA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"DEMARIA MAQUILA LAB. DUKAY","nombre":"DEMARIA MAQUILA LAB. DUKAY","recinto":"DEMARIA MAQUILA LAB. DUKAY","comuna":"LAMPA","region":"RM","zona":"P12","t252":303,"t540":257},{"key":"DEMARIA MEGA CARRASCAL","nombre":"DEMARIA MEGA CARRASCAL","recinto":"DEMARIA MEGA CARRASCAL","comuna":"CERRO NAVIA","region":"RM","zona":"P7","t252":185,"t540":167},{"key":"DEMARIA MEGA NOVICIADO","nombre":"DEMARIA MEGA NOVICIADO","recinto":"DEMARIA MEGA NOVICIADO","comuna":"LAMPA","region":"RM","zona":"P19","t252":167,"t540":170},{"key":"DEMARIA PALLET PARKING 5","nombre":"DEMARIA PALLET PARKING 5","recinto":"DEMARIA PALLET PARKING 5","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"DEMARIA WAREHOUSING","nombre":"DEMARIA WAREHOUSING","recinto":"DEMARIA WAREHOUSING","comuna":"LAMPA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"DESA DIST ERRAZURRIZ LAMPA","nombre":"DESA DIST ERRAZURRIZ LAMPA","recinto":"DESA DIST ERRAZURRIZ","comuna":"LAMPA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"DIST.CASANOVA SALAR DE ASCOTAN 1291 ENEA","nombre":"DIST.CASANOVA Salar de Ascotan 1291 Enea","recinto":"DISTRIBUIDORA CASANOVA","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"DISTRIBUIDORA LAGOS SAN BDO","nombre":"DISTRIBUIDORA LAGOS SAN BDO","recinto":"DISTRIBUIDORA LAGOS","comuna":"SAN BERNARDO","region":"RM","zona":"P15","t252":224,"t540":190},{"key":"DOS BANDERAS PUDAHUEL BODEGA LEVEL","nombre":"DOS BANDERAS Pudahuel Bodega Level","recinto":"DOS BANDERAS BODEGA PUDAHUEL","comuna":"PUDAHUEL","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"DOS BANDERAS SANTIAGO","nombre":"DOS BANDERAS Santiago","recinto":"DOS BANDERAS SANTIAGO","comuna":"QUILICURA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"EGA KAT LOGISTICA","nombre":"EGA KAT LOGISTICA","recinto":"EGA KAT","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"EMB. ANDINA PLANTA RENCA","nombre":"EMB. ANDINA PLANTA RENCA","recinto":"EMBOTELLADORA ANDINA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"EMBO. METROPOLITANA QUILICURA","nombre":"EMBO. METROPOLITANA Quilicura","recinto":"EMBOTELLADORA METROPOLITANA","comuna":"QUILICURA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"ENVASES CMF","nombre":"ENVASES CMF","recinto":"ENVASES CMF S.A.","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"GOOD FOOD CD","nombre":"GOOD FOOD CD","recinto":"GOOD FOOD","comuna":"PEÑAFLOR","region":"RM","zona":"P22","t252":212,"t540":208},{"key":"HALEON PUDAHUEL LA MARTINA 400","nombre":"HALEON PUDAHUEL La Martina 400","recinto":"HALEON CHILE SPA","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"HAMBURGO CD RENCA","nombre":"HAMBURGO CD Renca","recinto":"HAMBURGO CD RENCA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"IFCO CHILE QUILICURA","nombre":"IFCO CHILE Quilicura","recinto":"","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":null,"t540":142},{"key":"IFCO CHILE QUILICURA","nombre":"IFCO CHILE Quilicura","recinto":"IFCO SISA","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":null},{"key":"INDUSTRIA DE ALIMENTOS TRENDY","nombre":"INDUSTRIA DE ALIMENTOS TRENDY","recinto":"INDUSTRIA DE ALIMENTOS TRENDY","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"INDUSTRIAS CLEANER D Y C SAN BERNARDO","nombre":"INDUSTRIAS CLEANER D y C San Bernardo","recinto":"INDUSTRIAS CLEANER DyC","comuna":"SAN BERNARDO","region":"RM","zona":"P14","t252":200,"t540":174},{"key":"INDUSTRIAS CLEANER EMPRESA RENCA","nombre":"INDUSTRIAS CLEANER Empresa Renca","recinto":"INDUSTRIAS CLEANER RENCA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"INDUSTRIAS CLEANER LAMPA","nombre":"INDUSTRIAS CLEANER LAMPA","recinto":"INDUSTRIAS CLEANER LAMPA","comuna":"LAMPA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"INDUSTRIAS CLEANER MANUCHAR SAN ANTONIO","nombre":"INDUSTRIAS CLEANER Manuchar San Antonio","recinto":"INDUSTRIAS CLEANER Manuchar","comuna":"SAN ANTONIO","region":"V REGIÓN","zona":"P28","t252":null,"t540":581},{"key":"INDUSTRIAS CLEANER SCALPI QUILICURA LAUTARO 3005","nombre":"INDUSTRIAS CLEANER Scalpi Quilicura Lautaro 3005","recinto":"INDUSTRIAS CLEANER CHILE S.A.","comuna":"QUILICURA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"INDUSTRIAS CLEANER MANUCHAR","nombre":"INDUSTRIAS CLEANER Manuchar","recinto":"INDUSTRIAS CLEANER Manuchar","comuna":"SAN ANTONIO","region":"V REGIÓN","zona":"P28","t252":629,"t540":null},{"key":"INTERCARRY CD LO ESPEJO","nombre":"INTERCARRY CD LO ESPEJO","recinto":"INTERCARRY CD LO ESPEJO","comuna":"SAN BERNARDO","region":"RM","zona":"P14","t252":200,"t540":174},{"key":"INTERCARRY CD MACUL","nombre":"INTERCARRY CD Macul","recinto":"INTERCARRY CD MACUL","comuna":"MACUL","region":"RM","zona":"P18","t252":188,"t540":173},{"key":"INTERCOS COLINA","nombre":"INTERCOS COLINA","recinto":"INTERCOS COLINA","comuna":"COLINA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"INTERCOS DUKAY","nombre":"INTERCOS DUKAY","recinto":"INTERCOS DUKAY","comuna":"LAMPA","region":"RM","zona":"P12","t252":303,"t540":257},{"key":"INTERCOS SIM","nombre":"INTERCOS SIM","recinto":"INTERCOS SIM","comuna":"ESTACION CENTRAL","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"LAF CD RENCA","nombre":"LAF CD Renca","recinto":"LAF CD RENCA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"LESAFFRE CD","nombre":"LESAFFRE CD","recinto":"LESAFFRE CD","comuna":"QUILICURA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"M3034 MAYORISTA 10 RENGO","nombre":"M3034 MAYORISTA 10 RENGO","recinto":"M3034 MAYORISTA 10 RENGO","comuna":"RENGO","region":"VI REGIÓN","zona":"P27","t252":746,"t540":640},{"key":"MARGARITA UAUY E HIJOS","nombre":"MARGARITA UAUY E HIJOS","recinto":"MARGARITA UAUY E HIJOS","comuna":"LAMPA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"MARGOT IRENE RIVERA VILLA","nombre":"MARGOT IRENE RIVERA VILLA","recinto":"MARGOT IRENE RIVERA VILLA","comuna":"MAIPÚ","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"MARINETTI QUILICURA CD","nombre":"MARINETTI QUILICURA CD","recinto":"MMP MARINETTI LTDA","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"MARITANO CD HUECHURABA","nombre":"MARITANO CD HUECHURABA","recinto":"MARITANO CD HUECHURABA","comuna":"HUECHURABA","region":"RM","zona":"P5","t252":247,"t540":214},{"key":"MOL HEREDIA MAIPU PLANTA","nombre":"MOL HEREDIA MAIPU PLANTA","recinto":"MOLINERA HEREDIA LTDA.","comuna":"MAIPU","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"MOLINO PUENTE ALTO CD","nombre":"MOLINO PUENTE ALTO CD","recinto":"MOLINO PUENTE ALTO S.A","comuna":"PUENTE ALTO","region":"RM","zona":"P16","t252":309,"t540":257},{"key":"NESTLE MAIPU C. MELIPILLA 15300","nombre":"NESTLE MAIPÚ C. Melipilla 15300","recinto":"NESTLE CHILE S.A","comuna":"MAIPÚ","region":"RM","zona":"P21","t252":193,"t540":183},{"key":"NUTRATRADE S.A - LAS ACACIAS","nombre":"NUTRATRADE S.A - Las acacias","recinto":"NUTRATRADE S.A - Las acacias","comuna":"SAN BERNARDO","region":"RM","zona":"P14","t252":200,"t540":174},{"key":"NUTRATRADE S.A - LOS PINOS","nombre":"NUTRATRADE S.A - Los pinos","recinto":"NUTRATRADE S.A - Los pinos","comuna":"SAN BERNARDO","region":"RM","zona":"P15","t252":224,"t540":190},{"key":"NUTRISCO","nombre":"NUTRISCO","recinto":"NUTRISCO","comuna":"COLINA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"PAIMASA ISLA DE MAIPO","nombre":"PAIMASA ISLA DE MAIPO","recinto":"PAIMASA ISLA DE MAIPO","comuna":"ISLA DE MAIPO","region":"RM","zona":"P24","t252":287,"t540":274},{"key":"PF SANTIAGO PLANTA","nombre":"PF SANTIAGO PLANTA","recinto":"PF SANTIAGO PLANTA","comuna":"RENCA","region":"RM","zona":"P8","t252":189,"t540":172},{"key":"PIBAMOUR CD BUENAVENTURA","nombre":"PIBAMOUR CD BUENAVENTURA","recinto":"PIBAMOUR CD BUENAVENTURA","comuna":"QUILICURA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"PIBAMOUR CD FRIO","nombre":"PIBAMOUR CD FRIO","recinto":"PIBAMOUR CD FRIO","comuna":"RENCA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"PRISA CD QUILICURA","nombre":"PRISA CD Quilicura","recinto":"CD PRISA","comuna":"PUDAHUEL","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"PRISA PRILOGIC","nombre":"PRISA PRILOGIC","recinto":"PRISA PRILOGIC","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"PROALSA CD LO AGUIRRE","nombre":"PROALSA CD Lo Aguirre","recinto":"PROALSA CD LO AGUIRRE","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"PROCTER AND GAMBLE","nombre":"PROCTER AND GAMBLE","recinto":"P&G","comuna":"MACUL","region":"RM","zona":"P18","t252":188,"t540":173},{"key":"QUINTA ENEA","nombre":"QUINTA ENEA","recinto":"QUINTA ENEA S.A.","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"QUINTA VESPUCIO","nombre":"QUINTA VESPUCIO","recinto":"QUINTA VESPUCIO","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"RABIE SANTIAGO","nombre":"RABIE SANTIAGO","recinto":"RABIE SANTIAGO","comuna":"QUILICURA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"RECUPAC S.A.","nombre":"RECUPAC S.A.","recinto":"RECUPAC S.A.","comuna":"HUECHURABA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"SIADTALEB SAN BERNANDO CD BARRANCON 2080","nombre":"SIADTALEB  SAN BERNANDO CD Barrancon 2080","recinto":"DISTRIBUIDORA TALEB","comuna":"SAN BERNARDO","region":"RM","zona":"P26","t252":252,"t540":217},{"key":"SOFTYS PLANTA TALAGANTE","nombre":"SOFTYS PLANTA TALAGANTE","recinto":"SOFTYS CHILE SPA TALAGANTE","comuna":"TALAGANTE","region":"RM","zona":"P24","t252":287,"t540":274},{"key":"SOFTYS PLANTA PUENTE ALTO","nombre":"Softys Planta Puente Alto","recinto":"SOFTYS CHILE SPA PUENTE ALTO","comuna":"PUENTE ALTO","region":"RM","zona":"P16","t252":309,"t540":257},{"key":"SOFTYS TEXVAL","nombre":"Softys TEXVAL","recinto":"SOFTYS CHILE SPA TEXVAL","comuna":"VALPARAÍSO","region":"V REGIÓN","zona":"P29","t252":669,"t540":591},{"key":"TEBA GRAN AVENIDA AV. JOSE MIGUEL CARERRA 13365","nombre":"TEBA GRAN AVENIDA Av. José Miguel Carerra 13365","recinto":"TEBA GRAN AVENIDA","comuna":"SAN BERNARDO","region":"RM","zona":"P15","t252":224,"t540":190},{"key":"TEBA JJ PEREZ AV. J.J PEREZ #6142 CERRO NAVIA","nombre":"TEBA JJ PEREZ Av. J.J Perez #6142 Cerro Navia","recinto":"TEBA JJ PEREZ","comuna":"CERRO NAVIA","region":"RM","zona":"P7","t252":185,"t540":167},{"key":"TEBA LO BLANCO AV. LO BLANCO #2561 LA PINTANA","nombre":"TEBA LO BLANCO Av. Lo Blanco #2561 La Pintana","recinto":"TEBA LO BLANCO","comuna":"LA PINTANA","region":"RM","zona":"P15","t252":224,"t540":190},{"key":"TEBA LO VALLEDOR AV.GRL.VELAZQUEZ #3409 CERRILLOS","nombre":"TEBA LO VALLEDOR Av.Grl.Velázquez #3409 Cerrillos","recinto":"TEBA LO VALLEDOR","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"THE PROTEIN COMPANY PAINE","nombre":"THE PROTEIN COMPANY Paine","recinto":"THE PROTEIN COMPANY","comuna":"PAINE","region":"RM","zona":"P25","t252":344,"t540":298},{"key":"TUCAPEL PRODUCCION SANTIAGO","nombre":"TUCAPEL PRODUCCION SANTIAGO","recinto":"EMPRESAS TUCAPEL S.A.","comuna":"PUDAHUEL","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"TUCAPEL SA","nombre":"TUCAPEL SA","recinto":"EMPRESAS TUCAPEL S.A.","comuna":"PUDAHUEL","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"VETERQUIMICA S.A.","nombre":"VETERQUIMICA S.A.","recinto":"VETERQUIMICA S.A.","comuna":"MAIPU","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"VIRUTEX CD PUDAHUEL","nombre":"VIRUTEX CD Pudahuel","recinto":"VIRUTEX CD PUDAHUEL","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"VIRUTEX MAMUT SAN JOAQUIN","nombre":"VIRUTEX MAMUT SAN JOAQUIN","recinto":"VIRUTEX MAMUT","comuna":"SAN JOAQUIN","region":"RM","zona":"P18","t252":188,"t540":173},{"key":"VIRUTEX MELIPILLA","nombre":"VIRUTEX MELIPILLA","recinto":"VIRUTEX CD MELIPILLA","comuna":"CERRILLOS","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"WOODPALLETS","nombre":"WOODPALLETS","recinto":"WOODPALLETS (APR)","comuna":"TALAGANTE","region":"RM","zona":"P23","t252":235,"t540":222},{"key":"ZAL03 CD ALVI AEROPARQUE","nombre":"ZAL03 CD ALVI AEROPARQUE","recinto":"ZAL03 CD ALVI AEROPARQUE","comuna":"PUDAHUEL","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"ZCS01 CD CENCOSUD NOVICIADO","nombre":"ZCS01 CD CENCOSUD NOVICIADO","recinto":"ZCS01 CD CENCOSUD NOVICIADO","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"ZCS07 CD CENCOSUD LO AGUIRRE","nombre":"ZCS07 CD CENCOSUD LO AGUIRRE","recinto":"ZCS07 CD CENCOSUD LO AGUIRRE","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"ZSB CD SALCO BRAND","nombre":"ZSB CD SALCO BRAND","recinto":"ZSB CD SALCOBRAND","comuna":"SAN BERNARDO","region":"RM","zona":"P10","t252":157,"t540":146},{"key":"ZTT01 CD TOTTUS LA FARFANA","nombre":"ZTT01 CD TOTTUS LA FARFANA","recinto":"CD TOTTUS LA FARFANA","comuna":"PUDAHUEL","region":"RM","zona":"P1","t252":116,"t540":120},{"key":"ZUN01 CD UNIMARC LO AGUIRRE","nombre":"ZUN01 CD UNIMARC LO AGUIRRE","recinto":"ZUN01 CD UNIMARC LO AGUIRRE","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"ZWM01 CD WM LO AGUIRRE SECO","nombre":"ZWM01 CD WM LO AGUIRRE SECO","recinto":"ZWM01 CD WM LO AGUIRRE SECO","comuna":"PUDAHUEL","region":"RM","zona":"P13","t252":139,"t540":142},{"key":"ZWM02 CD WM QUILICURA FRIO","nombre":"ZWM02 CD WM QUILICURA FRIO","recinto":"ZWM02 CD WM QUILICURA FRIO","comuna":"QUILICURA","region":"RM","zona":"P4","t252":235,"t540":207},{"key":"ZWM08 WM RENTAPACK SANTIAGO","nombre":"ZWM08 WM RENTAPACK SANTIAGO","recinto":"ZWM08 WM RENTAPACK SANTIAGO","comuna":"QUILICURA","region":"RM","zona":"P2","t252":169,"t540":155},{"key":"ZWM11 CD WM EL PENON","nombre":"ZWM11 CD WM EL PEÑON","recinto":"ZWM11 CD WM EL PEÑON","comuna":"SAN BERNARDO","region":"RM","zona":"P26","t252":252,"t540":217}];

const TARIFAS_IDX = {};
TARIFAS.forEach(t => {
  if (!TARIFAS_IDX[t.key]) TARIFAS_IDX[t.key] = [];
  TARIFAS_IDX[t.key].push(t);
});

// ============================================================
//  MOTOR DE CÁLCULO  (réplica de transportespagos.html)
// ============================================================
function normalize(s){
  if(!s) return '';
  return String(s).toUpperCase().trim()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ñ/g,'N')
    .replace(/\s+/g,' ');
}
function esRedtec(b){
  if(!b) return false;
  const n = normalize(b);
  return n.includes('REDTEC SANTIAGO') || n.includes('SANTIAGO INSPECCION');
}

// Según la operación, cuál es el CLIENTE al que se atribuye el viaje:
// en emisión, el que recibe (destino); en retiro/devolución, el de origen.
function clienteDe(v){
  const op = (v.operacion||'').trim();
  if(op === 'Emision' || op === 'Emision 24 horas') return v.clienteDestinoStr || v.clienteOrigenStr || '';
  if(op === 'Retiro' || op === 'Devolucion')        return v.clienteOrigenStr || v.clienteDestinoStr || '';
  return v.clienteDestinoStr || v.clienteOrigenStr || '';
}

// Según la operación, cuál bodega se tarifa.
function getBodegaTarifable(v){
  const op = (v.operacion||'').trim();
  if(op === 'Emision' || op === 'Emision 24 horas') return v.bodegaDestinoStr;
  if(op === 'Retiro' || op === 'Devolucion'){
    if(!esRedtec(v.bodegaOrigenStr)) return v.bodegaOrigenStr;
    return v.bodegaDestinoStr;
  }
  if(!esRedtec(v.bodegaOrigenStr)) return v.bodegaOrigenStr;
  return v.bodegaDestinoStr;
}

// Tarifa por pallet según bodega + capacidad del camión (252 → t252, si no t540).
function lookupTarifa(bodega, capacidad){
  if(!bodega) return null;
  const key = normalize(bodega);
  const matches = TARIFAS_IDX[key];
  if(!matches || !matches.length) return null;
  const m = matches[0];
  const tarifa = capacidad === 252 ? m.t252 : m.t540;
  return {zona: m.zona, tarifa, comuna: m.comuna, region: m.region, nombreBodega: m.nombre};
}

// Clasifica el viaje en línea de negocio / clase de operación.
function clasificarLinea(v){
  const op = (v.operacion||'').trim();
  const destino = normalize(v.bodegaDestinoStr);
  const cliente = normalize(v.clienteOrigenStr) + ' ' + normalize(v.clienteDestinoStr);
  const obs = normalize(v.observacion);
  if(obs.includes('FALSO FLETE') || obs.includes('FALSO'))
    return {linea:'FALSO FLETE', tipoOperacion:'FALSO FLETE', claseOp:'Blanco comercializacion Redtec'};
  if(cliente.includes('IFCO') || cliente.includes('LOGISTICA Y TRANSPORTES RT'))
    return {linea:'COMERCIALIZACION', tipoOperacion:'COMPRA', claseOp:'Blanco comercializacion RT'};
  if(op === 'Emision' || op === 'Emision 24 horas')
    return {linea:'EMISION ROJO', tipoOperacion:'EMISIÓN ROJOS', claseOp:'Rojo'};
  if(op === 'Retiro'){
    if(destino.includes('REDTEC SANTIAGO') && /^Z[A-Z]{2}\d/.test((v.bodegaOrigenStr||'').trim()))
      return {linea:'RETIRO ROJO', tipoOperacion:'RETIRO CD RETAIL', claseOp:'Rojo'};
    return {linea:'RETIRO ROJO', tipoOperacion:'RETIRO RUTA RM', claseOp:'Rojo'};
  }
  if(op === 'Devolucion')
    return {linea:'RETIRO ROJO', tipoOperacion:'DEVOLUCION', claseOp:'Rojo'};
  return {linea:'-', tipoOperacion:'-', claseOp:'-'};
}

function procesarViaje(raw){
  const patente = (raw.patente||'').trim().toUpperCase();
  const camion = CAMIONES[patente] || {chofer: raw.chofer||'', razonSocial:'', capacidad:null};
  const capacidad = camion.capacidad;
  const cantidad = Number(raw.cantidadConfirmada) || 0;
  const bodegaTarif = getBodegaTarifable(raw);
  const tarifaInfo = lookupTarifa(bodegaTarif, capacidad);
  const clasif = clasificarLinea(raw);
  const valorUnit = tarifaInfo ? tarifaInfo.tarifa : null;
  const total = (valorUnit && cantidad) ? valorUnit * cantidad : null;
  return {
    patente,
    chofer: raw.chofer || camion.chofer || '',
    razonSocial: camion.razonSocial || '',
    capacidad,
    operacion: raw.operacion || '',
    nroPedido: raw.nroPedido || '',
    dteNro: raw.dteNro || raw.nroDocumento || '',
    clienteOrigenStr: raw.clienteOrigenStr || '',
    clienteDestinoStr: raw.clienteDestinoStr || '',
    bodegaOrigenStr: raw.bodegaOrigenStr || '',
    bodegaDestinoStr: raw.bodegaDestinoStr || '',
    fechaConfirmacion: raw.fechaConfirmacion || raw.fechaDespacho || raw.horaIngreso || '',
    cantidad,
    valorUnit, total,
    zona: tarifaInfo ? tarifaInfo.zona : null,
    comuna: tarifaInfo ? tarifaInfo.comuna : null,
    claseOp: clasif.claseOp,
    linea: clasif.linea,
    bodegaTarif,
    sinTarifa: !tarifaInfo && !esRedtec(bodegaTarif),
    sinPatente: !CAMIONES[patente] && !!patente
  };
}

// ============================================================
//  AGREGACIÓN Y CONSULTA
// ============================================================
const reISO  = /^\d{4}-\d{2}-\d{2}$/;
const hoyIso = () => new Date().toISOString().slice(0, 10);
const num    = x => Number(x) || 0;

function acopiar(mapa, clave, base, v){
  if(!mapa[clave]) mapa[clave] = Object.assign({viajes:0, pallets:0, neto:0}, base);
  const a = mapa[clave];
  a.viajes  += 1;
  a.pallets += v.cantidad;
  a.neto    += num(v.total);
  return a;
}

// Procesa el rango: devuelve viajes facturables (con patente) dentro del rango real.
async function viajesDelRango(desde, hasta){
  const crudos = await traerViajes(desde, hasta);
  const proc = crudos.map(procesarViaje).filter(v => v.patente && v.patente.trim().length);
  // El API puede expandir a semanas ISO completas: recortamos por la MISMA fecha
  // (fechaConfirmacion) que usa la prefactura, para coincidir con el dashboard.
  const t0 = new Date(desde + 'T00:00:00').getTime();
  const t1 = new Date(hasta + 'T23:59:59').getTime();
  return proc.filter(v => {
    if(!v.fechaConfirmacion) return false;
    const t = new Date(v.fechaConfirmacion).getTime();
    return !isNaN(t) && t >= t0 && t <= t1;
  });
}

// ── Herramienta: consultar_transporte ───────────────────────────────────────
async function consultarTransporte({ desde, hasta, entidad, cliente, operacion }, ctx){
  if(!reISO.test(desde||'') || !reISO.test(hasta||'')) throw new Error('fechas inválidas: YYYY-MM-DD');
  const hoy = hoyIso();
  if(hasta > hoy) hasta = hoy;
  if(desde > hasta) throw new Error('desde > hasta');

  let viajes = await viajesDelRango(desde, hasta);

  // Filtro opcional por transportista / patente / chofer.
  const term = entidad ? normalize(entidad) : null;
  if(term){
    viajes = viajes.filter(v =>
      normalize(v.razonSocial).includes(term) ||
      normalize(v.patente).includes(term) ||
      normalize(v.chofer).includes(term));
  }
  // Filtro opcional por CLIENTE (destino en emisión, origen en retiro).
  const termCli = cliente ? normalize(cliente) : null;
  if(termCli){
    viajes = viajes.filter(v => normalize(clienteDe(v)).includes(termCli));
  }
  // Filtro opcional por TIPO DE OPERACIÓN (retiro / emisión / devolución).
  // 'emision' abarca también 'Emision 24 horas'.
  const termOp = operacion ? normalize(operacion) : null;
  if(termOp){
    viajes = viajes.filter(v => normalize(v.operacion).includes(termOp));
  }

  const total = { viajes:0, pallets:0, neto:0 };
  const porTransportista = {}, porPatente = {}, porZona = {}, porClase = {}, porCliente = {}, porOperacion = {};
  const sinTarifa = [];
  for(const v of viajes){
    total.viajes += 1; total.pallets += v.cantidad; total.neto += num(v.total);
    const rs = v.razonSocial || '(sin transportista)';
    const cli = clienteDe(v) || '(sin cliente)';
    acopiar(porTransportista, rs, { transportista: rs }, v);
    acopiar(porPatente, v.patente, { patente: v.patente, chofer: v.chofer, razonSocial: v.razonSocial, capacidad: v.capacidad }, v);
    acopiar(porZona, (v.zona || '(sin tarifa)'), { zona: v.zona || '(sin tarifa)' }, v);
    acopiar(porClase, (v.claseOp || '-'), { clase: v.claseOp || '-' }, v);
    acopiar(porCliente, cli, { cliente: cli }, v);
    acopiar(porOperacion, (v.operacion || '(s/o)'), { operacion: v.operacion || '(s/o)' }, v);
    if(v.sinTarifa) sinTarifa.push({ patente: v.patente, bodega: v.bodegaTarif, operacion: v.operacion, pallets: v.cantidad });
  }

  const ordSuma = o => Object.values(o).sort((a,b) => b.neto - a.neto).map(x => ({...x, neto: Math.round(x.neto)}));
  const iva = Math.round(total.neto * IVA);

  if(ctx && ctx.log) ctx.log(`transporte ${desde}..${hasta}${entidad?' ["'+entidad+'"]':''}${cliente?' cli["'+cliente+'"]':''}${operacion?' op['+operacion+']':''}: ${viajes.length} viajes, neto ${Math.round(total.neto)}`);

  const out = {
    desde, hasta, entidad: entidad || null, cliente: cliente || null, operacion: operacion || null,
    total: { viajes: total.viajes, pallets: total.pallets, neto: Math.round(total.neto), iva, total_con_iva: Math.round(total.neto) + iva },
    por_operacion: ordSuma(porOperacion),
    por_transportista: ordSuma(porTransportista).slice(0, 20),
    por_cliente: termCli ? ordSuma(porCliente) : ordSuma(porCliente).slice(0, 20),
    por_zona: ordSuma(porZona).slice(0, 20),
    por_clase: ordSuma(porClase),
    sin_tarifa: { viajes: sinTarifa.length, muestra: sinTarifa.slice(0, 10) }
  };
  // Detalle por camión: completo si se filtró por entidad, si no el top 20.
  out.por_patente = term ? ordSuma(porPatente) : ordSuma(porPatente).slice(0, 20);
  // Detalle envío por envío (con costo) cuando se filtra por cliente o transportista.
  if(termCli || term){
    out.detalle = viajes
      .sort((a,b) => num(b.total) - num(a.total))
      .slice(0, 80)
      .map(v => ({
        fecha: (v.fechaConfirmacion||'').slice(0,10),
        operacion: v.operacion,
        nroPedido: v.nroPedido,
        dte: v.dteNro,
        cliente: clienteDe(v),
        bodega_destino: v.bodegaDestinoStr,
        bodega_origen: v.bodegaOrigenStr,
        zona: v.zona,
        patente: v.patente,
        transportista: v.razonSocial,
        pallets: v.cantidad,
        valor_unit: v.valorUnit,
        costo: v.total == null ? null : Math.round(v.total),
        sin_tarifa: v.sinTarifa || undefined
      }));
  }
  return out;
}

// ── Resumen del mes en curso (para inyectar en el contexto) ──────────────────
async function resumenPeriodo(hoy){
  hoy = reISO.test(hoy||'') ? hoy : hoyIso();
  const desde = hoy.slice(0, 8) + '01';
  const viajes = await viajesDelRango(desde, hoy);
  let neto = 0, pallets = 0;
  const porTransportista = {};
  for(const v of viajes){
    neto += num(v.total); pallets += v.cantidad;
    acopiar(porTransportista, v.razonSocial || '(sin transportista)', { transportista: v.razonSocial || '(sin transportista)' }, v);
  }
  const top = Object.values(porTransportista).sort((a,b)=>b.neto-a.neto).slice(0,5);
  return { desde, hasta: hoy, viajes: viajes.length, pallets, neto: Math.round(neto), iva: Math.round(neto*IVA), top };
}

const milesCL = n => Math.round(n).toLocaleString('es-CL');
function formatoContextoTransporte(r){
  const top = r.top.map(t => `${t.transportista} $${milesCL(t.neto)}`).join(', ');
  return `[TRANSPORTE · pagos a transportistas, mes en curso ${r.desde}→${r.hasta}] ` +
    `Costo de flete (neto): $${milesCL(r.neto)} CLP (+IVA $${milesCL(r.iva)}) · ` +
    `${milesCL(r.viajes)} viajes, ${milesCL(r.pallets)} pallets. ` +
    `Top transportistas: ${top || 's/d'}. ` +
    `Para otros períodos, por transportista/patente/zona usa la herramienta consultar_transporte. ` +
    `Cuando uses datos de transporte, incluye 'transporte' en la línea [FUENTES].`;
}

const TOOL_SCHEMA = {
  name: 'consultar_transporte',
  description:
    'Consulta los COSTOS DE TRANSPORTE de REDTEC (lo que se PAGA a los ' +
    'transportistas por los viajes) EN VIVO para un rango: monto neto (CLP) e ' +
    'IVA, número de viajes y pallets, con desglose por transportista (razón ' +
    'social), por CLIENTE (a quién se despachó), por patente/camión, por zona ' +
    'tarifaria y por clase de operación (Rojo, Blanco comercialización, etc.). ' +
    'Úsala para "cuánto pagamos en transporte", "cuánto le pagamos a ' +
    '<transportista>", "cuánto costó el flete de despacharle a <cliente>", ' +
    '"qué camión hizo más viajes", "costo de flete por zona", "viajes sin ' +
    'tarifa". Si nombran un transportista/patente/chofer, pásalo en `entidad`; ' +
    'si nombran un CLIENTE, pásalo en `cliente`. Al filtrar por cliente o ' +
    'transportista se incluye además `detalle`: cada envío (fecha, pedido, DTE, ' +
    'bodega, pallets) con su costo, para comparar una emisión con lo que costó ' +
    'llevarla. Para separar RETIROS (desde retail) de EMISIONES (a cliente) o ' +
    'DEVOLUCIONES, pasa `operacion` (ej. "retiro"); el desglose `por_operacion` ' +
    'siempre viene en la respuesta. NO la uses para el mes en curso global: eso ' +
    'ya viene en el contexto. Al usar estos datos, incluye \'transporte\' en la línea [FUENTES].',
  input_schema: {
    type: 'object',
    properties: {
      desde:     { type: 'string', description: 'Inicio del rango, YYYY-MM-DD' },
      hasta:     { type: 'string', description: 'Fin del rango, YYYY-MM-DD' },
      entidad:   { type: 'string', description: 'Transportista (razón social), patente o chofer; opcional' },
      cliente:   { type: 'string', description: 'Nombre (o parte) del cliente al que se despachó/retiró; opcional. Úsalo para el costo de flete de un cliente/retail.' },
      operacion: { type: 'string', description: 'Filtra por tipo: "retiro", "emision" o "devolucion"; opcional. "emision" incluye "Emision 24 horas".' }
    },
    required: ['desde', 'hasta']
  }
};

module.exports = { consultarTransporte, resumenPeriodo, formatoContextoTransporte, procesarViaje, TOOL_SCHEMA };