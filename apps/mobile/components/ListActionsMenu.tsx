import React, { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { hapticLight } from '@/lib/haptics';
import { useTaskSelection } from '@/lib/task-selection';

export interface ListAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

interface Props {
  /**
   * Screen-specific rows, listed under "Select tasks". This is where a top bar
   * puts the destinations it would otherwise spend an icon on — Today's
   * Completed and Settings, for instance, which are worth reaching and not
   * worth a permanent slot beside Search.
   */
  actions?: ListAction[];
  /** Tint, for the two screens whose bar isn't indigo. Defaults to the accent. */
  color?: string;
}

/**
 * The ⋯ button in a task list's top bar.
 *
 * It exists because multi-select needed a door. Selection used to be entered by
 * holding a row, which is the gesture reordering has to have, so the row paid
 * for that with a permanent grab handle. Moving selection to a menu buys the
 * handle's pixels back on every row of every list — and puts a rare action
 * where rare actions go, instead of one hold away from a very common one.
 *
 * The menu opens as a bottom sheet rather than a popover anchored under the
 * button: every other menu in the app does (the Display sheet, the project
 * picker, the bulk bar's option lists), an anchored panel would have to know
 * the header's height on two different kinds of header, and the sheet lands
 * under the thumb rather than at the far top corner of the screen.
 */
export function ListActionsMenu({ actions = [], color = '#6366f1' }: Props) {
  const [open, setOpen] = useState(false);
  const selection = useTaskSelection();

  /**
   * The row's action, held until this sheet has actually gone.
   *
   * On iOS a `Modal` presented while another is still dismissing never appears
   * — no error, the row just does nothing. Every action here used to navigate,
   * so nothing hit it; "Edit project" opens a sheet, and did nothing at all.
   *
   * `onDismiss` is iOS-only, which is also where the problem is, so Android
   * keeps running the action inline rather than waiting for a callback that
   * will never fire.
   */
  const pending = useRef<(() => void) | null>(null);

  const runPending = useCallback(() => {
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);

  const rows: ListAction[] = [
    {
      key: 'select',
      label: 'Select tasks',
      icon: 'checkmark-circle-outline',
      onPress: () => selection.begin(),
    },
    ...actions,
  ];

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="More actions"
      >
        <Ionicons name="ellipsis-horizontal" size={22} color={color} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        // Nothing is queued when the sheet is dismissed by its backdrop, so
        // this is a no-op on the ordinary way out.
        onDismiss={runPending}
      >
        <Pressable onPress={() => setOpen(false)} style={styles.backdrop}>
          <Pressable onPress={() => {}} style={styles.sheet}>
            {rows.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => {
                  // Dismiss first: arming selection mounts the bulk bar, and a
                  // modal still on screen would sit over the rows it wants
                  // tapped.
                  setOpen(false);
                  hapticLight();
                  if (Platform.OS === 'ios') pending.current = a.onPress;
                  else a.onPress();
                }}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
              >
                <Ionicons name={a.icon} size={20} color="#4b5563" />
                <Text style={styles.rowLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 4 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 28,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  rowPressed: { backgroundColor: '#f3f4f6' },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '500', color: '#111827' },
});
