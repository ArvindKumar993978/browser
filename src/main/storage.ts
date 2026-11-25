import { app } from 'electron'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type {
  BookmarkItem,
  BrowserSettings,
  DownloadItem,
  HistoryItem,
  OmniboxSuggestion,
  PermissionKind,
  SitePermissionRecord,
  WorkspaceItem
} from '../shared/types'

export interface SavedSessionTab {
  url: string
  title: string
  workspaceId: string
  isActive: boolean
}

const DEFAULT_SETTINGS: BrowserSettings = {
  httpsFirst: true,
  adBlockGlobal: true,
  sleepAfterMinutes: 10,
  verticalTabs: false
}

const DEFAULT_WORKSPACES: WorkspaceItem[] = [
  { id: 'personal', name: 'Personal', color: '#38bdf8' },
  { id: 'work', name: 'Work', color: '#a78bfa' },
  { id: 'research', name: 'Research', color: '#34d399' }
]

export class BrowserStorage {
  private readonly db: DatabaseSync

  constructor() {
    const dbPath = join(app.getPath('userData'), 'orbit.db')
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        visited_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_visited ON history(visited_at DESC);

      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        filename TEXT NOT NULL,
        save_path TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        received_bytes INTEGER NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS site_permissions (
        origin TEXT NOT NULL,
        permission TEXT NOT NULL,
        decision TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (origin, permission)
      );

      CREATE TABLE IF NOT EXISTS adblock_allowlist (
        hostname TEXT PRIMARY KEY,
        disabled_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_tabs (
        position INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'personal',
        is_active INTEGER NOT NULL
      );
    `)

    // Migrate existing session_tabs table if created in Phase 1/2 without workspace_id
    const cols = this.db.prepare('PRAGMA table_info(session_tabs)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'workspace_id')) {
      this.db.exec(`ALTER TABLE session_tabs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'personal';`)
    }

    const wsCount = (this.db.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number }).c
    if (wsCount === 0) {
      const stmt = this.db.prepare(
        'INSERT INTO workspaces (id, name, color, position) VALUES (?, ?, ?, ?)'
      )
      DEFAULT_WORKSPACES.forEach((ws, idx) => stmt.run(ws.id, ws.name, ws.color, idx))
    }
  }

  // --- Workspaces ---
  public getWorkspaces(): WorkspaceItem[] {
    return this.db
      .prepare('SELECT id, name, color FROM workspaces ORDER BY position ASC')
      .all() as unknown as WorkspaceItem[]
  }

  public createWorkspace(name: string): WorkspaceItem {
    const clean = name.trim().slice(0, 24) || 'Workspace'
    const id = `ws-${Date.now()}`
    const palette = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number }).c
    const color = palette[count % palette.length]
    this.db
      .prepare('INSERT INTO workspaces (id, name, color, position) VALUES (?, ?, ?, ?)')
      .run(id, clean, color, count)
    return { id, name: clean, color }
  }

  // --- History ---
  public addHistory(url: string, title: string): void {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return
    const now = Date.now()
    const last = this.db
      .prepare('SELECT id, url, visited_at FROM history ORDER BY visited_at DESC LIMIT 1')
      .get() as { id: number; url: string; visited_at: number } | undefined

    if (last && last.url === url && now - last.visited_at < 15_000) {
      this.db
        .prepare('UPDATE history SET title = ?, visited_at = ? WHERE id = ?')
        .run(title || url, now, last.id)
      return
    }

    this.db
      .prepare('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)')
      .run(url, title || url, now)
  }

  public getHistory(query = '', limit = 150): HistoryItem[] {
    const trimmed = query.trim()
    if (!trimmed) {
      return this.db
        .prepare(
          'SELECT id, url, title, visited_at as visitedAt FROM history ORDER BY visited_at DESC LIMIT ?'
        )
        .all(limit) as unknown as HistoryItem[]
    }
    const pattern = `%${trimmed}%`
    return this.db
      .prepare(
        `SELECT id, url, title, visited_at as visitedAt FROM history
         WHERE url LIKE ? OR title LIKE ?
         ORDER BY visited_at DESC LIMIT ?`
      )
      .all(pattern, pattern, limit) as unknown as HistoryItem[]
  }

  public deleteHistoryItem(id: number): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id)
  }

  public clearHistorySince(sinceMs: number | null): void {
    if (sinceMs === null) {
      this.db.prepare('DELETE FROM history').run()
    } else {
      this.db.prepare('DELETE FROM history WHERE visited_at >= ?').run(sinceMs)
    }
  }

  // --- Bookmarks ---
  public isBookmarked(url: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM bookmarks WHERE url = ?').get(url)
    return Boolean(row)
  }

  public toggleBookmark(url: string, title: string): boolean {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false
    if (this.isBookmarked(url)) {
      this.db.prepare('DELETE FROM bookmarks WHERE url = ?').run(url)
      return false
    }
    this.db
      .prepare('INSERT INTO bookmarks (url, title, created_at) VALUES (?, ?, ?)')
      .run(url, title || url, Date.now())
    return true
  }

  public getBookmarks(): BookmarkItem[] {
    return this.db
      .prepare(
        'SELECT id, url, title, created_at as createdAt FROM bookmarks ORDER BY created_at DESC'
      )
      .all() as unknown as BookmarkItem[]
  }

  public deleteBookmark(id: number): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  }

  // --- Omnibox Suggestions ---
  public getSuggestions(query: string): OmniboxSuggestion[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const pattern = `%${trimmed}%`

    const bookmarks = this.db
      .prepare(
        `SELECT 'bookmark' as source, title, url FROM bookmarks
         WHERE url LIKE ? OR title LIKE ?
         ORDER BY created_at DESC LIMIT 4`
      )
      .all(pattern, pattern) as unknown as OmniboxSuggestion[]

    const history = this.db
      .prepare(
        `SELECT 'history' as source, title, url FROM history
         WHERE url LIKE ? OR title LIKE ?
         GROUP BY url
         ORDER BY MAX(visited_at) DESC LIMIT 6`
      )
      .all(pattern, pattern) as unknown as OmniboxSuggestion[]

    const seen = new Set(bookmarks.map((b) => b.url))
    return [...bookmarks, ...history.filter((h) => !seen.has(h.url))].slice(0, 7)
  }

  // --- Downloads ---
  public upsertDownload(item: DownloadItem): void {
    this.db
      .prepare(
        `INSERT INTO downloads (id, url, filename, save_path, total_bytes, received_bytes, state, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           save_path = excluded.save_path,
           total_bytes = excluded.total_bytes,
           received_bytes = excluded.received_bytes,
           state = excluded.state`
      )
      .run(
        item.id,
        item.url,
        item.filename,
        item.savePath,
        item.totalBytes,
        item.receivedBytes,
        item.state,
        item.startedAt
      )
  }

  public getDownloads(limit = 50): DownloadItem[] {
    return this.db
      .prepare(
        `SELECT id, url, filename, save_path as savePath, total_bytes as totalBytes,
                received_bytes as receivedBytes, state, started_at as startedAt
         FROM downloads ORDER BY started_at DESC LIMIT ?`
      )
      .all(limit) as unknown as DownloadItem[]
  }

  public clearDownloads(): void {
    this.db.prepare('DELETE FROM downloads').run()
  }

  // --- Site Permissions ---
  public getPermission(origin: string, permission: PermissionKind): 'allow' | 'deny' | null {
    const row = this.db
      .prepare('SELECT decision FROM site_permissions WHERE origin = ? AND permission = ?')
      .get(origin, permission) as { decision: 'allow' | 'deny' } | undefined
    return row ? row.decision : null
  }

  public setPermission(
    origin: string,
    permission: PermissionKind,
    decision: 'allow' | 'deny'
  ): void {
    this.db
      .prepare(
        `INSERT INTO site_permissions (origin, permission, decision, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(origin, permission) DO UPDATE SET
           decision = excluded.decision,
           updated_at = excluded.updated_at`
      )
      .run(origin, permission, decision, Date.now())
  }

  public getAllPermissions(): SitePermissionRecord[] {
    return this.db
      .prepare(
        `SELECT origin, permission, decision, updated_at as updatedAt
         FROM site_permissions ORDER BY updated_at DESC`
      )
      .all() as unknown as SitePermissionRecord[]
  }

  public deletePermission(origin: string, permission: PermissionKind): void {
    this.db
      .prepare('DELETE FROM site_permissions WHERE origin = ? AND permission = ?')
      .run(origin, permission)
  }

  public clearPermissions(): void {
    this.db.prepare('DELETE FROM site_permissions').run()
  }

  // --- Per-Site Adblock Allowlist ---
  public isAdblockDisabledForHost(hostname: string): boolean {
    if (!hostname) return false
    const row = this.db
      .prepare('SELECT 1 FROM adblock_allowlist WHERE hostname = ?')
      .get(hostname.toLowerCase())
    return Boolean(row)
  }

  public toggleAdblockForHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase()
    if (!normalized) return false
    if (this.isAdblockDisabledForHost(normalized)) {
      this.db.prepare('DELETE FROM adblock_allowlist WHERE hostname = ?').run(normalized)
      return false
    }
    this.db
      .prepare('INSERT INTO adblock_allowlist (hostname, disabled_at) VALUES (?, ?)')
      .run(normalized, Date.now())
    return true
  }

  // --- Settings ---
  public getSettings(): BrowserSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string
      value: string
    }>
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return {
      httpsFirst: map.has('httpsFirst') ? map.get('httpsFirst') === 'true' : DEFAULT_SETTINGS.httpsFirst,
      adBlockGlobal: map.has('adBlockGlobal')
        ? map.get('adBlockGlobal') === 'true'
        : DEFAULT_SETTINGS.adBlockGlobal,
      sleepAfterMinutes: map.has('sleepAfterMinutes')
        ? Number(map.get('sleepAfterMinutes')) || DEFAULT_SETTINGS.sleepAfterMinutes
        : DEFAULT_SETTINGS.sleepAfterMinutes,
      verticalTabs: map.has('verticalTabs')
        ? map.get('verticalTabs') === 'true'
        : DEFAULT_SETTINGS.verticalTabs
    }
  }

  public updateSettings(partial: Partial<BrowserSettings>): BrowserSettings {
    const next = { ...this.getSettings(), ...partial }
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    stmt.run('httpsFirst', String(next.httpsFirst))
    stmt.run('adBlockGlobal', String(next.adBlockGlobal))
    stmt.run('sleepAfterMinutes', String(next.sleepAfterMinutes))
    stmt.run('verticalTabs', String(next.verticalTabs))
    return next
  }

  // --- Session Restore ---
  public saveSessionTabs(tabs: SavedSessionTab[]): void {
    this.db.exec('DELETE FROM session_tabs;')
    const stmt = this.db.prepare(
      'INSERT INTO session_tabs (position, url, title, workspace_id, is_active) VALUES (?, ?, ?, ?, ?)'
    )
    tabs.forEach((tab, idx) => {
      stmt.run(idx, tab.url, tab.title, tab.workspaceId, tab.isActive ? 1 : 0)
    })
  }

  public loadSessionTabs(): SavedSessionTab[] {
    const rows = this.db
      .prepare('SELECT url, title, workspace_id, is_active FROM session_tabs ORDER BY position ASC')
      .all() as Array<{ url: string; title: string; workspace_id: string; is_active: number }>
    return rows.map((r) => ({
      url: r.url,
      title: r.title,
      workspaceId: r.workspace_id || 'personal',
      isActive: r.is_active === 1
    }))
  }
}
