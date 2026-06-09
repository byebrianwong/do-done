import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Mic toggle for quick-add surfaces. Pulses while listening. Render only when
 * voice is supported (dev-client build); see lib/useVoiceInput.
 */
export default function VoiceMicButton({
  listening,
  onPress,
  disabled,
}: {
  listening: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!listening) {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [listening, pulse]);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityLabel={listening ? 'Stop listening' : 'Add task by voice'}
      style={[styles.button, listening && styles.buttonActive]}
    >
      <Animated.View style={{ opacity: listening ? pulse : 1 }}>
        <Ionicons
          name={listening ? 'mic' : 'mic-outline'}
          size={20}
          color={listening ? '#6366f1' : '#6b7280'}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: '#eef2ff',
  },
});
