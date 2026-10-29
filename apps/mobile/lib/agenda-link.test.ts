import { describe, it, expect } from 'vitest';

import { agendaModeForSystemPath } from './agenda-link';

describe('agendaModeForSystemPath', () => {
  it('reads the custom-scheme links the widgets and shortcuts open', () => {
    expect(agendaModeForSystemPath('dodone://today')).toBe('today');
    expect(agendaModeForSystemPath('dodone://upcoming')).toBe('upcoming');
  });

  it('accepts the other shapes a link can arrive in', () => {
    expect(agendaModeForSystemPath('dodone:///upcoming')).toBe('upcoming');
    expect(agendaModeForSystemPath('dodone://today/')).toBe('today');
    expect(agendaModeForSystemPath('dodone://today?from=widget')).toBe('today');
    expect(agendaModeForSystemPath('/upcoming')).toBe('upcoming');
    expect(agendaModeForSystemPath('https://dodone.byebrianwong.com/today')).toBe('today');
  });

  it('leaves every other link alone', () => {
    expect(agendaModeForSystemPath('dodone://')).toBeNull();
    expect(agendaModeForSystemPath('dodone://quick-add?voice=1')).toBeNull();
    expect(agendaModeForSystemPath('dodone://lists/abc')).toBeNull();
    expect(agendaModeForSystemPath('dodone://today/extra')).toBeNull();
    expect(agendaModeForSystemPath('dodone://preview-pr?number=3')).toBeNull();
    // On https the host is not a route.
    expect(agendaModeForSystemPath('https://today/')).toBeNull();
  });
});
