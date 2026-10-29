/**
 * Load a pull request's build on this phone, and go back to main.
 *
 * Reached from Settings → App version, from the "PR" pill while a preview is
 * loaded, and from `dodone://preview-pr?number=<n>`, which is what the QR code
 * in each pull request's preview comment opens. A deep link only fills the
 * number in: switching restarts the app, so it waits for a tap.
 *
 * See `lib/pr-preview.ts` for how the switch works and when it is offered.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Updates from 'expo-updates';

import {
  canPreviewPullRequests,
  parsePrNumber,
  prFromChannel,
} from '@/lib/pr-preview';
import {
  enterPullRequestPreview,
  leavePullRequestPreview,
  PreviewUnavailableError,
} from '@/lib/pr-preview-runtime';

export default function PreviewPullRequestScreen() {
  const params = useLocalSearchParams<{ number?: string }>();
  const current = prFromChannel(Updates.channel);
  const available = canPreviewPullRequests({
    updatesEnabled: Updates.isEnabled,
    isDev: __DEV__,
    channel: Updates.channel,
  });

  const [input, setInput] = useState(params.number ?? '');
  const [busy, setBusy] = useState<'enter' | 'leave' | null>(null);
  const requested = parsePrNumber(input);

  async function load() {
    if (requested === null) return;
    setBusy('enter');
    try {
      await enterPullRequestPreview(requested, Updates.channel);
    } catch (e) {
      Alert.alert(
        e instanceof PreviewUnavailableError
          ? 'No preview yet'
          : 'Could not load the preview',
        e instanceof Error ? e.message : 'Something went wrong.'
      );
      setBusy(null);
    }
  }

  async function leave() {
    setBusy('leave');
    try {
      await leavePullRequestPreview();
    } catch (e) {
      Alert.alert(
        'Could not go back to main',
        (e instanceof Error ? e.message : 'Something went wrong.') +
          ' Check your connection and try again.'
      );
      setBusy(null);
    }
  }

  if (!available) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          {Updates.channel === 'production'
            ? 'Previews are not available on a store build.'
            : 'This build loads its code from a development server, so it cannot switch to a pull request’s update. Open the dev client link in the pull request’s preview comment instead.'}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.label}>Running now</Text>
        <Text style={styles.value}>
          {current === null ? `Main (${Updates.channel ?? 'preview'})` : `PR #${current}`}
        </Text>
        {current !== null ? (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={leave}
            disabled={busy !== null}
          >
            {busy === 'leave' ? (
              <ActivityIndicator color="#6366f1" />
            ) : (
              <Text style={styles.buttonText}>Go back to main</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Pull request</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Number or link, e.g. 321"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
          returnKeyType="go"
          onSubmitEditing={load}
          style={styles.input}
        />
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.buttonPrimary,
            pressed && styles.buttonPrimaryPressed,
            (requested === null || busy !== null) && styles.buttonDisabled,
          ]}
          onPress={load}
          disabled={requested === null || busy !== null}
        >
          {busy === 'enter' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonPrimaryText}>
              {requested === null ? 'Load preview' : `Load PR #${requested}`}
            </Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Loading a preview restarts the app on that pull request’s code. It stays
        loaded, through restarts, until you go back to main here. Your tasks are
        the same either way: a preview changes the app, not your data.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  value: { fontSize: 17, fontWeight: '600', color: '#111827' },
  body: { fontSize: 15, color: '#374151', lineHeight: 21 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
  },
  button: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c7d2fe',
  },
  buttonPressed: { backgroundColor: '#eef2ff' },
  buttonText: { color: '#6366f1', fontSize: 15, fontWeight: '600' },
  buttonPrimary: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  buttonPrimaryPressed: { backgroundColor: '#4f46e5' },
  buttonPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  // #4b5563 rather than a lighter grey: 12px text on the #f3f4f6 page needs
  // the darker shade to reach 4.5:1, as the Settings credit line notes.
  hint: { fontSize: 12, color: '#4b5563', lineHeight: 17 },
});
