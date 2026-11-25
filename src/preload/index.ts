import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserSettings,
  BrowserStateSnapshot,
  ClearBrowsingDataOptions,
  DownloadItem,
  OrbitBrowserAPI,
  PanelMode,
  PermissionKind,
  UpdateState
} from '../shared/types'

const api: OrbitBrowserAPI = {
  getState: () => ipcRenderer.invoke('browser:get-state'),
  createTab: (url?: string) => ipcRenderer.invoke('browser:create-tab', url),
  closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', tabId),
  restoreClosedTab: () => ipcRenderer.invoke('browser:restore-closed-tab'),
  switchTab: (tabId: string) => ipcRenderer.invoke('browser:switch-tab', tabId),
  reorderTab: (fromIndex: number, toIndex: number) =>
    ipcRenderer.invoke('browser:reorder-tab', fromIndex, toIndex),
  sleepInactiveTabs: () => ipcRenderer.invoke('browser:sleep-inactive-tabs'),
  navigate: (tabId: string, input: string) => ipcRenderer.invoke('browser:navigate', tabId, input),
  goBack: (tabId: string) => ipcRenderer.invoke('browser:go-back', tabId),
  goForward: (tabId: string) => ipcRenderer.invoke('browser:go-forward', tabId),
  reloadOrStop: (tabId: string) => ipcRenderer.invoke('browser:reload-or-stop', tabId),
  setZoom: (tabId: string, action: 'in' | 'out' | 'reset') =>
    ipcRenderer.invoke('browser:set-zoom', tabId, action),

  switchWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke('browser:switch-workspace', workspaceId),
  createWorkspace: (name: string) => ipcRenderer.invoke('browser:create-workspace', name),
  toggleSplitView: (tabId?: string) => ipcRenderer.invoke('browser:toggle-split-view', tabId),
  setCommandPaletteOpen: (open: boolean) =>
    ipcRenderer.invoke('browser:set-command-palette-open', open),
  toggleReaderMode: () => ipcRenderer.invoke('browser:toggle-reader-mode'),

  setFindOpen: (open: boolean) => ipcRenderer.invoke('browser:set-find-open', open),
  findInPage: (tabId: string, query: string, forward = true, findNext = false) =>
    ipcRenderer.invoke('browser:find-in-page', tabId, query, forward, findNext),

  setPanelMode: (mode: PanelMode) => ipcRenderer.invoke('browser:set-panel-mode', mode),
  setOverlayHeight: (extraHeight: number) =>
    ipcRenderer.invoke('browser:set-overlay-height', extraHeight),
  openPrivateWindow: () => ipcRenderer.invoke('browser:open-private-window'),

  getSuggestions: (query: string) => ipcRenderer.invoke('browser:get-suggestions', query),

  toggleBookmark: (url: string, title: string) =>
    ipcRenderer.invoke('browser:toggle-bookmark', url, title),
  getBookmarks: () => ipcRenderer.invoke('browser:get-bookmarks'),
  deleteBookmark: (id: number) => ipcRenderer.invoke('browser:delete-bookmark', id),
  getHistory: (query?: string) => ipcRenderer.invoke('browser:get-history', query),
  deleteHistoryItem: (id: number) => ipcRenderer.invoke('browser:delete-history-item', id),
  getDownloads: () => ipcRenderer.invoke('browser:get-downloads'),
  openDownload: (id: string) => ipcRenderer.invoke('browser:open-download', id),
  showDownloadInFolder: (id: string) => ipcRenderer.invoke('browser:show-download-in-folder', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('browser:cancel-download', id),

  respondPermission: (requestId, decision) =>
    ipcRenderer.invoke('browser:respond-permission', requestId, decision),
  getSitePermissions: () => ipcRenderer.invoke('browser:get-site-permissions'),
  deleteSitePermission: (origin: string, permission: PermissionKind) =>
    ipcRenderer.invoke('browser:delete-site-permission', origin, permission),
  toggleSiteAdblock: (hostname: string) =>
    ipcRenderer.invoke('browser:toggle-site-adblock', hostname),
  updateSettings: (partial: Partial<BrowserSettings>) =>
    ipcRenderer.invoke('browser:update-settings', partial),
  clearBrowsingData: (options: ClearBrowsingDataOptions) =>
    ipcRenderer.invoke('browser:clear-browsing-data', options),

  getUpdateState: () => ipcRenderer.invoke('browser:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('browser:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('browser:download-update'),
  installUpdate: () => ipcRenderer.invoke('browser:install-update'),

  onStateChange: (callback: (state: BrowserStateSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserStateSnapshot) => {
      callback(state)
    }
    ipcRenderer.on('browser:state-changed', listener)
    return () => ipcRenderer.removeListener('browser:state-changed', listener)
  },

  onDownloadsChange: (callback: (downloads: DownloadItem[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, downloads: DownloadItem[]) => {
      callback(downloads)
    }
    ipcRenderer.on('browser:downloads-changed', listener)
    return () => ipcRenderer.removeListener('browser:downloads-changed', listener)
  },

  onUpdateStateChange: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
      callback(state)
    }
    ipcRenderer.on('browser:update-state-changed', listener)
    return () => ipcRenderer.removeListener('browser:update-state-changed', listener)
  },

  onFocusAddressBar: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('browser:focus-address-bar', listener)
    return () => ipcRenderer.removeListener('browser:focus-address-bar', listener)
  }
}

contextBridge.exposeInMainWorld('orbitAPI', api)
