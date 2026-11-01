import ipaddr from 'ipaddr.js';

// Reject special-purpose and transition networks, including globally routed
// exceptions within them. This deliberately errs on the side of refusal.
const blockedV4 = ['192.0.0.0/24', '192.88.99.0/24'].map(ipaddr.parseCIDR);
const blockedV6 = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'].map(ipaddr.parseCIDR);
// IANA IPv6 Global Unicast allocations, 2025-10-10. Unlisted space is denied.
const globalV6 = [
  '2001:200::/23','2001:400::/23','2001:600::/23','2001:800::/22',
  '2001:c00::/23','2001:e00::/23','2001:1200::/23','2001:1400::/22',
  '2001:1800::/23','2001:1a00::/23','2001:1c00::/22','2001:2000::/19',
  '2001:4000::/23','2001:4200::/23','2001:4400::/23','2001:4600::/23',
  '2001:4800::/23','2001:4a00::/23','2001:4c00::/23','2001:5000::/20',
  '2001:8000::/19','2001:a000::/20','2001:b000::/20','2003::/18',
  '2400::/12','2410::/12','2600::/12','2610::/23','2620::/23',
  '2630::/12','2800::/12','2a00::/12','2a10::/12','2c00::/12',
].map(ipaddr.parseCIDR);

export function isPublicAddress(value) {
  if (!ipaddr.isValid(value)) return false;
  const address = ipaddr.parse(value);
  if (address.range() !== 'unicast') return false;
  if (address.kind() === 'ipv4') return !blockedV4.some(cidr => address.match(cidr));
  return globalV6.some(cidr => address.match(cidr)) && !blockedV6.some(cidr => address.match(cidr));
}

export async function resolvePublicAddress(host, lookup) {
  const answers = await lookup(host, {all:true, verbatim:true});
  if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) {
    throw new Error('Endpoint address is unavailable');
  }
  return answers[0];
}
