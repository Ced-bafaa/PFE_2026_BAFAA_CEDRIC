import { Injectable } from '@nestjs/common';
import { JsonStore } from '../storage/json-store';
import { ensureFileExists } from '../storage/ensure-file';
import type {
  SubmissionTrackingItem,
  TrackingLine,
  TrackingMap,
} from './tracking.types';

const defaultLine = (): TrackingLine => ({ phase: 'depose', notes: [''] });

const defaultTracking: SubmissionTrackingItem = {
  lines: [defaultLine()],
  updatedAt: '',
};

@Injectable()
export class TrackingService {
  private readonly store = new JsonStore<TrackingMap>({
    fileName: 'submission-tracking.json',
    defaultValue: {},
  });

  private async ensureSeeded(): Promise<void> {
    await ensureFileExists(this.store.getPath(), JSON.stringify({}, null, 2));
  }

  async list(): Promise<TrackingMap> {
    await this.ensureSeeded();
    return await this.store.read();
  }

  async get(id: string): Promise<SubmissionTrackingItem> {
    await this.ensureSeeded();
    const map = await this.store.read();
    return map[id] ?? defaultTracking;
  }

  async update(
    id: string,
    patch: { lines?: TrackingLine[] },
  ): Promise<SubmissionTrackingItem> {
    await this.ensureSeeded();
    const map = await this.store.read();
    const current = map[id] ?? defaultTracking;
    const nextLines =
      patch.lines !== undefined
        ? patch.lines.length > 0
          ? patch.lines
          : [defaultLine()]
        : current.lines;

    const next: SubmissionTrackingItem = {
      lines: nextLines,
      updatedAt: new Date().toISOString(),
    };
    map[id] = next;
    await this.store.write(map);
    return next;
  }
}
