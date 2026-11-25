package com.arvind.orbitbrowser

import java.util.concurrent.ConcurrentHashMap

class AdBlocker {
    private val downgradedHttpHosts = ConcurrentHashMap.newKeySet<String>()

    private val blockedHosts = setOf(
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "google-analytics.com",
        "googletagmanager.com",
        "googletagservices.com",
        "adservice.google.com",
        "pagead2.googlesyndication.com",
        "ads.youtube.com",
        "adnxs.com",
        "adsrvr.org",
        "advertising.com",
        "adform.net",
        "adcolony.com",
        "applovin.com",
        "appsflyer.com",
        "branch.io",
        "chartbeat.com",
        "criteo.com",
        "criteo.net",
        "demdex.net",
        "exelator.com",
        "facebook.net",
        "connect.facebook.net",
        "pixel.facebook.com",
        "hotjar.com",
        "imrworldwide.com",
        "krxd.net",
        "mathtag.com",
        "media.net",
        "mixpanel.com",
        "moatads.com",
        "mopub.com",
        "omtrdc.net",
        "openx.net",
        "outbrain.com",
        "pubmatic.com",
        "quantserve.com",
        "rubiconproject.com",
        "scorecardresearch.com",
        "segment.io",
        "segment.com",
        "sharethrough.com",
        "smartadserver.com",
        "taboola.com",
        "tapjoy.com",
        "teads.tv",
        "tradedoubler.com",
        "turn.com",
        "unityads.unity3d.com",
        "vungle.com",
        "yieldmo.com",
        "zedo.com"
    )

    fun allowHttpFallbackForHost(hostname: String) {
        if (hostname.isNotBlank()) {
            downgradedHttpHosts.add(hostname.lowercase())
        }
    }

    fun isHttpFallbackAllowed(hostname: String): Boolean {
        return hostname.isNotBlank() && downgradedHttpHosts.contains(hostname.lowercase())
    }

    fun shouldBlockRequest(requestUrl: String, pageHost: String): Boolean {
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
        val lowerUrl = requestUrl.lowercase()
        return lowerUrl.contains("/pagead/") ||
            lowerUrl.contains("/ads/ga-audiences") ||
            lowerUrl.contains("doubleclick.net/")
    }
}
