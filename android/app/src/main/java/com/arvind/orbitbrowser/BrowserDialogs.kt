package com.arvind.orbitbrowser

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object BrowserDialogs {

    fun roundedBg(colorHex: String, radiusDp: Float, context: Context, strokeHex: String? = null): GradientDrawable {
        val density = context.resources.displayMetrics.density
        return GradientDrawable().apply {
            setColor(Color.parseColor(colorHex))
            cornerRadius = radiusDp * density
            if (strokeHex != null) {
                setStroke((1 * density).toInt(), Color.parseColor(strokeHex))
            }
        }
    }

    fun dp(context: Context, value: Int): Int {
        return (value * context.resources.displayMetrics.density).toInt()
    }

    fun showCommandPalette(
        context: Context,
        tabs: List<TabItem>,
        workspaces: List<WorkspaceItem>,
        isSplitActive: Boolean,
        onSwitchTab: (String) -> Unit,
        onAction: (String) -> Unit
    ) {
        val dialog = AlertDialog.Builder(context, android.R.style.Theme_DeviceDefault_Dialog_NoActionBar).create()
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg("#141824", 14f, context, "#334155")
            setPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 14))
        }

        val searchInput = EditText(context).apply {
            hint = "Type a command, tab title, or workspace..."
            setHintTextColor(Color.parseColor("#64748b"))
            setTextColor(Color.parseColor("#f1f5f9"))
            textSize = 14f
            background = roundedBg("#0f1117", 10f, context, "#334155")
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
            isSingleLine = true
        }
        root.addView(searchInput)

        val scroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(context, 340)
            ).apply { topMargin = dp(context, 10) }
        }
        val listContainer = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(listContainer)
        root.addView(scroll)

        val wsMap = workspaces.associateBy({ it.id }, { it.name })
        data class Entry(val title: String, val hint: String, val run: () -> Unit)

        val allEntries = mutableListOf<Entry>()
        tabs.forEach { t ->
            allEntries.add(Entry(t.title.ifBlank { t.url }, "Tab · ${wsMap[t.workspaceId] ?: "Personal"}") {
                dialog.dismiss()
                onSwitchTab(t.id)
            })
        }

        val commands = listOf(
            "New Tab" to "new_tab",
            "New Private Tab" to "private_tab",
            (if (isSplitActive) "Exit Split View" else "Toggle Split View") to "split",
            "Open Reader Mode" to "reader",
            "Find in Page" to "find",
            "Sleep Inactive Tabs Now" to "sleep",
            "Open Bookmarks" to "bookmarks",
            "Open History" to "history",
            "Open Downloads" to "downloads",
            "Open Privacy & Shield" to "privacy",
            "View Orbit Privacy Policy" to "policy"
        )
        commands.forEach { (label, code) ->
            allEntries.add(Entry(label, "Command") {
                dialog.dismiss()
                onAction(code)
            })
        }

        fun render(q: String) {
            listContainer.removeAllViews()
            val query = q.trim().lowercase()
            val filtered = if (query.isEmpty()) allEntries.take(12) else {
                allEntries.filter {
                    it.title.lowercase().contains(query) || it.hint.lowercase().contains(query)
                }.take(12)
            }
            if (filtered.isEmpty()) {
                listContainer.addView(TextView(context).apply {
                    text = "No matching commands or tabs."
                    setTextColor(Color.parseColor("#64748b"))
                    textSize = 12f
                    setPadding(dp(context, 8), dp(context, 16), dp(context, 8), dp(context, 16))
                    gravity = Gravity.CENTER
                })
                return
            }
            filtered.forEach { entry ->
                val row = LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    background = roundedBg("#181c28", 8f, context)
                    setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = dp(context, 6) }
                    setOnClickListener { entry.run() }
                }
                row.addView(TextView(context).apply {
                    text = entry.title
                    setTextColor(Color.parseColor("#f1f5f9"))
                    textSize = 13f
                    maxLines = 1
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
                row.addView(TextView(context).apply {
                    text = entry.hint
                    setTextColor(Color.parseColor("#94a3b8"))
                    textSize = 11f
                    background = roundedBg("#0f1117", 6f, context)
                    setPadding(dp(context, 7), dp(context, 3), dp(context, 7), dp(context, 3))
                })
                listContainer.addView(row)
            }
        }

        render("")
        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                render(s?.toString() ?: "")
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        dialog.setView(root)
        dialog.show()
    }

    fun showReaderDialog(context: Context, article: ReaderArticle) {
        val dialog = AlertDialog.Builder(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen).create()
        var currentTheme = "dark"
        var fontSizeSp = 17f

        val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val topBar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
        }
        val titleBadge = TextView(context).apply {
            text = "Reader Mode"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        topBar.addView(titleBadge)

        val btnMinus = makeChipBtn(context, "A-")
        val btnPlus = makeChipBtn(context, "A+")
        val btnDark = makeChipBtn(context, "Dark")
        val btnSepia = makeChipBtn(context, "Sepia")
        val btnLight = makeChipBtn(context, "Light")
        val btnClose = makeChipBtn(context, "Exit")
        listOf(btnMinus, btnPlus, btnDark, btnSepia, btnLight, btnClose).forEach {
            topBar.addView(it)
        }
        root.addView(topBar)

        val scroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(context, 20), dp(context, 18), dp(context, 20), dp(context, 36))
        }
        scroll.addView(contentCol)
        root.addView(scroll)

        fun renderArticle() {
            val (bg, fg, muted) = when (currentTheme) {
                "sepia" -> Triple("#f4ecd8", "#3a2f22", "#6e5a41")
                "light" -> Triple("#fafafa", "#0f172a", "#475569")
                else -> Triple("#10131a", "#e2e8f0", "#94a3b8")
            }
            root.setBackgroundColor(Color.parseColor(bg))
            titleBadge.setTextColor(Color.parseColor(fg))
            contentCol.removeAllViews()

            if (article.siteName.isNotEmpty()) {
                contentCol.addView(TextView(context).apply {
                    text = article.siteName.uppercase(Locale.US)
                    setTextColor(Color.parseColor(muted))
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                })
            }
            contentCol.addView(TextView(context).apply {
                text = article.title
                setTextColor(Color.parseColor(fg))
                textSize = 22f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, dp(context, 6), 0, dp(context, 6))
            })
            if (article.byline.isNotEmpty()) {
                contentCol.addView(TextView(context).apply {
                    text = "By ${article.byline}"
                    setTextColor(Color.parseColor(muted))
                    textSize = 12f
                    setPadding(0, 0, 0, dp(context, 12))
                })
            }

            if (article.blocks.isEmpty()) {
                contentCol.addView(TextView(context).apply {
                    text = "Could not extract article text from this page."
                    setTextColor(Color.parseColor(muted))
                    textSize = 14f
                })
                return
            }

            article.blocks.forEach { block ->
                val tv = TextView(context).apply {
                    text = when (block.type) {
                        "li" -> "• ${block.text}"
                        "quote" -> "“${block.text}”"
                        else -> block.text
                    }
                    setTextColor(Color.parseColor(fg))
                    textSize = if (block.type == "h1" || block.type == "h2") fontSizeSp + 3f else fontSizeSp
                    if (block.type == "h1" || block.type == "h2") setTypeface(null, Typeface.BOLD)
                    if (block.type == "quote") setTypeface(null, Typeface.ITALIC)
                    setLineSpacing(0f, 1.45f)
                    setPadding(
                        if (block.type == "quote" || block.type == "li") dp(context, 12) else 0,
                        dp(context, 8),
                        0,
                        dp(context, 8)
                    )
                }
                contentCol.addView(tv)
            }
        }

        btnMinus.setOnClickListener { fontSizeSp = (fontSizeSp - 1f).coerceAtLeast(13f); renderArticle() }
        btnPlus.setOnClickListener { fontSizeSp = (fontSizeSp + 1f).coerceAtMost(24f); renderArticle() }
        btnDark.setOnClickListener { currentTheme = "dark"; renderArticle() }
        btnSepia.setOnClickListener { currentTheme = "sepia"; renderArticle() }
        btnLight.setOnClickListener { currentTheme = "light"; renderArticle() }
        btnClose.setOnClickListener { dialog.dismiss() }

        renderArticle()
        dialog.setView(root)
        dialog.show()
    }

    fun showPanelDialog(
        context: Context,
        initialMode: String,
        storage: OrbitStorage,
        activeHost: String,
        activeTabBlockedCount: Int,
        activeTabWebView: WebView?,
        onOpenUrl: (String) -> Unit,
        onSleepInactive: () -> Int,
        onSettingsChanged: () -> Unit
    ) {
        val dialog = AlertDialog.Builder(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen).create()
        var mode = initialMode

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#12151e"))
        }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0f1117"))
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
        }
        val tabBtns = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnClose = makeChipBtn(context, "Close")
        btnClose.setOnClickListener { dialog.dismiss() }
        header.addView(tabBtns)
        header.addView(btnClose)
        root.addView(header)

        val scroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 28))
        }
        scroll.addView(body)
        root.addView(scroll)

        fun renderContent() {
            tabBtns.removeAllViews()
            listOf(
                "bookmarks" to "Stars",
                "history" to "History",
                "downloads" to "Files",
                "privacy" to "Shield",
                "policy" to "Policy"
            ).forEach { (key, label) ->
                val b = makeChipBtn(context, label, active = mode == key)
                b.setOnClickListener { mode = key; renderContent() }
                tabBtns.addView(b)
            }

            body.removeAllViews()
            when (mode) {
                "bookmarks" -> {
                    val items = storage.getBookmarks()
                    if (items.isEmpty()) {
                        body.addView(emptyMsg(context, "No bookmarks yet. Tap the star in the address bar to save a page."))
                    } else {
                        items.forEach { b ->
                            body.addView(linkRow(context, b.title, b.url, {
                                dialog.dismiss()
                                onOpenUrl(b.url)
                            }, {
                                storage.deleteBookmark(b.id)
                                renderContent()
                            }))
                        }
                    }
                }
                "history" -> {
                    val search = EditText(context).apply {
                        hint = "Search history..."
                        setHintTextColor(Color.parseColor("#64748b"))
                        setTextColor(Color.parseColor("#f1f5f9"))
                        textSize = 13f
                        background = roundedBg("#0f1117", 8f, context, "#334155")
                        setPadding(dp(context, 10), dp(context, 8), dp(context, 10), dp(context, 8))
                    }
                    body.addView(search)
                    val listWrap = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
                    body.addView(listWrap)

                    fun loadHist(q: String) {
                        listWrap.removeAllViews()
                        val hist = storage.getHistory(q)
                        if (hist.isEmpty()) {
                            listWrap.addView(emptyMsg(context, "No browsing history found."))
                        } else {
                            val fmt = SimpleDateFormat("HH:mm", Locale.getDefault())
                            hist.forEach { h ->
                                listWrap.addView(linkRow(context, h.title, "${fmt.format(Date(h.visitedAt))} · ${h.url}", {
                                    dialog.dismiss()
                                    onOpenUrl(h.url)
                                }, {
                                    storage.deleteHistoryItem(h.id)
                                    loadHist(search.text.toString())
                                }))
                            }
                        }
                    }
                    loadHist("")
                    search.addTextChangedListener(object : TextWatcher {
                        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                            loadHist(s?.toString() ?: "")
                        }
                        override fun afterTextChanged(s: Editable?) {}
                    })
                }
                "downloads" -> {
                    val dls = storage.getDownloads()
                    if (dls.isEmpty()) {
                        body.addView(emptyMsg(context, "No downloads yet. Downloaded files are saved via Android DownloadManager."))
                    } else {
                        dls.forEach { dl ->
                            val row = LinearLayout(context).apply {
                                orientation = LinearLayout.VERTICAL
                                background = roundedBg("#181c28", 10f, context, "#253047")
                                setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
                                layoutParams = LinearLayout.LayoutParams(
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                    ViewGroup.LayoutParams.WRAP_CONTENT
                                ).apply { bottomMargin = dp(context, 8) }
                                setOnClickListener {
                                    context.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
                                }
                            }
                            row.addView(TextView(context).apply {
                                text = dl.filename
                                setTextColor(Color.parseColor("#f1f5f9"))
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                            })
                            row.addView(TextView(context).apply {
                                text = dl.url
                                setTextColor(Color.parseColor("#94a3b8"))
                                textSize = 11f
                                maxLines = 1
                            })
                            body.addView(row)
                        }
                    }
                }
                "privacy" -> {
                    val settings = storage.getSettings()
                    if (activeHost.isNotEmpty()) {
                        val disabled = storage.isAdblockDisabledForHost(activeHost)
                        val card = makeCard(context)
                        card.addView(TextView(context).apply {
                            text = "$activeHost ($activeTabBlockedCount blocked)"
                            setTextColor(Color.parseColor("#f1f5f9"))
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                        })
                        val btn = Button(context).apply {
                            text = if (disabled) "Shield OFF — Tap to Enable" else "Shield ON — Tap to Disable"
                            setOnClickListener {
                                storage.toggleAdblockForHost(activeHost)
                                activeTabWebView?.reload()
                                onSettingsChanged()
                                renderContent()
                            }
                        }
                        card.addView(btn)
                        body.addView(card)
                    }

                    val protCard = makeCard(context)
                    protCard.addView(sectionHeader(context, "PROTECTION & MEMORY"))
                    val cbAd = CheckBox(context).apply {
                        text = "Ad & Tracker Blocking"
                        setTextColor(Color.parseColor("#f1f5f9"))
                        isChecked = settings.adBlockGlobal
                        setOnCheckedChangeListener { _, checked ->
                            storage.updateSettings(storage.getSettings().copy(adBlockGlobal = checked))
                            onSettingsChanged()
                        }
                    }
                    val cbHttps = CheckBox(context).apply {
                        text = "HTTPS-First Mode"
                        setTextColor(Color.parseColor("#f1f5f9"))
                        isChecked = settings.httpsFirst
                        setOnCheckedChangeListener { _, checked ->
                            storage.updateSettings(storage.getSettings().copy(httpsFirst = checked))
                            onSettingsChanged()
                        }
                    }
                    protCard.addView(cbAd)
                    protCard.addView(cbHttps)

                    val sleepBtn = Button(context).apply {
                        text = "Sleep Inactive Tabs Now"
                        setOnClickListener {
                            val count = onSleepInactive()
                            Toast.makeText(
                                context,
                                if (count > 0) "Put $count background tab(s) to sleep." else "No eligible tabs to sleep.",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                    protCard.addView(sleepBtn)
                    body.addView(protCard)

                    val clearCard = makeCard(context)
                    clearCard.addView(sectionHeader(context, "CLEAR BROWSING DATA"))
                    val rangeSpinner = Spinner(context).apply {
                        adapter = ArrayAdapter(
                            context,
                            android.R.layout.simple_spinner_dropdown_item,
                            listOf("Last hour", "Last 24 hours", "All time")
                        )
                        setSelection(1)
                    }
                    clearCard.addView(rangeSpinner)
                    val cHist = CheckBox(context).apply { text = "Browsing history"; setTextColor(Color.parseColor("#f1f5f9")); isChecked = true }
                    val cDl = CheckBox(context).apply { text = "Download history"; setTextColor(Color.parseColor("#f1f5f9")) }
                    val cCache = CheckBox(context).apply { text = "Cached files"; setTextColor(Color.parseColor("#f1f5f9")); isChecked = true }
                    val cCookies = CheckBox(context).apply { text = "Cookies & site data"; setTextColor(Color.parseColor("#f1f5f9")) }
                    val cPerms = CheckBox(context).apply { text = "Saved site permissions"; setTextColor(Color.parseColor("#f1f5f9")) }
                    listOf(cHist, cDl, cCache, cCookies, cPerms).forEach { clearCard.addView(it) }

                    val clearBtn = Button(context).apply {
                        text = "Clear Selected Data"
                        setBackgroundColor(Color.parseColor("#e11d48"))
                        setTextColor(Color.WHITE)
                        setOnClickListener {
                            val sinceMs = when (rangeSpinner.selectedItemPosition) {
                                0 -> System.currentTimeMillis() - 3_600_000L
                                1 -> System.currentTimeMillis() - 24 * 3_600_000L
                                else -> null
                            }
                            if (cHist.isChecked) storage.clearHistorySince(sinceMs)
                            if (cDl.isChecked) storage.clearDownloads()
                            if (cPerms.isChecked) storage.clearPermissions()
                            if (cCache.isChecked) activeTabWebView?.clearCache(true)
                            if (cCookies.isChecked) {
                                CookieManager.getInstance().removeAllCookies(null)
                                CookieManager.getInstance().flush()
                                WebStorage.getInstance().deleteAllData()
                            }
                            Toast.makeText(context, "Selected browsing data cleared.", Toast.LENGTH_SHORT).show()
                            onSettingsChanged()
                        }
                    }
                    clearCard.addView(clearBtn)
                    body.addView(clearCard)
                }
                "policy" -> {
                    val c0 = makeCard(context)
                    c0.addView(sectionHeader(context, "ZERO TELEMETRY GUARANTEE"))
                    c0.addView(bodyText(context, "Orbit Browser has no telemetry servers, no crash-upload beacons, and no usage analytics. Your browsing stays strictly on your device."))
                    body.addView(c0)

                    val c1 = makeCard(context)
                    c1.addView(sectionHeader(context, "1. LOCAL DATA STORED ON DEVICE"))
                    c1.addView(bodyText(context, "History, bookmarks, downloads, workspaces, adblock allowlist, and site permissions are saved locally in SQLite (orbit.db) inside your app private storage."))
                    body.addView(c1)

                    val c2 = makeCard(context)
                    c2.addView(sectionHeader(context, "2. NETWORK REQUESTS"))
                    c2.addView(bodyText(context, "Orbit only connects to websites you open and DuckDuckGo when you submit a search from the address bar."))
                    body.addView(c2)

                    val c3 = makeCard(context)
                    c3.addView(sectionHeader(context, "3. PRIVATE TABS & PROTOCOL SECURITY"))
                    c3.addView(bodyText(context, "Private tabs never write history, session tabs, or permanent permissions. Only http(s) navigations are allowed, HTTPS-First upgrades plain HTTP, and invalid TLS certificates are blocked."))
                    body.addView(c3)
                }
            }
        }

        renderContent()
        dialog.setView(root)
        dialog.show()
    }

    private fun makeChipBtn(context: Context, label: String, active: Boolean = false): TextView {
        return TextView(context).apply {
            text = label
            textSize = 11.5f
            setTextColor(Color.parseColor(if (active) "#ffffff" else "#cbd5e1"))
            background = roundedBg(if (active) "#0284c7" else "#1e293b", 8f, context)
            setPadding(dp(context, 9), dp(context, 5), dp(context, 9), dp(context, 5))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(context, 5) }
        }
    }

    private fun makeCard(context: Context): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg("#181c28", 12f, context, "#253047")
            setPadding(dp(context, 12), dp(context, 12), dp(context, 12), dp(context, 12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(context, 12) }
        }
    }

    private fun sectionHeader(context: Context, title: String): TextView {
        return TextView(context).apply {
            text = title
            setTextColor(Color.parseColor("#38bdf8"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, dp(context, 6))
        }
    }

    private fun bodyText(context: Context, content: String): TextView {
        return TextView(context).apply {
            text = content
            setTextColor(Color.parseColor("#cbd5e1"))
            textSize = 12.5f
            setLineSpacing(0f, 1.4f)
        }
    }

    private fun emptyMsg(context: Context, msg: String): TextView {
        return TextView(context).apply {
            text = msg
            setTextColor(Color.parseColor("#64748b"))
            textSize = 12.5f
            gravity = Gravity.CENTER
            setPadding(dp(context, 16), dp(context, 30), dp(context, 16), dp(context, 30))
        }
    }

    private fun linkRow(
        context: Context,
        title: String,
        subtitle: String,
        onOpen: () -> Unit,
        onDelete: () -> Unit
    ): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = roundedBg("#181c28", 10f, context, "#253047")
            setPadding(dp(context, 12), dp(context, 10), dp(context, 10), dp(context, 10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(context, 8) }
        }
        val textCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { onOpen() }
        }
        textCol.addView(TextView(context).apply {
            text = title
            setTextColor(Color.parseColor("#f1f5f9"))
            textSize = 13f
            maxLines = 1
        })
        textCol.addView(TextView(context).apply {
            text = subtitle
            setTextColor(Color.parseColor("#94a3b8"))
            textSize = 11f
            maxLines = 1
        })
        val delBtn = TextView(context).apply {
            text = "✕"
            setTextColor(Color.parseColor("#fda4af"))
            textSize = 14f
            setPadding(dp(context, 10), dp(context, 6), dp(context, 8), dp(context, 6))
            setOnClickListener { onDelete() }
        }
        row.addView(textCol)
        row.addView(delBtn)
        return row
    }
}
