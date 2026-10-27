/** Maintained native client fixture. Compatibility headers never replace authentication. */
export class ClientRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    if (new URL(this.url).pathname.startsWith('/api/mobile/v1/')) this.headers.set('X-Ledger-Protocol', '2');
  }
}
