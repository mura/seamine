'use strict'

require('dotenv').config();
import { status } from 'minecraft-server-util'
import { Client, TextChannel, Message } from 'discord.js'
import * as seamine from './seamine'

const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordChannel = process.env.DISCORD_CHANNEL!;

const pong = async (message: Message) => {
  try {
    const res = await status(process.env.MINECRAFT_RCON_HOST!);
    message.reply(`上がってるよ ${res.version}`);
  } catch(err) {
    message.reply('落ちてるよ');
  }
}

const discord = new Client();
let channel: TextChannel | undefined

discord.on('ready', () => {
  channel = discord.channels.cache.get(discordChannel) as TextChannel
});

discord.on('message', async (message) => {
  if (message.channel.id !== channel?.id) return
  if (message.author.bot || message.author.id === discord.user?.id) return
  if (message.content === 'ping') {
    await pong(message);
  }
});

seamine.onWakeup.addListener(async (serverSoftware, mcVersion) => {
  await channel?.send(`サーバー上がったっぽい ${serverSoftware} (${mcVersion})`);
})

seamine.onClosed.addListener(async () => {
  await channel?.send('サーバー止まったぽい');
})

seamine.setup({
  host: process.env.MINECRAFT_RCON_HOST!,
  port: parseInt(process.env.MINECRAFT_RCON_PORT!, 10),
  password: process.env.MINECRAFT_RCON_PASSWORD!
})
discord.login(discordBotToken);
seamine.start(process.env.MINECRAFT_LOG_FILE!)
// vim: se ts=2 sw=2 sts=2 et: