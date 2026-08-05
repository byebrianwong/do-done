/**
 * Write-path tests for saved and one-off places.
 *
 * Both failure modes here are invisible on a device. A place created without
 * `is_saved: false` looks identical the moment you make it — it only shows up
 * later, as a saved-places list slowly filling with shops you visited once. And
 * a write that doesn't resync geofences leaves the OS monitoring the previous
 * set, which looks exactly like a reminder that simply didn't fire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock("./query-client", () => ({ queryClient }));

// The geofence engine reaches for expo-location and a background task
// definition; here we only care that it was asked to re-register.
const registerUserGeofences = vi.fn(async () => ({ registered: 0, skipped: 0 }));
vi.mock("./geofencing", () => ({ registerUserGeofences }));

const create = vi.fn(async (input: unknown) => ({
  data: { id: "loc-1", ...(input as object) },
  error: null,
}));
const update = vi.fn(async () => ({ data: null, error: null }));
const save = vi.fn(async () => ({ data: null, error: null }));
const linkTask = vi.fn(async (): Promise<{ error: Error | null }> => ({
  error: null,
}));
const unlinkTask = vi.fn(async (): Promise<{ error: Error | null }> => ({
  error: null,
}));
vi.mock("./supabase", () => ({
  getLocationsApi: async () => ({ create, update, save, linkTask, unlinkTask }),
}));

const {
  createLocation,
  createOneOffLocation,
  linkTaskLocation,
  saveLocationAsPlace,
  unlinkTaskLocation,
} = await import("./location-queries");

const NEW_PLACE = {
  name: "Target",
  latitude: 30.25,
  longitude: -97.75,
  radius_meters: 200,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOneOffLocation", () => {
  it("marks the row one-off, which is what keeps it out of the picker", async () => {
    await createOneOffLocation(NEW_PLACE);
    expect(create).toHaveBeenCalledWith({ ...NEW_PLACE, is_saved: false });
  });

  it("leaves the flag alone for a place the user deliberately saved", async () => {
    await createLocation(NEW_PLACE);
    expect(create).toHaveBeenCalledWith(NEW_PLACE);
  });

  it("pushes the new region down to the OS", async () => {
    await createOneOffLocation(NEW_PLACE);
    expect(registerUserGeofences).toHaveBeenCalledTimes(1);
  });
});

describe("task links", () => {
  it("resyncs geofences after attaching a reminder", async () => {
    await linkTaskLocation("task-1", "loc-1", "enter");
    expect(linkTask).toHaveBeenCalledWith("task-1", "loc-1", "enter");
    expect(registerUserGeofences).toHaveBeenCalledTimes(1);
  });

  it("resyncs after removing one too — a retired region has to stop waking the device", async () => {
    await unlinkTaskLocation("task-1", "loc-1", "exit");
    expect(unlinkTask).toHaveBeenCalledWith("task-1", "loc-1", "exit");
    expect(registerUserGeofences).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a failed link behind a geofence sync", async () => {
    linkTask.mockResolvedValueOnce({ error: new Error("offline") });
    await expect(linkTaskLocation("task-1", "loc-1", "enter")).rejects.toThrow(
      "offline"
    );
    expect(registerUserGeofences).not.toHaveBeenCalled();
  });
});

describe("saveLocationAsPlace", () => {
  it("promotes the existing row rather than making a second one", async () => {
    await saveLocationAsPlace("loc-1", "Target on Congress");
    expect(save).toHaveBeenCalledWith("loc-1", "Target on Congress");
    expect(create).not.toHaveBeenCalled();
  });

  it("skips the geofence sync — keeping a place doesn't move its region", async () => {
    await saveLocationAsPlace("loc-1");
    expect(registerUserGeofences).not.toHaveBeenCalled();
  });
});
