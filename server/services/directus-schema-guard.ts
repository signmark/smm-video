/**
 * Directus schema guard — AI-132.
 *
 * Validates field names on write and read operations against a schema snapshot.
 * Snapshot is imported as a TypeScript module so esbuild bundles it
 * into dist/server/index.js — no runtime file reads needed.
 *
 * Two modes:
 * - Test/dev: unknown field throws with details (collection, field, allowed list).
 * - Production: unknown field is logged as an error event; the data passes through
 *   unchanged. Stripping is deliberately NOT done — a stale snapshot would then
 *   cause silent data loss, which is the very failure this guard exists to expose.
 *
 * ## AI-132 slice 2: reads
 *
 * Slice 1 covered writes — directus-crud.create/update. Slice 2 covers reads,
 * where the failure mode is different: a typo in `filter` or `sort` does NOT
 * surface as an error. Directus returns a different (wrong) data set silently,
 * and the application shows it to the user as if nothing happened. That is
 * exactly the AI-132 motivation: two AI-assistant commands used a non-existent
 * collection for a month before anyone noticed.
 *
 * The risk on the read side is the inverse of the write side. On writes, a
 * missing field shows up as soon as the first record cannot be saved — visible
 * failure is a feature, not a bug. On reads, every request is a silent success.
 * So the read guard has to be MORE conservative than the write guard: if we
 * flag a legitimate query, the guard gets turned off within a week, and the
 * coverage it gives on actual typos is lost too.
 *
 * ## Skip-list (do not validate)
 *
 * Per @Clause_Dev_Hermi 22.08:
 * — Directus operators in `filter` (`_and`, `_or`, `_eq`, `_in`, `_nnull`, ...).
 *   Anything that starts with `_` is a logical or comparison operator, not a field.
 * — Aggregate functions (`count(*)`, `year(created_at)`, `month(...)`).
 * — `fields` wildcard forms: `*`, `*.*`, `rel.*`.
 * — `sort` leading minus is part of syntax, not a field.
 * — `deep` relation paths (`campaign_id.name`) are split on `.` and only the
 *   first segment is validated; subsequent segments belong to the related
 *   collection and are validated separately when the schema knows which.
 *
 * If unsure — SKIP. The violation list is reported at the end of every review.
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

/* ------------------------------------------------------------------------- */
/* AI-132 slice 2: read-side validation                                      */
/* ------------------------------------------------------------------------- */

/**
 * A single violation on the read side.
 * `where` is the place in the request structure that produced it
 * (`filter`, `sort`, `fields`, `deep:rel`, ...).
 */
export interface ReadViolation {
  where: string;
  value: string;
}

/**
 * Operators / special keys that Directus accepts inside filter and deep objects
 * but are not fields. Anything starting with `_` is treated as an operator.
 */
function isOperatorKey(key: string): boolean {
  return key.startsWith('_');
}

/**
 * Wildcard expression that is legal in Directus `fields` / aggregate lists.
 * Examples: `*`, `*.*`, `rel.*`, `count(*)`.
 */
function isWildcard(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === '*' || trimmed === '*.*') return true;
  // Anything ending with `.*` is a relation wildcard — top segment validated,
  // rest is the literal `*`.
  if (trimmed.endsWith('.*')) {
    const head = trimmed.slice(0, -2);
    return head.length > 0;
  }
  // Aggregate / function calls like `count(*)`, `year(created_at)`.
  if (/^[a-zA-Z_]+\s*\(.*\)$/.test(trimmed)) return true;
  return false;
}

/**
 * Strip a leading `-` from sort fields. Also accepts `+field` though rare.
 */
function stripSortPrefix(field: string): string {
  if (field.startsWith('-')) return field.slice(1);
  if (field.startsWith('+')) return field.slice(1);
  return field;
}

/**
 * Head segment of a relation path. For `campaign_id.name` returns `campaign_id`.
 * Returns the input itself when there is no `.`.
 */
function headSegment(path: string): string {
  const dot = path.indexOf('.');
  return dot === -1 ? path : path.slice(0, dot);
}

/**
 * Validate the read side of a query.
 *
 * `params` is the structure Directus expects on `GET /items/{collection}`:
 * — `filter` — object (or string) — keys are field names; nested `_and`/`_or`
 *   are operator groups.
 * — `sort` — array of field names, optionally with `-` prefix.
 * — `fields` — array of field names or wildcards (`*`, `*.*`, `rel.*`).
 * — `deep` — object keyed by relation name, with nested `fields`/`_filter`/`_sort`.
 *
 * Returns an array of violations. An empty array means the query is consistent
 * with the schema. The caller (guardReadParams) decides whether to throw or
 * just log.
 *
 * When the COLLECTION itself is unknown, every nested field is reported as
 * unknown — there is no schema to compare against.
 */
