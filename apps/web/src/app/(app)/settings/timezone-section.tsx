"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_TZ = "America/New_York";

function allTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === "function") return fn("timeZone");
  } catch {
    // fall through to a small fallback list
  }
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "UTC",
  ];
}

function detectTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

async function postTimezone(tz: string): Promise<boolean> {
  try {
    const res = await fetch("/api/preferences/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function TimezoneSection({ timezone }: { timezone: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState(timezone);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const detected = useMemo(detectTimeZone, []);
  const zones = useMemo(() => {
    const list = allTimeZones();
    return list.includes(timezone) ? list : [timezone, ...list];
  }, [timezone]);

  async function applyTimezone(tz: string, msg: string) {
    setSelected(tz);
    setSaving(true);
    setNote(null);
    const ok = await postTimezone(tz);
    setSaving(false);
    setNote(ok ? msg : "Couldn't save timezone — please try again.");
    startTransition(() => router.refresh());
  }

  // Default to the detected timezone when the saved value is still the system
  // default and detection found something different.
  useEffect(() => {
    if (detected && timezone === DEFAULT_TZ && detected !== DEFAULT_TZ) {
      void applyTimezone(detected, `Detected and set your timezone to ${detected}.`);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
        Timezone
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Used to place your scheduled tasks at the right time on your calendar and
        across the app.
      </p>

      <select
        value={selected}
        onChange={(e) => applyTimezone(e.target.value, "Timezone updated.")}
        disabled={saving}
        className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      {detected && detected !== selected && (
        <button
          onClick={() =>
            applyTimezone(detected, `Switched to detected timezone ${detected}.`)
          }
          disabled={saving}
          className="mt-2 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
        >
          Use detected: {detected.replace(/_/g, " ")}
        </button>
      )}

      {note && (
        <div className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {note}
        </div>
      )}
    </div>
  );
}
