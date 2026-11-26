import { Readability } from '@mozilla/readability';
import {
  CODE_LANG_ATTRIBUTES,
  countWords,
  MATH_PLACEHOLDER_ATTR,
  NON_CONTENT_TAG_SET,
  NON_CONTENT_TAGS,
} from '@/lib/constants';
import { resolveSafeHttpUrl } from '@/lib/url';

export { NON_CONTENT_TAG_SET, NON_CONTENT_TAGS };

export type ExtractMode = 'auto' | 'page' | 'selection';

export interface ExtractedDocument {
  title: string;
  url: string;
  html: string;
  source: 'selection' | 'readability' | 'fallback';
}

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

const CHROME_ROLE_ITEMS = [
  '[role="navigation"]',
  '[role="search"]',
  '[role="menubar"]',
  '[role="menu"]',
  '[role="toolbar"]',
  '[role="listbox"]',
] as const;

const CHROME_ROLE_SELECTORS = CHROME_ROLE_ITEMS.join(', ');

const FALLBACK_LANDMARK_NOISE_SELECTORS = [
  'nav',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  ...CHROME_ROLE_ITEMS,
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

const CODE_BLOCK_LINE_TAGS: ReadonlySet<string> = new Set([
  'div',
  'p',
  'li',
  'tr',
]);

const BLOCK_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'section',
  'article',
  'table',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const NON_CONTENT_SELECTORS = [...NON_CONTENT_TAGS, HIDDEN_SELECTORS].join(', ');
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const MAX_DOM_DEPTH = 128;
const MIN_READABILITY_TEXT_CHARS = 120;
const MIN_CODE_BLOCK_CHARS = 8;
const MAX_ACTION_BUTTON_TEXT_LEN = 40;
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

function resolveRelativeLinks(root: ParentNode, baseUrl: string): void {
  if (!baseUrl) {
    return;
  }
  for (const anchor of root.querySelectorAll('a[href]')) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) {
      continue;
    }
    const resolved = resolveSafeHttpUrl(rawHref, baseUrl);
    if (resolved) {
      anchor.setAttribute('href', resolved);
    } else if (!rawHref.trim().startsWith('#')) {
      anchor.removeAttribute('href');
    }
  }
}

function sanitizeClonedAttributes(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const lowerName = attr.name.toLowerCase();
    if (lowerName.startsWith('on') || lowerName === MATH_PLACEHOLDER_ATTR) {
      el.removeAttribute(attr.name);
    }
  }
}

function shouldPruneElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return (
    NON_CONTENT_TAG_SET.has(tag) ||
    PRUNED_FORM_TAGS.has(tag) ||
    element.matches(HIDDEN_SELECTORS) ||
    element.matches(CHROME_ROLE_SELECTORS)
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

function stripOuterDisplaystyle(rawTex: string): string {
  const trimmed = rawTex.trim();
  const prefixMatch = trimmed.match(/^\{\\displaystyle\s+/);
  if (!prefixMatch || !trimmed.endsWith('}')) {
    return trimmed;
  }

  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && i < trimmed.length - 1) {
        return trimmed;
      }
    }
  }

  if (depth !== 0) {
    return trimmed;
  }
  return trimmed.slice(prefixMatch[0].length, -1).trim();
}

