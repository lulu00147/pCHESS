import type { EngineConfig } from './client';
import type { BuildId, NetworkSpec, Variant } from './protocol';

export interface ManifestArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ManifestBuild {
  readonly baseUrl: string;
  readonly command: string;
  readonly artifacts: readonly ManifestArtifact[];
}

export interface ManifestNetwork {
  readonly option: string;
  readonly file: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly license: string;
}

export interface ManifestEngine {
  readonly source: string;
  readonly commit: string;
  readonly version: string;
  readonly license: string;
  readonly patch: string | null;
  readonly builds: Readonly<Record<BuildId, ManifestBuild>>;
  readonly networks: readonly ManifestNetwork[];
}

export type EngineName = 'stockfish' | 'pikafish';

export interface EngineManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly toolchain: Readonly<Record<string, string>>;
  readonly engines: Readonly<Record<EngineName, ManifestEngine>>;
}

export async function loadEngineManifest(
  fetchImpl: typeof fetch = fetch,
  url = '/engines/engines.lock.json',
): Promise<EngineManifest> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
  const data = (await response.json()) as EngineManifest;
  if (data.schemaVersion !== 1 || !data.engines?.stockfish || !data.engines?.pikafish) {
    throw new Error('unsupported engine manifest');
  }
  return data;
}

export function engineConfigFromManifest(
  manifest: EngineManifest,
  variant: Variant,
  buildId: BuildId,
  options?: { readonly threads?: number; readonly hashMb?: number },
): EngineConfig {
  const engineName: EngineName = variant === 'chess' ? 'stockfish' : 'pikafish';
  const engine = manifest.engines[engineName];
  const build = engine?.builds[buildId];
  if (!engine || !build) throw new Error(`engine build missing: ${variant}/${buildId}`);

  const js = build.artifacts.find((artifact) => artifact.path.endsWith('.js'));
  const wasm = build.artifacts.find((artifact) => artifact.path.endsWith('.wasm'));
  if (!js || !wasm) throw new Error(`engine artifacts missing: ${variant}/${buildId}`);

  const networks: NetworkSpec[] = engine.networks.map((network) => ({
    option: network.option,
    url: network.url,
    bytes: network.bytes,
    sha256: network.sha256,
  }));

  return {
    engine: variant,
    build: buildId,
    glueUrl: `${build.baseUrl}${js.path}`,
    wasmUrl: `${build.baseUrl}${wasm.path}`,
    artifactBase: build.baseUrl,
    networks,
    options: {
      threads: buildId === 'single-simd' ? 1 : Math.max(1, Math.min(4, options?.threads ?? 1)),
      hashMb: Math.max(16, Math.min(256, options?.hashMb ?? 16)),
      multiPv: 1,
    },
  };
}
