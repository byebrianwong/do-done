import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "@do-done/shared";

/**
 * Renders Markdown with React Native primitives.
 *
 * The web app uses `react-markdown`, which emits DOM elements — there is no
 * DOM here, so this walks the block tree from `@do-done/shared` instead. Both
 * surfaces therefore agree on what a document *means*; only the drawing
 * differs. Keeping the parse in the shared package is also what makes it
 * testable: `apps/mobile` has no renderer in CI, so anything that has to be
 * verified must not live in a component.
 *
 * Raw HTML in the source is never markup here — the parser hands it back as
 * text, which is the property that makes rendering an untrusted attachment
 * safe.
 */

function InlineNodes({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <Text key={i}>{node.value}</Text>;
          case "strong":
            return (
              <Text key={i} style={styles.strong}>
                <InlineNodes nodes={node.children} />
              </Text>
            );
          case "em":
            return (
              <Text key={i} style={styles.em}>
                <InlineNodes nodes={node.children} />
              </Text>
            );
          case "strike":
            return (
              <Text key={i} style={styles.strike}>
                <InlineNodes nodes={node.children} />
              </Text>
            );
          case "code":
            return (
              <Text key={i} style={styles.codeSpan}>
                {node.value}
              </Text>
            );
          case "link":
            return (
              <Text
                key={i}
                style={styles.link}
                onPress={() => {
                  void Linking.openURL(node.href).catch(() => {
                    // A relative path inside an attached file has nothing to
                    // resolve against. Tapping it does nothing rather than
                    // throwing an unhandled rejection.
                  });
                }}
              >
                <InlineNodes nodes={node.children} />
              </Text>
            );
        }
      })}
    </>
  );
}

function headingStyle(fontSize: number) {
  return { fontSize, fontWeight: "700" as const, color: "#111827" };
}

// h1…h6. The steps are small because these render inside a preview card, not
// as a page's own hierarchy — an h1 that dwarfed the editor's own headings
// would make the attachment look like the subject of the screen.
const HEADING_STYLES = [
  headingStyle(19),
  headingStyle(17),
  headingStyle(15.5),
  headingStyle(14.5),
  headingStyle(14),
  headingStyle(13.5),
];

/** Left indent per nesting level, matching the web list's `pl-5`. */
const LIST_INDENT = 16;

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <Text style={[HEADING_STYLES[block.level - 1], styles.headingSpacing]}>
          <InlineNodes nodes={block.children} />
        </Text>
      );

    case "paragraph":
      return (
        <Text style={styles.paragraph}>
          <InlineNodes nodes={block.children} />
        </Text>
      );

    case "code":
      return (
        <View style={styles.codeBlock}>
          <Text style={styles.codeBlockText}>{block.value}</Text>
        </View>
      );

    case "quote":
      return (
        <View style={styles.quote}>
          <Text style={styles.quoteText}>
            <InlineNodes nodes={block.children} />
          </Text>
        </View>
      );

    case "rule":
      return <View style={styles.rule} />;

    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View
              key={i}
              style={[styles.listItem, { paddingLeft: item.depth * LIST_INDENT }]}
            >
              <Text style={styles.listMarker}>
                {item.checked === null
                  ? block.ordered
                    ? `${i + 1}.`
                    : "•"
                  : item.checked
                    ? "☑"
                    : "☐"}
              </Text>
              <Text
                style={[
                  styles.listText,
                  item.checked === true ? styles.listTextDone : null,
                ]}
              >
                <InlineNodes nodes={item.children} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <View>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headingSpacing: { marginTop: 10, marginBottom: 4 },
  paragraph: {
    fontSize: 13.5,
    lineHeight: 20,
    color: "#374151",
    marginBottom: 6,
  },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", color: "#9ca3af" },
  codeSpan: {
    fontFamily: "monospace",
    fontSize: 12.5,
    backgroundColor: "#e5e7eb",
    color: "#111827",
  },
  codeBlock: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  codeBlockText: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    color: "#111827",
  },
  link: { color: "#4f46e5", textDecorationLine: "underline" },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: "#d1d5db",
    paddingLeft: 10,
    marginVertical: 6,
  },
  quoteText: {
    fontSize: 13.5,
    lineHeight: 20,
    fontStyle: "italic",
    color: "#6b7280",
  },
  rule: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 10,
  },
  list: { marginVertical: 4 },
  listItem: { flexDirection: "row", gap: 8, marginBottom: 3 },
  listMarker: {
    fontSize: 13.5,
    lineHeight: 20,
    color: "#6b7280",
    minWidth: 16,
  },
  listText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: "#374151" },
  listTextDone: { color: "#9ca3af" },
});
