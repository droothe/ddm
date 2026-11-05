# Droothe Download Manager

This repository contains the SSR web UI, a browser download engine, and an optional Tauri v2/Rust desktop host. The native host probes the server, downloads supported HTTP byte ranges concurrently to temporary files, emits `download-progress` events, and merges the chunks into the selected directory.

## Requirements and limitations

- Cross-origin download servers must allow browser CORS requests and expose any non-safelisted headers needed for metadata, including `Accept-Ranges`, `Content-Range`, and `Content-Disposition`.
- Browsers cannot write to an arbitrary local directory or reveal a file in the operating system's file manager. The directory setting is used by the native bridge only.
- Browser downloads are held in memory until complete. Pause/resume keeps partial byte ranges in memory for the current page session; a server without Range support must be downloaded again from the beginning after a pause.
- The native backend registers `check_url_headers`, `start_download`, `pause_download`, `resume_download`, `cancel_download`, and `show_download_in_folder`. `start_download` receives `url`, `savePath`, `threadCount`, `downloadId`, and `speedLimitBytesPerSecond`; progress is emitted as `download-progress`.
- Relative save directories are resolved under the current user's home directory by the native app.
- The native HTTP client accepts HTTP(S) URLs without embedded credentials. Treat links from untrusted sources as user-initiated downloads.

## Browser extension handoff

An extension content script can send a URL to the open app page with:

```js
window.postMessage({ type: "ddm:add-download", url: "https://example.com/file.zip" }, "*");
```

The app validates the URL and opens the new-download dialog with it filled in. A native host can instead emit `external-download-request` with a `{ url }` payload.

## Development

```sh
bun install
bun run dev
```

Run the test suite with `bun run test` and the production build with `bun run build`.

For the Tauri desktop host, install the Tauri v2 CLI (`cargo install tauri-cli --version "^2"`) and run `cargo tauri dev` from `src-tauri`. Build the webview bundle with `npm run build:tauri`.

## Native release builds

The Windows portable executable is built with:

```sh
cargo tauri build --no-bundle
```

The output is `src-tauri/target/release/droothe-download-manager.exe`. The Tauri icon assets are
generated from `src-tauri/app-icon.svg` in `src-tauri/icons`.

For Android, install JDK 17 and the Android SDK command-line tools, platform-tools, NDK, and
platform/build-tools required by Tauri. Then initialize the Android project, apply the
[share-intent manifest setup](./src-tauri/android/README.md), and build an arm64 APK:

```sh
cargo tauri android init
cargo tauri android build --apk --target aarch64
```

Android APKs are written under
`src-tauri/gen/android/app/build/outputs/apk/`.

The browser engine requires server CORS access, holds file data in memory, and cannot write to a custom directory or reveal a file in the OS file manager. Those operations are provided by the native desktop host.
