import React from "react";
import { Text, View, StyleSheet, Platform, StatusBar } from "react-native";
import Constants from "expo-constants";

type GitInfo = { branch?: string; sha?: string };

export default function DevBanner() {
  if (!__DEV__) return null;

  const git = (Constants.expoConfig?.extra?.git as GitInfo | undefined) ?? {};
  const label = `${git.branch ?? "?"} · ${git.sha ?? "?"}`;

  return (
    <View pointerEvents="none" style={styles.wrapper}>
      <View style={styles.pill}>
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 4 : 50,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  pill: {
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: {
    color: "#f9fafb",
    fontSize: 11,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
    }),
  },
});
