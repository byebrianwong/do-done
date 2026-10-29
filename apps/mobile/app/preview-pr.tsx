/**
 * Load a pull request's build on this phone, and go back to main.
 *
 * Lists the repository's open pull requests, each with the "How to try it"
 * steps from its description, so nobody has to know a number. A number can
 * still be typed at the bottom.
 *
 * Reached from Settings → App version, from the "PR" pill while a preview is
 * loaded, and from `dodone://preview-pr?number=<n>`, which is what the QR code
 * in each pull request's preview comment opens. A deep link opens that PR's
 * steps but does not load it: switching restarts the app, so it waits for a
 * tap.
 *
 * See `lib/pr-preview.ts` for how the switch works and when it is offered.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import * as Updates from 'expo-updates';

import { MarkdownView } from '@/components/MarkdownView';
import {
  canPreviewPullRequests,
  parsePrNumber,
  prFromChannel,
  PREVIEW_REPO,
  type PreviewablePullRequest,
} from '@/lib/pr-preview';
import {
  enterPullRequestPreview,
  fetchOpenPullRequests,
  leavePullRequestPreview,
  PreviewUnavailableError,
} from '@/lib/pr-preview-runtime';

type Busy = number | 'leave' | null;

export default function PreviewPullRequestScreen() {
  const params = useLocalSearchParams<{ number?: string }>();
  const current = prFromChannel(Updates.channel);
  const available = canPreviewPullRequests({
    updatesEnabled: Updates.isEnabled,
    isDev: __DEV__,
    channel: Updates.channel,
  });

  const [input, setInput] = useState(params.number ?? '');
  const [busy, setBusy] = useState<Busy>(null);
  // The linked PR opens expanded; otherwise the one that is loaded.
  const [expanded, setExpanded] = useState<number | null>(
    parsePrNumber(params.number ?? '') ?? current
  );
  const [pulls, setPulls] = useState<PreviewablePullRequest[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const typed = parsePrNumber(input);

  const loadList = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchOpenPullRequests(signal);
      setPulls(next);
      setListError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setListError(e instanceof Error ? e.message : 'Could not load the list.');
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [available, loadList]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadList();
    setRefreshing(false);
  }, [loadList]);

  async function load(n: number) {
    setBusy(n);
    try {
      await enterPullRequestPreview(n, Updates.channel);
    } catch (e) {
      const alreadyCurrent = n === current && e instanceof PreviewUnavailableError;
      Alert.alert(
        alreadyCurrent
          ? 'Up to date'
          : e instanceof PreviewUnavailableError
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
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6366f1" />
      }
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

      <Text style={styles.sectionHeader}>Open pull requests</Text>
      {pulls === null && listError === null ? (
        <View style={styles.card}>
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : listError !== null && pulls === null ? (
        <View style={styles.card}>
          <Text style={styles.body}>{listError}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => void refresh()}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : pulls !== null && pulls.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.body}>No pull requests are open.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {/* A refresh that failed over a list already shown keeps the list
              and says why it did not change. */}
          {listError !== null ? (
            <Text style={styles.listNotice}>{listError}</Text>
          ) : null}
          {(pulls ?? []).map((pr) => (
            <PullRow
              key={pr.number}
              pr={pr}
              loaded={pr.number === current}
              expanded={expanded === pr.number}
              busy={busy}
              onToggle={() =>
                setExpanded((open) => (open === pr.number ? null : pr.number))
              }
              onLoad={() => void load(pr.number)}
            />
          ))}
        </View>
      )}

      <Text style={styles.sectionHeader}>Or enter a number</Text>
      <View style={styles.card}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Number or link, e.g. 321"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => typed !== null && void load(typed)}
          style={styles.input}
        />
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.buttonPrimary,
            pressed && styles.buttonPrimaryPressed,
            (typed === null || busy !== null) && styles.buttonDisabled,
          ]}
          onPress={() => typed !== null && void load(typed)}
          disabled={typed === null || busy !== null}
        >
          {busy !== null && busy === typed ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonPrimaryText}>
              {typed === null ? 'Load preview' : `Load PR #${typed}`}
            </Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Loading a preview restarts the app on that pull request’s code. It stays
        loaded, through restarts, until you go back to main here. Your tasks are
        the same either way: a preview changes the app, not your data. Pull down
        to refresh the list.
      </Text>
    </ScrollView>
  );
}

/**
 * One pull request: its title, and when opened its testing steps and a Load
 * button. Opening and closing animate the height on the UI thread, and the
 * steps fade in, so the rows below move rather than jump.
 */
function PullRow({
  pr,
  loaded,
  expanded,
  busy,
  onToggle,
  onLoad,
}: {
  pr: PreviewablePullRequest;
  loaded: boolean;
  expanded: boolean;
  busy: Busy;
  onToggle: () => void;
  onLoad: () => void;
}) {
  return (
    <Animated.View layout={LinearTransition.duration(200)} style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Pull request ${pr.number}: ${pr.title}`}
        style={({ pressed }) => [styles.rowHeader, pressed && styles.rowHeaderPressed]}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowNumber}>
            #{pr.number}
            {loaded ? <Text style={styles.loadedTag}>  · Loaded</Text> : null}
          </Text>
          <Text style={styles.rowTitle}>{pr.title}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9ca3af"
        />
      </Pressable>
      {expanded ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.rowBody}>
          {pr.howToTry ? (
            <MarkdownView source={pr.howToTry} />
          ) : (
            <Text style={styles.body}>Its description has no testing steps.</Text>
          )}
          <Pressable
            onPress={() =>
              void Linking.openURL(`https://github.com/${PREVIEW_REPO}/pull/${pr.number}`)
            }
            hitSlop={6}
          >
            <Text style={styles.link}>Open on GitHub</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.buttonPrimary,
              pressed && styles.buttonPrimaryPressed,
              busy !== null && styles.buttonDisabled,
            ]}
            onPress={onLoad}
            disabled={busy !== null}
          >
            {busy === pr.number ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonPrimaryText}>
                {loaded ? `Load the newest build of #${pr.number}` : `Load PR #${pr.number}`}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginTop: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  list: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  listNotice: {
    fontSize: 13,
    color: '#4b5563',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowHeaderPressed: { backgroundColor: '#f9fafb' },
  rowText: { flex: 1, gap: 2 },
  rowNumber: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  loadedTag: { color: '#6366f1' },
  rowTitle: { fontSize: 15, color: '#111827', lineHeight: 20 },
  rowBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  value: { fontSize: 17, fontWeight: '600', color: '#111827' },
  body: { fontSize: 15, color: '#374151', lineHeight: 21 },
  link: { fontSize: 14, color: '#4f46e5', fontWeight: '600' },
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
