// Lazy CommonJS interop boundary for elkjs's main-thread bundle. Keeping the
// static import in this tiny module lets Rollup emit one self-contained
// dynamic fallback chunk instead of pulling the importing canvas module into
// a circular manual chunk.

import BundledELK from 'elkjs/lib/elk.bundled.js';

type BundledElk = { layout: (graph: never) => Promise<unknown> };

export function createBundledElk(): BundledElk {
  const Constructor = BundledELK as unknown as new () => BundledElk;
  return new Constructor();
}
