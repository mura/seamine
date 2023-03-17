'use strict'

import * as dotenv from 'dotenv'
dotenv.config()
import { Client, TextChannel, Message, GatewayIntentBits, ActivityType, Events } from 'discord.js'
import { Seamine } from './seamine.js'

const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordChannel = process.env.DISCORD_CHANNEL!;
const seamine = new Seamine({
  host: process.env.MINECRAFT_RCON_HOST!,
  port: parseInt(process.env.MINECRAFT_RCON_PORT!, 10),
  password: process.env.MINECRAFT_RCON_PASSWORD!,
  logfile: process.env.MINECRAFT_LOG_FILE!
})

const pong = async (message: Message) => {
  try {
    const res = await seamine.status();
    message.reply(`上がってるよ ${res.version.name}`);
  } catch(err) {
    message.reply('落ちてるよ');
  }
}

const discord = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });
let channel: TextChannel | undefined

discord.once(Events.ClientReady, async () => {
  // console.log(`discord: ready`)
  channel = discord.channels.cache.get(discordChannel) as TextChannel
  discord.user?.setActivity()
  await seamine.start()
});

discord.on(Events.MessageCreate, async (message) => {
  // console.log(`discord: ${message}`)
  if (message.channel.id !== channel?.id) return
  if (message.author.bot || message.author.id === discord.user?.id) return
  if (message.content === 'ping') {
    await pong(message);
  }
});

seamine.on('wakeup', async () => {
  const res = await seamine.version()
  await channel?.send(`サーバー上がったっぽい ${res.serverSoftware} (${res.mcVersion})`);
})

seamine.on('closed', async () => {
  await channel?.send('サーバー止まったぽい');
})

seamine.on('rendered', (world) => {
  if (world) {
    discord.user?.setActivity(`Dynmap: ${world}`, {type: ActivityType.Watching})
  } else {
    discord.user?.setActivity()
  }
})

discord.login(discordBotToken);

// vim: se ts=2 sw=2 sts=2 et: