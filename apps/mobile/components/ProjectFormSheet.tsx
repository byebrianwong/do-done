/**
 * Bottom-sheet form to create a project on mobile (name + icon + color).
 * Mirrors the web ProjectForm's create flow and reuses the swatch styling from
 * ProjectPickerSheet. Provisions via createProject(), which invalidates the
 * project caches so the new project appears at the end of every list.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PROJECT_COLOR_OPTIONS, DEFAULT_PROJECT_COLORS } from '@do-done/shared';
import { createProject } from '@/lib/task-queries';
import type { ProjectKind } from '@do-done/shared';
import { ProjectIconPicker } from '@/components/ProjectIconPicker';

export function ProjectFormSheet({
  visible,
  onClose,
  // A shopping list is the same row with a different `kind`, so this is the
  // same sheet with different words on it rather than a copy of it.
  kind = 'tasks',
}: {
  visible: boolean;
  onClose: () => void;
  kind?: ProjectKind;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const noun = kind === 'list' ? 'list' : 'project';

  // Reset every time the sheet opens/closes; focus the name field on open.
  useEffect(() => {
    if (!visible) {
      setName('');
      setIcon('');
      setColor(DEFAULT_PROJECT_COLORS[0]);
      setSaving(false);
      setError(null);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createProject({
        name: trimmed,
        color,
        icon: icon.trim() || undefined,
        kind,
      });
      setSaving(false);
      onClose();
    } catch (e) {
      setSaving(false);
      setError(
        e instanceof Error ? e.message : `Could not create ${noun}`
      );
    }
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
          <Text style={styles.title}>New {noun}</Text>

          <TextInput
            ref={inputRef}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            placeholder={kind === 'list' ? 'Groceries, Amazon…' : 'Project name…'}
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
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={disabled}
              style={[styles.createBtn, disabled && styles.createBtnDisabled]}
            >
              <Text style={styles.createBtnText}>
                {saving ? 'Creating…' : 'Create'}
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
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
