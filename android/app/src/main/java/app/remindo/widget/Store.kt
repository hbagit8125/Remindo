package app.remindo.widget

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Saved link (site + read-only key) and the last list we fetched. */
object Store {
    private const val PREFS = "remindo"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun site(c: Context): String? = prefs(c).getString("site", null)
    fun key(c: Context): String? = prefs(c).getString("key", null)
    fun lastJson(c: Context): JSONObject? = prefs(c).getString("json", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun lastError(c: Context): String? = prefs(c).getString("error", null)

    fun saveLink(c: Context, site: String, key: String) {
        prefs(c).edit().putString("site", site.trimEnd('/')).putString("key", key).remove("error").apply()
    }

    /** Fetch today's list from Remindo. Runs on a background thread. */
    fun refresh(c: Context): Boolean {
        val site = site(c) ?: return false.also { prefs(c).edit().putString("error", "Open the Remindo Widget app to connect").apply() }
        val key = key(c) ?: return false
        return try {
            val url = URL("$site/api/widget?k=" + URLEncoder.encode(key, "UTF-8"))
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            conn.disconnect()
            if (code in 200..299) {
                prefs(c).edit().putString("json", body).remove("error").apply()
                true
            } else {
                val msg = runCatching { JSONObject(body).optString("error") }.getOrNull()?.takeIf { it.isNotBlank() } ?: "Couldn't update ($code)"
                prefs(c).edit().putString("error", msg).apply()
                false
            }
        } catch (e: Exception) {
            prefs(c).edit().putString("error", "Offline, showing the last update").apply()
            false
        }
    }
}
