import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { SPARK_MS, sparkParticles, type SparkParticle } from '@do-done/shared';

/**
 * The particle fan thrown out of a checkbox by a completion that earned it.
 *
 * Ten plain `Animated.View`s off one shared value, running on the UI thread —
 * which is why they stay smooth mid-scroll, and why this deliberately does not
 * reach for Skia or Lottie. Neither is installed, and either would mean a fresh
 * `eas build` before anyone could see a single spark.
 *
 * The geometry comes from `@do-done/shared`, so the burst has the same shape
 * here as on the web.
 */
const PARTICLES = sparkParticles();

/** How much of the tail is spent fading out. */
const FADE_FROM = 0.7;

function Particle({
  particle,
  progress,
  color,
}: {
  particle: SparkParticle;
  progress: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    // Each particle re-bases the shared 0→1 onto its own stagger, so one value
    // drives all ten without the parent having to animate ten of them.
    const start = particle.delay / SPARK_MS;
    const span = 1 - start;
    const raw = span <= 0 ? progress.value : (progress.value - start) / span;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return {
      opacity: t <= 0 ? 0 : t < FADE_FROM ? 1 : (1 - t) / (1 - FADE_FROM),
      transform: [
        { translateX: particle.tx * t },
        { translateY: particle.ty * t },
        { scale: 1 - 0.65 * t },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          marginLeft: -particle.size / 2,
          marginTop: -particle.size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function CompletionSpark({
  progress,
  color,
}: {
  progress: SharedValue<number>;
  /**
   * The ring's own colour. The ring is the project's colour, so a fixed festive
   * palette would clash with half the projects a user can make; scattering the
   * hue that is already there can't.
   */
  color: string;
}) {
  return (
    <View style={styles.root} pointerEvents="none">
      {PARTICLES.map((p, i) => (
        <Particle key={i} particle={p} progress={progress} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Zero-sized and centred on the ring, so every particle's translate is
  // measured from the middle of the checkbox rather than a corner.
  root: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 0,
    height: 0,
  },
  particle: { position: 'absolute' },
});
