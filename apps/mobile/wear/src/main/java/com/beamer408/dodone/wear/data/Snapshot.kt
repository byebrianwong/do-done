package com.beamer408.dodone.wear.data

import org.json.JSONObject

/**
 * What the phone sent, as this app's model of it.
 *
 * Every row arrives with its subline, gutter, ring colour and icon already
 * decided. **Nothing here recomputes any of that**, and nothing should start:
 * the rules live in `packages/shared/src/task-row.ts` and are the ones the app,
 * the widgets and the web row all draw from. A second implementation on the one
 * surface CI cannot render is exactly how a row comes to say two different
 * things about the same task.
 *
 * Parsing is by hand against `org.json` rather than through a serialization
 * library. Three reasons, in order: a missing field must degrade to a sensible
 * default rather than throw, because the phone can be running a newer bundle
 * than this APK; the payload is small enough that reflection buys nothing; and
 * it is one fewer Gradle plugin in a build nothing here can run.
 */
data class WearSnapshot(
  val version: Int,
  val generatedAt: Long,
  val lists: List<WearList>,
  val counts: WearCounts,
  /** The phone's local day `lists` and `counts` describe. Empty from an older phone bundle. */
  val day: String = "",
  /**
   * Epoch ms of the midnight that ends [day]. Past it, `lists` and `counts` are
   * yesterday's. Zero means the phone did not say, and the view never expires,
   * which is how this app behaved before the field existed.
   */
  val validUntil: Long = 0L,
  /** The same tasks as they read after midnight, built by the phone. See [at]. */
  val next: WearDayView? = null,
  /** Which of the views [at] picked. Never sent; always [Validity.CURRENT] as stored. */
  val validity: Validity = Validity.CURRENT
) {
  fun list(key: String): WearList? = lists.firstOrNull { it.key == key }

  /**
   * The view that is true at [nowMs].
   *
   * **The watch never re-derives a day on its own.** The phone sends today's
   * view and tomorrow's, each with the instant it stops being true, and this
   * only picks between them. Re-bucketing rows by date here would be a second
   * copy of the grouping rules in Kotlin, which this app avoids everywhere else.
   *
   * Past tomorrow's end there is nothing true left to show. The view is then
   * [Validity.EXPIRED]: the tile and the complications say so rather than show
   * a count from two days ago as if it were today's.
   */
  fun at(nowMs: Long): WearSnapshot {
    if (validUntil == 0L || nowMs < validUntil) return this
    val following = next
    if (following != null && nowMs < following.validUntil) {
      return copy(
        day = following.day,
        validUntil = following.validUntil,
        lists = following.lists,
        counts = following.counts,
        next = null,
        validity = Validity.NEXT_DAY
      )
    }
    val latest = following ?: WearDayView(day, validUntil, lists, counts)
    return copy(
      day = latest.day,
      validUntil = latest.validUntil,
      lists = latest.lists,
      counts = latest.counts,
      next = null,
      validity = Validity.EXPIRED
    )
  }

  /**
   * From [nowMs] on, one period per answer [at] gives: today until midnight,
   * tomorrow until the midnight after, then expired.
   *
   * The tile and the complications hand the system one timeline entry per
   * period, so the switch at midnight happens on the watch's own clock without
   * waking this app or the phone.
   *
   * The first period starts at zero rather than at [nowMs]. The system checks
   * entries against its own clock, read a moment after this one, and a first
   * entry starting in its future would leave nothing to draw for that moment.
   */
  fun periodsFrom(nowMs: Long): List<ViewPeriod> {
    val cuts = listOfNotNull(validUntil.takeIf { it > 0L }, next?.validUntil?.takeIf { it > 0L })
      .filter { it > nowMs }
      .distinct()
      .sorted()
    val out = mutableListOf<ViewPeriod>()
    var start = nowMs
    for (cut in cuts) {
      out += ViewPeriod(if (out.isEmpty()) 0L else start, cut, at(start))
      start = cut
    }
    out += ViewPeriod(if (out.isEmpty()) 0L else start, FOREVER_MS, at(start))
    return out
  }

  /** Every task id either view lists. */
  fun rowIds(): Set<String> =
    (lists + (next?.lists ?: emptyList()))
      .flatMap { it.groups }
      .flatMap { it.rows }
      .map { it.id }
      .toSet()

  companion object {
    val EMPTY = WearSnapshot(WearContract.SNAPSHOT_VERSION, 0L, emptyList(), WearCounts.EMPTY)

    /**
     * Far enough out to mean "from here on". Not `Long.MAX_VALUE`: the
     * platform converts these to seconds and compares them, and a value at the
     * edge of the type is one arithmetic step from overflowing.
     */
    const val FOREVER_MS = 4_102_444_800_000L // 2100-01-01

    /**
     * Returns null for anything this build cannot read — a bad payload, or a
     * version stamped above [WearContract.SNAPSHOT_VERSION]. The caller keeps
     * what it already had, which is a stale list rather than an empty one.
     */
    fun parse(json: String): WearSnapshot? = try {
      val root = JSONObject(json)
      val version = root.optInt("v", 0)
      if (version > WearContract.SNAPSHOT_VERSION) {
        null
      } else {
        WearSnapshot(
          version = version,
          generatedAt = root.optLong("generatedAt", 0L),
          lists = root.optJSONArray("lists").mapObjects { WearList.parse(it) },
          counts = WearCounts.parse(root.optJSONObject("counts")),
          day = root.optString("day"),
          validUntil = root.optLong("validUntil", 0L),
          next = root.optJSONObject("next")?.let { WearDayView.parse(it) }
        )
      }
    } catch (err: Exception) {
      null
    }
  }
}

