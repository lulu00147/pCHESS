export interface EngineFS {
  open(path: string, flags: string): number;
  write(
    stream: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number;
  close(stream: number): void;
  unlink?(path: string): void;
}

export interface InstallProgress {
  readonly written: number;
  readonly total: number;
}

export async function installNetworkFile(
  fs: EngineFS,
  response: Response,
  path: string,
  expectedBytes: number,
  onProgress?: (progress: InstallProgress) => void,
): Promise<number> {
  if (!response.body) throw new Error('network response has no body');
  const reader = response.body.getReader();
  const stream = fs.open(path, 'w');
  let written = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const count = fs.write(stream, value, 0, value.byteLength, written);
      if (count !== value.byteLength) throw new Error('short write to engine FS');
      written += count;
      onProgress?.({ written, total: expectedBytes });
    }
  } catch (error) {
    fs.close(stream);
    fs.unlink?.(path);
    throw error;
  }

  fs.close(stream);
  if (written !== expectedBytes) {
    fs.unlink?.(path);
    throw new Error(`short network install: ${written} != ${expectedBytes}`);
  }
  return written;
}
