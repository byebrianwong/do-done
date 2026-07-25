import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const reorder = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/projects-client", () => ({
  getClientProjectsApi: vi.fn(async () => ({ reorder })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/projects/proj-2",
}));

import { SortableProjectList } from "./sortable-project-list";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

describe("SortableProjectList", () => {
  it("renders every project as a link, in the order given", () => {
    render(<SortableProjectList projects={SAMPLE_PROJECTS} />);

    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/projects/proj-1",
      "/projects/proj-2",
      "/projects/proj-3",
    ]);
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      "Engineering",
      "Personal",
      "Design",
    ]);
  });

  it("highlights the project matching the current path", () => {
    render(<SortableProjectList projects={SAMPLE_PROJECTS} />);

    const active = screen.getByRole("link", { name: /Personal/ });
    expect(active.className).toContain("text-indigo-600");

    const inactive = screen.getByRole("link", { name: /Engineering/ });
    expect(inactive.className).not.toContain("text-indigo-600");
  });
});
