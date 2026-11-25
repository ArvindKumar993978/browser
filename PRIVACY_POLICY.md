# Orbit Browser — Privacy Policy

**Last Updated:** November 25, 2026

Orbit Browser is designed as a local-first web browser. We do not collect, sell, or transmit your personal browsing data to any developer-controlled servers.

## 1. Data We Do Not Collect
- Orbit Browser has **no telemetry servers**, **no usage analytics**, and **no automatic crash-upload beacons**.
- We do not track the websites you visit, your search queries, your bookmarks, or your downloads.

## 2. Data Stored Locally on Your Device
To provide core browser features, Orbit stores the following locally in an SQLite database (`orbit.db`) inside your operating system's application data folder (`%APPDATA%\orbit-browser` on Windows):
- **Browsing History & Session Tabs:** URLs, page titles, and timestamps from normal (non-Private) windows.
- **Bookmarks & Workspaces:** Pages you explicitly star and workspace names/tabs.
- **Downloads:** File names, source URLs, save paths, and transfer status.
- **Site Permissions & Adblock Allowlist:** Your Allow/Block choices (camera, microphone, location, notifications) and sites where you turned off the shield.
- **Settings:** Preferences such as HTTPS-First mode, Vertical Tabs, and inactive tab sleep timer.

You can delete any or all of this data at any time via **Privacy & Shield -> Clear Browsing Data**.

## 3. Private Windows
When you open a **Private Window** (`Ctrl+Shift+N`):
- Orbit uses an isolated, in-memory Chromium session partition.
- Orbit does **not** write visited URLs to history, does **not** save tabs to session restore, and does **not** persist new permission grants.
- Cookies, cache, and site storage for that Private Window are cleared when the window closes.

## 4. Network Connections Made by Orbit
Orbit only makes network connections for:
1. **Websites you navigate to** (subject to each website's own privacy policy).
2. **Search queries** submitted from the address bar (sent to DuckDuckGo by default).
3. **Ad & Tracker Filter List Initialization:** On first run, Orbit fetches Ghostery's prebuilt ads-and-tracking filter engine and caches it locally (`adblocker-engine.bin`).
4. **App Update Checks:** Installed builds check GitHub Releases (`github.com/ArvindKumar993978/browser`) for newer Orbit Browser versions. Updates are only downloaded when you click to download.

## 5. Contact & Updates
When distributing Orbit Browser publicly, update this policy with your support email or repository URL if you add optional sync, AI, or auto-update services in future releases.
