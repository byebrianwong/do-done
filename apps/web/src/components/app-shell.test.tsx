import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import { OPEN_COMMAND_PALETTE_EVENT } from "./command-palette";
import { TOGGLE_PIP_PANEL_EVENT } from "@/lib/pip-visibility";
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
  // The nav rows render a NavPendingDot, which reads the enclosing Link's
  // status. There is no router here to be pending on.
  useLinkStatus: () => ({ pending: false }),
}));

function renderShell(props?: {
  pipHidden?: boolean;
  projects?: typeof SAMPLE_PROJECTS;
  projectsUnavailable?: boolean;
}) {
  return render(
    <AppShell
      projects={props?.projects ?? SAMPLE_PROJECTS}
      projectsUnavailable={props?.projectsUnavailable}
      userEmail="beamer408@gmail.com"
      pipHidden={props?.pipHidden}
    >
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

  it("shows the pet panel (no reveal tab) by default", () => {
    renderShell();
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();
  });

  it("collapses to a 'Show Pip' tab when pipHidden, and reveals on click", async () => {
    const user = userEvent.setup();
    renderShell({ pipHidden: true });

    const tab = screen.getByLabelText("Show Pip");
    expect(tab).toBeInTheDocument();

    await user.click(tab);

    // Clicking the tab flips back to the panel, so the tab is gone.
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();
  });

  it("toggles the pet panel with the 'p' keyboard shortcut", () => {
    renderShell();
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "p" });
    expect(screen.getByLabelText("Show Pip")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "p" });
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();
  });

  it("ignores 'p' with a modifier or while typing in a field", () => {
    renderShell();

    // ⌘P / ⌃P stay native (print) — no toggle.
    fireEvent.keyDown(document.body, { key: "p", metaKey: true });
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();

    // Typing "p" in a text field must not collapse the panel.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "p" });
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();
    input.remove();
  });

  it("toggles the pet panel when the TOGGLE_PIP_PANEL_EVENT fires (palette action)", () => {
    renderShell();
    expect(screen.queryByLabelText("Show Pip")).not.toBeInTheDocument();

    fireEvent(window, new Event(TOGGLE_PIP_PANEL_EVENT));
    expect(screen.getByLabelText("Show Pip")).toBeInTheDocument();
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

  // An empty sidebar is a claim about the account. During the Supabase outage
  // it was a false one, which is the same bug `lib/read-result.ts` fixes on the
  // pages — except the layout cannot throw, since no boundary of ours wraps it.
  describe("when the projects read failed", () => {
    it("says so instead of showing an empty project list", () => {
      renderShell({ projects: [], projectsUnavailable: true });

      expect(screen.getByText(/Couldn’t load projects/i)).toBeInTheDocument();
    });

    it("keeps the rest of the shell usable", () => {
      // The whole reason this is an inline notice rather than a thrown error:
      // the shell, its nav and the page's own error card must survive.
      renderShell({ projects: [], projectsUnavailable: true });

      expect(screen.getByText("Page content")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    });

    it("says nothing when the read simply found no projects", () => {
      // Zero projects is a real answer and gets the ordinary empty list.
      renderShell({ projects: [] });

      expect(
        screen.queryByText(/Couldn’t load projects/i)
      ).not.toBeInTheDocument();
    });

    it("says nothing on an ordinary render", () => {
      renderShell();

      expect(
        screen.queryByText(/Couldn’t load projects/i)
      ).not.toBeInTheDocument();
    });
  });
});
