import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Columns2,
  Command,
  Download,
  EyeOff,
  Globe,
  History,
  Lock,
  LockOpen,
  Moon,
  PanelLeft,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Shield,
  ShieldOff,
  Star,
  X
} from 'lucide-react'
import type { OmniboxSuggestion } from '@shared/types'
import { CommandPalette } from './components/CommandPalette'
import { ErrorOverlay } from './components/ErrorOverlay'
import { ReaderOverlay } from './components/ReaderOverlay'
import { SidePanel } from './components/SidePanel'
import { VerticalSidebar } from './components/VerticalSidebar'
import { useBrowserStore } from './store/browserStore'

function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function App(): React.JSX.Element {
  const viewMode = new URLSearchParams(window.location.search).get('view')
  if (viewMode === 'panel') return <SidePanel />
  if (viewMode === 'sidebar') return <VerticalSidebar />
  return <BrowserShell />
}

function BrowserShell(): React.JSX.Element {
  const { snapshot, updateState, hydrate, setSnapshot, setDownloads, setUpdateState } =
    useBrowserStore()
  const [addressValue, setAddressValue] = useState('')
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([])
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(-1)
  const [findQuery, setFindQuery] = useState('')
  const [dragTabIdx, setDragTabIdx] = useState<number | null>(null)

  const addressInputRef = useRef<HTMLInputElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void hydrate()
    const unsubState = window.orbitAPI.onStateChange((s) => setSnapshot(s))
    const unsubDl = window.orbitAPI.onDownloadsChange((d) => setDownloads(d))
    const unsubUpdate = window.orbitAPI.onUpdateStateChange((u) => setUpdateState(u))
    const unsubFocus = window.orbitAPI.onFocusAddressBar(() => {
      addressInputRef.current?.focus()
      addressInputRef.current?.select()
    })
    return () => {
      unsubState()
      unsubDl()
      unsubUpdate()
      unsubFocus()
    }
  }, [hydrate, setSnapshot, setDownloads, setUpdateState])

  const allTabs = snapshot?.tabs ?? []
  const activeWorkspaceId = snapshot?.activeWorkspaceId ?? 'personal'
  const wsTabs = allTabs.filter((t) => t.workspaceId === activeWorkspaceId)
  const activeTabId = snapshot?.activeTabId ?? null
  const activeTab = allTabs.find((t) => t.id === activeTabId) ?? null
  const isPrivate = snapshot?.isPrivate ?? false
  const verticalTabs = snapshot?.settings.verticalTabs ?? false
  const activeHost = activeTab ? extractHost(activeTab.url) : ''

  useEffect(() => {
    if (!isEditingAddress && activeTab) {
      setAddressValue(activeTab.url)
    }
  }, [activeTab?.id, activeTab?.url, isEditingAddress, activeTab])

  useEffect(() => {
    if (snapshot?.findOpen) {
      setTimeout(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      }, 20)
    }
  }, [snapshot?.findOpen])

  useEffect(() => {
    if (!isEditingAddress) {
      setSuggestions([])
      void window.orbitAPI.setOverlayHeight(0)
      return
    }
    const timer = setTimeout(() => {
      void window.orbitAPI.getSuggestions(addressValue).then((items) => {
        setSuggestions(items)
        setSelectedSuggestionIdx(-1)
        const extra = items.length > 0 ? items.length * 40 + 16 : 0
        void window.orbitAPI.setOverlayHeight(extra)
      })
    }, 60)
    return () => clearTimeout(timer)
  }, [addressValue, isEditingAddress])

  const commitNavigation = (input: string) => {
    if (!activeTab) return
    setIsEditingAddress(false)
    setSuggestions([])
    void window.orbitAPI.setOverlayHeight(0)
    addressInputRef.current?.blur()
    void window.orbitAPI.navigate(activeTab.id, input)
  }

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsEditingAddress(false)
      setSuggestions([])
      void window.orbitAPI.setOverlayHeight(0)
      if (activeTab) setAddressValue(activeTab.url)
      addressInputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      setSelectedSuggestionIdx((idx) => (idx + 1) % suggestions.length)
      return
    }
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      setSelectedSuggestionIdx((idx) => (idx <= 0 ? suggestions.length - 1 : idx - 1))
      return
    }
    if (e.key === 'Enter' && selectedSuggestionIdx >= 0 && suggestions[selectedSuggestionIdx]) {
      e.preventDefault()
      commitNavigation(suggestions[selectedSuggestionIdx].url)
    }
  }

  const hasErrorOverlay = Boolean(activeTab && (activeTab.lastError || activeTab.certError))
  const bgBase = isPrivate ? 'bg-[#120f1d]' : 'bg-[#0f1117]'
  const bgToolbar = isPrivate ? 'bg-[#1d1730]' : 'bg-[#1a1e29]'

  return (
    <div className={`flex h-screen w-full flex-col ${bgBase}`}>
      <header className={`relative flex w-full flex-col ${bgBase} border-b border-slate-800/80`}>
        {/* Top Strip (38px matches Windows titleBarOverlay) */}
        <div className="app-drag flex h-[38px] w-full items-end gap-1.5 pl-2.5 pr-[142px] pt-1">
          {isPrivate && (
            <div className="app-no-drag mb-1 flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-[11px] font-medium text-purple-200 border border-purple-400/30">
              <EyeOff className="h-3 w-3" />
              Private
            </div>
          )}

          {/* Workspace Switcher Pills */}
          <div className="app-no-drag mb-1 flex items-center gap-1 rounded-md bg-slate-900/80 p-0.5 border border-slate-800">
            {(snapshot?.workspaces ?? []).map((ws) => {
              const active = ws.id === activeWorkspaceId
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => void window.orbitAPI.switchWorkspace(ws.id)}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: ws.color }}
                  />
                  {ws.name}
                </button>
              )
            })}
          </div>

          {/* Horizontal Tabs (shown when verticalTabs is false) */}
          {!verticalTabs && (
            <div className="app-no-drag flex h-[30px] items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
              {wsTabs.map((tab) => {
                const globalIdx = allTabs.findIndex((t) => t.id === tab.id)
                const isActive = tab.id === activeTabId
                const isSplit = tab.id === snapshot?.splitTabId
                return (
                  <div
                    key={tab.id}
                    draggable
                    onDragStart={() => setDragTabIdx(globalIdx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragTabIdx !== null && dragTabIdx !== globalIdx) {
                        void window.orbitAPI.reorderTab(dragTabIdx, globalIdx)
                      }
                      setDragTabIdx(null)
                    }}
                    onClick={() => void window.orbitAPI.switchTab(tab.id)}
                    title={tab.isSleeping ? `${tab.title} (Sleeping to save RAM)` : tab.title}
                    className={`group flex h-[30px] min-w-[105px] max-w-[195px] shrink-0 cursor-pointer items-center gap-2 rounded-t-lg px-2.5 text-xs transition-colors ${
                      isActive
                        ? `${bgToolbar} text-slate-100 border-t border-x border-slate-700/70`
                        : isSplit
                          ? 'bg-sky-500/15 text-sky-200 border-t border-x border-sky-500/30'
                          : 'bg-transparent text-slate-400 hover:bg-[#161922] hover:text-slate-200'
                    } ${tab.isSleeping ? 'opacity-65' : ''}`}
                  >
                    {tab.isLoading ? (
                      <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                    ) : tab.isSleeping ? (
                      <Moon className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
                    ) : tab.favicon ? (
                      <img
                        src={tab.favicon}
                        alt=""
                        className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}

                    <span className="flex-1 truncate font-medium">{tab.title || 'New Tab'}</span>

                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.orbitAPI.closeTab(tab.id)
                      }}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 opacity-70 hover:bg-slate-700/80 hover:text-white group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}

              <button
                type="button"
                title="New Tab (Ctrl+T)"
                onClick={() => void window.orbitAPI.createTab()}
                className="ml-0.5 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-[#1a1e29] hover:text-slate-100 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>

              {snapshot?.canRestoreClosedTab && (
                <button
                  type="button"
                  title="Reopen Closed Tab (Ctrl+Shift+T)"
                  onClick={() => void window.orbitAPI.restoreClosedTab()}
                  className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-[#1a1e29] hover:text-slate-100 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation & Address Bar (48px) */}
        <div className={`flex h-[48px] w-full items-center gap-1.5 ${bgToolbar} px-3`}>
          <button
            type="button"
            title={verticalTabs ? 'Switch to Top Tabs' : 'Vertical Tabs'}
            onClick={() => void window.orbitAPI.updateSettings({ verticalTabs: !verticalTabs })}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              verticalTabs
                ? 'bg-slate-700 text-sky-300'
                : 'text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Back (Alt+Left)"
              disabled={!activeTab?.canGoBack}
              onClick={() => activeTab && void window.orbitAPI.goBack(activeTab.id)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 hover:bg-slate-700/60 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="Forward (Alt+Right)"
              disabled={!activeTab?.canGoForward}
              onClick={() => activeTab && void window.orbitAPI.goForward(activeTab.id)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 hover:bg-slate-700/60 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              title={activeTab?.isLoading ? 'Stop' : 'Reload (Ctrl+R)'}
              disabled={!activeTab}
              onClick={() => activeTab && void window.orbitAPI.reloadOrStop(activeTab.id)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 hover:bg-slate-700/60 disabled:opacity-30"
            >
              {activeTab?.isLoading ? <X className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitNavigation(addressValue)
            }}
            className="flex flex-1 items-center"
          >
            <div className="flex h-8 w-full items-center gap-2 rounded-full bg-[#0f1117] px-3 border border-slate-700/80 focus-within:border-sky-500/80">
              {activeTab?.isSecure ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <LockOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}

              <input
                ref={addressInputRef}
                type="text"
                value={addressValue}
                spellCheck={false}
                placeholder="Search with DuckDuckGo or enter URL..."
                onFocus={(e) => {
                  setIsEditingAddress(true)
                  e.currentTarget.select()
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setIsEditingAddress(false)
                    setSuggestions([])
                    void window.orbitAPI.setOverlayHeight(0)
                  }, 150)
                }}
                onChange={(e) => setAddressValue(e.target.value)}
                onKeyDown={handleAddressKeyDown}
                className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
              />

              {activeTab && Math.round(activeTab.zoomFactor * 100) !== 100 && (
                <button
                  type="button"
                  title="Reset Zoom (Ctrl+0)"
                  onClick={() => void window.orbitAPI.setZoom(activeTab.id, 'reset')}
                  className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                >
                  {Math.round(activeTab.zoomFactor * 100)}%
                </button>
              )}

              {activeTab && (
                <button
                  type="button"
                  title="Reader Mode (Ctrl+Alt+R)"
                  onClick={() => void window.orbitAPI.toggleReaderMode()}
                  className={`shrink-0 rounded p-0.5 transition-colors ${
                    snapshot?.readerArticle
                      ? 'text-sky-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </button>
              )}

              {activeHost && (
                <button
                  type="button"
                  title={
                    snapshot?.activeTabAdblockDisabled
                      ? `Adblock Off for ${activeHost} (Click to enable)`
                      : `Adblock On (${activeTab?.blockedCount ?? 0} blocked)`
                  }
                  onClick={() => void window.orbitAPI.toggleSiteAdblock(activeHost)}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    snapshot?.activeTabAdblockDisabled
                      ? 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                  }`}
                >
                  {snapshot?.activeTabAdblockDisabled ? (
                    <ShieldOff className="h-3 w-3" />
                  ) : (
                    <Shield className="h-3 w-3" />
                  )}
                  {(activeTab?.blockedCount ?? 0) > 0 && !snapshot?.activeTabAdblockDisabled && (
                    <span>{activeTab?.blockedCount}</span>
                  )}
                </button>
              )}

              {activeTab && !isPrivate && (
                <button
                  type="button"
                  title={snapshot?.activeTabBookmarked ? 'Remove Bookmark' : 'Bookmark This Page'}
                  onClick={() =>
                    void window.orbitAPI.toggleBookmark(activeTab.url, activeTab.title)
                  }
                  className="shrink-0 text-slate-400 hover:text-amber-300"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      snapshot?.activeTabBookmarked ? 'fill-amber-400 text-amber-400' : ''
                    }`}
                  />
                </button>
              )}
            </div>
          </form>

          {/* Right Action Toolbar */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Command Palette (Ctrl+K)"
              onClick={() =>
                void window.orbitAPI.setCommandPaletteOpen(!snapshot?.commandPaletteOpen)
              }
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-700/60"
            >
              <Command className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="Split View (Ctrl+\)"
              onClick={() => void window.orbitAPI.toggleSplitView()}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snapshot?.splitTabId
                  ? 'bg-slate-700 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <Columns2 className="h-4 w-4" />
            </button>

            {snapshot?.splitTabId && (
              <button
                type="button"
                title="Swap Split Panes"
                onClick={() => void window.orbitAPI.swapSplitPanes()}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-700/60"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              title="Bookmarks (Ctrl+B)"
              onClick={() => void window.orbitAPI.setPanelMode('bookmarks')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snapshot?.activePanel === 'bookmarks'
                  ? 'bg-slate-700 text-amber-300'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <Bookmark className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="History (Ctrl+H)"
              onClick={() => void window.orbitAPI.setPanelMode('history')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snapshot?.activePanel === 'history'
                  ? 'bg-slate-700 text-sky-300'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <History className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="Downloads (Ctrl+J)"
              onClick={() => void window.orbitAPI.setPanelMode('downloads')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snapshot?.activePanel === 'downloads'
                  ? 'bg-slate-700 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <Download className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="Privacy, Shield & Policy"
              onClick={() => void window.orbitAPI.setPanelMode('privacy')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snapshot?.activePanel === 'privacy' || snapshot?.activePanel === 'policy'
                  ? 'bg-slate-700 text-sky-300'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <Shield className="h-4 w-4" />
            </button>

            <button
              type="button"
              title="New Private Window (Ctrl+Shift+N)"
              onClick={() => void window.orbitAPI.openPrivateWindow()}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-purple-500/20 hover:text-purple-200 transition-colors"
            >
              <EyeOff className="h-4 w-4" />
            </button>

            {(updateState?.status === 'available' || updateState?.status === 'ready') && (
              <button
                type="button"
                title={updateState.message}
                onClick={() => {
                  if (updateState.status === 'ready') {
                    void window.orbitAPI.installUpdate()
                  } else {
                    void window.orbitAPI.downloadUpdate()
                  }
                }}
                className={`ml-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-white ${
                  updateState.status === 'ready'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-sky-600 hover:bg-sky-500'
                }`}
              >
                {updateState.status === 'ready' ? 'Restart to Update' : 'Update'}
              </button>
            )}
          </div>
        </div>

        {/* Find in Page Bar (42px when open) */}
        {snapshot?.findOpen && activeTab && (
          <div className="flex h-[42px] items-center justify-between border-t border-slate-800 bg-[#141824] px-3">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                placeholder="Find in page..."
                onChange={(e) => {
                  const val = e.target.value
                  setFindQuery(val)
                  void window.orbitAPI.findInPage(activeTab.id, val, true, false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void window.orbitAPI.findInPage(activeTab.id, findQuery, !e.shiftKey, true)
                  } else if (e.key === 'Escape') {
                    void window.orbitAPI.setFindOpen(false)
                  }
                }}
                className="w-60 rounded border border-slate-700 bg-[#0f1117] px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
              />
              {snapshot.findResult && findQuery && (
                <span className="text-[11px] text-slate-400">
                  {snapshot.findResult.activeMatchOrdinal} / {snapshot.findResult.matches}
                </span>
              )}
              <button
                type="button"
                onClick={() => void window.orbitAPI.findInPage(activeTab.id, findQuery, false, true)}
                className="rounded p-1 text-slate-300 hover:bg-slate-700"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void window.orbitAPI.findInPage(activeTab.id, findQuery, true, true)}
                className="rounded p-1 text-slate-300 hover:bg-slate-700"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void window.orbitAPI.setFindOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Permission Prompt Bar (44px when pending) */}
        {snapshot?.pendingPermission && (
          <div className="flex h-[44px] items-center justify-between border-t border-slate-800 bg-[#1a2234] px-4 text-xs">
            <div className="truncate text-slate-200">
              <span className="font-semibold text-sky-300">
                {snapshot.pendingPermission.origin}
              </span>{' '}
              wants permission to use your{' '}
              <span className="font-semibold">
                {snapshot.pendingPermission.permission === 'camera-and-microphone'
                  ? 'camera and microphone'
                  : snapshot.pendingPermission.permission}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void window.orbitAPI.respondPermission(
                    snapshot.pendingPermission!.requestId,
                    'allow-once'
                  )
                }
                className="rounded bg-slate-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-600"
              >
                Allow Once
              </button>
              {!isPrivate && (
                <button
                  type="button"
                  onClick={() =>
                    void window.orbitAPI.respondPermission(
                      snapshot.pendingPermission!.requestId,
                      'allow-always'
                    )
                  }
                  className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
                >
                  Always Allow
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void window.orbitAPI.respondPermission(
                    snapshot.pendingPermission!.requestId,
                    isPrivate ? 'deny-once' : 'deny-always'
                  )
                }
                className="rounded bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500"
              >
                Block
              </button>
            </div>
          </div>
        )}

        {activeTab?.isLoading && (
          <div className="absolute bottom-0 left-0 h-[2px] w-full overflow-hidden bg-slate-800">
            <div className="h-full w-1/3 animate-pulse bg-sky-400" />
          </div>
        )}
      </header>

      {/* Omnibox Autocomplete Dropdown */}
      {isEditingAddress && suggestions.length > 0 && (
        <div className="mx-auto mt-1 w-full max-w-3xl px-3">
          <div className="overflow-hidden rounded-xl border border-slate-700 bg-[#141824] p-1.5 shadow-2xl">
            {suggestions.map((item, idx) => (
              <button
                key={`${item.source}-${item.url}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitNavigation(item.url)
                }}
                className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs ${
                  idx === selectedSuggestionIdx
                    ? 'bg-sky-600/30 text-white'
                    : 'text-slate-200 hover:bg-slate-800'
                }`}
              >
                {item.source === 'bookmark' ? (
                  <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                ) : (
                  <History className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span className="truncate font-medium">{item.title}</span>
                <span className="truncate text-[11px] text-slate-400">{item.url}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Full-Height Overlays */}
      {snapshot?.commandPaletteOpen ? (
        <CommandPalette
          snapshot={snapshot}
          onClose={() => void window.orbitAPI.setCommandPaletteOpen(false)}
        />
      ) : hasErrorOverlay && activeTab ? (
        <ErrorOverlay
          tab={activeTab}
          onBack={() => void window.orbitAPI.goBack(activeTab.id)}
          onReload={() => void window.orbitAPI.reloadOrStop(activeTab.id)}
          onContinueHttp={() => void window.orbitAPI.continueOverHttp(activeTab.id)}
        />
      ) : snapshot?.readerArticle ? (
        <ReaderOverlay
          article={snapshot.readerArticle}
          onClose={() => void window.orbitAPI.toggleReaderMode()}
        />
      ) : null}
    </div>
  )
}

export default App
