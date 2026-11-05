# Android build and storage

The Android project is generated reproducibly by `cargo tauri android init`. Run
`python src-tauri/android/prepare_android.py` afterward to merge the `ACTION_SEND` / `text/plain`
filter into the launcher activity, set `singleTask`, and install the native plugin from
`src-tauri/android/plugin`. The script is idempotent and preserves the generated activity's other
manifest attributes, including `android:exported`.

The `Android APK` GitHub Actions workflow performs those steps and uploads an arm64 APK artifact.
Download it from the workflow run's **Artifacts** section.

On Android 10 and newer, completed downloads are copied from app-private storage into scoped
MediaStore collections without requesting broad storage permissions:

- video -> `Movies/Droothe`
- audio -> `Music/Droothe`
- other files -> `Download/Droothe`

The MediaStore URI is retained by the UI and the open action launches an Android viewer for that
item. Failed publication is reported in the download row; the original app-private file remains.
