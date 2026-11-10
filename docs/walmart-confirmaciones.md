# Confirmaciones Walmart · qué es, qué se midió y qué falta

**Estado al 6-nov-2026.** El cruce está medido y la regla validada contra la
realidad. Lo que falta para construir el reemplazo es una sola cosa técnica —el
endpoint de confirmación de Redlink— y una decisión de negocio.

---

## Qué hace hoy el módulo del proveedor

Vive en `brdt2.azurewebsites.net/comps/ImportarReporteWalmart`, dentro del M2LINK
que se da de baja. **No es "cruzar un Excel"**: leído de su propia pantalla,

| | |
|---|---|
| **Entrada** | Walmart manda `Reporte-RedTec.xlsx` por correo, un archivo por día |
| **Ingesta** | Un *job de casilla* lee el correo entre las 9 y las 16 h, avisa a las 15:00 y cierra a las 16:00, L-D |
| **Cruce** | Por **cita** (`appt_nbr` del Excel ↔ `nroCita` de la transferencia), con cascada: cita exacta → el texto de la Observación → la única pendiente entre duplicadas |
| **Excepciones** | Tres bandejas: *Match a revisar*, *Duplicadas*, *Con diferencia* |
| **Escritura** | Confirma en Redlink como usuario de sistema **M2LinkSystem**, y adjunta la evidencia |
| **Vencimiento** | Las transferencias vencen a los **30 días desde el Despacho**; alerta ≤5 días, aviso ≤10. Es el contador "EN RIESGO" del encabezado |
| **Y además** | Trazabilidad, Reconfirmaciones, correo automático al cliente, y los interruptores de auto-confirmar |

## El dato de Walmart

Una fila por recepción, no por transferencia. Columnas que importan:
`appt_nbr` (la cita, 8 dígitos), `Rut` / `Razon Social` (el cliente de REDTEC),
`po_dc_nbr` (el CD de Walmart), `rcvr_final_ts` (cuándo se recibió),
`pallet_tot_qty`, `pallet_bad_qty` y `pallet_exch_qty` (total, malos y canjeados).

**Una cita puede venir en varias filas**, una por recepción: hay que sumarlas antes
de cruzar. Del lado de Redlink esa cita es UNA transferencia, así que comparar
fila contra fila inventa diferencias que no existen.

## La regla de cantidades

- Walmart aceptó **igual o menos** que lo despachado → se confirma **lo aceptado**
- Walmart aceptó **más** → se confirma **lo despachado** (no se puede confirmar más
  de lo que salió)

---

## LO MEDIDO · 8 reportes, 23-oct a 5-nov-2026

`scripts/medir-citas-walmart.js` sobre 573 filas, 566 citas, contra 20.491
operaciones del cold store. **No escribe nada.**

### La llave sirve

| | |
|---|---|
| Transferencias a bodegas `ZWM*` en el período | 2.548 |
| …con `nroCita` | **2.367 (92,9%)** |
| Citas del reporte que resuelven directo | **453 de 566 (80%)** |
| Duplicadas (una cita, varias transferencias) | 12 |
| Sin match | 98 (17%) |

### Y la regla también · 332 de 342 (97,1%)

Contrastada contra lo que **M2LinkSystem ya confirmó**, no contra un documento.
Desglose por signo, sobre las ya confirmadas:

| | | |
|---|---|---|
| WM aceptó **menos** | 43 | se confirmó lo aceptado en 33, lo despachado en 10 |
| WM aceptó **igual** | 270 | se confirmó lo aceptado en 270 |
| WM aceptó **más** | 29 | se confirmó lo despachado en **29 de 29** |

Las positivas no tienen ni una excepción: la regla 2 está demostrada.

### Las 10 que no calzan

Todas con la misma forma —Walmart aceptó menos y se confirmó lo despachado—, y
**9 de 10 con `conf x1`**, o sea confirmadas una sola vez, no reconfirmadas. (La
hipótesis de que eran reconfirmaciones quedó descartada por el dato.)

Dos explicaciones en pie, ninguna descartada:

1. Alguien resolvió la diferencia con el cliente y confirmó completo. **5 de las 10
   son PUNTO AZUL**, lo que apunta a un cliente que disputa sistemáticamente.
2. Muestreo incompleto: `desp 16 · WM 3` y `desp 18 · WM 3` son brechas demasiado
   grandes para ser un rechazo. Parecen citas con varias recepciones de las que
   sólo tenemos una. Faltan el 24, 25 y 29 de octubre.

**Para despejarlo basta conseguir esos tres días.**

### El cruce al revés · lo que alimenta el correo al cliente

Sólo sirven los días **cerrados**: aquellos donde se reportó tanto el día de
despacho como el de recepción posible. De los 8, cumplen cuatro (26, 27, 30 y
31-oct). En los demás falta el reporte del día siguiente y no hay con qué comparar
— contarlos sería inventar reclamos.

| | | |
|---|---|---|
| Transferencias a `ZWM*` en días cerrados | 403 | |
| Informadas por Walmart | 270 | 67% |
| **Con cita, Walmart no informó** | **108** | 1.811 pallets — esto va al correo |
| Sin cita en nuestro dato | 25 | 538 pallets — esto es nuestro |

---

## Problemas de dato propio · accionables hoy, sin esperar nada

El campo de cita en Redlink es libre y se llena a mano. Medido sobre las ZWM:

- **56 transferencias a Walmart sin cita.** PRODUCTOS FERNANDEZ y PUNTO AZUL se
  repiten. Sin cita no se pueden cruzar ni confirmar, por ninguna vía.
- **59 con el campo mal escrito (2,5%)**, de las cuales **48 son recuperables**:
  traen una o más citas de 8 dígitos adentro — `42687291 - 42687292`,
  `42694952/42693330`, `42710724.`. El cruce las recupera extrayendo todas las
  secuencias de 8 dígitos, y **54 operaciones traen más de una cita** en el campo.
- **11 son irrecuperables**: `DJWC13`, `17221`, `1`, `5994-5992-6004`. Esas hay que
  corregirlas en el origen.

Mientras ese campo se llene a mano, ninguna automatización va a poder confirmar
esas operaciones. **Esto se puede mejorar hoy y no depende de la baja del M2LINK.**

---

## Lo que falta

### La compuerta: el endpoint de confirmación

`POST /api/FormHeader` de Holux **crea** operaciones (emisión, devolución,
relocalización, transferencia, traspaso). **Confirmar no es crear**, y ese endpoint
no está verificado. El portal evidentemente lo tiene —M2LinkSystem confirma con
él— pero hay que capturarlo mirando qué manda el portal al confirmar una de
verdad. Hasta no tenerlo, cualquier estimación de plazo es humo.

### La decisión de negocio: a quién se le informa

Las dos puntas dejan algo abierto, y son avisos distintos:

- WM aceptó **menos**: salieron 25, llegaron 21 → faltan 4 que nadie tiene.
- WM aceptó **más**: llegaron 23, se despacharon 18 → se confirman 18 y quedan 5
  pallets en poder de Walmart **sin respaldo en ninguna transferencia**.

Las reglas entregadas apuntan al segundo caso; la pantalla del módulo encola el
primero (139 "por informar"). Sugerencia: que el correo lleve **los dos**,
separados, porque la acción del cliente es diferente en cada uno. Es decisión del
área, no técnica.

---

## Cómo correr la medición

```
node scripts/medir-citas-walmart.js <carpeta con los .xlsx> --detalle
node scripts/medir-citas-walmart.js <uno.xlsx> <otro.xlsx>
node scripts/medir-citas-walmart.js <archivo.xlsx> --dias=30 --inverso-dias=2
```

Pide `OS_STORAGE_CONN` y falla cerrado nombrando la variable, nunca su valor.
Lee el `.xlsx` sin dependencias (un `.xlsx` es un ZIP con XML) y ubica las columnas
**por nombre**, no por posición: el día que Walmart agregue una columna al medio,
un lector por coordenadas leería otra cosa sin avisar.

En modo carpeta salta los `.xlsx` que no son reportes de Walmart, nombrándolos; un
archivo pasado a mano falla fuerte. Un archivo que no se puede **leer** se informa
aparte de uno que no es de Walmart: son cosas distintas.

Pruebas: `scripts/test-medir-citas-walmart.js` — 32 comprobaciones y 30 mutaciones,
todas muerden.

---

## La escritura en Redlink: qué dice el contrato y qué dice el servidor

**La afirmación de Marcelo** — que el endpoint de lectura sirve también para
escritura — es cierta en la forma: es el mismo host y la misma autenticación.
Lectura `GET /api/FormHeader/historico/{BP}`, escritura `POST /api/FormHeader`.
Pero *crear* no es *confirmar*, y ahí es donde el contrato entregado se queda corto.

