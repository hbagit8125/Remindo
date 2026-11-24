package app.remindo.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Rows for the widget list: focus tasks first, then today's reminders. */
class WidgetListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private data class Row(val title: String, val meta: String, val done: Boolean, val high: Boolean, val late: Boolean)

    private class Factory(private val context: Context) : RemoteViewsFactory {
        private var rows: List<Row> = emptyList()

        override fun onCreate() {}
        override fun onDestroy() {}

        override fun onDataSetChanged() {
            val json = Store.lastJson(context) ?: run { rows = emptyList(); return }
            val out = mutableListOf<Row>()
            json.optJSONArray("tasks")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val t = arr.getJSONObject(i)
                    out += Row(t.optString("title"), "Focus", t.optBoolean("done"), t.optBoolean("high"), false)
                }
            }
            json.optJSONArray("reminders")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val r = arr.getJSONObject(i)
                    out += Row(r.optString("title"), r.optString("time"), r.optBoolean("done"), r.optBoolean("high"), r.optBoolean("past"))
                }
            }
            // Open things first, done ones at the bottom.
            rows = out.sortedBy { it.done }
        }

        override fun getCount() = rows.size

        override fun getViewAt(position: Int): RemoteViews {
            val r = rows[position]
            val v = RemoteViews(context.packageName, R.layout.widget_item)
            v.setTextViewText(R.id.item_title, (if (r.high && !r.done) "❗ " else "") + r.title)
            v.setTextViewText(R.id.item_meta, r.meta)
            v.setTextViewText(R.id.item_check, if (r.done) "✓" else if (r.meta == "Focus") "☐" else "○")
            v.setTextColor(R.id.item_title, context.getColor(if (r.done) R.color.muted else R.color.fg))
            v.setTextColor(R.id.item_meta, context.getColor(if (r.late) R.color.late else R.color.muted))
            v.setOnClickFillInIntent(R.id.item_root, Intent())
            return v
        }

        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 1
        override fun getItemId(position: Int) = position.toLong()
        override fun hasStableIds() = false
    }
}
