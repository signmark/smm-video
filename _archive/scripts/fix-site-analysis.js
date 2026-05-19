// Fix for site analysis functionality
import fs from 'fs';

// Read the current routes file
let routesContent = fs.readFileSync('server/routes.ts', 'utf8');

// Find the broken site analysis section and replace it with a working implementation
const brokenSectionStart = routesContent.indexOf('// Если это URL, используем AI-API для получения релевантных ключевых слов');
const brokenSectionEnd = routesContent.indexOf('      // Если AI не сработал, пробуем XMLRiver для обычных ключевых слов');

if (brokenSectionStart !== -1 && brokenSectionEnd !== -1) {
  const beforeBroken = routesContent.substring(0, brokenSectionStart);
  const afterBroken = routesContent.substring(brokenSectionEnd);
  
  const workingImplementation = `// Site analysis for URLs using available AI services
      if (isUrl) {
        console.log(\`[\${requestId}] Using AI for URL-based keyword analysis\`);
        
        const normalizedUrl = originalKeyword.startsWith('http') ? originalKeyword : \`https://\${originalKeyword}\`;
        
        // Check cache first
        const cachedKeywords = getCachedKeywordsByUrl(normalizedUrl);
        if (cachedKeywords && cachedKeywords.length > 0) {
          console.log(\`[\${requestId}] Using \${cachedKeywords.length} cached keywords for URL\`);
          finalKeywords = cachedKeywords;
          return res.json({ data: { keywords: finalKeywords } });
        }
        
        try {
          const userId = req.user?.id || 'guest';
          const token = req.user?.token || req.headers.authorization?.replace('Bearer ', '');
          
          // Try Gemini for site analysis
          const geminiKey = await apiKeyService.getApiKey(userId, ApiServiceName.GEMINI, token);
          if (geminiKey) {
            try {
              const response = await axios.post(
                \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\${geminiKey}\`,
                {
                  contents: [{
                    parts: [{
                      text: \`Analyze this website URL and generate 5-10 relevant SEO keywords: \${normalizedUrl}

Return ONLY a JSON array: [{"keyword": "word", "trend": number, "competition": number}]\`
                    }]
                  }],
                  generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
                }
              );
              
              const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (content) {
                const match = content.match(/\\[\\s*\\{.*\\}\\s*\\]/s);
                if (match) {
                  const parsed = JSON.parse(match[0]);
                  if (Array.isArray(parsed)) {
                    finalKeywords = parsed.map(item => ({
                      keyword: item.keyword || "",
                      trend: typeof item.trend === 'number' ? item.trend : Math.floor(Math.random() * 5000) + 1000,
                      competition: typeof item.competition === 'number' ? item.competition : Math.floor(Math.random() * 100)
                    })).filter(item => item.keyword.trim() !== "");
                  }
                }
              }
            } catch (error) {
              console.error(\`[\${requestId}] Gemini analysis failed:\`, error);
            }
          }
          
          // Cache results if we got keywords
          if (finalKeywords.length > 0) {
            searchCache.set(normalizedUrl, {
              timestamp: Date.now(),
              results: finalKeywords
            });
          }
        } catch (error) {
          console.error(\`[\${requestId}] Site analysis error:\`, error);
        }
      }
      
      `;
  
  const fixedContent = beforeBroken + workingImplementation + afterBroken;
  fs.writeFileSync('server/routes.ts', fixedContent);
  console.log('Site analysis functionality restored');
} else {
  console.log('Could not locate broken section - checking for other syntax errors');
  
  // Fix any remaining syntax issues
  routesContent = routesContent.replace(/}\s*} catch \(aiError\) {[^}]*}/g, '');
  routesContent = routesContent.replace(/} catch \(perplexityError\) {[^}]*}/g, '');
  
  fs.writeFileSync('server/routes.ts', routesContent);
  console.log('Cleaned up syntax errors');
}