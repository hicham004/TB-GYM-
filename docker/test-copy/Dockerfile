# TB Gym's test copy (render.yaml): the screens, the API and the Worker in one container, so the copy
# is one Render service (the free plan has no background workers, and one paid service costs less
# than two). The launch setup is compose.production.yaml (docs/GO-LIVE.md); this builds the same
# sources the same way.

FROM node:24.19.0-alpine AS web
WORKDIR /app

COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci

COPY src/web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /source

COPY . .
RUN dotnet tool restore
# The newest migration's id, so start.sh can skip the bundle when the database already has it.
RUN mkdir --parents /app \
    && grep --recursive --no-filename --only-matching --extended-regexp '\[Migration\("[^"]+"\)\]' \
        src/backend/TB.Gym.Infrastructure/Persistence/Migrations \
    | sed --regexp-extended 's/\[Migration\("([^"]+)"\)\]/\1/' | sort | tail --lines=1 > /app/latest-migration \
    && grep --quiet --extended-regexp '^[0-9]{14}_[A-Za-z0-9_]+$' /app/latest-migration
# Ready-to-run code, so a start on half a CPU (or the free plan's tenth) is not spent compiling.
RUN dotnet publish src/backend/TB.Gym.Api/TB.Gym.Api.csproj \
        --configuration Release --runtime linux-x64 --self-contained false \
        -p:PublishReadyToRun=true --output /app/api \
    && dotnet publish src/backend/TB.Gym.Worker/TB.Gym.Worker.csproj \
        --configuration Release --runtime linux-x64 --self-contained false \
        -p:PublishReadyToRun=true --output /app/worker
# The migration bundle, as docker/migrate/Dockerfile builds it.
RUN ConnectionStrings__Database='Host=unused;Database=unused;Username=unused;Password=unused' \
       ASPNETCORE_ENVIRONMENT=Production DOTNET_ENVIRONMENT=Production \
       dotnet ef migrations bundle \
        --project src/backend/TB.Gym.Infrastructure/TB.Gym.Infrastructure.csproj \
        --startup-project src/backend/TB.Gym.Api/TB.Gym.Api.csproj \
        --context GymDbContext \
        --configuration Release \
        --self-contained \
        --target-runtime linux-x64 \
        --output /app/efbundle

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

# nginx serves the screens and passes /api and /hubs to the API, openssl rebuilds the sign-in key,
# psql asks whether the schema is current, curl waits for the API, and libgssapi-krb5-2 is there as
# in the API's own image.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends nginx openssl postgresql-client curl libgssapi-krb5-2 \
    && rm --recursive --force /var/lib/apt/lists/* \
    && mkdir --parents /home/app/.aspnet/DataProtection-Keys /var/cache/nginx /tmp/nginx \
    && chown --recursive $APP_UID:$APP_UID /home/app/.aspnet /var/cache/nginx /tmp/nginx

COPY --from=web /app/dist/tb-gym-web/browser /usr/share/nginx/html
COPY --from=backend /app/api /app/api
COPY --from=backend /app/worker /app/worker
COPY --from=backend /app/efbundle /app/latest-migration /app/
COPY docker/test-copy/nginx.conf /etc/nginx/tb-gym.conf
COPY docker/test-copy/start.sh /app/start.sh

# The web container's own site (src/web/nginx.conf) with what one container on Render needs: Render's
# port, the API inside this container, the visitor's address read past Render's private proxies,
# HTTPS (Render's edge accepts nothing else), five minutes for an answer (on the free plan's tenth of
# a CPU a cold API takes over one for its first pages), and no search indexing. /health and /openapi stay inside,
# as the production edge keeps them (docker/caddy/Caddyfile). The checks stop the build if
# src/web/nginx.conf has changed under these edits.
COPY src/web/nginx.conf /etc/nginx/tb-gym-site.conf
RUN site=/etc/nginx/tb-gym-site.conf \
    && sed -i \
        -e 's#listen 80;#listen 10000;#' \
        -e 's#proxy_pass http://api:8080;#proxy_pass http://127.0.0.1:8080;#' \
        -e 's#set_real_ip_from 172.30.0.10;#set_real_ip_from 10.0.0.0/8; set_real_ip_from 172.16.0.0/12; set_real_ip_from 192.168.0.0/16; set_real_ip_from 100.64.0.0/10; real_ip_recursive on;#' \
        -e 's#X-Forwarded-Proto $scheme;#X-Forwarded-Proto https;#' \
        -e 's#proxy_read_timeout 60s;#proxy_read_timeout 300s;#' \
        -e 's#^\( *\)add_header X-Content-Type-Options "nosniff" always;#&\n\1add_header X-Robots-Tag "noindex, nofollow" always;#' \
        -e 's#location ~ ^/(api|health|hubs|openapi)(/|\$) {#location ~ ^/(api|hubs)(/|$) {#' \
        "$site" \
    && grep -q 'listen 10000;' "$site" \
    && test "$(grep -c 'proxy_pass http://127.0.0.1:8080;' "$site")" -eq 2 \
    && ! grep -q 'http://api:8080' "$site" \
    && grep -q 'real_ip_recursive on;' "$site" \
    && ! grep -q 'X-Forwarded-Proto \$scheme' "$site" \
    && test "$(grep -c 'proxy_read_timeout 300s;' "$site")" -eq 2 \
    && grep -q 'X-Robots-Tag "noindex, nofollow"' "$site" \
    && grep -qF 'location ~ ^/(api|hubs)(/|$) {' "$site"

USER $APP_UID
RUN nginx -t -c /etc/nginx/tb-gym.conf
EXPOSE 10000
ENTRYPOINT ["bash", "/app/start.sh"]
