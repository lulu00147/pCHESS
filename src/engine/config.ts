export interface AutoConfig {
  readonly threads: number;
  readonly hashMb: number;
}

export interface AutoConfigEnvironment {
  readonly isolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  readonly mobile: boolean;
}

const HASH_PRESETS = [16, 32, 64, 128, 256] as const;

export function autoConfig(environment: AutoConfigEnvironment): AutoConfig {
  const hc = environment.hardwareConcurrency ?? 2;
  const memGb = environment.deviceMemory ?? 4;
  let threads = 1;
  if (environment.isolated && environment.sharedArrayBuffer) {
    threads = Math.max(1, Math.min(4, hc - 1, Math.floor(memGb / 2)));
    if (environment.mobile) threads = Math.min(threads, 2);
  }
  const cap = environment.mobile ? 64 : threads * 32;
  const hashMb = [...HASH_PRESETS].reverse().find((value) => value <= cap) ?? 16;
  return { threads, hashMb };
}

export function lowerHashMb(hashMb: number): number {
  return [...HASH_PRESETS].reverse().find((value) => value < hashMb) ?? HASH_PRESETS[0];
}