### Lo que dice la documentación que nos entregaron

`Api Holux/_LEER_PRIMER_REDTEC_API.pdf`, primera línea:

> «Se proporcionará **sólo la creación** de documentos, método POST».

La colección de Postman (`PORTAL MMESIAS.postman_collection.json`) y la planilla
`API Portal Redtec.xlsx` cubren exactamente eso y nada más: seis `formId` sobre
`POST /api/FormHeader` — 1 Emisión, 2 Devolución, 3 Retiro, 4 Traspaso,
5 Relocaliza, 6 Transferencia — más los maestros de sólo lectura
(`/api/Bodega/*`, `/api/Servicio/*`, `/api/BusinessPartner/*`, `/api/Documento`,
`/api/Camion/*`, `/api/Chofer/*`). No hay ninguna operación de confirmación.
El `.rar` «Api escritura» es una copia de esa misma carpeta: no agrega nada.

### Lo que dice el servidor

El servidor expone más de lo que está documentado. Preguntando por `OPTIONS`
(método que por definición no modifica nada, sin credenciales), el encabezado
`Allow` de cada ruta:

| Ruta | Métodos |
|---|---|
| `/api/FormHeader` | **GET, PATCH, POST, PUT** |
| `/api/FormHeader/{id}` | DELETE, GET |
| `/api/FormHeader/historico/{BP}` | GET |
| `/api/Form`, `/api/FormDdetalle`, `/api/Transporte`, `/api/Item`, `/api/Bodega`, `/api/BusinessPartner`, `/api/Camion`, `/api/Chofer`, `/api/Documento`, `/api/Servicio` | GET, POST, PUT |

El dato está en la asimetría: **todos los controladores son CRUD parejos
(GET/POST/PUT en la colección, DELETE/GET en el `{id}`), y `FormHeader` es el
único que además tiene `PATCH`**. Un `PATCH` es una modificación parcial de un
documento que ya existe — exactamente la forma que tendría «confirmar esta
transferencia». No es prueba, es el único candidato que hay.

`apidemo.portalredtec.cl` expone la misma superficie, `PATCH` incluido. Es decir
que el contrato se puede probar en DEMO, contra el usuario genérico de pruebas,
sin tocar producción.

Lo que **no** se puede averiguar desde afuera es el cuerpo del `PATCH`: qué
campos espera, si confirma el encabezado o los detalles, y si acepta la cantidad.
No se probó ningún método que escriba: todas las consultas fueron `GET` y `OPTIONS`.

### Lo que falta, por orden de costo

1. **Preguntarle a Marcelo por el contrato del `PATCH /api/FormHeader`.** Él es la
   fuente; el PDF que nos pasaron acota a propósito el alcance a la creación, así
   que esto es ampliar un alcance, no descubrir un secreto.
2. **Mirar una confirmación real.** El portal marca esas confirmaciones con el
   usuario `M2LinkSystem`: M2LINK ya llama a algo. Observar una confirmación
   hecha a mano en el portal muestra el cuerpo exacto.
3. **Probar en DEMO**, una vez conocido el contrato, antes de cualquier cosa en
   productivo.

Hasta que uno de los tres cierre, el proyecto Walmart tiene todo menos el último
paso: el cruce está medido y validado (97,1% de acierto de la regla sobre 342
casos), y lo único que falta es el verbo que escribe la confirmación.

---

## El circuito que hay que reemplazar, paso a paso

Tal como opera hoy, contado por quien lo recibe:

1. Walmart manda el reporte por correo. Llega a Marcelo, con copia a Mauro.
2. Marcelo se lo reenvía a un desarrollador.
3. El desarrollador carga el archivo en la plataforma (`ImportarReporteWalmart`).
4. La plataforma lo lee y lo cruza con lo que tiene Redlink.
5. Se confirma, y la confirmación queda escrita **con un usuario de sistema**:
   en la pantalla de transacciones del portal aparece como `M2LinkSystem`.

De los cinco pasos, cuatro son manualidad pura: el reenvío, la carga, el
apretar el botón y el estar disponible para hacerlo. El paso 1 se puede
automatizar aparte (el correo llega a un buzón; de ahí a un blob hay poco), y
el 4 ya está hecho y medido en este documento. El que falta es el 5.

### El usuario que firma la confirmación no es un detalle

`M2LinkSystem` es lo que queda escrito en la traza: cualquiera que mire esa
transacción en el portal ve quién la confirmó. Para nosotros eso significa dos
cosas, y la segunda es la que importa:

- Hay que pedirle a Marcelo un usuario `M3LinkSystem` (o como se llame) antes
  de escribir la primera confirmación de verdad.
- **El usuario de pruebas sirve en DEMO y sólo en DEMO.** Usarlo en productivo
  dejaría confirmaciones reales firmadas por un usuario de pruebas: la traza
  diría una cosa y la verdad sería otra, y eso no se arregla después.

### Lo que Marcelo puede y no puede responder

Marcelo maneja el concepto del `POST` — que es exactamente lo que dice el PDF
que nos entregó. El contrato del `PATCH` no lo tiene. Así que la pregunta no es
para él sino **a través** de él, hacia Holux: qué cuerpo espera
`PATCH /api/FormHeader` para confirmar, y un usuario de sistema propio.

Mientras tanto, la sonda levanta la respuesta por su cuenta en DEMO.

## La sonda

`scripts/sonda-escritura-redlink.js` — averigua si `PATCH /api/FormHeader` es la
pieza que falta, y con qué cuerpo.

```
node scripts/sonda-escritura-redlink.js --catalogo
node scripts/sonda-escritura-redlink.js --leer [--id=N]
node scripts/sonda-escritura-redlink.js --confirmar=N --cantidad=K       (muestra)
node scripts/sonda-escritura-redlink.js --confirmar=N --cantidad=K --si  (manda)
```

- El host está **clavado** a `apidemo.portalredtec.cl` y no hay bandera que lo
  cambie. Si algún día hay que escribir en productivo, eso se decide editando el
  archivo a conciencia, no pasando un flag apurado un viernes.
- Sin `--si` no manda nada: imprime el cuerpo exacto que mandaría y se detiene.
- Credenciales sólo por entorno —`REDLINK_DEMO_CLIENT_SECRET`,
  `REDLINK_DEMO_USER`, `REDLINK_DEMO_PASS`— y nunca se imprimen. Un valor con
  `<corchetes>` se detecta como marcador pegado literal y se nombra la variable,
  en vez de fallar quinientas líneas después con un «Invalid URL».

**Cómo se lee el resultado**, que es la mitad del asunto: un **400 no es un
fracaso**. Significa que la ruta aceptó el verbo y discutió el cuerpo — o sea,
que `PATCH` existe y sólo falta acertarle a los campos. El que cierra la puerta
es el **405**: ahí la ruta no acepta el verbo y la confirmación no pasa por ahí.
Por eso la sonda manda también un **testigo con cuerpo vacío**: si el testigo
contesta lo mismo que los candidatos, el error no está señalando ningún campo en
particular y no hay nada que deducir de él.

Prueba los dos `PATCH` que existen en ASP.NET Core, que se distinguen por el
`Content-Type`: JsonPatch (`application/json-patch+json`, una lista de
operaciones) y merge patch (`application/json`, un objeto parcial). Probar uno
solo y concluir sería repetir el error de siempre: confundir «no contestó» con
«no existe».

Pruebas: `scripts/test-sonda-escritura-redlink.js` — 46 comprobaciones y 33
mutaciones, todas muerden.

---

## El contrato de escritura, medido contra el servidor

Lo que sigue no sale de ninguna documentación: se levantó probando en DEMO,
error por error, el 9-nov-2026. La documentación entregada dice que sólo hay
creación; el servidor dice otra cosa.

### Lo que quedó probado

**`PATCH /api/FormHeader` escribe.** Enlaza el comando
`Application.Features.FormHeaders.Commands.UpdateForm` y persiste cambios sobre
un documento existente. Lo verificamos creando un documento propio en DEMO
(id 684029, una emisión de 15 pallets) y releyéndolo después de cada intento.

**El modelo no tiene ningún `cantidadConfirmada`.** Las cantidades viven en las
líneas de `formDdetalles`, con estos nombres:

| En las líneas de Redlink | En el contrato RDT que ya usamos |
|---|---|
| `cantidad` | cantidad solicitada |
| `despachado` | cantidad despachada |
| `recepcion` | cantidad confirmada |
| `recepcionAnterior` | — |

