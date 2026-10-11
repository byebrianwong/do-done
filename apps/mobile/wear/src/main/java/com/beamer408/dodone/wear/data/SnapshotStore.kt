package com.beamer408.dodone.wear.data

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

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
  private const val KEY_STALE_ASKED_AT = "stale_asked_at"

  /**
   * How often a stale tile or complication may ask the phone for a fresh
   * snapshot. Both are drawn often, and each ask can start the phone's JS.
   */
  private const val STALE_ASK_INTERVAL_MS = 15 * 60_000L

  private val _snapshot = MutableStateFlow(WearSnapshot.EMPTY)

  /** The list as it should be drawn, with local completions already removed. */
  val snapshot: StateFlow<WearSnapshot> = _snapshot.asStateFlow()

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ── Reading ────────────────────────────────────────────

  /**
   * The view that is true now: the last snapshot this watch understood, with
   * local completions applied, resolved to today with [WearSnapshot.at].
   *
   * Never throws and never blocks. A watch that has never been paired, or one
   * whose stored snapshot is from a newer phone bundle, gets
   * [WearSnapshot.EMPTY], which every surface here draws as "nothing to do"
   * plus the age of what it is showing, rather than as an error.
   */
  fun cached(context: Context, nowMs: Long = System.currentTimeMillis()): WearSnapshot =
    stored(context).at(nowMs)

  /**
   * Both days, unresolved. For the tile and the complications, which hand the
   * system one entry per day rather than only the one that is true now.
   */
  fun stored(context: Context): WearSnapshot {
    val json = prefs(context).getString(KEY_SNAPSHOT, null) ?: return WearSnapshot.EMPTY
    val parsed = WearSnapshot.parse(json) ?: return WearSnapshot.EMPTY
    return parsed.withoutLocallyCompleted(completedLocally(context).keys)
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
    // A new snapshot settles some local marks: either the phone has the
    // completion, or enough time has passed to know it never arrived. See
    // keptCompletionMarks.
    pruneCompletedLocally(context, parsed)
    _snapshot.value = cached(context)
  }

  fun storeSession(context: Context, json: String) {
    prefs(context).edit().putString(KEY_SESSION, json).apply()
  }

  /**
   * Sign-out on the phone deletes both items; this is the other half.
   *
   * The write queue goes too. It is keyed to no account, so a create queued
   * before the sign-out would otherwise be relayed to whoever signs in next
   * and filed in their account.
   */
  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
    PendingWrites.clear(context)
    _snapshot.value = WearSnapshot.EMPTY
  }

  // ── Local completions ──────────────────────────────────

  /**
   * Ticking a task off has to move it now, not when the phone next syncs.
   *
   * The row is written straight to Supabase, but the *list* the watch draws is
   * the phone's snapshot, which will not carry the change until the phone
   * rebuilds it. So the id is remembered here and filtered out of every surface
   * (the app, the tile and the counts alike), or the tile would go on counting
   * a task the list no longer shows.
   *
   * Each mark carries the time its write was handed off, which is what lets
   * [keptCompletionMarks] tell a write still landing from one that was lost.
   */
  fun markCompletedLocally(context: Context, taskId: String) {
    val marks = completedLocally(context).toMutableMap()
    if (taskId in marks) return
    marks[taskId] = System.currentTimeMillis()
    writeCompletedLocally(context, marks)
    _snapshot.value = cached(context)
  }

  /**
   * Restart a mark's clock: its write has just left the watch.
   *
   * Called when a queued completion finally goes out. Without it, a mark made
   * while out of range would look long overdue the moment the phone came back,
   * and the first snapshot built before the write landed would put the row back.
   */
  fun markHandedOff(context: Context, taskId: String) {
    val marks = completedLocally(context).toMutableMap()
    if (taskId !in marks) return
    marks[taskId] = System.currentTimeMillis()
    writeCompletedLocally(context, marks)
  }

  /** Undo a local mark: the write failed and could not be queued. */
  fun unmarkCompletedLocally(context: Context, taskId: String) {
    val marks = completedLocally(context).toMutableMap()
    if (marks.remove(taskId) == null) return
    writeCompletedLocally(context, marks)
    _snapshot.value = cached(context)
  }

  /** Task id to the epoch ms its completion was handed off. */
  fun completedLocally(context: Context): Map<String, Long> {
    val raw = prefs(context).getString(KEY_COMPLETED, null) ?: return emptyMap()
    return try {
      val o = JSONObject(raw)
      o.keys().asSequence().associateWith { o.optLong(it) }
    } catch (err: Exception) {
      emptyMap()
    }
  }

  private fun writeCompletedLocally(context: Context, marks: Map<String, Long>) {
    val o = JSONObject()
    marks.forEach { (id, at) -> o.put(id, at) }
    prefs(context).edit().putString(KEY_COMPLETED, o.toString()).apply()
  }

  private fun pruneCompletedLocally(context: Context, snapshot: WearSnapshot) {
    val kept = keptCompletionMarks(
      marks = completedLocally(context),
      listedIds = snapshot.rowIds(),
      queuedIds = PendingWrites.queuedCompletions(context),
      generatedAt = snapshot.generatedAt
    )
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
   * Ask the phone for a fresh snapshot when [view] is not today's, at most once
   * every [STALE_ASK_INTERVAL_MS].
   *
   * For the tile and the complications, which are drawn with the app closed
   * and would otherwise wait for the phone to be opened. Past midnight they
   * show the phone's precomputed next day, which is a forecast from yesterday's
   * rows; this is what replaces it with the real thing.
   */
  suspend fun requestPhoneSyncIfStale(context: Context, view: WearSnapshot, nowMs: Long) {
    if (view.validity == Validity.CURRENT) return
    val prefs = prefs(context)
    if (nowMs - prefs.getLong(KEY_STALE_ASKED_AT, 0L) < STALE_ASK_INTERVAL_MS) return
    prefs.edit().putLong(KEY_STALE_ASKED_AT, nowMs).apply()
    requestPhoneSync(context)
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
 * How long after a completion leaves the watch a snapshot may still be blind
 * to it.
 *
 * A relayed write is applied by the phone's headless task, which has a 30
 * second timeout, before the snapshot that task sends back. Another trigger
 * can build a snapshot from a read made before the write landed. Two minutes
 * covers both with room for a slow wake. The comparison is between the
 * watch's clock and the phone's, which a paired watch keeps in step.
 */
const val LANDING_GRACE_MS = 2 * 60_000L

/**
 * Which completion marks survive a new snapshot.
 *
 * A mark hides a row the user ticked off until the phone's snapshot stops
 * listing it. It must not outlive a write that never landed. Before this rule,
 * a relayed completion the phone failed to apply (a refused background start,
 * a network error, the headless timeout) kept its mark for as long as the task
 * was open: the task stayed open everywhere else and hidden on the watch, with
 * nothing to say so.
 *
 * - Not listed any more: the phone has it. Drop the mark.
 * - Still queued on the watch: the write has not gone out. Keep it.
 * - Built within [LANDING_GRACE_MS] of the hand-off: the write may still be
 *   landing. Keep it.
 * - Built later and still listed: the write did not land, or something newer
 *   reopened the task. Drop the mark, and the row comes back, which is the
 *   truth. The write is not retried: a task reopened on the phone after the
 *   tick must stay open.
 */
fun keptCompletionMarks(
  marks: Map<String, Long>,
  listedIds: Set<String>,
  queuedIds: Set<String>,
  generatedAt: Long
): Map<String, Long> = marks.filter { (id, handedOffAt) ->
  when {
    id !in listedIds -> false
    id in queuedIds -> true
    else -> generatedAt < handedOffAt + LANDING_GRACE_MS
  }
}

/**
 * The snapshot minus anything this watch has already ticked off, counts
 * included, on both days.
 *
 * The counts have to move with the rows. A tile that says "3 left" over a list
 * of two is a worse bug than either number being stale, because the two
 * disagree on the same screen.
 */
fun WearSnapshot.withoutLocallyCompleted(done: Set<String>): WearSnapshot {
  if (done.isEmpty()) return this
  val today = WearDayView(day, validUntil, lists, counts).without(done, countsAsDone = true)
  return copy(
    lists = today.lists,
    counts = today.counts,
    // Tomorrow's view only loses the rows. A task ticked off today was not
    // done tomorrow, so it does not add to that day's progress.
    next = next?.without(done, countsAsDone = false)
  )
}

private fun WearDayView.without(done: Set<String>, countsAsDone: Boolean): WearDayView {
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
  val nextTitle = lists.firstOrNull { it.key == "today" }
    ?.groups?.firstOrNull()?.rows?.firstOrNull()?.title ?: ""
  return copy(
    lists = lists,
    counts = counts.copy(
      openToday = (counts.openToday - removedOpen).coerceAtLeast(0),
      // A task ticked off on the wrist is one done today, so the progress ring
      // moves on the tap rather than on the next sync.
      doneToday = if (countsAsDone) counts.doneToday + removedOpen else counts.doneToday,
      overdue = (counts.overdue - removedOverdue).coerceAtLeast(0),
      nextTitle = nextTitle
    )
  )
}
