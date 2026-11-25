import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Bookmark,
  Columns2,
  Download,
  EyeOff,
  FileText,
  Globe,
  History,
  Moon,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Shield
} from 'lucide-react'
import type { BrowserStateSnapshot } from '@shared/types'

interface CommandPaletteProps {
  snapshot: BrowserStateSnapshot
  onClose: () => void
}

interface PaletteEntry {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  run: () => void
}

export function CommandPalette({ snapshot, onClose }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const entries = useMemo<PaletteEntry[]>(() => {
    const activeId = snapshot.activeTabId
    const commands: PaletteEntry[] = [
      {
        id: 'cmd-new-tab',
        label: 'New Tab',
        hint: 'Ctrl+T',
        icon: <Plus className="h-4 w-4 text-sky-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.createTab()
        }
      },
      {
        id: 'cmd-private',
        label: 'New Private Window',
        hint: 'Ctrl+Shift+N',
        icon: <EyeOff className="h-4 w-4 text-purple-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.openPrivateWindow()
        }
      },
      {
        id: 'cmd-vertical',
        label: snapshot.settings.verticalTabs ? 'Switch to Horizontal Tabs' : 'Switch to Vertical Tabs',
        hint: 'Layout',
        icon: <PanelLeft className="h-4 w-4 text-sky-300" />,
        run: () => {
          onClose()
          void window.orbitAPI.updateSettings({ verticalTabs: !snapshot.settings.verticalTabs })
        }
      },
      {
        id: 'cmd-split',
        label: snapshot.splitTabId ? 'Exit Split View' : 'Toggle Split View',
        hint: 'Ctrl+\\',
        icon: <Columns2 className="h-4 w-4 text-emerald-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.toggleSplitView()
        }
      },
      {
        id: 'cmd-reader',
        label: snapshot.readerArticle ? 'Exit Reader Mode' : 'Open Reader Mode',
        hint: 'Ctrl+Alt+R',
        icon: <BookOpen className="h-4 w-4 text-amber-300" />,
        run: () => {
          onClose()
          void window.orbitAPI.toggleReaderMode()
        }
      },
      {
        id: 'cmd-sleep',
        label: 'Sleep Inactive Tabs Now',
        hint: 'Save RAM',
        icon: <Moon className="h-4 w-4 text-indigo-300" />,
        run: () => {
          onClose()
          void window.orbitAPI.sleepInactiveTabs()
        }
      },
      {
        id: 'cmd-bookmarks',
        label: 'Open Bookmarks',
        hint: 'Ctrl+B',
        icon: <Bookmark className="h-4 w-4 text-amber-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.setPanelMode('bookmarks')
        }
      },
      {
        id: 'cmd-history',
        label: 'Open History',
        hint: 'Ctrl+H',
        icon: <History className="h-4 w-4 text-sky-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.setPanelMode('history')
        }
      },
      {
        id: 'cmd-downloads',
        label: 'Open Downloads',
        hint: 'Ctrl+J',
        icon: <Download className="h-4 w-4 text-emerald-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.setPanelMode('downloads')
        }
      },
      {
        id: 'cmd-privacy',
        label: 'Open Privacy, Shield & Clear Data',
        hint: 'Security',
        icon: <Shield className="h-4 w-4 text-sky-400" />,
        run: () => {
          onClose()
          void window.orbitAPI.setPanelMode('privacy')
        }
      },
      {
        id: 'cmd-policy',
        label: 'View Orbit Privacy Policy & Architecture',
        hint: 'Trust',
        icon: <FileText className="h-4 w-4 text-emerald-300" />,
        run: () => {
          onClose()
          void window.orbitAPI.setPanelMode('policy')
        }
      }
    ]

    if (activeId) {
      commands.push({
        id: 'cmd-reload',
        label: 'Reload Active Tab',
        hint: 'Ctrl+R',
        icon: <RotateCw className="h-4 w-4 text-slate-300" />,
        run: () => {
          onClose()
          void window.orbitAPI.reloadOrStop(activeId)
        }
      })
    }

    const wsMap = new Map(snapshot.workspaces.map((w) => [w.id, w.name]))
    const tabEntries: PaletteEntry[] = snapshot.tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      label: tab.title || tab.url,
      hint: `Tab · ${wsMap.get(tab.workspaceId) ?? 'Personal'}`,
      icon: <Globe className="h-4 w-4 text-slate-400" />,
      run: () => {
        onClose()
        void window.orbitAPI.switchTab(tab.id)
      }
    }))

    const all = [...tabEntries, ...commands]
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 12)
    return all
      .filter((e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q))
      .slice(0, 12)
  }, [snapshot, query, onClose])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="flex flex-1 items-start justify-center bg-black/60 pt-16 px-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-[#141824] shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-sky-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose()
              } else if (e.key === 'ArrowDown' && entries.length > 0) {
                e.preventDefault()
                setSelectedIdx((i) => (i + 1) % entries.length)
              } else if (e.key === 'ArrowUp' && entries.length > 0) {
                e.preventDefault()
                setSelectedIdx((i) => (i <= 0 ? entries.length - 1 : i - 1))
              } else if (e.key === 'Enter' && entries[selectedIdx]) {
                e.preventDefault()
                entries[selectedIdx].run()
              }
            }}
            placeholder="Type a command, tab title, or workspace..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
          />
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            ESC
          </span>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">No matching commands or tabs.</div>
          ) : (
            entries.map((entry, idx) => (
              <button
                key={entry.id}
                type="button"
                onClick={entry.run}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                  idx === selectedIdx
                    ? 'bg-sky-600/30 text-white'
                    : 'text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {entry.icon}
                  <span className="truncate font-medium">{entry.label}</span>
                </div>
                <span className="ml-3 shrink-0 rounded bg-slate-800/90 px-2 py-0.5 text-[10px] text-slate-400">
                  {entry.hint}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
