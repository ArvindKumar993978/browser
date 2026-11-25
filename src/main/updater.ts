import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

export class UpdaterService {
  private state: UpdateState
  private readonly onBroadcast: (state: UpdateState) => void

  constructor(onBroadcast: (state: UpdateState) => void) {
    this.onBroadcast = onBroadcast
    this.state = {
      status: 'idle',
      appVersion: app.getVersion()
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', message: 'Checking for updates...' })
    })

    autoUpdater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        latestVersion: info.version,
        message: `Orbit ${info.version} is available.`
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.setState({
        status: 'up-to-date',
        message: `You are on the latest version (${app.getVersion()}).`
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        progress: Math.round(progress.percent),
        message: `Downloading update (${Math.round(progress.percent)}%)...`
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        status: 'ready',
        latestVersion: info.version,
        progress: 100,
        message: `Orbit ${info.version} is ready to install.`
      })
    })

    autoUpdater.on('error', (err) => {
      this.setState({
        status: 'error',
        message: err?.message ? `Update check failed: ${err.message}` : 'Update check failed.'
      })
    })
  }

  public getState(): UpdateState {
    return { ...this.state }
  }

  public scheduleInitialCheck(): void {
    if (!app.isPackaged) return
    setTimeout(() => {
      void this.checkForUpdates()
    }, 8_000)
  }

  public async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) {
      this.setState({
        status: 'up-to-date',
        message: `Dev mode (${app.getVersion()}). Auto-updates run in installed builds.`
      })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // Error event updates state cleanly
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (!app.isPackaged) return
    try {
      await autoUpdater.downloadUpdate()
    } catch {
      // Error event updates state cleanly
    }
  }

  public installUpdate(): void {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  }

  private setState(partial: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...partial,
      appVersion: app.getVersion()
    }
    this.onBroadcast(this.getState())
  }
}
