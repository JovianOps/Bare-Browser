# Nadir

A lightweight desktop browser shell built with **Tauri v2** and a plain HTML/CSS/JS frontend.

> **Engine note:** this project uses the system webview, **not Gecko**. On Linux that means **WebKitGTK**. Gecko’s only supported embedding path is GeckoView on Android; there is no supported desktop Gecko embedding API. Nadir is intentionally a small, hackable browser shell built on Tauri instead.

## Features

- **Tabbed browsing** - create, switch, and close tabs
- **Address bar** - enter a URL or a search query (falls back to DuckDuckGo)
- **Navigation controls** - back, forward, reload, home
- **Bookmarks** - save/remove the current page, open from sidebar, persisted in `localStorage`
- **History** - visited pages recorded locally, open/clear from sidebar, persisted in `localStorage`
- **Keyboard shortcuts** - `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+L` focus address bar, `Ctrl+R` reload, `Ctrl+B` bookmarks, `Ctrl+H` history

## Project layout

```text
.
├── ui/                     # Browser chrome (frontend)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src-tauri/              # Tauri/Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json
│   ├── permissions/
│   │   └── browser.toml
│   ├── icons/
│   └── src/
│       ├── main.rs
│       └── lib.rs
└── package.json
```

## How it works

The app creates a bare Tauri window and adds a **chrome webview** (`ui/index.html`) that fills the window. The chrome UI manages tabs and calls Rust commands via Tauri's IPC.

For each browser tab, the Rust backend creates a **child webview** positioned below the chrome toolbar. The frontend reports the content area bounds, and Rust places/resizes the active tab webview accordingly. This uses Tauri v2 multiwebview support (`unstable` feature).

## Linux prerequisites

Install the Tauri Linux prerequisites (Debian/Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  xdg-utils
```

You also need Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

And Node.js (for the Tauri CLI):

```bash
npm install
```

## Windows 11 prerequisites

Install Node.js 20 or newer and Rust with the stable MSVC toolchain. The Rust MSVC
toolchain requires **Microsoft C++ Build Tools** with the **Desktop development
with C++** workload. Windows 11 usually includes the WebView2 Runtime; if it is
missing, the installer downloads and silently installs its bootstrapper, so an
internet connection is needed on first install.

From PowerShell in the repository root, install the frontend dependency and run
the app:

```powershell
npm install
npm run dev
```

Build both Windows x64 installer formats with:

```powershell
npm run build -- --bundles msi,nsis
```

The MSI and NSIS installers are written to
`src-tauri/target/release/bundle/msi/` and
`src-tauri/target/release/bundle/nsis/`, respectively. The Windows GitHub Actions
workflow builds both formats and uploads them as `nadir-windows-x64-installers`.

## Run in development

```bash
npm run dev
# or
cargo tauri dev
```

## Build

```bash
npm run build
# or
cargo tauri build
```

The Linux bundle output will be under `src-tauri/target/release/bundle/`.

## Notes / limitations

- **System webview, not Gecko.** Rendering behavior depends on the platform webview (WebKitGTK on Linux).
- **Multiwebview is Tauri v2 `unstable`.** The API is used for tab webviews; behavior may vary across Tauri releases/platforms.
- **Developer tools are unavailable for Windows child webviews.** Tauri's Webview devtools API does not support Windows; the command opens tools only in debug builds on other desktop platforms.
- **Bookmarks/history are stored in the chrome webview `localStorage`.** They are local to the app profile and not synced.
- **Tab titles are currently derived from the URL/host.** Reading full page titles from external tab webviews can be added as a follow-up.
- This repo was scaffolded as a starting point; test on your Linux desktop with WebKitGTK installed.
