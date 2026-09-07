package com.beamer408.dodone.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.beamer408.dodone.wear.data.WearRow
import com.beamer408.dodone.wear.data.WearSnapshot
import java.time.LocalDate

/**
 * One task, and the four things a wrist can do to it.
 *
 * **Completing is the only filled button on the screen**, and it is first. Every
 * other control here is a reschedule, and rescheduling is what you do when the
 * answer is not "done" — so it should not compete for the same tap.
 *
 * There is no editor. Notes, subtasks, attachments, a project, a deadline and a
 * recurrence are all real and all unreachable from here, on purpose: a watch
 * screen cannot show them and a watch keyboard cannot fix them. The row's
 * subline says what the task is; the phone is where it gets changed.
 */
@Composable
fun TaskDetailScreen(
  snapshot: WearSnapshot,
  taskId: String,
  onDone: () -> Unit,
  onReschedule: (String) -> Unit
) {
  val listState = rememberScalingLazyListState()
  val row = snapshot.findRow(taskId)

  ScreenScaffold(scrollState = listState) {
    ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxWidth()) {
      if (row == null) {
        // The task left the snapshot while this screen was open — completed on
        // the phone, deleted, or rescheduled out of every list the watch holds.
        // Saying so beats a screen of buttons that would write to a row the user
        // is no longer looking at.
        item {
          Text(
            text = "This task is no longer on your lists",
            color = DoDoneMuted,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)
          )
        }
        return@ScalingLazyColumn
      }

      item {
        ListHeader {
          Text(text = row.title, textAlign = TextAlign.Center)
        }
      }

      if (row.subline.isNotEmpty()) {
        item {
          Text(
            text = row.subline,
            color = DoDoneMuted,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
          )
        }
      }

      item {
        Button(
          onClick = onDone,
          label = { Text("Done") },
          modifier = Modifier.fillMaxWidth()
        )
      }

      // The same three the phone's swipe panel and quick-schedule offer, minus
      // the ones that need a calendar. "This weekend" is deliberately absent: it
      // means different days to different people and there is no month grid here
      // to correct it with.
      for ((label, days) in QUICK_SCHEDULE) {
        item {
          FilledTonalButton(
            onClick = { onReschedule(LocalDate.now().plusDays(days).toString()) },
            label = { Text(label) },
            modifier = Modifier.fillMaxWidth()
          )
        }
      }
    }
  }
}

private val QUICK_SCHEDULE = listOf(
  "Today" to 0L,
  "Tomorrow" to 1L,
  "Next week" to 7L
)

private fun WearSnapshot.findRow(id: String): WearRow? =
  lists.asSequence()
    .flatMap { it.groups.asSequence() }
    .flatMap { it.rows.asSequence() }
    .firstOrNull { it.id == id }
