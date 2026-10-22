import { pipeline } from 'npm:@huggingface/transformers@3.8.1';

// deno-lint-ignore no-explicit-any
let extractor: Promise<any> | null = null;

function getExtractor() {
  extractor ??= pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
  return extractor;
}

/** Mean-pooled, L2-normalised 384-d embedding of "query: " + q. */
export async function embedQueryText(q: string): Promise<number[]> {
  const fn = await getExtractor();
  const out = await fn('query: ' + q, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}
