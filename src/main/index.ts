import { app, BaseWindow, ipcMain, session, shell, WebContentsView } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import type {
  BrowserSettings,
  ClearBrowsingDataOptions,
  DownloadItem,
  PanelMode,
  PermissionKind,
  UpdateState
} from '../shared/types'
import { AdBlockerService } from './adblocker'
import { BrowserStorage } from './storage'
import { BASE_TOOLBAR_HEIGHT, TabManager } from './tabManager'
import { UpdaterService } from './updater'
import { extractHostname, isAllowedWebUrl } from './url'

let storage: BrowserStorage
let adblocker: AdBlockerService
let updater: UpdaterService

const managers = new Map<number, TabManager>()
const senderToManager = new Map<number, TabManager>()
const activeDownloads = new Map<string, Electron.DownloadItem>()
const wiredDownloadSessions = new WeakSet<Electron.Session>()

function getUniqueDownloadPath(filename: string): string {
  const downloadsDir = app.getPath('downloads')
  const safeName = basename(filename || 'download')
  const ext = extname(safeName)
  const stem = ext ? safeName.slice(0, -ext.length) : safeName

  let candidate = join(downloadsDir, safeName)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(downloadsDir, `${stem} (${counter})${ext}`)
    counter += 1
  }
  return candidate
}

function broadcastUpdateState(state: UpdateState): void {
  for (const manager of managers.values()) {
    if (!manager.shellView.webContents.isDestroyed()) {
      manager.shellView.webContents.send('browser:update-state-changed', state)
    }
    if (!manager.panelView.webContents.isDestroyed()) {
      manager.panelView.webContents.send('browser:update-state-changed', state)
    }
  }
}

function broadcastDownloads(): void {
  const list = storage.getDownloads()
  for (const manager of managers.values()) {
    if (!manager.shellView.webContents.isDestroyed()) {
      manager.shellView.webContents.send('browser:downloads-changed', list)
    }
    if (!manager.panelView.webContents.isDestroyed()) {
      manager.panelView.webContents.send('browser:downloads-changed', list)
    }
  }
}

function wireSessionDownloads(webSession: Electron.Session): void {
  if (wiredDownloadSessions.has(webSession)) return
  wiredDownloadSessions.add(webSession)

  webSession.on('will-download', (_event, item) => {
    const id = randomUUID()
    const savePath = getUniqueDownloadPath(item.getFilename())
    item.setSavePath(savePath)
    activeDownloads.set(id, item)

    const record: DownloadItem = {
      id,
      url: item.getURL(),
      filename: basename(savePath),
      savePath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: item.getReceivedBytes(),
      state: 'progressing',
      startedAt: Date.now()
    }
    storage.upsertDownload(record)
    broadcastDownloads()

    item.on('updated', (_e, state) => {
      record.receivedBytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes()
      record.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      storage.upsertDownload(record)
      broadcastDownloads()
    })

    item.once('done', (_e, state) => {
      activeDownloads.delete(id)
      record.receivedBytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes()
      record.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      storage.upsertDownload(record)
      broadcastDownloads()
    })
  })
}

function createShellWebView(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true
    }
  })
}

