# Nadir Architecture (Phase 0 baseline)

## Goals

- Keep Nadir a lightweight Tauri v2 system-webview browser shell.
- Prefer clear module boundaries over line count.
- Make data, IPC, and platform behavior explicit and testable.

## Current layout

```text
src-tauri/src/
  main.rs          # desktop entrypoint
  lib.rs           # Tauri bootstrap, state wiring, command registration
  commands.rs      # #[tauri::command] IPC surface
  tabs.rs          # tab state/models
  storage.rs       # atomic JSON persistence, schema version, backup
  settings.rs      # settings model/defaults/search URL resolution
  downloads.rs     # download model/state (best-effort)

ui/
  index.html       # browser chrome
  app.js           # chrome controller (vanilla JS, no bundler)
  styles.css       # chrome styles
  newtab.html      # nadir://newtab
  error.html       # nadir://error
```

## Near-term direction

1. **Core platform**: typed command errors/events, storage migrations, diagnostics.
2. **Tab engine**: robust lifecycle, multi-window, crash recovery, load/error handling.
3. **Data**: migrate JSON -> SQLite with import/backup; full history/bookmark/download managers.
4. **Security**: permission prompts, HTTPS-first enforcement, tracker blocking, IPC hardening.
5. **Platform**: Windows/macOS/Linux packaging, updater, CI matrix, signed artifacts.

## Guardrails

- No arbitrary file access from webview content.
- Validate all IPC inputs and URL schemes.
- Gate platform-specific webview behavior with `#[cfg(...)]` and runtime checks.
- Add tests before expanding privileged features.
