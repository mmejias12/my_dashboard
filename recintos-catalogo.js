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
var COMUNA_CENT = {"BUIN": [-70.7411, -33.7333], "CERRILLOS": [-70.718, -33.496], "CERRO NAVIA": [-70.742, -33.421], "COLINA": [-70.672, -33.202], "ESTACION CENTRAL": [-70.696, -33.46], "HUECHURABA": [-70.639, -33.367], "ISLA DE MAIPO": [-70.898, -33.752], "LA FLORIDA": [-70.568, -33.532], "LA PINTANA": [-70.63, -33.583], "LAMPA": [-70.876, -33.284], "MACUL": [-70.598, -33.49], "MAIPU": [-70.758, -33.517], "PAINE": [-70.741, -33.808], "PENAFLOR": [-70.876, -33.61], "PUDAHUEL": [-70.75, -33.442], "PUENTE ALTO": [-70.575, -33.611], "QUILICURA": [-70.729, -33.36], "RECOLETA": [-70.641, -33.402], "RENCA": [-70.728, -33.406], "SAN BERNARDO": [-70.7, -33.592], "SAN JOAQUIN": [-70.628, -33.497], "TALAGANTE": [-70.931, -33.664], "SAN ANTONIO": [-71.613, -33.593], "VALPARAISO": [-71.613, -33.047], "PLACILLA": [-71.568, -33.116], "HIJUELAS": [-71.133, -32.806], "RENGO": [-70.86, -34.406], "SANTIAGO": [-70.65, -33.442], "QUINTA NORMAL": [-70.7, -33.432], "CONCHALI": [-70.675, -33.383], "INDEPENDENCIA": [-70.664, -33.415], "PROVIDENCIA": [-70.61, -33.43], "NUNOA": [-70.598, -33.456], "LAS CONDES": [-70.545, -33.408], "VITACURA": [-70.578, -33.38], "LO BARNECHEA": [-70.48, -33.35], "LA REINA": [-70.545, -33.445], "PENALOLEN": [-70.545, -33.49], "SAN MIGUEL": [-70.652, -33.497], "PEDRO AGUIRRE CERDA": [-70.674, -33.487], "LO ESPEJO": [-70.688, -33.52], "LA CISTERNA": [-70.662, -33.533], "EL BOSQUE": [-70.675, -33.562], "LA GRANJA": [-70.628, -33.541], "SAN RAMON": [-70.645, -33.538], "LO PRADO": [-70.722, -33.443], "TIL TIL": [-70.93, -33.087], "CURACAVI": [-71.15, -33.4], "MELIPILLA": [-71.215, -33.688], "EL MONTE": [-70.983, -33.68], "CALERA DE TANGO": [-70.78, -33.62], "PIRQUE": [-70.59, -33.67], "SAN JOSE DE MAIPO": [-70.35, -33.64], "PADRE HURTADO": [-70.815, -33.573], "TALCA": [-71.665, -35.426], "SAN JAVIER": [-71.73, -35.594], "LINARES": [-71.597, -35.846], "LOS ANGELES": [-72.351, -37.469], "CHILLAN": [-72.103, -36.606], "TEMUCO": [-72.59, -38.735], "PUERTO MONTT": [-72.941, -41.469], "CONCEPCION": [-73.05, -36.827], "CORONEL": [-73.132, -37.026], "TALCAHUANO": [-73.117, -36.717], "OSORNO": [-73.133, -40.573], "LA CALERA": [-71.192, -32.788], "QUILLOTA": [-71.247, -32.88], "LIMACHE": [-71.267, -33.017], "LOS ANDES": [-70.598, -32.834], "SAN FELIPE": [-70.725, -32.75], "RANCAGUA": [-70.745, -34.17], "SANTA CRUZ": [-71.365, -34.639], "VALDIVIA": [-73.245, -39.814], "MELIPILLA CENTRO": [-71.215, -33.688]};


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
  'P G':                 'PROCTER AND GAMBLE'
};

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
    res = {coords: REDTEC_COORD[baseKey].slice(), comuna:'PUDAHUEL', zona:null, fuente:'base'};
  }

  // 2. Recinto del catálogo → centroide de su comuna + jitter
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

  // 3. Dirección suelta → comuna escrita en el propio texto
  if(!res){
    var com = comunaDeDireccion(punto);
    if(com && COMUNA_CENT[com]){
      var c2 = COMUNA_CENT[com], j2 = catJitter(n);
      res = {coords:[c2[0]+j2[0], c2[1]+j2[1]], comuna:com, zona:null, fuente:'comuna'};
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
