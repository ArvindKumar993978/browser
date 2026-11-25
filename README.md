# Orbit Browser

A fast, privacy-focused multi-tab desktop web browser built with **Electron (`WebContentsView`)**, **React**, **TypeScript**, **Tailwind CSS**, **Zustand**, and built-in **`node:sqlite`**.

## Key Features

- **Multi-Tab & Workspaces:** Drag-and-drop tabs, reopen closed tabs (`Ctrl+Shift+T`), session restore, horizontal or **Vertical Tabs**, and **Workspaces** (`Personal`, `Work`, `Research`).
- **Split View (`Ctrl+\`):** View two live web tabs side by side in one window.
- **Command Palette (`Ctrl+K`):** Jump between tabs and browser actions instantly.
- **Zero-XSS Reader Mode (`Ctrl+Alt+R`):** Extracts plain-text article blocks only (no raw HTML injection) with Dark / Sepia / Light themes.
- **Privacy & Security:**
  - Built-in Ad & Tracker Blocker (`@ghostery/adblocker-electron`) with per-site on/off shield.
  - Interactive permission prompts (camera, microphone, location, notifications).
  - Private Windows (`Ctrl+Shift+N`) with isolated in-memory storage.
  - HTTPS-First upgrades, strict `http:`/`https:` navigation/redirect guards, and TLS certificate blocking.
  - Clear Browsing Data controls + built-in [Privacy Policy](PRIVACY_POLICY.md) and [Security Architecture](SECURITY.md).
- **8 GB RAM Friendly:** Automatically sleeps inactive silent tabs and lets you sleep background tabs on demand.
- **Auto-Updates:** Checks GitHub Releases (`electron-updater`) for new builds.

## Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+T` / `Ctrl+W` | New tab / Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+L` | Focus address bar |
| `Ctrl+K` | Command palette |
| `Ctrl+\` | Toggle Split View |
| `Ctrl+Alt+R` | Toggle Reader Mode |
| `Ctrl+F` | Find in page |
| `Ctrl+B` / `Ctrl+H` / `Ctrl+J` | Bookmarks / History / Downloads |
| `Ctrl+Shift+N` | New Private Window |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |

## Development & Building

```powershell
npm install
npm run dev       # Start in development mode
npm run typecheck # Run TypeScript check
npm run build:win # Build dist/Orbit-Browser-Setup-<version>.exe
```

## Publishing a Release

Tagging a version (e.g. `v0.1.0`) triggers [release.yml](.github/workflows/release.yml) to build and attach the Windows installer, `.blockmap`, and `latest.yml` to GitHub Releases:

```powershell
git tag v0.1.0
git push origin v0.1.0
```
