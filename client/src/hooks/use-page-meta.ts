import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
}

const SITE_NAME = 'SMM Manager';

export function usePageMeta({ title, description, ogTitle, ogDescription }: PageMeta) {
  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`;
    document.title = fullTitle;

    const setMeta = (selector: string, content: string) => {
      let el = document.querySelector(selector) as HTMLMetaElement | null;
      if (el) {
        el.content = content;
      }
    };

    if (description) {
      setMeta('meta[name="description"]', description);
    }

    const ogTitleVal = ogTitle || title;
    const ogDescVal = ogDescription || description || '';

    setMeta('meta[property="og:title"]', `${ogTitleVal} | ${SITE_NAME}`);
    setMeta('meta[name="twitter:title"]', `${ogTitleVal} | ${SITE_NAME}`);

    if (ogDescVal) {
      setMeta('meta[property="og:description"]', ogDescVal);
      setMeta('meta[name="twitter:description"]', ogDescVal);
    }

    return () => {
      document.title = `${SITE_NAME} — ИИ-автоматизация социальных сетей`;
    };
  }, [title, description, ogTitle, ogDescription]);
}
