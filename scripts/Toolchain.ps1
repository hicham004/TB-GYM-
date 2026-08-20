function Initialize-TbGymToolchains {
    param([Parameter(Mandatory = $true)][string] $RepositoryRoot)

    $environmentFile = Join-Path $RepositoryRoot '.env'
    if (Test-Path $environmentFile) {
        Get-Content $environmentFile | ForEach-Object {
            $line = $_.Trim()
            if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) {
                return
            }

            $name, $value = $line -split '=', 2
            $name = $name.Trim()
            $value = $value.Trim().Trim('"').Trim("'")
            if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$' -and
                [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
                Set-Item -Path "Env:$name" -Value $value
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__Database) -and
        -not [string]::IsNullOrWhiteSpace($env:POSTGRES_PASSWORD)) {
        $database = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'tbgym' }
        $user = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'tbgym' }
        $port = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5433' }
        $env:ConnectionStrings__Database = "Host=localhost;Port=$port;Database=$database;Username=$user;Password=$($env:POSTGRES_PASSWORD)"
        $env:TB_GYM_TEST_ADMIN_CONNECTION = "Host=localhost;Port=$port;Database=postgres;Username=$user;Password=$($env:POSTGRES_PASSWORD);Pooling=false"
    }

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
