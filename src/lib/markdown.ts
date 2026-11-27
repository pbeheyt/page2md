import TurndownService from 'turndown';
import { MATH_PLACEHOLDER_ATTR, NON_CONTENT_TAG_SET } from '@/lib/constants';
import type { ExtractedDocument } from '@/lib/extractor';
import { insertInlineBoundaries } from '@/lib/markdown-inline-boundaries';
import { ANCHOR_ONLY_LABEL_RE, computeBacktickFence } from '@/lib/markdown-syntax';
import { convertTableToMarkdown } from '@/lib/markdown-table';
import { collapseWhitespace } from '@/lib/text';
import { cleanDocumentUrl, cleanLinkHref } from '@/lib/url';

const CODE_LANG_RE = /(?:^|\s)(?:language-|lang-)([a-z0-9_+.#-]+)/i;
const SAFE_LANG_TOKEN_RE = /^[a-z0-9_+.#-]+/i;

const olIndexCache = new WeakMap<Element, Map<Element, number>>();

function readLanguageFromElement(el: Element | null): string {
  if (!el) {
    return '';
  }
  const rawDataLang =
    el.getAttribute('data-lang')?.trim() ||
    el.getAttribute('data-language')?.trim() ||
    '';
  if (rawDataLang) {
    const token = rawDataLang.match(SAFE_LANG_TOKEN_RE)?.[0];
    if (token) {
      return token.toLowerCase();
    }
  }
  const className = el.getAttribute('class') ?? '';
  const match = className.match(CODE_LANG_RE);
  return match?.[1]?.toLowerCase() ?? '';
}

function extractCodeLanguage(preEl: HTMLElement, codeEl: Element | null): string {
  return readLanguageFromElement(codeEl) || readLanguageFromElement(preEl);
}

function extractCodeContent(preEl: HTMLElement): { code: string; codeEl: Element | null } {
  const codeEls = preEl.querySelectorAll('code');
  if (codeEls.length === 0) {
    return { code: (preEl.textContent ?? '').replace(/\n$/, ''), codeEl: null };
  }
  const joined = Array.from(codeEls, (el) =>
    (el.textContent ?? '').replace(/\n$/, '')
  ).join('\n');
  return { code: joined, codeEl: codeEls[0] ?? null };
}

function hasMeaningfulListItemContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node as Text).data.trim().length > 0;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (NON_CONTENT_TAG_SET.has(tag) || tag === 'img') {
    return false;
  }
  for (const child of el.childNodes) {
    if (hasMeaningfulListItemContent(child)) {
      return true;
    }
  }
  return false;
}

function getOrderedListItemIndex(parent: Element, item: Element): number {
  let indexMap = olIndexCache.get(parent);
  if (!indexMap) {
    indexMap = new Map<Element, number>();
    let seq = 0;
    for (const child of parent.children) {
      if (child.tagName.toLowerCase() === 'li' && hasMeaningfulListItemContent(child)) {
        indexMap.set(child, seq++);
      }
    }
    olIndexCache.set(parent, indexMap);
  }
  return indexMap.get(item) ?? 0;
}

function parseOrderedListStart(parent: Element): number {
  const raw = parent.getAttribute('start');
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 1;
  }
  return parsed;
}

const DROP_NON_CONTENT_RULE: TurndownService.Rule = {
  filter: (node) => NON_CONTENT_TAG_SET.has(node.nodeName.toLowerCase()),
  replacement: () => '',
};

const DROP_IMAGES_RULE: TurndownService.Rule = {
  filter: 'img',
  replacement: () => '',
};

const FENCED_CODE_RULE: TurndownService.Rule = {
  filter: 'pre',
  replacement: (_content, node) => {
    const { code, codeEl } = extractCodeContent(node);
    if (!code.trim()) {
      return '';
    }
    const lang = extractCodeLanguage(node, codeEl);
    const fence = computeBacktickFence(code, 3);
    return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
  },
};

const GFM_TABLE_RULE: TurndownService.Rule = {
  filter: 'table',
  replacement: (_content, node) => {
    const md = convertTableToMarkdown(node);
    return md ? `\n\n${md}\n\n` : '';
  },
};

