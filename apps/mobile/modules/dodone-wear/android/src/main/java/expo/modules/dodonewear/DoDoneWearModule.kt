package expo.modules.dodonewear

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Writes the two data items the watch reads, and answers whether there is a
 * watch to read them.
 *
 * It takes JSON strings rather than maps on purpose. The payload's shape is
 * decided and tested in `lib/wear-snapshot.ts`; re-encoding it as a `DataMap`
 * here would give the native side a second opinion about that shape, in a
 * language nothing in CI compiles.
 */
class DoDoneWearModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DoDoneWear")

    AsyncFunction("syncToWatch") { snapshotJson: String, sessionJson: String, promise: Promise ->
      // A put with no watch paired is not an error: the item is held locally and
      // delivered when a node appears. So the only failure worth reporting is
      // the put itself failing.
      val puts = listOf(
        put(WearContract.PATH_SNAPSHOT, snapshotJson),
        put(WearContract.PATH_SESSION, sessionJson)
      )
      Tasks.whenAll(puts)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { err ->
          promise.reject("ERR_WEAR_SYNC", err.message ?: "putDataItem failed", err)
        }
    }

    AsyncFunction("clearWatch") { promise: Promise ->
      val client = Wearable.getDataClient(context)
      val deletes = listOf(WearContract.PATH_SNAPSHOT, WearContract.PATH_SESSION)
        .map { client.deleteDataItems(anyNodeUri(it)) }
      Tasks.whenAll(deletes)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { promise.resolve(false) }
    }

    AsyncFunction("hasWatchApp") { promise: Promise ->
      Wearable.getCapabilityClient(context)
        .getCapability(WearContract.CAPABILITY_WATCH_APP, CapabilityClient.FILTER_REACHABLE)
        .addOnSuccessListener { info -> promise.resolve(info.nodes.isNotEmpty()) }
        // Play Services missing or the call failed. "We can't tell" reports as
        // no watch, because every caller uses this to decide whether to show a
        // row about one.
        .addOnFailureListener { promise.resolve(false) }
    }
  }

  private fun put(path: String, json: String) =
    Wearable.getDataClient(context).putDataItem(
      PutDataMapRequest.create(path)
        .apply { dataMap.putString(WearContract.KEY_JSON, json) }
        .asPutDataRequest()
        // Without this the platform batches the write and can hold it for up to
        // half an hour, which on the write-time sync is the whole point of the
        // call — the user just ticked something off and is looking at a watch.
        .setUrgent()
    )

  /**
   * A data item is addressed `wear://<nodeId><path>`, and deleting takes a URI
   * rather than a path.
   *
   * The `*` authority is the documented wildcard for "every node". Naming this
   * node instead would leave the copy the watch is holding in place, which on
   * sign-out is the copy that matters — it is the one with the task list and the
   * token on it.
   */
  private fun anyNodeUri(path: String) =
    android.net.Uri.Builder().scheme("wear").authority("*").path(path).build()
}
