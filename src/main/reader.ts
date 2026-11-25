import type { ReaderArticle, ReaderBlock } from '../shared/types'

const VALID_TYPES = new Set<ReaderBlock['type']>(['h1', 'h2', 'p', 'quote', 'li'])

/**
 * Extracts strictly plain-text blocks from an untrusted page without passing any raw HTML
 * into the browser shell UI (prevents XSS in Reader Mode).
 */
export async function extractSafeReaderArticle(
  wc: Electron.WebContents
): Promise<ReaderArticle | null> {
  if (wc.isDestroyed()) return null
  const pageUrl = wc.getURL()
  if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
    return null
  }

  const raw: unknown = await wc.executeJavaScript(
    `(() => {
      const root =
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.body;
      if (!root) return null;

      const titleEl = document.querySelector('h1') || document.querySelector('title');
      const title = (titleEl?.textContent || document.title || '').trim().slice(0, 240);
      const authorMeta =
        document.querySelector('meta[name="author"]')?.getAttribute('content') ||
        document.querySelector('[rel="author"]')?.textContent ||
        '';
      const siteMeta =
        document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
        location.hostname;

      const blocks = [];
      const nodes = root.querySelectorAll('h1, h2, h3, p, blockquote, li');
      for (const el of nodes) {
        if (blocks.length >= 250) break;
        if (el.closest('nav, header, footer, aside, [aria-hidden="true"]')) continue;
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < 20 && el.tagName === 'P') continue;
        if (!text) continue;
        const tag = el.tagName.toLowerCase();
        let type = 'p';
        if (tag === 'h1') type = 'h1';
        else if (tag === 'h2' || tag === 'h3') type = 'h2';
        else if (tag === 'blockquote') type = 'quote';
        else if (tag === 'li') type = 'li';
        blocks.push({ type, text: text.slice(0, 4000) });
      }

      return {
        title,
        byline: authorMeta.trim().slice(0, 120),
        siteName: siteMeta.trim().slice(0, 120),
        url: location.href,
        blocks
      };
    })()`,
    true
  )

  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : []
  const blocks: ReaderBlock[] = []

  for (const item of rawBlocks) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const type = typeof rec.type === 'string' && VALID_TYPES.has(rec.type as ReaderBlock['type'])
      ? (rec.type as ReaderBlock['type'])
      : 'p'
    const text = typeof rec.text === 'string' ? rec.text.trim() : ''
    if (text) {
      blocks.push({ type, text: text.slice(0, 4000) })
    }
  }

  return {
    title: typeof obj.title === 'string' && obj.title ? obj.title : 'Reader View',
    byline: typeof obj.byline === 'string' ? obj.byline : '',
    siteName: typeof obj.siteName === 'string' ? obj.siteName : '',
    url: pageUrl,
    blocks
  }
}
