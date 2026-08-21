FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source

COPY . .
RUN dotnet restore src/backend/TB.Gym.Api/TB.Gym.Api.csproj
RUN dotnet publish src/backend/TB.Gym.Api/TB.Gym.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgssapi-krb5-2 \
    && rm --recursive --force /var/lib/apt/lists/* \
    && mkdir --parents /home/app/.aspnet/DataProtection-Keys /home/app/media \
    && chown --recursive $APP_UID:$APP_UID /home/app/.aspnet /home/app/media

COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "TB.Gym.Api.dll"]
