package com.beamer408.dodone.wear.data

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Everything the watch can change, and where each change is made.
 *
 * **Two paths, and which one a write takes is a rule rather than a fallback
 * order.**
 *
 * | Write | Path |
 * | --- | --- |
 * | Complete, reopen, reschedule | the phone if it is reachable, Supabase directly if not |
 * | Create | the phone, always — queued when it is not reachable |
 *
 * The split is about what a write needs to be correct.
 *
 * A completion is one field. `TasksApi.update` does a few more things around it
 * — stamps `completed_at`, feeds the pet, records a shopping item in the pantry
 * — and of those only the stamp changes what the user sees, so the watch can do
 * that part itself and be right about the row. The pet feed is the one thing a
 * direct write skips, and it is skipped only when the phone is out of range.
 *
 * A create cannot be done that way. `parseTaskInput` is what turns "call the
 * bank tomorrow" into a task scheduled tomorrow, and it is a few hundred lines
 * of TypeScript in `packages/task-engine`. Porting it to Kotlin would be the
 * exact drift this design avoids everywhere else, and getting it subtly wrong
 * means a dictated task silently landing undated. So a create is relayed or it
 * waits, and the composer says which.
 */
object WearWriter {
  sealed interface Result {
    /** The write landed, or the phone has it. */
    data object Done : Result
    /** Accepted and queued. The row has moved; the write has not gone out. */
    data object Queued : Result
    /** Nothing was written and nothing was kept. The caller must undo the row. */
    data class Failed(val reason: String) : Result
  }

  suspend fun complete(context: Context, taskId: String): Result =
    write(context, PendingWrites.Entry(PendingWrites.Entry.OP_COMPLETE, taskId, "", now()))

  suspend fun reschedule(context: Context, taskId: String, dateIso: String): Result =
    write(
      context,
      PendingWrites.Entry(PendingWrites.Entry.OP_RESCHEDULE, taskId, dateIso, now())
    )

  /**
   * Add a task from dictated or typed text.
   *
   * Relayed or queued, never written directly — see the note on this object.
   * `taskId` is empty because the row does not exist yet; the phone's parser
   * decides what it becomes.
   */
  suspend fun create(context: Context, text: String): Result {
    val entry = PendingWrites.Entry(PendingWrites.Entry.OP_CREATE, "", text, now())
    if (relay(context, entry)) return Result.Done
    PendingWrites.add(context, entry)
    return Result.Queued
  }

  /**
   * Send everything waiting.
   *
   * Called when the app opens and when a data item arrives, because a data item
   * arriving is proof the phone is in range — which is the condition the whole
   * queue is waiting on.
   */
  suspend fun flush(context: Context) {
    for (entry in PendingWrites.all(context)) {
      val sent = when (entry.op) {
        // A create can only ever go to the phone.
        PendingWrites.Entry.OP_CREATE -> relay(context, entry)
        else -> relay(context, entry) || direct(context, entry)
      }
      if (!sent) return // Still out of range. Keep the rest in order.
      PendingWrites.remove(context, entry)
    }
  }

  private suspend fun write(context: Context, entry: PendingWrites.Entry): Result {
    // The phone first, so the write goes through the one door the rules live
    // behind. Not an optimisation: it is where the write is most correct.
    if (relay(context, entry)) return Result.Done
    if (direct(context, entry)) return Result.Done
    PendingWrites.add(context, entry)
    return Result.Queued
  }

  // ── Through the phone ──────────────────────────────────

  private suspend fun relay(context: Context, entry: PendingWrites.Entry): Boolean = try {
    val nodes = Wearable.getCapabilityClient(context)
      .getCapability(WearContract.CAPABILITY_WATCH_APP, CapabilityClient.FILTER_REACHABLE)
      .await()
      .nodes
    if (nodes.isEmpty()) {
      false
    } else {
      val body = entry.toJson().toString().toByteArray()
      val client = Wearable.getMessageClient(context)
      // One reachable node is enough. Sending to all of them would apply the
      // write once per paired phone, and completing twice is not idempotent for
      // the pet history.
      client.sendMessage(nodes.first().id, WearContract.PATH_REQUEST_SYNC, body).await()
      true
    }
  } catch (err: Exception) {
    false
  }

  // ── Straight to Supabase ───────────────────────────────

  /**
   * PostgREST, with the access token the phone last handed over.
   *
   * Declines rather than tries when the token is spent: a 401 here costs a round
   * trip on a watch radio and ends in the same queue. [SnapshotStore] holds the
   * token, and asking the phone for a new one is the caller's next move.
   */
  private suspend fun direct(context: Context, entry: PendingWrites.Entry): Boolean {
    val session = SnapshotStore.session(context) ?: return false
    if (!session.usableAt(System.currentTimeMillis())) return false
    if (entry.taskId.isEmpty()) return false

    val patch = JSONObject()
    when (entry.op) {
      PendingWrites.Entry.OP_COMPLETE -> {
        patch.put("status", "done")
        // The stamp `TasksApi.update` would have added. Without it the task
        // reads as done but is missing from the Completed list, the weekly
        // summary and the streak — every surface that counts off the timestamp
        // rather than the status.
        patch.put("completed_at", isoNow())
      }
      PendingWrites.Entry.OP_RESCHEDULE -> patch.put("scheduled_date", entry.value)
      else -> return false
    }

    return withContext(Dispatchers.IO) {
      var conn: HttpURLConnection? = null
      try {
        val url = URL(
          "${session.url}/rest/v1/tasks" +
            "?id=eq.${entry.taskId}" +
            // Belt and braces beside RLS. The policy already scopes every row to
            // the caller, but a write that names the owner cannot touch someone
            // else's row even if a policy is ever loosened.
            "&user_id=eq.${session.userId}"
        )
        conn = (url.openConnection() as HttpURLConnection).apply {
          requestMethod = "PATCH"
          connectTimeout = TIMEOUT_MS
          readTimeout = TIMEOUT_MS
          doOutput = true
          setRequestProperty("apikey", session.anonKey)
          setRequestProperty("Authorization", "Bearer ${session.accessToken}")
          setRequestProperty("Content-Type", "application/json")
          // Nothing here reads the row back, and asking for it would cost a
          // response body on a watch radio for no one.
          setRequestProperty("Prefer", "return=minimal")
        }
        OutputStreamWriter(conn.outputStream).use { it.write(patch.toString()) }
        conn.responseCode in 200..299
      } catch (err: Exception) {
        false
      } finally {
        conn?.disconnect()
      }
    }
  }

  private const val TIMEOUT_MS = 10_000

  private fun now() = System.currentTimeMillis()

  private fun isoNow(): String {
    // Postgres stores `completed_at` as a timestamptz, so this has to be UTC
    // with an offset rather than the watch's local wall clock. The streak reads
    // it back and buckets by the *user's* local day; sending a local time with
    // no zone would move a late-evening completion into the wrong day.
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    fmt.timeZone = TimeZone.getTimeZone("UTC")
    return fmt.format(Date())
  }
}
