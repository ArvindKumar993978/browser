import { useEffect, useState } from 'react'
import {
  Bookmark,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Moon,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X
} from 'lucide-react'
import type {
  BookmarkItem,
  HistoryItem,
  SitePermissionRecord
} from '@shared/types'
import { useBrowserStore } from '../store/browserStore'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function SidePanel(): React.JSX.Element {
  const { snapshot, downloads, updateState, hydrate, setSnapshot, setDownloads, setUpdateState } =
    useBrowserStore()
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [permissions, setPermissions] = useState<SitePermissionRecord[]>([])
  const [sleptNotice, setSleptNotice] = useState<string | null>(null)
  const [clearFeedback, setClearFeedback] = useState<string | null>(null)

  const [clearOpts, setClearOpts] = useState({
    history: true,
    downloads: false,
    cookies: false,
    cache: true,
    permissions: false,
    sinceHours: 24 as number | null
  })

  useEffect(() => {
    void hydrate()
    const unsubState = window.orbitAPI.onStateChange((s) => setSnapshot(s))
    const unsubDl = window.orbitAPI.onDownloadsChange((d) => setDownloads(d))
    const unsubUpdate = window.orbitAPI.onUpdateStateChange((u) => setUpdateState(u))
    return () => {
      unsubState()
      unsubDl()
      unsubUpdate()
    }
  }, [hydrate, setSnapshot, setDownloads, setUpdateState])

  const mode = snapshot?.activePanel ?? 'none'
  const activeTab = snapshot?.tabs.find((t) => t.id === snapshot.activeTabId) ?? null
  const activeHost = activeTab ? extractHost(activeTab.url) : ''

  useEffect(() => {
    if (mode === 'bookmarks') {
      void window.orbitAPI.getBookmarks().then(setBookmarks)
    } else if (mode === 'history') {
      void window.orbitAPI.getHistory(historyQuery).then(setHistory)
    } else if (mode === 'downloads') {
      void window.orbitAPI.getDownloads().then(setDownloads)
    } else if (mode === 'privacy') {
      void window.orbitAPI.getSitePermissions().then(setPermissions)
    }
  }, [mode, historyQuery, snapshot?.activeTabBookmarked, setDownloads])

  const panelTitle =
    mode === 'bookmarks'
      ? 'Bookmarks'
      : mode === 'history'
        ? 'History'
        : mode === 'downloads'
          ? 'Downloads'
          : mode === 'policy'
            ? 'Privacy Policy & Trust'
            : 'Privacy & Shield'

  return (
    <aside className="flex h-screen w-full flex-col border-l border-slate-800 bg-[#12151e] text-slate-100">
      <div className="flex h-11 items-center justify-between border-b border-slate-800 px-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-200">
          {mode === 'bookmarks' && <Bookmark className="h-4 w-4 text-amber-400" />}
          {mode === 'history' && <History className="h-4 w-4 text-sky-400" />}
          {mode === 'downloads' && <Download className="h-4 w-4 text-emerald-400" />}
          {mode === 'privacy' && <Shield className="h-4 w-4 text-sky-400" />}
          {mode === 'policy' && <ShieldCheck className="h-4 w-4 text-emerald-400" />}
          <span>{panelTitle}</span>
        </div>
        <button
          type="button"
          onClick={() => void window.orbitAPI.setPanelMode('none')}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {mode === 'bookmarks' && (
          <>
            {bookmarks.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No bookmarks yet. Click the star in the address bar to save a page.
              </p>
            ) : (
              bookmarks.map((b) => (
                <div
                  key={b.id}
                  className="group flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-[#181c28] px-3 py-2 hover:border-slate-700"
                >
                  <button
                    type="button"
                    onClick={() => void window.orbitAPI.createTab(b.url)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-medium text-slate-100">{b.title}</div>
                    <div className="truncate text-[11px] text-slate-400">{b.url}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.orbitAPI
                        .deleteBookmark(b.id)
                        .then(() => window.orbitAPI.getBookmarks().then(setBookmarks))
                    }
                    className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </>
        )}

        {mode === 'history' && (
          <>
            <input
              type="text"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search history..."
              className="w-full rounded-lg border border-slate-700 bg-[#0f1117] px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
            />
            {history.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">No browsing history found.</p>
            ) : (
              history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-[#181c28] px-3 py-2 hover:border-slate-700"
                >
                  <button
                    type="button"
                    onClick={() => void window.orbitAPI.createTab(h.url)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-medium text-slate-100">{h.title}</div>
                    <div className="truncate text-[11px] text-slate-400">
                      {new Date(h.visitedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}{' '}
                      · {h.url}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.orbitAPI
                        .deleteHistoryItem(h.id)
                        .then(() => window.orbitAPI.getHistory(historyQuery).then(setHistory))
                    }
                    className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </>
        )}

        {mode === 'downloads' && (
          <>
            {downloads.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">No downloads yet.</p>
            ) : (
              downloads.map((dl) => {
                const pct =
                  dl.totalBytes > 0
                    ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100))
                    : 0
                return (
                  <div
                    key={dl.id}
                    className="rounded-lg border border-slate-800 bg-[#181c28] p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-100">
                          {dl.filename}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {dl.state === 'progressing'
                            ? `${formatBytes(dl.receivedBytes)} / ${formatBytes(dl.totalBytes)} (${pct}%)`
                            : `${dl.state} · ${formatBytes(dl.receivedBytes)}`}
                        </div>
                      </div>
                    </div>

                    {dl.state === 'progressing' && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-emerald-400 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-0.5">
                      {dl.state === 'progressing' ? (
                        <button
                          type="button"
                          onClick={() => void window.orbitAPI.cancelDownload(dl.id)}
                          className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/30"
                        >
                          Cancel
                        </button>
                      ) : (
                        <>
                          {dl.state === 'completed' && (
                            <button
                              type="button"
                              onClick={() => void window.orbitAPI.openDownload(dl.id)}
                              className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void window.orbitAPI.showDownloadInFolder(dl.id)}
                            className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                          >
                            <FolderOpen className="h-3 w-3" />
                            Folder
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </>
        )}

        {mode === 'privacy' && snapshot && (
          <div className="space-y-4">
            {activeHost && (
              <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {activeHost}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {activeTab?.blockedCount ?? 0} ads/trackers blocked on this tab
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void window.orbitAPI.toggleSiteAdblock(activeHost)}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      snapshot.activeTabAdblockDisabled
                        ? 'bg-slate-700 text-slate-300'
                        : 'bg-sky-600 text-white'
                    }`}
                  >
                    {snapshot.activeTabAdblockDisabled ? (
                      <>
                        <ShieldOff className="h-3.5 w-3.5" /> Off
                      </>
                    ) : (
                      <>
                        <Shield className="h-3.5 w-3.5" /> On
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Protection, Layout & Memory
              </div>

              <label className="flex items-center justify-between text-xs">
                <span>Ad & Tracker Blocking</span>
                <input
                  type="checkbox"
                  checked={snapshot.settings.adBlockGlobal}
                  onChange={(e) =>
                    void window.orbitAPI.updateSettings({ adBlockGlobal: e.target.checked })
                  }
                  className="accent-sky-500"
                />
              </label>

              <label className="flex items-center justify-between text-xs">
                <span>HTTPS-First Mode</span>
                <input
                  type="checkbox"
                  checked={snapshot.settings.httpsFirst}
                  onChange={(e) =>
                    void window.orbitAPI.updateSettings({ httpsFirst: e.target.checked })
                  }
                  className="accent-sky-500"
                />
              </label>

              <label className="flex items-center justify-between text-xs">
                <span>Vertical Tabs Sidebar</span>
                <input
                  type="checkbox"
                  checked={snapshot.settings.verticalTabs}
                  onChange={(e) =>
                    void window.orbitAPI.updateSettings({ verticalTabs: e.target.checked })
                  }
                  className="accent-sky-500"
                />
              </label>

              <div className="flex items-center justify-between text-xs">
                <span>Sleep Inactive Tabs</span>
                <select
                  value={snapshot.settings.sleepAfterMinutes}
                  onChange={(e) =>
                    void window.orbitAPI.updateSettings({
                      sleepAfterMinutes: Number(e.target.value)
                    })
                  }
                  className="rounded border border-slate-700 bg-[#0f1117] px-2 py-1 text-xs text-slate-200"
                >
                  <option value={5}>After 5 min</option>
                  <option value={10}>After 10 min</option>
                  <option value={30}>After 30 min</option>
                  <option value={0}>Disabled</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  void window.orbitAPI.sleepInactiveTabs().then((count) => {
                    setSleptNotice(
                      count > 0
                        ? `Put ${count} background tab(s) to sleep.`
                        : 'No eligible tabs to sleep.'
                    )
                    setTimeout(() => setSleptNotice(null), 3000)
                  })
                }
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                <Moon className="h-3.5 w-3.5 text-sky-400" />
                Sleep Inactive Tabs Now
              </button>
              {sleptNotice && <div className="text-[11px] text-sky-300">{sleptNotice}</div>}
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Saved Site Permissions
              </div>
              {permissions.length === 0 ? (
                <div className="text-[11px] text-slate-500">No saved site permissions.</div>
              ) : (
                permissions.map((p) => (
                  <div
                    key={`${p.origin}-${p.permission}`}
                    className="flex items-center justify-between gap-2 rounded bg-[#0f1117] px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-slate-200">{p.origin}</div>
                      <div className="text-slate-400">
                        {p.permission}:{' '}
                        <span
                          className={
                            p.decision === 'allow' ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {p.decision}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void window.orbitAPI
                          .deleteSitePermission(p.origin, p.permission)
                          .then(() => window.orbitAPI.getSitePermissions().then(setPermissions))
                      }
                      className="rounded p-1 text-slate-500 hover:text-rose-300"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Clear Browsing Data
              </div>

              <select
                value={clearOpts.sinceHours ?? 'all'}
                onChange={(e) =>
                  setClearOpts((prev) => ({
                    ...prev,
                    sinceHours: e.target.value === 'all' ? null : Number(e.target.value)
                  }))
                }
                className="w-full rounded border border-slate-700 bg-[#0f1117] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value={1}>Last hour</option>
                <option value={24}>Last 24 hours</option>
                <option value="all">All time</option>
              </select>

              {(
                [
                  ['history', 'Browsing history'],
                  ['downloads', 'Download history'],
                  ['cache', 'Cached images & files'],
                  ['cookies', 'Cookies & site data'],
                  ['permissions', 'Saved site permissions']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between text-xs">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={clearOpts[key]}
                    onChange={(e) =>
                      setClearOpts((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="accent-rose-500"
                  />
                </label>
              ))}

              <button
                type="button"
                onClick={() =>
                  void window.orbitAPI.clearBrowsingData(clearOpts).then(() => {
                    setClearFeedback('Selected data cleared.')
                    void window.orbitAPI.getSitePermissions().then(setPermissions)
                    setTimeout(() => setClearFeedback(null), 3000)
                  })
                }
                className="w-full rounded-lg bg-rose-600 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
              >
                Clear Data
              </button>
              {clearFeedback && <div className="text-[11px] text-emerald-400">{clearFeedback}</div>}
            </div>

            <button
              type="button"
              onClick={() => void window.orbitAPI.setPanelMode('policy')}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#181c28] py-2 text-xs font-medium text-emerald-300 hover:bg-slate-800"
            >
              <FileText className="h-3.5 w-3.5" />
              Read Orbit Privacy Policy & Security Docs
            </button>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Orbit Browser v{updateState?.appVersion ?? '0.1.0'}
                </span>
                <button
                  type="button"
                  onClick={() => void window.orbitAPI.checkForUpdates()}
                  disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
                  className="rounded bg-slate-800 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Check Updates
                </button>
              </div>
              {updateState?.message && (
                <div className="text-[11px] text-slate-400">{updateState.message}</div>
              )}
              {updateState?.status === 'available' && (
                <button
                  type="button"
                  onClick={() => void window.orbitAPI.downloadUpdate()}
                  className="w-full rounded-lg bg-sky-600 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
                >
                  Download Orbit {updateState.latestVersion}
                </button>
              )}
              {updateState?.status === 'ready' && (
                <button
                  type="button"
                  onClick={() => void window.orbitAPI.installUpdate()}
                  className="w-full rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Restart & Install Update
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'policy' && (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="font-semibold text-emerald-300">Zero Telemetry Guarantee</div>
              <p className="mt-1 text-[11px] text-slate-300">
                Orbit Browser has no telemetry servers, no crash-upload beacons, and no usage
                analytics. Your browsing stays strictly on your device.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-1.5">
              <div className="font-semibold text-slate-100">1. Local Data Stored on Device</div>
              <p className="text-[11px] text-slate-400">
                History, bookmarks, downloads, workspaces, adblock allowlist, and site permissions
                are saved locally in SQLite inside your Windows user data directory. You can wipe
                them anytime from Privacy & Shield.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-1.5">
              <div className="font-semibold text-slate-100">2. Network Requests</div>
              <p className="text-[11px] text-slate-400">
                Orbit only connects to websites you open, DuckDuckGo when you submit a search from
                the address bar, Ghostery prebuilt filter lists once to cache ad/tracker rules
                locally, and GitHub Releases (`ArvindKumar993978/browser`) to check for app updates.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-1.5">
              <div className="font-semibold text-slate-100">3. Private Windows</div>
              <p className="text-[11px] text-slate-400">
                Private Windows run in an isolated in-memory partition. They never record history,
                session tabs, or permanent permissions, and clear cookies/cache when closed.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#181c28] p-3 space-y-1.5">
              <div className="font-semibold text-slate-100">4. Protocol & Sandbox Security</div>
              <p className="text-[11px] text-slate-400">
                Web tabs run with sandbox, contextIsolation, webSecurity, and zero Node/IPC access.
                Only http(s) navigations/redirects are allowed, HTTPS-First upgrades plain HTTP,
                and invalid TLS certificates are blocked.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void window.orbitAPI.setPanelMode('privacy')}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              Back to Privacy & Shield
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
