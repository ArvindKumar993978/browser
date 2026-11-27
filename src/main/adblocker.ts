import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ElectronBlocker, Request, fromElectronDetails } from '@ghostery/adblocker-electron'
import { parse } from 'tldts-experimental'
import type { BrowserStorage } from './storage'
import { extractHostname, isPrivateOrLocalHost } from './url'

interface SessionPipelineOptions {
  session: Electron.Session
  storage: BrowserStorage
  getTabInfoByWebContentsId: (webContentsId: number) => { url: string; host: string } | null
  onRequestBlocked: (webContentsId: number) => void
}

const EXTRA_AD_HOSTS = [
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
  'popcash.net',
  'propellerads.com',
  'highperformanceformat.com',
  'adsterra.com',
  'hilltopads.net',
  'monetag.com',
  'exoclick.com',
  'juicyads.com',
  'revcontent.com',
  'ads-api.twitter.com',
  'adeventtracker.spotify.com',
  'ads.tiktok.com',
  'analytics.tiktok.com',
  'bat.bing.com'
]

const EXTRA_AD_PATHS = [
  '/pagead/',
  '/api/stats/ads',
  '/ptracking',
  '/get_midroll_info',
  '/youtubei/v1/player/ad_break',
  '/ads/ga-audiences',
  '/en_us/fbevents.js',
  '/popunder'
]

const GENERIC_HIDE_CSS = `
  ins.adsbygoogle,
  [id^="google_ads_iframe"],
  [id^="div-gpt-ad"],
  [class*="taboola"],
  [id*="taboola"],
  [class*="outbrain"],
  [id*="outbrain"],
  [class*="mgid"],
  [id*="mgid"],
  shreddit-ad-post,
  [data-testid="placementTracking"],
  ytd-ad-slot-renderer,
  ytm-ad-slot-renderer,
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

const YOUTUBE_AD_GUARD_JS = `(() => {
  if (window.__orbitYtAdGuard) return;
  window.__orbitYtAdGuard = true;

  const stripAds = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      delete obj.adPlacements;
      delete obj.playerAds;
      delete obj.adSlots;
      delete obj.adBreakHeartbeatParams;
    } catch {}
    return obj;
  };

  if (window.ytInitialPlayerResponse) {
    stripAds(window.ytInitialPlayerResponse);
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (reqUrl.includes('/youtubei/v1/player') || reqUrl.includes('/youtubei/v1/next')) {
          const clone = res.clone();
          const data = await clone.json();
          stripAds(data);
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
          });
        }
      } catch {}
      return res;
    };
  }

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
    document.querySelectorAll(
      'ytd-ad-slot-renderer, ytm-ad-slot-renderer, ytm-promoted-sparkles-web-renderer, ytd-promoted-sparkles-web-renderer, #masthead-ad'
    ).forEach((el) => {
      if (el instanceof HTMLElement) el.style.setProperty('display', 'none', 'important');
    });
    // Hide Shorts sponsored reels
    document.querySelectorAll('ytd-reel-video-renderer').forEach((reel) => {
      if (reel.querySelector('ad-badge-view-model, ytd-ad-slot-renderer')) {
        reel.style.setProperty('display', 'none', 'important');
      }
    });
  };

  setInterval(tick, 300);
  tick();
})();`

const GENERIC_MUTATION_GUARD_JS = `(() => {
  if (window.__orbitDomAdObserver) return;
  window.__orbitDomAdObserver = true;
  const selector = 'ins.adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"], shreddit-ad-post, [data-testid="placementTracking"], [class*="taboola"], [id*="taboola"], [class*="outbrain"], [id*="outbrain"], [class*="mgid"], [id*="mgid"]';
  const sweep = () => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) el.style.setProperty('display', 'none', 'important');
    });
    // Neutralize invisible full-viewport click-hijack anchor traps
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      if (!(a instanceof HTMLElement)) return;
      const r = a.getBoundingClientRect();
      if (r.width > window.innerWidth * 0.85 && r.height > window.innerHeight * 0.85) {
        const style = getComputedStyle(a);
        if (style.position === 'fixed' || style.position === 'absolute') {
          a.style.setProperty('display', 'none', 'important');
        }
      }
    });
  };
  const mo = new MutationObserver(() => sweep());
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  sweep();
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
    const cachePath = join(app.getPath('userData'), 'adblocker-full-v2.bin')
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

  private matchesExtraRules(reqUrl: string, pageHost: string): boolean {
    const lower = reqUrl.toLowerCase()
    if (EXTRA_AD_PATHS.some((p) => lower.includes(p))) {
      return true
    }
    const reqHost = extractHostname(reqUrl)
    if (!reqHost || (pageHost && (reqHost === pageHost || reqHost.endsWith(`.${pageHost}`)))) {
      return false
    }
    return EXTRA_AD_HOSTS.some((h) => reqHost === h || reqHost.endsWith(`.${h}`))
  }

  public shouldBlockNavigationOrPopup(
    targetUrl: string,
    sourceUrl: string,
    storage: BrowserStorage
  ): boolean {
    if (!storage.getSettings().adBlockGlobal) return false
    const sourceHost = extractHostname(sourceUrl)
    if (sourceHost && storage.isAdblockDisabledForHost(sourceHost)) return false

    if (this.matchesExtraRules(targetUrl, sourceHost)) return true
    if (!this.blocker) return false

    const targetHost = extractHostname(targetUrl)
    if (sourceHost && targetHost && (targetHost === sourceHost || targetHost.endsWith(`.${sourceHost}`))) {
      return false
    }

    const req = Request.fromRawDetails({
      url: targetUrl,
      sourceUrl,
      type: 'mainFrame'
    })
    const { match } = this.blocker.match(req)
    return match
  }

  public applyCosmetics(wc: Electron.WebContents, pageUrl: string, storage: BrowserStorage): void {
    if (wc.isDestroyed()) return
    if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) return

    const settings = storage.getSettings()
    if (!settings.adBlockGlobal) return

    const host = extractHostname(pageUrl)
    if (host && storage.isAdblockDisabledForHost(host)) return

    void wc.insertCSS(GENERIC_HIDE_CSS, { cssOrigin: 'user' }).catch(() => {})
    void wc.executeJavaScript(GENERIC_MUTATION_GUARD_JS, true).catch(() => {})

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      void wc.executeJavaScript(YOUTUBE_AD_GUARD_JS, true).catch(() => {})
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

      // 2. Ad & Tracker Blocking (including mainFrame $document/$popup matches + subresources)
      if (settings.adBlockGlobal) {
        const tabInfo = details.webContentsId
          ? getTabInfoByWebContentsId(details.webContentsId)
          : null
        const pageHost = tabInfo?.host || extractHostname(details.referrer || '')

        if (!pageHost || !storage.isAdblockDisabledForHost(pageHost)) {
          if (this.matchesExtraRules(details.url, pageHost)) {
            if (details.webContentsId) onRequestBlocked(details.webContentsId)
            callback({ cancel: true })
            return
          }

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
