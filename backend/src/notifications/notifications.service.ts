import { Injectable } from '@nestjs/common';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { JsonStore } from '../storage/json-store';
import type { AppNotification } from './notifications.types';

@Injectable()
export class NotificationsService {
  private readonly stateStore = new JsonStore<{
    readIds: number[];
    deletedIds: number[];
  }>({
    fileName: 'notifications-state.json',
    defaultValue: { readIds: [], deletedIds: [] },
  });

  constructor(private readonly opportunities: OpportunitiesService) {}

  async list(): Promise<AppNotification[]> {
    const [state, opps] = await Promise.all([
      this.stateStore.read(),
      // Same filtering logic as the UI list (strict keywords / active sources).
      this.opportunities.list(),
    ]);

    const read = new Set<number>((state?.readIds ?? []).filter((x) => typeof x === 'number'));
    const deleted = new Set<number>(
      (state?.deletedIds ?? []).filter((x) => typeof x === 'number'),
    );

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayMs = now.getTime();
    const msPerDay = 24 * 60 * 60 * 1000;

    const fnv1a32 = (input: string): number => {
      let h = 0x811c9dc5;
      for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h | 0;
    };

    const toStableId = (key: string): number => {
      const h = fnv1a32(key);
      return -Math.abs(h || 1); // negative: reserved for computed notifications
    };

    const parseIsoDateOnly = (v: string): Date | null => {
      const s = String(v ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const d = new Date(`${s}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const rules: Array<{
      daysBefore: number;
      type: AppNotification['type'];
      titlePrefix: string;
      message: (oppId: string, daysLeft: number, score?: number) => string;
    }> = [
      {
        daysBefore: 14,
        type: 'info',
        titlePrefix: 'Rappel (J-14)',
        message: (id, d, score) =>
          `Échéance dans ${d} jour(s) pour ${id}. Anticipez la préparation du dossier.${
            typeof score === 'number' ? ` Score: ${score}/100.` : ''
          }`,
      },
      {
        daysBefore: 7,
        type: 'info',
        titlePrefix: 'Rappel (J-7)',
        message: (id, d, score) =>
          `L'appel d'offres ${id} arrive à échéance dans ${d} jour(s).${
            typeof score === 'number' ? ` Score: ${score}/100.` : ''
          }`,
      },
      {
        daysBefore: 3,
        type: 'warning',
        titlePrefix: 'Échéance proche (J-3)',
        message: (id, d, score) =>
          `Plus que ${d} jour(s) avant clôture de ${id}.${
            typeof score === 'number' ? ` Score: ${score}/100.` : ''
          }`,
      },
      {
        daysBefore: 1,
        type: 'urgent',
        titlePrefix: 'Échéance imminente (J-1)',
        message: (id, d, score) =>
          `Dernier(s) ${d} jour(s) avant clôture de ${id}. Vérification du dossier recommandée.${
            typeof score === 'number' ? ` Score: ${score}/100.` : ''
          }`,
      },
      {
        daysBefore: 0,
        type: 'urgent',
        titlePrefix: "Clôture aujourd'hui",
        message: (id, _d, score) =>
          `Clôture aujourd'hui pour ${id}. Action immédiate recommandée.${
            typeof score === 'number' ? ` Score: ${score}/100.` : ''
          }`,
      },
    ];

    const computed: AppNotification[] = [];
    for (const opp of opps) {
      if (!opp?.id) continue;
      // Align with UI: submitted opportunities have their own tracking page and can spam alerts.
      if (String((opp as any)?.status ?? '').toLowerCase() === 'soumis') continue;

      const deadline = parseIsoDateOnly(String((opp as any)?.deadline ?? ''));
      if (!deadline) continue;
      const daysLeft = Math.round((deadline.getTime() - todayMs) / msPerDay);
      if (daysLeft < 0) continue;

      for (const rule of rules) {
        if (daysLeft !== rule.daysBefore) continue;
        const id = toStableId(`deadline:${opp.id}:${rule.daysBefore}`);
        if (deleted.has(id)) continue;
        computed.push({
          id,
          type: rule.type,
          title: `${rule.titlePrefix} : ${String((opp as any)?.title ?? opp.id)}`,
          message: rule.message(
            opp.id,
            daysLeft,
            typeof (opp as any)?.score === 'number' ? (opp as any).score : undefined,
          ),
          time: "Aujourd'hui",
          read: read.has(id),
          opportunityId: opp.id,
        });
      }
    }

    // Cleanup state: keep only ids that still exist in the computed set.
    const existingIds = new Set(computed.map((n) => n.id));
    const nextReadIds = Array.from(read).filter((id) => existingIds.has(id));
    const nextDeletedIds = Array.from(deleted).filter((id) => existingIds.has(id));
    const stateChanged =
      nextReadIds.length !== read.size || nextDeletedIds.length !== deleted.size;
    if (stateChanged) {
      await this.stateStore.write({ readIds: nextReadIds, deletedIds: nextDeletedIds });
    }

    // Most urgent first, then by daysBefore (implicit in id), then stable.
    const prio: Record<AppNotification['type'], number> = {
      urgent: 0,
      warning: 1,
      info: 2,
      success: 3,
    };
    return computed.sort((a, b) => {
      const pa = prio[a.type] ?? 99;
      const pb = prio[b.type] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.id - b.id;
    });
  }

  async markRead(id: number): Promise<{ id: number; read: true }> {
    const state = await this.stateStore.read();
    const readIds = new Set<number>((state?.readIds ?? []).filter((x) => typeof x === 'number'));
    readIds.add(id);
    await this.stateStore.write({
      readIds: Array.from(readIds),
      deletedIds: Array.isArray(state?.deletedIds) ? state.deletedIds : [],
    });
    return { id, read: true };
  }

  async markAllRead(): Promise<{ updated: number }> {
    const current = await this.list();
    const state = await this.stateStore.read();
    const deletedIds = Array.isArray(state?.deletedIds) ? state.deletedIds : [];
    const readIds = Array.from(new Set(current.map((n) => n.id)));
    await this.stateStore.write({ readIds, deletedIds });
    return { updated: current.length };
  }

  async deleteMany(ids: number[]): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    const targets = new Set(ids);
    const state = await this.stateStore.read();
    const deleted = new Set<number>(
      (state?.deletedIds ?? []).filter((x) => typeof x === 'number'),
    );
    for (const id of targets) deleted.add(id);
    const read = new Set<number>((state?.readIds ?? []).filter((x) => typeof x === 'number'));
    for (const id of targets) read.delete(id);
    await this.stateStore.write({ readIds: Array.from(read), deletedIds: Array.from(deleted) });
    return { deleted: targets.size };
  }
}
