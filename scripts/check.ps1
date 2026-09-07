param([switch] $SkipRestore)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

# The backend integration suite talks to a real PostgreSQL, so it needs a connection string to reach
# it and an administrative one to create the per-test databases it drops again afterwards.
# Toolchain.ps1 derives both from the POSTGRES_* values in `.env`, so the ordinary local setup needs
# nothing further here. But `.env` is deliberately not in the repository, and without it the suite
# still starts and then fails every integration test with "TB_GYM_TEST_ADMIN_CONNECTION is not
# configured" -- after a full Release build has already been paid for. Checking now turns twenty
# wasted minutes into one sentence naming what to set.
#
# Nothing is defaulted. A working credential belongs in `.env` or the environment, never in a script
# that is committed.
$missingDatabaseSettings = @()
if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__Database)) {
    $missingDatabaseSettings += 'ConnectionStrings__Database'
}

if ([string]::IsNullOrWhiteSpace($env:TB_GYM_TEST_ADMIN_CONNECTION)) {
    $missingDatabaseSettings += 'TB_GYM_TEST_ADMIN_CONNECTION'
}

if ($missingDatabaseSettings.Count -gt 0) {
    throw @"
The backend integration tests have no PostgreSQL to run against: $($missingDatabaseSettings -join ' and ') $(if ($missingDatabaseSettings.Count -eq 1) { 'is' } else { 'are' }) not set.

The usual fix is to create the local environment file and start the database:

    Copy-Item .env.example .env
    # set POSTGRES_PASSWORD in .env
    docker compose up --detach postgres

Toolchain.ps1 then derives both connection strings from POSTGRES_PASSWORD, together with
POSTGRES_DB, POSTGRES_USER and POSTGRES_PORT (defaulting to tbgym, tbgym and 5433).

To point the run at a database of your own instead, set both variables directly before running
this script, for example:

    `$env:ConnectionStrings__Database = 'Host=127.0.0.1;Port=5433;Database=tbgym;Username=tbgym;Password=<password>'
    `$env:TB_GYM_TEST_ADMIN_CONNECTION = 'Host=127.0.0.1;Port=5433;Database=postgres;Username=tbgym;Password=<password>;Pooling=false'

TB_GYM_TEST_ADMIN_CONNECTION must reach a database the user may run CREATE DATABASE against; the
suite creates one database per test class and drops it on the way out.
"@
}

Push-Location $repositoryRoot
try {
    if (-not $SkipRestore) {
        dotnet restore TB.Gym.slnx
        Assert-TbGymCommandSucceeded 'dotnet restore'
    }

    dotnet build TB.Gym.slnx --configuration Release --no-restore
    Assert-TbGymCommandSucceeded 'dotnet build'

    $env:TB_GYM_REQUIRE_POSTGRES_TESTS = 'true'

    # The realtime scale-out tests start their own pinned Redis container per test, because the
    # outage test stops one and the suite runs methods in parallel. Requiring them turns a missing
    # Docker daemon into a failure rather than a quietly skipped proof that a frame published by one
    # replica reaches a connection held by another. The image is pulled once up front so a test is
    # never also waiting on a registry.
    $dockerAvailable = $false
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) { $dockerAvailable = $true }
    }

    if ($dockerAvailable) {
        docker pull redis:8.2.2-alpine
        Assert-TbGymCommandSucceeded 'docker pull redis'
        $env:TB_GYM_REQUIRE_REDIS_TESTS = 'true'

        docker compose config --quiet
        Assert-TbGymCommandSucceeded 'docker compose config'
    }
    else {
        Write-Warning 'Docker is unavailable, so the Redis scale-out tests will report inconclusive rather than fail. CI requires them.'
        $env:TB_GYM_REQUIRE_REDIS_TESTS = 'false'
    }

    dotnet test TB.Gym.slnx --configuration Release --no-build
    Assert-TbGymCommandSucceeded 'dotnet test'

    Push-Location 'src\web'
    try {
        if (-not (Test-Path 'node_modules')) {
            npm ci
            Assert-TbGymCommandSucceeded 'npm ci'
        }

        npm run format:check
        Assert-TbGymCommandSucceeded 'Angular format check'

        npm run lint
        Assert-TbGymCommandSucceeded 'Angular lint'

        npm run build
        Assert-TbGymCommandSucceeded 'Angular build'

        npm test
        Assert-TbGymCommandSucceeded 'Angular tests'

        npm audit --audit-level=high
        Assert-TbGymCommandSucceeded 'npm audit'
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
