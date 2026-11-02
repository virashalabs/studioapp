# Keeps the Studio Booking server running; restarts it if it crashes.
# Started at Windows logon by the "StudioBooking" scheduled task.
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot 'data\server.log'
while ($true) {
    "[$(Get-Date -Format s)] starting server" | Add-Content $log
    # Append line by line so the log isn't locked and can be read while the server runs.
    node server.js 2>&1 | ForEach-Object { Add-Content $log "$_" -Encoding UTF8 }
    "[$(Get-Date -Format s)] server exited ($LASTEXITCODE), restarting in 5s" | Add-Content $log
    Start-Sleep -Seconds 5
}