**La confirmación es un cambio de etapa.** El encabezado trae `formMetapaId` y
el objeto `formMetapa`; el documento recién creado queda en
`{formMetapaiD: 2, nombre: "Por Confirmar"}`. Al lado hay una bandera
`avanzaEtapa`, en `false`, y los campos que se llenan al confirmar:
`fechaConfirmacion`, `fechaConfirmacionHora`, `confirmacionVeces` y
**`usuarioConfirmaId`** — este último es el que en producción queda con el
usuario de sistema, el que la pantalla de transacciones muestra como
`M2LinkSystem`.

**Lo que el cuerpo tiene que llevar**, aprendido un error a la vez:

| Error del servidor | Lo que significaba |
|---|---|
| `No Tiene Lineas de detalles` | el cuerpo debe traer `formDdetalles`; no se leen de la base |
| `Falta Cantidad a Despachar` | cada línea necesita `despachado` |
| `Otro usuario Avanzo a etapa Siguiente` | hay que mandar el `formMetapaId` que se leyó, para que cuadre el control de concurrencia |
| `Object reference not set to an instance of an object` | faltaba alguna de las otras colecciones hijas; el manejador las recorre sin preguntar si vienen |
| `An error occurred while saving the entity changes` | aparece sólo con `avanzaEtapa: true` |

El cuerpo que **sí** funciona es un eco del documento leído: todos los
escalares del encabezado, las cinco colecciones hijas presentes (las vacías,
vacías), sin las propiedades de navegación (`items`, `formMetapa`, `bp`…) y sin
las filas de relleno que el servidor arrastra con la clave en cero. Con eso,
`despachado` y `recepcion` quedan guardados y **ningún otro campo se pisa**:
`bpId`, bodegas, fechas y observación siguen intactos.

### Lo que no se pudo cerrar

**Avanzar de etapa.** Con `avanzaEtapa: true`, el servidor responde siempre
`An error occurred while saving the entity changes`. No es validación —el
cuerpo pasa— sino un fallo al escribir en la base, con la causa en una
*inner exception* que no se expone. Desde afuera no hay más que deducir: falta
algo del estado del servidor que no se ve.

Se probó, y falló igual, con todas estas variantes:

- con y sin `recepcion`
- con y sin las filas de relleno de `formDregistros`
- con `fechaDespacho` llenada, que era la **única diferencia observable** entre
  nuestro documento y los que el portal sí lista para confirmar (toda fila de
  `/confirmar/emisiones` trae fecha de despacho; la nuestra la tenía en nulo)

Tres cuerpos distintos, el mismo error exacto. La hipótesis de la fecha de
despacho queda descartada.

Entonces: **las cantidades se escriben, la confirmación no.**

### Dos cosas operativas que hay que tener presentes

1. **El PATCH no es idempotente.** Cada llamada agrega una fila a
   `formDregistros`, **incluso cuando falla**: después de dos intentos (uno
   fallido y uno exitoso) la colección pasó de 1 fila a 3. Cuando esto corra
   solo contra el reporte de Walmart, un reintento no es gratis — hay que
   releer y decidir antes de repetir.
2. **El usuario firma la confirmación.** `usuarioConfirmaId` es la traza. El
   usuario de pruebas sirve en DEMO y sólo en DEMO; en productivo hace falta un
   usuario de sistema propio antes de la primera escritura real.

### La pregunta que queda, con nombre y apellido

> `PATCH /api/FormHeader` guarda bien `despachado` y `recepcion` sobre un
> documento en etapa "Por Confirmar", pero con `avanzaEtapa: true` responde
> *"An error occurred while saving the entity changes"*. ¿Qué más espera el
> comando `UpdateForm` para avanzar de etapa, y qué debería traer el cuerpo?

### Dos callejones sin salida, para no recorrerlos de nuevo

**Observar la red del portal no sirve.** El portal es **Blazor Server**
(`_framework/blazor.server.js`, `/_blazor` por WebSocket): el navegador no
llama a `api.portalredtec.cl`, manda los eventos de la interfaz al servidor y
la confirmación se ejecuta allá adentro. Se confirmaron dos emisiones en DEMO
mirando la red y no hay ningún `PATCH` que capturar, porque no existe del lado
del cliente. Cualquier intento de "ver qué manda el portal" desde el navegador
va a dar lo mismo.

**La fecha de despacho no era.** Ver arriba.

Lo que queda es preguntar. Y conviene decirle a Holux lo de Blazor Server,
porque les señala dónde está la respuesta: el camino que usa su propia
aplicación es interno, no pasa por la API pública.

### Cómo repetir todo esto

```
node scripts\sonda-escritura-redlink.js --catalogo
node scripts\sonda-escritura-redlink.js --maestros
node scripts\sonda-escritura-redlink.js --crear --cliente=499 --servicio=1 --usuario=13 --bodega-origen=1338 --bodega-destino=1524 --cantidad=15 --si
node scripts\sonda-escritura-redlink.js --leer --id=<el id que devolvió>
node scripts\sonda-escritura-redlink.js --confirmar=<id> --cantidad=15 --si
```

Las credenciales se cargan con `backfill\cargar-demo.ps1`, que las pide por
pantalla y las deja sólo en esa ventana. El host está clavado a
`apidemo.portalredtec.cl` y no hay bandera que lo cambie.

Pruebas: `scripts/test-sonda-escritura-redlink.js` — 153 comprobaciones y 127
mutaciones, todas muerden.

Un detalle del orden de los candidatos que cuesta una corrida si se pierde: la
sonda corta en el primer éxito, y el cuerpo que sólo guarda cantidades **siempre**
tiene éxito. Por eso los que intentan avanzar van primero y ése queda al final.
Si se reordena, tapa a los demás y la corrida no prueba nada nuevo.

---

## La máquina de etapas, y dónde actúa el módulo

La tabla `FormMetapa` de la base declara las etapas por tipo de formulario, con
una columna `Confirmar` que marca desde cuál se puede confirmar. Para
`FormId 6` (Transferencia):

| FormMetapaiD | Código | Nombre | Confirmar |
|---|---|---|---|
| 37 | `transferencia` | Transferencia | false |
| 43 | `trans_anexos` | Pendiente Adjuntar Respaldo | false |
| 42 | `trans_volver_atras` | Volver a Adjuntar Respaldo | false |
| **44** | `trans_verifica` | **Pendiente de Confirmación** | **true** |
| 46 | `trans_cerrar` | Transferencia Confirmada | false |
| 49 | `trans_reconfirmar` | Transferencia Reconfirmada | false |
| 48 | `trans_reversar` | Transferencia Reversada | false |
| 47 | `trans_anula` | Transferencia Anulada | false |

El circuito es `37 → 43 → 44 → 46`, con 42 como paso atrás. **El módulo de
Walmart actúa sobre documentos en la etapa 44 y los lleva a 46.** No crea
transferencias ni adjunta respaldos: para cuando llega el reporte diario, el
cliente ya hizo todo eso.

Tres de esas etapas explican conceptos que en `scripts/comparar-cuadre.js`
habíamos deducido del comportamiento, sin saber que tenían nombre propio:
`trans_reversar` es `entradaPalletReversa`, `trans_reconfirmar` es la
reconfirmación que contamos en el reporte, y `trans_cerrar` es la confirmación.

### Walmart es el único retail con transferencias

De los **69 retails** del maestro, **uno solo** tiene `transferencia = true`:
`16 · WALMART CHILE COMERCIAL S.A`. En Redlink la transferencia no es un
movimiento genérico entre socios: es el circuito de Walmart. Eso explica que el
módulo del M2LINK se llame "Confirmaciones Walmart" y no "Confirmaciones
Retail".

### El número que usa el área no es el id

El encabezado trae `folio` — para nuestra transferencia de prueba, `4141181` —
y **ése es el "Nro. Pedido" que muestra el portal**. El `formHeaderiD` (684030)
es interno y no aparece en ninguna pantalla. Buscar por el id en el portal no
encuentra nada; hay que buscar por folio.

### Ids de DEMO para armar una transferencia como las de Walmart

```
cliente (bpId / bpOrigenId)   499   PRODUCTOS FERNANDEZ SA
servicio (formulario 6)        28   Transferencias  (el único)
bodega origen                1524   PF ANTOFAGASTA  (de las 35 del cliente)
retail destino (bpDestinoId)   16   WALMART CHILE COMERCIAL S.A
bodega destino                386   00001 EXPS PLAZA LYON  (de 338)
documento                      14   Transferencia Timbrada
usuario                        13   malfaro
```

Las bodegas de Walmart en DEMO se llaman `00001 EXPS…`, `00032 HIPER…`, con
`codigoSap` tipo `WALMART-005`. **No confirman la regla `/^ZWM/`** que usa
`medir-citas-walmart.js`: esa regla se sostiene por los datos de producción
(`bodegaDestinoStr`), no por este maestro.

