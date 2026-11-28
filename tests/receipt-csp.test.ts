import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {staticSecurityHeaders} from '../worker/security';

describe('receipt OCR content security policy',()=>{
  it('permits WebAssembly in both static policies without allowing JavaScript eval',()=>{
    const policies=[staticSecurityHeaders()['content-security-policy'],readFileSync('public/_headers','utf8').match(/Content-Security-Policy:\s*(.+)/i)?.[1] ?? ''];
    for(const policy of policies){
      const script=policy.split(';').map(part=>part.trim()).find(part=>part.startsWith('script-src '));
      expect(script).toContain("'wasm-unsafe-eval'");
      expect(script).not.toContain("'unsafe-eval'");
    }
  });
});
