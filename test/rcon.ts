'use strict'

require('dotenv').config()
import * as seamine from '../src/seamine'

seamine.onWakeup.addListener((serverSoftware, mcVersion) => {
  console.log(`サーバー上がったっぽい ${serverSoftware} (${mcVersion})`)
});

(async () => {
  seamine.setup({
    host: process.env.MINECRAFT_RCON_HOST!,
    port: parseInt(process.env.MINECRAFT_RCON_PORT!, 10),
    password: process.env.MINECRAFT_RCON_PASSWORD!
  })
  await seamine.sendCommand('version')
})();
