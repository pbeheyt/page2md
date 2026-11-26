import { Readability } from '@mozilla/readability';
import type { ExtractedDocument } from '@/lib/extractor';
import {
  FALLBACK_LANDMARK_NOISE_SELECTORS,
  pruneActionButtons,
  resolveRelativeLinks,
} from '@/lib/extractor-dom';
import { countDirectTableRows } from '@/lib/markdown-table';
import { collapseWhitespace, countWords } from '@/lib/text';

const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const MIN_READABILITY_TEXT_CHARS = 120;
const MIN_CODE_BLOCK_CHARS = 8;
const MIN_MAIN_FALLBACK_WORDS = 80;
const MIN_MAIN_RETENTION_RATIO = 0.65;
const MIN_MAIN_TABLE_WORD_RATIO = 0.85;
const MIN_MAIN_HEADINGS = 4;
const MIN_MAIN_HEADING_RATIO = 0.4;
const MIN_CODE_BLOCK_RETENTION_RATIO = 0.5;
const MIN_TABLE_RETENTION_RATIO = 0.5;
const MIN_BODY_FALLBACK_WORDS = 300;
const MIN_BODY_CODE_BLOCKS = 2;
const MIN_BODY_RETENTION_RATIO = 0.55;
const MIN_BODY_HEADINGS = 5;
const MIN_BODY_HEADING_RATIO = 0.35;
const MIN_BODY_STUB_WORDS = 250;
const MIN_BODY_STUB_RATIO = 0.25;

export interface ContentMetrics {
  wordCount: number;
  headingCount: number;
  tableCount: number;
  codeBlockCount: number;
}

export interface FallbackExtraction extends ContentMetrics {
  html: string;
  hasExplicitMain: boolean;
}

export interface ReadabilityExtraction extends ContentMetrics {
  doc: ExtractedDocument;
}

function countContentUnits(text: string): number {
  const baseWords = countWords(text);
  const cjkMatches = text.match(CJK_CHAR_RE);
  if (!cjkMatches || cjkMatches.length === 0) {
    return baseWords;
  }
  return Math.max(baseWords, Math.round(cjkMatches.length / 2));
}

function countNonEmptyTables(root: ParentNode): number {
  let count = 0;
  for (const table of root.querySelectorAll('table')) {
    if (countDirectTableRows(table) >= 2) {
      count++;
    }
  }
  return count;
}

function countNonEmptyCodeBlocks(root: ParentNode): number {
  let count = 0;
  for (const pre of root.querySelectorAll('pre')) {
    if ((pre.textContent?.trim().length ?? 0) >= MIN_CODE_BLOCK_CHARS) {
      count++;
    }
  }
  return count;
}

function measureContentMetrics(root: ParentNode, textContent?: string): ContentMetrics {
  const resolvedText =
    textContent ?? (root instanceof Element ? (root.textContent ?? '') : '');
  return {
    wordCount: countContentUnits(resolvedText),
    headingCount: root.querySelectorAll('h1, h2, h3').length,
    tableCount: countNonEmptyTables(root),
    codeBlockCount: countNonEmptyCodeBlocks(root),
  };
}

function resolveFallbackRoot(doc: Document): { root: Element | null; hasExplicitMain: boolean } {
  for (const mainEl of doc.querySelectorAll('main, [role="main"]')) {
    if ((mainEl.textContent?.trim().length ?? 0) > 0) {
      return { root: mainEl, hasExplicitMain: true };
    }
  }

  const articles = doc.querySelectorAll('article');
  const singleArticle = articles.length === 1 ? articles[0] : undefined;
  if (singleArticle && (singleArticle.textContent?.trim().length ?? 0) > 0) {
    return { root: singleArticle, hasExplicitMain: false };
  }

  return { root: doc.body, hasExplicitMain: false };
}

