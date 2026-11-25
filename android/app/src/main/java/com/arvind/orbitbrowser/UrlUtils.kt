package com.arvind.orbitbrowser

import android.net.Uri
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

object UrlUtils {
    private val allowedSchemes = setOf("http", "https")

    fun isAllowedWebUrl(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        return try {
            val uri = Uri.parse(rawUrl)
            val scheme = uri.scheme?.lowercase() ?: return false
            scheme in allowedSchemes && !uri.host.isNullOrBlank()
        } catch (_: Exception) {
            false
        }
    }

    fun extractHostname(rawUrl: String?): String {
        if (rawUrl.isNullOrBlank()) return ""
        return try {
            Uri.parse(rawUrl).host?.lowercase() ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    fun extractOrigin(rawUrl: String?): String {
        if (rawUrl.isNullOrBlank()) return ""
        return try {
            val uri = Uri.parse(rawUrl)
            val scheme = uri.scheme?.lowercase() ?: return ""
            val host = uri.host?.lowercase() ?: return ""
            if (scheme !in allowedSchemes) return ""
            if (uri.port != -1) "$scheme://$host:${uri.port}" else "$scheme://$host"
        } catch (_: Exception) {
            ""
        }
    }

    fun isPrivateOrLocalHost(hostname: String): Boolean {
        val host = hostname.lowercase().removePrefix("[").removeSuffix("]")
        if (host.isEmpty()) return false
        if (host == "localhost" || host == "::1") return true
        if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) {
            return true
        }
        val m172 = Regex("^172\\.(\\d{1,3})\\.").find(host)
        if (m172 != null) {
            val second = m172.groupValues[1].toIntOrNull() ?: -1
            if (second in 16..31) return true
        }
        return false
    }

    private fun isExplicitScheme(input: String): Boolean {
        val match = Regex("^([a-zA-Z][a-zA-Z\\d+\\-.]*):(.*)$").find(input) ?: return false
        val prefix = match.groupValues[1].lowercase()
        val rest = match.groupValues[2]
        if (prefix == "http" || prefix == "https") return true
        if (Regex("^\\d{1,5}(/|$)").containsMatchIn(rest) && (prefix == "localhost" || prefix.contains("."))) {
            return false
        }
        return true
    }

    fun normalizeAddressInput(rawInput: String, httpsFirst: Boolean = true): String {
        val trimmed = rawInput.trim()
        if (trimmed.isEmpty()) return "https://duckduckgo.com"

        if (isExplicitScheme(trimmed)) {
            if (isAllowedWebUrl(trimmed)) {
                val uri = Uri.parse(trimmed)
                val host = uri.host ?: ""
                return if (httpsFirst && uri.scheme.equals("http", true) && !isPrivateOrLocalHost(host)) {
                    uri.buildUpon().scheme("https").build().toString()
                } else {
                    trimmed
                }
            }
            return searchUrl(trimmed)
        }

        val looksLikeHost = !trimmed.contains(" ") && (
            trimmed == "localhost" ||
                Regex("^localhost[:/]").containsMatchIn(trimmed) ||
                Regex("^\\[[0-9a-fA-F:]+](:\\d+)?(/|$)").containsMatchIn(trimmed) ||
                Regex("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/|$)").containsMatchIn(trimmed) ||
                Regex("^[^\\s/:]+\\.[^\\s/:]{2,}(:\\d+)?(/|$)").containsMatchIn(trimmed)
            )

        if (looksLikeHost) {
            val probe = Uri.parse("http://$trimmed")
            val host = probe.host ?: ""
            if (host.isNotEmpty()) {
                val scheme = if (isPrivateOrLocalHost(host) || !httpsFirst) "http" else "https"
                return probe.buildUpon().scheme(scheme).build().toString()
            }
        }

        return searchUrl(trimmed)
    }

    fun searchUrl(query: String): String {
        val encoded = URLEncoder.encode(query, StandardCharsets.UTF_8.toString())
        return "https://duckduckgo.com/?q=$encoded"
    }
}