function createBrowserWindow(isPrivate = false): TabManager {
  const partition = isPrivate ? `private-${randomUUID()}` : 'persist:web-default'
  const webSession = session.fromPartition(partition)

  const devIconPath = join(__dirname, '../../build/icon.png')
  const win = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 680,
    minHeight: 440,
    icon: existsSync(devIconPath) ? devIconPath : undefined,
    backgroundColor: isPrivate ? '#120f1d' : '#0f1117',
    title: isPrivate ? 'Orbit Private Window' : 'Orbit Browser',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isPrivate ? '#120f1d' : '#0f1117',
      symbolColor: '#cbd5e1',
      height: 38
    }
  })

  const shellView = createShellWebView()
  const sidebarView = createShellWebView()
  const panelView = createShellWebView()

  win.contentView.addChildView(shellView)
  win.contentView.addChildView(sidebarView)
  win.contentView.addChildView(panelView)
  sidebarView.setVisible(false)
  panelView.setVisible(false)

  const { width } = win.getContentBounds()
  shellView.setBounds({ x: 0, y: 0, width, height: BASE_TOOLBAR_HEIGHT })

  const manager = new TabManager({
    windowId: win.id,
    isPrivate,
    window: win,
    shellView,
    sidebarView,
    panelView,
    webSession,
    storage,
    adblocker,
    onOpenPrivateWindow: () => {
      createBrowserWindow(true)
    }
  })

  managers.set(win.id, manager)
  senderToManager.set(shellView.webContents.id, manager)
  senderToManager.set(sidebarView.webContents.id, manager)
  senderToManager.set(panelView.webContents.id, manager)

  adblocker.attachToSession({
    session: webSession,
    storage,
    getTabHostByWebContentsId: (wcId) => {
      const tab = manager.getTabByWebContentsId(wcId)
      return tab ? extractHostname(tab.state.url) : null
    },
    onRequestBlocked: (wcId) => {
      manager.incrementBlockedCount(wcId)
    }
  })

  wireSessionDownloads(webSession)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void shellView.webContents.loadURL(devUrl)
    void sidebarView.webContents.loadURL(`${devUrl}?view=sidebar`)
    void panelView.webContents.loadURL(`${devUrl}?view=panel`)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    void shellView.webContents.loadFile(htmlPath)
    void sidebarView.webContents.loadFile(htmlPath, { query: { view: 'sidebar' } })
    void panelView.webContents.loadFile(htmlPath, { query: { view: 'panel' } })
  }

  manager.initializeTabs()

  win.on('closed', () => {
    managers.delete(win.id)
    for (const view of [shellView, sidebarView, panelView]) {
      if (!view.webContents.isDestroyed()) {
        senderToManager.delete(view.webContents.id)
      }
    }
    if (isPrivate) {
      void webSession.clearStorageData().catch(() => {})
      void webSession.clearCache().catch(() => {})
    }
  })

  return manager
}

