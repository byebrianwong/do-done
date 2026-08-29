/**
 * Bottom-sheet form to create *or* edit a project or list on mobile
 * (name + icon + color). Mirrors the web ProjectForm, which is one component
 * for both modes for the same reason: everything on it is identical, and the
 * only differences are the verb on the button and whether Delete is offered.
 *
 * Writes go through createProject / updateProject / deleteProject, which
 * invalidate the project caches — including the detail read a list screen's
 * title bar uses, so a rename shows there without a refocus.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PROJECT_COLOR_OPTIONS,
  DEFAULT_PROJECT_COLORS,
  projectKind,
} from '@do-done/shared';
import { createProject, deleteProject, updateProject } from '@/lib/task-queries';
import { invalidateLists } from '@/lib/list-queries';
import type { Project, ProjectKind } from '@do-done/shared';
import { ProjectIconPicker } from '@/components/ProjectIconPicker';

export function ProjectFormSheet({
  visible,
  onClose,
  // A shopping list is the same row with a different `kind`, so this is the
  // same sheet with different words on it rather than a copy of it.
  kind = 'tasks',
  project,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  kind?: ProjectKind;
  /** Present = edit mode, absent = create mode. */
  project?: Project;
  /**
   * Called after a delete lands. The screen that opened this sheet is usually
   * the deleted row's own screen, so it has to leave — the sheet cannot know
   * where to.
   */
  onDeleted?: () => void;
}) {
  // In edit mode the row already knows what it is; `kind` describes what is
  // being created and is ignored.
  const effectiveKind: ProjectKind = project ? projectKind(project) : kind;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const noun = effectiveKind === 'list' ? 'list' : 'project';

  // Seeded from the row every time the sheet opens — so re-opening after a
  // cancelled edit shows what is saved, not what was abandoned. Create mode
  // seeds the same fields empty, which is the same statement.
  useEffect(() => {
    if (!visible) {
      setSaving(false);
      setError(null);
      return;
    }
    setName(project?.name ?? '');
    setIcon(project?.icon ?? '');
    setColor(project?.color ?? DEFAULT_PROJECT_COLORS[0]);
    setSaving(false);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [visible, project]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (project) {
        await updateProject(project.id, {
          name: trimmed,
          color,
          // An emptied icon field is a real answer — it clears the glyph and
          // leaves the ring its colour — so it is sent as null, not dropped.
          icon: icon.trim() || null,
        });
      } else {
        await createProject({
          name: trimmed,
          color,
          icon: icon.trim() || undefined,
          kind: effectiveKind,
        });
      }
      // The lists index is its own query root, so the project caches these
      // writes invalidate don't reach it: without this a list created here
      // left the screen still saying "No lists yet" until it was re-focused.
      invalidateLists();
      setSaving(false);
      onClose();
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
              onClose();
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

  const disabled = !name.trim() || saving;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.title}>
            {project ? `Edit ${noun}` : `New ${noun}`}
          </Text>

          <TextInput
            ref={inputRef}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            placeholder={
              effectiveKind === 'list' ? 'Groceries, Amazon…' : 'Project name…'
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
            <Pressable onPress={onClose} style={styles.cancel}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
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
