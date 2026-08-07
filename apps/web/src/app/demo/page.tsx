import { redirect } from "next/navigation";

/** The demo opens on Today — the view that has the most to say. */
export default function DemoIndex() {
  redirect("/demo/today");
}
