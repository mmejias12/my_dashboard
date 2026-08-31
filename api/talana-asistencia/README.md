# Asistencia Talana — reemplazo de "Workera al día"

El reporte `workera-aldia.html` consumía la API de Workera vía `/api/workera-proxy`.
Con la unificación en Talana, el reporte pasa a ser **`asistencia-aldia.html`** y se
alimenta de **`/api/talana-asistencia`**, que sirve un *snapshot* de Talana guardado
en Blob Storage.

## Por qué un snapshot y no consultas en vivo

Talana bloquea una URL durante **10 minutos** si supera ~50 peticiones por minuto
([FAQ del portal de desarrolladores](https://developers.talana.com/v1.1/docs/preguntas-frecuentes)).
El reporte de Workera abría con decenas de llamadas en paralelo (sucursales ×
departamentos × páginas). Trasladar ese patrón a Talana significaba quedar
bloqueados en la primera carga.

Por eso el flujo quedó partido en dos:

```
GitHub Actions (cron)
        │  POST /api/talana-sync   (llave compartida)
        ▼
  talana-sync ──── cola de ≤18 req/min ───▶ talana.com/es/api/…
        │
        ▼  escribe
  Blob: talana/maestros.json · talana/marcas/YYYY-MM-DD.json · talana/ausencias/YYYY-MM.json
        │
        ▼  lee
  talana-asistencia ──────▶ asistencia-aldia.html
```

`talana-asistencia` **no llama a Talana** (salvo `?endpoint=/_diagnostico`): lee Blob.
El reporte abre al instante y no puede provocar el bloqueo.

## Equivalencias de endpoints

| Workera | Talana | Notas |
|---|---|---|
| `/branchOffice` | `/sucursal/` | `code` = id de sucursal |
| `/department` | `/centroCosto/` | `code` = código del centro |
| `/employee` | `/contracts-resumed-paginated/` | trae persona + sucursal + centro de costo + cargo + jefe de una vez; `/personas-paginadas/` no incluye sucursal |
| `/attendanceData` | `/mark/` | `TS` → `attendanceDate`; **`direction` E/X/O** da el sentido real de la marca |
| `/workshift/assign` | `/workShiftPersonRange/` | |
| `/workshift/schedules` | **no existe** | se construye cruzando asignación × `workShift` × `rotativeDay`/`specificDay` |
| `/permission` | `/absentism-resumed/`, `/vacations-resumed/`, `/administrative-leaves-resumed/` | variantes *resumed*: sin número de licencia, médico ni datos de salud |

La clave de unión es el **id numérico de persona** de Talana, que viaja en
`mark.person.id` y en `contrato.empleado`. Es lo que ocupa el campo `code`.

### Lo que mejora respecto de Workera

Workera devolvía `attendanceType` siempre en 0, así que el reporte tenía que
**adivinar** si una marca era entrada o salida por cercanía al horario teórico.
Talana informa `direction` (`E` entrada · `X` salida · `O` otra), y el reporte
ahora lo usa cuando viene. La heurística antigua queda como respaldo.

### Lo que Talana no permite resolver

Los turnos **rotativos** (`workShiftType = 'R'`) definen el ciclo en
`/specialRotativeDay/` (día 1, día 2, …), pero la API pública **no expone la fecha
ancla del ciclo de cada persona**, así que no hay forma de saber en qué día del
ciclo cae una fecha dada. Esos empleados quedarían sin horario teórico y el
reporte los resolvería con su respaldo de *primera marca = entrada / última =
salida*.

En la cuenta de REDTEC esto **no aplica**: `/specialRotativeDay/` devuelve 0
registros, o sea que no hay turnos rotativos configurados. Si algún día se crean,
`GET /api/talana-asistencia?endpoint=/workshift/schedules` los lista en
`rotativos_sin_ancla`.

## Estado del token de REDTEC

El diagnóstico del 31-08-2026 dejó esto:

| Recurso | Estado |
|---|---|
| `/sucursal/` | 200 · 2 sucursales (Bodega Santiago, Bodega Talca) |
| `/centroCosto/` | 200 · 42 centros |
| `/contracts-resumed-paginated/` | 200 · 93 contratos |
| `/rotativeDay/` | 200 · 252 días de turno |
| `/specialRotativeDay/` | 200 · 0 (no hay rotativos) |
| **`/workShift/`** | **403 · "No tienes permisos para realizar la solicitud"** |
| `/mark/`, `/workShiftPersonRange/`, los `-resumed` | sin probar todavía |

**`/workShift/` en 403 no rompe el reporte**, pero lo degrada: ese recurso es el
catálogo de turnos (nombre, tipo, tolerancia). Sin él, `traerTurnos()` reconstruye
el catálogo desde los días que sí responden y le pone al turno un nombre derivado
de su horario (`12:30–18:00 (5d)`) en vez del nombre real. Se pierde también la
tolerancia de atraso, que queda en 0. Conviene pedirle a Talana el permiso de
lectura sobre `/workShift/`; `/_estado` informa la degradación en
`catalogo_turnos_degradado`.

**`/workShiftPersonRange/` sí es imprescindible**: es la asignación persona ↔
turno. Si también responde 403, no hay horario teórico para nadie. Pruébalo con
`?endpoint=/_diagnostico&recursos=workShiftPersonRange,mark`.

## El día cero de los turnos ya no se adivina

Talana pone el nombre del día en `rotativeDay.name` ("Lunes", "Martes", …) junto
al `numberWorkingDay`. `detectarDiaCero()` cruza ambos y deduce la convención del
propio dato en cada sincronización. En REDTEC salió **lunes = 0**, que coincide
con el valor por defecto.

`TALANA_DIA_CERO` queda sólo como respaldo por si algún día los nombres dejan de
ser reconocibles. `/_estado` muestra en `dia_cero` qué se usó y si se detectó o
se cayó a la configuración.

## Variables de aplicación (Azure → Static Web App → Configuración)

| Variable | Obligatoria | Por defecto | Para qué |
|---|---|---|---|
| `TALANA_TOKEN` | sí | — | token de la API. **Debe tener acceso al módulo Asistencia y Turnos**, no sólo Personas |
| `OS_STORAGE_CONN` | sí | — | cadena de conexión del storage (la misma de REDTEC OS) |
| `OS_INGESTA_KEY` | sí | — | llave compartida que protege `POST /api/talana-sync` |
| `OS_TALANA_CONTAINER` | no | `redtec-talana` | contenedor del snapshot |
| `TALANA_RPM` | no | `18` | peticiones por minuto. No subir cerca de 50 |
| `TALANA_DIA_CERO` | no | `lunes` | **respaldo**: normalmente se deduce de `rotativeDay.name` |
| `TALANA_GRACIA_DIAS` | no | `5` | días hacia atrás que se reconsultan por marcas atrasadas |
| `TALANA_TTL_MAESTROS_MIN` | no | `720` | vida útil de personas, turnos y asignaciones |
| `TALANA_EMPRESA_ID` | no | — | id de empresa que inyecta `talana-proxy` (REDTEC = `2921`) |
| `TALANA_PRESUPUESTO_MS` | no | `32000` | tiempo por invocación de sync, bajo el corte de la plataforma |

Secrets del repositorio (Settings → Secrets and variables → Actions):

| Secret | Valor |
|---|---|
| `TALANA_SYNC_URL` | `https://<tu-swa>.azurestaticapps.net/api/talana-sync` |
| `OS_INGESTA_KEY` | el mismo valor que la variable de aplicación |

## Puesta en marcha

1. **Rotar el token.** El anterior estaba escrito en `api/talana-proxy/index.js`, es
   decir publicado en el repositorio: dalo por comprometido. Pide a Talana uno nuevo
   con permiso de **lectura sobre Asistencia y Turnos** y cárgalo en `TALANA_TOKEN`.

2. **Verificar credenciales y forma de los datos**, ya desplegado:

   ```
   GET /api/talana-asistencia?endpoint=/_diagnostico
   ```

   Devuelve el código HTTP y una muestra de cada recurso. Si `mark`, `workShift` o
   `workShiftPersonRange` responden 401/403, el token no cubre ese módulo.

3. **Confirmar que `/workShiftPersonRange/` y `/mark/` responden**, que son los dos
   recursos sin los cuales no hay reporte:
   `?endpoint=/_diagnostico&recursos=workShiftPersonRange,mark`

4. **Primera carga.** Ejecuta el workflow *Asistencia Talana* a mano
   (Actions → Run workflow) indicando `desde` y `hasta`. Reintenta solo hasta que
   `pendientes` llegue a 0; un mes desde cero toma unos minutos por el throttle.

5. **Abrir `asistencia-aldia.html`.** La línea de estado muestra la antigüedad del
   snapshot y marca ⚠ si pasan de 3 horas sin sincronizar.

6. **Dar de baja lo de Workera** cuando el reporte nuevo esté validado: borrar
   `workera-aldia.html`, `workera-dashboard.html`, `api/workera-proxy/` y las
   variables `WORKERA_USER` / `WORKERA_KEY`.

## Endpoints de `/api/talana-asistencia`

| `?endpoint=` | Devuelve |
|---|---|
| `/branchOffice` | sucursales |
| `/department` | centros de costo |
| `/employee` | trabajadores con contrato vigente |
| `/workshift/assign&start&end` | asignaciones de turno del rango |
| `/workshift/schedules&start&end` | horario teórico por empleado y día |
| `/attendanceData&start&end` | marcas del rango |
| `/permission&start&end` | ausencias, vacaciones y días administrativos |
| `/todo&start&end` | todo lo anterior en una sola respuesta |
| `/_estado` | antigüedad del snapshot, día cero usado y degradación del catálogo |
| `/_diagnostico` | muestra en vivo de cada recurso de Talana |
| `/_diagnostico&recursos=mark,workShift` | sólo esos recursos (el diagnóstico completo no cabe en una invocación) |

Las respuestas mantienen el sobre de Workera (`{ data, totalPages, totalResult }`)
para que el JS del reporte no cambie.

## Diagnóstico rápido

| Síntoma | Causa probable |
|---|---|
| 503 "snapshot todavía no generado" | nunca corrió `talana-sync`; ejecuta el workflow a mano |
| Horarios corridos un día | la detección falló; revisa `dia_cero` en `/_estado` y forza `TALANA_DIA_CERO` |
| Calendario vacío con datos cargados | `employeeStatus` no llegó; el reporte filtra por él |
| Turnos con nombre tipo `12:30–18:00 (5d)` | 403 en `/workShift/`: catálogo reconstruido desde los días |
| Trabajadores sin horario teórico | turno rotativo sin ancla, o sin asignación en `workShiftPersonRange` |
| Faltan marcas del día en curso | el sync corre cada 4 h; usa "Run workflow" para forzarlo |
| ⚠ en la línea de estado del reporte | hay días o meses del rango fuera del snapshot: sincroniza ese rango |
| Marcas que aparecen días después | normal: el sync reconsulta los últimos `TALANA_GRACIA_DIAS` días |
| 429 en el diagnóstico | hay un bloqueo activo de 10 minutos; espera y baja `TALANA_RPM` |

## Pruebas

```
node scripts/test-talana-mapeo.js        # 24 · unitarias del mapeo
node scripts/test-talana-integracion.js  # 28 · circuito completo
```

Ninguna toca la red ni Azure, así que corren en cualquier parte.

`test-talana-mapeo.js` verifica cada traducción por separado: horas, marcas,
ausencias, horario teórico, detección del día cero.

`test-talana-integracion.js` ejecuta las Functions reales de punta a punta
—`talana-sync` → Blob → `talana-asistencia` → contrato del reporte— simulando
sólo las dos fronteras: Talana (con las formas exactas que devolvió
`/_diagnostico`, incluido el 403 de `/workShift/`) y Blob Storage (en memoria).
Cubre la llave del sincronizador, el 503 cuando no hay snapshot, la
deduplicación de marcas, la idempotencia del segundo sync y los avisos de
cobertura incompleta. Los datos de personas son inventados: la forma es la
real, los RUT y nombres no.
