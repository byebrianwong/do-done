/**
 * The When / Priority / Project / Estimate fields shared by every mobile
 * quick-add surface — the bar pinned above the tab bar (QuickAddBar), the
 * `dodone://quick-add` modal and the home-screen widget (QuickAddComposer).
 * Mirrors the web `QuickAddChipRow`, so a task captured on either platform can
 * be scheduled, prioritised, filed and estimated without opening the full
 * editor.
 *
 * Three pieces, kept separate because the popovers have to render *above* the
 * card while the chips live *inside* it:
 *
 *  - {@link useQuickAddFields} — the state (chips + typed `#tags`), the merge
 *    with the natural-language parse, and reset.
 *  - {@link QuickAddChipRow} — the tappable chips, placed inside the card.
 *  - {@link QuickAddPickers} — the popovers + the full month grid, placed
 *    above the card in the same view hierarchy.
 *
 * The options render as inline popovers in the *same window*, never as a
 * `Modal`: on Android a Modal opens a new window, which drops the IME and
 * collapses the composer back down. Only the full month calendar — too tall to
 * float over the keyboard — takes over the screen, and the host hands focus
 * back to its input when it closes.
 *
 * Nothing here may call a TanStack Query hook: the widget mounts its own React
 * root with no QueryClientProvider (see lib/task-queries.ts). Hosts that have a
 * provider pass `projects` in; the widget omits it and the Project chip hides.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  BackHandler,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  extractTitleShortcuts,
  formatScheduleHint,
  resolveQuickSchedule,
  type CreateTaskInput,
  type Project,
  type ProjectRef,
  type TaskPriority,
} from '@do-done/shared';
import {
  PickerSheet,
  ScheduleCalendar,
  PRIORITY_PICKER_OPTIONS,
  ESTIMATE_PICKER_OPTIONS,
  PRIORITY_COLORS,
  shortDateLabel,
} from './TaskEditModalV2';

/** Which chip's popover is open, if any. */
export type QuickAddMenu = 'scheduled' | 'priority' | 'project' | 'estimate' | null;

type ChipKey = Exclude<QuickAddMenu, null>;

interface MenuItem {
  key: string;
  label: string;
  /** Muted right-hand annotation, e.g. the concrete date behind "Tomorrow". */
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  selected?: boolean;
}

const POPOVER_WIDTH = 252;

/** What the hosting surface implies about the task before the user touches it. */
export interface QuickAddSeed {
  /** Pre-file into this project (the project detail screen). */
  projectId?: string | null;
}

