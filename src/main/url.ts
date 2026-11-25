const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Checks whether a parsed URL uses a safe external web protocol.
 */
export function isAllowedWebUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return ALLOWED_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

export function extractHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function extractOrigin(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return ''
    return parsed.origin
  } catch {
    return ''
  }
}

/**
 * Returns true for localhost, IPv6 loopback, and RFC1918/loopback IPv4 addresses.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) {
    return true
  }
  const match172 = /^172\.(\d{1,3})\./.exec(host)
  if (match172) {
    const second = Number(match172[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

function isExplicitScheme(input: string): boolean {
  // Distinguish schemes like "https:", "javascript:", "file:" from "localhost:3000" or "example.com:8080"
  const match = /^([a-zA-Z][a-zA-Z\d+\-.]*):(.*)$/.exec(input)
  if (!match) return false
  const prefix = match[1].toLowerCase()
  const rest = match[2]
  if (prefix === 'http' || prefix === 'https') return true
  if (/^\d{1,5}(\/|$)/.test(rest) && (prefix === 'localhost' || prefix.includes('.'))) {
    return false
  }
  return true
}

/**
 * Converts user address-bar input into a safe http(s) URL or a search query URL.
 */
export function normalizeAddressInput(rawInput: string, httpsFirst = true): string {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return 'https://duckduckgo.com'
  }

  if (isExplicitScheme(trimmed)) {
    if (isAllowedWebUrl(trimmed)) {
      const parsed = new URL(trimmed)
      if (httpsFirst && parsed.protocol === 'http:' && !isPrivateOrLocalHost(parsed.hostname)) {
        parsed.protocol = 'https:'
      }
      return parsed.toString()
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
  }

  const looksLikeHost =
    !trimmed.includes(' ') &&
    (trimmed === 'localhost' ||
      /^localhost[:/]/.test(trimmed) ||
      /^\[[0-9a-fA-F:]+\](:\d+)?(\/|$)/.test(trimmed) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(trimmed) ||
      /^[^\s/:]+\.[^\s/:]{2,}(:\d+)?(\/|$)/.test(trimmed))

  if (looksLikeHost) {
    // Parse with temporary http:// first so we can inspect parsed.hostname accurately
    try {
      const candidate = new URL(`http://${trimmed}`)
      const useHttp = isPrivateOrLocalHost(candidate.hostname) || !httpsFirst
      candidate.protocol = useHttp ? 'http:' : 'https:'
      return candidate.toString()
    } catch {
      // Fall through to search
    }
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}
