package com.arvind.orbitbrowser

import android.webkit.WebView

data class WorkspaceItem(
    val id: String,
    val name: String,
    val color: String
)

data class TabItem(
    val id: String,
    var workspaceId: String,
    val isPrivate: Boolean,
    var title: String = "New Tab",
    var url: String,
    var isLoading: Boolean = true,
    var isSleeping: Boolean = false,
    var canGoBack: Boolean = false,
    var canGoForward: Boolean = false,
    var isSecure: Boolean = true,
    var blockedCount: Int = 0,
    var lastError: String? = null,
    var certError: String? = null,
    var canContinueOverHttp: Boolean = false,
    var lastActiveAt: Long = System.currentTimeMillis(),
    var webView: WebView? = null
)

data class ClosedTabEntry(
    val url: String,
    val title: String,
    val workspaceId: String
)

data class HistoryItem(
    val id: Long,
    val url: String,
    val title: String,
    val visitedAt: Long
)

data class BookmarkItem(
    val id: Long,
    val url: String,
    val title: String,
    val createdAt: Long
)

data class DownloadRecord(
    val id: String,
    val url: String,
    val filename: String,
    val startedAt: Long
)

data class SitePermissionRecord(
    val origin: String,
    val permission: String,
    val decision: String,
    val updatedAt: Long
)

data class BrowserSettings(
    val httpsFirst: Boolean = true,
    val adBlockGlobal: Boolean = true,
    val sleepAfterMinutes: Int = 10
)

data class ReaderBlock(
    val type: String,
    val text: String
)

data class ReaderArticle(
    val title: String,
    val byline: String,
    val siteName: String,
    val url: String,
    val blocks: List<ReaderBlock>
)

data class OmniboxSuggestion(
    val source: String,
    val title: String,
    val url: String
)

data class SavedSessionTab(
    val url: String,
    val title: String,
    val workspaceId: String,
    val isActive: Boolean
)
