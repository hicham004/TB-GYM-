<#
.SYNOPSIS
Runs a plan's status table unattended: one fresh Claude chat per row.

.DESCRIPTION
-Plan notes (the default since 2026-11-05) runs the Open rows in section 0 of
docs/NOTES-PLAN-2026-11.md, the builds the two owners decided on 2026-11-05 from the plan for
the owner's notes of 2026-11-03, each chat with ultracode on (the owner's word that evening);
-Plan motion runs the rows in section 0 of
docs/MOTION-PLAN-2026-11.md, the motion and play the owner asked for on 2026-11-01 (its W rows
run on Fable, the owner's word that night); -Plan critique runs the rows in section 0 of
docs/CRITIQUE-FIXES-2026-10.md, the fixes from Toufic's critique (2026-10-27); -Plan audit runs
the fix batches in section 0 of docs/FULL-AUDIT-2026-10.md, all Done on 2026-10-23; -Plan ui
runs the section 0 table of docs/UI-REDESIGN-PLAN.md, which the owner marked complete on
2026-10-13.

Each step is a new `claude -p` chat on -Model at -Effort: Fable 5.2 at extra-high effort since
2026-11-12 (the owner's word; Opus 5.5 at max effort before), unless -RowModels names another
model for its row (the owner put R6.2 on Fable on 2026-10-11). It gets the plan's opening in
$planPrompts plus the unattended-run rules in $sharedRules below. The owner decided on
2026-10-11, and again for the audit on 2026-10-19, that such a chat commits its own step once
every check AGENTS.md asks for is green. A chat never pushes: a deny rule blocks git push.
The runner itself pushes the branch after each step that ends Done (the owner, 2026-10-29),
only while GitHub hides the repository from the signed-out (404) and origin has no commit the
branch lacks; -NoPush keeps the commits on this laptop.

A chat that hits a usage limit is resumed where it stopped. A five-hour limit is waited out
on the same model. A weekly limit (one resetting more than 12 hours away, the account's or one
model's) moves the chat to -FallbackModel at once, and later rows stay on it until that limit
resets (the owner, 2026-10-12: Fable first, then Opus 5.5). When no other model can carry on,
-OnWeeklyLimit wait (the owner, 2026-10-29: "use it all, then carry on") waits for the reset
and resumes the chat; -OnWeeklyLimit stop ends the run instead. Claude Code's --fallback-model
does the same for a model that is overloaded or unavailable. A STOP file ends any wait.
A chat whose usage window is rejected until after its deadline is stopped at its limit result,
or once it is quiet for 10 minutes or past the deadline, so that wait takes over: N10c's chat
waited on its own servers past the weekly limit, the laptop slept, and StepHours ended the run
(2026-11-07). A window that resets sooner is left to the chat, which carries on by itself.

A step starts only when no tracked file is changed, no chat in this folder has written
for -IdleMinutes, and the next row is Open (not a gate, Optional, Built or Blocked).
The runner stops after -MaxSteps, at the first step that does not end clean with its
row Done, when artifacts\plan-runner\STOP exists, or, with -NoNewStepAfter, before a step
that would start after that clock time. Logs, each chat's report and summary.md go to
artifacts\plan-runner\ (git-ignored).

A step a weekly limit stopped leaves its work uncommitted in the tree. -ResumeSession with
that chat's session id (runner.log names it) makes the first step resume the same chat,
with its context, instead of refusing to start on the changed tree.

Rows run focused tests only (the owner, 2026-11-10: the full backend suite took 1.6 to 2.1
hours of every row, and review agents half of every row's tokens). A run that ends because
its rows are built, or at -MaxSteps, then runs the full backend suite and Vitest itself, with
no chat waiting on them: what fails is rerun alone once to tell a flake, what fails again goes
to one fix chat, and the check runs once more after it. -FinalCheck runs only that check.

.EXAMPLE
.\scripts\plan-runner.ps1 -DryRun       # what would run next; starts nothing
.\scripts\plan-runner.ps1 -SelfTest     # one tiny chat per model outside the repo: model, effort, deny rule
.\scripts\plan-runner.ps1 -WaitForIdle  # wait until other chats are finished, then run
.\scripts\plan-runner.ps1 -WaitForIdle -NoNewStepAfter 08:00   # a night run that leaves the morning free
.\scripts\plan-runner.ps1 -WaitForIdle -ResumeSession <id>     # carry on with the step a limit stopped
.\scripts\plan-runner.ps1 -FinalCheck   # the full backend suite and Vitest now, a fix chat if they fail
#>
[CmdletBinding()]
param(
    [ValidateSet('audit', 'ui', 'critique', 'motion', 'notes')]
    [string]$Plan = 'notes',
    # A clock time such as 08:00: no step starts after its next occurrence (empty: no limit).
    [string]$NoNewStepAfter = '',
    # The session id of a chat a limit stopped: the first step resumes it, its changes still in the tree.
    [string]$ResumeSession = '',
    [int]$MaxSteps = 3,
    [double]$StepHours = 8,
    [int]$IdleMinutes = 20,
    [int]$MaxLimitWaits = 12,
    # Every chat's model and effort (the owner, 2026-11-12: Fable 5.2 at extra-high effort; Opus 5.5 at
    # max before). The rest of the script reads them as $model and $effort.
    [string]$Model = 'claude-fable-5-2',
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = 'xhigh',
    # Row id pattern (-like) to model; a row matching none runs on -Model.
    [hashtable]$RowModels = @{ 'R6.2*' = 'claude-fable-5-1'; 'W*' = 'claude-fable-5-1' },
    # After a weekly limit the chat carries on with this model, and so do later rows until that
    # limit resets (the owner, 2026-10-12). An empty string stops the runner instead.
    [string]$FallbackModel = 'claude-opus-5-5',
    # A weekly limit no other model can take over from: wait for its reset, or stop the run.
    [ValidateSet('wait', 'stop')]
    [string]$OnWeeklyLimit = 'wait',
    # Keep commits on this laptop instead of pushing after each step that ends Done.
    [switch]$NoPush,
    [switch]$WaitForIdle,
    [switch]$DryRun,
    [switch]$SelfTest,
    # Only the final check: the full backend suite and Vitest on the current commit, a fix chat if they fail.
    [switch]$FinalCheck,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$planFiles = @{ audit = 'docs\FULL-AUDIT-2026-10.md'; ui = 'docs\UI-REDESIGN-PLAN.md'; critique = 'docs\CRITIQUE-FIXES-2026-10.md'; motion = 'docs\MOTION-PLAN-2026-11.md'; notes = 'docs\NOTES-PLAN-2026-11.md' }
$planPath = Join-Path $repositoryRoot $planFiles[$Plan]
$logDir = Join-Path $repositoryRoot 'artifacts\plan-runner'
$stopFile = Join-Path $logDir 'STOP'
$lockFile = Join-Path $logDir 'runner.lock'
$summaryPath = Join-Path $logDir 'summary.md'
# Models whose weekly limit is used up, with when to try them again; their rows run on $FallbackModel.
$script:exhaustedUntil = @{}
# Set when a push needs the owner (commits on origin that the branch lacks, or an origin not on GitHub).
$script:pushStop = $false
# A chat whose usage window is rejected past its deadline and that writes nothing this long is stopped for the limit wait.
$script:limitQuietMinutes = 10
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
    critique = @'
Read docs/CRITIQUE-FIXES-2026-10.md and do the next step: the first row of its section 0
status table that is not Done, passing over rows marked "Open, not blocking". Build it as
section 2 describes that row; docs/CRITIQUE-TOUFIC-2026-10.md has the evidence.

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. The runner expects the next step to be <<ROW>>.
If section 0 gives a different row, change nothing and say why.

Traps on this laptop (your memory notes have more):
- A full backend suite started between 00:00 and 01:00 Beirut time fails R34a and R25b
  on the day boundary: start it after 01:00 or rerun those two alone. The known flakes
  (the rate-limit test, the Redis-outage SignalR test, the Step3Renewal double tap) pass
  when rerun alone.
- The live specs in src/web/e2e/live and your live pass run against a fresh demo in a
  throwaway database of your own (ConnectionStrings__Database pointed at it), never
  against the owner's own API (port 5134), web (port 4200) or the tbgym and tbgym_demo
  databases. Never drop a database you did not create; name yours in your report.

The owner's decisions for this run (2026-10-27, and 2026-10-29 for running unattended):
- The owner chose every row's content on a decision page of sketches, so rows are built
  without another preview round: the owner judges the screenshots afterwards. The row's
  third column is the owner's word; an item it leaves out is not built.
- Never stop the run for a decision: the owner answers section 3 of the plan later.
  A technical question is yours (AGENTS.md). A product choice the row and the docs do
  not settle (words, layout, a default, an edge case): build the way closest to the
  owner's earlier choices and the row's spec, and add a line to section 3, "Waiting for
  the owner" (the row, the question, what you built, the other way, your
  recommendation). A new money rule, legal wording or work outside the row: leave that
  item out, add it to section 3 with your recommendation, and build the rest of the
  row. The row's status says how many lines you added to section 3.
- The full backend suite runs on this laptop before you commit whenever you changed
  server code: scripts/TestPostgres.ps1 with a container name of your own, about 35
  minutes with Docker. A failure an earlier row left is fixed first, in its own commit,
  and named in your report.
- A row too big to finish well in one chat: split it into parts (B5a1, B5a2), each with
  its scope, build and commit the first, and leave the others Open for the next chat.
- Where a row changes a rule, update DOMAIN-RULES, the ADR or ARCHITECTURE in a few
  lines, as AGENTS.md asks.
'@
    motion = @'
Read docs/MOTION-PLAN-2026-11.md and do the next step: the first row of its section 0
status table that is not Done, passing over rows marked "Open, not blocking". Build it as
section 2 describes that row, under the rules of section 1.

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. The runner expects the next step to be <<ROW>>.
If section 0 gives a different row, change nothing and say why.

The clock (the owner's deadline is a demo this afternoon):
- The row is sized for about an hour. At 75 minutes stop adding: finish the checks on
  what is complete, leave the rest out with a line in section 3, and commit. The runner
  ends this chat at 1.75 hours and the whole run stops if you have not committed by then.
- A moment is complete and smooth, or absent. Never commit half-built motion. If nothing
  is complete in time, revert only your own changes, set the row to "Open, not blocking:
  ran out of time at HH:MM, <what was tried>", commit only the plan file, and end with
  RUNNER-RESULT: done so the run carries on.
- Read the clock before any long command. Start the API, ng serve and any command over a
  minute with run_in_background and a timeout.

Traps on this laptop (your memory notes have more):
- The live pass and the videos run against a fresh demo in a throwaway database of your
  own (ConnectionStrings__Database pointed at it), never against the owner's own API
  (port 5134), web (port 4200) or the tbgym and tbgym_demo databases. Never drop a
  database you did not create; name yours in your report.
- The owner's bin/Debug may be locked: build and run Release or a scratch output of your
  own for the API you start.
- GSAP's clock is Date.now, so a spec that freezes the clock freezes every tween; the
  mocked Playwright config runs with reduced motion by default after W1, and a motion
  spec opts in with emulateMedia.
- The first download is 510.74 kB against a 520 kB error budget: measure it before and
  after. No GSAP in the app (the Web Animations API carries every moment); core/motion is
  tiny and imports nothing but Angular.

The owner's decisions for this run (2026-11-01, "go"):
- The owner asked for animation and visible interactive things so that a friend trying
  the app tomorrow is amazed, and approved building the rows of section 0 in order
  without a preview round: the owner judges the videos and screenshots afterwards. The
  row's third column is the owner's word; an item it leaves out is not built.
- Never stop the run for a decision. A technical question is yours (AGENTS.md). A product
  choice the row and the docs do not settle (a duration, an easing, a place, the words):
  build the way closest to the prototype in docs/design/prototype/tb-gym-prototype.html
  and the owner's earlier choices, and add a line to section 3, "Waiting for the owner"
  (the row, the question, what you built, the other way, your recommendation). A new
  money rule, legal wording, points, levels, ranks or work outside the row: leave that
  item out, add it to section 3 with your recommendation, and build the rest.
- Only a row that changes server code runs the full backend suite (scripts/TestPostgres.ps1
  with a container name of your own). Web rows run the web checks, the mocked specs of the
  screens they changed, and the live pass with videos, as section 1 says.
- Where a row changes a rule or a motion layer, update docs/UI-REDESIGN-PLAN.md in a few
  lines, as AGENTS.md asks.
'@
    notes = @'
Read docs/NOTES-PLAN-2026-11.md and do the next step: the first row of its section 0
status table that is Open, passing over rows marked "Waits" or "Open, not blocking". Build
it as section 2 describes that row, under the rules of section 1.

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. The runner expects the next step to be <<ROW>>.
If section 0 gives a different row, change nothing and say why.

ultracode: the owner asked for every row of this plan to be built with ultracode on
(2026-11-05). Use the Workflow tool as the workflow-authoring skill's Ultracode section
says: understand the area with parallel readers, build, then review your own diff
adversarially before the checks. Solo only for trivial edits. The owner's limits of
2026-11-10 come before that section's "token cost is not a constraint": the review's
agents were half of every row's tokens (51 to 73 agents a row from N6b to N6d).
- At most four readers, each on its own part of the area.
- One adversarial review of the diff, with at most four finder lenses (correctness and
  the domain rules; security, tenancy and money; the tests; the screens and the words).
  One skeptic checks each finding, and a second only a finding on security, tenant
  isolation or money. No second review round: the focused tests check the fixes.

Traps on this laptop (your memory notes have more):
- A backend test run started between 00:00 and 01:00 Beirut time fails R34a and R25b on
  the day boundary: start it after 01:00 or rerun those two alone. The known flakes (the
  rate-limit test, the Redis-outage SignalR test, the Step3Renewal double tap) pass when
  rerun alone.
- The live pass runs against a fresh demo in a throwaway database of your own
  (ConnectionStrings__Database pointed at it), never against the owner's own API
  (port 5134), web (port 4200) or the tbgym and tbgym_demo databases. Never drop a
  database you did not create; name yours in your report.
- The owner's bin/Debug may be locked: build and run Release or a scratch output of your
  own for the API you start.
- The first download has a 520 kB error budget (510 kB warning): measure it before and
  after a web change and name both numbers.

The owner's decisions for this run (2026-11-05, "start building what's decided"):
- The rows follow the decisions the two owners recorded on 5 November; section 2 names
  each row's decisions. The row's third column is the owner's word; an item it leaves out
  is not built. A row marked "Waits" is not yours: the owner opens it.
- Never stop the run for a decision. A technical question is yours (AGENTS.md). A product
  choice the row and the docs do not settle (words, layout, a default, an edge case):
  build the default the row names, or the way closest to the owner's earlier choices, and
  add a line to section 3, "Waiting for the owner" (the row, the question, what you
  built, the other way, your recommendation). A new money rule, legal wording or work
  outside the row: leave that item out, add it to section 3 with your recommendation, and
  build the rest of the row. The row's status says how many lines you added to section 3.
- Tests in proportion (the owner, 2026-11-10; for a row this replaces AGENTS.md's full
  backend suite and any Checks line of section 2 that names it). Never run the whole
  backend suite or the whole of Vitest in a row: the suite took 1.6 to 2.1 hours of every
  row. While you build, run only the tests you are writing or changing. Once at the end,
  after the review's fixes: a row that changed server code builds the backend, runs the
  domain and architecture test projects whole (seconds), and runs the integration test
  classes it added or changed plus every class that calls an endpoint, service or table
  its diff changed (search the test project for them), inside
  Start/Stop-TbGymTestPostgres with a container name of your own; a row that changed web
  code runs format:check, lint, the production build, the Vitest spec files of the code
  it changed and the mocked Playwright specs of the screens it changed. A failure an
  earlier row left is fixed first, in its own commit, and named in your report. When the
  run ends, the runner itself runs the full backend suite and Vitest once and starts a
  chat to fix what fails.
- A row too big to finish well in one chat: split it into parts (N4a, N4b), each with
  its scope, build and commit the first, and leave the others Open for the next chat.
- Where a row changes a rule, update DOMAIN-RULES, the ADR or ARCHITECTURE in a few
  lines, as AGENTS.md asks.
'@
}

$sharedRules = @'
- Commit approved. When the step meets its definition of done and every check AGENTS.md
  and the rules above ask for has passed (the backend tests they name when backend code
  changed, the web checks when web code changed, git diff --check, and a live pass of
  every new or changed screen),
  commit the step on the current branch, then record the hash in its status row in a
  second small commit, in the form section 0 uses. Stage only the files this step changed,
  by explicit path. No co-author or "Generated with" lines. Never push (<<PUSH>>),
  never create or switch branches, never amend, rebase or reset commits.
- If a check fails and you cannot fix it inside the step, do not commit. Set the row to
  "Built, not committed" with one line on what failed, and stop.

How an unattended run works:
- Ask nothing and do not use plan mode. State your plan in a message, then build.
- Background commands are stopped after 10 minutes here unless you pass a timeout. Start
  long ones (a test run, the API, ng serve) with run_in_background and timeout 7200000,
  then do other work or end your turn: you get another turn when one exits. Never wait on
  one with sleep or polling loops: every turn re-reads the whole chat, about 600,000
  tokens late in a row.
- Before your final message, stop the servers and background commands you started, and
  only those. Never kill processes by name.
- Leave scripts/plan-runner.ps1 and artifacts/plan-runner/ alone; they belong to the runner.
- Your final message is the owner's report: what changed for coaches and clients, test
  results, what was not done or not verified, where the 390 px and 1440 px screenshots
  are, and the next step. End it with exactly one of these lines:
  RUNNER-RESULT: done <<ROW>> <commit hash>
  RUNNER-RESULT: stopped <one-line reason>
'@
$pushNote = 'the runner pushes the branch once your step ends Done, and CI runs again there'
if ($NoPush) { $pushNote = 'the owner pushes' }
$stepPrompt = ($planPrompts[$Plan] + "`n" + $sharedRules).Replace('<<PUSH>>', $pushNote)

$resumePrompt = 'The run stopped ({0}). Servers you started may still be running, and test runs you started have ended. Carry on with step {1} from where you stopped. The unattended-run rules in the first message still apply.'
# For -ResumeSession: hours may have passed since the chat stopped, and its runner has exited.
$stoppedResumePrompt = 'A usage limit or the owner stopped this chat and ended that run of the runner. A new run resumes you now, so the clock has moved on: read it before a backend test run. Servers you started may still be running, test runs you started have ended, and other commits may have reached main. Uncommitted changes another session made in files outside your step may have been set aside since: commit only your own files. Carry on with step {0} from where you stopped. The unattended-run rules in the first message still apply.'
# After -OnWeeklyLimit wait: the same run waited, possibly for days, while the chat was stopped.
$weeklyResumePrompt = 'A weekly usage limit stopped this chat, and the runner waited for it to reset, so the clock has moved on: read it before a backend test run. Servers you started may still be running, and test runs you started have ended. Carry on with step {0} from where you stopped. The unattended-run rules in the first message still apply.'
# A resumed chat runs in a new process: name ultracode again, as the notes plan's first message does.
if ($Plan -eq 'notes') {
    $resumePrompt += ' ultracode stays on.'
    $stoppedResumePrompt += ' ultracode stays on.'
    $weeklyResumePrompt += ' ultracode stays on.'
}

# The run's final check (the owner, 2026-11-10): rows run focused tests only, and when the run ends
# the runner itself runs the full backend suite and Vitest once, so no chat waits hours on them.
$finalCheckHours = 4
# The backend tests as check.ps1 runs them, in a child PowerShell. Written out as a file; ASCII only.
$backendTestsScript = @'
# Written by scripts/plan-runner.ps1 for its final check: the backend tests, as check.ps1 runs them.
param([string]$Root, [string]$Log, [string]$Results, [string]$Container, [string]$Filter = '', [switch]$NoBuild)
$ErrorActionPreference = 'Continue'
Set-Location $Root
function Write-Log([string]$Text) { $Text | Out-File -FilePath $Log -Append -Encoding utf8 }
# Toolchain.ps1 would point an empty setting at the owner's database; the test container sets its own below.
$env:ConnectionStrings__Database = 'Host=unused;Database=unused;Username=unused;Password=unused'
. .\scripts\Toolchain.ps1
Initialize-TbGymToolchains -RepositoryRoot $Root | Out-Null
. .\scripts\TestPostgres.ps1
$TbGymTestPostgresContainer = $Container
Write-Log ('START ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$env:TB_GYM_REQUIRE_POSTGRES_TESTS = 'true'
$env:TB_GYM_REQUIRE_REDIS_TESTS = 'true'
docker pull redis:8.2.2-alpine *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
docker pull $TbGymTestPostgresImage *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
if (-not $NoBuild) {
    dotnet restore TB.Gym.slnx *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
    dotnet build TB.Gym.slnx --configuration Release --no-restore -v q -nologo *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
    $built = $LASTEXITCODE
    Write-Log ('BUILD exit=' + $built)
    if ($built -ne 0) { Write-Log ('END exit=' + $built); exit $built }
}
$testArgs = @('test', 'TB.Gym.slnx', '--configuration', 'Release', '--no-build', '--logger', 'console;verbosity=normal',
    '--logger', 'trx', '--results-directory', $Results, '--blame-hang-timeout', '30m', '--blame-hang-dump-type', 'none')
if ($Filter) { $testArgs += @('--filter', $Filter) }
$exit = 1
try {
    $previous = Start-TbGymTestPostgres
    try {
        & dotnet @testArgs *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
        $exit = $LASTEXITCODE
    }
    finally { Stop-TbGymTestPostgres $previous }
}
catch { Write-Log ('RUNNER-ERROR ' + $_.Exception.Message) }
Write-Log ('END exit=' + $exit + ' ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
exit $exit
'@
$vitestScript = @'
# Written by scripts/plan-runner.ps1 for its final check: every Vitest spec.
param([string]$Root, [string]$Log)
$ErrorActionPreference = 'Continue'
Set-Location $Root
. .\scripts\Toolchain.ps1
Initialize-TbGymToolchains -RepositoryRoot $Root | Out-Null
Set-Location (Join-Path $Root 'src\web')
$env:CI = 'true'
cmd /c "npx ng test --watch=false > `"$Log`" 2>&1"
$exit = $LASTEXITCODE
('END exit=' + $exit) | Out-File -FilePath $Log -Append -Encoding utf8
exit $exit
'@
# The one chat that fixes what the final check found.
$finalFixPrompt = @'
The plan runner ran the full backend suite and Vitest once at the end of its run, on main
at <<HEAD>> (the owner's rule of 2026-11-10: rows run focused tests, the runner the whole
suite). These failed, and failed again when rerun alone:
<<FAILURES>>
Logs: <<LOGS>>
The run's commits, newest first:
<<COMMITS>>

This chat runs unattended. scripts/plan-runner.ps1 started it, and nobody will see or
answer anything until it has finished. Fix these failures and nothing else.
- Find each failure's cause in the code and in the commits above. Fix whatever is wrong,
  which may be the test: a test that pins behaviour a row changed on purpose follows that
  row's spec in section 2 of the plan file the commits name.
- A failure that comes from this laptop rather than the code (Docker, a port, the clock,
  a known flake from your memory notes): change nothing for it and say so.
- Run the tests that failed and the focused tests of what you change: backend tests
  inside Start/Stop-TbGymTestPostgres from scripts/TestPostgres.ps1 with a container name
  of your own, Vitest only the spec files involved. Never the whole suite: the runner runs
  it again after you.
- Ask nothing, do not use plan mode, and use no workflows: this is a small fix.
- Commit approved: one commit on the current branch for the fix, after git diff --check,
  staging only the files you changed, by explicit path. No co-author or "Generated with"
  lines. Never push (<<PUSH>>), never create or switch branches, never amend, rebase or
  reset commits. Leave scripts/plan-runner.ps1 and artifacts/plan-runner/ alone.
- Background commands are stopped after 10 minutes here unless you pass a timeout. Start
  a long one with run_in_background and timeout 7200000, then end your turn: you get
  another turn when it exits. Never wait with sleep or polling loops.
- Before your final message, stop the servers and background commands you started, and
  only those. Never kill processes by name.
- Your final message is the owner's report: each failure, its cause, what you changed and
  the tests you ran. End it with exactly one of these lines:
  RUNNER-RESULT: done final-check <commit hash>
  RUNNER-RESULT: stopped <one-line reason>
'@

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

# The first row that is not Done; a gate the owner marked "not blocking" and a row that "Waits" on a
# decision (the notes plan, 2026-11-05) are passed over.
function Get-NextRow {
    foreach ($row in @(Get-PlanRows)) {
        if ($row.Status -like 'Done*' -or $row.Status -like 'Open, not blocking*' -or $row.Status -like 'Waits*') { continue }
        return $row
    }
}

function Get-RowProblem($Row) {
    if ($null -eq $Row) { return 'no row is left to build: every row is Done or waits for the owner' }
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

function Get-StartBlocker([bool]$CheckChats, [bool]$AllowChanges = $false) {
    $changes = @(Get-TrackedChanges)
    if ($changes.Count -gt 0 -and -not $AllowChanges) {
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
        'Docker is not running: backend tests need its test PostgreSQL, and the final check starts Docker Desktop.'
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
    # Print mode stops background tasks 10 minutes after the chat's last turn and exits; a chat that ends its
    # turn to wait for its own workflow lost N3b that way (2026-11-06). $StepHours is the limit instead.
    $startInfo.EnvironmentVariables['CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS'] = '0'

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
                $resultBefore = $run.Result
                Read-ChatEvent $line $run
                if ($run.Stopped) { break }
                # A limit result while background work keeps the process alive: N10c's chat waited on its
                # own servers past the weekly limit until StepHours ended the run (2026-11-07). When the
                # window outlasts this chat, the caller's limit wait takes over.
                if ($run.Result -and -not [object]::ReferenceEquals($run.Result, $resultBefore) -and (Get-Field $run.Result 'is_error') -and (Test-LimitOutlastsChat $run $deadline)) {
                    Write-Note ('Stopping the chat at its limit: {0}' -f (Get-ShortText (Get-ResultText $run) 160))
                    break
                }
                $pending = $process.StandardOutput.ReadLineAsync()
            }
            elseif ((Test-LimitOutlastsChat $run $deadline) -and ((Get-Date) -gt $deadline -or ((Get-Date) - $lastOutput).TotalMinutes -gt $script:limitQuietMinutes)) {
                # The same without a limit result: quiet, or past the deadline (a laptop that slept).
                Write-Note 'Stopping the chat: its usage limit outlasts it, and it went quiet or ran out of time.'
                break
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
    if ($Run.Stopped) { return $false }
    # A step the chat finished is not waited out, whatever the last rate-limit event said.
    if ($Run.Result -and -not (Get-Field $Run.Result 'is_error') -and (Get-ResultText $Run) -match '(?m)^\s*RUNNER-RESULT:\s*done\b') { return $false }
    # Even without a result: Invoke-Chat stops a rejected chat that went quiet.
    if ((Get-Field $Run.RateLimit 'status') -eq 'rejected') { return $true }
    if ($null -eq $Run.Result) { return $false }
    if (-not (Get-Field $Run.Result 'is_error')) { return $false }
    return (Get-ResultText $Run) -match '(?i)usage limit|limit reached|hit your limit|resets|overloaded|rate.?limit|\b(429|500|502|503|504|529)\b|timed? ?out|ECONN'
}

# The epoch second the chat's usage window resets, when its last rate-limit event or result says.
function Get-ResetEpoch($Run) {
    if ((Get-Field $Run.RateLimit 'status') -eq 'rejected') {
        $resetsAt = Get-Field $Run.RateLimit 'resetsAt'
        if ($resetsAt) { return [long]$resetsAt }
    }
    # Some limit messages carry the reset time themselves, as "...limit reached|<epoch seconds>".
    if ((Get-ResultText $Run) -match '\|(\d{10})\b') { return [long]$Matches[1] }
}

# True when the chat's usage window is rejected until after its deadline, or names no reset. A window
# that resets sooner is left to the chat itself: A14b's five-hour limit passed while its backend suite
# ran, and the same process carried on to Done (2026-10-22).
function Test-LimitOutlastsChat($Run, [datetime]$Deadline) {
    if ((Get-Field $Run.RateLimit 'status') -ne 'rejected') { return $false }
    $resetsAt = Get-ResetEpoch $Run
    if (-not $resetsAt) { return $true }
    return [DateTimeOffset]::FromUnixTimeSeconds($resetsAt).LocalDateTime -gt $Deadline
}

# Seconds until the usage window named in the chat's last rate-limit event resets, or 30
# minutes when it named none.
function Get-ResumeDelay($Run) {
    $resetsAt = Get-ResetEpoch $Run
    if ($resetsAt) {
        $seconds = ([DateTimeOffset]::FromUnixTimeSeconds($resetsAt) - [DateTimeOffset]::UtcNow).TotalSeconds + 120
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

# Sleeps in steps of a minute at most; false as soon as the STOP file appears.
function Wait-UnlessStopped([int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        if (Test-Path $stopFile) { return $false }
        $left = [int][Math]::Ceiling(($until - (Get-Date)).TotalSeconds)
        Start-Sleep -Seconds ([Math]::Max(1, [Math]::Min(60, $left)))
    }
    return $true
}

# owner/name of origin on GitHub; nothing for another host.
function Get-GitHubRepository {
    $url = @(Invoke-Git remote get-url origin)[0]
    if ($url -match 'github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$') { return $Matches[1] }
}

# Pushes the branch after a step ended Done (the owner, 2026-10-29). Commits on origin the branch
# lacks stop the run for the owner; a passing failure (no network) is noted and the next step's
# push carries this one's commits too.
function Invoke-Push {
    $branch = @(Invoke-Git rev-parse --abbrev-ref HEAD)[0]
    $repository = Get-GitHubRepository
    if (-not $repository) { return @{ Text = 'not pushed: origin is not on GitHub'; Stop = $true } }
    # A credential prompt would hang an unattended run: fail instead.
    $saved = @{ GCM_INTERACTIVE = $env:GCM_INTERACTIVE; GIT_TERMINAL_PROMPT = $env:GIT_TERMINAL_PROMPT }
    $env:GCM_INTERACTIVE = 'never'
    $env:GIT_TERMINAL_PROMPT = '0'
    try {
        try { Invoke-Git fetch --quiet origin $branch | Out-Null }
        catch { return @{ Text = ('not pushed: fetching origin failed ({0}); the next push tries again' -f $_.Exception.Message); Stop = $false } }
        $behind = 0
        try { $behind = [int]@(Invoke-Git rev-list --count ('HEAD..origin/{0}' -f $branch))[0] } catch { }
        if ($behind -gt 0) {
            return @{ Text = ('not pushed: origin/{0} has {1} commits this branch lacks; merge them, then start the runner again' -f $branch, $behind); Stop = $true }
        }
        try { Invoke-Git push --quiet origin ('HEAD:refs/heads/{0}' -f $branch) | Out-Null }
        catch { return @{ Text = ('not pushed: git push failed ({0}); the next push tries again' -f $_.Exception.Message); Stop = $false } }
        return @{ Text = ('pushed {0} to github.com/{1} at {2}' -f $branch, $repository, @(Invoke-Git rev-parse --short HEAD)[0]); Stop = $false }
    }
    finally {
        $env:GCM_INTERACTIVE = $saved.GCM_INTERACTIVE
        $env:GIT_TERMINAL_PROMPT = $saved.GIT_TERMINAL_PROMPT
    }
}

function Invoke-Step($Row, [string]$ResumeId = '', [string]$FirstPrompt = '') {
    $started = Get-Date
    $name = 'Plan runner ' + $Row.Id
    $base = Join-Path $logDir ('{0:yyyyMMdd-HHmm}-{1}' -f $started, ($Row.Id -replace '[^A-Za-z0-9.]', '_'))
    $log = $base + '.jsonl'
    $headBefore = @(Invoke-Git rev-parse HEAD)[0]
    $branchBefore = @(Invoke-Git rev-parse --abbrev-ref HEAD)[0]
    $untrackedBefore = @(Get-Untracked)
    $stepModel = Get-RowModel $Row.Id
    # The final check's fix chat brings its own first message, and runs without ultracode.
    $firstText = $stepPrompt.Replace('<<ROW>>', $Row.Id)
    $limitResumeText = $resumePrompt
    $weeklyResumeText = $weeklyResumePrompt
    if ($FirstPrompt) {
        $firstText = $FirstPrompt
        $limitResumeText = $resumePrompt.Replace(' ultracode stays on.', '')
        $weeklyResumeText = $weeklyResumePrompt.Replace(' ultracode stays on.', '')
    }
    $prompt = $firstText
    if ($ResumeId) {
        $prompt = $stoppedResumePrompt -f $Row.Id
        Write-Note ('Resuming chat {0} for {1} ({2}, effort {3}). Log: {4}' -f $ResumeId, $Row.Id, $stepModel, $effort, $log)
    }
    else { Write-Note ('Starting {0} in a new chat ({1}, effort {2}). Log: {3}' -f $Row.Id, $stepModel, $effort, $log) }

    $run = Invoke-Chat -Prompt $prompt -Name $name -WorkDir $repositoryRoot -LogPath $log -ChatModel $stepModel -ResumeId $ResumeId
    $fallbackNotes = New-Object System.Collections.Generic.List[string]
    $waits = 0
    $weeklyGiveUp = $null
    while ((Test-Retryable $run) -and $waits -lt $MaxLimitWaits -and -not (Test-Path $stopFile)) {
        $waits++
        $reason = Get-ShortText (Get-ResultText $run) 200
        if (-not $reason) { $reason = 'a usage limit, with no result' }
        $delay = Get-ResumeDelay $run
        # A chat that never got a session id starts again with the whole step prompt.
        $prompt = $firstText
        if ($run.SessionId) { $prompt = $limitResumeText -f $reason, $Row.Id }
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
            if ($OnWeeklyLimit -eq 'wait') {
                # Not counted in -MaxLimitWaits. Without a reset time, look again every hour; eight
                # days at most, so an error misread as a weekly limit cannot hold the run for ever.
                $waits--
                if (-not (Get-ResetEpoch $run)) { $delay = 3600 }
                if (-not $weeklyGiveUp) { $weeklyGiveUp = (Get-Date).AddDays(8) }
                if ((Get-Date).AddSeconds($delay) -gt $weeklyGiveUp) {
                    $run.Stopped = 'the weekly limit of {0} did not reset within 8 days' -f $stepModel
                    break
                }
                Write-Note ('{0} hit a weekly limit ("{1}"). Waiting for its reset; the chat resumes at {2:ddd HH:mm}.' -f $stepModel, $reason, (Get-Date).AddSeconds($delay))
                if (-not (Wait-UnlessStopped $delay)) { $run.Stopped = 'the STOP file ended the wait for the weekly limit'; break }
                if ($run.SessionId) { $prompt = $weeklyResumeText -f $Row.Id }
                $run = Invoke-Chat -Prompt $prompt -Name $name -WorkDir $repositoryRoot -LogPath $log -ResumeId $run.SessionId -ChatModel $stepModel
                continue
            }
            $run.Stopped = 'the usage limit of {0} resets {1}, more than 12 hours away' -f $stepModel, $resetText
            break
        }
        Write-Note ('The chat stopped on "{0}". Resuming it at {1:HH:mm} ({2} of {3}).' -f $reason, (Get-Date).AddSeconds($delay), $waits, $MaxLimitWaits)
        if (-not (Wait-UnlessStopped $delay)) { $run.Stopped = 'the STOP file ended the wait for the usage limit'; break }
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
    $pushText = ''
    $script:pushStop = $false
    if ($ok -and -not $NoPush) {
        $push = Invoke-Push
        $pushText = $push.Text
        $script:pushStop = $push.Stop
        Write-Note ('{0}: {1}' -f $Row.Id, $pushText)
    }
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(('## {0}: {1}' -f $Row.Id, $outcome))
    $lines.Add(('- {0:yyyy-MM-dd HH:mm} to {1:HH:mm}, chat "{2}", session {3}, model {4}' -f $started, (Get-Date), $name, $run.SessionId, $run.Model))
    $billed = Get-Field $run.Result 'modelUsage'
    if ($billed) { $lines.Add('- Models used: ' + (($billed.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')) }
    foreach ($note in $fallbackNotes) { $lines.Add('- Fallback: ' + $note) }
    foreach ($commit in $commits) { $lines.Add('- Commit: ' + $commit) }
    if ($pushText) { $lines.Add('- Push: ' + $pushText) }
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

# Runs a script in a hidden child PowerShell and waits for its exit code, at most $Hours; $null when
# the STOP file or the time limit ended it (its process tree is killed, never anything by name).
function Invoke-ChildScript([string]$Path, [string]$Arguments, [double]$Hours) {
    $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru `
        -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" {1}' -f $Path, $Arguments)
    # Without the handle, a Start-Process object can lose its exit code.
    $null = $process.Handle
    $until = (Get-Date).AddHours($Hours)
    while (-not $process.WaitForExit(30000)) {
        if ((Test-Path $stopFile) -or (Get-Date) -gt $until) {
            Stop-ProcessTree $process
            [void]$process.WaitForExit(30000)
            return $null
        }
    }
    return $process.ExitCode
}

# Every test a TRX file under $Directory reports as not passed (Class.Method, skipped tests aside), and
# the counts per test project. Read as a stream: the integration TRX holds every test's output (50 MB).
function Read-TrxResults([string]$Directory) {
    $failed = New-Object System.Collections.Generic.List[string]
    $counts = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path $Directory)) { return [pscustomobject]@{ Failed = @(); Counts = @() } }
    foreach ($file in @(Get-ChildItem -Path $Directory -Filter '*.trx' -File)) {
        $methods = @{}
        $failedIds = New-Object System.Collections.Generic.List[object]
        $unitTestId = $null
        $reader = [Xml.XmlReader]::Create($file.FullName)
        try {
            while ($reader.Read()) {
                if ($reader.NodeType -ne [Xml.XmlNodeType]::Element) { continue }
                $element = $reader.LocalName
                if ($element -eq 'UnitTestResult') {
                    if (@('Failed', 'Error', 'Timeout', 'Aborted') -contains $reader.GetAttribute('outcome')) {
                        $failedIds.Add(@($reader.GetAttribute('testId'), $reader.GetAttribute('testName')))
                    }
                }
                elseif ($element -eq 'UnitTest') { $unitTestId = $reader.GetAttribute('id') }
                elseif ($element -eq 'TestMethod' -and $unitTestId) {
                    $methods[$unitTestId] = '{0}.{1}' -f $reader.GetAttribute('className'), $reader.GetAttribute('name')
                }
                elseif ($element -eq 'Counters') {
                    $counts.Add(('{0} of {1} passed' -f $reader.GetAttribute('passed'), $reader.GetAttribute('total')))
                }
            }
        }
        catch { $counts.Add(('{0} could not be read: {1}' -f $file.Name, $_.Exception.Message)) }
        finally { $reader.Dispose() }
        foreach ($pair in $failedIds) {
            $testName = $methods[$pair[0]]
            if (-not $testName) { $testName = $pair[1] }
            if (-not $failed.Contains($testName)) { $failed.Add($testName) }
        }
    }
    return [pscustomobject]@{ Failed = $failed.ToArray(); Counts = $counts.ToArray() }
}

# The backend tests in a child PowerShell: the whole suite, or only -Filter on the last build.
function Invoke-BackendTests([string]$Base, [string]$Filter = '', [switch]$NoBuild) {
    $path = $Base + '.ps1'
    $log = $Base + '.log'
    $results = $Base + '-trx'
    [IO.File]::WriteAllText($path, $backendTestsScript, $utf8)
    $arguments = '-Root "{0}" -Log "{1}" -Results "{2}" -Container tbgym-test-postgres-runner' -f $repositoryRoot, $log, $results
    if ($Filter) { $arguments += ' -Filter "{0}"' -f $Filter }
    if ($NoBuild) { $arguments += ' -NoBuild' }
    $exit = Invoke-ChildScript $path $arguments $finalCheckHours
    $text = ''
    if (Test-Path $log) { $text = ([IO.File]::ReadAllText($log)).Replace([string][char]0, '') }
    $trx = Read-TrxResults $results
    $buildFailed = $text -match '(?m)^BUILD exit=[1-9]'
    # A run that never got to its tests (Docker, the container, a kill) is not the code's failure.
    $ran = ($null -ne $exit) -and ($buildFailed -or @($trx.Counts).Count -gt 0) -and $text -notmatch '(?m)^RUNNER-ERROR '
    return [pscustomobject]@{ Exit = $exit; Ran = $ran; BuildFailed = $buildFailed; Failed = @($trx.Failed); Counts = @($trx.Counts); Log = $log }
}

function Invoke-Vitest([string]$Base) {
    $path = $Base + '.ps1'
    $log = $Base + '.log'
    [IO.File]::WriteAllText($path, $vitestScript, $utf8)
    $exit = Invoke-ChildScript $path ('-Root "{0}" -Log "{1}"' -f $repositoryRoot, $log) 1
    $counts = ''
    if (Test-Path $log) {
        $counts = (@([IO.File]::ReadAllText($log) -split "`r?`n" | Where-Object { $_ -match '^\s*(Test Files|Tests)\s' } | ForEach-Object { $_.Trim() }) -join '; ')
    }
    return [pscustomobject]@{ Exit = $exit; Counts = $counts; Log = $log }
}

function Test-Docker {
    $ErrorActionPreference = 'Continue'
    try { $null = & docker info --format '{{.ServerVersion}}' 2>&1; return $LASTEXITCODE -eq 0 } catch { return $false }
}

# Docker Desktop started if it is not running; true once its engine answers, within five minutes.
function Confirm-Docker {
    if (Test-Docker) { return $true }
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $desktop)) { return $false }
    Write-Note 'Final check: starting Docker Desktop for the test PostgreSQL.'
    Start-Process -FilePath $desktop
    $until = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $until) {
        Start-Sleep -Seconds 15
        if (Test-Docker) { return $true }
    }
    return $false
}

