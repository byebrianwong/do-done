"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PetState } from "@do-done/api-client";
import { PetPanel } from "./PetPanel";
import { getClientPetsApi } from "@/lib/supabase/pets-client";

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
}: {
  className?: string;
}) {
  const [state, setState] = useState<PetState | null>(null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const api = await getClientPetsApi();
      const { data, error } = await api.getState();
      if (cancelledRef.current) return;
      if (error || !data) {
        setErrored(true);
        return;
      }
      setState(data);
      setErrored(false);
    } catch {
      if (!cancelledRef.current) setErrored(true);
    }
  }, []);

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
  return (
    <div
      className={"hidden xl:block " + (className ?? "")}
      style={{ width: 320 }}
    >
      {state ? (
        <PetPanel
          state={state}
          onAcceptGoal={handleAcceptGoal}
          onDismissGoal={handleDismissGoal}
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
      className="h-full animate-pulse"
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