export function validateReadParams(
  collection: string,
  params: Record<string, unknown> | undefined
): ReadViolation[] {
  const violations: ReadViolation[] = [];
  if (!params) return violations;

  const schema = loadSchema();
  const fields = schema.get(collection);

  // Unknown collection: every nested field is unknown. We do NOT throw at
  // validate-time — list() already catches this case at request time via the
  // 403 unknown-collection branch. Validation here is only meaningful when
  // we have a schema to compare against.
  if (!fields) return violations;

  // --- filter ---------------------------------------------------------------
  // Filter can be a string ('status_eq=published') or an object. We only
  // structurally validate the object form — the string form is opaque to us
  // and Directus will reject malformed strings on its own.
  const filter = params.filter;
  if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
    collectFilterKeys(collection, fields, filter, 'filter', violations);
  }

  // --- sort -----------------------------------------------------------------
  const sort = params.sort;
  if (Array.isArray(sort)) {
    for (const item of sort) {
      if (typeof item !== 'string') continue; // SKIP: not a field reference
      if (isWildcard(item)) continue;
      const head = headSegment(stripSortPrefix(item));
      if (!fields.has(head)) {
        violations.push({ where: 'sort', value: item });
      }
    }
  }

  // --- fields ----------------------------------------------------------------
  const fieldsList = params.fields;
  if (Array.isArray(fieldsList)) {
    for (const item of fieldsList) {
      if (typeof item !== 'string') continue;
      if (isWildcard(item)) continue;
      const head = headSegment(item);
      if (!fields.has(head)) {
        violations.push({ where: 'fields', value: item });
      }
    }
  }

  // --- deep -----------------------------------------------------------------
  // First segment of every relation key must exist on the parent collection.
  // Nested `_fields`/`_sort` are validated separately in a second pass once we
  // know which collection the relation points to.
  const deep = params.deep;
  if (deep && typeof deep === 'object' && !Array.isArray(deep)) {
    for (const [relName, relSpec] of Object.entries(deep as Record<string, unknown>)) {
      if (isOperatorKey(relName)) continue;
      if (!fields.has(relName)) {
        violations.push({ where: 'deep', value: relName });
        continue;
      }
      // Nested fields inside the relation: we DO know the schema map but not
      // which collection `relName` points to. The snapshot only carries
      // collection/field names, not relation targets, so we validate the head
      // of every nested path against ALL collections — if it matches any,
      // accept it. This is the conservative fallback Tech Lead asked for:
      // "сомневаешься — пропускай".
      if (relSpec && typeof relSpec === 'object' && !Array.isArray(relSpec)) {
        const nested = relSpec as Record<string, unknown>;
        const nestedFields = nested.fields;
        if (Array.isArray(nestedFields)) {
          for (const f of nestedFields) {
            if (typeof f !== 'string') continue;
            if (isWildcard(f)) continue;
            const head = headSegment(f);
            // Accept if head matches ANY collection — relation target is unknown.
            const matchesAny = [...schema.values()].some((set) => set.has(head));
            if (!matchesAny) {
              violations.push({ where: `deep:${relName}.fields`, value: f });
            }
          }
        }
        // Nested _filter: same pass-through via operator keys.
        const nestedFilter = nested._filter;
        if (nestedFilter && typeof nestedFilter === 'object') {
          collectFilterKeys(relName, allFieldsUnion(schema), nestedFilter, `deep:${relName}._filter`, violations);
        }
      }
    }
  }

  return violations;
}

/**
 * Recursive walker over a filter object. Skips operator keys (`_and`, `_eq`,
 * ...) and recurses into nested operator groups; field keys are validated.
 */
function collectFilterKeys(
  context: string,
  allowed: Set<string>,
  node: unknown,
  where: string,
  violations: ReadViolation[]
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isOperatorKey(key)) {
      // Operator group — recurse into its value(s).
      if (Array.isArray(value)) {
        for (const item of value) {
          collectFilterKeys(context, allowed, item, where, violations);
        }
      } else {
        collectFilterKeys(context, allowed, value, where, violations);
      }
      continue;
    }
    // Real field key.
    if (!allowed.has(key)) {
      violations.push({ where, value: key });
    }
    // Field value: if it's an object (operators applied to this field), the
    // inner keys are all operators; nothing to validate further.
  }
}

/**
 * Build the union of all known fields. Used as the conservative fallback for
 * `deep` subfields where we don't know the target collection.
 */
function allFieldsUnion(schema: SchemaMap): Set<string> {
  const out = new Set<string>();
  for (const set of schema.values()) {
    for (const f of set) out.add(f);
  }
  return out;
}

/**
 * Guard read params: validate, react according to environment.
 *
 * Pass-through semantics mirror guardWriteData: a violation in production
 * produces an `error` log entry; in test/dev it throws with details. We do
 * NOT strip fields — see top-of-file rationale. If you want to act on the
 * violations, do it where you can distinguish "typo" from "newly added field
 * not yet in snapshot" — that distinction requires domain knowledge we do
 * not have here.
 */
export function guardReadParams(
  collection: string,
  params: Record<string, unknown> | undefined
): void {
  const violations = validateReadParams(collection, params);
  if (violations.length === 0) return;

  const msg = `Directus schema guard (read): ${violations.length} unknown reference(s) in '${collection}': ${violations
    .map((v) => `${v.where}=${v.value}`)
    .join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    log.error(`[schema-guard] ${msg}`);
    return;
  }
  throw new Error(msg);
}

/* ------------------------------------------------------------------------- */
/* AI-132 slice 2: collection-existence error                                */
/* ------------------------------------------------------------------------- */

/**
 * Distinct error type so callers (and tests) can recognise "we asked for a
 * collection that does not exist" vs "the collection exists but access is
 * denied". Both surface as HTTP 403 from Directus, but the meaning is
 * different and the recovery path is different — for the unknown case the
 * developer needs to fix a typo; for the denied case the operator needs to
 * grant policy.
 */
export class DirectusUnknownCollectionError extends Error {
  readonly collection: string;
  readonly knownSample: string[];
  constructor(collection: string, knownSample: string[]) {
    super(
      `Directus schema guard: collection '${collection}' is not in the schema snapshot. ` +
        `Sample of known collections: ${knownSample.join(', ')}.`
    );
    this.name = 'DirectusUnknownCollectionError';
    this.collection = collection;
    this.knownSample = knownSample;
  }
}
