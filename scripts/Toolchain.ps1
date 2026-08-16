function Initialize-TbGymToolchains {
    param([Parameter(Mandatory = $true)][string] $RepositoryRoot)

    $localDotnet = Join-Path $RepositoryRoot '.tools\dotnet'
    if (Test-Path (Join-Path $localDotnet 'dotnet.exe')) {
        $env:DOTNET_ROOT = $localDotnet
        $env:PATH = "$localDotnet;$env:PATH"
    }

    $localNode = Join-Path $RepositoryRoot '.tools\node'
    if (Test-Path (Join-Path $localNode 'node.exe')) {
        $env:PATH = "$localNode;$env:PATH"
    }
}

function Assert-TbGymCommandSucceeded {
    param([Parameter(Mandatory = $true)][string] $Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

