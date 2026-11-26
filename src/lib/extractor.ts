import { cloneVisibleDocument } from '@/lib/extractor-dom';
import {
  extractFallback,
  shouldPreferFallbackOverReadability,
  tryExtractWithReadability,
} from '@/lib/extractor-scoring';
import { extractSelectionHtml } from '@/lib/extractor-selection';
import { collapseWhitespace } from '@/lib/text';

export type ExtractMode = 'auto' | 'page' | 'selection';

export interface ExtractedDocument {
  title: string;
  url: string;
  html: string;
  source: 'selection' | 'readability' | 'fallback';
}

function readValidDocumentUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed && trimmed !== 'about:blank' ? trimmed : null;
}

function resolveDocumentUrl(doc: Document): string {
  return readValidDocumentUrl(doc.location?.href) ?? readValidDocumentUrl(doc.URL) ?? '';
}

function resolveBaseUrl(doc: Document, documentUrl: string): string {
  return readValidDocumentUrl(doc.baseURI) ?? documentUrl;
}

export function extractDocumentContent(
  doc: Document,
  mode: ExtractMode = 'auto'
): ExtractedDocument {
  const url = resolveDocumentUrl(doc);
  const baseUrl = resolveBaseUrl(doc, url);
  const docTitle = collapseWhitespace(doc.title ?? '');

  if (mode === 'selection' || mode === 'auto') {
    const selectionHtml = extractSelectionHtml(doc, baseUrl);
    if (selectionHtml) {
      return { title: docTitle, url, html: selectionHtml, source: 'selection' };
    }
    if (mode === 'selection') {
      return { title: docTitle, url, html: '', source: 'selection' };
    }
  }

  const cleanDoc = cloneVisibleDocument(doc, baseUrl);
  const fallback = extractFallback(cleanDoc, baseUrl);
  const readability = tryExtractWithReadability(cleanDoc, url, docTitle);

  if (readability && !shouldPreferFallbackOverReadability(readability, fallback)) {
    return readability.doc;
  }

  return { title: docTitle, url, html: fallback.html, source: 'fallback' };
}
