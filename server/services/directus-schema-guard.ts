/**
 * Directus schema guard — AI-132.
 *
 * Validates field names on write operations against a schema snapshot.
 * Snapshot is imported as a TypeScript module so esbuild bundles it
 * into dist/server/index.js — no runtime file reads needed.
 *
 * Two modes:
 * - Test/dev: unknown field throws with details (collection, field, allowed list).
 * - Production: unknown field is logged as an error event; the data passes through
 *   unchanged. Stripping is deliberately NOT done — a stale snapshot would then
 *   cause silent data loss, which is the very failure this guard exists to expose.
 */
import { log } from '../utils/logger';
import { DIRECTUS_SCHEMA, CollectionSchema } from '../data/directus-schema';

export type { CollectionSchema };

type SchemaMap = Map<string, Set<string>>;

let schemaCache: SchemaMap | null = null;

/**
 * Build schema map from imported module. Called once; result cached for process lifetime.
 */
function loadSchema(): SchemaMap {
  if (schemaCache) return schemaCache;

  schemaCache = new Map();
  for (const col of DIRECTUS_SCHEMA) {
    schemaCache.set(col.collection, new Set(col.fields));
  }
  return schemaCache;
}

/**
 * Get known field names for a collection. Returns undefined if collection unknown.
 */
export function getKnownFields(collection: string): Set<string> | undefined {
  return loadSchema().get(collection);
}

/**
 * Get all known collection names.
 */
export function getKnownCollections(): Set<string> {
  return new Set(loadSchema().keys());
}

/**
 * Check if a collection exists in the schema.
 */
export function isKnownCollection(collection: string): boolean {
  return loadSchema().has(collection);
}

export interface ValidationResult {
  valid: boolean;
  unknownFields: string[];
  unknownCollection: boolean;
  knownFields: string[];
}

/**
 * Validate data keys against schema for a collection.
 * Returns validation result — caller decides how to handle violations.
 */
export function validateWriteData(
  collection: string,
  data: Record<string, unknown>
): ValidationResult {
  const schema = loadSchema();
  const fields = schema.get(collection);

  if (!fields) {
    return {
      valid: false,
      unknownFields: Object.keys(data),
      unknownCollection: true,
      knownFields: [],
    };
  }

  const unknownFields = Object.keys(data).filter((k) => !fields.has(k));
  return {
    valid: unknownFields.length === 0,
    unknownFields,
    unknownCollection: false,
    knownFields: [...fields],
  };
}

/**
 * Guard write data: validate, react according to environment.
 *
 * Returns the data unchanged. In production an unknown field produces a log entry
 * only; in test/dev it throws with details.
 */
export function guardWriteData(
  collection: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = validateWriteData(collection, data);
  if (result.valid) return data;

  if (result.unknownCollection) {
    const msg = `Directus schema guard: unknown collection '${collection}'`;
    if (process.env.NODE_ENV === 'production') {
      log.error(`[schema-guard] ${msg}. Fields attempted: ${Object.keys(data).join(', ')}`);
      return data; // don't block in prod
    }
    throw new Error(`${msg}. Known collections: ${[...loadSchema().keys()].slice(0, 20).join(', ')}...`);
  }

  const msg = `Directus schema guard: unknown field(s) in '${collection}': ${result.unknownFields.join(', ')}. Known: ${result.knownFields.join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    log.error(`[schema-guard] ${msg}`);
    // Pass data through unchanged — Directus will drop unknown fields as always,
    // but now we have a log entry. Do NOT strip fields: a stale snapshot
    // would cause silent data loss, defeating the purpose of this guard.
    return data;
  }
  throw new Error(msg);
}