### El estado del avance de etapa, caracterizado

`avanzaEtapa: true` falló **siempre**, con el mismo error exacto
(`An error occurred while saving the entity changes`), en todas estas
combinaciones:

- formulario 1 (Emisión) en etapa 2 "Por Confirmar"
- formulario 6 (Transferencia) en etapa 43 "Pendiente Adjuntar Respaldo"
- con y sin `recepcion`, con y sin `fechaDespacho`, con y sin las filas de
  relleno de `formDregistros`

Seis cuerpos, dos tipos de formulario, dos etapas, un único error. Si faltara
un campo, en algún momento el mensaje habría cambiado. **Lectura, no hecho:**
el avance de etapa por este endpoint parece no estar operativo en DEMO —
posiblemente escribe en algo que el ambiente de pruebas no tiene configurado.
Desde afuera no se distingue de un campo faltante, y es justo lo que responde
quien tiene el log del servidor.

Lo que sí quedó probado y es lo que el proyecto necesita: **`PATCH` escribe
`despachado` y `recepcion` sin tocar nada más**. Esa es la mitad del trabajo, y
la mitad difícil de averiguar.

---

## La entrega que funciona hoy, sin esperar a nadie

Marcelo propuso el 9-nov el camino intermedio, y es el que está operativo:
**el m3link produce el listado, el Excel que ya existe hace el ajuste en SAP.**
No hace falta escribir en Redlink para que esto entregue valor.

```
m3link                                   proceso que ya existe
──────                                   ─────────────────────
medir-citas-walmart.js --listado=x.csv
        ↓  folio ; cantRecibida
verificar-listado-walmart.js  (Redlink en vivo, sólo lectura)
        ↓  x-verificado.csv  +  x-verificado-revisar.csv
                                      →  se pega en el Excel de confirmación
                                      →  el Excel ejecuta el ajuste en SAP
```

El `folio` no es un número nuevo: es el `nroPedido` de nuestro contrato, que
`redlink-fetch.js` traduce desde `reg.folio`. Es el mismo "Nro. Pedido" que
muestra el portal — el `formHeaderiD` es interno y no aparece en ninguna
pantalla.

### Por qué la verificación no es opcional

El listado sale del almacén frío, que es una foto diaria. Entre esa foto y el
momento en que alguien pega el CSV pueden pasar días, y el módulo del proveedor
sigue corriendo. Una transferencia confirmada dos veces dispara un **segundo
ajuste de inventario en SAP**, y eso no se deshace.

`verificar-listado-walmart.js` relee Redlink en vivo (GET, nunca escribe) y le
pone veredicto a cada folio: sigue pendiente, ya fue confirmada, lo despachado
cambió, no aparece en la ventana, o el folio cae en más de una operación. Sólo
el primer caso sale al archivo.

### Primera corrida real, 9-nov-2026

Sobre los 8 reportes de Walmart del 23-oct al 5-nov:

| | |
|---|---|
| citas del reporte | 566 |
| la cita resuelve directo | 451 (80%) |
| pendientes de confirmar, con match único | 111 |
| listado propuesto | 104 |
| **confirmables tras verificar en vivo** | **102** |
| de esas, sin diferencia (no admiten discusión) | **94** |
| con diferencia, a decidir | 8 |

Dos ya habían sido confirmadas entre la foto y la verificación — una de ellas
entre dos corridas con veinte minutos de diferencia. El proceso manual está
andando, lento: **103 transferencias llevaban días pendientes.** Ése es el
atraso que la automatización resuelve, y ahora está contado.

De las 8 con diferencia, siete son de 1 a 4 pallets. La octava no:

```
folio 4146335   despachó 19 · Walmart aceptó 3 · quedan 16 por informar
```

Dieciséis de diferencia no es una recepción corta, es una carga rechazada o un
dato malo. Esa necesita que alguien averigüe qué pasó, no una regla.

### La pregunta de las diferencias, ahora con tamaño

La contradicción que quedó abierta el 6-nov —las reglas dicen una cosa, la
pantalla del módulo otra, y lo ya confirmado una tercera— **afecta a 8 de 102**.
Sobre lo ya confirmado, en las diferencias negativas el proceso real confirmó lo
aceptado en 33 casos y lo despachado en 10 (~23%), y 6 de esas 10 son PUNTO
AZUL, lo que sugiere una regla por cliente que nadie documentó.

Es una decisión chica y acotada, no un rediseño. Va a la reunión con números.

### Cómo correrlo

```
node scripts\medir-citas-walmart.js <carpeta de reportes> --listado=confirmar.csv
node scripts\verificar-listado-walmart.js --listado=confirmar.csv ^
     --salida=confirmar-verificado.csv --sin-diferencia
```

La verificación usa las mismas Application Settings de producción que el m3link
ya ocupa para leer (`REDLINK_CLIENT_SECRET`, `REDLINK_USER`, `REDLINK_PASS`).
Tarda alrededor de 80 segundos: lee 45 días de histórico completo.

Pruebas: `test-medir-citas-walmart.js` (44 y 41 mutaciones) y
`test-verificar-listado-walmart.js` (31 y 28 mutaciones). Todas muerden.

---

## El contrato de la confirmación, medido botón por botón (9-nov-2026)

El portal es Blazor Server: los clics viajan por WebSocket y no hay petición que
capturar. Pero el **efecto** sí se ve. Tomando una instantánea del documento
antes y después de cada botón, el diff dice exactamente qué produce cada acción
— que es lo que hay que reproducir, no la forma del mensaje.

Se hizo sobre una transferencia de prueba creada en DEMO (id 684031, 10 pallets,
PF → Walmart). `scripts/sonda-escritura-redlink.js --instantanea=` y `--comparar=`.

### Son DOS operaciones, no una

| | Pantalla | Botón | Etapa |
|---|---|---|---|
| Paso 1 | Transacciones en proceso → Transferencia | **Actualizar y Avanzar** | 43 → 44 |
| Paso 2 | Confirmaciones → Confirmar transferencia | **Confirmar** | 44 → 46 |

**Qué deja el paso 1** (avanzar):

```
formMetapaId          43 -> 44
usuarioIngresoId      13 -> 6          <- la firma se escribe ACA
usuarioIngresoNombre  malfaro -> mmesias
fechaConfirmacion     null -> 2026-11-09
confirmacionVeces     0 -> 1
formDdetalles[0].recepcionAnterior   null -> 0
formDregistros        +1 fila (relleno, todo en cero)
```

**Qué deja el paso 2** (confirmar):

```
formMetapaId          44 -> 46
confirmacionVeces     1 -> 2
abierto               true -> false    <- el documento se cierra
formDdetalles[0].recepcion          null -> 10
formDdetalles[0].recepcionAnterior  0 -> 10
formDregistros        +1 fila
```

### La firma NO está donde parecía

`usuarioConfirmaId` quedó en **null** incluso después de una confirmación real
hecha a mano en el portal. No es ahí donde queda la traza.

Donde queda es en **`usuarioIngresoId`**: el portal lo sobrescribe con el
usuario que ejecuta la acción. Ésa es la columna "Usuario" de la pantalla de
transacciones, y por eso las confirmaciones automáticas aparecen como
`M2LinkSystem`.

Para nuestra escritura esto es una obligación, no un detalle: hay que **mandar**
el id del usuario que firma. El servidor no lo deduce del token — se comprobó
creando un documento con `usuarioIngresoId: 13` estando autenticado como otro
usuario, y quedó con 13.

El número tampoco sale del token: el scope `usersiD` pertenece al cliente del
portal (`portalredtecapp`), no al de la API (`apiportalredtec`), y pedirlo
devuelve `invalid_scope` y deja **sin token**. El token de la API sí trae
`preferred_username`, `bpid`, `cardname`, `cargo` y `email`, pero no el id.
`--quiensoy` lo muestra.

Dato conocido: **`mmesias` es el `usersiD` 6**, deducido del diff. Falta el de
`M3LinkSystem`, y es una pregunta de un renglón a quien administra los usuarios.

### Por qué en DEMO no se puede avanzar, y ya no es misterio

`avanzaEtapa: true` falló **siempre**, con el mismo error de guardado, en:

- formulario 1 (Emisión), etapa 2
- formulario 6 (Transferencia), etapa 43 "Pendiente Adjuntar Respaldo"
- formulario 6 (Transferencia), **etapa 44 "Pendiente de Confirmación"** — la
  etapa desde la que el botón del portal sí funciona
- con y sin recepción, con y sin `fechaDespacho`, con y sin las filas de relleno

Siete intentos, cuatro etapas, dos formularios, seis cuerpos, un solo error.
Y en paralelo, lo que **sí** funciona siempre es escribir cantidades sin
avanzar.

