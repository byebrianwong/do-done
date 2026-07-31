/**
 * Bottom-sheet for attaching location reminders to a task.
 *
 * Lists the user's saved places; each one carries two independent toggles
 * ("Arriving" / "Leaving") that map one-to-one onto `task_locations` rows. The
 * inline create flow drops a place at the current position or at a geocoded
 * address, with a radius preset.
 *
 * This sheet owns the permission ask. It is the only place in the app that
 * prompts for location, and it primes with an explanation first — the Android
 * background grant is a trip to system settings, which is bewildering if it
 * arrives unannounced. See lib/geofencing.ts.
 *
 * Presentation mirrors ProjectPickerSheet.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ExpoLocation from 'expo-location';
import {
  DEFAULT_LOCATION_RADIUS_METERS,
  LOCATION_RADIUS_PRESETS,
  type Location,
  type TriggerType,
} from '@do-done/shared';
import {
  createLocation,
  linkTaskLocation,
  unlinkTaskLocation,
  useLocations,
  useTaskLocations,
  type TaskLocationLink,
} from '@/lib/location-queries';
import {
  hasGeofencePermissions,
  requestGeofencePermissions,
  type GeofencePermissionError,
} from '@/lib/geofencing';
import { IS_EXPO_GO } from '@/lib/runtime';

const TRIGGER_LABELS: Record<TriggerType, string> = {
  enter: 'Arriving',
  exit: 'Leaving',
};

function radiusLabel(meters: number): string {
  const preset = LOCATION_RADIUS_PRESETS.find((p) => p.meters === meters);
  if (preset) return preset.label;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

/**
 * Explain before the OS asks. Resolves true if the user agreed to continue —
 * we still have to survive the real system prompts after this.
 */
function primeForPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Remind you at a place',
      Platform.OS === 'android'
        ? "DoDone needs location access that works in the background, so a reminder can reach you when the app is closed.\n\nAndroid asks for this in two steps — the second one opens your settings, where you'll need to pick “Allow all the time”."
        : 'DoDone needs location access that works in the background, so a reminder can reach you when the app is closed.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ]
    );
  });
}

function explainDenial(error: GeofencePermissionError | undefined) {
  if (error === 'unsupported_runtime') {
    Alert.alert(
      'Not available here',
      'Location reminders need a full build of the app — they can’t run in Expo Go.'
    );
    return;
  }
  if (error === 'notifications_denied') {
    Alert.alert(
      'Notifications are off',
      'Location reminders arrive as notifications, so DoDone needs permission to send them.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ]
    );
    return;
  }
  Alert.alert(
    'Location access needed',
    error === 'background_denied'
      ? 'DoDone can see your location while it’s open, but a reminder has to reach you when it isn’t. Choose “Allow all the time” to finish setting this up.'
      : 'Without location access DoDone can’t tell when you’ve arrived somewhere.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ]
  );
}

