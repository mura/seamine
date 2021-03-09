FROM node:14-buster-slim

WORKDIR /app

COPY package*.json ./
COPY index.js ./

RUN npm ci --only=production

ENV MINECRAFT_LOG_FILE=/app/logs/latest.log
ENV MINECRAFT_RCON_HOST=
ENV MINECRAFT_RCON_PORT=25575
ENV MINECRAFT_RCON_PASSWORD=
ENV DISCORD_BOT_TOKEN=
ENV DISCORD_CHANNEL=

CMD [ "node", "index.js" ]
