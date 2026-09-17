package expo.modules.dodonewear

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Hears the watch, and starts the JS that answers it.
 *
 * **This exists because the watch cannot refresh its own credentials.** It is
 * handed a Supabase access token with each snapshot, and that token lasts about
 * an hour. Rotating it needs the refresh token, and a refresh token can only be
 * spent once — a watch spending it would sign the phone out. So when the
 * watch's token has expired, the only way to get another is to wake the phone's
 * JS, which holds the session and refreshes it as a matter of course.
 *
 * It is also how a write reaches `TasksApi`. A message with a body carries one
 * write to apply before the snapshot is rebuilt, which is what lets a task
 * created by voice on the wrist go through `parseTaskInput` rather than landing
 * as a bare undated title.
 *
 * The system starts this service, so it runs with the app dead. That is the case
 * it is for.
 */
class WearSyncRequestService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != WearContract.PATH_REQUEST_SYNC) return

    val intent = Intent(this, WearSyncTaskService::class.java)
    // An empty body is a plain "send me a snapshot". Anything else is a write,
    // passed through verbatim: parsing it here would put a second opinion about
    // its shape in Kotlin, where the shape is decided in JS.
    if (event.data.isNotEmpty()) {
      intent.putExtra(WearSyncTaskService.EXTRA_WRITE, String(event.data, Charsets.UTF_8))
    }

    try {
      // Being started by a Data Layer callback puts the app in the platform's
      // temporary allowlist, which is what makes a background service start
      // legal here. Outside that window it throws, and there is nothing useful
      // to do about it: the watch keeps the snapshot it has, says how old it is,
      // and keeps the write queued to retry.
      startService(intent)
      HeadlessJsTaskService.acquireWakeLockNow(this)
    } catch (err: IllegalStateException) {
      // Background start refused. Swallowed rather than crashed: a failed
      // refresh must not take down the process that delivers notifications.
    }
  }
}
