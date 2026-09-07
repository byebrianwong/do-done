package com.beamer408.dodone.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.beamer408.dodone.wear.data.SnapshotStore
import com.beamer408.dodone.wear.data.WearWriter
import com.beamer408.dodone.wear.ui.WearApp
import com.beamer408.dodone.wear.ui.WearRoutes
import kotlinx.coroutines.launch

/**
 * The watch app.
 *
 * **The first frame is drawn from disk, before anything is asked of the phone.**
 * A watch app is open for about four seconds; spending the first two on a Data
 * Layer round trip would mean the list arrives as the wrist drops. So
 * `SnapshotStore.hydrate` reads the cached snapshot synchronously, the UI draws
 * it, and the refresh below lands underneath. Same reasoning as
 * `lib/query-persist.ts` on the phone, for the same reason: an empty list is an
 * answer, and the app must not give it before it has one.
 */
class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    SnapshotStore.hydrate(this)

    setContent {
      WearApp(
        startRoute = WearRoutes.from(intent),
        onRefresh = ::refresh
      )
    }

    refresh()
  }

  override fun onResume() {
    super.onResume()
    // Coming back from the input picker or a long screen-off is the same case
    // as opening: whatever the phone did meanwhile has not been heard about.
    refresh()
  }

  private fun refresh() {
    lifecycleScope.launch {
      // Re-read first: the listener service covers changes while we were alive,
      // and this covers the ones that landed while we were not.
      SnapshotStore.refreshFromDataLayer(this@MainActivity)
      // Then push anything queued, then ask for a fresh snapshot and token. In
      // that order — a flush that goes out before the re-read can be sending a
      // write the phone has already applied.
      WearWriter.flush(this@MainActivity)
      SnapshotStore.requestPhoneSync(this@MainActivity)
    }
  }
}
