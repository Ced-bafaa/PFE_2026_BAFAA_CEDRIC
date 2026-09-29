import { Injectable, NotFoundException } from '@nestjs/common';
import { JsonStore } from '../storage/json-store';
import { ensureFileExists } from '../storage/ensure-file';
import { partnersSeed, type Partner } from '../seed/mock-data';
import { UpsertPartnerDto } from './dto/upsert-partner.dto';

function buildNextPartnerId(items: Partner[]): string {
  const max = items.reduce((acc, item) => {
    const numeric = Number(item.id.replace('P-', ''));
    return Number.isFinite(numeric) ? Math.max(acc, numeric) : acc;
  }, 0);
  return `P-${String(max + 1).padStart(3, '0')}`;
}

@Injectable()
export class PartnersService {
  private readonly store = new JsonStore<Partner[]>({
    fileName: 'partners.json',
    defaultValue: partnersSeed,
  });

  private async ensureSeeded(): Promise<void> {
    await ensureFileExists(
      this.store.getPath(),
      JSON.stringify(partnersSeed, null, 2),
    );
  }

  async list(): Promise<Partner[]> {
    await this.ensureSeeded();
    return await this.store.read();
  }

  /** Construit un partenaire à partir du DTO profil (id + tous les champs profil). */
  private toPartner(dto: UpsertPartnerDto, id: string): Partner {
    const profile: Record<string, unknown> = { ...(dto as Record<string, unknown>) };
    delete profile.id;
    return {
      ...profile,
      id,
      country: ((dto.country || 'Cameroun') as string).trim() || 'Cameroun',
    } as Partner;
  }

  async create(dto: UpsertPartnerDto): Promise<Partner> {
    await this.ensureSeeded();
    const list = await this.store.read();
    const payload = this.toPartner(dto, dto.id?.trim() || buildNextPartnerId(list));
    await this.store.write([payload, ...list]);
    return payload;
  }

  async update(id: string, dto: UpsertPartnerDto): Promise<Partner> {
    await this.ensureSeeded();
    const list = await this.store.read();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new NotFoundException('Partner not found');
    const payload = this.toPartner(dto, id);
    const next = [...list];
    next[idx] = payload;
    await this.store.write(next);
    return payload;
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.ensureSeeded();
    const list = await this.store.read();
    if (!list.some((p) => p.id === id))
      throw new NotFoundException('Partner not found');
    await this.store.write(list.filter((p) => p.id !== id));
    return { id, deleted: true };
  }
}
