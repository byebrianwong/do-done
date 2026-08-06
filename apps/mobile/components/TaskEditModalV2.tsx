/**
 * Mobile task edit modal V2 — round-7 design.
 * See docs/task-input-design/round7-mobile.html for the visual reference.
 *
 * Mirrors apps/web/src/components/task-edit-modal-v2.tsx but uses React
 * Native primitives. The autosave hook (useAutoSaveTask from
 * @do-done/api-client) is shared between web and mobile, so behavior is
 * identical.
 *
 * Calendar events (hollow dots in the web modal) are not fetched on
 * mobile — that requires a server-side gcal proxy and is deferred.
 * Mobile busyness shows tasks only.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Dimensions,
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  STATUS_ORDER,
  datesBetweenLocalISO,
  formatFullDate,
  formatRelativeDay,
  formatScheduleHint,
  formatTimeOfDay,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@do-done/shared";
import {
  useAutoSaveTask,
  BusynessApi,
  type DayBusyness,
  type SaveStatus,
  type TasksApi,
} from "@do-done/api-client";
import { supabase } from "@/lib/supabase";
import { createProject, invalidateTasks, useProjects } from "@/lib/task-queries";
import {
  useTaskLocations,
  type TaskLocationLink,
} from "@/lib/location-queries";
import { ProjectPickerSheet } from "./ProjectPickerSheet";
import { LocationReminderSheet } from "./LocationReminderSheet";
import { LinkifiedText } from "./LinkifiedText";
import { AttachmentsSection } from "./TaskAttachments";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

// ─── Constants ──────────────────────────────────────────────

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  p1: "#ef4444",
  p2: "#f59e0b",
  p3: "#6366f1",
  p4: "#9ca3af",
};

export const ESTIMATE_BUCKETS = [30, 60, 120, 240, 480, 960];

export function estimateBarIndex(minutes: number | null): number {
  if (!minutes) return -1;
  if (minutes <= 30) return 0;
  if (minutes <= 60) return 1;
  if (minutes <= 120) return 2;
  if (minutes <= 240) return 3;
  if (minutes <= 480) return 4;
  return 5;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// n can be negative to step backward. Always lands on the 1st.
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// A 6-week (42-cell) grid covering `viewMonth`, padded with the tail of the
// previous month and the head of the next so every row is full. `outside`
// flags days that spill over from the adjacent months.
function monthGridRows(
  viewMonth: Date
): { date: string; weekday: number; outside: boolean }[][] {
  const first = startOfMonth(viewMonth);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - first.getDay());
  const rows: { date: string; weekday: number; outside: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: { date: string; weekday: number; outside: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + w * 7 + i);
      row.push({
        date: ymd(d),
        weekday: i,
        outside: d.getMonth() !== viewMonth.getMonth(),
      });
    }
    rows.push(row);
  }
  return rows;
}

function dotWidth(minutes: number): number {
  if (minutes <= 30) return 3;
  if (minutes <= 60) return 5;
  if (minutes <= 120) return 8;
  if (minutes <= 240) return 12;
  return 17;
}

// Extract whitespace-terminated `#tag` tokens from text. Partial (unterminated)
// `#word` is left alone so the user can keep typing.
export function extractCompletedTags(text: string): {
  stripped: string;
  tags: string[];
} {
  const tags: string[] = [];
  const re = /#(\w+)(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tags.push(m[1]);
  }
  if (tags.length === 0) return { stripped: text, tags };
  const stripped = text.replace(/#(\w+)\s+/g, " ").replace(/\s{2,}/g, " ");
  return { stripped, tags };
}

export function shortDateLabel(date: string | null): string {
  if (date) {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  return "Not scheduled";
}

// ─── Sub-components ─────────────────────────────────────────

// ── Picker option metadata ─────────────────────────────

export const PRIORITY_PICKER_OPTIONS: { value: TaskPriority; code: string; label: string }[] = [
  { value: "p1", code: "P1", label: "Urgent" },
  { value: "p2", code: "P2", label: "High" },
  { value: "p3", code: "P3", label: "Medium" },
  { value: "p4", code: "P4", label: "Low" },
];

export const ESTIMATE_PICKER_OPTIONS: {
  minutes: number;
  code: string;
  label: string;
}[] = [
  { minutes: 30, code: "XS", label: "30 min or less" },
  { minutes: 60, code: "S", label: "~1 hr" },
  { minutes: 120, code: "M", label: "~2 hr" },
  { minutes: 240, code: "ML", label: "~4 hr" },
  { minutes: 480, code: "L", label: "~8 hr" },
  { minutes: 960, code: "XL", label: "16 hrs or more" },
];

// Hitbox tuning: column hitboxes are larger than the visible bar so a tap
// anywhere in the vertical column (even above a short bar) selects that
// value. Previously bars were 5×18 → ~90px² taps; now columns are 16×30 →
// 480px².
const PRI_COL_W = 16;
const PRI_COL_H = 30;
const PRI_BAR_HEIGHTS = [10, 16, 22, 28];

const EST_COL_W = 14;
const EST_COL_H = 30;
const EST_BAR_HEIGHTS = [8, 13, 17, 21, 25, 28];

/**
 * A row of bars that can be set either by tapping a bar or by dragging
 * left/right across the row (drag maps horizontal position → bar index).
 * Backs the priority and estimate selectors.
 */