const MATH_PLACEHOLDER_RULE: TurndownService.Rule = {
  filter: (node) =>
    node.nodeName === 'SPAN' && node.hasAttribute(MATH_PLACEHOLDER_ATTR),
  replacement: (_content, node) => {
    const tex = (node.textContent ?? '').trim();
    if (!tex) {
      return '';
    }
    const mode = node.getAttribute(MATH_PLACEHOLDER_ATTR);
    return mode === 'block' ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
};

const CLEAN_LINK_RULE: TurndownService.Rule = {
  filter: (node) => node.nodeName === 'A',
  replacement: (content, node) => {
    const label = collapseWhitespace(content)
      .replace(/^(?:#{1,6}\s+)+/, '')
      .replace(/^\\([+-])(?=\s)/, '$1');
    if (!label || ANCHOR_ONLY_LABEL_RE.test(label)) {
      return '';
    }
    const cleanedHref = cleanLinkHref(node.getAttribute('href') ?? '');
    if (!cleanedHref) {
      return label;
    }
    const rawTitle = node.getAttribute('title');
    const title = rawTitle ? collapseWhitespace(rawTitle) : '';
    const titlePart = title
      ? ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : '';
    return `[${label}](${cleanedHref}${titlePart})`;
  },
};

const CLEAN_BR_RULE: TurndownService.Rule = {
  filter: 'br',
  replacement: () => '\n',
};

const CLEAN_HEADING_RULE: TurndownService.Rule = {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement: (content, node) => {
    const cleaned = collapseWhitespace(content)
      .replace(/^(?:#{1,6}\s+)+/, '')
      .replace(/^\\([+>-])(?=\s)/, '$1')
      .replace(/^(\d+)\\\./, '$1.');
    if (!cleaned) {
      return '';
    }
    const level = Number(node.nodeName.charAt(1));
    return `\n\n${'#'.repeat(level)} ${cleaned}\n\n`;
  },
};

const CLEAN_BLOCKQUOTE_RULE: TurndownService.Rule = {
  filter: 'blockquote',
  replacement: (content) => {
    const trimmed = content.trim();
    if (!trimmed) {
      return '';
    }
    const quoted = trimmed
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n');
    return `\n\n${quoted}\n\n`;
  },
};

const CLEAN_LIST_ITEM_RULE: TurndownService.Rule = {
  filter: 'li',
  replacement: (content, node, options) => {
    const trimmed = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .replace(/^\\([+-])(?=\s)/, '$1');
    if (!trimmed.trim()) {
      return '';
    }

    let prefix = `${options.bulletListMarker} `;
    const parent = node.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'ol') {
      const start = parseOrderedListStart(parent);
      const index = getOrderedListItemIndex(parent, node);
      prefix = `${start + index}. `;
    }

    const indent = ' '.repeat(prefix.length);
    const indented = trimmed.replace(/\n([^\n])/g, `\n${indent}$1`);
    return prefix + indented + (node.nextSibling ? '\n' : '');
  },
};

const STRIKETHROUGH_RULE: TurndownService.Rule = {
  filter: ['del', 's'],
  replacement: (content) => {
    const trimmed = content.trim();
    return trimmed ? `~~${trimmed}~~` : '';
  },
};

function escapeMarkdownText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([`[\]])/g, '\\$1')
    .replace(/^([ \t]*)(#{1,6})(?=\s)/gm, '$1\\$2')
    .replace(/^([ \t]*)>/gm, '$1\\>')
    .replace(/^([ \t]*)([-+*])(?=\s)/gm, '$1\\$2')
    .replace(/^([ \t]*\d+)\.(?=\s)/gm, '$1\\.');
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  service.escape = escapeMarkdownText;
  service.addRule('dropNonContent', DROP_NON_CONTENT_RULE);
  service.addRule('dropImages', DROP_IMAGES_RULE);
  service.addRule('mathPlaceholder', MATH_PLACEHOLDER_RULE);
  service.addRule('cleanBr', CLEAN_BR_RULE);
  service.addRule('cleanHeading', CLEAN_HEADING_RULE);
  service.addRule('cleanBlockquote', CLEAN_BLOCKQUOTE_RULE);
  service.addRule('fencedCode', FENCED_CODE_RULE);
  service.addRule('gfmTable', GFM_TABLE_RULE);
  service.addRule('cleanLink', CLEAN_LINK_RULE);
  service.addRule('cleanListItem', CLEAN_LIST_ITEM_RULE);
  service.addRule('strikethrough', STRIKETHROUGH_RULE);

  return service;
}

const turndownService = createTurndownService();

function normalizeHeadingForComparison(text: string): string {
  return collapseWhitespace(
    text.replace(/\\([[\]\\*_.+-])/g, '$1').replace(/[`*_]/g, '')
  ).toLowerCase();
}

function stripDuplicateLeadingH1(body: string, title: string): string {
  const normalizedTitle = normalizeHeadingForComparison(title);
  if (!normalizedTitle) {
    return body;
  }

  const lines = body.split('\n');
  const firstLine = lines[0];
  if (!firstLine) {
    return body;
  }

  const match = firstLine.match(/^#\s+(.+)$/);
  if (!match?.[1]) {
    return body;
  }

  const headingText = normalizeHeadingForComparison(match[1]);
  if (headingText !== normalizedTitle) {
    return body;
  }

  return lines.slice(1).join('\n').replace(/^\n+/, '');
}

export function htmlToCleanMarkdown(html: string): string {
  if (!html.trim()) {
    return '';
  }

  let input: string | HTMLElement = html;
  if (typeof document !== 'undefined' && document.implementation?.createHTMLDocument) {
    const inertDoc = document.implementation.createHTMLDocument('');
    inertDoc.body.innerHTML = html;
    insertInlineBoundaries(inertDoc.body, inertDoc);
    input = inertDoc.body;
  }

  return turndownService
    .turndown(input)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0]/g, ' ')
    .replace(/[\u00ad\u200b\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatDocumentAsMarkdown(doc: ExtractedDocument): string {
  const rawBody = htmlToCleanMarkdown(doc.html);
  if (!rawBody) {
    return '';
  }

  const normalizedTitle = collapseWhitespace(doc.title);
  const body = stripDuplicateLeadingH1(rawBody, normalizedTitle);
  const cleanedUrl = cleanDocumentUrl(doc.url);

  const headerLines: string[] = [];
  if (normalizedTitle) {
    headerLines.push(`# ${normalizedTitle}`);
  }
  if (cleanedUrl) {
    headerLines.push(`Source : ${cleanedUrl}`);
  }

  if (headerLines.length === 0) {
    return body;
  }

  return body ? `${headerLines.join('\n')}\n\n${body}` : headerLines.join('\n');
}
