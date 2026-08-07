import type { Metadata } from "next";
import { DemoShell } from "@/components/demo/demo-shell";

export const metadata: Metadata = {
  title: "DoDone — live demo",
  description:
    "The whole app, loaded with a week of sample tasks. Nothing to sign up for.",
};

/**
 * The demo runs the real app one level down the URL, against an in-memory
 * sandbox instead of Supabase. See `lib/demo/mode.ts` for why the sandbox
 * exists at all, and `components/demo/demo-shell.tsx` for the provider stack.
 *
 * Thin and server-side so the route group keeps a static shell; everything
 * that touches the sandbox is inside `DemoShell`, which is a client component.
 */
export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DemoShell>{children}</DemoShell>;
}
