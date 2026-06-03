import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import { OPEN_COMMAND_PALETTE_EVENT } from "./command-palette";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

// SidebarNav reads usePathname; AppShell renders nothing else from the router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The pet panel polls Supabase on mount — not relevant to the shell layout.
vi.mock("./pet/PetPanelContainer", () => ({
  PetPanelContainer: () => null,
}));

// Render Links as plain anchors that don't trigger jsdom's unimplemented
// navigation (click still bubbles, so the drawer-close handler runs).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string | { pathname?: string };
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  } & Record<string, unknown>) => (
    <a
      href={typeof href === "string" ? href : "#"}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

function renderShell() {
  return render(
    <AppShell projects={SAMPLE_PROJECTS} userEmail="beamer408@gmail.com">
      <p>Page content</p>
    </AppShell>
  );
}

function getSidebar(container: HTMLElement): HTMLElement {
  const aside = container.querySelector("aside");
  if (!aside) throw new Error("sidebar <aside> not found");
  return aside as HTMLElement;
}

describe("AppShell — responsive navigation", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("renders the page content", () => {
    renderShell();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("docks the sidebar on md+ but hides it off-canvas on mobile by default", () => {
    const { container } = renderShell();
    const aside = getSidebar(container);
    // Off-canvas on small screens…
    expect(aside.className).toContain("-translate-x-full");
    // …but always docked from md up.
    expect(aside.className).toContain("md:translate-x-0");
  });

  it("only offsets the main column by the sidebar width on md+ (full width on mobile)", () => {
    const { container } = renderShell();
    // The main wrapper uses md:ml-64, never a bare ml-64 that would push
    // content off-screen on phones.
    expect(container.innerHTML).toContain("md:ml-64");
    expect(container.querySelector(".ml-64:not(.md\\:ml-64)")).toBeNull();
  });

  it("opens the drawer when the hamburger is tapped and dims the backdrop", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();

    expect(screen.queryByTestId("drawer-backdrop")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Open navigation menu"));

    const aside = getSidebar(container);
    expect(aside.className).toContain("translate-x-0");
    expect(aside.className).not.toContain("-translate-x-full");
    expect(screen.getByTestId("drawer-backdrop")).toBeInTheDocument();
  });

  it("closes the drawer when the backdrop is tapped", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();

    await user.click(screen.getByLabelText("Open navigation menu"));
    await user.click(screen.getByTestId("drawer-backdrop"));

    expect(getSidebar(container).className).toContain("-translate-x-full");
    expect(screen.queryByTestId("drawer-backdrop")).not.toBeInTheDocument();
  });

  it("closes the drawer after navigating via a nav link", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();

    await user.click(screen.getByLabelText("Open navigation menu"));
    expect(getSidebar(container).className).toContain("translate-x-0");

    // Tap a real nav link rendered by SidebarNav.
    await user.click(screen.getByRole("link", { name: "Today" }));

    expect(getSidebar(container).className).toContain("-translate-x-full");
  });

  it("lets mobile users reach the command palette via the search button", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handler);
    renderShell();

    await user.click(screen.getByLabelText("Search and commands"));

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handler);
  });
});
