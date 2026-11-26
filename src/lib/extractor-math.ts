import { MATH_PLACEHOLDER_ATTR } from '@/lib/constants';
import { collapseWhitespace } from '@/lib/text';

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

function readDataMwTex(mathEl: Element): string {
  const dataMwHost = mathEl.hasAttribute('data-mw')
    ? mathEl
    : mathEl.closest('[data-mw]');
  const dataMw = dataMwHost?.getAttribute('data-mw');
  if (!dataMw) {
    return '';
  }

  try {
    const parsed: unknown = JSON.parse(dataMw);
    if (typeof parsed !== 'object' || parsed === null || !('body' in parsed)) {
      return '';
    }
    const body = (parsed as { body?: unknown }).body;
    if (typeof body !== 'object' || body === null || !('extsrc' in body)) {
      return '';
    }
    const extsrc = (body as { extsrc?: unknown }).extsrc;
    return typeof extsrc === 'string' ? extsrc.trim() : '';
  } catch (error) {
    console.debug('[page2md] Malformed data-mw JSON on math element:', error);
    return '';
  }
}

function readRawMathTex(mathEl: Element): string {
  const annotation = mathEl.querySelector('annotation[encoding*="tex" i]');
  const annotationTex = annotation?.textContent?.trim();
  if (annotationTex) {
    return annotationTex;
  }

  const dataMwTex = readDataMwTex(mathEl);
  if (dataMwTex) {
    return dataMwTex;
  }

  const altTex = mathEl.getAttribute('alttext')?.trim();
  if (altTex) {
    return altTex;
  }

  return collapseWhitespace(mathEl.textContent ?? '');
}

function isBlockMathElement(mathEl: Element): boolean {
  const displayAttr = mathEl.getAttribute('display')?.toLowerCase();
  const className = mathEl.getAttribute('class') ?? '';
  return (
    displayAttr === 'block' ||
    /\b(?:mwe-math-element-block|katex-display)\b/.test(className) ||
    Boolean(mathEl.closest('.mwe-math-element-block, .katex-display'))
  );
}

function normalizeMathTex(rawTex: string, block: boolean): string {
  const stripped = stripOuterDisplaystyle(rawTex);
  return block
    ? stripped.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
    : collapseWhitespace(stripped);
}

function extractMathLatex(mathEl: Element): { tex: string; block: boolean } | null {
  const rawTex = readRawMathTex(mathEl);
  if (!rawTex) {
    return null;
  }

  const block = isBlockMathElement(mathEl);
  const tex = normalizeMathTex(rawTex, block);
  return tex ? { tex, block } : null;
}

export function createMathPlaceholder(
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

export function appendMathPlaceholder(
  mathEl: Element,
  cloneParent: Element,
  targetDoc: Document
): void {
  const placeholder = createMathPlaceholder(mathEl, targetDoc);
  if (placeholder) {
    cloneParent.appendChild(placeholder);
  }
}

export function appendDirectA11yMath(
  liveEl: Element,
  cloneParent: Element,
  targetDoc: Document
): void {
  if (
    liveEl.children.length === 1 &&
    liveEl.firstElementChild?.tagName.toLowerCase() === 'math'
  ) {
    appendMathPlaceholder(liveEl.firstElementChild, cloneParent, targetDoc);
  }
}
