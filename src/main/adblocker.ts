import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ElectronBlocker, fromElectronDetails } from '@ghostery/adblocker-electron'
import { parse } from 'tldts-experimental'
import type { BrowserStorage } from './storage'
import { extractHostname, isPrivateOrLocalHost } from './url'

interface SessionPipelineOptions {
  session: Electron.Session
  storage: BrowserStorage
  getTabInfoByWebContentsId: (webContentsId: number) => { url: string; host: string } | null
  onRequestBlocked: (webContentsId: number) => void
}

const FALLBACK_AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'adnxs.com',
  'adsrvr.org',
  'criteo.com',
  'outbrain.com',
  'taboola.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'moatads.com',
  'scorecardresearch.com',
  'amazon-adsystem.com',
  'mgid.com',
  'popads.net',
  'propellerads.com'
]

const GENERIC_HIDE_CSS = `
  ins.adsbygoogle,
  [id^="google_ads_iframe"],
  [id^="div-gpt-ad"],
  ytd-ad-slot-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-display-ad-renderer,
  ytd-banner-promo-renderer,
  ytm-promoted-sparkles-web-renderer,
  #masthead-ad,
  .ytp-ad-module,
  .ytp-ad-overlay-container,
  .ytd-merch-shelf-renderer {
    display: none !important;
  }
`

