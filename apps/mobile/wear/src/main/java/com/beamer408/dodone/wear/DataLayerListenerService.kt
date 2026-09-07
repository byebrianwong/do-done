package com.beamer408.dodone.wear

import android.content.ComponentName
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.beamer408.dodone.wear.complication.COMPLICATION_SERVICES
import com.beamer408.dodone.wear.data.SnapshotStore
import com.beamer408.dodone.wear.data.WearContract
import com.beamer408.dodone.wear.data.WearWriter
import com.beamer408.dodone.wear.tile.TodayTileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The phone's snapshot arriving.
 *
 * This is the only thing on the watch that ever *receives*, and it has to do
 * three things every time: store what came, tell the tile and the five
 * complications, and flush anything queued — because a data item arriving is
 * proof the phone is in range, which is the one condition the queue is waiting
 * on.
 *
 * Started by the system, so it runs with the app closed. That is the ordinary
 * case: the snapshot is what a tile and a watch face draw, and neither of those
 * involves opening the app.
 */
class DataLayerListenerService : WearableListenerService() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onDataChanged(events: DataEventBuffer) {
    var changed = false

    for (event in events) {
      val path = event.dataItem.uri.path ?: continue
      when (event.type) {
        DataEvent.TYPE_CHANGED -> {
          val json = DataMapItem.fromDataItem(event.dataItem)
            .dataMap.getString(WearContract.KEY_JSON) ?: continue
          when (path) {
            WearContract.PATH_SNAPSHOT -> {
              SnapshotStore.storeSnapshot(this, json)
              changed = true
            }
            WearContract.PATH_SESSION -> SnapshotStore.storeSession(this, json)
          }
        }
        DataEvent.TYPE_DELETED -> {
          // The phone deletes both items on sign-out. Anything less than
          // clearing would leave the previous account's day on a wrist someone
          // else can pick up, and the access token beside it.
          if (path == WearContract.PATH_SNAPSHOT || path == WearContract.PATH_SESSION) {
            SnapshotStore.clear(this)
            changed = true
          }
        }
      }
    }

    if (changed) redrawGlanceableSurfaces()

    // Queued writes go out on the same signal. Not tied to `changed`: a session
    // arriving on its own is a fresh token, which is exactly what a write that
    // failed on an expired one was waiting for.
    scope.launch { WearWriter.flush(this@DataLayerListenerService) }
  }

  /**
   * Nudge the tile and the complications.
   *
   * Both have `UPDATE_PERIOD_SECONDS` / no refresh interval of their own, on
   * purpose: a watch face polling DoDone every fifteen minutes would spend
   * battery to find nothing changed nine times out of ten. They are pushed
   * instead, from here, which is the only moment anything can have changed.
   */
  private fun redrawGlanceableSurfaces() {
    TileService.getUpdater(this).requestUpdate(TodayTileService::class.java)
    for (service in COMPLICATION_SERVICES) {
      ComplicationDataSourceUpdateRequester
        .create(this, ComponentName(this, service))
        .requestUpdateAll()
    }
  }
}
