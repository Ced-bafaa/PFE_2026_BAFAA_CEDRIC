import { Injectable, Logger } from '@nestjs/common';
import { chromium, type Page } from 'playwright';
import { load } from 'cheerio';
import type { ArmpTender } from '../armp/armp-tender.types';
import { buildArmpPdfDownloadHeaders } from '../armp/armp-pdf-download-headers';
import {
  bufferContainsPdfVersionMarker,
  extractPdfRelatedUrls,
  fetchPdfBufferFollowingHtml,
  isPlaywrightPdfFetchAllowed,
  isPlaywrightPdfPrimary,
  type PdfFetchOptions,
} from './pdf-fetch.util';
import type { ITenderScraper, ScrapeOptions } from './scraper.strategy';

type ExtractedRow = {
  title: string;
  /** Référence métier (ex. F_PROMAC_119291) — clé d’unicité Bénin. */
  reference?: string;
  detailUrl?: string;
  downloadLink?: string;
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

function absUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function looksLikeTender(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("appel d'offres") ||
    t.includes("appel d’offre") ||
    t.includes('tender') ||
    t.includes('rfp') ||
    t.includes('consultation') ||
    t.includes('marché') ||
    t.includes('marche') ||
    t.includes('avis') ||
    t.includes('soumission')
  );
}

/** Libellés type portail Bénin (cartes listes). */
function parseBeninOfferLabels(text: string): Partial<ExtractedRow> {
  const out: Partial<ExtractedRow> = {};
  const t = normText(text);

  const authM = t.match(
    /AUTORIT[EÉ]\s+CONTRACTANTE\s*[:\s]*([^\n\r]+?)(?=(?:\s{2,}|Réf|Ref\.?|Montant|Lieu|Prix|Date|Cl[ôo]ture)|$)/i,
  );
  if (authM?.[1]) out.authority = normText(authM[1]);

  const refM = t.match(
    /(?:Réf(?:érence)?|Ref)\s*[.:]?\s*([A-Z0-9][A-Z0-9_\-]{2,})/i,
  );
  if (refM?.[1]) out.reference = refM[1].trim();

  const lieuM = t.match(/Lieu\s+d['']?acquisition\s*[:\s]*([^\n\r]+)/i);
  if (lieuM?.[1]) {
    const raw = normText(lieuM[1]);
    const city = raw.replace(/\s*[,;]\s*B[eé]nin.*$/i, '').trim();
    out.region = city
      ? `${city} — Bénin`
      : 'Bénin';
  }

  const pubM = t.match(
    /(?:Publi[ée](?:\s+le)?|Mise\s+en\s+ligne)\s*[:\s]*([0-9./\-]{6,}[^\n\r]*)/i,
  );
  if (pubM?.[1]) out.publishedOn = normText(pubM[1]);

  const closM = t.match(
    /(?:Cl[ôo]ture|Date\s+limite)\s*[:\s]*([0-9./\-]{6,}[^\n\r]*)/i,
  );
  if (closM?.[1]) {
    const parts = normText(closM[1]).split(/\s+[—\-–]\s*/);
    if (parts[0]) out.closingDate = parts[0];
    if (parts[1]) out.closingTime = parts[1];
  }

  return out;
}

function cleanTitleLite(raw: string): string {
  return normText(raw)
    .replace(/\b(voir le d[ée]tail|voir\s+d[ée]tails?|d[ée]tails?)\b/gi, '')
    .trim();
}

