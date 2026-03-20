import { vi, describe, it, expect, beforeEach } from 'vitest'

// vi.hoisted() 内は vi.mock より先に実行されるため、
// モックオブジェクトの生成と process.env の設定をここで行う
const { discordHandlers, seamineHandlers, mockSeamine, mockChannel, mockUser, mockClient } = vi.hoisted(() => {
  process.env.DISCORD_BOT_TOKEN = 'test-token'
  process.env.DISCORD_CHANNEL = 'channel-id'
  process.env.MINECRAFT_RCON_HOST = 'localhost'
  process.env.MINECRAFT_RCON_PORT = '25575'
  process.env.MINECRAFT_RCON_PASSWORD = 'password'
  process.env.MINECRAFT_LOG_FILE = '/tmp/test.log'

  const discordHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const seamineHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockChannel = { id: 'channel-id', send: vi.fn().mockResolvedValue(undefined) }
  const mockUser = { setActivity: vi.fn(), id: 'bot-id' }
  const mockClient = {
    once: vi.fn((ev: string, fn: (...args: unknown[]) => unknown) => discordHandlers.set(ev, fn)),
    on: vi.fn((ev: string, fn: (...args: unknown[]) => unknown) => discordHandlers.set(ev, fn)),
    login: vi.fn().mockResolvedValue(undefined),
    channels: { cache: { get: vi.fn().mockReturnValue(mockChannel) } },
    user: mockUser,
  }
  const mockSeamine = {
    start: vi.fn().mockResolvedValue(undefined),
    status: vi.fn(),
    on: vi.fn((ev: string, fn: (...args: unknown[]) => unknown) => seamineHandlers.set(ev, fn)),
  }

  return { discordHandlers, seamineHandlers, mockSeamine, mockChannel, mockUser, mockClient }
})

vi.mock('@dotenvx/dotenvx', () => ({ config: vi.fn() }))

vi.mock('log4js', () => ({
  default: {
    configure: vi.fn(),
    getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
  },
}))

vi.mock('discord.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Client: vi.fn(function(this: unknown) { return mockClient as any }),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 512, MessageContent: 32768 },
  ActivityType: { Watching: 3 },
  Events: { ClientReady: 'ready', MessageCreate: 'messageCreate' },
}))

vi.mock('../src/seamine.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Seamine: vi.fn(function(this: unknown) { return mockSeamine as any }),
}))

// モックが揃った状態で bot を読み込む
import '../src/bot.js'

describe('bot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ready ハンドラを発火し channel をセットするヘルパー
  const fireReady = async () => {
    await discordHandlers.get('ready')?.()
  }

  describe('ClientReady', () => {
    it('seamine.start() を呼ぶ', async () => {
      await fireReady()
      expect(mockSeamine.start).toHaveBeenCalledOnce()
    })
  })

  describe('MessageCreate', () => {
    it('ping に対してサーバー起動中のメッセージを返す', async () => {
      await fireReady()
      mockSeamine.status.mockResolvedValue({ version: { name: '1.20.1' } })
      const msg = {
        channel: { id: 'channel-id' },
        author: { bot: false, id: 'user-id' },
        content: 'ping',
        reply: vi.fn().mockResolvedValue(undefined),
      }
      await discordHandlers.get('messageCreate')?.(msg)
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('上がってるよ'))
    })

    it('ping に対してサーバー停止中のメッセージを返す', async () => {
      await fireReady()
      mockSeamine.status.mockRejectedValue(new Error('connection refused'))
      const msg = {
        channel: { id: 'channel-id' },
        author: { bot: false, id: 'user-id' },
        content: 'ping',
        reply: vi.fn().mockResolvedValue(undefined),
      }
      await discordHandlers.get('messageCreate')?.(msg)
      expect(msg.reply).toHaveBeenCalledWith('落ちてるよ')
    })

    it('Bot からのメッセージを無視する', async () => {
      await fireReady()
      const msg = {
        channel: { id: 'channel-id' },
        author: { bot: true, id: 'other-bot' },
        content: 'ping',
        reply: vi.fn(),
      }
      await discordHandlers.get('messageCreate')?.(msg)
      expect(msg.reply).not.toHaveBeenCalled()
    })

    it('別チャンネルのメッセージを無視する', async () => {
      await fireReady()
      const msg = {
        channel: { id: 'other-channel' },
        author: { bot: false, id: 'user-id' },
        content: 'ping',
        reply: vi.fn(),
      }
      await discordHandlers.get('messageCreate')?.(msg)
      expect(msg.reply).not.toHaveBeenCalled()
    })
  })

  describe('Seamine: wakeup', () => {
    it('サーバー起動メッセージを Discord に送信する', async () => {
      await fireReady()
      await seamineHandlers.get('wakeup')?.({ serverSoftware: 'Paper', mcVersion: '1.20.1' })
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('上がったっぽい'),
      )
    })
  })

  describe('Seamine: closed', () => {
    it('サーバー停止メッセージを Discord に送信する', async () => {
      await fireReady()
      await seamineHandlers.get('closed')?.()
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('止まった'),
      )
    })
  })

  describe('Seamine: rendered', () => {
    it('world が設定されているとき Activity を更新する', () => {
      seamineHandlers.get('rendered')?.('world_overworld')
      expect(mockUser.setActivity).toHaveBeenCalledWith(
        'Dynmap: world_overworld',
        { type: 3 },
      )
    })

    it('world が undefined のとき Activity をクリアする', () => {
      seamineHandlers.get('rendered')?.(undefined)
      expect(mockUser.setActivity).toHaveBeenCalledWith()
    })
  })
})
