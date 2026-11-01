import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('AI egress deployment configuration',()=>{
  it('does not expose a public route and binds a container to its durable object',()=>{
    const config=JSON.parse(readFileSync('wrangler.ai-egress.jsonc','utf8').replace(/^\uFEFF/,''));
    expect(config.workers_dev).toBe(false);
    expect(config.routes).toBeUndefined();
    expect(config.containers[0].class_name).toBe('AiEgressContainer');
    expect(config.durable_objects.bindings[0].class_name).toBe('AiEgressContainer');
  });
});
