# HT12 — Muestrea CPU y memoria del backend (node) y de MySQL cada 2 s mientras corre la prueba.
#   powershell -File monitor.ps1 -Salida resultados\recursos-estres.csv -PidNode 1234 -Segundos 600
param(
  [string]$Salida = "recursos.csv",
  [int]$PidNode,
  [int]$Segundos = 600
)
# Punto decimal siempre (con la configuración regional es-CO la coma partiría las columnas del CSV)
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
$nucleos = [Environment]::ProcessorCount
"segundo,node_cpu_pct,node_ram_mb,mysql_cpu_pct,mysql_ram_mb,cpu_total_pct" | Out-File -Encoding utf8 $Salida
$prev = @{}
$t0 = Get-Date
for ($i = 0; $i -lt ($Segundos / 2); $i++) {
  $node = Get-Process -Id $PidNode -ErrorAction SilentlyContinue
  $mysql = Get-Process -Name mysqld -ErrorAction SilentlyContinue | Select-Object -First 1
  $ahora = Get-Date
  $fila = @([int]($ahora - $t0).TotalSeconds)
  foreach ($p in @($node, $mysql)) {
    if ($p) {
      $cpu = $p.TotalProcessorTime.TotalSeconds
      $pct = if ($prev.ContainsKey($p.Id)) { [math]::Round(($cpu - $prev[$p.Id].cpu) / (($ahora - $prev[$p.Id].t).TotalSeconds * $nucleos) * 100, 1) } else { 0 }
      $prev[$p.Id] = @{ cpu = $cpu; t = $ahora }
      $fila += $pct; $fila += [math]::Round($p.WorkingSet64 / 1MB, 1)
    } else { $fila += 0; $fila += 0 }
  }
  $total = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $fila += [math]::Round([double]$total, 1)
  (($fila | ForEach-Object { ([double]$_).ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ",") | Out-File -Append -Encoding utf8 $Salida
  Start-Sleep -Seconds 2
}
