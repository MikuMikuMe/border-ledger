import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import {sendPinned} from '../ai-egress/pinned-request.js';

describe('pinned provider connection', () => {
  it('pins the validated address while retaining the TLS hostname and does not follow redirects', async () => {
    let options:any;
    const request = vi.fn((url, config, onResponse) => {
      options = config;
      const outgoing = new EventEmitter() as any;
      outgoing.setTimeout = () => outgoing;
      outgoing.destroy = () => outgoing;
      outgoing.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 302;
        onResponse(response);
        response.emit('end');
      };
      return outgoing;
    });
    const result = await sendPinned('https://provider.example/v1', {'content-type':'application/json'}, '{}', {lookup:async () => [{address:'8.8.8.8',family:4}],request});
    expect(result.status).toBe(302);
    expect(options.servername).toBe('provider.example');
    expect(options.rejectUnauthorized).toBe(true);
    const lookup = await new Promise(resolve => options.lookup('provider.example', {}, (error:unknown, address:string, family:number) => resolve({error,address,family})));
    expect(lookup).toEqual({error:null,address:'8.8.8.8',family:4});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not open a connection for a mixed public and private answer', async () => {
    const request = vi.fn();
    await expect(sendPinned('https://provider.example/v1', {}, '{}', {lookup:async () => [{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}], request})).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
