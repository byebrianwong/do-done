package com.beamer408.dodone.wear.complication

import android.app.Service
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.MonochromaticImageComplicationData
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataTimeline
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingTimelineComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.TimeInterval
import androidx.wear.watchface.complications.datasource.TimelineEntry
import com.beamer408.dodone.wear.R
import com.beamer408.dodone.wear.data.SnapshotStore
import com.beamer408.dodone.wear.data.Validity
import com.beamer408.dodone.wear.data.WearCounts
import com.beamer408.dodone.wear.data.WearSnapshot
import com.beamer408.dodone.wear.ui.WearRoutes
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The five watch-face readings, and the one rule they share.
 *
 * **A complication is a few characters on someone else's layout.** The face
 * decides the size, the colour and whether the text is even shown, so each of
 * these picks one number and says it as briefly as it can. None of them fetches:
 * they read the cached snapshot, which is a `SharedPreferences` read, because a
 * watch face redraws on a schedule it owns and will not wait.
 *
 * They carry no update period either. `DataLayerListenerService` pushes an
 * update when a new snapshot lands, which is the only moment any of these can
 * have changed — a face polling DoDone every fifteen minutes would spend battery
 * to learn nothing.
 *
 * Five services rather than one offering five types, because a watch face slot
 * picks a *provider*. One provider would appear once in the face's picker and
 * choose for the user which reading they got.
 *
 * **Each answer is a timeline, because midnight pushes nothing.** Today's
 * reading runs until midnight, the phone's precomputed next day until the
 * midnight after, and then nothing. The face switches on its own clock. Drawn
 * with anything but today's view, a complication also asks the phone for a
 * fresh snapshot, which arrives through `DataLayerListenerService` like any
 * other.
 *
 * **"Nothing to show" is [NoDataComplicationData], never null.** A null answer
 * means "keep what you had", so returning one for a reading that has dropped to
 * nothing leaves the old value on the face: the overdue count stayed at "2"
 * after both tasks were done.
 */
abstract class DoDoneComplicationService : SuspendingTimelineComplicationDataSourceService() {
  // Not cancelled in onDestroy, for the reason TodayTileService gives.
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  /** Where a tap on this complication goes. */
  protected abstract val route: String

  /** Distinct per service; see `WearRoutes.pendingIntent`. */
  protected abstract val requestId: Int

  /**
   * Whether this reading describes a day. A button does not, so it stays on
   * the face when the snapshot is out of date.
   */
  protected open val describesTheDay: Boolean = true

  /** The reading, or null when there is nothing to show. */
  protected abstract fun data(counts: WearCounts, type: ComplicationType): ComplicationData?

  /** What the picker shows before the watch has any data. */
  protected abstract fun preview(type: ComplicationType): ComplicationData?

  override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationDataTimeline {
    val now = System.currentTimeMillis()
    val stored = SnapshotStore.stored(this)
    scope.launch {
      SnapshotStore.requestPhoneSyncIfStale(this@DoDoneComplicationService, stored.at(now), now)
    }

    val entries = stored.periodsFrom(now).map { period ->
      TimelineEntry(
        TimeInterval(Instant.ofEpochMilli(period.startMs), Instant.ofEpochMilli(period.endMs)),
        render(period.view, request.complicationType)
      )
    }
    // The entries cover every moment from zero on, so the default is never the
    // one drawn. It still has to exist, and the platform requires every entry
    // that has data to be the same type as the default. A NoData default would
    // reject an overdue count that only starts after midnight.
    val default = entries
      .map { it.complicationData }
      .firstOrNull { it !is NoDataComplicationData }
      ?: NoDataComplicationData()
    return ComplicationDataTimeline(default, entries)
  }

  private fun render(view: WearSnapshot, type: ComplicationType): ComplicationData {
    if (describesTheDay && view.validity == Validity.EXPIRED) return NoDataComplicationData()
    return data(view.counts, type) ?: NoDataComplicationData()
  }

  override fun getPreviewData(type: ComplicationType): ComplicationData? = preview(type)

  protected fun text(value: String, description: String) =
    PlainComplicationText.Builder(value).build().let { built ->
      built to PlainComplicationText.Builder(description).build()
    }

  protected fun shortText(value: String, description: String): ShortTextComplicationData {
    val (main, desc) = text(value, description)
    return ShortTextComplicationData.Builder(main, desc)
      .setTapAction(tap())
      .setMonochromaticImage(icon(R.drawable.ic_dodone))
      .build()
  }

  protected fun longText(value: String, description: String): LongTextComplicationData {
    val (main, desc) = text(value, description)
    return LongTextComplicationData.Builder(main, desc)
      .setTapAction(tap())
      .build()
  }

  protected fun icon(resId: Int): MonochromaticImage =
    MonochromaticImage.Builder(Icon.createWithResource(this, resId)).build()

  protected fun tap() = WearRoutes.pendingIntent(this, route, requestId)
}

/**
 * Every complication service, for the update requester.
 *
 * Listed here rather than discovered, so adding one and forgetting to refresh it
 * is a compile-time omission in one file rather than a complication that quietly
 * shows this morning's number all week.
 */
val COMPLICATION_SERVICES: List<Class<out Service>> = listOf(
  TodayProgressComplicationService::class.java,
  OpenTodayComplicationService::class.java,
  OverdueComplicationService::class.java,
  NextTaskComplicationService::class.java,
  AddTaskComplicationService::class.java
)

