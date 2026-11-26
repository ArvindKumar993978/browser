import { BaseWindow, Menu, WebContentsView, clipboard } from 'electron'
import { randomUUID } from 'crypto'
import type {
  BrowserStateSnapshot,
  FindInPageResult,
  PanelMode,
  PendingPermissionRequest,
  PermissionKind,
  ReaderArticle,
  TabState
} from '../shared/types'
import type { AdBlockerService } from './adblocker'
import { extractSafeReaderArticle } from './reader'
import type { BrowserStorage } from './storage'
import {
  extractHostname,
  extractOrigin,
  isAllowedWebUrl,
  isPrivateOrLocalHost,
  normalizeAddressInput
} from './url'

export const BASE_TOOLBAR_HEIGHT = 86
const FIND_BAR_HEIGHT = 42
const PERMISSION_BAR_HEIGHT = 44
const PANEL_WIDTH = 360
const SIDEBAR_WIDTH = 224
const SPLIT_GAP = 4
const DEFAULT_START_URLS = [
  'https://www.google.com',
  'https://www.youtube.com',
  'https://duckduckgo.com'
]

interface ManagedTab {
  id: string
  view: WebContentsView | null
  state: TabState
  lastActiveAt: number
}

interface ClosedTabEntry {
  url: string
  title: string
  workspaceId: string
}

interface QueuedPermission {
  request: PendingPermissionRequest
  callback: (granted: boolean) => void
}

export class TabManager {
  public readonly windowId: number
  public readonly isPrivate: boolean
  public readonly window: BaseWindow
  public readonly shellView: WebContentsView
  public readonly sidebarView: WebContentsView
  public readonly panelView: WebContentsView
  public readonly webSession: Electron.Session

  private readonly storage: BrowserStorage
  private readonly adblocker: AdBlockerService
  private readonly onOpenPrivateWindow: () => void
  private readonly tabs: ManagedTab[] = []
  private readonly closedTabs: ClosedTabEntry[] = []
  private readonly permissionQueue: QueuedPermission[] = []

