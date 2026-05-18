import { describe, it, expect } from 'vitest';
import { directusApi } from '../lib/directus';

describe('directus-lib', () => {
    it('should be initialized', () => {
        expect(directusApi).toBeDefined();
    });
});
