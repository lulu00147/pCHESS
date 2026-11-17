import type { EngineErrorCode } from './protocol';
import { Sha256 } from './sha256';

export const ASSET_CACHE_NAME = 'pchess-assets-v1';

export interface NetworkAssetSpec {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AssetProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface LoadNetworkOptions {
  readonly cache?: CacheLike | null;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AssetProgress) => void;
  readonly retryDelaysMs?: readonly number[];
}

export class AssetError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;

  constructor(code: EngineErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    this.retryable = retryable;
  }
}

const inFlight = new Map<string, Promise<Response>>();

export function assetCacheKey(url: string, sha256: string): string {
  const absolute = new URL(url, globalThis.location?.href ?? 'https://pchess.local/');
  absolute.searchParams.set('sha256', sha256);
  return absolute.href;
}

export async function openAssetCache(): Promise<CacheLike | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(ASSET_CACHE_NAME);
}

export function hasStorageHeadroom(usage: number, quota: number, bytes: number): boolean {
  if (!Number.isFinite(quota) || quota <= 0) return true;
  return quota - usage >= bytes * 1.2;
}

export async function assertStorageHeadroom(bytes: number): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  if (!hasStorageHeadroom(estimate.usage ?? 0, estimate.quota ?? 0, bytes)) {
    throw new AssetError('E_QUOTA', 'insufficient storage quota', true);
  }
}

export interface AssetCacheEntry {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly cachedAt: string | null;
}

export async function assetCacheEntries(): Promise<AssetCacheEntry[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(ASSET_CACHE_NAME);
  const keys = await cache.keys();
  const entries: AssetCacheEntry[] = [];
  for (const request of keys) {
    const response = await cache.match(request);
    if (!response) continue;
    const bytes = Number(response.headers.get('x-pchess-bytes'));
    const sha256 = response.headers.get('x-pchess-sha256') ?? '';
    const cachedAt = response.headers.get('x-pchess-cached-at');
    entries.push({
      key: request.url,
      bytes: Number.isFinite(bytes) ? bytes : (await response.clone().blob()).size,
      sha256,
      cachedAt,
    });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export async function deleteAssetCacheEntry(key: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(ASSET_CACHE_NAME);
  return cache.delete(key);
}

export async function assetCacheUsage(): Promise<number> {
  const entries = await assetCacheEntries();
  return entries.reduce((total, entry) => total + entry.bytes, 0);
}

export async function clearAssetCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  return caches.delete(ASSET_CACHE_NAME);
}

function header(response: Response, name: string): string | null {
  return response.headers.get(name);
}

async function readAndHash(
  response: Response,
  spec: NetworkAssetSpec,
  onProgress?: (progress: AssetProgress) => void,
  signal?: AbortSignal,
  collect = true,
): Promise<Blob | null> {
  if (!response.body) throw new AssetError('E_DOWNLOAD', 'response has no body', true);
  const reader = response.body.getReader();
  const hash = new Sha256();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new AssetError('E_DOWNLOAD', 'download aborted', true);
    }
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (collect) {
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy);
    }
    loaded += value.byteLength;
    onProgress?.({ loaded, total: spec.bytes });
  }

  if (loaded !== spec.bytes) {
    throw new AssetError(
      'E_HASH',
      `network byte count mismatch: ${loaded} != ${spec.bytes}`,
      false,
    );
  }
  const actual = hash.digest();
  if (actual !== spec.sha256.toLowerCase()) {
    throw new AssetError('E_HASH', 'network SHA256 mismatch', false);
  }
  return collect ? new Blob(chunks, { type: 'application/octet-stream' }) : null;
}

async function fetchOnce(
  spec: NetworkAssetSpec,
  cache: CacheLike | null,
  key: string,
  options: LoadNetworkOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(spec.url, {
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) {
    throw new AssetError('E_DOWNLOAD', `network fetch failed: HTTP ${response.status}`, true);
  }

  let blob: Blob;
  try {
    const verified = await readAndHash(response, spec, options.onProgress, options.signal);
    if (!verified) throw new AssetError('E_DOWNLOAD', 'verified body missing', true);
    blob = verified;
  } catch (error) {
    if (cache) await cache.delete(key).catch(() => undefined);
    throw error;
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', headers.get('content-type') ?? 'application/octet-stream');
  headers.set('x-pchess-sha256', spec.sha256.toLowerCase());
  headers.set('x-pchess-bytes', String(spec.bytes));
  const verifiedAt = new Date().toISOString();
  headers.set('x-pchess-verified-at', verifiedAt);
  headers.set('x-pchess-cached-at', verifiedAt);
  const asset = new Response(blob, { headers });

  if (cache) {
    try {
      await cache.put(key, asset.clone());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new AssetError('E_QUOTA', 'asset cache quota exceeded', true);
      }
      // Cache API unavailable or unable to store; the verified body is still usable.
    }
  }
  return asset;
}

async function loadWithRetry(
  spec: NetworkAssetSpec,
  cache: CacheLike | null,
  key: string,
  options: LoadNetworkOptions,
): Promise<Response> {
  const delays = options.retryDelaysMs ?? [1000, 2000, 4000];
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await fetchOnce(spec, cache, key, options);
    } catch (error) {
      last = error;
      if (!(error instanceof AssetError) || !error.retryable || attempt === delays.length) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw last instanceof Error ? last : new AssetError('E_DOWNLOAD', 'network fetch failed', true);
}

export async function loadNetwork(
  spec: NetworkAssetSpec,
  options: LoadNetworkOptions = {},
): Promise<Response> {
  const cache = options.cache === undefined ? await openAssetCache() : options.cache;
  const key = assetCacheKey(spec.url, spec.sha256);

  if (cache) {
    const cached = await cache.match(key);
    if (cached) {
      const bytes = header(cached, 'x-pchess-bytes');
      const sha = header(cached, 'x-pchess-sha256');
      if (
        bytes !== null &&
        Number(bytes) === spec.bytes &&
        sha !== null &&
        sha.toLowerCase() === spec.sha256.toLowerCase()
      ) {
        try {
          await readAndHash(cached.clone(), spec, undefined, undefined, false);
          return cached;
        } catch {
          await cache.delete(key).catch(() => undefined);
        }
      } else {
        await cache.delete(key).catch(() => undefined);
      }
    }
  }

  const existing = inFlight.get(key);
  if (existing) return existing.then((response) => response.clone());

  const promise = (async () => {
    await assertStorageHeadroom(spec.bytes);
    return loadWithRetry(spec, cache, key, options);
  })();
  inFlight.set(key, promise);
  return promise.finally(() => inFlight.delete(key)).then((response) => response.clone());
}
