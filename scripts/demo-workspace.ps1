$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

# Fills the development database with the Atlas Performance demo (UI-REDESIGN-PLAN.md R0.1).
# Stop a running API first: it holds the build output. Pass --password <value> to change the
# shared demo password, and --cast sample for the first-name cast the homepage's pictures show
# (UI plan R6.2d): the same people with a last initial only, in "Oakline Strength".
Push-Location $repositoryRoot
try {
    dotnet run --project src/backend/TB.Gym.Api/TB.Gym.Api.csproj --launch-profile http -- demo-workspace @args
    Assert-TbGymCommandSucceeded 'Demo workspace'
}
finally {
    Pop-Location
}
