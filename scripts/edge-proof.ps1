param(
    [string] $Url,
    [switch] $Build
)

# Proves what the edge sends with each kind of answer (audit WEB-4, WEB-14, WEB-15, UIQ-7): the
# cache rule, the security headers, the CSP and the fonts each document asks for. It runs the
# Playwright checks in src/web/e2e/edge (playwright.edge.config.ts) against a real nginx.
#
#   .\scripts\edge-proof.ps1 -Build
#   .\scripts\edge-proof.ps1 -Url https://tb-gym-test.onrender.com
#
# Without -Url it needs Docker: it starts nginx:1.30.4-alpine, the web image's base
# (src/web/Dockerfile), with src/web/nginx.conf and the production build in src/web/dist on a free
# local port, and removes it afterwards; -Build runs `npm run build` first, which a change to the web
# sources needs. With -Url it checks that site instead, such as the test copy after a deploy. No API
# is needed either way: only documents and files are asked for.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Toolchain.ps1')
. (Join-Path $PSScriptRoot 'TestPostgres.ps1')
Initialize-TbGymToolchains -RepositoryRoot $repositoryRoot

$web = Join-Path $repositoryRoot 'src\web'
$container = $null
Push-Location $web
try {
    if (-not $Url) {
        if ($Build) {
            npm run build
            Assert-TbGymCommandSucceeded 'npm run build'
        }

        $site = Join-Path $web 'dist\tb-gym-web\browser'
        if (-not (Test-Path (Join-Path $site 'index.csr.html'))) {
            throw "There is no production build in $site. Run this with -Build."
        }

        # The configuration's upstream is the API container, `api`; here nothing answers there.
        $container = 'tbgym-edge-proof-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
        $started = Invoke-TbGymDocker run --detach --rm --name $container `
            --add-host 'api:127.0.0.1' --publish '127.0.0.1::80' `
            --mount "type=bind,source=$(Join-Path $web 'nginx.conf'),target=/etc/nginx/conf.d/default.conf,readonly" `
            --mount "type=bind,source=$site,target=/usr/share/nginx/html,readonly" `
            'nginx:1.30.4-alpine'
        if ($started.ExitCode -ne 0) {
            throw "nginx did not start: $($started.Output)"
        }

        # Docker chose a free port on 127.0.0.1; ask which one, then wait until nginx answers on it.
        $published = Invoke-TbGymDocker port $container 80/tcp
        $port = ($published.Output -split "`n" | Select-Object -First 1).Trim().Split(':')[-1]
        $Url = "http://127.0.0.1:$port"
        $ready = $false
        for ($attempt = 0; $attempt -lt 40 -and -not $ready; $attempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $null = Invoke-WebRequest -UseBasicParsing -Uri "$Url/favicon.ico" -TimeoutSec 2
                $ready = $true
            }
            catch {
                $ready = $false
            }
        }
        if (-not $ready) {
            throw "nginx did not answer at ${Url}: $((Invoke-TbGymDocker logs $container).Output)"
        }
    }

    $env:TB_GYM_EDGE_URL = $Url.TrimEnd('/')
    Write-Host "Checking the edge at $env:TB_GYM_EDGE_URL"
    npx playwright test --config playwright.edge.config.ts
    Assert-TbGymCommandSucceeded 'The edge checks'
}
finally {
    if ($null -ne $container) {
        $null = Invoke-TbGymDocker rm --force $container
    }
    Pop-Location
}
