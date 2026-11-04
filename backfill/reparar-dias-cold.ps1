# ============================================================================
#  backfill/reparar-dias-cold.ps1  ·  Los dos días que el cold trae cortos
#
#  QUE RESUELVE. La reconstruccion de los agregados desde el cold store
#  (scripts/rollup-hist.js) corrigio 1.376 dias y dejo DOS afuera a proposito,
#  porque ahi el cold trae MENOS que el agregado guardado y reescribirlos
#  perderia dato:
#     2024-02-13  retiros    cold 3.408  guardado 4.048   (-640)
#     2025-02-17  emisiones  cold 4.055  guardado 4.595   (-540)
#  Medido con --explicar: ningun corte por fecha de confirmacion reproduce lo
#  guardado y el valor del cold es PLANO en los ocho cortes, o sea las filas no
#  llegaron tarde: no estan. Son operaciones ingresadas fuera de la ventana con
#  que se consulto ese dia en su momento (el defecto horaIngreso vs
#  fechaRequerida, a nivel de FILA).
#
#  QUE HACE, en cuatro pasos por dia:
#    1. respalda el blob del dia         (backfill/respaldo-cold.js)
#    2. lo vuelve a pedir a Redlink      (backfill/backfill-operaciones.js)
#    3. muestra por que difiere          (scripts/rollup-hist.js --explicar)
#    4. decide por codigo de salida      (--veredicto)
#  Con -Reconstruir, los dias que quedaron OK se reescriben en hist/; los que
#  siguen cortos NO se tocan y se nombran al final.
#
#  POR QUE EL RESPALDO. backfill-operaciones.js reescribe el blob del dia
#  COMPLETO. Si Redlink hoy devuelve menos filas que las que el blob ya tiene,
#  la corrida deja el dia peor que antes y no hay vuelta atras. La copia queda
#  en el mismo contenedor, bajo respaldo/<fecha>-<sello>.json, que nadie lee.
#
#  LAS CREDENCIALES NO VAN ACA. Se leen del entorno. Si falta alguna, el script
#  para y dice CUAL, nunca su valor.
#    $env:OS_STORAGE_CONN        = '<cadena del storage redtecos>'
#    $env:REDLINK_USER           = '<usuario del portal>'
#    $env:REDLINK_PASS           = '<clave>'
#    $env:REDLINK_CLIENT_SECRET  = '<secret del cliente apiportalredtec>'
#
#  SI NO TIENES LAS CREDENCIALES DE REDLINK A MANO. El paso 2 se puede hacer
#  desde GitHub Actions, donde los secrets que funcionan ya estan cargados:
#  Actions - "Datos diarios REDTEC OS" - Run workflow, con ops_desde y ops_hasta
#  en el dia a reparar y solo_operaciones MARCADO (asi corre unicamente el paso
#  de operaciones y no toca stock, agregados ni rollups). Despues, en local, los
#  pasos 3 y 4 de este script se corren solos y solo piden OS_STORAGE_CONN:
#     node scripts/rollup-hist.js 2024-02-13 --explicar
#     node scripts/rollup-hist.js 2024-02-13 --veredicto
#
#  USO:
#    .\backfill\reparar-dias-cold.ps1                      # repara y muestra
#    .\backfill\reparar-dias-cold.ps1 -Reconstruir         # y reescribe los que quedaron OK
#    .\backfill\reparar-dias-cold.ps1 -Dias 2024-02-13     # un dia puntual
#    .\backfill\reparar-dias-cold.ps1 -Dias 2024-02-13 -Margen 365
#                                        # mas ventana de entrada: para saber si
#                                        # la fila existe o no existe (lento)
#    .\backfill\reparar-dias-cold.ps1 -SinRespaldo         # (no recomendado)
# ============================================================================
[CmdletBinding()]
param(
  [string[]]$Dias = @('2024-02-13','2025-02-17'),
  [int]$Margen = 0,
  [switch]$Reconstruir,
  [switch]$SinRespaldo
)

$ErrorActionPreference = 'Stop'
# Igual que en cierre-diario.ps1: aca los codigos de salida se revisan a mano y
# uno de ellos NO es un error (el 3 del veredicto significa "este dia sigue
# corto", que es informacion, no falla). Sin apagar esto el script se mata solo.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}
Set-Location (Split-Path -Parent $PSScriptRoot)

