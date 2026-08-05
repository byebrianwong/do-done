/**
 * Contract tests for the calendar-list fetch behind the "Calendars to show"
 * screen.
 *
 * Two things here are load-bearing and invisible on a device. A user who has
 * never connected Google Calendar must reach an explanatory screen rather than
 * a generic error, which depends on the 400 being mapped to its own error type
 * (and not retried). And `hidden` has three meanings, not two: an array is a
 * saved selection, `null` means never configured — defer to Google's own
 * visible flags — and the two produce different ticks on first open. A
 * response that omits the field must land as `null`, never as `[]`, which
 * would read as "the user chose to hide nothing".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.EXPO_PUBLIC_WEB_APP_URL = "https://dodone.example.com";

// Native seams absent in node: AppState (module scope) and expo-constants.
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

const getSession = vi.fn(async () => ({
  data: { session: { access_token: "token-abc" } },
}));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession } } }));

const { fetchCalendarList, CalendarNotConnectedError } = await import(
  "./calendar-queries"
);

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  getSession.mockClear();
});

describe("fetchCalendarList", () => {
  it("maps the not-connected 400 to its own error, so the screen can explain it", async () => {
    global.fetch = respond(400, { error: "not_connected" });
    await expect(fetchCalendarList()).rejects.toBeInstanceOf(
      CalendarNotConnectedError
    );
  });

  it("throws a plain error on other failures, which React Query will retry", async () => {
    global.fetch = respond(500, { error: "list_failed" });
    const err = await fetchCalendarList().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CalendarNotConnectedError);
  });

  it("keeps a stored selection as an array", async () => {
    global.fetch = respond(200, { calendars: [], hidden: ["a", "b"] });
    await expect(fetchCalendarList()).resolves.toEqual({
      calendars: [],
      hidden: ["a", "b"],
    });
  });

  it("keeps an empty selection distinct from an absent one", async () => {
    global.fetch = respond(200, { calendars: [], hidden: [] });
    // [] means "hide nothing" — a real saved choice, not a missing one.
    expect((await fetchCalendarList()).hidden).toEqual([]);
  });

  it("normalises a missing or null hidden to null, never to []", async () => {
    global.fetch = respond(200, { calendars: [] });
    expect((await fetchCalendarList()).hidden).toBeNull();

    global.fetch = respond(200, { calendars: [], hidden: null });
    expect((await fetchCalendarList()).hidden).toBeNull();
  });

  it("sends the supabase access token as a bearer", async () => {
    const spy = respond(200, { calendars: [], hidden: [] });
    global.fetch = spy;
    await fetchCalendarList();
    expect(spy).toHaveBeenCalledWith(
      "https://dodone.example.com/api/calendar/list",
      { headers: { Authorization: "Bearer token-abc" } }
    );
  });

  it("refuses to call the API without a session", async () => {
    getSession.mockResolvedValueOnce({
      data: { session: null },
    } as unknown as Awaited<ReturnType<typeof getSession>>);
    const spy = respond(200, {});
    global.fetch = spy;
    await expect(fetchCalendarList()).rejects.toThrow("not signed in");
    expect(spy).not.toHaveBeenCalled();
  });
});