function isTenderLikeHrefOrText(href: string, linkText: string): boolean {
  const h = href.toLowerCase();
  const t = linkText.toLowerCase();
  return (
    /avis|appel|offre|march|public|consult|tender|dossier|cotation|publication|opportunit|ao[-/]|benin|\.bj\//i.test(
      `${h} ${t}`,
    ) || t.length >= 24
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

/** Moissonnage de liens (même logique que Generic) — indispensable si les cartes n’ont pas la classe `.card`. */
function harvestTenderAnchorsFromHtml(
  $: ReturnType<typeof load>,
  pageUrl: string,
  pageTitle: string,
): ExtractedRow[] {
  const seenAbs = new Set<string>();
  const collected: ExtractedRow[] = [];
  const pushLink = (hrefRaw: string, linkText: string, contextText: string) => {
    const href = hrefRaw.trim();
    if (!href || href.startsWith('#')) return;
    if (isBoilerplateOrSocialHref(href)) return;
    const abs = absUrl(pageUrl, href);
    const lower = abs.toLowerCase();
    if (seenAbs.has(lower)) return;
    const t = cleanTitleLite(normText(linkText));
    if (!isTenderLikeHrefOrText(abs, t) && t.length < 14) return;
    if (t.length < 4 && !/avis|appel|offre|publication|consultation/i.test(abs))
      return;
    seenAbs.add(lower);
    const blockText = contextText || linkText;
    collected.push({
      title: t || pageTitle,
      detailUrl: abs,
      ...parseKeyValueText(blockText),
      ...parseBeninOfferLabels(blockText),
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
    '[class*="item"] a[href]',
    '[class*="grid"] a[href]',
  ].join(', ');

  $(primarySelectors).each((_i, el) => {
    const $a = $(el);
    const ctx = normText($a.closest('article, li, tr, section, div').first().text());
    pushLink($a.attr('href') || '', $a.text(), ctx);
  });

  if (collected.length < 16) {
    $('a[href]').each((_i, el) => {
      const $a = $(el);
      if (
        $a.closest(
          'header, footer, nav, [role="navigation"], .nav, .menu, .breadcrumb',
        ).length
      )
        return;
      const ctx = normText($a.closest('article, li, tr, td, div').first().text());
      pushLink($a.attr('href') || '', $a.text(), ctx);
    });
  }

  return collected;
}

function extractBeninOfferCards(
  $: ReturnType<typeof load>,
  pageUrl: string,
): ExtractedRow[] {
  const selectors = [
    '.card',
    '[class*="card-item"]',
    '[class*="offer-card"]',
    '[class*="tender-card"]',
    '[class*="MuiPaper"]',
    '[class*="MuiCard"]',
    '[class*="shadow-lg"]',
    '[class*="border-rounded"]',
    'article.card',
    'article[class*="Card"]',
    'div[class*="Card"]',
    'main [class*="grid"] > div',
    'main [class*="Grid"] > div',
    '[role="listitem"]',
    '[data-testid*="card"]',
    '[data-testid*="offer"]',
  ];
  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();

  for (const sel of selectors) {
    $(sel).each((_idx, el) => {
      const $c = $(el);
      const fullText = normText($c.text());
      if (fullText.length < 25) return;

      let title = normText($c.find('strong').first().text());
      if (!title || title.length < 12) {
        title = normText(
          $c.find('h1, h2, h3, h4, [class*="title"], b').first().text(),
        );
      }
      if (!title || title.length < 8) return;

      const link = $c
        .find('a[href]')
        .filter((_i, a) => {
          const h = ($(a).attr('href') || '').trim().toLowerCase();
          return (
            h.length > 1 &&
            !h.startsWith('#') &&
            !h.startsWith('javascript:') &&
            !/\.pdf(\?|$)/i.test(h)
          );
        })
        .first();
      const href = (link.attr('href') || '').trim();
      const detailUrl = href ? absUrl(pageUrl, href) : undefined;

      const parsed = parseBeninOfferLabels(fullText);
      const refKey = (parsed.reference || detailUrl || title).toLowerCase();
      if (seen.has(refKey)) return;
      seen.add(refKey);

      const pdfLink = $c
        .find('a[href]')
        .toArray()
        .map((x) => absUrl(pageUrl, ($(x).attr('href') || '').trim()))
        .find((u) => /\.pdf(\b|$)/i.test(u));

      rows.push({
        title,
        detailUrl,
        downloadLink: pdfLink,
        ...parseKeyValueText(fullText),
        ...parsed,
      });
    });
  }

  return rows;
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

  const closing = tryExtractAfter(/\b(cl[oô]ture|closing)\s*[:\-–]\s*(.+)$/i);
  if (closing) {
    const parts = closing
      .split(/[—\-–]\s*/)
      .map((x) => normText(x))
      .filter(Boolean);
    if (parts[0]) out.closingDate = parts[0];
    if (parts[1]) out.closingTime = parts[1];
  }

  return out;
}

function pickTitleFromDom($: ReturnType<typeof load>): string {
  const h1 = normText($('h1').first().text());
  if (h1) return h1;
  return normText($('title').first().text()) || 'Marchés publics';
}

/**
 * Fusionne cartes + tableaux + listes + moissonnage de liens (ne s’arrête plus à la première carte trouvée).
 */
function extractTenderLikeRowsFromHtml(html: string, pageUrl: string): ExtractedRow[] {
  const $ = load(html);
  const pageTitle = pickTitleFromDom($);
  const merged: ExtractedRow[] = [];

  merged.push(...extractBeninOfferCards($, pageUrl));

  // Tables
  const rows: ExtractedRow[] = [];
  $('table')
    .toArray()
    .slice(0, 30)
    .forEach((table) => {
      const $table = $(table);
      $table
        .find('tr')
        .toArray()
        .slice(0, 800)
        .forEach((tr) => {
          const $tr = $(tr);
          const text = normText($tr.text());
          const links = $tr.find('a[href]').toArray();
          if (!text || links.length === 0) return;
          if (text.length < 12) return;
          if (!looksLikeTender(text) && links.length < 2) return;

          const titleLinkText = normText($(links[0]).text()) || '';
          const firstHref = ($(links[0]).attr('href') || '').trim();
          const firstLink = firstHref ? absUrl(pageUrl, firstHref) : '';

          const pdfLink = links
            .map((a) => absUrl(pageUrl, ($(a).attr('href') || '').trim()))
            .find((h) => /\.pdf(\b|$)/i.test(h) || h.toLowerCase().includes('download'));

          rows.push({
            title: titleLinkText || text.slice(0, 120),
            detailUrl: firstLink || undefined,
            downloadLink: pdfLink || undefined,
            ...parseKeyValueText(text),
          });
        });
    });

  // Lists
  $('ul')
    .toArray()
    .slice(0, 60)
    .forEach((ul) => {
      const $ul = $(ul);
      $ul
        .find('li')
        .toArray()
        .slice(0, 800)
        .forEach((li) => {
          const $li = $(li);
          const text = normText($li.text());
          const a = $li.find('a[href]').first();
          const href = (a.attr('href') || '').trim();
          const linkText = normText(a.text());
          if (!href || !linkText) return;
          if (linkText.length < 8) return;
          if (!looksLikeTender(text) && !looksLikeTender(linkText) && text.length < 30) return;

          const abs = absUrl(pageUrl, href);
          const pdf = $li
            .find('a[href]')
            .toArray()
            .map((x) => absUrl(pageUrl, ($(x).attr('href') || '').trim()))
            .find((h) => /\.pdf(\b|$)/i.test(h) || h.toLowerCase().includes('download'));

          rows.push({
            title: linkText,
            detailUrl: abs,
            downloadLink: pdf || undefined,
            ...parseKeyValueText(text),
          });
        });
    });

  // Card-like fallback via headers
  if (rows.length === 0) {
    $('h2, h3')
      .toArray()
      .slice(0, 250)
      .forEach((h) => {
        const title = normText($(h).text());
        if (!title) return;
        const parent = $(h).closest('section, article, div');
        const link = parent.find('a[href]').first();
        const href = (link.attr('href') || '').trim();
        if (!href) return;
        const text = normText(parent.text());
        if (!looksLikeTender(title) && !looksLikeTender(text)) return;
        rows.push({
          title,
          detailUrl: absUrl(pageUrl, href),
          ...parseKeyValueText(text),
        });
      });
  }

  merged.push(...rows);
  merged.push(...harvestTenderAnchorsFromHtml($, pageUrl, pageTitle));

  const dedup = new Map<string, ExtractedRow>();
  for (const r of merged) {
    const urlKey = (r.detailUrl ?? '').toLowerCase().trim();
    const ref = (r.reference ?? '').toLowerCase().trim();
    const key =
      ref ||
      urlKey ||
      `${(r.title ?? '').toLowerCase()}|${(r.authority ?? '').toLowerCase()}`;
    if (!key || key === '|') continue;
    const prev = dedup.get(key);
    if (!prev || (r.authority ?? '').length > (prev.authority ?? '').length) {
      dedup.set(key, r);
    }
  }
  return Array.from(dedup.values()).slice(0, 800);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type DynamicDetection = {
  isLikelyDynamic: boolean;
  /** Un sélecteur CSS répété qui grossit quand on charge plus d’éléments. */
  repeatedSelector: string;
  initialCount: number;
};

const DEFAULT_REPEAT_SELECTORS = [
  // Cartes
  '.card',
  '[class*="card"]',
  '[data-testid*="card"]',
  '[data-testid*="item"]',
  // Articles / listes
  'article',
  '[role="listitem"]',
  'li',
  // Tables
  'table tr',
  // Fallback : liens “liste”
  'main a[href]',
];

async function detectDynamicContent(
  page: Page,
  url: string,
  logger: Logger,
): Promise<DynamicDetection> {
  const result = await page.evaluate((candidates) => {
    const safeCount = (sel: string) => {
      try {
        const n = document.querySelectorAll(sel).length;
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    };
    const scored = candidates
      .map((sel) => ({ sel, n: safeCount(sel) }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n);
    const best = scored[0] ?? { sel: 'article', n: 0 };
    const isLikelyDynamic = scored.some((x) => x.n >= 6) || best.n >= 10;
    return { isLikelyDynamic, repeatedSelector: best.sel, initialCount: best.n };
  }, DEFAULT_REPEAT_SELECTORS);

  if (result.isLikelyDynamic) {
    logger.log(
      `Site détecté comme Dynamique. Utilisation du moteur Playwright... (selector "${result.repeatedSelector}", initial=${result.initialCount}) — ${url}`,
    );
  } else {
    logger.debug(
      `Site plutôt statique (selector "${result.repeatedSelector}", initial=${result.initialCount}) — ${url}`,
    );
  }
  return result;
}

async function waitForRepeatedContent(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  const safe = selector && selector.trim() ? selector : 'article';
  // Attendre que le DOM “se stabilise” : au moins 2 éléments et stable pendant ~800ms.
  await page
    .waitForFunction(
      (sel) => {
        try {
          const countNow = document.querySelectorAll(sel).length;
          // @ts-expect-error - store on window for lightweight stability tracking
          const prev = window.__kiama_prevCount ?? 0;
          // @ts-expect-error
          const prevAt = window.__kiama_prevAt ?? Date.now();
          // @ts-expect-error
          window.__kiama_prevCount = countNow;
          // @ts-expect-error
          if (countNow !== prev) window.__kiama_prevAt = Date.now();
          // @ts-expect-error
          const stableForMs = Date.now() - (window.__kiama_prevAt ?? Date.now());
          return countNow >= 2 && stableForMs >= 800;
        } catch {
          return false;
        }
      },
      safe,
      { timeout: timeoutMs },
    )
    .catch(() => {
      /* best effort */
    });
}

async function clickLoadMoreIfPresent(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a')) as Array<
      HTMLElement
    >;
    const isVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const labels = [
      'plus',
      'voir plus',
      'afficher plus',
      'charger plus',
      'load more',
      'more',
      'suivant',
      'next',
    ];
    for (const el of buttons) {
      if (!isVisible(el)) continue;
      const text = (el.textContent ?? '').trim().toLowerCase();
      if (!text) continue;
      if (!labels.some((x) => text.includes(x))) continue;
      try {
        el.click();
        return true;
      } catch {
        /* */
      }
    }
    return false;
  });
  return Boolean(clicked);
}

async function autoScrollUntilStagnant(
  page: Page,
  selector: string,
  logger: Logger,
  opts?: { maxSeconds?: number; stagnationRounds?: number },
): Promise<{ finalCount: number; rounds: number }> {
  const maxSeconds = opts?.maxSeconds ?? 25;
  const stagnationRounds = opts?.stagnationRounds ?? 3;
  const safe = selector && selector.trim() ? selector : 'article';

  const start = Date.now();
  let rounds = 0;
  let lastCount = await page.evaluate((sel) => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return 0;
    }
  }, safe);
  let stagnant = 0;

  while (Date.now() - start < maxSeconds * 1000) {
    rounds += 1;
    // 1) essayer un “load more” si présent
    const didClick = await clickLoadMoreIfPresent(page).catch(() => false);
    // 2) puis scroll (pour infinite scroll)
    try {
      await page.evaluate(() =>
        window.scrollBy({
          top: Math.max(650, window.innerHeight * 0.9),
          left: 0,
          behavior: 'instant',
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fréquent quand une navigation/rerender détruit le contexte JS pendant l'auto-scroll.
      if (msg.toLowerCase().includes('execution context destroyed')) {
        logger.debug(`Auto-scroll interrompu (context destroyed) — on ignore et on continue`);
      } else {
        throw err;
      }
    }
    await sleep(didClick ? 1400 : 900);

    const nextCount = await page.evaluate((sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }, safe);

    if (rounds <= 3 || rounds % 6 === 0) {
      logger.log(
        `Auto-scroll adaptatif (${safe}) — round ${rounds}: ${lastCount} → ${nextCount}${didClick ? ' (load-more)' : ''}`,
      );
    }

    if (nextCount <= lastCount) stagnant += 1;
    else stagnant = 0;

    lastCount = nextCount;
    if (stagnant >= stagnationRounds) break;
  }

  return { finalCount: lastCount, rounds };
}

// NOTE: domain allowlist / manual forcing will be added later.

@Injectable()
export class PlaywrightScraperService implements ITenderScraper {
  private readonly logger = new Logger(PlaywrightScraperService.name);

  canHandle(url: string): boolean {
    // Disabled by default; will be enabled later (manual trigger / domain allowlist).
    // Keeping the parameter to avoid breaking the interface.
    void url;
    return false;
  }

  /**
   * Lance un contexte Chromium avec des arguments et scripts d'initialisation qui masquent
   * les empreintes classiques des navigateurs automatisés (navigator.webdriver, plugins vides,
   * dimensions nulles…). Pas de dépendance externe — tout est fait via les API Playwright natives.
   */
  private async launchStealthBrowser() {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Masque le flag navigator.webdriver au niveau du processus Chrome.
        '--disable-blink-features=AutomationControlled',
        // Évite certaines heuristiques de détection basées sur les indicateurs GPU / rendu.
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--start-maximized',
        // Simule un profil utilisateur avec historique / préférences.
        '--disable-extensions',
      ],
    });

    const ua = process.env.ARMP_USER_AGENT?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      timezoneId: 'Africa/Douala',
      // Simule un écran à densité de pixels normale.
      deviceScaleFactor: 1,
      // Permissions nécessaires pour un comportement navigateur réaliste.
      permissions: [],
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.5',
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Script d'initialisation injecté AVANT tout chargement de page :
    // masque les propriétés détectables par les systèmes anti-bot JavaScript.
    await context.addInitScript(() => {
      // Supprime navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Simule des plugins Chrome réalistes
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Simule des langues réalistes
      Object.defineProperty(navigator, 'languages', {
        get: () => ['fr-FR', 'fr', 'en-US', 'en'],
      });

      // Empêche la détection via chrome.runtime manquant
      // @ts-expect-error: propriété non typée dans le contexte browser
      if (!window.chrome) {
        // @ts-expect-error
        window.chrome = { runtime: {} };
      }

      // Masque le flag headless dans Notification.permission
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: 'denied' } as PermissionStatus)
            : originalQuery(parameters);
      }
    });

    return { browser, context };
  }

  async scrape(url: string, _options?: ScrapeOptions): Promise<ArmpTender[]> {
    let browser:
      | Awaited<ReturnType<typeof chromium.launch>>
      | undefined;

    try {
      const launched = await this.launchStealthBrowser();
      browser = launched.browser;
      const page = await launched.context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {
        /* certains SPAs gardent des connexions ouvertes */
      });
      await page.waitForSelector('body', { timeout: 15_000 });

      await sleep(1200);

      const detection = await detectDynamicContent(page, url, this.logger);
      await waitForRepeatedContent(page, detection.repeatedSelector, 20_000);

      if (detection.isLikelyDynamic) {
        // Fix demandé: s'assurer que le rendu a fini son activité réseau avant auto-scroll.
        await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {
          /* best effort */
        });
        const res = await autoScrollUntilStagnant(
          page,
          detection.repeatedSelector,
          this.logger,
          { maxSeconds: 28, stagnationRounds: 3 },
        );
        this.logger.log(
          `Auto-scroll terminé (${detection.repeatedSelector}) : ${res.finalCount} élément(s), rounds=${res.rounds}`,
        );
        await waitForRepeatedContent(page, detection.repeatedSelector, 10_000);
      }

      const html = await page.content();
      const rows = extractTenderLikeRowsFromHtml(html, url);

      this.logger.log(
        `Capture Playwright terminée : ${rows.length} élément(s) trouvé(s)`,
      );

      return rows.map((r) => ({
        id: '_',
        typePublication: '',
        idPublication: (r.reference ?? '').trim(),
        title: r.title,
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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `PlaywrightScraperService.scrape failed for ${url}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    } finally {
      // VERY IMPORTANT: always close to avoid leaks.
      try {
        await browser?.close();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Par défaut : navigateur d’abord (`ARMP_PDF_PLAYWRIGHT_FIRST=true`) pour obtenir un buffer
   * avec signature `%PDF-` (évite les pages HTML enregistrées en `.pdf`), puis Axios si besoin.
   */
  async fetchPdfBufferPreferringBrowser(
    targetUrl: string,
    opts: PdfFetchOptions = {},
  ): Promise<Buffer> {
    const url = String(targetUrl ?? '').trim();
    if (!url) throw new Error('URL PDF vide');

    const allowBrowser = isPlaywrightPdfFetchAllowed();
    const browserFirst = isPlaywrightPdfPrimary();

    if (allowBrowser && browserFirst) {
      const fromBrowser = await this.fetchPdfBufferViaBrowser(url);
      if (fromBrowser && bufferContainsPdfVersionMarker(fromBrowser)) {
        this.logger.log(`PDF obtenu via navigateur (priorité) : ${url}`);
        return fromBrowser;
      }
    }

    try {
      return await fetchPdfBufferFollowingHtml(url, opts);
    } catch (err) {
      if (!allowBrowser || browserFirst) {
        throw err;
      }
      const fromBrowser = await this.fetchPdfBufferViaBrowser(url);
      if (fromBrowser && bufferContainsPdfVersionMarker(fromBrowser)) {
        this.logger.log(`PDF obtenu via navigateur (secours) : ${url}`);
        return fromBrowser;
      }
      throw err;
    }
  }

  /**
   * Télécharge le buffer PDF réel lorsque l’URL renvoie du HTML (viewer, JS, session cookie).
   * Secours après `fetchPdfBufferFollowingHtml` (Axios) : même détection des liens / iframes.
   */
  async fetchPdfBufferViaBrowser(targetUrl: string): Promise<Buffer | null> {
    const u = String(targetUrl ?? '').trim();
    if (!u || !/^https?:\/\//i.test(u)) return null;

    const headers = buildArmpPdfDownloadHeaders();

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      // Utilise le même lancement stealth pour éviter la détection lors du téléchargement PDF.
      const launched = await this.launchStealthBrowser();
      browser = launched.browser;
      const context = launched.context;

      // Ajoute les en-têtes spécifiques PDF (Referer ARMP) par-dessus les en-têtes stealth.
      await context.setExtraHTTPHeaders({
        Referer: headers['Referer']!,
        Accept: headers['Accept']!,
      });

      const page = await context.newPage();

      const tryBody = (body: Buffer): boolean =>
        bufferContainsPdfVersionMarker(body);

      const gotoAndRead = async (href: string): Promise<Buffer | null> => {
        const res = await page.goto(href, {
          timeout: 90_000,
          waitUntil: 'domcontentloaded',
        });
        if (!res) return null;
        const body = Buffer.from(await res.body());
        if (tryBody(body)) return body;
        const html = body.toString('utf8');
        const nextUrls = extractPdfRelatedUrls(html, href);
        for (const next of nextUrls.slice(0, 8)) {
          const r2 = await page.goto(next, {
            timeout: 60_000,
            waitUntil: 'domcontentloaded',
          });
          if (!r2) continue;
          const b2 = Buffer.from(await r2.body());
          if (tryBody(b2)) return b2;
        }
        return null;
      };

      const first = await gotoAndRead(u);
      if (first) return first;

      const frameSrc = await page
        .locator('iframe[src]')
        .first()
        .getAttribute('src', { timeout: 5_000 })
        .catch(() => null);
      if (frameSrc) {
        const abs = absUrl(page.url(), frameSrc);
        const r3 = await page.goto(abs, {
          timeout: 60_000,
          waitUntil: 'domcontentloaded',
        });
        if (r3) {
          const b3 = Buffer.from(await r3.body());
          if (tryBody(b3)) return b3;
        }
      }

      this.logger.debug(`Playwright: aucun PDF valide pour ${u}`);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // N1 — « Download is starting » : l'URL est un téléchargement direct ; le
      // secours HTTP (fetchPdfBufferFollowingHtml) le récupère. Attendu, donc
      // niveau debug et non warn (supprime le bruit de log par PDF).
      if (/download is starting/i.test(msg)) {
        this.logger.debug(
          `fetchPdfBufferViaBrowser: téléchargement direct (${u}) — bascule secours HTTP`,
        );
      } else {
        this.logger.warn(`fetchPdfBufferViaBrowser échoué (${u}): ${msg}`);
      }
      return null;
    } finally {
      try {
        await browser?.close();
      } catch {
        /* ignore */
      }
    }
  }
}

