import { NATIVE_SUPPORT } from '@main/native'
import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { autoSurrenderRegionSchema } from '@shared/shards/auto-misc/auto-surrender'
import { z } from 'zod'

import { GameClientMain } from '../game-client'
import { InGameSendMain } from '../in-game-send'
import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { AutoMiscAutoReplyController } from './auto-reply-controller'
import { AutoSurrenderController } from './auto-surrender/auto-surrender-controller'
import { SurrenderOcrExecutor } from './auto-surrender/ocr-executor'
import { AutoSurrenderState } from './auto-surrender/state'
import {
  AUTO_MISC_MAIN_NAMESPACE,
  AUTO_MISC_SETTING_KEYS,
  type AutoMiscMainContext
} from './context'
import { AutoMiscIpcHandlers } from './ipc-handlers'
import { AutoMiscLoginAutomationController } from './login-automation-controller'
import { AutoMiscSettings } from './state'

@Shard(AutoMiscMain.id)
export class AutoMiscMain implements IAkariShardInitDispose {
  static id = AUTO_MISC_MAIN_NAMESPACE

  public readonly settings = new AutoMiscSettings()
  public readonly autoSurrender = new AutoSurrenderState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService
  private readonly _context: AutoMiscMainContext
  private readonly _autoReplyController: AutoMiscAutoReplyController
  private readonly _loginAutomationController: AutoMiscLoginAutomationController
  private readonly _ipcHandlers: AutoMiscIpcHandlers
  private readonly _autoSurrenderController: AutoSurrenderController

  constructor(
    loggerFactory: LoggerFactoryMain,
    settingFactory: SettingFactoryMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _ipc: AkariIpcMain,
    private readonly _gameClient: GameClientMain,
    private readonly _inGameSend: InGameSendMain
  ) {
    this._logger = loggerFactory.create(AutoMiscMain.id)
    this._settingService = settingFactory.register(
      AutoMiscMain.id,
      {
        autoAcceptSurrenderRegion: {
          default: this.settings.autoAcceptSurrenderRegion,
          schema: autoSurrenderRegionSchema
        },
        autoSurrenderEnabled: { default: this.settings.autoSurrenderEnabled, schema: z.boolean() },
        autoSurrenderRegion: {
          default: this.settings.autoSurrenderRegion,
          schema: autoSurrenderRegionSchema
        },
        autoReplyEnabled: { default: this.settings.autoReplyEnabled, schema: z.boolean() },
        autoReplyEnableOnAway: {
          default: this.settings.autoReplyEnableOnAway,
          schema: z.boolean()
        },
        autoReplyText: { default: this.settings.autoReplyText, schema: z.string() },
        lockOfflineStatus: { default: this.settings.lockOfflineStatus, schema: z.boolean() },
        autoSetStatusMessageEnabled: {
          default: this.settings.autoSetStatusMessageEnabled,
          schema: z.boolean()
        },
        statusMessage: { default: this.settings.statusMessage, schema: z.string() },
        autoSetRankedStatusEnabled: {
          default: this.settings.autoSetRankedStatusEnabled,
          schema: z.boolean()
        },
        rankedStatus: {
          default: this.settings.rankedStatus,
          schema: z.object({
            queue: z.string(),
            tier: z.enum([
              'IRON',
              'BRONZE',
              'SILVER',
              'GOLD',
              'PLATINUM',
              'EMERALD',
              'DIAMOND',
              'MASTER',
              'GRANDMASTER',
              'CHALLENGER'
            ]),
            division: z.enum(['I', 'II', 'III', 'IV'])
          })
        }
      },
      this.settings
    )
    this._context = {
      namespace: AutoMiscMain.id,
      settings: this.settings,
      logger: this._logger,
      leagueClient: this._leagueClient,
      mobxUtils: this._mobxUtils,
      ipc: this._ipc
    }
    this._autoReplyController = new AutoMiscAutoReplyController(this._context)
    this._loginAutomationController = new AutoMiscLoginAutomationController(this._context)
    this._ipcHandlers = new AutoMiscIpcHandlers(this._context, this._loginAutomationController)
    this._autoSurrenderController = new AutoSurrenderController(this._context, this.autoSurrender, {
      isAvailable: () => process.platform === 'win32' && NATIVE_SUPPORT.nativeInput.available,
      isGameForeground: () => this._gameClient.isGameClientForegroundCached(),
      createOcr: () => new SurrenderOcrExecutor(),
      sendSurrender: (signal) => this._inGameSend.sendSurrender(signal)
    })
  }

  async onInit() {
    await this._settingService.applyToState()
    this._context.mobxUtils.propSync(AutoMiscMain.id, 'settings', this.settings, [
      ...AUTO_MISC_SETTING_KEYS
    ])
    this._mobxUtils.propSync(AutoMiscMain.id, 'autoSurrender', this.autoSurrender, [
      'status',
      'error',
      'lastText',
      'lastScanDurationMs',
      'followAttempts',
      'acceptAttempts'
    ])

    this._ipcHandlers.register()
    this._autoReplyController.watch()
    this._loginAutomationController.watch()
    this._autoSurrenderController.watch()
  }

  async onDispose() {
    this._autoSurrenderController.dispose()
  }
}
