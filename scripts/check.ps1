param([switch] $SkipRestore)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

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
