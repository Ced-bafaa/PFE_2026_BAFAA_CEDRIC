import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import type { ArmpTender } from '../armp/armp-tender.types';
import type { ITenderScraper, ScrapeOptions } from './scraper.strategy';

type ExtractedRow = {
  title: string;
  detailUrl?: string;
  downloadLink?: string;
  reference?: string;
  authority?: string;
  type?: string;
  region?: string;
  amount?: string;
  publishedOn?: string;
  closingDate?: string;
  closingTime?: string;
};

function normText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function looksLikeTender(text: string): boolean {
  const t = text.toLowerCase();
  // Heuristiques simples (fr/en) pour détecter des appels d'offres.
  return (
    t.includes("appel d'offres") ||
    t.includes("appel d’offre") ||
    t.includes('ao ') ||
    t.includes('ao-') ||
    t.includes('tender') ||
    t.includes('rfp') ||
    t.includes('consultation') ||
    t.includes('marché') ||
    t.includes('marche') ||
    t.includes('avis') ||
    t.includes('objet') ||
    t.includes('date') ||
    t.includes('soumission')
  );
}

function pickTitleFromDom($: ReturnType<typeof load>): string {
  const h1 = normText($('h1').first().text());
  if (h1) return h1;
  const h2 = normText($('h2').first().text());
  if (h2) return h2;
  const titleTag = normText($('title').first().text());
  return titleTag || "Liste des appels d'offres";
}

function absUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function parseKeyValueText(text: string): Partial<ExtractedRow> {
  const out: Partial<ExtractedRow> = {};
  const t = normText(text);

  const tryExtractAfter = (re: RegExp) => {
    const m = t.match(re);
    return m?.[1] ? normText(m[1]) : '';
  };

  const region = tryExtractAfter(/\b(r[ée]gion)\s*[:\-–]\s*(.+)$/i);
  if (region) out.region = region;

  const amount = tryExtractAfter(/\b(montant|budget|amount)\s*[:\-–]\s*(.+)$/i);
  if (amount) out.amount = amount;

  const authority = tryExtractAfter(/\b(mo\/ac|autorit[ée]|authority)\s*[:\-–]\s*(.+)$/i);
  if (authority) out.authority = authority;

  const type = tryExtractAfter(/\b(type)\s*[:\-–]\s*(.+)$/i);
  if (type) out.type = type;

  const publishedOn = tryExtractAfter(/\b(publi[ée]\sle|published)\s*[:\-–]\s*(.+)$/i);
  if (publishedOn) out.publishedOn = publishedOn;

  const reference = tryExtractAfter(
    /\b(r[ée]f[ée]rence|reference|n[°o]\s*ref|ref)\s*[:\-–]\s*(.+)$/i,
  );
  if (reference) out.reference = reference;

  const closing = tryExtractAfter(/\b(cl[oô]ture|closing)\s*[:\-–]\s*(.+)$/i);
  if (closing) {
    // Support "14-04-2026 — 12:00:00"
    const parts = closing
      .split(/[—\-–]\s*/)
      .map((x) => normText(x))
      .filter(Boolean);
    if (parts[0]) out.closingDate = parts[0];
    if (parts[1]) out.closingTime = parts[1];
  }

  return out;
}

function cleanTitle(raw: string): string {
  return normText(raw)
    .replace(/\b(voir le d[ée]tail|voir\s+d[ée]tails?|d[ée]tails?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasTenderKeywords(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('objet') ||
    t.includes('référence') ||
    t.includes('reference') ||
    t.includes('clôture') ||
    t.includes('cloture') ||
    t.includes('date') ||
    t.includes("appel d'offres") ||
    t.includes('avis')
  );
}

/** Accepte une ligne / bloc répété si le texte ou le lien ressemble à une offre (listes complètes type Bénin). */
function rowLooksLikeOffer(text: string, linkTexts: string[]): boolean {
  if (looksLikeTender(text) || hasTenderKeywords(text)) return true;
  const primary = linkTexts[0] ?? '';
  if (primary.length >= 15) return true;
  if (linkTexts.some((x) => x.length >= 12)) return true;
  return text.length >= 18 && linkTexts.length > 0;
}

function classSignature(el: Element): string {
  const cls = (el.attribs?.class ?? '').trim();
  if (!cls) return '';
  // Normalize class order a bit (space-separated).
  return cls
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .sort()
    .join('.');
}

function nodeStructureSignature($: ReturnType<typeof load>, el: Element): string {
  const $el = $(el);
  const tag = (($el.get(0) as any)?.tagName ?? '').toLowerCase();
  const cls = classSignature(el);
  const childTags = $el
    .children()
    .toArray()
    .slice(0, 6)
    .map((c) => ((c as any)?.tagName ?? '').toLowerCase())
    .filter(Boolean)
    .join(',');
  const hasLink = $el.find('a[href]').length > 0 ? 'a' : '';
  const hasHeader = $el.find('h1,h2,h3,strong').length > 0 ? 'h' : '';
  return [tag, cls, hasLink, hasHeader, childTags].filter(Boolean).join('|');
}

function guessTitleFromClusterText(text: string): string {
  const t = normText(text);
  if (!t) return '';
  const parts = t
    .split(/\s{2,}|\n|\r|•|·|\t/g)
    .map((x) => normText(x))
    .filter((x) => x.length >= 10);
  parts.sort((a, b) => b.length - a.length);
  return (parts[0] ?? '').slice(0, 180);
}

/** Lien ou libellé typique d’une fiche d’avis / AO (sites type listes nationales). */
function isTenderLikeHrefOrText(href: string, linkText: string): boolean {
  const h = href.toLowerCase();
  const t = linkText.toLowerCase();
  return (
    /avis|appel|offre|march|public|consult|tender|dossier|cotation|publication|opportunit|ao[-/]|benin|bj\//i.test(
      `${h} ${t}`,
    ) || t.length >= 28
  );
}

function isBoilerplateOrSocialHref(href: string): boolean {
  const h = href.toLowerCase();
  return (
    /facebook|twitter|linkedin|whatsapp|instagram|youtube|mailto:|tel:|javascript:|#$/i.test(
      h,
    ) || h === '#' || h === ''
  );
}

