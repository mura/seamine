require('dotenv').config();
const Tail = require('tail').Tail;
const util = require('minecraft-server-util');
const Discord = require('discord.js')

const tail = new Tail(process.env.MINECRAFT_LOG_FILE);
const rcon = new util.RCON(process.env.MINECRAFT_RCON_HOST, {
  port: parseInt(process.env.MINECRAFT_RCON_PORT, 10),
  password: process.env.MINECRAFT_RCON_PASSWORD
});
const discord = new Discord.Client()

const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;
const doneRegex = /^Done\s\(.*s\)!\sFor\shelp,\stype\s"help"$/;
const stoppingRegex = /^Stopping\sserver$/;
const versionRegex = /^This server is running\s(Paper\sversion\s.*)\s\(MC: (.*?)\)/;

const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordChannel = process.env.DISCORD_CHANNEL;

let channel;

const tail_log = async (time, causedAt, level, message) => {
  if (level == 'INFO' && stoppingRegex.test(message)) {
    //console.log(message);
    channel.send('サーバー止まったぽい');
  }
  if (level == 'INFO' && doneRegex.test(message)) {
    //console.log(message);
    await rcon.connect()
      .then(() => {
        rcon.run('version');
      })
      .catch((error) => {
        throw error;
      });
  }
}

const pong = async (message) => {
  try {
    const res = await util.status(process.env.MINECRAFT_RCON_HOST);
    await message.reply(`上がってるよ ${res.version}`);
  } catch(err) {
    await message.reply('落ちてるよ');
  }
}

discord.on('ready', () => {
  channel = discord.channels.cache.get(discordChannel)
});

discord.on('message', async (message) => {
  if (message.channel.id !== channel.id) return
  if (message.author.bot || message.author.id === discord.user.id) return
  if (message.content == 'ping') {
    await pong(message);
  }
});

tail.on('line', async (line) => {
  const [log, time, causedAt, level, message] = regexpLog.exec(line);
  await tail_log(time, causedAt, level, message);
});

rcon.on('output', (message) => {
  //console.log(message)
  const [msg, serverSoftware, mcVersion] = versionRegex.exec(message);
  if (serverSoftware && mcVersion) {
    channel.send(`サーバー上がったっぽい ${serverSoftware} (${mcVersion})`);
  }
});

discord.login(discordBotToken);
// vim: se ts=2 sw=2 sts=2 et:
