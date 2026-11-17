import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const require = createRequire(import.meta.url);
const sevenZip = require('7zip-bin').path7za;
const root = resolve(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
const refresh = flags.has('--refresh');
const fetchOnly = flags.has('--fetch-only');
const checkOnly = flags.has('--check');
const localMake = join(root, 'tools/w64devkit/w64devkit/bin/make.exe');
const localEmxx = join(root, 'tools/emsdk/upstream/emscripten/em++.exe');
const localEmConfig = join(root, 'tools/emsdk/.emscripten');
const make = existsSync(localMake) ? localMake : 'make';
const emxx = existsSync(localEmxx) ? localEmxx : 'em++';
const env = {
  ...process.env,
  PATH: [
    join(root, 'tools/w64devkit/w64devkit/bin'),
    join(root, 'tools/emsdk/upstream/emscripten'),
    process.env.PATH ?? '',
  ].join(delimiter),
  TMP: join(root, 'tools/tmp'),
  TEMP: join(root, 'tools/tmp'),
  ...(existsSync(localEmConfig) ? { EM_CONFIG: localEmConfig } : {}),
};

const version = {
  stockfish: 'sf_19',
  pikafish: 'Pikafish-2026-09-06',
};
const publicRoot = join(root, 'public/engines');
const downloadRoot = join(root, 'tools/cache/downloads');
const networkRoot = join(root, 'tools/cache/nets');
const sourceRoot = join(root, 'tools/src');
const builds = [
  { engine: 'stockfish', build: 'threads-simd', artifact: 'stockfish' },
  { engine: 'stockfish', build: 'single-simd', artifact: 'stockfish' },
  { engine: 'pikafish', build: 'threads-simd', artifact: 'pikafish' },
  { engine: 'pikafish', build: 'single-simd', artifact: 'pikafish' },
];
const sources = {
  stockfish: {
    dir: 'stockfish',
    commit: 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
    url: 'https://codeload.github.com/official-stockfish/Stockfish/tar.gz/edb0d9db6731067ec50ce619ff372b463bc4dd5d',
    bridge: 'tools/patches/stockfish-wasm-bridge.patch',
    single: 'tools/patches/stockfish-single-thread.patch',
  },
  pikafish: {
    dir: 'pikafish',
    commit: '4c17cee11f888ae1d48a9494f2e2239f019f0a1f',
    url: 'https://codeload.github.com/official-pikafish/Pikafish/tar.gz/4c17cee11f888ae1d48a9494f2e2239f019f0a1f',
    bridge: 'tools/patches/pikafish-wasm-bridge.patch',
    single: 'tools/patches/pikafish-single-thread.patch',
    noLto: 'tools/patches/pikafish-no-lto.patch',
  },
};
const networks = [
  {
    engine: 'stockfish',
    file: 'nn-1a298aa575a0.nnue',
    bytes: 98_511_183,
    sha256: '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2',
    license: 'CC0-1.0',
    url: 'https://tests.stockfishchess.org/api/nn/nn-1a298aa575a0.nnue',
  },
  {
    engine: 'pikafish',
    file: 'pikafish.nnue',
    bytes: 50_706_378,
    sha256: '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e',
    license: 'Pikafish NNUE License (non-commercial)',
    archive: 'Pikafish.2026-09-06.7z',
    archiveUrl:
      'https://github.com/official-pikafish/Pikafish/releases/download/Pikafish-2026-09-06/Pikafish.2026-09-06.7z',
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertFile(path, expectedBytes, expectedSha) {
  if (!existsSync(path)) throw new Error(`missing input: ${path}`);
  const size = statSync(path).size;
  if (expectedBytes !== undefined && size !== expectedBytes) {
    throw new Error(`size mismatch: ${path} is ${size}, expected ${expectedBytes}`);
  }
  if (expectedSha !== undefined && sha256(path) !== expectedSha.toLowerCase()) {
    throw new Error(`SHA256 mismatch: ${path}`);
  }
}

async function download(url, target) {
  if (existsSync(target) && statSync(target).size > 0) return;
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.part`;
  rmSync(partial, { force: true });
  console.log(`download ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  assertFile(partial);
  renameSync(partial, target);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

function extractTarball(archive, target) {
  const temp = join(root, 'tools/tmp', `extract-${Date.now()}`);
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  run('tar', ['-xzf', archive, '-C', temp]);
  const entries = readdirSync(temp, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`unexpected archive layout: ${archive}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(temp, entries[0].name), target);
  rmSync(temp, { recursive: true, force: true });
}

function extract7z(archive, target, member, extras = []) {
  const temp = join(root, 'tools/tmp', `extract-${Date.now()}`);
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  run(sevenZip, ['x', '-y', `-o${temp}`, archive]);
  const found = findFile(temp, member);
  if (!found) throw new Error(`archive member missing: ${member}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(found, target);
  for (const extra of extras) {
    const source = findFile(temp, extra.name);
    if (!source) throw new Error(`archive member missing: ${extra.name}`);
    mkdirSync(dirname(extra.target), { recursive: true });
    copyFileSync(source, extra.target);
  }
  rmSync(temp, { recursive: true, force: true });
}

async function ensureSource(engine, spec) {
  const target = join(sourceRoot, spec.dir);
  if (refresh) rmSync(target, { recursive: true, force: true });
  if (existsSync(join(target, 'src', 'Makefile'))) return target;

  const archive = join(downloadRoot, `${engine}-${spec.commit}.tar.gz`);
  await download(spec.url, archive);
  extractTarball(archive, target);
  if (!existsSync(join(target, 'src', 'Makefile'))) {
    throw new Error(`${engine}: source archive has no src/Makefile`);
  }
  return target;
}

async function ensureNetwork(network) {
  const target = join(networkRoot, network.file);
  if (existsSync(target)) {
    assertFile(target, network.bytes, network.sha256);
    if (network.archive) await ensureNetworkLicenses(network);
    return target;
  }

  if (network.url) {
    await download(network.url, target);
  } else {
    const archive = join(downloadRoot, network.archive);
    await download(network.archiveUrl, archive);
    extract7z(archive, target, network.file, networkLicenses());
  }
  assertFile(target, network.bytes, network.sha256);
  return target;
}

function networkLicenses() {
  return [
    {
      name: 'Copying.txt',
      target: join(root, 'tools/cache/pikafish-release/Copying.txt'),
    },
    {
      name: 'NNUE-License.md',
      target: join(root, 'tools/cache/pikafish-release/NNUE-License.md'),
    },
  ];
}

async function ensureNetworkLicenses(network) {
  const extras = networkLicenses();
  if (extras.every((extra) => existsSync(extra.target))) return;
  const archive = join(downloadRoot, network.archive);
  await download(network.archiveUrl, archive);
  extract7z(archive, join(networkRoot, network.file), network.file, extras);
}

function applyPatch(source, patch) {
  const directory = relative(root, source).replaceAll('\\', '/');
  run('git', ['apply', `--directory=${directory}`, resolve(root, patch)]);
}

function reversePatch(source, patch) {
  const directory = relative(root, source).replaceAll('\\', '/');
  run('git', ['apply', '--reverse', `--directory=${directory}`, resolve(root, patch)]);
}

function patchState(source) {
  const thread = readFileSync(join(source, 'src', 'thread.cpp'), 'utf8');
  const makefile = readFileSync(join(source, 'src', 'Makefile'), 'utf8');
  return {
    thread: thread.includes('STOCKFISH_SINGLE_THREAD'),
    makefile: makefile.includes('STOCKFISH_SINGLE_THREAD'),
  };
}

function prepareSource(engine, source, spec) {
  const bridge = join(source, 'src', 'wasm_bridge.cpp');
  if (!existsSync(bridge) || !readFileSync(bridge, 'utf8').includes('uci_command')) {
    applyPatch(source, spec.bridge);
  }
  if (spec.noLto) {
    const makefile = readFileSync(join(source, 'src', 'Makefile'), 'utf8');
    if (!makefile.includes('filter-out -flto%')) applyPatch(source, spec.noLto);
  }

  const state = patchState(source);
  if (state.thread || state.makefile) {
    if (!state.thread || !state.makefile) {
      throw new Error(`${engine}: partial single-thread patch; run with --refresh`);
    }
    reversePatch(source, spec.single);
  }
  if (!readFileSync(bridge, 'utf8').includes('uci_command')) {
    throw new Error(`${engine}: wasm bridge patch not applied`);
  }
}

function build(spec, source) {
  const sourcePath = join(source, 'src');
  const isSingle = spec.build === 'single-simd';
  if (isSingle) applyPatch(source, sources[spec.engine].single);
  try {
    run(make, ['-C', sourcePath, 'clean']);
    const extra =
      spec.engine === 'pikafish'
        ? ['GIT_SHA=4c17cee1', 'GIT_DATE=20260906', 'GIT_DIFFINDEX=']
        : [];
    run(make, [
      '-C',
      sourcePath,
      '-j4',
      'ARCH=wasm32',
      'COMP=clang',
      'clangmajorversion=20',
      ...extra,
      `CXX=${emxx}`,
      'build',
    ]);
  } finally {
    if (isSingle) reversePatch(source, sources[spec.engine].single);
  }

  const target = join(publicRoot, spec.engine, version[spec.engine], spec.build);
  const js = copy(join(sourcePath, `${spec.artifact}.js`), join(target, `${spec.artifact}.js`));
  const wasm = copy(join(sourcePath, `${spec.artifact}.wasm`), join(target, `${spec.artifact}.wasm`));
  const gitArgs =
    spec.engine === 'pikafish' ? ' GIT_SHA=4c17cee1 GIT_DATE=20260906 GIT_DIFFINDEX=' : '';
  return {
    baseUrl: `/engines/${spec.engine}/${version[spec.engine]}/${spec.build}/`,
    command:
      spec.build === 'single-simd'
        ? `make -C tools/src/${spec.engine}/src clean && make -C tools/src/${spec.engine}/src -j4 ARCH=wasm32 COMP=clang clangmajorversion=20${gitArgs} build`
        : `make -C tools/src/${spec.engine}/src -j4 ARCH=wasm32 COMP=clang clangmajorversion=20${gitArgs} build`,
    artifacts: [
      { path: `${spec.artifact}.js`, bytes: js.bytes, sha256: js.sha256 },
      { path: `${spec.artifact}.wasm`, bytes: wasm.bytes, sha256: wasm.sha256 },
    ],
  };
}

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { bytes: statSync(target).size, sha256: sha256(target).toUpperCase() };
}

function pruneStaleLayout() {
  for (const [engine, engineVersion] of Object.entries(version)) {
    const engineRoot = join(publicRoot, engine);
    if (!existsSync(engineRoot)) continue;
    for (const entry of readdirSync(engineRoot, { withFileTypes: true })) {
      if (entry.name !== engineVersion) {
        rmSync(join(engineRoot, entry.name), { recursive: true, force: true });
      }
    }
    const versionRoot = join(engineRoot, engineVersion);
    if (!existsSync(versionRoot)) continue;
    const buildNames = new Set(
      builds.filter((spec) => spec.engine === engine).map((spec) => spec.build),
    );
    for (const entry of readdirSync(versionRoot, { withFileTypes: true })) {
      if (entry.name !== 'nets' && !buildNames.has(entry.name)) {
        rmSync(join(versionRoot, entry.name), { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  const check = spawnSync(make, ['--version'], { cwd: root, env, stdio: 'ignore' });
  if (check.status !== 0) throw new Error('make is unavailable; install GNU Make or use tools/w64devkit');
  const compiler = spawnSync(emxx, ['--version'], { cwd: root, env, stdio: 'ignore' });
  if (compiler.status !== 0) throw new Error('Emscripten em++ is unavailable; install emsdk or use tools/emsdk');

  pruneStaleLayout();
  const prepared = {};
  for (const [engine, spec] of Object.entries(sources)) {
    const source = await ensureSource(engine, spec);
    prepareSource(engine, source, spec);
    prepared[engine] = source;
  }
  for (const network of networks) await ensureNetwork(network);

  copyFileSync(
    join(networkRoot, 'pikafish.nnue'),
    join(prepared.pikafish, 'src', 'pikafish.nnue'),
  );

  if (fetchOnly || checkOnly) {
    console.log('engine inputs ready');
    return;
  }

  const engineLock = {
    stockfish: { builds: {}, networks: [] },
    pikafish: { builds: {}, networks: [] },
  };
  for (const spec of builds) {
    engineLock[spec.engine].builds[spec.build] = build(spec, prepared[spec.engine]);
  }

  for (const network of networks) {
    const target = join(publicRoot, network.engine, version[network.engine], 'nets', network.file);
    copy(join(networkRoot, network.file), target);
    engineLock[network.engine].networks.push({
      option: 'EvalFile',
      file: network.file,
      url: `/engines/${network.engine}/${version[network.engine]}/nets/${network.file}`,
      bytes: network.bytes,
      sha256: network.sha256,
      license: network.license,
    });
  }

  const lock = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    toolchain: {
      emsdkCommit: 'd7b4130688bfa348392b921ab04015aa15c4f154',
      emscriptenVersion: '6.0.13',
      emscriptenCommit: 'e13ee988ce3d87a738dd8f3661d02223308c412a',
      make: 'GNU Make 4.4.1 (w64devkit)',
      sevenZip: '7zip-bin 5.2.0',
    },
    engines: {
      stockfish: {
        source: 'https://github.com/official-stockfish/Stockfish',
        commit: sources.stockfish.commit,
        version: version.stockfish,
        license: 'GPL-3.0-or-later',
        patch: sources.stockfish.bridge,
        builds: engineLock.stockfish.builds,
        networks: engineLock.stockfish.networks,
      },
      pikafish: {
        source: 'https://github.com/official-pikafish/Pikafish',
        commit: sources.pikafish.commit,
        version: version.pikafish,
        license: 'GPL-3.0',
        patch: sources.pikafish.bridge,
        builds: engineLock.pikafish.builds,
        networks: engineLock.pikafish.networks,
      },
    },
  };

  const lockPath = join(publicRoot, 'engines.lock.json');
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`wrote ${lockPath}`);
}

await main();