# SOLO ASCII EN LAS LINEAS DE CODIGO, Y NO ES UN CAPRICHO. Este archivo no
# tiene BOM, asi que Windows PowerShell 5.1 lo lee como ANSI (CP-1252). Un
# caracter de caja como U+2500 son los bytes E2 94 80, y leidos como CP-1252 el
# 0x94 se vuelve la comilla tipografica de cierre — que PowerShell acepta como
# delimitador de cadena. O sea cada raya de una linea decorativa inyecta media
# comilla: con una cantidad impar, el parser queda con una cadena abierta y a
# partir de ahi falla en lugares que no tienen nada que ver (y ahi un '<' del
# texto de ayuda se lee como redireccion: eso fue el primer error, que era un
# sintoma y no la causa). cierre-diario.ps1 sobrevive por casualidad: tiene 34
# rayas, cantidad par.
# Para sugerir comandos con fechas de verdad en vez de marcadores:
$ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')

function Paso([string]$n, [string]$que) { Write-Host "`n[$n] $que" }
function Muere([string]$que) { [Console]::Error.WriteLine("ERROR: $que"); exit 1 }

# ── Comprobaciones antes de tocar nada ──────────────────────────────────────
$malas = $Dias | Where-Object { $_ -notmatch '^\d{4}-\d{2}-\d{2}$' }
if ($malas) { Muere "fecha(s) invalida(s): $($malas -join ', ') (formato AAAA-MM-DD)" }

$faltan = @('OS_STORAGE_CONN','REDLINK_USER','REDLINK_PASS','REDLINK_CLIENT_SECRET') |
          Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue) }
if ($faltan) { Muere "faltan variables de entorno: $($faltan -join ', ')" }

# Diagnostico ENMASCARADO de las credenciales. No imprime ningun valor, ni
# parcial: solo el largo y si trae espacios en los bordes. Sirve para el caso
# mas comun, que es haberlas cargado con comillas DOBLES en PowerShell: ahi un
# '$' dentro de la clave se expande como variable y la clave llega cortada o
# vacia sin que nada avise. Con comillas SIMPLES eso no pasa.
function Pinta([string]$n) {
  $v = (Get-Item "env:$n").Value
  $bordes = if ($v -ne $v.Trim()) { '  OJO: tiene espacios en los bordes' } else { '' }
  Write-Host ("  {0,-22} {1,3} caracteres{2}" -f $n, $v.Length, $bordes)
}
Write-Host "`ncredenciales cargadas (sin mostrar valores):"
'REDLINK_USER','REDLINK_PASS','REDLINK_CLIENT_SECRET' | ForEach-Object { Pinta $_ }
Write-Host "  si algun largo no es el que esperas, se cargaron con comillas dobles:"
Write-Host "  en PowerShell la clave va entre comillas SIMPLES."


foreach ($f in @('backfill/respaldo-cold.js','backfill/backfill-operaciones.js','scripts/rollup-hist.js')) {
  if (-not (Test-Path $f)) { Muere "no encuentro $f (se corrio fuera del repositorio?)" }
}

# OPS_ORIGEN tiene que estar en redlink: con 'rdt' (el valor por omision)
# consultarOps le pide las filas al proveedor que se dio de baja y la
# reparacion no traeria nada. backfill-operaciones.js usa redlink-fetch
# directo, pero se deja explicito para que el entorno sea el mismo que el del
# workflow y para que no dependa de un default.
if (-not $env:OPS_ORIGEN) { $env:OPS_ORIGEN = 'redlink' }

# -Margen amplia la ventana de ENTRADA de la consulta (OS_BACKFILL_MARGEN_DIAS,
# 60 por omision). Es la perilla que decide si una operacion aparece: Redlink
# filtra por horaIngreso, asi que una requerida para el dia X pero ingresada
# antes de X menos el margen es invisible. Si un dia sigue corto con 60, el
# unico modo de saber si la fila existe o no existe es pedirla con mas margen.
# CUESTA TIEMPO: la consulta se parte en tramos de 31 dias y cada tramo tarda
# unos 70 s, asi que 365 dias de margen son unos 14 minutos POR DIA reparado.
if ($Margen -gt 0) {
  $env:OS_BACKFILL_MARGEN_DIAS = "$Margen"
  $tramos = [math]::Ceiling($Margen / 31.0)
  Write-Host "  margen      : $Margen dias de entrada (unos $tramos tramos por dia)"
}

Write-Host "-- reparar dias del cold -----------------------------"
Write-Host "  dias        : $($Dias -join ' ')"
Write-Host "  reconstruir : $(if ($Reconstruir) { 'si, los que queden OK' } else { 'no (solo diagnostico)' })"

# ── 1 · respaldo ────────────────────────────────────────────────────────────
# Todos los dias de una sola corrida: si el respaldo falla, no se repara nada.
if ($SinRespaldo) {
  Write-Host "`n[1/4] respaldo SALTADO por -SinRespaldo"
} else {
  Paso '1/4' "respaldando el blob de cada dia"
  node backfill/respaldo-cold.js $Dias
  if ($LASTEXITCODE -ne 0) { Muere 'fallo el respaldo: no se reparo ningun dia' }
}

