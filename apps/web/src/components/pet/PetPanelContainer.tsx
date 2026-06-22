"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PetSettingsPatch, PetState } from "@do-done/api-client";
import type { PetSettingsValues } from "./PetPanel";
import { PetPanel } from "./PetPanel";
import { getClientPetsApi } from "@/lib/supabase/pets-client";
import { getClientUserPrefsApi } from "@/lib/supabase/user-prefs-client";

// Polling interval per the plan: state refetches every 30s and after any
// goal action. No realtime — keeps the dependency surface small.
const POLL_INTERVAL_MS = 30_000;

/**
 * Client-side wrapper that fetches PetState and renders <PetPanel/>.
 *
 * Fails gracefully: if PetsApi.getState errors (e.g. migrations not yet
 * applied to this environment, or RLS rejects), the panel hides itself
 * rather than crashing the page. The pet feature is non-critical chrome.
 */
export function PetPanelContainer({
  className,
  onHide,
}: {
  className?: string;
  /** Collapse the panel. Rendered as a button in the panel header. */
  onHide?: () => void;
}) {
  const [state, setState] = useState<PetState | null>(null);
  const [petSettings, setPetSettings] = useState<PetSettingsValues | null>(null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [petsApi, prefsApi] = await Promise.all([
        getClientPetsApi(),
        getClientUserPrefsApi(),
      ]);
      const [stateRes, prefsRes] = await Promise.all([
        petsApi.getState(),
        prefsApi.get(),
      ]);
      if (cancelledRef.current) return;
      if (stateRes.error || !stateRes.data) {
        setErrored(true);
        return;
      }
      setState(stateRes.data);
      if (prefsRes.data) {
        setPetSettings({
          hunger_daily_decay: prefsRes.data.hunger_daily_decay,
          happiness_weekly_decay: prefsRes.data.happiness_weekly_decay,
          week_end_day: prefsRes.data.week_end_day,
        });
      }
      setErrored(false);
    } catch {
      if (!cancelledRef.current) setErrored(true);
    }
  }, []);

  const handleSavePetSettings = useCallback(
    async (patch: PetSettingsPatch) => {
      const api = await getClientUserPrefsApi();
      const { data } = await api.updatePetSettings(patch);
      if (data) {
        setPetSettings({
          hunger_daily_decay: data.hunger_daily_decay,
          happiness_weekly_decay: data.happiness_weekly_decay,
          week_end_day: data.week_end_day,
        });
      }
      await load();
    },
    [load]
  );

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [load]);

  const handleAcceptGoal = useCallback(
    async (goalId: string) => {
      const api = await getClientPetsApi();
      await api.acceptGoal(goalId);
      await load();
    },
    [load]
  );

  const handleDismissGoal = useCallback(
    async (goalId: string) => {
      const api = await getClientPetsApi();
      await api.declineGoal(goalId);
      await load();
    },
    [load]
  );

  if (errored) return null;

  // Outer wrapper handles visibility (hidden < xl) so we don't fight with
  // PetPanel's own `display: flex` for its column layout. Any extra
  // className from the layout (border-l, etc.) lands on this wrapper.
  //
  // The wrapper is its own pinned column: `sticky top-0` + `h-dvh` +
  // `self-start` keep it the height of the viewport and stop the flex row
  // from stretching it to the (much taller) page height — so Pip stays in
  // view as the task list scrolls and never bleeds into a tall empty strip.
  // `overflow-y-auto` lets the panel scroll internally when its own content
  // is taller than the viewport.
  return (
    <div
      className={
        "hidden self-start sticky top-0 h-dvh overflow-y-auto xl:block " +
        (className ?? "")
      }
      style={{ width: 320 }}
    >
      {state ? (
        <PetPanel
          state={state}
          onAcceptGoal={handleAcceptGoal}
          onDismissGoal={handleDismissGoal}
          petSettings={petSettings ?? undefined}
          onSavePetSettings={handleSavePetSettings}
          onHide={onHide}
        />
      ) : (
        <PetPanelSkeleton />
      )}
    </div>
  );
}

function PetPanelSkeleton() {
  // Soft cream box that matches the panel's chrome so the layout doesn't
  // jump when state arrives.
  return (
    <div
      className="min-h-full animate-pulse"
      style={{
        backgroundColor: "#fffbe6",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(120,100,40,0.06) 1px, transparent 0)",
        backgroundSize: "20px 20px",
      }}
      aria-label="Pip is waking up"
    />
  );
}