/** A stretch of time and the view that is true during it. End is exclusive. */
data class ViewPeriod(val startMs: Long, val endMs: Long, val view: WearSnapshot)

/** Which view [WearSnapshot.at] picked. */
enum class Validity {
  /** The day the phone built the snapshot on. */
  CURRENT,

  /** The phone's precomputed view of the following day. */
  NEXT_DAY,

  /** Past both. Nothing in the snapshot describes today. */
  EXPIRED
}

/** One day's lists and counts. The phone sends today's and tomorrow's. */
data class WearDayView(
  val day: String,
  val validUntil: Long,
  val lists: List<WearList>,
  val counts: WearCounts
) {
  companion object {
    fun parse(o: JSONObject) = WearDayView(
      day = o.optString("day"),
      validUntil = o.optLong("validUntil", 0L),
      lists = o.optJSONArray("lists").mapObjects { WearList.parse(it) },
      counts = WearCounts.parse(o.optJSONObject("counts"))
    )
  }
}

data class WearList(
  val key: String,
  val title: String,
  val groups: List<WearGroup>
) {
  val rowCount: Int get() = groups.sumOf { it.rows.size }

  companion object {
    fun parse(o: JSONObject) = WearList(
      key = o.optString("key"),
      title = o.optString("title"),
      groups = o.optJSONArray("groups").mapObjects { WearGroup.parse(it) }
    )
  }
}

data class WearGroup(val title: String, val rows: List<WearRow>) {
  companion object {
    fun parse(o: JSONObject) = WearGroup(
      title = o.optString("title"),
      rows = o.optJSONArray("rows").mapObjects { WearRow.parse(it) }
    )
  }
}

data class WearRow(
  val id: String,
  val title: String,
  val subline: String,
  /** "overdue", "p1", "p2", "p3" or "" — see `rowGutter` in the shared package. */
  val gutter: String,
  /** `#rrggbb`. Always present: a project-less task gets a chosen neutral. */
  val ring: String,
  /** The project's emoji, or "". A Phosphor icon arrives as "" by design. */
  val icon: String
) {
  companion object {
    fun parse(o: JSONObject) = WearRow(
      id = o.optString("id"),
      title = o.optString("title"),
      subline = o.optString("subline"),
      gutter = o.optString("gutter"),
      ring = o.optString("ring", DEFAULT_RING),
      icon = o.optString("icon")
    )

    /** Matches `WidgetTheme.noProjectRing`, for a row that arrived without one. */
    const val DEFAULT_RING = "#94A3B8"
  }
}

data class WearCounts(
  val openToday: Int,
  val doneToday: Int,
  val overdue: Int,
  val nextTitle: String
) {
  /** Everything scheduled for today, done or not. The progress denominator. */
  val totalToday: Int get() = openToday + doneToday

  companion object {
    val EMPTY = WearCounts(0, 0, 0, "")

    fun parse(o: JSONObject?) = if (o == null) EMPTY else WearCounts(
      openToday = o.optInt("openToday"),
      doneToday = o.optInt("doneToday"),
      overdue = o.optInt("overdue"),
      nextTitle = o.optString("nextTitle")
    )
  }
}

/** The credentials the watch signs its own writes with. */
data class WearSession(
  val url: String,
  val anonKey: String,
  val accessToken: String,
  /** Epoch ms. */
  val expiresAt: Long,
  val userId: String
) {
  /**
   * A minute of headroom, so a write is not sent against a token that expires
   * while it is in flight. A 401 costs a round trip and a retry; declining early
   * costs nothing and lets the watch ask the phone instead.
   */
  fun usableAt(nowMs: Long): Boolean =
    url.isNotEmpty() && accessToken.isNotEmpty() && nowMs < expiresAt - 60_000L

  companion object {
    fun parse(json: String): WearSession? = try {
      val o = JSONObject(json)
      WearSession(
        url = o.optString("url").trimEnd('/'),
        anonKey = o.optString("anonKey"),
        accessToken = o.optString("accessToken"),
        expiresAt = o.optLong("expiresAt"),
        userId = o.optString("userId")
      )
    } catch (err: Exception) {
      null
    }
  }
}

private inline fun <T> org.json.JSONArray?.mapObjects(f: (JSONObject) -> T): List<T> {
  if (this == null) return emptyList()
  val out = ArrayList<T>(length())
  for (i in 0 until length()) {
    optJSONObject(i)?.let { out.add(f(it)) }
  }
  return out
}
