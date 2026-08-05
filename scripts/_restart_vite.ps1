Stop-Process -Id 52156 -Force -ErrorAction SilentlyContinue
Start-Sleep 1
$p = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'node_modules/vite/bin/vite.js','--port','5173' `
  -WorkingDirectory 'C:\Users\JasonJin06\Desktop\LogicPilot\web\apps\ide' `
  -PassThru -WindowStyle Hidden
Start-Sleep 4
Write-Host "vite pid=$($p.Id)"
try {
  $response = Invoke-WebRequest -Uri http://localhost:5173 -UseBasicParsing -TimeoutSec 5
  Write-Host "status=$($response.StatusCode)"
} catch {
  Write-Host "request failed: $($_.Exception.Message)"
}
