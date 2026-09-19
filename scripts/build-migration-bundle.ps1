<#
.SYNOPSIS
Builds a self-contained EF Core migration bundle for GymDbContext.

.DESCRIPTION
Production migrations run as one deliberate deployment job that executes this bundle, never as part
of API startup. The bundle is built from the Infrastructure project with the API as its startup
project, through the same GymDbContextFactory every other EF command in this repository uses.

That factory reads its connection from ConnectionStrings__Database, both here and when the bundle
runs. Building opens no connection with it, and the bundle does not embed it, so a build takes a
credential-free placeholder. When the bundle runs, the deployment secret store injects the migration
role's real connection as ConnectionStrings__Database into the one-shot job's environment, and the
bundle is invoked with no arguments:

    ./efbundle

The bundle's --connection option overrides the variable, for local use only. It is not the
production path: command-line arguments are routinely exposed in process listings. Environment
injection avoids that ordinary exposure, but the value remains secret material and requires the
one-shot workload's normal process-isolation and secret-access controls.

EF ends by suggesting that appsettings.json be copied alongside the bundle. That does not apply here:
GymDbContextFactory reads no configuration file, so nothing belongs next to the bundle.

.PARAMETER RuntimeIdentifier
The runtime of the machine that will execute the bundle, for example linux-x64 or linux-musl-x64.
Required and never defaulted: a bundle built for the wrong runtime does not start there.

.PARAMETER OutputPath
The bundle executable to create.

.PARAMETER Force
Overwrite an existing file at OutputPath. Without it, an existing file is an error.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]+(?:[.-][a-z0-9]+)*$')]
    [string] $RuntimeIdentifier,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $OutputPath,

    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')

# Resolved against the caller's location, before this script changes directory.
$bundlePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)

if (Test-Path -LiteralPath $bundlePath -PathType Container) {
    throw "OutputPath is a directory: $bundlePath. Name the bundle file to create."
}

if ((Test-Path -LiteralPath $bundlePath) -and -not $Force) {
    throw "A file already exists at $bundlePath. Choose another path, or pass -Force to overwrite it."
}

# Checked, never printed.
if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__Database)) {
    throw @"
ConnectionStrings__Database is not set. GymDbContextFactory requires it to construct the context,
but building a bundle opens no connection with it, so do not supply a real credential here. A
placeholder is enough:

    `$env:ConnectionStrings__Database = 'Host=unused;Database=unused;Username=unused;Password=unused'
"@
}

# Every variable this script changes belongs to the caller's process. Whether each one existed, and
# its exact value, is captured before anything changes; the finally block puts back exactly that.
$savedVariables = [ordered]@{}
foreach ($name in @('DOTNET_ROOT', 'PATH', 'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
    $exists = Test-Path -LiteralPath "Env:$name"
    $value = $null
    if ($exists) {
        $value = (Get-Item -LiteralPath "Env:$name").Value
    }

    $savedVariables[$name] = @{ Exists = $exists; Value = $value }
}

$pushedLocation = $false
try {
    Push-Location $repositoryRoot
    $pushedLocation = $true

    # The repository's pinned SDK when one is installed locally, as check.ps1 uses. This deliberately
    # does not call Initialize-TbGymToolchains, which also loads the developer's .env: a production
    # artefact must not depend on whatever a local file happens to contain.
    $localDotnet = Join-Path $repositoryRoot '.tools/dotnet'
    if (Test-Path (Join-Path $localDotnet 'dotnet.exe')) {
        $env:DOTNET_ROOT = $localDotnet
        $env:PATH = "$localDotnet;$env:PATH"
    }

    # EF's design-time tooling assumes Development when neither variable is set. Name the
    # environment instead of inheriting that default.
    $env:ASPNETCORE_ENVIRONMENT = 'Production'
    $env:DOTNET_ENVIRONMENT = 'Production'

    dotnet tool restore
    Assert-TbGymCommandSucceeded 'dotnet tool restore'

    $arguments = @(
        'ef', 'migrations', 'bundle',
        '--project', 'src/backend/TB.Gym.Infrastructure/TB.Gym.Infrastructure.csproj',
        '--startup-project', 'src/backend/TB.Gym.Api/TB.Gym.Api.csproj',
        '--context', 'GymDbContext',
        '--configuration', 'Release',
        '--self-contained',
        '--target-runtime', $RuntimeIdentifier,
        '--output', $bundlePath
    )
    if ($Force) {
        $arguments += '--force'
    }

    dotnet @arguments
    Assert-TbGymCommandSucceeded 'dotnet ef migrations bundle'

    if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
        throw "dotnet ef reported success, but there is no bundle at $bundlePath."
    }

    Write-Host "Migration bundle for ${RuntimeIdentifier}: $bundlePath"
}
finally {
    # Written back only where it differs, so a variable this run never touched is never rewritten.
    foreach ($name in $savedVariables.Keys) {
        $saved = $savedVariables[$name]
        $present = Test-Path -LiteralPath "Env:$name"
        if (-not $saved.Exists) {
            if ($present) {
                Remove-Item -LiteralPath "Env:$name"
            }
        }
        elseif (-not $present -or (Get-Item -LiteralPath "Env:$name").Value -cne $saved.Value) {
            Set-Item -LiteralPath "Env:$name" -Value $saved.Value
        }
    }

    # Last, so a location problem can never stand between the caller and its own environment.
    if ($pushedLocation) {
        Pop-Location
    }
}