export function extractFallback(cleanDoc: Document, baseUrl: string): FallbackExtraction {
  const { root: sourceRoot, hasExplicitMain } = resolveFallbackRoot(cleanDoc);
  if (!sourceRoot) {
    return {
      html: '',
      hasExplicitMain: false,
      wordCount: 0,
      headingCount: 0,
      tableCount: 0,
      codeBlockCount: 0,
    };
  }

  const root = sourceRoot.cloneNode(true) as Element;
  const isBodyRoot = sourceRoot === cleanDoc.body;

  root.querySelectorAll(FALLBACK_LANDMARK_NOISE_SELECTORS).forEach((el) => el.remove());

  for (const aside of root.querySelectorAll('aside')) {
    if (!aside.closest('article, main')) {
      aside.remove();
    }
  }

  if (isBodyRoot) {
    for (const chrome of root.querySelectorAll('header, footer')) {
      if (!chrome.closest('article, main, section')) {
        chrome.remove();
      }
    }
  }

  pruneActionButtons(root);
  resolveRelativeLinks(root, baseUrl);

  return {
    html: root.innerHTML,
    hasExplicitMain,
    ...measureContentMetrics(root),
  };
}

export function tryExtractWithReadability(
  readabilityDoc: Document,
  url: string,
  docTitle: string
): ReadabilityExtraction | null {
  let article: ReturnType<Readability['parse']>;

  try {
    article = new Readability(readabilityDoc, {
      keepClasses: true,
      charThreshold: MIN_READABILITY_TEXT_CHARS,
    }).parse();
  } catch (error) {
    console.warn('[page2md] Readability parsing failed:', error);
    return null;
  }

  const textContent = article?.textContent?.trim() ?? '';
  if (!article?.content || textContent.length < MIN_READABILITY_TEXT_CHARS) {
    return null;
  }

  const measureDoc = readabilityDoc.implementation.createHTMLDocument('');
  measureDoc.body.innerHTML = article.content;

  const preferredTitle = article.title ? collapseWhitespace(article.title) : '';

  return {
    doc: {
      title: preferredTitle || docTitle,
      url,
      html: article.content,
      source: 'readability',
    },
    ...measureContentMetrics(measureDoc.body, textContent),
  };
}

function shouldPreferExplicitMainFallback(
  readability: ReadabilityExtraction,
  fallback: FallbackExtraction
): boolean {
  if (readability.wordCount < fallback.wordCount * MIN_MAIN_RETENTION_RATIO) {
    return true;
  }
  if (
    fallback.codeBlockCount > 0 &&
    readability.codeBlockCount < fallback.codeBlockCount * MIN_CODE_BLOCK_RETENTION_RATIO
  ) {
    return true;
  }
  if (
    fallback.tableCount > 0 &&
    readability.tableCount < fallback.tableCount * MIN_TABLE_RETENTION_RATIO &&
    readability.wordCount < fallback.wordCount * MIN_MAIN_TABLE_WORD_RATIO
  ) {
    return true;
  }
  if (
    fallback.headingCount >= MIN_MAIN_HEADINGS &&
    readability.headingCount < fallback.headingCount * MIN_MAIN_HEADING_RATIO
  ) {
    return true;
  }
  return false;
}

function shouldPreferBodyFallback(
  readability: ReadabilityExtraction,
  fallback: FallbackExtraction
): boolean {
  if (
    fallback.codeBlockCount >= MIN_BODY_CODE_BLOCKS &&
    readability.codeBlockCount < fallback.codeBlockCount * MIN_CODE_BLOCK_RETENTION_RATIO
  ) {
    return true;
  }

  if (
    fallback.wordCount >= MIN_BODY_FALLBACK_WORDS &&
    readability.wordCount < fallback.wordCount * MIN_BODY_RETENTION_RATIO &&
    ((fallback.headingCount >= MIN_BODY_HEADINGS &&
      readability.headingCount < fallback.headingCount * MIN_BODY_HEADING_RATIO) ||
      (fallback.tableCount > 0 &&
        readability.tableCount < fallback.tableCount * MIN_TABLE_RETENTION_RATIO) ||
      (readability.wordCount < MIN_BODY_STUB_WORDS &&
        readability.wordCount < fallback.wordCount * MIN_BODY_STUB_RATIO))
  ) {
    return true;
  }

  return false;
}

export function shouldPreferFallbackOverReadability(
  readability: ReadabilityExtraction,
  fallback: FallbackExtraction
): boolean {
  if (!fallback.html.trim() || fallback.wordCount === 0) {
    return false;
  }

  if (fallback.hasExplicitMain && fallback.wordCount >= MIN_MAIN_FALLBACK_WORDS) {
    return shouldPreferExplicitMainFallback(readability, fallback);
  }

  return shouldPreferBodyFallback(readability, fallback);
}
