export interface PlaidAccountMetadata {
  id: string;
  name: string;
  mask?: string;
  type: string;
  subtype?: string;
  verification_status?: string;
}

export interface PlaidInstitutionMetadata {
  institution?: { name?: string };
  accounts?: PlaidAccountMetadata[];
}

export interface PlaidExitMetadata {
  institution?: { name?: string };
  status?: string;
}

interface PlaidLinkHandler {
  open(): void;
  exit(): void;
  destroy(): void;
}

interface PlaidApi {
  create(options: {
    token: string;
    onSuccess(publicToken: string, metadata: PlaidInstitutionMetadata): void;
    onExit(error: { error_code?: string; display_message?: string } | null, metadata: PlaidExitMetadata): void;
  }): PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidApi;
  }
}

const PLAID_SCRIPT_ID = 'plaid-link-script';
const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
let plaidLoader: Promise<PlaidApi> | null = null;

function loadPlaidScript() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (plaidLoader) return plaidLoader;

  plaidLoader = new Promise<PlaidApi>((resolve, reject) => {
    const existing = document.getElementById(PLAID_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    script.id = PLAID_SCRIPT_ID;
    script.src = PLAID_SCRIPT_SRC;
    script.async = true;
    script.onload = () => window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link loaded without its API.'));
    script.onerror = () => reject(new Error('Plaid Link could not be loaded. Check the browser connection and try again.'));
    if (!existing) document.head.appendChild(script);
  }).catch((error) => {
    plaidLoader = null;
    throw error;
  });

  return plaidLoader;
}

export async function openPlaidLink(options: {
  token: string;
  onSuccess(publicToken: string, metadata: PlaidInstitutionMetadata): Promise<void> | void;
  onExit(error: { error_code?: string; display_message?: string } | null, metadata: PlaidExitMetadata): void;
}) {
  const plaid = await loadPlaidScript();
  const handler = plaid.create({
    token: options.token,
    onSuccess: (publicToken, metadata) => { void options.onSuccess(publicToken, metadata); },
    onExit: options.onExit,
  });
  handler.open();
  return handler;
}
