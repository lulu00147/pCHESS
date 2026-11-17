# Engine toolchain (local)

This directory contains ignored local toolchains and downloaded sources.
Patches under `tools/patches/` are tracked.

## One-command build

```bash
npm run build:release
```

The script downloads the pinned source tarballs and NNUE files when missing,
verifies NNUE size/SHA256, applies the bridge/no-LTO patches, builds both
variants, then runs the app build. Sources and networks stay under ignored
`tools/src/` and `tools/cache/`; `dist/` is ignored by Git.

Prerequisites: Node 24, GNU Make, and Emscripten 6.0.13. The local Windows
toolchain paths under `tools/w64devkit` and `tools/emsdk` are used when present;
otherwise `make` and `em++` must be on `PATH`.

Inspection flags:

```bash
node tools/build-engines.mjs --check       # validate/download inputs, no build
node tools/build-engines.mjs --fetch-only  # fetch + patch, no build
node tools/build-engines.mjs --refresh     # discard fetched sources first
```

## Pinned inputs

| Item                     | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Emscripten               | 6.0.13 (`e13ee988ce3d87a738dd8f3661d02223308c412a`)                |
| emsdk                    | `d7b4130688bfa348392b921ab04015aa15c4f154`                         |
| GNU Make                 | 4.4.1 (w64devkit 2.11.0)                                           |
| w64devkit archive SHA256 | `54c2bb9962e8a30c8270e34c5efc3d5fee579f53087fa7d435b95fbba2af7b2b` |
| 7-Zip                    | `7zip-bin` 5.2.0                                                   |
| Stockfish                | `sf_19`, `edb0d9db6731067ec50ce619ff372b463bc4dd5d`                |
| Pikafish                 | `Pikafish-2026-09-06`, `4c17cee11f888ae1d48a9494f2e2239f019f0a1f`  |

## Networks

| Engine    | File                   | Bytes      | SHA256                                                             |
| --------- | ---------------------- | ---------- | ------------------------------------------------------------------ |
| Stockfish | `nn-1a298aa575a0.nnue` | 98,511,183 | `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` |
| Pikafish  | `pikafish.nnue`        | 50,706,378 | `7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e` |

The Stockfish network is the `EvalFile` default of `sf_19`, fetched from
`tests.stockfishchess.org`. The Pikafish network is extracted from the pinned
release archive, not `master-net`; the latter is not compatible with the
pinned engine.

## Manual build

The instructions below are the manual equivalent of `npm run build:release`;
they are not required after the automatic fetch succeeds.
`tools/patches/stockfish-wasm-bridge.patch` and
`tools/patches/pikafish-wasm-bridge.patch` add a browser-side
`uci_command(const char*)` entry. Upstream's wasm target runs `main()` and
reads `std::cin`, which is not usable from a browser Worker. The patch also:

- omits `main()` via `-sINVOKE_RUN=0`;
- keeps the runtime alive with `-sEXIT_RUNTIME=0`;
- pre-creates four pthread workers;
- exports `FS` and `ccall`.

`tools/patches/stockfish-single-thread.patch` is applied after the bridge patch
for the no-pthread build. It replaces the pthread thread with synchronous
execution in `Thread::run_custom_job`; `go` therefore blocks until the search
ends. Use `go movetime <chunkMs>` for cancellation-friendly chunks. The patch
also removes `-pthread`/pthread-pool flags.

Single-thread build (after `make clean`):

```powershell
make -C tools/src/stockfish/src -j4 `
  ARCH=wasm32 COMP=clang clangmajorversion=20 `
  CXX="$root/tools/emsdk/upstream/emscripten/em++.exe" build
```

Verified 2026-11-05 in Node `vm` with external network:

- `uci`/`isready`/`go depth 5` → `bestmove e2e4`;
- JS 62,563 bytes SHA256 `0287613821fcff1cb01e7355b74247f3731f165b80acbbe8844e26e42373fbc6`;
- WASM 678,192 bytes SHA256 `f1e67e2509c4ffc218931b45890d2173d8d4edb903372589e81bd3ada2eb2423`.

Browser Worker loading was verified locally with a non-shipped smoke harness.

`tools/patches/pikafish-no-lto.patch` is applied after the Pikafish bridge
patch and before the single-thread patch. It removes `-flto` from wasm builds,
which makes the artifacts reproducible. `pikafish-single-thread.patch` is then
applied for the no-pthread build. Verified 2026-11-05 in Node `vm` with the
pinned network: `go depth 5` → `bestmove b2e2 ponder b9c7`.

- JS 61,893 bytes SHA256 `32503ca637eb74874aef41e3395e83ba5917cfd24c40fcbe4035b61a4e4d268f`;
- WASM 615,241 bytes SHA256 `bb6790e7c56642648b4791a5489e2d6d706c1f0faaa81648025e1f428e19a3eb`.

Build environment:

```powershell
$root = (Get-Location).Path
$env:TMP = "$root\tools\tmp"
$env:TEMP = "$root\tools\tmp"
$env:PATH = "$root\tools\w64devkit\w64devkit\bin;$root\tools\emsdk\upstream\emscripten;$env:PATH"
$env:EM_CONFIG = "$root\tools\emsdk\.emscripten"

make -C tools/src/stockfish/src -j4 `
  ARCH=wasm32 COMP=clang clangmajorversion=20 `
  CXX="$root/tools/emsdk/upstream/emscripten/em++.exe" build
```

Remove `tools/src/<engine>`, apply the patch, and rebuild for a clean result.
`clangmajorversion=20` is required because Emscripten's `-dumpversion` is not
the clang version and the Makefile otherwise adds an unsupported flag.

## Verified evidence

Stockfish 19, threads-simd:

- `uci` → `uciok`; single `EvalFile` option;
- `isready` → `readyok`; network loaded externally;
- `go infinite` + `stop` → `bestmove` within 1 ms; depth 20 reached;
- artifacts: JS 80,094 bytes, WASM 732,516 bytes.

Pikafish `dev-20260906-m-4c17cee1`, threads-simd:

- `uci` → `uciok`; `isready` → `readyok`;
- network loaded from `pikafish.nnue`;
- `go depth 5` → `bestmove b2e2`;
- artifacts: JS 79,549 bytes, WASM 669,663 bytes.

G0 is passed and archived outside Git in `docs/phase0-report.md`. G1 rebuilds all four
artifacts via `node tools/build-engines.mjs`; clean-room artifacts match the
lock after applying bridge, no-LTO, and single-thread patches.
