import type { ArmpTender } from '../armp/armp-tender.types';

/** Déduplication brute avant mapping (réf. métier > URL > titre). */
export function dedupeArmpTendersByRefAndUrl(rows: ArmpTender[]): ArmpTender[] {
  const m = new Map<string, ArmpTender>();
  for (const t of rows) {
    const ref = (t.idPublication ?? '').trim().toLowerCase();
    const u = (t.detailUrl ?? '').trim().toLowerCase();
    const key =
      ref.length >= 4
        ? `ref:${ref}`
        : u.length > 8
          ? `url:${u}`
          : `tit:${(t.title ?? '').toLowerCase().slice(0, 96)}`;
    const existing = m.get(key);
    if (!existing) {
      m.set(key, t);
      continue;
    }
    const prefer =
      ((t.authority ?? '').length > (existing.authority ?? '').length
        ? t
        : existing) ?? t;
    m.set(key, prefer);
  }
  return [...m.values()];
}

export function isBeninPublicHost(url: string): boolean {
  try {
    return new URL(url)
      .hostname.replace(/^www\./i, '')
      .toLowerCase()
      .endsWith('.bj');
  } catch {
    return false;
  }
}
