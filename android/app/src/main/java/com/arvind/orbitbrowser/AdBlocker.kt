package com.arvind.orbitbrowser

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.ConcurrentHashMap

class AdBlocker {
    private val downgradedHttpHosts = ConcurrentHashMap.newKeySet<String>()
    private val blockedHosts = ConcurrentHashMap.newKeySet<String>(120_000)
    @Volatile
    private var loadedFromAssets = false

    private val fallbackHosts = listOf(
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "google-analytics.com",
        "googletagmanager.com",
        "adservice.google.com",
        "pagead2.googlesyndication.com",
        "ads.youtube.com",
        "adnxs.com",
        "adsrvr.org",
        "criteo.com",
        "outbrain.com",
        "taboola.com",
        "pubmatic.com",
        "rubiconproject.com",
        "openx.net",
        "moatads.com",
        "scorecardresearch.com",
        "amazon-adsystem.com",
        "mgid.com",
        "popads.net",
        "propellerads.com"
    )

    private val adPathPatterns = listOf(
        "/pagead/",
        "/api/stats/ads",
        "/ptracking",
        "/get_midroll_info",
        "/youtubei/v1/player/ad_break",
        "/ads/ga-audiences",
        "/adserver/",
        "/adsense/",
        "/adsystem/",
        "/popunder",
        "doubleclick.net/"
    )

    fun initialize(context: Context) {
        if (loadedFromAssets) return
        fallbackHosts.forEach { blockedHosts.add(it) }
        Thread {
            try {
                context.assets.open("adblock_domains.txt").use { stream ->
                    BufferedReader(InputStreamReader(stream)).use { reader ->
                        var line = reader.readLine()
                        while (line != null) {
                            val trimmed = line.trim()
                            if (trimmed.isNotEmpty()) {
                                blockedHosts.add(trimmed)
                            }
                            line = reader.readLine()
                        }
                    }
                }
                loadedFromAssets = true
            } catch (_: Exception) {
                // Fallback list remains active
            }
        }.start()
    }

    fun allowHttpFallbackForHost(hostname: String) {
        if (hostname.isNotBlank()) {
            downgradedHttpHosts.add(hostname.lowercase())
        }
    }

    fun isHttpFallbackAllowed(hostname: String): Boolean {
        return hostname.isNotBlank() && downgradedHttpHosts.contains(hostname.lowercase())
    }

    fun shouldBlockRequest(requestUrl: String, pageHost: String): Boolean {
        val lowerUrl = requestUrl.lowercase()
        for (pattern in adPathPatterns) {
            if (lowerUrl.contains(pattern)) return true
        }

        val reqHost = UrlUtils.extractHostname(requestUrl)
        if (reqHost.isEmpty()) return false
        if (pageHost.isNotEmpty() && (reqHost == pageHost || reqHost.endsWith(".$pageHost"))) {
            return false
        }

        var probe = reqHost
        while (probe.contains('.')) {
            if (blockedHosts.contains(probe)) return true
            probe = probe.substringAfter('.')
        }
        return false
    }

    fun buildCosmeticScript(pageUrl: String): String {
        val isYoutube = UrlUtils.extractHostname(pageUrl).let {
            it == "youtube.com" || it.endsWith(".youtube.com")
        }
        val ytPart = if (isYoutube) {
            """
            if (!window.__orbitYtAdGuard) {
              window.__orbitYtAdGuard = true;
              const tick = () => {
                const player = document.querySelector('.html5-video-player');
                if (player && player.classList.contains('ad-showing')) {
                  const v = player.querySelector('video');
                  if (v) {
                    v.muted = true;
                    if (Number.isFinite(v.duration) && v.duration > 0.2) v.currentTime = v.duration;
                  }
                  const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                  if (skip) skip.click();
                }
                document.querySelectorAll('ytm-promoted-sparkles-web-renderer, ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, #masthead-ad').forEach(el => {
                  el.style.setProperty('display', 'none', 'important');
                });
              };
              setInterval(tick, 350);
              tick();
            }
            """.trimIndent()
        } else ""

        return """
            (() => {
              if (!document.getElementById('__orbit-ad-css')) {
                const st = document.createElement('style');
                st.id = '__orbit-ad-css';
                st.textContent = 'ins.adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"], [class*="ad-banner"], [class*="sponsored-ad"], ytm-promoted-sparkles-web-renderer, ytd-ad-slot-renderer, ytd-banner-promo-renderer, .ytp-ad-module, .ytp-ad-overlay-container, #masthead-ad { display: none !important; }';
                (document.head || document.documentElement)?.appendChild(st);
              }
              $ytPart
            })();
        """.trimIndent()
    }
}