  private activeWorkspaceId = 'personal'
  private activeTabId: string | null = null
  private splitPair: [string, string] | null = null
  private activePanel: PanelMode = 'none'
  private findOpen = false
  private commandPaletteOpen = false
  private isHtmlFullscreen = false
  private readerArticle: ReaderArticle | null = null
  private findResult: FindInPageResult | null = null
  private overlayExtraHeight = 0
  private sleepTimer: ReturnType<typeof setInterval> | null = null
  private sessionSaveTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: {
    windowId: number
    isPrivate: boolean
    window: BaseWindow
    shellView: WebContentsView
    sidebarView: WebContentsView
    panelView: WebContentsView
    webSession: Electron.Session
    storage: BrowserStorage
    adblocker: AdBlockerService
    onOpenPrivateWindow: () => void
  }) {
    this.windowId = options.windowId
    this.isPrivate = options.isPrivate
    this.window = options.window
    this.shellView = options.shellView
    this.sidebarView = options.sidebarView
    this.panelView = options.panelView
    this.webSession = options.webSession
    this.storage = options.storage
    this.adblocker = options.adblocker
    this.onOpenPrivateWindow = options.onOpenPrivateWindow

    this.window.on('resize', () => this.layoutViews())
    this.attachShortcuts(this.shellView.webContents)
    this.attachShortcuts(this.sidebarView.webContents)
    this.attachShortcuts(this.panelView.webContents)
    this.setupPermissions()

    this.sleepTimer = setInterval(() => {
      this.sleepTimedOutTabs()
    }, 30_000)

    if (!this.isPrivate) {
      this.sessionSaveTimer = setInterval(() => {
        this.persistSession()
      }, 15_000)
    }

    this.window.on('close', () => {
      if (!this.isPrivate) {
        this.persistSession()
      }
      if (this.sleepTimer) clearInterval(this.sleepTimer)
      if (this.sessionSaveTimer) clearInterval(this.sessionSaveTimer)
      while (this.permissionQueue.length > 0) {
        const q = this.permissionQueue.shift()
        q?.callback(false)
      }
    })
  }

  public initializeTabs(): void {
    const workspaces = this.storage.getWorkspaces()
    const validWorkspaceIds = new Set(workspaces.map((w) => w.id))
    this.activeWorkspaceId = workspaces[0]?.id ?? 'personal'

    if (!this.isPrivate) {
      const saved = this.storage.loadSessionTabs()
      if (saved.length > 0) {
        let activeTab: ManagedTab | undefined
        for (const item of saved) {
          const wsId = validWorkspaceIds.has(item.workspaceId)
            ? item.workspaceId
            : this.activeWorkspaceId
          const id = this.createTab(item.url, false, item.title, wsId)
          if (item.isActive) {
            activeTab = this.tabs.find((t) => t.id === id)
          }
        }
        const firstTab = activeTab ?? this.tabs[0]
        if (firstTab) {
          this.activeWorkspaceId = firstTab.state.workspaceId
          this.switchTab(firstTab.id)
          return
        }
      }
    }

    const startUrls = this.isPrivate ? ['https://duckduckgo.com'] : DEFAULT_START_URLS
    for (const url of startUrls) {
      this.createTab(url, false, 'New Tab', this.activeWorkspaceId)
    }
    if (this.tabs.length > 0) {
      this.switchTab(this.tabs[0].id)
    }
  }

  public getTabByWebContentsId(webContentsId: number): ManagedTab | undefined {
    return this.tabs.find(
      (t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === webContentsId
    )
  }

  public getActiveTabHost(): string {
    const active = this.tabs.find((t) => t.id === this.activeTabId)
    return active ? extractHostname(active.state.url) : ''
  }

  public reloadActiveTabIfHost(hostname: string): void {
    const active = this.tabs.find((t) => t.id === this.activeTabId)
    if (!active) return
    if (extractHostname(active.state.url) === hostname.toLowerCase()) {
      this.reloadOrStop(active.id)
    }
  }

  public incrementBlockedCount(webContentsId: number): void {
    const tab = this.getTabByWebContentsId(webContentsId)
    if (!tab) return
    tab.state.blockedCount += 1
    if (tab.id === this.activeTabId || this.getSplitPartnerId() === tab.id) {
      this.broadcastState()
    }
  }

  private getSplitPartnerId(): string | null {
    if (!this.splitPair) return null
    const [leftId, rightId] = this.splitPair
    if (this.activeTabId === leftId) return rightId
    if (this.activeTabId === rightId) return leftId
    return null
  }

  public getSnapshot(): BrowserStateSnapshot {
    const activeTab = this.tabs.find((t) => t.id === this.activeTabId) ?? null
    const activeHost = activeTab ? extractHostname(activeTab.state.url) : ''

    return {
      windowId: this.windowId,
      isPrivate: this.isPrivate,
      workspaces: this.storage.getWorkspaces(),
      activeWorkspaceId: this.activeWorkspaceId,
      tabs: this.tabs.map((t) => ({ ...t.state })),
      activeTabId: this.activeTabId,
      splitTabId: this.getSplitPartnerId(),
      canRestoreClosedTab: this.closedTabs.length > 0,
      activePanel: this.activePanel,
      findOpen: this.findOpen,
      commandPaletteOpen: this.commandPaletteOpen,
      readerArticle: this.readerArticle,
      findResult: this.findResult,
      pendingPermission: this.permissionQueue[0]?.request ?? null,
      activeTabAdblockDisabled: activeHost
        ? this.storage.isAdblockDisabledForHost(activeHost)
        : false,
      activeTabBookmarked: activeTab ? this.storage.isBookmarked(activeTab.state.url) : false,
      settings: this.storage.getSettings()
    }
  }

  public getTopBarHeight(): number {
    return (
      BASE_TOOLBAR_HEIGHT +
      (this.findOpen ? FIND_BAR_HEIGHT : 0) +
      (this.permissionQueue.length > 0 ? PERMISSION_BAR_HEIGHT : 0)
    )
  }

  public layoutViews(): void {
    if (this.window.isDestroyed()) return
    const { width, height } = this.window.getContentBounds()
    const safeWidth = Math.max(0, width)
    const safeHeight = Math.max(0, height)

    if (this.isHtmlFullscreen) {
      this.shellView.setVisible(false)
      this.sidebarView.setVisible(false)
      this.panelView.setVisible(false)
      for (const tab of this.tabs) {
        if (!tab.view) continue
        const isActive = tab.id === this.activeTabId
        tab.view.setVisible(isActive)
        if (isActive) {
          tab.view.setBounds({ x: 0, y: 0, width: safeWidth, height: safeHeight })
        }
      }
      return
    }

    this.shellView.setVisible(true)
    const barHeight = this.getTopBarHeight()
    const settings = this.storage.getSettings()
    const activeTab = this.tabs.find((t) => t.id === this.activeTabId) ?? null
    const hasTabError = Boolean(activeTab && (activeTab.state.lastError || activeTab.state.certError))
    const showingFullOverlay =
      hasTabError || this.commandPaletteOpen || this.readerArticle !== null

    const sidebarOpen = settings.verticalTabs && !showingFullOverlay
    const sidebarWidth = sidebarOpen ? Math.min(SIDEBAR_WIDTH, Math.floor(safeWidth * 0.32)) : 0

    const panelOpen = this.activePanel !== 'none' && !showingFullOverlay
    const panelWidth = panelOpen ? Math.min(PANEL_WIDTH, Math.floor(safeWidth * 0.4)) : 0

    const contentX = sidebarWidth
    const contentWidth = Math.max(0, safeWidth - sidebarWidth - panelWidth)
    const contentHeight = Math.max(0, safeHeight - barHeight)

    const shellHeight = showingFullOverlay
      ? safeHeight
      : Math.min(safeHeight, barHeight + this.overlayExtraHeight)

    this.shellView.setBounds({ x: 0, y: 0, width: safeWidth, height: shellHeight })

    if (sidebarOpen) {
      this.sidebarView.setVisible(true)
      this.sidebarView.setBounds({
        x: 0,
        y: barHeight,
        width: sidebarWidth,
        height: contentHeight
      })
    } else {
      this.sidebarView.setVisible(false)
    }

    if (panelOpen) {
      this.panelView.setVisible(true)
      this.panelView.setBounds({
        x: sidebarWidth + contentWidth,
        y: barHeight,
        width: panelWidth,
        height: contentHeight
      })
    } else {
      this.panelView.setVisible(false)
    }

    const splitValid = Boolean(
      this.splitPair &&
        !showingFullOverlay &&
        this.splitPair[0] !== this.splitPair[1] &&
        this.tabs.some((t) => t.id === this.splitPair?.[0]) &&
        this.tabs.some((t) => t.id === this.splitPair?.[1]) &&
        (this.activeTabId === this.splitPair?.[0] || this.activeTabId === this.splitPair?.[1])
    )

    for (const tab of this.tabs) {
      if (!tab.view) continue
      if (showingFullOverlay) {
        tab.view.setVisible(false)
        continue
      }

      if (splitValid && this.splitPair && contentWidth > 100) {
        const [leftId, rightId] = this.splitPair
        if (tab.id !== leftId && tab.id !== rightId) {
          tab.view.setVisible(false)
          continue
        }
        tab.view.setVisible(true)
        const leftWidth = Math.floor((contentWidth - SPLIT_GAP) / 2)
        const rightWidth = Math.max(0, contentWidth - leftWidth - SPLIT_GAP)
        if (tab.id === leftId) {
          tab.view.setBounds({ x: contentX, y: barHeight, width: leftWidth, height: contentHeight })
        } else {
          tab.view.setBounds({
            x: contentX + leftWidth + SPLIT_GAP,
            y: barHeight,
            width: rightWidth,
            height: contentHeight
          })
        }
      } else {
        const isActive = tab.id === this.activeTabId
        tab.view.setVisible(isActive)
        if (isActive) {
          tab.view.setBounds({
            x: contentX,
            y: barHeight,
            width: contentWidth,
            height: contentHeight
          })
        }
      }
    }
  }

  public setOverlayHeight(extraHeight: number): void {
    const clamped = Math.max(0, Math.min(340, Math.round(extraHeight)))
    if (this.overlayExtraHeight === clamped) return
    this.overlayExtraHeight = clamped
    this.layoutViews()
  }

  public setPanelMode(mode: PanelMode): void {
    this.activePanel = this.activePanel === mode ? 'none' : mode
    this.layoutViews()
    this.broadcastState()
  }

  public setCommandPaletteOpen(open: boolean): void {
    this.commandPaletteOpen = open
    this.layoutViews()
    this.broadcastState()
    if (open) {
      this.shellView.webContents.focus()
    } else {
      const active = this.tabs.find((t) => t.id === this.activeTabId)
      active?.view?.webContents.focus()
    }
  }

  public async toggleReaderMode(): Promise<void> {
    if (this.readerArticle) {
      this.readerArticle = null
      this.layoutViews()
      this.broadcastState()
      const active = this.tabs.find((t) => t.id === this.activeTabId)
      active?.view?.webContents.focus()
      return
    }

    const active = this.tabs.find((t) => t.id === this.activeTabId)
    if (!active?.view || active.view.webContents.isDestroyed()) return
    try {
      const article = await extractSafeReaderArticle(active.view.webContents)
      if (!article) return
      this.readerArticle = article
      this.layoutViews()
      this.broadcastState()
    } catch {
      // Ignore extraction failure on protected or non-article pages
    }
  }

  public switchWorkspace(workspaceId: string): void {
    const workspaces = this.storage.getWorkspaces()
    if (!workspaces.some((w) => w.id === workspaceId)) return
    this.activeWorkspaceId = workspaceId
    this.splitPair = null
    this.readerArticle = null
    this.isHtmlFullscreen = false

    const wsTabs = this.tabs.filter((t) => t.state.workspaceId === workspaceId)
    if (wsTabs.length > 0) {
      const latest = wsTabs.reduce((best, cur) =>
        cur.lastActiveAt > best.lastActiveAt ? cur : best
      )
      this.switchTab(latest.id)
    } else {
      this.createTab('https://duckduckgo.com', true, 'New Tab', workspaceId)
    }
  }

  public createWorkspace(name: string): void {
    const ws = this.storage.createWorkspace(name)
    this.switchWorkspace(ws.id)
  }

  public toggleSplitView(targetTabId?: string): void {
    if (!this.activeTabId) return

    if (this.splitPair && (!targetTabId || targetTabId === this.getSplitPartnerId())) {
      this.splitPair = null
      this.layoutViews()
      this.broadcastState()
      return
    }

    if (targetTabId && targetTabId !== this.activeTabId) {
      const target = this.tabs.find((t) => t.id === targetTabId)
      if (!target) return
      if (target.state.isSleeping || !target.view || target.view.webContents.isDestroyed()) {
        this.mountTabWebView(target)
      }
      this.splitPair = [this.activeTabId, targetTabId]
      this.layoutViews()
      this.broadcastState()
      return
    }

    const candidate = this.tabs.find(
      (t) => t.state.workspaceId === this.activeWorkspaceId && t.id !== this.activeTabId
    )
    if (candidate) {
      if (candidate.state.isSleeping || !candidate.view || candidate.view.webContents.isDestroyed()) {
        this.mountTabWebView(candidate)
      }
      this.splitPair = [this.activeTabId, candidate.id]
      this.layoutViews()
      this.broadcastState()
      return
    }

    const newId = this.createTab('https://duckduckgo.com', false, 'New Tab', this.activeWorkspaceId)
    this.splitPair = [this.activeTabId, newId]
    this.layoutViews()
    this.broadcastState()
  }

  public swapSplitPanes(): void {
    if (!this.splitPair) return
    this.splitPair = [this.splitPair[1], this.splitPair[0]]
    this.layoutViews()
    this.broadcastState()
  }

  public setFindOpen(open: boolean): void {
    const active = this.tabs.find((t) => t.id === this.activeTabId)
    if (open && active && (active.state.lastError || active.state.certError)) {
      return
    }
    this.findOpen = open
    if (!open) {
      this.findResult = null
      if (active?.view && !active.view.webContents.isDestroyed()) {
        active.view.webContents.stopFindInPage('clearSelection')
      }
    }
    this.layoutViews()
    this.broadcastState()
  }

  public findInPage(tabId: string, query: string, forward = true, findNext = false): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab?.view || tab.view.webContents.isDestroyed()) return
    const trimmed = query.trim()
    if (!trimmed) {
      tab.view.webContents.stopFindInPage('clearSelection')
      this.findResult = null
      this.broadcastState()
      return
    }
    this.findResult = {
      tabId,
      query: trimmed,
      activeMatchOrdinal: this.findResult?.query === trimmed ? this.findResult.activeMatchOrdinal : 0,
      matches: this.findResult?.query === trimmed ? this.findResult.matches : 0
    }
    tab.view.webContents.findInPage(trimmed, { forward, findNext })
  }

  public createTab(
    rawUrl?: string,
    activate = true,
    initialTitle = 'New Tab',
    workspaceId = this.activeWorkspaceId
  ): string {
    const settings = this.storage.getSettings()
    const targetUrl = rawUrl
      ? normalizeAddressInput(rawUrl, settings.httpsFirst)
      : 'https://duckduckgo.com'
    const id = randomUUID()

    const state: TabState = {
      id,
      workspaceId,
      title: initialTitle,
      url: targetUrl,
      favicon: null,
      isLoading: true,
      isSleeping: false,
      canGoBack: false,
      canGoForward: false,
      isSecure: targetUrl.startsWith('https://'),
      zoomFactor: 1,
      blockedCount: 0,
      lastError: null,
      certError: null,
      canContinueOverHttp: false
    }

    const managed: ManagedTab = {
      id,
      view: null,
      state,
      lastActiveAt: Date.now()
    }

    this.tabs.push(managed)
    this.mountTabWebView(managed)

    if (activate) {
      this.activeWorkspaceId = workspaceId
      this.switchTab(id)
    } else {
      this.broadcastState()
    }

    return id
  }

  private mountTabWebView(tab: ManagedTab): void {
    const view = new WebContentsView({
      webPreferences: {
        session: this.webSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: true
      }
    })

    tab.view = view
    tab.state.isSleeping = false
    tab.state.isLoading = true
    tab.state.lastError = null
    tab.state.certError = null
    tab.state.canContinueOverHttp = false

    this.window.contentView.addChildView(view, 0)
    view.setVisible(false)

    this.wireTabEvents(tab, view)
    this.attachShortcuts(view.webContents)

    void view.webContents.loadURL(tab.state.url).catch(() => {})
  }

  public switchTab(tabId: string): void {
    const target = this.tabs.find((t) => t.id === tabId)
    if (!target) return

    const prev = this.tabs.find((t) => t.id === this.activeTabId)
    if (prev && prev.id !== tabId) {
      prev.lastActiveAt = Date.now()
    }

    if (target.state.workspaceId !== this.activeWorkspaceId) {
      this.activeWorkspaceId = target.state.workspaceId
      this.splitPair = null
    } else if (
      this.splitPair &&
      this.splitPair[0] !== tabId &&
      this.splitPair[1] !== tabId
    ) {
      this.splitPair = null
    }

    this.activeTabId = tabId
    this.isHtmlFullscreen = false
    this.readerArticle = null
    this.commandPaletteOpen = false
    target.lastActiveAt = Date.now()

    if (target.state.isSleeping || !target.view || target.view.webContents.isDestroyed()) {
      this.mountTabWebView(target)
    }

    this.findResult = null
    this.layoutViews()
    target.view?.webContents.focus()
    this.broadcastState()
  }

  public closeTab(tabId: string): void {
    const index = this.tabs.findIndex((t) => t.id === tabId)
    if (index === -1) return

    const [removed] = this.tabs.splice(index, 1)
    if (!this.isPrivate && isAllowedWebUrl(removed.state.url)) {
      this.closedTabs.push({
        url: removed.state.url,
        title: removed.state.title,
        workspaceId: removed.state.workspaceId
      })
      if (this.closedTabs.length > 20) this.closedTabs.shift()
    }

    if (this.splitPair && (this.splitPair[0] === tabId || this.splitPair[1] === tabId)) {
      this.splitPair = null
    }

    this.destroyTabView(removed)

    const wsRemaining = this.tabs.filter((t) => t.state.workspaceId === this.activeWorkspaceId)
    if (wsRemaining.length === 0) {
      this.activeTabId = null
      this.createTab('https://duckduckgo.com', true, 'New Tab', this.activeWorkspaceId)
      return
    }

    if (this.activeTabId === tabId) {
      this.switchTab(wsRemaining[wsRemaining.length - 1].id)
    } else {
      this.layoutViews()
      this.broadcastState()
    }
  }

  public restoreClosedTab(): void {
    const entry = this.closedTabs.pop()
    if (!entry) return
    this.createTab(entry.url, true, entry.title, entry.workspaceId)
  }

  public reorderTab(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.tabs.length ||
      toIndex >= this.tabs.length ||
      fromIndex === toIndex
    ) {
      return
    }
    const [moved] = this.tabs.splice(fromIndex, 1)
    this.tabs.splice(toIndex, 0, moved)
    this.broadcastState()
  }

  public sleepInactiveTabs(): number {
    let slept = 0
    const splitPartner = this.getSplitPartnerId()
    for (const tab of this.tabs) {
      if (
        tab.id === this.activeTabId ||
        tab.id === splitPartner ||
        tab.state.isSleeping ||
        !tab.view
      ) {
        continue
      }
      const wc = tab.view.webContents
      if (wc.isDestroyed() || wc.isCurrentlyAudible() || tab.state.isLoading) continue
      this.sleepTab(tab)
      slept += 1
    }
    if (slept > 0) this.broadcastState()
    return slept
  }

  private sleepTimedOutTabs(): void {
    const minutes = this.storage.getSettings().sleepAfterMinutes
    if (minutes <= 0) return
    const cutoff = Date.now() - minutes * 60_000
    const splitPartner = this.getSplitPartnerId()
    let slept = 0

    for (const tab of this.tabs) {
      if (
        tab.id === this.activeTabId ||
        tab.id === splitPartner ||
        tab.state.isSleeping ||
        !tab.view
      ) {
        continue
      }
      if (tab.lastActiveAt > cutoff) continue
      const wc = tab.view.webContents
      if (wc.isDestroyed() || wc.isCurrentlyAudible() || tab.state.isLoading) continue
      this.sleepTab(tab)
      slept += 1
    }
    if (slept > 0) this.broadcastState()
  }

  private sleepTab(tab: ManagedTab): void {
    this.destroyTabView(tab)
    tab.state.isSleeping = true
    tab.state.isLoading = false
  }

  private destroyTabView(tab: ManagedTab): void {
    if (!tab.view) return
    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(tab.view)
    }
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
    tab.view = null
  }

  public navigate(tabId: string, rawInput: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const settings = this.storage.getSettings()
    const candidateHost = extractHostname(rawInput.trim())
    const useHttpsFirst = settings.httpsFirst && !this.adblocker.isHttpFallbackAllowed(candidateHost)
    const url = normalizeAddressInput(rawInput, useHttpsFirst)

    tab.state.lastError = null
    tab.state.certError = null
    tab.state.canContinueOverHttp = false
    tab.state.blockedCount = 0
    tab.state.url = url
    tab.state.isSecure = url.startsWith('https://')
    this.readerArticle = null

    if (!tab.view || tab.view.webContents.isDestroyed()) {
      this.mountTabWebView(tab)
    } else {
      void tab.view.webContents.loadURL(url).catch(() => {})
    }

    this.layoutViews()
    this.broadcastState()
    tab.view?.webContents.focus()
  }

  public continueOverHttp(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const host = extractHostname(tab.state.url)
    if (!host) return
    this.adblocker.allowHttpFallbackForHost(host)
    const httpUrl = tab.state.url.replace(/^https:\/\//i, 'http://')
    tab.state.lastError = null
    tab.state.certError = null
    tab.state.canContinueOverHttp = false
    tab.state.url = httpUrl
    tab.state.isSecure = false

    if (!tab.view || tab.view.webContents.isDestroyed()) {
      this.mountTabWebView(tab)
    } else {
      void tab.view.webContents.loadURL(httpUrl).catch(() => {})
    }

    this.layoutViews()
    this.broadcastState()
  }

  public goBack(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab?.view || tab.view.webContents.isDestroyed()) return
    if (tab.view.webContents.navigationHistory.canGoBack()) {
      tab.state.lastError = null
      tab.state.certError = null
      tab.state.canContinueOverHttp = false
      this.readerArticle = null
      tab.view.webContents.navigationHistory.goBack()
      this.layoutViews()
    }
  }

  public goForward(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab?.view || tab.view.webContents.isDestroyed()) return
    if (tab.view.webContents.navigationHistory.canGoForward()) {
      tab.state.lastError = null
      tab.state.certError = null
      tab.state.canContinueOverHttp = false
      this.readerArticle = null
      tab.view.webContents.navigationHistory.goForward()
      this.layoutViews()
    }
  }

  public reloadOrStop(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    this.readerArticle = null
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      this.mountTabWebView(tab)
      this.layoutViews()
      this.broadcastState()
      return
    }
    if (tab.view.webContents.isLoading()) {
      tab.view.webContents.stop()
      return
    }
    tab.state.lastError = null
    tab.state.certError = null
    tab.state.canContinueOverHttp = false
    tab.state.blockedCount = 0
    this.layoutViews()
    if (tab.view.webContents.getURL()) {
      tab.view.webContents.reload()
    } else {
      void tab.view.webContents.loadURL(tab.state.url).catch(() => {})
    }
  }

  public setZoom(tabId: string, action: 'in' | 'out' | 'reset'): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab?.view || tab.view.webContents.isDestroyed()) return
    const current = tab.view.webContents.getZoomFactor()
    let next = 1
    if (action === 'in') next = Math.min(2.5, Math.round((current + 0.1) * 10) / 10)
    if (action === 'out') next = Math.max(0.5, Math.round((current - 0.1) * 10) / 10)
    tab.view.webContents.setZoomFactor(next)
    tab.state.zoomFactor = next
    this.broadcastState()
  }

  public respondPermission(
    requestId: string,
    decision: 'allow-once' | 'allow-always' | 'deny-always' | 'deny-once'
  ): void {
    const index = this.permissionQueue.findIndex((q) => q.request.requestId === requestId)
    if (index === -1) return
    const [entry] = this.permissionQueue.splice(index, 1)
    const granted = decision === 'allow-once' || decision === 'allow-always'

    if (!this.isPrivate && (decision === 'allow-always' || decision === 'deny-always')) {
      const storeVal = decision === 'allow-always' ? 'allow' : 'deny'
      if (entry.request.permission === 'camera-and-microphone') {
        this.storage.setPermission(entry.request.origin, 'camera', storeVal)
        this.storage.setPermission(entry.request.origin, 'microphone', storeVal)
      } else {
        this.storage.setPermission(entry.request.origin, entry.request.permission, storeVal)
      }
    }

    entry.callback(granted)
    this.layoutViews()
    this.broadcastState()
  }

  public broadcastState(): void {
    if (this.window.isDestroyed()) return
    const snapshot = this.getSnapshot()
    if (!this.shellView.webContents.isDestroyed()) {
      this.shellView.webContents.send('browser:state-changed', snapshot)
    }
    if (!this.sidebarView.webContents.isDestroyed()) {
      this.sidebarView.webContents.send('browser:state-changed', snapshot)
    }
    if (!this.panelView.webContents.isDestroyed()) {
      this.panelView.webContents.send('browser:state-changed', snapshot)
    }
  }

  private persistSession(): void {
    if (this.isPrivate) return
    const sessionTabs = this.tabs
      .filter((t) => isAllowedWebUrl(t.state.url))
      .map((t) => ({
        url: t.state.url,
        title: t.state.title,
        workspaceId: t.state.workspaceId,
        isActive: t.id === this.activeTabId
      }))
    this.storage.saveSessionTabs(sessionTabs)
  }

  private setupPermissions(): void {
    const mapElectronPermission = (
      permission: string,
      details: Electron.PermissionRequestHandlerHandlerDetails | Electron.PermissionCheckHandlerHandlerDetails
    ): PermissionKind | null => {
      if (permission === 'media') {
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
        const hasVideo = mediaTypes?.includes('video') ?? false
        const hasAudio = mediaTypes?.includes('audio') ?? false
        if (hasVideo && hasAudio) return 'camera-and-microphone'
        if (hasAudio && !hasVideo) return 'microphone'
        return 'camera'
      }
      if (permission === 'geolocation') return 'location'
      if (permission === 'notifications') return 'notifications'
      return null
    }

    const readSavedPermission = (origin: string, kind: PermissionKind): 'allow' | 'deny' | null => {
      // Private windows never inherit normal-window saved permissions
      if (this.isPrivate) return null
      if (kind === 'camera-and-microphone') {
        const cam = this.storage.getPermission(origin, 'camera')
        const mic = this.storage.getPermission(origin, 'microphone')
        if (cam === 'allow' && mic === 'allow') return 'allow'
        if (cam === 'deny' || mic === 'deny') return 'deny'
        return null
      }
      return this.storage.getPermission(origin, kind)
    }

    this.webSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      if (permission === 'fullscreen') return true
      if (this.isPrivate) return false
      const kind = mapElectronPermission(permission, details)
      if (!kind) return false
      const origin = extractOrigin(requestingOrigin)
      if (!origin) return false
      return readSavedPermission(origin, kind) === 'allow'
    })

    this.webSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (permission === 'fullscreen') {
        callback(true)
        return
      }
      const kind = mapElectronPermission(permission, details)
      if (!kind) {
        callback(false)
        return
      }

      const origin = extractOrigin(details.requestingUrl || wc.getURL())
      if (!origin) {
        callback(false)
        return
      }

      const saved = readSavedPermission(origin, kind)
      if (saved === 'allow') {
        callback(true)
        return
      }
      if (saved === 'deny') {
        callback(false)
        return
      }

      const tab = this.getTabByWebContentsId(wc.id)
      const request: PendingPermissionRequest = {
        requestId: randomUUID(),
        tabId: tab?.id ?? this.activeTabId ?? '',
        origin,
        permission: kind
      }

      this.permissionQueue.push({ request, callback })
      this.layoutViews()
      this.broadcastState()
    })
  }

  private wireTabEvents(tab: ManagedTab, view: WebContentsView): void {
    const wc = view.webContents

    const syncNavFlags = () => {
      if (wc.isDestroyed()) return
      const currentUrl = wc.getURL() || tab.state.url
      tab.state.url = currentUrl
      tab.state.isSecure = currentUrl.startsWith('https://')
      tab.state.canGoBack = wc.navigationHistory.canGoBack()
      tab.state.canGoForward = wc.navigationHistory.canGoForward()
      tab.state.zoomFactor = wc.getZoomFactor()
      this.broadcastState()
    }

    // Focusing a split-view pane switches the toolbar/address-bar target to that pane
    wc.on('focus', () => {
      if (this.splitPair && this.activeTabId !== tab.id) {
        if (this.splitPair[0] === tab.id || this.splitPair[1] === tab.id) {
          this.activeTabId = tab.id
          this.broadcastState()
        }
      }
    })

    wc.on('enter-html-full-screen', () => {
      this.isHtmlFullscreen = true
      if (!this.window.isFullScreen()) {
        this.window.setFullScreen(true)
      }
      this.layoutViews()
    })

    wc.on('leave-html-full-screen', () => {
      this.isHtmlFullscreen = false
      if (this.window.isFullScreen()) {
        this.window.setFullScreen(false)
      }
      this.layoutViews()
    })

    wc.on('zoom-changed', () => {
      if (wc.isDestroyed()) return
      tab.state.zoomFactor = wc.getZoomFactor()
      this.broadcastState()
    })

    wc.on('context-menu', (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = []

      if (params.linkURL && isAllowedWebUrl(params.linkURL)) {
        template.push(
          {
            label: 'Open Link in New Tab',
            click: () => this.createTab(params.linkURL, true, 'New Tab', tab.state.workspaceId)
          },
          {
            label: 'Open Link in Split View',
            click: () => {
              const newId = this.createTab(params.linkURL, false, 'New Tab', tab.state.workspaceId)
              this.splitPair = [tab.id, newId]
              this.layoutViews()
              this.broadcastState()
            }
          },
          {
            label: 'Copy Link Address',
            click: () => clipboard.writeText(params.linkURL)
          },
          { type: 'separator' }
        )
      }

      if (params.mediaType === 'image' && params.srcURL && isAllowedWebUrl(params.srcURL)) {
        template.push(
          {
            label: 'Open Image in New Tab',
            click: () => this.createTab(params.srcURL, true, 'Image', tab.state.workspaceId)
          },
          {
            label: 'Save Image As...',
            click: () => wc.downloadURL(params.srcURL)
          },
          {
            label: 'Copy Image Address',
            click: () => clipboard.writeText(params.srcURL)
          },
          { type: 'separator' }
        )
      }

      if (params.isEditable) {
        template.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' }
        )
      } else if (params.selectionText.trim()) {
        const selected = params.selectionText.trim()
        template.push(
          { role: 'copy' },
          {
            label: `Search DuckDuckGo for "${selected.slice(0, 28)}${selected.length > 28 ? '…' : ''}"`,
            click: () =>
              this.createTab(
                `https://duckduckgo.com/?q=${encodeURIComponent(selected)}`,
                true,
                'Search',
                tab.state.workspaceId
              )
          },
          { type: 'separator' }
        )
      }

      template.push(
        {
          label: 'Back',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => this.goBack(tab.id)
        },
        {
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => this.goForward(tab.id)
        },
        {
          label: 'Reload',
          click: () => this.reloadOrStop(tab.id)
        },
        { type: 'separator' },
        {
          label: 'Inspect Element',
          click: () => wc.inspectElement(params.x, params.y)
        }
      )

      const menu = Menu.buildFromTemplate(template)
      menu.popup({ window: this.window })
    })

    wc.on('dom-ready', () => {
      this.adblocker.applyCosmetics(wc, wc.getURL() || tab.state.url, this.storage)
    })

    wc.on('did-start-loading', () => {
      tab.state.isLoading = true
      tab.state.lastError = null
      tab.state.certError = null
      tab.state.canContinueOverHttp = false
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('did-stop-loading', () => {
      tab.state.isLoading = false
      syncNavFlags()
      if (!this.isPrivate && !tab.state.lastError && !tab.state.certError) {
        this.storage.addHistory(tab.state.url, tab.state.title)
      }
    })

    wc.on('page-title-updated', (_event, title) => {
      tab.state.title = title || tab.state.url
      this.broadcastState()
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      tab.state.favicon = favicons[0] ?? null
      this.broadcastState()
    })

    wc.on('did-navigate', (_event, url) => {
      tab.state.url = url
      tab.state.blockedCount = 0
      tab.state.isSecure = url.startsWith('https://')
      syncNavFlags()
    })

    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.state.url = url
      tab.state.isSecure = url.startsWith('https://')
      this.adblocker.applyCosmetics(wc, url, this.storage)
      syncNavFlags()
    })

    wc.on('found-in-page', (_event, result) => {
      if (!this.findOpen) return
      this.findResult = {
        tabId: tab.id,
        query: this.findResult?.query ?? '',
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      }
      this.broadcastState()
    })

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      tab.state.isLoading = false
      if (validatedURL) tab.state.url = validatedURL

      const failedUrl = tab.state.url
      const host = extractHostname(failedUrl)
      const isCertCode = errorCode <= -200 && errorCode >= -299

      if (isCertCode) {
        tab.state.certError = `${errorDescription} (${errorCode})`
        tab.state.canContinueOverHttp = false
      } else {
        tab.state.lastError = `${errorDescription} (${errorCode})`
        tab.state.canContinueOverHttp =
          failedUrl.startsWith('https://') && Boolean(host) && !isPrivateOrLocalHost(host)
      }
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('certificate-error', (event, url, error) => {
      event.preventDefault()
      tab.state.isLoading = false
      tab.state.url = url
      tab.state.isSecure = false
      tab.state.canContinueOverHttp = false
      tab.state.certError = `Untrusted TLS certificate (${error})`
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('render-process-gone', (_event, details) => {
      tab.state.isLoading = false
      tab.state.canContinueOverHttp = false
      tab.state.lastError = `Tab crashed (${details.reason}). Click reload to recover.`
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('will-navigate', (event, url) => {
      if (!isAllowedWebUrl(url)) {
        event.preventDefault()
      }
    })

    wc.on('will-redirect', (event, url) => {
      if (!isAllowedWebUrl(url)) {
        event.preventDefault()
      }
    })

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!isAllowedWebUrl(url)) {
        return { action: 'deny' }
      }

      const isOAuthOrPopup =
        disposition === 'new-window' ||
        /\b(width|height)=/i.test(features) ||
        /accounts\.google\.com|github\.com\/login\/oauth|login\.microsoftonline\.com|appleid\.apple\.com|facebook\.com\/.*\/dialog\/oauth/i.test(
          url
        )

      if (isOAuthOrPopup) {
        // Preserve window.opener inside a strictly sandboxed popup window for OAuth flows
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            backgroundColor: '#0f1117',
            webPreferences: {
              session: this.webSession,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webviewTag: false,
              webSecurity: true,
              allowRunningInsecureContent: false
            }
          }
        }
      }

      this.createTab(url, true, 'New Tab', tab.state.workspaceId)
      return { action: 'deny' }
    })

    wc.on('did-create-window', (popupWindow) => {
      const pwc = popupWindow.webContents
      pwc.on('will-navigate', (event, url) => {
        if (!isAllowedWebUrl(url)) event.preventDefault()
      })
      pwc.on('will-redirect', (event, url) => {
        if (!isAllowedWebUrl(url)) event.preventDefault()
      })
      pwc.setWindowOpenHandler(({ url }) => {
        if (isAllowedWebUrl(url)) {
          this.createTab(url, true, 'New Tab', tab.state.workspaceId)
        }
        return { action: 'deny' }
      })
    })
  }

  private attachShortcuts(wc: Electron.WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = input.control || input.meta
      const key = input.key.toLowerCase()

      if (input.key === 'Escape' && this.isHtmlFullscreen) {
        this.isHtmlFullscreen = false
        if (this.window.isFullScreen()) this.window.setFullScreen(false)
        this.layoutViews()
        return
      }
      if (input.key === 'Escape' && this.commandPaletteOpen) {
        event.preventDefault()
        this.setCommandPaletteOpen(false)
        return
      }
      if (input.key === 'F12' || (mod && input.shift && key === 'i')) {
        const active = this.tabs.find((t) => t.id === this.activeTabId)
        if (active?.view && !active.view.webContents.isDestroyed()) {
          event.preventDefault()
          active.view.webContents.toggleDevTools()
        }
        return
      }
      if (mod && key === 'k') {
        event.preventDefault()
        this.setCommandPaletteOpen(!this.commandPaletteOpen)
        return
      }
      if (mod && key === '\\') {
        event.preventDefault()
        this.toggleSplitView()
        return
      }
      if (mod && input.alt && key === 'r') {
        event.preventDefault()
        void this.toggleReaderMode()
        return
      }
      if (mod && input.shift && key === 't') {
        event.preventDefault()
        this.restoreClosedTab()
        return
      }
      if (mod && input.shift && key === 'n') {
        event.preventDefault()
        this.onOpenPrivateWindow()
        return
      }
      if (mod && key === 't') {
        event.preventDefault()
        this.createTab('https://duckduckgo.com', true, 'New Tab', this.activeWorkspaceId)
        return
      }
      if (mod && key === 'w' && this.activeTabId) {
        event.preventDefault()
        this.closeTab(this.activeTabId)
        return
      }
      if (mod && key === 'l') {
        event.preventDefault()
        this.shellView.webContents.focus()
        this.shellView.webContents.send('browser:focus-address-bar')
        return
      }
      if (mod && key === 'f') {
        event.preventDefault()
        this.setFindOpen(true)
        this.shellView.webContents.focus()
        return
      }
      if (mod && key === 'h') {
        event.preventDefault()
        this.setPanelMode('history')
        return
      }
      if (mod && key === 'j') {
        event.preventDefault()
        this.setPanelMode('downloads')
        return
      }
      if (mod && key === 'b') {
        event.preventDefault()
        this.setPanelMode('bookmarks')
        return
      }
      if ((mod && key === 'r') || input.key === 'F5') {
        if (this.activeTabId) {
          event.preventDefault()
          this.reloadOrStop(this.activeTabId)
        }
        return
      }
      if (mod && (key === '=' || key === '+') && this.activeTabId) {
        event.preventDefault()
        this.setZoom(this.activeTabId, 'in')
        return
      }
      if (mod && key === '-' && this.activeTabId) {
        event.preventDefault()
        this.setZoom(this.activeTabId, 'out')
        return
      }
      if (mod && key === '0' && this.activeTabId) {
        event.preventDefault()
        this.setZoom(this.activeTabId, 'reset')
        return
      }
      if (input.alt && input.key === 'ArrowLeft' && this.activeTabId) {
        event.preventDefault()
        this.goBack(this.activeTabId)
        return
      }
      if (input.alt && input.key === 'ArrowRight' && this.activeTabId) {
        event.preventDefault()
        this.goForward(this.activeTabId)
        return
      }
      if (mod && input.key === 'Tab' && this.activeTabId) {
        const wsTabs = this.tabs.filter((t) => t.state.workspaceId === this.activeWorkspaceId)
        if (wsTabs.length > 1) {
          event.preventDefault()
          const idx = wsTabs.findIndex((t) => t.id === this.activeTabId)
          const delta = input.shift ? -1 : 1
          const nextIdx = (idx + delta + wsTabs.length) % wsTabs.length
          this.switchTab(wsTabs[nextIdx].id)
        }
      }
    })
  }
}
