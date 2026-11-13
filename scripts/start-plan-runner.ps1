<#
.SYNOPSIS
Starts scripts/plan-runner.ps1 as the scheduled task "TB Gym plan runner", so it outlives VS Code.

.DESCRIPTION
Registers (or replaces) a scheduled task that runs the plan runner in its own PowerShell window
under the current user with no time limit, then starts it. The runner builds the plan's Open rows
(by default the notes plan, -Plan notes, since 2026-11-05; -Plan motion, -Plan critique, -Plan audit
and -Plan ui are finished) one fresh
chat at a time (on -Model at -Effort: Opus 5.5 at extra-high effort, the owner's word of 2026-11-14;
Fable 5.2 from 2026-11-12, with Opus 5.5 at -FallbackEffort once Fable's weekly limit was used up)
until every row is Done or waits for the owner, pushing each row that ends Done
(-NoPush keeps commits local) and waiting out a used-up weekly limit (-OnWeeklyLimit stop ends the
run instead), the owner's choices of 2026-10-29. It stops early at the first gate, Optional row or
step that does not end Done, or, when given -NoNewStepAfter, before a step that would start after
that clock time. Rows run focused tests; once the rows are built, the runner runs the full backend
suite and Vitest itself and starts one chat to fix what fails (the owner, 2026-11-10).
Closing VS Code or any chat does not stop the task; the laptop sleeping does (keep it on power with
the lid open). Windows asks for nothing: the task runs as you, already signed in.

.EXAMPLE
.\scripts\start-plan-runner.ps1                 # every Open row (up to 40 steps), after other chats are 20 min quiet
.\scripts\start-plan-runner.ps1 -Now            # the same, starting at once
.\scripts\start-plan-runner.ps1 -MaxSteps 2 -NoNewStepAfter 08:00
.\scripts\start-plan-runner.ps1 -ResumeSession <id>   # first carry on with the chat a weekly limit stopped
.\scripts\start-plan-runner.ps1 -Status         # task state and the last log lines
.\scripts\start-plan-runner.ps1 -Stop           # the runner ends after the current step
#>
[CmdletBinding()]
param(
    [ValidateSet('audit', 'ui', 'critique', 'motion', 'notes')]
    [string]$Plan = 'notes',
    # The most hours one chat may run before the runner ends it (and the run stops); the motion plan's
    # rows are sized for about an hour (the owner, 2026-11-01).
    [double]$StepHours = 8,
    # A clock time such as 08:00: no step starts after its next occurrence (empty: run on; the owner, 2026-10-19).
    [string]$NoNewStepAfter = '',
    # The session id of the chat a limit stopped (runner.log names it); its work is still in the tree.
    [string]$ResumeSession = '',
    [int]$MaxSteps = 40,
    # Every chat's model and effort (the owner: Opus 5.5 at extra-high from 2026-11-14; Fable 5.2 from 2026-11-12).
    [string]$Model = 'claude-opus-5-5',
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = 'xhigh',
    # The effort of a chat that carries on with Opus 5.5 after -Model's weekly limit (the owner: max on
    # 2026-11-12, extra-high from 2026-11-13 to save tokens).
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$FallbackEffort = 'xhigh',
    # The first step starts at once instead of after 20 quiet minutes of other chats (the owner, 2026-11-12).
    [switch]$Now,
    [ValidateSet('wait', 'stop')]
    [string]$OnWeeklyLimit = 'wait',
    [switch]$NoPush,
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
    Write-Warning 'Docker is not running: backend tests need its test PostgreSQL (the final check starts Docker Desktop itself).'
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
& $runner -DryRun -Plan $Plan -NoNewStepAfter $NoNewStepAfter -ResumeSession $ResumeSession -OnWeeklyLimit $OnWeeklyLimit -StepHours $StepHours -Model $Model -Effort $Effort -FallbackEffort $FallbackEffort -Force:$Now -NoPush:$NoPush

$arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Plan {1} -WaitForIdle -MaxSteps {2} -OnWeeklyLimit {3} -StepHours {4} -Model {5} -Effort {6} -FallbackEffort {7}' -f $runner, $Plan, $MaxSteps, $OnWeeklyLimit, $StepHours, $Model, $Effort, $FallbackEffort
if ($NoPush) { $arguments += ' -NoPush' }
if ($Now) { $arguments += ' -Force' }
if ($NoNewStepAfter) { $arguments += ' -NoNewStepAfter {0}' -f $NoNewStepAfter }
if ($ResumeSession) { $arguments += ' -ResumeSession {0}' -f $ResumeSession }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $root
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 4 `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host ('Started "{0}": up to {1} steps. A PowerShell window shows the run; it also logs to {2}.' -f $taskName, $MaxSteps, $log)
Write-Host 'Watch:  .\scripts\start-plan-runner.ps1 -Status     Stop:  .\scripts\start-plan-runner.ps1 -Stop'
