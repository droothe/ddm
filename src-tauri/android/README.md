# Android share-intent setup

The Tauri Android plugin is registered in `src-tauri/src/lib.rs`; its Kotlin implementation is
`src-tauri/gen/android/app/src/main/java/dev/droothe/ddm/ShareIntentPlugin.kt`. After running
`cargo tauri android init`, verify that the generated project retains that source file. Merge the
following filter into the generated `.MainActivity` declaration in
`src-tauri/gen/android/app/src/main/AndroidManifest.xml`:

```xml
<!-- contents of src-tauri/android/AndroidManifest.share-intent.xml -->
```

Keep the generated activity's existing `android:exported` setting. The Kotlin plugin forwards warm
`onNewIntent` shares as a `ddm:share-intent` WebView event and exposes the cold-start intent through
its `getInitialSharedText` command. Ensure the activity uses `android:launchMode="singleTask"` so
subsequent shares reach `onNewIntent` instead of creating another activity.
Do not grant broad external-storage permissions: Android 10+ scoped storage should be used. The
Rust engine writes under the app's selected private directory; exporting to public Downloads or
MediaStore requires a separate SAF/MediaStore integration and a user-authorized URI.