export function LocationReminderSheet({
  visible,
  taskId,
  onClose,
}: {
  visible: boolean;
  taskId: string;
  onClose: () => void;
}) {
  const { data: locations = [], isLoading } = useLocations();
  const { data: links = [] } = useTaskLocations(visible ? taskId : null);

  const [creating, setCreating] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCreating(false);
      setBusyKey(null);
    }
  }, [visible]);

  const linkedSet = useMemo(
    () => new Set(links.map((l) => `${l.location.id}:${l.trigger_type}`)),
    [links]
  );

  /**
   * Gate the first link behind the permission flow. Existing links keep
   * working without re-asking, and un-linking never asks at all — revoking a
   * reminder shouldn't require granting anything.
   */
  const ensurePermission = async (): Promise<boolean> => {
    if (await hasGeofencePermissions()) return true;
    if (!(await primeForPermission())) return false;

    const { granted, error } = await requestGeofencePermissions();
    if (!granted) {
      explainDenial(error);
      return false;
    }
    return true;
  };

  const toggle = async (location: Location, trigger: TriggerType) => {
    const key = `${location.id}:${trigger}`;
    if (busyKey) return;
    const isLinked = linkedSet.has(key);

    setBusyKey(key);
    try {
      if (isLinked) {
        await unlinkTaskLocation(taskId, location.id, trigger);
      } else {
        if (!(await ensurePermission())) return;
        await linkTaskLocation(taskId, location.id, trigger);
      }
    } catch (e) {
      console.error('[locations] toggle failed', e);
      Alert.alert('Could not save', 'That reminder didn’t stick. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.title}>Remind me at</Text>

          {IS_EXPO_GO ? (
            <Text style={styles.expoGoNote}>
              Location reminders need a full build — they don’t run in Expo Go.
              You can still set them up here.
            </Text>
          ) : null}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : locations.length === 0 ? (
              <Text style={styles.empty}>
                No saved places yet. Add one below and DoDone will nudge you
                when you get there.
              </Text>
            ) : (
              locations.map((loc) => (
                <PlaceRow
                  key={loc.id}
                  location={loc}
                  linkedSet={linkedSet}
                  busyKey={busyKey}
                  onToggle={toggle}
                />
              ))
            )}
          </ScrollView>

          {creating ? (
            <CreatePlaceForm
              onCancel={() => setCreating(false)}
              onEnsurePermission={ensurePermission}
              onCreated={() => setCreating(false)}
            />
          ) : (
            <Pressable onPress={() => setCreating(true)} style={styles.newRow}>
              <View style={styles.newPlus}>
                <Text style={styles.newPlusText}>+</Text>
              </View>
              <Text style={styles.newLabel}>New place</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PlaceRow({
  location,
  linkedSet,
  busyKey,
  onToggle,
}: {
  location: Location;
  linkedSet: Set<string>;
  busyKey: string | null;
  onToggle: (location: Location, trigger: TriggerType) => void;
}) {
  const anyLinked = (['enter', 'exit'] as TriggerType[]).some((t) =>
    linkedSet.has(`${location.id}:${t}`)
  );

  return (
    <View style={[styles.placeRow, anyLinked && styles.placeRowActive]}>
      <View style={styles.placeHead}>
        <Text style={styles.placeName} numberOfLines={1}>
          {location.name}
        </Text>
        <Text style={styles.placeRadius}>
          {radiusLabel(location.radius_meters)}
        </Text>
      </View>
      {location.address ? (
        <Text style={styles.placeAddress} numberOfLines={1}>
          {location.address}
        </Text>
      ) : null}
      <View style={styles.triggerRow}>
        {(['enter', 'exit'] as TriggerType[]).map((trigger) => {
          const key = `${location.id}:${trigger}`;
          const on = linkedSet.has(key);
          const busy = busyKey === key;
          return (
            <Pressable
              key={trigger}
              onPress={() => onToggle(location, trigger)}
              disabled={!!busyKey}
              style={[styles.triggerChip, on && styles.triggerChipOn]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={on ? '#fff' : '#6366f1'} />
              ) : (
                <Text
                  style={[
                    styles.triggerChipText,
                    on && styles.triggerChipTextOn,
                  ]}
                >
                  {on ? '✓ ' : ''}
                  {TRIGGER_LABELS[trigger]}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CreatePlaceForm({
  onCancel,
  onCreated,
  onEnsurePermission,
}: {
  onCancel: () => void;
  onCreated: (location: Location) => void;
  onEnsurePermission: () => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(DEFAULT_LOCATION_RADIUS_METERS);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const useCurrentPosition = async () => {
    if (locating) return;
    setLocating(true);
    try {
      // Reading a position needs the foreground grant at minimum; ask for the
      // full set here so the user isn't interrupted again when they link it.
      if (!(await onEnsurePermission())) return;

      const pos = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });

      const [place] = await ExpoLocation.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (place) {
        const line = [place.name ?? place.street, place.city]
          .filter(Boolean)
          .join(', ');
        if (line) setAddress(line);
        if (!name.trim() && place.name) setName(place.name);
      }
    } catch (e) {
      console.error('[locations] current position failed', e);
      Alert.alert(
        'Could not get your location',
        'Check that location services are on, then try again.'
      );
    } finally {
      setLocating(false);
    }
  };

  const lookUpAddress = async () => {
    const query = address.trim();
    if (!query || locating) return;
    setLocating(true);
    try {
      const [hit] = await ExpoLocation.geocodeAsync(query);
      if (!hit) {
        Alert.alert('No match', `Couldn’t find “${query}” on the map.`);
        return;
      }
      setCoords({ lat: hit.latitude, lng: hit.longitude });
    } catch (e) {
      console.error('[locations] geocode failed', e);
      Alert.alert('Lookup failed', 'Could not search for that address.');
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || !coords || saving) return;
    setSaving(true);
    try {
      const created = await createLocation({
        name: trimmed,
        latitude: coords.lat,
        longitude: coords.lng,
        radius_meters: radius,
        ...(address.trim() ? { address: address.trim() } : {}),
      });
      onCreated(created);
    } catch (e) {
      console.error('[locations] create failed', e);
      Alert.alert('Could not save', 'That place didn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.createWrap}>
      <TextInput
        ref={inputRef}
        value={name}
        onChangeText={setName}
        placeholder="Place name — “Home”, “Tesco”…"
        placeholderTextColor="#9ca3af"
        maxLength={200}
        style={styles.input}
      />
      <View style={styles.addressRow}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={lookUpAddress}
          placeholder="Address (optional)"
          placeholderTextColor="#9ca3af"
          maxLength={500}
          returnKeyType="search"
          style={[styles.input, styles.addressInput]}
        />
        <Pressable
          onPress={lookUpAddress}
          disabled={!address.trim() || locating}
          style={[
            styles.lookUpBtn,
            (!address.trim() || locating) && styles.btnDisabled,
          ]}
        >
          <Text style={styles.lookUpBtnText}>Find</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={useCurrentPosition}
        disabled={locating}
        style={[styles.currentBtn, locating && styles.btnDisabled]}
      >
        {locating ? (
          <ActivityIndicator size="small" color="#4338ca" />
        ) : (
          <Text style={styles.currentBtnText}>◎ Use my current location</Text>
        )}
      </Pressable>

      {coords ? (
        <Text style={styles.coordsNote}>
          Pinned at {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </Text>
      ) : (
        <Text style={styles.coordsHint}>
          Pin a spot with the button above or by finding an address.
        </Text>
      )}

      <Text style={styles.radiusLabel}>How close is “there”?</Text>
      <View style={styles.radiusRow}>
        {LOCATION_RADIUS_PRESETS.map((preset) => {
          const on = preset.meters === radius;
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
      <Text style={styles.radiusHint}>
        {LOCATION_RADIUS_PRESETS.find((p) => p.meters === radius)?.hint}
      </Text>

      <View style={styles.createActions}>
        <Pressable onPress={onCancel} style={styles.createCancel}>
          <Text style={styles.createCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!name.trim() || !coords || saving}
          style={[
            styles.createBtn,
            (!name.trim() || !coords || saving) && styles.btnDisabled,
          ]}
        >
          <Text style={styles.createBtnText}>
            {saving ? 'Saving…' : 'Save place'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  expoGoNote: {
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  list: { maxHeight: 300 },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  empty: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    paddingVertical: 16,
    paddingHorizontal: 4,
  },

  placeRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#f9fafb',
  },
  placeRowActive: { backgroundColor: '#eef2ff' },
  placeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  placeName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  placeRadius: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  placeAddress: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  triggerRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  triggerChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#fff',
    minWidth: 92,
    alignItems: 'center',
  },
  triggerChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  triggerChipText: { fontSize: 12, fontWeight: '600', color: '#4338ca' },
  triggerChipTextOn: { color: '#fff' },

  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  newPlus: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPlusText: { fontSize: 12, color: '#6b7280', lineHeight: 14 },
  newLabel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },

  createWrap: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  addressInput: { flex: 1 },
  lookUpBtn: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
  },
  lookUpBtnText: { fontSize: 13, fontWeight: '700', color: '#4338ca' },
  currentBtn: {
    marginTop: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    alignItems: 'center',
  },
  currentBtnText: { fontSize: 13, fontWeight: '600', color: '#4338ca' },
  coordsNote: { fontSize: 12, color: '#16a34a', marginTop: 8, fontWeight: '600' },
  coordsHint: { fontSize: 12, color: '#9ca3af', marginTop: 8 },

  radiusLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginTop: 14,
  },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
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
  radiusHint: { fontSize: 11, color: '#6b7280', marginTop: 6 },

  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  createCancel: { paddingVertical: 8, paddingHorizontal: 12 },
  createCancelText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  btnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
