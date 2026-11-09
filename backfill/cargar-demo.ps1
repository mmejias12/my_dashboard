# =============================================================================
#  backfill/cargar-demo.ps1
#
#  Carga en ESTA ventana las credenciales de DEMO del portal Redtec, para que
#  scripts/sonda-escritura-redlink.js pueda pedir token.
#
#  No se imprimen, no quedan en el historial de comandos y mueren al cerrar la
#  ventana. Hay que correrlo desde un archivo y no pegarlo: un Read-Host dentro
#  de un pegado multilinea se come las lineas siguientes del pegado como si
#  fueran la respuesta, y las variables quedan vacias sin que nadie se entere.
#
#  Los valores estan en el request "__Login consultaredtec" de
#  PORTAL MMESIAS.postman_collection.json, carpeta Api Holux.
#
#  Este archivo lleva BOM a proposito: PowerShell 5.1 lee un .ps1 sin BOM como
#  CP-1252 y cualquier caracter no ASCII le descuadra las comillas.
# =============================================================================

$ErrorActionPreference = 'Stop'

function Plano([System.Security.SecureString] $s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$usr = Read-Host 'Usuario DEMO'
$sec = Read-Host 'Client secret DEMO' -AsSecureString
$pas = Read-Host 'Password DEMO'      -AsSecureString

$env:REDLINK_DEMO_USER          = $usr
$env:REDLINK_DEMO_CLIENT_SECRET = Plano $sec
$env:REDLINK_DEMO_PASS          = Plano $pas

$falta = @()
foreach ($k in 'REDLINK_DEMO_USER','REDLINK_DEMO_CLIENT_SECRET','REDLINK_DEMO_PASS') {
  $v = [Environment]::GetEnvironmentVariable($k)
  if ([string]::IsNullOrWhiteSpace($v)) { $falta += "$k (quedo vacia)" }
  elseif ($v -match '[<>]')             { $falta += "$k (quedo un marcador pegado literal)" }
}

if ($falta.Count) {
  Write-Host ''
  Write-Host 'No quedo cargado:' -ForegroundColor Red
  foreach ($f in $falta) { Write-Host "  $f" -ForegroundColor Red }
  Write-Host 'Vuelve a correr el script.' -ForegroundColor Red
} else {
  Write-Host ''
  Write-Host 'Las tres cargadas, solo en esta ventana.' -ForegroundColor Green
  Write-Host 'Ahora: node scripts\sonda-escritura-redlink.js --leer'
}
