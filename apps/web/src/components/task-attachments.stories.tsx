import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AttachmentsSection } from "./task-attachments";
import {
  makeAttachment,
  makeAttachmentsApi,
  SAMPLE_AUDIO_DATA_URL,
  SAMPLE_IMAGE_DATA_URL,
  SAMPLE_MARKDOWN,
} from "./__stories__/mocks";

const meta: Meta<typeof AttachmentsSection> = {
  title: "Components/TaskAttachments",
  component: AttachmentsSection,
  decorators: [
    (Story) => (
      <div className="w-[560px] bg-white p-6 dark:bg-neutral-950">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing attached yet — the affordance is the whole surface. */
export const Empty: Story = {
  args: {
    taskId: "task-1",
    api: makeAttachmentsApi({ attachments: [] }),
  },
};

export const WithImage: Story = {
  args: (() => {
    const image = makeAttachment({
      id: "att-image",
      file_name: "screenshot.png",
      mime_type: "image/png",
      size_bytes: 184_320,
    });
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [image],
        urls: { "att-image": SAMPLE_IMAGE_DATA_URL },
      }),
    };
  })(),
};

/**
 * A voice note recorded on the phone, played back at the desk.
 *
 * The name is a timestamp, so the card says "Voice note" instead — the point
 * being that a recording is identified by what it is, not by when it was
 * written.
 */
export const WithVoiceNote: Story = {
  args: (() => {
    const note = makeAttachment({
      id: "att-voice",
      file_name: "voice-note-2026-08-08-090403.wav",
      mime_type: "audio/wav",
      size_bytes: 268_444,
      storage_path: "user-1/task-1/abc.wav",
    });
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [note],
        urls: { "att-voice": SAMPLE_AUDIO_DATA_URL },
      }),
    };
  })(),
};

/** An audio file that isn't one of ours keeps its own name. */
export const WithAudioFile: Story = {
  args: (() => {
    const clip = makeAttachment({
      id: "att-audio",
      file_name: "standup-recap.m4a",
      mime_type: "audio/mp4",
      size_bytes: 1_048_576,
      storage_path: "user-1/task-1/pqr.m4a",
    });
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [clip],
        urls: { "att-audio": SAMPLE_AUDIO_DATA_URL },
      }),
    };
  })(),
};

/** The case the whole markdown renderer exists for. */
export const WithMarkdown: Story = {
  args: (() => {
    const doc = makeAttachment({
      id: "att-md",
      file_name: "launch-checklist.md",
      mime_type: "text/markdown",
      size_bytes: 1_240,
      storage_path: "user-1/task-1/def.md",
    });
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [doc],
        text: { "att-md": SAMPLE_MARKDOWN },
      }),
    };
  })(),
};

/** A long file is clipped with a fade and a "Show more". */
export const LongMarkdown: Story = {
  args: (() => {
    const doc = makeAttachment({
      id: "att-long",
      file_name: "spec.md",
      mime_type: "text/markdown",
      size_bytes: 9_400,
      storage_path: "user-1/task-1/ghi.md",
    });
    const body = Array.from(
      { length: 12 },
      (_, i) =>
        `## Section ${i + 1}\n\nParagraph ${i + 1} of the specification, long enough to run past the fold.\n`
    ).join("\n");
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [doc],
        text: { "att-long": body },
      }),
    };
  })(),
};

/** Everything at once: image, markdown, plain text, and an opaque binary. */
export const MixedTypes: Story = {
  args: (() => {
    const image = makeAttachment({
      id: "att-image",
      file_name: "mockup.png",
      mime_type: "image/png",
      size_bytes: 402_115,
    });
    const doc = makeAttachment({
      id: "att-md",
      file_name: "notes.md",
      mime_type: "text/markdown",
      size_bytes: 900,
      storage_path: "user-1/task-1/def.md",
    });
    const log = makeAttachment({
      id: "att-txt",
      file_name: "build.log",
      mime_type: "text/plain",
      size_bytes: 2_048,
      storage_path: "user-1/task-1/jkl.log",
    });
    const zip = makeAttachment({
      id: "att-zip",
      file_name: "design-assets.zip",
      mime_type: "application/zip",
      size_bytes: 8_400_000,
      storage_path: "user-1/task-1/mno.zip",
    });
    return {
      taskId: "task-1",
      api: makeAttachmentsApi({
        attachments: [image, doc, log, zip],
        urls: { "att-image": SAMPLE_IMAGE_DATA_URL },
        text: {
          "att-md": "### Handover\n\nAll assets are in the zip.",
          "att-txt":
            "› build succeeded in 12.4s\n› 0 errors, 2 warnings\n› artifacts written to dist/",
        },
      }),
    };
  })(),
};
