export type PermissionKind = 'camera' | 'microphone' | 'location' | 'notifications'

export type PanelMode =
  | 'none'
  | 'bookmarks'
  | 'history'
  | 'downloads'
  | 'privacy'
  | 'policy'

export interface WorkspaceItem {
  id: string
  name: string
  color: string
}

export interface ReaderBlock {
  type: 'h1' | 'h2' | 'p' | 'quote' | 'li'
  text: string
}

export interface ReaderArticle {
  title: string
  byline: string
  siteName: string
  url: string
  blocks: ReaderBlock[]
}

export interface TabState {
  id: string
  workspaceId: string
  title: string
  url: string
  favicon: string | null
  isLoading: boolean
  isSleeping: boolean
  canGoBack: boolean
  canGoForward: boolean
  isSecure: boolean
  zoomFactor: number
  blockedCount: number
  lastError: string | null
  certError: string | null
}

export interface HistoryItem {
  id: number
  url: string
  title: string
  visitedAt: number
}

export interface BookmarkItem {
  id: number
  url: string
  title: string
  createdAt: number
}

export interface DownloadItem {
  id: string
  url: string
  filename: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
}

export interface SitePermissionRecord {
  origin: string
  permission: PermissionKind
  decision: 'allow' | 'deny'
  updatedAt: number
}

export interface PendingPermissionRequest {
  requestId: string
  tabId: string
  origin: string
  permission: PermissionKind
}

export interface FindInPageResult {
  tabId: string
  query: string
  activeMatchOrdinal: number
  matches: number
}

export interface BrowserSettings {
  httpsFirst: boolean
  adBlockGlobal: boolean
  sleepAfterMinutes: number
  verticalTabs: boolean
}

export interface OmniboxSuggestion {
  source: 'bookmark' | 'history'
  title: string
  url: string
}

export interface BrowserStateSnapshot {
  windowId: number
  isPrivate: boolean
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string
  tabs: TabState[]
  activeTabId: string | null
  splitTabId: string | null
  canRestoreClosedTab: boolean
  activePanel: PanelMode
  findOpen: boolean
  commandPaletteOpen: boolean
  readerArticle: ReaderArticle | null
  findResult: FindInPageResult | null
  pendingPermission: PendingPermissionRequest | null
  activeTabAdblockDisabled: boolean
  activeTabBookmarked: boolean
  settings: BrowserSettings
}

export interface ClearBrowsingDataOptions {
  history: boolean
  downloads: boolean
  cookies: boolean
  cache: boolean
  permissions: boolean
  sinceHours: number | null
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  appVersion: string
  latestVersion?: string
  progress?: number
  message?: string
}

export interface OrbitBrowserAPI {
  getState: () => Promise<BrowserStateSnapshot>
  createTab: (url?: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  restoreClosedTab: () => Promise<void>
  switchTab: (tabId: string) => Promise<void>
  reorderTab: (fromIndex: number, toIndex: number) => Promise<void>
  sleepInactiveTabs: () => Promise<number>
  navigate: (tabId: string, input: string) => Promise<void>
  goBack: (tabId: string) => Promise<void>
  goForward: (tabId: string) => Promise<void>
  reloadOrStop: (tabId: string) => Promise<void>
  setZoom: (tabId: string, action: 'in' | 'out' | 'reset') => Promise<void>

  // Phase 3: Workspaces, Split View, Command Palette, Reader Mode
  switchWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  toggleSplitView: (tabId?: string) => Promise<void>
  setCommandPaletteOpen: (open: boolean) => Promise<void>
  toggleReaderMode: () => Promise<void>

  // Find in page
  setFindOpen: (open: boolean) => Promise<void>
  findInPage: (tabId: string, query: string, forward?: boolean, findNext?: boolean) => Promise<void>

  // Side panel & overlays
  setPanelMode: (mode: PanelMode) => Promise<void>
  setOverlayHeight: (extraHeight: number) => Promise<void>
  openPrivateWindow: () => Promise<void>

  // Omnibox suggestions
  getSuggestions: (query: string) => Promise<OmniboxSuggestion[]>

  // Bookmarks, history, downloads
  toggleBookmark: (url: string, title: string) => Promise<boolean>
  getBookmarks: () => Promise<BookmarkItem[]>
  deleteBookmark: (id: number) => Promise<void>
  getHistory: (query?: string) => Promise<HistoryItem[]>
  deleteHistoryItem: (id: number) => Promise<void>
  getDownloads: () => Promise<DownloadItem[]>
  openDownload: (id: string) => Promise<void>
  showDownloadInFolder: (id: string) => Promise<void>
  cancelDownload: (id: string) => Promise<void>

  // Privacy, permissions, adblock & settings
  respondPermission: (
    requestId: string,
    decision: 'allow-once' | 'allow-always' | 'deny-always' | 'deny-once'
  ) => Promise<void>
  getSitePermissions: () => Promise<SitePermissionRecord[]>
  deleteSitePermission: (origin: string, permission: PermissionKind) => Promise<void>
  toggleSiteAdblock: (hostname: string) => Promise<void>
  updateSettings: (partial: Partial<BrowserSettings>) => Promise<void>
  clearBrowsingData: (options: ClearBrowsingDataOptions) => Promise<void>

  // Auto-updater
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>

  // Events
  onStateChange: (callback: (state: BrowserStateSnapshot) => void) => () => void
  onDownloadsChange: (callback: (downloads: DownloadItem[]) => void) => () => void
  onUpdateStateChange: (callback: (state: UpdateState) => void) => () => void
  onFocusAddressBar: (callback: () => void) => () => void
}