Eso encajaba con lo que explicó el proveedor: **confirmar o reconfirmar dispara
un proceso de ajuste hacia SAP que mueve bodegas**. DEMO no tiene esa
integración, así que la parte que no toca SAP pasaría y la que sí toca fallaría.

> ### ESTA TEORÍA ESTÁ MUERTA (9-nov-2026)
>
> El 9-nov se probó en **productivo**, que sí tiene la integración con SAP, y
> dio **exactamente el mismo error**. Dos veces: con la firma en el cuerpo y
> sin ella. O sea el problema no era "el otro lado que no está".
>
> Van **ocho intentos** en cuatro etapas, dos formularios, seis cuerpos y
> **los dos ambientes**, siempre el mismo `DbUpdateException`. La lectura que
> queda en pie es más simple y más incómoda: **`PATCH /api/FormHeader` con
> `avanzaEtapa: true` no confirma, y punto.** Los botones del portal hacen otra
> cosa — otro endpoint, un procedimiento almacenado, o el Excel.
>
> Se deja escrita la teoría vieja, y no se borra, porque tenía toda la pinta de
> ser cierta y encajaba con lo que había dicho el proveedor. Eso es justamente
> lo que la hacía peligrosa.

### Cómo repetir la medición

```
node scripts\sonda-escritura-redlink.js --crear --form=6 --cliente=499 ^
     --servicio=28 --usuario=13 --bodega-origen=1524 --destino=16 ^
     --bodega-destino=386 --documento=14 --documento-numero=900003 ^
     --cita=42674993 --cantidad=12 --si
node scripts\sonda-escritura-redlink.js --instantanea=t0.json --id=<el que devolvio>
   (apretar "Actualizar y Avanzar" en el portal)
node scripts\sonda-escritura-redlink.js --instantanea=t1.json --id=...
   (apretar "Confirmar")
node scripts\sonda-escritura-redlink.js --instantanea=t2.json --id=...
node scripts\sonda-escritura-redlink.js --comparar=t0.json,t1.json
node scripts\sonda-escritura-redlink.js --comparar=t1.json,t2.json
```

La instantánea hay que tomarla **antes** del primer clic: si el documento ya
está confirmado, los tres diffs salen vacíos y no se aprende nada.

## Corrección: a quién se le avisa

El aviso al cliente son las diferencias **POSITIVAS**, no las negativas.
Confirmado por el área el 9-nov: si el cliente despachó 10 y Walmart dice 15, se
confirman 10 y hay que avisarle para que **emita otra transferencia por los 5
que faltan** — esos pallets están en Walmart sin respaldo. Si Walmart recibió
menos, se confirma lo recibido y no queda nada abierto: la diferencia es un
problema de transporte, no una transferencia por emitir.

`reglaCantidad()` devolvía lo contrario hasta el 9-nov, leído de la pantalla del
proveedor en vez de las reglas escritas. El correo al cliente habría salido con
los casos equivocados.

## Corrección: no toda etapa pendiente es confirmable

`estaConfirmada()` descarta las confirmadas, pero **"Pendiente Adjuntar
Respaldo" y "Pendiente de Confirmación" empiezan las dos con "Pendiente"** y
pasaban igual. El listado proponía confirmar documentos que todavía esperan el
respaldo del cliente.

Medido sobre los 104 propuestos: **91 estaban en "Pendiente Adjuntar
Respaldo"**, 10 en "Pendiente de Confirmación", 3 ya confirmadas. Si ese 91 es
real, hay un atraso del que nadie está hablando; si el flujo de Walmart salta
ese paso, el filtro sobra. El filtro quedó **opcional** (`--exigir-etapa`) hasta
que se compruebe operando, porque es una regla deducida de la tabla y no vista
funcionar.

De paso aparecieron dos que nunca debieron estar en el listado: una
**Transferencia Anulada** y una **relocalización** a la que la cita hizo match
por error. Ahora tienen veredicto propio.

## La pantalla: `confirmaciones-walmart.html` (9-nov-2026)

El módulo de M2LINK que hacía este trabajo **murió** con unos cambios en Holux.
No se está reemplazando contra un plazo: no hay nada corriendo. Por eso lo que
se entrega es la herramienta andando, no el alcance.

**Qué hace.** Se arrastra el `.xlsx` de Walmart tal como llega por correo. El
archivo se lee **en el navegador** y no se sube a ninguna parte. De las fechas
del propio reporte sale la ventana de consulta (±20 días, editable), se piden
las transferencias a `/proxy/ops` —la misma lectura autenticada que usa el
resto del m3link, así que no hubo que escribir ninguna Function nueva ni se
toca el corte de 45 s— y se entrega el cruce en tres bandejas:

| bandeja | qué trae | salida |
|---|---|---|
| Por confirmar | folio + cantidad, con la etapa a la vista | CSV `folio;cantRecibida` y copiar/pegar a Excel |
| Avisar al cliente | las diferencias **positivas**: Walmart recibió más de lo despachado | CSV con cliente, cita y cantidad |
| Excepciones | toda cita que no entra, **con su motivo** | CSV |

Medido contra `Reporte-RedTec5.xlsx` real: 106 citas → 85 por confirmar, 9
avisos, 21 excepciones. 85 + 21 = 106: **ninguna cita desaparece en silencio**.

**Dónde vive la lógica.** En `data/walmart-nucleo.js`, sin dependencias, cargado
tanto por la página como por `scripts/test-walmart-nucleo.js` en Node: **una
sola copia de la regla**. Dos copias de la misma regla se separan sin que nadie
se entere y después nadie sabe cuál de las dos corrió. 74 pruebas, 76
mutaciones, todas mueren.

El `.xlsx` se abre sin librería: es un ZIP con XML adentro, y tanto Chrome como
Node traen `DecompressionStream`. Dos trampas que las pruebas cubren porque ya
nos mordieron: los largos de nombre y extra del **encabezado local** no son los
del directorio central (usar los del central corre el dato unos bytes sin
avisar), y la celda **autocerrada** `<c r="B1"/>` tiene que ir primero en la
alternancia del regex o la rama normal se la come junto con la celda siguiente.

**Lo que la pantalla NO hace todavía.** No escribe en Redlink. Entrega la lista;
la confirmación se ejecuta con `scripts/confirmar-redlink.js`, de a un folio,
contra producción, y **esa prueba con un folio real sigue pendiente**. También
sigue pendiente el `usersiD` numérico de `M3LinkSystem`, que es lo que se graba
como firma en `usuarioIngresoId`.

**Un hallazgo del reporte real.** De 573 filas en ocho reportes, 3 traen en la
columna `appt_nbr` un número corto y sin cliente (38046, 38044, 38090): son
filas de resumen, no citas. Salen con motivo propio y no como "sin coincidencia
en Redlink", que mandaría a alguien a buscar en Redlink algo que nunca existió.

## Resuelto: la etapa 43 SÍ se confirma por el camino masivo (9-nov-2026)

Durante días se trabajó suponiendo lo contrario. La tabla `FormMetapa` marca
`Confirmar=true` en una sola etapa por formulario —la **44**, "Pendiente de
Confirmación"— y la **43**, "Pendiente Adjuntar Respaldo", parecía un paso del
negocio que faltaba. El filtro quedó deliberadamente **opcional** porque la
regla estaba deducida de la tabla y no vista funcionar.

**Marcelo lo cerró:** en las confirmaciones **masivas** de Walmart no
corresponde adjuntar respaldo. Ese paso existe para que la gente de logística
no tenga que ir documento por documento; por el camino masivo se confirma de
una. O sea la 43 es confirmable en este circuito.

Lo que cambió, en los tres lugares donde vivía la regla:

| archivo | antes | ahora |
|---|---|---|
| `data/walmart-nucleo.js` | sólo 44 | `ETAPAS_CONFIRMABLES` = 43 y 44 |
| `scripts/verificar-listado-walmart.js` | sólo 44 | ídem; `--exigir-etapa` sigue existiendo y ahora sólo descarta 46/47/49 |
| `scripts/confirmar-redlink.js` | **rechazaba** la 43 | la acepta |

El tercero era el que importaba: es el que escribe. Con la regla vieja, la
primera confirmación real habría fallado en **55 de los 60 folios del día**.

La lista es explícita y corta a propósito, y las pruebas lo fijan: **empezar con
"Pendiente" no alcanza**. Las dos confirmables empiezan con esa palabra, así que
un `/pendiente/i` dejaría pasar cualquier etapa futura que arranque igual — que
es exactamente el error que ya nos mordió una vez.

En la pantalla se sacó el interruptor "dejar afuera lo que espera respaldo": un
control que ya no hace nada confunde más de lo que ayuda. En su lugar quedó la
regla escrita, con fecha y con quién la respondió.

