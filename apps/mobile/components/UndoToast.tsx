import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Toast = {
  id: number;
  message: string;
  undo: () => void | Promise<void>;
};

type Ctx = { show: (t: Omit<Toast, 'id'>) => void };

const UndoToastContext = createContext<Ctx | null>(null);

const TOAST_TTL_MS = 6000;

export function UndoToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [opacity]);

  const show = useCallback<Ctx['show']>(
    (t) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = ++idRef.current;
      setToast({ ...t, id });
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
      timerRef.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start(() => setToast((cur) => (cur?.id === id ? null : cur)));
      }, TOAST_TTL_MS);
    },
    [opacity]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <UndoToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="box-none">
          <View style={styles.toast}>
            <Text style={styles.message} numberOfLines={2}>
              {toast.message}
            </Text>
            <Pressable
              onPress={async () => {
                const fn = toast.undo;
                dismiss();
                await fn();
              }}
              hitSlop={8}
              style={styles.undoBtn}
            >
              <Text style={styles.undoLabel}>Undo</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </UndoToastContext.Provider>
  );
}

export function useUndoToast(): Ctx {
  const ctx = useContext(UndoToastContext);
  if (!ctx) return { show: () => {} };
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  message: { color: '#f9fafb', fontSize: 14, maxWidth: 240 },
  undoBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  undoLabel: { color: '#a5b4fc', fontSize: 14, fontWeight: '700' },
});
