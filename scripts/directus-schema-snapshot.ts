#!/usr/bin/env npx tsx
/**
 * Fetch Directus field schema and save as JSON snapshot.
 *
 * Usage:
 *   npx tsx scripts/directus-schema-snapshot.ts
 *
 * Requires DIRECTUS_URL and DIRECTUS_STATIC_TOKEN environment variables.
 * Output: server/data/directus-schema.json
 */
import axios from 'axios';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface DirectusField {
  collection: string;
  field: string;
  // other fields ignored
}

async function main() {
  const url = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_STATIC_TOKEN;
  if (!url || !token) {
    console.error('DIRECTUS_URL and DIRECTUS_STATIC_TOKEN required');
    process.exit(2);
  }

  const resp = await axios.get(`${url}/fields`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { limit: -1 },
  });

  const fields: DirectusField[] = resp.data.data;
  // Group by collection
  const grouped = new Map<string, string[]>();
  for (const f of fields) {
    const arr = grouped.get(f.collection) || [];
    arr.push(f.field);
    grouped.set(f.collection, arr);
  }

  const snapshot = [...grouped.entries()].map(([collection, fieldNames]) => ({
    collection,
    fields: fieldNames.sort(),
  }));

  // Sort by collection name for stable output
  snapshot.sort((a, b) => a.collection.localeCompare(b.collection));

  const outDir = join(__dirname, '..', 'server', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'directus-schema.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Schema snapshot saved: ${outPath} (${snapshot.length} collections)`);
}

main().catch((err) => {
  console.error('Failed to fetch schema:', err.message);
  process.exit(1);
});
