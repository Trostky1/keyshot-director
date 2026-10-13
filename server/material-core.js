// Rust-owned material recipe validation/compiler. The generated WASM module is
// deliberately isolated here; KeyShot graph edits remain in bridge/cc_materials.py.
'use strict';

const fs = require('fs');
const path = require('path');

const WASM_PATH = path.join(__dirname, 'material-core.wasm');
let instancePromise;

async function loadCompiler() {
  if (!instancePromise) {
    instancePromise = (async () => {
      if (!fs.existsSync(WASM_PATH)) {
        throw new Error('Rust material compiler is not built. Run material-core/build.ps1 (Windows) or material-core/build.sh (macOS/Linux).');
      }
      const bytes = fs.readFileSync(WASM_PATH);
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const e = instance.exports;
      if (!e.memory || !e.material_alloc || !e.material_compile || !e.material_output_ptr || !e.material_output_len || !e.material_dealloc) {
        throw new Error('The Rust material compiler has an incompatible WASM interface.');
      }
      return e;
    })().catch(error => { instancePromise = null; throw error; });
  }
  return instancePromise;
}

async function compileTexturePlan({ name, files }) {
  const e = await loadCompiler();
  const input = Buffer.from(JSON.stringify({ name, files }), 'utf8');
  if (!input.length || input.length > 1024 * 1024) throw new Error('Material recipe request is too large.');
  const inputPtr = e.material_alloc(input.length);
  try {
    new Uint8Array(e.memory.buffer, inputPtr, input.length).set(input);
    const status = e.material_compile(inputPtr, input.length);
    if (status !== 0) throw new Error(`Rust material compiler failed (${status}).`);
    const outputPtr = e.material_output_ptr();
    const outputLen = e.material_output_len();
    if (!outputLen || outputLen > 4 * 1024 * 1024) throw new Error('Rust material compiler returned an invalid response size.');
    const output = Buffer.from(new Uint8Array(e.memory.buffer, outputPtr, outputLen));
    const response = JSON.parse(output.toString('utf8'));
    if (!response.ok || !response.plan) throw new Error(response.error || 'Rust material compiler rejected the recipe.');
    return response.plan;
  } finally {
    e.material_dealloc(inputPtr, input.length);
  }
}

module.exports = { compileTexturePlan };
