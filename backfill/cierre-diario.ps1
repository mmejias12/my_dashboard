# ============================================================================
#  backfill/cierre-diario.ps1  ·  M3DATA · el cierre del dia, todos los dias
#
#  POR QUE ESTE ARCHIVO Y NO UN WORKFLOW DE GITHUB. Medido el 25-10-2026:
#  el Service Layer de SAP NO contesta desde un runner de GitHub. Tres rutas,
#  120 segundos de timeout cada una, sin ECONNREFUSED y sin ENOTFOUND — el
#  DNS resuelve y la conexion queda colgada, que es la firma de un firewall
#  que descarta en silencio. En el mismo rato, la Azure Function de REDTEC
#  hizo login contra ese mismo host y puerto en 1,6 segundos. O sea: no es
#  caida, no son credenciales, es filtro por IP. Las IPs de Azure estan
#  permitidas; las de GitHub no.
#  CONSECUENCIA: el cierre corre donde SAP si contesta — una maquina de
#  REDTEC — y empuja el resultado al repositorio. El workflow de GitHub queda
#  solo para corridas manuales, por si algun dia se abre el acceso.
#
#  QUE HACE, en siete pasos:
#    1. re-extrae el mes en curso de SAP          (los documentos del dia)
#    2. lee el saldo vivo por bodega de SAP       (el ancla, sin semilla)
#    3. arma el json de RETAIL y el de CLIENTES   (nivel por socio + cierres)
#    4. arma la distribucion diaria de planta     (bodega por bodega, dia a dia)
#    5. arma el tablero                            (la pagina que ve gerencia)
#    6. guarda una copia fechada                  (la memoria del dia)
#    7. commitea y empuja                          (para que el sitio lo vea)
#
#  POR QUE LA COPIA FECHADA. El nivel a una fecha medido hoy y medido ayer
#  tienen que dar lo mismo: el cierre del 23 es la apertura del 24, por
#  construccion. Si alguna vez difieren, entre las dos mediciones se posteo un
#  documento con fecha vieja. Ese numero NO lo puede ver una consulta en vivo
#  a SAP —que siempre devuelve la verdad de ahora, sin memoria— y es lo unico
#  que el tablero sabe y la lectura directa no.
#
#  LAS CREDENCIALES NO VAN ACA. Se leen del entorno de la tarea programada.
#  Si falta alguna, el script para y dice cual, nunca su valor.
#
#  COMO DEJARLO CORRIENDO (Programador de tareas de Windows):
#    Programa:    powershell.exe
#    Argumentos:  -NoProfile -ExecutionPolicy Bypass -File "<repo>\backfill\cierre-diario.ps1"
#    Iniciar en:  <repo>
#    Hora:        05:17, de lunes a sabado (antes de la reunion de las 8:30)
#    Marcar "Ejecutar aunque el usuario no haya iniciado sesion" solo si las
#    credenciales de SAP estan en variables de entorno de MAQUINA, no de
#    usuario; si no, la tarea arranca sin ellas y se cae en el primer paso.
# ============================================================================
$ErrorActionPreference = 'Stop'
# En PowerShell 7.4 un comando nativo que sale con codigo distinto de cero
# aborta el script cuando ErrorActionPreference es 'Stop'. Aca los codigos se
# revisan a mano, y uno de ellos es NORMAL: 'git diff --staged --quiet'
# devuelve 1 justamente cuando SI hay cambios que commitear. Sin apagar esto,
# el script se mata solo en el unico caso en que tiene trabajo que hacer.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}
Set-Location (Split-Path -Parent $PSScriptRoot)

$faltan = @('SAP_LOGIN_URL','SAP_USER','SAP_PASS','SAP_DB','OS_STORAGE_CONN') |
          Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue) }
if ($faltan) { Write-Error "Faltan variables de entorno: $($faltan -join ', ')"; exit 1 }

$hoy  = Get-Date -Format 'yyyy-MM-dd'
$mes  = Get-Date -Format 'yyyy-MM'
$dir  = 'data'
$hist = Join-Path $dir 'historico'
New-Item -ItemType Directory -Force -Path $dir, $hist | Out-Null

