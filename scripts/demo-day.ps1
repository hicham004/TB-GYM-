param(
    [string] $Database = 'tbgym_demo',
    [int] $ApiPort = 5134,
    [int] $WebPort = 4200,
    [switch] $KeepDemo,
    [string] $Configuration = 'Release',
    [string] $HeroName
)

# Demo day (docs/MOTION-PLAN-2026-11.md, W2): one command that runs the app on this laptop for a phone
# in the same room. It starts Docker's PostgreSQL, drops and rebuilds the Atlas Performance demo into
# tbgym_demo (never tbgym, which holds your own accounts), starts the API, makes a certificate for the
# laptop's own addresses once, lets the toolchain's node.exe through the firewall once (a UAC prompt),
# starts the web app over HTTPS on every address of the laptop, and prints the address, the sign-ins
# and a QR code for the phone. Ctrl+C stops what it started.
#
#   .\scripts\demo-day.ps1                                  # rebuild the demo, then serve https://<ip>:4200
#   .\scripts\demo-day.ps1 -KeepDemo                        # serve the demo as it is, no rebuild
#   .\scripts\demo-day.ps1 -HeroName Rami                   # the hero client (Maya) carries this first name
#   .\scripts\demo-day.ps1 -Database tbgym_w2 -ApiPort 5320 -WebPort 4320   # a copy of your own, beside the owner's
#
# The phone shows a certificate warning once, because the certificate is this laptop's own and nobody
# else signs it: Advanced, then Proceed. Run the script again after the last row lands and after 09:00
# on the day, since the demo's data ages (section 1 of the plan).
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')

if ($Database -eq 'tbgym') {
    throw 'tbgym holds your own accounts and is never rebuilt; the demo lives in tbgym_demo, or give -Database a name of your own.'
}
if ($HeroName -and $HeroName -notmatch '^[\p{L}][\p{L}\p{M}'' .-]{0,39}$') {
    throw '-HeroName is a first name: letters, with spaces, apostrophes or hyphens, 40 characters at most.'
}

# Toolchain.ps1 builds the connection string from POSTGRES_DB when none is set, so the database is
# chosen here, before it runs, and the API, the demo command and the rebuild all see the same one.
$env:POSTGRES_DB = $Database
$env:ConnectionStrings__Database = $null
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot
if (-not $env:POSTGRES_USER) { $env:POSTGRES_USER = 'tbgym' }
$env:ASPNETCORE_ENVIRONMENT = 'Development'

$webRoot = Join-Path $repositoryRoot 'src\web'
$apiProject = Join-Path $repositoryRoot 'src\backend\TB.Gym.Api'
$apiDll = Join-Path $apiProject "bin\$Configuration\net10.0\TB.Gym.Api.dll"
$node = Join-Path $repositoryRoot '.tools\node\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node).Source }
$demoFolder = Join-Path $repositoryRoot 'artifacts\demo-day'
New-Item -ItemType Directory -Force $demoFolder | Out-Null

# Windows PowerShell 5.1 turns a native command's stderr lines (a dropdb notice, Docker's progress)
# into red error records; they are printed as the plain text they are, and the exit code decides.
function Invoke-TbGymNative {
    param(
        [Parameter(Mandatory = $true)][string] $Step,
        [Parameter(Mandatory = $true)][string] $Command,
        [string[]] $Arguments = @()
    )
    $ErrorActionPreference = 'Continue'
    try {
        & $Command @Arguments 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_ }
        }
    }
    finally {
        $ErrorActionPreference = 'Stop'
    }
    Assert-TbGymCommandSucceeded $Step
}

function Wait-TbGymPort {
    param([int] $Port, [System.Diagnostics.Process] $Process, [string] $Name, [int] $Seconds = 180)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw "$Name stopped before it answered (exit code $($Process.ExitCode)); its output is above." }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect('127.0.0.1', $Port)
            if ($client.Connected) { return }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
        finally {
            $client.Dispose()
        }
    }
    throw "$Name did not answer on port $Port within $Seconds seconds."
}

foreach ($port in @($ApiPort, $WebPort)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is in use. Stop the API or web app holding it (a run-api.ps1, run-web.ps1 or demo-day window), or pass -ApiPort and -WebPort."
    }
}

# The laptop's addresses, the connected network's first: the certificate names them all and the
# printout leads with the one the phone reaches.
$connected = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4Connectivity -in 'Internet', 'LocalNetwork' } |
    Select-Object -ExpandProperty InterfaceIndex)
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object @{ Expression = { if ($connected -contains $_.InterfaceIndex) { 0 } else { 1 } } }, InterfaceIndex |
    Select-Object -ExpandProperty IPAddress -Unique)
if ($addresses.Count -eq 0) {
    Write-Warning 'This laptop has no network address, so a phone cannot reach it: join a Wi-Fi or turn on Mobile hotspot and run again. Serving on localhost only.'
}
$primary = if ($addresses.Count -gt 0) { $addresses[0] } else { 'localhost' }
$origin = "https://${primary}:$WebPort"

