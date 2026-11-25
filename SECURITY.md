# Orbit Browser — Security & Protocol Architecture

## 1. Process Isolation & Sandbox
- Every web tab runs inside an Electron `WebContentsView` configured with:
  - `sandbox: true`
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `webviewTag: false`
  - `webSecurity: true`
  - `allowRunningInsecureContent: false`
  - **No preload script** attached to untrusted web pages.
- Web browsing uses dedicated Chromium sessions (`persist:web-default` for normal windows; `private-<uuid>` in-memory partitions for Private Windows), isolated from the browser shell UI.

## 2. IPC & Privilege Boundaries
- Only the internal browser UI views (`shellView`, `sidebarView`, `panelView`) receive the `orbitAPI` `contextBridge` preload.
- Every `ipcMain.handle` endpoint checks `senderToManager.get(event.sender.id)` and validates parameter types before acting. Untrusted web pages cannot invoke browser IPCs.
- Browser UI views enforce a strict `<meta http-equiv="Content-Security-Policy">` (`object-src 'none'`, `base-uri 'none'`).

## 3. Protocol & Transport Security
- **Allowed Schemes Only:** Address bar input, `will-navigate`, `will-redirect`, and `setWindowOpenHandler` enforce `http:` and `https:` only—blocking `file:`, `javascript:`, `data:`, and arbitrary external protocols.
- **HTTPS-First Mode:** External `http://` top-level navigations are automatically upgraded to `https://` when HTTPS-First is enabled.
- **Strict TLS Verification:** Certificate errors (`certificate-error`) are never silently bypassed; untrusted connections are blocked and shown a clear security warning.
- **Zero-XSS Reader Mode:** Article text is extracted as plain-text JSON blocks and rendered solely via React JSX text nodes without `dangerouslySetInnerHTML`.
- **Single-Instance Lock:** `app.requestSingleInstanceLock()` prevents concurrent launches from corrupting local SQLite/cache files.