function registerIpcHandlers(): void {
  const getManager = (event: Electron.IpcMainInvokeEvent): TabManager | null =>
    senderToManager.get(event.sender.id) ?? null

  ipcMain.handle('browser:get-state', (event) => {
    const manager = getManager(event)
    if (!manager) return null
    return manager.getSnapshot()
  })

  ipcMain.handle('browser:create-tab', (event, url?: unknown) => {
    const manager = getManager(event)
    if (!manager) return
    manager.createTab(typeof url === 'string' ? url : undefined, true)
  })

  ipcMain.handle('browser:close-tab', (event, tabId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string') return
    manager.closeTab(tabId)
  })

  ipcMain.handle('browser:restore-closed-tab', (event) => {
    getManager(event)?.restoreClosedTab()
  })

  ipcMain.handle('browser:switch-tab', (event, tabId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string') return
    manager.switchTab(tabId)
  })

  ipcMain.handle('browser:reorder-tab', (event, fromIndex: unknown, toIndex: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof fromIndex !== 'number' || typeof toIndex !== 'number') return
    manager.reorderTab(fromIndex, toIndex)
  })

  ipcMain.handle('browser:sleep-inactive-tabs', (event) => {
    const manager = getManager(event)
    return manager ? manager.sleepInactiveTabs() : 0
  })

  ipcMain.handle('browser:navigate', (event, tabId: unknown, input: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string' || typeof input !== 'string') return
    manager.navigate(tabId, input)
  })

  ipcMain.handle('browser:go-back', (event, tabId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string') return
    manager.goBack(tabId)
  })

  ipcMain.handle('browser:go-forward', (event, tabId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string') return
    manager.goForward(tabId)
  })

  ipcMain.handle('browser:reload-or-stop', (event, tabId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string') return
    manager.reloadOrStop(tabId)
  })

  ipcMain.handle('browser:set-zoom', (event, tabId: unknown, action: unknown) => {
    const manager = getManager(event)
    if (
      !manager ||
      typeof tabId !== 'string' ||
      (action !== 'in' && action !== 'out' && action !== 'reset')
    ) {
      return
    }
    manager.setZoom(tabId, action)
  })

  ipcMain.handle('browser:switch-workspace', (event, workspaceId: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof workspaceId !== 'string') return
    manager.switchWorkspace(workspaceId)
  })

  ipcMain.handle('browser:create-workspace', (event, name: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof name !== 'string') return
    manager.createWorkspace(name)
  })

  ipcMain.handle('browser:toggle-split-view', (event, tabId?: unknown) => {
    const manager = getManager(event)
    if (!manager) return
    manager.toggleSplitView(typeof tabId === 'string' ? tabId : undefined)
  })

  ipcMain.handle('browser:set-command-palette-open', (event, open: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof open !== 'boolean') return
    manager.setCommandPaletteOpen(open)
  })

  ipcMain.handle('browser:toggle-reader-mode', async (event) => {
    const manager = getManager(event)
    if (!manager) return
    await manager.toggleReaderMode()
  })

  ipcMain.handle('browser:set-find-open', (event, open: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof open !== 'boolean') return
    manager.setFindOpen(open)
  })

  ipcMain.handle(
    'browser:find-in-page',
    (event, tabId: unknown, query: unknown, forward?: unknown, findNext?: unknown) => {
      const manager = getManager(event)
      if (!manager || typeof tabId !== 'string' || typeof query !== 'string') return
      manager.findInPage(
        tabId,
        query,
        typeof forward === 'boolean' ? forward : true,
        typeof findNext === 'boolean' ? findNext : false
      )
    }
  )

  ipcMain.handle('browser:set-panel-mode', (event, mode: unknown) => {
    const manager = getManager(event)
    if (
      !manager ||
      (mode !== 'none' &&
        mode !== 'bookmarks' &&
        mode !== 'history' &&
        mode !== 'downloads' &&
        mode !== 'privacy' &&
        mode !== 'policy')
    ) {
      return
    }
    manager.setPanelMode(mode as PanelMode)
  })

  ipcMain.handle('browser:set-overlay-height', (event, extraHeight: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof extraHeight !== 'number') return
    manager.setOverlayHeight(extraHeight)
  })

  ipcMain.handle('browser:open-private-window', (event) => {
    if (!getManager(event)) return
    createBrowserWindow(true)
  })

  ipcMain.handle('browser:get-suggestions', (event, query: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof query !== 'string') return []
    return storage.getSuggestions(query)
  })

  ipcMain.handle('browser:toggle-bookmark', (event, url: unknown, title: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof url !== 'string' || typeof title !== 'string') return false
    const result = storage.toggleBookmark(url, title)
    for (const m of managers.values()) m.broadcastState()
    return result
  })

  ipcMain.handle('browser:get-bookmarks', (event) => {
    if (!getManager(event)) return []
    return storage.getBookmarks()
  })

  ipcMain.handle('browser:delete-bookmark', (event, id: unknown) => {
    if (!getManager(event) || typeof id !== 'number') return
    storage.deleteBookmark(id)
    for (const m of managers.values()) m.broadcastState()
  })

  ipcMain.handle('browser:get-history', (event, query?: unknown) => {
    if (!getManager(event)) return []
    return storage.getHistory(typeof query === 'string' ? query : '')
  })

  ipcMain.handle('browser:delete-history-item', (event, id: unknown) => {
    if (!getManager(event) || typeof id !== 'number') return
    storage.deleteHistoryItem(id)
  })

  ipcMain.handle('browser:get-downloads', (event) => {
    if (!getManager(event)) return []
    return storage.getDownloads()
  })

  ipcMain.handle('browser:open-download', async (event, id: unknown) => {
    if (!getManager(event) || typeof id !== 'string') return
    const item = storage.getDownloads().find((d) => d.id === id)
    if (item && existsSync(item.savePath)) {
      await shell.openPath(item.savePath)
    }
  })

  ipcMain.handle('browser:show-download-in-folder', (event, id: unknown) => {
    if (!getManager(event) || typeof id !== 'string') return
    const item = storage.getDownloads().find((d) => d.id === id)
    if (item) shell.showItemInFolder(item.savePath)
  })

  ipcMain.handle('browser:cancel-download', (event, id: unknown) => {
    if (!getManager(event) || typeof id !== 'string') return
    activeDownloads.get(id)?.cancel()
  })

  ipcMain.handle('browser:respond-permission', (event, requestId: unknown, decision: unknown) => {
    const manager = getManager(event)
    if (
      !manager ||
      typeof requestId !== 'string' ||
      (decision !== 'allow-once' &&
        decision !== 'allow-always' &&
        decision !== 'deny-always' &&
        decision !== 'deny-once')
    ) {
      return
    }
    manager.respondPermission(requestId, decision)
  })

  ipcMain.handle('browser:get-site-permissions', (event) => {
    if (!getManager(event)) return []
    return storage.getAllPermissions()
  })

  ipcMain.handle(
    'browser:delete-site-permission',
    (event, origin: unknown, permission: unknown) => {
      if (!getManager(event) || typeof origin !== 'string' || typeof permission !== 'string') return
      storage.deletePermission(origin, permission as PermissionKind)
    }
  )

  ipcMain.handle('browser:toggle-site-adblock', (event, hostname: unknown) => {
    const manager = getManager(event)
    if (!manager || typeof hostname !== 'string') return
    storage.toggleAdblockForHost(hostname)
    for (const m of managers.values()) m.broadcastState()
  })

  ipcMain.handle('browser:update-settings', (event, partial: unknown) => {
    if (!getManager(event) || typeof partial !== 'object' || partial === null) return
    storage.updateSettings(partial as Partial<BrowserSettings>)
    for (const m of managers.values()) {
      m.layoutViews()
      m.broadcastState()
    }
  })

  ipcMain.handle('browser:clear-browsing-data', async (event, options: unknown) => {
    if (!getManager(event) || typeof options !== 'object' || options === null) return
    const opts = options as ClearBrowsingDataOptions
    const sinceMs =
      typeof opts.sinceHours === 'number' && opts.sinceHours > 0
        ? Date.now() - opts.sinceHours * 3_600_000
        : null

    if (opts.history) storage.clearHistorySince(sinceMs)
    if (opts.downloads) {
      storage.clearDownloads()
      broadcastDownloads()
    }
    if (opts.permissions) storage.clearPermissions()

    const defaultWebSession = session.fromPartition('persist:web-default')
    if (opts.cache) {
      await defaultWebSession.clearCache()
    }
    if (opts.cookies) {
      await defaultWebSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      })
    }

    for (const m of managers.values()) m.broadcastState()
  })

  ipcMain.handle('browser:get-update-state', (event) => {
    if (!getManager(event)) return null
    return updater.getState()
  })

  ipcMain.handle('browser:check-for-updates', async (event) => {
    if (!getManager(event)) return
    await updater.checkForUpdates()
  })

  ipcMain.handle('browser:download-update', async (event) => {
    if (!getManager(event)) return
    await updater.downloadUpdate()
  })

  ipcMain.handle('browser:install-update', (event) => {
    if (!getManager(event)) return
    updater.installUpdate()
  })
}

function extractLaunchUrl(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (isAllowedWebUrl(arg)) {
      return arg
    }
  }
  return null
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const existing = managers.values().next().value
    const launchUrl = extractLaunchUrl(commandLine)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.focus()
      if (launchUrl) existing.createTab(launchUrl, true)
    } else {
      const m = createBrowserWindow(false)
      if (launchUrl) m.createTab(launchUrl, true)
    }
  })

  app.whenReady().then(() => {
    storage = new BrowserStorage()
    adblocker = new AdBlockerService()
    updater = new UpdaterService((state) => broadcastUpdateState(state))
    void adblocker.initialize()

    registerIpcHandlers()
    const m = createBrowserWindow(false)
    const launchUrl = extractLaunchUrl(process.argv)
    if (launchUrl) m.createTab(launchUrl, true)
    updater.scheduleInitialCheck()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
