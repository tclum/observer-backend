/**
 * Jest globalSetup — runs ONCE before all test suites.
 *
 * Connects to your real Airtable base and writes live field values to
 * tests/fixtures/airtable-data.json. Unit tests then import that file
 * instead of hardcoding fake data, so the tests always reflect the
 * actual configuration of your Airtable base.
 *
 * Requires: .env.test (copy .env.test.example and fill in your values).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // ── 1. Load environment variables from .env.test ──
  const envPath = resolve(process.cwd(), '.env.test');
  let envContent = '';
  try {
    envContent = readFileSync(envPath, 'utf-8');
    console.log('\n[globalSetup] Loaded .env.test');
  } catch {
    try {
      envContent = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
      console.log('\n[globalSetup] Loaded .env (fallback)');
    } catch {
      console.warn('\n[globalSetup] WARNING: No .env.test or .env found.');
      console.warn('[globalSetup] Airtable fixtures will not be refreshed.');
      console.warn('[globalSetup] Copy .env.test.example → .env.test and add your credentials.\n');
      return;
    }
  }

  // Parse key=value pairs (handles quoted values, ignores comments)
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
    if (!match) continue;
    const [, key, raw] = match;
    process.env[key] = raw.replace(/^["']|["']$/g, '').trim();
  }

  const { AIRTABLE_BASE_ID, AIRTABLE_TOKEN } = process.env;
  if (!AIRTABLE_BASE_ID || !AIRTABLE_TOKEN) {
    console.warn('[globalSetup] AIRTABLE_BASE_ID or AIRTABLE_TOKEN not set. Skipping fixture refresh.');
    return;
  }

  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
  const headers = {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };

  console.log('[globalSetup] Fetching fixtures from Airtable...');

  // ── 2. Fetch FieldConfig ──
  let fieldConfig = { Ages: [], Genders: [], Ethnicities: [], Disabilities: [], Emotions: [] };
  try {
    const r = await fetch(
      `${base}/${encodeURIComponent('FieldConfig')}?maxRecords=1`,
      { headers }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.records?.length) {
      const f = data.records[0].fields;
      const parse = (v) =>
        (v || '').split('\n').map((s) => s.trim()).filter(Boolean);
      fieldConfig = {
        Ages:        parse(f.Ages),
        Genders:     parse(f.Genders),
        Ethnicities: parse(f.Ethnicities),
        Disabilities:parse(f.Disabilities),
        Emotions:    parse(f.Emotions),
      };
      console.log('[globalSetup] FieldConfig loaded.');
    } else {
      console.warn('[globalSetup] FieldConfig table is empty — demographic field tests will skip value checks.');
    }
  } catch (err) {
    console.warn(`[globalSetup] Could not fetch FieldConfig: ${err.message}`);
  }

  // ── 3. Fetch active locations (names only, no PII) ──
  let activeLocations = [];
  try {
    const formula = encodeURIComponent('NOT({Active}=FALSE())');
    const fields  = 'fields[]=Name';
    const r = await fetch(`${base}/${encodeURIComponent('Locations')}?filterByFormula=${formula}&${fields}`, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    activeLocations = (data.records || []).map((rec) => rec.fields.Name).filter(Boolean);
    console.log(`[globalSetup] ${activeLocations.length} active location(s) loaded.`);
  } catch (err) {
    console.warn(`[globalSetup] Could not fetch Locations: ${err.message}`);
  }

  // ── 4. Fetch one sample active Observer username (no passwords fetched) ──
  let sampleActiveObserver = null;
  try {
    const formula = encodeURIComponent('AND({Status}="Active",{Role}="Observer")');
    const r = await fetch(
      `${base}/${encodeURIComponent('Users')}?filterByFormula=${formula}&maxRecords=1&fields[]=Username&fields[]=Role&fields[]=Status`,
      { headers }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.records?.length) {
      sampleActiveObserver = data.records[0].fields.Username;
      console.log(`[globalSetup] Sample active observer: ${sampleActiveObserver}`);
    }
  } catch (err) {
    console.warn(`[globalSetup] Could not fetch sample user: ${err.message}`);
  }

  // ── 5. Write fixture file ──
  const fixtures = {
    fieldConfig,
    activeLocations,
    sampleActiveObserver,
    fetchedAt: new Date().toISOString(),
  };

  const fixturesDir = resolve(__dirname, 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
  const outPath = resolve(fixturesDir, 'airtable-data.json');
  writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`[globalSetup] Fixtures written to tests/fixtures/airtable-data.json\n`);
}
