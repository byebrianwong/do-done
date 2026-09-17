package com.beamer408.dodone.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.beamer408.dodone.wear.data.WearSnapshot

/**
 * One of the three lists.
 *
 * The order down the screen is deliberate: **Add first, then the tasks, then the
 * other lists.** Adding is the action a watch is best at and the one a user
 * arrives with in mind, so it sits where the thumb lands. Switching lists is the
 * rarest thing here and goes at the bottom, which on a round screen is also
 * where a footer chip reads most comfortably.
 */
@Composable
fun TaskListScreen(
  snapshot: WearSnapshot,
  listKey: String,
  onOpenTask: (String) -> Unit,
  onOpenList: (String) -> Unit,
  onAdd: () -> Unit,
  onRefresh: () -> Unit
) {
  val listState = rememberScalingLazyListState()
  val list = snapshot.list(listKey)
  val title = list?.title ?: listKey.replaceFirstChar { it.uppercase() }

  ScreenScaffold(scrollState = listState) {
    ScalingLazyColumn(
      state = listState,
      modifier = Modifier.fillMaxWidth()
    ) {
      item { ListHeader { Text(title) } }

      item {
        CompactButton(
          onClick = onAdd,
          label = { Text("Add a task") },
          modifier = Modifier.fillMaxWidth()
        )
      }

      if (list == null || list.rowCount == 0) {
        item { EmptyState(listKey = listKey, snapshot = snapshot, onRefresh = onRefresh) }
      } else {
        for (group in list.groups) {
          // The Inbox arrives as one group with no title, because there is no
          // axis to head it with — see `buildInboxGroups`. An empty header would
          // be a line of screen spent saying nothing.
          if (group.title.isNotEmpty()) {
            item { ListHeader { Text(group.title) } }
          }
          items(group.rows) { row ->
            TaskRow(
              row = row,
              onClick = { onOpenTask(row.id) },
              modifier = Modifier.fillMaxWidth()
            )
          }
        }
      }

      // The other two lists, named. A cycling button would fit one slot instead
      // of two, but it would also mean the user cannot see where the second tap
      // goes — and on a watch, a control you have to try to understand has
      // already cost more than the space it saved.
      for (other in OTHER_LISTS.getValue(listKey)) {
        item {
          FilledTonalButton(
            onClick = { onOpenList(other) },
            label = { Text(LIST_TITLES.getValue(other)) },
            modifier = Modifier.fillMaxWidth()
          )
        }
      }

      item { Freshness(snapshot) }
    }
  }
}

/**
 * "Nothing scheduled" is an answer, and this screen must not give it before it
 * has one.
 *
 * A watch that has never been paired and a watch whose day really is clear look
 * identical from here, so the two are worded apart: a snapshot that has never
 * arrived (`generatedAt == 0`) says so and points at the phone.
 */
@Composable
private fun EmptyState(listKey: String, snapshot: WearSnapshot, onRefresh: () -> Unit) {
  if (snapshot.generatedAt == 0L) {
    FilledTonalButton(
      onClick = onRefresh,
      label = { Text("Open DoDone on your phone") },
      secondaryLabel = { Text("Then tap to try again", color = DoDoneMuted) },
      modifier = Modifier.fillMaxWidth()
    )
    return
  }
  Text(
    text = when (listKey) {
      "inbox" -> "Nothing to triage"
      "upcoming" -> "Nothing coming up"
      else -> "Nothing on today"
    },
    color = DoDoneMuted,
    textAlign = TextAlign.Center,
    style = MaterialTheme.typography.bodyMedium,
    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
  )
}

/**
 * How old the list is.
 *
 * Drawn always, not only when stale. The watch cannot fetch for itself, so
 * everything on this screen is as old as the phone's last sync, and a list that
 * only admits its age past some threshold is one the user has no reason to trust
 * below it.
 */
@Composable
private fun Freshness(snapshot: WearSnapshot) {
  if (snapshot.generatedAt == 0L) return
  Text(
    text = "Updated ${relativeAge(System.currentTimeMillis() - snapshot.generatedAt)}",
    color = DoDoneMuted,
    textAlign = TextAlign.Center,
    style = MaterialTheme.typography.labelSmall,
    modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp)
  )
}

/**
 * A coarse age. Minutes for the first hour, then hours, then days.
 *
 * Deliberately vague past an hour: the exact minute a snapshot was built is not
 * something anyone acts on, and precision here would read as a claim about how
 * fresh the data is.
 */
internal fun relativeAge(ageMs: Long): String {
  val minutes = ageMs / 60_000
  return when {
    minutes < 1 -> "just now"
    minutes < 60 -> "${minutes}m ago"
    minutes < 60 * 24 -> "${minutes / 60}h ago"
    else -> "${minutes / (60 * 24)}d ago"
  }
}

private val LIST_TITLES = mapOf(
  "today" to "Today",
  "upcoming" to "Upcoming",
  "inbox" to "Inbox"
)

private val OTHER_LISTS = mapOf(
  "today" to listOf("upcoming", "inbox"),
  "upcoming" to listOf("today", "inbox"),
  "inbox" to listOf("today", "upcoming")
)
