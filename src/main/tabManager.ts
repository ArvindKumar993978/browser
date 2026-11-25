import { BaseWindow, WebContentsView } from 'electron'
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
import { extractHostname, extractOrigin, isAllowedWebUrl, normalizeAddressInput } from './url'

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
  private splitTabId: string | null = null
  private activePanel: PanelMode = 'none'
  private findOpen = false
  private commandPaletteOpen = false
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

  public incrementBlockedCount(webContentsId: number): void {
    const tab = this.getTabByWebContentsId(webContentsId)
    if (!tab) return
    tab.state.blockedCount += 1
    if (tab.id === this.activeTabId || tab.id === this.splitTabId) {
      this.broadcastState()
    }
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
      splitTabId: this.splitTabId,
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

    const splitActive = Boolean(
      this.splitTabId &&
        this.splitTabId !== this.activeTabId &&
        !showingFullOverlay &&
        this.tabs.some((t) => t.id === this.splitTabId)
    )

    for (const tab of this.tabs) {
      if (!tab.view) continue
      const isPrimary = tab.id === this.activeTabId && !showingFullOverlay
      const isSecondary = splitActive && tab.id === this.splitTabId

      if (!isPrimary && !isSecondary) {
        tab.view.setVisible(false)
        continue
      }

      tab.view.setVisible(true)
      if (splitActive && contentWidth > 100) {
        const leftWidth = Math.floor((contentWidth - SPLIT_GAP) / 2)
        const rightWidth = Math.max(0, contentWidth - leftWidth - SPLIT_GAP)
        if (isPrimary) {
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
        tab.view.setBounds({
          x: contentX,
          y: barHeight,
          width: contentWidth,
          height: contentHeight
        })
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
    this.splitTabId = null
    this.readerArticle = null

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
    if (this.splitTabId && (!targetTabId || targetTabId === this.splitTabId)) {
      this.splitTabId = null
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
      this.splitTabId = targetTabId
      this.layoutViews()
      this.broadcastState()
      return
    }

    // Pick another tab in current workspace or create one side-by-side
    const candidate = this.tabs.find(
      (t) => t.state.workspaceId === this.activeWorkspaceId && t.id !== this.activeTabId
    )
    if (candidate) {
      if (candidate.state.isSleeping || !candidate.view || candidate.view.webContents.isDestroyed()) {
        this.mountTabWebView(candidate)
      }
      this.splitTabId = candidate.id
      this.layoutViews()
      this.broadcastState()
      return
    }

    const newId = this.createTab('https://duckduckgo.com', false, 'New Tab', this.activeWorkspaceId)
    this.splitTabId = newId
    this.layoutViews()
    this.broadcastState()
  }

  public setFindOpen(open: boolean): void {
    this.findOpen = open
    if (!open) {
      this.findResult = null
      const active = this.tabs.find((t) => t.id === this.activeTabId)
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
      certError: null
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
      this.splitTabId = null
    }
    if (this.splitTabId === tabId) {
      this.splitTabId = null
    }

    this.activeTabId = tabId
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

    if (this.splitTabId === tabId) {
      this.splitTabId = null
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
    for (const tab of this.tabs) {
      if (
        tab.id === this.activeTabId ||
        tab.id === this.splitTabId ||
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
    let slept = 0

    for (const tab of this.tabs) {
      if (
        tab.id === this.activeTabId ||
        tab.id === this.splitTabId ||
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
    this.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
    tab.view = null
  }

  public navigate(tabId: string, rawInput: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const settings = this.storage.getSettings()
    const url = normalizeAddressInput(rawInput, settings.httpsFirst)
    tab.state.lastError = null
    tab.state.certError = null
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

  public goBack(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab?.view || tab.view.webContents.isDestroyed()) return
    if (tab.view.webContents.navigationHistory.canGoBack()) {
      tab.state.lastError = null
      tab.state.certError = null
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

    if (decision === 'allow-always' && !this.isPrivate) {
      this.storage.setPermission(entry.request.origin, entry.request.permission, 'allow')
    } else if (decision === 'deny-always' && !this.isPrivate) {
      this.storage.setPermission(entry.request.origin, entry.request.permission, 'deny')
    }

    entry.callback(granted)
    this.layoutViews()
    this.broadcastState()
  }

  public broadcastState(): void {
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
        if (mediaTypes?.includes('audio') && !mediaTypes.includes('video')) return 'microphone'
        return 'camera'
      }
      if (permission === 'geolocation') return 'location'
      if (permission === 'notifications') return 'notifications'
      return null
    }

    this.webSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      if (permission === 'fullscreen') return true
      const kind = mapElectronPermission(permission, details)
      if (!kind) return false
      const origin = extractOrigin(requestingOrigin)
      if (!origin) return false
      return this.storage.getPermission(origin, kind) === 'allow'
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

      const saved = this.storage.getPermission(origin, kind)
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

    wc.on('did-start-loading', () => {
      tab.state.isLoading = true
      tab.state.lastError = null
      tab.state.certError = null
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

      if (errorCode <= -200 && errorCode >= -299) {
        tab.state.certError = `${errorDescription} (${errorCode})`
      } else {
        tab.state.lastError = `${errorDescription} (${errorCode})`
      }
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('certificate-error', (event, url, error) => {
      event.preventDefault()
      tab.state.isLoading = false
      tab.state.url = url
      tab.state.isSecure = false
      tab.state.certError = `Untrusted TLS certificate (${error})`
      this.layoutViews()
      this.broadcastState()
    })

    wc.on('render-process-gone', (_event, details) => {
      tab.state.isLoading = false
      tab.state.lastError = `Tab crashed (${details.reason}). Click reload to recover.`
      this.layoutViews()
      this.broadcastState()
    })

    // Strict protocol enforcement on navigations and HTTP redirects
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

    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedWebUrl(url)) {
        this.createTab(url, true, 'New Tab', tab.state.workspaceId)
      }
      return { action: 'deny' }
    })
  }

  private attachShortcuts(wc: Electron.WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = input.control || input.meta
      const key = input.key.toLowerCase()

      if (input.key === 'Escape' && this.commandPaletteOpen) {
        event.preventDefault()
        this.setCommandPaletteOpen(false)
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
