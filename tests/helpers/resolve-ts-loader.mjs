import { readFile } from 'node:fs/promises';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/[.](?:ts|js|mjs|json)$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context, nextResolve);
    } catch {
      return nextResolve(specifier, context, nextResolve);
    }
  }
  return nextResolve(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8');
    return { format: 'module', source: `export default ${source};`, shortCircuit: true };
  }
  return nextLoad(url, context, nextLoad);
}
