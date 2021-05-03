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

const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;

let rcon: RCON | undefined;
let tail: Tail;

const emitter = new EventEmitter()

const logCases: LogCase[] = [
  {
    level: 'INFO',
    regex: /^Closing\sServer$/,
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
    regex: /This server is running\s(Paper\sversion\s.*)\s\(MC: (.*?)\)/,
    callback: async (exec) => {
      const [msg, serverSoftware, mcVersion] = exec
      if (serverSoftware && mcVersion) {
        emitter.emit('wakeup', serverSoftware, mcVersion);
        await rcon?.close();
      }
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
  await rcon?.connect();
  return rcon?.run(command);
}

const setup = (rconOptions: RconOptions) => {
  rcon = new util.RCON(rconOptions.host, {
    port: rconOptions.port,
    password: rconOptions.password
  });
  rcon.on('output', async (message: string) => {
    await handleRconMessage(message)
  });
}

const start = (logfile: string) => {
  tail = new Tail(logfile);
  tail.on('line', async (line: string) => {
    await handleLogMessage(line)
  });
}

const onWakeup = {
  addListener: (listener: WakeupCallback) => {
    emitter.addListener('wakeup', listener)
  }
}

const onClosed  = {
  addListener: (listener: CloseCallback) => {
    emitter.addListener('close', listener)
  }
}

export {
  RconOptions,
  setup,
  start,
  sendCommand,
  onWakeup,
  onClosed,
}

// vim: se ts=2 sw=2 sts=2 et: