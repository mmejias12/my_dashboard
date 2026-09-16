/* ══════════════════════════════════════════════════════════════════════════
   CATÁLOGO DE RECINTOS Y COORDENADAS — REDTEC
   ──────────────────────────────────────────────────────────────────────────
   El API del GPS entrega el NOMBRE de la geocerca, no su latitud/longitud,
   así que las coordenadas salen de acá: el recinto dice en qué comuna está y
   la comuna aporta su centroide. Es el mismo mecanismo que ya usaba
   mapa-retiros.html; este archivo lo saca a un lugar común para que el mapa
   de Transportes lo reutilice en vez de tener su propia copia.

   OJO: los centroides son APROXIMADOS. Sirven para ver CÓMO SE DISTRIBUYE la
   flota por comuna, no para ubicar un camión en una dirección exacta. El
   jitter determinístico separa los recintos de una misma comuna para que no
   queden apilados, y es estable: el mismo recinto cae siempre en el mismo
   lugar.

   Si algún día el proveedor del GPS expone las coordenadas de sus geocercas,
   esto se reemplaza por ese dato y el mapa pasa a ser exacto.
   ══════════════════════════════════════════════════════════════════════════ */

/* Bases propias — coordenadas reales, tomadas de mapa-retiros.html
   (Av. Américo Vespucio Norte 170, Pudahuel) */
var REDTEC_COORD = {
  'REDTEC':        [-70.76679, -33.45791],
  'REDTEC SANTIAGO':[-70.76679, -33.45791],
  'REDTEC TALCA':  [-71.6554,  -35.4264]
};

var RECINTOS = [{"k": "HALEON PUDAHUEL LA MARTINA 400", "n": "HALEON PUDAHUEL La Martina 400", "c": "PUDAHUEL", "z": "P1", "d": "LA MARTINA 400"}, {"k": "DEMARIA PALLET PARKING 5", "n": "DEMARIA PALLET PARKING 5", "c": "PUDAHUEL", "z": "P1", "d": "LA MARTINA 455, PUDAHUEL"}, {"k": "ENVASES CMF", "n": "ENVASES CMF", "c": "PUDAHUEL", "z": "P1", "d": "LA MARTINA 390"}, {"k": "EGA KAT LOGISTICA", "n": "EGA KAT LOGISTICA", "c": "PUDAHUEL", "z": "P1", "d": "BOULEVARD PONIENTE 900"}, {"k": "QUINTA VESPUCIO", "n": "QUINTA VESPUCIO", "c": "PUDAHUEL", "z": "P1", "d": "PUERTO VESPUCIO 9631"}, {"k": "QUINTA ENEA", "n": "QUINTA ENEA", "c": "PUDAHUEL", "z": "P1", "d": "JOSÉ MANUEL GUZMAN 1066"}, {"k": "CD PRE-UNIC", "n": "CD PRE-UNIC", "c": "PUDAHUEL", "z": "P1", "d": "CLAUDIO ARRAU 9482"}, {"k": "ZTT01 CD TOTTUS LA FARFANA", "n": "ZTT01 CD TOTTUS LA FARFANA", "c": "PUDAHUEL", "z": "P1", "d": "PUERTO MADERO 9710"}, {"k": "VIRUTEX CD PUDAHUEL", "n": "VIRUTEX CD Pudahuel", "c": "PUDAHUEL", "z": "P1", "d": "AV. EL PARQUE 1307"}, {"k": "DIST.CASANOVA SALAR DE ASCOTAN 1291 ENEA", "n": "DIST.CASANOVA Salar de Ascotan 1291 Enea", "c": "PUDAHUEL", "z": "P1", "d": "SALAR DE ASCOTAN 1291, ENEA"}, {"k": "INDUSTRIA DE ALIMENTOS TRENDY", "n": "INDUSTRIA DE ALIMENTOS TRENDY", "c": "PUDAHUEL", "z": "P1", "d": "LO ZAÑARTU 11"}, {"k": "HAMBURGO CD RENCA", "n": "HAMBURGO CD Renca", "c": "RENCA", "z": "P2", "d": "LUIS ALBERTO CRUZ 1181 RENCA"}, {"k": "ZAL03 CD ALVI AEROPARQUE", "n": "ZAL03 CD ALVI AEROPARQUE", "c": "PUDAHUEL", "z": "P2", "d": "AV. MIRAFLORES 9700"}, {"k": "ALIMENTOS ANDINO RENCA", "n": "ALIMENTOS ANDINO RENCA", "c": "RENCA", "z": "P2", "d": "AV VENTISQUERO 1220"}, {"k": "BRÜGGEN RENCA", "n": "Brüggen Renca", "c": "RENCA", "z": "P2", "d": "AV VENTISQUERO 1148"}, {"k": "ZWM08 WM RENTAPACK SANTIAGO", "n": "ZWM08 WM RENTAPACK SANTIAGO", "c": "QUILICURA", "z": "P2", "d": "CAMINO LO ECHEVERS 230"}, {"k": "LAF CD RENCA", "n": "LAF CD Renca", "c": "RENCA", "z": "P2", "d": "AV. VENTISQUERO 1180"}, {"k": "PRISA CD QUILICURA", "n": "PRISA CD Quilicura", "c": "PUDAHUEL", "z": "P2", "d": "AV MIRAFLORES 9700"}, {"k": "EMB. ANDINA PLANTA RENCA", "n": "EMB. ANDINA PLANTA RENCA", "c": "RENCA", "z": "P2", "d": "MIRAFLORES 9153"}, {"k": "MARINETTI QUILICURA CD", "n": "MARINETTI QUILICURA CD", "c": "RENCA", "z": "P2", "d": "AV AMERICO VESPUCIO 1751"}, {"k": "PIBAMOUR CD FRIO", "n": "PIBAMOUR CD FRIO", "c": "RENCA", "z": "P2", "d": "AV. AMÉRICO VESPUCIO 1955"}, {"k": "DEMARIA CD SANTIAGO", "n": "DEMARIA CD Santiago", "c": "QUILICURA", "z": "P2", "d": "CORDILLERA 401"}, {"k": "EMBO. METROPOLITANA QUILICURA", "n": "EMBO. METROPOLITANA Quilicura", "c": "QUILICURA", "z": "P2", "d": "PARINACOTA 340"}, {"k": "RABIE SANTIAGO", "n": "RABIE SANTIAGO", "c": "QUILICURA", "z": "P2", "d": "CAMINO LO ECHEVERS 311"}, {"k": "00748 HIPER RENCA", "n": "00748 HIPER RENCA", "c": "RENCA", "z": "P2", "d": "AV MIRAFLORES 8412"}, {"k": "TUCAPEL PRODUCCION SANTIAGO", "n": "TUCAPEL PRODUCCION SANTIAGO", "c": "PUDAHUEL", "z": "P2", "d": "VOLCÁN LICANCABUR 435"}, {"k": "TUCAPEL SA", "n": "TUCAPEL SA", "c": "PUDAHUEL", "z": "P2", "d": "VOLCÁN LICANCABUR 435"}, {"k": "00671 HIPER QUILICURA MARCOLETA", "n": "00671 HIPER QUILICURA Marcoleta", "c": "QUILICURA", "z": "P3", "d": "LO MARCOLETA 361"}, {"k": "00049 HIPER QUILICURA OHIGGINS", "n": "00049 HIPER QUILICURA Ohiggins", "c": "QUILICURA", "z": "P3", "d": "AV. BERNARDO O'HIGGINS 314"}, {"k": "00041 HIPER HUECHURABA", "n": "00041 HIPER HUECHURABA", "c": "HUECHURABA", "z": "P4", "d": "AVENIDA AMÉRICO VESPUCIO 1737"}, {"k": "RECUPAC S.A.", "n": "RECUPAC S.A.", "c": "HUECHURABA", "z": "P4", "d": "CALLE NUEVA 1821"}, {"k": "ZWM02 CD WM QUILICURA FRIO", "n": "ZWM02 CD WM QUILICURA FRIO", "c": "QUILICURA", "z": "P4", "d": "PRESIDENTE EDUARDO FREI MONTALVA 8301"}, {"k": "CASTANO QUILICURA", "n": "CASTANO QUILICURA", "c": "QUILICURA", "z": "P4", "d": "LAUTARO 361"}, {"k": "INDUSTRIAS CLEANER LAMPA", "n": "INDUSTRIAS CLEANER LAMPA", "c": "LAMPA", "z": "P4", "d": "EL ROBLE 160 LAMPA"}, {"k": "LESAFFRE CD", "n": "LESAFFRE CD", "c": "QUILICURA", "z": "P4", "d": "LAS ESTERAS NORTE 2751"}, {"k": "PIBAMOUR CD BUENAVENTURA", "n": "PIBAMOUR CD BUENAVENTURA", "c": "QUILICURA", "z": "P4", "d": "GUACOLDA 2152"}, {"k": "DEMARIA WAREHOUSING", "n": "DEMARIA WAREHOUSING", "c": "LAMPA", "z": "P4", "d": "EL PERAL 454, LAMPA"}, {"k": "MARGARITA UAUY E HIJOS", "n": "MARGARITA UAUY E HIJOS", "c": "LAMPA", "z": "P4", "d": "JUAN DE LA FUENTE 634"}, {"k": "NUTRISCO", "n": "NUTRISCO", "c": "COLINA", "z": "P4", "d": "AVENIDA PRESIDENTE EDUARDO FREI MONTALVA 15600"}, {"k": "DESA DIST ERRAZURRIZ LAMPA", "n": "DESA DIST ERRAZURRIZ LAMPA", "c": "LAMPA", "z": "P4", "d": "AV LA MONTAÑA 776"}, {"k": "INTERCOS COLINA", "n": "INTERCOS COLINA", "c": "COLINA", "z": "P4", "d": "MANUEL RODRIGUEZ 69"}, {"k": "INTERCOS SIM", "n": "INTERCOS SIM", "c": "ESTACION CENTRAL", "z": "P4", "d": "AV. GLADYS MARÍN MILLIE 6366"}, {"k": "COMERCIAL CANADA QUILICURA", "n": "COMERCIAL CANADA Quilicura", "c": "COLINA", "z": "P4", "d": "BERNARDO O'HIGGINS 158"}, {"k": "INDUSTRIAS CLEANER SCALPI QUILICURA LAUTARO 3005", "n": "INDUSTRIAS CLEANER Scalpi Quilicura Lautaro 3005", "c": "QUILICURA", "z": "P4", "d": "Lautaro 3005"}, {"k": "MARITANO CD HUECHURABA", "n": "MARITANO CD HUECHURABA", "c": "HUECHURABA", "z": "P5", "d": "CONQUISTADOR DEL MONTE 4776"}, {"k": "00086 HIPER RECOLETA", "n": "00086 HIPER RECOLETA", "c": "RECOLETA", "z": "P6", "d": "AV RECOLETA 3501"}, {"k": "DEMARIA MEGA CARRASCAL", "n": "DEMARIA MEGA CARRASCAL", "c": "CERRO NAVIA", "z": "P7", "d": "CERAMICA 2371, CERRO NAVIA"}, {"k": "TEBA JJ PEREZ AV. J.J PEREZ #6142 CERRO NAVIA", "n": "TEBA JJ PEREZ Av. J.J Perez #6142 Cerro Navia", "c": "CERRO NAVIA", "z": "P7", "d": "AV. J.J PÉREZ #6142 CERRO NAVIA"}, {"k": "PF SANTIAGO PLANTA", "n": "PF SANTIAGO PLANTA", "c": "RENCA", "z": "P8", "d": "AV PRESIDENTE EDUARDO FREI MONTALVA  3900"}, {"k": "TEBA LO VALLEDOR AV.GRL.VELAZQUEZ #3409 CERRILLOS", "n": "TEBA LO VALLEDOR Av.Grl.Velázquez #3409 Cerrillos", "c": "CERRILLOS", "z": "P10", "d": "GENERAL VELÁSQUEZ 3409"}, {"k": "MARGOT IRENE RIVERA VILLA", "n": "MARGOT IRENE RIVERA VILLA", "c": "MAIPU", "z": "P10", "d": "AVENIDA LO ESPEJO 860"}, {"k": "PRISA PRILOGIC", "n": "PRISA PRILOGIC", "c": "CERRILLOS", "z": "P10", "d": "LAS AMERICAS 777"}, {"k": "VIRUTEX MELIPILLA", "n": "VIRUTEX MELIPILLA", "c": "CERRILLOS", "z": "P10", "d": "AV PEDRO AGUIRRE CERDA 7875"}, {"k": "MOL HEREDIA MAIPU PLANTA", "n": "MOL HEREDIA MAIPU PLANTA", "c": "MAIPU", "z": "P10", "d": "CAMINO A MELIPILLA 9780"}, {"k": "COMERCIAL CASTRO CD CERRILLOS", "n": "COMERCIAL CASTRO CD CERRILLOS", "c": "CERRILLOS", "z": "P10", "d": "AVENIDA LOS CERRILLOS 4030"}, {"k": "COMERCIAL ANDEN SALZ PLANTA", "n": "COMERCIAL ANDEN SALZ PLANTA", "c": "MAIPU", "z": "P10", "d": "SAN AGUSTIN 11130"}, {"k": "COMERCIAL ECCSA SAN BERNARDO", "n": "COMERCIAL ECCSA San Bernardo", "c": "SAN BERNARDO", "z": "P10", "d": "AVENIDA ROBERTO SIMPSON CLARO 1200, SAN BERNARDO"}, {"k": "ZSB CD SALCO BRAND", "n": "ZSB CD SALCO BRAND", "c": "SAN BERNARDO", "z": "P10", "d": "GENERAL VELASQUEZ 9981"}, {"k": "VETERQUIMICA S.A.", "n": "VETERQUIMICA S.A.", "c": "MAIPU", "z": "P10", "d": "CAMINO A LONQUÉN 10387, MAIPÚ"}, {"k": "BALLERINA PLANTA CERRILLOS", "n": "BALLERINA Planta Cerrillos", "c": "CERRILLOS", "z": "P10", "d": "ANTONIO ESCOBAR WILLIAMS 190 CERRILLOS"}, {"k": "ARCOR CERRILLOS GRAL. VELASQUEZ 9309", "n": "ARCOR CERRILLOS Gral. Velasquez 9309", "c": "CERRILLOS", "z": "P10", "d": "Gral. Velasquez 9309"}, {"k": "DEMARIA MAQUILA LAB. DUKAY", "n": "DEMARIA MAQUILA LAB. DUKAY", "c": "LAMPA", "z": "P12", "d": "EL TAQUERAL 454"}, {"k": "INTERCOS DUKAY", "n": "INTERCOS DUKAY", "c": "LAMPA", "z": "P12", "d": "EL TAQUERAL 454"}, {"k": "CD FASA", "n": "CD FASA", "c": "PUDAHUEL", "z": "P13", "d": "LOS VIENTOS 19867"}, {"k": "IFCO CHILE QUILICURA", "n": "IFCO CHILE Quilicura", "c": "PUDAHUEL", "z": "P13", "d": "AV. NUEVA UNO 17580"}, {"k": "ZCS01 CD CENCOSUD NOVICIADO", "n": "ZCS01 CD CENCOSUD NOVICIADO", "c": "PUDAHUEL", "z": "P13", "d": "AV. NUEVA UNO 17580"}, {"k": "ZWM01 CD WM LO AGUIRRE SECO", "n": "ZWM01 CD WM LO AGUIRRE SECO", "c": "PUDAHUEL", "z": "P13", "d": "CAMINO LOS VIENTOS 20254"}, {"k": "ZUN01 CD UNIMARC LO AGUIRRE", "n": "ZUN01 CD UNIMARC LO AGUIRRE", "c": "PUDAHUEL", "z": "P13", "d": "LO AGUIRRE 537"}, {"k": "PROALSA CD LO AGUIRRE", "n": "PROALSA CD Lo Aguirre", "c": "PUDAHUEL", "z": "P13", "d": "MARIA LUISA ETCHART NORTE 21201"}, {"k": "ZCS07 CD CENCOSUD LO AGUIRRE", "n": "ZCS07 CD CENCOSUD LO AGUIRRE", "c": "PUDAHUEL", "z": "P13", "d": "LO AGUIRRE SUR 1200 PARCELA 2"}, {"k": "INDUSTRIAS CLEANER D Y C SAN BERNARDO", "n": "INDUSTRIAS CLEANER D y C San Bernardo", "c": "SAN BERNARDO", "z": "P14", "d": "LA DIVISA 900, SAN BERNARDO"}, {"k": "INTERCARRY CD LO ESPEJO", "n": "INTERCARRY CD LO ESPEJO", "c": "SAN BERNARDO", "z": "P14", "d": "PDTE. JORGE ALESSANDRI RODRÍGUEZ 9243"}, {"k": "NUTRATRADE S.A - LAS ACACIAS", "n": "NUTRATRADE S.A - Las acacias", "c": "SAN BERNARDO", "z": "P14", "d": "AV LAS ACACIAS 2120"}, {"k": "COMERCIAL NABEK SPA", "n": "COMERCIAL NABEK SPA", "c": "LA PINTANA", "z": "P15", "d": "AV LO BLANCO 2561"}, {"k": "TEBA LO BLANCO AV. LO BLANCO #2561 LA PINTANA", "n": "TEBA LO BLANCO Av. Lo Blanco #2561 La Pintana", "c": "LA PINTANA", "z": "P15", "d": "AV LO BLANCO 2561"}, {"k": "TEBA GRAN AVENIDA AV. JOSE MIGUEL CARERRA 13365", "n": "TEBA GRAN AVENIDA Av. José Miguel Carerra 13365", "c": "SAN BERNARDO", "z": "P15", "d": "GRAN AVENIDA JOSÉ MIGUEL CARRERA 13365, SAN BERNARDO"}, {"k": "NUTRATRADE S.A - LOS PINOS", "n": "NUTRATRADE S.A - Los pinos", "c": "SAN BERNARDO", "z": "P15", "d": "CAMINO LOS PINOS 32"}, {"k": "DISTRIBUIDORA LAGOS SAN BDO", "n": "DISTRIBUIDORA LAGOS SAN BDO", "c": "SAN BERNARDO", "z": "P15", "d": "CAMINO LA VARA 03795"}, {"k": "00693 HIPER LA PINTANA", "n": "00693 HIPER LA PINTANA", "c": "LA PINTANA", "z": "P16", "d": "AV GABRIELA 2541"}, {"k": "MOLINO PUENTE ALTO CD", "n": "MOLINO PUENTE ALTO CD", "c": "PUENTE ALTO", "z": "P16", "d": "BALMACEDA 27"}, {"k": "SOFTYS PLANTA PUENTE ALTO", "n": "Softys Planta Puente Alto", "c": "PUENTE ALTO", "z": "P16", "d": "COMPANIA MANUFACTURERA DE PAPELES Y CARTONES, PUENTE ALTO, REGIÓN METROPOLITANA, CHILE"}, {"k": "COLGATE INOCUO CBP", "n": "COLGATE INOCUO CBP", "c": "PUDAHUEL", "z": "P17", "d": "CAMINO EL NOVICIADO 3707"}, {"k": "VIRUTEX MAMUT SAN JOAQUIN", "n": "VIRUTEX MAMUT SAN JOAQUIN", "c": "SAN JOAQUIN", "z": "P18", "d": "PACIFICO 254, SAN JOAQUIN"}, {"k": "00682 HIPER SAN JOAQUIN", "n": "00682 HIPER SAN JOAQUIN", "c": "SAN JOAQUIN", "z": "P18", "d": "VICUÑA MACKENNA 3361"}, {"k": "00076 HIPER DEPARTAMENTAL", "n": "00076 HIPER DEPARTAMENTAL", "c": "LA FLORIDA", "z": "P18", "d": "VESPUCIO 6325"}, {"k": "INTERCARRY CD MACUL", "n": "INTERCARRY CD Macul", "c": "MACUL", "z": "P18", "d": "AV VICUÑA MACKENNA 3350"}, {"k": "PROCTER AND GAMBLE", "n": "PROCTER AND GAMBLE", "c": "MACUL", "z": "P18", "d": "AYSEN 321"}, {"k": "DEMARIA MEGA NOVICIADO", "n": "DEMARIA MEGA NOVICIADO", "c": "LAMPA", "z": "P19", "d": "CAMINO EL NOVICIADO 1107, LAMPA"}, {"k": "COLGATE - IMO CBP", "n": "COLGATE - IMO CBP", "c": "LAMPA", "z": "P19", "d": "CHORRILLOS UNO"}, {"k": "NESTLE MAIPU C. MELIPILLA 15300", "n": "NESTLE MAIPÚ C. Melipilla 15300", "c": "MAIPU", "z": "P21", "d": "C. Melipilla 15300"}, {"k": "GOOD FOOD CD", "n": "GOOD FOOD CD", "c": "PENAFLOR", "z": "P22", "d": "AV BALMACEDA 3050"}, {"k": "WOODPALLETS", "n": "WOODPALLETS", "c": "TALAGANTE", "z": "P23", "d": "CAMINO LONQUEN SUR 5160"}, {"k": "SOFTYS PLANTA TALAGANTE", "n": "SOFTYS PLANTA TALAGANTE", "c": "TALAGANTE", "z": "P24", "d": "JAIME GUZMÁN 4685"}, {"k": "PAIMASA ISLA DE MAIPO", "n": "PAIMASA ISLA DE MAIPO", "c": "ISLA DE MAIPO", "z": "P24", "d": "JAIME GUZMAN 4078"}, {"k": "THE PROTEIN COMPANY PAINE", "n": "THE PROTEIN COMPANY Paine", "c": "PAINE", "z": "P25", "d": "PAINE, REGIÓN METROPOLITANA, CHILE"}, {"k": "ZWM11 CD WM EL PENON", "n": "ZWM11 CD WM EL PEÑON", "c": "SAN BERNARDO", "z": "P26", "d": "AV. JORGE ALESSANDRI RODRIGUEZ 18899"}, {"k": "SIADTALEB SAN BERNANDO CD BARRANCON 2080", "n": "SIADTALEB  SAN BERNANDO CD Barrancon 2080", "c": "SAN BERNARDO", "z": "P26", "d": "Barrancon 2080"}, {"k": "M3034 MAYORISTA 10 RENGO", "n": "M3034 MAYORISTA 10 RENGO", "c": "RENGO", "z": "P27", "d": "ARTURO PRAT 607"}, {"k": "ALIFRUT RENGO PLANTA", "n": "ALIFRUT RENGO PLANTA", "c": "RENGO", "z": "P27", "d": "JUAN EGENAU PONIENTE 1655"}, {"k": "BODEGA SOFTYS SAN ANTONIO ULOG", "n": "BODEGA SOFTYS SAN ANTONIO ULOG", "c": "SAN ANTONIO", "z": "P28", "d": "RUTA G86, AGUAS BUENAS N° 6729, CRUCE A CARTAGENA, 2660000 SAN ANTONIO, VALPARAÍSO, CHILE"}, {"k": "INDUSTRIAS CLEANER MANUCHAR SAN ANTONIO", "n": "INDUSTRIAS CLEANER Manuchar San Antonio", "c": "SAN ANTONIO", "z": "P28", "d": "LAS ACACIAS 362, SECTOR AGUAS BUENAS, SAN ANTONIO"}, {"k": "INDUSTRIAS CLEANER MANUCHAR", "n": "INDUSTRIAS CLEANER Manuchar", "c": "SAN ANTONIO", "z": "P28", "d": "LAS ACACIAS 362, SECTOR AGUAS BUENAS, SAN ANTONIO"}, {"k": "CAMBIASO VALPARAISO CD", "n": "CAMBIASO Valparaiso CD", "c": "PLACILLA", "z": "P29", "d": "EL SAUCE 851"}, {"k": "SOFTYS TEXVAL", "n": "Softys TEXVAL", "c": "VALPARAISO", "z": "P29", "d": "PLACILLA, VALPARAÍSO, CHILE"}, {"k": "COMERCIALIZADORA PANOR", "n": "COMERCIALIZADORA PANOR", "c": "VALPARAISO", "z": "P29", "d": "CERRO EL ALTAR 3580"}, {"k": "COMERCIAL ROCKY S.A.", "n": "COMERCIAL ROCKY S.A.", "c": "HIJUELAS", "z": "P30", "d": "FUNDO LAS ENCINAS LOTE 1 VISTA HERMOSA OCOA, HIJUELAS, VALPARAÍSO, CHILE"}, {"k": "ACONCAGUA FOODS", "n": "ACONCAGUA FOODS", "c": "BUIN", "z": "P31", "d": "JOSE ALBERTO BRAVO 278, BUIN"}, {"k": "INDUSTRIAS CLEANER EMPREPA RENCA", "n": "INDUSTRIAS CLEANER Emprepa Renca", "c": "RENCA", "z": "P2", "d": "Av. José Miguel Infante 8765, Renca"}, {"k": "DOS BANDERAS SANTIAGO", "n": "DOS BANDERAS Santiago", "c": "QUILICURA", "z": "P2", "d": "PARINACOTA 340 QUILICURA"}, {"k": "DOS BANDERAS PUDAHUEL BODEGA LEVEL", "n": "DOS BANDERAS Pudahuel Bodega Level", "c": "PUDAHUEL", "z": "P2", "d": "MIRAFLORES 9700"}];

/* Centroides aproximados (lon, lat). Las 27 primeras vienen del catálogo
   original; el resto se agregó al ver las comunas que aparecen en las
   direcciones sin geocerca del GPS. */
var COMUNA_CENT = {"BUIN": [-70.7411, -33.7333], "CERRILLOS": [-70.718, -33.496], "CERRO NAVIA": [-70.742, -33.421], "COLINA": [-70.672, -33.202], "ESTACION CENTRAL": [-70.696, -33.46], "HUECHURABA": [-70.639, -33.367], "ISLA DE MAIPO": [-70.898, -33.752], "LA FLORIDA": [-70.568, -33.532], "LA PINTANA": [-70.63, -33.583], "LAMPA": [-70.876, -33.284], "MACUL": [-70.598, -33.49], "MAIPU": [-70.758, -33.517], "PAINE": [-70.741, -33.808], "PENAFLOR": [-70.876, -33.61], "PUDAHUEL": [-70.75, -33.442], "PUENTE ALTO": [-70.575, -33.611], "QUILICURA": [-70.729, -33.36], "RECOLETA": [-70.641, -33.402], "RENCA": [-70.728, -33.406], "SAN BERNARDO": [-70.7, -33.592], "SAN JOAQUIN": [-70.628, -33.497], "TALAGANTE": [-70.931, -33.664], "SAN ANTONIO": [-71.613, -33.593], "VALPARAISO": [-71.613, -33.047], "PLACILLA": [-71.568, -33.116], "HIJUELAS": [-71.133, -32.806], "RENGO": [-70.86, -34.406], "SANTIAGO": [-70.65, -33.442], "QUINTA NORMAL": [-70.7, -33.432], "CONCHALI": [-70.675, -33.383], "INDEPENDENCIA": [-70.664, -33.415], "PROVIDENCIA": [-70.61, -33.43], "NUNOA": [-70.598, -33.456], "LAS CONDES": [-70.545, -33.408], "VITACURA": [-70.578, -33.38], "LO BARNECHEA": [-70.48, -33.35], "LA REINA": [-70.545, -33.445], "PENALOLEN": [-70.545, -33.49], "SAN MIGUEL": [-70.652, -33.497], "PEDRO AGUIRRE CERDA": [-70.674, -33.487], "LO ESPEJO": [-70.688, -33.52], "LA CISTERNA": [-70.662, -33.533], "EL BOSQUE": [-70.675, -33.562], "LA GRANJA": [-70.628, -33.541], "SAN RAMON": [-70.645, -33.538], "LO PRADO": [-70.722, -33.443], "TIL TIL": [-70.93, -33.087], "CURACAVI": [-71.15, -33.4], "MELIPILLA": [-71.215, -33.688], "EL MONTE": [-70.983, -33.68], "CALERA DE TANGO": [-70.78, -33.62], "PIRQUE": [-70.59, -33.67], "SAN JOSE DE MAIPO": [-70.35, -33.64], "PADRE HURTADO": [-70.815, -33.573], "TALCA": [-71.665, -35.426], "SAN JAVIER": [-71.73, -35.594], "LINARES": [-71.597, -35.846], "LOS ANGELES": [-72.351, -37.469], "CHILLAN": [-72.103, -36.606], "TEMUCO": [-72.59, -38.735], "PUERTO MONTT": [-72.941, -41.469], "CONCEPCION": [-73.05, -36.827], "CORONEL": [-73.132, -37.026], "TALCAHUANO": [-73.117, -36.717], "OSORNO": [-73.133, -40.573], "LA CALERA": [-71.192, -32.788], "QUILLOTA": [-71.247, -32.88], "LIMACHE": [-71.267, -33.017], "LOS ANDES": [-70.598, -32.834], "SAN FELIPE": [-70.725, -32.75], "RANCAGUA": [-70.745, -34.17], "SANTA CRUZ": [-71.365, -34.639], "VALDIVIA": [-73.245, -39.814], "MELIPILLA CENTRO": [-71.215, -33.688], "COQUIMBO": [-71.3436, -29.9533], "LA SERENA": [-71.2542, -29.9027], "OVALLE": [-71.1994, -30.6017], "ILLAPEL": [-71.1667, -31.63], "VICUNA": [-70.71, -30.032], "COPIAPO": [-70.332, -27.366], "VALLENAR": [-70.758, -28.576], "ANTOFAGASTA": [-70.4, -23.65], "CALAMA": [-68.933, -22.455], "IQUIQUE": [-70.14, -20.214], "ARICA": [-70.312, -18.478], "PAN DE AZUCAR": [-71.309, -29.966], "CURICO": [-71.239, -34.983], "SAN RAFAEL": [-71.513, -35.017], "MOLINA": [-71.282, -35.113], "COLBUN": [-71.411, -35.696], "PANGUILEMO": [-71.62, -35.363], "SAN CLEMENTE": [-71.485, -35.537], "CONSTITUCION": [-72.411, -35.333], "PARRAL": [-71.829, -36.143], "CAUQUENES": [-72.352, -35.967], "SAN CARLOS": [-71.96, -36.424], "COCHARCAS": [-72.043, -36.531], "NIQUEN": [-71.94, -36.29], "CHILLAN VIEJO": [-72.122, -36.623], "BULNES": [-72.298, -36.742], "COELEMU": [-72.705, -36.487], "QUILLON": [-72.468, -36.737], "YUMBEL": [-72.568, -37.098], "SAN PEDRO DE LA PAZ": [-73.1, -36.84], "CHIGUAYANTE": [-73.027, -36.925], "HUALPEN": [-73.093, -36.793], "PENCO": [-72.995, -36.74], "LOTA": [-73.156, -37.09], "ARAUCO": [-73.317, -37.246], "CANETE": [-73.398, -37.801], "ANGOL": [-72.707, -37.797], "VICTORIA": [-72.334, -38.231], "LAUTARO": [-72.436, -38.531], "PUCON": [-71.955, -39.27], "VILLARRICA": [-72.227, -39.281], "LONCOCHE": [-72.632, -39.37], "LA UNION": [-73.083, -40.292], "RIO BUENO": [-72.952, -40.332], "PAILLACO": [-72.87, -40.068], "PUERTO VARAS": [-72.984, -41.319], "CASTRO": [-73.765, -42.482], "ANCUD": [-73.829, -41.867], "COYHAIQUE": [-72.066, -45.571], "PUNTA ARENAS": [-70.917, -53.162], "PUERTO NATALES": [-72.506, -51.723], "CHIMBARONGO": [-71.043, -34.713], "SAN FERNANDO": [-70.986, -34.586], "PEUMO": [-71.171, -34.393], "SAN VICENTE": [-71.079, -34.437], "PICHILEMU": [-72.013, -34.387], "PALMILLA": [-71.361, -34.594], "NANCAGUA": [-71.21, -34.667], "MACHALI": [-70.651, -34.181], "GRANEROS": [-70.728, -34.068], "CATEMU": [-70.96, -32.783], "PANQUEHUE": [-70.857, -32.813], "LLAY LLAY": [-70.96, -32.844], "NOGALES": [-71.208, -32.74], "OLMUE": [-71.188, -32.999], "VILLA ALEMANA": [-71.373, -33.042], "QUILPUE": [-71.442, -33.047], "CONCON": [-71.526, -32.926], "VINA DEL MAR": [-71.552, -33.024], "CASABLANCA": [-71.409, -33.321], "ALGARROBO": [-71.669, -33.367], "CARTAGENA": [-71.606, -33.546], "EL QUISCO": [-71.69, -33.4], "SAN ANTONIO CENTRO": [-71.613, -33.593]};


/* ── COORDENADAS REALES ──────────────────────────────────────────────────
   Geocodificadas UNA VEZ contra Nominatim (OpenStreetMap) usando la dirección
   que ya trae cada recinto en el catálogo, y validadas: se descartó cualquier
   resultado fuera de Chile o a más de 22 km del centroide de su propia comuna.
   97 de 110 quedaron con coordenada exacta; el resto sigue cayendo en el
   centroide de su comuna.

   Esto NO se consulta en tiempo de ejecución: son valores fijos acá. El mapa
   no depende de ningún servicio externo de geocodificación.

   Motivo: el mapa dibujaba DEMARIA CD SANTIAGO —que el catálogo ubica en
   Quilicura— dentro de Quinta Normal, porque el centroide de comuna más un
   jitter de 5 km puede sacar un punto de su propia comuna. Con la dirección
   geocodificada el pin cae donde está el recinto de verdad. */
var COORD_RECINTO = {"HALEON PUDAHUEL LA MARTINA 400": [-70.7746,-33.45533],"DEMARIA PALLET PARKING 5": [-70.7746,-33.45533],"ENVASES CMF": [-70.7746,-33.45533],"EGA KAT LOGISTICA": [-70.79405,-33.43061],"QUINTA VESPUCIO": [-70.78191,-33.44909],"QUINTA ENEA": [-70.77201,-33.42769],"CD PRE-UNIC": [-70.76545,-33.4496],"ZTT01 CD TOTTUS LA FARFANA": [-70.77817,-33.4508],"VIRUTEX CD PUDAHUEL": [-70.80076,-33.43446],"DIST.CASANOVA SALAR DE ASCOTAN 1291 ENEA": [-70.77659,-33.43245],"HAMBURGO CD RENCA": [-70.76395,-33.4077],"ZAL03 CD ALVI AEROPARQUE": [-70.77695,-33.39148],"ALIMENTOS ANDINO RENCA": [-70.76684,-33.40726],"BRÜGGEN RENCA": [-70.76684,-33.40726],"ZWM08 WM RENTAPACK SANTIAGO": [-70.75261,-33.37492],"LAF CD RENCA": [-70.76684,-33.40726],"PRISA CD QUILICURA": [-70.77695,-33.39148],"EMB. ANDINA PLANTA RENCA": [-70.75036,-33.40123],"MARINETTI QUILICURA CD": [-70.76264,-33.39117],"PIBAMOUR CD FRIO": [-70.78046,-33.40384],"DEMARIA CD SANTIAGO": [-70.7617,-33.37782],"EMBO. METROPOLITANA QUILICURA": [-70.75025,-33.3661],"RABIE SANTIAGO": [-70.7478,-33.37604],"00748 HIPER RENCA": [-70.74562,-33.40255],"TUCAPEL PRODUCCION SANTIAGO": [-70.77892,-33.38404],"TUCAPEL SA": [-70.77892,-33.38404],"00671 HIPER QUILICURA MARCOLETA": [-70.74664,-33.35886],"00049 HIPER QUILICURA OHIGGINS": [-70.72766,-33.35627],"00041 HIPER HUECHURABA": [-70.67986,-33.36584],"RECUPAC S.A.": [-70.67833,-33.36222],"ZWM02 CD WM QUILICURA FRIO": [-70.69769,-33.36107],"CASTANO QUILICURA": [-70.70317,-33.34221],"INDUSTRIAS CLEANER LAMPA": [-70.73095,-33.31462],"LESAFFRE CD": [-70.72124,-33.34351],"PIBAMOUR CD BUENAVENTURA": [-70.70632,-33.33797],"DEMARIA WAREHOUSING": [-70.73706,-33.32611],"MARGARITA UAUY E HIJOS": [-70.7247,-33.32214],"NUTRISCO": [-70.71871,-33.32409],"DESA DIST ERRAZURRIZ LAMPA": [-70.72397,-33.31335],"INTERCOS COLINA": [-70.69172,-33.2306],"COMERCIAL CANADA QUILICURA": [-70.71787,-33.30137],"INDUSTRIAS CLEANER SCALPI QUILICURA LAUTARO 3005": [-70.70809,-33.3446],"MARITANO CD HUECHURABA": [-70.65151,-33.37164],"00086 HIPER RECOLETA": [-70.64123,-33.39359],"DEMARIA MEGA CARRASCAL": [-70.72208,-33.41531],"PF SANTIAGO PLANTA": [-70.67843,-33.41885],"TEBA LO VALLEDOR AV.GRL.VELAZQUEZ #3409 CERRILLOS": [-70.70627,-33.53105],"MARGOT IRENE RIVERA VILLA": [-70.73411,-33.52098],"PRISA PRILOGIC": [-70.70728,-33.49197],"VIRUTEX MELIPILLA": [-70.71636,-33.50719],"MOL HEREDIA MAIPU PLANTA": [-70.78084,-33.54386],"COMERCIAL CASTRO CD CERRILLOS": [-70.70267,-33.49747],"COMERCIAL ANDEN SALZ PLANTA": [-70.73931,-33.52504],"ZSB CD SALCO BRAND": [-70.71001,-33.54343],"VETERQUIMICA S.A.": [-70.7601,-33.56264],"BALLERINA PLANTA CERRILLOS": [-70.69701,-33.48503],"ARCOR CERRILLOS GRAL. VELASQUEZ 9309": [-70.68861,-33.48465],"DEMARIA MAQUILA LAB. DUKAY": [-70.78455,-33.31143],"INTERCOS DUKAY": [-70.78455,-33.31143],"CD FASA": [-70.85101,-33.44866],"IFCO CHILE QUILICURA": [-70.84058,-33.45119],"ZCS01 CD CENCOSUD NOVICIADO": [-70.84058,-33.45119],"ZUN01 CD UNIMARC LO AGUIRRE": [-70.82199,-33.4566],"PROALSA CD LO AGUIRRE": [-70.85727,-33.45947],"INDUSTRIAS CLEANER D Y C SAN BERNARDO": [-70.69794,-33.54533],"INTERCARRY CD LO ESPEJO": [-70.7101,-33.55947],"NUTRATRADE S.A - LAS ACACIAS": [-70.71,-33.55375],"COMERCIAL NABEK SPA": [-70.63296,-33.58841],"TEBA LO BLANCO AV. LO BLANCO #2561 LA PINTANA": [-70.63296,-33.58841],"TEBA GRAN AVENIDA AV. JOSE MIGUEL CARERRA 13365": [-70.69385,-33.57843],"NUTRATRADE S.A - LOS PINOS": [-70.71889,-33.57111],"DISTRIBUIDORA LAGOS SAN BDO": [-70.71059,-33.56716],"00693 HIPER LA PINTANA": [-70.62798,-33.58538],"MOLINO PUENTE ALTO CD": [-70.57418,-33.61304],"COLGATE INOCUO CBP": [-70.85226,-33.40116],"VIRUTEX MAMUT SAN JOAQUIN": [-70.63735,-33.48119],"00682 HIPER SAN JOAQUIN": [-70.62226,-33.48432],"00076 HIPER DEPARTAMENTAL": [-70.59162,-33.51132],"INTERCARRY CD MACUL": [-70.62065,-33.48284],"PROCTER AND GAMBLE": [-70.61733,-33.48362],"DEMARIA MEGA NOVICIADO": [-70.85409,-33.37916],"COLGATE - IMO CBP": [-70.83369,-33.35426],"NESTLE MAIPU C. MELIPILLA 15300": [-70.7537,-33.52568],"GOOD FOOD CD": [-70.87242,-33.62972],"WOODPALLETS": [-70.84954,-33.67572],"SOFTYS PLANTA TALAGANTE": [-70.91538,-33.66425],"PAIMASA ISLA DE MAIPO": [-70.90997,-33.75959],"THE PROTEIN COMPANY PAINE": [-70.86063,-33.81182],"ZWM11 CD WM EL PENON": [-70.71905,-33.62066],"SIADTALEB SAN BERNANDO CD BARRANCON 2080": [-70.71813,-33.61252],"M3034 MAYORISTA 10 RENGO": [-70.85156,-34.39732],"CAMBIASO VALPARAISO CD": [-71.56643,-33.11349],"COMERCIALIZADORA PANOR": [-71.5558,-33.13181],"ACONCAGUA FOODS": [-70.73128,-33.7345],"INDUSTRIAS CLEANER EMPREPA RENCA": [-70.77567,-33.40337],"DOS BANDERAS SANTIAGO": [-70.75025,-33.3661],"DOS BANDERAS PUDAHUEL BODEGA LEVEL": [-70.75649,-33.45557]};


/* ── COORDENADAS DEL MAPA DE CLIENTES DE REDTEC ─────────────────────────
   Fuente: el Google My Maps "Clientes Redtec" que mantiene la empresa
   (199 clientes, 31 polígonos de zona, 52 comunas y 104 pórticos). Estas
   son las coordenadas BUENAS: las puso REDTEC, no un geocodificador.
   86 de las geocercas que el GPS reporta calzan por nombre con un cliente
   de ese mapa. Tienen PRIORIDAD sobre lo geocodificado en Nominatim.
   La clave es el nombre de la geocerca normalizado. */
var COORD_GPS = {"00159 MAYORISTA SAN LUIS": [-70.5886, -33.507],
  "ZCS01 CD CENCOSUD NOVICIADO": [-70.8189, -33.4265],
  "ZWM11 CD WM EL PENON": [-70.7181, -33.6189],
  "CAMBIASO VALPARAISO CD": [-71.5712, -33.1136],
  "ZWM02 CD WM QUILICURA FRIO": [-70.6941, -33.3604],
  "LAF CD RENCA": [-70.7665, -33.4023],
  "PRODUCTOS FERNANDEZ PZ": [-71.6295, -35.4163],
  "ZUN01 CD UNIMARC LO AGUIRRE": [-70.8587, -33.4523],
  "HAMBURGO CD RENCA": [-70.7637, -33.4077],
  "ZWM01 CD WM LO AGUIRRE SECO": [-70.8517, -33.4489],
  "ZAL03 CD ALVI AEROPARQUE": [-70.7762, -33.3944],
  "MOLINO PUENTE ALTO S A": [-70.5745, -33.6114],
  "PRODUCTOS FERNANDEZ P2": [-71.6364, -35.4226],
  "TEBA LO BLANCO": [-70.633, -33.5885],
  "CD TOTTUS LA FARFANA": [-70.8077, -33.4573],
  "00049 HIPER QUILICURA OHIGGINS": [-70.7288, -33.3557],
  "ZCS04 CD CENCOSUD CHILLAN": [-72.2529, -36.6892],
  "EMBOTELLADORA METROPOLITANA": [-70.7581, -33.3795],
  "COMERCIALIZADORA PANOR SPA": [-71.555, -33.1323],
  "DESA DIST ERRAZURRIZ": [-70.7312, -33.3167],
  "PF SANTIAGO PLANTA": [-70.6862, -33.397],
  "EMBOTELLADORA EMSA COLBUN": [-71.4308, -35.7957],
  "INTERCOS COLINA": [-70.7101, -33.3038],
  "COLGATE CALYCO CBP": [-70.8478, -33.4081],
  "CASTANO CD QULICURA": [-70.7034, -33.3438],
  "ZWM08 WM RENTAPACK SANTIAGO": [-70.7516, -33.375],
  "DEMARIA CD SANTIAGO": [-70.761, -33.3775],
  "MOLINERA HEREDIA LTDA": [-70.732, -33.5159],
  "ALIMENTOS Y FRUTOS SA ALIFRUT": [-70.8709, -34.3971],
  "THE PROTEIN COMPANY": [-70.7432, -33.7746],
  "M3069 MAYORISTA 10 SANTA CRUZ": [-71.3676, -34.6424],
  "00626 HIPER PPE GALES": [-70.535, -33.4406],
  "CD PRE UNIC": [-70.7716, -33.4482],
  "GOOD FOOD": [-70.8713, -33.6293],
  "PIBAMOUR CD BUENAVENTURA": [-70.7087, -33.335],
  "COMERCIAL ANDEN SALZ LIMITADA": [-70.7395, -33.5249],
  "00748 HIPER RENCA": [-70.7583, -33.3996],
  "COLGATE BUNKER CALYCO": [-70.8242, -33.3521],
  "TAK S A": [-71.4555, -35.2392],
  "EMBOTELLADORA DOS BANDERAS CORONEL": [-73.1448, -36.987],
  "CENCOCAL LA CALERA": [-71.1967, -32.7448],
  "DIMAK CORONEL": [-73.166, -36.9758],
  "M3007 MAYORISTA 10 BELLOTO": [-71.4189, -33.0436],
  "PRISA PRILOGIC": [-70.7131, -33.4897],
  "QUINTA VESPUCIO": [-70.781, -33.4491],
  "M3034 MAYORISTA 10 RENGO": [-70.857, -34.4044],
  "00602 HIPER LOS ANDES": [-70.6054, -32.835],
  "00083 HIPER SANTA AMALIA": [-70.5707, -33.5451],
  "00983 HIPER LA CALERA": [-71.2038, -32.7977],
  "VIRUTEX CD MELIPILLA": [-70.7169, -33.5063],
  "ZSB CD SALCOBRAND": [-70.7089, -33.544],
  "INTERCARRY CD LO ESPEJO": [-70.6879, -33.5417],
  "ZUN03 CD UNIMARC CONCEPCION": [-73.1424, -36.8721],
  "DISTRIBUIDORA LAGOS": [-70.7209, -33.5667],
  "ZR020 AGRICOLA Y FORESTAL EL PEUMO": [-70.8551, -34.1948],
  "ZUN02 CD UNIMARC PUERTO MONTT": [-72.9905, -41.4694],
  "TEBA GRAN AVENIDA": [-70.6932, -33.5774],
  "00086 HIPER RECOLETA": [-70.6413, -33.3933],
  "HALEON CHILE SPA": [-70.7767, -33.4571],
  "PRODUCTOS FERNANDEZ P1": [-71.6498, -35.4252],
  "00671 HIPER QUILICURA MARCOLETA": [-70.7464, -33.3593],
  "TEBA JJ PEREZ": [-70.7208, -33.4308],
  "RABIE SANTIAGO": [-70.7565, -33.3748],
  "EMPRESAS TUCAPEL S A": [-70.7793, -33.3824],
  "CD FASA": [-70.8482, -33.4476],
  "INTERCOS DUKAY": [-70.7478, -33.281],
  "DIMAK OSORNO": [-73.0983, -40.5977],
  "ZCU01 CD CUGAT RANCAGUA MALL": [-70.795, -34.2198],
  "M3169 MAYORISTA 10 LINARES": [-71.5904, -35.8457],
  "00073 HIPER PUENTE ALTO": [-70.5756, -33.6015],
  "PIBAMOUR CD FRIO": [-70.762, -33.3887],
  "PROVIMARKET LIMACHE": [-71.2558, -33.0063],
  "COMERCIAL CASTRO CD CERRILLOS": [-70.7134, -33.5216],
  "MARGARITA UAUY E HIJOS": [-70.7259, -33.3235],
  "PRODUCTOS FERNANDEZ FMP": [-71.6338, -35.423],
  "LESAFFRE CD": [-70.7127, -33.3428],
  "NUTRISCO": [-70.7154, -33.3182],
  "TEBA RANCAGUA": [-70.7523, -34.166],
  "00094 HIPER VALDIVIA": [-73.2372, -39.8282],
  "INTERCOS SIM": [-70.7108, -33.3027],
  "00122 HIPER QUILLOTA": [-71.2417, -32.8743],
  "MARITANO TALCAHUANO": [-73.1194, -36.7345],
  "DISTRIBUIDORA DISMARA LA CALERA": [-71.1923, -32.7776],
  "00076 HIPER DEPARTAMENTAL": [-70.5917, -33.5119],
  "CD PRISA": [-70.7793, -33.3934],
  "M3041 MAYORISTA 10 SAN FELIPE": [-70.7228, -32.7492]};

