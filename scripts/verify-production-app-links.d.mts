export interface ProductionAppLinksVerificationOptions {
  fetchImpl?: typeof fetch;
  deploymentRevision?: string;
  attempts?: number;
  retryDelayMs?: number;
  waitImpl?: (milliseconds: number) => Promise<unknown>;
}

export function verifyProductionAppLinks(
  options?: ProductionAppLinksVerificationOptions,
): Promise<{ attempts: number }>;
