import { Injectable, NotFoundException } from '@nestjs/common';
import { JsonStore } from '../storage/json-store';
import { ensureFileExists } from '../storage/ensure-file';
import type { TrashItem } from './trash.types';
import { MoveToTrashDto } from './dto/move-to-trash.dto';

const RETENTION_DAYS = 30;

function purgeExpired(items: TrashItem[]): TrashItem[] {
  const now = Date.now();
  return items.filter((item) => new Date(item.expiresAt).getTime() > now);
}

@Injectable()
export class TrashService {
  private readonly store = new JsonStore<TrashItem[]>({
    fileName: 'trash.json',
    defaultValue: [],
  });

  private async ensureSeeded(): Promise<void> {
    await ensureFileExists(this.store.getPath(), JSON.stringify([], null, 2));
  }

  async list(): Promise<TrashItem[]> {
    await this.ensureSeeded();
    const cleaned = purgeExpired(await this.store.read()).sort(
      (a, b) =>
        new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
    );
    await this.store.write(cleaned);
    return cleaned;
  }

  async move(input: MoveToTrashDto): Promise<TrashItem> {
    const list = await this.list();
    const deletedAt = new Date();
    const expiresAt = new Date(deletedAt);
    expiresAt.setDate(expiresAt.getDate() + RETENTION_DAYS);
    const next: TrashItem = {
      // Id/dates client respectés si fournis (synchronisation front write-through)
      id: input.id?.trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deletedAt: input.deletedAt || deletedAt.toISOString(),
      expiresAt: input.expiresAt || expiresAt.toISOString(),
      type: input.type,
      label: input.label,
      description: input.description,
      payload: input.payload,
    };
    await this.store.write([next, ...list]);
    return next;
  }

  async restore(id: string): Promise<TrashItem> {
    const list = await this.list();
    const target = list.find((x) => x.id === id);
    if (!target) throw new NotFoundException('Trash item not found');
    await this.store.write(list.filter((x) => x.id !== id));
    return target;
  }

  async deletePermanently(id: string): Promise<{ id: string; deleted: true }> {
    const list = await this.list();
    await this.store.write(list.filter((x) => x.id !== id));
    return { id, deleted: true };
  }
}
