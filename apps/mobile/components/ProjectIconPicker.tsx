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

import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PHOSPHOR_CATALOGUE,
  PHOSPHOR_WEIGHTS,
  PROJECT_ICON_GROUPS,
  formatPhosphorIcon,
  parseProjectIcon,
  searchPhosphorIcons,
  searchProjectIcons,
  type PhosphorCatalogueIcon,
  type PhosphorWeight,
  type ProjectIconOption,
} from '@do-done/shared';
import { ProjectIcon } from '@/components/ProjectIcon';
import {
  iconGridItems,
  initialRenderCount,
  nextRenderCount,
  renderCountAfterChange,
  type IconGridSection,
} from '@/lib/icon-grid';

type Tab = 'icons' | 'emoji';

/**
 * How many of `total` grid items to mount. Grows a batch per frame until it
 * reaches `total`. When `scope` changes (the panel opens, or the tab switches)
 * it starts again from the first batch; any other change to the list keeps the
 * count already reached (`renderCountAfterChange`). The growth runs in a
 * transition, so a keystroke in the search box is never queued behind it.
 */
function useProgressiveCount(total: number, scope: string): number {
  const [state, setState] = useState(() => ({
    scope,
    total,
    count: initialRenderCount(total),
  }));
  let count = state.count;
  if (state.scope !== scope || state.total !== total) {
    // Adjusted during render rather than in an effect, so the frame that shows
    // the new results never mounts more than this.
    count = renderCountAfterChange(state.count, total, state.scope === scope);
    setState({ scope, total, count });
  }

  useEffect(() => {
    if (count >= total) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => {
        setState((s) =>
          s.scope === scope && s.total === total
            ? { ...s, count: nextRenderCount(s.count, total) }
            : s,
        );
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [count, total, scope]);

  return Math.min(count, total);
}

const EmojiCell = memo(function EmojiCell({
  char,
  name,
  active,
  onPick,
}: {
  char: string;
  name: string;
  active: boolean;
  onPick: (icon: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(char)}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={[styles.iconCell, active && styles.iconCellActive]}
    >
      <Text style={styles.iconChar}>{char}</Text>
    </Pressable>
  );
});

const PhosphorCell = memo(function PhosphorCell({
  token,
  label,
  active,
  color,
  onPick,
}: {
  token: string;
  label: string;
  active: boolean;
  color: string;
  onPick: (icon: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(token)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.iconCell, active && styles.iconCellActive]}
    >
      {/* Previewed in the project's own colour, which is how the row will
          actually draw it. */}
      <ProjectIcon icon={token} size={22} color={color} />
    </Pressable>
  );
});

/**
 * Memoised, so a keystroke in the form's name field does not re-render the
 * grid. The host passes `onChange` as a state setter, which is stable.
 */
export const ProjectIconPicker = memo(function ProjectIconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color: string;
}) {
  const parsed = parseProjectIcon(value);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(
    parsed.kind === 'emoji' ? 'emoji' : 'icons',
  );
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  // The weight outlives the icon: switching from Briefcase to House keeps the
  // treatment already chosen, and the next project starts on the last one used.
  const [weight, setWeight] = useState<PhosphorWeight>(
    parsed.kind === 'phosphor' ? parsed.weight : 'fill',
  );

  const narrowed = query.trim() !== '' || group !== 'all';
  const groups = tab === 'emoji' ? PROJECT_ICON_GROUPS : PHOSPHOR_CATALOGUE;

  // Headed sections only when nothing is narrowing the list — a filtered result
  // set broken into eleven labelled boxes is harder to scan than one grid.
  const emojiItems = useMemo(() => {
    if (!open || tab !== 'emoji') return [];
    let sections: IconGridSection<ProjectIconOption>[];
    if (narrowed) {
      const searched = searchProjectIcons(query);
      const inGroup =
        group === 'all'
          ? null
          : new Set(
              PROJECT_ICON_GROUPS.find((g) => g.id === group)?.icons.map(
                (i) => i.char,
              ),
            );
      sections = [
        {
          id: null,
          label: null,
          icons: inGroup ? searched.filter((i) => inGroup.has(i.char)) : searched,
        },
      ];
    } else {
      sections = PROJECT_ICON_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        icons: g.icons,
      }));
    }
    return iconGridItems(sections, (i) => i.char);
  }, [open, tab, narrowed, query, group]);

  const iconItems = useMemo(() => {
    if (!open || tab !== 'icons') return [];
    let sections: IconGridSection<PhosphorCatalogueIcon>[];
    if (narrowed) {
      const searched = searchPhosphorIcons(query);
      sections = [
        {
          id: null,
          label: null,
          icons:
            group === 'all'
              ? searched
              : searched.filter((i) => i.groupId === group),
        },
      ];
    } else {
      sections = PHOSPHOR_CATALOGUE.map((g) => ({
        id: g.id,
        label: g.label,
        icons: g.icons,
      }));
    }
    return iconGridItems(sections, (i) => i.name);
  }, [open, tab, narrowed, query, group]);

  const total = tab === 'emoji' ? emojiItems.length : iconItems.length;
  const empty = total === 0;
  // Reopening the panel or switching tab starts from the first batch again.
  // A weight change re-renders the mounted cells in place, keyed by name, so
  // the grid keeps its scroll position.
  const shown = useProgressiveCount(open ? total : 0, `${open}|${tab}`);

  // A stable callback, so the memoised cells skip re-rendering. The ref holds
  // the latest `onChange` in case a host ever passes a fresh one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pick = useCallback((icon: string) => {
    onChangeRef.current(icon);
    setOpen(false);
    setQuery('');
    setGroup('all');
  }, []);

  const pickWeight = (next: PhosphorWeight) => {
    setWeight(next);
    // Re-stamp the current pick so the ring follows the choice, rather than the
    // choice only applying to whatever is picked next.
    if (parsed.kind === 'phosphor') {
      onChange(formatPhosphorIcon(parsed.name, next));
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
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
            <ProjectIcon icon={value} size={11} color={color} />
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
          <View style={styles.tabRow}>
            {(
              [
                ['icons', 'Icons'],
                ['emoji', 'Emoji'],
              ] as const
            ).map(([id, label]) => (
              <Pressable
                key={id}
                onPress={() => switchTab(id)}
                style={[styles.tab, tab === id && styles.tabActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === id }}
              >
                <Text
                  style={[styles.tabText, tab === id && styles.tabTextActive]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              tab === 'emoji'
                ? 'Search, or paste any character…'
                : 'Search icons…'
            }
            placeholderTextColor="#9ca3af"
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
          />

          {tab === 'icons' ? (
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>Style</Text>
              {PHOSPHOR_WEIGHTS.map((w) => (
                <Pressable
                  key={w.id}
                  onPress={() => pickWeight(w.id)}
                  style={[
                    styles.weightChip,
                    weight === w.id && styles.weightChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${w.label} — ${w.hint}`}
                  accessibilityState={{ selected: weight === w.id }}
                >
                  {/* The label is drawn *in* the weight it names — the fastest
                      way to say what "Light fill" means is to show it. */}
                  <ProjectIcon
                    icon={formatPhosphorIcon('circle', w.id)}
                    size={13}
                    color={weight === w.id ? '#4338ca' : '#6b7280'}
                  />
                  <Text
                    style={[
                      styles.weightText,
                      weight === w.id && styles.weightTextActive,
                    ]}
                  >
                    {w.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            {[{ id: 'all', label: 'All' }, ...groups].map((g) => (
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
            {empty ? (
              <Text style={styles.empty}>
                {tab === 'emoji'
                  ? `Nothing matches “${query.trim()}”. Any character works — paste one into the search box.`
                  : `No icon matches “${query.trim()}”. The Emoji tab has the long tail.`}
              </Text>
            ) : (
              // One wrapping container for every section, so a cell keeps its
              // parent, and stays mounted, when a search narrows the list.
              <View style={styles.iconWrap}>
                {tab === 'emoji'
                  ? emojiItems.slice(0, shown).map((item) =>
                      item.kind === 'label' ? (
                        <Text key={item.key} style={styles.sectionLabel}>
                          {item.label}
                        </Text>
                      ) : (
                        <EmojiCell
                          key={item.key}
                          char={item.icon.char}
                          name={item.icon.name}
                          active={value === item.icon.char}
                          onPick={pick}
                        />
                      ),
                    )
                  : iconItems.slice(0, shown).map((item) => {
                      if (item.kind === 'label') {
                        return (
                          <Text key={item.key} style={styles.sectionLabel}>
                            {item.label}
                          </Text>
                        );
                      }
                      const token = formatPhosphorIcon(item.icon.name, weight);
                      return (
                        <PhosphorCell
                          key={item.key}
                          token={token}
                          label={item.icon.label}
                          active={value === token}
                          color={color}
                          onPick={pick}
                        />
                      );
                    })}
              </View>
            )}
          </ScrollView>

          <View style={styles.panelFooter}>
            <Text style={styles.hint}>
              {tab === 'icons'
                ? 'Icons take the project’s colour'
                : 'Symbols take the row’s text colour'}
            </Text>
            <Pressable onPress={() => pick('')} hitSlop={8}>
              <Text style={styles.noIcon}>No icon</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
});

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
  tabRow: { flexDirection: 'row', gap: 6, marginHorizontal: 8, marginBottom: 8 },
  tab: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  tabActive: { backgroundColor: '#111827' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#fff' },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginHorizontal: 8,
  },
  weightLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginRight: 2,
  },
  weightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#f3f4f6',
  },
  weightChipActive: { backgroundColor: '#eef2ff' },
  weightText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  weightTextActive: { color: '#4338ca' },
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
  // A full-width item inside the wrapping grid, so it takes a line of its own.
  // The grid's 4 px gap sits above and below it, which with this margin gives
  // the spacing the per-group containers used to.
  sectionLabel: {
    width: '100%',
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
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
