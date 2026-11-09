# ============================================================================
#  backfill/cierre-programado.ps1  .  M3DATA . el cierre, con bitacora
#
#  ESTE ARCHIVO EMPIEZA CON BOM UTF-8 Y TIENE QUE SEGUIR ASI, por la misma
#  razon que cierre-diario.ps1: powershell.exe (Windows PowerShell 5.1, el que
#  corre en el Programador de tareas) lee un .ps1 sin BOM como CP-1252. Si el
#  editor ofrece "UTF-8 sin BOM", no lo uses aca.
#
#  PARA QUE EXISTE. Una tarea programada no tiene consola: todo lo que el
#  cierre escribe en pantalla se pierde, y el dia que falle no queda rastro de
#  por que. Esto lo corre igual que a mano, guarda la salida completa en un
#  archivo fechado y devuelve el MISMO codigo de salida, para que el
#  Programador muestre en "Resultado de la ultima ejecucion" si termino bien.
#
#  LA BITACORA VA FUERA DEL REPOSITORIO, en %LOCALAPPDATA%\M3DATA\cierre, a
#  proposito: adentro ensuciaria 'git status' todos los dias y el paso 8 del
#  cierre commitea por lista de archivos, asi que no la subiria igual.
#
#  EL CIERRE CORRE COMO PROCESO APARTE, tambien a proposito: su 'Muere' hace
#  'exit 1', y si corriera dentro de este script ese exit se llevaria por
#  delante la linea que cierra la bitacora. Aparte, el codigo de salida llega
#  limpio y es justo lo que el Programador necesita.
#
#  Correrlo a mano es lo mismo que correr el cierre, con bitacora de regalo:
#     powershell -NoProfile -ExecutionPolicy Bypass -File backfill\cierre-programado.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
# Mismo apagado que en cierre-diario.ps1: en PowerShell 7.4 un comando nativo
# que sale con codigo distinto de cero aborta el script. Aca el codigo del
# hijo se revisa a mano y un valor distinto de cero es informacion, no una
# razon para morirse.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$cierre = Join-Path $PSScriptRoot 'cierre-diario.ps1'
if (-not (Test-Path -LiteralPath $cierre)) {
  [Console]::Error.WriteLine("ERROR: no encuentro $cierre")
  exit 2
}

# El repositorio es la carpeta que contiene a backfill\. El cierre usa rutas
# relativas (data\, stock-flujos-pallets.html) y hace 'git add', asi que tiene
# que arrancar parado ahi y no donde el Programador lo haya dejado.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $raiz

$dirLog = Join-Path $env:LOCALAPPDATA 'M3DATA\cierre'
if (-not (Test-Path -LiteralPath $dirLog)) {
  New-Item -ItemType Directory -Path $dirLog -Force | Out-Null
}
$log = Join-Path $dirLog ('cierre-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')

$inicio = Get-Date
"=== cierre arrancado el $($inicio.ToString('yyyy-MM-dd HH:mm:ss')) en $raiz ===" |
  Tee-Object -FilePath $log -Append

# '2>&1' convierte cada linea de error del hijo en un ErrorRecord dentro de la
# tuberia, y con ErrorActionPreference en 'Stop' eso aborta este script en la
# primera linea de stderr -- justo cuando mas falta hace la bitacora. node
# escribe avisos por stderr en corridas que terminan bien, asi que no es un
# caso raro. Se baja a 'Continue' solo para esta llamada.
# 'ForEach-Object { "$_" }' aplana cada linea a texto ANTES de que llegue al
# archivo. Sin eso, Windows PowerShell 5.1 formatea el ErrorRecord con toda su
# decoracion -- 'powershell.exe : ', '+ CategoryInfo', '+ FullyQualifiedErrorId'
# -- y una corrida que termino bien queda con un bloque rojo en medio. Visto el
# 2026-11-09: 'git push' escribe "To https://github.com/..." por stderr AUNQUE
# el push salga bien, asi que ese bloque salia todos los dias. Una bitacora que
# grita error cuando no lo hubo ensena a no leerla.
$ErrorActionPreference = 'Continue'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cierre 2>&1 |
  ForEach-Object { "$_" } |
  Tee-Object -FilePath $log -Append
$codigo = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
# Si por lo que sea no quedo codigo, se trata como exito: inventar un fallo
# seria peor que no saber.
if ($null -eq $codigo) { $codigo = 0 }

$fin = Get-Date
$min = [math]::Round(($fin - $inicio).TotalMinutes, 1)
if ($codigo -eq 0) { $texto = 'termino BIEN' } else { $texto = "FALLO con codigo $codigo" }
"=== $texto a las $($fin.ToString('HH:mm:ss')), $min minutos ===" |
  Tee-Object -FilePath $log -Append
"    bitacora: $log" | Tee-Object -FilePath $log -Append

# Un mes de bitacoras alcanza para mirar hacia atras sin que la carpeta crezca
# sola para siempre. Si el borrado falla no se toca el codigo de salida: una
# bitacora vieja que no se pudo borrar no es un cierre fallido.
Get-ChildItem -LiteralPath $dirLog -Filter 'cierre-*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $inicio.AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit $codigo
