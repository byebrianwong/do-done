import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { PetsApi } from "@do-done/api-client";

// MCP tools that expose Pip the pet to Claude. These let Claude:
//   - get_pet_state: read Pip's current vibe before acting
//   - propose_pet_goal: suggest a task framed as Pip's wish
//   - accept_pet_goal: convert a goal into a real task on the user's behalf
//   - narrate_task_completion: leave color commentary in the activity log
//   - get_pet_history: read recent events for context
//
// Feeding Pip is implicit: it happens server-side inside TasksApi.update
// when status flips to 'done', so the MCP tools don't expose raw stat
// manipulation — Claude can't cheat by feeding Pip without doing real work.

export function registerPetTools(
  server: McpServer,
  supabase: SupabaseClient,
  userId: string
) {
  const pets = new PetsApi(supabase, userId);

  server.tool(
    "get_pet_state",
    "Read Pip's current stats, mood, level, active goals, and recent activity. Call before suggesting tasks or narrating actions so you have context on what Pip needs and what's been happening lately.",
    {},
    async () => {
      const { data, error } = await pets.getState();
      if (error || !data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Pet state unavailable: ${error?.message ?? "no data"}`,
            },
          ],
        };
      }
      const lines: string[] = [
        `# Pip — lvl ${data.pet.level} (xp: ${data.pet.xp})`,
        `Mood: ${data.mood}`,
        ``,
        `## Stats`,
        `- Hunger: ${data.current_stats.hunger}/100`,
        `- Happiness: ${data.current_stats.happiness}/100`,
        `- Energy: ${data.current_stats.energy}/100`,
      ];
      if (data.goals.length > 0) {
        lines.push("", "## Open goals");
        for (const g of data.goals) {
          lines.push(
            `- ${g.id}: "${g.description}" (proposed by ${g.proposed_by})`
          );
        }
      }
      if (data.recent_events.length > 0) {
        lines.push("", "## Recent events (newest first)");
        for (const e of data.recent_events.slice(0, 8)) {
          const deltas: string[] = [];
          if (e.delta_hunger)
            deltas.push(
              `hunger ${e.delta_hunger > 0 ? "+" : ""}${e.delta_hunger}`
            );
          if (e.delta_happiness)
            deltas.push(
              `happiness ${e.delta_happiness > 0 ? "+" : ""}${e.delta_happiness}`
            );
          if (e.delta_energy)
            deltas.push(
              `energy ${e.delta_energy > 0 ? "+" : ""}${e.delta_energy}`
            );
          const deltaStr = deltas.length > 0 ? ` (${deltas.join(", ")})` : "";
          const narrative = e.narrative ? ` — ${e.narrative}` : "";
          lines.push(
            `- [${e.event_type} by ${e.actor}]${narrative}${deltaStr}`
          );
        }
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "propose_pet_goal",
    "Suggest a goal for Pip — typically a task derived from the user's task patterns or recent gaps. The user can accept it from the pet panel (which creates a real task) or decline. Phrase from Pip's perspective. Use sparingly: don't propose more than 1-2 open goals at a time.",
    {
      description: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "Short suggestion phrased from Pip's perspective. e.g. \"Pip wants to learn cooking this week\" or \"Pip would love a walk outside\""
        ),
    },
    async ({ description }) => {
      const { data, error } = await pets.proposeGoal({
        description,
        proposedBy: "claude",
      });
      if (error || !data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error proposing goal: ${error?.message ?? "no data"}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Proposed goal: "${description}"\nGoal ID: ${data.id}\nThe user will see this in the pet panel and can accept it (creating a real task) or decline.`,
          },
        ],
      };
    }
  );

  server.tool(
    "accept_pet_goal",
    "Accept an open goal on the user's behalf — converts it into a real task. Use only when the user has explicitly asked you to accept; otherwise leave it for them to accept from the pet panel.",
    {
      goal_id: z.string().uuid(),
    },
    async ({ goal_id }) => {
      const { data, error } = await pets.acceptGoal(goal_id);
      if (error || !data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error accepting goal: ${error?.message ?? "no data"}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Accepted goal "${data.goal.description}" — created task "${data.task.title}" (${data.task.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "narrate_task_completion",
    "Record a first-person narrative beat in Pip's activity log after working on the user's behalf. Adds color so the user can see what you did and why (e.g. after triaging email or completing a quick task). The actor is automatically tagged 'claude'. Use this AFTER calling complete_task or update_task — feeding Pip with stats already happens automatically; this just adds the story.",
    {
      task_id: z
        .string()
        .uuid()
        .optional()
        .describe("Optional task this narrative refers to"),
      narrative: z
        .string()
        .min(1)
        .max(280)
        .describe(
          "Short first-person beat from Claude. e.g. \"Triaged your inbox while you were in standup — 8 archived, 2 forwarded\""
        ),
    },
    async ({ task_id, narrative }) => {
      const { data, error } = await pets.recordNarrative({
        narrative,
        task_id: task_id ?? null,
        actor: "claude",
      });
      if (error || !data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error recording narrative: ${error?.message ?? "no data"}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Narrative recorded in Pip's activity log.`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_pet_history",
    "Recent pet events with timestamps, actors, and narratives. Use to understand context — what the user did, what you did, what's been narrated — before proposing goals or writing new narrative.",
    {
      limit: z.number().int().positive().max(50).default(20),
    },
    async ({ limit }) => {
      const { data, error } = await pets.getHistory(limit);
      if (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
      if (data.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No pet events yet." },
          ],
        };
      }
      const lines = data.map((e) => {
        const time = new Date(e.created_at).toISOString();
        const deltas: string[] = [];
        if (e.delta_hunger)
          deltas.push(`H${e.delta_hunger > 0 ? "+" : ""}${e.delta_hunger}`);
        if (e.delta_happiness)
          deltas.push(
            `J${e.delta_happiness > 0 ? "+" : ""}${e.delta_happiness}`
          );
        if (e.delta_energy)
          deltas.push(`E${e.delta_energy > 0 ? "+" : ""}${e.delta_energy}`);
        const deltaStr = deltas.length > 0 ? ` [${deltas.join(" ")}]` : "";
        return `${time}  ${e.actor.padEnd(7)} ${e.event_type.padEnd(16)} ${e.narrative ?? ""}${deltaStr}`;
      });
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
