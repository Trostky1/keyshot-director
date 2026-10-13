#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cargo build --manifest-path "$ROOT/material-core/Cargo.toml" --release --target wasm32-unknown-unknown
cp "$ROOT/material-core/target/wasm32-unknown-unknown/release/keyshot_material_core.wasm" "$ROOT/server/material-core.wasm"
echo "Built server/material-core.wasm"
