package com.beamer408.dodone.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Chip
import androidx.wear.protolayout.material.ChipColors
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.beamer408.dodone.wear.data.SnapshotStore
import com.beamer408.dodone.wear.data.WearRow
import com.beamer408.dodone.wear.data.WearSnapshot
import com.beamer408.dodone.wear.ui.WearRoutes
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The Today tile: what is left today, and a way to add.
 *
 * **It draws from the cached snapshot and never waits.** A tile is rendered
 * while the user's wrist is already turning toward it, and the platform will
 * show whatever was last returned if this takes too long. `SnapshotStore.cached`
 * is a `SharedPreferences` read, so the answer is immediate and the same one the
 * app would give.
 *
 * It carries **no refresh interval of its own** (`freshnessIntervalMillis` is
 * left at zero). A tile that polls every fifteen minutes would spend battery to
 * find nothing changed nine times out of ten; instead `DataLayerListenerService`
 * pushes an update at the only moment anything can have changed, which is when
 * the phone sends a new snapshot.
 */
class TodayTileService : TileService() {

  override fun onTileRequest(
    requestParams: RequestBuilders.TileRequest
  ): ListenableFuture<TileBuilders.Tile> {
    val snapshot = SnapshotStore.cached(this)
    val layout = layout(snapshot, requestParams.deviceConfiguration)

    return Futures.immediateFuture(
      TileBuilders.Tile.Builder()
        .setResourcesVersion(RESOURCES_VERSION)
        .setTileTimeline(
          TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(
              TimelineBuilders.TimelineEntry.Builder()
                .setLayout(LayoutElementBuilders.Layout.Builder().setRoot(layout).build())
                .build()
            )
            .build()
        )
        .build()
    )
  }

  override fun onTileResourcesRequest(
    requestParams: RequestBuilders.ResourcesRequest
  ): ListenableFuture<ResourceBuilders.Resources> =
    Futures.immediateFuture(
      ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
    )

  private fun layout(
    snapshot: WearSnapshot,
    device: DeviceParameters
  ): LayoutElementBuilders.LayoutElement {
    val rows = snapshot.list("today")
      ?.groups
      ?.flatMap { it.rows }
      .orEmpty()

    val content = LayoutElementBuilders.Column.Builder()
    if (rows.isEmpty()) {
      content.addContent(
        Text.Builder(this, emptyMessage(snapshot))
          .setTypography(Typography.TYPOGRAPHY_BODY2)
          .setColor(argb(MUTED))
          .setMaxLines(2)
          .build()
      )
    } else {
      // Three, because a tile is one glance. A fourth would fit on a large watch
      // and be cut off on a small one, and a tile that says a different number
      // of things per device is one nobody can rely on.
      for (row in rows.take(MAX_ROWS)) {
        content.addContent(taskChip(row, device))
      }
    }

    return PrimaryLayout.Builder(device)
      .setPrimaryLabelTextContent(
        Text.Builder(this, "TODAY")
          .setTypography(Typography.TYPOGRAPHY_CAPTION1)
          .setColor(argb(ACCENT))
          .build()
      )
      .setContent(content.build())
      .setSecondaryLabelTextContent(
        Text.Builder(this, summary(snapshot, rows.size))
          .setTypography(Typography.TYPOGRAPHY_CAPTION2)
          .setColor(argb(MUTED))
          .build()
      )
      .setPrimaryChipContent(
        CompactChip.Builder(this, "Add", launch(WearRoutes.ADD), device)
          .setChipColors(ChipColors.primaryChipColors(TILE_COLORS))
          .build()
      )
      .build()
  }

  private fun taskChip(row: WearRow, device: DeviceParameters): LayoutElementBuilders.LayoutElement =
    Chip.Builder(this, launch(WearRoutes.task(row.id)), device)
      .setPrimaryLabelContent(row.title)
      .setChipColors(ChipColors.secondaryChipColors(TILE_COLORS))
      .setWidth(device.screenWidthDp * CHIP_WIDTH_FRACTION)
      .build()

  /**
   * A tile action names an activity and carries extras. It has nowhere to put a
   * data URI, which is why `WearRoutes` reads both that and this extra.
   */
  private fun launch(route: String) = ModifiersBuilders.Clickable.Builder()
    .setId(route)
    .setOnClick(
      ActionBuilders.LaunchAction.Builder()
        .setAndroidActivity(
          ActionBuilders.AndroidActivity.Builder()
            .setPackageName(packageName)
            .setClassName("com.beamer408.dodone.wear.MainActivity")
            .addKeyToExtraMapping(
              WearRoutes.EXTRA_ROUTE,
              ActionBuilders.AndroidStringExtra.Builder().setValue(route).build()
            )
            .build()
        )
        .build()
    )
    .build()

  /**
   * The line under the rows. Overdue first when there is any, because it is the
   * one number here that changes what you would do next.
   */
  private fun summary(snapshot: WearSnapshot, shown: Int): String {
    val counts = snapshot.counts
    val parts = mutableListOf<String>()
    if (counts.overdue > 0) parts.add("${counts.overdue} overdue")
    val hidden = counts.openToday - shown
    if (hidden > 0) parts.add("+$hidden more")
    if (counts.doneToday > 0) parts.add("${counts.doneToday} done")
    return parts.joinToString(" · ")
  }

  /**
   * A watch that has never been paired and a day that is genuinely clear look
   * the same from here, so they are worded apart — the same rule the app's list
   * screen follows.
   */
  private fun emptyMessage(snapshot: WearSnapshot): String =
    if (snapshot.generatedAt == 0L) "Open DoDone on your phone" else "Nothing on today"

  private companion object {
    /**
     * Bumped when a tile resource changes. Nothing is registered today — the
     * tile draws text and chips only — so it stays at 1 and the platform caches
     * an empty resource set.
     */
    const val RESOURCES_VERSION = "1"

    const val MAX_ROWS = 3

    /** Chips sit inside the layout's own margins rather than at full width. */
    const val CHIP_WIDTH_FRACTION = 0.84f

    const val ACCENT = 0xFF818CF8.toInt()
    const val MUTED = 0xFFB6BCC8.toInt()

    val TILE_COLORS = androidx.wear.protolayout.material.Colors(
      /* primary = */ ACCENT,
      /* onPrimary = */ 0xFF11131A.toInt(),
      /* surface = */ 0xFF16181F.toInt(),
      /* onSurface = */ 0xFFF3F4F6.toInt()
    )
  }
}
