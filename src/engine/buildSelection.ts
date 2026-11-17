import type { BuildId } from './protocol';

export function selectBuild(isolated: boolean, hasSharedArrayBuffer: boolean): BuildId {
  return isolated && hasSharedArrayBuffer ? 'threads-simd' : 'single-simd';
}
