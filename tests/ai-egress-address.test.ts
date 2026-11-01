import {describe, expect, it} from 'vitest';
import {isPublicAddress, resolvePublicAddress} from '../ai-egress/address.js';

describe('AI egress address validation', () => {
  it.each(['127.0.0.1','10.1.2.3','100.64.0.1','169.254.169.254','172.16.1.1','192.168.1.1','192.0.0.9','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.2','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002::1','64:ff9b::808:808','3000::1','2d00::1','2e00::1','2001:1000::1','2500::1'])('rejects %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('accepts globally routable %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it('fails closed on mixed DNS results and returns the validated address', async () => {
    await expect(resolvePublicAddress('provider.example', async () => [{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}])).rejects.toThrow();
    await expect(resolvePublicAddress('provider.example', async () => [{address:'8.8.8.8',family:4}])).resolves.toEqual({address:'8.8.8.8',family:4});
    await expect(resolvePublicAddress('provider.example', async () => [])).rejects.toThrow();
  });
});
