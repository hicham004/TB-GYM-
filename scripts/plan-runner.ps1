<#
.SYNOPSIS
Runs a plan's status table unattended: one fresh Claude chat per row.

.DESCRIPTION
-Plan audit (the default since 2026-10-19) runs the fix batches in section 0 of
docs/FULL-AUDIT-2026-10.md; -Plan ui runs the section 0 table of docs/UI-REDESIGN-PLAN.md,
which the owner marked complete on 2026-10-13.

Each step is a new `claude -p` chat at max effort, on Opus unless -RowModels names another
model for its row (the owner put R6.2 on Fable on 2026-10-11). It gets the plan's opening in
$planPrompts plus the unattended-run rules in $sharedRules below. The owner decided on
2026-10-11, and again for the audit on 2026-10-19, that such a chat commits its own step once
every check AGENTS.md asks for is green. It never pushes: a deny rule blocks git push.

A chat that hits a usage limit is resumed where it stopped. A five-hour limit is waited out
on the same model. A weekly limit (one resetting more than 12 hours away, the account's or one
model's) moves the chat to -FallbackModel at once, and later rows stay on it until that limit
resets (the owner, 2026-10-12: Fable first, then Opus 5.5). Claude Code's --fallback-model does
the same for a model that is overloaded or unavailable.

A step starts only when no tracked file is changed, no chat in this folder has written
for -IdleMinutes, and the next row is Open (not a gate, Optional, Built or Blocked).
The runner stops after -MaxSteps, at the first step that does not end clean with its
row Done, when artifacts\plan-runner\STOP exists, or, with -NoNewStepAfter, before a step
that would start after that clock time. Logs, each chat's report and summary.md go to
artifacts\plan-runner\ (git-ignored).

.EXAMPLE
.\scripts\plan-runner.ps1 -DryRun       # what would run next; starts nothing
.\scripts\plan-runner.ps1 -SelfTest     # one tiny chat per model outside the repo: model, effort, deny rule
.\scripts\plan-runner.ps1 -WaitForIdle  # wait until other chats are finished, then run
.\scripts\plan-runner.ps1 -WaitForIdle -NoNewStepAfter 08:00   # a night run that leaves the morning free
#>
[CmdletBinding()]
param(
    [ValidateSet('audit', 'ui')]
    [string]$Plan = 'audit',
    # A clock time such as 08:00: no step starts after its next occurrence (empty: no limit).
    [string]$NoNewStepAfter = '',
    [int]$MaxSteps = 3,
    [double]$StepHours = 8,
    [int]$IdleMinutes = 20,
    [int]$MaxLimitWaits = 12,
    # Row id pattern (-like) to model; a row matching none runs on $model below.
    [hashtable]$RowModels = @{ 'R6.2*' = 'claude-fable-5-1' },
    # After a weekly limit the chat carries on with this model, and so do later rows until that
    # limit resets (the owner, 2026-10-12). An empty string stops the runner instead.
    [string]$FallbackModel = 'claude-opus-5-5',
    [switch]$WaitForIdle,
    [switch]$DryRun,
    [switch]$SelfTest,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$planFiles = @{ audit = 'docs\FULL-AUDIT-2026-10.md'; ui = 'docs\UI-REDESIGN-PLAN.md' }
$planPath = Join-Path $repositoryRoot $planFiles[$Plan]
$logDir = Join-Path $repositoryRoot 'artifacts\plan-runner'
$stopFile = Join-Path $logDir 'STOP'
$lockFile = Join-Path $logDir 'runner.lock'
$summaryPath = Join-Path $logDir 'summary.md'
$model = 'claude-opus-5-5'
$effort = 'max'
# Models whose weekly limit is used up, with when to try them again; their rows run on $FallbackModel.
$script:exhaustedUntil = @{}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$gateSign = [char]::ConvertFromUtf32(0x1F6A6)
[IO.Directory]::CreateDirectory($logDir) | Out-Null
try { [Console]::OutputEncoding = $utf8 } catch { }
$stepCutoff = $null
if ($NoNewStepAfter) {
    $stepCutoff = [datetime]::Today.Add([timespan]::Parse($NoNewStepAfter))
    if ($stepCutoff -le (Get-Date)) { $stepCutoff = $stepCutoff.AddDays(1) }
}

# How each plan's chat starts; $sharedRules continues its list of the owner's decisions.
$planPrompts = @{
    ui = @'
Read docs/UI-REDESIGN-PLAN.md and do the next step.

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. The runner expects the next step to be <<ROW>>.
If the rules in section 0 give a different row, change nothing and say why.

The owner's decisions for unattended runs (2026-10-11):
- The owner approved building the plan's Open rows, the review's slices included, without
  a preview round.
- A business question inside the step: decide it as your memory note on delegated
  business decisions says (research, decide, write down the evidence, name it in the
  report). Money rules, legal wording and work outside the plan's rows are not delegated:
  set the row to "Blocked" with the question and your recommendation, and stop.
- A gate row or an Optional row needs the owner: stop and say so.
'@
    audit = @'
Read docs/FULL-AUDIT-2026-10.md and do the next step: the first row of its section 0
status table that is not Done. Build it as section 11 describes that batch; section 6
gives each finding's cause, files and proof.

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. The runner expects the next step to be <<ROW>>.
If section 0 gives a different row, change nothing and say why.

Traps on this laptop (your memory notes have more):
- A full backend suite started between 00:00 and 01:00 Beirut time fails R34a and R25b
  on the day boundary: start it after 01:00 or rerun those two alone. The known flakes
  (the rate-limit test, the Redis-outage SignalR test, the Step3Renewal double tap) pass
  when rerun alone.
- Until A1 bumps Microsoft.AspNetCore.SignalR.Common, build with
  -p:WarningsNotAsErrors=NU1903.
- The live specs in src/web/e2e/live run against a fresh demo copy as section 10 says,
  never against the owner's own API (port 5134), web (port 4200) or the tbgym database,
  which holds the owner's accounts.

The owner's decisions for this run (2026-10-19):
- The owner approved fixing the audit's batches in section 0's order on the branch
  audit-fixes, without a preview round: the owner judges the screenshots afterwards.
  The row's third column is the owner's word; an item it leaves out is not built.
- A question the row and the docs do not settle: a technical one is yours (AGENTS.md).
  A business question, a new money rule or legal wording is not delegated: leave that
  item out, write it with your recommendation into the row's status and your report,
  and build the rest of the batch.
- A batch too big to finish well in one chat: split its row into parts (A3a, A3b), each
  with its scope, build and commit the first, and leave the others Open for the next chat.
- Where a fix changes a rule, update DOMAIN-RULES, the ADR or ARCHITECTURE in a few
  lines, as AGENTS.md asks.
'@
}

$sharedRules = @'
- Commit approved. When the step meets its definition of done and every check AGENTS.md
  asks for has passed (the full backend suite when backend code changed, the web checks
  when web code changed, git diff --check, and a live pass of every new or changed screen),
  commit the step on the current branch, then record the hash in its status row in a
  second small commit, in the form section 0 uses. Stage only the files this step changed,
  by explicit path. No co-author or "Generated with" lines. Never push, never create or
  switch branches, never amend, rebase or reset commits.
- If a check fails and you cannot fix it inside the step, do not commit. Set the row to
  "Built, not committed" with one line on what failed, and stop.

How an unattended run works:
- Ask nothing and do not use plan mode. State your plan in a message, then build.
- Background commands are stopped after 10 minutes here unless you pass a timeout. Start
  long ones (the full backend suite, the API, ng serve) with run_in_background and timeout
  7200000. While the suite runs you may end your turn; you get another turn when it exits.
- Before your final message, stop the servers and background commands you started, and
  only those. Never kill processes by name.
- Leave scripts/plan-runner.ps1 and artifacts/plan-runner/ alone; they belong to the runner.
- Your final message is the owner's report: what changed for coaches and clients, test
  results, what was not done or not verified, where the 390 px and 1440 px screenshots
  are, and the next step. End it with exactly one of these lines:
  RUNNER-RESULT: done <<ROW>> <commit hash>
  RUNNER-RESULT: stopped <one-line reason>
'@
$stepPrompt = $planPrompts[$Plan] + "`n" + $sharedRules

$resumePrompt = 'The run stopped ({0}). Carry on with step {1} from where you stopped. The unattended-run rules in the first message still apply.'

function Write-Note([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm}  {1}' -f (Get-Date), $Message
    Write-Host $line
    [IO.File]::AppendAllText((Join-Path $logDir 'runner.log'), $line + "`r`n", $utf8)
}

function Get-RowModel([string]$RowId) {
    $chosen = $model
    foreach ($pattern in @($RowModels.Keys | Sort-Object)) {
        if ($RowId -like $pattern) { $chosen = [string]$RowModels[$pattern]; break }
    }
    if ($FallbackModel -and $script:exhaustedUntil.ContainsKey($chosen) -and (Get-Date) -lt $script:exhaustedUntil[$chosen]) {
        return $FallbackModel
    }
    return $chosen
}

function Get-RowModelText {
    $pairs = @($RowModels.Keys | Sort-Object | ForEach-Object { '{0} on {1}' -f $_, $RowModels[$_] })
    $text = 'every row on {0}' -f $model
    if ($pairs.Count -gt 0) { $text = '{0}; every other row on {1}' -f ($pairs -join ', '), $model }
    if ($FallbackModel) { $text += '; after a weekly limit, {0}' -f $FallbackModel }
    return $text
}

function Get-ShortText([string]$Text, [int]$Length) {
    $flat = ($Text -replace '\s+', ' ').Trim()
    if ($flat.Length -le $Length) { return $flat }
    return $flat.Substring(0, $Length) + '...'
}

# Outputs nothing for a missing field, so @(Get-Field ...) is empty rather than @($null).
function Get-Field($Object, [string]$Name) {
    if ($null -ne $Object) {
        $property = $Object.PSObject.Properties[$Name]
        if ($property) { $property.Value }
    }
}

function Get-ClaudeExe {
    $extensions = Join-Path $env:USERPROFILE '.vscode\extensions'
    $newest = Get-ChildItem -Path $extensions -Directory -Filter 'anthropic.claude-code-*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            $exe = Join-Path $_.FullName 'resources\native-binary\claude.exe'
            if ($_.Name -match '^anthropic\.claude-code-(\d+\.\d+\.\d+)' -and (Test-Path $exe)) {
                [pscustomobject]@{ Version = [version]$Matches[1]; Exe = $exe }
            }
        } |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if (-not $newest) { throw "claude.exe was not found under $extensions." }
    return $newest.Exe
}

# --no-optional-locks keeps these reads from taking index.lock under a chat's git command.
function Invoke-Git {
    $output = & git -C $repositoryRoot --no-optional-locks @args
    if ($LASTEXITCODE -ne 0) { throw ('git {0} exited with {1}' -f ($args -join ' '), $LASTEXITCODE) }
    $output
}

function Get-TrackedChanges {
    @(Invoke-Git status --porcelain=v1 --untracked-files=no) | Where-Object { $_ }
}

function Get-Untracked {
    @(Invoke-Git status --porcelain=v1 --untracked-files=all) |
        Where-Object { $_ -like '?? *' } |
        ForEach-Object { $_.Substring(3) }
}

function Get-PlanRows {
    $inStatus = $false
    foreach ($line in ([IO.File]::ReadAllText($planPath, $utf8) -split "`r?`n")) {
        if ($line -match '^## 0\.') { $inStatus = $true; continue }
        if ($inStatus -and $line -match '^## ') { break }
        if (-not $inStatus -or $line -notmatch '^\|') { continue }
        # Section 0's prose shows statuses in bold, so a chat may write **Done ...**.
        $cells = @($line.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim().Trim('*', '_', ' ') })
        if ($cells.Count -lt 4 -or $cells[0] -eq 'Step' -or $cells[0] -match '^-+$') { continue }
        [pscustomobject]@{
            Id = $cells[0]
            What = $cells[1]
            Gate = $cells[1].Contains($gateSign)
            Status = $cells[$cells.Count - 1]
        }
    }
}

# The first row that is not Done; a gate the owner marked "not blocking" is passed over.
function Get-NextRow {
    foreach ($row in @(Get-PlanRows)) {
        if ($row.Status -like 'Done*' -or $row.Status -like 'Open, not blocking*') { continue }
        return $row
    }
}

function Get-RowProblem($Row) {
    if ($null -eq $Row) { return 'every row of the plan is Done' }
    if ($Row.Gate) { return ('{0} is a gate: it needs the owner' -f $Row.Id) }
    if ($Row.Status -like 'Optional*') { return ('{0} is Optional: it needs the owner''s go' -f $Row.Id) }
    if ($Row.Status -notlike 'Open*') { return ('{0} is not Open: "{1}"' -f $Row.Id, (Get-ShortText $Row.Status 160)) }
}

function Get-ChatTitle([string]$Path) {
    $title = ''
    try {
        # The chat may be appending to its transcript right now.
        $stream = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $reader = New-Object IO.StreamReader($stream, $utf8)
        try {
            while ($null -ne ($line = $reader.ReadLine())) {
                if ($line.Contains('"aiTitle":"') -and $line -match '"aiTitle":"([^"]*)"') { $title = $Matches[1] }
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    catch { }
    return $title
}

# Chats in this folder whose transcript changed in the last -IdleMinutes, newest first.
function Get-RecentChats {
    $key = $repositoryRoot -replace '[^A-Za-z0-9]', '-'
    $projects = Join-Path $env:USERPROFILE '.claude\projects'
    $folder = @(Get-ChildItem -Path $projects -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $key })
    if ($folder.Count -eq 0) { return }
    $since = (Get-Date).AddMinutes(-$IdleMinutes)
    Get-ChildItem -Path $folder[0].FullName -Filter '*.jsonl' -File |
        Where-Object { $_.LastWriteTime -gt $since } |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object {
            [pscustomobject]@{
                Id = $_.BaseName
                Minutes = [int][Math]::Floor(((Get-Date) - $_.LastWriteTime).TotalMinutes)
                Title = Get-ChatTitle $_.FullName
            }
        }
}

function Get-StartBlocker([bool]$CheckChats) {
    $changes = @(Get-TrackedChanges)
    if ($changes.Count -gt 0) {
        return ('{0} tracked files are changed and not committed (first: {1})' -f $changes.Count, $changes[0].Substring(3))
    }
    if ($CheckChats) {
        $chats = @(Get-RecentChats)
        if ($chats.Count -gt 0) {
            return ('a chat wrote {0} min ago: "{1}" ({2}); the runner starts after {3} quiet minutes' -f $chats[0].Minutes, $chats[0].Title, $chats[0].Id, $IdleMinutes)
        }
    }
}

function Get-EnvironmentNotes {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        if ([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -eq 'Offline') {
            'On battery: tests run about twice as slow. Keep the charger in and the lid open.'
        }
    }
    catch { }
    if (-not (Get-Process -Name 'com.docker.backend', 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        'Docker is not running: the full backend suite takes about an hour instead of 35 minutes.'
    }
}

function Enter-RunnerLock {
    if (Test-Path $lockFile) {
        $text = [IO.File]::ReadAllText($lockFile).Trim()
        if ($text -match '^\d+$') {
            $other = Get-Process -Id ([int]$text) -ErrorAction SilentlyContinue
            if ($other -and $other.ProcessName -match '^(powershell|pwsh)$') {
                throw ('Another runner is running (process {0}). If it is not, delete {1}.' -f $text, $lockFile)
            }
        }
    }
    [IO.File]::WriteAllText($lockFile, [string]$PID, $utf8)
}

function Stop-ProcessTree([Diagnostics.Process]$Process) {
    if (-not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F | Out-Null }
}

function Read-ChatEvent([string]$Line, $Run) {
    # Tool output is most of the stream and holds nothing the runner needs.
    if ($Line.Length -gt 1000000) { return }
    $wanted = '"type":"system"', '"type":"result"', '"type":"assistant"', '"type":"rate_limit_event"'
    if (-not ($wanted | Where-Object { $Line.Contains($_) })) { return }
    try { $chatEvent = $Line | ConvertFrom-Json } catch { return }
    $type = Get-Field $chatEvent 'type'
    if ($type -eq 'rate_limit_event') {
        $Run.RateLimit = Get-Field $chatEvent 'rate_limit_info'
    }
    elseif ($type -eq 'system' -and (Get-Field $chatEvent 'subtype') -eq 'init') {
        $Run.Init = $chatEvent
        $Run.SessionId = Get-Field $chatEvent 'session_id'
        $Run.Model = Get-Field $chatEvent 'model'
        Write-Note ('Chat {0} started on {1}.' -f $Run.SessionId, $Run.Model)
        $onFallback = $Run.Fallback -and "$($Run.Model)" -like "$($Run.Fallback)*"
        if ("$($Run.Model)" -notlike "$($Run.Expected)*" -and -not $onFallback) { $Run.Stopped = ('it started on {0}, not {1}' -f $Run.Model, $Run.Expected) }
    }
    elseif ($type -eq 'result') {
        $Run.Result = $chatEvent
    }
    elseif ($type -eq 'assistant' -and -not (Get-Field $chatEvent 'parent_tool_use_id')) {
        foreach ($block in @(Get-Field (Get-Field $chatEvent 'message') 'content')) {
            if ((Get-Field $block 'type') -eq 'text') {
                $text = Get-ShortText ([string](Get-Field $block 'text')) 220
                if ($text) { Write-Host ('  {0:HH:mm}  {1}' -f (Get-Date), $text) }
            }
        }
    }
}

function Invoke-Chat {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [string]$ResumeId,
        [string]$ChatModel = $script:model,
        [string[]]$ExtraArgs = @(),
        [string[]]$ExtraDeny = @()
    )
    $argList = @('-p', '--model', $ChatModel, '--effort', $effort,
        '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none',
        '--output-format', 'stream-json', '--verbose', '--name', ('"{0}"' -f $Name))
    if ($ResumeId) { $argList += @('--resume', $ResumeId) }
    $fallback = ''
    if ($FallbackModel -and $FallbackModel -ne $ChatModel) {
        $fallback = $FallbackModel
        $argList += @('--fallback-model', $FallbackModel)
    }
    $argList += $ExtraArgs
    # Deny rules hold even in bypassPermissions. The list takes every value up to the end.
    $argList += '--disallowedTools'
    $argList += @(@('Bash(git push *)', 'PowerShell(git push *)') + $ExtraDeny | ForEach-Object { '"{0}"' -f $_ })

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Get-ClaudeExe
    $startInfo.Arguments = $argList -join ' '
    $startInfo.WorkingDirectory = $WorkDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8
    $startInfo.EnvironmentVariables['CLAUDE_CODE_EFFORT_LEVEL'] = $effort
    $startInfo.EnvironmentVariables['CLAUDE_CODE_SUBAGENT_MODEL'] = $ChatModel

    $run = [pscustomobject]@{ SessionId = $ResumeId; Expected = $ChatModel; Fallback = $fallback; Model = $null; Init = $null; Result = $null; RateLimit = $null; ExitCode = $null; Stopped = $null }
    $log = New-Object IO.StreamWriter($LogPath, $true, $utf8)
    $log.AutoFlush = $true
    $process = [Diagnostics.Process]::Start($startInfo)
    $finished = $false
    try {
        # The prompt goes through stdin as UTF-8: no command-line quoting, no code page.
        $stdin = New-Object IO.StreamWriter($process.StandardInput.BaseStream, $utf8)
        $stdin.Write($Prompt)
        $stdin.Close()
        $stderr = $process.StandardError.ReadToEndAsync()
        $deadline = (Get-Date).AddHours($StepHours)
        $lastOutput = Get-Date
        $pending = $process.StandardOutput.ReadLineAsync()
        while ($true) {
            if ($pending.Wait(15000)) {
                $line = $pending.Result
                if ($null -eq $line) { $finished = $true; break }
                $lastOutput = Get-Date
                $log.WriteLine($line)
                Read-ChatEvent $line $run
                if ($run.Stopped) { break }
                $pending = $process.StandardOutput.ReadLineAsync()
            }
            elseif ((Get-Date) -gt $deadline) {
                $run.Stopped = 'it ran past {0} hours' -f $StepHours
                break
            }
            elseif ($process.HasExited -and ((Get-Date) - $lastOutput).TotalSeconds -gt 60) {
                # A leftover child process can hold stdout open after claude.exe exits.
                $finished = $true
                break
            }
        }
    }
    finally {
        if ($finished) { [void]$process.WaitForExit(60000) }
        if (-not $process.HasExited) {
            Stop-ProcessTree $process
            [void]$process.WaitForExit(30000)
        }
        $log.Dispose()
    }
    if ($process.HasExited) { $run.ExitCode = $process.ExitCode }
    if ($stderr.Wait(5000) -and $stderr.Result.Trim()) {
        [IO.File]::WriteAllText($LogPath + '.stderr.txt', $stderr.Result, $utf8)
    }
    return $run
}

function Get-ResultText($Run) {
    return [string](Get-Field $Run.Result 'result')
}

# A usage limit or a passing API failure is worth a resume; anything else stops the runner.
function Test-Retryable($Run) {
    if ($Run.Stopped -or $null -eq $Run.Result) { return $false }
    if ((Get-Field $Run.RateLimit 'status') -eq 'rejected') { return $true }
    if (-not (Get-Field $Run.Result 'is_error')) { return $false }
    return (Get-ResultText $Run) -match '(?i)usage limit|limit reached|hit your limit|resets|overloaded|rate.?limit|\b(429|500|502|503|504|529)\b|timed? ?out|ECONN'
}

# Seconds until the usage window named in the chat's last rate-limit event resets, or 30
# minutes when it named none.
function Get-ResumeDelay($Run) {
    $resetsAt = $null
    if ((Get-Field $Run.RateLimit 'status') -eq 'rejected') { $resetsAt = Get-Field $Run.RateLimit 'resetsAt' }
    # Some limit messages carry the reset time themselves, as "...limit reached|<epoch seconds>".
    if (-not $resetsAt -and (Get-ResultText $Run) -match '\|(\d{10})\b') { $resetsAt = $Matches[1] }
    if ($resetsAt) {
        $seconds = ([DateTimeOffset]::FromUnixTimeSeconds([long]$resetsAt) - [DateTimeOffset]::UtcNow).TotalSeconds + 120
        if ($seconds -gt 60) { return [int]$seconds }
    }
    return 1800
}

# A weekly limit, the account's or one model's: it resets more than 12 hours away, or says so.
function Test-LongLimit($Run, [int]$Delay) {
    if ($Delay -gt 12 * 3600) { return $true }
    $type = [string](Get-Field $Run.RateLimit 'rateLimitType')
    if ((Get-Field $Run.RateLimit 'status') -eq 'rejected' -and $type -match '(?i)seven|week') { return $true }
    $text = Get-ResultText $Run
    return ($text -match '(?i)limit') -and ($text -match '(?i)week|seven.?day|7.?day')
}

function Get-UsageText($Run) {
    $windows = Get-Field $Run.RateLimit 'unifiedWindows'
    $parts = foreach ($name in 'five_hour', 'seven_day') {
        $used = Get-Field (Get-Field $windows $name) 'utilization'
        if ($null -ne $used) { '{0} {1:P0}' -f ($name -replace '_', '-'), [double]$used }
    }
    return (@($parts) -join ', ')
}

function Invoke-Step($Row) {
    $started = Get-Date
    $name = 'Plan runner ' + $Row.Id
    $base = Join-Path $logDir ('{0:yyyyMMdd-HHmm}-{1}' -f $started, ($Row.Id -replace '[^A-Za-z0-9.]', '_'))
    $log = $base + '.jsonl'
    $headBefore = @(Invoke-Git rev-parse HEAD)[0]
    $branchBefore = @(Invoke-Git rev-parse --abbrev-ref HEAD)[0]
    $untrackedBefore = @(Get-Untracked)
    $stepModel = Get-RowModel $Row.Id
    Write-Note ('Starting {0} in a new chat ({1}, effort {2}). Log: {3}' -f $Row.Id, $stepModel, $effort, $log)

    $run = Invoke-Chat -Prompt $stepPrompt.Replace('<<ROW>>', $Row.Id) -Name $name -WorkDir $repositoryRoot -LogPath $log -ChatModel $stepModel
    $fallbackNotes = New-Object System.Collections.Generic.List[string]
    $waits = 0
    while ((Test-Retryable $run) -and $waits -lt $MaxLimitWaits -and -not (Test-Path $stopFile)) {
        $waits++
        $reason = Get-ShortText (Get-ResultText $run) 200
        $delay = Get-ResumeDelay $run
        # A chat that never got a session id starts again with the whole step prompt.
        $prompt = $stepPrompt.Replace('<<ROW>>', $Row.Id)
        if ($run.SessionId) { $prompt = $resumePrompt -f $reason, $Row.Id }
        if (Test-LongLimit $run $delay) {
            $resetText = 'later this week'
            if ($delay -gt 12 * 3600) { $resetText = '{0:ddd HH:mm}' -f (Get-Date).AddSeconds($delay) }
            # A used-up weekly window resets days later: carry on with the fallback model, or stop.
            if ($FallbackModel -and $stepModel -ne $FallbackModel) {
                $script:exhaustedUntil[$stepModel] = (Get-Date).AddSeconds([Math]::Max($delay, 24 * 3600))
                $note = '{0} hit a limit that resets {1} ("{2}"); the chat carries on with {3}, and so do later rows until then' -f $stepModel, $resetText, $reason, $FallbackModel
                Write-Note $note
                $fallbackNotes.Add($note)
                $stepModel = $FallbackModel
                $run = Invoke-Chat -Prompt $prompt -Name $name -WorkDir $repositoryRoot -LogPath $log -ResumeId $run.SessionId -ChatModel $stepModel
                continue
            }
            $run.Stopped = 'the usage limit of {0} resets {1}, more than 12 hours away' -f $stepModel, $resetText
            break
        }
        Write-Note ('The chat stopped on "{0}". Resuming it at {1:HH:mm} ({2} of {3}).' -f $reason, (Get-Date).AddSeconds($delay), $waits, $MaxLimitWaits)
        Start-Sleep -Seconds $delay
        $run = Invoke-Chat -Prompt $prompt -Name $name -WorkDir $repositoryRoot -LogPath $log -ResumeId $run.SessionId -ChatModel $stepModel
    }

    $problems = New-Object System.Collections.Generic.List[string]
    if ($run.Stopped) { $problems.Add('the runner stopped the chat: ' + $run.Stopped) }
    elseif ($null -eq $run.Result) { $problems.Add(('the chat ended without a result (exit code {0})' -f $run.ExitCode)) }
    elseif (Get-Field $run.Result 'is_error') { $problems.Add('the chat ended with an error: ' + (Get-ShortText (Get-ResultText $run) 300)) }
    $changes = @(Get-TrackedChanges)
    if ($changes.Count -gt 0) { $problems.Add(('{0} tracked files are left changed and not committed' -f $changes.Count)) }
    $branchAfter = @(Invoke-Git rev-parse --abbrev-ref HEAD)[0]
    if ($branchAfter -ne $branchBefore) { $problems.Add(('the branch changed from {0} to {1}' -f $branchBefore, $branchAfter)) }
    $commits = @()
    if (@(Invoke-Git rev-parse HEAD)[0] -eq $headBefore) { $problems.Add('nothing was committed') }
    else {
        $commits = @(Invoke-Git log --oneline --no-decorate ('{0}..HEAD' -f $headBefore))
        # A co-author line once needed a history rewrite; catch it before anything is pushed.
        $messages = @(Invoke-Git log --format=%B ('{0}..HEAD' -f $headBefore)) -join "`n"
        if ($messages -match '(?im)^\s*co-authored-by:|generated with') {
            $problems.Add('a commit message has a co-author or "Generated with" line; reword it before pushing')
        }
    }
    # A row the chat split (R5.4b into R5.4b1 and R5.4b2) is gone; the next loop finds the rest.
    $rowAfter = @(Get-PlanRows | Where-Object { $_.Id -eq $Row.Id })
    if ($rowAfter.Count -gt 0 -and $rowAfter[0].Status -notlike 'Done*') {
        $problems.Add(('its row reads "{0}"' -f (Get-ShortText $rowAfter[0].Status 200)))
    }
    $newUntracked = @(Get-Untracked | Where-Object { $untrackedBefore -notcontains $_ })

    $report = Get-ResultText $run
    if ($report) { [IO.File]::WriteAllText($base + '-report.md', $report, $utf8) }
    $marker = ''
    if ($report -match '(?m)^\s*(RUNNER-RESULT:.*)$') { $marker = $Matches[1].Trim() }

    $ok = $problems.Count -eq 0
    $outcome = 'stopped'
    if ($ok) { $outcome = 'done' }
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(('## {0}: {1}' -f $Row.Id, $outcome))
    $lines.Add(('- {0:yyyy-MM-dd HH:mm} to {1:HH:mm}, chat "{2}", session {3}, model {4}' -f $started, (Get-Date), $name, $run.SessionId, $run.Model))
    $billed = Get-Field $run.Result 'modelUsage'
    if ($billed) { $lines.Add('- Models used: ' + (($billed.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')) }
    foreach ($note in $fallbackNotes) { $lines.Add('- Fallback: ' + $note) }
    foreach ($commit in $commits) { $lines.Add('- Commit: ' + $commit) }
    foreach ($problem in $problems) { $lines.Add('- Problem: ' + $problem) }
    if ($newUntracked.Count -gt 0) { $lines.Add('- New untracked files: ' + ($newUntracked -join ', ')) }
    if ($marker) { $lines.Add('- The chat says: ' + $marker) }
    $usage = Get-UsageText $run
    if ($usage) { $lines.Add('- Usage limits used at the end: ' + $usage) }
    $lines.Add(('- Report: {0}-report.md; log: {1}' -f $base, $log))
    [IO.File]::AppendAllText($summaryPath, ($lines -join "`r`n") + "`r`n`r`n", $utf8)
    Write-Note ('{0} {1}. {2}' -f $Row.Id, $outcome, ($problems -join '; '))
    return $ok
}

function Invoke-SelfTest([string]$TestModel) {
    $workDir = Join-Path $env:TEMP 'tbgym-plan-runner-selftest'
    [IO.Directory]::CreateDirectory($workDir) | Out-Null
    $log = Join-Path $logDir ('selftest-{0:yyyyMMdd-HHmmss}-{1}.jsonl' -f (Get-Date), $TestModel)
    $prompt = "This is a self-test of an automation script. Do exactly two things.`n" +
        "1. Run this command with the Bash tool: echo runner-selftest-blocked hello`n" +
        "2. Reply with one word: BLOCKED if the command was refused, RAN if it ran."
    Write-Note ('Self-test of {0}: one small chat in {1}. Log: {2}' -f $TestModel, $workDir, $log)
    $run = Invoke-Chat -Prompt $prompt -Name 'Plan runner self-test' -WorkDir $workDir -LogPath $log -ChatModel $TestModel `
        -ExtraArgs @('--no-session-persistence', '--strict-mcp-config') -ExtraDeny @('Bash(echo runner-selftest-blocked *)')
    $answer = Get-ShortText (Get-ResultText $run) 200
    $usage = Get-Field $run.Result 'modelUsage'
    $models = ''
    if ($usage) { $models = ($usage.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ' }
    $effortFields = ''
    if ($run.Init) {
        $effortFields = ($run.Init.PSObject.Properties | Where-Object { $_.Name -match 'effort|thinking' } |
            ForEach-Object { '{0}={1}' -f $_.Name, ($_.Value | ConvertTo-Json -Compress -Depth 3) }) -join ', '
    }
    Write-Note ('Model at start: {0}. Models billed: {1}. Exit code: {2}.' -f $run.Model, $models, $run.ExitCode)
    Write-Note ('Effort fields at start: {0}' -f $(if ($effortFields) { $effortFields } else { 'none reported' }))
    Write-Note ('Answer: {0}. Refused tool calls: {1}.' -f $answer, @(Get-Field $run.Result 'permission_denials').Count)
    Write-Note ('Usage limits used: {0}. Retry if it hit a limit: {1}.' -f (Get-UsageText $run), (Test-Retryable $run))
    $passed = ("$($run.Model)" -like "$TestModel*") -and $null -ne $run.Result -and -not (Get-Field $run.Result 'is_error') -and $answer -match 'BLOCKED'
    if ($passed) { Write-Note ('Self-test passed: {0}, the effort flag accepted, and a deny rule held in bypassPermissions.' -f $TestModel) }
    else { Write-Note ('Self-test of {0} FAILED: read the log above.' -f $TestModel) }
    return $passed
}

function Get-CutoffText {
    if ($stepCutoff) { return ('; no step starts after {0:ddd HH:mm}' -f $stepCutoff) }
    return ''
}

function Show-DryRun {
    Write-Note ('Claude: {0}' -f (Get-ClaudeExe))
    Write-Note ('Plan: {0} ({1}){2}.' -f $Plan, $planFiles[$Plan], (Get-CutoffText))
    Write-Note ('Each chat: --effort {0} ({1}), bypassPermissions, git push denied, at most {2} hours.' -f $effort, (Get-RowModelText), $StepHours)
    foreach ($note in @(Get-EnvironmentNotes)) { Write-Note ('Note: ' + $note) }
    foreach ($chat in @(Get-RecentChats)) {
        Write-Note ('Active in the last {0} min: "{1}" ({2}), {3} min ago' -f $IdleMinutes, $chat.Title, $chat.Id, $chat.Minutes)
    }
    $blocker = Get-StartBlocker $true
    if ($blocker) { Write-Note ('Would not start now: ' + $blocker) }
    else { Write-Note 'Nothing blocks a start now.' }
    $row = Get-NextRow
    $problem = Get-RowProblem $row
    if ($problem) { Write-Note ('Next row: ' + $problem) }
    else { Write-Note ('Next row: {0} on {1}, {2}' -f $row.Id, (Get-RowModel $row.Id), (Get-ShortText $row.What 120)) }
}

if ($SelfTest) {
    $allPassed = $true
    foreach ($testModel in @(@($model) + @($RowModels.Values) + @(@($FallbackModel) | Where-Object { $_ }) | Select-Object -Unique)) {
        if (-not (Invoke-SelfTest $testModel)) { $allPassed = $false }
    }
    if ($allPassed) { exit 0 }
    exit 1
}
if ($DryRun) {
    Show-DryRun
    exit 0
}

Enter-RunnerLock
try {
    Write-Note ('Runner started on the {0} plan: up to {1} steps{2}, each a new chat at {3} effort ({4}).' -f $Plan, $MaxSteps, (Get-CutoffText), $effort, (Get-RowModelText))
    foreach ($note in @(Get-EnvironmentNotes)) { Write-Note ('Note: ' + $note) }
    $steps = 0
    $lastBlocker = ''
    while ($true) {
        if (Test-Path $stopFile) {
            Remove-Item $stopFile
            Write-Note 'Found the STOP file: stopping before the next step.'
            break
        }
        $blocker = Get-StartBlocker ($steps -eq 0 -and -not $Force)
        if ($blocker) {
            if (-not $WaitForIdle) { Write-Note ('Not starting: ' + $blocker); break }
            if ($blocker -ne $lastBlocker) { Write-Note ('Waiting: ' + $blocker) }
            $lastBlocker = $blocker
            Start-Sleep -Seconds 300
            continue
        }
        $row = Get-NextRow
        $problem = Get-RowProblem $row
        if ($problem) { Write-Note ('Stopping: ' + $problem + '.'); break }
        if ($steps -ge $MaxSteps) { Write-Note ('Stopping after {0} steps (-MaxSteps). Next is {1}.' -f $steps, $row.Id); break }
        if ($stepCutoff -and (Get-Date) -gt $stepCutoff) { Write-Note ('Stopping: it is past {0:HH:mm} (-NoNewStepAfter). Next is {1}.' -f $stepCutoff, $row.Id); break }
        $steps++
        if (-not (Invoke-Step $row)) { Write-Note ('Stopped. Read {0}' -f $summaryPath); break }
    }
}
finally {
    Remove-Item $lockFile -ErrorAction SilentlyContinue
}
