FROM node:24.19.0-alpine AS build
WORKDIR /app

COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci

COPY src/web/ ./
RUN npm run build

FROM nginx:1.30.4-alpine AS runtime
COPY src/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/tb-gym-web/browser /usr/share/nginx/html
EXPOSE 80