# ── 2 a 4 · dia por dia ─────────────────────────────────────────────────────
$ok = @(); $cortos = @(); $sinBlob = @(); $reconstruidos = @()

foreach ($dia in $Dias) {
  Write-Host "`n=== $dia ==========================================="

  Paso '2/4' "volviendo a pedirle el dia a Redlink"
  # El mismo dia como desde y hasta: backfill-operaciones consulta con margen
  # de entrada de 60 dias (OS_BACKFILL_MARGEN_DIAS) y escribe SOLO los dias del
  # rango, asi que esto reescribe un dia y ninguno mas.
  node backfill/backfill-operaciones.js $dia $dia
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  Si el error fue HTTP 401 invalid_grant / Invalid user credentials, lo que'
    Write-Host '  rechazo Keycloak es el par USUARIO-CLAVE, no el secret del cliente (ese'
    Write-Host '  daria invalid_client). Dos salidas:'
    Write-Host '    1. revisar REDLINK_USER / REDLINK_PASS en esta sesion (ver los largos de'
    Write-Host '       arriba) y volver a cargarlas con comillas SIMPLES;'
    Write-Host '    2. o reparar el dia desde GitHub Actions, donde las credenciales que'
    Write-Host '       funcionan ya viven como secrets: Actions - Datos diarios REDTEC OS -'
    Write-Host '       Run workflow, con ops_desde y ops_hasta en el dia y solo_operaciones'
    Write-Host '       marcado. Despues, aca mismo:'
    Write-Host "         node scripts/rollup-hist.js $dia --explicar"
    Write-Host "         node scripts/rollup-hist.js $dia --veredicto"
    Write-Host '       (esos dos solo necesitan OS_STORAGE_CONN).'
    Write-Host ''
    Muere "fallo la consulta a Redlink para $dia"
  }

  Paso '3/4' 'por que difiere, con el dato'
  node scripts/rollup-hist.js $dia --explicar
  if ($LASTEXITCODE -ne 0) { Muere "fallo el diagnostico de $dia" }

  Paso '4/4' 'veredicto'
  node scripts/rollup-hist.js $dia --veredicto
  $v = $LASTEXITCODE
  switch ($v) {
    0 { $ok += $dia }
    3 { $cortos += $dia }
    4 { $sinBlob += $dia }
    default { Muere "el veredicto de $dia fallo (codigo $v)" }
  }

  if ($Reconstruir -and $v -eq 0) {
    Write-Host "      reconstruyendo el agregado de $dia"
    node scripts/rollup-hist.js $dia $dia
    if ($LASTEXITCODE -ne 0) { Muere "fallo la reconstruccion de $dia" }
    $reconstruidos += $dia
  }
}

# ── Resumen ─────────────────────────────────────────────────────────────────
Write-Host "`n-- resumen -------------------------------------------"
if ($ok.Count)      { Write-Host "  recuperados      : $($ok -join ' ')" }
if ($cortos.Count)  { Write-Host "  SIGUEN CORTOS    : $($cortos -join ' ')" }
if ($sinBlob.Count) { Write-Host "  sin blob en cold : $($sinBlob -join ' ')" }
if ($reconstruidos.Count) { Write-Host "  reconstruidos    : $($reconstruidos -join ' ')" }

if ($ok.Count -and -not $Reconstruir) {
  Write-Host "`n  Para dejarlos escritos:  .\backfill\reparar-dias-cold.ps1 -Reconstruir"
}
if ($cortos.Count) {
  Write-Host "`n  Los dias que siguen cortos NO se tocaron: el agregado guardado sigue"
  Write-Host "  siendo el mejor dato que existe para ellos."
  if ($Margen -le 0) {
    Write-Host "  ANTES de darlos por perdidos, probar con mas ventana de entrada: con el"
    Write-Host "  margen de 60 dias, una operacion ingresada mucho antes de su fecha"
    Write-Host "  requerida sigue siendo invisible."
    Write-Host "    .\backfill\reparar-dias-cold.ps1 -Dias $($cortos -join ',') -Margen 365"
  } else {
    Write-Host "  Ya se probo con $Margen dias de margen, asi que la fila no esta en el"
    Write-Host "  origen: el agregado guardado es el unico lugar donde sobrevive. Dejar"
    Write-Host "  esos dias excluidos para siempre."
  }
  Write-Host "  En cualquier reconstruccion futura:"
  Write-Host "    node scripts/rollup-hist.js 2023-01-01 $ayer --excluir=$($cortos -join ',')"
}
if (-not $cortos.Count -and -not $sinBlob.Count) {
  Write-Host "`n  Ya no quedan dias a la baja: la reconstruccion completa puede correr sin"
  Write-Host "  exclusiones.  node scripts/rollup-hist.js 2023-01-01 $ayer --comparar"
}
Write-Host ''
