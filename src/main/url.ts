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
 * Converts user address-bar input into a safe http(s) URL or a search query URL.
 */
export function normalizeAddressInput(rawInput: string, httpsFirst = true): string {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return 'https://duckduckgo.com'
  }

  // Reject explicit non-web protocols such as file:, javascript:, data:, chrome:
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    if (isAllowedWebUrl(trimmed)) {
      const parsed = new URL(trimmed)
      if (
        httpsFirst &&
        parsed.protocol === 'http:' &&
        parsed.hostname !== 'localhost' &&
        !parsed.hostname.startsWith('127.') &&
        !parsed.hostname.startsWith('192.168.')
      ) {
        parsed.protocol = 'https:'
      }
      return parsed.toString()
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
  }

  // Treat localhost, IPv4, or domain-like inputs (no spaces, contains a dot) as URLs
  const looksLikeHost =
    !trimmed.includes(' ') &&
    (trimmed.startsWith('localhost') ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(trimmed) ||
      trimmed.includes('.'))

  if (looksLikeHost) {
    const isLocal =
      trimmed.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)
    const scheme = isLocal ? 'http://' : httpsFirst ? 'https://' : 'http://'
    const candidate = `${scheme}${trimmed}`
    if (isAllowedWebUrl(candidate)) {
      return new URL(candidate).toString()
    }
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}