const YOUTUBE_AD_SKIPPER_JS = `(() => {
  if (window.__orbitYtAdGuard) return;
  window.__orbitYtAdGuard = true;
  const tick = () => {
    const player = document.querySelector('.html5-video-player');
    if (player && player.classList.contains('ad-showing')) {
      const video = player.querySelector('video');
      if (video) {
        video.muted = true;
        if (Number.isFinite(video.duration) && video.duration > 0.2) {
          video.currentTime = video.duration;
        }
      }
      const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skipBtn instanceof HTMLElement) skipBtn.click();
    }
    document.querySelectorAll('ytd-ad-slot-renderer, ytm-promoted-sparkles-web-renderer, #masthead-ad').forEach((el) => {
      if (el instanceof HTMLElement) el.style.setProperty('display', 'none', 'important');
    });
  };
  setInterval(tick, 350);
  tick();
})();`

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
    const cachePath = join(app.getPath('userData'), 'adblocker-full-engine.bin')
    try {
      if (existsSync(cachePath)) {
        const bytes = readFileSync(cachePath)
        this.blocker = ElectronBlocker.deserialize(bytes)
        return
      }
      this.blocker = await ElectronBlocker.fromPrebuiltFull(fetch)
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

  public isHttpFallbackAllowed(hostname: string): boolean {
    return Boolean(hostname && this.downgradedHttpHosts.has(hostname.toLowerCase()))
  }

  private matchesFallbackHost(reqUrl: string, pageHost: string): boolean {
    const reqHost = extractHostname(reqUrl)
    if (!reqHost || (pageHost && (reqHost === pageHost || reqHost.endsWith(`.${pageHost}`)))) {
      return false
    }
    return FALLBACK_AD_HOSTS.some((h) => reqHost === h || reqHost.endsWith(`.${h}`))
  }

  public applyCosmetics(wc: Electron.WebContents, pageUrl: string, storage: BrowserStorage): void {
    if (wc.isDestroyed()) return
    if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) return

    const settings = storage.getSettings()
    if (!settings.adBlockGlobal) return

    const host = extractHostname(pageUrl)
    if (host && storage.isAdblockDisabledForHost(host)) return

    // Always inject fast generic cosmetic hiding CSS
    void wc.insertCSS(GENERIC_HIDE_CSS, { cssOrigin: 'user' }).catch(() => {})

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      void wc.executeJavaScript(YOUTUBE_AD_SKIPPER_JS, true).catch(() => {})
    }

    if (!this.blocker) return

    try {
      const parsed = parse(pageUrl)
      const hostname = parsed.hostname || host
      const domain = parsed.domain || host
      const { active, styles, scripts } = this.blocker.getCosmeticsFilters({
        domain,
        hostname,
        url: pageUrl,
        getBaseRules: true,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromHostname: true,
        getRulesFromDOM: false
      })
      if (!active) return
      if (styles) {
        void wc.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {})
      }
      for (const script of scripts) {
        void wc.executeJavaScript(script, true).catch(() => {})
      }
    } catch {
      // Ignore cosmetic injection errors on navigating frames
    }
  }

  public attachToSession(options: SessionPipelineOptions): void {
    const { session, storage, getTabInfoByWebContentsId, onRequestBlocked } = options
    if (this.attachedSessions.has(session)) return
    this.attachedSessions.add(session)

    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const settings = storage.getSettings()

      // 1. HTTPS-First upgrade for top-level http:// navigations (excluding local/LAN/explicit fallback)
      if (
        settings.httpsFirst &&
        details.resourceType === 'mainFrame' &&
        details.url.startsWith('http://')
      ) {
        const host = extractHostname(details.url)
        if (host && !isPrivateOrLocalHost(host) && !this.downgradedHttpHosts.has(host)) {
          const upgraded = details.url.replace(/^http:\/\//i, 'https://')
          callback({ redirectURL: upgraded })
          return
        }
      }

      // 2. Ad & Tracker Blocking (skip mainFrame navigation itself, respect per-site allowlist)
      if (settings.adBlockGlobal && details.resourceType !== 'mainFrame') {
        const tabInfo = details.webContentsId
          ? getTabInfoByWebContentsId(details.webContentsId)
          : null
        const pageHost = tabInfo?.host || extractHostname(details.referrer || '')

        if (!pageHost || !storage.isAdblockDisabledForHost(pageHost)) {
          if (this.blocker) {
            const effectiveDetails =
              !details.referrer && tabInfo?.url
                ? { ...details, referrer: tabInfo.url }
                : details
            const request = fromElectronDetails(effectiveDetails)
            if (this.blocker.config.guessRequestTypeFromUrl && request.type === 'other') {
              request.guessTypeOfRequest()
            }
            const { redirect, rewrite, match } = this.blocker.match(request)
            if (redirect) {
              if (details.webContentsId) onRequestBlocked(details.webContentsId)
              callback({ redirectURL: redirect.dataUrl })
              return
            }
            if (rewrite?.url) {
              if (details.webContentsId) onRequestBlocked(details.webContentsId)
              callback({ redirectURL: rewrite.url })
              return
            }
            if (match) {
              if (details.webContentsId) onRequestBlocked(details.webContentsId)
              callback({ cancel: true })
              return
            }
          } else if (this.matchesFallbackHost(details.url, pageHost)) {
            if (details.webContentsId) onRequestBlocked(details.webContentsId)
            callback({ cancel: true })
            return
          }
        }
      }

      callback({})
    })

    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const settings = storage.getSettings()
      if (
        this.blocker &&
        settings.adBlockGlobal &&
        (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame')
      ) {
        const tabInfo = details.webContentsId
          ? getTabInfoByWebContentsId(details.webContentsId)
          : null
        const pageHost = tabInfo?.host || extractHostname(details.url)
        if (!pageHost || !storage.isAdblockDisabledForHost(pageHost)) {
          const rawCSP = this.blocker.getCSPDirectives(fromElectronDetails(details))
          if (rawCSP) {
            const responseHeaders = { ...(details.responseHeaders || {}) }
            const policies = rawCSP.split(';').map((s) => s.trim())
            for (const [name, values] of Object.entries(responseHeaders)) {
              if (name.toLowerCase() === 'content-security-policy') {
                policies.push(...values)
                delete responseHeaders[name]
              }
            }
            responseHeaders['content-security-policy'] = [policies.join(';')]
            callback({ responseHeaders })
            return
          }
        }
      }
      callback({})
    })
  }
}
