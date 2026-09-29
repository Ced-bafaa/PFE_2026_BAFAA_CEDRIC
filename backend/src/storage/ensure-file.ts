import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export async function ensureFileExists(
  filePath: string,
  contents: string,
): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf-8');
  }
}
