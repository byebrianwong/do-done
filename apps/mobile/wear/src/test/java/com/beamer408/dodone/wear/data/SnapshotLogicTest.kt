package com.beamer408.dodone.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure rules behind what the watch shows: which completion marks survive
 * a snapshot, and which day's view is true at a given moment.
 *
 * JVM tests, run with `./gradlew :wear:testDebugUnitTest` from the generated
 * `android/` project. CI has no Android SDK, so they run wherever the watch
 * app is built rather than on every push.
 */
class SnapshotLogicTest {

  // ── keptCompletionMarks ────────────────────────────────

  private val handedOff = 1_000_000L

  @Test
  fun `drops a mark once the snapshot no longer lists the task`() {
    val kept = keptCompletionMarks(
      marks = mapOf("a" to handedOff),
      listedIds = emptySet(),
      queuedIds = emptySet(),
      generatedAt = handedOff + 1
    )
    assertEquals(emptyMap<String, Long>(), kept)
  }

  @Test
  fun `keeps a mark whose write is still queued, however old the snapshot`() {
    val kept = keptCompletionMarks(
      marks = mapOf("a" to handedOff),
      listedIds = setOf("a"),
      queuedIds = setOf("a"),
      generatedAt = handedOff + 10 * LANDING_GRACE_MS
    )
    assertEquals(setOf("a"), kept.keys)
  }

  @Test
  fun `keeps a mark while the write may still be landing`() {
    val kept = keptCompletionMarks(
      marks = mapOf("a" to handedOff),
      listedIds = setOf("a"),
      queuedIds = emptySet(),
      generatedAt = handedOff + LANDING_GRACE_MS - 1
    )
    assertEquals(setOf("a"), kept.keys)
  }

  @Test
  fun `drops a mark when a later snapshot still lists the task`() {
    // The relay reached the phone but the write never landed. Before this
    // rule the row stayed hidden on the watch while the task stayed open.
    val kept = keptCompletionMarks(
      marks = mapOf("lost" to handedOff, "landing" to handedOff + LANDING_GRACE_MS),
      listedIds = setOf("lost", "landing"),
      queuedIds = emptySet(),
      generatedAt = handedOff + LANDING_GRACE_MS
    )
    assertEquals(setOf("landing"), kept.keys)
  }

  // ── WearSnapshot.at ────────────────────────────────────

  private fun row(id: String, gutter: String = "") =
    WearRow(id = id, title = id, subline = "", gutter = gutter, ring = "#000000", icon = "")

  private fun todayList(vararg groups: WearGroup) = WearList("today", "Today", groups.toList())

  private val midnight = 2_000_000L
  private val nextMidnight = midnight + 86_400_000L

  private val snapshot = WearSnapshot(
    version = 1,
    generatedAt = midnight - 3_600_000L,
    lists = listOf(todayList(WearGroup("Today", listOf(row("a"), row("b"))))),
    counts = WearCounts(openToday = 2, doneToday = 1, overdue = 0, nextTitle = "a"),
    day = "2026-10-05",
    validUntil = midnight,
    next = WearDayView(
      day = "2026-10-06",
      validUntil = nextMidnight,
      lists = listOf(
        todayList(
          WearGroup("Overdue", listOf(row("a", "overdue"), row("b", "overdue"))),
          WearGroup("Today", listOf(row("c")))
        )
      ),
      counts = WearCounts(openToday = 3, doneToday = 0, overdue = 2, nextTitle = "a")
    )
  )

  @Test
  fun `shows today's view until midnight`() {
    val view = snapshot.at(midnight - 1)
    assertEquals(Validity.CURRENT, view.validity)
    assertEquals("2026-10-05", view.day)
    assertEquals(2, view.counts.openToday)
  }

  @Test
  fun `switches to the phone's next day at midnight`() {
    val view = snapshot.at(midnight)
    assertEquals(Validity.NEXT_DAY, view.validity)
    assertEquals("2026-10-06", view.day)
    assertEquals(nextMidnight, view.validUntil)
    assertEquals(3, view.counts.openToday)
    assertEquals(2, view.counts.overdue)
    assertEquals(null, view.next)
  }

  @Test
  fun `expires past the end of the next day`() {
    assertEquals(Validity.EXPIRED, snapshot.at(nextMidnight).validity)
  }

  @Test
  fun `never expires a snapshot that does not say when it ends`() {
    // What an older phone bundle sends.
    val old = snapshot.copy(validUntil = 0L, next = null)
    assertEquals(Validity.CURRENT, old.at(Long.MAX_VALUE / 2).validity)
    assertEquals(
      listOf(ViewPeriod(0L, WearSnapshot.FOREVER_MS, old)),
      old.periodsFrom(midnight)
    )
  }

  @Test
  fun `hands out one period per day, starting from zero`() {
    val periods = snapshot.periodsFrom(midnight - 10)
    assertEquals(listOf(0L, midnight, nextMidnight), periods.map { it.startMs })
    assertEquals(listOf(midnight, nextMidnight, WearSnapshot.FOREVER_MS), periods.map { it.endMs })
    assertEquals(
      listOf(Validity.CURRENT, Validity.NEXT_DAY, Validity.EXPIRED),
      periods.map { it.view.validity }
    )
  }

  @Test
  fun `drops the periods that have already passed`() {
    val periods = snapshot.periodsFrom(midnight + 10)
    assertEquals(listOf(Validity.NEXT_DAY, Validity.EXPIRED), periods.map { it.view.validity })
    assertEquals(0L, periods.first().startMs)
  }

  // ── withoutLocallyCompleted ────────────────────────────

  @Test
  fun `hides a ticked task on both days and counts it done only today`() {
    val view = snapshot.withoutLocallyCompleted(setOf("a"))

    assertEquals(listOf("b"), view.lists.single().groups.flatMap { it.rows }.map { it.id })
    assertEquals(WearCounts(openToday = 1, doneToday = 2, overdue = 0, nextTitle = "b"), view.counts)

    val next = view.next!!
    assertEquals(listOf("b", "c"), next.lists.single().groups.flatMap { it.rows }.map { it.id })
    // Not overdue tomorrow any more, and not done tomorrow either.
    assertEquals(WearCounts(openToday = 2, doneToday = 0, overdue = 1, nextTitle = "b"), next.counts)
  }

  @Test
  fun `filters before choosing the day, so the switch keeps the tick`() {
    val view = snapshot.withoutLocallyCompleted(setOf("a")).at(midnight)
    assertTrue(view.lists.flatMap { it.groups }.flatMap { it.rows }.none { it.id == "a" })
  }
}
