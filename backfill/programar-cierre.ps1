# ============================================================================
#  backfill/programar-cierre.ps1  .  M3DATA . deja el cierre como tarea
#
#  ESTE ARCHIVO EMPIEZA CON BOM UTF-8 Y TIENE QUE SEGUIR ASI (ver el encabezado
#  de cierre-diario.ps1).
#
#  QUE HACE. Registra "M3DATA - cierre diario" en el Programador de tareas de
#  Windows: de lunes a viernes a la hora que se le pase, corriendo
#  backfill\cierre-programado.ps1 parado en la raiz del repositorio.
#
#  POR QUE "SOLO CUANDO EL USUARIO INICIO SESION". La tarea hereda asi el
#  entorno del usuario -- las variables SAP_* y OS_STORAGE_CONN -- y sus
#  credenciales de git. Con "aunque el usuario no haya iniciado sesion" esas
#  variables tienen que ser de MAQUINA, no de usuario, o el cierre se cae en el
#  primer paso diciendo cual falta; y el 'git push' del paso 8 se queda sin
#  credenciales si el Administrador de credenciales no las tiene guardadas.
#  La maquina queda con sesion iniciada, asi que no hace falta pagar ese precio.
#  Bloquear la pantalla con Win+L NO cierra la sesion: la tarea corre igual.
#
#  NO PIDE PERMISOS DE ADMINISTRADOR: registra la tarea para el usuario actual.
#
#  Uso:
#     powershell -NoProfile -ExecutionPolicy Bypass -File backfill\programar-cierre.ps1
#     powershell -NoProfile -ExecutionPolicy Bypass -File backfill\programar-cierre.ps1 -Hora 18:00
#     powershell -NoProfile -ExecutionPolicy Bypass -File backfill\programar-cierre.ps1 -Quitar
#
#  Volver a correrlo no duplica la tarea: la reemplaza.
# ============================================================================
param(
  [string]$Hora = '17:30',
  [switch]$Quitar
)
$ErrorActionPreference = 'Stop'

$nombre = 'M3DATA - cierre diario'
$ruta   = '\M3DATA\'

if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine('ERROR: este Windows no trae el modulo ScheduledTasks.')
  [Console]::Error.WriteLine('Se puede dejar igual con schtasks.exe; pideme la linea.')
  exit 2
}

function Existe {
  Get-ScheduledTask -TaskName $nombre -TaskPath $ruta -ErrorAction SilentlyContinue
}

if ($Quitar) {
  if (Existe) {
    Unregister-ScheduledTask -TaskName $nombre -TaskPath $ruta -Confirm:$false
    Write-Host "Tarea '$nombre' eliminada. El cierre vuelve a ser a mano."
  } else {
    Write-Host "No habia ninguna tarea '$nombre' que eliminar."
  }
  exit 0
}

$guion = Join-Path $PSScriptRoot 'cierre-programado.ps1'
$raiz  = Split-Path -Parent $PSScriptRoot
foreach ($f in @($guion, (Join-Path $PSScriptRoot 'cierre-diario.ps1'))) {
  if (-not (Test-Path -LiteralPath $f)) {
    [Console]::Error.WriteLine("ERROR: falta $f")
    exit 2
  }
}

# Cultura INVARIANTE a proposito, igual que en cierre-diario.ps1: con la del
# equipo, '17:30' depende de como este configurado Windows y esto tiene que
# dar lo mismo en cualquier maquina.
try {
  $t = [datetime]::ParseExact($Hora, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
} catch {
  [Console]::Error.WriteLine("ERROR: -Hora se escribe HH:mm en 24 horas, por ejemplo 17:30. Llego '$Hora'.")
  exit 2
}

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $guion + '"') `
            -WorkingDirectory $raiz

$disparo = New-ScheduledTaskTrigger -Weekly `
             -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $t

# WindowsIdentity y no USERDOMAIN+USERNAME: devuelve la forma que el
# Programador espera en los tres casos -- cuenta local (EQUIPO\usuario),
# dominio (DOMINIO\usuario) y Azure AD (AzureAD\usuario). Armarla a mano
# acierta solo en los dos primeros.
$yo = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quien = New-ScheduledTaskPrincipal -UserId $yo -LogonType Interactive -RunLevel Limited

#  IgnoreNew: si una corrida se alargo y todavia esta viva, la siguiente no
#    arranca encima. Dos cierres a la vez pelean por el mismo 'git add'.
#  2 horas de tope: el cierre entero toma minutos; dos horas es una corrida
#    colgada, y vale mas matarla que dejarla tomada hasta el dia siguiente.
#  DontStopOnIdleEnd: que no la corte si nadie toca el teclado mientras corre.
$opciones = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $nombre -TaskPath $ruta -Action $accion `
  -Trigger $disparo -Principal $quien -Settings $opciones -Force `
  -Description 'Cierre diario de stock de pallet rojo (M3DATA). Lo arma backfill/programar-cierre.ps1.' |
  Out-Null

# SE LEE DE VUELTA LO QUE QUEDO REGISTRADO, no lo que se pidio: si el
# Programador cambio o ignoro algo, aca se ve.
$tarea = Existe
if (-not $tarea) {
  [Console]::Error.WriteLine('ERROR: la tarea no quedo registrada.')
  exit 1
}
$info = Get-ScheduledTaskInfo -TaskName $nombre -TaskPath $ruta

Write-Host ''
Write-Host "Tarea registrada: $ruta$nombre"
Write-Host "  programa    : $($tarea.Actions[0].Execute)"
Write-Host "  argumentos  : $($tarea.Actions[0].Arguments)"
Write-Host "  iniciar en  : $($tarea.Actions[0].WorkingDirectory)"
Write-Host "  usuario     : $($tarea.Principal.UserId)  ($($tarea.Principal.LogonType))"
Write-Host "  dias        : mascara $($tarea.Triggers[0].DaysOfWeek)  (62 = lunes a viernes)"
Write-Host "  arranca     : $($tarea.Triggers[0].StartBoundary)"
Write-Host "  estado      : $($tarea.State)"
Write-Host "  proxima vez : $($info.NextRunTime)"
Write-Host ''
# Comillas dobles afuera y simples adentro: en PowerShell, "'x' + $v" no
# concatena nada, pasa tres argumentos sueltos a Write-Host.
Write-Host "Para probarla ahora mismo:  Start-ScheduledTask -TaskName '$nombre' -TaskPath '$ruta'"
Write-Host "Para sacarla:               programar-cierre.ps1 -Quitar"
Write-Host "Bitacora de cada corrida:   $env:LOCALAPPDATA\M3DATA\cierre"
