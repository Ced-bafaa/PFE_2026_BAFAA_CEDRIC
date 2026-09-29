/**
 * Script de diagnostic : teste le scraping ARMP et affiche la structure HTML réelle.
 * Lancer depuis C:\KIAMA\Divers\backend :
 *   node test-armp-scraper.mjs
 */

import * as https from 'node:https';
import * as http from 'node:http';

const URL_TO_TEST = 'https://www.armp.cm/filtres?type=avis&val=1';

const agent = new https.Agent({ rejectUnauthorized: false });

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        agent: parsed.protocol === 'https:' ? agent : undefined,
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          DNT: '1',
          Connection: 'keep-alive',
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, html: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout 30s')); });
    req.end();
  });
}

// Compte les occurrences d'une chaîne dans le HTML
function count(html, str) {
  return (html.match(new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

// Extrait un extrait autour du premier match
function excerpt(html, str, radius = 200) {
  const idx = html.indexOf(str);
  if (idx === -1) return '(introuvable)';
  return '...' + html.slice(Math.max(0, idx - radius), idx + str.length + radius) + '...';
}

console.log(`\n🔍 Diagnostic scraper ARMP`);
console.log(`URL : ${URL_TO_TEST}\n`);

try {
  console.log('Fetching...');
  const { status, html } = await fetchHtml(URL_TO_TEST);

  console.log(`✅ HTTP ${status} — ${html.length} caractères reçus\n`);

  // ─── Sélecteurs candidats ──────────────────────────────────────────────
  const selectors = [
    { label: 'id="tout_les_avis"',   find: 'id="tout_les_avis"' },
    { label: "id='tout_les_avis'",   find: "id='tout_les_avis'" },
    { label: 'tout_les_avis (any)',  find: 'tout_les_avis' },
    { label: 'd-table-row',          find: 'd-table-row' },
    { label: 'd-table-cell',         find: 'd-table-cell' },
    { label: '<ul ',                 find: '<ul ' },
    { label: '<ol ',                 find: '<ol ' },
    { label: 'id_publication',       find: 'id_publication' },
    { label: 'type_publication',     find: 'type_publication' },
    { label: '0903_publications_dl', find: '0903_publications_dl' },
    { label: '/details?',            find: '/details?' },
    { label: 'Publié le',            find: 'Publié le' },
    { label: 'Date de clôture',      find: 'Date de clôture' },
    { label: 'MO/AC',                find: 'MO/AC' },
    { label: '<li ',                 find: '<li ' },
    { label: '<li>',                 find: '<li>' },
  ];

  console.log('── Présence des sélecteurs clés ──────────────────────────────');
  for (const { label, find } of selectors) {
    const n = count(html, find);
    const icon = n > 0 ? '✅' : '❌';
    console.log(`  ${icon} "${label}" : ${n} occurrence(s)`);
  }

  // ─── Contexte autour du premier <ul ──────────────────────────────────
  console.log('\n── 1er <ul  (contexte ±300 chars) ───────────────────────────');
  console.log(excerpt(html, '<ul ', 300));

  // ─── Contexte autour du 1er id_publication ───────────────────────────
  console.log('\n── 1er id_publication (contexte ±400 chars) ─────────────────');
  console.log(excerpt(html, 'id_publication', 400));

  // ─── Liste des id="..." présents dans la page ──────────────────────────
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const uniqueIds = [...new Set(ids)];
  console.log(`\n── IDs HTML présents (${uniqueIds.length} uniques) ─────────────────────`);
  uniqueIds.slice(0, 40).forEach((id) => console.log(`  · ${id}`));
  if (uniqueIds.length > 40) console.log(`  ... et ${uniqueIds.length - 40} autres`);

} catch (err) {
  console.error('❌ Erreur :', err.message);
}
