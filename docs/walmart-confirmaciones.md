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
