<#
.SYNOPSIS
Starts scripts/plan-runner.ps1 as the scheduled task "TB Gym plan runner", so it outlives VS Code.

.DESCRIPTION
Registers (or replaces) a scheduled task that runs the plan runner in its own PowerShell window
under the current user with no time limit, then starts it. The runner builds the plan's Open rows
(by default the audit's fix batches, -Plan audit) one fresh chat at a time and stops at the first
gate, Optional row or step that does not end Done, and starts no step after -NoNewStepAfter.
Closing VS Code or any chat does not stop the task; the laptop sleeping does (keep it on power with
the lid open). Windows asks for nothing: the task runs as you, already signed in.

.EXAMPLE
.\scripts\start-plan-runner.ps1                 # up to 8 steps, after other chats are 20 min quiet, none after 08:00
.\scripts\start-plan-runner.ps1 -MaxSteps 2 -NoNewStepAfter ''
.\scripts\start-plan-runner.ps1 -Status         # task state and the last log lines
.\scripts\start-plan-runner.ps1 -Stop           # the runner ends after the current step
#>
[CmdletBinding()]
param(
    [ValidateSet('audit', 'ui')]
    [string]$Plan = 'audit',
    # No step starts after this clock time (its next occurrence), so a night run leaves the morning free.
    [string]$NoNewStepAfter = '08:00',
    [int]$MaxSteps = 8,
    [switch]$Status,
    [switch]$Stop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'TB Gym plan runner'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\plan-runner.ps1'
$logDir = Join-Path $root 'artifacts\plan-runner'
$stopFile = Join-Path $logDir 'STOP'
$log = Join-Path $logDir 'runner.log'
[IO.Directory]::CreateDirectory($logDir) | Out-Null

if ($Stop) {
    [IO.File]::WriteAllText($stopFile, 'stop', [Text.UTF8Encoding]::new($false))
    Write-Host 'STOP written: the runner ends after the step it is on. Delete artifacts\plan-runner\STOP before the next start.'
    return
}

if ($Status) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        Write-Host ('Task: {0}; last run {1}; last result {2}' -f $task.State, $info.LastRunTime, $info.LastTaskResult)
    }
    else { Write-Host 'Task: not registered.' }
    if (Test-Path $log) { Write-Host '--- last log lines ---'; Get-Content $log -Tail 15 }
    $summary = Join-Path $logDir 'summary.md'
    if (Test-Path $summary) { Write-Host '--- summary.md, last 20 lines ---'; Get-Content $summary -Tail 20 }
    return
}

# Warnings only; the runner itself refuses to start on a changed tree or a non-Open row.
if (-not (Get-Process -Name 'com.docker.backend', 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    Write-Warning 'Docker is not running: a backend step will test against a normal PostgreSQL and take about an hour.'
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    if ([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -eq 'Offline') {
        Write-Warning 'On battery: plug in and keep the lid open, or the run dies with the laptop.'
    }
}
catch { }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') {
    Write-Warning 'Windows Update is waiting for a restart; it can restart the laptop during the run.'
}
if (Test-Path $stopFile) { Remove-Item $stopFile -Force }

Write-Host '--- what the runner would do now ---'
& $runner -DryRun -Plan $Plan -NoNewStepAfter $NoNewStepAfter

$arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Plan {1} -WaitForIdle -MaxSteps {2}' -f $runner, $Plan, $MaxSteps
if ($NoNewStepAfter) { $arguments += ' -NoNewStepAfter {0}' -f $NoNewStepAfter }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $root
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 4 `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host ('Started "{0}": up to {1} steps. A PowerShell window shows the run; it also logs to {2}.' -f $taskName, $MaxSteps, $log)
Write-Host 'Watch:  .\scripts\start-plan-runner.ps1 -Status     Stop:  .\scripts\start-plan-runner.ps1 -Stop'
