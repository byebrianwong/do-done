package com.beamer408.dodone.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/**
 * The watch's palette.
 *
 * **Dark, where the phone app is light-only.** That is not drift. The phone's
 * decision (CLAUDE.md, "The app is light-only") is about a screen held in a lit
 * room for minutes at a time; a watch screen is OLED, glanced at for two seconds,
 * and often in the dark. A white card on a wrist at night is the one thing every
 * Wear OS design guide agrees not to draw.
 *
 * The accent is the app's indigo lifted one step. `indigo-500` on black measures
 * about 3.4:1, which is under the bar for the small text a watch uses; the
 * `indigo-400` here measures 6.5:1 and still reads as the same colour beside the
 * phone.
 */
val DoDoneAccent = Color(0xFF818CF8)
val DoDoneBackground = Color(0xFF000000)

/** A row's surface. Not pure black, so a row has an edge against the ground. */
val DoDoneSurface = Color(0xFF16181F)

val DoDoneOnSurface = Color(0xFFF3F4F6)

/**
 * The subline, and any secondary line. `#9CA3AF` — what the phone's row uses —
 * measures 3.2:1 on black; this is 6.9:1. A watch subline is 12sp and read at
 * arm's length in whatever light there is.
 */
val DoDoneMuted = Color(0xFFB6BCC8)

/** The gutter marks, matching `rowGutter`'s four states. */
val DoDoneOverdue = Color(0xFFF87171)
val DoDoneP1 = Color(0xFFFB7185)
val DoDoneP2 = Color(0xFFFBBF24)

/** Cool, so it reads as ranked rather than urgent — as on the phone's row. */
val DoDoneP3 = Color(0xFF94A3B8)

@Composable
fun DoDoneWearTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = ColorScheme(
      primary = DoDoneAccent,
      onPrimary = Color(0xFF11131A),
      surfaceContainer = DoDoneSurface,
      surfaceContainerLow = DoDoneSurface,
      onSurface = DoDoneOnSurface,
      onSurfaceVariant = DoDoneMuted,
      background = DoDoneBackground,
      onBackground = DoDoneOnSurface,
      error = DoDoneOverdue
    ),
    content = content
  )
}

/**
 * The colour a row's gutter draws, or null for a row that draws none.
 *
 * P4 returning null is the rule, not an omission: `tasks.priority` defaults to
 * `p4`, so a mark there would be a mark for "nobody triaged this" on nearly
 * every row. The reasoning is written out on `rowGutter` in the shared package;
 * this only has to agree with the strings it produces.
 */
fun gutterColor(gutter: String): Color? = when (gutter) {
  "overdue" -> DoDoneOverdue
  "p1" -> DoDoneP1
  "p2" -> DoDoneP2
  "p3" -> DoDoneP3
  else -> null
}

/** A `#rrggbb` from the snapshot, or the neutral if it is not one. */
fun parseRing(hex: String): Color = try {
  Color(android.graphics.Color.parseColor(hex))
} catch (err: IllegalArgumentException) {
  Color(0xFF94A3B8)
}
