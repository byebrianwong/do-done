import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('./withWearApp.js');

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Every Kotlin file in the watch module, contents only. */
function kotlinSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(resolve(ROOT, 'wear/src/main/java'));
  return out;
}

/**
 * Nothing here compiles Kotlin or runs Gradle — there is no Android SDK on this
 * machine. What it covers is every way the two halves can disagree, because all
 * of those are silent on the device: a mismatched Data Layer path leaves the
 * watch listening to a channel nothing writes to, and a module missing from
 * `settings.gradle` is simply not built.
 */
describe('withWearApp: the generated project edits', () => {
  it('adds the module to settings.gradle', () => {
    const out = plugin.withInclude("rootProject.name = 'DoDone'\ninclude ':app'\n");
    expect(out).toContain(plugin.INCLUDE_LINE);
  });

  it('does not add it twice', () => {
    const once = plugin.withInclude("include ':app'\n");
    const twice = plugin.withInclude(once);
    expect(twice).toBe(once);
    expect(twice.match(/include ':wear'/g)).toHaveLength(1);
  });

  it('puts the Compose compiler plugin on the buildscript classpath', () => {
    const before = [
      'buildscript {',
      '  dependencies {',
      "    classpath('com.android.tools.build:gradle')",
      "    classpath('com.facebook.react:react-native-gradle-plugin')",
      '  }',
      '}',
    ].join('\n');
    const after = plugin.withComposePlugin(before);
    expect(after).toContain('compose-compiler-gradle-plugin');
    // Inside the buildscript block, not appended to the end of the file.
    const pluginLine = after.indexOf('compose-compiler-gradle-plugin');
    expect(pluginLine).toBeGreaterThan(after.indexOf('buildscript {'));
    expect(pluginLine).toBeLessThan(after.lastIndexOf('}'));
  });

  it('pins the Compose plugin to the project kotlinVersion', () => {
    // Not a literal version: the Compose compiler plugin ships with Kotlin and
    // a mismatch fails at configuration time.
    const after = plugin.withComposePlugin(
      "dependencies {\n  classpath('com.android.tools.build:gradle')\n}"
    );
    expect(after).toContain('kotlinVersion');
    expect(after).not.toMatch(/compose-compiler-gradle-plugin:\d/);
  });

  it('does not add the Compose plugin twice', () => {
    const once = plugin.withComposePlugin(
      "dependencies {\n  classpath('com.android.tools.build:gradle')\n}"
    );
    expect(plugin.withComposePlugin(once)).toBe(once);
  });

  it('leaves a build.gradle it does not recognise alone', () => {
    // Better to build without the wear module than to write a classpath line
    // into the wrong block and fail the whole Android build.
    const odd = 'buildscript { dependencies { } }';
    expect(plugin.withComposePlugin(odd)).toBe(odd);
  });
});

describe('the two halves of the Data Layer contract', () => {
  const phone = read(
    'modules/dodone-wear/android/src/main/java/expo/modules/dodonewear/WearContract.kt'
  );
  const watch = read('wear/src/main/java/com/beamer408/dodone/wear/data/WearContract.kt');

  const constants = (src: string) => {
    const out = new Map<string, string>();
    for (const [, name, value] of src.matchAll(/const val (\w+) = "([^"]*)"/g)) {
      out.set(name, value);
    }
    return out;
  };

  it('declares the same paths and keys on both sides', () => {
    const a = constants(phone);
    const b = constants(watch);
    expect(a.size).toBeGreaterThan(0);
    for (const [name, value] of a) {
      expect(b.get(name), `${name} differs between the two copies`).toBe(value);
    }
  });

  it('agrees with the manifest filter the phone listens on', () => {
    const manifest = read('modules/dodone-wear/android/src/main/AndroidManifest.xml');
    const path = constants(phone).get('PATH_REQUEST_SYNC');
    expect(path).toBeTruthy();
    expect(manifest).toContain(`android:pathPrefix="${path}"`);
  });

  it('agrees with the capability the watch declares', () => {
    const wearXml = read('wear/src/main/res/values/wear.xml');
    expect(wearXml).toContain(
      `<item>${constants(watch).get('CAPABILITY_WATCH_APP')}</item>`
    );
  });

  it('names the headless task index.js actually registers', () => {
    const entry = read('index.js');
    expect(entry).toContain(
      `registerHeadlessTask('${constants(phone).get('HEADLESS_TASK')}'`
    );
  });

  it('agrees with the snapshot version the phone stamps', () => {
    const snapshotTs = read('lib/wear-snapshot.ts');
    const phoneVersion = /WEAR_SNAPSHOT_VERSION = (\d+)/.exec(snapshotTs)?.[1];
    const watchVersion = /SNAPSHOT_VERSION = (\d+)/.exec(watch)?.[1];
    expect(phoneVersion).toBeTruthy();
    // The watch may lag the phone — its APK does not ship over OTA — but it must
    // never be *ahead*, or it would drop snapshots the phone is still sending.
    expect(Number(watchVersion)).toBeLessThanOrEqual(Number(phoneVersion));
  });
});

describe('the wear module is complete enough to be copied', () => {
  const required = [
    'wear/build.gradle',
    'wear/src/main/AndroidManifest.xml',
    'wear/src/main/res/values/wear.xml',
    'wear/src/main/java/com/beamer408/dodone/wear/MainActivity.kt',
    'wear/src/main/java/com/beamer408/dodone/wear/DataLayerListenerService.kt',
    'wear/src/main/java/com/beamer408/dodone/wear/tile/TodayTileService.kt',
    'wear/src/main/java/com/beamer408/dodone/wear/complication/DoDoneComplicationService.kt',
  ];

  it.each(required)('has %s', (file) => {
    expect(existsSync(resolve(ROOT, file))).toBe(true);
  });

  it('declares every class the manifest names', () => {
    // A manifest naming a class that does not exist installs fine and fails at
    // the moment the system tries to start it — a tile that never appears, or a
    // complication missing from the picker, with nothing logged where anyone
    // would look.
    const manifest = read('wear/src/main/AndroidManifest.xml');
    const sources = kotlinSources();
    const named = [...manifest.matchAll(/android:name="\.([\w.]+)"/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5);
    for (const relative of named) {
      const className = relative.split('.').pop()!;
      const declared = sources.some((src) =>
        new RegExp(`class ${className}\\b`).test(src)
      );
      expect(declared, `${relative} is named in the manifest but not declared`).toBe(
        true
      );
    }
  });

  it('registers every complication service with the update requester', () => {
    const manifest = read('wear/src/main/AndroidManifest.xml');
    const source = read(
      'wear/src/main/java/com/beamer408/dodone/wear/complication/DoDoneComplicationService.kt'
    );
    const declared = [
      ...manifest.matchAll(/android:name="\.complication\.(\w+)"/g),
    ].map((m) => m[1]);
    expect(declared.length).toBe(5);
    // A complication missing from COMPLICATION_SERVICES still installs and still
    // shows a value — it just never refreshes, so it sits on this morning's
    // number all week.
    for (const name of declared) {
      expect(source).toContain(`${name}::class.java`);
    }
  });
});
