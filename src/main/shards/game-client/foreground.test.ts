import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GameClientMain } from './index'

const native = vi.hoisted(() => ({
  support: { available: true },
  getPidsByName: vi.fn<() => Promise<number[]>>(),
  isProcessForeground: vi.fn<(pid: number) => boolean>(),
  isProcessRunning: vi.fn(() => true)
}))

vi.mock('@main/native', () => ({
  NATIVE_SUPPORT: { isProcessForeground: native.support },
  getPidsByName: native.getPidsByName,
  isProcessForeground: native.isProcessForeground,
  isProcessRunning: native.isProcessRunning
}))

vi.mock('../client-installation', () => ({ ClientInstallationMain: class {} }))
vi.mock('../ipc', () => ({ AkariIpcMain: class {} }))
vi.mock('../keyboard-shortcuts', () => ({ KeyboardShortcutsMain: class {} }))
vi.mock('../league-client', () => ({ LeagueClientMain: class {} }))
vi.mock('../logger-factory', () => ({ LoggerFactoryMain: class {} }))
vi.mock('../mobx-utils', () => ({ MobxUtilsMain: class {} }))
vi.mock('../setting-factory', () => ({ SettingFactoryMain: class {} }))
vi.mock('./settings-file-controller', () => ({ GameClientSettingsFileController: class {} }))

function createGameClient() {
  // Exercise the real cached check without starting Electron or unrelated shard lifecycle.
  return Object.assign(Object.create(GameClientMain.prototype), {
    _gameClientCachedRunningPids: []
  }) as GameClientMain
}

describe('game foreground detection across matches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.support.available = true
  })

  it('finds the next match even if the previous process ID still appears to exist', async () => {
    const gameClient = createGameClient()
    let foregroundPid = 101
    native.isProcessForeground.mockImplementation((pid) => pid === foregroundPid)
    native.getPidsByName.mockResolvedValueOnce([101]).mockResolvedValue([202])
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)

    foregroundPid = 202
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)
    expect(native.getPidsByName).toHaveBeenCalledTimes(2)
  })

  it('keeps the fast path while the cached game remains in the foreground', async () => {
    const gameClient = createGameClient()
    native.getPidsByName.mockResolvedValue([101])
    native.isProcessForeground.mockReturnValue(true)
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)
    expect(native.getPidsByName).toHaveBeenCalledTimes(1)
  })

  it('stays false while outside the game and recovers when another game appears', async () => {
    const gameClient = createGameClient()
    native.getPidsByName.mockResolvedValueOnce([]).mockResolvedValue([202])
    native.isProcessForeground.mockReturnValue(false)
    expect(await gameClient.isGameClientForegroundCached()).toBe(false)
    expect(await gameClient.isGameClientForegroundCached()).toBe(false)
    native.isProcessForeground.mockImplementation((pid) => pid === 202)
    expect(await gameClient.isGameClientForegroundCached()).toBe(true)
  })

  it('does not query native processes when foreground detection is unavailable', async () => {
    native.support.available = false
    expect(await createGameClient().isGameClientForegroundCached()).toBe(false)
    expect(native.getPidsByName).not.toHaveBeenCalled()
  })
})
