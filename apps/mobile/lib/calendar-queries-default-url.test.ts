/**
 * The web app URL falls back to production when nothing configures it.
 *
 * This is the regression for a bug with no signal on a device: the URL used to
 * come only from EXPO_PUBLIC_WEB_APP_URL / extra.webAppUrl, and an
 * `EXPO_PUBLIC_*` var has to reach the bundler, so an EAS build or OTA bundle
 * published without it disabled calendar events on Today and Upcoming with
 * nothing said anywhere. It looked exactly like a clear week.
 *
 * It lives in its own file because the module resolves the URL once at import,
 * and `calendar-queries.test.ts` sets the env var before importing it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.EXPO_PUBLIC_WEB_APP_URL;

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
// No `extra.webAppUrl`: an app.config.ts that was never given the override.
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
  },
}));

const { fetchCalendarList } = await import("./calendar-queries");

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ calendars: [], hidden: [] }),
  })) as unknown as typeof fetch;
});

describe("web app URL with nothing configured", () => {
  it("still calls the production web app rather than giving up", async () => {
    await fetchCalendarList();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://dodone.byebrianwong.com/api/calendar/list",
      { headers: { Authorization: "Bearer t" } }
    );
  });

  it("treats a declared-but-empty env var as unset", async () => {
    vi.resetModules();
    process.env.EXPO_PUBLIC_WEB_APP_URL = "";
    const { fetchCalendarList: fresh } = await import("./calendar-queries");
    await fresh();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://dodone.byebrianwong.com/api/calendar/list",
      { headers: { Authorization: "Bearer t" } }
    );
    delete process.env.EXPO_PUBLIC_WEB_APP_URL;
  });
});
