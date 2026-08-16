"use client";

import { PlacesManager } from "@/app/(app)/places/places-manager";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

/**
 * The same manager the real app renders. It reads through
 * `getClientLocationsApi()`, which hands back the sandbox's own store on a
 * `/demo` route, so nothing here has to be a demo variant.
 *
 * `ready` is still gated on: the manager loads in an effect, and rendering it
 * before the sandbox has hydrated would flash "No places yet" at a visitor who
 * has three.
 */
export default function DemoPlacesPage() {
  const { ready } = useDemoData();
  if (!ready) return <DemoLoading rows={3} />;

  return <PlacesManager />;
}
