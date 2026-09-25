# The production migration step: one EF Core migration bundle, run once per deployment before the API
# and the Worker start (compose.production.yaml), never by the API itself. Same command as
# scripts/build-migration-bundle.ps1. Building opens no connection, so the placeholder connection string
# is only there because the design-time factory insists on one; the real one arrives as
# ConnectionStrings__Database when the container runs.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /source

COPY . .
RUN dotnet tool restore
RUN case "$TARGETARCH" in arm64) rid=linux-arm64 ;; *) rid=linux-x64 ;; esac \
    && dotnet restore src/backend/TB.Gym.Api/TB.Gym.Api.csproj --runtime "$rid" \
    && ConnectionStrings__Database='Host=unused;Database=unused;Username=unused;Password=unused' \
       ASPNETCORE_ENVIRONMENT=Production DOTNET_ENVIRONMENT=Production \
       dotnet ef migrations bundle \
        --project src/backend/TB.Gym.Infrastructure/TB.Gym.Infrastructure.csproj \
        --startup-project src/backend/TB.Gym.Api/TB.Gym.Api.csproj \
        --context GymDbContext \
        --configuration Release \
        --self-contained \
        --target-runtime "$rid" \
        --output /app/efbundle

FROM mcr.microsoft.com/dotnet/runtime-deps:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/efbundle .
USER $APP_UID
ENTRYPOINT ["./efbundle"]
