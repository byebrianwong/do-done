package expo.modules.dodonewear

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the `DoDoneWearSync` JS task, which applies any write the watch sent and
 * hands a fresh snapshot back to [DoDoneWearModule].
 *
 * Registered in `index.js` at bundle evaluation, for the same reason the widget
 * handler and the geofence task are: this starts the runtime with no activity
 * and no React tree, so anything registered from a component has not run yet and
 * the task key is simply unknown.
 */
class WearSyncTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    val data = Arguments.createMap()
    intent?.getStringExtra(EXTRA_WRITE)?.let { data.putString("write", it) }
    return HeadlessJsTaskConfig(
      WearContract.HEADLESS_TASK,
      data,
      TIMEOUT_MS,
      // Allowed in the foreground too. The watch sends the same message whether
      // the phone is awake or not, and refusing it while the app is open would
      // make the wrist stale in exactly the case the phone could answer fastest.
      true
    )
  }

  companion object {
    const val EXTRA_WRITE = "dodone_wear_write"

    /**
     * Long enough for a token refresh, one write and one task read on a bad
     * connection. The task resolves as soon as the put lands, so this is a
     * ceiling rather than a wait.
     */
    private const val TIMEOUT_MS = 30_000L
  }
}
