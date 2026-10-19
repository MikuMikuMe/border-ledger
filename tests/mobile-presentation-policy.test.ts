import { describe, expect, it, vi } from 'vitest';
import { DARK_TEXT_COLORS, LOGIN_ACTION_COLORS, statusBarStyle, watchSystemReducedMotion } from '../mobile/src/features/auth/presentationPolicy';

describe('native presentation policy', () => {
  it('keeps action and shell text above 4.5:1 contrast on their fixed surfaces', () => {
    const luminance = (hex: string) => {
      const channels = hex.match(/[0-9a-f]{2}/gi)!.map((channel) => {
        const value = parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const background = luminance(LOGIN_ACTION_COLORS.background);
    const foreground = luminance(LOGIN_ACTION_COLORS.foreground);
    expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThanOrEqual(4.5);
    for (const color of Object.values(DARK_TEXT_COLORS)) {
      expect((luminance(color) + 0.05) / (luminance('#1D2925') + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses readable system icons for login artwork and the themed About surface', () => {
    expect(statusBarStyle('login', false)).toBe('light-content');
    expect(statusBarStyle('about', false)).toBe('dark-content');
    expect(statusBarStyle('about', true)).toBe('light-content');
    expect(statusBarStyle('shell', false)).toBe('dark-content');
  });

  it('honors system remove-animations changes without a stale initial read replacing them', async () => {
    let resolveInitial!: (value: boolean) => void;
    let changed!: (value: boolean) => void;
    const removed = vi.fn();
    const observed: boolean[] = [];
    const subscription = watchSystemReducedMotion({
      isReduceMotionEnabled: () => new Promise<boolean>((resolve) => { resolveInitial = resolve; }),
      addEventListener: (_event, listener) => { changed = listener; return { remove: removed }; },
    }, (value) => observed.push(value));

    changed(true);
    resolveInitial(false);
    await Promise.resolve();
    expect(observed).toEqual([true]);
    changed(false);
    expect(observed).toEqual([true, false]);
    subscription.remove();
    changed(true);
    expect(observed).toEqual([true, false]);
    expect(removed).toHaveBeenCalledOnce();
  });

  it('publishes the initial system preference and ignores a read after disposal', async () => {
    const observed: boolean[] = [];
    const port = {
      isReduceMotionEnabled: async () => true,
      addEventListener: () => ({ remove() {} }),
    };
    const first = watchSystemReducedMotion(port, (value) => observed.push(value));
    await Promise.resolve();
    expect(observed).toEqual([true]);
    first.remove();
    const second = watchSystemReducedMotion(port, (value) => observed.push(value));
    second.remove();
    await Promise.resolve();
    expect(observed).toEqual([true]);
  });
});
