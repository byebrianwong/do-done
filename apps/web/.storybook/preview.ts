import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "neutral", value: "#fafafa" },
        { name: "dark", value: "#0a0a0a" },
      ],
    },
    layout: "padded",
  },
};

export default preview;
