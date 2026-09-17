import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * These read the module's own files rather than running it, for the reason
 * `plugins/withAndroidShortcuts.test.ts` reads generated XML: nothing in a
 * build, a type-check or a screenshot connects the three names below, and every
 * way they can disagree fails only on an Android device.
 *
 *   - `expo-module.config.json` names the Kotlin class autolinking registers.
 *     Wrong, and the module is silently absent — `requireOptionalNativeModule`
 *     then returns null and every shortcut call does nothing.
 *   - `Name(...)` in the Kotlin is what JS asks for by string.
 *   - The Kotlin `AsyncFunction` names are the JS module's method names.
 */
const here = __dirname;
const kotlin = readFileSync(
  resolve(
    here,
    'android/src/main/java/expo/modules/listshortcuts/ListShortcutsModule.kt'
  ),
  'utf8'
);
const indexTs = readFileSync(resolve(here, 'index.ts'), 'utf8');
const config = JSON.parse(
  readFileSync(resolve(here, 'expo-module.config.json'), 'utf8')
) as { platforms: string[]; android: { modules: string[] } };
const gradle = readFileSync(resolve(here, 'android/build.gradle'), 'utf8');

describe('list-shortcuts module', () => {
  it('registers the Kotlin class that actually exists', () => {
    expect(config.android.modules).toEqual([
      'expo.modules.listshortcuts.ListShortcutsModule',
    ]);
    expect(kotlin).toContain('package expo.modules.listshortcuts');
    expect(kotlin).toContain('class ListShortcutsModule : Module()');
  });

  it('is Android-only, and says so', () => {
    // There is no iOS half: an app cannot put an icon on the iOS home screen.
    // Declaring the platform anyway would make the build look for sources that
    // are not there.
    expect(config.platforms).toEqual(['android']);
    expect(gradle).toContain("namespace 'expo.modules.listshortcuts'");
  });

  it('agrees with JS on the module name', () => {
    const name = kotlin.match(/Name\("([^"]+)"\)/)?.[1];
    expect(name).toBe('DoDoneListShortcuts');
    expect(indexTs).toContain(`requireOptionalNativeModule<ListShortcutsNativeModule>(\n  '${name}'\n)`);
  });

  it('exposes exactly the three functions JS declares', () => {
    const native = [...kotlin.matchAll(/AsyncFunction\("([^"]+)"\)/g)].map(
      (m) => m[1]
    );
    expect(native.sort()).toEqual(['isPinSupported', 'requestPin', 'sync']);
    for (const fn of native) {
      expect(indexTs).toContain(`${fn}(`);
    }
  });

  it('keeps the record fields JS sends', () => {
    // An @Field the Kotlin does not declare arrives as its default — an empty
    // shortLabel, which ShortcutInfoCompat.Builder rejects outright.
    const fields = [...kotlin.matchAll(/@Field\s+val (\w+):/g)].map((m) => m[1]);
    expect(fields.sort()).toEqual([
      'color',
      'id',
      'longLabel',
      'shortLabel',
      'url',
    ]);
  });

  it('never sets an intent package and component together', () => {
    // Intent.setPackage throws once a component is set, which would fail every
    // shortcut build. The Kotlin picks one; this is the reminder.
    expect(kotlin).toContain('intent.setPackage(context.packageName)');
    expect(kotlin).toMatch(/if \(component != null\) \{\s*intent\.component = component\s*\} else \{/);
  });

  it('guards the prune, so a failed read cannot disable pinned icons', () => {
    expect(kotlin).toContain('if (!prune) return');
    // And the disable has to come after that guard, not before it.
    expect(kotlin.indexOf('if (!prune) return')).toBeLessThan(
      kotlin.indexOf('ShortcutManagerCompat.disableShortcuts(')
    );
  });

  it('is not swallowed by the repo-wide android/ ignore', () => {
    /*
      `.gitignore` carries a bare `android/` for the prebuild output, and a bare
      pattern matches a directory of that name at any depth — so it also matches
      this module's hand-written native source. The negation beside it is what
      keeps that committed.

      This is the worst failure in the module and the quietest: the Kotlin never
      reaches the repo, autolinking finds nothing, `requireOptionalNativeModule`
      returns null exactly as it does on iOS, and every shortcut call resolves
      to nothing with no error anywhere.
    */
    const kt =
      'apps/mobile/modules/list-shortcuts/android/src/main/java/expo/modules/listshortcuts/ListShortcutsModule.kt';
    const repo = resolve(here, '../../../..');
    let ignored: boolean;
    try {
      execFileSync('git', ['check-ignore', '-q', kt], { cwd: repo });
      ignored = true;
    } catch (err) {
      // Exit 1 is "not ignored", which is what we want. Anything else (no git,
      // not a checkout) means the question could not be asked.
      const code = (err as { status?: number }).status;
      if (code !== 1) return;
      ignored = false;
    }
    expect(ignored).toBe(false);
  });

  it('updates as well as sets, so a pinned icon follows a rename', () => {
    // setDynamicShortcuts alone cannot reach a pinned shortcut. Dropping this
    // call leaves a home-screen icon reading the list's old name forever, and
    // nothing in the app would ever show it.
    expect(kotlin).toContain('ShortcutManagerCompat.updateShortcuts(context, infos)');
  });
});
