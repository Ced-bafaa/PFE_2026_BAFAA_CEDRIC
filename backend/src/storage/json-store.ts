import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export class JsonStore<T> {
  private readonly filePath: string;
  private readonly defaultValue: T;

  constructor(opts: { fileName: string; defaultValue: T; dataDir?: string }) {
    const dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
    this.filePath = path.join(dataDir, opts.fileName);
    this.defaultValue = opts.defaultValue;
  }

  getPath(): string {
    return this.filePath;
  }

  async read(): Promise<T> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return this.defaultValue;
    }
  }

  async write(value: T): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const raw = JSON.stringify(value, null, 2);
    await fs.writeFile(this.filePath, raw, 'utf-8');
  }
}
