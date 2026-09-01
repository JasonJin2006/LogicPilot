// Shared ELK orchestration for every paradigm canvas. The consumer supplies
// the two elkjs constructors (the worker one needs a bundler-resolved `?url`
// import, so it stays application-side); this module owns the policy:
// worker first, main-thread bundle on failure, one logged fallback.

export interface ElkLike {
  layout(graph: never): Promise<unknown>;
}

/** Shape both callers read back: layered children with optional x/y. */
export interface ElkLayoutResult {
  children?: Array<Record<string, unknown>>;
}

export interface ElkRunOptions<G> {
  graph: G;
  /** Worker-backed constructor; omit in non-browser environments (tests). */
  createWorkerElk?: () => ElkLike;
  /** Main-thread bundled constructor, awaited lazily on worker failure. */
  createBundledElk: () => Promise<ElkLike>;
}

export async function runElkLayout<G>(options: ElkRunOptions<G>): Promise<ElkLayoutResult> {
  const run = async (elk: ElkLike): Promise<ElkLayoutResult> =>
    (await elk.layout(options.graph as never)) as ElkLayoutResult;
  // Node/SSR/test runtimes intentionally have no Web Worker global. Treat
  // that as an unsupported capability, not a worker failure: constructing
  // elk-api there throws synchronously and used to flood otherwise-green
  // test output with an expected fallback stack trace.
  if (options.createWorkerElk !== undefined && typeof Worker !== 'undefined') {
    try {
      return await run(options.createWorkerElk());
    } catch (workerError) {
      // Worker unavailable (CSP, exotic bundler, non-browser): the
      // main-thread bundle keeps working.
      // eslint-disable-next-line no-console -- one-shot fallback diagnostic.
      console.warn('[canvas] ELK worker failed, falling back to main thread', workerError);
    }
  }
  const bundled = await options.createBundledElk();
  return run(bundled);
}
