import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ElectronBlocker, fromElectronDetails } from '@ghostery/adblocker-electron'
import type { BrowserStorage } from './storage'
import { extractHostname } from './url'

interface SessionPipelineOptions {
  session: Electron.Session
  storage: BrowserStorage
  getTabHostByWebContentsId: (webContentsId: number) => string | null
  onRequestBlocked: (webContentsId: number) => void
}

export class AdBlockerService {
  private blocker: ElectronBlocker | null = null
  private initPromise: Promise<void> | null = null
  private readonly downgradedHttpHosts = new Set<string>()
  private readonly attachedSessions = new WeakSet<Electron.Session>()

  public async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.loadEngine()
    return this.initPromise
  }

  private async loadEngine(): Promise<void> {
    const cachePath = join(app.getPath('userData'), 'adblocker-engine.bin')
    try {
      if (existsSync(cachePath)) {
        const bytes = readFileSync(cachePath)
        this.blocker = ElectronBlocker.deserialize(bytes)
        return
      }
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      writeFileSync(cachePath, this.blocker.serialize())
    } catch (err) {
      console.warn('Adblocker init deferred/offline:', err)
    }
  }

  public allowHttpFallbackForHost(hostname: string): void {
    if (hostname) {
      this.downgradedHttpHosts.add(hostname.toLowerCase())
    }
  }

  public attachToSession(options: SessionPipelineOptions): void {
    const { session, storage, getTabHostByWebContentsId, onRequestBlocked } = options
    if (this.attachedSessions.has(session)) return
    this.attachedSessions.add(session)

    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const settings = storage.getSettings()

      // 1. HTTPS-First upgrade for top-level http:// navigations (excluding localhost / LAN)
      if (
        settings.httpsFirst &&
        details.resourceType === 'mainFrame' &&
        details.url.startsWith('http://')
      ) {
        const host = extractHostname(details.url)
        const isLocal =
          host === 'localhost' ||
          host.startsWith('127.') ||
          host.startsWith('192.168.') ||
          host.startsWith('10.') ||
          this.downgradedHttpHosts.has(host)

        if (host && !isLocal) {
          const upgraded = details.url.replace(/^http:\/\//i, 'https://')
          callback({ redirectURL: upgraded })
          return
        }
      }

      // 2. Ad & Tracker Blocking (skip mainFrame navigation itself, respect per-site allowlist)
      if (
        this.blocker &&
        settings.adBlockGlobal &&
        details.resourceType !== 'mainFrame'
      ) {
        const pageHost =
          (details.webContentsId ? getTabHostByWebContentsId(details.webContentsId) : null) ??
          extractHostname(details.referrer || '')

        if (!pageHost || !storage.isAdblockDisabledForHost(pageHost)) {
          const request = fromElectronDetails(details)
          if (this.blocker.config.guessRequestTypeFromUrl && request.type === 'other') {
            request.guessTypeOfRequest()
          }
          const { redirect, match } = this.blocker.match(request)
          if (redirect) {
            if (details.webContentsId) onRequestBlocked(details.webContentsId)
            callback({ redirectURL: redirect.dataUrl })
            return
          }
          if (match) {
            if (details.webContentsId) onRequestBlocked(details.webContentsId)
            callback({ cancel: true })
            return
          }
        }
      }

      callback({})
    })
  }
}
