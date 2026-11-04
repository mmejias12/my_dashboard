# ¿Seguimos consumiendo el API de M2LINK?

Revisión completa del repo `my_dashboard` (M3LINK) · 4-nov-2026

**Alcance.** 280 archivos: las 54 vistas HTML, los 155 `.js` (las 37 Functions de
`api/` más `api/shared/`, `backfill/` y `scripts/`), los 12 workflows de GitHub
Actions y `staticwebapp.config.json`. Quedaron fuera `data/` (sólo datos, sin llamadas),
`icons/` y los binarios. Método: inventario de todo host externo que aparece en
el árbol, y de cada uno hacia atrás hasta la vista que lo usa, separando el
código que corre en producción del que sólo corre en local.

---

## La respuesta corta

1. **No existe ninguna llamada a un servidor llamado m2link.** Las 38 menciones
   de "M2LINK" en el repo son comentarios, notas de verificación y texto de
   pantalla. Ni un host, ni una ruta, ni una llave.

2. **Lo que sí seguimos consumiendo del proveedor es `apirdt1.azurewebsites.net`
   (RDTOut)** — y es la misma familia: la llave se llama `m2s_live_…`. Ése es el
   que se da de baja, así que para la pregunta práctica —"¿qué se nos cae?"— la
   respuesta es la lista de abajo.

3. **Sigue colgando de ahí:** 8 Functions en vivo (más dos con la rama `rdt`
   dormida), 9 endpoints distintos, 19 vistas y **una de las corridas
   programadas**.

---

## Lo que se cae el día de la baja

### 1 · Cuadre de rojos del pool — *crítico*

`/api/RDTOut/cuadrerojosclientesxrangofechas` y `…retailxrangofechas`

| Quién | Vistas |
|---|---|
| `api/stock-clientes-proxy`, `api/stock-retail-proxy` | `stocks-unificado.html`, `stock-calendario.html`, `Stock Plantas Respaldo - Copia.html` |
| `api/shared/stock-fetch.js` → `stock-dia.js` | la herramienta de stock del chat (`api/chat`) y `backfill/backfill-stock.js` |

Son las tres vistas que el cockpit ya tiene anotadas para el 30-nov. `stock-fetch`
no pasa por ningún interruptor: el host está escrito en el archivo.

### 2 · Cartola — *crítico*

`/api/RDTOut/cartolasdiariasxrangofechas` y el endpoint PBI
`/api/<token>/pbi/CartolaDiariasXRangoFechas`

| Quién | Vistas |
|---|---|
| `api/cartola-proxy` | `cartola-financiera.html`, `semaforo-gerencial.html` |
| `api/cartola` | `Emisiones_Detalle.html` (el valorizado) |
| `api/shared/cartola-fetch.js` → `consulta-finanzas.js` | la galaxia FINANZAS del chat |

Es la dependencia que ya estaba identificada: sin esto, Emisiones — Detalle
valorizado pierde los valores aunque las cantidades sigan.

### 3 · Facturación con guías

`/api/RDTOut/facturacionconguias` · `api/facturacion-guias-proxy` ·
`facturacion-guias.html`

### 4 · OT con asientos

`/api/RDTOut/otconasientos` · `api/otconasientos` · `Operaciones_Planta.html`

### 5 · Operaciones de pallets rojos

`/api/RDTOut/operacionespalletsrojos` · `api/opsrojos` ·
`Resumen_Operaciones.html` (el otro dato de esa vista, `/proxy/ops`, ya está migrado)

### 6 · Historial por pedido — *la más repartida*

`/api/RDTOut/historialxnropedido` · `api/historial-proxy` · **11 vistas**:
`m3link_dashboard_dark`, `analisis-transferencias`, `analisis-cliente`,
`transferencias-clientes`, `transportes-tiempos`, `transportes-pagos`,
`calendario-retiro-pallets`, `retiros-programacion`, `emisiones-reporte`,
`top10`, `Emisiones_Detalle`.

En todas es el popup del pedido, no el dato principal: el día de la baja esas
vistas siguen funcionando y lo que falla es el detalle al hacer clic. Redlink
entrega estado actual, no recorrido, así que este dato no tiene reemplazo
directo — hay que decidir si se reconstruye o se deja ir.

### 7 · OpsXRangoFechas desde el chat — *sin interruptor*

