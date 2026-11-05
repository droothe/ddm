package dev.droothe.ddm

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.TauriPlugin
import app.tauri.annotation.Command
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

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

    private fun sharedText(intent: Intent?): JSObject? {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
        val payload = JSObject()
        payload.put("text", text)
        payload.put("mimeType", intent.type)
        return payload
    }
}
