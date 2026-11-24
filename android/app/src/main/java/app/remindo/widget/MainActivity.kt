package app.remindo.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/**
 * Setup: paste the link from Remindo → More, or tap "Connect it" there (which opens
 * remindo://setup?u=<site>&k=<key> and fills everything in).
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var site: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        site = findViewById(R.id.site)
        site.setText(Store.site(this) ?: "https://remindo-jet.vercel.app")

        findViewById<Button>(R.id.open).setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(site.text.toString().trim().trimEnd('/') + "/more")))
        }
        findViewById<Button>(R.id.test).setOnClickListener { test() }
        handle(intent)
        showState()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "remindo" && data.host == "setup") {
            val u = data.getQueryParameter("u")
            val k = data.getQueryParameter("k")
            if (!u.isNullOrBlank() && !k.isNullOrBlank() && u.startsWith("https://")) {
                Store.saveLink(this, u, k)
                site.setText(u)
                test()
            } else {
                status.text = "That link didn't look right. Open Remindo → More → Connect it again."
            }
        }
    }

    private fun showState() {
        status.text = if (Store.key(this) == null)
            "Not connected yet.\n\n1. Tap \"Open Remindo\" below.\n2. In More → Home-screen widget, tap \"Connect it\"."
        else "✅ Connected. Long-press your home screen → Widgets → Remindo to add it."
    }

    private fun test() {
        status.text = "Checking…"
        Thread {
            val ok = Store.refresh(this)
            runOnUiThread {
                status.text = if (ok) {
                    TodayWidget.updateAll(this)
                    "✅ Connected. Long-press your home screen → Widgets → Remindo to add it.\n\nIt updates every 30 minutes and when you tap ⟳."
                } else "⚠️ " + (Store.lastError(this) ?: "Couldn't connect")
            }
        }.start()
    }
}
