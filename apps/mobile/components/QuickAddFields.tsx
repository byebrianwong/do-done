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
 * Nothing here may call a TanStack Query hook, and nothing here may reach for
 * the API directly: the widget mounts its own React root with no
 * QueryClientProvider (see lib/task-queries.ts). Both the project list and the
 * "create a project" action are handed in by the host, which is the only piece
 * that knows whether there's a query cache behind it to keep in step.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  BackHandler,
  TextInput,
  ActivityIndicator,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import {
  COMPACT_PROJECT_COLORS,
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  extractTitleShortcuts,
  formatScheduleHint,
  resolveQuickSchedule,
  type CreateTaskInput,
  type Project,
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
  /**
   * The list the Project chip renders and a typed `#name` matches against: the
   * host's projects plus anything created from the chip since. Undefined on a
   * surface that can't supply one, which is what hides the chip.
   */
  projects?: Project[];
  /** Fold a just-created project into {@link projects} without a refetch. */
  addProject: (project: Project) => void;
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
    opts?: {
      status?: 'inbox' | 'not_started';
      /**
       * Body text the typed line can't express. Only dictation produces one
       * today: a spoken task longer than a title keeps its remainder here
       * rather than being truncated away.
       */
      description?: string;
    }
  ) => CreateTaskInput;
}

/**
 * @param hostProjects  The user's projects, so a typed `#name` files the task
 *   there instead of tagging it. Omit and the Project chip hides and every
 *   `#token` stays a tag — which is what a surface still loading its list
 *   looks like for the first frame, not a permanent state of any surface.
 */
