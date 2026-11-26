import {
  copyCodeAttributes,
  createCodeBlockFromTextarea,
  isReadonlyTextarea,
  normalizePreCodeBlocks,
} from '@/lib/extractor-code';
import {
  HIDDEN_SELECTORS,
  NON_CONTENT_SELECTORS,
  PRUNED_FORM_TAGS,
  preserveTableHeaderButtons,
  resolveRelativeLinks,
  sanitizeClonedAttributes,
} from '@/lib/extractor-dom';
import { createMathPlaceholder } from '@/lib/extractor-math';

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

function wrapInCodeAncestor(
  doc: Document,
  content: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const preAncestor = ancestorEl.closest('pre');
  if (!preAncestor || content.querySelector('pre')) {
    return null;
  }

  const pre = doc.createElement('pre');
  copyCodeAttributes(preAncestor, pre);

  const codeAncestor = ancestorEl.closest('code');
  const hasCode = Boolean(content.querySelector('code'));

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
  content: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const tableAncestor = ancestorEl.closest('table');
  if (!tableAncestor || content.querySelector('table')) {
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
  content: DocumentFragment,
  ancestorEl: Element
): Node | null {
  const listAncestor = ancestorEl.closest('ol, ul');
  if (!listAncestor || content.querySelector('ol, ul')) {
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

export function extractSelectionHtml(doc: Document, baseUrl: string): string | null {
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