/**
 * Collecte large de liens vers fiches (listes plates, CMS sans tableaux) — ex. marchés Bénin.
 * Appelé en complément des autres motifs, pas seulement si rien n’a été trouvé.
 */
function harvestAnchorCandidates(
  $: ReturnType<typeof load>,
  baseUrl: string,
  pageTitle: string,
): ExtractedRow[] {
  const seenAbs = new Set<string>();
  const collected: ExtractedRow[] = [];

  const pushLink = (hrefRaw: string, linkText: string, contextText: string) => {
    const href = hrefRaw.trim();
    if (!href || href.startsWith('#')) return;
    if (isBoilerplateOrSocialHref(href)) return;
    const abs = absUrl(baseUrl, href);
    const lower = abs.toLowerCase();
    if (seenAbs.has(lower)) return;
    const t = cleanTitle(normText(linkText));
    if (!isTenderLikeHrefOrText(abs, t)) {
      if (t.length < 12) return;
    }
    if (t.length < 4 && !/avis|appel|offre|publication|consultation/i.test(abs)) return;
    seenAbs.add(lower);
    collected.push({
      title: t || pageTitle,
      detailUrl: abs,
      ...parseKeyValueText(contextText || linkText),
    });
  };

  const primarySelectors = [
    'main a[href]',
    '[role="main"] a[href]',
    '#content a[href]',
    '#main a[href]',
    'article a[href]',
    '[class*="result"] a[href]',
    '[class*="listing"] a[href]',
    '[class*="offre"] a[href]',
    '[class*="avis"] a[href]',
    '[class*="tender"] a[href]',
    '[class*="card"] a[href]',
    '[class*="post"] a[href]',
    '[class*="entry"] a[href]',
    '[class*="item"] a[href]',
  ].join(', ');

  $(primarySelectors).each((_i, el) => {
    const $a = $(el);
    const ctx = normText($a.closest('article, li, tr, section, div').first().text());
    pushLink($a.attr('href') || '', $a.text(), ctx);
  });

  if (collected.length < 12) {
    $('a[href]').each((_i, el) => {
      const $a = $(el);
      if ($a.closest('header, footer, nav, [role="navigation"], .nav, .menu, .breadcrumb').length)
        return;
      const ctx = normText($a.closest('article, li, tr, td, div').first().text());
      pushLink($a.attr('href') || '', $a.text(), ctx);
    });
  }

  return collected;
}

@Injectable()
export class GenericScraperService implements ITenderScraper {
  private readonly logger = new Logger(GenericScraperService.name);

  canHandle(_url: string): boolean {
    // This strategy is only used as a default fallback via the factory.
    return false;
  }

