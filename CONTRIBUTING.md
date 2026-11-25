# Contributing to Nadir

## Development

```bash
npm install
npm run tauri dev
```

## Checks

```bash
node --check ui/app.js
python3 -m json.tool src-tauri/tauri.conf.json
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Guidelines

- Keep changes small and verifiable.
- Prefer explicit IPC contracts and input validation.
- Gate platform-specific behavior with `#[cfg(...)]` or runtime checks.
- Add tests for parsing, storage, settings, and command behavior.
- Do not commit secrets or local build artifacts.
