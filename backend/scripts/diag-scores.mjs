import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const c = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [[{ n: total }]] = await c.query('SELECT COUNT(*) as n FROM opportunities');
const [[{ n: scored }]] = await c.query(
  "SELECT COUNT(*) as n FROM opportunities WHERE JSON_EXTRACT(enrichment, '$.decision.scoredAt') IS NOT NULL",
);
const [[{ n: withPdf }]] = await c.query(
  "SELECT COUNT(*) as n FROM opportunities WHERE internal_file_id IS NOT NULL AND internal_file_id <> ''",
);

const rp =
  process.env.AO_EXTRACTOR_RESULTATS_PATH ||
  resolve(process.cwd(), '../ao_extractor/output/resultats.json');
const byFile = new Map();
if (existsSync(rp)) {
  for (const e of JSON.parse(readFileSync(rp, 'utf-8'))) {
    const n = String(e.nom_fichier ?? '').toLowerCase();
    if (n) byFile.set(n, e);
  }
}

const [rows] = await c.query(
  'SELECT id, internal_file_id, title FROM opportunities',
);

let canScore = 0;
let noExtract = 0;
let noPdf = 0;
for (const r of rows) {
  const hasDecision = false; // simplified
  const keys = [];
  if (r.internal_file_id) keys.push(`${r.internal_file_id}.pdf`.toLowerCase());
  keys.push(`${r.id}.pdf`.toLowerCase());
  const hit = keys.some((k) => byFile.has(k));
  if (hit) canScore++;
  else if (r.internal_file_id) noExtract++;
  else noPdf++;
}

console.log({
  total,
  scored,
  withPdf,
  extractorFiles: byFile.size,
  unscored: total - scored,
  unscoredWithExtractionReady: canScore,
  unscoredPdfButNotExtracted: noExtract,
  unscoredNoPdf: noPdf,
});

await c.end();
