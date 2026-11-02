# Run once so the site (virashalabs.online/studioapp) starts automatically when you log in to Windows.
# Registers two tasks: StudioBooking (the app) and VirashalabsTunnel (the Cloudflare Tunnel).
# Undo with: Unregister-ScheduledTask -TaskName StudioBooking, VirashalabsTunnel
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

foreach ($task in @(
    @{ Name = 'StudioBooking';     Script = 'start-studio.ps1'; Description = 'Runs Studio Booking at virashalabs.online/studioapp' },
    @{ Name = 'VirashalabsTunnel'; Script = 'start-tunnel.ps1'; Description = 'Cloudflare Tunnel for virashalabs.online' }
)) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\$($task.Script)`"" -WorkingDirectory $PSScriptRoot
    Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Description $task.Description -Force | Out-Null
    Start-ScheduledTask -TaskName $task.Name
    Write-Host "$($task.Name) registered and started."
}
Write-Host 'Logs: data\server.log and data\tunnel.log'
