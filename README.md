<div align="center">

# Droothe Download Manager

**A focused download manager for the web and native desktop—with Android sharing support.**

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-native%20engine-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-frontend-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Android](https://img.shields.io/badge/Android-supported-3DDC84?logo=android&logoColor=white)](https://www.android.com/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

![Droothe Download Manager](./docs/screenshot.png)

</div>

DDM combines a React and TypeScript download dashboard with a Rust-powered Tauri v2 application. Use the browser engine for a no-install web experience, or run the native desktop and Android builds for filesystem access, concurrent HTTP downloads, and platform integrations.

## Key features

- **Multi-segment downloads:** the native engine splits servers that support HTTP byte ranges into concurrent segments, tracks live progress, and merges the finished file.
- **Pause, resume, cancel, and queue controls:** manage individual downloads or pause and resume the queue together.
- **Speed and concurrency controls:** choose the number of segments and set a global speed limit.
- **English and Turkish interface:** the UI follows the system language when supported and can be changed in Settings.
- **Browser and native engines:** the web UI can run without Tauri; the desktop and Android hosts provide native download and storage capabilities.
- **Android share intents:** share a link from another Android app to DDM. Direct audio and video URLs can be previewed before downloading.
- **Android MediaStore publishing:** completed files are saved to the appropriate public media collection without broad storage permissions on Android 10 and newer.
- **Chromium browser extension:** send a link from a page's right-click menu to an open DDM browser tab.
- **Direct media link support:** DDM downloads direct HTTP(S) URLs. It does not scrape or extract media from social-platform pages.

## Install and run

### Windows

Download a Windows build from the project's [GitHub Releases](https://github.com/Droothe60/ddm/releases) when one is available. The current Tauri configuration disables bundling, so a source build produces a portable executable rather than an installer.

To build and run from source, install [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), the Visual Studio C++ build tools, and the Microsoft Edge WebView2 Runtime. In a terminal at the repository root:

```powershell
bun install
cd src-tauri
cargo tauri dev
```

To produce the Windows executable:

```powershell
cd src-tauri
cargo tauri build --no-bundle
```

The executable is written to `src-tauri/target/release/droothe-download-manager.exe`.

### Android

For a prebuilt APK, download the `Android APK` artifact from a successful run of the repository's [Android APK workflow](https://github.com/Droothe60/ddm/actions/workflows/android-apk.yml). Transfer the APK to your device and install it, allowing installation from that source if Android asks. The workflow currently builds an arm64 APK.

To build locally, install Bun, Rust with the Android target, Python 3, a JDK, and the Android SDK/NDK. From the repository root:

```sh
bun install
cd src-tauri
cargo tauri android init
cd ..
python src-tauri/android/prepare_android.py
cd src-tauri
cargo tauri android build --apk --target aarch64
```

The preparation script adds the Android `ACTION_SEND` / `text/plain` intent filter and installs the share and media plugin into the generated Android project. APK output is under `src-tauri/gen/android/app/build/outputs/apk/`.

On Android 10 and newer, completed videos are published under `Movies/Droothe`, audio under `Music/Droothe`, and other files under `Download/Droothe`. Android downloads use app-private staging storage before publication.

## Chromium browser extension

The Manifest V3 extension supports Chrome, Brave, and Edge. It prefers an open DDM web-app tab. If none is found, it opens a `ddm://download?url=...` link to hand the download to the desktop application.

1. Open the browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the repository's `extension/` folder.
4. On Windows, launch the desktop app once to register the `ddm` protocol. Then, on any page, right-click a link and choose **Download with DDM**. When no DDM web tab is open, the browser will ask to launch the desktop app if needed.

The extension's content script relays the URL to the DDM page using:

```js
window.postMessage({ type: "ddm:add-download", url }, "*");
```

The app validates incoming URLs and opens the new-download dialog. The Windows desktop app registers `ddm://` at startup; its single-instance integration forwards later protocol activations to the running app and focuses its window. Supported links are `ddm://download?url=<encoded-http-url>` and `ddm://add?url=<encoded-http-url>`.

## Development

Install the JavaScript dependencies once, then start the web app:

```sh
bun install
bun run dev
```

Run the Tauri desktop application from `src-tauri/` (with the Tauri v2 CLI available):

```sh
cd src-tauri
cargo tauri dev
```

Build the Tauri web frontend from the repository root:

```sh
bun run build:tauri
```

Additional project checks:

```sh
bun run test
bun run lint
```

## Architecture

- **Frontend (`src/`):** React and TypeScript UI, download state, browser download engine, and share-intent handling.
- **Native host (`src-tauri/`):** Tauri v2 commands and a Rust/Tokio HTTP engine. It probes server metadata, uses byte-range segments when supported, writes temporary chunks, and merges them into the destination.
- **Android integration (`src-tauri/android/`):** generated-manifest preparation, Android share intent plugin, and scoped MediaStore publishing.
- **Browser extension (`extension/`):** MV3 context menu and content-script bridge to an open DDM web page.

## Network and platform limitations

- **CORS in browser mode:** the browser engine is subject to same-origin policy. A cross-origin server must allow the app's origin and permit request headers when the browser requires it (including `Range` where applicable). It must also expose response headers used for metadata (such as `Content-Length`, `Accept-Ranges`, `Content-Range`, and `Content-Disposition`) when those headers are not CORS-safelisted. The native Rust client is not subject to browser CORS rules.
- **HTTP range support:** the native engine verifies that a server honors byte-range requests before downloading multiple segments. If ranges are unavailable, it downloads as a single stream; concurrent segments and range-based resume are not available for that server. A server that advertises ranges but does not honor them may fail the download.
- **Browser storage:** browser downloads are assembled in memory and saved through the browser's download mechanism. A web page cannot write to an arbitrary filesystem path or reveal a file in the operating system's file manager. Use the native app for destination-folder control.
- **Social platforms:** sharing and previewing is intended for direct audio/video file URLs. DDM deliberately does not extract media from social-platform pages; use a direct URL you are authorized to download.
- **Extension handoff:** `window.postMessage` reaches an open DDM browser page; otherwise the extension uses the registered `ddm://` handler to open or activate the desktop app.
- **URL support:** downloads use HTTP or HTTPS links; embedded URL credentials are not accepted by the native engine.

## License

This project is distributed under the MIT License. See [LICENSE](./LICENSE).
