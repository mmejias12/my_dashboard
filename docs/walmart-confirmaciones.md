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
