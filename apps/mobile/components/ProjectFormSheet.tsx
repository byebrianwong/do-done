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
import { DEFAULT_PROJECT_COLORS } from '@do-done/shared';
import { createProject } from '@/lib/task-queries';

export function ProjectFormSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);

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
      });
      setSaving(false);
      onClose();
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Could not create project');
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
          <Text style={styles.title}>New project</Text>

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

          <View style={styles.iconRow}>
            <Text style={styles.fieldLabel}>Icon</Text>
            <TextInput
              value={icon}
              onChangeText={setIcon}
              placeholder="🚀"
              placeholderTextColor="#9ca3af"
              maxLength={4}
              style={styles.iconInput}
            />
          </View>

          <View style={styles.swatchRow}>
            {DEFAULT_PROJECT_COLORS.map((c) => (
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
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  iconInput: {
    width: 64,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlign: 'center',
    color: '#111827',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
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
