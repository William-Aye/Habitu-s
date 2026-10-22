// onnxruntime-web (WebAssembly) for Transformers.js. Import this module before Transformers.js.
// The Edge runtime forbids native addons, so the Node build of Transformers.js (onnxruntime-node)
// cannot load. Its web build would pick the absent Node backend here, because Deno exposes a
// Node-like `process`; it uses a runtime registered under Symbol.for('onnxruntime') instead.
// `/wasm` is the WASM-only build; its .mjs/.wasm are read from the npm package itself.
import * as ort from 'npm:onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/wasm';

// Edge workers are not cross-origin isolated: no SharedArrayBuffer, so no WASM threads.
ort.env.wasm.numThreads = 1;
// Default file locations (next to the package's entry). Setting the field also stops
// Transformers.js from pointing it at its own CDN copy.
ort.env.wasm.wasmPaths = {};

(globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')] = ort;
