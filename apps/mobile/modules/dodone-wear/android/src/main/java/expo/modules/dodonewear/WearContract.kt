package expo.modules.dodonewear

/**
 * The names the phone and the watch both have to know.
 *
 * There are two copies of this file — this one and
 * `wear/src/main/java/com/beamer408/dodone/wear/data/WearContract.kt` — because
 * the phone module and the watch app are separate Gradle modules with no shared
 * source set, and adding one for six strings would mean a third module in a
 * build nothing here can compile.
 *
 * `plugins/withWearApp.test.ts` asserts the two copies agree. Every way they
 * can disagree is silent on the device: a path typo means the watch listens on
 * a channel nothing writes to, and shows an empty list forever.
 */
object WearContract {
  /** DataItem carrying the presentation-ready task lists and counts. */
  const val PATH_SNAPSHOT = "/dodone/snapshot"

  /** DataItem carrying the Supabase credentials the watch writes with. */
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

  /** The single DataMap key inside each of the two data items. */
  const val KEY_JSON = "json"

  /**
   * Declared by the watch app in `res/values/wear.xml`. The phone asks for it
   * to answer "is there a watch with DoDone on it", which is the only thing
   * that makes the Settings row worth showing.
   */
  const val CAPABILITY_WATCH_APP = "dodone_wear_app"

  /** The headless JS task `index.js` registers to build a fresh snapshot. */
  const val HEADLESS_TASK = "DoDoneWearSync"
}
