/**
 * AI-132 slice A: directus-schema-guard behavioral tests.
 *
 * Tests import the real guard module and verify its behavior against
 * a schema fixture (server/data/directus-schema.json).
 *
 * Mutation proofs:
 * 1. Remove guardWriteData call from directus-crud.ts create → test "guard is called on create" RED
 * 2. Remove guardWriteData call from directus-crud.ts update → test "guard is called on update" RED
 * 3. Change throw to silent return in guard → test "dev mode throws on unknown field" RED
 * 4. Remove log.error in prod path → test "prod mode logs error" RED
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock logger before importing guard
vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn();
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  return { log, default: log, logEvent: vi.fn() };
});

import {
  validateWriteData,
  guardWriteData,
  isKnownCollection,
  getKnownFields,
} from '../services/directus-schema-guard';

import log from '../utils/logger';

describe('AI-132: directus schema guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  describe('schema loading', () => {
    it('knows campaign_content collection', () => {
      expect(isKnownCollection('campaign_content')).toBe(true);
    });

    it('knows campaign_trend_topics collection', () => {
      expect(isKnownCollection('campaign_trend_topics')).toBe(true);
    });

    it('rejects unknown collection', () => {
      expect(isKnownCollection('nonexistent_collection_xyz')).toBe(false);
    });

    it('returns field set for known collection', () => {
      const fields = getKnownFields('campaign_content');
      expect(fields).toBeDefined();
      expect(fields!.has('id')).toBe(true);
      expect(fields!.has('created_at')).toBe(true);
      expect(fields!.has('status')).toBe(true);
    });

    it('returns undefined for unknown collection', () => {
      expect(getKnownFields('nonexistent')).toBeUndefined();
    });
  });

  describe('mixed schema (criterion 3)', () => {
    it('created_at passes in campaign_content (where it exists)', () => {
      const result = validateWriteData('campaign_content', { created_at: '2024-01-01' });
      expect(result.valid).toBe(true);
    });

    it('date_created fails in campaign_content (not in schema — uses created_at)', () => {
      const result = validateWriteData('campaign_content', { date_created: '2024-01-01' });
      expect(result.valid).toBe(false);
      expect(result.unknownFields).toContain('date_created');
    });

    it('date_created passes in social_accounts (where it exists)', () => {
      const result = validateWriteData('social_accounts', { date_created: '2024-01-01' });
      expect(result.valid).toBe(true);
    });

    it('created_at fails in social_accounts (not in schema — uses date_created)', () => {
      const result = validateWriteData('social_accounts', { created_at: '2024-01-01' });
      expect(result.valid).toBe(false);
      expect(result.unknownFields).toContain('created_at');
    });
  });

  describe('dev mode (criterion 2)', () => {
    it('throws on unknown field with details', () => {
      expect(() => {
        guardWriteData('campaign_content', { date_created: 'x', fake_field: 'y' });
      }).toThrow(/unknown field.*campaign_content.*date_created.*fake_field/);
    });

    it('throws with known fields list', () => {
      try {
        guardWriteData('campaign_content', { nonexistent_field: 'x' });
        expect.fail('should have thrown');
      } catch (e: unknown) {
        const msg = (e as Error).message;
        expect(msg).toContain('nonexistent_field');
        expect(msg).toContain('Known:');
        expect(msg).toContain('created_at');
      }
    });

    it('passes through valid data unchanged', () => {
      const data = { status: 'published', image_url: 'https://example.com/img.jpg' };
      const result = guardWriteData('campaign_content', data);
      expect(result).toEqual(data);
    });
  });

  describe('production mode (criterion 3)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('does not throw on unknown field', () => {
      expect(() => {
        guardWriteData('campaign_content', { fake_field: 'x' });
      }).not.toThrow();
    });

    it('logs error event with collection and field', () => {
      guardWriteData('campaign_content', { fake_field: 'x' });
      expect(log.error).toHaveBeenCalledOnce();
      const call = (log.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toContain('campaign_content');
      expect(call).toContain('fake_field');
    });

    it('passes data through unchanged (no stripping)', () => {
      const data = { status: 'published', fake_field: 'should_be_logged', image_url: 'https://img.com' };
      const result = guardWriteData('campaign_content', data);
      // Data passes through unchanged — Directus drops unknown fields as always,
      // but now we have a log entry. Do NOT strip: stale snapshot would cause
      // silent data loss, defeating the guard's purpose.
      expect(result).toEqual(data);
      expect(result).toHaveProperty('fake_field');
    });

    it('data with all known fields passes unchanged', () => {
      const data = { id: '123', status: 'draft' };
      const result = guardWriteData('campaign_content', data);
      expect(result).toEqual(data);
    });
  });

  describe('unknown collection (criterion 4)', () => {
    it('dev mode throws on unknown collection', () => {
      expect(() => {
        guardWriteData('nonexistent_collection', { foo: 'bar' });
      }).toThrow(/unknown collection.*nonexistent_collection/);
    });

    it('prod mode logs error on unknown collection', () => {
      process.env.NODE_ENV = 'production';
      guardWriteData('nonexistent_collection', { foo: 'bar' });
      expect(log.error).toHaveBeenCalledOnce();
      const call = (log.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toContain('nonexistent_collection');
    });
  });
});

describe('AI-132: guard integrated in directus-crud', () => {
  it('guard is called on create (mutation: remove guardWriteData call → RED)', async () => {
    // Import the guard module and spy on it
    const guardModule = await import('../services/directus-schema-guard');
    const spy = vi.spyOn(guardModule, 'guardWriteData');

    // Import crud after spy is set up
    const { directusCrud } = await import('../services/directus-crud');

    // Try to create with unknown field — guard should be called
    try {
      await directusCrud.create('campaign_content', {
        status: 'draft',
        totally_fake_field: 'should trigger guard',
      }, { useAdminToken: true });
    } catch {
      // Expected — either guard throws or Directus mock fails
    }

    expect(spy).toHaveBeenCalledWith('campaign_content', expect.objectContaining({
      status: 'draft',
      totally_fake_field: 'should trigger guard',
    }));
    spy.mockRestore();
  });

  it('guard is called on update (mutation: remove guardWriteData call → RED)', async () => {
    const guardModule = await import('../services/directus-schema-guard');
    const spy = vi.spyOn(guardModule, 'guardWriteData');

    const { directusCrud } = await import('../services/directus-crud');

    try {
      await directusCrud.update('campaign_content', 'test-id', {
        status: 'published',
        nonexistent_field: 'should trigger guard',
      }, { useAdminToken: true });
    } catch {
      // Expected
    }

    expect(spy).toHaveBeenCalledWith('campaign_content', expect.objectContaining({
      status: 'published',
      nonexistent_field: 'should trigger guard',
    }));
    spy.mockRestore();
  });
});
