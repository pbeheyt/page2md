import { NON_CONTENT_TAG_SET } from '@/lib/constants';
import {
  ATTACHING_PUNCTUATION_RE,
  DECIMAL_TAIL_RE,
  OPENING_PUNCTUATION_END_RE,
  SIGN_PREFIX_CHAR_RE,
  WORD_OR_DIGIT_START_RE,
} from '@/lib/markdown-syntax';

const CURRENCY_PREFIX_CHAR_RE = /^[$€£¥#@~]$/;

const INLINE_BOUNDARY_TAGS: ReadonlySet<string> = new Set([
  'span',
  'a',
  'time',
  'small',
  'label',
  'data',
  'abbr',
]);

const SUFFIX_ATTACHING_TAGS: ReadonlySet<string> = new Set(['a', 'abbr']);

function getEmphasisGroup(tag: string): 'strong' | 'em' | '' {
  if (tag === 'strong' || tag === 'b') {
    return 'strong';
  }
  if (tag === 'em' || tag === 'i') {
    return 'em';
  }
  return '';
}

function normalizeEdgeChunk(text: string): string {
  return text.replace(/[\u00a0\u200b\ufeff]/g, ' ');
}

function getEdgeText(node: Node, edge: 'leading' | 'trailing'): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeEdgeChunk((node as Text).data);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as Element;
  if (NON_CONTENT_TAG_SET.has(el.tagName.toLowerCase())) {
    return '';
  }
  let child = edge === 'leading' ? el.firstChild : el.lastChild;
  while (child) {
    const chunk = getEdgeText(child, edge);
    if (chunk.length > 0) {
      return chunk;
    }
    child = edge === 'leading' ? child.nextSibling : child.previousSibling;
  }
  return '';
}

function readSingleTokenText(node: Node): string | null {
  let collected = '';
  const stack: Node[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.nodeType === Node.TEXT_NODE) {
      const cleaned = normalizeEdgeChunk((current as Text).data).trim();
      if (cleaned) {
        collected += cleaned;
        if (collected.length > 1) {
          return null;
        }
      }
      continue;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const el = current as Element;
    if (NON_CONTENT_TAG_SET.has(el.tagName.toLowerCase())) {
      continue;
    }
    for (let child = el.lastChild; child; child = child.previousSibling) {
      stack.push(child);
    }
  }

  return collected.length === 1 ? collected : null;
}

function hasPreviousNonWhitespaceContent(children: readonly Node[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const text = getEdgeText(children[i]!, 'trailing');
    if (text.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function isInlineBoundaryPair(leftTag: string, rightTag: string): boolean {
  if (INLINE_BOUNDARY_TAGS.has(leftTag) || INLINE_BOUNDARY_TAGS.has(rightTag)) {
    return true;
  }
  const leftEmphasis = getEmphasisGroup(leftTag);
  return leftEmphasis !== '' && leftEmphasis === getEmphasisGroup(rightTag);
}

function shouldInsertBoundarySpace(
  left: Node,
  right: Node,
  leftTag: string,
  children: readonly Node[],
  index: number
): boolean {
  const leftEdge = getEdgeText(left, 'trailing');
  const rightEdge = getEdgeText(right, 'leading');
  if (!leftEdge.trim() || !rightEdge.trim()) {
    return false;
  }
  if (/\s$/.test(leftEdge) || /^\s/.test(rightEdge)) {
    return false;
  }
  if (ATTACHING_PUNCTUATION_RE.test(rightEdge) || OPENING_PUNCTUATION_END_RE.test(leftEdge)) {
    return false;
  }
  if (DECIMAL_TAIL_RE.test(leftEdge) && /^\d/.test(rightEdge)) {
    return false;
  }
  if (
    right.nodeType === Node.TEXT_NODE &&
    SUFFIX_ATTACHING_TAGS.has(leftTag) &&
    /^[a-z]/.test(rightEdge)
  ) {
    return false;
  }

  const singleToken = readSingleTokenText(left);
  if (singleToken) {
    if (CURRENCY_PREFIX_CHAR_RE.test(singleToken) && WORD_OR_DIGIT_START_RE.test(rightEdge)) {
      return false;
    }
    if (
      SIGN_PREFIX_CHAR_RE.test(singleToken) &&
      /^\d/.test(rightEdge) &&
      !hasPreviousNonWhitespaceContent(children, index)
    ) {
      return false;
    }
  }

  return true;
}

export function insertInlineBoundaries(root: Element, doc: Document): void {
  const stack: Element[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const tag = current.tagName.toLowerCase();
    if (tag === 'pre' || tag === 'code' || tag === 'table') {
      continue;
    }

    const children = Array.from(current.childNodes);
    for (let i = 0; i < children.length - 1; i++) {
      const left = children[i]!;
      const right = children[i + 1]!;
      if (left.nodeType !== Node.ELEMENT_NODE && right.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const leftTag =
        left.nodeType === Node.ELEMENT_NODE ? (left as Element).tagName.toLowerCase() : '';
      const rightTag =
        right.nodeType === Node.ELEMENT_NODE ? (right as Element).tagName.toLowerCase() : '';
      if (!isInlineBoundaryPair(leftTag, rightTag)) {
        continue;
      }

      if (shouldInsertBoundarySpace(left, right, leftTag, children, i)) {
        current.insertBefore(doc.createTextNode(' '), right);
      }
    }

    for (const child of current.children) {
      stack.push(child);
    }
  }
}
