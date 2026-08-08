/**
 * A small Markdown parser that produces a typed block tree.
 *
 * Why this exists when the web app renders Markdown with `react-markdown`:
 * that library emits DOM elements, and React Native has no DOM. Mobile needs
 * `<Text>`/`<View>`, so it needs the *structure* rather than the markup — which
 * is what this returns. Web keeps react-markdown; mobile walks these blocks.
 *
 * The scope is a preview of an attached .md file, so it covers what such a file
 * actually contains — headings, paragraphs, lists (including task lists), fenced
 * code, block quotes, rules, and inline emphasis/code/links — and deliberately
 * stops short of the long tail (tables, footnotes, reference links, embedded
 * HTML). Anything unrecognised degrades to its literal text rather than
 * disappearing, so an unsupported construct is visible instead of silently lost.
 *
 * Raw HTML is never interpreted: it falls through as text. That is a security
 * property, not a limitation — attachment content is untrusted input.
 */

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "em"; children: MarkdownInline[] }
  | { type: "strike"; children: MarkdownInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MarkdownInline[] };

export interface MarkdownListItem {
  children: MarkdownInline[];
  /** Nesting level, 0-based, capped at 3 — deeper indents all render alike. */
  depth: number;
  /** `null` when the item isn't a task-list item. */
  checked: boolean | null;
}

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { type: "quote"; children: MarkdownInline[] }
  | { type: "rule" };

// ── Inline ──────────────────────────────────────────────────

// Longest delimiters first: `**` has to be tried before `*`, or every bold run
// parses as an italic that opens and closes on its own first asterisk.
const EMPHASIS: Array<{ open: string; type: "strong" | "em" | "strike" }> = [
  { open: "***", type: "strong" },
  { open: "**", type: "strong" },
  { open: "__", type: "strong" },
  { open: "~~", type: "strike" },
  { open: "*", type: "em" },
  { open: "_", type: "em" },
];

const WORD_CHAR = /[A-Za-z0-9]/;

const CODE_SPAN = /^(`+)([\s\S]*?)\1(?!`)/;
const LINK = /^\[([^\]]*)\]\(\s*<?([^\s>)]*)>?(?:\s+"[^"]*")?\s*\)/;
const IMAGE = /^!\[([^\]]*)\]\(\s*<?([^\s>)]*)>?(?:\s+"[^"]*")?\s*\)/;
const BARE_URL = /^https?:\/\/[^\s<>()[\]]+/;

/**
 * Parse a run of inline Markdown.
 *
 * Unmatched delimiters are the common case in real text ("2 * 3", a stray
 * underscore in a path), so an opener with no closer is emitted as literal
 * text rather than swallowing the rest of the line.
 */
