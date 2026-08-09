/**
 * The project icon field on mobile: a preview of the ring the icon will appear
 * in, which expands into a searchable grid of characters.
 *
 * It replaces a 64 px text box whose only hint was a "🚀" placeholder — which
 * asked the user to find the emoji key, and never said that a plain symbol like
 * ★ was allowed at all.
 *
 * The grid expands **inside the sheet that hosts it**, never in a `Modal`.
 * Every surface this appears on is keyboard-anchored, and an Android `Modal`
 * opens a second window and drops the IME (the same rule `QuickAddFields`'
 * chip popovers follow).
 *
 * The catalogue itself is in `@do-done/shared` so web offers the same choice.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PROJECT_ICON_GROUPS,
  searchProjectIcons,
  type ProjectIconOption,
} from '@do-done/shared';

export function ProjectIconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');

  const results = useMemo(() => {
    const searched = searchProjectIcons(query);
    if (group === 'all') return searched;
    const inGroup = new Set(
      PROJECT_ICON_GROUPS.find((g) => g.id === group)?.icons.map((i) => i.char),
    );
    return searched.filter((i) => inGroup.has(i.char));
  }, [query, group]);

  // Headed sections only when nothing is narrowing the list — a filtered result
  // set broken into ten labelled boxes is harder to scan than one grid.
  const sections: { label: string | null; icons: readonly ProjectIconOption[] }[] =
    query.trim() || group !== 'all'
      ? [{ label: null, icons: results }]
      : PROJECT_ICON_GROUPS.map((g) => ({ label: g.label, icons: g.icons }));

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
    setQuery('');
    setGroup('all');
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.fieldLabel}>Icon</Text>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={styles.preview}
          accessibilityRole="button"
          accessibilityLabel={value ? 'Change icon' : 'Choose an icon'}
        >
          {/* The 22 px ring the task rows draw, so the choice is made against
              the size it will actually be seen at. */}
          <View style={[styles.ring, { borderColor: color }]}>
            <Text style={styles.ringIcon}>{value}</Text>
          </View>
          <Text style={styles.previewText}>
            {value ? 'Change' : 'Choose an icon'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange('')} hitSlop={8}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <View style={styles.panel}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search, or paste any character…"
            placeholderTextColor="#9ca3af"
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            {[{ id: 'all', label: 'All' }, ...PROJECT_ICON_GROUPS].map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setGroup(g.id)}
                style={[styles.chip, group === g.id && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    group === g.id && styles.chipTextActive,
                  ]}
                >
                  {g.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            style={styles.grid}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {results.length === 0 ? (
              <Text style={styles.empty}>
                Nothing matches “{query.trim()}”. Any character works — paste one
                into the search box.
              </Text>
            ) : (
              sections
                .filter((s) => s.icons.length > 0)
                .map((section, i) => (
                  <View key={section.label ?? `results-${i}`}>
                    {section.label ? (
                      <Text style={styles.sectionLabel}>{section.label}</Text>
                    ) : null}
                    <View style={styles.iconWrap}>
                      {section.icons.map((icon) => (
                        <Pressable
                          key={icon.char}
                          onPress={() => pick(icon.char)}
                          accessibilityRole="button"
                          accessibilityLabel={icon.name}
                          style={[
                            styles.iconCell,
                            value === icon.char && styles.iconCellActive,
                          ]}
                        >
                          <Text style={styles.iconChar}>{icon.char}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
            )}
          </ScrollView>

          <View style={styles.panelFooter}>
            <Text style={styles.hint}>Symbols take the row’s text colour</Text>
            <Pressable onPress={() => pick('')} hitSlop={8}>
              <Text style={styles.noIcon}>No icon</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringIcon: { fontSize: 10, lineHeight: 12, color: '#111827' },
  previewText: { fontSize: 13, color: '#4b5563' },
  remove: { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  panel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingTop: 8,
    backgroundColor: '#fff',
  },
  search: {
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
  },
  chipScroll: { marginTop: 8, maxHeight: 34 },
  chipRow: { paddingHorizontal: 8, gap: 6, alignItems: 'center' },
  chip: {
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: '#6366f1' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#4b5563' },
  chipTextActive: { color: '#fff' },
  grid: { maxHeight: 210, paddingHorizontal: 8, paddingTop: 6 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  iconWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  iconCell: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellActive: { backgroundColor: '#eef2ff' },
  iconChar: { fontSize: 20, lineHeight: 24, color: '#111827' },
  empty: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
  },
  panelFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
  },
  hint: { fontSize: 11, color: '#9ca3af' },
  noIcon: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
});
