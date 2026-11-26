import {
  MATH_PLACEHOLDER_ATTR,
  MAX_DOM_DEPTH,
  NON_CONTENT_TAG_SET,
  NON_CONTENT_TAGS,
} from '@/lib/constants';
import {
  createCodeBlockFromTextarea,
  isReadonlyTextarea,
  normalizePreCodeBlocks,
} from '@/lib/extractor-code';
import {
  appendDirectA11yMath,
  appendMathPlaceholder,
} from '@/lib/extractor-math';
import { collapseWhitespace } from '@/lib/text';
import { resolveSafeHttpUrl } from '@/lib/url';

export const HIDDEN_SELECTORS = [
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '.sr-only',
  '.visually-hidden',
  'dialog:not([open])',
].join(', ');

export const PRUNED_FORM_TAGS: ReadonlySet<string> = new Set([
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

export const FALLBACK_LANDMARK_NOISE_SELECTORS = [
  'nav',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  ...CHROME_ROLE_ITEMS,
].join(', ');

export const NON_CONTENT_SELECTORS = [...NON_CONTENT_TAGS, HIDDEN_SELECTORS].join(', ');

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

const MAX_ACTION_BUTTON_TEXT_LEN = 40;

interface CloneContext {
  readonly targetDoc: Document;
  readonly win: Window | null;
}

type ElementVisibility = 'skip' | 'hidden' | 'visible';

export function resolveRelativeLinks(root: ParentNode, baseUrl: string): void {
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

export function sanitizeClonedAttributes(el: Element): void {
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

function resolveElementVisibility(
  liveEl: Element,
  win: Window | null,
  parentHidden: boolean
): ElementVisibility {
  if (!win?.getComputedStyle) {
    return parentHidden ? 'hidden' : 'visible';
  }
  const style = win.getComputedStyle(liveEl);
  if (style.display === 'none' || style.visibility === 'collapse') {
    return 'skip';
  }
  if (style.visibility === 'hidden') {
    return 'hidden';
  }
  if (style.visibility === 'visible') {
    return 'visible';
  }
  return parentHidden ? 'hidden' : 'visible';
}

function shouldDropEmptyContainer(
  tag: string,
  insidePre: boolean,
  clonedEl: Element
): boolean {
  return (
    !insidePre &&
    PRUNABLE_EMPTY_CONTAINER_TAGS.has(tag) &&
    !hasMeaningfulContent(clonedEl)
  );
}

function cloneVisibleChildren(
  liveParent: Element,
  cloneParent: Element,
  ctx: CloneContext,
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
        cloneParent.appendChild(ctx.targetDoc.createTextNode((child as Text).data));
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
        appendMathPlaceholder(liveEl, cloneParent, ctx.targetDoc);
      }
      continue;
    }

    if (shouldPruneElement(liveEl)) {
      if (!parentVisibilityHidden && liveEl.matches('.sr-only, .visually-hidden')) {
        appendDirectA11yMath(liveEl, cloneParent, ctx.targetDoc);
      }
      continue;
    }

    const visibility = resolveElementVisibility(liveEl, ctx.win, parentVisibilityHidden);
    if (visibility === 'skip') {
      if (!parentVisibilityHidden) {
        appendDirectA11yMath(liveEl, cloneParent, ctx.targetDoc);
      }
      continue;
    }

    const isVisibilityHidden = visibility === 'hidden';

    if (tag === 'textarea') {
      if (!isVisibilityHidden && isReadonlyTextarea(liveEl)) {
        const codeBlock = createCodeBlockFromTextarea(liveEl, ctx.targetDoc);
        if (codeBlock) {
          cloneParent.appendChild(codeBlock);
        }
      }
      continue;
    }

    const nextInsidePre = insidePre || tag === 'pre' || tag === 'code';
    const clonedEl = ctx.targetDoc.importNode(liveEl, false) as Element;
    sanitizeClonedAttributes(clonedEl);
    cloneVisibleChildren(
      liveEl,
      clonedEl,
      ctx,
      isVisibilityHidden,
      nextInsidePre,
      depth + 1
    );

    if (shouldDropEmptyContainer(tag, nextInsidePre, clonedEl)) {
      continue;
    }

    if (!isVisibilityHidden || clonedEl.childNodes.length > 0) {
      cloneParent.appendChild(clonedEl);
    }
  }
}

export function preserveTableHeaderButtons(root: ParentNode, doc: Document): void {
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
    const label = collapseWhitespace(button.textContent ?? '');
    if (!label) {
      button.remove();
      continue;
    }
    const span = doc.createElement('span');
    span.textContent = label;
    button.replaceWith(span);
  }
}

export function pruneActionButtons(root: ParentNode): void {
  const buttons = Array.from(root.querySelectorAll('button'));
  for (const button of buttons) {
    if (button.closest('th, [role="columnheader"], summary, h1, h2, h3, h4, h5, h6')) {
      continue;
    }
    if (button.querySelector('h1, h2, h3, h4, h5, h6, table, p, ul, ol')) {
      continue;
    }
    const label = collapseWhitespace(button.textContent ?? '');
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

export function cloneVisibleDocument(doc: Document, baseUrl: string): Document {
  const cleanDoc = doc.implementation.createHTMLDocument(doc.title);

  if (baseUrl) {
    const baseEl = cleanDoc.createElement('base');
    baseEl.setAttribute('href', baseUrl);
    cleanDoc.head.appendChild(baseEl);
  }
  copyTitleMetadata(doc, cleanDoc);

  if (doc.body && cleanDoc.body) {
    cloneVisibleChildren(
      doc.body,
      cleanDoc.body,
      { targetDoc: cleanDoc, win: doc.defaultView },
      false
    );
    preserveTableHeaderButtons(cleanDoc.body, cleanDoc);
    normalizePreCodeBlocks(cleanDoc.body, cleanDoc);
  }

  return cleanDoc;
}
