FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source

COPY . .
RUN dotnet restore src/backend/TB.Gym.Worker/TB.Gym.Worker.csproj
RUN dotnet publish src/backend/TB.Gym.Worker/TB.Gym.Worker.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish

# Infrastructure transitively requires the Microsoft.AspNetCore.App shared framework. The ASP.NET
# runtime supplies it; using this base does not add a listener, endpoint, or exposed port.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgssapi-krb5-2 \
    && rm --recursive --force /var/lib/apt/lists/*

COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "TB.Gym.Worker.dll"]