## El costo del módulo muerto, medido (9-nov-2026)

Porcentaje de transferencias de Walmart que quedan en etapa 43, por semana de
despacho, sobre 5.931 operaciones a bodegas `ZWM*` de los dos servicios:

| semana del | en espera |
|---|---|
| 17-ago a 12-oct | 2 – 8 % |
| 19-oct | 18 % |
| 26-oct | 12 % |
| **2-nov** | **59 %** — 315 de 535 |

El residuo normal era 2–8 %. El atraso arranca a mediados de octubre y se rompe
la primera semana de noviembre. No es una opinión sobre lo que pasa cuando el
módulo deja de correr: es el dato.

## Quién firma: medido en producción (9-nov-2026)

```
node scripts/confirmar-redlink.js --productivo --quien=4145690 --dias=7

  histórico 2026-11-02 a 2026-11-09: 4746 operaciones
  folio 4145690  (documento 688543)
  etapa                  Transferencia Reconfirmada
  usuarioIngresoNombre   M2LinkSystem
  usuarioIngresoId       951
  usuarioConfirmaId      (null)
```

Tres cosas quedan fijadas con esto:

1. **La firma es `usuarioIngresoId`**, y en producción `usuarioConfirmaId` queda
   en `null` incluso en un documento Reconfirmado. Lo mismo que se había medido
   a mano en DEMO, ahora confirmado sobre un documento real del módulo viejo.
2. **M2LinkSystem = 951** en producción. Sirve de patrón de control.
3. El modo `--quien` lee y no escribe: no pide `--cantidad` ni las credenciales
   de escritura.

### La ventana de 31 días se cortaba por tamaño

El primer intento con `--dias=30` devolvió HTTP 200 con el cuerpo vacío, y el
script lo reportó como "no hay datos en esa ventana: prueba --dias mayor" — el
consejo exactamente al revés. La causa era `await r.text().catch(() => '')`, que
convierte un corte de descarga en una respuesta vacía. Con `--dias=7` entró sin
problema: 4.746 operaciones.

Ahora `leerCuerpo()` guarda el motivo del corte y `porQueNoHayJson()` separa las
tres cosas que antes se contaban como una: se cortó la bajada, el servidor
contestó vacío de verdad, o contestó algo que no es JSON. Si el servidor declara
un `content-length` y llegan cero bytes, lo dice: **el cuerpo se perdió, no vino
vacío.**

### LA TRAMPA: el id de DEMO no sirve para producción

DEMO y producción son bases distintas. El `usersiD` de M3LinkSystem en DEMO no
tiene por qué ser el mismo que en producción, y escribir el número equivocado en
`usuarioIngresoId` firma la confirmación con otro usuario — o con ninguno.

Por eso el experimento en DEMO (crear un documento, aprobarlo como M3LinkSystem
y leer la firma) sirve para **probar el camino de escritura de punta a punta**,
no para cosechar el número que se va a usar en producción.

El número de producción sale de la tabla de usuarios, y la consulta se valida
sola: **pedir los dos usuarios juntos**. Si M2LinkSystem vuelve 951, la tabla y
la columna son las correctas y el número de M3LinkSystem de esa misma consulta
es confiable. Si vuelve otra cosa, se está mirando el lugar equivocado.

## M3LinkSystem = 983, y el defecto que el número destapó

Marcelo entregó el `usersiD` de producción el 9-nov-2026: **983**. Encaja con el
patrón de control — M2LinkSystem es 951, los dos usuarios de sistema en el mismo
rango.

Al cablearlo apareció un defecto que sólo se habría notado después de la primera
confirmación real, y en el peor lugar: **el cuerpo del PATCH no llevaba la
firma**. `cuerpoEco` devolvía el `usuarioIngresoId` que el documento ya traía,
así que la confirmación habría quedado a nombre de **quien tocó el documento
antes** — probablemente el usuario del cliente que emitió la transferencia. No
habría dado error. Simplemente nadie habría sabido que la hizo el m3link, y el
rastro de auditoría habría apuntado a una persona que no hizo nada.

Tres cosas quedaron en su lugar:

1. El cuerpo lleva `usuarioIngresoId: 983` (parametrizable por
   `REDLINK_M3LINK_USERSID`, e inyectable en `planDeConfirmacion` para poder
   probarlo).
2. **Sin usersiD el plan se niega.** Mejor no escribir que escribir sin firma.
3. Después de escribir, `veredictoDeFirma()` juzga el resultado **por el
   NOMBRE** que devolvió el servidor, no por el número. Un id equivocado no da
   error: graba otro usuario y se queda callado. Lo único que prueba que 983 era
   el correcto es que vuelva `usuarioIngresoNombre = M3LinkSystem`. Si no
   vuelve, el script lo dice en mayúsculas y termina con código 1.

### De paso: el campo que no se mostraba

`--leer` de la sonda lista los "campos que huelen a estado de confirmación" con
un filtro por nombre, y ese filtro **no incluía la palabra "usuario"**. El único
campo de usuario que aparecía era `usuarioConfirmaId`, que está siempre en
`null`. El que de verdad se escribe —`usuarioIngresoId`— quedaba invisible.

Eso fue parte de por qué durante días se creyó que la firma era `usuarioConfirmaId`:
**el que no se muestra es el que no se revisa.** El filtro ahora incluye
"usuario" y la prueba T25b lo fija.

## Primer disparo real: HTTP 400, y no se escribió nada (9-nov-2026)

```
folio 4139366  (documento 682214)   Trans Diferenciada · ZWM01 CD WM LO AGUIRRE SECO
etapa Pendiente Adjuntar Respaldo   despachado 30 -> a confirmar 30

PATCH /api/FormHeader  ->  HTTP 400
respuesta: {"error":"An error occurred while saving the entity changes.
            See the inner exception for details."}

El documento NO cambió.
FIRMA MAL: se mandó 983 y quedó 920 / "Eliecer_Baeza"
```

**No hubo movimiento en SAP y el documento quedó intacto.** El chequeo de firma
que se había agregado esa misma mañana avisó en el acto en vez de dejar creer
que había quedado confirmada.

De paso: **Eliecer_Baeza = 920**. Con 920, 951 (M2LinkSystem) y 983
(M3LinkSystem) el espacio de ids es consistente, así que 983 es plausible —
pero sigue sin estar verificado contra producción.

### Dos sospechosos, y el cuerpo lleva los dos

El mensaje es un `DbUpdateException` de Entity Framework: algo falló al grabar
en la base, no al validar la petición. El cuerpo lleva **dos cosas que nunca se
vieron grabar**:

| sospechoso | antecedente |
|---|---|
| `avanzaEtapa: true` | **siete intentos fallidos en DEMO**, en cuatro etapas, dos tipos de formulario y seis cuerpos distintos. Nunca funcionó en ningún lado |
| `usuarioIngresoId: 983` | se agregó hoy. Si 983 no existe en la tabla de usuarios de PRODUCCIÓN, una violación de clave foránea da exactamente este error |

Un 400 no dice cuál de los dos fue, y adivinar cuesta escrituras en producción.

### Cómo se separan, sin adivinar

Primero, lo gratis: el mensaje dice *"See the inner exception for details"*. Esa
excepción interna está en el log del servidor y la lee Marcelo o Holux en un
minuto. Si dice violación de clave foránea sobre el usuario, el problema es 983;
si habla de la etapa o del ajuste a SAP, es `avanzaEtapa`. **Eso vale más que
cualquier intento adicional.**

Si hay que medirlo igual, el script trae dos banderas que sacan una variable por
vez (`--sin-firma` y `--sin-avanzar`), y el orden importa:

1. `--sin-firma` primero. Si graba, la confirmación queda completa pero a nombre
   del usuario anterior — recuperable, y además prueba que el problema era 983.
   Si vuelve a dar 400, el problema es `avanzaEtapa` y la firma queda absuelta.
2. `--sin-avanzar` sólo después, y con cuidado: si graba, escribe la recepción
   **sin** avanzar la etapa y deja el documento a medio camino.

Un PATCH que falla no cambia nada —está comprobado en esta misma corrida—, así
que el riesgo de cada intento está sólo en que tenga éxito a medias.

## El histórico se baja por tramos (9-nov-2026)

El intento con `--sin-firma` ni siquiera llegó al PATCH:

```
El histórico no vino como JSON.
  ruta: /api/FormHeader/historico/433?fechainicio=10-10-2026&fechafin=11-09-2026
  la descarga se CORTÓ a mitad de camino: The operation was aborted due to timeout
  no es que no haya datos — no se alcanzó a leer la respuesta
```

