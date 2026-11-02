# Keeps the Cloudflare Tunnel (virashalabs.online) connected; restarts it if it exits.
# Started at Windows logon by the "VirashalabsTunnel" scheduled task.
$cf = Join-Path $env:USERPROFILE 'cloudflared\cloudflared.exe'
$log = Join-Path $PSScriptRoot 'data\tunnel.log'
while ($true) {
    "[$(Get-Date -Format s)] starting tunnel" | Add-Content $log
    # Append line by line so the log isn't locked and can be read while the tunnel runs.
    & $cf tunnel --loglevel warn run virashalabs 2>&1 | ForEach-Object { Add-Content $log "$_" -Encoding UTF8 }
    "[$(Get-Date -Format s)] tunnel exited ($LASTEXITCODE), restarting in 10s" | Add-Content $log
    Start-Sleep -Seconds 10
}
