import { CODE_LANG_ATTRIBUTES, MAX_DOM_DEPTH } from '@/lib/constants';

const CODE_BLOCK_LINE_TAGS: ReadonlySet<string> = new Set([
  'div',
  'p',
  'li',
  'tr',
]);

export function copyCodeAttributes(source: Element, target: Element): void {
  for (const attr of CODE_LANG_ATTRIBUTES) {
    const value = source.getAttribute(attr);
    if (value) {
      target.setAttribute(attr, value);
    }
  }
}

export function isReadonlyTextarea(el: Element): boolean {
  return (
    el.hasAttribute('readonly') ||
    el.getAttribute('aria-readonly')?.toLowerCase() === 'true'
  );
}

export function createCodeBlockFromTextarea(
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
    if (chunks.length === beforeLen || !last.endsWith('\n')) {
      chunks.push('\n');
    }
  }
}

function extractNormalizedPreText(el: Element): string {
  const chunks: string[] = [];
  collectPreText(el, chunks);
  return chunks.join('').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

export function normalizePreCodeBlocks(root: ParentNode, doc: Document): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const codeEls = Array.from(pre.querySelectorAll('code')).filter(
      (codeEl) => codeEl.parentElement?.closest('code') === null
    );

    const primaryCodeEl = codeEls[0] ?? null;
    const normalized =
      codeEls.length > 1
        ? codeEls.map(extractNormalizedPreText).join('\n')
        : extractNormalizedPreText(primaryCodeEl ?? pre);

    if (!normalized.trim()) {
      pre.remove();
      continue;
    }

    const cleanCode = doc.createElement('code');
    copyCodeAttributes(primaryCodeEl ?? pre, cleanCode);
    cleanCode.textContent = normalized;
    pre.textContent = '';
    pre.appendChild(cleanCode);
  }
}
