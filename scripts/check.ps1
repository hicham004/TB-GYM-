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
