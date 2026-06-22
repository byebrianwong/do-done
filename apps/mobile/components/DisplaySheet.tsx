import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  GROUP_OPTIONS,
  PRIORITY_CONFIG,
  SORT_OPTIONS,
  hasFlagFilter,
  isManualSort,
  selectedFilterValues,
  toggleFilterValue,
  toggleFlagFilter,
  toggleGroupDir,
  toggleSortDir,
  withGroup,
  withSort,
  type DisplayConfig,
  type TaskPriority,
} from '@do-done/shared';

const PRIORITIES: TaskPriority[] = ['p1', 'p2', 'p3', 'p4'];

interface DisplayProject {
  id: string;
  name: string;
  color: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  config: DisplayConfig;
  onChange: (next: DisplayConfig) => void;
  onReset: () => void;
  isDefault: boolean;
  projects?: DisplayProject[];
  availableTags?: string[];
}

export default function DisplaySheet({
  visible,
  onClose,
  config,
  onChange,
  onReset,
  isDefault,
  projects = [],
  availableTags = [],
}: Props) {
  const sortField = config.sort[0]?.field ?? 'manual';
  const sortDir = config.sort[0]?.dir ?? 'asc';
  const selectedPriorities = selectedFilterValues(config, 'priority');
  const selectedProjects = selectedFilterValues(config, 'project');
  const selectedTags = selectedFilterValues(config, 'tag');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Display</Text>
            {!isDefault ? (
              <Pressable onPress={onReset} hitSlop={8}>
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Section label="Group by">
              <View style={styles.pillWrap}>
                {GROUP_OPTIONS.map((g) => (
                  <Pill
                    key={g.key}
                    label={g.label}
                    active={config.group === g.key}
                    onPress={() => onChange(withGroup(config, g.key))}
                  />
                ))}
                {config.group !== 'none' ? (
                  <Pill
                    label="⇅ Reverse"
                    active={config.groupDir === 'desc'}
                    onPress={() => onChange(toggleGroupDir(config))}
                  />
                ) : null}
              </View>
            </Section>

            <Section label="Sort by">
              <View style={styles.pillWrap}>
                {SORT_OPTIONS.map((s) => (
                  <Pill
                    key={s.field}
                    label={s.label}
                    active={sortField === s.field}
                    onPress={() => onChange(withSort(config, s.field))}
                  />
                ))}
                {sortField !== 'manual' ? (
                  <Pill
                    label={sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
                    active
                    onPress={() => onChange(toggleSortDir(config))}
                  />
                ) : null}
              </View>
              {!isManualSort(config) ? (
                <Text style={styles.hint}>
                  Drag a task to switch to manual order.
                </Text>
              ) : null}
            </Section>

            <Section label="Filter">
              <View style={styles.pillWrap}>
                {PRIORITIES.map((p) => (
                  <Pill
                    key={p}
                    label={p.toUpperCase()}
                    active={selectedPriorities.includes(p)}
                    accent={PRIORITY_CONFIG[p].color}
                    onPress={() => onChange(toggleFilterValue(config, 'priority', p))}
                  />
                ))}
                <Pill
                  label="Overdue"
                  active={hasFlagFilter(config, 'overdue')}
                  accent="#ef4444"
                  onPress={() => onChange(toggleFlagFilter(config, 'overdue'))}
                />
              </View>
              {projects.length ? (
                <View style={styles.pillWrap}>
                  {projects.map((p) => (
                    <Pill
                      key={p.id}
                      label={p.name}
                      active={selectedProjects.includes(p.id)}
                      accent={p.color}
                      onPress={() => onChange(toggleFilterValue(config, 'project', p.id))}
                    />
                  ))}
                </View>
              ) : null}
              {availableTags.length ? (
                <View style={styles.pillWrap}>
                  {availableTags.map((t) => (
                    <Pill
                      key={t}
                      label={`#${t}`}
                      active={selectedTags.includes(t)}
                      onPress={() => onChange(toggleFilterValue(config, 'tag', t))}
                    />
                  ))}
                </View>
              ) : null}
            </Section>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Show completed</Text>
              <Switch
                value={config.showCompleted}
                onValueChange={(v) => onChange({ ...config, showCompleted: v })}
                trackColor={{ true: '#6366f1', false: '#d1d5db' }}
              />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Pill({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active && styles.pillActive,
        active && accent ? { borderColor: accent } : null,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          active && styles.pillTextActive,
          active && accent ? { color: accent } : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingBottom: 32,
    paddingTop: 10,
    maxHeight: '82%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  reset: { fontSize: 13, fontWeight: '600', color: '#6366f1' },
  section: { marginTop: 14 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    marginBottom: 8,
  },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  pill: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillActive: { borderColor: '#a5b4fc', backgroundColor: '#eef2ff' },
  pillText: { fontSize: 13, fontWeight: '500', color: '#4b5563' },
  pillTextActive: { color: '#4338ca' },
  hint: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 14,
  },
  switchLabel: { fontSize: 14, fontWeight: '500', color: '#374151' },
});
