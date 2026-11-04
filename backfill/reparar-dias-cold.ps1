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
#  USO:
#    .\backfill\reparar-dias-cold.ps1                      # repara y muestra
#    .\backfill\reparar-dias-cold.ps1 -Reconstruir         # y reescribe los que quedaron OK
#    .\backfill\reparar-dias-cold.ps1 -Dias 2024-02-13     # un dia puntual
#    .\backfill\reparar-dias-cold.ps1 -SinRespaldo         # (no recomendado)
# ============================================================================
[CmdletBinding()]
param(
  [string[]]$Dias = @('2024-02-13','2025-02-17'),
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

function Paso([string]$n, [string]$que) { Write-Host "`n[$n] $que" }
function Muere([string]$que) { [Console]::Error.WriteLine("ERROR: $que"); exit 1 }

# ── Comprobaciones antes de tocar nada ──────────────────────────────────────
$malas = $Dias | Where-Object { $_ -notmatch '^\d{4}-\d{2}-\d{2}$' }
if ($malas) { Muere "fecha(s) invalida(s): $($malas -join ', ') (formato AAAA-MM-DD)" }

$faltan = @('OS_STORAGE_CONN','REDLINK_USER','REDLINK_PASS','REDLINK_CLIENT_SECRET') |
          Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue) }
if ($faltan) { Muere "faltan variables de entorno: $($faltan -join ', ')" }

foreach ($f in @('backfill/respaldo-cold.js','backfill/backfill-operaciones.js','scripts/rollup-hist.js')) {
  if (-not (Test-Path $f)) { Muere "no encuentro $f (se corrio fuera del repositorio?)" }
}

# OPS_ORIGEN tiene que estar en redlink: con 'rdt' (el valor por omision)
# consultarOps le pide las filas al proveedor que se dio de baja y la
# reparacion no traeria nada. backfill-operaciones.js usa redlink-fetch
# directo, pero se deja explicito para que el entorno sea el mismo que el del
# workflow y para que no dependa de un default.
if (-not $env:OPS_ORIGEN) { $env:OPS_ORIGEN = 'redlink' }

Write-Host "── reparar dias del cold ─────────────────────────────"
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
  Write-Host "`n══ $dia ═══════════════════════════════════════════"

  Paso '2/4' "volviendo a pedirle el dia a Redlink"
  # El mismo dia como desde y hasta: backfill-operaciones consulta con margen
  # de entrada de 60 dias (OS_BACKFILL_MARGEN_DIAS) y escribe SOLO los dias del
  # rango, asi que esto reescribe un dia y ninguno mas.
  node backfill/backfill-operaciones.js $dia $dia
  if ($LASTEXITCODE -ne 0) { Muere "fallo la consulta a Redlink para $dia" }

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
Write-Host "`n── resumen ───────────────────────────────────────────"
if ($ok.Count)      { Write-Host "  recuperados      : $($ok -join ' ')" }
if ($cortos.Count)  { Write-Host "  SIGUEN CORTOS    : $($cortos -join ' ')" }
if ($sinBlob.Count) { Write-Host "  sin blob en cold : $($sinBlob -join ' ')" }
if ($reconstruidos.Count) { Write-Host "  reconstruidos    : $($reconstruidos -join ' ')" }

if ($ok.Count -and -not $Reconstruir) {
  Write-Host "`n  Para dejarlos escritos:  .\backfill\reparar-dias-cold.ps1 -Reconstruir"
}
if ($cortos.Count) {
  Write-Host "`n  Los dias que siguen cortos NO se tocaron. El origen ya no tiene esas"
  Write-Host "  filas, asi que el agregado guardado es el mejor dato que existe: hay que"
  Write-Host "  dejarlos excluidos tambien en cualquier reconstruccion futura."
  Write-Host "    node scripts/rollup-hist.js <desde> <hasta> --excluir=$($cortos -join ',')"
}
if (-not $cortos.Count -and -not $sinBlob.Count) {
  Write-Host "`n  Ya no quedan dias a la baja: la reconstruccion completa puede correr sin"
  Write-Host "  exclusiones.  node scripts/rollup-hist.js 2023-01-01 <ayer> --comparar"
}
Write-Host ''
