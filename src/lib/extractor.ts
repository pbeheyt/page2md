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
  '[inert]',
  '[aria-hidden="true"]',
  '.sr-only',
  '.visually-hidden',
  'dialog:not([open])',
].join(', ');

const PRUNED_FORM_TAGS: ReadonlySet<string> = new Set([
  'select',
  'datalist',
  'progress',
  'meter',
]);

const CHROME_ROLE_SELECTORS = [
  '[role="navigation"]',
  '[role="search"]',
  '[role="menubar"]',
  '[role="menu"]',
  '[role="toolbar"]',
  '[role="listbox"]',
].join(', ');

const FALLBACK_LANDMARK_NOISE_SELECTORS = [
  'nav',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="search"]',
  '[role="menubar"]',
  '[role="menu"]',
  '[role="toolbar"]',
  '[role="listbox"]',
].join(', ');

const PRUNABLE_EMPTY_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'span',
  'section',
  'article',
  'li',
  'ul',
  'ol',
  'header',
  'footer',
  'figure',
  'figcaption',
  'aside',
  'nav',
  'label',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const NON_CONTENT_SELECTORS = [...NON_CONTENT_TAGS, HIDDEN_SELECTORS].join(', ');

const SKIPPED_HREF_PROTOCOL_RE = /^(?:javascript|mailto|tel|data):/i;
const WORD_TOKEN_RE = /[\p{L}\p{N}]/u;
const MIN_READABILITY_TEXT_CHARS = 120;
const MAX_ACTION_BUTTON_TEXT_LEN = 40;
const MIN_MAIN_RETENTION_RATIO = 0.65;
const MIN_BODY_RETENTION_RATIO = 0.55;
const MIN_BODY_STUB_WORDS = 250;
const MIN_BODY_STUB_RATIO = 0.25;

const CODE_BLOCK_LINE_TAGS: ReadonlySet<string> = new Set([
  'div',
  'p',
  'li',
  'tr',
]);

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
  const tag = element.tagName.toLowerCase();
  return (
    NON_CONTENT_TAG_SET.has(tag) ||
    PRUNED_FORM_TAGS.has(tag) ||
    element.matches(HIDDEN_SELECTORS)
  );
}

function hasMeaningfulContent(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child as Text).data.trim().length > 0) {
        return true;
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      return true;
    }
  }
  return false;
}

function extractMathLatex(mathEl: Element): { tex: string; block: boolean } | null {
  let rawTex = '';
  const annotation = mathEl.querySelector('annotation[encoding*="tex" i]');
  if (annotation?.textContent?.trim()) {
    rawTex = annotation.textContent.trim();
  }

  if (!rawTex) {
    const dataMw = mathEl.getAttribute('data-mw');
    if (dataMw) {
      try {
        const parsed = JSON.parse(dataMw) as { body?: { extsrc?: string } };
        if (typeof parsed.body?.extsrc === 'string' && parsed.body.extsrc.trim()) {
          rawTex = parsed.body.extsrc.trim();
        }
      } catch {
      }
    }
  }

  if (!rawTex) {
    rawTex = mathEl.getAttribute('alttext')?.trim() ?? '';
  }

  if (!rawTex) {
    rawTex = mathEl.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  if (!rawTex) {
    return null;
  }

  const tex = rawTex
    .replace(/^\{\\displaystyle\s+([\s\S]+)\}$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!tex) {
    return null;
  }

  const displayAttr = mathEl.getAttribute('display')?.toLowerCase();
  const className = mathEl.getAttribute('class') ?? '';
  const block =
    displayAttr === 'block' ||
    /\b(?:mwe-math-element-block|katex-display)\b/.test(className);

  return { tex, block };
}

function createMathPlaceholder(
  mathEl: Element,
  targetDoc: Document
): Element | null {
  const extracted = extractMathLatex(mathEl);
  if (!extracted) {
    return null;
  }
  const span = targetDoc.createElement('span');
  span.setAttribute('data-page2md-math', extracted.block ? 'block' : 'inline');
  span.textContent = extracted.tex;
  return span;
}

function isReadonlyTextarea(el: Element): boolean {
  return (
    el.hasAttribute('readonly') ||
    el.getAttribute('aria-readonly')?.toLowerCase() === 'true'
  );
}

function createCodeBlockFromTextarea(
  textareaEl: Element,
  targetDoc: Document
): Element | null {
  const rawCode =
    ('value' in textareaEl && typeof textareaEl.value === 'string'
      ? textareaEl.value
      : textareaEl.textContent) ?? '';
  if (!rawCode.trim()) {
    return null;
  }

  const pre = targetDoc.createElement('pre');
  const code = targetDoc.createElement('code');
  copyCodeAttributes(textareaEl, code);
  code.textContent = rawCode.replace(/\r\n/g, '\n');
  pre.appendChild(code);
  return pre;
}

function cloneVisibleChildren(
  liveParent: Element,
  cloneParent: Element,
  targetDoc: Document,
  win: Window | null,
  parentVisibilityHidden: boolean,
  insidePre = false
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
    const tag = liveEl.tagName.toLowerCase();

    if (tag === 'math') {
      const placeholder = createMathPlaceholder(liveEl, targetDoc);
      if (placeholder) {
        cloneParent.appendChild(placeholder);
      }
      continue;
    }

    if (tag === 'textarea') {
      if (isReadonlyTextarea(liveEl)) {
        const codeBlock = createCodeBlockFromTextarea(liveEl, targetDoc);
        if (codeBlock) {
          cloneParent.appendChild(codeBlock);
        }
      }
      continue;
    }

    if (shouldPruneElement(liveEl)) {
      continue;
    }

    let isVisibilityHidden = parentVisibilityHidden;
    if (win?.getComputedStyle) {
      const style = win.getComputedStyle(liveEl);
      if (style.display === 'none' || style.visibility === 'collapse') {
        if (
          liveEl.children.length === 1 &&
          liveEl.firstElementChild?.tagName.toLowerCase() === 'math'
        ) {
          const placeholder = createMathPlaceholder(
            liveEl.firstElementChild,
            targetDoc
          );
          if (placeholder) {
            cloneParent.appendChild(placeholder);
          }
        }
        continue;
      }
      if (style.visibility === 'hidden') {
        isVisibilityHidden = true;
      } else if (style.visibility === 'visible') {
        isVisibilityHidden = false;
      }
    }

    const nextInsidePre = insidePre || tag === 'pre' || tag === 'code';
    const clonedEl = targetDoc.importNode(liveEl, false) as Element;
    cloneVisibleChildren(
      liveEl,
      clonedEl,
      targetDoc,
      win,
      isVisibilityHidden,
      nextInsidePre
    );

    if (
      !nextInsidePre &&
      PRUNABLE_EMPTY_CONTAINER_TAGS.has(tag) &&
      !hasMeaningfulContent(clonedEl)
    ) {
      continue;
    }

    if (!isVisibilityHidden || clonedEl.childNodes.length > 0) {
      cloneParent.appendChild(clonedEl);
    }
  }
}

function collectPreText(node: Node, chunks: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    chunks.push((node as Text).data);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') {
    return;
  }
  if (tag === 'br') {
    chunks.push('\n');
    return;
  }
  const beforeLen = chunks.length;
  for (const child of el.childNodes) {
    collectPreText(child, chunks);
  }
  if (CODE_BLOCK_LINE_TAGS.has(tag) && chunks.length > beforeLen) {
    const last = chunks[chunks.length - 1] ?? '';
    if (!last.endsWith('\n')) {
      chunks.push('\n');
    }
  }
}

function normalizePreCodeBlocks(root: ParentNode, doc: Document): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const codeEl = pre.querySelector('code');
    const sourceEl = codeEl ?? pre;
    const chunks: string[] = [];
    collectPreText(sourceEl, chunks);
    const normalized = chunks.join('').replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (!normalized.trim()) {
      continue;
    }

    const cleanCode = doc.createElement('code');
    if (codeEl) {
      copyCodeAttributes(codeEl, cleanCode);
    } else {
      copyCodeAttributes(pre, cleanCode);
    }
    cleanCode.textContent = normalized;
    pre.textContent = '';
    pre.appendChild(cleanCode);
  }
}

function preserveTableHeaderButtons(root: ParentNode, doc: Document): void {
  const buttons = Array.from(
    root.querySelectorAll('th button, [role="columnheader"] button')
  );
  for (const button of buttons) {
    const label = button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!label) {
      button.remove();
      continue;
    }
    const span = doc.createElement('span');
    span.textContent = label;
    button.replaceWith(span);
  }
}

function pruneActionButtons(root: ParentNode): void {
  const buttons = Array.from(root.querySelectorAll('button'));
  for (const button of buttons) {
    if (button.closest('th, [role="columnheader"], summary, h1, h2, h3, h4, h5, h6')) {
      continue;
    }
    if (button.querySelector('h1, h2, h3, h4, h5, h6, table, p, ul, ol')) {
      continue;
    }
    const label = button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!label || label.length <= MAX_ACTION_BUTTON_TEXT_LEN) {
      button.remove();
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
    preserveTableHeaderButtons(cleanDoc.body, cleanDoc);
    normalizePreCodeBlocks(cleanDoc.body, cleanDoc);
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

interface FallbackExtraction {
  html: string;
  hasExplicitMain: boolean;
  wordCount: number;
  headingCount: number;
  tableCount: number;
  codeBlockCount: number;
}

function countWordsInText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter((token) => WORD_TOKEN_RE.test(token)).length;
}

function countNonEmptyTables(root: ParentNode): number {
  let count = 0;
  for (const table of root.querySelectorAll('table')) {
    if (table.querySelectorAll('tr').length >= 2) {
      count++;
    }
  }
  return count;
}

function countNonEmptyCodeBlocks(root: ParentNode): number {
  let count = 0;
  for (const pre of root.querySelectorAll('pre')) {
    if ((pre.textContent?.trim().length ?? 0) >= 8) {
      count++;
    }
  }
  return count;
}

function resolveFallbackRoot(doc: Document): { root: Element | null; hasExplicitMain: boolean } {
  const mainEl = doc.querySelector('main, [role="main"]');
  if (mainEl) {
    return { root: mainEl, hasExplicitMain: true };
  }

  const articles = doc.querySelectorAll('article');
  if (articles.length === 1) {
    return { root: articles[0] ?? null, hasExplicitMain: false };
  }

  return { root: doc.body, hasExplicitMain: false };
}

function extractFallback(cleanDoc: Document, baseUrl: string): FallbackExtraction {
  const fallbackDoc = cleanDoc.cloneNode(true) as Document;
  const { root, hasExplicitMain } = resolveFallbackRoot(fallbackDoc);
  if (!root) {
    return {
      html: '',
      hasExplicitMain: false,
      wordCount: 0,
      headingCount: 0,
      tableCount: 0,
      codeBlockCount: 0,
    };
  }

  root.querySelectorAll(FALLBACK_LANDMARK_NOISE_SELECTORS).forEach((el) => el.remove());

  if (root === fallbackDoc.body) {
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
    wordCount: countWordsInText(root.textContent ?? ''),
    headingCount: root.querySelectorAll('h1, h2, h3').length,
    tableCount: countNonEmptyTables(root),
    codeBlockCount: countNonEmptyCodeBlocks(root),
  };
}

interface ReadabilityExtraction {
  doc: ExtractedDocument;
  wordCount: number;
  headingCount: number;
  tableCount: number;
  codeBlockCount: number;
}

function tryExtractWithReadability(
  cleanDoc: Document,
  url: string,
  docTitle: string
): ReadabilityExtraction | null {
  const readabilityDoc = cleanDoc.cloneNode(true) as Document;
  readabilityDoc.body
    ?.querySelectorAll(CHROME_ROLE_SELECTORS)
    .forEach((el) => el.remove());

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

  const measureDoc = cleanDoc.implementation.createHTMLDocument('');
  measureDoc.body.innerHTML = article.content;

  return {
    doc: createExtractedDocument(
      resolveDocumentTitle(article.title, docTitle),
      url,
      article.content,
      'readability'
    ),
    wordCount: countWordsInText(textContent),
    headingCount: measureDoc.body.querySelectorAll('h1, h2, h3').length,
    tableCount: countNonEmptyTables(measureDoc.body),
    codeBlockCount: countNonEmptyCodeBlocks(measureDoc.body),
  };
}

function shouldPreferFallbackOverReadability(
  readability: ReadabilityExtraction,
  fallback: FallbackExtraction
): boolean {
  if (!fallback.html.trim() || fallback.wordCount === 0) {
    return false;
  }

  if (fallback.hasExplicitMain && fallback.wordCount >= 80) {
    if (readability.wordCount < fallback.wordCount * MIN_MAIN_RETENTION_RATIO) {
      return true;
    }
    if (
      fallback.codeBlockCount > 0 &&
      readability.codeBlockCount < fallback.codeBlockCount * 0.5
    ) {
      return true;
    }
    if (
      fallback.tableCount > 0 &&
      readability.tableCount < fallback.tableCount * 0.5 &&
      readability.wordCount < fallback.wordCount * 0.85
    ) {
      return true;
    }
    if (
      fallback.headingCount >= 4 &&
      readability.headingCount < fallback.headingCount * 0.4
    ) {
      return true;
    }
    return false;
  }

  if (
    fallback.codeBlockCount >= 2 &&
    readability.codeBlockCount < fallback.codeBlockCount * 0.5
  ) {
    return true;
  }

  if (
    fallback.wordCount >= 300 &&
    readability.wordCount < fallback.wordCount * MIN_BODY_RETENTION_RATIO &&
    ((fallback.headingCount >= 5 &&
      readability.headingCount < fallback.headingCount * 0.35) ||
      (fallback.tableCount > 0 &&
        readability.tableCount < fallback.tableCount * 0.5) ||
      (readability.wordCount < MIN_BODY_STUB_WORDS &&
        readability.wordCount < fallback.wordCount * MIN_BODY_STUB_RATIO))
  ) {
    return true;
  }

  return false;
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
  const fallback = extractFallback(cleanDoc, baseUrl);
  const readability = tryExtractWithReadability(cleanDoc, url, docTitle);

  if (readability && !shouldPreferFallbackOverReadability(readability, fallback)) {
    return readability.doc;
  }

  return createExtractedDocument(docTitle, url, fallback.html, 'fallback');
}
