/**
 * Bottom sheet for attaching location reminders to a task.
 *
 * The shape of this screen follows from what people actually do: they type a
 * few letters and a house number, pick the nearest match, and move on. So the
 * sheet is a search field over a list of complete, tappable places — the first
 * tap attaches the reminder, and everything else (which direction, how close,
 * whether to keep the place) is an adjustment made afterwards on a row that is
 * already doing its job.
 *
 * Three things it does not do, each of them a thing the earlier version did:
 *
 *  - **It does not ask for a name.** A place picked from search brings its own
 *    ("Target"); a dropped pin borrows its street line. The name only exists so
 *    the notification can say where you are.
 *  - **It does not make you save the place.** Attaching creates a one-off
 *    location, invisible to the picker and swept away by the database when the
 *    last reminder on it goes. "Save place" promotes it if you want it back.
 *  - **It does not hide behind the keyboard.** Android's edge-to-edge mode
 *    turns off `adjustResize`, so nothing moves on its own: the sheet tracks
 *    the IME height itself and gives the list whatever is left, the same way
 *    QuickAddBar does.
 *
 * This sheet still owns the permission ask — it is the only place in the app
 * that prompts for location — and still primes with an explanation first, since
 * the Android background grant is a trip to system settings. Reading the last
 * known position to bias search is *not* part of that: it never prompts, so
 * opening the sheet stays free. See lib/geofencing.ts.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import {
  DEFAULT_LOCATION_RADIUS_METERS,
  LOCATION_RADIUS_PRESETS,
  type Location,
  type TriggerType,
} from '@do-done/shared';
import {
  createOneOffLocation,
  linkTaskLocation,
  saveLocationAsPlace,
  unlinkTaskLocation,
  updateLocation,
  useLocations,
  useTaskLocations,
} from '@/lib/location-queries';
import {
  getLastKnownPosition,
  hasGeofencePermissions,
  requestGeofencePermissions,
  type GeofencePermissionError,
} from '@/lib/geofencing';
import {
  formatDistance,
  haversineMeters,
  searchPlaces,
  type Coordinates,
  type PlaceSuggestion,
} from '@/lib/place-search';
import { IS_EXPO_GO } from '@/lib/runtime';
import { MapPreview } from './MapPreview';

const TRIGGER_LABELS: Record<TriggerType, string> = {
  enter: 'Arriving',
  exit: 'Leaving',
};

/** Attaching a place means "remind me when I get there" until told otherwise. */
const DEFAULT_TRIGGER: TriggerType = 'enter';

/**
 * Short enough to feel live, long enough that a typed word is one request
 * rather than six. The provider is keyless and asks callers to be fair.
 */
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

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

