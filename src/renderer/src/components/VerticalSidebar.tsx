import { useEffect, useState } from 'react'
import {
  Columns2,
  FolderPlus,
  Globe,
  Moon,
  PanelLeftClose,
  Plus,
  RotateCcw,
  X
} from 'lucide-react'
import { useBrowserStore } from '../store/browserStore'

export function VerticalSidebar(): React.JSX.Element {
  const { snapshot, hydrate, setSnapshot } = useBrowserStore()
  const [creatingWs, setCreatingWs] = useState(false)
  const [wsName, setWsName] = useState('')

  useEffect(() => {
    void hydrate()
    return window.orbitAPI.onStateChange((s) => setSnapshot(s))
  }, [hydrate, setSnapshot])

  if (!snapshot) return <div className="h-screen w-full bg-[#0f1117]" />

  const wsTabs = snapshot.tabs.filter((t) => t.workspaceId === snapshot.activeWorkspaceId)

  return (
    <aside className="flex h-screen w-full flex-col border-r border-slate-800 bg-[#0f1219] text-slate-100">
      {/* Workspaces */}
      <div className="border-b border-slate-800 p-2.5 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Workspaces
          </span>
          <button
            type="button"
            title="New Workspace"
            onClick={() => setCreatingWs((v) => !v)}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {creatingWs && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!wsName.trim()) return
              void window.orbitAPI.createWorkspace(wsName.trim())
              setWsName('')
              setCreatingWs(false)
            }}
            className="flex gap-1"
          >
            <input
              autoFocus
              type="text"
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              placeholder="Workspace name..."
              className="w-full rounded border border-slate-700 bg-[#151924] px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
            />
          </form>
        )}

        <div className="flex flex-wrap gap-1">
          {snapshot.workspaces.map((ws) => {
            const active = ws.id === snapshot.activeWorkspaceId
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => void window.orbitAPI.switchWorkspace(ws.id)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: ws.color }}
                />
                <span>{ws.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Vertical Tabs */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {wsTabs.map((tab) => {
          const isActive = tab.id === snapshot.activeTabId
          const isSplit = tab.id === snapshot.splitTabId
          return (
            <div
              key={tab.id}
              onClick={() => void window.orbitAPI.switchTab(tab.id)}
              title={tab.title}
              className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                isActive
                  ? 'bg-[#1e2433] text-white border border-slate-700/80'
                  : isSplit
                    ? 'bg-sky-500/10 text-sky-200 border border-sky-500/30'
                    : 'text-slate-300 hover:bg-slate-800/60'
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

              {!isActive && (
                <button
                  type="button"
                  title="Open in Split View"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.orbitAPI.toggleSplitView(tab.id)
                  }}
                  className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-sky-300 group-hover:flex"
                >
                  <Columns2 className="h-3 w-3" />
                </button>
              )}

              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void window.orbitAPI.closeTab(tab.id)
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-60 hover:bg-slate-700 hover:text-white group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Bottom Controls */}
      <div className="border-t border-slate-800 p-2 space-y-1">
        <button
          type="button"
          onClick={() => void window.orbitAPI.createTab()}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5 text-sky-400" />
          New Tab
        </button>

        {snapshot.canRestoreClosedTab && (
          <button
            type="button"
            onClick={() => void window.orbitAPI.restoreClosedTab()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reopen Closed Tab
          </button>
        )}

        <button
          type="button"
          onClick={() => void window.orbitAPI.updateSettings({ verticalTabs: false })}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
          Switch to Top Tabs
        </button>
      </div>
    </aside>
  )
}
