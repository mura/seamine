'use strict'

import { Tail } from 'tail'
import { JavaStatusResponse, RCON, status } from 'minecraft-server-util'
import { EventEmitter } from 'events'

export type SeamineOptions = {
  host: string,
  port: number,
  password: string,
  logfile: string
};

type LogCase = {
  level?: string,
  regex: RegExp,
  callback: (exec: RegExpExecArray) => void
};

type VersionResponse = {
  serverSoftware: string,
  mcVersion: string
}

export type WakeupCallback = (serverSoftware: string, mcVersion: string) => void;
export type CloseCallback = () => void;
export type RenderedCallback = (world: string | undefined) => void;

const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;

const wait = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Seamine extends EventEmitter {
  private rcon: RCON
  private tail: Tail | undefined
  private options: SeamineOptions
  private rendering: string | null = null

  private logCases: LogCase[] = [
    {
      level: 'INFO',
      regex: /^(Closing|Stopping)\sServer$/i,
      callback: (exec) => {
        this.rcon.close()
        this.rcon = new RCON()
        this.emit('closed')
      }
    },
    {
      level: 'INFO',
      regex: /^RCON\srunning\son\s/,
      callback: async (exec) => {
        this.emit('wakeup')
      }
    }
  ];

  constructor(options: SeamineOptions) {
    super()
    this.rcon = new RCON()
    this.options = options
  }
  
  private async login(): Promise<void> {
    // console.log(`login: isConnected:${this.rcon.isConnected}, isLoggedIn:${this.rcon.isLoggedIn}`)
    if (!this.rcon.isConnected) {
      await this.rcon.connect(this.options.host, this.options.port)
      // console.log(`connected: ${this.options.host}:${this.options.port}`)
    }
    if (!this.rcon.isLoggedIn) {
      await this.rcon.login(this.options.password)
      // console.log(`logged in: ${this.options.host}:${this.options.port}`)
    }
  }

  async start(): Promise<void> {
    this.tail = new Tail(this.options.logfile, {follow: true});
    this.tail.on('line', async (line: string) => {
      const [log, time, causedAt, level, message] = regexpLog.exec(line) || [];
  
      this.logCases.forEach(c => {
        if (level !== c.level) {
          return
        }
        const exec = c.regex.exec(message)
        exec && c.callback(exec)
      })
    });

    await this.watchDynmap()
  }

  async version(): Promise<VersionResponse> {
    const runningRegex = /This server is running\s(.*\sversion\s.*)\s\(MC: (.*?)\)/
    const checkingRegex = /Checking version, please wait\.\.\./
    let res: string | null = null
    let exec: RegExpExecArray | null
    while (true) {
      res = await this.execute('version')
      exec = runningRegex.exec(res)
      if (exec) {
        const [, serverSoftware, mcVersion] = exec
        if (serverSoftware && mcVersion) {
          return {serverSoftware, mcVersion}
        }
      }

      exec = checkingRegex.exec(res)
      if (exec) {
        await wait(1000);
      }
    }
  }

  private async watchDynmap() {
    try {
      await this.status();
      await this.dynmapStats()
      setTimeout(async () => { await this.watchDynmap() }, 30_000)
    } catch(err) {
      setTimeout(async () => { await this.watchDynmap() }, 10_000)
    }
  }

  private async dynmapStats(): Promise<void> {
    const regex = /Tile Render Statistics:[\s\S]*?Active render jobs: (.*)[\s\S]/m
    const res = await this.execute('dynmap stats')
    const exec = regex.exec(res)
    if (exec) {
      const [, world] = exec
      if (world !== this.rendering) {
        // console.log(`redered: ${world}`)
        this.emit('rendered', world)
        this.rendering = world
      }
    }
  }

  async sendCommand(command: string): Promise<void> {
    await this.login()
    await this.rcon.run(command)
  }

  async execute(command: string): Promise<string> {
    await this.login()
    return this.rcon.execute(command)
  }

  async status(): Promise<JavaStatusResponse> {
    return status(this.options.host)
  }
}

// vim: se ts=2 sw=2 sts=2 et:
