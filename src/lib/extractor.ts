import { Readability } from '@mozilla/readability';

export type ExtractMode = 'auto' | 'page' | 'selection';

export interface ExtractedDocument {
  title: string;
  url: string;
  html: string;
  source: 'selection' | 'readability' | 'fallback';
}

export const NON_CONTENT_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'template',
] as const;

export const NON_CONTENT_TAG_SET: ReadonlySet<string> = new Set(NON_CONTENT_TAGS);

const HIDDEN_SELECTORS = [
  '[hidden]',
  '[aria-hidden="true"]',
  '.sr-only',
  '.visually-hidden',
  'dialog:not([open])',
].join(', ');

const FALLBACK_LANDMARK_NOISE_SELECTORS = [
  'nav',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
].join(', ');

const NON_CONTENT_SELECTORS = [...NON_CONTENT_TAGS, HIDDEN_SELECTORS].join(', ');

const SKIPPED_HREF_PROTOCOL_RE = /^(?:javascript|mailto|tel|data):/i;
const MIN_READABILITY_TEXT_CHARS = 120;

function createExtractedDocument(
  title: string,
  url: string,
  html: string,
  source: ExtractedDocument['source']
): ExtractedDocument {
  return { title, url, html, source };
}

function normalizeTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle) {
    return '';
  }
  return rawTitle.replace(/\s+/g, ' ').trim();
}

function resolveDocumentTitle(
  preferredTitle: string | null | undefined,
  fallbackTitle: string
): string {
  const normalizedPreferred = normalizeTitle(preferredTitle);
  return normalizedPreferred || fallbackTitle;
}

function resolveDocumentUrl(doc: Document): string {
  const locationHref = doc.location?.href?.trim();
  if (locationHref && locationHref !== 'about:blank') {
    return locationHref;
  }
  const docUrl = doc.URL?.trim();
  if (docUrl && docUrl !== 'about:blank') {
    return docUrl;
  }
  return '';
}

function resolveBaseUrl(doc: Document, documentUrl: string): string {
  const baseUri = doc.baseURI?.trim();
  if (baseUri && baseUri !== 'about:blank') {
    return baseUri;
  }
  return documentUrl;
}

function resolveUrl(rawHref: string, baseUrl: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#') || SKIPPED_HREF_PROTOCOL_RE.test(trimmed)) {
    return null;
  }
  if (!URL.canParse(trimmed, baseUrl)) {
    return null;
  }
  return new URL(trimmed, baseUrl).href;
}

function resolveRelativeLinks(root: ParentNode, baseUrl: string): void {
  if (!baseUrl) {
    return;
  }
  for (const anchor of root.querySelectorAll('a[href]')) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) {
      continue;
    }
    const resolved = resolveUrl(rawHref, baseUrl);
    if (resolved) {
      anchor.setAttribute('href', resolved);
    }
  }
}

function shouldPruneElement(element: Element): boolean {
  return (
    NON_CONTENT_TAG_SET.has(element.tagName.toLowerCase()) ||
    element.matches(HIDDEN_SELECTORS)
  );
}

function cloneVisibleChildren(
  liveParent: Element,
  cloneParent: Element,
  targetDoc: Document,
  win: Window | null,
  parentVisibilityHidden: boolean
): void {
  for (const child of liveParent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!parentVisibilityHidden) {
        cloneParent.appendChild(targetDoc.createTextNode((child as Text).data));
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const liveEl = child as Element;
    if (shouldPruneElement(liveEl)) {
      continue;
    }

    let isVisibilityHidden = parentVisibilityHidden;
    if (win?.getComputedStyle) {
      const style = win.getComputedStyle(liveEl);
      if (style.display === 'none' || style.visibility === 'collapse') {
        continue;
      }
      if (style.visibility === 'hidden') {
        isVisibilityHidden = true;
      } else if (style.visibility === 'visible') {
        isVisibilityHidden = false;
      }
    }

    const clonedEl = targetDoc.importNode(liveEl, false) as Element;
    cloneVisibleChildren(liveEl, clonedEl, targetDoc, win, isVisibilityHidden);

    if (!isVisibilityHidden || clonedEl.childNodes.length > 0) {
      cloneParent.appendChild(clonedEl);
    }
  }
}

function cloneVisibleDocument(doc: Document, baseUrl: string): Document {
  const cleanDoc = doc.implementation.createHTMLDocument(doc.title);

  if (baseUrl) {
    const baseEl = cleanDoc.createElement('base');
    baseEl.setAttribute('href', baseUrl);
    cleanDoc.head.appendChild(baseEl);
  }

  if (doc.body && cleanDoc.body) {
    cloneVisibleChildren(doc.body, cleanDoc.body, cleanDoc, doc.defaultView, false);
  }

  return cleanDoc;
}

function copyCodeAttributes(source: Element, target: Element): void {
  for (const attr of ['class', 'data-lang', 'data-language']) {
    const value = source.getAttribute(attr);
    if (value) {
      target.setAttribute(attr, value);
    }
  }
}

function wrapInCodeAncestor(
  doc: Document,
  fragment: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const preAncestor = ancestorEl.closest('pre');
  if (!preAncestor || fragment.querySelector('pre')) {
    return null;
  }

  const pre = doc.createElement('pre');
  copyCodeAttributes(preAncestor, pre);

  const codeAncestor = ancestorEl.closest('code');
  if (codeAncestor && preAncestor.contains(codeAncestor) && !fragment.querySelector('code')) {
    const code = doc.createElement('code');
    copyCodeAttributes(codeAncestor, code);
    code.appendChild(fragment);
    pre.appendChild(code);
  } else {
    pre.appendChild(fragment);
  }

  return pre;
}

function wrapInTableAncestor(
  doc: Document,
  fragment: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const tableAncestor = ancestorEl.closest('table');
  if (!tableAncestor || fragment.querySelector('table')) {
    return null;
  }

  const hasRow = Array.from(fragment.children).some((el) => el.tagName === 'TR');
  const hasCell = Array.from(fragment.children).some(
    (el) => el.tagName === 'TD' || el.tagName === 'TH'
  );

  if (!hasRow && !hasCell) {
    return null;
  }

  const table = doc.createElement('table');
  const tbody = doc.createElement('tbody');

  if (hasCell && !hasRow) {
    const tr = doc.createElement('tr');
    tr.appendChild(fragment);
    tbody.appendChild(tr);
  } else {
    tbody.appendChild(fragment);
  }

  table.appendChild(tbody);
  return table;
}

function wrapInListAncestor(
  doc: Document,
  fragment: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const listAncestor = ancestorEl.closest('ol, ul');
  if (!listAncestor || fragment.querySelector('ol, ul')) {
    return null;
  }

  const hasListItem = Array.from(fragment.children).some((el) => el.tagName === 'LI');
  if (!hasListItem) {
    return null;
  }

  const list = doc.createElement(listAncestor.tagName.toLowerCase());
  list.appendChild(fragment);
  return list;
}

function wrapInBlockquoteAncestor(
  doc: Document,
  fragment: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const quoteAncestor = ancestorEl.closest('blockquote');
  if (!quoteAncestor || fragment.querySelector('blockquote')) {
    return null;
  }

  const quote = doc.createElement('blockquote');
  quote.appendChild(fragment);
  return quote;
}

function wrapSelectionFragment(
  doc: Document,
  fragment: DocumentFragment,
  commonAncestor: Node
): Node {
  const ancestorEl =
    commonAncestor.nodeType === Node.ELEMENT_NODE
      ? (commonAncestor as Element)
      : commonAncestor.parentElement;

  if (!ancestorEl) {
    return fragment;
  }

  return (
    wrapInCodeAncestor(doc, fragment, ancestorEl) ??
    wrapInTableAncestor(doc, fragment, ancestorEl) ??
    wrapInListAncestor(doc, fragment, ancestorEl) ??
    wrapInBlockquoteAncestor(doc, fragment, ancestorEl) ??
    fragment
  );
}

function extractSelectionHtml(doc: Document, baseUrl: string): string | null {
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  if (!selection.toString().trim()) {
    return null;
  }

  const container = doc.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    if (i > 0) {
      container.appendChild(doc.createElement('br'));
    }
    const range = selection.getRangeAt(i);
    const wrapped = wrapSelectionFragment(
      doc,
      range.cloneContents(),
      range.commonAncestorContainer
    );
    container.appendChild(wrapped);
  }

  container.querySelectorAll(NON_CONTENT_SELECTORS).forEach((el) => el.remove());
  resolveRelativeLinks(container, baseUrl);

  const html = container.innerHTML.trim();
  return html.length > 0 ? html : null;
}

function resolveFallbackRoot(doc: Document): Element | null {
  const mainEl = doc.querySelector('main, [role="main"]');
  if (mainEl) {
    return mainEl;
  }

  const articles = doc.querySelectorAll('article');
  if (articles.length === 1) {
    return articles[0] ?? null;
  }

  return doc.body;
}

function extractFallbackHtml(cleanDoc: Document, baseUrl: string): string {
  const root = resolveFallbackRoot(cleanDoc);
  if (!root) {
    return '';
  }

  root.querySelectorAll(FALLBACK_LANDMARK_NOISE_SELECTORS).forEach((el) => el.remove());

  if (root === cleanDoc.body) {
    for (const chrome of root.querySelectorAll('header, footer')) {
      if (!chrome.closest('article, main, section')) {
        chrome.remove();
      }
    }
  }

  resolveRelativeLinks(root, baseUrl);
  return root.innerHTML;
}

function tryExtractWithReadability(
  cleanDoc: Document,
  url: string,
  docTitle: string
): ExtractedDocument | null {
  const readabilityDoc = cleanDoc.cloneNode(true) as Document;
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

  const textLength = article?.textContent?.trim().length ?? 0;
  if (!article?.content || textLength < MIN_READABILITY_TEXT_CHARS) {
    return null;
  }

  return createExtractedDocument(
    resolveDocumentTitle(article.title, docTitle),
    url,
    article.content,
    'readability'
  );
}

export function extractDocumentContent(
  doc: Document,
  mode: ExtractMode = 'auto'
): ExtractedDocument {
  const url = resolveDocumentUrl(doc);
  const baseUrl = resolveBaseUrl(doc, url);
  const docTitle = normalizeTitle(doc.title);

  if (mode === 'selection' || mode === 'auto') {
    const selectionHtml = extractSelectionHtml(doc, baseUrl);
    if (selectionHtml) {
      return createExtractedDocument(docTitle, url, selectionHtml, 'selection');
    }
    if (mode === 'selection') {
      return createExtractedDocument(docTitle, url, '', 'selection');
    }
  }

  const cleanDoc = cloneVisibleDocument(doc, baseUrl);
  const readabilityResult = tryExtractWithReadability(cleanDoc, url, docTitle);
  if (readabilityResult) {
    return readabilityResult;
  }

  return createExtractedDocument(
    docTitle,
    url,
    extractFallbackHtml(cleanDoc, baseUrl),
    'fallback'
  );
}
