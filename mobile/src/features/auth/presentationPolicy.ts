export const LOGIN_ACTION_COLORS = { background: '#174B37', foreground: '#F4F0E6' } as const;
export const DARK_TEXT_COLORS = { muted: '#A5B2AA', accent: '#83C9B1', warning: '#D7B77E', error: '#FFB4A9' } as const;

export function statusBarStyle(screen: 'login' | 'about' | 'shell', dark: boolean): 'light-content' | 'dark-content' {
  return screen === 'login' || dark ? 'light-content' : 'dark-content';
}

type MotionPort = {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(event: 'reduceMotionChanged', listener: (value: boolean) => void): { remove(): void };
};

/** Keep the system preference separate from the persisted device preference. */
export function watchSystemReducedMotion(port: MotionPort, listener: (value: boolean) => void) {
  let disposed = false;
  let changed = false;
  const subscription = port.addEventListener('reduceMotionChanged', (value) => {
    if (disposed) return;
    changed = true;
    listener(value);
  });
  void port.isReduceMotionEnabled().then((value) => {
    if (!disposed && !changed) listener(value);
  }).catch(() => undefined);
  return { remove() { disposed = true; subscription.remove(); } };
}
