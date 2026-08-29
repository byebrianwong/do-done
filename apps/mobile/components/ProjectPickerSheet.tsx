/**
 * Bottom-sheet project picker — shared by the task row's project chip and the
 * task edit modal's Project field. Lists existing projects, offers a "No
 * project" clear option, and an inline create flow (name + color) that
 * provisions a project and selects it in one step.
 *
 * Presentation mirrors PickerSheet in TaskEditModalV2.tsx, but the stateful
 * create flow is why this is a separate component.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { COMPACT_PROJECT_COLORS } from '@do-done/shared';
import type { Project } from '@do-done/shared';
import { ProjectIcon } from '@/components/ProjectIcon';

export function ProjectPickerSheet({
  visible,
  projects,
  selectedId,
  onSelect,
  onClose,
  onCreate,
}: {
  visible: boolean;
  projects: Project[];
  selectedId: string | null;
  onSelect: (projectId: string | null) => void;
  onClose: () => void;
  /** Provision a project; returns it on success, null on failure. */
  onCreate: (name: string, color: string) => Promise<Project | null>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(COMPACT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  // Reset the create sub-form whenever the sheet closes.
  useEffect(() => {
    if (!visible) {
      setCreating(false);
      setName('');
      setColor(COMPACT_PROJECT_COLORS[0]);
      setSaving(false);
    }
  }, [visible]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const created = await onCreate(trimmed, color);
    setSaving(false);
    if (created) {
      onSelect(created.id);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.title}>Project</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            <Pressable
              onPress={() => {
                onSelect(null);
                onClose();
              }}
              style={[styles.row, selectedId === null && styles.rowSelected]}
            >
              <View style={[styles.dot, styles.dotNone]} />
              <Text style={[styles.label, styles.labelMuted]}>No project</Text>
              {selectedId === null && <Text style={styles.check}>✓</Text>}
            </Pressable>
            {projects.map((p) => {
              const selected = p.id === selectedId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    onSelect(p.id);
                    onClose();
                  }}
                  style={[styles.row, selected && styles.rowSelected]}
                >
                  {p.icon ? (
                    <ProjectIcon icon={p.icon} size={15} color={p.color} />
                  ) : (
                    <View style={[styles.dot, { backgroundColor: p.color }]} />
                  )}
                  <Text style={styles.label} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {selected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          {creating ? (
            <View style={styles.createWrap}>
              <TextInput
                ref={inputRef}
                value={name}
                onChangeText={setName}
                onSubmitEditing={submit}
                placeholder="Project name…"
                placeholderTextColor="#9ca3af"
                maxLength={100}
                style={styles.input}
              />
              <View style={styles.swatchRow}>
                {COMPACT_PROJECT_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    style={[
                      styles.swatch,
                      { backgroundColor: c },
                      color === c && styles.swatchActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.createActions}>
                <Pressable
                  onPress={() => {
                    setCreating(false);
                    setName('');
                  }}
                  style={styles.createCancel}
                >
                  <Text style={styles.createCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={!name.trim() || saving}
                  style={[
                    styles.createBtn,
                    (!name.trim() || saving) && styles.createBtnDisabled,
                  ]}
                >
                  <Text style={styles.createBtnText}>
                    {saving ? 'Creating…' : 'Create'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setCreating(true)} style={styles.newRow}>
              <View style={styles.newPlus}>
                <Text style={styles.newPlusText}>+</Text>
              </View>
              <Text style={styles.newLabel}>New project</Text>
            </Pressable>
          )}
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
    paddingTop: 14,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  list: { maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rowSelected: { backgroundColor: '#eef2ff' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotNone: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#9ca3af',
    borderStyle: 'dashed',
  },
  label: { flex: 1, fontSize: 14, fontWeight: '500', color: '#111827' },
  labelMuted: { color: '#6b7280' },
  check: { fontSize: 14, fontWeight: '700', color: '#4338ca' },

  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  newPlus: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPlusText: { fontSize: 12, color: '#6b7280', lineHeight: 14 },
  newLabel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },

  createWrap: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: { borderColor: '#111827' },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  createCancel: { paddingVertical: 8, paddingHorizontal: 12 },
  createCancelText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
