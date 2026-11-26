package com.arvind.orbitbrowser

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var storage: OrbitStorage
    private val adblocker = AdBlocker()
    private val handler = Handler(Looper.getMainLooper())

    private val tabs = mutableListOf<TabItem>()
    private val closedTabs = mutableListOf<ClosedTabEntry>()
    private var activeWorkspaceId = "personal"
    private var activeTabId: String? = null
    private var splitPair: Pair<String, String>? = null
    private var privateMode = false

    // UI references
    private lateinit var rootLayout: LinearLayout
    private lateinit var topHeader: LinearLayout
    private lateinit var workspaceStrip: LinearLayout
    private lateinit var tabStrip: LinearLayout
    private lateinit var navBar: LinearLayout
    private lateinit var addressInput: EditText
    private lateinit var securityBadge: TextView
    private lateinit var shieldPill: TextView
    private lateinit var bookmarkStar: TextView
    private lateinit var btnBack: TextView
    private lateinit var btnForward: TextView
    private lateinit var btnReload: TextView
    private lateinit var btnSplit: TextView
    private lateinit var btnPrivate: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var suggestionsBox: LinearLayout
    private lateinit var findBar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCountText: TextView
    private lateinit var permissionBar: LinearLayout
    private lateinit var permissionText: TextView
    private lateinit var contentContainer: FrameLayout
    private lateinit var webSplitContainer: LinearLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorTitle: TextView
    private lateinit var errorUrl: TextView
    private lateinit var errorDetail: TextView
    private lateinit var errorBackBtn: Button
    private lateinit var errorReloadBtn: Button
    private lateinit var errorHttpBtn: Button
    private lateinit var fullscreenContainer: FrameLayout

    private var customFullscreenView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var pendingPermAction: ((Boolean, Boolean) -> Unit)? = null

    private val sleepChecker = object : Runnable {
        override fun run() {
            sleepTimedOutTabs()
            handler.postDelayed(this, 30_000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        storage = OrbitStorage(this)
        adblocker.initialize(this)

        buildLayout()
        handleBackPress()
        initializeTabs(intent?.dataString)

        handler.postDelayed(sleepChecker, 30_000L)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.dataString
        if (UrlUtils.isAllowedWebUrl(url)) {
            createTab(url, activate = true)
        }
    }

    override fun onPause() {
        super.onPause()
        persistSession()
    }

    override fun onDestroy() {
        handler.removeCallbacks(sleepChecker)
        persistSession()
        tabs.forEach { it.webView?.destroy() }
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateSplitOrientation()
    }

    private fun buildLayout() {
        val d = BrowserDialogs
        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0f1117"))
        }

        topHeader = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0f1117"))
        }

        // Row 1: Workspaces + Horizontal Tabs + New Tab + Restore
        val topScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setPadding(d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4))
        }
        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        workspaceStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        tabStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        topRow.addView(workspaceStrip)
        topRow.addView(tabStrip)
        topScroll.addView(topRow)
        topHeader.addView(topScroll)

        // Row 2: Navigation + Omnibox + Action Buttons
        navBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1a1e29"))
            setPadding(d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 6))
        }

        btnBack = navIcon("←") { activeTab()?.let { if (it.webView?.canGoBack() == true) it.webView?.goBack() } }
        btnForward = navIcon("→") { activeTab()?.let { if (it.webView?.canGoForward() == true) it.webView?.goForward() } }
        btnReload = navIcon("↻") { reloadOrStopActive() }
        navBar.addView(btnBack)
        navBar.addView(btnForward)
        navBar.addView(btnReload)

        val omnibox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = d.roundedBg("#0f1117", 20f, this@MainActivity, "#334155")
            setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 4), d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4))
            layoutParams = LinearLayout.LayoutParams(0, d.dp(this@MainActivity, 38), 1f).apply {
                marginStart = d.dp(this@MainActivity, 4)
                marginEnd = d.dp(this@MainActivity, 4)
            }
        }

        securityBadge = TextView(this).apply {
            text = "🔒"
            textSize = 12f
            setPadding(0, 0, d.dp(this@MainActivity, 6), 0)
        }
        addressInput = EditText(this).apply {
            hint = "Search or enter URL..."
            setHintTextColor(Color.parseColor("#64748b"))
            setTextColor(Color.parseColor("#f1f5f9"))
            textSize = 13f
            background = null
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            setSelectAllOnFocus(true)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                    commitAddress(text.toString())
                    true
                } else false
            }
            setOnFocusChangeListener { _, hasFocus ->
                if (!hasFocus) {
                    handler.postDelayed({ suggestionsBox.visibility = View.GONE }, 150)
                }
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (hasFocus()) updateSuggestions(s?.toString() ?: "")
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        shieldPill = TextView(this).apply {
            text = "🛡"
            textSize = 11f
            setTextColor(Color.parseColor("#7dd3fc"))
            background = d.roundedBg("#1e293b", 12f, this@MainActivity)
            setPadding(d.dp(this@MainActivity, 7), d.dp(this@MainActivity, 3), d.dp(this@MainActivity, 7), d.dp(this@MainActivity, 3))
            setOnClickListener { toggleActiveSiteShield() }
        }
        bookmarkStar = TextView(this).apply {
            text = "☆"
            textSize = 16f
            setTextColor(Color.parseColor("#94a3b8"))
            setPadding(d.dp(this@MainActivity, 6), 0, d.dp(this@MainActivity, 2), 0)
            setOnClickListener { toggleActiveBookmark() }
        }
        omnibox.addView(securityBadge)
        omnibox.addView(addressInput)
        omnibox.addView(shieldPill)
        omnibox.addView(bookmarkStar)
        navBar.addView(omnibox)

        val btnReader = navIcon("📖") { openReaderMode() }
        btnSplit = navIcon("▥") { toggleSplitView() }
        val btnCmd = navIcon("⌘") { openCommandPalette() }
        btnPrivate = navIcon("🕶") { togglePrivateNewTab() }
        val btnMenu = navIcon("☰") { openSidePanel("privacy") }
        navBar.addView(btnReader)
        navBar.addView(btnSplit)
        navBar.addView(btnCmd)
        navBar.addView(btnPrivate)
        navBar.addView(btnMenu)
        topHeader.addView(navBar)

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, d.dp(this@MainActivity, 2))
        }
        topHeader.addView(progressBar)

        // Omnibox Suggestions
        suggestionsBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#141824"))
            visibility = View.GONE
            setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 8))
        }
        topHeader.addView(suggestionsBox)

        // Find in page bar
        findBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#141824"))
            visibility = View.GONE
            setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 6))
        }
        findInput = EditText(this).apply {
            hint = "Find in page..."
            setHintTextColor(Color.parseColor("#64748b"))
            setTextColor(Color.parseColor("#f1f5f9"))
            textSize = 13f
            isSingleLine = true
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    activeTab()?.webView?.findAllAsync(s?.toString() ?: "")
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        findCountText = TextView(this).apply {
            setTextColor(Color.parseColor("#94a3b8"))
            textSize = 11f
            setPadding(d.dp(this@MainActivity, 6), 0, d.dp(this@MainActivity, 6), 0)
        }
        findBar.addView(findInput)
        findBar.addView(findCountText)
        findBar.addView(navIcon("▲") { activeTab()?.webView?.findNext(false) })
        findBar.addView(navIcon("▼") { activeTab()?.webView?.findNext(true) })
        findBar.addView(navIcon("✕") {
            findBar.visibility = View.GONE
            activeTab()?.webView?.clearMatches()
        })
        topHeader.addView(findBar)

        // Permission Prompt bar
        permissionBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1a2234"))
            visibility = View.GONE
            setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 8))
        }
        permissionText = TextView(this).apply {
            setTextColor(Color.parseColor("#e2e8f0"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val bOnce = smallActionBtn("Allow", "#334155") { resolvePermission(true, false) }
        val bAlways = smallActionBtn("Always", "#0284c7") { resolvePermission(true, true) }
        val bDeny = smallActionBtn("Block", "#e11d48") { resolvePermission(false, !privateMode) }
        permissionBar.addView(permissionText)
        permissionBar.addView(bOnce)
        permissionBar.addView(bAlways)
        permissionBar.addView(bDeny)
        topHeader.addView(permissionBar)

        rootLayout.addView(topHeader)

        // Content container: Split View + Error Overlay + Fullscreen Video
        contentContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        webSplitContainer = LinearLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#0f1117"))
        }
        updateSplitOrientation()
        contentContainer.addView(webSplitContainer)

        errorOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0d1017"))
            visibility = View.GONE
            setPadding(d.dp(this@MainActivity, 24), d.dp(this@MainActivity, 24), d.dp(this@MainActivity, 24), d.dp(this@MainActivity, 24))
        }
        errorTitle = TextView(this).apply {
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#f1f5f9"))
            gravity = Gravity.CENTER
        }
        errorUrl = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor("#94a3b8"))
            gravity = Gravity.CENTER
            setPadding(0, d.dp(this@MainActivity, 8), 0, d.dp(this@MainActivity, 8))
        }
        errorDetail = TextView(this).apply {
            textSize = 12.5f
            setTextColor(Color.parseColor("#cbd5e1"))
            background = d.roundedBg("#151923", 10f, this@MainActivity, "#334155")
            setPadding(d.dp(this@MainActivity, 14), d.dp(this@MainActivity, 12), d.dp(this@MainActivity, 14), d.dp(this@MainActivity, 12))
        }
        val errBtns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, d.dp(this@MainActivity, 16), 0, 0)
        }
        errorBackBtn = Button(this).apply { text = "Go Back" }
        errorReloadBtn = Button(this).apply { text = "Reload" }
        errorHttpBtn = Button(this).apply { text = "Continue HTTP" }
        errBtns.addView(errorBackBtn)
        errBtns.addView(errorReloadBtn)
        errBtns.addView(errorHttpBtn)
        errorOverlay.addView(errorTitle)
        errorOverlay.addView(errorUrl)
        errorOverlay.addView(errorDetail)
        errorOverlay.addView(errBtns)
        contentContainer.addView(errorOverlay)

        fullscreenContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }
        contentContainer.addView(fullscreenContainer)

        rootLayout.addView(contentContainer)
        setContentView(rootLayout)
    }

    private fun updateSplitOrientation() {
        val isLandscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        webSplitContainer.orientation = if (isLandscape) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
    }

    private fun navIcon(label: String, onClick: () -> Unit): TextView {
        val d = BrowserDialogs
        return TextView(this).apply {
            text = label
            textSize = 15f
            setTextColor(Color.parseColor("#e2e8f0"))
            gravity = Gravity.CENTER
            setPadding(d.dp(this@MainActivity, 7), d.dp(this@MainActivity, 5), d.dp(this@MainActivity, 7), d.dp(this@MainActivity, 5))
            setOnClickListener { onClick() }
        }
    }

    private fun smallActionBtn(label: String, bgHex: String, onClick: () -> Unit): TextView {
        val d = BrowserDialogs
        return TextView(this).apply {
            text = label
            textSize = 11.5f
            setTextColor(Color.WHITE)
            background = d.roundedBg(bgHex, 6f, this@MainActivity)
            setPadding(d.dp(this@MainActivity, 9), d.dp(this@MainActivity, 5), d.dp(this@MainActivity, 9), d.dp(this@MainActivity, 5))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = d.dp(this@MainActivity, 5) }
            setOnClickListener { onClick() }
        }
    }

    private fun initializeTabs(launchUrl: String?) {
        val workspaces = storage.getWorkspaces()
        activeWorkspaceId = workspaces.firstOrNull()?.id ?: "personal"

        val saved = storage.loadSessionTabs()
        if (saved.isNotEmpty()) {
            var activeId: String? = null
            saved.forEach { s ->
                val wsId = if (workspaces.any { it.id == s.workspaceId }) s.workspaceId else activeWorkspaceId
                val id = createTab(s.url, activate = false, title = s.title, workspaceId = wsId, privateTab = false)
                if (s.isActive) activeId = id
            }
            if (UrlUtils.isAllowedWebUrl(launchUrl)) {
                createTab(launchUrl, activate = true)
            } else {
                switchTab(activeId ?: tabs.first().id)
            }
            return
        }

        val defaults = listOf("https://www.google.com", "https://www.youtube.com", "https://duckduckgo.com")
        defaults.forEach { url ->
            createTab(url, activate = false, workspaceId = activeWorkspaceId, privateTab = false)
        }
        if (UrlUtils.isAllowedWebUrl(launchUrl)) {
            createTab(launchUrl, activate = true)
        } else if (tabs.isNotEmpty()) {
            switchTab(tabs.first().id)
        }
    }

    private fun activeTab(): TabItem? = tabs.firstOrNull { it.id == activeTabId }

    private fun createTab(
        rawUrl: String? = null,
        activate: Boolean = true,
        title: String = "New Tab",
        workspaceId: String = activeWorkspaceId,
        privateTab: Boolean = privateMode
    ): String {
        val settings = storage.getSettings()
        val url = if (rawUrl.isNullOrBlank()) "https://duckduckgo.com" else UrlUtils.normalizeAddressInput(rawUrl, settings.httpsFirst)
        val id = UUID.randomUUID().toString()
        val tab = TabItem(
            id = id,
            workspaceId = workspaceId,
            isPrivate = privateTab,
            title = title,
            url = url,
            isSecure = url.startsWith("https://")
        )
        tabs.add(tab)
        mountWebView(tab)
        if (activate) {
            activeWorkspaceId = workspaceId
            privateMode = privateTab
            switchTab(id)
        } else {
            refreshChrome()
        }
        return id
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun mountWebView(tab: TabItem) {
        val wv = WebView(this)
        tab.webView = wv
        tab.isSleeping = false
        tab.isLoading = true
        tab.lastError = null
        tab.certError = null
        tab.canContinueOverHttp = false

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = !tab.isPrivate
            databaseEnabled = !tab.isPrivate
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
        }

        if (tab.isPrivate) {
            CookieManager.getInstance().setAcceptCookie(true)
        }

        wv.setOnTouchListener { _, _ ->
            if (splitPair != null && activeTabId != tab.id && (splitPair?.first == tab.id || splitPair?.second == tab.id)) {
                activeTabId = tab.id
                refreshChrome()
            }
            false
        }

        wv.setFindListener { activeMatchOrdinal, numberOfMatches, isDoneCounting ->
            if (isDoneCounting && tab.id == activeTabId) {
                findCountText.text = if (numberOfMatches > 0) "${activeMatchOrdinal + 1}/$numberOfMatches" else "0/0"
            }
        }

        wv.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            if (!UrlUtils.isAllowedWebUrl(url)) return@setDownloadListener
            val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val req = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(filename)
                setDescription("Orbit Browser Download")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(req)
            storage.addDownload(DownloadRecord(UUID.randomUUID().toString(), url, filename, System.currentTimeMillis()))
            Toast.makeText(this, "Downloading $filename", Toast.LENGTH_SHORT).show()
        }

        wv.setOnLongClickListener {
            val hit = wv.hitTestResult
            val extra = hit.extra
            if (extra != null && UrlUtils.isAllowedWebUrl(extra)) {
                val items = mutableListOf("Open in New Tab", "Open in Split View", "Copy Link")
                if (hit.type == WebView.HitTestResult.IMAGE_TYPE || hit.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                    items.add("Save Image")
                }
                AlertDialog.Builder(this)
                    .setItems(items.toTypedArray()) { _, which ->
                        when (items[which]) {
                            "Open in New Tab" -> createTab(extra, activate = true, workspaceId = tab.workspaceId, privateTab = tab.isPrivate)
                            "Open in Split View" -> {
                                val newId = createTab(extra, activate = false, workspaceId = tab.workspaceId, privateTab = tab.isPrivate)
                                splitPair = tab.id to newId
                                renderWebPanes()
                                refreshChrome()
                            }
                            "Copy Link" -> {
                                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                cm.setPrimaryClip(ClipData.newPlainText("URL", extra))
                                Toast.makeText(this, "Link copied", Toast.LENGTH_SHORT).show()
                            }
                            "Save Image" -> {
                                val fn = URLUtil.guessFileName(extra, null, "image/*")
                                val req = DownloadManager.Request(Uri.parse(extra)).apply {
                                    setTitle(fn)
                                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fn)
                                }
                                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                            }
                        }
                    }.show()
                true
            } else false
        }

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUrl = request?.url?.toString() ?: return false
                if (!UrlUtils.isAllowedWebUrl(targetUrl)) return true

                val settings = storage.getSettings()
                val host = UrlUtils.extractHostname(targetUrl)
                if (settings.httpsFirst && targetUrl.startsWith("http://") && !UrlUtils.isPrivateOrLocalHost(host) && !adblocker.isHttpFallbackAllowed(host)) {
                    val upgraded = targetUrl.replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "https://")
                    view?.loadUrl(upgraded)
                    return true
                }
                return false
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val reqUrl = request?.url?.toString() ?: return null
                if (request.isForMainFrame) return null
                val settings = storage.getSettings()
                if (!settings.adBlockGlobal) return null
                val pageHost = UrlUtils.extractHostname(tab.url)
                if (pageHost.isNotEmpty() && storage.isAdblockDisabledForHost(pageHost)) return null

                if (adblocker.shouldBlockRequest(reqUrl, pageHost)) {
                    tab.blockedCount += 1
                    if (tab.id == activeTabId) {
                        handler.post { updateShieldBadge() }
                    }
                    return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                tab.isLoading = true
                tab.lastError = null
                tab.certError = null
                tab.canContinueOverHttp = false
                if (!url.isNullOrBlank()) {
                    tab.url = url
                    tab.isSecure = url.startsWith("https://")
                    tab.blockedCount = 0
                }
                if (tab.id == activeTabId) refreshChrome()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                tab.isLoading = false
                if (!url.isNullOrBlank()) {
                    tab.url = url
                    tab.isSecure = url.startsWith("https://")
                }
                tab.title = view?.title?.ifBlank { tab.url } ?: tab.url
                tab.canGoBack = view?.canGoBack() ?: false
                tab.canGoForward = view?.canGoForward() ?: false
                val settings = storage.getSettings()
                val pageHost = UrlUtils.extractHostname(tab.url)
                if (settings.adBlockGlobal && (pageHost.isEmpty() || !storage.isAdblockDisabledForHost(pageHost))) {
                    view?.evaluateJavascript(adblocker.buildCosmeticScript(tab.url), null)
                }
                if (!tab.isPrivate && tab.lastError == null && tab.certError == null) {
                    storage.addHistory(tab.url, tab.title)
                }
                if (tab.id == activeTabId) {
                    renderErrorOverlayIfNeeded()
                    refreshChrome()
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame != true) return
                tab.isLoading = false
                val failedUrl = request.url?.toString() ?: tab.url
                tab.url = failedUrl
                tab.lastError = "${error?.description ?: "Failed to load"} (${error?.errorCode ?: -1})"
                val host = UrlUtils.extractHostname(failedUrl)
                tab.canContinueOverHttp = failedUrl.startsWith("https://") && host.isNotEmpty() && !UrlUtils.isPrivateOrLocalHost(host)
                if (tab.id == activeTabId) {
                    renderErrorOverlayIfNeeded()
                    refreshChrome()
                }
            }

            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                // Never bypass untrusted certificates silently
                handler?.cancel()
                tab.isLoading = false
                tab.isSecure = false
                tab.canContinueOverHttp = false
                tab.certError = "Untrusted TLS certificate (error ${error?.primaryError ?: -1})"
                if (tab.id == activeTabId) {
                    renderErrorOverlayIfNeeded()
                    refreshChrome()
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (tab.id == activeTabId) {
                    progressBar.progress = newProgress
                    progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
                }
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                if (!title.isNullOrBlank()) {
                    tab.title = title
                    refreshTabsOnly()
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val origin = UrlUtils.extractOrigin(request.origin?.toString() ?: tab.url)
                if (origin.isEmpty()) {
                    request.deny()
                    return
                }
                val res = request.resources ?: emptyArray()
                val hasCam = PermissionRequest.RESOURCE_VIDEO_CAPTURE in res
                val hasMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in res
                val kind = when {
                    hasCam && hasMic -> "camera and microphone"
                    hasCam -> "camera"
                    hasMic -> "microphone"
                    else -> {
                        request.deny()
                        return
                    }
                }

                if (!tab.isPrivate) {
                    val saved = storage.getPermission(origin, kind)
                    if (saved == "allow") { request.grant(res); return }
                    if (saved == "deny") { request.deny(); return }
                }

                handler.post {
                    showPermissionPrompt(origin, kind) { allow, remember ->
                        if (!tab.isPrivate && remember) {
                            storage.setPermission(origin, kind, if (allow) "allow" else "deny")
                        }
                        if (allow) request.grant(res) else request.deny()
                    }
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                if (origin.isNullOrBlank() || callback == null) return
                val cleanOrigin = UrlUtils.extractOrigin(origin)
                if (!tab.isPrivate) {
                    val saved = storage.getPermission(cleanOrigin, "location")
                    if (saved == "allow") { callback.invoke(origin, true, false); return }
                    if (saved == "deny") { callback.invoke(origin, false, false); return }
                }
                handler.post {
                    showPermissionPrompt(cleanOrigin.ifEmpty { origin }, "location") { allow, remember ->
                        if (!tab.isPrivate && remember && cleanOrigin.isNotEmpty()) {
                            storage.setPermission(cleanOrigin, "location", if (allow) "allow" else "deny")
                        }
                        callback.invoke(origin, allow, false)
                    }
                }
            }

            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
                val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                val popupDialog = AlertDialog.Builder(this@MainActivity, android.R.style.Theme_DeviceDefault_Dialog_NoActionBar).create()
                val popupWeb = WebView(this@MainActivity).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = !tab.isPrivate
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.allowFileAccess = false
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(v: WebView?, req: WebResourceRequest?): Boolean {
                            val u = req?.url?.toString() ?: return true
                            return !UrlUtils.isAllowedWebUrl(u)
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onCloseWindow(window: WebView?) {
                            popupDialog.dismiss()
                        }
                    }
                }
                popupDialog.setView(popupWeb)
                popupDialog.setOnDismissListener { popupWeb.destroy() }
                popupDialog.show()
                transport.webView = popupWeb
                resultMsg.sendToTarget()
                return true
            }

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) return
                customFullscreenView = view
                customViewCallback = callback
                topHeader.visibility = View.GONE
                fullscreenContainer.removeAllViews()
                fullscreenContainer.addView(view)
                fullscreenContainer.visibility = View.VISIBLE
            }

            override fun onHideCustomView() {
                exitHtmlFullscreen()
            }
        }

        wv.loadUrl(tab.url)
    }

    private fun exitHtmlFullscreen() {
        fullscreenContainer.visibility = View.GONE
        fullscreenContainer.removeAllViews()
        customFullscreenView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        topHeader.visibility = View.VISIBLE
    }

    private fun switchTab(tabId: String) {
        val target = tabs.firstOrNull { it.id == tabId } ?: return
        activeTab()?.lastActiveAt = System.currentTimeMillis()
        if (target.workspaceId != activeWorkspaceId) {
            activeWorkspaceId = target.workspaceId
            splitPair = null
        } else if (splitPair != null && splitPair?.first != tabId && splitPair?.second != tabId) {
            splitPair = null
        }
        activeTabId = tabId
        privateMode = target.isPrivate
        target.lastActiveAt = System.currentTimeMillis()
        if (target.isSleeping || target.webView == null) {
            mountWebView(target)
        }
        renderWebPanes()
        renderErrorOverlayIfNeeded()
        refreshChrome()
    }

    private fun closeTab(tabId: String) {
        val idx = tabs.indexOfFirst { it.id == tabId }
        if (idx == -1) return
        val removed = tabs.removeAt(idx)
        if (!removed.isPrivate && UrlUtils.isAllowedWebUrl(removed.url)) {
            closedTabs.add(ClosedTabEntry(removed.url, removed.title, removed.workspaceId))
            if (closedTabs.size > 20) closedTabs.removeAt(0)
        }
        if (splitPair?.first == tabId || splitPair?.second == tabId) {
            splitPair = null
        }
        removed.webView?.destroy()
        removed.webView = null

        val wsTabs = tabs.filter { it.workspaceId == activeWorkspaceId }
        if (wsTabs.isEmpty()) {
            activeTabId = null
            createTab("https://duckduckgo.com", activate = true, workspaceId = activeWorkspaceId, privateTab = privateMode)
            return
        }
        if (activeTabId == tabId) {
            switchTab(wsTabs.last().id)
        } else {
            renderWebPanes()
            refreshChrome()
        }
    }

    private fun restoreClosedTab() {
        if (closedTabs.isEmpty()) return
        val last = closedTabs.removeAt(closedTabs.size - 1)
        createTab(last.url, activate = true, title = last.title, workspaceId = last.workspaceId, privateTab = false)
    }

    private fun renderWebPanes() {
        webSplitContainer.removeAllViews()
        val pair = splitPair
        val splitValid = pair != null &&
            pair.first != pair.second &&
            tabs.any { it.id == pair.first } &&
            tabs.any { it.id == pair.second } &&
            (activeTabId == pair.first || activeTabId == pair.second)

        if (splitValid && pair != null) {
            val left = tabs.first { it.id == pair.first }
            val right = tabs.first { it.id == pair.second }
            if (left.webView == null) mountWebView(left)
            if (right.webView == null) mountWebView(right)
            attachPane(left.webView)
            webSplitContainer.addView(View(this).apply {
                setBackgroundColor(Color.parseColor("#0f1117"))
                layoutParams = LinearLayout.LayoutParams(BrowserDialogs.dp(this@MainActivity, 4), BrowserDialogs.dp(this@MainActivity, 4))
            })
            attachPane(right.webView)
        } else {
            val active = activeTab() ?: return
            if (active.webView == null) mountWebView(active)
            attachPane(active.webView)
        }
    }

    private fun attachPane(wv: WebView?) {
        if (wv == null) return
        (wv.parent as? ViewGroup)?.removeView(wv)
        wv.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
        webSplitContainer.addView(wv)
    }

    private fun renderErrorOverlayIfNeeded() {
        val tab = activeTab()
        val hasErr = tab != null && (tab.lastError != null || tab.certError != null)
        if (!hasErr || tab == null) {
            errorOverlay.visibility = View.GONE
            return
        }
        val isCert = tab.certError != null
        errorTitle.text = if (isCert) "Your connection is not private" else "This site can't be reached"
        errorUrl.text = tab.url
        errorDetail.text = tab.certError ?: tab.lastError ?: ""
        errorBackBtn.visibility = if (tab.canGoBack) View.VISIBLE else View.GONE
        errorReloadBtn.visibility = if (isCert) View.GONE else View.VISIBLE
        errorHttpBtn.visibility = if (tab.canContinueOverHttp) View.VISIBLE else View.GONE

        errorBackBtn.setOnClickListener {
            tab.lastError = null
            tab.certError = null
            tab.webView?.goBack()
            renderErrorOverlayIfNeeded()
        }
        errorReloadBtn.setOnClickListener {
            tab.lastError = null
            tab.webView?.reload()
            renderErrorOverlayIfNeeded()
        }
        errorHttpBtn.setOnClickListener {
            val host = UrlUtils.extractHostname(tab.url)
            adblocker.allowHttpFallbackForHost(host)
            val httpUrl = tab.url.replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "http://")
            tab.lastError = null
            tab.canContinueOverHttp = false
            tab.url = httpUrl
            tab.isSecure = false
            tab.webView?.loadUrl(httpUrl)
            renderErrorOverlayIfNeeded()
            refreshChrome()
        }
        errorOverlay.visibility = View.VISIBLE
    }

    private fun refreshChrome() {
        val d = BrowserDialogs
        val active = activeTab()
        val bgBase = if (privateMode) "#120f1d" else "#0f1117"
        val bgBar = if (privateMode) "#1d1730" else "#1a1e29"
        rootLayout.setBackgroundColor(Color.parseColor(bgBase))
        topHeader.setBackgroundColor(Color.parseColor(bgBase))
        navBar.setBackgroundColor(Color.parseColor(bgBar))
        window.statusBarColor = Color.parseColor(bgBase)

        workspaceStrip.removeAllViews()
        if (privateMode) {
            workspaceStrip.addView(TextView(this).apply {
                text = "Private"
                textSize = 11f
                setTextColor(Color.parseColor("#e9d5ff"))
                background = d.roundedBg("#4c1d95", 6f, this@MainActivity)
                setPadding(d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4), d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = d.dp(this@MainActivity, 6)
                }
            })
        }

        storage.getWorkspaces().forEach { ws ->
            val selected = ws.id == activeWorkspaceId
            workspaceStrip.addView(TextView(this).apply {
                text = ws.name
                textSize = 11f
                setTextColor(Color.parseColor(if (selected) "#ffffff" else "#94a3b8"))
                background = d.roundedBg(if (selected) "#334155" else "#161922", 6f, this@MainActivity)
                setPadding(d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4), d.dp(this@MainActivity, 8), d.dp(this@MainActivity, 4))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = d.dp(this@MainActivity, 4)
                }
                setOnClickListener { switchWorkspace(ws.id) }
            })
        }

        refreshTabsOnly()

        if (active != null && !addressInput.hasFocus()) {
            addressInput.setText(active.url)
        }
        securityBadge.text = if (active?.isSecure == true) "🔒" else "🔓"
        btnBack.alpha = if (active?.canGoBack == true) 1f else 0.35f
        btnForward.alpha = if (active?.canGoForward == true) 1f else 0.35f
        btnReload.text = if (active?.isLoading == true) "✕" else "↻"
        btnSplit.setTextColor(Color.parseColor(if (splitPair != null) "#34d399" else "#e2e8f0"))
        btnPrivate.setTextColor(Color.parseColor(if (privateMode) "#c084fc" else "#e2e8f0"))

        val bookmarked = active != null && storage.isBookmarked(active.url)
        bookmarkStar.text = if (bookmarked) "★" else "☆"
        bookmarkStar.setTextColor(Color.parseColor(if (bookmarked) "#fbbf24" else "#94a3b8"))
        updateShieldBadge()
    }

    private fun refreshTabsOnly() {
        val d = BrowserDialogs
        tabStrip.removeAllViews()
        val wsTabs = tabs.filter { it.workspaceId == activeWorkspaceId }
        wsTabs.forEach { tab ->
            val isActive = tab.id == activeTabId
            val isSplit = splitPair?.first == tab.id || splitPair?.second == tab.id
            val pillBg = when {
                isActive -> if (tab.isPrivate) "#1d1730" else "#1a1e29"
                isSplit -> "#0c4a6e"
                else -> "#141824"
            }
            val pill = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = d.roundedBg(pillBg, 8f, this@MainActivity, if (isActive) "#334155" else null)
                alpha = if (tab.isSleeping) 0.65f else 1f
                setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 5), d.dp(this@MainActivity, 6), d.dp(this@MainActivity, 5))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = d.dp(this@MainActivity, 5)
                }
                setOnClickListener { switchTab(tab.id) }
            }
            val labelPrefix = if (tab.isSleeping) "☾ " else ""
            pill.addView(TextView(this).apply {
                text = "$labelPrefix${tab.title.take(18)}"
                textSize = 11.5f
                setTextColor(Color.parseColor(if (isActive) "#ffffff" else "#cbd5e1"))
                maxLines = 1
            })
            pill.addView(TextView(this).apply {
                text = "  ✕"
                textSize = 11f
                setTextColor(Color.parseColor("#94a3b8"))
                setOnClickListener { closeTab(tab.id) }
            })
            tabStrip.addView(pill)
        }

        tabStrip.addView(TextView(this).apply {
            text = "+"
            textSize = 15f
            setTextColor(Color.parseColor("#38bdf8"))
            background = d.roundedBg("#1a1e29", 8f, this@MainActivity)
            setPadding(d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 3), d.dp(this@MainActivity, 10), d.dp(this@MainActivity, 3))
            setOnClickListener { createTab("https://duckduckgo.com", activate = true, workspaceId = activeWorkspaceId, privateTab = privateMode) }
        })

        if (closedTabs.isNotEmpty()) {
            tabStrip.addView(TextView(this).apply {
                text = "↺"
                textSize = 14f
                setTextColor(Color.parseColor("#cbd5e1"))
                background = d.roundedBg("#1a1e29", 8f, this@MainActivity)
                setPadding(d.dp(this@MainActivity, 9), d.dp(this@MainActivity, 3), d.dp(this@MainActivity, 9), d.dp(this@MainActivity, 3))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = d.dp(this@MainActivity, 4)
                }
                setOnClickListener { restoreClosedTab() }
            })
        }
    }

    private fun updateShieldBadge() {
        val active = activeTab() ?: return
        val host = UrlUtils.extractHostname(active.url)
        val off = host.isNotEmpty() && storage.isAdblockDisabledForHost(host)
        shieldPill.text = if (off) "🛡 Off" else if (active.blockedCount > 0) "🛡 ${active.blockedCount}" else "🛡"
        shieldPill.setTextColor(Color.parseColor(if (off) "#94a3b8" else "#7dd3fc"))
    }

    private fun commitAddress(raw: String) {
        val active = activeTab() ?: return
        suggestionsBox.visibility = View.GONE
        addressInput.clearFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(addressInput.windowToken, 0)

        val settings = storage.getSettings()
        val candidateHost = UrlUtils.extractHostname(raw.trim())
        val useHttps = settings.httpsFirst && !adblocker.isHttpFallbackAllowed(candidateHost)
        val url = UrlUtils.normalizeAddressInput(raw, useHttps)
        active.url = url
        active.isSecure = url.startsWith("https://")
        active.lastError = null
        active.certError = null
        active.canContinueOverHttp = false
        active.blockedCount = 0
        if (active.webView == null) mountWebView(active) else active.webView?.loadUrl(url)
        renderErrorOverlayIfNeeded()
        refreshChrome()
    }

    private fun updateSuggestions(query: String) {
        val items = storage.getSuggestions(query)
        suggestionsBox.removeAllViews()
        if (items.isEmpty()) {
            suggestionsBox.visibility = View.GONE
            return
        }
        suggestionsBox.visibility = View.VISIBLE
        items.forEach { s ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(BrowserDialogs.dp(this@MainActivity, 8), BrowserDialogs.dp(this@MainActivity, 7), BrowserDialogs.dp(this@MainActivity, 8), BrowserDialogs.dp(this@MainActivity, 7))
                setOnClickListener { commitAddress(s.url) }
            }
            row.addView(TextView(this).apply {
                text = (if (s.source == "bookmark") "★ " else "🕒 ") + s.title
                setTextColor(Color.parseColor("#f1f5f9"))
                textSize = 12.5f
                maxLines = 1
            })
            row.addView(TextView(this).apply {
                text = s.url
                setTextColor(Color.parseColor("#94a3b8"))
                textSize = 11f
                maxLines = 1
            })
            suggestionsBox.addView(row)
        }
    }

    private fun reloadOrStopActive() {
        val active = activeTab() ?: return
        if (active.isLoading) {
            active.webView?.stopLoading()
        } else {
            active.lastError = null
            active.certError = null
            active.canContinueOverHttp = false
            active.blockedCount = 0
            if (active.webView == null) mountWebView(active) else active.webView?.reload()
            renderErrorOverlayIfNeeded()
        }
    }

    private fun toggleActiveSiteShield() {
        val active = activeTab() ?: return
        val host = UrlUtils.extractHostname(active.url)
        if (host.isEmpty()) return
        storage.toggleAdblockForHost(host)
        active.webView?.reload()
        refreshChrome()
    }

    private fun toggleActiveBookmark() {
        val active = activeTab() ?: return
        if (active.isPrivate) {
            Toast.makeText(this, "Bookmarks are disabled in Private tabs", Toast.LENGTH_SHORT).show()
            return
        }
        storage.toggleBookmark(active.url, active.title)
        refreshChrome()
    }

    private fun toggleSplitView() {
        val active = activeTab() ?: return
        if (splitPair != null) {
            splitPair = null
            renderWebPanes()
            refreshChrome()
            return
        }
        val other = tabs.firstOrNull { it.workspaceId == activeWorkspaceId && it.id != active.id }
        val partnerId = other?.id ?: createTab("https://duckduckgo.com", activate = false, workspaceId = activeWorkspaceId, privateTab = privateMode)
        splitPair = active.id to partnerId
        renderWebPanes()
        refreshChrome()
    }

    private fun togglePrivateNewTab() {
        createTab("https://duckduckgo.com", activate = true, title = "Private Tab", workspaceId = activeWorkspaceId, privateTab = !privateMode)
    }

    private fun switchWorkspace(workspaceId: String) {
        activeWorkspaceId = workspaceId
        splitPair = null
        val wsTabs = tabs.filter { it.workspaceId == workspaceId }
        if (wsTabs.isNotEmpty()) {
            switchTab(wsTabs.maxByOrNull { it.lastActiveAt }!!.id)
        } else {
            createTab("https://duckduckgo.com", activate = true, workspaceId = workspaceId, privateTab = false)
        }
    }

    private fun openCommandPalette() {
        BrowserDialogs.showCommandPalette(
            context = this,
            tabs = tabs,
            workspaces = storage.getWorkspaces(),
            isSplitActive = splitPair != null,
            onSwitchTab = { switchTab(it) },
            onAction = { cmd ->
                when (cmd) {
                    "new_tab" -> createTab("https://duckduckgo.com", activate = true)
                    "private_tab" -> createTab("https://duckduckgo.com", activate = true, title = "Private Tab", privateTab = true)
                    "split" -> toggleSplitView()
                    "reader" -> openReaderMode()
                    "find" -> {
                        findBar.visibility = View.VISIBLE
                        findInput.requestFocus()
                    }
                    "sleep" -> {
                        val c = sleepInactiveTabs()
                        Toast.makeText(this, "Put $c tab(s) to sleep.", Toast.LENGTH_SHORT).show()
                    }
                    "bookmarks", "history", "downloads", "privacy", "policy" -> openSidePanel(cmd)
                }
            }
        )
    }

    private fun openSidePanel(mode: String) {
        val active = activeTab()
        val host = active?.let { UrlUtils.extractHostname(it.url) } ?: ""
        BrowserDialogs.showPanelDialog(
            context = this,
            initialMode = mode,
            storage = storage,
            activeHost = host,
            activeTabBlockedCount = active?.blockedCount ?: 0,
            activeTabWebView = active?.webView,
            onOpenUrl = { url -> createTab(url, activate = true) },
            onSleepInactive = { sleepInactiveTabs() },
            onSettingsChanged = { refreshChrome() }
        )
    }

    private fun openReaderMode() {
        val wv = activeTab()?.webView ?: return
        val script = """
            (() => {
              const root = document.querySelector('article') || document.querySelector('main') || document.body;
              if (!root) return null;
              const title = (document.querySelector('h1')?.textContent || document.title || '').trim().slice(0, 240);
              const byline = (document.querySelector('meta[name="author"]')?.getAttribute('content') || '').trim().slice(0, 120);
              const siteName = (document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || location.hostname).trim();
              const blocks = [];
              root.querySelectorAll('h1, h2, h3, p, blockquote, li').forEach(el => {
                if (blocks.length >= 200) return;
                if (el.closest('nav, header, footer, aside')) return;
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text || (el.tagName === 'P' && text.length < 20)) return;
                const tag = el.tagName.toLowerCase();
                const type = tag === 'h1' ? 'h1' : (tag === 'h2' || tag === 'h3') ? 'h2' : tag === 'blockquote' ? 'quote' : tag === 'li' ? 'li' : 'p';
                blocks.push({ type, text: text.slice(0, 4000) });
              });
              return JSON.stringify({ title, byline, siteName, url: location.href, blocks });
            })()
        """.trimIndent()

        wv.evaluateJavascript(script) { raw ->
            try {
                if (raw == null || raw == "null") return@evaluateJavascript
                val unquoted = JSONObject("{\"v\":$raw}").getString("v")
                val obj = JSONObject(unquoted)
                val arr = obj.getJSONArray("blocks")
                val blocks = mutableListOf<ReaderBlock>()
                for (i in 0 until arr.length()) {
                    val b = arr.getJSONObject(i)
                    blocks.add(ReaderBlock(b.getString("type"), b.getString("text")))
                }
                val article = ReaderArticle(
                    title = obj.optString("title", "Reader Mode"),
                    byline = obj.optString("byline", ""),
                    siteName = obj.optString("siteName", ""),
                    url = obj.optString("url", ""),
                    blocks = blocks
                )
                BrowserDialogs.showReaderDialog(this, article)
            } catch (_: Exception) {
                Toast.makeText(this, "Could not extract article text.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showPermissionPrompt(origin: String, kind: String, callback: (Boolean, Boolean) -> Unit) {
        pendingPermAction?.invoke(false, false)
        pendingPermAction = callback
        permissionText.text = "$origin wants $kind access"
        permissionBar.visibility = View.VISIBLE
    }

    private fun resolvePermission(allow: Boolean, remember: Boolean) {
        permissionBar.visibility = View.GONE
        pendingPermAction?.invoke(allow, remember)
        pendingPermAction = null
    }

    private fun sleepInactiveTabs(): Int {
        var slept = 0
        tabs.forEach { tab ->
            if (tab.id != activeTabId && tab.id != splitPair?.first && tab.id != splitPair?.second && !tab.isSleeping && tab.webView != null && !tab.isLoading) {
                tab.webView?.destroy()
                tab.webView = null
                tab.isSleeping = true
                slept += 1
            }
        }
        if (slept > 0) refreshTabsOnly()
        return slept
    }

    private fun sleepTimedOutTabs() {
        val mins = storage.getSettings().sleepAfterMinutes
        if (mins <= 0) return
        val cutoff = System.currentTimeMillis() - mins * 60_000L
        var slept = 0
        tabs.forEach { tab ->
            if (tab.id != activeTabId && tab.id != splitPair?.first && tab.id != splitPair?.second && !tab.isSleeping && tab.webView != null && !tab.isLoading && tab.lastActiveAt <= cutoff) {
                tab.webView?.destroy()
                tab.webView = null
                tab.isSleeping = true
                slept += 1
            }
        }
        if (slept > 0) refreshTabsOnly()
    }

    private fun persistSession() {
        val normalTabs = tabs.filter { !it.isPrivate && UrlUtils.isAllowedWebUrl(it.url) }.map {
            SavedSessionTab(it.url, it.title, it.workspaceId, it.id == activeTabId)
        }
        storage.saveSessionTabs(normalTabs)
    }

    private fun handleBackPress() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customFullscreenView != null) {
                    exitHtmlFullscreen()
                    return
                }
                if (findBar.visibility == View.VISIBLE) {
                    findBar.visibility = View.GONE
                    activeTab()?.webView?.clearMatches()
                    return
                }
                val wv = activeTab()?.webView
                if (wv != null && wv.canGoBack()) {
                    wv.goBack()
                    return
                }
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        })
    }
}