Write-Host 'Starting PostgreSQL (Docker)...'
Push-Location $repositoryRoot
try {
    Invoke-TbGymNative 'Docker PostgreSQL' 'docker' @('compose', 'up', '--detach', '--wait', 'postgres')

    Write-Host "Building the API ($Configuration)..."
    Invoke-TbGymNative 'API build' 'dotnet' @('build', (Join-Path $apiProject 'TB.Gym.Api.csproj'), '-c', $Configuration, '--nologo', '-v', 'quiet')

    if (-not $KeepDemo) {
        Write-Host "Dropping $Database and rebuilding the demo (about 5 minutes)..."
        Invoke-TbGymNative 'Drop the demo database' 'docker' @('compose', 'exec', '-T', 'postgres', 'dropdb', '-U', $env:POSTGRES_USER, '--force', '--if-exists', $Database)
        Push-Location $apiProject
        try {
            Invoke-TbGymNative 'Demo workspace' 'dotnet' @($apiDll, 'demo-workspace')
        }
        finally {
            Pop-Location
        }
    }

    if ($HeroName) {
        # The hero client's first name, in this demo database only (no endpoint edits a client's name,
        # and the sign-in stays maya.fakhoury@mail.example): her profile, which the coach's screens read,
        # and her account's display name, which her own greeting reads. Messages that greet her by name
        # keep hers. Piped to psql's stdin as UTF-8: Windows PowerShell 5.1 strips the quoted identifiers
        # from a -c argument and writes a piped accented letter as '?' under its default ASCII encoding.
        $escaped = $HeroName.Replace("'", "''")
        $sql = "UPDATE clients.""ClientProfiles"" SET ""FirstName"" = '$escaped' WHERE ""FirstName"" = 'Maya' AND ""LastName"" = 'Fakhoury';`n" +
            "UPDATE identity.""Users"" SET ""DisplayName"" = regexp_replace(""DisplayName"", '^Maya', '$escaped') WHERE ""NormalizedEmail"" = 'MAYA.FAKHOURY@MAIL.EXAMPLE';"
        $previousOutputEncoding = $OutputEncoding
        $OutputEncoding = [Text.UTF8Encoding]::new($false)
        $ErrorActionPreference = 'Continue'
        try {
            $sql | & docker compose exec -T postgres psql -U $env:POSTGRES_USER -d $Database -v ON_ERROR_STOP=1
        }
        finally {
            $ErrorActionPreference = 'Stop'
            $OutputEncoding = $previousOutputEncoding
        }
        Assert-TbGymCommandSucceeded 'Hero name'
    }
}
finally {
    Pop-Location
}

# The certificate, made once for these addresses and again when they change (a new Wi-Fi, a hotspot).
$certificate = Join-Path $demoFolder 'demo-day.crt'
$key = Join-Path $demoFolder 'demo-day.key'
$namesFile = Join-Path $demoFolder 'demo-day.names'
$names = (@('DNS:localhost', 'IP:127.0.0.1') + @($addresses | ForEach-Object { "IP:$_" })) -join ','
$current = (Test-Path $certificate) -and (Test-Path $key) -and (Test-Path $namesFile) -and
    ([IO.File]::ReadAllText($namesFile).Trim() -eq $names)
if (-not $current) {
    # Git's openssl, with Git's own configuration: this laptop's OPENSSL_CONF names a PostgreSQL ODBC
    # file that does not exist, and openssl refuses to run with a missing configuration.
    $openssl = $null
    $git = Get-Command git -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($git) {
        $gitRoot = Split-Path -Parent (Split-Path -Parent $git)
        $openssl = Join-Path $gitRoot 'usr\bin\openssl.exe'
        $opensslConfiguration = Join-Path $gitRoot 'usr\ssl\openssl.cnf'
        if ((Test-Path $openssl) -and (Test-Path $opensslConfiguration)) { $env:OPENSSL_CONF = $opensslConfiguration }
    }
    if (-not $openssl -or -not (Test-Path $openssl)) {
        $openssl = Get-Command openssl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    }
    if (-not $openssl) {
        throw 'openssl was not found; Git for Windows carries one at C:\Program Files\Git\usr\bin\openssl.exe.'
    }
    Write-Host "Making the certificate for $names..."
    Invoke-TbGymNative 'Certificate' $openssl @('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '397',
        '-subj', '/CN=TB Gym demo day', '-addext', "subjectAltName=$names", '-addext', 'basicConstraints=CA:FALSE',
        '-addext', 'extendedKeyUsage=serverAuth', '-keyout', $key, '-out', $certificate)
    [IO.File]::WriteAllText($namesFile, $names + "`n", [Text.UTF8Encoding]::new($false))
}

