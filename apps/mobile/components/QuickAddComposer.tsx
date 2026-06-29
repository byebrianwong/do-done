/**
 * Todoist-style quick-add surface. A compact bottom-sheet card with a title
 * input plus tappable chips for When / Priority / Estimate / Tags — the same
 * affordances as the detailed task editor (TaskEditModalV2), whose selectors
 * this reuses. Typed natural-language syntax still works via parseTaskInput
 * (`#tag`, `p1`, `/today`, `~30m`, "tomorrow", …) and merges on submit, with
 * explicit chip selections taking precedence.
 *
 * Used by both the home-screen widget activity (quick-add-root.tsx) and the
 * in-app `dodone://quick-add` modal (app/quick-add.tsx). Each host supplies its
 * own dismissal via onClose / onCreated.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import {
  PRIORITY_CONFIG,
  type CreateTaskInput,
  type TaskPriority,
} from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import {
  PickerSheet,
  WhenCalendar,
  TagRow,
  PRIORITY_PICKER_OPTIONS,
  ESTIMATE_PICKER_OPTIONS,
  PRIORITY_COLORS,
  ESTIMATE_BUCKETS,
  extractCompletedTags,
  shortDateLabel,
  estimateBarIndex,
} from './TaskEditModalV2';

interface QuickAddComposerProps {
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /** Dismiss without creating (backdrop tap / cancel). */
  onClose?: () => void;
  /** Focus the input as soon as the composer mounts. */
  autoFocus?: boolean;
}

function durationLabel(minutes: number | null): string {
  if (!minutes) return 'Estimate';
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

export default function QuickAddComposer({
  defaultStatus = 'not_started',
  onCreated,
  onClose,
  autoFocus = false,
}: QuickAddComposerProps) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [whenDate, setWhenDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const [whenSheet, setWhenSheet] = useState(false);
  const [priSheet, setPriSheet] = useState(false);
  const [estSheet, setEstSheet] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // edgeToEdgeEnabled disables Android adjustResize, so the absolute-positioned
  // card stays behind the keyboard unless we lift it ourselves.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) =>
      setKbHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // Live-extract whitespace-terminated `#tag` tokens into chips as the user
  // types (same behavior as the detailed editor's title field).
  const handleChangeText = (v: string) => {
    const { stripped, tags: extracted } = extractCompletedTags(v);
    if (extracted.length > 0) {
      setTags((prev) => {
        const seen = new Set(prev);
        const fresh = extracted.filter((t) => !seen.has(t));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setText(stripped);
    } else {
      setText(v);
    }
  };

  const addTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  const removeTag = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  const onPickDate = (date: string) => {
    setWhenDate(date);
    setWhenSheet(false);
  };

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    // Parse remaining typed syntax; explicit chip selections win over parsed.
    const parsed = parseTaskInput(trimmed);
    const mergedTags = Array.from(new Set([...tags, ...(parsed.tags ?? [])]));
    const finalPriority = priority ?? parsed.priority ?? undefined;
    const finalDuration = duration ?? parsed.duration_minutes ?? undefined;
    const finalWhenDate = whenDate ?? parsed.when_date ?? undefined;

    const input: CreateTaskInput = {
      title: parsed.title || trimmed,
      status: defaultStatus,
      ...(finalPriority && { priority: finalPriority }),
      ...(finalWhenDate && { when_date: finalWhenDate }),
      ...(parsed.due_date && { due_date: parsed.due_date }),
      ...(parsed.due_time && { due_time: parsed.due_time }),
      ...(finalDuration && { duration_minutes: finalDuration }),
      ...(mergedTags.length > 0 && { tags: mergedTags }),
      ...(parsed.recurrence_rule && { recurrence_rule: parsed.recurrence_rule }),
    };

    const tasks = await getTasksApi();
    const { error } = await tasks.create(input);
    setSubmitting(false);
    if (!error) {
      hapticSuccess();
      setText('');
      setTags([]);
      setPriority(null);
      setWhenDate(null);
      setDuration(null);
      onCreated?.();
    }
  }

  const whenSet = !!whenDate;
  const estIdx = estimateBarIndex(duration);

  return (
    <View style={[styles.wrapper, kbHeight > 0 && { bottom: kbHeight + 8 }]}>
      <View style={styles.card}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Add a task…"
            placeholderTextColor="#9ca3af"
            value={text}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!submitting}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              (pressed || !text.trim()) && styles.sendBtnMuted,
            ]}
            onPress={handleSubmit}
            disabled={submitting || !text.trim()}
            hitSlop={4}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={22} color="#fff" />
            )}
          </Pressable>
        </View>

        {/* Tags */}
        <TagRow tags={tags} onAdd={addTag} onRemove={removeTag} />

        {/* Chip row */}
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, whenSet && styles.chipActive]}
            onPress={() => setWhenSheet(true)}
            hitSlop={4}
          >
            <Ionicons
              name="calendar-outline"
              size={15}
              color={whenSet ? '#4338ca' : '#6b7280'}
            />
            <Text style={[styles.chipText, whenSet && styles.chipTextActive]}>
              {whenSet ? shortDateLabel(whenDate) : 'Date'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, priority && styles.chipActive]}
            onPress={() => setPriSheet(true)}
            hitSlop={4}
          >
            <Ionicons
              name="flag"
              size={15}
              color={priority ? PRIORITY_COLORS[priority] : '#6b7280'}
            />
            <Text
              style={[
                styles.chipText,
                priority && { color: PRIORITY_COLORS[priority], fontWeight: '700' },
              ]}
            >
              {priority ? PRIORITY_CONFIG[priority].label : 'Priority'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, !!duration && styles.chipActive]}
            onPress={() => setEstSheet(true)}
            hitSlop={4}
          >
            <Ionicons
              name="time-outline"
              size={15}
              color={duration ? '#4338ca' : '#6b7280'}
            />
            <Text style={[styles.chipText, !!duration && styles.chipTextActive]}>
              {durationLabel(duration)}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Date sheet — reuses the detailed editor's calendar */}
      <PickerSheet
        visible={whenSheet}
        title="Date"
        options={[]}
        selectedKey=""
        onSelect={() => {}}
        onClose={() => setWhenSheet(false)}
        header={
          <WhenCalendar
            whenDate={whenDate}
            busyness={[]}
            onPickDate={onPickDate}
          />
        }
      />

      <PickerSheet
        visible={priSheet}
        title="Priority"
        options={PRIORITY_PICKER_OPTIONS.map((p) => ({
          key: p.value,
          code: p.code,
          label: p.label,
        }))}
        selectedKey={priority ?? ''}
        onSelect={(key) => {
          setPriority(key as TaskPriority);
          setPriSheet(false);
        }}
        onClose={() => setPriSheet(false)}
        accentByKey={(key) => PRIORITY_COLORS[key as TaskPriority]}
      />

      <PickerSheet
        visible={estSheet}
        title="Estimate"
        options={ESTIMATE_PICKER_OPTIONS.map((b) => ({
          key: String(b.minutes),
          code: b.code,
          label: b.label,
        }))}
        selectedKey={estIdx >= 0 ? String(ESTIMATE_BUCKETS[estIdx]) : ''}
        onSelect={(key) => {
          setDuration(parseInt(key, 10));
          setEstSheet(false);
        }}
        onClose={() => setEstSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 8,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnMuted: {
    backgroundColor: '#c7d2fe',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f3f4f6',
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: '#eef2ff',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  chipTextActive: {
    color: '#4338ca',
    fontWeight: '700',
  },
});
