$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

Push-Location $repositoryRoot
try {
    dotnet run --project src/backend/TB.Gym.Api/TB.Gym.Api.csproj --launch-profile http
    Assert-TbGymCommandSucceeded 'API'
}
finally {
    Pop-Location
}