export function useQuickAddFields(
  seed: QuickAddSeed = {},
  hostProjects?: Project[]
): QuickAddFields {
  const seedProjectId = seed.projectId ?? null;

  // Projects created from the chip. Merged over the host's list rather than
  // replacing it, and deduped by id, because a query-backed host refetches and
  // will hand the same project back a moment later.
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const projects = useMemo(() => {
    if (!hostProjects || !createdProjects.length) return hostProjects;
    const seen = new Set(hostProjects.map((p) => p.id));
    return [...hostProjects, ...createdProjects.filter((p) => !seen.has(p.id))];
  }, [hostProjects, createdProjects]);

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

  const addProject = (project: Project) =>
    setCreatedProjects((prev) =>
      prev.some((p) => p.id === project.id) ? prev : [...prev, project]
    );

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
      ...(opts.description?.trim() && { description: opts.description.trim() }),
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
    projects,
    addProject,
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

/**
 * Name + colour, in the Project popover's own footprint. Deliberately not the
 * app's `ProjectPickerSheet`: that's a `Modal`, which on Android opens a second
 * window and drops the IME — the one thing every surface here is built to
 * avoid. Filing a task under a project that doesn't exist yet is a capture
 * problem, so it has to be solvable without leaving capture.
 */
function NewProjectForm({
  left,
  onCancel,
  onSubmit,
}: {
  left: number;
  onCancel: () => void;
  /** Returns true once the project exists; false leaves the form up. */
  onSubmit: (name: string, color: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(COMPACT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setFailed(false);
    const ok = await onSubmit(trimmed, color);
    setSaving(false);
    if (!ok) setFailed(true);
  };

  return (
    <View style={[styles.popover, styles.newProject, { marginLeft: left }]}>
      <TextInput
        style={styles.newProjectInput}
        value={name}
        onChangeText={setName}
        placeholder="Project name"
        placeholderTextColor="#9ca3af"
        autoFocus
        returnKeyType="done"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        editable={!saving}
      />
      <View style={styles.swatchRow}>
        {COMPACT_PROJECT_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Colour ${c}`}
            style={[
              styles.swatch,
              { backgroundColor: c },
              c === color && styles.swatchSelected,
            ]}
          />
        ))}
      </View>
      {failed ? (
        <Text style={styles.newProjectError}>Couldn’t create that project.</Text>
      ) : null}
      <View style={styles.newProjectActions}>
        <Pressable onPress={onCancel} hitSlop={6}>
          <Text style={styles.newProjectCancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!name.trim() || saving}
          style={[
            styles.newProjectSubmit,
            (!name.trim() || saving) && styles.newProjectSubmitMuted,
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.newProjectSubmitText}>Create</Text>
          )}
        </Pressable>
      </View>
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
 * Project chip appears only once `fields.projects` has a list to show.
 */
export function QuickAddChipRow({
  fields,
  style,
}: {
  fields: QuickAddFields;
  style?: StyleProp<ViewStyle>;
}) {
  const {
    priority,
    scheduledDate,
    duration,
    projectId,
    projects,
    menu,
    setRowOffset,
  } = fields;
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
  /**
   * Hand focus back to the host's title input. Fired by the two pickers that
   * take focus away from it — the month grid (a Modal, which takes the keyboard
   * with it) and the inline New project form (its own TextInput) — so the user
   * carries on typing the task where they left off.
   */
  onReturnFocus,
  onCreateProject,
}: {
  fields: QuickAddFields;
  onReturnFocus?: () => void;
  /**
   * Provision a project from inside the Project popover; returns it on success,
   * null on failure. Supplied by the host because only it knows what else has
   * to hear about the new project — a query cache to invalidate, or, on the
   * widget root, nothing at all. Omit and the "New project" row doesn't appear.
   */
  onCreateProject?: (name: string, color: string) => Promise<Project | null>;
}) {
  const { menu, scheduledDate, priority, duration, projectId, projects } = fields;
  const [width, setWidth] = useState(0);
  /** The Project popover's inline create form, when it's showing one. */
  const [creatingProject, setCreatingProject] = useState(false);

  // A popover that closes takes its create form with it, so reopening the chip
  // always lands on the list rather than on a half-typed name.
  useEffect(() => {
    if (menu !== 'project') setCreatingProject(false);
  }, [menu]);

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
    ...(onCreateProject
      ? [
          {
            key: '__new',
            label: 'New project…',
            icon: 'add-circle-outline' as const,
            color: '#6366f1',
          },
        ]
      : []),
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
    if (key === '__new') {
      setCreatingProject(true);
      return;
    }
    fields.setProjectId(key === 'none' ? null : key);
    fields.setMenu(null);
  };

  /** Back to the project list. The form owned the focus; give it back. */
  const cancelNewProject = () => {
    setCreatingProject(false);
    onReturnFocus?.();
  };

  const submitNewProject = async (name: string, color: string) => {
    const created = await onCreateProject?.(name, color);
    if (!created) return false;
    // Into the local list first: the host may be refetching, and the chip has
    // to be able to name the project it is already showing as selected.
    fields.addProject(created);
    fields.setProjectId(created.id);
    setCreatingProject(false);
    fields.setMenu(null);
    onReturnFocus?.();
    return true;
  };

  const closeCalendar = () => {
    fields.setCalendarOpen(false);
    // The month grid is a Modal, so it took the keyboard with it. Hand focus
    // back so the user carries on typing where they left off.
    onReturnFocus?.();
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
      {menu === 'project' &&
        (creatingProject ? (
          <NewProjectForm
            left={anchorLeft('project')}
            onCancel={cancelNewProject}
            onSubmit={submitNewProject}
          />
        ) : (
          <Popover
            left={anchorLeft('project')}
            items={projectItems}
            onSelect={selectProject}
          />
        ))}
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
  newProject: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
  },
  newProjectInput: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 6,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: '#111827',
  },
  newProjectError: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '500',
  },
  newProjectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  newProjectCancel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  newProjectSubmit: {
    minWidth: 66,
    alignItems: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  newProjectSubmitMuted: {
    backgroundColor: '#c7d2fe',
  },
  newProjectSubmitText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
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
