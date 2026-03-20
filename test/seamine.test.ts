import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// --- hoisted mocks ---
const { mockRcon, mockRconHandlers, mockTail, mockTailHandlers, mockStatus } = vi.hoisted(() => {
  const mockRconHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockRcon = {
    isConnected: false,
    isLoggedIn: false,
    connect: vi.fn().mockImplementation(async () => { mockRcon.isConnected = true }),
    login: vi.fn().mockImplementation(async () => { mockRcon.isLoggedIn = true }),
    execute: vi.fn().mockResolvedValue('ok'),
    run: vi.fn().mockResolvedValue(1),
    close: vi.fn().mockImplementation(() => { mockRcon.isConnected = false; mockRcon.isLoggedIn = false }),
    removeAllListeners: vi.fn(),
    on: vi.fn((ev: string, fn: (...args: unknown[]) => unknown) => {
      mockRconHandlers.set(ev, fn)
    }),
  }

  const mockTailHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockTail = {
    on: vi.fn((ev: string, fn: (...args: unknown[]) => unknown) => {
      mockTailHandlers.set(ev, fn)
    }),
  }

  const mockStatus = vi.fn()

  return { mockRcon, mockRconHandlers, mockTail, mockTailHandlers, mockStatus }
})

vi.mock('@log4js-node/log4js-api', () => ({
  default: { getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })) },
}))

vi.mock('tail', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tail: vi.fn(function (this: unknown) { return mockTail as any }),
}))

vi.mock('minecraft-server-util', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RCON: vi.fn(function (this: unknown) { return mockRcon as any }),
  status: mockStatus,
}))

import { Seamine } from '../src/seamine.js'

const defaultOptions = {
  host: 'localhost',
  port: 25575,
  password: 'secret',
  logfile: '/tmp/test.log',
}

