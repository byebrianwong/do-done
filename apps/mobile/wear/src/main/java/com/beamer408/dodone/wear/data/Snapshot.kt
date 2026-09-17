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
  val counts: WearCounts
) {
  fun list(key: String): WearList? = lists.firstOrNull { it.key == key }

  companion object {
    val EMPTY = WearSnapshot(WearContract.SNAPSHOT_VERSION, 0L, emptyList(), WearCounts.EMPTY)

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
          counts = WearCounts.parse(root.optJSONObject("counts"))
        )
      }
    } catch (err: Exception) {
      null
    }
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
