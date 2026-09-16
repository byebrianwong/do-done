package expo.modules.listshortcuts

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Launcher shortcuts that open one shopping list.
 *
 * The five quick actions in `plugins/withAndroidShortcuts.js` are *static*
 * shortcuts, and a static shortcut's label has to be a string resource fixed at
 * build time — Android silently drops one whose label is a literal. A list's
 * title is the user's own text, so it cannot be one of those. That is the whole
 * reason this module exists: `ShortcutManagerCompat` is the only way to give a
 * launcher a label the app decides at runtime, and there is no JS API for it.
 *
 * Every decision about *which* lists get a shortcut, what each is called, and
 * which one occupies the long-press menu is made in JS
 * (`lib/list-shortcut-plan.ts`, node-tested). This file only carries them out,
 * so nothing here has to be re-derived to be checked.
 *
 * Generated nothing and bundled no resources on purpose: the icon is drawn with
 * Canvas primitives below, so there is no `R` class, no vector drawable, and no
 * second place for the shortcut's look to be defined.
 */
class ListShortcutsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    // Must match the string `modules/list-shortcuts/index.ts` asks for.
    // `modules/list-shortcuts/module.test.ts` asserts the two agree, because a
    // mismatch is a runtime throw on Android and nothing else.
    Name("DoDoneListShortcuts")

    AsyncFunction("isPinSupported") {
      ShortcutManagerCompat.isRequestPinShortcutSupported(context)
    }

    /**
     * Ask the system to drop one list's icon on the home screen.
     *
     * The boolean says the *request* was issued, never that the user accepted
     * it — the system's own dialog is what asks, and it reports nothing back.
     * So the caller must not claim the shortcut was added.
     */
    AsyncFunction("requestPin") { list: ListShortcutRecord ->
      ShortcutManagerCompat.requestPinShortcut(context, build(list), null)
    }

    AsyncFunction("sync") {
        lists: List<ListShortcutRecord>,
        dynamicId: String?,
        prefix: String,
        disabledMessage: String,
        prune: Boolean ->
      sync(lists, dynamicId, prefix, disabledMessage, prune)
    }
  }

  /**
   * Bring the launcher in line with the lists the app can currently see.
   *
   * Three writes, and each does something the other two cannot:
   *
   * - `updateShortcuts` reaches shortcuts that are already **pinned**, which is
   *   the only way a "Groceries" icon someone put on their home screen follows
   *   a rename. `setDynamicShortcuts` would leave it reading the old name
   *   forever.
   * - `setDynamicShortcuts` owns the single entry in the long-press menu.
   * - `disableShortcuts` is what a pinned icon for a deleted list needs.
   *   Removing it is not an option — the launcher owns a pinned shortcut and
   *   the app cannot take it back — so the honest end state is an icon that
   *   says why it no longer works.
   *
   * `prune` is false whenever the caller could not get a trustworthy read of
   * the user's lists: signed out, or a failed request. Without it a dropped
   * connection would read as "this account has no lists" and disable every
   * pinned icon on the home screen, which is exactly the failure the web app's
   * `read-result.ts` exists to prevent one layer up.
   */
  private fun sync(
    lists: List<ListShortcutRecord>,
    dynamicId: String?,
    prefix: String,
    disabledMessage: String,
    prune: Boolean
  ) {
    val infos = lists.map { build(it) }
    if (infos.isNotEmpty()) {
      ShortcutManagerCompat.updateShortcuts(context, infos)
    }

    // At most one, and empty is a real answer: no lists, or none remembered.
    ShortcutManagerCompat.setDynamicShortcuts(context, infos.filter { it.id == dynamicId })

    if (!prune) return

    val wanted = lists.map { it.id }.toSet()
    val ours = ShortcutManagerCompat
      .getShortcuts(
        context,
        ShortcutManagerCompat.FLAG_MATCH_PINNED or ShortcutManagerCompat.FLAG_MATCH_DYNAMIC
      )
      .filter { it.id.startsWith(prefix) }

    val gone = ours.map { it.id }.filterNot { wanted.contains(it) }
    if (gone.isNotEmpty()) {
      ShortcutManagerCompat.disableShortcuts(context, gone, disabledMessage)
    }

    // Re-enable anything a previous run disabled that is back — a list that
    // was hidden by a failed read before `prune` existed, or one restored on
    // another device. Enabling an already-enabled shortcut does nothing, and
    // these ids all came from `getShortcuts`, so none of them is unknown.
    val back = ours.filter { wanted.contains(it.id) }
    if (back.isNotEmpty()) {
      ShortcutManagerCompat.enableShortcuts(context, back)
    }
  }

  private fun build(list: ListShortcutRecord): ShortcutInfoCompat {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(list.url))

    // Explicit, like the static shortcuts: an implicit intent on a shortcut
    // never launches. The deep link rides along as the intent's data, which is
    // what expo-linking reads back through `getInitialURL`.
    //
    // Component and package are mutually exclusive — `Intent.setPackage` throws
    // once a component is set — so the package is only the fallback for a
    // device that somehow reports no launch activity.
    val component = context.packageManager
      .getLaunchIntentForPackage(context.packageName)
      ?.component
    if (component != null) {
      intent.component = component
    } else {
      intent.setPackage(context.packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    return ShortcutInfoCompat.Builder(context, list.id)
      .setShortLabel(list.shortLabel)
      .setLongLabel(list.longLabel)
      .setIcon(iconFor(list.color))
      .setIntent(intent)
      .build()
  }

  /**
   * The list's own colour, with a white list glyph on it.
   *
   * The colour is carried because it is what tells two pinned icons apart
   * before either label is read — the same job the ring does on a task row.
   * The list's *icon* (an emoji, or a `ph:` token) is deliberately not drawn:
   * deciding which of those a stored string is belongs to `parseProjectIcon`
   * in `@do-done/shared`, and a second implementation of that rule in Kotlin is
   * how a shortcut comes to draw the literal text `ph:cart:fill`.
   */
  private fun iconFor(colorHex: String): IconCompat {
    val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(parseColor(colorHex))

    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = Color.WHITE

    // An adaptive icon reserves the outer 18/108 of its canvas for whatever
    // mask the launcher applies, so nothing outside the middle two thirds is
    // safe. This box is half the canvas, comfortably inside that.
    val box = SIZE * 0.5f
    val originX = (SIZE - box) / 2f
    val originY = (SIZE - box) / 2f
    val rowHeight = box / ROWS
    val dotRadius = box * 0.075f
    val barHeight = box * 0.125f
    val barLeft = originX + box * 0.23f
    val barRight = originX + box

    for (row in 0 until ROWS) {
      val centreY = originY + rowHeight * (row + 0.5f)
      canvas.drawCircle(originX + dotRadius, centreY, dotRadius, paint)
      canvas.drawRoundRect(
        RectF(barLeft, centreY - barHeight / 2f, barRight, centreY + barHeight / 2f),
        barHeight / 2f,
        barHeight / 2f,
        paint
      )
    }

    return IconCompat.createWithAdaptiveBitmap(bitmap)
  }

  /**
   * A colour that will not parse falls back to the accent rather than failing
   * the shortcut. A wrong-coloured icon is a small thing; no icon at all is a
   * list the user cannot reach.
   */
  private fun parseColor(hex: String): Int = try {
    Color.parseColor(hex)
  } catch (e: IllegalArgumentException) {
    ACCENT
  }

  private companion object {
    /** Indigo-500, the app's accent — the same fallback the ring uses. */
    const val ACCENT = 0xFF6366F1.toInt()
    const val SIZE = 192
    const val ROWS = 3
  }
}

/**
 * One list's shortcut, decided entirely in JS. `id` is the *shortcut* id
 * (prefixed), not the list's uuid, so this file never has to know how the two
 * relate.
 */
class ListShortcutRecord : Record {
  @Field
  val id: String = ""

  @Field
  val shortLabel: String = ""

  @Field
  val longLabel: String = ""

  @Field
  val url: String = ""

  @Field
  val color: String = ""
}
