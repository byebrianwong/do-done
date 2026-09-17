package com.beamer408.dodone.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.beamer408.dodone.wear.data.WearRow

/**
 * One task, drawn the way the phone's row is: a ring for the project, a gutter
 * for urgency, and one muted line for everything else.
 *
 * **Every string here arrived precomputed.** Nothing in this file decides what a
 * task says — see `apps/mobile/lib/wear-snapshot.ts`.
 *
 * The one deliberate divergence from the phone: **the whole row opens the task,
 * and nothing on it completes.** On the phone the ring is the tick target and the
 * words open the editor. A 24dp ring on a 45mm watch is under every touch
 * minimum there is, and the two targets would be four millimetres apart on a
 * screen operated by a fingertip while walking. So completing is the first
 * button on the screen the row opens, one tap further on and impossible to hit
 * by accident.
 */
@Composable
fun TaskRow(row: WearRow, onClick: () -> Unit, modifier: Modifier = Modifier) {
  Button(
    onClick = onClick,
    modifier = modifier,
    colors = ButtonDefaults.filledTonalButtonColors(),
    icon = { RowRing(row) },
    label = {
      Text(
        text = row.title,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        style = MaterialTheme.typography.bodyMedium
      )
    },
    secondaryLabel = if (row.subline.isEmpty()) null else {
      {
        Text(
          text = row.subline,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          color = DoDoneMuted,
          style = MaterialTheme.typography.bodySmall
        )
      }
    }
  )
}

/**
 * The two coloured slots, side by side in the button's icon area.
 *
 * The gutter keeps the shape it has on the phone — a dot for overdue, a bar
 * whose length falls with the rank — because length is what carries an ordinal
 * variable. A row with neither still reserves the 3dp, so the rings stay in one
 * column down the list instead of stepping in and out by row.
 */
@Composable
private fun RowRing(row: WearRow) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Box(modifier = Modifier.width(3.dp).height(GUTTER_MAX), contentAlignment = Alignment.Center) {
      Gutter(row.gutter)
    }
    Spacer(modifier = Modifier.width(4.dp))
    Box(
      modifier = Modifier
        .size(20.dp)
        .clip(CircleShape)
        .background(parseRing(row.ring)),
      contentAlignment = Alignment.Center
    ) {
      if (row.icon.isNotEmpty()) {
        // The project's emoji. A Phosphor icon arrives empty and leaves a bare
        // coloured ring, which is a state the design already has a name for.
        Text(text = row.icon, style = MaterialTheme.typography.labelSmall)
      }
    }
  }
}

private val GUTTER_MAX = 18.dp

@Composable
private fun Gutter(gutter: String) {
  val color = gutterColor(gutter) ?: return
  val height = when (gutter) {
    // A dot, not a bar. Being late is a different kind of thing from being
    // ranked, so it is the one mark here that does not encode by length.
    "overdue" -> 3.dp
    "p1" -> GUTTER_MAX
    "p2" -> 12.dp
    else -> 7.dp
  }
  Box(
    modifier = Modifier
      .width(3.dp)
      .height(height)
      .clip(RoundedCornerShape(2.dp))
      .background(color)
  )
}