`api/shared/consulta-transporte.js` arma la URL con
`OS_OPS_HOST` (default `apirdt1`) y `/api/RDTOut/OpsXRangoFechas` y llama
directo. No consulta `origenActivo()`, así que **no se movió cuando conmutamos
`OPS_ORIGEN`**: la galaxia TRANSPORTE del chat sigue leyendo del proveedor
viejo. Es el único consumidor en vivo que quedó fuera del interruptor por
omisión y no por diseño.

### 8 · La corrida diaria — *hallazgo*

`.github/workflows/datos-diarios-redtecos.yml` (03:13 / 06:13 / 08:13 de Chile)
**no define `OPS_ORIGEN`**, y `origenActivo()` sin esa variable devuelve `rdt`
(verificado corriendo la función con seis valores distintos). Entonces:

- **paso 1**, `backfill/backfill.js` (ventana de 45 días), lee del **apirdt1**
  por `consultarOps` y escribe los agregados `hist/YYYY-MM-DD.json`;
- **paso 2**, `backfill/backfill-stock.js`, lee del **apirdt1** por `stock-fetch`
  y escribe `stock/YYYY-MM-DD.json`;
- el paso **2b** sí es Redlink directo (`backfill-operaciones.js`, contenedor
  `redtec-os-operaciones`).

- el paso **3d**, `scripts/rollup-transferencias.js`, también va por
  `consultarOps` —consulta el origen en vivo a propósito, porque los blobs
  diarios se congelan a los 45 días y pierden las confirmaciones tardías—, así
  que es un **tercer** punto de contacto con el proveedor viejo.

`OPS_ORIGEN` se cargó en las Application Settings de la Static Web App, y eso no
alcanza al runner de Actions: son dos entornos distintos. Consecuencia para
**Operaciones REDTEC**: `scripts/rollup-diario.js` arma `resumen/diario.json`
leyendo las dos cosas —los agregados `hist/` (paso 1, hoy apirdt1) y el cold
store de Redlink (paso 2b)—, así que la mitad de esa serie sí se sigue llenando
desde RDTOut. **Corrige lo que te dije el 3-nov**: la cadena es nuestra en
almacenamiento y en scripts, pero el dato de origen de los agregados todavía
entra por el proveedor viejo.

Y una corrección a esta misma página: el interruptor arregla los pasos 1 y 3d,
**no** el paso 2. `backfill-stock.js` llega al proveedor por `stock-fetch.js`,
que tiene el host escrito y no pregunta por `OPS_ORIGEN`; ése sólo se resuelve
con el punto 3 del orden de abajo.

---

## Lo que ya no depende del proveedor viejo

- `/proxy/ops` y `/api/ops` · frío (`redtec-os-operaciones`) + Redlink
- `/api/os-diario`, `/api/os-resumen`, `/api/os-transferencias` · blobs propios
- `/api/calendario-pallets-proxy` y `/api/m3link-viajes-proxy` · pasan por el interruptor
- `/api/guias-pendientes` y el monitor del andén · `guias-fetch` (frío + Redlink)
- Chat: `consulta-historico` y `consulta-cliente` (interruptor), `consulta-contraparte` (blobs)

**Otros proveedores, que no tienen nada que ver con esta baja:** SAP B1 Service
Layer (`sap-stock-proxy`, todo `backfill/*sap*`, el tablero de stock), Redlink
(`api.portalredtec.cl` + Keycloak), SpotVision (`redtec.spotcloud.io`), Talana,
Workera, GPS (`web1ws.shareservice.co`), el KPI de Walmart, Microsoft Graph
(correo de alerta) y la API de Anthropic (chat).

---

## Código muerto · no confundirlo con dependencia

- **15 vistas** tienen constantes `API_DIRECT` / `HIST_DIRECT` / `CLI_DIRECT`
  apuntando a apirdt1, **todas** detrás de `isDev` (`localhost` / `127.0.0.1`) o
  `location.protocol === 'file:'`. En producción no se usan nunca. Son la mitad
  de los hallazgos de una búsqueda ingenua por "apirdt1".
- Las ramas `rdt` de `api/ops` y `api/m3link-viajes-proxy`: están escritas, pero
  con el interruptor en `redlink` no se ejecutan.
- `backfill/backfill-cartola.js` y `backfill/backfill-historial.js`: se corren a
  mano, no están en ningún workflow.

---

## Un hallazgo de seguridad, aparte

