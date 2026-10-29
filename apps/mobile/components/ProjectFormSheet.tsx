/**
 * Bottom-sheet form to create *or* edit a project or list on mobile
 * (name + icon + color). Mirrors the web ProjectForm, which is one component
 * for both modes for the same reason: everything on it is identical, and the
 * only differences are the verb on the button and whether Delete is offered.
 *
 * Writes go through createProject / updateProject / deleteProject, which
 * invalidate the project caches, including the detail read a list screen's
 * title bar uses, so a rename shows there without a refocus.
 *
 * **The sheet is an overlay at the app root, not a `Modal`.** On Android,
 * React Native 0.81 draws a `Modal` in its own window, and with edge-to-edge
 * on that window ignores `adjustResize`. Reanimated's `useAnimatedKeyboard`
 * only watches the activity's window, so it cannot see a keyboard raised over
 * a `Modal` either. The result was a sheet that focused its name field and
 * then sat behind the keyboard, with only its title showing.
 *
 * So `ProjectFormHost` is mounted once in `app/_layout.tsx`, after the
 * navigator. It draws over the tab bar the way `BulkActionBar` does, it is in
 * the activity's window, and it lifts the sheet by the keyboard's height every
 * frame, like `QuickAddComposer`. Screens open it with `openProjectForm`.
 *
 * The motion is the shared `useSheetMotion`, the same one every `BottomSheet`
 * uses: the sheet rises on its own wrapper while the backdrop darkens with it,
 * and slides back down before the host unmounts it. The keyboard lift stays
 * padding on the frame around that wrapper, so the two never touch the same
 * property.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  PROJECT_COLOR_OPTIONS,
  DEFAULT_PROJECT_COLORS,
  isShoppingList,
  projectKind,
} from '@do-done/shared';
import { createProject, deleteProject, updateProject } from '@/lib/task-queries';
import { invalidateLists } from '@/lib/list-queries';
import { pinListShortcut } from '@/lib/list-shortcuts';
import type { Project, ProjectKind } from '@do-done/shared';
import { ProjectIconPicker } from '@/components/ProjectIconPicker';
import { useSheetMotion } from '@/components/BottomSheet';

export interface ProjectFormRequest {
  // A shopping list is the same row with a different `kind`, so this is the
  // same sheet with different words on it rather than a copy of it.
  kind?: ProjectKind;
  /** Present = edit mode, absent = create mode. */
  project?: Project;
  /**
   * Called after a delete lands. The screen that opened this sheet is usually
   * the deleted row's own screen, so it has to leave. The sheet cannot know
   * where to.
   */
  onDeleted?: () => void;
}

type Opener = (request: ProjectFormRequest) => void;

let opener: Opener | null = null;

/**
 * Open the form over the whole app.
 *
 * Does nothing before `ProjectFormHost` has mounted, and nothing while signed
 * out, since the host is unmounted with the navigator.
 */
export function openProjectForm(request: ProjectFormRequest = {}): void {
  opener?.(request);
}

/** The one place the form is drawn. Mounted once, after the root navigator. */
export function ProjectFormHost() {
  const [request, setRequest] = useState<
    (ProjectFormRequest & { key: number }) | null
  >(null);
  // Separate from `request`: closing slides the sheet away first, and the
  // request is cleared only once it has gone.
  const [visible, setVisible] = useState(false);
  const nextKey = useRef(0);

  useEffect(() => {
    // A new key per request, so a sheet opened while the last one is still
    // leaving is a fresh form rather than the old one's draft.
    const open: Opener = (next) => {
      nextKey.current += 1;
      setRequest({ ...next, key: nextKey.current });
      setVisible(true);
    };
    opener = open;
    return () => {
      // Only clear if it is still ours: a remount can install the new one
      // before the old one's cleanup runs.
      if (opener === open) opener = null;
    };
  }, []);

  const close = useCallback(() => setVisible(false), []);
  const exited = useCallback(() => setRequest(null), []);

  if (!request) return null;
  const { key, ...rest } = request;
  return (
    <ProjectFormSheet
      key={key}
      {...rest}
      visible={visible}
      onClose={close}
      onExited={exited}
    />
  );
}