Ese mensaje, escrito una hora antes, resolvió de una el misterio del "cuerpo
vacío" del primer `--quien`: **31 días del BP 433 son ~17.500 operaciones con el
registro crudo completo y la descarga no alcanza a terminar en 60 segundos.**
Con la versión anterior del script esto se habría leído como "no hay datos en
esa ventana, prueba --dias mayor" — el consejo exactamente al revés.

El arreglo no es adivinar `--dias`. `buscarPorFolio` ahora baja el histórico
**en tramos de 7 días, del más nuevo al más viejo, y corta apenas encuentra el
folio**. Un folio del día aparece en el primer tramo; el 4139366, despachado el
23-oct, aparece en el tercero. El código del m3link que sí funciona también
trocea (31 días), pero corre dentro de Azure y no sobre la conexión de una
oficina.

Cada tramo se canta mientras baja, así que si uno se corta se ve cuál y dónde
iba:

```
  tramo 1/5  2026-11-03 a 2026-11-09: 4.746 operaciones
  tramo 2/5  2026-10-27 a 2026-11-02: 5.112 operaciones
  tramo 3/5  2026-10-20 a 2026-10-26: 4.980 operaciones  <- acá está
```

`buscarPorFolio` recibe la función que baja cada tramo, así que las pruebas la
ejercitan sin red: que corte apenas encuentra, que recorra la ventana entera
antes de decir que no está, que compare el folio como texto (el argumento llega
como texto y el dato viene como número), y que un `--dias` mal escrito no deje
la búsqueda en cero tramos — buscar en cero tramos diría "no aparece" sin haber
mirado nada.

### El umbral del timeout no es fijo: el tramo se parte solo

A las 15:30 un tramo de 7 días entró sin problema (4.746 operaciones). A las
17:00 **el mismo tamaño se cortó**. O sea el límite no es una cantidad de
registros: depende de cómo esté el servidor y la conexión en ese momento, y
pedirle a alguien que adivine el `--tramo` es hacerle perder vueltas.

`traerTramo` ahora, **ante un corte de tiempo**, parte el tramo al medio y
reintenta cada mitad, recursivamente, hasta llegar a un día. Lo dice mientras lo
hace:

```
  · el tramo 2026-11-03 a 2026-11-09 se cortó por tiempo;
    lo parto en 2026-11-03..2026-11-05 y 2026-11-06..2026-11-09
```

Tres cosas que las pruebas fijan, porque las tres se pueden romper en silencio:

- **Sólo se parte ante un corte de TIEMPO.** Ante un 400 o un 500 pedir menos
  no arregla nada: sería repetir el mismo error dos veces.
- **Vuelven LAS DOS mitades.** Quedarse con la primera haría invisible un folio
  y el script diría "no aparece" sobre datos que sí bajó.
- **Si el tramo ya es de un día, revienta y dice cómo salir** (`--timeout=120`,
  u otra conexión) en vez de devolver vacío, que se leería como "no hay datos".

## El experimento de aislamiento: la firma queda absuelta (9-nov-2026)

```
tramo 1/5  2026-11-03 a 2026-11-09: 4.038 operaciones
tramo 2/5  2026-10-27 a 2026-11-02: 4.281 operaciones
tramo 3/5  2026-10-20 a 2026-10-26: 4.279 operaciones  <- acá está
histórico: 12.598 operaciones en 3 de 5 tramos

PATCH /api/FormHeader  ->  HTTP 400
respuesta: {"error":"An error occurred while saving the entity changes..."}
El documento NO cambió.
Firma: se mandó SIN firma a propósito; quedó 920 / "Eliecer_Baeza"
```

Mismo error **sin** `usuarioIngresoId` en el cuerpo. Los dos sospechosos quedan
resueltos:

| sospechoso | veredicto |
|---|---|
| `usuarioIngresoId: 983` | **absuelto.** El error aparece igual sin él |
| `avanzaEtapa: true` | **culpable.** Único elemento común a los ocho intentos |

El troceo funcionó como se esperaba: tres tramos, cortó al encontrarlo, no bajó
los dos viejos.

### Lo que esto cambia

Marcelo había propuesto un "camino intermedio": que el m3link genere las
columnas `folio` y `cantRecibida` para pegarlas en el Excel que conversa con el
sistema. A la luz de estos ocho intentos, **ese camino puede no ser intermedio
sino el único**: es plausible que el Excel exista precisamente porque la
confirmación no se puede disparar por el API.

Y para ese camino **la herramienta ya está terminada**: la pantalla entrega
exactamente `folio;cantRecibida`, que es el contrato que pidió Marcelo.

### Lo que NO conviene probar

`--sin-avanzar` diría si el API puede escribir *algo* en este documento. Pero ya
se sabe por DEMO que `despachado` y `recepcion` persisten, así que lo más
probable es que grabe la recepción **sin** avanzar la etapa y deje un documento
productivo a medio camino — bastante ruido a cambio de poca información nueva.

La pregunta que queda es **cómo confirma el portal de verdad**, y eso lo
contesta el proveedor, no otro intento en producción.

## La consulta también va por tramos (10-nov-2026)

Con Redlink lento, la página **no funcionaba**: pedía los ~40 días de la ventana
en una sola llamada y el proxy moría con `502 Proxy error · fetch failed` a los
21 segundos. Medido el 10-nov en vivo: 2 días responden en 1 segundo, 10 días
mueren a los 21.

`traerOperaciones()` ahora parte la ventana en tramos de 5 días, y un tramo que
falla se parte al medio y se reintenta hasta tres niveles. Validado contra el
Redlink real de ese día: **8 de 9 tramos entre 0,3 y 1,7 segundos, cero
duplicados** entre tramos.

### Por qué un hueco importa tanto

Una operación que no se trajo **se ve exactamente igual que una que no existe**:
la cita cae en "sin coincidencia en Redlink", que es justamente la lista que se
le manda al cliente para que emita de nuevo la transferencia. Un hueco silencioso
termina en un correo pidiéndole al cliente que reemita algo que ya está.

Por eso lo que falta se **anota** y se avisa, y nunca se presenta como resultado
completo.

### Pero no todo hueco importa: de dónde viene cada día

`/proxy/ops` ya sirve los días **cerrados** desde nuestro blob
`redtec-os-operaciones` (instantáneo) y sólo los **últimos 2 días** en vivo
contra Redlink (`OPS_COLD=operaciones`, `OPS_COLD_LIVE_DIAS=2`, confirmado con
`?diag=1`). La parte que falla es casi siempre esa cola viva.

Y para este tablero, la cola viva casi no importa: las transferencias de un
reporte de Walmart se despacharon días o semanas antes de la recepción, así que
salen del blob.

De ahí la regla final: **se bloquea la descarga de excepciones sólo si el tramo
que faltó se pisa con las fechas PROPIAS del reporte** (sin el margen de ±20
días). Un hueco en el margen se avisa y no estorba.

### Un hallazgo para el proveedor

El 10-nov, el histórico de **2026-11-09 solo** falló de forma reproducible: 502 a
los ~21 segundos, dos veces seguidas, mientras 2026-11-08 devolvía 33
operaciones en 0,3 segundos y un tramo de 5 días traía 3.753 en 1,7. No es
volumen: es ese día.

## La etapa SÍ se puede escribir — y por qué igual no sirve (10-nov-2026)

Nunca se había probado **escribir `formMetapaId` directo** en vez de pedir
`avanzaEtapa: true`. Se probó en DEMO sobre el documento 684033:

```
etapa directa · formMetapaId=44, SIN avanzaEtapa   ->  HTTP 200
antes:   Pendiente Adjuntar Respaldo · despachado 10 · recepcion null
después: Pendiente de Confirmación   · despachado 10 · recepcion 10
```

Es lo primero que mueve la etapa por el API, después de ocho intentos con
`avanzaEtapa`. Pero mover la etapa **no es confirmar**. Comparado contra lo que
deja el botón "Actualizar y Avanzar" del portal, se consiguieron **2 de 5**
efectos:

| efecto del paso 1 del portal | nosotros |
|---|---|
| `formMetapaId` 43 → 44 | **sí** |
| `usuarioIngresoId` → el que actúa | **sí** |
| `fechaConfirmacion` → fecha | no (`null`) |
| `confirmacionVeces` 0 → 1 | no (`0`) |
| `formDdetalles[0].recepcionAnterior` → 0 | no (`null`) |

El resultado es un documento que **el portal nunca produciría**: dice "Pendiente
de Confirmación" con recepción escrita, pero sin fecha, sin contador y sin
recepción anterior.