export function parseInlineMarkdown(src: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);

    // Backslash escape — the next character is always literal.
    if (ch === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const m = CODE_SPAN.exec(rest);
      if (m) {
        flush();
        out.push({ type: "code", value: m[2]!.trim() });
        i += m[0].length;
        continue;
      }
    }

    // An image in an attached file usually points at a path we can't resolve,
    // so it renders as a link carrying its alt text — visible and followable,
    // rather than a broken frame.
    if (ch === "!" && src[i + 1] === "[") {
      const m = IMAGE.exec(rest);
      if (m) {
        flush();
        out.push({
          type: "link",
          href: m[2]!,
          children: [{ type: "text", value: m[1]! || m[2]! }],
        });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "[") {
      const m = LINK.exec(rest);
      if (m) {
        flush();
        out.push({
          type: "link",
          href: m[2]!,
          children: parseInlineMarkdown(m[1]!),
        });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "h") {
      const m = BARE_URL.exec(rest);
      if (m) {
        flush();
        // Trailing sentence punctuation belongs to the prose, not the URL.
        const url = m[0].replace(/[.,;:!?]+$/, "");
        out.push({
          type: "link",
          href: url,
          children: [{ type: "text", value: url }],
        });
        i += url.length;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const found = EMPHASIS.find((e) => rest.startsWith(e.open));
      if (found) {
        // `_` is a word character in identifiers (snake_case, __dunder__), so
        // underscore emphasis only opens when it isn't inside a word. Asterisks
        // and tildes carry no such meaning and need no guard.
        const guarded = found.open.startsWith("_");
        const prev = i > 0 ? src[i - 1]! : "";
        if (!guarded || !WORD_CHAR.test(prev)) {
          const inner = rest.slice(found.open.length);
          const close = inner.indexOf(found.open);
          const after = inner[close + found.open.length] ?? "";
          const content = close > 0 ? inner.slice(0, close) : "";
          // CommonMark's flanking rule, and the reason `2 * 3 * 4` stays
          // arithmetic: an opener may not be followed by whitespace, and a
          // closer may not be preceded by it. Without this, any two asterisks
          // on a line italicise whatever sits between them.
          const flanks =
            content.length > 0 &&
            !/\s/.test(content[0]!) &&
            !/\s/.test(content[content.length - 1]!);
          if (flanks && (!guarded || !WORD_CHAR.test(after))) {
            flush();
            const children =
              found.open === "***"
                ? [{ type: "em" as const, children: parseInlineMarkdown(content) }]
                : parseInlineMarkdown(content);
            out.push({ type: found.type, children });
            i += found.open.length * 2 + content.length;
            continue;
          }
        }
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

// ── Blocks ──────────────────────────────────────────────────

const FENCE = /^ {0,3}(```|~~~)\s*([^\s`]*)\s*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const TASK_MARKER = /^\[([ xX])\][ \t]+/;

/** Widest indent that still counts as one nesting level. */
const INDENT_PER_LEVEL = 2;
const MAX_LIST_DEPTH = 3;

function listDepth(indent: string): number {
  // Tabs count as one level each; spaces divide down. Both round toward the
  // shallower level so a 3-space indent doesn't invent a level of its own.
  const width = indent.replace(/\t/g, " ".repeat(INDENT_PER_LEVEL)).length;
  return Math.min(MAX_LIST_DEPTH, Math.floor(width / INDENT_PER_LEVEL));
}

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    FENCE.test(line) ||
    RULE.test(line) ||
    ATX.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

/**
 * Parse a Markdown document into blocks.
 *
 * Line-oriented and single-pass: each iteration recognises the block that
 * starts at the current line and consumes exactly its lines.
 */
export function parseMarkdown(src: string): MarkdownBlock[] {
  const lines = src
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) {
        body.push(lines[i]!);
        i += 1;
      }
      // An unterminated fence runs to end-of-file, which is what CommonMark
      // does — better than dropping the code the user can see in their editor.
      if (i < lines.length) i += 1;
      // The document's own trailing newline lands in `body` when the fence was
      // never closed; it isn't part of the code.
      while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
      blocks.push({
        type: "code",
        lang: fence[2] ? fence[2] : null,
        value: body.join("\n"),
      });
      continue;
    }

    // Ordered before ATX/list so `---` isn't read as a bullet.
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({
        type: "heading",
        level: atx[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInlineMarkdown(atx[2]!),
      });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        parts.push(lines[i]!.replace(QUOTE, ""));
        i += 1;
      }
      blocks.push({
        type: "quote",
        children: parseInlineMarkdown(parts.join(" ").trim()),
      });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]!);
      const items: MarkdownListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (!m) {
          // A non-blank, non-item line that isn't another block continues the
          // previous item (a wrapped bullet), which is how editors soft-wrap.
          const cont = lines[i]!;
          if (items.length > 0 && cont.trim() !== "" && !isBlockStart(cont)) {
            const last = items[items.length - 1]!;
            last.children = [
              ...last.children,
              { type: "text", value: " " + cont.trim() },
            ];
            i += 1;
            continue;
          }
          break;
        }
        // A bullet where an ordered list started (or vice versa) begins a new
        // list rather than joining this one.
        if (/\d/.test(m[2]!) !== ordered) break;

        let text = m[3]!;
        let checked: boolean | null = null;
        const task = TASK_MARKER.exec(text);
        if (task) {
          checked = task[1]!.toLowerCase() === "x";
          text = text.slice(task[0].length);
        }
        items.push({
          depth: listDepth(m[1]!),
          checked,
          children: parseInlineMarkdown(text),
        });
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: runs to the next blank line or block start. A `===`/`---`
    // underline promotes it to a setext heading instead.
    const para: string[] = [line];
    i += 1;
    let level: 1 | 2 | null = null;
    while (i < lines.length) {
      const next = lines[i]!;
      const setext = SETEXT.exec(next);
      // `---` directly under a paragraph line is a setext underline, not a
      // rule — CommonMark gives the heading precedence. A blank line between
      // them breaks the paragraph first, so the standalone `---` still rules.
      if (setext) {
        level = setext[1]!.startsWith("=") ? 1 : 2;
        i += 1;
        break;
      }
      if (next.trim() === "" || isBlockStart(next)) break;
      para.push(next);
      i += 1;
    }
    const children = parseInlineMarkdown(para.join(" ").trim());
    blocks.push(
      level ? { type: "heading", level, children } : { type: "paragraph", children }
    );
  }

  return blocks;
}

/**
 * Flatten inline nodes back to their text. Used for accessibility labels and
 * for the one-line summary a collapsed preview shows.
 */
export function inlineToPlainText(nodes: MarkdownInline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        default:
          return inlineToPlainText(n.children);
      }
    })
    .join("");
}
