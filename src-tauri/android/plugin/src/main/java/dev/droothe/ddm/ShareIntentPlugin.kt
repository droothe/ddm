package dev.droothe.ddm

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import org.json.JSONObject

@InvokeArg
internal class PublishDownloadArgs {
    lateinit var sourcePath: String
    lateinit var name: String
    var mimeType: String? = null
}

@InvokeArg
internal class OpenMediaArgs {
    lateinit var uri: String
}

@TauriPlugin
class ShareIntentPlugin(private val activity: Activity) : Plugin(activity) {
    private var initialShare: JSObject? = null
    private var webView: WebView? = null

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        initialShare = sharedText(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        activity.setIntent(intent)
        val payload = sharedText(intent) ?: return
        initialShare = payload
        val serialized = JSONObject.quote(payload.toString())
        activity.runOnUiThread {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('ddm:share-intent',{detail:JSON.parse($serialized)}))",
                null,
            )
        }
    }

    @Command
    fun getInitialSharedText(invoke: Invoke) {
        invoke.resolve(initialShare)
        initialShare = null
    }

    @Command
    fun publishDownload(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(PublishDownloadArgs::class.java)
        } catch (error: Exception) {
            invoke.reject("Invalid Android media save request: ${error.message}", error)
            return
        }
        Thread({
            try {
                val uri = publishToMediaStore(args.sourcePath, args.name, args.mimeType)
                activity.runOnUiThread { invoke.resolveObject(mapOf("uri" to uri.toString())) }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    invoke.reject("Could not save download to Android media storage: ${error.message}", error)
                }
            }
        }, "ddm-media-publish").start()
    }

    @Command
    fun openMediaStoreItem(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(OpenMediaArgs::class.java)
        } catch (error: Exception) {
            invoke.reject("Invalid Android media URI request: ${error.message}", error)
            return
        }
        val uri = Uri.parse(args.uri)
        if (uri.scheme != "content") {
            invoke.reject("Invalid media URI.")
            return
        }
        activity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, activity.contentResolver.getType(uri) ?: "*/*")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(Intent.createChooser(intent, "Open download"))
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject("Could not open the saved media item: ${error.message}", error)
            }
        }
    }

    private fun publishToMediaStore(
        sourcePath: String,
        requestedName: String,
        declaredMimeType: String?,
    ): Uri {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw IllegalStateException("MediaStore publishing requires Android 10 or later.")
        }

        val source = File(sourcePath).canonicalFile
        val privateRoot = activity.filesDir.canonicalFile
        if (!source.path.startsWith(privateRoot.path + File.separator) || !source.isFile) {
            throw SecurityException("The download file is outside the app's private storage.")
        }

        val name = File(requestedName).name
        if (name.isBlank() || name == "." || name == "..") {
            throw IllegalArgumentException("Invalid download filename.")
        }
        val extension = name.substringAfterLast('.', "").lowercase()
        val extensionMimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
        val mimeType = declaredMimeType
            ?.takeIf { it.startsWith("video/") || it.startsWith("audio/") }
            ?: extensionMimeType
            ?: "application/octet-stream"
        val (collection, relativePath) = when {
            mimeType.startsWith("video/") ->
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                    "${Environment.DIRECTORY_MOVIES}/Droothe"
            mimeType.startsWith("audio/") ->
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                    "${Environment.DIRECTORY_MUSIC}/Droothe"
            else ->
                MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                    "${Environment.DIRECTORY_DOWNLOADS}/Droothe"
        }

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = activity.contentResolver
        val destination = resolver.insert(collection, values)
            ?: throw IOException("Android could not create the media item.")
        try {
            val output = resolver.openOutputStream(destination, "w")
                ?: throw IOException("Android could not open the media item.")
            FileInputStream(source).use { input ->
                output.use { input.copyTo(it, bufferSize = 64 * 1024) }
            }
            val publishedValues = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }
            if (resolver.update(destination, publishedValues, null, null) != 1) {
                throw IOException("Android could not publish the media item.")
            }
            return destination
        } catch (error: Exception) {
            resolver.delete(destination, null, null)
            throw error
        }
    }

    private fun sharedText(intent: Intent?): JSObject? {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
        val payload = JSObject()
        payload.put("text", text)
        payload.put("mimeType", intent.type)
        return payload
    }
}
