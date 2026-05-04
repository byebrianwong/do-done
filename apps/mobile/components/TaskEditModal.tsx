import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRIORITY_CONFIG } from '@do-done/shared';
import type { Project, Task, TaskPriority, TaskStatus } from '@do-done/shared';
import { getProjectsApi, getTasksApi } from '@/lib/supabase';

interface TaskEditModalProps {
  task: Task | null;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const PRIORITIES: TaskPriority[] = ['p1', 'p2', 'p3', 'p4'];
const STATUSES: TaskStatus[] = [
  'inbox',
  'todo',
  'in_progress',
  'done',
  'archived',
];

export default function TaskEditModal({
  task,
  visible,
  onClose,
  onSaved,
}: TaskEditModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [priority, setPriority] = useState<TaskPriority>('p4');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [duration, setDuration] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setStatus(task.status);
    setPriority(task.priority);
    setDueDate(task.due_date ?? '');
    setDueTime(task.due_time ?? '');
    setDuration(task.duration_minutes?.toString() ?? '');
    setTagsInput((task.tags ?? []).join(', '));
    setProjectId(task.project_id ?? null);
  }, [task]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const api = await getProjectsApi();
      const { data } = await api.list();
      if (!cancelled) setProjects(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!task) return null;

  async function save() {
    if (!task) return;
    setSaving(true);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    const tasks = await getTasksApi();
    const { error } = await tasks.update(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      project_id: projectId,
      due_date: dueDate || null,
      due_time: dueTime || null,
      duration_minutes: duration ? parseInt(duration, 10) : null,
      tags,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }
    onSaved?.();
    onClose();
  }

  async function archive() {
    if (!task) return;
    Alert.alert('Archive task?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          const tasks = await getTasksApi();
          await tasks.update(task.id, { status: 'archived' });
          onSaved?.();
          onClose();
        },
      },
    ]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Edit task</Text>
          <Pressable onPress={save} disabled={saving || !title.trim()}>
            <Text
              style={[
                styles.save,
                (saving || !title.trim()) && styles.saveDisabled,
              ]}
            >
              {saving ? '...' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.content}>
          <FieldLabel label="Title" />
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            autoFocus
          />

          <FieldLabel label="Description" />
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <FieldLabel label="Status" />
          <View style={styles.chipRow}>
            {STATUSES.map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={[
                  styles.chip,
                  status === s && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    status === s && styles.chipTextActive,
                  ]}
                >
                  {s.replace('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>

          <FieldLabel label="Priority" />
          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPriority(p)}
                style={[
                  styles.chip,
                  priority === p && {
                    backgroundColor: PRIORITY_CONFIG[p].color + '20',
                    borderColor: PRIORITY_CONFIG[p].color,
                  },
                ]}
              >
                <View
                  style={[
                    styles.priorityDot,
                    { backgroundColor: PRIORITY_CONFIG[p].color },
                  ]}
                />
                <Text
                  style={[
                    styles.chipText,
                    priority === p && {
                      color: PRIORITY_CONFIG[p].color,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {PRIORITY_CONFIG[p].label}
                </Text>
              </Pressable>
            ))}
          </View>

          <FieldLabel label="Project" />
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setProjectId(null)}
              style={[
                styles.chip,
                projectId === null && styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  projectId === null && styles.chipTextActive,
                ]}
              >
                None
              </Text>
            </Pressable>
            {projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[
                  styles.chip,
                  projectId === p.id && {
                    backgroundColor: p.color + '20',
                    borderColor: p.color,
                  },
                ]}
              >
                <View
                  style={[styles.priorityDot, { backgroundColor: p.color }]}
                />
                <Text
                  style={[
                    styles.chipText,
                    projectId === p.id && {
                      color: p.color,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <FieldLabel label="Due date" />
              <TextInput
                style={styles.input}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View style={styles.col}>
              <FieldLabel label="Time" />
              <TextInput
                style={styles.input}
                value={dueTime}
                onChangeText={setDueTime}
                placeholder="HH:MM"
                placeholderTextColor="#9ca3af"
              />
            </View>
          </View>

          <FieldLabel label="Duration (minutes)" />
          <TextInput
            style={styles.input}
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            placeholder="60"
            placeholderTextColor="#9ca3af"
          />

          <FieldLabel label="Tags (comma-separated)" />
          <TextInput
            style={styles.input}
            value={tagsInput}
            onChangeText={setTagsInput}
            placeholder="work, urgent"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
          />

          <Pressable style={styles.archiveButton} onPress={archive}>
            <Ionicons name="archive-outline" size={16} color="#ef4444" />
            <Text style={styles.archiveText}>Archive task</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.label}>{label}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  cancel: { fontSize: 15, color: '#6b7280' },
  save: { fontSize: 15, fontWeight: '600', color: '#6366f1' },
  saveDisabled: { color: '#c7d2fe' },
  body: { flex: 1 },
  content: { padding: 16, paddingBottom: 80 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  chipActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#6366f1',
  },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#6366f1', fontWeight: '600' },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  archiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
    borderRadius: 10,
  },
  archiveText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});
