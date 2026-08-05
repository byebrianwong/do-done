import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CalendarSection } from "@/app/(app)/settings/calendar-section";

// A calendar list shaped like a real one: a couple of writable calendars the
// user actually lives in, buried in a drift of read-only subscriptions
// (holidays, weather, sports, imported booking feeds). This is the case the
// picker exists for — the calendars that matter sit near the BOTTOM of the
// list Google returns, which is exactly where a positional cap cut them off.
const CALENDARS = [
  { id: "holidays", summary: "Holidays in United States", color: "#0b8043" },
  { id: "others-plans", summary: "Others' Plans", color: "#7986cb" },
  { id: "courtreserve-1", summary: "Court bookings (13234)", color: "#616161" },
  { id: "courtreserve-2", summary: "Court bookings (13233)", color: "#616161" },
  { id: "moon", summary: "Phases of the Moon", color: "#8e24aa" },
  { id: "courtreserve-3", summary: "Court bookings (10054)", color: "#616161" },
  { id: "mine", summary: "My Calendar", primary: true, color: "#039be5" },
  { id: "personal", summary: "personal@example.com", color: "#3f51b5" },
  { id: "travel", summary: "Travel", color: "#e67c73" },
  { id: "giants", summary: "San Francisco Giants", color: "#f4511e" },
  { id: "49ers", summary: "San Francisco 49ers", color: "#f4511e" },
  { id: "warriors", summary: "Golden State Warriors", color: "#f4511e" },
  { id: "bears", summary: "California Golden Bears football", color: "#f4511e" },
  { id: "weather", summary: "San Jose, California Weather", color: "#4285f4" },
  { id: "dog", summary: "August the Border Collie", color: "#33b679" },
  { id: "todoist", summary: "Todoist", color: "#d50000" },
  { id: "dodone", summary: "DoDone", color: "#6366f1" },
  { id: "work", summary: "work@example.com", color: "#795548" },
  { id: "lucas", summary: "Baby Lucas", color: "#f6bf26" },
  { id: "partner", summary: "partner@example.com", color: "#c0ca33" },
  { id: "winston-travel", summary: "Winston's Travel", color: "#e4c441" },
  { id: "todo", summary: "To Do", color: "#a79b8e" },
].map((c) => ({
  primary: false,
  // Only the handful you'd actually write to; the rest are subscriptions.
  canWrite: ["mine", "personal", "dodone", "todoist", "work", "lucas"].includes(
    c.id
  ),
  selected: true,
  ...c,
}));

/**
 * Serve `/api/calendar/list` from a literal, so the section mounts without a
 * Google token or a signed-in session. Installed during render (not in an
 * effect) so it's in place before the component's own effect fires.
 */
function mockList(hidden: string[] | null) {
  return function Decorator(Story: () => React.ReactElement) {
    const real = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/calendar/list")) {
        return new Response(
          JSON.stringify({ calendars: CALENDARS, selected: "dodone", hidden }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      return real(input as RequestInfo, init);
    }) as typeof window.fetch;
    return <Story />;
  };
}

const meta = {
  title: "Settings/CalendarSection",
  component: CalendarSection,
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
  args: {
    isConnected: true,
    showEvents: true,
    syncedAt: "2026-08-04T17:42:10.000Z",
    status: null,
    errorMessage: null,
  },
} satisfies Meta<typeof CalendarSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A saved selection: the noise unticked, the calendars you live in kept. */
export const Default: Story = {
  decorators: [
    mockList([
      "holidays",
      "moon",
      "courtreserve-1",
      "courtreserve-2",
      "courtreserve-3",
      "giants",
      "49ers",
      "warriors",
      "bears",
      "weather",
      "winston-travel",
    ]),
  ],
};

/**
 * First visit, nothing configured, and Google has more calendars ticked than
 * DoDone will load. The old code dropped the tail in silence; the warning now
 * names what isn't loading and says how many to untick.
 */
export const OverLimit: Story = {
  decorators: [mockList(null)],
};

/**
 * Exactly at the cap. Unticked rows go inert rather than accepting a click
 * that can't take effect.
 */
export const AtLimit: Story = {
  decorators: [mockList(["holidays", "moon"])],
};

/** Events switched off entirely — the picker has nothing to say, so it goes. */
export const EventsHidden: Story = {
  args: { showEvents: false },
  decorators: [mockList([])],
};

/** Not connected yet: no dropdown, no picker, just the Connect call to action. */
export const Disconnected: Story = {
  args: { isConnected: false, syncedAt: null },
  decorators: [mockList(null)],
};
