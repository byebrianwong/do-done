package com.beamer408.dodone.wear.data

/**
 * The names the phone and the watch both have to know.
 *
 * The other copy is
 * `modules/dodone-wear/android/src/main/java/expo/modules/dodonewear/WearContract.kt`.
 * Two copies because the phone module and this one are separate Gradle modules
 * with no shared source set, and a third module for six strings would be a
 * module nothing in this repo can compile either.
 *
 * `plugins/withWearApp.test.ts` asserts the two agree. Every way they can
 * disagree is silent on the device: a path typo leaves this app listening on a
 * channel nothing writes to, showing an empty list forever.
 */
object WearContract {
  const val PATH_SNAPSHOT = "/dodone/snapshot"
  const val PATH_SESSION = "/dodone/session"
  /**
   * Message the watch sends to ask the phone for a fresh snapshot.
   *
   * The body decides what it means. Empty asks for a snapshot and nothing else.
   * A JSON body is a write to apply first — `{ op, taskId, value }`, the shape
   * `PendingWrites.Entry` serialises — and the snapshot that follows is what
   * tells the watch it landed.
   *
   * One path rather than two because the answer is the same either way: a fresh
   * snapshot. A second path would need a second manifest filter and a second
   * service, to end in the same place.
   */
  const val PATH_REQUEST_SYNC = "/dodone/request-sync"
  const val KEY_JSON = "json"
  const val CAPABILITY_WATCH_APP = "dodone_wear_app"
  const val HEADLESS_TASK = "DoDoneWearSync"

  /**
   * The snapshot shape this build can read. A snapshot stamped higher is
   * dropped rather than half-parsed, and the last readable one is kept.
   *
   * This matters more here than it looks. The phone's bundle ships over OTA and
   * this APK does not, so a phone running ahead of the watch is the ordinary
   * state after every JS release.
   */
  const val SNAPSHOT_VERSION = 1
}
