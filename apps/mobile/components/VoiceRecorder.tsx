/**
 * The card that is up while a voice note is being recorded.
 *
 * Three things on screen, and each is answering a question the user would
 * otherwise have to guess at: a level meter ("is it hearing me?"), a clock
 * ("how long have I got?") and the transcript as it lands ("did it get that
 * right?"). A recorder that shows only a red dot leaves all three unanswered
 * until it's too late to do anything about them.
 *
 * It is a plain card, not a `Modal`. Every quick-add surface it appears on is
 * keyboard-anchored, and an Android `Modal` opens a new window and drops the
 * IME — the same reason the chip popovers in `QuickAddFields` are inline.
 * Hosts position it; this component only draws.
 */

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  formatRecordingTime,
  VOICE_MAX_DURATION_MS,
  VOICE_WARN_REMAINING_MS,
} from "@do-done/shared";
import type { VoiceCapture } from "@/lib/voice-capture";

/** Bars in the level meter. Odd, so there is a centre one to peak. */
const BAR_COUNT = 9;

/**
 * A bar's height for the current input level.
 *
 * Bars away from the centre respond less, which is the shape a meter is
 * expected to have — a row of identical bars moving in lockstep reads as a
 * progress indicator rather than as sound.
 */
function barHeight(index: number, level: number): number {
  const distance = Math.abs(index - (BAR_COUNT - 1) / 2);
  const falloff = 1 - distance / BAR_COUNT;
  return 4 + level * falloff * 26;
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: active ? barHeight(i, level) : 4,
              backgroundColor: active ? "#6366f1" : "#d1d5db",
            },
          ]}
        />
      ))}
    </View>
  );
}

interface VoiceRecorderProps {
  voice: VoiceCapture;
  /** Shown while the note is being uploaded after the recording stops. */
  busy?: boolean;
  /** Discard the recording and close. */
  onCancel: () => void;
}

export default function VoiceRecorder({
  voice,
  busy = false,
  onCancel,
}: VoiceRecorderProps) {
  const remaining = VOICE_MAX_DURATION_MS - voice.elapsedMs;
  const nearlyUp = remaining <= VOICE_WARN_REMAINING_MS;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.dot} />
        <Text style={[styles.clock, nearlyUp && styles.clockWarn]}>
          {formatRecordingTime(voice.elapsedMs)}
        </Text>
        {nearlyUp ? (
          <Text style={styles.remaining}>
            {formatRecordingTime(Math.max(remaining, 0))} left
          </Text>
        ) : null}
        <View style={styles.spacer} />
        <LevelMeter level={voice.level} active={voice.recording} />
      </View>

      <Text
        style={[styles.transcript, !voice.transcript && styles.transcriptEmpty]}
        numberOfLines={4}
      >
        {voice.transcript || "Listening…"}
      </Text>

      {voice.error ? <Text style={styles.error}>{voice.error}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          testID="voice-cancel"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={onCancel}
          disabled={busy}
          hitSlop={4}
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          testID="voice-done"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={voice.stop}
          disabled={busy || !voice.recording}
          hitSlop={4}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.primaryText}>Done</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * What a finished dictation left behind, shown on the quick-add surfaces while
 * the task is still being composed.
 *
 * Both halves need saying. The description is text the collapsed line can't
 * show, and the recording is a file that exists but has nowhere to live until
 * the task is submitted — without the pill there is no evidence at all that
 * audio is about to be attached, and a user who cleared the text would
 * reasonably assume they had cleared the recording too.
 */
export function DictatedNote({
  description,
  pending,
  error,
  onClear,
}: {
  description: string;
  pending: boolean;
  error: string | null;
  onClear: () => void;
}) {
  if (!description && !pending && !error) return null;

  return (
    <View style={styles.note}>
      <View style={styles.noteHead}>
        <Ionicons name="mic" size={13} color="#4f46e5" />
        <Text style={styles.noteLabel}>
          {pending ? "Voice note will be attached" : "Dictated"}
        </Text>
        <View style={styles.spacer} />
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityLabel="Discard the dictated note"
        >
          <Text style={styles.noteClear}>×</Text>
        </Pressable>
      </View>
      {description ? (
        <Text style={styles.noteBody} numberOfLines={3}>
          {description}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eef2ff",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#ef4444",
  },
  clock: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    // Tabular figures: without them the clock jitters sideways every tick.
    fontVariant: ["tabular-nums"],
  },
  clockWarn: { color: "#b45309" },
  remaining: { fontSize: 11, fontWeight: "600", color: "#b45309" },
  spacer: { flex: 1 },

  meter: { flexDirection: "row", alignItems: "center", gap: 3, height: 30 },
  bar: { width: 3, borderRadius: 2 },

  transcript: { fontSize: 15, lineHeight: 21, color: "#111827" },
  transcriptEmpty: { color: "#9ca3af" },
  error: { fontSize: 12, color: "#ef4444" },

  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  secondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
  },
  secondaryText: { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#6366f1",
    minWidth: 88,
    justifyContent: "center",
  },
  primaryText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  pressed: { opacity: 0.8 },

  note: {
    backgroundColor: "#eef2ff",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteLabel: { fontSize: 11, fontWeight: "700", color: "#4f46e5" },
  noteClear: { fontSize: 17, lineHeight: 18, color: "#a5b4fc" },
  noteBody: { fontSize: 13, lineHeight: 18, color: "#374151" },
});
