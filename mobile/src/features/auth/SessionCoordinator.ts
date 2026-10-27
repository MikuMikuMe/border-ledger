import { CAPTURE_DESTINATION, routeForSession, shellDestination, type SafeSessionSnapshot, type ShellDestination } from './authModel';

export type DisplaySnapshot = {
  appearanceMode: 'System' | 'Light' | 'Dark';
  filter: string;
  reducedMotion: boolean;
};

type Subscription = { remove(): void };
type GenerationToken = { generation: number };
type SnapshotToken = GenerationToken & { revision: number };
type DestinationToken = GenerationToken & { destinationGeneration: number };
type SessionTransition = { enteringSignedIn: boolean; hadSession: boolean };

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
    this.subscribeToSession({ generation });
    this.subscribeToPreferences({ generation });
    const sessionToken: SnapshotToken = { generation, revision: this.sessionEventRevision };
    const displayToken: SnapshotToken = { generation, revision: this.displayEventRevision };
    await Promise.all([
      this.loadInitialSession(sessionToken),
      this.loadInitialDisplay(displayToken),
    ]);
  }

  async resume(): Promise<void> {
    if (!this.started) return;
    const token: SnapshotToken = { generation: this.lifecycleGeneration, revision: this.sessionEventRevision };
    try {
      const session = await this.session.refreshOnResume();
      if (this.shouldApplySession(token)) this.applySession(session);
    } catch {
      if (this.shouldApplySession(token)) {
        this.applySession(lockedSession(this.value.session));
      }
    }
  }

  async beginLogin(staySignedIn: boolean): Promise<void> {
    if (!this.started) return;
    const token: SnapshotToken = { generation: this.lifecycleGeneration, revision: this.sessionEventRevision };
    const session = await this.session.beginLogin(staySignedIn, CAPTURE_DESTINATION);
    if (this.shouldApplySession(token)) this.applySession(session);
  }

  async signOut(): Promise<void> {
    if (!this.started) return;
    const token: GenerationToken = { generation: this.lifecycleGeneration };
    const session = await this.session.signOut();
    if (this.isCurrent(token)) this.applySession(session);
  }

  async setAppearance(appearanceMode: DisplaySnapshot['appearanceMode']): Promise<void> {
    if (!this.started) return;
    const token: GenerationToken = { generation: this.lifecycleGeneration };
    const display = await this.preferences.updateDisplay({ ...this.value.display, appearanceMode });
    if (this.isCurrent(token)) this.update({ display });
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
    if (session.state === 'refreshing') session = { ...session, userId: this.value.session.userId, ledgerId: this.value.session.ledgerId, sessionEpoch: this.value.session.sessionEpoch };
    if (session.state === 'signed_in' && session.sessionEpoch !== this.value.session.sessionEpoch) {
      this.signedInTransition = false;
      this.destinationGeneration += 1;
      this.update({ destination: 'overview' });
    }
    const enteringSignedIn = this.updateSessionTransition(session);
    const token: GenerationToken = { generation: this.lifecycleGeneration };
    const destinationToken: DestinationToken = { ...token, destinationGeneration: this.destinationGeneration };
    this.update({ session, route: routeForSession(session, this.value.route) });
    if (enteringSignedIn && this.isCurrent(token)) this.consumeDestination(destinationToken);
  }

  private subscribeToSession(token: GenerationToken): void {
    this.subscriptions.push(this.session.onStateChanged((value) => {
      if (!this.isCurrent(token)) return;
      this.sessionEventRevision += 1;
      this.applySession(value);
    }));
  }

  private subscribeToPreferences(token: GenerationToken): void {
    this.subscriptions.push(this.preferences.onChanged((display) => {
      if (!this.isCurrent(token)) return;
      this.displayEventRevision += 1;
      this.update({ display });
    }));
  }

  private async loadInitialSession(token: SnapshotToken): Promise<void> {
    try {
      const session = await this.session.getSnapshot();
      if (this.shouldApplySession(token)) this.applySession(session);
    } catch {
      if (this.shouldApplySession(token)) this.applySession(lockedSession(this.value.session));
    }
  }

  private async loadInitialDisplay(token: SnapshotToken): Promise<void> {
    try {
      const display = await this.preferences.getSnapshot();
      if (this.isCurrent(token) && this.displayEventRevision === token.revision) this.update({ display });
    } catch {
      // Display preferences are optional; the in-memory defaults remain active.
    }
  }

  private shouldApplySession(token: SnapshotToken): boolean {
    return this.isCurrent(token) && this.sessionEventRevision === token.revision;
  }

  private updateSessionTransition(session: SafeSessionSnapshot): boolean {
    const hadSession = this.signedInTransition;
    const transition: SessionTransition = {
      enteringSignedIn: session.state === 'signed_in' && !hadSession,
      hadSession,
    };
    // Refresh keeps the current authenticated cycle and its mounted navigation.
    if (session.state !== 'refreshing') this.signedInTransition = session.state === 'signed_in';
    if (this.shouldAdvanceDestination(transition)) this.destinationGeneration += 1;
    return transition.enteringSignedIn;
  }

  private shouldAdvanceDestination(transition: SessionTransition): boolean {
    if (transition.enteringSignedIn) return true;
    return transition.hadSession && !this.signedInTransition;
  }

  private consumeDestination(token: DestinationToken): void {
    const isCurrentDestination = () => this.isCurrent(token) &&
      this.destinationGeneration === token.destinationGeneration && this.signedInTransition;
    void this.session.consumePendingDestination()
      .then((destination) => {
        if (isCurrentDestination()) this.update({ destination: shellDestination(destination) });
      })
      .catch(() => {
        if (isCurrentDestination()) this.update({ destination: 'overview' });
      });
  }

  private isCurrent(token: GenerationToken): boolean {
    return this.started && this.lifecycleGeneration === token.generation;
  }

  private update(next: Partial<MobileAppSnapshot>): void {
    this.value = { ...this.value, ...next };
    this.listeners.forEach((listener) => listener(this.value));
  }
}