/**
 * The keyboard's height, tracked rather than assumed.
 *
 * `edgeToEdgeEnabled` in app.config.ts turns off Android's `adjustResize`, so
 * the window does not shrink when the IME appears and a bottom-anchored sheet
 * would simply be behind it. Same approach as QuickAddBar.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) =>
      setHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

interface AttachedPlace {
  location: Location;
  triggers: Set<TriggerType>;
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
  const { data: savedPlaces = [], isLoading } = useLocations();
  const { data: links = [] } = useTaskLocations(visible ? taskId : null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [position, setPosition] = useState<Coordinates | null>(null);

  const keyboardHeight = useKeyboardHeight();
  const { height: screenHeight } = useWindowDimensions();

  // Where the user is, if the OS already knows and we're already allowed to
  // ask. Biases search towards the Target down the road rather than the one
  // three cities over, and puts the "you" dot on the map.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getLastKnownPosition().then((p) => {
      if (!cancelled && p) setPosition(p);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (visible) return;
    setQuery('');
    setResults([]);
    setSearching(false);
    setSearchFailed(false);
    setBusyKey(null);
    setExpandedId(null);
  }, [visible]);

  /**
   * Debounced type-ahead.
   *
   * The abort lives in the effect's cleanup, not in the next timer callback:
   * a request already in flight has to be dropped the moment its query stops
   * being what's on screen, or a slow answer for "tesc" lands on top of the
   * results for "tesco" — the one race in a search box that users notice,
   * because the row they were reaching for moves.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    setSearchFailed(false);

    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q, {
          near: position,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setResults(found);
        setSearching(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.warn('[locations] place search failed', e);
        setResults([]);
        setSearchFailed(true);
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, position]);

  /** One row per place, carrying whichever directions are switched on. */
  const attached = useMemo(() => {
    const byId = new Map<string, AttachedPlace>();
    for (const link of links) {
      const entry = byId.get(link.location.id) ?? {
        location: link.location,
        triggers: new Set<TriggerType>(),
      };
      entry.triggers.add(link.trigger_type);
      byId.set(link.location.id, entry);
    }
    return [...byId.values()];
  }, [links]);

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => a.location.id)),
    [attached]
  );

  /** Saved places worth offering: not already on this task, matching what's typed. */
  const savedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return savedPlaces
      .filter((place) => !attachedIds.has(place.id))
      .filter(
        (place) =>
          !q ||
          place.name.toLowerCase().includes(q) ||
          (place.address ?? '').toLowerCase().includes(q)
      );
  }, [savedPlaces, attachedIds, query]);

  /**
   * Gate the first link behind the permission flow. Existing links keep
   * working without re-asking, and un-linking never asks at all — revoking a
   * reminder shouldn't require granting anything.
   */
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (await hasGeofencePermissions()) return true;
    if (!(await primeForPermission())) return false;

    const { granted, error } = await requestGeofencePermissions();
    if (!granted) {
      explainDenial(error);
      return false;
    }
    return true;
  }, []);

  /** Clear the search back to the resting state once something is attached. */
  const settleAfterAttach = (locationId: string) => {
    setQuery('');
    setResults([]);
    setExpandedId(locationId);
    Keyboard.dismiss();
  };

  const attachSaved = async (place: Location) => {
    if (busyKey) return;
    setBusyKey(`saved:${place.id}`);
    try {
      if (!(await ensurePermission())) return;
      await linkTaskLocation(taskId, place.id, DEFAULT_TRIGGER);
      settleAfterAttach(place.id);
    } catch (e) {
      console.error('[locations] attach failed', e);
      Alert.alert('Could not save', 'That reminder didn’t stick. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Attach a searched place. The location row is created one-off: the user
   * asked for a reminder, not for a new entry in their places list.
   */
  const attachSuggestion = async (suggestion: PlaceSuggestion) => {
    if (busyKey) return;
    setBusyKey(`suggestion:${suggestion.id}`);
    try {
      if (!(await ensurePermission())) return;
      const created = await createOneOffLocation({
        name: suggestion.name,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        radius_meters: DEFAULT_LOCATION_RADIUS_METERS,
        ...(suggestion.address ? { address: suggestion.address } : {}),
      });
      await linkTaskLocation(taskId, created.id, DEFAULT_TRIGGER);
      settleAfterAttach(created.id);
    } catch (e) {
      console.error('[locations] attach suggestion failed', e);
      Alert.alert('Could not save', 'That place didn’t attach. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Last resort: hand the typed text to the OS geocoder.
   *
   * `geocodeAsync` answers with coordinates and no label, which is why it can't
   * drive the suggestion list — but it runs on the platform's own geocoder
   * rather than a third party, so it still works when Photon is unreachable or
   * simply doesn't know a place. Without this, a provider outage would leave no
   * way at all to attach an address.
   */
  const attachTypedAddress = async () => {
    const typed = query.trim();
    if (!typed || busyKey) return;
    setBusyKey('typed');
    try {
      if (!(await ensurePermission())) return;

      const [hit] = await ExpoLocation.geocodeAsync(typed);
      if (!hit) {
        Alert.alert('No match', `Couldn’t find “${typed}” on the map.`);
        return;
      }
      const created = await createOneOffLocation({
        name: typed.slice(0, 200),
        latitude: hit.latitude,
        longitude: hit.longitude,
        radius_meters: DEFAULT_LOCATION_RADIUS_METERS,
        address: typed.slice(0, 500),
      });
      await linkTaskLocation(taskId, created.id, DEFAULT_TRIGGER);
      settleAfterAttach(created.id);
    } catch (e) {
      console.error('[locations] address lookup failed', e);
      Alert.alert('Lookup failed', 'Could not search for that address.');
    } finally {
      setBusyKey(null);
    }
  };

  /** "Right here" — a pin at the current fix, named from a reverse geocode. */
  const attachCurrentPosition = async () => {
    if (locating || busyKey) return;
    setLocating(true);
    try {
      if (!(await ensurePermission())) return;

      const fix = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const here = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
      };
      setPosition(here);

      let name = 'Here';
      let address = '';
      try {
        const [place] = await ExpoLocation.reverseGeocodeAsync(here);
        if (place) {
          const street = [place.streetNumber, place.street]
            .filter(Boolean)
            .join(' ');
          name = place.name || street || place.city || 'Here';
          address = [street, place.city, place.region]
            .filter(Boolean)
            .filter((part) => part !== name)
            .join(', ');
        }
      } catch {
        // No label is a cosmetic loss; the coordinates are what geofences on.
      }

      const created = await createOneOffLocation({
        name,
        latitude: here.latitude,
        longitude: here.longitude,
        radius_meters: DEFAULT_LOCATION_RADIUS_METERS,
        ...(address ? { address } : {}),
      });
      await linkTaskLocation(taskId, created.id, DEFAULT_TRIGGER);
      settleAfterAttach(created.id);
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

  const toggleTrigger = async (place: AttachedPlace, trigger: TriggerType) => {
    const key = `${place.location.id}:${trigger}`;
    if (busyKey) return;
    const on = place.triggers.has(trigger);

    // Switching off the only direction left removes the reminder entirely —
    // and takes a one-off place with it, since nothing else points at it.
    if (on && place.triggers.size === 1) {
      await detach(place);
      return;
    }

    setBusyKey(key);
    try {
      if (on) {
        await unlinkTaskLocation(taskId, place.location.id, trigger);
      } else {
        if (!(await ensurePermission())) return;
        await linkTaskLocation(taskId, place.location.id, trigger);
      }
    } catch (e) {
      console.error('[locations] toggle failed', e);
      Alert.alert('Could not save', 'That reminder didn’t stick. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const detach = async (place: AttachedPlace) => {
    const key = `${place.location.id}:detach`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      for (const trigger of place.triggers) {
        await unlinkTaskLocation(taskId, place.location.id, trigger);
      }
      setExpandedId((id) => (id === place.location.id ? null : id));
    } catch (e) {
      console.error('[locations] detach failed', e);
      Alert.alert('Could not remove', 'That reminder is still there.');
    } finally {
      setBusyKey(null);
    }
  };

  const changeRadius = async (place: AttachedPlace, meters: number) => {
    if (busyKey || meters === place.location.radius_meters) return;
    setBusyKey(`${place.location.id}:radius`);
    try {
      await updateLocation(place.location.id, { radius_meters: meters });
    } catch (e) {
      console.error('[locations] radius change failed', e);
      Alert.alert('Could not update', 'That change didn’t save.');
    } finally {
      setBusyKey(null);
    }
  };

  const keepPlace = async (place: AttachedPlace) => {
    if (busyKey) return;
    setBusyKey(`${place.location.id}:save`);
    try {
      await saveLocationAsPlace(place.location.id);
    } catch (e) {
      console.error('[locations] save place failed', e);
      Alert.alert('Could not save', 'That place wasn’t added to your places.');
    } finally {
      setBusyKey(null);
    }
  };

  const searchingOrTyping = query.trim().length >= MIN_QUERY_LENGTH;
  // Leave room above the sheet for the backdrop to stay tappable, and never
  // let the content reach under the keyboard.
  const maxSheetHeight = Math.max(screenHeight - keyboardHeight - 72, 260);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            { marginBottom: keyboardHeight, maxHeight: maxSheetHeight },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Remind me at</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#9ca3af" />
            </Pressable>
          </View>

          {IS_EXPO_GO ? (
            <Text style={styles.expoGoNote}>
              Location reminders need a full build — they don’t run in Expo Go.
              You can still set them up here.
            </Text>
          ) : null}

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="#9ca3af" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a place or address"
              placeholderTextColor="#9ca3af"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {searching ? <ActivityIndicator size="small" color="#6366f1" /> : null}
            {query.length > 0 && !searching ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#c7cbd1" />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            contentContainerStyle={styles.listContent}
          >
            {attached.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>On this task</Text>
                {attached.map((place) => (
                  <AttachedRow
                    key={place.location.id}
                    place={place}
                    expanded={expandedId === place.location.id}
                    busyKey={busyKey}
                    position={position}
                    onToggleExpand={() =>
                      setExpandedId((id) =>
                        id === place.location.id ? null : place.location.id
                      )
                    }
                    onToggleTrigger={(trigger) => toggleTrigger(place, trigger)}
                    onChangeRadius={(meters) => changeRadius(place, meters)}
                    onKeep={() => keepPlace(place)}
                    onRemove={() => detach(place)}
                  />
                ))}
              </>
            ) : null}

            {searchingOrTyping ? (
              <>
                {results.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Search results</Text>
                    {results.map((suggestion) => (
                      <SuggestionRow
                        key={suggestion.id}
                        suggestion={suggestion}
                        busy={busyKey === `suggestion:${suggestion.id}`}
                        disabled={!!busyKey}
                        onPress={() => attachSuggestion(suggestion)}
                      />
                    ))}
                  </>
                ) : null}

                {!searching && (searchFailed || results.length === 0) ? (
                  <>
                    <Text style={styles.searchNote}>
                      {searchFailed
                        ? 'Couldn’t search for places just now.'
                        : `Nothing found for “${query.trim()}”.`}
                    </Text>
                    {/* The OS geocoder knows no names, so it can't fill the
                        list above — but it can still place a typed address,
                        which is what keeps this screen usable when the search
                        provider is down. */}
                    <Pressable
                      onPress={attachTypedAddress}
                      disabled={!!busyKey}
                      style={({ pressed }) => [
                        styles.pickRow,
                        pressed && styles.pickRowPressed,
                      ]}
                    >
                      <Ionicons name="navigate-outline" size={18} color="#6366f1" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.placeName} numberOfLines={1}>
                          Look up “{query.trim()}”
                        </Text>
                        <Text style={styles.placeMeta}>
                          Find this address with your phone’s own map data
                        </Text>
                      </View>
                      {busyKey === 'typed' ? (
                        <ActivityIndicator size="small" color="#6366f1" />
                      ) : null}
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}

            {savedMatches.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Saved places</Text>
                {savedMatches.map((place) => (
                  <SavedRow
                    key={place.id}
                    place={place}
                    position={position}
                    busy={busyKey === `saved:${place.id}`}
                    disabled={!!busyKey}
                    onPress={() => attachSaved(place)}
                  />
                ))}
              </>
            ) : null}

            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : null}

            {!isLoading &&
            attached.length === 0 &&
            savedMatches.length === 0 &&
            !searchingOrTyping ? (
              <Text style={styles.empty}>
                Type a shop, a street or an address above — then pick the one
                you meant. DoDone will nudge you when you get there.
              </Text>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={attachCurrentPosition}
            disabled={locating || !!busyKey}
            style={[styles.currentBtn, (locating || !!busyKey) && styles.disabled]}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#4338ca" />
            ) : (
              <>
                <Ionicons name="locate" size={16} color="#4338ca" />
                <Text style={styles.currentBtnText}>Use where I am now</Text>
              </>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A place already reminding on this task: directions, radius, and its fate. */
function AttachedRow({
  place,
  expanded,
  busyKey,
  position,
  onToggleExpand,
  onToggleTrigger,
  onChangeRadius,
  onKeep,
  onRemove,
}: {
  place: AttachedPlace;
  expanded: boolean;
  busyKey: string | null;
  position: Coordinates | null;
  onToggleExpand: () => void;
  onToggleTrigger: (trigger: TriggerType) => void;
  onChangeRadius: (meters: number) => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const { location } = place;

  return (
    <View style={styles.attachedRow}>
      <Pressable onPress={onToggleExpand} style={styles.attachedHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.placeName} numberOfLines={1}>
            {location.name}
          </Text>
          <Text style={styles.placeMeta} numberOfLines={1}>
            {[
              [...place.triggers]
                .map((t) => TRIGGER_LABELS[t])
                .sort()
                .join(' + '),
              radiusLabel(location.radius_meters),
              location.address,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#9ca3af"
        />
      </Pressable>

      <View style={styles.triggerRow}>
        {(['enter', 'exit'] as TriggerType[]).map((trigger) => {
          const key = `${location.id}:${trigger}`;
          const on = place.triggers.has(trigger);
          return (
            <Pressable
              key={trigger}
              onPress={() => onToggleTrigger(trigger)}
              disabled={!!busyKey}
              style={[styles.triggerChip, on && styles.triggerChipOn]}
            >
              {busyKey === key ? (
                <ActivityIndicator size="small" color={on ? '#fff' : '#6366f1'} />
              ) : (
                <Text
                  style={[styles.triggerChipText, on && styles.triggerChipTextOn]}
                >
                  {on ? '✓ ' : ''}
                  {TRIGGER_LABELS[trigger]}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {expanded ? (
        <View style={styles.detail}>
          <MapPreview
            center={{
              latitude: location.latitude,
              longitude: location.longitude,
            }}
            radiusMeters={location.radius_meters}
            you={position}
            label={location.address ?? location.name}
          />

          <Text style={styles.detailLabel}>How close is “there”?</Text>
          <View style={styles.radiusRow}>
            {LOCATION_RADIUS_PRESETS.map((preset) => {
              const on = preset.meters === location.radius_meters;
              return (
                <Pressable
                  key={preset.meters}
                  onPress={() => onChangeRadius(preset.meters)}
                  disabled={!!busyKey}
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

          <View style={styles.detailActions}>
            {location.is_saved ? (
              <Text style={styles.savedTag}>In your saved places</Text>
            ) : (
              <Pressable
                onPress={onKeep}
                disabled={!!busyKey}
                style={styles.keepBtn}
              >
                <Ionicons name="bookmark-outline" size={14} color="#4338ca" />
                <Text style={styles.keepBtnText}>Save place</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onRemove}
              disabled={!!busyKey}
              style={styles.removeBtn}
            >
              <Text style={styles.removeBtnText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SuggestionRow({
  suggestion,
  busy,
  disabled,
  onPress,
}: {
  suggestion: PlaceSuggestion;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.pickRow, pressed && styles.pickRowPressed]}
    >
      <Ionicons name="location-outline" size={18} color="#6366f1" />
      <View style={{ flex: 1 }}>
        <Text style={styles.placeName} numberOfLines={1}>
          {suggestion.name}
        </Text>
        {suggestion.address ? (
          <Text style={styles.placeMeta} numberOfLines={1}>
            {suggestion.address}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : suggestion.distanceMeters !== undefined ? (
        <Text style={styles.distance}>
          {formatDistance(suggestion.distanceMeters)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SavedRow({
  place,
  position,
  busy,
  disabled,
  onPress,
}: {
  place: Location;
  position: Coordinates | null;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const distance = position
    ? formatDistance(
        haversineMeters(position, {
          latitude: place.latitude,
          longitude: place.longitude,
        })
      )
    : '';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.pickRow, pressed && styles.pickRowPressed]}
    >
      <Ionicons name="bookmark" size={16} color="#6366f1" />
      <View style={{ flex: 1 }}>
        <Text style={styles.placeName} numberOfLines={1}>
          {place.name}
        </Text>
        <Text style={styles.placeMeta} numberOfLines={1}>
          {[radiusLabel(place.radius_meters), place.address]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : distance ? (
        <Text style={styles.distance}>{distance}</Text>
      ) : null}
    </Pressable>
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
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  title: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  closeBtn: { padding: 2 },
  expoGoNote: {
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    backgroundColor: '#fff',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827' },

  // flexShrink defaults to 0 in Yoga, unlike the web. Without this the list
  // keeps its full content height and pushes the "use where I am" row (and the
  // bottom of the sheet) off the screen instead of scrolling.
  list: { flexShrink: 1, marginTop: 4 },
  listContent: { paddingBottom: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  empty: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    paddingVertical: 18,
    paddingHorizontal: 4,
  },
  searchNote: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  pickRowPressed: { backgroundColor: '#f3f4f6' },
  placeName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  placeMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  distance: { fontSize: 11, fontWeight: '600', color: '#9ca3af' },

  attachedRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#eef2ff',
  },
  attachedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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

  detail: { marginTop: 12, gap: 8 },
  detailLabel: { fontSize: 12, fontWeight: '700', color: '#374151' },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radiusChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  radiusChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  radiusChipText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  radiusChipMeta: { fontSize: 10, color: '#9ca3af', marginTop: 1 },
  radiusChipTextOn: { color: '#fff' },
  detailActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  keepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  keepBtnText: { fontSize: 12, fontWeight: '700', color: '#4338ca' },
  savedTag: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  removeBtn: { paddingVertical: 8, paddingHorizontal: 10 },
  removeBtnText: { fontSize: 12, fontWeight: '700', color: '#dc2626' },

  currentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  currentBtnText: { fontSize: 13, fontWeight: '600', color: '#4338ca' },
  disabled: { opacity: 0.5 },
});