# The firewall: the Wi-Fi is usually a Public network, where Windows drops inbound connections, so
# node.exe (the dev server) needs an inbound rule on the Private and Public profiles, added once.
$allowed = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
    Where-Object { $_.Program -and $_.Program -ieq $node } |
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' -and
        ("$($_.Profile)" -eq 'Any' -or ("$($_.Profile)" -match 'Public' -and "$($_.Profile)" -match 'Private'))
    })
if ($allowed.Count -eq 0) {
    Write-Host 'Windows asks once (a UAC prompt) to let node.exe accept the phone''s connections on Private and Public networks.'
    $rule = "New-NetFirewallRule -DisplayName 'TB Gym demo day (node.exe)' -Direction Inbound -Action Allow -Program '$node' -Profile Private,Public | Out-Null"
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$rule`""
    }
    catch {
        Write-Warning "The firewall rule was not added ($($_.Exception.Message)), so the phone may not reach this laptop; the app still runs here."
    }
}

# The proxy to the API, the committed one unless the API port differs.
$proxy = Join-Path $webRoot 'proxy.conf.json'
if ($ApiPort -ne 5134) {
    $proxy = Join-Path $demoFolder "proxy-$ApiPort.json"
    [IO.File]::WriteAllText($proxy,
        [IO.File]::ReadAllText((Join-Path $webRoot 'proxy.conf.json')).Replace('localhost:5134', "localhost:$ApiPort"),
        [Text.UTF8Encoding]::new($false))
}

$api = $null
$web = $null
try {
    Write-Host "Starting the API on http://localhost:$ApiPort..."
    $env:ASPNETCORE_URLS = "http://localhost:$ApiPort"
    $env:Application__PublicBaseUrl = $origin
    $api = Start-Process -FilePath 'dotnet' -ArgumentList "`"$apiDll`"" -WorkingDirectory $apiProject -NoNewWindow -PassThru
    Wait-TbGymPort -Port $ApiPort -Process $api -Name 'The API' -Seconds 120

    Write-Host "Starting the web app on $origin..."
    $ng = Join-Path $webRoot 'node_modules\@angular\cli\bin\ng.js'
    $serve = "`"$ng`" serve --host 0.0.0.0 --port $WebPort --ssl --ssl-cert `"$certificate`" --ssl-key `"$key`" --proxy-config `"$proxy`""
    $web = Start-Process -FilePath $node -ArgumentList $serve -WorkingDirectory $webRoot -NoNewWindow -PassThru
    Wait-TbGymPort -Port $WebPort -Process $web -Name 'The web app' -Seconds 240

    $qr = @()
    try {
        $ErrorActionPreference = 'Continue'
        $qr = @(& $node (Join-Path $PSScriptRoot 'demo-day-qr.mjs') $origin 2>$null)
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0) { $qr = @() }
    }
    catch {
        $qr = @()
    }

    Write-Host ''
    Write-Host '  TB Gym demo day is ready.'
    Write-Host ''
    Write-Host "  On the phone (same Wi-Fi):    $origin"
    if ($addresses.Count -gt 1) {
        Write-Host "  Other addresses:              $(($addresses | Select-Object -Skip 1 | ForEach-Object { "https://${_}:$WebPort" }) -join '  ')"
    }
    Write-Host "  On this laptop:               https://localhost:$WebPort"
    $hero = if ($HeroName) { $HeroName } else { 'Maya' }
    Write-Host "  The client, $hero (phone):     maya.fakhoury@mail.example    AtlasDemo-2026!"
    Write-Host '  The coach, Lea (laptop):      lea@atlas.example             AtlasDemo-2026!'
    Write-Host ''
    Write-Host '  The phone shows a certificate warning once, because the certificate is this laptop''s own:'
    Write-Host "  tap Advanced, then Proceed to $primary. Sign in as $hero and keep the tab open."
    if ($qr.Count -gt 0) {
        Write-Host ''
        # Two rows of modules per line in block characters, built here so this file stays ASCII: a
        # light module is bright and a dark one is the console's background, right on a dark console.
        $upper = [string][char]0x2580
        $lower = [string][char]0x2584
        $full = [string][char]0x2588
        for ($i = 0; $i -lt $qr.Count; $i += 2) {
            $top = $qr[$i]
            $bottom = if ($i + 1 -lt $qr.Count) { $qr[$i + 1] } else { ' ' * $top.Length }
            $line = ''
            for ($j = 0; $j -lt $top.Length; $j++) {
                $topDark = $top[$j] -eq '#'
                $bottomDark = $bottom[$j] -eq '#'
                $line += if ($topDark -and $bottomDark) { ' ' } elseif ($topDark) { $lower } elseif ($bottomDark) { $upper } else { $full }
            }
            Write-Host "  $line"
        }
    }
    Write-Host ''
    Write-Host '  Ctrl+C stops the API and the web app.'
    Write-Host ''

    Wait-Process -Id $api.Id, $web.Id
}
finally {
    foreach ($process in @($web, $api)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
