param(
    [int] $Port = 4400,
    [switch] $Network,
    [string] $Password,
    [string] $Api,
    [switch] $NoPictures,
    [switch] $SkipBuild
)

# The private pre-launch build of the homepage (UI plan R6.2h): the page with the stand-in
# photographs from src\web\placeholders\ (hero.jpg, train.jpg, talk.jpg, team.jpg; any that exist
# are used, the rest are drawn grey), each marked "Placeholder", served on this laptop with
# X-Robots-Tag: noindex. Nothing is deployed and the public build is unchanged.
#
#   .\scripts\private-preview.ps1                      # build, then open http://127.0.0.1:4400/
#   .\scripts\private-preview.ps1 -Network             # also on the local network, behind a password it prints
#   .\scripts\private-preview.ps1 -Network -Password 'our-word' -Port 4400
#   .\scripts\private-preview.ps1 -Api http://localhost:5134   # with a running API, so Talk to us can send
#   .\scripts\private-preview.ps1 -SkipBuild           # serve the last build again
#   .\scripts\private-preview.ps1 -NoPictures          # the page as a fresh clone would show it: every stand-in grey
#
# The build runs src\web\scripts\private-preview.mjs, which writes placeholders\home-placeholders.ts
# (git-ignored, like the pictures) and builds with `ng build --configuration production,placeholders`
# into src\web\.private. Ctrl+C stops the server.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

# ng build writes its budget warnings to stderr; with the output captured, PowerShell 5.1 would turn
# each line into an error under 'Stop'. The exit code decides instead.
function Invoke-TbGymNode {
    param([Parameter(Mandatory = $true)][string] $Step, [Parameter(Mandatory = $true)][string[]] $Arguments)
    $ErrorActionPreference = 'Continue'
    try {
        & node @Arguments
    }
    finally {
        $ErrorActionPreference = 'Stop'
    }
    Assert-TbGymCommandSucceeded $Step
}

Push-Location (Join-Path $repositoryRoot 'src\web')
try {
    if (-not $SkipBuild) {
        $buildArguments = @('scripts/private-preview.mjs', 'build')
        if ($NoPictures) { $buildArguments += '--no-pictures' }
        Invoke-TbGymNode 'Private preview: build' $buildArguments
    }

    $serveArguments = @('scripts/private-preview.mjs', 'serve', '--port', "$Port")
    if ($Network) { $serveArguments += '--network' }
    if ($Password) { $serveArguments += @('--password', $Password) }
    if ($Api) { $serveArguments += @('--api', $Api) }
    Invoke-TbGymNode 'Private preview: serve' $serveArguments
}
finally {
    Pop-Location
}
