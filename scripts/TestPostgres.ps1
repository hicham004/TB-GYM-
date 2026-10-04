# A throwaway PostgreSQL for the backend integration suite.
#
# The suite creates, fills and drops about 640 databases. On a development server every drop waits
# for a checkpoint that flushes all pending writes to disk, one checkpoint at a time, and that queue
# was most of the hour. This server holds nothing but those test databases: it keeps its data in
# memory with durability switched off (the "Non-Durable Settings" chapter of the PostgreSQL docs),
# listens on this machine only, uses a password made up for this run, and is removed when the run
# ends. A crash can therefore lose nothing of value, and the development server and its databases
# are never touched.
#
# Usage, from the repository root:
#
#     . .\scripts\TestPostgres.ps1
#     $testPostgres = Start-TbGymTestPostgres
#     try { dotnet test TB.Gym.slnx --configuration Release --no-build }
#     finally { Stop-TbGymTestPostgres $testPostgres }

# The same image CI's PostgreSQL service runs.
$TbGymTestPostgresImage = 'postgres:18.4-alpine'
$TbGymTestPostgresContainer = 'tbgym-test-postgres'

function Invoke-TbGymDocker {
    # Windows PowerShell 5.1 turns a native command's stderr into an error record, which is
    # terminating under the 'Stop' preference check.ps1 uses; callers check the exit code instead.
    $ErrorActionPreference = 'Continue'
    $output = & docker @args 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output | Out-String).Trim() }
}

function Start-TbGymTestPostgres {
    # A container left by a run that was killed before it could clean up is replaced, not reused.
    $null = Invoke-TbGymDocker rm --force $TbGymTestPostgresContainer

    $password = [guid]::NewGuid().ToString('N')
    $started = Invoke-TbGymDocker run --detach --rm --name $TbGymTestPostgresContainer `
        --publish '127.0.0.1::5432' `
        --env POSTGRES_USER=postgres --env "POSTGRES_PASSWORD=$password" `
        --tmpfs '/var/lib/postgresql:rw,size=4g' `
        $TbGymTestPostgresImage `
        -c fsync=off -c full_page_writes=off -c synchronous_commit=off
    if ($started.ExitCode -ne 0) {
        throw "The throwaway test PostgreSQL did not start: $($started.Output)"
    }

    try {
        # Docker chose a free port on 127.0.0.1; ask which one.
        $published = Invoke-TbGymDocker port $TbGymTestPostgresContainer 5432/tcp
        $port = ($published.Output -split "`n" | Select-Object -First 1).Trim().Split(':')[-1]
        if ($published.ExitCode -ne 0 -or $port -notmatch '^\d+$') {
            throw "The throwaway test PostgreSQL published no port: $($published.Output)"
        }

        # Asked over TCP inside the container: while the image initializes its data directory it
        # runs a temporary server on the Unix socket only, so a socket probe can answer too early.
        $ready = $false
        for ($attempt = 0; $attempt -lt 60 -and -not $ready; $attempt++) {
            Start-Sleep -Seconds 1
            $ready = (Invoke-TbGymDocker exec $TbGymTestPostgresContainer pg_isready --quiet --host 127.0.0.1 --username postgres).ExitCode -eq 0
        }
        if (-not $ready) {
            throw 'The throwaway test PostgreSQL did not accept connections within a minute.'
        }
    }
    catch {
        $null = Invoke-TbGymDocker rm --force $TbGymTestPostgresContainer
        throw
    }

    $previous = @{
        Database = $env:ConnectionStrings__Database
        Admin = $env:TB_GYM_TEST_ADMIN_CONNECTION
    }
    $env:ConnectionStrings__Database = "Host=127.0.0.1;Port=$port;Database=postgres;Username=postgres;Password=$password"
    $env:TB_GYM_TEST_ADMIN_CONNECTION = "$env:ConnectionStrings__Database;Pooling=false"
    Write-Host "Backend tests use a throwaway in-memory PostgreSQL on 127.0.0.1:$port."
    return $previous
}

function Stop-TbGymTestPostgres([hashtable] $Previous) {
    $null = Invoke-TbGymDocker rm --force $TbGymTestPostgresContainer
    if ($null -ne $Previous) {
        $env:ConnectionStrings__Database = $Previous.Database
        $env:TB_GYM_TEST_ADMIN_CONNECTION = $Previous.Admin
    }
}