function Paso([string]$n, [string]$que) { Write-Host "`n[$n] $que" }
# Write-Error con ErrorActionPreference 'Stop' lanza y puede no llegar al
# exit, dejando el codigo de salida a merced del host. El Programador de
# tareas necesita un codigo, no una excepcion bonita.
function Muere([string]$que) { [Console]::Error.WriteLine("ERROR: $que"); exit 1 }

Write-Host "── cierre diario $hoy ────────────────────────────────"

# 1 · los documentos nuevos. VENTANA DE TRES DIAS, no el mes entero: medido el
#     26-oct, rehacer octubre completo son 15.688 documentos y 58 minutos para
#     traer el movimiento de un dia. Con --desde se piden solo los de la cola y
#     se fusionan con el blob que ya esta.
#     TRES DIAS Y NO UNO porque SAP acepta posteos con fecha vieja: una ventana
#     de un dia se perderia justamente los que llegan tarde.
#     Los dos meses van cuando la ventana cruza el cambio de mes; si no, es el
#     mismo mes dos veces y el script lo resuelve igual. --forzar se queda
#     porque los primeros dias del mes la ventana cubre el mes entero y sin el
#     se saltaria el blob recien creado.
$ventana = (Get-Date).AddDays(-3)
$desde   = $ventana.ToString('yyyy-MM-dd')
$mesIni  = $ventana.ToString('yyyy-MM')
Paso '1/7' "extrayendo desde $desde (meses $mesIni..$mes)"
node backfill/backfill-sap-bin.js $mesIni $mes --desde=$desde --forzar
if ($LASTEXITCODE -ne 0) { Muere "fallo la extraccion desde $desde" }

# 2 · el ancla. Va DESPUES de la extraccion para que la cobertura la alcance.
#     Al reves, el ancla queda adelante de los movimientos y saldo-pool se
#     niega a cuadrar: entre una lectura y otra se mueven pallets.
Paso '2/7' 'leyendo el saldo por bodega'
node backfill/sonda-oinm-bodega.js --salida="$dir/bodegas-hoy.json"
if ($LASTEXITCODE -ne 0) { Muere 'fallo la sonda de bodegas' }

# 3 · el nivel por socio de cada bodega
Paso '3/7' 'calculando el nivel por socio'
node scripts/saldo-pool.js --bodega=RETAIL `
  --semilla=backfill/s0-semilla-retail-2025-12-31.json `
  --bodegas="$dir/bodegas-hoy.json" --json="$dir/stock-retail.json"
if ($LASTEXITCODE -ne 0) { Muere 'fallo RETAIL' }

node scripts/saldo-pool.js --bodega=CLIENTES `
  --semilla=backfill/s0-semilla-2025-12-31.json `
  --bodegas="$dir/bodegas-hoy.json" --json="$dir/stock-clientes.json"
if ($LASTEXITCODE -ne 0) { Muere 'fallo CLIENTES' }

# 4 · la distribucion diaria de planta. Va DESPUES del ancla (paso 2) a
#     proposito: saldo-planta calcula el nivel hacia atras desde el saldo vivo,
#     asi que si el ancla fuera mas vieja que las lineas toda la serie quedaria
#     corrida. Aca el orden lo garantiza y el aviso de "ancla corrida" no puede
#     aparecer.
#     Los dos meses son el de la ventana y el actual, los mismos del paso 1:
#     son los unicos con blob lineasbod/ garantizado.
#     NO MATA LA CORRIDA. Si falla, el tablero se arma igual sin esa seccion:
#     armar-tablero-stock trata planta.json como entrada opcional. Una seccion
#     nueva no puede dejar a gerencia sin el tablero.
Paso '4/7' 'calculando la distribucion diaria de planta'
node scripts/saldo-planta.js --meses="$mesIni,$mes" --json="$dir/planta.json"
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'fallo la distribucion diaria de planta: el tablero se arma sin esa seccion'
  Remove-Item (Join-Path $dir 'planta.json') -ErrorAction SilentlyContinue
}

