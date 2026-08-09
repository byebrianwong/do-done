"use client";

import { SPARK_MS, sparkParticles } from "@do-done/shared";

/**
 * The particle fan thrown out of a checkbox by a completion that earned it.
 *
 * Rendered only for the frames it is in the air — the row mounts it on the tap
 * and drops it again afterwards — so a list of already-completed rows paints
 * without a single spark, and nothing lingers in the tree once it has finished.
 *
 * The geometry is computed once at module load, not per render: the fan is
 * deterministic by design (see `sparkParticles`), so there is exactly one of
 * it, shared by every row in the app.
 */
const PARTICLES = sparkParticles();

export function CompletionSpark({ color }: { color: string }) {
  return (
    <span
      className="pointer-events-none absolute inset-0"
      // The particles are `currentColor`, so the ring's hue is set once here
      // rather than on each of the ten.
      style={{ color }}
      aria-hidden="true"
    >
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="dd-spark"
          style={
            {
              "--tx": `${p.tx}px`,
              "--ty": `${p.ty}px`,
              "--dl": `${p.delay}ms`,
              "--sz": `${p.size}px`,
              // The stagger is spent *inside* the burst, not added to it: a
              // particle that starts late flies for less time, so all ten land
              // on the same frame at SPARK_MS. Mobile re-bases the same way, and
              // the whole burst has to be over before the row starts clipping
              // itself for the collapse.
              "--dd-spark-ms": `${SPARK_MS - p.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
