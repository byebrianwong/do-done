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
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  PRIORITY_CONFIG,
  type Task,
  type TaskPriority,
  type WhenBucket,
} from "@do-done/shared";
import {
  useAutoSaveTask,
  BusynessApi,
  type DayBusyness,
} from "@do-done/api-client";
import { supabase } from "@/lib/supabase";

// ─── Constants ──────────────────────────────────────────────

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  p1: "#ef4444",
  p2: "#f59e0b",
  p3: "#6366f1",
  p4: "#9ca3af",
};

const ESTIMATE_BUCKETS = [30, 60, 120, 240, 480, 960];

function estimateBarIndex(minutes: number | null): number {
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

function dotWidth(minutes: number): number {
  if (minutes <= 30) return 3;
  if (minutes <= 60) return 5;
  if (minutes <= 120) return 8;
  if (minutes <= 240) return 12;
  return 17;
}

// Extract whitespace-terminated `#tag` tokens from text. Partial (unterminated)
// `#word` is left alone so the user can keep typing.
function extractCompletedTags(text: string): {
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

function shortDateLabel(date: string | null, bucket: WhenBucket | null): string {
  if (date) {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  if (bucket) return bucket.replace("_", " ");
  return "Not scheduled";
}

// ─── Sub-components ─────────────────────────────────────────

// ── Picker option metadata ─────────────────────────────

const PRIORITY_PICKER_OPTIONS: { value: TaskPriority; code: string; label: string }[] = [
  { value: "p1", code: "P1", label: "Urgent" },
  { value: "p2", code: "P2", label: "High" },
  { value: "p3", code: "P3", label: "Medium" },
  { value: "p4", code: "P4", label: "Low" },
];

const ESTIMATE_PICKER_OPTIONS: {
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

function PrioritySignal({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[value];
  const color = PRIORITY_COLORS[value];
  // Bars are positioned left-to-right short→tall: indices 0..3 map to p4..p1.
  const barPriorities: TaskPriority[] = ["p4", "p3", "p2", "p1"];
  return (
    <View style={styles.barsRow}>
      {barPriorities.map((p, i) => {
        const lit = i < litCount;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            hitSlop={4}
            style={{
              width: PRI_COL_W,
              height: PRI_COL_H,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={[
                styles.priBar,
                {
                  height: PRI_BAR_HEIGHTS[i],
                  backgroundColor: lit ? color : "#e5e7eb",
                },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
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
    <View style={styles.barsRow}>
      {ESTIMATE_BUCKETS.map((minutes, i) => {
        const lit = i <= activeIdx;
        return (
          <Pressable
            key={minutes}
            onPress={() => onChange(minutes)}
            hitSlop={4}
            style={{
              width: EST_COL_W,
              height: EST_COL_H,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={[
                styles.estBar,
                {
                  height: EST_BAR_HEIGHTS[i],
                  backgroundColor: lit ? "#6366f1" : "#e5e7eb",
                },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Mobile bottom-sheet pickers ─────────────────────────

function PickerSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  accentByKey,
}: {
  visible: boolean;
  title: string;
  options: { key: string; code: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  accentByKey?: (key: string) => string;
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
                <Text style={styles.pickerCode}>{opt.code}</Text>
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

function SaveStatusDot({
  saving,
  hasError,
}: {
  saving: boolean;
  hasError: boolean;
}) {
  const color = hasError ? "#ef4444" : saving ? "#f59e0b" : "#16a34a";
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusText}>
        {hasError ? "save failed" : saving ? "saving…" : "Saved"}
      </Text>
    </View>
  );
}

function WhenCalendar({
  whenDate,
  whenBucket,
  busyness,
  onPickDate,
  onPickBucket,
}: {
  whenDate: string | null;
  whenBucket: WhenBucket | null;
  busyness: DayBusyness[];
  onPickDate: (date: string) => void;
  onPickBucket: (bucket: WhenBucket | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const todayStr = ymd(today);

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

  const busyByDate = useMemo(() => {
    const m = new Map<string, DayBusyness>();
    for (const d of busyness) m.set(d.date, d);
    return m;
  }, [busyness]);

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
        {weekRows.map((week, wi) => (
          <View key={wi} style={styles.calWeekRow}>
            {week.map((c) => {
          const isWeekend = c.weekday === 0 || c.weekday === 6;
          const isPast = c.date < todayStr;
          const isToday = c.date === todayStr;
          const isActive = whenDate === c.date;
          const numLabel = parseInt(c.date.split("-")[2], 10);
          const dots = (busyByDate.get(c.date)?.items ?? []).slice(0, 8);

          let bg = "#f9fafb";
          let borderColor: string = "transparent";
          if (isWeekend) bg = "rgba(99,102,241,0.035)";
          if (isToday) {
            bg = "#fff";
            borderColor = "#d1d5db";
          }
          if (isActive) {
            bg = "#eef2ff";
            borderColor = "#6366f1";
          }
          if (isPast) bg = "#f9fafb";

          return (
            <Pressable
              key={c.date}
              disabled={isPast}
              onPress={() => onPickDate(c.date)}
              style={[
                styles.cell,
                { backgroundColor: bg, borderColor },
                isPast && { opacity: 0.3 },
              ]}
            >
              {isToday && <View style={styles.todayDot} />}
              <Text
                style={[
                  styles.cellNum,
                  isActive && { color: "#4338ca" },
                ]}
              >
                {numLabel}
              </Text>
              {(isToday || isActive) && (
                <Text
                  style={[
                    styles.cellSub,
                    isActive && { color: "#6366f1" },
                  ]}
                >
                  {isActive ? "selected" : "today"}
                </Text>
              )}
              <View style={styles.dotsRow}>
                {dots.map((item) => {
                  const w = dotWidth(item.duration_minutes);
                  if (item.type === "event") {
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.dotEvent,
                          { width: w },
                        ]}
                      />
                    );
                  }
                  const color =
                    PRIORITY_COLORS[item.priority ?? "p3"];
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
            })}
          </View>
        ))}
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
        {(["later", "someday"] as const).map((b) => {
          const active = whenBucket === b;
          return (
            <Pressable
              key={b}
              onPress={() => onPickBucket(active ? null : b)}
              style={[
                styles.bucketChip,
                active && styles.bucketChipActive,
              ]}
            >
              <Text
                style={[
                  styles.bucketChipText,
                  active && styles.bucketChipTextActive,
                ]}
              >
                {b === "later" ? "⏳ Later" : "∞ Someday"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TagRow({
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

export default function TaskEditModalV2({
  task,
  visible,
  onClose,
  onSaved,
}: Props) {
  if (!task) return null;
  const handleClose = () => {
    onClose();
    onSaved?.();
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <Inner task={task} onClose={handleClose} />
    </Modal>
  );
}

function Inner({ task, onClose }: { task: Task; onClose: () => void }) {
  const tasksApiMemo = useMemo(() => {
    // Lazy require avoids loading TasksApi at module init.
    const { TasksApi } = require("@do-done/api-client") as typeof import("@do-done/api-client");
    return new TasksApi(supabase, task.user_id);
  }, [task.user_id]);

  const {
    task: current,
    setField,
    undoAll,
    hasChanges,
    isSaving,
    lastError,
  } = useAutoSaveTask(task, tasksApiMemo);

  const [busyness, setBusyness] = useState<DayBusyness[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = new Date();
      const sow = startOfWeek(today);
      const end = new Date(sow);
      end.setDate(end.getDate() + 13);
      const api = new BusynessApi(supabase, task.user_id);
      const { data } = await api.getTasksRange(ymd(sow), ymd(end));
      if (!cancelled) setBusyness(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.user_id]);

  const handleUndo = useCallback(async () => {
    await undoAll();
  }, [undoAll]);

  const onPickDate = (date: string) => {
    setField("when_date", date);
    setField("when_bucket", null);
  };
  const onPickBucket = (bucket: WhenBucket | null) => {
    setField("when_bucket", bucket);
    if (bucket !== null) setField("when_date", null);
  };

  const handleTitleChange = (v: string) => {
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screen}
    >
      <View style={styles.topBar}>
        {hasChanges ? (
          <Pressable onPress={handleUndo} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>↶ Cancel</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
        <SaveStatusDot saving={isSaving} hasError={!!lastError} />
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>×</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Title input */}
        <View style={styles.inputWrap}>
          <TextInput
            value={current.title}
            onChangeText={handleTitleChange}
            placeholder="Task title…"
            placeholderTextColor="#9ca3af"
            style={styles.titleInput}
            autoFocus
          />
          <TagRow
            tags={current.tags}
            onAdd={handleAddTag}
            onRemove={handleRemoveTag}
          />
        </View>

        {/* WHEN */}
        <View style={{ marginTop: 16 }}>
          <View style={styles.rowHead}>
            <Text style={styles.sectionLabel}>When</Text>
            <Text style={styles.sectionValue}>
              {shortDateLabel(current.when_date, current.when_bucket)}
            </Text>
          </View>
          <WhenCalendar
            whenDate={current.when_date}
            whenBucket={current.when_bucket}
            busyness={busyness}
            onPickDate={onPickDate}
            onPickBucket={onPickBucket}
          />
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
            setField("priority", key as TaskPriority);
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

        {/* Notes */}
        <View style={{ marginTop: 18 }}>
          <View style={styles.rowHead}>
            <Text style={styles.sectionLabel}>Notes</Text>
          </View>
          <TextInput
            value={current.description ?? ""}
            onChangeText={(v) =>
              setField("description", v.length === 0 ? null : v)
            }
            placeholder="Tap to add notes…"
            placeholderTextColor="#9ca3af"
            multiline
            style={styles.notesInput}
          />
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          onPress={() => {
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
          }}
          hitSlop={8}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteBtnLabel}>Delete</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.doneBtn}>
          <View style={styles.doneBtnCheck}>
            <Text style={styles.doneBtnCheckMark}>✓</Text>
          </View>
          <View>
            <Text style={styles.doneBtnPrimary}>Done</Text>
            <Text style={styles.doneBtnSub}>all saved</Text>
          </View>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },

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
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { fontSize: 22, color: "#6b7280", lineHeight: 24 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 12, color: "#16a34a", fontWeight: "600" },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingBottom: 24 },

  inputWrap: { marginTop: 12 },
  titleInput: {
    borderWidth: 1.5,
    borderColor: "#6366f1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
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
  todayDot: {
    position: "absolute",
    top: 3,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#6366f1",
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

  barsRow: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  priBar: { width: 7, borderRadius: 2 },
  estBar: { width: 7, borderRadius: 2 },

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
  deleteBtn: {
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  deleteBtnLabel: { color: "#dc2626", fontSize: 14, fontWeight: "700" },
  doneBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    backgroundColor: "#6366f1",
    borderRadius: 16,
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
  doneBtnCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnCheckMark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  doneBtnPrimary: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 17,
  },
  doneBtnSub: {
    fontSize: 11,
    color: "rgba(255,255,255,0.78)",
    lineHeight: 13,
  },
});
