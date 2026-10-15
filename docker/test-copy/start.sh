#!/bin/bash
# The test copy's start (render.yaml, docker/test-copy/Dockerfile). Render's database URL and
# public address become the app's settings, the schema is migrated, then the API, the web server and
# the Worker start. If any of them stops, the container stops and Render starts it again.
#
# Production mode with every launch safety check, minus what needs the go-live steps: no email (no
# domain yet), no photo uploads (no R2 bucket yet), no AI, and no platform invoices, so a workspace
# loaded for testing never turns read-only.
set -euo pipefail

# Render gives postgresql://user:password@host:port/database; Npgsql wants key=value pairs. Render's
# generated passwords are letters and digits, so nothing in the URL needs decoding.
if [[ ! "${DATABASE_URL:?Set DATABASE_URL}" =~ ^postgres(ql)?://([^:/@]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
    echo "DATABASE_URL is not a postgresql://user:password@host/database URL." >&2
    exit 1
fi
export ConnectionStrings__Database="Host=${BASH_REMATCH[4]};Port=${BASH_REMATCH[6]:-5432};Database=${BASH_REMATCH[7]};Username=${BASH_REMATCH[2]};Password=${BASH_REMATCH[3]}"

# The address people open, such as https://tb-gym-test.onrender.com. Every link and the chat's
# origin check use it.
origin="${TB_GYM_PUBLIC_ORIGIN:-${RENDER_EXTERNAL_URL:?Set TB_GYM_PUBLIC_ORIGIN outside Render}}"
export Application__PublicBaseUrl="$origin"
export Application__PublicOriginAllowlist__0="$origin"
export Messaging__Realtime__AllowedOrigins__0="$origin"

# The sign-in key ring, rebuilt from one secret on every start. The service has no disk, and a new
# key at each start would sign everyone out at every deploy, restart or (on the free plan) wake-up. The file is the format
# ASP.NET Core writes itself; the key's id and value both come from the secret.
secret="${TB_GYM_TEST_COPY_KEY:?Set TB_GYM_TEST_COPY_KEY}"
keys=/home/app/.aspnet/DataProtection-Keys
master=$(printf '%s' "$secret" | openssl dgst -sha512 -binary | base64 --wrap=0)
hex=$(printf 'key-id:%s' "$secret" | openssl dgst -sha256 -r | cut -c1-32)
id="${hex:0:8}-${hex:8:4}-${hex:12:4}-${hex:16:4}-${hex:20:12}"
cat > "$keys/key-$id.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<key id="$id" version="1">
  <creationDate>2026-10-01T00:00:00Z</creationDate>
  <activationDate>2026-10-01T00:00:00Z</activationDate>
  <expirationDate>2036-10-01T00:00:00Z</expirationDate>
  <descriptor deserializerType="Microsoft.AspNetCore.DataProtection.AuthenticatedEncryption.ConfigurationModel.AuthenticatedEncryptorDescriptorDeserializer, Microsoft.AspNetCore.DataProtection, Version=10.0.0.0, Culture=neutral, PublicKeyToken=adb9793829ddae60">
    <descriptor>
      <encryption algorithm="AES_256_CBC" />
      <validation algorithm="HMACSHA256" />
      <masterKey p4:requiresEncryption="true" xmlns:p4="http://schemas.asp.net/2015/03/dataProtection">
        <value>$master</value>
      </masterKey>
    </descriptor>
  </descriptor>
</key>
XML
unset secret master
export DataProtection__KeyPath="$keys"

export ASPNETCORE_ENVIRONMENT=Production DOTNET_ENVIRONMENT=Production
export Database__ApplyMigrationsOnStartup=false Seed__Enabled=false
export Notifications__Email__Enabled=false Notifications__Email__Adapter=None
export Media__StorageAdapter=None Media__ScannerAdapter=None
export Nutrition__Anthropic__Enabled=false
# Optional: a free USDA FoodData Central key (api.data.gov), added in Render's dashboard, turns food search on.
export Nutrition__UsdaFoodDataCentral__ApiKey="${TB_GYM_USDA_API_KEY:-}"
export PlatformBilling__SweepEnabled=false
export Messaging__Realtime__ScaleOut=SingleProcess Messaging__Realtime__ApiReplicaCount=1
# nginx in this container is the API's only caller, and it passes on the visitor's address.
export ReverseProxy__Enabled=true ReverseProxy__TrustedProxies__0=127.0.0.1

# The bundle is slow to start on a small CPU (over a minute on the free plan's tenth), so a start that
# finds the newest migration already applied (every start after a deploy's first) skips it.
latest=$(cat /app/latest-migration)
applied=$(psql "$DATABASE_URL" --no-psqlrc --no-password --tuples-only --no-align --command \
    "SELECT 1 FROM platform.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = '$latest'" 2>/dev/null || true)
if [ "$applied" = 1 ]; then
    echo "The database already has migration $latest."
else
    /app/efbundle
fi

# The API listens only inside the container; Render reaches it through nginx on port 10000.
unset ASPNETCORE_HTTP_PORTS
ASPNETCORE_URLS=http://127.0.0.1:8080 dotnet /app/api/TB.Gym.Api.dll &
api=$!
trap 'kill -TERM $(jobs -p) 2>/dev/null; wait; exit 0' TERM INT

# nginx opens Render's port only once the API is ready and has reached the database, so a waking
# visitor waits on Render's loading screen rather than meeting errors. The Worker starts last and at
# the lowest priority: its sweeps can wait, and a visitor's first pages cannot.
until curl --silent --fail --output /dev/null http://127.0.0.1:8080/health/ready; do
    if ! kill -0 "$api" 2>/dev/null; then
        echo "The API stopped before it was ready." >&2
        exit 1
    fi
    sleep 1
done
mkdir --parents /tmp/nginx
nginx -c /etc/nginx/tb-gym.conf -g 'daemon off;' &
nice -n 19 dotnet /app/worker/TB.Gym.Worker.dll &

wait -n || :
echo "A process stopped; stopping the container so Render starts it again." >&2
exit 1
