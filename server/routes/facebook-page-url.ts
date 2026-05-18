import express from 'express';

const router = express.Router();

// GET /api/facebook/page-url/:pageId - получить URL страницы Facebook
router.get('/page-url/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    
    if (!pageId) {
      return res.status(400).json({
        error: 'Page ID is required'
      });
    }

    console.log('🔗 [FACEBOOK-URL] Generating URL for page ID:', pageId);

    // Facebook Page URL формат: https://www.facebook.com/{page-id}
    const pageUrl = `https://www.facebook.com/${pageId}`;
    
    console.log('🔗 [FACEBOOK-URL] Generated URL:', pageUrl);

    res.json({
      success: true,
      pageId: pageId,
      pageUrl: pageUrl,
      message: 'Open this URL to verify if this is a Facebook Page or Group'
    });

  } catch (error: any) {
    console.error('❌ [FACEBOOK-URL] Failed to generate URL:', error.message);
    res.status(500).json({
      error: 'Failed to generate page URL',
      details: error.message
    });
  }
});

export default router;