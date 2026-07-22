import { describe, expect, it } from 'vitest';
import {
  getAnalyticsVerdict,
  getPlatformEfficiencyLevel,
  getSampleSummary,
  type AnalyticsSample,
} from '../analytics-verdict';

describe('getAnalyticsVerdict — acceptance matrix', () => {
  it('posts=0, views=0, engagements=0 -> no-data', () => {
    const v = getAnalyticsVerdict({ posts: 0, views: 0, engagements: 0 });
    expect(v).toBe('no-data');
  });

  it('posts>0, views=0, engagements=0 -> insufficient-views', () => {
    const v = getAnalyticsVerdict({ posts: 5, views: 0, engagements: 0 });
    expect(v).toBe('insufficient-views');
  });

  it('posts>0, views>0, engagements=0 -> low (allows "low" verdict)', () => {
    const v = getAnalyticsVerdict({ posts: 5, views: 1000, engagements: 0 });
    expect(v).toBe('low');
  });

  it('posts>0, views>0, engagements high rate (>= 5%) -> high', () => {
    const v = getAnalyticsVerdict({ posts: 4, views: 1000, engagements: 80 });
    expect(v).toBe('high');
  });

  it('posts>0, views>0, engagements medium rate (2-5%) -> medium', () => {
    const v = getAnalyticsVerdict({ posts: 4, views: 1000, engagements: 30 });
    expect(v).toBe('medium');
  });

  it('posts>0, views>0, engagements low rate (1-2%) -> low', () => {
    const v = getAnalyticsVerdict({ posts: 4, views: 1000, engagements: 15 });
    expect(v).toBe('low');
  });

  it('posts>0, views>0, engagements under 1% -> low', () => {
    const v = getAnalyticsVerdict({ posts: 4, views: 1000, engagements: 5 });
    expect(v).toBe('low');
  });
});

describe('getSampleSummary copy', () => {
  it('no-data summary never says "Низкая"', () => {
    const summary = getSampleSummary({ posts: 0, views: 0, engagements: 0 });
    expect(summary.headline.toLowerCase()).not.toContain('низк');
    expect(summary.headline.toLowerCase()).not.toContain('low');
  });

  it('insufficient-views summary never says "Низкая"', () => {
    const summary = getSampleSummary({ posts: 3, views: 0, engagements: 0 });
    expect(summary.headline.toLowerCase()).not.toContain('низк');
  });

  it('low verdict produces the "Низкая эффективность" copy only when there are views', () => {
    const summary = getSampleSummary({ posts: 3, views: 500, engagements: 1 });
    expect(summary.headline).toMatch(/Низкая эффективность/);
  });

  it('every verdict returns a non-empty headline and detail', () => {
    const samples: AnalyticsSample[] = [
      { posts: 0, views: 0, engagements: 0 },
      { posts: 1, views: 0, engagements: 0 },
      { posts: 1, views: 100, engagements: 0 },
      { posts: 1, views: 100, engagements: 3 },
      { posts: 1, views: 100, engagements: 6 },
    ];
    for (const sample of samples) {
      const summary = getSampleSummary(sample);
      expect(summary.headline.length).toBeGreaterThan(0);
      expect(summary.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('getPlatformEfficiencyLevel', () => {
  it('returns no-data for posts=0 OR views=0', () => {
    expect(getPlatformEfficiencyLevel({ posts: 0, views: 100 })).toBe('no-data');
    expect(getPlatformEfficiencyLevel({ posts: 5, views: 0 })).toBe('no-data');
    expect(getPlatformEfficiencyLevel({ posts: 0, views: 0 })).toBe('no-data');
  });

  it('never returns "low" for no-data platforms', () => {
    expect(getPlatformEfficiencyLevel({ posts: 0, views: 0 })).not.toBe('low');
  });
});
