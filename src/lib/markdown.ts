import TurndownService from 'turndown';
import { NON_CONTENT_TAG_SET, type ExtractedDocument } from '@/lib/extractor';

const CODE_LANG_RE = /(?:^|\s)(?:language-|lang-)([a-z0-9_+.#-]+)/i;
const ATTACHING_PUNCTUATION_RE = /^[,.;:!?)\]%]/;
const SKIPPED_LINK_PROTOCOL_RE = /^javascript:/i;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const MAX_TABLE_SPAN = 100;

const CELL_BOUNDARY_TAGS = new Set([
  'span',
  'div',
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

interface CellSegment {
  text: string;
  boundary: boolean;
}

function readLanguageFromElement(el: Element | null): string {
  if (!el) {
    return '';
  }
  const dataLang = (el.getAttribute('data-lang') ?? el.getAttribute('data-language') ?? '').trim();
  if (dataLang) {
    return dataLang.toLowerCase();
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
    return { code: preEl.textContent.replace(/\n$/, ''), codeEl: null };
  }
  if (codeEls.length === 1) {
    const codeEl = codeEls[0] ?? null;
    const rawCode = codeEl?.textContent ?? '';
    return { code: rawCode.replace(/\n$/, ''), codeEl };
  }
  const joined = Array.from(codeEls, (el) => el.textContent.replace(/\n$/, '')).join('\n');
  return { code: joined, codeEl: codeEls[0] ?? null };
}

function computeCodeFence(code: string): string {
  let maxRun = 0;
  for (const match of code.matchAll(/`+/g)) {
    if (match[0].length > maxRun) {
      maxRun = match[0].length;
    }
  }
  return '`'.repeat(Math.max(3, maxRun + 1));
}

function escapeTableCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

function joinCellSegments(segments: readonly CellSegment[]): string {
  let result = '';
  let previousBoundary = false;

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const needsSpace =
      result.length > 0 &&
      !/\s$/.test(result) &&
      !/^\s/.test(segment.text) &&
      !ATTACHING_PUNCTUATION_RE.test(segment.text) &&
      (previousBoundary || segment.boundary);

    result += needsSpace ? ` ${segment.text}` : segment.text;
    previousBoundary = segment.boundary;
  }

  return result;
}

function collectCellSegments(node: Node, segments: CellSegment[], boundary: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const data = (node as Text).data;
    if (data.trim()) {
      segments.push({ text: data, boundary });
    } else if (data.length > 0 && segments.length > 0) {
      segments.push({ text: ' ', boundary: false });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (NON_CONTENT_TAG_SET.has(tag) || tag === 'img') {
    return;
  }

  if (tag === 'br') {
    segments.push({ text: ' ', boundary: false });
    return;
  }

  if (tag === 'code') {
    const codeText = el.textContent.trim();
    if (codeText) {
      segments.push({ text: `\`${codeText}\``, boundary });
    }
    return;
  }

  if (tag === 'a') {
    const linkSegments: CellSegment[] = [];
    for (const child of el.childNodes) {
      collectCellSegments(child, linkSegments, false);
    }
    const label = joinCellSegments(linkSegments).trim();
    if (!label) {
      return;
    }
    const href = el.getAttribute('href')?.trim() ?? '';
    const formatted =
      href && !SKIPPED_LINK_PROTOCOL_RE.test(href)
        ? `[${label}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
        : label;
    segments.push({ text: formatted, boundary: true });
    return;
  }

  const isBoundary = CELL_BOUNDARY_TAGS.has(tag);
  const childSegments: CellSegment[] = [];
  for (const child of el.childNodes) {
    collectCellSegments(child, childSegments, false);
  }
  const combined = joinCellSegments(childSegments);
  if (combined) {
    segments.push({ text: combined, boundary: isBoundary || boundary });
  }
}

function formatTableCell(cell: Element): string {
  const segments: CellSegment[] = [];
  for (const child of cell.childNodes) {
    collectCellSegments(child, segments, false);
  }
  return escapeTableCell(joinCellSegments(segments));
}

function parseSpanAttribute(cell: Element, attr: 'colspan' | 'rowspan'): number {
  const raw = cell.getAttribute(attr);
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, MAX_TABLE_SPAN);
}

function extractDirectTableRows(table: HTMLElement): Element[] {
  const headRows: Element[] = [];
  const bodyRows: Element[] = [];
  const footRows: Element[] = [];

  for (const child of table.children) {
    const tag = child.tagName;
    if (tag === 'TR') {
      bodyRows.push(child);
    } else if (tag === 'THEAD') {
      for (const row of child.children) {
        if (row.tagName === 'TR') {
          headRows.push(row);
        }
      }
    } else if (tag === 'TBODY') {
      for (const row of child.children) {
        if (row.tagName === 'TR') {
          bodyRows.push(row);
        }
      }
    } else if (tag === 'TFOOT') {
      for (const row of child.children) {
        if (row.tagName === 'TR') {
          footRows.push(row);
        }
      }
    }
  }

  return [...headRows, ...bodyRows, ...footRows];
}

function extractTableMatrix(table: HTMLElement): string[][] {
  const rows = extractDirectTableRows(table);
  if (rows.length === 0) {
    return [];
  }

  const grid: string[][] = [];
  const occupied: boolean[][] = [];

  rows.forEach((row, rowIndex) => {
    const cells = Array.from(row.children).filter(
      (el) => el.tagName === 'TH' || el.tagName === 'TD'
    );
    if (cells.length === 0) {
      return;
    }

    const rowCells = (grid[rowIndex] ??= []);
    const rowOccupied = (occupied[rowIndex] ??= []);
    let colIndex = 0;

    for (const cell of cells) {
      while (rowOccupied[colIndex]) {
        colIndex++;
      }

      const colSpan = parseSpanAttribute(cell, 'colspan');
      const rowSpan = parseSpanAttribute(cell, 'rowspan');
      const text = formatTableCell(cell);

      for (let r = 0; r < rowSpan; r++) {
        const targetRow = (grid[rowIndex + r] ??= []);
        const targetOccupied = (occupied[rowIndex + r] ??= []);
        for (let c = 0; c < colSpan; c++) {
          targetOccupied[colIndex + c] = true;
          targetRow[colIndex + c] = r === 0 && c === 0 ? text : '';
        }
      }

      colIndex += colSpan;
    }

    for (let c = 0; c < rowCells.length; c++) {
      if (rowCells[c] === undefined) {
        rowCells[c] = '';
      }
    }
  });

  return grid.filter((row): row is string[] => Array.isArray(row) && row.length > 0);
}

function normalizeTableMatrix(rows: readonly string[][]): string[][] {
  const colCount = rows.reduce((max, row) => (row.length > max ? row.length : max), 0);
  if (colCount === 0) {
    return [];
  }

  return rows.map((row) =>
    Array.from({ length: colCount }, (_, colIndex) => row[colIndex] ?? '')
  );
}

function compactTableColumns(matrix: readonly string[][]): string[][] {
  const firstRow = matrix[0];
  if (!firstRow) {
    return [];
  }

  const nonEmptyColIndices: number[] = [];
  for (let col = 0; col < firstRow.length; col++) {
    if (matrix.some((row) => row[col] !== '')) {
      nonEmptyColIndices.push(col);
    }
  }

  if (nonEmptyColIndices.length === 0) {
    return [];
  }

  return matrix.map((row) =>
    nonEmptyColIndices.map((col) => {
      const value = row[col];
      return value === undefined ? '' : value;
    })
  );
}

function formatTableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function renderGfmTable(matrix: readonly string[][]): string {
  const [header, ...body] = matrix;
  if (!header) {
    return '';
  }

  const separator = header.map(() => '---');
  return [
    formatTableRow(header),
    formatTableRow(separator),
    ...body.map(formatTableRow),
  ].join('\n');
}

function convertTableToMarkdown(table: HTMLElement): string {
  const rawMatrix = extractTableMatrix(table);
  if (rawMatrix.length === 0) {
    return '';
  }
  const normalized = normalizeTableMatrix(rawMatrix);
  const compacted = compactTableColumns(normalized);
  return renderGfmTable(compacted);
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
    const lang = extractCodeLanguage(node, codeEl);
    const fence = computeCodeFence(code);
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

const CLEAN_LINK_RULE: TurndownService.Rule = {
  filter: (node) => node.nodeName === 'A',
  replacement: (content, node) => {
    const label = content.trim();
    if (!label) {
      return '';
    }
    const href = node.getAttribute('href')?.trim() ?? '';
    if (!href || SKIPPED_LINK_PROTOCOL_RE.test(href)) {
      return label;
    }
    const escapedHref = href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    const title = node.getAttribute('title')?.trim();
    const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `[${label}](${escapedHref}${titlePart})`;
  },
};

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    br: '\\',
  });

  service.addRule('dropNonContent', DROP_NON_CONTENT_RULE);
  service.addRule('dropImages', DROP_IMAGES_RULE);
  service.addRule('fencedCode', FENCED_CODE_RULE);
  service.addRule('gfmTable', GFM_TABLE_RULE);
  service.addRule('cleanLink', CLEAN_LINK_RULE);

  return service;
}

const turndownService = createTurndownService();

function stripDuplicateLeadingH1(body: string, title: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedTitle) {
    return body;
  }

  const lines = body.split('\n');
  const firstLine = lines[0];
  if (!firstLine) {
    return body;
  }

  const match = firstLine.match(/^#\s+(.+?)\s*#*$/);
  if (!match?.[1]) {
    return body;
  }

  const headingText = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
  if (headingText !== normalizedTitle) {
    return body;
  }

  return lines.slice(1).join('\n').replace(/^\n+/, '');
}

export function htmlToCleanMarkdown(html: string): string {
  if (!html.trim()) {
    return '';
  }

  return turndownService
    .turndown(html)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatDocumentAsMarkdown(doc: ExtractedDocument): string {
  const rawBody = htmlToCleanMarkdown(doc.html);
  if (!rawBody) {
    return '';
  }

  const normalizedTitle = doc.title.replace(/\s+/g, ' ').trim();
  const body = stripDuplicateLeadingH1(rawBody, normalizedTitle);

  const headerLines: string[] = [];
  if (normalizedTitle) {
    headerLines.push(`# ${normalizedTitle}`);
  }
  if (doc.url) {
    headerLines.push(`Source : ${doc.url}`);
  }

  if (headerLines.length === 0) {
    return body;
  }

  return body ? `${headerLines.join('\n')}\n\n${body}` : headerLines.join('\n');
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter((token) => WORD_CHAR_RE.test(token)).length;
}
