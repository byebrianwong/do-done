/**
 * Saved places manager.
 *
 * Attaching a reminder happens in the task editor (LocationReminderSheet);
 * this screen is the other half — renaming a place, widening its radius when
 * the reminder keeps missing, and deleting places you no longer visit.
 *
 * It also surfaces the two things that otherwise fail invisibly: the platform
 * cap on monitored regions, and a place with no open tasks (which is
 * deliberately not registered with the OS).
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import {
  GEOFENCE_COOLDOWN_MINUTES,
  GEOFENCE_DWELL_SECONDS,
  GEOFENCE_MAX_REGIONS,
  LOCATION_RADIUS_PRESETS,
  type Location,
} from '@do-done/shared';
import {
  deleteLocation,
  saveLocationAsPlace,
  updateLocation,
  useLocations,
  useLocationsWithPending,
} from '@/lib/location-queries';

export default function LocationsScreen() {
  // Every saved place, not just the ones currently armed — a place whose tasks
  // are all done still needs to be renameable and deletable.
  const { data: locations = [], isLoading, error } = useLocations();
  const { data: targets = [] } = useLocationsWithPending();
  const [editingId, setEditingId] = useState<string | null>(null);

  const cap =
    GEOFENCE_MAX_REGIONS[Platform.OS as keyof typeof GEOFENCE_MAX_REGIONS] ??
    GEOFENCE_MAX_REGIONS.ios;
  const overCap = targets.length > cap;

  /**
   * Same ordering registerUserGeofences() uses, so "Paused" here means exactly
   * the places it trims. Places with no open tasks sort last: they aren't
   * registered at all, which is a different state from being over the cap.
   *
   * The armed half is built from `targets`, which includes one-off places —
   * a place attached inline to a task holds a region like any other, and a cap
   * warning that counted regions this screen didn't list would be unanswerable.
   * The idle half comes from the saved list, since a one-off place with no open
   * tasks has already been swept away by the database.
   */
  const rows = useMemo(() => {
    const armed = [...targets]
      .sort(
        (a, b) =>
          b.pendingCount - a.pendingCount ||
          a.location.name.localeCompare(b.location.name)
      )
      .map(({ location, pendingCount }, index) => ({
        location,
        pendingCount,
        paused: index >= cap,
      }));
    const armedIds = new Set(armed.map((r) => r.location.id));
    const idle = locations
      .filter((l) => !armedIds.has(l.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((location) => ({ location, pendingCount: 0, paused: false }));
    return [...armed, ...idle];
  }, [locations, targets, cap]);

  return (
    <>
      <Stack.Screen options={{ title: 'Saved places' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.blurb}>
          A reminder fires once you&rsquo;ve been inside a place for{' '}
          {GEOFENCE_DWELL_SECONDS} seconds, so driving past doesn&rsquo;t
          trigger it. After one fires it stays quiet for{' '}
          {GEOFENCE_COOLDOWN_MINUTES} minutes.
        </Text>

        {overCap ? (
          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={16} color="#b45309" />
            <Text style={styles.warningText}>
              {Platform.OS === 'ios' ? 'iOS' : 'Android'} watches at most {cap}{' '}
              places at once. The {targets.length - cap} with the fewest open
              tasks are paused.
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#6366f1" />
          </View>
        ) : error ? (
          <Text style={styles.error}>Could not load your saved places.</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            No saved places yet. Open a task, tap the 📍 row, and add one.
          </Text>
        ) : (
          rows.map(({ location, pendingCount, paused }) => (
            <PlaceCard
              key={location.id}
              location={location}
              pendingCount={pendingCount}
              paused={paused}
              editing={editingId === location.id}
              onToggleEdit={() =>
                setEditingId((id) => (id === location.id ? null : location.id))
              }
            />
          ))
        )}
      </ScrollView>
    </>
  );
}

function PlaceCard({
  location,
  pendingCount,
  paused,
  editing,
  onToggleEdit,
}: {
  location: Location;
  pendingCount: number;
  paused: boolean;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const [name, setName] = useState(location.name);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === location.name) return;
    setSaving(true);
    try {
      await updateLocation(location.id, { name: trimmed });
    } catch (e) {
      console.error('[locations] rename failed', e);
      setName(location.name);
      Alert.alert('Could not rename', 'That change didn’t save.');
    } finally {
      setSaving(false);
    }
  };

  const setRadius = async (meters: number) => {
    if (meters === location.radius_meters || saving) return;
    setSaving(true);
    try {
      await updateLocation(location.id, { radius_meters: meters });
    } catch (e) {
      console.error('[locations] radius change failed', e);
      Alert.alert('Could not update', 'That change didn’t save.');
    } finally {
      setSaving(false);
    }
  };

  const keepPlace = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveLocationAsPlace(location.id);
    } catch (e) {
      console.error('[locations] keep failed', e);
      Alert.alert('Could not save', 'That place wasn’t added to your places.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      `Delete “${location.name}”?`,
      pendingCount > 0
        ? `${pendingCount} open ${pendingCount === 1 ? 'task is' : 'tasks are'} reminding you here. Deleting the place removes ${pendingCount === 1 ? 'that reminder' : 'those reminders'} — the ${pendingCount === 1 ? 'task' : 'tasks'} stay.`
        : 'This place has no reminders attached.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLocation(location.id);
            } catch (e) {
              console.error('[locations] delete failed', e);
              Alert.alert('Could not delete', 'That place is still there.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.card, paused && styles.cardPaused]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              onSubmitEditing={saveName}
              maxLength={200}
              style={styles.nameInput}
            />
          ) : (
            <Text style={styles.name} numberOfLines={1}>
              {location.name}
            </Text>
          )}
          {location.address ? (
            <Text style={styles.address} numberOfLines={1}>
              {location.address}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onToggleEdit} hitSlop={8} style={styles.iconBtn}>
          <Ionicons
            name={editing ? 'checkmark' : 'pencil'}
            size={16}
            color="#6b7280"
          />
        </Pressable>
        <Pressable onPress={confirmDelete} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#dc2626" />
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {pendingCount === 0
            ? 'Not watching — no open tasks'
            : `${pendingCount} open ${pendingCount === 1 ? 'task' : 'tasks'}`}
        </Text>
        {paused ? <Text style={styles.pausedTag}>Paused</Text> : null}
        {saving ? <ActivityIndicator size="small" color="#6366f1" /> : null}
      </View>

      {/* A one-off place is here only because it holds a region; it isn't in
          the saved list and disappears with its last reminder. Saying so is
          what stops "why can't I find this place again?". */}
      {location.is_saved ? null : (
        <View style={styles.oneOffRow}>
          <Text style={styles.oneOffText}>
            One-off — goes away with its last reminder
          </Text>
          <Pressable onPress={keepPlace} disabled={saving} style={styles.keepBtn}>
            <Text style={styles.keepBtnText}>Keep</Text>
          </Pressable>
        </View>
      )}

      {editing ? (
        <View style={styles.radiusRow}>
          {LOCATION_RADIUS_PRESETS.map((preset) => {
            const on = preset.meters === location.radius_meters;
            return (
              <Pressable
                key={preset.meters}
                onPress={() => setRadius(preset.meters)}
                style={[styles.radiusChip, on && styles.radiusChipOn]}
              >
                <Text
                  style={[styles.radiusChipText, on && styles.radiusChipTextOn]}
                >
                  {preset.label}
                </Text>
                <Text
                  style={[styles.radiusChipMeta, on && styles.radiusChipTextOn]}
                >
                  {preset.meters} m
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.radiusSummary}>
          Triggers within {location.radius_meters} m
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  blurb: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 14 },
  warning: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  warningText: { flex: 1, fontSize: 12, color: '#b45309', lineHeight: 17 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  error: { fontSize: 13, color: '#dc2626', paddingVertical: 20 },
  empty: { fontSize: 13, color: '#6b7280', lineHeight: 19, paddingVertical: 20 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  cardPaused: { opacity: 0.6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  nameInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#c7d2fe',
    paddingVertical: 2,
  },
  address: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  iconBtn: { padding: 6 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  meta: { fontSize: 12, color: '#6b7280' },
  pausedTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#b45309',
    backgroundColor: '#fffbeb',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  radiusSummary: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  oneOffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  oneOffText: { flex: 1, fontSize: 11, color: '#9ca3af' },
  keepBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  keepBtnText: { fontSize: 12, fontWeight: '700', color: '#4338ca' },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  radiusChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  radiusChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  radiusChipText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  radiusChipMeta: { fontSize: 10, color: '#9ca3af', marginTop: 1 },
  radiusChipTextOn: { color: '#fff' },
});
