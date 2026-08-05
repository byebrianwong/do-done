import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withAndroidShortcuts.js');

const { SHORTCUTS, shortcutsXml, legacyVector, adaptiveIcon, iconName } = plugin;

const PKG = 'com.beamer408.dodone';
const xml: string = shortcutsXml(PKG);

/**
 * These assert the generated XML rather than running a prebuild, because every
 * failure mode here is silent: Android drops a malformed <shortcut> without a
 * word, and a shortcut pointing at a route that doesn't exist just opens the
 * app on whatever screen it was already showing.
 */
describe('withAndroidShortcuts', () => {
  it('declares the four quick actions in launcher order', () => {
    expect(SHORTCUTS.map((s: { id: string }) => s.id)).toEqual([
      'quick-add',
      'search',
      'today',
      'upcoming',
    ]);
  });

  it('gives every shortcut an explicit intent — an implicit one never launches', () => {
    const intents = xml.match(/<intent[\s\S]*?\/>/g) ?? [];
    expect(intents).toHaveLength(SHORTCUTS.length);
    for (const intent of intents) {
      expect(intent).toContain('android:action="android.intent.action.VIEW"');
      expect(intent).toContain(`android:targetPackage="${PKG}"`);
      expect(intent).toMatch(new RegExp(`android:targetClass="${PKG}\\.\\w+"`));
      expect(intent).toMatch(/android:data="[a-z]+:\/\//);
    }
  });

  it('floats the quick-add composer instead of launching the whole app', () => {
    const quickAdd = SHORTCUTS.find(
      (s: { id: string }) => s.id === 'quick-add'
    );
    expect(quickAdd.activity).toBe('QuickAddActivity');
    expect(quickAdd.data).toBe('dodoneadd://open');
    // Every other action wants the full app.
    for (const s of SHORTCUTS.filter(
      (s: { id: string }) => s.id !== 'quick-add'
    )) {
      expect(s.activity).toBe('MainActivity');
    }
  });

  it('labels every shortcut with string resources, never literals', () => {
    // Android silently drops a static shortcut whose label is a raw string.
    for (const s of SHORTCUTS) {
      const slug = s.id.replace(/-/g, '_');
      expect(xml).toContain(
        `android:shortcutShortLabel="@string/dodone_shortcut_${slug}_short"`
      );
      expect(xml).toContain(
        `android:shortcutLongLabel="@string/dodone_shortcut_${slug}_long"`
      );
    }
    expect(xml).not.toMatch(/shortcut(Short|Long)Label="(?!@string\/)/);
  });

  it("escapes nothing it shouldn't have to — no apostrophes in labels", () => {
    // A bare ' in strings.xml is a build error, and these go through
    // buildResourceItem unescaped.
    for (const s of SHORTCUTS) {
      expect(s.shortLabel).not.toMatch(/['"&<>]/);
      expect(s.longLabel).not.toMatch(/['"&<>]/);
    }
  });

  it('points every icon at a drawable the plugin writes', () => {
    for (const s of SHORTCUTS) {
      expect(xml).toContain(`android:icon="@drawable/${iconName(s.id)}"`);
      expect(adaptiveIcon(s.id)).toContain(
        `@drawable/${iconName(s.id)}_fg`
      );
      expect(adaptiveIcon(s.id)).toContain('@drawable/dodone_shortcut_background');
    }
  });

  it('keeps the glyph inside the adaptive-icon safe zone', () => {
    // 24x24 glyph scaled 2.5x = 60, translated to 24 => spans 24..84. Any mask
    // a launcher applies leaves 18..90 alone, so nothing can be clipped.
    const svg = legacyVector(SHORTCUTS[0].glyph);
    const scale = Number(svg.match(/android:scaleX="([\d.]+)"/)![1]);
    const translate = Number(svg.match(/android:translateX="([\d.]+)"/)![1]);
    const size = 24 * scale;
    expect(translate).toBeGreaterThanOrEqual(18);
    expect(translate + size).toBeLessThanOrEqual(90);
    expect(translate).toBeCloseTo((108 - size) / 2);
  });

  it('deep-links only to routes that exist', () => {
    const appDir = resolve(__dirname, '..', 'app');
    for (const s of SHORTCUTS.filter(
      (s: { data: string }) => s.data.startsWith('dodone://')
    )) {
      const route = s.data.replace('dodone://', '');
      const candidates = [
        `${route}.tsx`,
        `(tabs)/${route}.tsx`,
        `${route}/index.tsx`,
      ].map((p) => resolve(appDir, p));
      expect(
        candidates.some((p) => existsSync(p)),
        `no route file for ${s.data}`
      ).toBe(true);
    }
  });
});
