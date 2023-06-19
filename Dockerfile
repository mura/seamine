FROM node:18-bookworm-slim as build

WORKDIR /app
COPY . /app

RUN npm ci && npm run build

FROM node:18-bookworm-slim

WORKDIR /app
COPY package*.json ./
COPY --from=build /app/lib ./lib

RUN npm ci --only=production

ENV MINECRAFT_LOG_FILE=/app/logs/latest.log
ENV MINECRAFT_RCON_HOST=
ENV MINECRAFT_RCON_PORT=25575
ENV MINECRAFT_RCON_PASSWORD=
ENV DISCORD_BOT_TOKEN=
ENV DISCORD_CHANNEL=

CMD [ "node", "lib/bot.js" ]
