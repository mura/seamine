'use strict'

import log4js from '@log4js-node/log4js-api'
import { Tail } from 'tail'
import { JavaStatusResponse, RCON, status } from 'minecraft-server-util'
import { EventEmitter } from 'events'

const logger = log4js.getLogger('seamine')

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
  private reqIds: Map<number, string> = new Map
  private version: VersionResponse | undefined

  private logCases: LogCase[] = [
    {
      level: 'INFO',
      regex: /^(Closing|Stopping)\sServer$/i,
      callback: (exec) => {
        logger.info('close server')
        this.rcon.close()
        this.rcon = this.createRCON()
        this.emit('closed')
      }
    },
    {
      level: 'INFO',
      regex: /^RCON\srunning\son\s/,
      callback: async (exec) => {
        logger.info('start server')
        await this.runVersion()
      }
    }
  ];

  constructor(options: SeamineOptions) {
    super()
    this.rcon = this.createRCON()
    this.options = options
  }
  
  private async login(): Promise<void> {
    // console.log(`login: isConnected:${this.rcon.isConnected}, isLoggedIn:${this.rcon.isLoggedIn}`)
    if (!this.rcon.isConnected) {
      await this.rcon.connect(this.options.host, this.options.port)
      logger.info(`connected: ${this.options.host}:${this.options.port}`)
    }
    if (!this.rcon.isLoggedIn) {
      await this.rcon.login(this.options.password)
      logger.info(`logged in: ${this.options.host}:${this.options.port}`)
    }
  }

  async start(): Promise<void> {
    if (this.tail) {
      return
    }

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

    await this.runDynmapStats()
  }
  
  private createRCON(): RCON {
    const rcon = new RCON()
    rcon.on('message', async ({ requestID, message }) => {
      const type = this.reqIds.get(requestID)
      switch (type) {
        case 'version': {
          await this.handleVersion(message)
        }
        case 'dynmap_stats': {
          this.handleDynmapStats(message)
        }
      }
      this.reqIds.delete(requestID)
    })

    return rcon
  }

  private async handleVersion(message: string) {
    const runningRegex = /This server is running\s(.*\sversion\s.*)\s\(MC: (.*?)\)/
    const checkingRegex = /Checking version, please wait\.\.\./
    
    let exec = runningRegex.exec(message)
    if (exec) {
      const [, serverSoftware, mcVersion] = exec
      if (serverSoftware && mcVersion) {
        this.version = {serverSoftware, mcVersion}
        logger.info(`version: {}`, this.version)
        this.emit('wakeup', this.version)
      }
      return
    }

    exec = checkingRegex.exec(message)
    if (exec) {
      setTimeout(async () => { await this.runVersion() }, 1_000)
    }
  }

  private handleDynmapStats(message: string) {
    const regex = /Tile Render Statistics:[\s\S]*?Active render jobs: (.*)[\s\S]/m
    const exec = regex.exec(message)
    if (exec) {
      const [, world] = exec
      if (world !== this.rendering) {
        logger.info(`redered: ${world}`)
        this.emit('rendered', world)
        this.rendering = world
      }
    }

    setTimeout(async () => { await this.runDynmapStats( )}, 30_000)
  }

  private async runVersion() {
    this.reqIds.set(await this.run('version'), 'version')
  }

  private async runDynmapStats() {
    try {
      await this.status()
      this.reqIds.set(await this.run('dynmap stats'), 'dynmap_stats')
    } catch (err) {
      setTimeout(async () => { await this.runDynmapStats() }, 10_000)
    }
  }

  async execute(command: string): Promise<string> {
    await this.login()
    return this.rcon.execute(command)
  }

  async run(command: string): Promise<number> {
    await this.login()
    return this.rcon.run(command)
  }

  async status(): Promise<JavaStatusResponse> {
    return status(this.options.host)
  }
}

// vim: se ts=2 sw=2 sts=2 et:
