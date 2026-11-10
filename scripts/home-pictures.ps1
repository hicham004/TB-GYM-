param(
    [string] $Base = 'http://127.0.0.1:4340',
    [string] $Shots = (Join-Path $env:TEMP 'tb-home-shots'),
    [string] $Pictures = (Join-Path $env:TEMP 'tb-home-pictures'),
    [string] $Bezel,
    [string[]] $Only,
    [switch] $SkipCapture,
    [switch] $SkipCompose
)

# The homepage's device pictures (UI plan R6.2d): the real app on the first-name sample demo,
# photographed as an iPhone 17 under Apple's own bezel and as 1:1 crops of the coach's screens.
#
# Before running it:
#   1. Build the sample demo into a throwaway database (never the development one):
#        $env:ConnectionStrings__Database = 'Host=127.0.0.1;Port=5432;Database=tbgym_pictures;...'
#        .\scripts\demo-workspace.ps1 --cast sample
#   2. Run the API against that database and `ng serve --proxy-config` on $Base (see run-api.ps1
#      and run-web.ps1; any spare ports do).
#   3. For the phone pictures only: download "Product bezels > iPhone 17" from
#      developer.apple.com/design/resources (a disk image; 7-Zip opens it) and pass the portrait PNG
#      of the colour you want as -Bezel. A run that makes only coach windows needs none. Apple's
#      files are not kept in the repository.
#   4. Install sharp outside the repository once (the script's header says how); set TB_HOME_TOOLS
#      if it is not in %TEMP%\tb-home-tools.
#
# Then, from the repository root (-Only takes shot and picture names, with or without quotes):
#   .\scripts\home-pictures.ps1 -Bezel 'C:\...\iPhone 17 - Black - Portrait.png'
#   .\scripts\home-pictures.ps1 -Only client-today -Bezel 'C:\...\iPhone 17 - Black - Portrait.png'
#   .\scripts\home-pictures.ps1 -Only coach-client-training-dark,maxes-dark
#   .\scripts\home-pictures.ps1 -SkipCapture -Only today-needs-you,team-window
#
# The shots go to -Shots and the finished pictures (PNG master, AVIF and WebP at the widths the page
# draws) to -Pictures; src/web/scripts/home-pictures.mjs lists every screen and crop.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

Push-Location (Join-Path $repositoryRoot 'src\web')
try {
    # PowerShell hands an unquoted a,b to a parameter as a list: join it back for the script.
    $onlyArguments = @()
    if ($Only) { $onlyArguments = @('--only', ($Only -join ',')) }
    $bezelArguments = @()
    if ($Bezel) { $bezelArguments = @('--bezel', $Bezel) }

    if (-not $SkipCapture) {
        node scripts/home-pictures.mjs capture --base $Base --out $Shots @onlyArguments
        Assert-TbGymCommandSucceeded 'Homepage pictures: capture'
    }

    if (-not $SkipCompose) {
        # compose asks for the bezel itself, and only when it makes a phone picture.
        node scripts/home-pictures.mjs compose --shots $Shots --out $Pictures @bezelArguments @onlyArguments
        Assert-TbGymCommandSucceeded 'Homepage pictures: compose'
    }
}
finally {
    Pop-Location
}