La llave de RDTOut está **escrita en el código como respaldo** en 11 archivos
(`m2s_live_ORA0…`), con el patrón `process.env.REDTEC_API_KEY || '<literal>'`, y
el token PBI de la cartola en otros 9 (`rdtd9fd…`, además dentro de la URL, o sea
visible en cualquier log de red). `api/ops` ya lo reporta en su diagnóstico
("RESPALDO ESCRITO EN EL CÓDIGO"). Cuando el proveedor se dé de baja esto deja de
importar, pero hasta entonces conviene borrar los literales: el día que se
rote la llave, los que queden con respaldo seguirán usando la vieja y van a
fallar sin decir por qué.

---

## Orden sugerido

1. ~~`OPS_ORIGEN: redlink` en el `env:` del workflow diario~~ · **hecho el
   4-nov**, junto con algo mejor para el paso 1: ver más abajo.
2. ~~`consulta-transporte.js` al interruptor~~ · **hecho el 4-nov**.
3. El cuadre de rojos (`stock-fetch` y los dos proxies de stock) desde SAP:
   la extracción propia ya existe.
4. Cartola con fuente propia — es el camino que ya decidiste, y de ahí sale
   también el valorizado de Emisiones — Detalle.
5. `otconasientos`, `operacionespalletsrojos` y `facturacionconguias`: una vista
   cada uno, decidir si se reemplazan o se jubilan.
6. El historial por pedido: decisión de negocio, no técnica.

---

## Cómo se verificó

Además de leer el código, la clasificación se volvió a derivar por otro camino
con un script que recorre el cierre de `require` de cada Function y marca como
**dependencia dura** sólo los sitios que llaman al host *sin* consultar el
origen. Son 31 comprobaciones y pasan las 31: las 8 Functions duras, las 2 con
rama dormida, las 9 ya migradas, los tres módulos por los que llega el chat, los
cinco hechos de la corrida diaria, los `*_DIRECT` de las vistas (con ventana de
±2 líneas, más el único caso indirecto —`fetchSaldo` en *Stock Plantas
Respaldo*— revisado a mano) y la ausencia de cualquier host con "m2" en el
nombre. El script quedó en
`/tmp/claude-0/-home-claude/88f40cc2-cc0c-5b87-8cf1-132a53d60e22/scratchpad/auditx/verif.js`.

Lo que **no** se pudo verificar: la sonda contra el sitio publicado. El panel de
navegador que uso para probar está sin sesión (`/.auth/me` devuelve
`clientPrincipal: null`), así que todo endpoint protegido responde el HTML del
portal en vez del dato. Con sesión iniciada se confirma en minutos que cada
Function de la lista responde desde donde dice el código.

Un detalle menor que conviene saber: `api/ops` decide el origen leyendo
`process.env.OPS_ORIGEN` por su cuenta, mientras el resto lo pregunta a
`origenActivo()` de `ops-fetch`. Hoy dan lo mismo; son dos copias de la misma
regla y por eso puede desfasarse una.


---

## Lo aplicado el 4-nov-2026 · puntos 1 y 2

### Paso 1 de la corrida diaria · ya no le pide nada al proveedor

En vez de conmutar `backfill.js` a Redlink —que habría sido una segunda ruta
hacia el mismo dato— los agregados ahora se **derivan del cold store** que el
paso 2b acaba de escribir. Los dos almacenes se archivan por la misma clave de
día (`fechaRequerida`) y el agregador es el de siempre (`movimientos.js`), así
que `hist/` sale del dato que ya está en nuestro Blob.

- **nuevo** `scripts/rollup-hist.js` · lee `redtec-os-operaciones` día por día,
  deduplica por `nroPedido` y escribe `hist/YYYY-MM-DD.json`. Tiene modo
  `--comparar`, que **no escribe**: calcula lo que saldría del cold y lo
  contrasta con lo guardado, concepto por concepto.
- **regla que no se negocia**: un día sin blob en el cold NO se escribe. Podría
  ser un domingo sin movimiento, pero también un hueco de la ingesta, y escribir
  ceros encima de un día bueno destruye historia.
- nunca escribe un día fuera del rango pedido, ni un bucket cuyo día no se leyó
  completo.
- el workflow pasa a: 2b (Redlink → cold) → **2c (cold → hist/)** → rollups. El
  orden importa: si 2c corriera antes, agregaría el cold de ayer.
- `backfill.js` queda en el repo para la carga inicial histórica; `rollup-hist.js`
  también puede hacerla, y sin proveedor.

