package com.beamer408.dodone.wear.ui

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.beamer408.dodone.wear.MainActivity

/**
 * Where an outside tap lands.
 *
 * Four things open this app and they cannot all say so the same way. A
 * complication carries a `PendingIntent`, which takes a data URI. A tile carries
 * an `ActionBuilders.AndroidActivity`, which takes string extras and has nowhere
 * to put a URI at all. Rather than let each surface invent its own convention,
 * both are read here.
 */
object WearRoutes {
  const val SCHEME = "dodonewear"
  const val EXTRA_ROUTE = "dodone_route"

  const val TODAY = "list/today"
  const val UPCOMING = "list/upcoming"
  const val INBOX = "list/inbox"
  const val ADD = "add"

  fun task(id: String) = "task/$id"

  /**
   * The route an intent asks for, or [TODAY].
   *
   * An unrecognised route falls back rather than erroring. Every caller is ours,
   * so one this build does not know means the APK is older than whatever sent it
   * — and the useful answer to that is the list the user most likely wanted, not
   * a screen explaining a version mismatch to someone holding up their wrist.
   */
  fun from(intent: Intent?): String {
    intent?.getStringExtra(EXTRA_ROUTE)?.let { if (isKnown(it)) return it }
    val uri = intent?.data ?: return TODAY
    if (uri.scheme != SCHEME) return TODAY
    val route = when (uri.host) {
      "upcoming" -> UPCOMING
      "inbox" -> INBOX
      "add" -> ADD
      "task" -> uri.pathSegments.firstOrNull()?.let(::task) ?: TODAY
      else -> TODAY
    }
    return route
  }

  private fun isKnown(route: String) =
    route == TODAY || route == UPCOMING || route == INBOX || route == ADD ||
      route.startsWith("task/")

  /** For a complication's tap action. */
  fun pendingIntent(context: Context, route: String, requestId: Int): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      data = Uri.parse("$SCHEME://placeholder")
      putExtra(EXTRA_ROUTE, route)
      // A complication tap should land on a fresh screen rather than resuming
      // whatever the user last left open three days ago.
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(
      context,
      // Distinct per complication. `PendingIntent` matches on everything except
      // extras, so a shared request code would hand every slot on the watch face
      // whichever intent was registered first.
      requestId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