function extractMathLatex(mathEl: Element): { tex: string; block: boolean } | null {
  let rawTex = '';
  const annotation = mathEl.querySelector('annotation[encoding*="tex" i]');
  if (annotation?.textContent?.trim()) {
    rawTex = annotation.textContent.trim();
  }

  if (!rawTex) {
    const dataMwHost = mathEl.hasAttribute('data-mw')
      ? mathEl
      : mathEl.closest('[data-mw]');
    const dataMw = dataMwHost?.getAttribute('data-mw');
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

  const displayAttr = mathEl.getAttribute('display')?.toLowerCase();
  const className = mathEl.getAttribute('class') ?? '';
  const block =
    displayAttr === 'block' ||
    /\b(?:mwe-math-element-block|katex-display)\b/.test(className) ||
    Boolean(mathEl.closest('.mwe-math-element-block, .katex-display'));

  const stripped = stripOuterDisplaystyle(rawTex);
  const tex = block
    ? stripped.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
    : stripped.replace(/\s+/g, ' ').trim();
  if (!tex) {
    return null;
  }

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
  span.setAttribute(MATH_PLACEHOLDER_ATTR, extracted.block ? 'block' : 'inline');
  span.textContent = extracted.tex;
  return span;
}

function getDirectA11yMathChild(el: Element): Element | null {
  if (
    el.children.length === 1 &&
    el.firstElementChild?.tagName.toLowerCase() === 'math'
  ) {
    return el.firstElementChild;
  }
  return null;
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
  insidePre = false,
  depth = 0
): void {
  if (depth >= MAX_DOM_DEPTH) {
    return;
  }

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
      if (!parentVisibilityHidden) {
        const placeholder = createMathPlaceholder(liveEl, targetDoc);
        if (placeholder) {
          cloneParent.appendChild(placeholder);
        }
      }
      continue;
    }

    if (shouldPruneElement(liveEl)) {
      if (!parentVisibilityHidden && (liveEl.matches('.sr-only, .visually-hidden'))) {
        const a11yMath = getDirectA11yMathChild(liveEl);
        if (a11yMath) {
          const placeholder = createMathPlaceholder(a11yMath, targetDoc);
          if (placeholder) {
            cloneParent.appendChild(placeholder);
          }
        }
      }
      continue;
    }

    let isVisibilityHidden = parentVisibilityHidden;
    if (win?.getComputedStyle) {
      const style = win.getComputedStyle(liveEl);
      if (style.display === 'none' || style.visibility === 'collapse') {
        if (!parentVisibilityHidden) {
          const a11yMath = getDirectA11yMathChild(liveEl);
          if (a11yMath) {
            const placeholder = createMathPlaceholder(a11yMath, targetDoc);
            if (placeholder) {
              cloneParent.appendChild(placeholder);
            }
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

    if (tag === 'textarea') {
      if (!isVisibilityHidden && isReadonlyTextarea(liveEl)) {
        const codeBlock = createCodeBlockFromTextarea(liveEl, targetDoc);
        if (codeBlock) {
          cloneParent.appendChild(codeBlock);
        }
      }
      continue;
    }

    const nextInsidePre = insidePre || tag === 'pre' || tag === 'code';
    const clonedEl = targetDoc.importNode(liveEl, false) as Element;
    sanitizeClonedAttributes(clonedEl);
    cloneVisibleChildren(
      liveEl,
      clonedEl,
      targetDoc,
      win,
      isVisibilityHidden,
      nextInsidePre,
      depth + 1
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

function collectPreText(node: Node, chunks: string[], depth = 0): void {
  if (depth >= MAX_DOM_DEPTH) {
    return;
  }
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
    collectPreText(child, chunks, depth + 1);
  }
  if (tag === 'td' || tag === 'th') {
    if (chunks.length > beforeLen) {
      const last = chunks[chunks.length - 1] ?? '';
      if (!/\s$/.test(last)) {
        chunks.push(' ');
      }
    }
    return;
  }
  if (CODE_BLOCK_LINE_TAGS.has(tag)) {
    const last = chunks[chunks.length - 1] ?? '';
    if (chunks.length === beforeLen) {
      chunks.push('\n');
    } else if (!last.endsWith('\n')) {
      chunks.push('\n');
    }
  }
}

function normalizePreCodeBlocks(root: ParentNode, doc: Document): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const codeEls = Array.from(pre.querySelectorAll('code')).filter(
      (codeEl) => codeEl.parentElement?.closest('code') === null
    );

    let normalized: string;
    const primaryCodeEl = codeEls[0] ?? null;

    if (codeEls.length > 1) {
      const lines = codeEls.map((codeEl) => {
        const chunks: string[] = [];
        collectPreText(codeEl, chunks);
        return chunks.join('').replace(/\r\n/g, '\n').replace(/\n$/, '');
      });
      normalized = lines.join('\n');
    } else {
      const sourceEl = primaryCodeEl ?? pre;
      const chunks: string[] = [];
      collectPreText(sourceEl, chunks);
      normalized = chunks.join('').replace(/\r\n/g, '\n').replace(/\n$/, '');
    }

    if (!normalized.trim()) {
      pre.remove();
      continue;
    }

    const cleanCode = doc.createElement('code');
    if (primaryCodeEl) {
      copyCodeAttributes(primaryCodeEl, cleanCode);
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
    if (button.querySelector(`[${MATH_PLACEHOLDER_ATTR}]`)) {
      const span = doc.createElement('span');
      while (button.firstChild) {
        span.appendChild(button.firstChild);
      }
      button.replaceWith(span);
      continue;
    }
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

function copyTitleMetadata(sourceDoc: Document, targetDoc: Document): void {
  if (!sourceDoc.head || !targetDoc.head) {
    return;
  }
  const metaSelector =
    'meta[property="og:title"], meta[name="twitter:title"], meta[name="description"], meta[property="og:description"]';
  for (const meta of sourceDoc.head.querySelectorAll(metaSelector)) {
    const cloned = targetDoc.importNode(meta, false) as Element;
    sanitizeClonedAttributes(cloned);
    targetDoc.head.appendChild(cloned);
  }
}

function cloneVisibleDocument(doc: Document, baseUrl: string): Document {
  const cleanDoc = doc.implementation.createHTMLDocument(doc.title);

  if (baseUrl) {
    const baseEl = cleanDoc.createElement('base');
    baseEl.setAttribute('href', baseUrl);
    cleanDoc.head.appendChild(baseEl);
  }
  copyTitleMetadata(doc, cleanDoc);

  if (doc.body && cleanDoc.body) {
    cloneVisibleChildren(doc.body, cleanDoc.body, cleanDoc, doc.defaultView, false);
    preserveTableHeaderButtons(cleanDoc.body, cleanDoc);
    normalizePreCodeBlocks(cleanDoc.body, cleanDoc);
  }

  return cleanDoc;
}

function copyCodeAttributes(source: Element, target: Element): void {
  for (const attr of CODE_LANG_ATTRIBUTES) {
    const value = source.getAttribute(attr);
    if (value) {
      target.setAttribute(attr, value);
    }
  }
}

function wrapInCodeAncestor(
  doc: Document,
  content: Node,
  ancestorEl: Element
): Node | null {
  const preAncestor = ancestorEl.closest('pre');
  if (!preAncestor || (content instanceof DocumentFragment && content.querySelector('pre'))) {
    return null;
  }

  const pre = doc.createElement('pre');
  copyCodeAttributes(preAncestor, pre);

  const codeAncestor = ancestorEl.closest('code');
  const hasCode =
    content instanceof DocumentFragment
      ? Boolean(content.querySelector('code'))
      : content instanceof Element && content.tagName.toLowerCase() === 'code';

  if (codeAncestor && preAncestor.contains(codeAncestor) && !hasCode) {
    const code = doc.createElement('code');
    copyCodeAttributes(codeAncestor, code);
    code.appendChild(content);
    pre.appendChild(code);
  } else {
    pre.appendChild(content);
  }

  return pre;
}

function wrapInTableAncestor(
  doc: Document,
  content: Node,
  ancestorEl: Element
): Node | null {
  const tableAncestor = ancestorEl.closest('table');
  if (!tableAncestor || !(content instanceof DocumentFragment) || content.querySelector('table')) {
    return null;
  }

  const childTags = Array.from(content.children, (el) => el.tagName.toLowerCase());
  const hasSection = childTags.some(
    (tag) => tag === 'thead' || tag === 'tbody' || tag === 'tfoot'
  );
  const hasRow = childTags.some((tag) => tag === 'tr');
  const hasCell = childTags.some((tag) => tag === 'td' || tag === 'th');

  if (!hasSection && !hasRow && !hasCell) {
    return null;
  }

  const table = doc.createElement('table');
  if (hasSection) {
    table.appendChild(content);
    return table;
  }

  const tbody = doc.createElement('tbody');
  if (hasCell && !hasRow) {
    const tr = doc.createElement('tr');
    tr.appendChild(content);
    tbody.appendChild(tr);
  } else {
    tbody.appendChild(content);
  }

  table.appendChild(tbody);
  return table;
}

function wrapInListAncestor(
  doc: Document,
  content: Node,
  ancestorEl: Element
): Node | null {
  const listAncestor = ancestorEl.closest('ol, ul');
  if (!listAncestor || !(content instanceof DocumentFragment) || content.querySelector('ol, ul')) {
    return null;
  }

  const hasListItem = Array.from(content.children).some(
    (el) => el.tagName.toLowerCase() === 'li'
  );
  if (!hasListItem) {
    return null;
  }

  const tag = listAncestor.tagName.toLowerCase();
  const list = doc.createElement(tag);
  if (tag === 'ol') {
    const startAttr = listAncestor.getAttribute('start');
    if (startAttr) {
      list.setAttribute('start', startAttr);
    }
  }
  list.appendChild(content);
  return list;
}

function wrapInBlockquoteAncestor(
  doc: Document,
  content: Node,
  ancestorEl: Element
): Node | null {
  const quoteAncestor = ancestorEl.closest('blockquote');
  if (!quoteAncestor) {
    return null;
  }
  const hasQuote =
    content instanceof DocumentFragment
      ? Boolean(content.querySelector('blockquote'))
      : content instanceof Element && content.tagName.toLowerCase() === 'blockquote';
  if (hasQuote) {
    return null;
  }

  const quote = doc.createElement('blockquote');
  quote.appendChild(content);
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

  let wrapped: Node =
    wrapInCodeAncestor(doc, fragment, ancestorEl) ??
    wrapInTableAncestor(doc, fragment, ancestorEl) ??
    wrapInListAncestor(doc, fragment, ancestorEl) ??
    fragment;

  wrapped = wrapInBlockquoteAncestor(doc, wrapped, ancestorEl) ?? wrapped;
  return wrapped;
}

function isBlockNode(node: Node | null): boolean {
  return (
    node !== null &&
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_ELEMENT_TAGS.has((node as Element).tagName.toLowerCase())
  );
}

function sanitizeSelectionTree(container: Element, doc: Document): void {
  for (const el of container.querySelectorAll('*')) {
    sanitizeClonedAttributes(el);
  }

  for (const mathEl of Array.from(container.querySelectorAll('math'))) {
    const placeholder = createMathPlaceholder(mathEl, doc);
    if (placeholder) {
      mathEl.replaceWith(placeholder);
    } else {
      mathEl.remove();
    }
  }

  for (const ta of Array.from(container.querySelectorAll('textarea'))) {
    if (!ta.matches(HIDDEN_SELECTORS) && isReadonlyTextarea(ta)) {
      const codeBlock = createCodeBlockFromTextarea(ta, doc);
      if (codeBlock) {
        ta.replaceWith(codeBlock);
        continue;
      }
    }
    ta.remove();
  }

  container
    .querySelectorAll(
      [NON_CONTENT_SELECTORS, Array.from(PRUNED_FORM_TAGS).join(', ')].join(', ')
    )
    .forEach((el) => el.remove());

  preserveTableHeaderButtons(container, doc);
  normalizePreCodeBlocks(container, doc);
}

function extractSelectionHtml(doc: Document, baseUrl: string): string | null {
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  if (!selection.toString().trim()) {
    return null;
  }

  const inertDoc = doc.implementation.createHTMLDocument('');
  const container = inertDoc.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const clonedFragment = inertDoc.importNode(range.cloneContents(), true);
    const wrapped = wrapSelectionFragment(
      inertDoc,
      clonedFragment,
      range.commonAncestorContainer
    );
    if (i > 0 && !isBlockNode(container.lastChild) && !isBlockNode(wrapped)) {
      container.appendChild(inertDoc.createElement('br'));
    }
    container.appendChild(wrapped);
  }

  sanitizeSelectionTree(container, inertDoc);
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

function countContentUnits(text: string): number {
  const baseWords = countWords(text);
  const cjkMatches = text.match(CJK_CHAR_RE);
  if (!cjkMatches || cjkMatches.length === 0) {
    return baseWords;
  }
  return Math.max(baseWords, Math.round(cjkMatches.length / 2));
}

function countDirectTableRows(table: Element): number {
  let rows = 0;
  for (const child of table.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') {
      rows++;
    } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const row of child.children) {
        if (row.tagName.toLowerCase() === 'tr') {
          rows++;
        }
      }
    }
  }
  return rows;
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

function resolveFallbackRoot(doc: Document): { root: Element | null; hasExplicitMain: boolean } {
  for (const mainEl of doc.querySelectorAll('main, [role="main"]')) {
    if ((mainEl.textContent?.trim().length ?? 0) > 0) {
      return { root: mainEl, hasExplicitMain: true };
    }
  }

  const articles = doc.querySelectorAll('article');
  if (articles.length === 1 && (articles[0]?.textContent?.trim().length ?? 0) > 0) {
    return { root: articles[0] ?? null, hasExplicitMain: false };
  }

  return { root: doc.body, hasExplicitMain: false };
}

function extractFallback(cleanDoc: Document, baseUrl: string): FallbackExtraction {
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
    wordCount: countContentUnits(root.textContent ?? ''),
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

  return {
    doc: createExtractedDocument(
      resolveDocumentTitle(article.title, docTitle),
      url,
      article.content,
      'readability'
    ),
    wordCount: countContentUnits(textContent),
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

  if (fallback.hasExplicitMain && fallback.wordCount >= MIN_MAIN_FALLBACK_WORDS) {
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