# One pass of the final check: the full backend suite, then Vitest, each failure rerun alone once to
# tell a flake from a break. Returns what still fails, and the lines for summary.md.
function Invoke-FinalPass([string]$Base) {
    $lines = New-Object System.Collections.Generic.List[string]
    $failures = New-Object System.Collections.Generic.List[string]
    $logs = New-Object System.Collections.Generic.List[string]
    $suite = Invoke-BackendTests ($Base + '-backend')
    $logs.Add($suite.Log)
    if (-not $suite.Ran) {
        $lines.Add(('- Backend suite: did not run to the end (exit {0}); read {1}' -f $suite.Exit, $suite.Log))
        return [pscustomobject]@{ Failures = @(); Lines = $lines.ToArray(); Logs = $logs.ToArray(); Broken = $true }
    }
    if ($suite.BuildFailed) {
        $failures.Add('the backend build (dotnet build TB.Gym.slnx -c Release)')
        $lines.Add(('- Backend suite: the build failed; read {0}' -f $suite.Log))
    }
    else {
        $lines.Add(('- Backend suite: {0} (exit {1})' -f ($suite.Counts -join ', '), $suite.Exit))
        $stillFailing = @($suite.Failed)
        if ($stillFailing.Count -eq 0 -and $suite.Exit -ne 0) {
            $failures.Add(('the backend suite ended with exit {0} and no failed test; read {1}' -f $suite.Exit, $suite.Log))
        }
        elseif ($stillFailing.Count -gt 0 -and $stillFailing.Count -le 40) {
            # The known flakes pass alone (the plan's traps); only what fails again is a break.
            $filter = ($stillFailing | ForEach-Object { 'FullyQualifiedName~' + $_ }) -join '|'
            $rerun = Invoke-BackendTests ($Base + '-backend-rerun') -Filter $filter -NoBuild
            $logs.Add($rerun.Log)
            if ($rerun.Ran) {
                $flaky = @($stillFailing | Where-Object { @($rerun.Failed) -notcontains $_ })
                if ($flaky.Count -gt 0) { $lines.Add(('- Passed when rerun alone: {0}' -f ($flaky -join ', '))) }
                $stillFailing = @($rerun.Failed)
            }
        }
        foreach ($test in $stillFailing) { $failures.Add($test) }
    }
    $vitest = Invoke-Vitest ($Base + '-vitest')
    if ($null -ne $vitest.Exit -and $vitest.Exit -ne 0) { $vitest = Invoke-Vitest ($Base + '-vitest-rerun') }
    $logs.Add($vitest.Log)
    $lines.Add(('- Vitest: {0} (exit {1})' -f $vitest.Counts, $vitest.Exit))
    if ($null -eq $vitest.Exit) { return [pscustomobject]@{ Failures = $failures.ToArray(); Lines = $lines.ToArray(); Logs = $logs.ToArray(); Broken = $true } }
    if ($vitest.Exit -ne 0) { $failures.Add(('Vitest, twice: {0}; read {1}' -f $vitest.Counts, $vitest.Log)) }
    return [pscustomobject]@{ Failures = $failures.ToArray(); Lines = $lines.ToArray(); Logs = $logs.ToArray(); Broken = $false }
}

# The full backend suite and Vitest once when a run ends (the owner, 2026-11-10). What still fails
# goes to one fix chat, and the check runs once more after it. No chat waits on the suite itself.
function Invoke-FinalCheck([string]$RunStart) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('## Final check')
    $head = @(Invoke-Git rev-parse --short HEAD)[0]
    $outcome = ''
    if (@(Get-TrackedChanges).Count -gt 0) { $outcome = 'not run: tracked files are changed and not committed' }
    elseif (-not (Confirm-Docker)) { $outcome = 'not run: Docker does not answer, and the suite needs its test PostgreSQL' }
    else {
        # R34a and R25b fail on the day boundary when the suite starts between 00:00 and 01:00.
        if ((Get-Date).Hour -eq 0) {
            Write-Note 'Final check: waiting until 01:05, past the day boundary two tests trip on.'
            if (-not (Wait-UnlessStopped ([int]([datetime]::Today.AddHours(1).AddMinutes(5) - (Get-Date)).TotalSeconds))) { $outcome = 'not run: the STOP file ended the wait' }
        }
    }
    if (-not $outcome) {
        $started = Get-Date
        $base = Join-Path $logDir ('{0:yyyyMMdd-HHmm}-final-check' -f $started)
        Write-Note ('Final check on {0}: the full backend suite, then Vitest (about 2 hours). Logs: {1}-*' -f $head, $base)
        $pass = Invoke-FinalPass $base
        $lines.Add(('- {0:yyyy-MM-dd HH:mm} to {1:HH:mm} on {2}' -f $started, (Get-Date), $head))
        foreach ($line in $pass.Lines) { $lines.Add($line) }
        if ($pass.Broken) { $outcome = 'not finished: a run was cut short (the STOP file, the time limit, Docker or the test container)' }
        elseif ($pass.Failures.Count -eq 0) { $outcome = 'passed' }
        else {
            $lines.Add(('- Still failing: {0}' -f ($pass.Failures -join '; ')))
            [IO.File]::AppendAllText($summaryPath, ($lines -join "`r`n") + "`r`n`r`n", $utf8)
            $lines.Clear()
            $lines.Add('## Final check, after the fix chat')
            $commits = @(Invoke-Git log --oneline --no-decorate -20 ('{0}..HEAD' -f $RunStart))
            if ($commits.Count -eq 0) { $commits = @(Invoke-Git log --oneline --no-decorate -10) }
            $prompt = $finalFixPrompt.Replace('<<HEAD>>', $head).Replace('<<PUSH>>', $pushNote).Replace('<<LOGS>>', ($pass.Logs -join ', '))
            $prompt = $prompt.Replace('<<FAILURES>>', (($pass.Failures | Select-Object -First 60 | ForEach-Object { '- ' + $_ }) -join "`n"))
            $prompt = $prompt.Replace('<<COMMITS>>', (($commits | ForEach-Object { '- ' + (Get-ShortText $_ 160) }) -join "`n"))
            $fixed = Invoke-Step ([pscustomobject]@{ Id = 'final-check'; What = 'fix what the final check found'; Gate = $false; Status = 'Open' }) -FirstPrompt $prompt
            if (Test-Path $stopFile) { $outcome = 'not run again: the STOP file' }
            elseif (@(Get-TrackedChanges).Count -gt 0) { $outcome = 'not run again: the fix chat left tracked files changed' }
            else {
                $again = Get-Date
                $head = @(Invoke-Git rev-parse --short HEAD)[0]
                Write-Note ('Final check again on {0}, after the fix chat (it ended {1}).' -f $head, $(if ($fixed) { 'Done' } else { 'stopped' }))
                $pass = Invoke-FinalPass ($base + '-2')
                $lines.Add(('- {0:yyyy-MM-dd HH:mm} to {1:HH:mm} on {2}' -f $again, (Get-Date), $head))
                foreach ($line in $pass.Lines) { $lines.Add($line) }
                if ($pass.Broken) { $outcome = 'not finished: a run was cut short' }
                elseif ($pass.Failures.Count -eq 0) { $outcome = 'passed' }
                else { $outcome = 'failed again, for the owner: ' + ($pass.Failures -join '; ') }
            }
        }
    }
    $lines.Add('- Outcome: ' + $outcome)
    [IO.File]::AppendAllText($summaryPath, ($lines -join "`r`n") + "`r`n`r`n", $utf8)
    if (Test-Path $stopFile) { Remove-Item $stopFile }
    Write-Note ('Final check: {0}.' -f $outcome)
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

function Get-RunRulesText {
    $weekly = 'a weekly limit no other model takes over is waited out'
    if ($OnWeeklyLimit -eq 'stop') { $weekly = 'a weekly limit no other model takes over stops the run' }
    $push = 'the runner pushes after each step that ends Done'
    if ($NoPush) { $push = 'nothing is pushed (-NoPush)' }
    return ('{0}; {1}' -f $push, $weekly)
}

function Show-DryRun {
    Write-Note ('Claude: {0}' -f (Get-ClaudeExe))
    Write-Note ('Plan: {0} ({1}){2}.' -f $Plan, $planFiles[$Plan], (Get-CutoffText))
    Write-Note ('Each chat: --effort {0} ({1}), bypassPermissions, git push denied, at most {2} hours.' -f $effort, (Get-RowModelText), $StepHours)
    Write-Note ('Runner: {0}.' -f (Get-RunRulesText))
    Write-Note ('Final check: when the rows are built (or at -MaxSteps), the full backend suite and Vitest, Docker {0}.' -f $(if (Test-Docker) { 'answering' } else { 'not answering yet' }))
    if (-not $NoPush) { Write-Note ('Push target: github.com/{0}.' -f (Get-GitHubRepository)) }
    foreach ($note in @(Get-EnvironmentNotes)) { Write-Note ('Note: ' + $note) }
    foreach ($chat in @(Get-RecentChats)) {
        Write-Note ('Active in the last {0} min: "{1}" ({2}), {3} min ago' -f $IdleMinutes, $chat.Title, $chat.Id, $chat.Minutes)
    }
    $blocker = Get-StartBlocker $true ([bool]$ResumeSession)
    if ($blocker) { Write-Note ('Would not start now: ' + $blocker) }
    else { Write-Note 'Nothing blocks a start now.' }
    $row = Get-NextRow
    $problem = Get-RowProblem $row
    if ($problem) { Write-Note ('Next row: ' + $problem) }
    else { Write-Note ('Next row: {0} on {1}, {2}' -f $row.Id, (Get-RowModel $row.Id), (Get-ShortText $row.What 120)) }
    if ($ResumeSession) { Write-Note ('The first step resumes chat {0}, with the {1} tracked changes in the tree.' -f $ResumeSession, @(Get-TrackedChanges).Count) }
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
    if ($FinalCheck) {
        Write-Note 'Runner started for the final check only.'
        Invoke-FinalCheck (@(Invoke-Git rev-parse HEAD)[0])
        return
    }
    Write-Note ('Runner started on the {0} plan: up to {1} steps{2}, each a new chat at {3} effort ({4}); {5}.' -f $Plan, $MaxSteps, (Get-CutoffText), $effort, (Get-RowModelText), (Get-RunRulesText))
    foreach ($note in @(Get-EnvironmentNotes)) { Write-Note ('Note: ' + $note) }
    $runStart = @(Invoke-Git rev-parse HEAD)[0]
    $steps = 0
    $doneSteps = 0
    # Only a run that ends because its rows are built (or at -MaxSteps) runs the final check.
    $finished = $false
    $lastBlocker = ''
    while ($true) {
        if (Test-Path $stopFile) {
            Remove-Item $stopFile
            Write-Note 'Found the STOP file: stopping before the next step.'
            break
        }
        # A resumed first step finds its own uncommitted work in the tree.
        $resumeId = ''
        if ($ResumeSession -and $steps -eq 0) { $resumeId = $ResumeSession }
        $blocker = Get-StartBlocker ($steps -eq 0 -and -not $Force) ([bool]$resumeId)
        if ($blocker) {
            if (-not $WaitForIdle) { Write-Note ('Not starting: ' + $blocker); break }
            if ($blocker -ne $lastBlocker) { Write-Note ('Waiting: ' + $blocker) }
            $lastBlocker = $blocker
            Start-Sleep -Seconds 300
            continue
        }
        $row = Get-NextRow
        $problem = Get-RowProblem $row
        if ($problem) { Write-Note ('Stopping: ' + $problem + '.'); $finished = $true; break }
        if ($steps -ge $MaxSteps) { Write-Note ('Stopping after {0} steps (-MaxSteps). Next is {1}.' -f $steps, $row.Id); $finished = $true; break }
        if ($stepCutoff -and (Get-Date) -gt $stepCutoff) { Write-Note ('Stopping: it is past {0:HH:mm} (-NoNewStepAfter). Next is {1}.' -f $stepCutoff, $row.Id); break }
        $steps++
        if (-not (Invoke-Step $row $resumeId)) {
            # A STOP file that ended a wait inside the step has done its job.
            if (Test-Path $stopFile) { Remove-Item $stopFile }
            Write-Note ('Stopped. Read {0}' -f $summaryPath)
            break
        }
        $doneSteps++
        if ($script:pushStop) { Write-Note ('Stopped before the next step: the push needs the owner. Read {0}' -f $summaryPath); break }
    }
    if ($doneSteps -gt 0) {
        if ($finished) { Invoke-FinalCheck $runStart }
        else { Write-Note 'No final check: the run did not finish its rows. When it has: .\scripts\plan-runner.ps1 -FinalCheck' }
    }
}
finally {
    Remove-Item $lockFile -ErrorAction SilentlyContinue
}
