param(
    [string] $DatabaseUrl = $env:TB_GYM_TEST_DATABASE_URL,
    [string] $Password
)

# Loads the Atlas Performance demo into the test copy on Render (render.yaml, docs/GO-LIVE.md
# "Before launch: a test copy on Render"), replacing everything the copy held. Needs Docker.
#
#   .\scripts\test-copy-demo.ps1 -DatabaseUrl 'postgresql://tbgym:...@dpg-...-a.frankfurt-postgres.render.com/tbgym'
#
# The URL is the database's External Database URL (Render > tb-gym-test-db > Connect > External).
# Every demo account gets the same new password, printed at the end, unless -Password gives one
# (12 characters or more, with a capital letter, a digit and a symbol).
#
# The demo is built on this computer in a throwaway PostgreSQL 18 container, because building it
# over the internet would take hours, and that container then copies it across and is removed. It is
# built from main as GitHub has it, the code the copy runs, not from this working tree, which may
# hold unfinished work; and nothing is copied unless both have exactly the same migrations.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
. (Join-Path $PSScriptRoot 'TestPostgres.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

function Invoke-TbGymGit {
    # Windows PowerShell 5.1 turns a native command's stderr into an error record; the exit code decides.
    $ErrorActionPreference = 'Continue'
    $output = & git -C $repositoryRoot @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($args[0]) failed: $(($output | Out-String).Trim())"
    }
}

if (-not $DatabaseUrl) {
    throw 'Give -DatabaseUrl: the External Database URL of tb-gym-test-db in Render.'
}
$target = [Uri] $DatabaseUrl
if ($target.Scheme -notin @('postgres', 'postgresql') -or $target.IsLoopback -or $target.Host -eq 'host.docker.internal') {
    throw 'The URL must be the test copy database on Render, never a database on this computer.'
}
if (-not $Password) {
    do { $Password = 'Atlas-' + [guid]::NewGuid().ToString('N').Substring(0, 8) } until ($Password -match '\d')
}

$container = 'tbgym-test-copy-seed'
$null = Invoke-TbGymDocker rm --force $container
$seedPassword = [guid]::NewGuid().ToString('N')
$started = Invoke-TbGymDocker run --detach --rm --name $container --publish '127.0.0.1::5432' `
    --env POSTGRES_USER=tbgym --env "POSTGRES_PASSWORD=$seedPassword" --env POSTGRES_DB=tbgym `
    $TbGymTestPostgresImage
if ($started.ExitCode -ne 0) {
    throw "The throwaway PostgreSQL did not start: $($started.Output)"
}

$source = Join-Path ([IO.Path]::GetTempPath()) ('tbgym-test-copy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$previousDatabase = $env:ConnectionStrings__Database
try {
    $published = Invoke-TbGymDocker port $container 5432/tcp
    $port = ($published.Output -split "`n" | Select-Object -First 1).Trim().Split(':')[-1]
    $ready = $false
    for ($attempt = 0; $attempt -lt 60 -and -not $ready; $attempt++) {
        Start-Sleep -Seconds 1
        $ready = (Invoke-TbGymDocker exec $container pg_isready --quiet --host 127.0.0.1 --username tbgym).ExitCode -eq 0
    }
    if (-not $ready) {
        throw 'The throwaway PostgreSQL did not accept connections within a minute.'
    }

    # A file, because Windows PowerShell 5.1 mangles the double quotes this query needs on a command line.
    $query = Join-Path ([IO.Path]::GetTempPath()) 'tbgym-test-copy-migrations.sql'
    [IO.File]::WriteAllText($query, 'SELECT "MigrationId" FROM platform."__EFMigrationsHistory" ORDER BY 1;', [Text.UTF8Encoding]::new($false))
    $null = Invoke-TbGymDocker cp $query "${container}:/tmp/migrations.sql"
    $copyMigrations = Invoke-TbGymDocker exec $container psql $DatabaseUrl --tuples-only --no-align --file /tmp/migrations.sql
    if ($copyMigrations.ExitCode -ne 0) {
        throw "The test copy cannot be read. Check the URL, and wait until its first deploy is live (that creates its tables): $($copyMigrations.Output)"
    }

    Write-Host 'Building the demo from main on GitHub...'
    Invoke-TbGymGit fetch --quiet origin main
    Invoke-TbGymGit worktree add --detach --quiet $source origin/main
    $env:ConnectionStrings__Database = "Host=127.0.0.1;Port=$port;Database=tbgym;Username=tbgym;Password=$seedPassword"
    & dotnet run --disable-build-servers --configuration Release --project (Join-Path $source 'src\backend\TB.Gym.Api\TB.Gym.Api.csproj') `
        --launch-profile http -- demo-workspace --password $Password
    Assert-TbGymCommandSucceeded 'Demo workspace'

    $seedMigrations = Invoke-TbGymDocker exec $container psql --username tbgym --dbname tbgym --tuples-only --no-align --file /tmp/migrations.sql
    if ($seedMigrations.ExitCode -ne 0 -or $seedMigrations.Output -ne $copyMigrations.Output) {
        throw 'The test copy runs a different version from main on GitHub, so nothing was copied. In Render, Manual Deploy > Deploy latest commit, wait until it is live, then run this again.'
    }

    $dump = Invoke-TbGymDocker exec $container pg_dump --username tbgym --format custom --file /tmp/demo.dump tbgym
    if ($dump.ExitCode -ne 0) {
        throw "Copying the demo out failed: $($dump.Output)"
    }

    # --clean replaces the copy's tables, including the empty ones its own start migrated, and one
    # transaction means a failure leaves the copy as it was.
    Write-Host 'Replacing the test copy''s data with the demo...'
    $restore = Invoke-TbGymDocker exec $container pg_restore --clean --if-exists --no-owner --no-privileges `
        --single-transaction --dbname $DatabaseUrl /tmp/demo.dump
    if ($restore.ExitCode -ne 0) {
        throw "Loading the demo into the test copy failed: $($restore.Output)"
    }
}
finally {
    $env:ConnectionStrings__Database = $previousDatabase
    $null = Invoke-TbGymDocker rm --force $container
    if (Test-Path $source) {
        try { Invoke-TbGymGit worktree remove --force $source }
        catch { Write-Warning "Could not remove the temporary checkout $source; delete it and run git worktree prune." }
    }
}

Write-Host ''
Write-Host "The demo is in the test copy. Every account's password: $Password"
Write-Host '  karim@atlas.example          the gym owner, who also coaches (best on a computer)'
Write-Host '  lea@atlas.example            a coach, Maya''s'
Write-Host '  omar@atlas.example           a coach'
Write-Host '  maya.fakhoury@mail.example   a client (best on a phone)'