describe('Seamine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockRcon.isConnected = false
    mockRcon.isLoggedIn = false
    // clearAllMocks でリセットされるので実装を再設定
    mockRcon.connect.mockImplementation(async () => { mockRcon.isConnected = true })
    mockRcon.login.mockImplementation(async () => { mockRcon.isLoggedIn = true })
    mockRcon.close.mockImplementation(() => { mockRcon.isConnected = false; mockRcon.isLoggedIn = false })
    mockRcon.on.mockImplementation((ev: string, fn: (...args: unknown[]) => unknown) => {
      mockRconHandlers.set(ev, fn)
    })
    mockTail.on.mockImplementation((ev: string, fn: (...args: unknown[]) => unknown) => {
      mockTailHandlers.set(ev, fn)
    })
    mockRcon.run.mockResolvedValue(1)
    mockRconHandlers.clear()
    mockTailHandlers.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('RCON を作成しオプションを保持する', () => {
      const seamine = new Seamine(defaultOptions)
      expect(seamine).toBeDefined()
    })
  })

  describe('execute()', () => {
    it('login してからコマンドを実行する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.execute.mockResolvedValue('done')
      const result = await seamine.execute('list')
      expect(mockRcon.connect).toHaveBeenCalledWith('localhost', 25575)
      expect(mockRcon.login).toHaveBeenCalledWith('secret')
      expect(mockRcon.execute).toHaveBeenCalledWith('list')
      expect(result).toBe('done')
    })

    it('既に接続済みなら connect を呼ばない', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      await seamine.execute('list')
      expect(mockRcon.connect).not.toHaveBeenCalled()
      expect(mockRcon.login).not.toHaveBeenCalled()
    })
  })

  describe('run()', () => {
    it('login してからコマンドを実行し requestID を返す', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockResolvedValue(42)
      const id = await seamine.run('version')
      expect(mockRcon.run).toHaveBeenCalledWith('version')
      expect(id).toBe(42)
    })
  })

  describe('status()', () => {
    it('minecraft-server-util の status を呼ぶ', async () => {
      const seamine = new Seamine(defaultOptions)
      const fakeResponse = { version: { name: '1.20.1' } }
      mockStatus.mockResolvedValue(fakeResponse)
      const res = await seamine.status()
      expect(mockStatus).toHaveBeenCalledWith('localhost')
      expect(res).toBe(fakeResponse)
    })
  })

  describe('start()', () => {
    it('Tail を作成しログ監視を開始する', async () => {
      const seamine = new Seamine(defaultOptions)
      // runDynmapStats は run を呼ぶが、失敗してリトライするだけなのでモック
      mockRcon.run.mockRejectedValue(new Error('not connected'))
      await seamine.start()
      expect(mockTail.on).toHaveBeenCalledWith('line', expect.any(Function))
    })

    it('二重に start しても Tail は1つだけ', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValue(new Error('not connected'))
      await seamine.start()
      await seamine.start()
      // Tail コンストラクタは1回だけ
      const { Tail } = await import('tail')
      expect(Tail).toHaveBeenCalledTimes(1)
    })
  })

  describe('ログ解析: Closing Server', () => {
    it('closed イベントを emit する（started 状態の場合）', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValue(new Error('not connected'))
      await seamine.start()

      // started フラグを立てるため execute を呼ぶ
      mockRcon.isConnected = false
      mockRcon.isLoggedIn = false
      await seamine.execute('test')

      const closedHandler = vi.fn()
      seamine.on('closed', closedHandler)

      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: Closing Server')

      expect(closedHandler).toHaveBeenCalledOnce()
    })

    it('Stopping Server でも closed イベントを emit する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValue(new Error('not connected'))
      await seamine.start()

      mockRcon.isConnected = false
      mockRcon.isLoggedIn = false
      await seamine.execute('test')

      const closedHandler = vi.fn()
      seamine.on('closed', closedHandler)

      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: Stopping Server')

      expect(closedHandler).toHaveBeenCalledOnce()
    })

    it('started でない場合は closed イベントを emit しない', async () => {
      const seamine = new Seamine(defaultOptions)
      // connect を失敗させて started = false を維持
      mockRcon.connect.mockRejectedValue(new Error('connection refused'))
      await seamine.start()

      const closedHandler = vi.fn()
      seamine.on('closed', closedHandler)

      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: Closing Server')

      expect(closedHandler).not.toHaveBeenCalled()
    })
  })

  describe('ログ解析: RCON running', () => {
    it('RCON 起動ログで version コマンドを送信する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValueOnce(new Error('not connected')) // runDynmapStats in start()
      await seamine.start()

      // login 状態を整えて version 呼び出しに備える
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(99)

      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: RCON running on 0.0.0.0:25575')

      expect(mockRcon.run).toHaveBeenCalledWith('version')
    })
  })

  describe('RCON message: version', () => {
    it('バージョン応答で wakeup イベントを emit する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValueOnce(new Error('not connected')) // runDynmapStats in start()
      await seamine.start()

      const wakeupHandler = vi.fn()
      seamine.on('wakeup', wakeupHandler)

      // login 状態を整える
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(10)

      // RCON起動ログ → runVersion → reqId=10 を 'version' に登録
      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: RCON running on 0.0.0.0:25575')
      // forEach 内の async callback を消化
      await vi.advanceTimersByTimeAsync(0)

      // RCON message ハンドラを発火
      const rconMessageHandler = mockRconHandlers.get('message')!
      await rconMessageHandler({
        requestID: 10,
        message: 'This server is running Paper version 1.20.1-100 (MC: 1.20.1)',
      })

      expect(wakeupHandler).toHaveBeenCalledWith({
        serverSoftware: 'Paper version',
        mcVersion: '1.20.1-100',
      })
    })

    it('"Checking version" 応答で 1 秒後にリトライする', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.run.mockRejectedValueOnce(new Error('not connected')) // runDynmapStats in start()
      await seamine.start()

      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(10)

      const lineHandler = mockTailHandlers.get('line')!
      await lineHandler('[12:00:00] [Server thread/INFO]: RCON running on 0.0.0.0:25575')
      // forEach 内の async callback を消化
      await vi.advanceTimersByTimeAsync(0)

      const rconMessageHandler = mockRconHandlers.get('message')!
      await rconMessageHandler({
        requestID: 10,
        message: 'Checking version, please wait...',
      })

      // setTimeout(1000) が登録されている
      mockRcon.run.mockResolvedValue(20)
      await vi.advanceTimersByTimeAsync(1_000)

      // version コマンドが再度呼ばれる
      const versionCalls = mockRcon.run.mock.calls.filter(c => c[0] === 'version')
      expect(versionCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('RCON message: dynmap_stats', () => {
    it('レンダリング状態変化で rendered イベントを emit する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(5)
      await seamine.start()

      const renderedHandler = vi.fn()
      seamine.on('rendered', renderedHandler)

      const rconMessageHandler = mockRconHandlers.get('message')!
      await rconMessageHandler({
        requestID: 5,
        message: 'Tile Render Statistics:\nActive render jobs: world_overworld\nmore',
      })

      expect(renderedHandler).toHaveBeenCalledWith('world_overworld')
    })

    it('同じ world が続く場合は rendered を再発火しない', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(5)
      await seamine.start()

      const renderedHandler = vi.fn()
      seamine.on('rendered', renderedHandler)

      const rconMessageHandler = mockRconHandlers.get('message')!
      await rconMessageHandler({
        requestID: 5,
        message: 'Tile Render Statistics:\nActive render jobs: world_overworld\nmore',
      })
      // 次のポーリング用を登録
      mockRcon.run.mockResolvedValue(6)
      await vi.advanceTimersByTimeAsync(30_000)

      await rconMessageHandler({
        requestID: 6,
        message: 'Tile Render Statistics:\nActive render jobs: world_overworld\nmore',
      })

      expect(renderedHandler).toHaveBeenCalledTimes(1)
    })

    it('30 秒後に dynmap stats を再ポーリングする', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.isConnected = true
      mockRcon.isLoggedIn = true
      mockRcon.run.mockResolvedValue(5)
      await seamine.start()

      const rconMessageHandler = mockRconHandlers.get('message')!
      await rconMessageHandler({
        requestID: 5,
        message: 'Tile Render Statistics:\nActive render jobs: none\nmore',
      })

      const callCountBefore = mockRcon.run.mock.calls.length
      mockRcon.run.mockResolvedValue(6)
      await vi.advanceTimersByTimeAsync(30_000)

      const dynmapCalls = mockRcon.run.mock.calls
        .slice(callCountBefore)
        .filter(c => c[0] === 'dynmap stats')
      expect(dynmapCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('login: 6時間 RCON リセット', () => {
    it('接続後 6 時間で RCON を再作成する', async () => {
      const seamine = new Seamine(defaultOptions)
      mockRcon.isConnected = false
      mockRcon.isLoggedIn = false
      await seamine.execute('test')

      expect(mockRcon.connect).toHaveBeenCalled()

      // 6時間経過
      await vi.advanceTimersByTimeAsync(21_600_000)
      expect(mockRcon.close).toHaveBeenCalled()
      expect(mockRcon.removeAllListeners).toHaveBeenCalled()
    })
  })
})
