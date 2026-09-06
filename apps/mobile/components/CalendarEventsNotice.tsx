import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * One line under a list's title bar saying the calendar fetch failed.
 *
 * It renders on `isError` alone, which is narrower than it looks. A user with
 * no Google Calendar connected, one who has switched events off, and one whose
 * day simply has nothing on it all get a successful empty list, so none of them
 * see this — events stay the decoration they are meant to be. What reaches
 * here is an HTTP failure: an expired token, the web app unreachable, no
 * network. Those used to render as an empty day, which is a lie about the
 * user's calendar and the reason this exists.
 *
 * Deliberately not `ListError`: the tasks around it loaded fine, and this is
 * the sidebar's "Couldn't load projects" shape — one section admits it is
 * blind while the screen keeps working. There is no Retry for the same reason.
 * A pull-to-refresh already refetches it, and a button here would sit above a
 * list that is not the thing that failed.
 */
export default function CalendarEventsNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.row}>
      <Ionicons name="cloud-offline-outline" size={13} color="#6b7280" />
      <Text style={styles.text}>Couldn’t load calendar events</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
  },
  // neutral-500 rather than the neutral-400 the app's chrome uses: this is a
  // sentence you have to read, not a label you skim past.
  text: { fontSize: 13, color: '#6b7280' },
});
