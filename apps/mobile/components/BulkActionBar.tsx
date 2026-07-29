import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  resolveQuickSchedule,
} from '@do-done/shared';
import type {
  QuickScheduleKey,
  TaskPriority,
  UpdateTaskInput,
} from '@do-done/shared';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import {
  bulkCompleteTasks,
  bulkDeleteTasks,
  bulkUpdateTasks,
  createProject,
  useProjects,
} from '@/lib/task-queries';
import { useTaskSelection } from '@/lib/task-selection';
import { ProjectPickerSheet } from './ProjectPickerSheet';

type Sheet = 'schedule' | 'priority' | 'move' | null;

interface Option {
  key: string;
  label: string;
  color?: string;
  destructive?: boolean;
}

const PRIORITY_ORDER: TaskPriority[] = ['p1', 'p2', 'p3', 'p4'];

/**
 * A simple bottom-sheet list of options — the Schedule and Priority pickers for
 * the bulk bar. Mirrors ProjectPickerSheet's presentation.
 */
function OptionSheet({
  visible,
  title,
  options,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={styles.sheetList}>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => onPick(o.key)}
                style={styles.optionRow}
              >
                {o.color ? (
                  <View style={[styles.optionDot, { backgroundColor: o.color }]} />
                ) : null}
                <Text
                  style={[
                    styles.optionLabel,
                    o.destructive && styles.optionDestructive,
                  ]}
                >
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BarButton({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const color = danger ? '#dc2626' : '#374151';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.barBtn, pressed && styles.barBtnPressed]}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.barBtnLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Floating bulk-action toolbar — the primary surface for acting on a
 * multi-selection. Mounted once at the app root; renders nothing until a row is
 * selected (long-press), then docks over the tab bar with Schedule, Move,
 * Priority, Complete and Delete, plus the selected count and a cancel.
 */
export function BulkActionBar() {
  const selection = useTaskSelection();
  const insets = useSafeAreaInsets();
  const { data: projects } = useProjects();
  const [sheet, setSheet] = useState<Sheet>(null);

  const count = selection.count;
  if (count === 0) return null;

  const ids = () => [...selection.selectedIds];

  const apply = (input: UpdateTaskInput) => {
    const targets = ids();
    hapticLight();
    void bulkUpdateTasks(targets, input).catch(() => {});
    setSheet(null);
    selection.clear();
  };

  const pickSchedule = (key: string) => {
    if (key === 'remove') {
      apply({ when_date: null, due_date: null, due_time: null });
      return;
    }
    apply({ when_date: resolveQuickSchedule(key as QuickScheduleKey) });
  };

  const complete = () => {
    const targets = ids();
    hapticSuccess();
    void bulkCompleteTasks(targets).catch(() => {});
    selection.clear();
  };

  const confirmDelete = () => {
    const targets = ids();
    Alert.alert(
      `Delete ${targets.length} task${targets.length > 1 ? 's' : ''}?`,
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            hapticMedium();
            void bulkDeleteTasks(targets).catch(() => {});
            selection.clear();
          },
        },
      ]
    );
  };

  const scheduleOptions: Option[] = [
    ...QUICK_SCHEDULE.map((q) => ({ key: q.key, label: q.label })),
    { key: 'remove', label: 'Remove dates', destructive: true },
  ];
  const priorityOptions: Option[] = PRIORITY_ORDER.map((p) => ({
    key: p,
    label: PRIORITY_CONFIG[p].label,
    color: PRIORITY_CONFIG[p].color,
  }));

  return (
    <>
      <View style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}>
        <View style={styles.header}>
          <Text style={styles.count}>{count} selected</Text>
          <Pressable onPress={() => selection.clear()} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <View style={styles.actions}>
          <BarButton
            icon="calendar-outline"
            label="Schedule"
            onPress={() => setSheet('schedule')}
          />
          <BarButton
            icon="folder-outline"
            label="Move"
            onPress={() => setSheet('move')}
          />
          <BarButton
            icon="flag-outline"
            label="Priority"
            onPress={() => setSheet('priority')}
          />
          <BarButton
            icon="checkmark-done-outline"
            label="Complete"
            onPress={complete}
          />
          <BarButton
            icon="trash-outline"
            label="Delete"
            danger
            onPress={confirmDelete}
          />
        </View>
      </View>

      <OptionSheet
        visible={sheet === 'schedule'}
        title="Schedule"
        options={scheduleOptions}
        onPick={pickSchedule}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'priority'}
        title="Priority"
        options={priorityOptions}
        onPick={(key) => apply({ priority: key as TaskPriority })}
        onClose={() => setSheet(null)}
      />
      <ProjectPickerSheet
        visible={sheet === 'move'}
        projects={projects ?? []}
        selectedId={null}
        onSelect={(projectId) => apply({ project_id: projectId })}
        onClose={() => setSheet(null)}
        onCreate={async (name, color) => {
          try {
            return await createProject({ name, color });
          } catch {
            return null;
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  count: { fontSize: 14, fontWeight: '700', color: '#4338ca' },
  cancel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 6,
  },
  barBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
    borderRadius: 10,
  },
  barBtnPressed: { backgroundColor: '#f3f4f6' },
  barBtnLabel: { fontSize: 11, fontWeight: '600' },

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
  sheetTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sheetList: { maxHeight: 360 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  optionDot: { width: 10, height: 10, borderRadius: 5 },
  optionLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827' },
  optionDestructive: { color: '#dc2626' },
});