function ProjectFormSheet({
  kind = 'tasks',
  project,
  onDeleted,
  visible,
  onClose,
  onExited,
}: ProjectFormRequest & {
  visible: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  // In edit mode the row already knows what it is; `kind` describes what is
  // being created and is ignored.
  const effectiveKind: ProjectKind = project ? projectKind(project) : kind;
  // Seeded once. The sheet mounts on open and unmounts on close, so re-opening
  // after a cancelled edit shows what is saved, not what was abandoned. A
  // refetch of the row while the sheet is open does not overwrite the draft.
  const [name, setName] = useState(project?.name ?? '');
  const [icon, setIcon] = useState(project?.icon ?? '');
  const [color, setColor] = useState<string>(
    project?.color ?? DEFAULT_PROJECT_COLORS[0]
  );
  // A new list starts as a shopping list, which is what nearly every list is.
  const [shopping, setShopping] = useState(
    project ? isShoppingList(project) : true
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const noun = effectiveKind === 'list' ? 'list' : 'project';

  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  // The sheet already pads itself clear of the gesture bar, and the reported
  // keyboard height covers that same strip, so lift by the difference.
  // Padding rather than a transform: the frame has to shrink, so that a sheet
  // taller than the space left above the keyboard scrolls instead of running
  // off the top of the screen.
  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value - insets.bottom, 0),
  }));

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // The keyboard is going down while the sheet is, so the sheet travels its
  // own height plus the lift it had when the exit began.
  const motion = useSheetMotion(visible, onExited, () =>
    Math.max(keyboard.height.value - insets.bottom, 0)
  );

  // Android's back button closes the sheet. `Modal`'s onRequestClose used to.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      /*
        `is_shopping` is sent only when it says something the column default
        does not: false on create, and a change on edit. A rename from this
        bundle against a database that has not had the migration yet would
        otherwise name a column the table lacks, and fail.
      */
      const isList = effectiveKind === 'list';
      if (project) {
        const shoppingChanged = isList && isShoppingList(project) !== shopping;
        await updateProject(project.id, {
          name: trimmed,
          color,
          // An emptied icon field is a real answer — it clears the glyph and
          // leaves the ring its colour — so it is sent as null, not dropped.
          icon: icon.trim() || null,
          ...(shoppingChanged ? { is_shopping: shopping } : {}),
        });
      } else {
        await createProject({
          name: trimmed,
          color,
          icon: icon.trim() || undefined,
          kind: effectiveKind,
          ...(isList && !shopping ? { is_shopping: false } : {}),
        });
      }
      // The lists index is its own query root, so the project caches these
      // writes invalidate don't reach it: without this a list created here
      // left the screen still saying "No lists yet" until it was re-focused.
      invalidateLists();
      setSaving(false);
      close();
    } catch (e) {
      setSaving(false);
      setError(
        e instanceof Error
          ? e.message
          : `Could not ${project ? 'save' : 'create'} ${noun}`
      );
    }
  };

  /**
   * Deleting is behind a confirm, unlike deleting a task.
   *
   * A task has an undo toast and `restore()` behind it; a project delete has
   * neither, and it unfiles everything that pointed at the row. So this is the
   * one place in the app where asking first is still the right call.
   */
  const confirmDelete = () => {
    if (!project) return;
    Alert.alert(
      `Delete "${project.name}"?`,
      effectiveKind === 'list'
        ? 'Everything on it will be unfiled.'
        : 'Tasks in it will be unassigned.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await deleteProject(project.id);
              invalidateLists();
              setSaving(false);
              close();
              onDeleted?.();
            } catch (e) {
              setSaving(false);
              setError(
                e instanceof Error ? e.message : `Could not delete ${noun}`
              );
            }
          },
        },
      ]
    );
  };

  /**
   * Put this list on the home screen as its own icon, labelled with its name.
   *
   * Here rather than in the list's title bar, which already spends its two
   * slots on "Put away" and the pencil — a third icon for something done once
   * in a list's life is the trade this app keeps refusing. This sheet is
   * already where the once-per-list answers live, Delete among them.
   *
   * Lists only, and Android only. A project has no equivalent because nothing
   * on the phone treats one as a place you return to daily, and iOS home
   * screen icons cannot be created by an app at all.
   */
  const canPin =
    Platform.OS === 'android' && !!project && effectiveKind === 'list';

  const pin = async () => {
    if (!project) return;
    const result = await pinListShortcut(project);
    // Only the failures speak. Android raises its own "Add to home screen"
    // dialog and never reports what the user chose, so a success message here
    // would be a guess — and the sheet stays open behind that dialog rather
    // than closing, which would throw away a half-typed rename.
    if (result !== 'requested') {
      setError(
        result === 'unsupported'
          ? 'This launcher cannot add shortcuts'
          : 'Could not add this list to the home screen'
      );
    }
  };

  const disabled = !name.trim() || saving;

  return (
    // A sheet on its way out takes no more taps, so the screen under it is
    // live again as soon as the slide starts.
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, motion.backdropStyle]}
      />
      <Pressable
        onPress={close}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <Animated.View
        pointerEvents="box-none"
        style={[styles.frame, { paddingTop: insets.top + 12 }, liftStyle]}
      >
        <Animated.View
          onLayout={motion.onLayout}
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 16 },
            motion.sheetStyle,
          ]}
        >
          <Text style={styles.title}>
            {project ? `Edit ${noun}` : `New ${noun}`}
          </Text>

          {/* The fields scroll and the buttons below them do not, so Create
              stays reachable when the keyboard and an open icon grid leave
              little room. */}
          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              ref={inputRef}
              value={name}
              onChangeText={setName}
              onSubmitEditing={submit}
              placeholder={
                effectiveKind === 'list'
                  ? 'Groceries, Amazon…'
                  : 'Project name…'
              }
              placeholderTextColor="#9ca3af"
              maxLength={100}
              style={styles.input}
            />

            <View style={styles.swatchRow}>
              {PROJECT_COLOR_OPTIONS.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setColor(c.value)}
                  accessibilityRole="button"
                  accessibilityLabel={c.name}
                  accessibilityState={{ selected: color === c.value }}
                  style={[
                    styles.swatch,
                    { backgroundColor: c.value },
                    color === c.value && styles.swatchActive,
                  ]}
                />
              ))}
            </View>

            <ProjectIconPicker value={icon} onChange={setIcon} color={color} />

            {effectiveKind === 'list' ? (
              /*
                Lists only. On, the list groups by aisle, takes `@store`, keeps
                a pantry and joins All shopping. Off, it is a plain checklist.
                Switching changes no item: an item on either is still an item,
                so the switch can be flipped back without losing anything.
              */
              <View style={styles.shoppingRow}>
                <View style={styles.shoppingText}>
                  <Text style={styles.shoppingLabel}>Shopping list</Text>
                  <Text style={styles.shoppingHint}>
                    {shopping
                      ? 'Grouped by aisle, with shops and what you bought before. Shown in All shopping.'
                      : 'A plain checklist. No aisles, shops or pantry.'}
                  </Text>
                </View>
                <Switch
                  value={shopping}
                  onValueChange={setShopping}
                  disabled={saving}
                  trackColor={{ true: '#6366f1', false: '#d1d5db' }}
                  accessibilityLabel="Shopping list"
                />
              </View>
            ) : null}

            {canPin ? (
              <Pressable
                onPress={pin}
                disabled={saving}
                style={({ pressed }) => [
                  styles.pinRow,
                  pressed && styles.pinRowPressed,
                ]}
                accessibilityRole="button"
                /* The saved name, not the draft: the shortcut is built from
                   the row, and a rename typed above reaches the icon through
                   `updateShortcuts` on the next save rather than through
                   this. */
                accessibilityLabel={`Add ${project?.name ?? 'this list'} to the home screen`}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={17}
                  color="#6366f1"
                />
                <Text style={styles.pinText}>Add to Home screen</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {/* Left of the row, away from Save, because it is the one control
                here that cannot be taken back. */}
            {project && (
              <Pressable
                onPress={confirmDelete}
                disabled={saving}
                style={styles.delete}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            )}
            <View style={styles.actionsSpacer} />
            <Pressable onPress={close} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={disabled}
              style={[styles.createBtn, disabled && styles.createBtnDisabled]}
            >
              <Text style={styles.createBtnText}>
                {saving
                  ? project
                    ? 'Saving…'
                    : 'Creating…'
                  : project
                    ? 'Save'
                    : 'Create'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    // Opaque: the dimming is the shared `backdropOpacity`. An alpha here would
    // multiply.
    backgroundColor: '#111827',
  },
  // Fills the screen and holds the sheet at its bottom. Its padding is the
  // status bar above and the keyboard below, so the sheet is always sized to
  // the space between them.
  frame: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  // `flexShrink` lets the sheet be shorter than its content, and the body
  // scrolls the difference.
  sheet: {
    flexShrink: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: { borderColor: '#111827' },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  pinRowPressed: { backgroundColor: '#f9fafb' },
  shoppingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  shoppingText: { flex: 1, gap: 2 },
  shoppingLabel: { fontSize: 14, fontWeight: '600', color: '#111827' },
  shoppingHint: { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  pinText: { fontSize: 14, fontWeight: '600', color: '#6366f1' },
  error: {
    marginTop: 12,
    fontSize: 13,
    color: '#dc2626',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  actionsSpacer: { flex: 1 },
  delete: { paddingVertical: 9, paddingHorizontal: 4 },
  deleteText: { fontSize: 14, fontWeight: '600', color: '#dc2626' },
  cancel: { paddingVertical: 9, paddingHorizontal: 14 },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