function BarSelector({
  litCount,
  barHeights,
  colW,
  colH,
  litColor,
  onSelectIndex,
}: {
  litCount: number;
  barHeights: number[];
  colW: number;
  colH: number;
  litColor: string;
  onSelectIndex: (index: number, source: "tap" | "drag") => void;
}) {
  const widthRef = useRef(0);
  const count = barHeights.length;

  const selectFromX = (x: number, source: "tap" | "drag") => {
    const w = widthRef.current;
    if (w <= 0) return;
    const idx = Math.min(count - 1, Math.max(0, Math.floor((x / w) * count)));
    onSelectIndex(idx, source);
  };

  // Tap selects the bar under the finger; horizontal drag scrubs the value.
  // activeOffsetX lets vertical scroll pass through to the parent ScrollView.
  // `source` is passed on because a scrub fires repeatedly over the same bar —
  // only a deliberate tap may read as "re-selected, so clear it".
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-10, 10])
    .onUpdate((e) => selectFromX(e.x, "drag"));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => selectFromX(e.x, "tap"));
  const gesture = Gesture.Race(tap, pan);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.barsRow}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
        }}
      >
        {barHeights.map((h, i) => (
          <View
            key={i}
            style={{
              width: colW,
              height: colH,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                width: 7,
                borderRadius: 2,
                height: h,
                backgroundColor: i < litCount ? litColor : "#e5e7eb",
              }}
            />
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

function PrioritySignal({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[value];
  // Bars run left→right short→tall: indices 0..3 map to p4..p1.
  const barPriorities: TaskPriority[] = ["p4", "p3", "p2", "p1"];
  return (
    <BarSelector
      litCount={litCount}
      barHeights={PRI_BAR_HEIGHTS}
      colW={PRI_COL_W}
      colH={PRI_COL_H}
      litColor={PRIORITY_COLORS[value]}
      onSelectIndex={(i, source) => {
        // Tapping the priority already set clears it to p4 ("no priority").
        // A scrub must not — it fires on every frame over the same bar and
        // would flip the value off mid-gesture.
        const picked = barPriorities[i];
        onChange(source === "tap" && picked === value ? "p4" : picked);
      }}
    />
  );
}

function EstimateEqualizer({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number) => void;
}) {
  const activeIdx = estimateBarIndex(value);
  return (
    <BarSelector
      litCount={activeIdx + 1}
      barHeights={EST_BAR_HEIGHTS}
      colW={EST_COL_W}
      colH={EST_COL_H}
      litColor="#6366f1"
      onSelectIndex={(i) => onChange(ESTIMATE_BUCKETS[i])}
    />
  );
}

// ── Mobile bottom-sheet pickers ─────────────────────────

export function PickerSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  accentByKey,
  header,
}: {
  visible: boolean;
  title: string;
  options: { key: string; code: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  accentByKey?: (key: string) => string;
  /** Optional content rendered between the title and the option rows. */
  header?: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.pickerBackdrop}>
        <Pressable onPress={() => {}} style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          {header}
          {options.map((opt) => {
            const selected = opt.key === selectedKey;
            return (
              <Pressable
                key={opt.key}
                onPress={() => onSelect(opt.key)}
                style={[
                  styles.pickerRow,
                  selected && styles.pickerRowSelected,
                ]}
              >
                <View
                  style={[
                    styles.pickerDot,
                    {
                      backgroundColor:
                        accentByKey?.(opt.key) ?? "#6366f1",
                    },
                  ]}
                />
                {opt.code ? (
                  <Text style={styles.pickerCode}>{opt.code}</Text>
                ) : null}
                <Text style={styles.pickerLabel}>{opt.label}</Text>
                {selected && <Text style={styles.pickerCheck}>✓</Text>}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Copy and colour per save phase. `pending` and `saving` deliberately read the
 * same: the user doesn't care whether the request has left yet, only that the
 * edit is in hand and not on the server. Rendering them identically also means
 * the debounce elapsing doesn't cause a second, meaningless flicker.
 */
const SAVE_STATUS_COPY: Record<SaveStatus, { label: string; color: string }> = {
  idle: { label: "Auto-saves", color: "#9ca3af" },
  pending: { label: "Saving…", color: "#f59e0b" },
  saving: { label: "Saving…", color: "#f59e0b" },
  saved: { label: "Saved", color: "#16a34a" },
  error: { label: "Save failed", color: "#ef4444" },
};

function SaveStatusDot({ status }: { status: SaveStatus }) {
  const { label, color } = SAVE_STATUS_COPY[status];
  const inFlight = status === "pending" || status === "saving";

  // Pulse while there's unsaved work. The colour change alone is a single
  // frame's worth of signal at the edge of the user's vision; movement is what
  // actually gets noticed, and it stops the moment the edit is safe.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!inFlight) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [inFlight, pulse]);

  return (
    <View
      style={styles.statusRow}
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <Animated.View
        style={[styles.statusDot, { backgroundColor: color, opacity: pulse }]}
      />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

// A single day tile, shared between the compact week strip and the full-month
// grid. `dense` shrinks it (square, no "today/selected" caption, fewer dots) so
// six rows of a month fit without a huge sheet. `outside` dims spill-over days
// from the adjacent months in the month grid.
function DayCell({
  date,
  weekday,
  outside = false,
  scheduledDate,
  todayStr,
  inSpan = false,
  busyByDate,
  onPickDate,
  dense = false,
}: {
  date: string;
  weekday: number;
  outside?: boolean;
  scheduledDate: string | null;
  todayStr: string;
  /** Between today and the task's date — the tinted runway. */
  inSpan?: boolean;
  busyByDate: Map<string, DayBusyness>;
  onPickDate: (date: string) => void;
  dense?: boolean;
}) {
  const isWeekend = weekday === 0 || weekday === 6;
  const isPast = date < todayStr;
  const isToday = date === todayStr;
  const isActive = scheduledDate === date;
  const numLabel = parseInt(date.split("-")[2], 10);
  const dots = (busyByDate.get(date)?.items ?? []).slice(0, dense ? 4 : 8);

  let bg = "#f9fafb";
  let borderColor: string = "transparent";
  if (isWeekend) bg = "rgba(99,102,241,0.035)";
  // Weekends already carry a 0.035 indigo wash, so the runway needs real
  // separation from it to read as a span rather than as another weekend.
  if (inSpan) bg = "rgba(99,102,241,0.13)";
  if (isToday) {
    // Today used to be a plain white cell — quieter than every neighbour.
    // It anchors the span now, so it gets its own outline.
    bg = "rgba(99,102,241,0.10)";
    borderColor = "#818cf8";
  }
  if (isActive) {
    bg = "#eef2ff";
    borderColor = "#6366f1";
  }
  if (isPast) bg = "#f9fafb";

  return (
    <Pressable
      disabled={isPast}
      onPress={() => onPickDate(date)}
      style={[
        styles.cell,
        dense && styles.cellDense,
        { backgroundColor: bg, borderColor },
        isPast && { opacity: 0.3 },
        outside && !isActive && { opacity: 0.45 },
      ]}
    >
      {isToday && <View style={styles.todayDot} />}
      <Text style={[styles.cellNum, isActive && { color: "#4338ca" }]}>
        {numLabel}
      </Text>
      {!dense && (isToday || isActive) && (
        <Text style={[styles.cellSub, isActive && { color: "#6366f1" }]}>
          {isActive ? "selected" : "today"}
        </Text>
      )}
      <View style={[styles.dotsRow, dense && styles.dotsRowDense]}>
        {dots.map((item) => {
          const w = dotWidth(item.duration_minutes);
          if (item.type === "event") {
            return (
              <View key={item.id} style={[styles.dotEvent, { width: w }]} />
            );
          }
          const color = PRIORITY_COLORS[item.priority ?? "p3"];
          return (
            <View
              key={item.id}
              style={[styles.dot, { width: w, backgroundColor: color }]}
            />
          );
        })}
      </View>
    </Pressable>
  );
}

/** Column gap inside a week row — must match `styles.calWeekRow.gap`. */
const CAL_ROW_GAP = 3;

/** One week row's window onto the span, in that row's coordinate space. */
type WaveRun = {
  rowIndex: number;
  left: number;
  width: number;
  /** Distance from the span's start to this run's start, along the span. */
  offset: number;
};

type SpanWave = {
  runs: WaveRun[];
  totalWidth: number;
  bandWidth: number;
  durationMs: number;
};

/**
 * Lay the span out across the visible week rows.
 *
 * `spanSeq` is today plus the days between, in order; the selected day is left
 * out because its solid indigo fill would swallow the band anyway. Rows are in
 * date order, so each row contributes one contiguous run, and the runs laid end
 * to end form a single continuous space for the band to cross exactly once.
 */
function computeSpanWave(
  rows: { date: string }[][],
  spanSeq: string[],
  rowWidth: number
): SpanWave | null {
  if (spanSeq.length === 0 || rowWidth <= 0) return null;
  const inSpan = new Set(spanSeq);
  const cellW = (rowWidth - CAL_ROW_GAP * 6) / 7;
  const step = cellW + CAL_ROW_GAP;

  const runs: WaveRun[] = [];
  let offset = 0;
  rows.forEach((row, rowIndex) => {
    const cols = row
      .map((c, i) => (inSpan.has(c.date) ? i : -1))
      .filter((i) => i >= 0);
    if (cols.length === 0) return;
    const c0 = cols[0];
    const c1 = cols[cols.length - 1];
    const width = (c1 - c0) * step + cellW;
    runs.push({ rowIndex, left: c0 * step, width, offset });
    offset += width;
  });

  if (runs.length === 0 || offset < 24) return null;
  // A band roughly a day and a half wide reads as a soft swell rather than a
  // lit-up cell; clamped so very long spans don't wash the whole grid.
  const bandWidth = Math.min(Math.max(cellW * 1.6, 40), 170);
  // Constant travel speed, so a longer span takes proportionally longer
  // instead of the band accelerating across it.
  const durationMs = Math.min(
    Math.max((offset + bandWidth) * 7.5, 2200),
    7000
  );
  return { runs, totalWidth: offset, bandWidth, durationMs };
}

// Alpha profile across the band: 0 at both edges, peak in the middle. React
// Native has no gradient without `expo-linear-gradient`, which is a native
// module — adding one would cost an EAS rebuild and break the OTA path for a
// decoration. At this width the stepped strips are indistinguishable from a
// real gradient, especially in motion.
const WAVE_STRIPS = Array.from({ length: 16 }, (_, i) => {
  const t = i / 15;
  return Math.sin(Math.PI * t) * 0.2;
});

/**
 * One row's window onto the travelling band. Every row shares the caller's
 * single `progress` value, so the runs are in exact lockstep and the band
 * appears to pass through row one, then row two, as one unbroken sweep.
 */
function SpanWaveRun({
  run,
  wave,
  rowHeight,
  progress,
}: {
  run: WaveRun;
  wave: SpanWave;
  rowHeight: number;
  progress: Animated.Value;
}) {
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, wave.totalWidth + wave.bandWidth],
  });
  return (
    <View
      pointerEvents="none"
      style={[
        styles.waveClip,
        { left: run.left, width: run.width, height: rowHeight },
      ]}
    >
      {/* Shifts this row's window into the span's shared coordinate space. */}
      <View style={{ position: "absolute", left: -run.offset, top: 0, bottom: 0, width: wave.totalWidth }}>
        <Animated.View
          style={[
            styles.waveBand,
            {
              left: -wave.bandWidth,
              width: wave.bandWidth,
              transform: [{ translateX }],
            },
          ]}
        >
          {WAVE_STRIPS.map((alpha, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                backgroundColor: `rgba(99,102,241,${alpha.toFixed(3)})`,
              }}
            />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

export function ScheduleCalendar({
  scheduledDate,
  busyness,
  onPickDate,
  onRangeChange,
}: {
  scheduledDate: string | null;
  busyness: DayBusyness[];
  onPickDate: (date: string) => void;
  /**
   * Called with the [start, end] YYYY-MM-DD range the calendar wants busyness
   * for whenever the full-month view navigates to a new month. The parent can
   * lazily fetch + merge those days so dots appear for months beyond the
   * initial two-week window. Optional — callers that don't fetch busyness
   * (e.g. quick-add) can omit it.
   */
  onRangeChange?: (startDate: string, endDate: string) => void;
}) {
  // View modes:
  //   "strip"  — the compact 1- or 2-week horizontal glance (default)
  //   "month"  — a full navigable month grid for reaching any date
  const [mode, setMode] = useState<"strip" | "month">("strip");
  // Near the weekend (Thu–Sat), default the strip to two weeks so the next
  // week is visible at a glance; otherwise start collapsed to one week.
  const [expanded, setExpanded] = useState(() => {
    const day = new Date().getDay(); // 0=Sun … 4=Thu, 5=Fri, 6=Sat
    return day >= 4 && day <= 6;
  });

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const todayStr = ymd(today);
  // "Next week" is a concrete date — exactly 7 days from today — not a soft
  // bucket, so it survives as a real scheduled_date.
  const nextWeekStr = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return ymd(d);
  }, [today]);

  // The month shown in month mode. Seeded from the selected date (so opening
  // the picker lands on the month you already scheduled) or today.
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(scheduledDate ? new Date(scheduledDate + "T00:00:00") : today)
  );
  const atCurrentMonth = sameMonth(viewMonth, today);
  const monthLabel = useMemo(
    () =>
      viewMonth.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [viewMonth]
  );

  const weekRows = useMemo(() => {
    const numWeeks = expanded ? 2 : 1;
    const out: { date: string; weekday: number }[][] = [];
    for (let w = 0; w < numWeeks; w++) {
      const row: { date: string; weekday: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + w * 7 + i);
        row.push({ date: ymd(d), weekday: i });
      }
      out.push(row);
    }
    return out;
  }, [weekStart, expanded]);

  const monthRows = useMemo(() => monthGridRows(viewMonth), [viewMonth]);

  const busyByDate = useMemo(() => {
    const m = new Map<string, DayBusyness>();
    for (const d of busyness) m.set(d.date, d);
    return m;
  }, [busyness]);

  // The "runway": the days between now and when the task is scheduled. Only
  // forward spans have one — a task dated today or overdue has no distance to
  // show, and its own cell already carries the marker.
  const spanDates = useMemo(() => {
    if (!scheduledDate || scheduledDate <= todayStr) return new Set<string>();
    return new Set(datesBetweenLocalISO(todayStr, scheduledDate));
  }, [todayStr, scheduledDate]);
  // Today plus those days, in order — the path the wave travels.
  const spanSeq = useMemo(
    () => (spanDates.size > 0 ? [todayStr, ...spanDates] : []),
    [todayStr, spanDates]
  );

  // Rows are uniform, so one measurement places the wave on any of them. Cells
  // are `flex: 1`, so their edges follow from the row width.
  const [rowBox, setRowBox] = useState<{ w: number; h: number } | null>(null);
  const [monthRowBox, setMonthRowBox] = useState<{
    w: number;
    h: number;
  } | null>(null);

  const weekWave = useMemo(
    () => computeSpanWave(weekRows, spanSeq, rowBox?.w ?? 0),
    [weekRows, spanSeq, rowBox]
  );
  const monthWave = useMemo(
    () => computeSpanWave(monthRows, spanSeq, monthRowBox?.w ?? 0),
    [monthRows, spanSeq, monthRowBox]
  );

  // One shared driver for every run on screen, so rows never drift apart.
  const waveProgress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const activeWave = mode === "month" ? monthWave : weekWave;
  const waveDuration = activeWave?.durationMs ?? 0;
  useEffect(() => {
    // The wave is ambient, never load-bearing: the static runway tint already
    // shows the span, so reduced motion simply drops the moving band.
    if (!waveDuration || reduceMotion) {
      waveProgress.setValue(0);
      return;
    }
    waveProgress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(waveProgress, {
        toValue: 1,
        duration: waveDuration,
        easing: (t) => t, // linear: constant travel speed
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [waveProgress, waveDuration, reduceMotion]);

  // When the month view is active, ask the parent to load busyness for the
  // visible grid (which spills a few days into the neighbouring months).
  useEffect(() => {
    if (mode !== "month" || !onRangeChange) return;
    const first = monthRows[0][0].date;
    const last = monthRows[monthRows.length - 1][6].date;
    onRangeChange(first, last);
  }, [mode, monthRows, onRangeChange]);

  const openMonth = () => {
    setViewMonth(
      startOfMonth(scheduledDate ? new Date(scheduledDate + "T00:00:00") : today)
    );
    setMode("month");
  };

  if (mode === "month") {
    return (
      <View>
        <View style={styles.monthNav}>
          <Pressable
            onPress={() => setViewMonth((m) => addMonths(m, -1))}
            disabled={atCurrentMonth}
            hitSlop={10}
            style={[styles.monthNavBtn, atCurrentMonth && { opacity: 0.25 }]}
          >
            <Text style={styles.monthNavArrow}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setViewMonth(startOfMonth(today))} hitSlop={8}>
            <Text style={styles.monthTitle}>{monthLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMonth((m) => addMonths(m, 1))}
            hitSlop={10}
            style={styles.monthNavBtn}
          >
            <Text style={styles.monthNavArrow}>›</Text>
          </Pressable>
        </View>

        <View style={styles.calHeader}>
          {WEEKDAYS.map((w, i) => (
            <Text
              key={i}
              style={[
                styles.colHead,
                (i === 0 || i === 6) && styles.colHeadWeekend,
              ]}
            >
              {w}
            </Text>
          ))}
        </View>
        <View style={styles.calGrid}>
          {monthRows.map((week, wi) => {
            const run = monthWave?.runs.find((r) => r.rowIndex === wi);
            return (
            <View
              key={wi}
              style={styles.calWeekRow}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setMonthRowBox((prev) =>
                  prev && prev.w === width && prev.h === height
                    ? prev
                    : { w: width, h: height }
                );
              }}
            >
              {run && monthWave && monthRowBox && !reduceMotion ? (
                <SpanWaveRun
                  run={run}
                  wave={monthWave}
                  rowHeight={monthRowBox.h}
                  progress={waveProgress}
                />
              ) : null}
              {week.map((c) => (
                <DayCell
                  key={c.date}
                  date={c.date}
                  weekday={c.weekday}
                  outside={c.outside}
                  scheduledDate={scheduledDate}
                  todayStr={todayStr}
                  inSpan={spanDates.has(c.date)}
                  busyByDate={busyByDate}
                  onPickDate={onPickDate}
                  dense
                />
              ))}
            </View>
            );
          })}
        </View>

        <View style={styles.altRow}>
          <Pressable onPress={() => setMode("strip")} style={styles.expandChip}>
            <Text style={styles.expandChipText}>⇡ Week view</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.calHeader}>
        {WEEKDAYS.map((w, i) => (
          <Text
            key={i}
            style={[
              styles.colHead,
              (i === 0 || i === 6) && styles.colHeadWeekend,
            ]}
          >
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {weekRows.map((week, wi) => {
          const run = weekWave?.runs.find((r) => r.rowIndex === wi);
          return (
            <View
              key={wi}
              style={styles.calWeekRow}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setRowBox((prev) =>
                  prev && prev.w === width && prev.h === height
                    ? prev
                    : { w: width, h: height }
                );
              }}
            >
              {/* First child: the day cells paint over it, so the band glows
                  through their translucent fills instead of over the numbers. */}
              {run && weekWave && rowBox && !reduceMotion ? (
                <SpanWaveRun
                  run={run}
                  wave={weekWave}
                  rowHeight={rowBox.h}
                  progress={waveProgress}
                />
              ) : null}
              {week.map((c) => (
                <DayCell
                  key={c.date}
                  date={c.date}
                  weekday={c.weekday}
                  scheduledDate={scheduledDate}
                  todayStr={todayStr}
                  inSpan={spanDates.has(c.date)}
                  busyByDate={busyByDate}
                  onPickDate={onPickDate}
                />
              ))}
            </View>
          );
        })}
      </View>

      <View style={styles.altRow}>
        {!expanded && (
          <Pressable
            onPress={() => setExpanded(true)}
            style={styles.expandChip}
          >
            <Text style={styles.expandChipText}>+ next week ⇣</Text>
          </Pressable>
        )}
        <Pressable onPress={openMonth} style={styles.monthChip}>
          <Text style={styles.monthChipText}>📅 Full calendar</Text>
        </Pressable>
        <Pressable
          onPress={() => onPickDate(nextWeekStr)}
          style={[
            styles.bucketChip,
            scheduledDate === nextWeekStr && styles.bucketChipActive,
          ]}
        >
          <Text
            style={[
              styles.bucketChipText,
              scheduledDate === nextWeekStr && styles.bucketChipTextActive,
            ]}
          >
            Next week
          </Text>
          <Text
            style={[
              styles.bucketChipHint,
              scheduledDate === nextWeekStr && styles.bucketChipTextActive,
            ]}
          >
            {formatScheduleHint(nextWeekStr)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Every half hour across the day, as "HH:MM". Pure JS (no native datetime
// picker — that would force a dev-client rebuild); mirrors the web
// ScheduledTimeField's scrollable slot list.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

// Round wall-clock `now` to the nearest hour, as an "HH:00" slot. Anchors the
// scroller near "now" when it opens (2:03pm → "14:00", 2:45pm → "15:00").
function nearestHourSlot(now: Date): string {
  const h = (now.getHours() + Math.round(now.getMinutes() / 60)) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

const TIME_SLOT_ROW_H = 42;
const TIME_LIST_H = TIME_SLOT_ROW_H * 6;

// Time-of-day for the scheduled_date "do date". Only rendered once a day is picked
// (the caller gates on scheduledDate). A tappable field that opens a bottom sheet
// with a vertical scroll of half-hour slots, centered on the current value
// (or the hour nearest now) — like a normal time picker, not a chip strip.
export function ScheduledTimeField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (t: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const anchorSlot =
    value && TIME_SLOTS.includes(value) ? value : nearestHourSlot(new Date());
  const anchorIdx = TIME_SLOTS.indexOf(anchorSlot);

  // Center the anchor row as soon as the sheet's list lays out.
  const centerOnAnchor = () => {
    scrollRef.current?.scrollTo({
      y: Math.max(
        0,
        anchorIdx * TIME_SLOT_ROW_H - TIME_LIST_H / 2 + TIME_SLOT_ROW_H / 2
      ),
      animated: false,
    });
  };

  return (
    <View style={styles.timeFieldRow}>
      <Text style={styles.sectionLabel}>Time</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.timeField}>
        <Text style={styles.timeFieldIcon}>🕐</Text>
        <Text
          style={[styles.timeFieldText, !value && styles.timeFieldTextMuted]}
        >
          {value ? formatTimeOfDay(value) : "Add time"}
        </Text>
        <Text style={styles.projectFieldChevron}>▾</Text>
      </Pressable>
      {value ? (
        <Pressable
          onPress={() => onChange(null)}
          hitSlop={8}
          accessibilityLabel="Clear time"
          style={styles.timeClearBtn}
        >
          <Text style={styles.timeClearBtnText}>×</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable onPress={() => setOpen(false)} style={styles.pickerBackdrop}>
          <Pressable onPress={() => {}} style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Time</Text>
            <View style={{ height: TIME_LIST_H }}>
              <ScrollView
                ref={scrollRef}
                onContentSizeChange={centerOnAnchor}
                showsVerticalScrollIndicator
              >
                {TIME_SLOTS.map((slot) => {
                  const selected = value === slot;
                  const isAnchor = slot === anchorSlot;
                  return (
                    <Pressable
                      key={slot}
                      onPress={() => {
                        onChange(slot);
                        setOpen(false);
                      }}
                      style={[
                        styles.timeSlotRow,
                        isAnchor && !selected && styles.timeSlotRowAnchor,
                        selected && styles.timeSlotRowSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeSlotText,
                          selected && styles.timeSlotTextSelected,
                        ]}
                      >
                        {formatTimeOfDay(slot)}
                      </Text>
                      {isAnchor && !selected ? (
                        <Text style={styles.timeSlotNow}>NOW</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            {value ? (
              <Pressable
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
                style={styles.timeSheetClear}
              >
                <Text style={styles.timeSheetClearText}>× Clear time</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function TagRow({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const submit = () => {
    const trimmed = draft.trim().replace(/^#/, "");
    if (trimmed) onAdd(trimmed);
    setDraft("");
  };

  return (
    <View style={styles.tagRow}>
      {tags.map((tag) => (
        <View key={tag} style={styles.tagChip}>
          <Text style={styles.tagChipLabel}>#{tag}</Text>
          <Pressable
            onPress={() => onRemove(tag)}
            hitSlop={6}
            accessibilityLabel={`Remove tag ${tag}`}
            style={styles.tagChipRemove}
          >
            <Text style={styles.tagChipRemoveText}>×</Text>
          </Pressable>
        </View>
      ))}
      {adding ? (
        <View style={[styles.tagChip, styles.tagChipEditing]}>
          <Text style={styles.tagChipLabel}>#</Text>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(v) => setDraft(v.replace(/[^\w]/g, ""))}
            onSubmitEditing={() => {
              submit();
              if (!draft.trim()) setAdding(false);
            }}
            blurOnSubmit={false}
            onBlur={() => {
              if (draft.trim()) submit();
              setAdding(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="tag"
            placeholderTextColor="#a5b4fc"
            style={styles.tagChipInput}
          />
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} style={styles.tagAddChip}>
          <Text style={styles.tagAddChipText}>+ tag</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Recurrence ──────────────────────────────────────────

const RECURRENCE_PRESETS: { label: string; rule: string | null }[] = [
  { label: "None", rule: null },
  { label: "Daily", rule: "FREQ=DAILY" },
  { label: "Weekdays", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Weekly", rule: "FREQ=WEEKLY" },
  { label: "Monthly", rule: "FREQ=MONTHLY" },
];

export function recurrenceShortLabel(rule: string | null): string {
  if (!rule) return "None";
  return RECURRENCE_PRESETS.find((p) => p.rule === rule)?.label ?? "Custom";
}

/**
 * One-line summary of a task's location reminders for the folded row.
 * Names the place while there's only one, since "Arriving at Tesco" is the
 * whole setting at a glance; past that, counting is the only thing that fits.
 */
export function locationReminderLabel(links: TaskLocationLink[]): string {
  if (links.length === 0) return "Remind me at a place";
  if (links.length === 1) {
    const { location, trigger_type } = links[0];
    return trigger_type === "enter"
      ? `Arriving at ${location.name}`
      : `Leaving ${location.name}`;
  }
  const places = new Set(links.map((l) => l.location.id)).size;
  return places === 1
    ? `Arriving at and leaving ${links[0].location.name}`
    : `${places} places`;
}

/**
 * Notes, with URLs rendered as tappable links.
 *
 * A `TextInput` can only ever hold dead text, so notes — the field a URL is
 * most likely to be pasted into — swap between a linkified read view and the
 * editor: tap the notes to edit, blur to go back to links. Empty notes go
 * straight to the input so the "add notes" affordance still takes one tap.
 */
function NotesField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = value ?? "";

  if (editing || text.length === 0) {
    return (
      <TextInput
        value={text}
        autoFocus={editing}
        onChangeText={(v) => onChange(v.length === 0 ? null : v)}
        onBlur={() => setEditing(false)}
        placeholder="Tap to add notes…"
        placeholderTextColor="#9ca3af"
        multiline
        style={styles.notesInput}
      />
    );
  }

  return (
    // A tap that lands on a link opens it (the link's own onPress takes the
    // tap); anywhere else in the box switches to the editor.
    <Pressable onPress={() => setEditing(true)} style={styles.notesBox}>
      <LinkifiedText text={text} style={styles.notesText} />
    </Pressable>
  );
}

function RepeatRow({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (rule: string | null) => void;
}) {
  return (
    <View style={styles.repeatRow}>
      {RECURRENCE_PRESETS.map((p) => {
        const active = (value ?? null) === p.rule;
        return (
          <Pressable
            key={p.label}
            onPress={() => onChange(p.rule)}
            style={[styles.repeatChip, active && styles.repeatChipActive]}
          >
            <Text
              style={[
                styles.repeatChipText,
                active && styles.repeatChipTextActive,
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Status ──────────────────────────────────────────────

export const STATUS_PICKER_OPTIONS: { key: string; code: string; label: string }[] =
  STATUS_ORDER.map((s) => ({
    key: s,
    code: "",
    label: STATUS_CONFIG[s].label,
  }));

// ── Subtasks ────────────────────────────────────────────

function SubtaskRow({
  task,
  onToggle,
  onOpen,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  /** Open this subtask in the sheet (drill down into its own editor). */
  onOpen: () => void;
  onDelete: () => void;
}) {
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <View style={styles.subtaskRow}>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityLabel={done ? "Mark not done" : "Mark done"}
        style={[styles.subtaskCheck, done && styles.subtaskCheckDone]}
      >
        {done ? <Text style={styles.subtaskCheckMark}>✓</Text> : null}
      </Pressable>
      {/* Tapping the title drills into the subtask's own editor. */}
      <Pressable
        onPress={onOpen}
        style={styles.subtaskTitleBtn}
        accessibilityLabel={`Open ${task.title}`}
      >
        <LinkifiedText
          text={task.title}
          numberOfLines={1}
          style={[styles.subtaskTitle, done && styles.subtaskTitleDone]}
        />
      </Pressable>
      <Pressable
        onPress={onOpen}
        hitSlop={8}
        accessibilityLabel={`Open ${task.title}`}
        style={styles.subtaskDelete}
      >
        <Text style={styles.subtaskChevron}>›</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        accessibilityLabel={`Delete ${task.title}`}
        style={styles.subtaskDelete}
      >
        <Text style={styles.subtaskDeleteText}>×</Text>
      </Pressable>
    </View>
  );
}

function SubtasksSection({
  parentTask,
  tasksApi,
  onOpenSubtask,
}: {
  parentTask: Task;
  tasksApi: TasksApi;
  /** Drill the sheet into a subtask's own editor. */
  onOpenSubtask: (task: Task) => void;
}) {
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await tasksApi.listSubtasks(parentTask.id);
      if (!cancelled) {
        setSubtasks(data);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentTask.id, tasksApi]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  // DB trigger enforces depth ≤ 2, so depth 2 tasks can't have children.
  const canAdd = parentTask.depth < 2;

  const handleAdd = async () => {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    const { data } = await tasksApi.create({
      title,
      parent_task_id: parentTask.id,
    });
    if (data) {
      setSubtasks((prev) => [...prev, data]);
      invalidateTasks();
    }
    setDraft("");
    // Keep the input open for rapid entry.
  };

  const handleToggle = async (st: Task) => {
    const next = st.status === "done" ? "not_started" : "done";
    const { data } = await tasksApi.update(st.id, { status: next });
    if (data) {
      setSubtasks((prev) => prev.map((s) => (s.id === data.id ? data : s)));
      invalidateTasks();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await tasksApi.delete(id);
    if (!error) {
      setSubtasks((prev) => prev.filter((s) => s.id !== id));
      invalidateTasks();
    }
  };

  if (!canAdd && subtasks.length === 0 && loaded) return null;

  const doneCount = subtasks.filter((s) => s.status === "done").length;

  return (
    <View style={{ marginTop: 18 }}>
      <View style={styles.rowHead}>
        <Text style={styles.sectionLabel}>Subtasks</Text>
        {subtasks.length > 0 ? (
          <Text style={styles.sectionValue}>
            {doneCount}/{subtasks.length}
          </Text>
        ) : null}
      </View>
      <View style={styles.subtaskCard}>
        {subtasks.map((st) => (
          <SubtaskRow
            key={st.id}
            task={st}
            onToggle={() => handleToggle(st)}
            onOpen={() => onOpenSubtask(st)}
            onDelete={() => handleDelete(st.id)}
          />
        ))}
        {canAdd ? (
          adding ? (
            <View style={styles.subtaskRow}>
              <View style={[styles.subtaskCheck, styles.subtaskCheckGhost]} />
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void handleAdd()}
                blurOnSubmit={false}
                onBlur={() => {
                  if (draft.trim()) void handleAdd();
                  setAdding(false);
                }}
                placeholder="Subtask title…"
                placeholderTextColor="#9ca3af"
                style={styles.subtaskInput}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              style={styles.subtaskAddRow}
            >
              <View style={[styles.subtaskCheck, styles.subtaskCheckGhost]}>
                <Text style={styles.subtaskAddPlus}>+</Text>
              </View>
              <Text style={styles.subtaskAddText}>Add subtask</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

// ─── Main modal ─────────────────────────────────────────────

interface Props {
  task: Task | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Best-effort post-close callback so call sites can reload their list
   * after edits. Optional. With autosave, this is purely a UI sync hook —
   * the data is already in Supabase by the time this fires.
   */
  onSaved?: () => void;
}

const SCREEN_H = Dimensions.get("window").height;

export default function TaskEditModalV2({
  task,
  visible,
  onClose,
  onSaved,
}: Props) {
  // Keep the latest close handler in a ref so the once-created PanResponder
  // always calls the current one.
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    onClose();
    onSaved?.();
  };

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  // Which task is on screen. The editor can drill from the opened task into a
  // subtask, or climb back to a parent, all within the same sheet. Re-rooted in
  // the render phase (not an effect) so an in-place re-render never clobbers a
  // drill-down; `marker` is the (id, visible) pair we last rooted on.
  const [activeTask, setActiveTask] = useState<Task | null>(task);
  const marker = `${task?.id ?? "none"}:${visible}`;
  const [rootedMarker, setRootedMarker] = useState(marker);
  if (marker !== rootedMarker) {
    setRootedMarker(marker);
    if (visible) setActiveTask(task);
  }

  // Slide the sheet up whenever it becomes visible.
  useEffect(() => {
    if (visible && task) {
      translateY.setValue(SCREEN_H);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: false,
      }).start();
    }
  }, [visible, task, translateY]);

  // Animate the sheet down, then actually close.
  const animatedClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_H,
      duration: 220,
      useNativeDriver: false,
    }).start(() => closeRef.current());
  };

  // Drag the sheet down to dismiss. gesture-handler (the slider's stack — it
  // reliably detects touches here) drives a plain RN Animated.Value, so we
  // steer clear of Reanimated. activeOffsetY makes it claim only downward
  // drags, leaving taps and the horizontal sliders alone.
  const dismissPan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY(12)
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.setValue(e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        Animated.timing(translateY, {
          toValue: SCREEN_H,
          duration: 220,
          useNativeDriver: false,
        }).start(() => closeRef.current());
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 0,
        }).start();
      }
    });

  return (
    <Modal
      visible={visible && !!task}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={animatedClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={animatedClose} />
        <GestureHandlerRootView style={styles.ghRoot}>
          <GestureDetector gesture={dismissPan}>
            <Animated.View
              style={[styles.sheet, { transform: [{ translateY }] }]}
            >
              <View style={styles.grabberWrap}>
                <View style={styles.grabber} />
              </View>
              {activeTask ? (
                <Inner
                  key={activeTask.id}
                  task={activeTask}
                  onClose={animatedClose}
                  onNavigateTask={setActiveTask}
                />
              ) : null}
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      </View>
    </Modal>
  );
}

function Inner({
  task,
  onClose,
  onNavigateTask,
}: {
  task: Task;
  onClose: () => void;
  /** Drill the sheet to another task (a subtask, or this task's parent). */
  onNavigateTask: (task: Task) => void;
}) {
  const tasksApiMemo = useMemo(() => {
    // Lazy require avoids loading TasksApi at module init.
    const { TasksApi } = require("@do-done/api-client") as typeof import("@do-done/api-client");
    return new TasksApi(supabase, task.user_id);
  }, [task.user_id]);

  const attachmentsApiMemo = useMemo(() => {
    const { AttachmentsApi } =
      require("@do-done/api-client") as typeof import("@do-done/api-client");
    return new AttachmentsApi(supabase, task.user_id);
  }, [task.user_id]);

  // Parent task, resolved when the open task is a subtask, so the header can
  // offer a way back up. Doubles as the navigation target (no extra fetch on tap).
  // Starts null every mount; the sheet body is keyed on the task id, so
  // navigating remounts this fresh rather than needing a reset here.
  const [parentTask, setParentTask] = useState<Task | null>(null);
  useEffect(() => {
    const parentId = task.parent_task_id;
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      const { data } = await tasksApiMemo.getById(parentId);
      if (!cancelled) setParentTask(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.parent_task_id, tasksApiMemo]);

  const {
    task: current,
    setField,
    undoAll,
    hasChanges,
    status: saveStatus,
  } = useAutoSaveTask(task, tasksApiMemo, {
    // Reconcile the TanStack Query lists after each commit. Doing it here (not
    // on modal close) means the refetch reads the row *after* the PATCH lands,
    // so the lists stop showing the pre-edit value — and it covers every close
    // path (swipe, backdrop, back button, ×) since it no longer depends on the
    // close handler firing.
    onSaved: invalidateTasks,
  });

  // Busyness dots, keyed by date so ranges from different months merge cleanly.
  // The calendar starts with the default two-week window; the full-month picker
  // requests additional ranges via onRangeChange (see fetchRange below).
  const [busyByDate, setBusyByDate] = useState<Map<string, DayBusyness>>(
    () => new Map()
  );
  const fetchedRanges = useRef<Set<string>>(new Set());

  const fetchRange = useCallback(
    async (startDate: string, endDate: string) => {
      const key = `${startDate}:${endDate}`;
      if (fetchedRanges.current.has(key)) return;
      fetchedRanges.current.add(key);
      const api = new BusynessApi(supabase, task.user_id);
      const { data, error } = await api.getTasksRange(startDate, endDate);
      if (error) {
        fetchedRanges.current.delete(key); // allow a later retry
        return;
      }
      setBusyByDate((prev) => {
        const next = new Map(prev);
        for (const d of data) next.set(d.date, d);
        return next;
      });
    },
    [task.user_id]
  );

  useEffect(() => {
    const sow = startOfWeek(new Date());
    const end = new Date(sow);
    end.setDate(end.getDate() + 13);
    fetchRange(ymd(sow), ymd(end));
  }, [fetchRange]);

  const busyness = useMemo(
    () => Array.from(busyByDate.values()),
    [busyByDate]
  );

  const handleUndo = useCallback(async () => {
    await undoAll();
  }, [undoAll]);

  const onPickDate = (date: string) => {
    setField("scheduled_date", date);
  };

  const handleTitleChange = (raw: string) => {
    // The field wraps but is still one logical line — a pasted newline would
    // otherwise ride into the title and break every single-line rendering of it.
    const v = raw.replace(/\s*\r?\n\s*/g, " ");
    const { stripped, tags: extracted } = extractCompletedTags(v);
    if (extracted.length > 0) {
      const existing = new Set(current.tags);
      const fresh = extracted.filter((t) => !existing.has(t));
      if (fresh.length > 0) setField("tags", [...current.tags, ...fresh]);
      setField("title", stripped);
    } else {
      setField("title", v);
    }
  };

  const handleAddTag = (tag: string) => {
    if (current.tags.includes(tag)) return;
    setField("tags", [...current.tags, tag]);
  };

  const handleRemoveTag = (tag: string) => {
    setField(
      "tags",
      current.tags.filter((t) => t !== tag)
    );
  };

  const [priPickerOpen, setPriPickerOpen] = useState(false);
  const [estPickerOpen, setEstPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Delete lives in the top-bar overflow menu now, not loose in the bottom bar
  // next to the dismiss control.
  const confirmDelete = useCallback(() => {
    Alert.alert(
      "Delete task?",
      `“${current.title}” will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await tasksApiMemo.delete(task.id);
            if (error) {
              console.error("Delete failed:", error);
              return;
            }
            onClose();
          },
        },
      ]
    );
  }, [current.title, tasksApiMemo, task.id, onClose]);

  // Drives the completion circle beside the title. STATUS_CONFIG[status] can be
  // undefined for an unmigrated DB still serving legacy values — guard before
  // reading .color, as the row does.
  const titleCompleted =
    current.status === "done" || current.status === "cancelled";
  const titleStatusColor = STATUS_CONFIG[current.status]?.color ?? "#94a3b8";
  // Recurrence is a rare setting — keep it folded behind a one-line toggle.
  const [repeatOpen, setRepeatOpen] = useState(false);

  const { data: taskLocations = [] } = useTaskLocations(task.id);

  // Projects created via the picker are merged locally so the field reflects
  // them immediately; the query invalidate in createProject reconciles.
  const { data: projectsData } = useProjects();
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const allProjects = useMemo(
    () => [...(projectsData ?? []), ...createdProjects],
    [projectsData, createdProjects]
  );
  const selectedProject = current.project_id
    ? allProjects.find((p) => p.id === current.project_id) ?? null
    : null;

  const handleProjectCreate = useCallback(
    async (name: string, color: string): Promise<Project | null> => {
      try {
        const created = await createProject({ name, color });
        setCreatedProjects((prev) => [...prev, created]);
        return created;
      } catch {
        return null;
      }
    },
    []
  );

  return (
    <View style={styles.sheetContent}>
      <View style={styles.topBar}>
        {hasChanges ? (
          <Pressable onPress={handleUndo} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>↶ Cancel</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
        <SaveStatusDot status={saveStatus} />
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Task menu"
          style={styles.menuBtn}
        >
          <View style={styles.menuDot} />
          <View style={styles.menuDot} />
          <View style={styles.menuDot} />
        </Pressable>
      </View>

      {/* When the open task is a subtask, offer a way back up to its parent —
          the sheet drills in place, so this is the climb-out. */}
      {current.parent_task_id ? (
        <Pressable
          onPress={() => {
            if (parentTask) onNavigateTask(parentTask);
          }}
          disabled={!parentTask}
          style={styles.parentCrumb}
          accessibilityLabel={
            parentTask ? `Back to ${parentTask.title}` : "Back to parent task"
          }
        >
          <Text style={styles.parentCrumbArrow}>←</Text>
          <Text style={styles.parentCrumbText} numberOfLines={1}>
            {parentTask ? parentTask.title : "Parent task"}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Title input */}
        <View style={styles.inputWrap}>
          {/* The completion circle from a task row, brought into the editor so
              completing the open task is one tap here too — it was previously
              reachable only as one of seven rows in the Status picker. Writes
              through setField, so the Status field stays in sync. */}
          <View style={styles.titleRow}>
            <Pressable
              onPress={() =>
                setField("status", titleCompleted ? "not_started" : "done")
              }
              hitSlop={10}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: titleCompleted }}
              accessibilityLabel={
                titleCompleted ? "Mark incomplete" : "Mark complete"
              }
              style={[
                styles.titleCheckbox,
                {
                  borderColor: titleCompleted ? "#d4d4d4" : titleStatusColor,
                  backgroundColor: titleCompleted ? "#d4d4d4" : "transparent",
                },
              ]}
            >
              {titleCompleted ? (
                <Text style={styles.titleCheckMark}>✓</Text>
              ) : null}
            </Pressable>
            <TextInput
              value={current.title}
              onChangeText={handleTitleChange}
              placeholder="Task title…"
              placeholderTextColor="#9ca3af"
              // A long title has to be readable in full, so the box grows with
              // the text instead of scrolling it sideways past the edge. Return
              // still closes the keyboard — the wrap is visual, not a newline.
              // The circle is top-aligned in the row, so it stays on the first
              // line as the box grows.
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              style={[styles.titleInput, styles.titleInputFlex]}
            />
          </View>
          <TagRow
            tags={current.tags}
            onAdd={handleAddTag}
            onRemove={handleRemoveTag}
          />
        </View>

        {/* DATE */}
        <View style={{ marginTop: 16 }}>
          <View style={styles.rowHead}>
            <Text style={styles.sectionLabel}>Date</Text>
            <Text style={styles.sectionValue}>
              {current.scheduled_date
                ? formatFullDate(current.scheduled_date)
                : "Not scheduled"}
            </Text>
            {current.scheduled_date ? (
              <Text style={styles.sectionValueHint}>
                · {formatRelativeDay(current.scheduled_date)}
              </Text>
            ) : null}
            {current.scheduled_date && current.scheduled_time ? (
              <Text style={styles.sectionValueTime}>
                {formatTimeOfDay(current.scheduled_time)}
              </Text>
            ) : null}
          </View>
          <ScheduleCalendar
            scheduledDate={current.scheduled_date}
            busyness={busyness}
            onPickDate={onPickDate}
            onRangeChange={fetchRange}
          />
          {current.scheduled_date ? (
            <ScheduledTimeField
              value={current.scheduled_time}
              onChange={(t) => setField("scheduled_time", t)}
            />
          ) : null}
        </View>

        {/* Inline meta */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaGroup}>
              <Pressable
                onPress={() => setPriPickerOpen(true)}
                hitSlop={6}
                style={styles.metaLabelButton}
              >
                <Text style={styles.metaLabel}>Pri</Text>
              </Pressable>
              <PrioritySignal
                value={current.priority}
                onChange={(p) => setField("priority", p)}
              />
              <Text
                style={[
                  styles.metaValue,
                  { color: PRIORITY_COLORS[current.priority] },
                ]}
              >
                {PRIORITY_CONFIG[current.priority].label}
              </Text>
            </View>
            <View style={styles.metaGroup}>
              <Pressable
                onPress={() => setEstPickerOpen(true)}
                hitSlop={6}
                style={styles.metaLabelButton}
              >
                <Text style={styles.metaLabel}>Est</Text>
              </Pressable>
              <EstimateEqualizer
                value={current.duration_minutes}
                onChange={(m) => setField("duration_minutes", m)}
              />
              <Text style={[styles.metaValue, { color: "#4338ca" }]}>
                {current.duration_minutes
                  ? current.duration_minutes >= 60
                    ? `${Math.round(current.duration_minutes / 60)}h`
                    : `${current.duration_minutes}m`
                  : "—"}
              </Text>
            </View>
          </View>
        </View>

        {/* Location reminders — folded like Repeat, since most tasks have none */}
        <View style={{ marginTop: 14 }}>
          <Pressable
            onPress={() => setLocationSheetOpen(true)}
            hitSlop={6}
            style={styles.repeatToggle}
          >
            <Text style={styles.repeatToggleText} numberOfLines={1}>
              📍 {locationReminderLabel(taskLocations)}
            </Text>
            <Text style={styles.repeatToggleChevron}>▸</Text>
          </Pressable>
        </View>

        <LocationReminderSheet
          visible={locationSheetOpen}
          taskId={task.id}
          onClose={() => setLocationSheetOpen(false)}
        />

        <PickerSheet
          visible={priPickerOpen}
          title="Priority"
          options={PRIORITY_PICKER_OPTIONS.map((p) => ({
            key: p.value,
            code: p.code,
            label: p.label,
          }))}
          selectedKey={current.priority}
          onSelect={(key) => {
            // Re-picking the current row clears to p4, as the bars do.
            setField(
              "priority",
              key === current.priority ? "p4" : (key as TaskPriority)
            );
            setPriPickerOpen(false);
          }}
          onClose={() => setPriPickerOpen(false)}
          accentByKey={(key) => PRIORITY_COLORS[key as TaskPriority]}
        />
        <PickerSheet
          visible={estPickerOpen}
          title="Estimate"
          options={ESTIMATE_PICKER_OPTIONS.map((b) => ({
            key: String(b.minutes),
            code: b.code,
            label: b.label,
          }))}
          selectedKey={(() => {
            const idx = estimateBarIndex(current.duration_minutes);
            return idx >= 0 ? String(ESTIMATE_BUCKETS[idx]) : "";
          })()}
          onSelect={(key) => {
            setField("duration_minutes", parseInt(key, 10));
            setEstPickerOpen(false);
          }}
          onClose={() => setEstPickerOpen(false)}
        />

        {/* Status + Project — side by side, one tap opens each picker */}
        <View style={styles.fieldPairRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.rowHead}>
              <Text style={styles.sectionLabel}>Status</Text>
            </View>
            <Pressable
              onPress={() => setStatusPickerOpen(true)}
              style={styles.projectField}
            >
              <View
                style={[
                  styles.projectFieldDot,
                  { backgroundColor: STATUS_CONFIG[current.status].color },
                ]}
              />
              <Text style={styles.projectFieldText} numberOfLines={1}>
                {STATUS_CONFIG[current.status].label}
              </Text>
              <Text style={styles.projectFieldChevron}>▾</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.rowHead}>
              <Text style={styles.sectionLabel}>Project</Text>
            </View>
            <Pressable
              onPress={() => setProjectPickerOpen(true)}
              style={styles.projectField}
            >
              <View
                style={[
                  styles.projectFieldDot,
                  selectedProject
                    ? { backgroundColor: selectedProject.color }
                    : styles.projectFieldDotNone,
                ]}
              />
              <Text
                style={[
                  styles.projectFieldText,
                  !selectedProject && styles.projectFieldTextMuted,
                ]}
                numberOfLines={1}
              >
                {selectedProject
                  ? `${selectedProject.icon ? `${selectedProject.icon} ` : ""}${selectedProject.name}`
                  : "No project"}
              </Text>
              <Text style={styles.projectFieldChevron}>▾</Text>
            </Pressable>
          </View>
        </View>

        <PickerSheet
          visible={statusPickerOpen}
          title="Status"
          options={STATUS_PICKER_OPTIONS}
          selectedKey={current.status}
          onSelect={(key) => {
            setField("status", key as TaskStatus);
            setStatusPickerOpen(false);
          }}
          onClose={() => setStatusPickerOpen(false)}
          accentByKey={(key) => STATUS_CONFIG[key as TaskStatus].color}
        />

        <ProjectPickerSheet
          visible={projectPickerOpen}
          projects={allProjects}
          selectedId={current.project_id}
          onSelect={(id) => setField("project_id", id)}
          onClose={() => setProjectPickerOpen(false)}
          onCreate={handleProjectCreate}
        />

        {/* Subtasks */}
        <SubtasksSection
          parentTask={current}
          tasksApi={tasksApiMemo}
          onOpenSubtask={onNavigateTask}
        />

        {/* Notes */}
        <View style={{ marginTop: 18 }}>
          <View style={styles.rowHead}>
            <Text style={styles.sectionLabel}>Notes</Text>
          </View>
          <NotesField
            value={current.description}
            onChange={(v) => setField("description", v)}
          />
        </View>

        {/* Attachments */}
        <AttachmentsSection taskId={current.id} api={attachmentsApiMemo} />

        {/* Repeat — rare, so it stays folded behind a one-line toggle */}
        <View style={{ marginTop: 14 }}>
          <Pressable
            onPress={() => setRepeatOpen((o) => !o)}
            hitSlop={6}
            style={styles.repeatToggle}
          >
            <Text style={styles.repeatToggleText}>
              ↻{" "}
              {current.recurrence_rule
                ? `Repeats ${recurrenceShortLabel(current.recurrence_rule).toLowerCase()}`
                : "Repeat"}
            </Text>
            <Text style={styles.repeatToggleChevron}>
              {repeatOpen ? "▾" : "▸"}
            </Text>
          </Pressable>
          {repeatOpen ? (
            <View style={{ marginTop: 8 }}>
              <RepeatRow
                value={current.recurrence_rule}
                onChange={(rule) => setField("recurrence_rule", rule)}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Dismisses the editor. Deliberately quiet: everything auto-saves, so
          there is nothing to commit here, and this used to be a primary button
          wearing a green ✓ labelled "Done" — which read as "complete the task"
          rather than "close the editor". The ✓ now belongs to the title circle
          alone. */}
      <View style={styles.bottomBar}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close editor"
          style={styles.closeBarBtn}
        >
          <Text style={styles.closeBarBtnLabel}>Close</Text>
        </Pressable>
      </View>

      <TaskMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDelete={confirmDelete}
      />
    </View>
  );
}

// Top-bar overflow menu. Holds the actions that shouldn't sit in the chrome
// competing with the task's own controls — Delete was previously loose in the
// bottom bar, a red button one slip away from the dismiss control.
function TaskMenuSheet({
  visible,
  onClose,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.pickerBackdrop}>
        <Pressable onPress={() => {}} style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Task actions</Text>
          <Pressable
            onPress={() => {
              // Dismiss first: the confirmation is an Alert, which would
              // otherwise stack on top of this sheet.
              onClose();
              onDelete();
            }}
            style={styles.menuRow}
          >
            <Text style={styles.menuRowDestructive}>Delete task</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.4)",
  },
  ghRoot: { height: "92%" },
  sheet: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  grabberWrap: { paddingVertical: 12, alignItems: "center" },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#d1d5db",
  },
  sheetContent: { flex: 1, backgroundColor: "#fff" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cancelBtnText: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
  menuBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  menuDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: "#6b7280",
  },
  menuRow: { paddingVertical: 12, paddingHorizontal: 4 },
  menuRowDestructive: { fontSize: 15, fontWeight: "600", color: "#dc2626" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  // Colour is set per save phase at the call site.
  statusText: { fontSize: 12, fontWeight: "600" },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingBottom: 24 },

  inputWrap: { marginTop: 12 },
  // Top-aligned so the circle sits on the title's first line rather than
  // drifting to the middle when the title wraps.
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    // Centres the circle against the title input's own first line
    // (1.5px border + 10px padding + half the 15px line).
    marginTop: 10,
  },
  titleCheckMark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  titleInputFlex: { flex: 1 },
  titleInput: {
    borderWidth: 1.5,
    borderColor: "#6366f1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
    // Multiline, so height follows the text: one line looks exactly as it did
    // (minHeight), and it grows to roughly five lines before the box itself
    // starts scrolling rather than eating the rest of the sheet.
    minHeight: 44,
    maxHeight: 130,
    textAlignVertical: "top",
  },

  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#eef2ff",
    borderRadius: 5,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 3,
  },
  tagChipEditing: {
    paddingRight: 8,
  },
  tagChipLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4338ca",
  },
  tagChipRemove: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
  },
  tagChipRemoveText: {
    fontSize: 14,
    color: "#6366f1",
    fontWeight: "600",
    lineHeight: 14,
  },
  tagChipInput: {
    minWidth: 50,
    fontSize: 11,
    fontWeight: "700",
    color: "#4338ca",
    padding: 0,
  },
  tagAddChip: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d1d5db",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagAddChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
  },

  rowHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sectionValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  sectionValueHint: {
    fontSize: 12,
    fontWeight: "500",
    color: "#9ca3af",
  },
  sectionValueTime: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338ca",
  },

  fieldPairRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },

  subtaskCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  subtaskCheck: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskCheckDone: {
    backgroundColor: "#6366f1",
    borderColor: "#6366f1",
  },
  subtaskCheckGhost: { borderStyle: "dashed" },
  subtaskCheckMark: { color: "#fff", fontSize: 11, fontWeight: "700" },
  subtaskTitle: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
  },
  subtaskTitleDone: {
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  subtaskDelete: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  subtaskTitleBtn: { flex: 1 },
  subtaskChevron: { fontSize: 18, color: "#c7cdd6", lineHeight: 18 },
  subtaskDeleteText: { fontSize: 16, color: "#9ca3af", lineHeight: 18 },
  parentCrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  parentCrumbArrow: { fontSize: 15, color: "#6366f1", fontWeight: "700" },
  parentCrumbText: {
    flexShrink: 1,
    fontSize: 13,
    color: "#6366f1",
    fontWeight: "600",
  },
  subtaskInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  subtaskAddRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  subtaskAddPlus: { fontSize: 12, color: "#9ca3af", lineHeight: 13 },
  subtaskAddText: { fontSize: 13, fontWeight: "600", color: "#6b7280" },

  calHeader: { flexDirection: "row", gap: 3, marginBottom: 4 },
  colHead: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingBottom: 4,
  },
  colHeadWeekend: { color: "#6b7280" },

  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  monthNavBtn: {
    width: 34,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  monthNavArrow: { fontSize: 20, color: "#4338ca", lineHeight: 22, fontWeight: "700" },
  monthTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },

  calGrid: {
    gap: 3,
  },
  calWeekRow: {
    flexDirection: "row",
    gap: 3,
  },
  cell: {
    flex: 1,
    aspectRatio: 0.77, // taller than wide so dots can wrap to 2 rows
    borderRadius: 7,
    borderWidth: 1.5,
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 2,
    alignItems: "center",
    overflow: "hidden",
  },
  // Month grid packs 6 rows, so cells go square and shed the caption row.
  cellDense: {
    aspectRatio: 1,
    paddingTop: 4,
    paddingBottom: 3,
  },
  todayDot: {
    position: "absolute",
    top: 3,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#6366f1",
  },
  // Clips one row's window onto the span the band travels along.
  waveClip: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 7,
    overflow: "hidden",
  },
  waveBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  cellNum: { fontSize: 13, fontWeight: "600", color: "#111827", lineHeight: 14 },
  cellSub: { fontSize: 8, color: "#9ca3af", marginTop: 1, lineHeight: 9 },
  dotsRow: {
    marginTop: "auto",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 1.5,
    width: "100%",
    minHeight: 12,
  },
  dotsRowDense: { minHeight: 6, gap: 1 },
  dot: { height: 4, borderRadius: 2 },
  dotEvent: {
    height: 4,
    borderRadius: 2,
    borderWidth: 1.25,
    borderColor: "#94a3b8",
    backgroundColor: "transparent",
  },

  altRow: {
    flexDirection: "row",
    gap: 5,
    marginTop: 10,
    flexWrap: "wrap",
  },
  expandChip: {
    flexBasis: "100%",
    backgroundColor: "#eef2ff",
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: "center",
  },
  expandChipText: { color: "#4338ca", fontSize: 12, fontWeight: "600" },
  monthChip: {
    flex: 1,
    backgroundColor: "#eef2ff",
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  monthChipText: { color: "#4338ca", fontSize: 11, fontWeight: "700" },
  bucketChip: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: "center",
  },
  bucketChipActive: { backgroundColor: "#eef2ff" },
  bucketChipText: { fontSize: 11, color: "#374151", fontWeight: "500" },
  bucketChipTextActive: { color: "#4338ca", fontWeight: "700" },
  bucketChipHint: { fontSize: 10, color: "#9ca3af", fontWeight: "400", marginTop: 1 },

  timeFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  timeField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  timeFieldIcon: { fontSize: 13 },
  timeFieldText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#4338ca",
  },
  timeFieldTextMuted: { color: "#9ca3af", fontWeight: "500" },
  timeClearBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  timeClearBtnText: { fontSize: 15, color: "#6b7280", lineHeight: 17 },

  timeSlotRow: {
    height: 42, // TIME_SLOT_ROW_H — keep in sync so scroll centering lands
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  timeSlotRowAnchor: { backgroundColor: "#eef2ff" },
  timeSlotRowSelected: { backgroundColor: "#6366f1" },
  timeSlotText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  timeSlotTextSelected: { color: "#fff", fontWeight: "700" },
  timeSlotNow: {
    fontSize: 9,
    fontWeight: "700",
    color: "#6366f1",
    letterSpacing: 1,
  },
  timeSheetClear: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  timeSheetClearText: { fontSize: 13, fontWeight: "600", color: "#dc2626" },

  repeatToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  repeatToggleText: { fontSize: 12, fontWeight: "600", color: "#9ca3af" },
  repeatToggleChevron: { fontSize: 11, color: "#9ca3af" },

  repeatRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  repeatChip: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  repeatChipActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe",
  },
  repeatChipText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  repeatChipTextActive: { color: "#4338ca", fontWeight: "700" },

  metaCard: {
    marginTop: 18,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 14,
  },
  metaRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  metaGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    minWidth: 22,
  },
  metaLabelButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  metaValue: { fontSize: 12, fontWeight: "700" },

  projectField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  projectFieldDot: { width: 12, height: 12, borderRadius: 6 },
  projectFieldDotNone: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderStyle: "dashed",
  },
  projectFieldText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  projectFieldTextMuted: { color: "#9ca3af", fontWeight: "500" },
  projectFieldChevron: { fontSize: 12, color: "#9ca3af" },

  barsRow: { flexDirection: "row", alignItems: "flex-end", gap: 3 },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  pickerTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  pickerRowSelected: {
    backgroundColor: "#eef2ff",
  },
  pickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickerCode: {
    width: 32,
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  pickerLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  pickerCheck: {
    fontSize: 14,
    fontWeight: "700",
    color: "#4338ca",
  },

  notesInput: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#374151",
    minHeight: 60,
  },
  // Same box as notesInput for the read view — the font lives on the Text
  // inside it, since a View can't carry text styles.
  notesBox: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 60,
  },
  notesText: {
    fontSize: 14,
    color: "#374151",
  },

  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  closeBarBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  closeBarBtnLabel: { fontSize: 15, fontWeight: "700", color: "#4b5563" },
});
