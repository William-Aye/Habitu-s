import './onnx.ts';
// Web build of Transformers.js 3.8.1 (bundled, pinned). The npm entry resolves to the Node build,
// which loads the native onnxruntime-node addon that the Edge runtime forbids. Minified on purpose:
// the unminified bundle keeps JSDoc `import('../utils/…')` types, which the Edge runtime's module
// graph tries to resolve (and cannot) at boot.
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

// Server runtime: weights come from the Hub over HTTP; no browser cache, no filesystem cache.
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useFSCache = false;

// deno-lint-ignore no-explicit-any
let extractor: Promise<any> | null = null;

function getExtractor() {
  extractor ??= pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    dtype: 'q8',
    // With an injected runtime Transformers.js lists no devices of its own: 'auto' defers the
    // choice to the session options, which ask onnxruntime-web for its WASM backend.
    device: 'auto',
    session_options: { executionProviders: ['wasm'] },
  });
  return extractor;
}

/** Mean-pooled, L2-normalised 384-d embedding of "query: " + q. */
export async function embedQueryText(q: string): Promise<number[]> {
  const fn = await getExtractor();
  const out = await fn('query: ' + q, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}