var RECINTO_IDX = {};
RECINTOS.forEach(function(r){ if(!RECINTO_IDX[r.k]) RECINTO_IDX[r.k] = r; });

function catNorm(s){
  return String(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
var CAT_STOP = {'CD':1,'DE':1,'LA':1,'EL':1,'LOS':1,'LAS':1,'SA':1,'SPA':1,'LTDA':1,
                'LIMITADA':1,'CHILE':1,'PLANTA':1,'BODEGA':1,'SUCURSAL':1,'S':1,'A':1};
function catToks(s){
  return catNorm(s).split(' ').filter(function(t){ return t && !CAT_STOP[t] && t.length > 1; });
}
function catJac(a,b){
  var B={}, i=0; b.forEach(function(x){B[x]=1;});
  a.forEach(function(x){ if(B[x]) i++; });
  var u = a.length + b.length - i;
  return u ? i/u : 0;
}

/* Jitter determinístico: separa recintos dentro de una comuna sin moverlos
   entre consultas. Copiado tal cual de mapa-retiros.html. */
/* El jitter ORIGINAL usaba 0.045°, que son unos 5 km: suficiente para sacar
   un punto de su propia comuna. Se vio en vivo con DEMARIA CD SANTIAGO, que
   el catálogo ubica en Quilicura y el mapa dibujaba en Quinta Normal — el
   mapa contradecía su propia etiqueta. Bajado a 0.008° (unos 400 m de
   dispersión), que separa lo suficiente para que no se apilen sin mentir
   sobre la comuna. */
var CAT_JITTER_GRADOS = 0.008;
function catJitter(seed){
  var h = 0;
  for(var i=0; i<seed.length; i++){ h = (h*31 + seed.charCodeAt(i)) >>> 0; }
  var a = ((h%1000)/1000 - 0.5), b = (((h>>10)%1000)/1000 - 0.5);
  return [a*CAT_JITTER_GRADOS, b*CAT_JITTER_GRADOS];
}

/* La comuna viene dentro de la propia dirección que entrega el GPS:
   "Calle Meza Bell 3057  8500000 Quinta Normal  Region Metropolitana de
   Santiago  Republica de Chile" → "QUINTA NORMAL" */
function comunaDeDireccion(s){
  if(!/Republica de Chile/i.test(s)) return null;
  var t = String(s).replace(/\s*Republica de Chile\s*$/i,'').trim();
  t = t.replace(/\s*Region Metropolitana de Santiago\s*$/i,'')
       .replace(/\s*Region[^,]*$/i,'')
       .replace(/\s*Provincia[^,]*$/i,'').trim();
  var m = t.match(/(?:^|\s)(\d{7})\s+(.+)$/);
  var cand = m ? m[2] : t.split(/\s{2,}/).pop();
  cand = String(cand||'').split(/\s+-\s+/)[0];          // "San Javier - Linares" → "San Javier"
  cand = cand.replace(/\s{2,}.*$/,'').trim();
  return cand ? catNorm(cand) : null;
}

/* Nombres que el GPS escribe distinto al catálogo. Se verifican a mano: no
   se bajan los umbrales del match difuso, porque eso genera falsos positivos
   que después nadie detecta. */
var ALIAS_COORD = {
  'CASTANO CD QULICURA': 'CASTANO QUILICURA',          // "QULICURA" es un typo del GPS
  'CD TOTTUS LA FARFANA': 'ZTT01 CD TOTTUS LA FARFANA',
  'COLGATE-CALYCO CBP':  'COLGATE INOCUO CBP',
  'ZSB CD SALCOBRAND':   'ZSB CD SALCO BRAND',
  'TEBA LO BLANCO':      'TEBA LO BLANCO AV. LO BLANCO #2561 LA PINTANA',
  'TEBA GRAN AVENIDA':   'TEBA GRAN AVENIDA AV. JOSE MIGUEL CARERRA 13365',
  'TEBA JJ PEREZ':       'TEBA JJ PEREZ AV. J.J PEREZ #6142 CERRO NAVIA',
  'MOLINERA HEREDIA LTDA.': 'MOL HEREDIA MAIPU PLANTA',
  'P G':                 'PROCTER AND GAMBLE',

  /* Talca: el RDTOut y la geocerca del GPS nombran distinto la misma planta.
     Verificado contra las 230 operaciones REDTEC de la zona (16-09-2026). */
  'PF TALCA PLANTA 1':       'PRODUCTOS FERNANDEZ P1',
  'PF TALCA PLANTA 2':       'PRODUCTOS FERNANDEZ P2',
  'PF TALCA PLANTA PIZZAS':  'PRODUCTOS FERNANDEZ PZ',
  'EMBO. METROPOLITANA COLBUN': 'EMBOTELLADORA EMSA COLBUN',
  'M3169 M10 LINARES BRASIL 646': 'M3169 MAYORISTA 10 LINARES'
};

/* Recintos que no estaban en el catálogo de Santiago y que aparecen al sumar
   Talca y la 4ª Región. Coordenadas del complejo industrial de Talca y de los
   puntos de Coquimbo/Atacama; las plantas PF comparten predio, así que van
   separadas por pocos metros a propósito. */
var COORD_EXTRA = {
  'PF TALCA PLANTA 4':             [-71.6472, -35.4281],
  'PF TALCA PLANTA ELABORADOS':    [-71.6441, -35.4269],
  'PF PATIO COMPLEJO INDUS. TALCA':[-71.6459, -35.4258],
  'PF FRIGORIFICO MATERIA PRIMA':  [-71.6420, -35.4239],
  'DIMAK TALCA':                   [-71.6612, -35.4340],
  'TAK CURICO SAN RAFAEL':         [-71.5130, -35.0170],
  'AGROINDUSTRIAL ITATA COCHARCAS':[-72.0430, -36.5310],
  'PAN DE AZUCAR COQUIMBO':        [-71.3090, -29.9660],
  'ZUN08 CD UNIMARC PAN DE AZUCAR':[-71.3120, -29.9690],
  'CENCOCAL COPIAPO':              [-70.3320, -27.3660],
  'PUNTO AZUL TIL-TIL':            [-70.9310, -33.0870]
};

/* Bodegas "virtuales": existen en el RDTOut como nodo contable, no como lugar
   físico donde un camión se detenga. No deben contarse como punto de espera.
   REDTEC COQUIMBO VIRTUAL concentra 24 operaciones sin patente asignada. */
/* Comuna de cada punto agregado a mano, para que la tabla por comuna no los
   deje en blanco. */
var COMUNA_EXTRA = {
  'PF TALCA PLANTA 4':'TALCA', 'PF TALCA PLANTA ELABORADOS':'TALCA',
  'PF PATIO COMPLEJO INDUS. TALCA':'TALCA', 'PF FRIGORIFICO MATERIA PRIMA':'TALCA',
  'DIMAK TALCA':'TALCA', 'TAK CURICO SAN RAFAEL':'SAN RAFAEL',
  'AGROINDUSTRIAL ITATA COCHARCAS':'COCHARCAS',
  'PAN DE AZUCAR COQUIMBO':'COQUIMBO', 'ZUN08 CD UNIMARC PAN DE AZUCAR':'COQUIMBO',
  'CENCOCAL COPIAPO':'COPIAPO', 'PUNTO AZUL TIL-TIL':'TIL TIL'
};

/* Geocercas del GPS en Talca cuya comuna no viene en el nombre. */
var COMUNA_GEOCERCA = {
  'PRODUCTOS FERNANDEZ P1':'TALCA', 'PRODUCTOS FERNANDEZ P2':'TALCA',
  'PRODUCTOS FERNANDEZ PZ':'TALCA', 'EMBOTELLADORA EMSA COLBUN':'COLBUN',
  'THE PROTEIN COMPANY':'PAINE', 'AGROINDUSTRIAL ITATA LTDA':'COCHARCAS'
};

var BODEGA_VIRTUAL = {'REDTEC COQUIMBO VIRTUAL':1, 'REDTEC TALCA VIRTUAL':1};
function esVirtual(nombre){
  return !!BODEGA_VIRTUAL[catNorm(catDesenvolver(nombre))] || /\bVIRTUAL\b/i.test(String(nombre||''));
}

/* Quita el envoltorio de borde del proveedor: "B X  B" → "X" */
function catDesenvolver(loc){
  var s = String(loc||'').trim();
  var mp = s.match(/^B?\s*Pasando Por\s*--+\s*(.+?)\s*B?$/i);
  if(mp) s = mp[1];
  var mb = s.match(/^B\s+(.*?)\s+B$/);
  if(mb) s = mb[1];
  return s.trim();
}

var _catCache = {};
/* Devuelve {coords:[lon,lat], comuna, zona, fuente} o null si no se pudo ubicar.
   fuente: 'base' | 'recinto' | 'direccion' */
function resolverCoords(puntoOriginal){
  if(puntoOriginal == null) return null;
  if(_catCache[puntoOriginal] !== undefined) return _catCache[puntoOriginal];
  var punto = catDesenvolver(puntoOriginal);
  var res = null;
  var n = catNorm(punto);
  if(ALIAS_COORD[punto]) n = catNorm(ALIAS_COORD[punto]);
  else if(ALIAS_COORD[n]) n = catNorm(ALIAS_COORD[n]);

  // 1. Base propia
  var baseKey = Object.keys(REDTEC_COORD).filter(function(k){ return catNorm(k) === n; })[0];
  if(!baseKey && /^REDTEC\b/.test(n)) baseKey = 'REDTEC';
  if(baseKey){
    /* Cada base en su comuna: antes todas heredaban PUDAHUEL, así que la base
       de Talca aparecía rotulada como si estuviera en Santiago. */
    var comBase = /TALCA/.test(baseKey) ? 'TALCA'
                : /COQUIMBO/.test(baseKey) ? 'COQUIMBO'
                : 'PUDAHUEL';
    res = {coords: REDTEC_COORD[baseKey].slice(), comuna:comBase, zona:null, fuente:'base'};
  }

  // 2. Mapa de clientes de REDTEC: la mejor fuente que tenemos
  if(!res && COORD_GPS[n]){
    res = {coords: COORD_GPS[n].slice(), comuna:null, zona:null, fuente:'cliente'};
    var rr = RECINTO_IDX[n];
    if(rr){ res.comuna = catNorm(rr.c); res.zona = rr.z || null; }
    if(!res.comuna && COMUNA_GEOCERCA[n]) res.comuna = COMUNA_GEOCERCA[n];
  }

  // 3. Recinto del catálogo → dirección geocodificada, o centroide + jitter
  if(!res){
    var r = RECINTO_IDX[n];
    if(!r){
      var tp = catToks(n), best = null, bs = 0;
      for(var k in RECINTO_IDX){
        var s = catJac(tp, catToks(k));
        if(s > bs){ bs = s; best = k; }
      }
      if(bs >= 0.6) r = RECINTO_IDX[best];
    }
    if(r && COORD_RECINTO[r.k]){
      /* Dirección geocodificada: ubicación real, sin jitter */
      res = {coords: COORD_RECINTO[r.k].slice(), comuna:catNorm(r.c), zona:r.z||null, fuente:'direccion'};
    } else if(r && COMUNA_CENT[catNorm(r.c)]){
      var c = COMUNA_CENT[catNorm(r.c)], j = catJitter(n);
      res = {coords:[c[0]+j[0], c[1]+j[1]], comuna:catNorm(r.c), zona:r.z||null, fuente:'comuna'};
    }
  }

  // 3b. Recintos agregados a mano (Talca, 4ª y 3ª Región)
  if(!res && COORD_EXTRA[n]){
    res = {coords: COORD_EXTRA[n].slice(), comuna:COMUNA_EXTRA[n]||null, zona:null, fuente:'extra'};
  }

  // 4. Dirección suelta → comuna escrita en el propio texto
  if(!res){
    var com = comunaDeDireccion(punto);
    if(com && COMUNA_CENT[com]){
      var c2 = COMUNA_CENT[com], j2 = catJitter(n);
      res = {coords:[c2[0]+j2[0], c2[1]+j2[1]], comuna:com, zona:null, fuente:'comuna'};
    }
  }

  // 5. Último recurso: la comuna va escrita en el propio NOMBRE de la bodega
  //    ("DIMAK LOS ANGELES", "RABIE PUERTO MONTT", "00094 HIPER VALDIVIA
  //    BUERAS"). Sin esto, 60 de las 136 bodegas de RDTOut caían en "sin
  //    ubicar" y quedaban fuera del mapa y de todo promedio por zona.
  //    Se toma la coincidencia MÁS LARGA para que "SAN PEDRO DE LA PAZ" gane
  //    sobre "SAN PEDRO", y se exige borde de palabra para no confundir
  //    "MAIPU" dentro de otra palabra. La precisión es de comuna, nunca de
  //    dirección: por eso la fuente se marca aparte y el informe la distingue.
  if(!res){
    /* Abreviaturas que usa el RDTOut en el nombre de la sucursal. Se expanden
       sólo acá, en el último escalón, para no ensuciar el match exacto. */
    var nAb = n
      .replace(/(^| )PTE ALTO( |$)/, '$1PUENTE ALTO$2')
      .replace(/(^| )STA CRUZ( |$)/, '$1SANTA CRUZ$2')
      .replace(/(^| )STA AMALIA( |$)/, '$1LA FLORIDA$2')
      .replace(/(^| )BELLOTO( |$)/,   '$1QUILPUE$2')
      .replace(/(^| )BODENOR FLEXCENTER( |$)/, '$1PUDAHUEL$2')
      .replace(/(^| )PPE GALES( |$)/, '$1LA REINA$2')
      .replace(/(^| )STO DGO( |$)/,   '$1SAN FELIPE$2')
      .replace(/(^| )STA TERE( |$)/,  '$1LOS ANDES$2');
    if(nAb !== n) n = nAb;
    var mejor = null;
    for(var cm in COMUNA_CENT){
      if(cm.length < 4) continue;
      if(new RegExp('(^| )' + cm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '( |$)').test(n)){
        if(!mejor || cm.length > mejor.length) mejor = cm;
      }
    }
    if(mejor){
      var c3 = COMUNA_CENT[mejor], j3 = catJitter(n);
      res = {coords:[c3[0]+j3[0], c3[1]+j3[1]], comuna:mejor, zona:null, fuente:'comuna_nombre'};
    }
  }

  _catCache[puntoOriginal] = res;
  return res;
}

/* Recuadro de la Región Metropolitana, para separar "Santiago" del resto */
var BBOX_STGO = {oeste:-71.35, este:-70.20, sur:-34.05, norte:-32.90};
function esSantiago(coords){
  return !!coords && coords[0] >= BBOX_STGO.oeste && coords[0] <= BBOX_STGO.este
      && coords[1] >= BBOX_STGO.sur && coords[1] <= BBOX_STGO.norte;
}
