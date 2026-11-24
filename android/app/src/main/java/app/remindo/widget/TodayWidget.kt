package app.remindo.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/** Home-screen widget: today's reminders and focus tasks from Remindo. */
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        // Show what we have straight away, then fetch fresh data in the background.
        render(context, manager, ids)
        val pending = goAsync()
        Thread {
            try {
                Store.refresh(context)
                render(context, manager, ids)
            } finally {
                pending.finish()
            }
        }.start()
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) updateAll(context)
    }

    companion object {
        const val ACTION_REFRESH = "app.remindo.widget.REFRESH"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            if (ids.isEmpty()) return
            val i = Intent(context, TodayWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(i)
        }

        private fun openUrl(context: Context, path: String, code: Int): PendingIntent {
            val site = Store.site(context) ?: "https://remindo-jet.vercel.app"
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(site + path)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val json = Store.lastJson(context)
            val error = Store.lastError(context)
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget)
                val date = json?.optString("date") ?: "Today"
                val left = json?.optInt("left", 0) ?: 0
                views.setTextViewText(R.id.title, if (json == null) "Remindo" else "Today · $date")
                val subtitle = when {
                    Store.site(context) == null -> "Tap to connect"
                    error != null && json == null -> error
                    json == null -> "Loading…"
                    else -> buildString {
                        append(if (left == 0) "All done 🎉" else "$left left")
                        json.optString("spentToday").takeIf { it.isNotBlank() && it != "null" }?.let { append(" · $it spent") }
                        if (error != null) append(" · offline") else append(" · ${json.optString("updated")}")
                    }
                }
                views.setTextViewText(R.id.subtitle, subtitle)

                // List of rows (filled by WidgetListService).
                val svc = Intent(context, WidgetListService::class.java).apply {
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
                }
                views.setRemoteAdapter(R.id.list, svc)
                views.setEmptyView(R.id.list, R.id.empty)
                views.setTextViewText(
                    R.id.empty,
                    if (Store.site(context) == null) "Open the Remindo Widget app and tap Connect." else "Nothing for today 🎉",
                )
                views.setPendingIntentTemplate(R.id.list, openUrl(context, "/plan", 1))

                // Taps: header opens the app, + opens Ask, ⟳ refreshes.
                val tapHeader = if (Store.site(context) == null) {
                    PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
                } else openUrl(context, "/plan", 3)
                views.setOnClickPendingIntent(R.id.header, tapHeader)
                views.setOnClickPendingIntent(R.id.add, openUrl(context, "/?add=ask", 4))
                val refresh = PendingIntent.getBroadcast(
                    context, 5,
                    Intent(context, TodayWidget::class.java).setAction(ACTION_REFRESH),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                views.setOnClickPendingIntent(R.id.refresh, refresh)
                views.setViewVisibility(R.id.add, if (Store.site(context) == null) View.GONE else View.VISIBLE)

                manager.updateAppWidget(id, views)
                manager.notifyAppWidgetViewDataChanged(id, R.id.list)
            }
        }
    }
}
