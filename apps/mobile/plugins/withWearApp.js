/**
 * Puts the Wear OS app into the Android project `expo prebuild` generates.
 *
 * The watch app is a second Android application module. It cannot live in
 * `android/` — that directory is gitignored and rewritten on every prebuild — so
 * its source is kept at `apps/mobile/wear/` and copied in here, the same way
 * `withQuickAddActivity` writes its activity and `withAndroidShortcuts` writes
 * its XML.
 *
 * Three edits, and each is needed for a different reason:
 *
 * 1. **Copy the tree.** Gradle needs the sources where `settings.gradle` says
 *    they are.
 * 2. **Include the module.** Without it the module is simply not built, and
 *    nothing reports a missing watch app because nothing asked for one.
 * 3. **Put the Compose compiler plugin on the classpath.** Kotlin 2.x moved
 *    Compose support out of the Kotlin compiler and into its own Gradle plugin.
 *    Expo's generated root project does not carry it, because nothing else in an
 *    Expo app uses Compose. The wear module's `apply plugin` line fails at
 *    configuration time without it.
 *
 * Nothing here can be verified by this repo's CI — there is no Android SDK on
 * the machine. `withWearApp.test.ts` asserts everything about the edits that can
 * be checked without one, which is the same bargain `withAndroidShortcuts` makes.
 */

const { withDangerousMod, withSettingsGradle, withProjectBuildGradle } =
  require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** The module's Gradle name, and the directory it is copied to under `android/`. */
const MODULE = 'wear';

/**
 * The Compose compiler plugin. Its version has to match the Kotlin version the
 * project builds with, which is why it is interpolated from `kotlinVersion`
 * rather than pinned: they are released together and a mismatch is a
 * configuration-time failure with a long message about an incompatible plugin.
 */
const COMPOSE_PLUGIN =
  "classpath('org.jetbrains.kotlin:compose-compiler-gradle-plugin:' + kotlinVersion)";

const INCLUDE_LINE = `include ':${MODULE}'`;

/** Everything under `wear/` except build output, which prebuild must not carry. */
const SKIP = new Set(['build', '.gradle', '.cxx', 'node_modules']);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/** Add `include ':wear'` unless it is already there. Exported for the test. */
function withInclude(contents) {
  if (contents.includes(INCLUDE_LINE)) return contents;
  return `${contents.trimEnd()}\n${INCLUDE_LINE}\n`;
}

/**
 * Add the Compose compiler plugin to the root buildscript's classpath.
 *
 * Anchored on the existing `classpath('com.android.tools.build:gradle')` line,
 * which Expo's template has always written, rather than on the `dependencies {`
 * block — there are several of those in that file and matching the wrong one
 * puts the plugin somewhere Gradle never reads it.
 */
function withComposePlugin(contents) {
  if (contents.includes('compose-compiler-gradle-plugin')) return contents;
  const anchor = /(classpath\(['"]com\.android\.tools\.build:gradle['"]\))/;
  if (!anchor.test(contents)) return contents;
  return contents.replace(anchor, `$1\n    ${COMPOSE_PLUGIN}`);
}

const withWearApp = (config) => {
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, MODULE);
      const target = path.join(cfg.modRequest.platformProjectRoot, MODULE);
      // Removed first rather than merged over. A file deleted from `wear/`
      // would otherwise survive in the generated project forever, and a stale
      // Kotlin file that still compiles is the kind of thing that is only found
      // by wondering why a change had no effect.
      fs.rmSync(target, { recursive: true, force: true });
      copyTree(source, target);
      return cfg;
    },
  ]);

  config = withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = withInclude(cfg.modResults.contents);
    return cfg;
  });

  config = withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = withComposePlugin(cfg.modResults.contents);
    return cfg;
  });

  return config;
};

module.exports = withWearApp;
module.exports.withInclude = withInclude;
module.exports.withComposePlugin = withComposePlugin;
module.exports.MODULE = MODULE;
module.exports.INCLUDE_LINE = INCLUDE_LINE;
