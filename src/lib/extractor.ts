import { Readability } from '@mozilla/readability';

export type ExtractMode = 'auto' | 'page' | 'selection';

export interface ExtractedDocument {
  title: string;
  url: string;
  html: string;
  source: 'selection' | 'readability' | 'fallback';
}

const HIDDEN_SELECTORS = [
  '[hidden]',
  '[aria-hidden="true"]',
  '.sr-only',
  '.visually-hidden',
  'dialog:not([open])',
  'template',
].join(', ');

const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  HIDDEN_SELECTORS,
].join(', ');

const MIN_READABILITY_TEXT_CHARS = 120;

function cloneDocumentWithoutHidden(doc: Document): Document {
  const clonedDoc = doc.cloneNode(true) as Document;
  const win = doc.defaultView;

  if (win?.getComputedStyle && doc.body && clonedDoc.body) {
    const liveEls = doc.body.querySelectorAll('*');
    const cloneEls = clonedDoc.body.querySelectorAll('*');
    if (liveEls.length === cloneEls.length) {
      const toRemove: Element[] = [];
      for (let i = 0; i < liveEls.length; i++) {
        const liveEl = liveEls[i]!;
        const style = win.getComputedStyle(liveEl);
        if (style.display === 'none' || style.visibility === 'hidden') {
          toRemove.push(cloneEls[i]!);
        }
      }
      for (const el of toRemove) {
        el.remove();
      }
    }
  }

  clonedDoc.querySelectorAll(HIDDEN_SELECTORS).forEach((el) => el.remove());
  return clonedDoc;
}

function extractSelectionHtml(doc: Document): string | null {
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const text = selection.toString().trim();
  if (!text) {
    return null;
  }
  const container = doc.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    container.appendChild(range.cloneContents());
  }
  return container.innerHTML.trim() || null;
}

function extractFallbackHtml(doc: Document): string {
  const root =
    doc.querySelector('main, article, [role="main"]') ?? doc.body;
  if (!root) {
    return '';
  }
  const cloned = root.cloneNode(true) as Element;
  cloned.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());
  return cloned.innerHTML;
}

export function extractDocumentContent(
  doc: Document,
  mode: ExtractMode = 'auto'
): ExtractedDocument {
  const url = doc.location?.href ?? '';
  const fallbackTitle = doc.title?.trim() || url;

  if (mode === 'selection' || mode === 'auto') {
    const selectionHtml = extractSelectionHtml(doc);
    if (selectionHtml) {
      return {
        title: fallbackTitle,
        url,
        html: selectionHtml,
        source: 'selection',
      };
    }
    if (mode === 'selection') {
      return {
        title: fallbackTitle,
        url,
        html: '',
        source: 'selection',
      };
    }
  }

  const cleanDoc = cloneDocumentWithoutHidden(doc);

  try {
    const readabilityDoc = cleanDoc.cloneNode(true) as Document;
    const article = new Readability(readabilityDoc).parse();
    const textLength = article?.textContent?.trim().length ?? 0;
    if (article?.content && textLength >= MIN_READABILITY_TEXT_CHARS) {
      return {
        title: article.title?.trim() || fallbackTitle,
        url,
        html: article.content,
        source: 'readability',
      };
    }
  } catch {
  }

  return {
    title: fallbackTitle,
    url,
    html: extractFallbackHtml(cleanDoc),
    source: 'fallback',
  };
}