# 5 · la pagina. Se arma aca y se commitea armada: lo que abre gerencia es un
#     archivo estatico que no depende de nada en tiempo de lectura.
Paso '5/7' 'armando el tablero'
node scripts/armar-tablero-stock.js `
  --bodegas="$dir/bodegas-hoy.json" `
  --retail="$dir/stock-retail.json" `
  --clientes="$dir/stock-clientes.json" `
  --extra="$dir/tablero-extra.json" `
  --planta="$dir/planta.json" `
  --datos="$dir/datos-stock.json" `
  --salida='stock-flujos-pallets.html'
if ($LASTEXITCODE -ne 0) { Muere 'fallo el armado del tablero' }

# 6 · la memoria. Sin esto no hay con que comparar mañana, y la comparacion
#     es lo unico que una lectura en vivo de SAP no puede dar.
Paso '6/7' 'guardando la copia del dia'
# planta.json puede no existir: su paso no mata la corrida, asi que la copia
# tampoco puede. Los otros tres SI tienen que estar — si falta uno, el cierre
# ya habria muerto antes.
foreach ($f in 'bodegas-hoy','stock-retail','stock-clientes','planta') {
  $src = Join-Path $dir "$f.json"
  if (Test-Path $src) { Copy-Item $src (Join-Path $hist "$hoy-$f.json") -Force }
  elseif ($f -ne 'planta') { Muere "falta $src y deberia estar" }
}
# La comparacion no mata la corrida: si no puede leer el historico, el dato
# de hoy YA esta bien calculado y vale la pena publicarlo igual. Pero se avisa,
# porque sin comparacion no hay deteccion de posteos retroactivos.
node scripts/comparar-cierres.js --dir="$hist" --hasta=$hoy
if ($LASTEXITCODE -ne 0) { Write-Warning 'no se pudo comparar con la copia anterior' }
# 60 dias alcanzan para investigar y evitan que el repo se llene: la
# comparacion solo necesita la copia anterior.
# SE CUENTAN DIAS, NO ARCHIVOS. Antes el tope era 180 archivos, que con tres
# familias por dia daban 60 dias; al agregar planta serian 45 sin que nadie lo
# note. Contando por la fecha del nombre, agregar una familia no mueve la
# ventana.
$DIAS_COPIA = 60
$porDia = Get-ChildItem (Join-Path $hist '*.json') |
          Group-Object { $_.Name.Substring(0, 10) } | Sort-Object Name
if ($porDia.Count -gt $DIAS_COPIA) {
  $porDia[0..($porDia.Count - $DIAS_COPIA - 1)] |
    ForEach-Object { $_.Group | Remove-Item -Force }
}

# 7 · empujar. Sin esto el tablero queda en el disco y el sitio sigue
#     mostrando el de ayer. Si el push falla, el dato YA esta calculado: se
#     avisa y se sale con error para que el Programador lo marque, pero no se
#     deshace nada.
Paso '7/7' 'commiteando y empujando'
# Se commitea solo lo que existe: un git add con una ruta inexistente aborta
# todo el add, y planta.json puede faltar legitimamente.
$archivos = @("$dir/stock-retail.json", "$dir/stock-clientes.json", "$dir/bodegas-hoy.json",
              "$dir/planta.json", "$dir/datos-stock.json", 'stock-flujos-pallets.html', $hist) |
            Where-Object { Test-Path $_ }
git add -- $archivos
if ($LASTEXITCODE -ne 0) { Muere 'fallo git add: se corrio fuera del repositorio?' }
git diff --staged --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host '  sin cambios: no hay nada que commitear.'
} else {
  git commit -m "Stock y flujos de pallets - cierre $hoy"
  if ($LASTEXITCODE -ne 0) { Muere 'fallo el commit' }
  git push
  if ($LASTEXITCODE -ne 0) { Muere 'el commit quedo local: fallo el push (revisar credenciales de git)' }
  Write-Host '  empujado.'
}

Write-Host "`nlisto. El tablero quedo en stock-flujos-pallets.html y el dato en $dir/datos-stock.json"