// ── The five ───────────────────────────────────────────────

/**
 * How much of today is done, as a ring.
 *
 * `RANGED_VALUE` because the question is a proportion and a ring is what carries
 * one. A day with nothing on it reports a full ring rather than an empty one:
 * nothing left to do is the finished state, and an empty ring at 6am on a clear
 * day reads as being behind.
 */
class TodayProgressComplicationService : DoDoneComplicationService() {
  override val route = WearRoutes.TODAY
  override val requestId = 1

  override fun data(counts: WearCounts, type: ComplicationType): ComplicationData? {
    val total = counts.totalToday
    return when (type) {
      ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(
        value = if (total == 0) 1f else counts.doneToday.toFloat(),
        min = 0f,
        max = if (total == 0) 1f else total.toFloat(),
        contentDescription = PlainComplicationText.Builder(
          if (total == 0) "Nothing on today" else "${counts.doneToday} of $total done today"
        ).build()
      )
        .setText(PlainComplicationText.Builder("${counts.doneToday}/$total").build())
        .setMonochromaticImage(icon(R.drawable.ic_dodone))
        .setTapAction(tap())
        .build()
      ComplicationType.SHORT_TEXT ->
        shortText("${counts.doneToday}/$total", "Done today")
      else -> null
    }
  }

  override fun preview(type: ComplicationType): ComplicationData? =
    data(WearCounts(openToday = 4, doneToday = 3, overdue = 0, nextTitle = ""), type)
}

/** How many are left today. The number most people want on a face. */
class OpenTodayComplicationService : DoDoneComplicationService() {
  override val route = WearRoutes.TODAY
  override val requestId = 2

  override fun data(counts: WearCounts, type: ComplicationType): ComplicationData? = when (type) {
    ComplicationType.SHORT_TEXT ->
      shortText(counts.openToday.toString(), "${counts.openToday} tasks today")
    ComplicationType.MONOCHROMATIC_IMAGE ->
      MonochromaticImageComplicationData.Builder(
        icon(R.drawable.ic_dodone),
        PlainComplicationText.Builder("Open DoDone").build()
      ).setTapAction(tap()).build()
    else -> null
  }

  override fun preview(type: ComplicationType): ComplicationData? =
    data(WearCounts(openToday = 5, doneToday = 2, overdue = 1, nextTitle = ""), type)
}

/**
 * How many are late.
 *
 * **Absent rather than zero when nothing is overdue.** An empty slot is the
 * honest rendering: a persistent "0" is a mark that appears on every ordinary
 * day, and a mark that appears everywhere carries no information. The base
 * class turns this null into [NoDataComplicationData], which is what actually
 * empties the slot.
 */
class OverdueComplicationService : DoDoneComplicationService() {
  override val route = WearRoutes.TODAY
  override val requestId = 3

  override fun data(counts: WearCounts, type: ComplicationType): ComplicationData? {
    if (counts.overdue == 0) return null
    return when (type) {
      ComplicationType.SHORT_TEXT ->
        shortText(counts.overdue.toString(), "${counts.overdue} overdue")
      else -> null
    }
  }

  override fun preview(type: ComplicationType): ComplicationData? =
    data(WearCounts(openToday = 5, doneToday = 0, overdue = 2, nextTitle = ""), type)
}

/**
 * The one task to do next — the same one the phone's Next up widget names, since
 * both read the head of the Today list.
 */
class NextTaskComplicationService : DoDoneComplicationService() {
  override val route = WearRoutes.TODAY
  override val requestId = 4

  override fun data(counts: WearCounts, type: ComplicationType): ComplicationData? {
    val title = counts.nextTitle
    return when (type) {
      ComplicationType.LONG_TEXT ->
        longText(title.ifEmpty { "Nothing on today" }, "Next task")
      // A short slot holds about seven characters, which is not a task title. It
      // gets the count instead of a title cut to "Call t…".
      ComplicationType.SHORT_TEXT ->
        shortText(counts.openToday.toString(), title.ifEmpty { "Nothing on today" })
      else -> null
    }
  }

  override fun preview(type: ComplicationType): ComplicationData? =
    data(WearCounts(openToday = 3, doneToday = 1, overdue = 0, nextTitle = "Call the bank"), type)
}

/**
 * A button, not a reading. It opens the composer straight into the input picker,
 * which is the whole of capture on a watch.
 */
class AddTaskComplicationService : DoDoneComplicationService() {
  override val route = WearRoutes.ADD
  override val requestId = 5
  override val describesTheDay = false

  override fun data(counts: WearCounts, type: ComplicationType): ComplicationData? = when (type) {
    ComplicationType.MONOCHROMATIC_IMAGE, ComplicationType.SMALL_IMAGE ->
      MonochromaticImageComplicationData.Builder(
        icon(R.drawable.ic_add),
        PlainComplicationText.Builder("Add a task").build()
      ).setTapAction(tap()).build()
    ComplicationType.SHORT_TEXT -> {
      val (main, desc) = text("Add", "Add a task")
      ShortTextComplicationData.Builder(main, desc)
        .setMonochromaticImage(icon(R.drawable.ic_add))
        .setTapAction(tap())
        .build()
    }
    else -> null
  }

  override fun preview(type: ComplicationType): ComplicationData? = data(WearCounts.EMPTY, type)
}
