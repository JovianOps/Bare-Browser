# Security Policy

## Reporting

Please report security issues privately to the repository maintainers. Do not open public issues for unpatched vulnerabilities.

## Scope

Nadir is a system-webview browser shell. Security boundaries include:

- Tauri IPC command validation and capabilities
- File/path handling for downloads, imports, exports, and storage
- URL/scheme handling (`nadir://`, `http://`, `https://`)
- Webview configuration and permission prompts

## Current posture

- No telemetry by default.
- Local JSON storage in app data directory with schema version and `.bak` backup.
- Privileged operations should go through Rust commands, not untrusted page content.

## Hardening backlog

- Typed IPC errors and strict input validation
- Per-site permission prompts
- CSP/hardening for built-in pages
- Dependency auditing in CI
