package com.beamer408.dodone.wear.data

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONArray

/**
 * What the watch knows, and how it survives the app being killed.
 *
 * Three things read this and only one of them is the app: the tile and the five
 * complications are separate system-started entry points that run with nothing
 * else of ours alive. So the snapshot is kept in `SharedPreferences` rather than
 * in memory, and reading it is cheap and synchronous — a complication has about
 * a hundred milliseconds and no business awaiting a Data Layer round trip.
 *
 * The Data Layer holds its own copy, which is the authority. The preference is a
 * cache in front of it, refreshed whenever a data item changes and re-read on a
 * cold start.
 */
object SnapshotStore {
  private const val PREFS = "dodone_wear"
  private const val KEY_SNAPSHOT = "snapshot"
  private const val KEY_SESSION = "session"
  private const val KEY_COMPLETED = "completed_locally"

  private val _snapshot = MutableStateFlow(WearSnapshot.EMPTY)

  /** The list as it should be drawn, with local completions already removed. */
  val snapshot: StateFlow<WearSnapshot> = _snapshot.asStateFlow()

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ── Reading ────────────────────────────────────────────

  /**
   * The last snapshot this watch understood, with local completions applied.
   *
   * Never throws and never blocks. A watch that has never been paired, or one
   * whose stored snapshot is from a newer phone bundle, gets
   * [WearSnapshot.EMPTY] — which every surface here draws as "nothing to do"
   * plus the age of what it is showing, rather than as an error.
   */
  fun cached(context: Context): WearSnapshot {
    val stored = prefs(context).getString(KEY_SNAPSHOT, null) ?: return WearSnapshot.EMPTY
    val parsed = WearSnapshot.parse(stored) ?: return WearSnapshot.EMPTY
    return parsed.withoutLocallyCompleted(completedLocally(context))
  }

  fun session(context: Context): WearSession? =
    prefs(context).getString(KEY_SESSION, null)?.let { WearSession.parse(it) }

  /** Prime the flow from disk. Called before the first frame is drawn. */
  fun hydrate(context: Context) {
    _snapshot.value = cached(context)
  }

  // ── Writing ────────────────────────────────────────────

  /**
   * Store a snapshot the phone sent.
   *
   * A payload this build cannot read is **dropped, not stored**. Overwriting the
   * last readable one would turn a phone running ahead of this APK into an empty
   * watch, which is the worse of the two failures by a long way: the user cannot
   * tell "your watch app is old" from "you have nothing on".
   */
  fun storeSnapshot(context: Context, json: String) {
    val parsed = WearSnapshot.parse(json) ?: return
    prefs(context).edit().putString(KEY_SNAPSHOT, json).apply()
    // A fresh snapshot from the phone has already seen everything this watch
    // wrote before it was built, so the local marks it was holding are spent.
    pruneCompletedLocally(context, parsed)
    _snapshot.value = parsed.withoutLocallyCompleted(completedLocally(context))
  }

  fun storeSession(context: Context, json: String) {
    prefs(context).edit().putString(KEY_SESSION, json).apply()
  }