**Hallazgo bueno de paso:** se mandó `usuarioIngresoId: 6` y el servidor
devolvió `usuarioIngreso: {usersiD: 6, userName: "mmesias"}`. Resuelve el nombre
solo, así que la firma por id funciona — en productivo, 983 haría aparecer
M3LinkSystem.

### Lo que cierra la puerta: no podemos verificar el ajuste

El contrato RDT trae los campos que dirían si el movimiento llegó a SAP:
`enviadoSap`, `sapObjType`, `sapDocEntry`, `sapDocNum`. Y no es que no lleguen
los datos de transporte — sus vecinos del mismo origen vienen poblados
(`patente` en 480 de 1.491 operaciones, `chofer` en 483, `folioGuiaDte` y
`linkGuia` en 38).

Pero los cuatro campos SAP están **vacíos en las 1.491 operaciones**, incluidas
las **281 confirmadas** por M2LinkSystem y por personas.

O sea: aunque lográramos fabricar la confirmación, **no tendríamos forma de
comprobar desde nuestro lado que el inventario se movió.** Escribir sin poder
verificar, sobre un documento que mueve stock, es peor que no escribir.

### Conclusión de la línea de investigación

1. `avanzaEtapa: true` no funciona. Ocho intentos, dos ambientes.
2. `formMetapaId` directo **sí** mueve la etapa, pero deja el documento a medio
   camino, en un estado que el portal no produce.
3. El ajuste a SAP **no es verificable** con los datos que tenemos.

Con eso, la escritura por API queda descartada **con dato, no por cansancio**.
El camino que queda es el que propuso Marcelo: el m3link entrega `folio` y
`cantRecibida`, y la confirmación corre por donde hoy ya funciona. Para ese
camino la herramienta está terminada.

# LA RESPUESTA: cómo se confirma de verdad (10-nov-2026)

Luis Macri, autor de M2LINK, entregó la planilla `Confirmacion_Ver2.xlsm` que el
proveedor mandó usar como reemplazo. Su macro contiene el mecanismo completo.

**Nuestro error era estructural: armábamos el cuerpo del PATCH nosotros. El
servidor lo arma.** Existe un endpoint dedicado que devuelve el documento ya
preparado para confirmar, y lo único que hay que hacer es devolvérselo tal cual.

### El flujo, en cuatro pasos

```
1.  POST https://accounts.portalredtec.cl/realms/Redtec/protocol/openid-connect/token
    client_id=apiportalredtec & grant_type=password & client_secret=... &
    scope=openid & username=... & password=...
    -> la macro toma id_token (nosotros veníamos usando access_token)

2.  GET  /api/User/nombreusuario/{nombre}
    -> devuelve el usuario, de donde sale "usersiD"

3.  GET  /api/FormHeader/ConfirmarTransferencia
             /Folio/{folio}
             /recibido/{cantidad}
             /original/CONFIRMAVER2
             /usuarioconfirma/{usersiD}
    -> devuelve el documento YA ARMADO para confirmar (esto es lo que faltaba)

4.  PATCH /api/FormHeader
    cuerpo = la respuesta EXACTA del paso 3, sin tocar
    -> 200 = confirmada
```

El segmento `original/` es una marca de procedencia: la planilla manda
`CONFIRMAVER2`. Es el equivalente a nuestra firma, y queda del lado del
servidor.

### Lo que esto corrige de todo lo anterior

| lo que creíamos | lo que es |
|---|---|
| `avanzaEtapa: true` es la forma de confirmar | no existe como mecanismo; el endpoint dedicado hace todo |
| hay que construir el cuerpo del PATCH | el servidor lo construye y lo entrega |
| hay que averiguar el `usersiD` preguntando | sale de `/api/User/nombreusuario/{nombre}` |
| el API de escritura se rompió | el API funciona; nunca habíamos encontrado la ruta |

Los ocho 400 se explican solos: mandábamos un cuerpo armado a mano a un endpoint
que espera el cuerpo que él mismo genera.

### Hallazgo de seguridad

La macro trae el **`client_secret` de `apiportalredtec` en texto plano**, en un
archivo que circula por correo y vive en OneDrive. Es el mismo client que usa el
m3link. **Hay que rotarlo**, y tratar esa planilla como material comprometido.

## Implementado en `scripts/confirmar-redlink.js` (10-nov-2026)

El script ya no arma ningún cuerpo. Quedó en cuatro pasos, con un paso de
**mirar** antes del paso de **mandar**:

```
node scripts/confirmar-redlink.js --productivo --usuario=M3LinkSystem
   -> GET /api/User/nombreusuario/M3LinkSystem, imprime usersiD y userName,
      y lo coteja con el 983 configurado. No toca ninguna transferencia.

node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K
   -> busca el folio, lee el documento, revisa las nueve guardas del plan y
      MUESTRA la URL del preparador. No pega en el servidor de escritura.

node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --preparar
   -> además pide el documento preparado y lo revisa: tamaño, etapa que trae,
      recepción que trae y a nombre de quién viene firmado. NO manda el PATCH.

node scripts/confirmar-redlink.js --productivo --folio=N --cantidad=K --si
   -> lo mismo y además el PATCH con el cuerpo exacto. Esto confirma y mueve
      inventario en SAP.
```

### Decisiones que vale la pena dejar escritas

**El cuerpo se manda como texto, no reserializado.** `body: prep.texto`, los
bytes tal como vinieron. Un `JSON.parse` + `JSON.stringify` cambia el orden de
las claves, el formato de los decimales y la representación de las fechas. No
sabemos qué mira el servidor; sabemos que ocho cuerpos armados por nosotros
fallaron.

**`--preparar` existe porque nadie midió si `ConfirmarTransferencia` sólo
prepara.** El nombre dice "Confirmar" y en la macro el PATCH es el que
compromete, pero esa misma clase de inferencia razonable fue la teoría muerta de
la página anterior. Así que el GET no se dispara sin que alguien lo pida, y el
plan sin banderas no toca el servidor de escritura.

**El `usersiD` se pregunta por nombre y se coteja con el configurado.** Si la
API dice otro número, el script **se detiene**: hay dos fuentes y se
contradicen, y elegir una a ojo firma a nombre de quien no confirmó. Si la API
no contesta, sigue con el 983 pero dice "no se pudo verificar" — porque decir
"verificado" sin haber verificado es lo que haría que nadie vuelva a mirarlo.

**El GET del preparador va con M3LinkSystem, no con el usuario de lectura.** La
macro corre todo con una sola sesión, la del que confirma. Si el servidor lo
rechaza por permisos (401/403) reintenta con el de lectura **y lo dice**, porque
la firma la lleva la URL y no el token — eso está medido. Un 500 no se reintenta:
reintentar un error del servidor con otro usuario esconde el problema y manda el
mismo pedido dos veces.

**Se fueron `--sin-firma` y `--sin-avanzar`.** Servían para aislar cuál de dos
campos causaba el 400. Ya se sabe: ninguno de los dos, era el cuerpo entero.
Dejarlas sería dejar a mano el único camino que sabemos que no funciona.

### Guardas antes de mandar

Antes del PATCH el documento preparado tiene que pasar: que sea JSON, que no
traiga `error` adentro de un 200, que sea **del folio que pedimos** (un folio
cruzado confirma la transferencia equivocada y el PATCH no pregunta), que traiga
una sola línea de detalle y que su `recepcion` sea **la cantidad que pedimos**.
Cualquiera de esas cosas detiene la corrida.

### `--candidatos`: de dónde sale el folio

El 10-nov quedó claro que pedirle a alguien un folio para tipear es pedirle que
se equivoque (la primera corrida se hizo literal con `--folio=N`). Así que el
script lo busca:

```
node scripts/confirmar-redlink.js --productivo --candidatos
```

Lee el histórico de los **últimos 3 días** (no 30: son ~4.000 operaciones por
semana y la que se confirma hoy es de ayer o de hoy), filtra las que van a
Walmart y están en etapa 43 o 44, lee el documento de cada una para saber la
cantidad despachada, la pasa por **las mismas nueve guardas del plan** y escribe
la línea de comando lista para copiar. Corta en cuanto junta las que pidió
(`--cuantos=5` por omisión), así que no baja los cinco tramos.

Los nombres de los campos se leen por lista de alternativas (`etapaOperacion`,
`formMetapaNombre`, `etapa`…): el histórico crudo y el `/proxy/ops` no etiquetan
igual lo mismo, y adivinar uno solo deja la búsqueda muda — no encuentra nada y
no dice por qué. Si ninguna fila trae un campo de etapa legible, lo dice con
esas palabras en vez de informar "no hay candidatas".

La cantidad que propone es la **despachada**. Si Walmart recibió menos, va lo
que recibió: ese número es el que mueve stock.

Cobertura: 106 pruebas, 97 mutaciones, todas mueren.