**Un defecto que salió en la primera corrida real (4-nov).** `--comparar` murió
con `Error: The specified blob does not exist.` El guard de `cache-dia.js`,
`cold-operaciones.js` y `cache-ops.js` decide "no existe" mirando el TEXTO del
error (`/BlobNotFound|ContainerNotFound/`), y el SDK de Azure manda ese mensaje
en prosa, sin la palabra `BlobNotFound`: un día sin blob se escapaba como
excepción. En producción no se nota porque TODOS los sitios de llamada envuelven
con `.catch(() => null)` — lo que a su vez esconde algo peor: unas credenciales
malas se ven exactamente igual que un día sin movimiento.

`rollup-hist.js` ahora clasifica por código (`statusCode 404`, `e.code`,
`e.details.errorCode`) **y** por texto, y distingue los dos casos: un día
ausente se informa y se salta; un 403 o un corte de red se propaga nombrando el
día. Vale revisar si conviene llevar el mismo criterio a esos tres módulos
compartidos, que hoy dependen de que cada llamador se defienda solo.

**Antes de confiar en el cambio, correrlo en seco.** Desde el repo, con
`OS_STORAGE_CONN` cargada:

```
node scripts/rollup-hist.js 2026-09-01 2026-10-31 --comparar
```

Si imprime "Los agregados del cold reproducen lo guardado", el reemplazo es
transparente. Si hay diferencias, las lista por día y concepto con los dos
números: ésa es la conversación que hay que tener antes de dejar que el paso 2c
escriba, y la razón de que el modo comparación exista.

### Primera comparación real · 1-sep → 31-oct, corrida el 4-nov

```
Días con blob en el cold : 60   (sin blob: 1)
Filas agregadas          : 36.081
Días iguales             : 59
Días con diferencia      : 1
  2026-10-30   transferencias  cold 879   guardado 851   dif +28
Sin blob en el cold      : 2026-09-19
```

**59 de 60 días idénticos**, incluido todo septiembre. Los dos orígenes
reproducen lo mismo en el dato cerrado, que es lo que había que establecer.

**El día que difiere es el esperado, y el concepto también.** El 30 de octubre
es el único día reciente del rango (5 días) y `transferencias` es el único
concepto que sigue moviéndose después: la ventana de gracia de confirmaciones
tardías es de 40 días (`mov.VENTANA_TRANSFER_DIAS`), y `cache-dia.js` marca
`transferencias_provisional` justamente para eso. Encima, los dos almacenes no
se refrescan al mismo ritmo: `operaciones-intradia.yml` reescribe el **cold** 8
veces al día, mientras `hist/` sólo se reescribe en las 3 corridas de la
madrugada. O sea el cold está estructuralmente más fresco en los días recientes,
y +28 pallets en un día de 879 es una tarde de confirmaciones, no un descalce de
fuente. Con el paso 2c corriendo detrás del 2b, los dos quedan en el mismo
instante.

### Segunda comparación · 1-ago → 15-sep · la hipótesis de frescura NO alcanza

Esa corrida devolvió **12 días con diferencia, todos en `transferencias` y todos
con el cold por encima**: del 1 al 14 de agosto (los días con movimiento), con
deltas de +24 a +263. Y del 15 de agosto al 15 de septiembre, **cero
diferencias**. 46 días, los 46 con blob en el cold.

El corte es exacto y vale escribirlo, porque es la pista: el agregado de un día
X se reescribe mientras X cae dentro de la ventana de 45 días de la corrida
diaria, o sea su ÚLTIMA escritura fue alrededor de X+45.

- 14 de agosto + 45 = **28 de septiembre** → difiere
- 15 de agosto + 45 = **29 de septiembre** → calza

O sea: los días cuyo agregado dejó de reescribirse ANTES del 28-29 de septiembre
difieren, y los que todavía se reescribieron después calzan. Eso descarta "el
cold está más fresco por la intradía" como explicación completa —sería un
gradiente, no un corte— y apunta a que todo lo escrito desde fines de septiembre
coincide con lo que el cold dice hoy.

Quedan dos lecturas posibles y son distintas: (a) son confirmaciones tardías que
llegaron después de la última escritura del agregado, y entonces el cold está
más completo; (b) algo cambió a fines de septiembre en cómo se cuenta el
concepto, y entonces hay dos varas midiendo lo mismo. Adivinar cuál es sale
gratis y vale cero, así que el script ahora lo mide.

### `--explicar`: por qué difiere UN día

```
node scripts/rollup-hist.js 2026-08-12 --explicar
```

Toma un día y responde tres cosas con el dato:

1. **en qué concepto** está el delta;
2. **si el agregado guardado se reproduce** filtrando las filas por
   `fechaConfirmacion` hasta cierto corte. Prueba +0, +7, +15, +30, +40, +45,
   +60 y +90 días. **Si el corte de +45 reproduce el número guardado, la
   explicación está cerrada**: lo que le sobra al cold son confirmaciones que
   llegaron después de la última escritura del agregado, y el cold está más
   completo, no distinto. Si ningún corte calza, la diferencia no son
   confirmaciones tardías y hay que mirar el punto 3;
3. **en qué contrapartes y bodegas** está el delta, usando el desglose que el
   propio agregado ya guarda (`detalle`), con los dos números y la diferencia.

Las filas sin `fechaConfirmacion` se cuentan en todos los cortes: ya estaban
cuando el agregado se escribió, no son información nueva.

`--comparar` además imprime ahora la **suma de las diferencias** por concepto,
para ver el tamaño del asunto antes de entrar en los días uno por uno.

**El día sin blob era un feriado.** El 19 de septiembre de 2026 fue sábado y día
de las Glorias del Ejército; el 18 sí tiene blob. La regla de no escribir ese día
lo protegió. Pero la pregunta buena no estaba contestada: *¿el cold no tiene
blob porque no hubo movimiento, o porque le falta el día?* Así que `--comparar`
ahora lo distingue:

- **sin blob y sin movimiento guardado** → normal, se lista y nada más;
- **sin blob pero el agregado guardado SÍ tiene movimiento** → `*** HUECOS DEL
  COLD`, con los números de lo que había, porque eso es historia que el cold no
  vio y hay que rellenarla con `backfill-operaciones.js` antes de que el cold sea
  la única fuente. Un hueco pesa igual que una diferencia en el veredicto final.

### Galaxia TRANSPORTE del chat · al frío y al interruptor

`api/shared/consulta-transporte.js` ya no arma la URL de RDTOut ni lleva la
llave: lee el **almacén frío** para los días cerrados y la **cola viva** por
`consultarOps` sólo si el rango toca hoy. Un rango de doce meses deja de ser
doce llamadas al proveedor y pasa a ser lectura de blobs.

- **el margen de 45 días no es decorativo**: el frío se archiva por
  `fechaRequerida` y esta galaxia factura por `fechaConfirmacion`. Un viaje
  requerido el 28 de septiembre y confirmado el 2 de octubre vive en el blob de
  septiembre, así que pedir sólo el período lo perdería. Se leen 45 días a cada
  lado y el recorte por fecha de confirmación lo sigue haciendo
  `viajesDelRango`.
- sin almacén frío y con un rango de más de 62 días **falla diciendo por qué**,
  en vez de colgar la Function contra el corte de 45 s.
- la respuesta de la herramienta ahora trae `fuente` (origen, días de frío,
  filas vivas, errores): el que lee el número puede saber de dónde salió.
- el workflow declara `OPS_ORIGEN: redlink` a nivel de job, así que el paso 3d
  —el rollup de transferencias— también deja de leer del proveedor viejo. OJO:
  eso **cambia los números** de `resumen/transferencias.json` para que coincidan
  con lo que ya muestran las vistas; hoy el índice está medido con una vara y las
  vistas con otra.

### Pruebas

- `rollup-hist`: 54 comprobaciones con el cold y el blob de agregados doblados
  (la línea de comandos, los tres sabores de "el blob no existe", la alarma de
  huecos y el análisis por cortes), 17 mutaciones y las 17 muerden. Dos
  mutaciones resultaron equivalentes y se reemplazaron por otras observables, en
  vez de forzarles una prueba.
- `consulta-transporte`: 27 comprobaciones, 8 mutaciones y las 8 muerden. Una de
  ellas descubrió un defecto de verdad: `Number(x) || def` convertía un `0`
  explícito en el default, o sea el interruptor "apágalo" no apagaba nada. Ya
  está parseado y validado.
- Quedan en
  `/tmp/claude-0/-home-claude/88f40cc2-cc0c-5b87-8cf1-132a53d60e22/scratchpad/histx/`
  y `.../scratchpad/transpx/`.

### Lo que sigue · puntos 3 a 6

El paso 2 de la corrida (stock/pool por `cuadrerojos`) es ahora **la única
dependencia automática** que queda del proveedor, y no se arregla con el
interruptor: hay que reemplazar el cuadre con la extracción propia de SAP. Ése
es el punto 3 y es un trabajo de equivalencia de datos, no de código: antes de
cambiar la fuente hay que demostrar que el cuadre de SAP da lo mismo que el del
proveedor, como se hizo con el tablero de stock contra Datawalt.