export function durationLabel(minutes: number | null): string {
  if (!minutes) return 'Estimate';
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface QuickAddFields {
  tags: string[];
  priority: TaskPriority | null;
  scheduledDate: string | null;
  duration: number | null;
  projectId: string | null;
  setPriority: (p: TaskPriority | null) => void;
  setScheduledDate: (d: string | null) => void;
  setDuration: (m: number | null) => void;
  setProjectId: (id: string | null) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  /**
   * Pull `#token` shortcuts out of the title as they're typed (same behavior as
   * the detailed editor) and return the text to keep. `#p1`…`#p4` set the
   * priority, `#xs`…`#xxl` the estimate, a token naming one of the `projects`
   * passed to the hook files it there; anything else becomes a tag.
   *
   * Pass `flushTrailing` from blur/submit, where end-of-input terminates the
   * last token — otherwise a trailing `#xs` never lands anywhere.
   */
  absorbTags: (value: string, flushTrailing?: boolean) => string;
  menu: QuickAddMenu;
  setMenu: (menu: QuickAddMenu) => void;
  toggleMenu: (menu: ChipKey) => void;
  /** onLayout handler recording where a chip sits, so its popover lines up. */
  anchorFor: (chip: ChipKey) => (e: LayoutChangeEvent) => void;
  anchors: Record<ChipKey, number>;
  /** Left inset of the chip row inside the card (its parent's padding). */
  rowOffset: number;
  setRowOffset: (x: number) => void;
  calendarOpen: boolean;
  setCalendarOpen: (open: boolean) => void;
  /** True once the user has chosen anything — keeps a surface expanded. */
  anySet: boolean;
  /** Back to the seed: what a surface does after a successful create. */
  reset: () => void;
  /**
   * Merge the typed text's parse with the chips into a `CreateTaskInput`.
   * Explicit chip selections win over parsed syntax, since picking a chip is a
   * deliberate act (matches the web `applyOverride` precedence).
   */
  buildInput: (
    raw: string,
    opts?: { status?: 'inbox' | 'not_started' }
  ) => CreateTaskInput;
}

/**
 * @param projects  The user's projects, so a typed `#name` files the task there
 *   instead of tagging it. Surfaces that can't load them (the widget root has
 *   no QueryClientProvider) omit the list and every `#token` stays a tag.
 */
export function useQuickAddFields(
  seed: QuickAddSeed = {},
  projects?: readonly ProjectRef[]
): QuickAddFields {
  const seedProjectId = seed.projectId ?? null;

  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | null>(seedProjectId);

  const [menu, setMenu] = useState<QuickAddMenu>(null);
  const [anchors, setAnchors] = useState<Record<ChipKey, number>>({
    scheduled: 0,
    priority: 0,
    project: 0,
    estimate: 0,
  });
  const [rowOffset, setRowOffset] = useState(0);
  /** The full month grid — the one picker too tall to float over the keyboard. */
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Back closes an open popover instead of tearing down the whole surface —
  // the hosts' back handling only takes over once nothing is layered on top.
  useEffect(() => {
    if (menu === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMenu(null);
      return true;
    });
    return () => sub.remove();
  }, [menu]);

  const anchorFor = (chip: ChipKey) => (e: LayoutChangeEvent) => {
    const { x } = e.nativeEvent.layout;
    setAnchors((prev) => (prev[chip] === x ? prev : { ...prev, [chip]: x }));
  };

  const toggleMenu = (next: ChipKey) =>
    setMenu((current) => (current === next ? null : next));

  const addTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  const removeTag = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  const absorbTags = (value: string, flushTrailing = false): string => {
    const {
      stripped,
      tags: extracted,
      priority: extractedPriority,
      durationMinutes: extractedDuration,
      projectId: extractedProjectId,
    } = extractTitleShortcuts(value, flushTrailing, projects);
    if (
      extracted.length === 0 &&
      extractedPriority === undefined &&
      extractedDuration === undefined &&
      extractedProjectId === undefined
    ) {
      return value;
    }
    if (extracted.length > 0) {
      setTags((prev) => {
        const seen = new Set(prev);
        const fresh = extracted.filter((t) => !seen.has(t));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    }
    // A typed token fills the chip the same way tapping the chip would.
    if (extractedPriority) setPriority(extractedPriority);
    if (extractedDuration) setDuration(extractedDuration);
    if (extractedProjectId) setProjectId(extractedProjectId);
    return stripped;
  };

  const reset = () => {
    setTags([]);
    setPriority(null);
    setScheduledDate(null);
    setDuration(null);
    setProjectId(seedProjectId);
    setMenu(null);
  };

  const buildInput: QuickAddFields['buildInput'] = (raw, opts = {}) => {
    const trimmed = raw.trim();
    const parsed = parseTaskInput(trimmed, undefined, { projects });
    const mergedTags = Array.from(new Set([...tags, ...(parsed.tags ?? [])]));
    const finalPriority = priority ?? parsed.priority ?? undefined;
    const finalDuration = duration ?? parsed.duration_minutes ?? undefined;
    const finalScheduledDate = scheduledDate ?? parsed.scheduled_date ?? undefined;
    // The chip already carries anything the absorber pulled out of the text;
    // the parse is what catches a trailing `#name` typed without a space after.
    const finalProjectId = projectId ?? parsed.project_id ?? undefined;

    return {
      title: parsed.title || trimmed,
      ...(opts.status && { status: opts.status }),
      ...(finalProjectId && { project_id: finalProjectId }),
      ...(finalPriority && { priority: finalPriority }),
      ...(finalScheduledDate && { scheduled_date: finalScheduledDate }),
      // Only meaningful alongside a date, which `finalScheduledDate` guarantees
      // whenever the parser produced a time.
      ...(parsed.scheduled_time && { scheduled_time: parsed.scheduled_time }),
      ...(parsed.deadline_date && { deadline_date: parsed.deadline_date }),
      ...(parsed.deadline_time && { deadline_time: parsed.deadline_time }),
      ...(finalDuration && { duration_minutes: finalDuration }),
      ...(mergedTags.length > 0 && { tags: mergedTags }),
      ...(parsed.recurrence_rule && {
        recurrence_rule: parsed.recurrence_rule,
      }),
    };
  };

  const anySet =
    priority !== null ||
    scheduledDate !== null ||
    duration !== null ||
    tags.length > 0 ||
    projectId !== seedProjectId;

  return {
    tags,
    priority,
    scheduledDate,
    duration,
    projectId,
    setPriority,
    setScheduledDate,
    setDuration,
    setProjectId,
    addTag,
    removeTag,
    absorbTags,
    menu,
    setMenu,
    toggleMenu,
    anchorFor,
    anchors,
    // Recorded by QuickAddChipRow's onLayout; QuickAddPickers adds it to a
    // chip's own x to line the popover up with the chip that opened it.
    rowOffset,
    setRowOffset,
    calendarOpen,
    setCalendarOpen,
    anySet,
    reset,
    buildInput,
  };
}

/**
 * A chip's options, floating directly above the card and anchored to the chip
 * that opened it. Lives in the composer's own view hierarchy so the text input
 * never loses focus — the whole point of the surface.
 */
function Popover({
  left,
  items,
  onSelect,
}: {
  left: number;
  items: MenuItem[];
  onSelect: (key: string) => void;
}) {
  return (
    <View style={[styles.popover, { marginLeft: left }]}>
      <ScrollView
        style={styles.popoverScroll}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [
              styles.menuRow,
              pressed && styles.menuRowPressed,
            ]}
          >
            <Ionicons name={item.icon} size={17} color={item.color ?? '#6b7280'} />
            <Text style={styles.menuLabel} numberOfLines={1}>
              {item.label}
            </Text>
            {item.hint ? <Text style={styles.menuHint}>{item.hint}</Text> : null}
            {item.selected ? (
              <Ionicons name="checkmark" size={16} color="#6366f1" />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** A single chip: icon + label, tinted once the field carries a value. */
function Chip({
  icon,
  label,
  active,
  open,
  color,
  iconColor,
  onPress,
  onLayout,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  open: boolean;
  /** Overrides the active tint for both icon and label (priority's own colour). */
  color?: string;
  /**
   * Tints only the icon, leaving the label on the standard active indigo — for
   * a project's colour, which is arbitrary and can read faint as body text.
   */
  iconColor?: string;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const tint = active ? color ?? '#4338ca' : '#6b7280';
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive, open && styles.chipOpen]}
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <Ionicons name={icon} size={15} color={active ? iconColor ?? tint : tint} />
      <Text
        style={[styles.chipText, active && { color: tint, fontWeight: '700' }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The chip row itself. Goes inside the card, under the title input. The
 * Project chip appears only when the host passed a project list.
 */
export function QuickAddChipRow({
  fields,
  projects,
  style,
}: {
  fields: QuickAddFields;
  projects?: Project[];
  style?: StyleProp<ViewStyle>;
}) {
  const { priority, scheduledDate, duration, projectId, menu, setRowOffset } = fields;
  const project = projects?.find((p) => p.id === projectId) ?? null;

  return (
    <View
      style={[styles.chipRow, style]}
      onLayout={(e) => setRowOffset(e.nativeEvent.layout.x)}
    >
      <Chip
        icon="calendar-outline"
        label={scheduledDate ? shortDateLabel(scheduledDate) : 'Date'}
        active={!!scheduledDate}
        open={menu === 'scheduled'}
        onPress={() => fields.toggleMenu('scheduled')}
        onLayout={fields.anchorFor('scheduled')}
      />
      <Chip
        icon="flag"
        label={priority ? PRIORITY_CONFIG[priority].label : 'Priority'}
        active={!!priority}
        open={menu === 'priority'}
        color={priority ? PRIORITY_COLORS[priority] : undefined}
        onPress={() => fields.toggleMenu('priority')}
        onLayout={fields.anchorFor('priority')}
      />
      {projects ? (
        <Chip
          icon="folder-outline"
          label={
            project
              ? `${project.icon ? `${project.icon} ` : ''}${project.name}`
              : 'Project'
          }
          active={!!project}
          open={menu === 'project'}
          iconColor={project?.color}
          onPress={() => fields.toggleMenu('project')}
          onLayout={fields.anchorFor('project')}
        />
      ) : null}
      <Chip
        icon="time-outline"
        label={durationLabel(duration)}
        active={!!duration}
        open={menu === 'estimate'}
        onPress={() => fields.toggleMenu('estimate')}
        onLayout={fields.anchorFor('estimate')}
      />
    </View>
  );
}

/**
 * The open chip's options, plus the full month grid. Render this as a sibling
 * *above* the card, inside the same full-width container — it measures itself
 * to keep a popover from running off either edge.
 */
export function QuickAddPickers({
  fields,
  projects,
  /** Called after the month grid closes, so the host can refocus its input. */
  onCalendarClosed,
}: {
  fields: QuickAddFields;
  projects?: Project[];
  onCalendarClosed?: () => void;
}) {
  const { menu, scheduledDate, priority, duration, projectId } = fields;
  const [width, setWidth] = useState(0);

  // Resolve the shortcuts once per render so the label, the hint and the
  // selected checkmark all agree on what "This weekend" means today.
  const quickDates = useMemo(
    () => QUICK_SCHEDULE.map((q) => ({ ...q, date: resolveQuickSchedule(q.key) })),
    []
  );

  // Keys are the shortcut names, not the dates they resolve to: on a Friday
  // "Today" and "This week" land on the same date, and duplicate keys would
  // collide.
  const scheduledItems: MenuItem[] = [
    ...quickDates.map((q) => ({
      key: q.key,
      label: q.label,
      hint: formatScheduleHint(q.date),
      icon: 'calendar-outline' as const,
      color: '#6366f1',
      selected: scheduledDate === q.date,
    })),
    {
      key: 'custom',
      label: 'Pick a date…',
      icon: 'calendar-number-outline' as const,
      color: '#6b7280',
      // A date nothing in the shortcut list covers still shows as chosen here.
      selected: !!scheduledDate && !quickDates.some((q) => q.date === scheduledDate),
    },
    ...(scheduledDate
      ? [
          {
            key: 'none',
            label: 'No date',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const priorityItems: MenuItem[] = [
    ...PRIORITY_PICKER_OPTIONS.map((p) => ({
      key: p.value,
      label: p.label,
      hint: p.code,
      icon: 'flag' as const,
      color: PRIORITY_COLORS[p.value],
      selected: priority === p.value,
    })),
    ...(priority
      ? [
          {
            key: 'none',
            label: 'No priority',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const estimateItems: MenuItem[] = [
    ...ESTIMATE_PICKER_OPTIONS.map((b) => ({
      key: String(b.minutes),
      label: b.label,
      hint: b.code,
      icon: 'time-outline' as const,
      color: '#6366f1',
      selected: duration === b.minutes,
    })),
    ...(duration
      ? [
          {
            key: 'none',
            label: 'No estimate',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const projectItems: MenuItem[] = [
    ...(projects ?? []).map((p) => ({
      key: p.id,
      label: `${p.icon ? `${p.icon} ` : ''}${p.name}`,
      icon: 'folder' as const,
      color: p.color,
      selected: projectId === p.id,
    })),
    ...(projectId
      ? [
          {
            key: 'none',
            label: 'No project',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const selectScheduled = (key: string) => {
    fields.setMenu(null);
    if (key === 'custom') {
      fields.setCalendarOpen(true);
      return;
    }
    if (key === 'none') {
      fields.setScheduledDate(null);
      return;
    }
    fields.setScheduledDate(quickDates.find((q) => q.key === key)?.date ?? null);
  };

  const selectPriority = (key: string) => {
    // Picking the priority already on the draft clears it, so the chip is a
    // toggle as well as a picker — the explicit "No priority" row stays for
    // discoverability.
    const cleared = key === 'none' || key === priority;
    fields.setPriority(cleared ? null : (key as TaskPriority));
    fields.setMenu(null);
  };

  const selectEstimate = (key: string) => {
    fields.setDuration(key === 'none' ? null : parseInt(key, 10));
    fields.setMenu(null);
  };

  const selectProject = (key: string) => {
    fields.setProjectId(key === 'none' ? null : key);
    fields.setMenu(null);
  };

  const closeCalendar = () => {
    fields.setCalendarOpen(false);
    // The month grid is a Modal, so it took the keyboard with it. Hand focus
    // back so the user carries on typing where they left off.
    onCalendarClosed?.();
  };

  const anchorLeft = (chip: ChipKey) =>
    width
      ? clamp(
          fields.rowOffset + fields.anchors[chip],
          0,
          Math.max(width - POPOVER_WIDTH, 0)
        )
      : fields.rowOffset;

  return (
    <View
      style={styles.pickerHost}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      pointerEvents="box-none"
    >
      {menu === 'scheduled' && (
        <Popover
          left={anchorLeft('scheduled')}
          items={scheduledItems}
          onSelect={selectScheduled}
        />
      )}
      {menu === 'priority' && (
        <Popover
          left={anchorLeft('priority')}
          items={priorityItems}
          onSelect={selectPriority}
        />
      )}
      {menu === 'project' && (
        <Popover
          left={anchorLeft('project')}
          items={projectItems}
          onSelect={selectProject}
        />
      )}
      {menu === 'estimate' && (
        <Popover
          left={anchorLeft('estimate')}
          items={estimateItems}
          onSelect={selectEstimate}
        />
      )}

      {/* Full month grid — the one picker that needs the whole screen. */}
      <PickerSheet
        visible={fields.calendarOpen}
        title="Date"
        options={[]}
        selectedKey=""
        onSelect={() => {}}
        onClose={closeCalendar}
        header={
          <ScheduleCalendar
            scheduledDate={fields.scheduledDate}
            busyness={[]}
            onPickDate={(date) => {
              fields.setScheduledDate(date);
              closeCalendar();
            }}
          />
        }
      />
    </View>
  );
}

/**
 * Full-bleed catcher that closes an open popover on an outside tap — and only
 * the popover, so a host's own backdrop underneath still dismisses the whole
 * surface. Render it before the popovers so they stay on top.
 */
export function QuickAddMenuScrim({ fields }: { fields: QuickAddFields }) {
  if (fields.menu === null) return null;
  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => fields.setMenu(null)}
    />
  );
}

const styles = StyleSheet.create({
  // Zero-height when nothing is open; still full width, which is what the
  // popovers clamp against.
  pickerHost: {
    alignSelf: 'stretch',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f3f4f6',
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: '#eef2ff',
  },
  // The chip stays visibly "held down" while its popover is open, so the two
  // read as one control.
  chipOpen: {
    backgroundColor: '#e0e7ff',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  popover: {
    alignSelf: 'flex-start',
    width: POPOVER_WIDTH,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  popoverScroll: {
    // Tall enough for every menu we show, short enough to never crowd the card.
    maxHeight: 320,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuRowPressed: {
    backgroundColor: '#f3f4f6',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  menuHint: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
  },
});
