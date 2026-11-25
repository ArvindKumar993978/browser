package com.arvind.orbitbrowser

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class OrbitStorage(context: Context) : SQLiteOpenHelper(context, "orbit.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                visited_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_history_visited ON history(visited_at DESC)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                started_at INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS site_permissions (
                origin TEXT NOT NULL,
                permission TEXT NOT NULL,
                decision TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (origin, permission)
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS adblock_allowlist (
                hostname TEXT PRIMARY KEY,
                disabled_at INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                position INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS session_tabs (
                position INTEGER PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                workspace_id TEXT NOT NULL DEFAULT 'personal',
                is_active INTEGER NOT NULL
            )
            """.trimIndent()
        )

        val defaults = listOf(
            WorkspaceItem("personal", "Personal", "#38bdf8"),
            WorkspaceItem("work", "Work", "#a78bfa"),
            WorkspaceItem("research", "Research", "#34d399")
        )
        defaults.forEachIndexed { idx, ws ->
            val cv = ContentValues().apply {
                put("id", ws.id)
                put("name", ws.name)
                put("color", ws.color)
                put("position", idx)
            }
            db.insert("workspaces", null, cv)
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        onCreate(db)
    }

    fun getWorkspaces(): List<WorkspaceItem> {
        val list = mutableListOf<WorkspaceItem>()
        readableDatabase.rawQuery(
            "SELECT id, name, color FROM workspaces ORDER BY position ASC",
            null
        ).use { c ->
            while (c.moveToNext()) {
                list.add(WorkspaceItem(c.getString(0), c.getString(1), c.getString(2)))
            }
        }
        return list
    }

    fun createWorkspace(name: String): WorkspaceItem {
        val clean = name.trim().take(24).ifEmpty { "Workspace" }
        val id = "ws-${System.currentTimeMillis()}"
        val palette = listOf("#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6")
        val count = getWorkspaces().size
        val color = palette[count % palette.size]
        val cv = ContentValues().apply {
            put("id", id)
            put("name", clean)
            put("color", color)
            put("position", count)
        }
        writableDatabase.insert("workspaces", null, cv)
        return WorkspaceItem(id, clean, color)
    }

    fun addHistory(url: String, title: String) {
        if (!UrlUtils.isAllowedWebUrl(url)) return
        val now = System.currentTimeMillis()
        readableDatabase.rawQuery(
            "SELECT id, url, visited_at FROM history ORDER BY visited_at DESC LIMIT 1",
            null
        ).use { c ->
            if (c.moveToFirst() && c.getString(1) == url && now - c.getLong(2) < 15_000) {
                val cv = ContentValues().apply {
                    put("title", title.ifEmpty { url })
                    put("visited_at", now)
                }
                writableDatabase.update("history", cv, "id = ?", arrayOf(c.getLong(0).toString()))
                return
            }
        }
        val cv = ContentValues().apply {
            put("url", url)
            put("title", title.ifEmpty { url })
            put("visited_at", now)
        }
        writableDatabase.insert("history", null, cv)
    }

    fun getHistory(query: String = "", limit: Int = 120): List<HistoryItem> {
        val list = mutableListOf<HistoryItem>()
        val trimmed = query.trim()
        val cursor = if (trimmed.isEmpty()) {
            readableDatabase.rawQuery(
                "SELECT id, url, title, visited_at FROM history ORDER BY visited_at DESC LIMIT ?",
                arrayOf(limit.toString())
            )
        } else {
            val pat = "%$trimmed%"
            readableDatabase.rawQuery(
                "SELECT id, url, title, visited_at FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT ?",
                arrayOf(pat, pat, limit.toString())
            )
        }
        cursor.use { c ->
            while (c.moveToNext()) {
                list.add(HistoryItem(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3)))
            }
        }
        return list
    }

    fun deleteHistoryItem(id: Long) {
        writableDatabase.delete("history", "id = ?", arrayOf(id.toString()))
    }

    fun clearHistorySince(sinceMs: Long?) {
        if (sinceMs == null) {
            writableDatabase.delete("history", null, null)
        } else {
            writableDatabase.delete("history", "visited_at >= ?", arrayOf(sinceMs.toString()))
        }
    }

    fun isBookmarked(url: String): Boolean {
        readableDatabase.rawQuery("SELECT 1 FROM bookmarks WHERE url = ?", arrayOf(url)).use {
            return it.moveToFirst()
        }
    }

    fun toggleBookmark(url: String, title: String): Boolean {
        if (!UrlUtils.isAllowedWebUrl(url)) return false
        if (isBookmarked(url)) {
            writableDatabase.delete("bookmarks", "url = ?", arrayOf(url))
            return false
        }
        val cv = ContentValues().apply {
            put("url", url)
            put("title", title.ifEmpty { url })
            put("created_at", System.currentTimeMillis())
        }
        writableDatabase.insert("bookmarks", null, cv)
        return true
    }

    fun getBookmarks(): List<BookmarkItem> {
        val list = mutableListOf<BookmarkItem>()
        readableDatabase.rawQuery(
            "SELECT id, url, title, created_at FROM bookmarks ORDER BY created_at DESC",
            null
        ).use { c ->
            while (c.moveToNext()) {
                list.add(BookmarkItem(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3)))
            }
        }
        return list
    }

    fun deleteBookmark(id: Long) {
        writableDatabase.delete("bookmarks", "id = ?", arrayOf(id.toString()))
    }

    fun getSuggestions(query: String): List<OmniboxSuggestion> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        val pat = "%$trimmed%"
        val result = mutableListOf<OmniboxSuggestion>()
        val seen = HashSet<String>()

        readableDatabase.rawQuery(
            "SELECT title, url FROM bookmarks WHERE url LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT 4",
            arrayOf(pat, pat)
        ).use { c ->
            while (c.moveToNext()) {
                val url = c.getString(1)
                if (seen.add(url)) result.add(OmniboxSuggestion("bookmark", c.getString(0), url))
            }
        }

        readableDatabase.rawQuery(
            "SELECT title, url FROM history WHERE url LIKE ? OR title LIKE ? GROUP BY url ORDER BY MAX(visited_at) DESC LIMIT 6",
            arrayOf(pat, pat)
        ).use { c ->
            while (c.moveToNext()) {
                val url = c.getString(1)
                if (seen.add(url)) result.add(OmniboxSuggestion("history", c.getString(0), url))
            }
        }
        return result.take(6)
    }

    fun addDownload(record: DownloadRecord) {
        val cv = ContentValues().apply {
            put("id", record.id)
            put("url", record.url)
            put("filename", record.filename)
            put("started_at", record.startedAt)
        }
        writableDatabase.insertWithOnConflict("downloads", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getDownloads(): List<DownloadRecord> {
        val list = mutableListOf<DownloadRecord>()
        readableDatabase.rawQuery(
            "SELECT id, url, filename, started_at FROM downloads ORDER BY started_at DESC LIMIT 50",
            null
        ).use { c ->
            while (c.moveToNext()) {
                list.add(DownloadRecord(c.getString(0), c.getString(1), c.getString(2), c.getLong(3)))
            }
        }
        return list
    }

    fun clearDownloads() {
        writableDatabase.delete("downloads", null, null)
    }

    fun getPermission(origin: String, permission: String): String? {
        readableDatabase.rawQuery(
            "SELECT decision FROM site_permissions WHERE origin = ? AND permission = ?",
            arrayOf(origin, permission)
        ).use { c ->
            return if (c.moveToFirst()) c.getString(0) else null
        }
    }

    fun setPermission(origin: String, permission: String, decision: String) {
        val cv = ContentValues().apply {
            put("origin", origin)
            put("permission", permission)
            put("decision", decision)
            put("updated_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("site_permissions", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getAllPermissions(): List<SitePermissionRecord> {
        val list = mutableListOf<SitePermissionRecord>()
        readableDatabase.rawQuery(
            "SELECT origin, permission, decision, updated_at FROM site_permissions ORDER BY updated_at DESC",
            null
        ).use { c ->
            while (c.moveToNext()) {
                list.add(SitePermissionRecord(c.getString(0), c.getString(1), c.getString(2), c.getLong(3)))
            }
        }
        return list
    }

    fun deletePermission(origin: String, permission: String) {
        writableDatabase.delete("site_permissions", "origin = ? AND permission = ?", arrayOf(origin, permission))
    }

    fun clearPermissions() {
        writableDatabase.delete("site_permissions", null, null)
    }

    fun isAdblockDisabledForHost(hostname: String): Boolean {
        if (hostname.isBlank()) return false
        readableDatabase.rawQuery(
            "SELECT 1 FROM adblock_allowlist WHERE hostname = ?",
            arrayOf(hostname.lowercase())
        ).use {
            return it.moveToFirst()
        }
    }

    fun toggleAdblockForHost(hostname: String): Boolean {
        val norm = hostname.lowercase()
        if (norm.isBlank()) return false
        if (isAdblockDisabledForHost(norm)) {
            writableDatabase.delete("adblock_allowlist", "hostname = ?", arrayOf(norm))
            return false
        }
        val cv = ContentValues().apply {
            put("hostname", norm)
            put("disabled_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("adblock_allowlist", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        return true
    }

    fun getSettings(): BrowserSettings {
        val map = HashMap<String, String>()
        readableDatabase.rawQuery("SELECT key, value FROM settings", null).use { c ->
            while (c.moveToNext()) {
                map[c.getString(0)] = c.getString(1)
            }
        }
        return BrowserSettings(
            httpsFirst = map["httpsFirst"]?.toBooleanStrictOrNull() ?: true,
            adBlockGlobal = map["adBlockGlobal"]?.toBooleanStrictOrNull() ?: true,
            sleepAfterMinutes = map["sleepAfterMinutes"]?.toIntOrNull() ?: 10
        )
    }

    fun updateSettings(next: BrowserSettings) {
        val pairs = mapOf(
            "httpsFirst" to next.httpsFirst.toString(),
            "adBlockGlobal" to next.adBlockGlobal.toString(),
            "sleepAfterMinutes" to next.sleepAfterMinutes.toString()
        )
        pairs.forEach { (k, v) ->
            val cv = ContentValues().apply {
                put("key", k)
                put("value", v)
            }
            writableDatabase.insertWithOnConflict("settings", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }

    fun saveSessionTabs(tabs: List<SavedSessionTab>) {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.delete("session_tabs", null, null)
            tabs.forEachIndexed { idx, t ->
                val cv = ContentValues().apply {
                    put("position", idx)
                    put("url", t.url)
                    put("title", t.title)
                    put("workspace_id", t.workspaceId)
                    put("is_active", if (t.isActive) 1 else 0)
                }
                writableDatabase.insert("session_tabs", null, cv)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun loadSessionTabs(): List<SavedSessionTab> {
        val list = mutableListOf<SavedSessionTab>()
        readableDatabase.rawQuery(
            "SELECT url, title, workspace_id, is_active FROM session_tabs ORDER BY position ASC",
            null
        ).use { c ->
            while (c.moveToNext()) {
                list.add(
                    SavedSessionTab(
                        url = c.getString(0),
                        title = c.getString(1),
                        workspaceId = c.getString(2).ifEmpty { "personal" },
                        isActive = c.getInt(3) == 1
                    )
                )
            }
        }
        return list
    }
}
