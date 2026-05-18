import express from 'express';
import { getFeatureFlags, DEFAULT_FEATURE_FLAGS, FEATURE_DESCRIPTIONS } from '@shared/feature-flags';
import type { FeatureFlags } from '@shared/feature-flags';

const router = express.Router();

// Get current feature flags
router.get('/feature-flags', (req, res) => {
  try {
    const flags = getFeatureFlags();
    res.json(flags);
  } catch (error) {
    console.error('Error getting feature flags:', error);
    res.status(500).json({ error: 'Failed to get feature flags' });
  }
});

// Get feature flags descriptions (for admin interface)
router.get('/feature-flags/descriptions', (req, res) => {
  try {
    res.json({
      flags: getFeatureFlags(),
      descriptions: FEATURE_DESCRIPTIONS,
      defaults: DEFAULT_FEATURE_FLAGS,
    });
  } catch (error) {
    console.error('Error getting feature descriptions:', error);
    res.status(500).json({ error: 'Failed to get feature descriptions' });
  }
});

// Admin endpoint to update feature flags (if needed in future)
router.patch('/feature-flags', (req, res) => {
  // For now, feature flags are environment-based
  // In future, this could update database-stored flags
  res.status(501).json({ 
    error: 'Feature flag updates not implemented yet',
    message: 'Feature flags are currently environment-based'
  });
});

export { router as featureFlagsRouter };