  async scrape(url: string, _options?: ScrapeOptions): Promise<ArmpTender[]> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let html = '';
      try {
        // En-têtes complets imitant un vrai navigateur Chrome — évite la détection par fingerprint HTTP.
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            DNT: '1',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
          },
        });
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const waitS = retryAfter ? parseInt(retryAfter, 10) : 60;
          this.logger.warn(
            `GenericScraper: 429 Rate-Limit sur ${url} — attente ${waitS}s (non retenté)`,
          );
          throw new Error(`HTTP 429 Too Many Requests (Retry-After: ${waitS}s)`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } finally {
        clearTimeout(timer);
      }

      const $ = load(html);
      const pageTitle = pickTitleFromDom($);
      const baseUrl = url;

      const rows: ExtractedRow[] = [];

      // Pattern discovery 1) Tables -> chaque <tr> avec lien(s) plausible(s) = une offre.
      $('table')
        .toArray()
        .slice(0, 200)
        .forEach((table) => {
          const $table = $(table);
          $table
            .find('tr')
            .toArray()
            .slice(0, 5000)
            .forEach((tr) => {
              const $tr = $(tr);
              const text = normText($tr.text());
              const links = $tr.find('a[href]').toArray();
              if (!text || text.length < 8 || links.length === 0) return;
              const linkTexts = links.map((n) => normText($(n).text()));
              if (!rowLooksLikeOffer(text, linkTexts)) return;

              const pdfLink = links
                .map((a) => absUrl(baseUrl, $(a).attr('href') || ''))
                .find((h) => /\.pdf(\b|$)/i.test(h) || h.toLowerCase().includes('download'));

              // Plusieurs liens par ligne (fiche + PDF, ou plusieurs avis) → une entrée par lien pertinent.
              const substantive = links.filter((n) => {
                const h = ($(n).attr('href') || '').trim();
                if (!h) return false;
                const abs = absUrl(baseUrl, h);
                if (/\.pdf(\?|$)/i.test(abs)) return false;
                const lt = cleanTitle(normText($(n).text()));
                return (
                  isTenderLikeHrefOrText(abs, lt) ||
                  lt.length >= 10 ||
                  rowLooksLikeOffer(text, [lt])
                );
              });

              const toEmit =
                substantive.length > 0 ? substantive : links.slice(0, 1);

              for (const n of toEmit) {
                const href = ($(n).attr('href') || '').trim();
                if (!href) continue;
                const abs = absUrl(baseUrl, href);
                const titleLinkText =
                  cleanTitle(normText($(n).text()) || '') || cleanTitle(text);
                rows.push({
                  title: titleLinkText || pageTitle,
                  detailUrl: abs,
                  downloadLink: pdfLink || undefined,
                  ...parseKeyValueText(text),
                });
              }
            });
        });

      // Pattern discovery 2) Lists -> chaque <li> avec lien = une offre potentielle.
      $('ul')
        .toArray()
        .slice(0, 300)
        .forEach((ul) => {
          const $ul = $(ul);
          $ul
            .find('li')
            .toArray()
            .slice(0, 4000)
            .forEach((li) => {
              const $li = $(li);
              const text = normText($li.text());
              const anchors = $li.find('a[href]').toArray();
              if (anchors.length === 0) return;
              const linkTexts = anchors.map((n) => cleanTitle(normText($(n).text())));
              if (!rowLooksLikeOffer(text, linkTexts)) return;

              const pdf = anchors
                .map((x) => absUrl(baseUrl, ($(x).attr('href') || '').trim()))
                .find((h) => /\.pdf(\b|$)/i.test(h) || h.toLowerCase().includes('download'));

              const emitAnchors = anchors.filter((n) => {
                const h = ($(n).attr('href') || '').trim();
                if (!h) return false;
                const abs = absUrl(baseUrl, h);
                if (/\.pdf(\?|$)/i.test(abs)) return false;
                const lt = cleanTitle(normText($(n).text()));
                return (
                  isTenderLikeHrefOrText(abs, lt) ||
                  lt.length >= 10 ||
                  rowLooksLikeOffer(text, [lt])
                );
              });

              const list = emitAnchors.length > 0 ? emitAnchors : anchors.slice(0, 1);

              for (const a of list) {
                const href = ($(a).attr('href') || '').trim();
                if (!href) continue;
                const linkText = cleanTitle(normText($(a).text()));
                rows.push({
                  title: linkText || cleanTitle(text) || pageTitle,
                  detailUrl: absUrl(baseUrl, href),
                  downloadLink: pdf || undefined,
                  ...parseKeyValueText(text),
                });
              }
            });
        });

      // Pattern discovery 3) Blocs répétés : <div> ou <article> avec la même signature de classes.
      const groupBySignature = (nodes: Element[]) => {
        const groups = new Map<string, Element[]>();
        for (const el of nodes) {
          const sig = nodeStructureSignature($, el);
          if (!sig) continue;
          const arr = groups.get(sig) ?? [];
          arr.push(el);
          groups.set(sig, arr);
        }
        return groups;
      };

      const divGroups = groupBySignature($('div').toArray().slice(0, 12_000));
      const articleGroups = groupBySignature($('article').toArray().slice(0, 4000));

      const mergeGroups = new Map<string, Element[]>();
      for (const m of [divGroups, articleGroups]) {
        for (const [sig, arr] of m) {
          const prev = mergeGroups.get(sig) ?? [];
          mergeGroups.set(sig, prev.concat(arr));
        }
      }

      const repeating = Array.from(mergeGroups.entries())
        .filter(([, arr]) => arr.length >= 2 && arr.length <= 2000)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 24);

      if (repeating.length > 0) {
        this.logger.log(
          `X opportunités extraites du cluster de patterns détecté. (clusters=${repeating.length}, top=${repeating[0]?.[1].length ?? 0}) — ${url}`,
        );
      }

      for (const [sig, arr] of repeating) {
        if (arr.length >= 8) {
          this.logger.debug(`Cluster détecté: "${sig}" (${arr.length} éléments)`);
        }
        for (const node of arr.slice(0, 2500)) {
          const $node = $(node);
          const link = $node.find('a[href]').first();
          const href = (link.attr('href') || '').trim();
          if (!href) continue;
          const linkText = cleanTitle(normText(link.text()));
          const headerTitle = cleanTitle(normText($node.find('h1,h2,h3,strong').first().text()));
          const text = normText($node.text());
          const title = linkText || headerTitle || guessTitleFromClusterText(text);
          if (!title || title.length < 6) continue;
          if (
            !rowLooksLikeOffer(text, [linkText, headerTitle].filter(Boolean))
          ) {
            continue;
          }
          rows.push({
            title,
            detailUrl: absUrl(baseUrl, href),
            ...parseKeyValueText(text),
          });
        }
      }

      // Fallback selectors by keywords if no tables found.
      const hasTable = $('table').length > 0;
      if (!hasTable && rows.length === 0) {
        const keywordNodes = $('*:contains("Objet"), *:contains("Référence"), *:contains("Clôture"), *:contains("Cloture")')
          .toArray()
          .slice(0, 2000);
        for (const node of keywordNodes) {
          const $n = $(node);
          const container = $n.closest('tr, li, article, section, div');
          const text = normText(container.text());
          const link = container.find('a[href]').first();
          const href = (link.attr('href') || '').trim();
          if (!href) continue;
          if (!hasTenderKeywords(text) && !looksLikeTender(text)) continue;
          const title = cleanTitle(normText(container.find('h1,h2,h3,strong,a').first().text())) || pageTitle;
          rows.push({
            title,
            detailUrl: absUrl(baseUrl, href),
            ...parseKeyValueText(text),
          });
        }
      }

      // Complément : collecte large de liens (listes sans tableau, ex. Bénin) — toujours fusionné.
      for (const h of harvestAnchorCandidates($, baseUrl, pageTitle)) {
        rows.push(h);
      }

      // Fallback ultime si toujours peu de résultats : liens « avis » / « appel » dans toute la page.
      if (rows.length < 8) {
        $('a[href]').each((_i, el) => {
          const $a = $(el);
          const href = ($a.attr('href') || '').trim();
          if (!href || href.startsWith('#')) return;
          const lowerHref = href.toLowerCase();
          if (lowerHref.startsWith('javascript:') || lowerHref.startsWith('mailto:')) return;
          const linkText = normText($a.text());
          const hay = `${linkText} ${href}`.toLowerCase();
          if (!hay.includes('avis') && !hay.includes('appel')) return;
          rows.push({
            title: cleanTitle(linkText) || pageTitle,
            detailUrl: absUrl(baseUrl, href),
            ...parseKeyValueText(linkText),
          });
        });
      }

      const elements = rows;
      console.log(
        "Nombre d'éléments potentiels trouvés sur la page:",
        elements.length,
      );

      const dedup = new Map<string, ExtractedRow>();
      for (const r of rows) {
        const urlKey = (r.detailUrl ?? '').toLowerCase().trim();
        const key =
          urlKey ||
          `${(r.title ?? '').toLowerCase()}|${(r.reference ?? '').toLowerCase()}`.trim();
        if (!key || key === '|') continue;
        if (!dedup.has(key)) dedup.set(key, r);
      }

      const normalized = Array.from(dedup.values()).slice(0, 500);
      if (normalized.length === 0) {
        this.logger.warn(`GenericScraper: no tender-like rows detected for ${url}`);
      }

      return normalized.map((r) => ({
        id: '_',
        typePublication: '',
        idPublication: (r.reference ?? '').trim(),
        title: cleanTitle(r.title || pageTitle),
        authority: r.authority ?? '',
        type: r.type ?? '',
        region: r.region ?? '',
        amount: r.amount ?? '',
        publishedOn: r.publishedOn ?? '',
        closingDate: r.closingDate ?? '',
        closingTime: r.closingTime ?? '',
        detailUrl: r.detailUrl ?? '',
        downloadLink: r.downloadLink ?? '',
        source: '',
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `GenericScraperService.scrape failed for ${url}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }
}

