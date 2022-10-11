'use strict'

import { Tail } from 'tail'
import * as util from 'minecraft-server-util'
import RCON from 'minecraft-server-util/dist/structure/RCON';
import { EventEmitter } from 'events'

type RconOptions = {
  host: string,
  port: number,
  password: string,
};

type LogCase = {
  level?: string,
  regex: RegExp,
  callback: (exec: RegExpExecArray) => void
};

type WakeupCallback = (serverSoftware: string, mcVersion: string) => void;
type CloseCallback = () => void;
type RenderedCallback = (world: string | undefined) => void;

const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;

let rcon: RCON | undefined;
let tail: Tail;

let rendering: string | undefined = undefined

const emitter = new EventEmitter()

const logCases: LogCase[] = [
  {
    level: 'INFO',
    regex: /^(Closing|Stopping)\sServer$/i,
    callback: (exec) => {
      emitter.emit('close')
    }
  },
  {
    level: 'INFO',
    regex: /^Done\s\(.*s\)!\sFor\shelp,\stype\s"help"$/,
    callback: async (exec) => {
      try {
        await sendCommand('version');
      } catch(err) {
        console.error(err);
      }
    }
  }
];

const rconCases: LogCase[] = [
  {
    regex: /Checking version, please wait\.\.\./,
    callback: async (exec) => {
      await wait(1000);
      await rcon?.run('version');
    }
  },
  {
    regex: /This server is running\s(.*\sversion\s.*)\s\(MC: (.*?)\)/,
    callback: async (exec) => {
      const [msg, serverSoftware, mcVersion] = exec
      if (serverSoftware && mcVersion) {
        emitter.emit('wakeup', serverSoftware, mcVersion);
        await rcon?.close();
      }
    }
  },
  {
    regex: /Tile Render Statistics:[\s\S]*?Active render jobs: (.*)[\s\S]/m,
    callback: async (exec) => {
      const [msg, world] = exec
      if (world !== rendering) {
        emitter.emit('rendered', world)
        rendering = world
      }
      setTimeout(async () => { await rcon?.run('dynmap stats') }, 30_000)
    }
  }
];

const wait = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const handleLogMessage = async (line: string) => {
  const [log, time, causedAt, level, message] = regexpLog.exec(line) || [];
  
  logCases.forEach(c => {
    if (level !== c.level) {
      return
    }
    const exec = c.regex.exec(message)
    exec && c.callback(exec)
  })
}

const handleRconMessage = async (message: string) => {
  // console.log(message)
  rconCases.forEach(c => {
    const exec = c.regex.exec(message)
    exec && c.callback(exec)
  })
}

const sendCommand = async (command: string): Promise<void> => {
  try {
    await rcon?.run(command);
  } catch (err) {
    await rcon?.connect();
    await rcon?.run(command);
  }
}

const setup = (rconOptions: RconOptions): void => {
  rcon = new util.RCON(rconOptions.host, {
    port: rconOptions.port,
    password: rconOptions.password
  });
  rcon.on('output', async (message: string) => {
    await handleRconMessage(message)
  });
}

const start = (logfile: string): void => {
  tail = new Tail(logfile, {follow: true});
  tail.on('line', async (line: string) => {
    await handleLogMessage(line)
  });
}

const onWakeup = {
  addListener: (listener: WakeupCallback): void => {
    emitter.addListener('wakeup', listener)
  }
}

const onClosed = {
  addListener: (listener: CloseCallback): void => {
    emitter.addListener('close', listener)
  }
}

const onRendered = {
  addListener: (listener: RenderedCallback): void => {
    emitter.addListener('rendered', listener)
  }
}

export {
  RconOptions,
  setup,
  start,
  sendCommand,
  onWakeup,
  onClosed,
  onRendered,
}

// vim: se ts=2 sw=2 sts=2 et:
