export class UciLineBuffer {
  private buffer = '';
  private readonly maxLineBytes: number;

  constructor(maxLineBytes = 1024 * 1024) {
    this.maxLineBytes = maxLineBytes;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      lines.push(line);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLineBytes) {
      throw new Error('UCI line buffer exceeded limit');
    }
    return lines;
  }

  flush(): string[] {
    if (this.buffer.length === 0) return [];
    const line = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    return [line];
  }
}

export function encodeUciCommand(command: string): string {
  if (command.length === 0 || /[\r\n]/.test(command)) {
    throw new Error('UCI command must be a non-empty single line');
  }
  if (new TextEncoder().encode(command).length > 4096) {
    throw new Error('UCI command exceeds 4096 bytes');
  }
  return `${command}\n`;
}
