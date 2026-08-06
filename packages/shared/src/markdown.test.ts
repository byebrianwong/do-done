import { describe, it, expect } from "vitest";
import {
  inlineToPlainText,
  parseInlineMarkdown,
  parseMarkdown,
  type MarkdownBlock,
} from "./markdown.js";

/** Collapse a block's inline tree to text, for assertions about structure. */
function text(block: MarkdownBlock): string {
  if (block.type === "code") return block.value;
  if (block.type === "rule") return "";
  if (block.type === "list") {
    return block.items.map((it) => inlineToPlainText(it.children)).join("|");
  }
  return inlineToPlainText(block.children);
}

describe("parseInlineMarkdown", () => {
  it("parses bold, italic and strikethrough", () => {
    expect(parseInlineMarkdown("**bold**")).toEqual([
      { type: "strong", children: [{ type: "text", value: "bold" }] },
    ]);
    expect(parseInlineMarkdown("*italic*")).toEqual([
      { type: "em", children: [{ type: "text", value: "italic" }] },
    ]);
    expect(parseInlineMarkdown("~~gone~~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
  });

  it("nests emphasis inside emphasis", () => {
    expect(parseInlineMarkdown("***both***")).toEqual([
      {
        type: "strong",
        children: [{ type: "em", children: [{ type: "text", value: "both" }] }],
      },
    ]);
  });

  it("keeps code spans literal", () => {
    // The asterisks inside a code span are code, not emphasis.
    expect(parseInlineMarkdown("`a * b`")).toEqual([
      { type: "code", value: "a * b" },
    ]);
  });

  it("parses links, and images as links carrying their alt text", () => {
    expect(parseInlineMarkdown("[docs](https://example.com)")).toEqual([
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "text", value: "docs" }],
      },
    ]);
    expect(parseInlineMarkdown("![a diagram](diagram.png)")).toEqual([
      {
        type: "link",
        href: "diagram.png",
        children: [{ type: "text", value: "a diagram" }],
      },
    ]);
  });

  it("linkifies bare URLs without eating the sentence's punctuation", () => {
    const nodes = parseInlineMarkdown("see https://example.com/a, then stop");
    expect(nodes[1]).toEqual({
      type: "link",
      href: "https://example.com/a",
      children: [{ type: "text", value: "https://example.com/a" }],
    });
    expect(inlineToPlainText(nodes)).toBe(
      "see https://example.com/a, then stop"
    );
  });

  it("leaves underscores inside words alone", () => {
    // snake_case and __dunder__ identifiers are the reason underscore emphasis
    // is guarded; an unguarded parser italicises half of `scheduled_date`.
    expect(inlineToPlainText(parseInlineMarkdown("scheduled_date_field"))).toBe(
      "scheduled_date_field"
    );
    expect(parseInlineMarkdown("scheduled_date_field")).toEqual([
      { type: "text", value: "scheduled_date_field" },
    ]);
  });

  it("still honours underscore emphasis at word boundaries", () => {
    expect(parseInlineMarkdown("an _emphatic_ word")[1]).toEqual({
      type: "em",
      children: [{ type: "text", value: "emphatic" }],
    });
  });

  it("emits an unclosed delimiter as literal text", () => {
    expect(parseInlineMarkdown("a ** dangling")).toEqual([
      { type: "text", value: "a ** dangling" },
    ]);
  });

  it("does not italicise arithmetic", () => {
    // Two asterisks on a line aren't emphasis unless they hug their content —
    // CommonMark's flanking rule, and the difference between "2 * 3 * 4" and
    // a sentence that has actually been marked up.
    expect(parseInlineMarkdown("2 * 3 * 4")).toEqual([
      { type: "text", value: "2 * 3 * 4" },
    ]);
    expect(parseInlineMarkdown("a *b* c")[1]).toEqual({
      type: "em",
      children: [{ type: "text", value: "b" }],
    });
  });

  it("honours backslash escapes", () => {
    expect(parseInlineMarkdown("\\*not italic\\*")).toEqual([
      { type: "text", value: "*not italic*" },
    ]);
  });

  it("passes raw HTML through as text rather than interpreting it", () => {
    // Attachment content is untrusted; there is no path from a .md file to
    // markup. The renderers only ever receive these node types.
    const nodes = parseInlineMarkdown('<img src=x onerror="alert(1)">');
    expect(nodes.every((n) => n.type === "text")).toBe(true);
    expect(inlineToPlainText(nodes)).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("parseMarkdown", () => {
  it("parses ATX headings at every level", () => {
    const blocks = parseMarkdown("# One\n\n### Three\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ type: "heading", level: 3 });
    expect(text(blocks[0]!)).toBe("One");
  });

  it("parses setext headings", () => {
    const blocks = parseMarkdown("Title\n=====\n\nSub\n---\n");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(text(blocks[0]!)).toBe("Title");
    expect(blocks[1]).toMatchObject({ type: "heading", level: 2 });
  });

  it("joins soft-wrapped paragraph lines", () => {
    const blocks = parseMarkdown("one line\nand its wrap\n\nsecond para");
    expect(blocks).toHaveLength(2);
    expect(text(blocks[0]!)).toBe("one line and its wrap");
    expect(text(blocks[1]!)).toBe("second para");
  });

  it("parses fenced code without touching its contents", () => {
    const blocks = parseMarkdown("```ts\nconst a = **1**;\n```\n");
    expect(blocks[0]).toEqual({
      type: "code",
      lang: "ts",
      value: "const a = **1**;",
    });
  });

  it("runs an unterminated fence to end of file", () => {
    const blocks = parseMarkdown("```\nstill code\n");
    expect(blocks[0]).toEqual({ type: "code", lang: null, value: "still code" });
  });

  it("parses bullet and ordered lists separately", () => {
    const blocks = parseMarkdown("- a\n- b\n\n1. one\n2. two\n");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect(text(blocks[0]!)).toBe("a|b");
    expect(blocks[1]).toMatchObject({ type: "list", ordered: true });
    expect(text(blocks[1]!)).toBe("one|two");
  });

  it("does not merge a bullet list into an ordered one", () => {
    const blocks = parseMarkdown("1. one\n- bullet\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ ordered: true });
    expect(blocks[1]).toMatchObject({ ordered: false });
  });

  it("records nesting depth and task-list state", () => {
    const blocks = parseMarkdown("- [ ] todo\n  - [x] done\n- plain\n");
    expect(blocks[0]).toMatchObject({ type: "list" });
    const list = blocks[0] as Extract<MarkdownBlock, { type: "list" }>;
    expect(list.items.map((i) => [i.depth, i.checked])).toEqual([
      [0, false],
      [1, true],
      [0, null],
    ]);
    expect(text(blocks[0]!)).toBe("todo|done|plain");
  });

  it("continues a soft-wrapped list item", () => {
    const blocks = parseMarkdown("- first item\n  that wraps\n- second\n");
    expect(text(blocks[0]!)).toBe("first item that wraps|second");
  });

  it("parses block quotes and rules", () => {
    const blocks = parseMarkdown("> quoted\n> more\n\n---\n");
    expect(blocks[0]).toMatchObject({ type: "quote" });
    expect(text(blocks[0]!)).toBe("quoted more");
    expect(blocks[1]).toEqual({ type: "rule" });
  });

  it("reads --- as a rule, not a bullet or a heading underline", () => {
    const blocks = parseMarkdown("para\n\n---\n\nafter");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "rule", "paragraph"]);
  });

  it("skips blank lines and handles CRLF and a BOM", () => {
    const blocks = parseMarkdown("﻿# Title\r\n\r\nbody\r\n");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(text(blocks[0]!)).toBe("Title");
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });

  it("keeps unsupported constructs visible as text", () => {
    // A GFM table isn't parsed, but its content must not vanish — the user can
    // still read what the file says.
    const blocks = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(inlineToPlainText((blocks[0] as never as { children: [] }).children))
      .toContain("a");
  });
});
