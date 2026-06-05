$connection = Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue
if ($connection) {
  $pidToStop = $connection.OwningProcess
  Get-Process -Id $pidToStop
  Stop-Process -Id $pidToStop -Force
}

Set-Location 'F:\maintenance-inventory-tracker-3\backend'
npm run dev
