import { CAPTURE_DESTINATION, routeForSession, shellDestination, type SafeSessionSnapshot, type ShellDestination } from './authModel';

export type DisplaySnapshot = {
  appearanceMode: 'System' | 'Light' | 'Dark';
  filter: string;
  reducedMotion: boolean;
};

type Subscription = { remove(): void };

export type SessionPort = {
  getSnapshot(): Promise<SafeSessionSnapshot>;
  refreshOnResume(): Promise<SafeSessionSnapshot>;
  beginLogin(staySignedIn: boolean, pendingDestination: string | null): Promise<SafeSessionSnapshot>;
  signOut(): Promise<SafeSessionSnapshot>;
  consumePendingDestination(): Promise<string | null>;
  onStateChanged(listener: (value: SafeSessionSnapshot) => void): Subscription;
};

export type PreferencesPort = {
  getSnapshot(): Promise<DisplaySnapshot>;
  updateDisplay(value: DisplaySnapshot): Promise<DisplaySnapshot>;
  onChanged(listener: (value: DisplaySnapshot) => void): Subscription;
};

export type MobileAppSnapshot = {
  session: SafeSessionSnapshot;
  route: 'login' | 'shell';
  display: DisplaySnapshot;
  destination: ShellDestination;
};

const restoring: SafeSessionSnapshot = {
  state: 'restoring', expiresAt: null, pendingDestination: null, reason: null,
  pendingRevocations: 0, environment: 'sandbox',
};

const lockedSession = (current: SafeSessionSnapshot): SafeSessionSnapshot => ({
  ...current,
  state: 'storage_failure',
  expiresAt: null,
  pendingDestination: null,
  reason: 'NativeFailure',
});

export class SessionCoordinator {
  private value: MobileAppSnapshot = {
    session: restoring,
    route: 'login',
    display: { appearanceMode: 'System', filter: 'All', reducedMotion: false },
    destination: 'overview',
  };
  private subscriptions: Subscription[] = [];
  private listeners = new Set<(value: MobileAppSnapshot) => void>();
  private started = false;
  private signedInTransition = false;
  private sessionEventRevision = 0;
  private displayEventRevision = 0;
  private lifecycleGeneration = 0;
  private destinationGeneration = 0;

  constructor(private readonly session: SessionPort, private readonly preferences: PreferencesPort) {}

  current(): MobileAppSnapshot {
    return this.value;
  }

  listen(listener: (value: MobileAppSnapshot) => void): Subscription {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const generation = ++this.lifecycleGeneration;
    this.subscriptions = [
      this.session.onStateChanged((value) => {
        if (!this.isCurrent(generation)) return;
        this.sessionEventRevision += 1;
        this.applySession(value);
      }),
      this.preferences.onChanged((display) => {
        if (!this.isCurrent(generation)) return;
        this.displayEventRevision += 1;
        this.update({ display });
      }),
    ];
    const sessionRevision = this.sessionEventRevision;
    const displayRevision = this.displayEventRevision;
    await Promise.all([
      this.session.getSnapshot()
        .then((session) => {
          if (this.isCurrent(generation) && this.sessionEventRevision === sessionRevision) this.applySession(session);
        })
        .catch(() => {
          if (this.isCurrent(generation) && this.sessionEventRevision === sessionRevision) {
            this.applySession(lockedSession(this.value.session));
          }
        }),
      this.preferences.getSnapshot()
        .then((display) => {
          if (this.isCurrent(generation) && this.displayEventRevision === displayRevision) this.update({ display });
        })
        .catch(() => undefined),
    ]);
  }

  async resume(): Promise<void> {
    if (!this.started) return;
    const generation = this.lifecycleGeneration;
    const revision = this.sessionEventRevision;
    try {
      const session = await this.session.refreshOnResume();
      if (this.isCurrent(generation) && this.sessionEventRevision === revision) this.applySession(session);
    } catch {
      if (this.isCurrent(generation) && this.sessionEventRevision === revision) {
        this.applySession(lockedSession(this.value.session));
      }
    }
  }

  async beginLogin(staySignedIn: boolean): Promise<void> {
    if (!this.started) return;
    const generation = this.lifecycleGeneration;
    const revision = this.sessionEventRevision;
    const session = await this.session.beginLogin(staySignedIn, CAPTURE_DESTINATION);
    if (this.isCurrent(generation) && this.sessionEventRevision === revision) this.applySession(session);
  }

  async signOut(): Promise<void> {
    if (!this.started) return;
    const generation = this.lifecycleGeneration;
    const session = await this.session.signOut();
    if (this.isCurrent(generation)) this.applySession(session);
  }

  async setAppearance(appearanceMode: DisplaySnapshot['appearanceMode']): Promise<void> {
    if (!this.started) return;
    const generation = this.lifecycleGeneration;
    const display = await this.preferences.updateDisplay({ ...this.value.display, appearanceMode });
    if (this.isCurrent(generation)) this.update({ display });
  }

  dispose(): void {
    this.started = false;
    this.lifecycleGeneration += 1;
    this.destinationGeneration += 1;
    this.signedInTransition = false;
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
    this.listeners.clear();
  }

  private applySession(session: SafeSessionSnapshot): void {
    if (!this.started) return;
    const hadSession = this.signedInTransition;
    const enteringSignedIn = session.state === 'signed_in' && !this.signedInTransition;
    // Refresh keeps the current authenticated cycle and its mounted navigation.
    if (session.state !== 'refreshing') this.signedInTransition = session.state === 'signed_in';
    if (enteringSignedIn || (hadSession && !this.signedInTransition)) this.destinationGeneration += 1;
    const generation = this.lifecycleGeneration;
    const destinationGeneration = this.destinationGeneration;
    const currentDestination = () => this.isCurrent(generation) &&
      this.destinationGeneration === destinationGeneration && this.signedInTransition;
    this.update({ session, route: routeForSession(session, this.value.route) });
    if (enteringSignedIn && currentDestination()) {
      void this.session.consumePendingDestination()
        .then((destination) => {
          if (currentDestination()) this.update({ destination: shellDestination(destination) });
        })
        .catch(() => {
          if (currentDestination()) this.update({ destination: 'overview' });
        });
    }
  }

  private isCurrent(generation: number): boolean {
    return this.started && this.lifecycleGeneration === generation;
  }

  private update(next: Partial<MobileAppSnapshot>): void {
    this.value = { ...this.value, ...next };
    this.listeners.forEach((listener) => listener(this.value));
  }
}