  /** Sign-out on the phone deletes both items; this is the other half. */
  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
    _snapshot.value = WearSnapshot.EMPTY
  }

  // ── Local completions ──────────────────────────────────

  /**
   * Ticking a task off has to move it now, not when the phone next syncs.
   *
   * The row is written straight to Supabase, but the *list* the watch draws is
   * the phone's snapshot, which will not carry the change until the phone
   * rebuilds it. So the id is remembered here and filtered out of every surface
   * — the app, the tile and the counts alike, or the tile would go on counting
   * a task the list no longer shows.
   */
  fun markCompletedLocally(context: Context, taskId: String) {
    val ids = completedLocally(context).toMutableSet()
    if (!ids.add(taskId)) return
    writeCompletedLocally(context, ids)
    _snapshot.value = cached(context)
  }

  /** Undo a local mark — the write failed and could not be queued. */
  fun unmarkCompletedLocally(context: Context, taskId: String) {
    val ids = completedLocally(context).toMutableSet()
    if (!ids.remove(taskId)) return
    writeCompletedLocally(context, ids)
    _snapshot.value = cached(context)
  }

  fun completedLocally(context: Context): Set<String> {
    val raw = prefs(context).getString(KEY_COMPLETED, null) ?: return emptySet()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotEmpty) }.toSet()
    } catch (err: Exception) {
      emptySet()
    }
  }

  private fun writeCompletedLocally(context: Context, ids: Set<String>) {
    prefs(context).edit().putString(KEY_COMPLETED, JSONArray(ids.toList()).toString()).apply()
  }

  /**
   * Forget marks for tasks the new snapshot no longer lists.
   *
   * Kept as an intersection rather than cleared outright, because a snapshot can
   * be built while a write is still in flight: the phone would not yet know, and
   * clearing would put the row back under the user's finger.
   */
  private fun pruneCompletedLocally(context: Context, snapshot: WearSnapshot) {
    val stillListed = snapshot.lists
      .flatMap { it.groups }
      .flatMap { it.rows }
      .map { it.id }
      .toSet()
    val kept = completedLocally(context).intersect(stillListed)
    writeCompletedLocally(context, kept)
  }

  // ── The Data Layer ─────────────────────────────────────

  /**
   * Re-read both data items directly.
   *
   * The listener service covers changes; this covers a cold start that missed
   * one — the app opened for the first time after pairing, or after the system
   * killed us while a data item landed.
   */
  suspend fun refreshFromDataLayer(context: Context) {
    val client = Wearable.getDataClient(context)
    try {
      val buffer = client.dataItems.await()
      try {
        for (item in buffer) {
          val json = DataMapItem.fromDataItem(item).dataMap.getString(WearContract.KEY_JSON)
            ?: continue
          when (item.uri.path) {
            WearContract.PATH_SNAPSHOT -> storeSnapshot(context, json)
            WearContract.PATH_SESSION -> storeSession(context, json)
          }
        }
      } finally {
        // `release()` rather than `use {}`: this buffer has carried `Closeable`
        // only in some releases of Play Services, and leaking it holds a native
        // handle open for the life of the process.
        buffer.release()
      }
    } catch (err: Exception) {
      // No Play Services, or no phone in range. The cached snapshot stands and
      // every surface says how old it is.
    }
  }

  /**
   * Ask the phone to build a fresh snapshot.
   *
   * The reply arrives as a data item, not as a return value — the phone may need
   * to start a headless JS task to answer, which takes seconds. So this returns
   * as soon as the message is away and the caller carries on drawing what it
   * has.
   */
  suspend fun requestPhoneSync(context: Context) {
    try {
      val nodes = Wearable.getCapabilityClient(context)
        .getCapability(WearContract.CAPABILITY_WATCH_APP, CapabilityClient.FILTER_REACHABLE)
        .await()
        .nodes
      // The capability is declared by *this* app, so the reachable nodes
      // carrying it are the phones with DoDone installed. A watch with no phone
      // in range gets an empty list, which is not an error.
      val messageClient = Wearable.getMessageClient(context)
      for (node in nodes) {
        messageClient.sendMessage(node.id, WearContract.PATH_REQUEST_SYNC, ByteArray(0)).await()
      }
    } catch (err: Exception) {
      // Nothing to do but keep showing what we have.
    }
  }
}

/**
 * The snapshot minus anything this watch has already ticked off, counts
 * included.
 *
 * The counts have to move with the rows. A tile that says "3 left" over a list
 * of two is a worse bug than either number being stale, because the two
 * disagree on the same screen.
 */
fun WearSnapshot.withoutLocallyCompleted(done: Set<String>): WearSnapshot {
  if (done.isEmpty()) return this
  var removedOpen = 0
  var removedOverdue = 0
  val lists = this.lists.map { list ->
    val groups = list.groups.mapNotNull { group ->
      val rows = group.rows.filterNot { row ->
        val drop = row.id in done
        if (drop && list.key == "today") {
          removedOpen++
          if (row.gutter == "overdue") removedOverdue++
        }
        drop
      }
      if (rows.isEmpty()) null else group.copy(rows = rows)
    }
    list.copy(groups = groups)
  }
  val next = lists.firstOrNull { it.key == "today" }
    ?.groups?.firstOrNull()?.rows?.firstOrNull()?.title ?: ""
  return copy(
    lists = lists,
    counts = counts.copy(
      openToday = (counts.openToday - removedOpen).coerceAtLeast(0),
      // A task ticked off on the wrist is one done today, so the progress ring
      // moves on the tap rather than on the next sync.
      doneToday = counts.doneToday + removedOpen,
      overdue = (counts.overdue - removedOverdue).coerceAtLeast(0),
      nextTitle = next
    )
  )
}
