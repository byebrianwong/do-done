import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { DisplayMenu } from "./display-menu";
import { defaultDisplayFor, type DisplayConfig } from "@do-done/shared";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

// Stateful harness so the menu is interactive; each story's `play` opens it so
// Chromatic snapshots the actual dropdown (not just the closed trigger).
function MenuHarness({ initial }: { initial: DisplayConfig }) {
  const [config, setConfig] = useState(initial);
  return (
    <div style={{ minHeight: 540 }}>
      <div className="flex justify-end">
        <DisplayMenu
          config={config}
          onChange={setConfig}
          onReset={() => setConfig(initial)}
          isDefault={JSON.stringify(config) === JSON.stringify(initial)}
          projects={SAMPLE_PROJECTS}
          availableTags={["finance", "groceries", "personal", "urgent", "work"]}
        />
      </div>
    </div>
  );
}

const meta: Meta<typeof MenuHarness> = {
  title: "Components/DisplayMenu",
  component: MenuHarness,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/all" } },
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

async function openMenu({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: /display/i }));
}

// The Display dropdown, open — Group by / Sort by / filters / Show completed.
export const Open: Story = {
  args: { initial: defaultDisplayFor("all") },
  play: openMenu,
};

// Open with a non-default config: grouped by priority, sorted by due date,
// P1+P2 filters active — shows the "customized" state (active pills + dir toggle).
export const Customized: Story = {
  args: {
    initial: {
      ...defaultDisplayFor("all"),
      group: "priority",
      sort: [{ field: "due_date", dir: "asc" }],
      filters: [{ field: "priority", op: "is", values: ["p1", "p2"] }],
    },
  },
  play: openMenu,
};
