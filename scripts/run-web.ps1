$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

Push-Location (Join-Path $repositoryRoot 'src\web')
try {
    npm start
    Assert-TbGymCommandSucceeded 'Angular development server'
}
finally {
    Pop-Location
}
