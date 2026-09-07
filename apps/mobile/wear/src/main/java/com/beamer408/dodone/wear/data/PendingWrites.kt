package com.beamer408.dodone.wear.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Writes the watch has accepted but not yet landed.
 *
 * A watch is off the network more often than a phone is, and the answer to that
 * cannot be a spinner: the whole value of ticking something off on your wrist is
 * that it takes a second. So the row moves immediately and the write waits here.
 *
 * Bounded and persisted. Bounded because an unbounded queue on a watch that has
 * been out of range for a week is a preference file that grows until something
 * fails; persisted because the system kills this app constantly and a queue in
 * memory would be a promise broken by the next tile refresh.
 */
object PendingWrites {
  private const val PREFS = "dodone_wear_pending"
  private const val KEY = "queue"

  /**
   * Past this, the oldest is dropped. Forty is far more than anyone ticks off
   * out of range, and small enough that the file stays a few kilobytes.
   */
  const val MAX = 40

  data class Entry(
    val op: String,
    val taskId: String,
    /** The create's text, or the reschedule's date. Empty for a completion. */
    val value: String,
    val queuedAt: Long
  ) {
    fun toJson(): JSONObject = JSONObject()
      .put("op", op)
      .put("taskId", taskId)
      .put("value", value)
      .put("queuedAt", queuedAt)

    companion object {
      const val OP_COMPLETE = "complete"
      const val OP_RESCHEDULE = "reschedule"
      const val OP_CREATE = "create"

      fun parse(o: JSONObject) = Entry(
        op = o.optString("op"),
        taskId = o.optString("taskId"),
        value = o.optString("value"),
        queuedAt = o.optLong("queuedAt")
      )
    }
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun all(context: Context): List<Entry> {
    val raw = prefs(context).getString(KEY, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(Entry::parse) }
    } catch (err: Exception) {
      emptyList()
    }
  }

  fun add(context: Context, entry: Entry) {
    // Newest wins on a full queue. The alternative — refusing the write — would
    // put the row back under the user's finger with no way to say why.
    val next = (all(context) + entry).takeLast(MAX)
    write(context, next)
  }

  fun remove(context: Context, entry: Entry) {
    write(context, all(context).filterNot { it == entry })
  }

  fun clear(context: Context) = write(context, emptyList())

  private fun write(context: Context, entries: List<Entry>) {
    val arr = JSONArray()
    entries.forEach { arr.put(it.toJson()) }
    prefs(context).edit().putString(KEY, arr.toString()).apply()
  }
}
