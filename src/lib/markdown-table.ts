import { MATH_PLACEHOLDER_ATTR, NON_CONTENT_TAG_SET } from '@/lib/constants';
import {
  ANCHOR_ONLY_LABEL_RE,
  ATTACHING_PUNCTUATION_RE,
  computeBacktickFence,
  DECIMAL_TAIL_RE,
  OPENING_PUNCTUATION_END_RE,
  SIGN_PREFIX_CHAR_RE,
  WORD_OR_DIGIT_START_RE,
} from '@/lib/markdown-syntax';
import { collapseWhitespace } from '@/lib/text';
import { cleanLinkHref } from '@/lib/url';

const CURRENCY_PREFIX_END_RE = /(?:^|\s)[$€£¥#@~]$/;
const MAX_TABLE_SPAN = 100;

const CELL_BOUNDARY_TAGS: ReadonlySet<string> = new Set([
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
  'td',
  'th',
  'tr',
  'dt',
  'dd',
  'section',
  'blockquote',
]);

interface CellSegment {
  text: string;
  boundary: boolean;
}

function formatInlineCode(codeText: string): string {
  const fence = computeBacktickFence(codeText, 1);
  const needsPadding =
    codeText.startsWith('`') ||
    codeText.endsWith('`') ||
    (codeText.startsWith(' ') && codeText.endsWith(' '));
  return needsPadding ? `${fence} ${codeText} ${fence}` : `${fence}${codeText}${fence}`;
}

function escapeTableCell(text: string): string {
  return collapseWhitespace(text).replace(
    /(\\*)\|/g,
    (_match, slashes: string) => `${slashes}${slashes}\\|`
  );
}

function joinCellSegments(segments: readonly CellSegment[]): string {
  let result = '';
  let previousBoundary = false;

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const attachesToPrefix =
      (CURRENCY_PREFIX_END_RE.test(result) && WORD_OR_DIGIT_START_RE.test(segment.text)) ||
      (SIGN_PREFIX_CHAR_RE.test(result) && /^\d/.test(segment.text));

    const needsSpace =
      result.length > 0 &&
      !/\s$/.test(result) &&
      !/^\s/.test(segment.text) &&
      !ATTACHING_PUNCTUATION_RE.test(segment.text) &&
      !OPENING_PUNCTUATION_END_RE.test(result) &&
      !(DECIMAL_TAIL_RE.test(result) && /^\d/.test(segment.text)) &&
      !attachesToPrefix &&
      (previousBoundary || segment.boundary);

    result += needsSpace ? ` ${segment.text}` : segment.text;
    previousBoundary = segment.boundary;
  }

  return result;
}

function collectAndJoinChildren(parent: Element): string {
  const segments: CellSegment[] = [];
  for (const child of parent.childNodes) {
    collectCellSegments(child, segments);
  }
  return joinCellSegments(segments);
}

function formatCellLink(el: Element): string | null {
  const label = collectAndJoinChildren(el).trim();
  if (!label || ANCHOR_ONLY_LABEL_RE.test(label)) {
    return null;
  }
  const href = cleanLinkHref(el.getAttribute('href') ?? '');
  if (!href) {
    return label;
  }
  const escapedLabel = label.replace(/([[\]])/g, '\\$1');
  return `[${escapedLabel}](${href})`;
}

function collectCellSegments(node: Node, segments: CellSegment[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const data = (node as Text).data;
    if (data.trim()) {
      segments.push({ text: data, boundary: false });
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
    const codeText = (el.textContent ?? '').trim();
    if (codeText) {
      segments.push({ text: formatInlineCode(codeText), boundary: true });
    }
    return;
  }

  if (tag === 'span' && el.hasAttribute(MATH_PLACEHOLDER_ATTR)) {
    const tex = (el.textContent ?? '').trim();
    if (tex) {
      segments.push({ text: `$${tex}$`, boundary: true });
    }
    return;
  }

  if (tag === 'del' || tag === 's') {
    const trimmed = collectAndJoinChildren(el).trim();
    if (trimmed) {
      segments.push({ text: `~~${trimmed}~~`, boundary: true });
    }
    return;
  }

  if (tag === 'a') {
    const formatted = formatCellLink(el);
    if (formatted) {
      segments.push({ text: formatted, boundary: true });
    }
    return;
  }

  const combined = collectAndJoinChildren(el);
  if (combined) {
    segments.push({ text: combined, boundary: CELL_BOUNDARY_TAGS.has(tag) });
  }
}

function formatTableCell(cell: Element): string {
  return escapeTableCell(collectAndJoinChildren(cell));
}

function parseColSpan(cell: Element): number {
  const raw = cell.getAttribute('colspan');
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, MAX_TABLE_SPAN);
}

function parseRowSpan(cell: Element, remainingRows: number): number {
  const raw = cell.getAttribute('rowspan');
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 1;
  }
  if (parsed === 0) {
    return Math.min(Math.max(1, remainingRows), MAX_TABLE_SPAN);
  }
  return Math.min(parsed, Math.max(1, remainingRows), MAX_TABLE_SPAN);
}

function collectSectionRows(sectionEl: Element): Element[] {
  const rows: Element[] = [];
  for (const child of sectionEl.children) {
    if (child.tagName.toLowerCase() === 'tr') {
      rows.push(child);
    }
  }
  return rows;
}

function extractTableSections(table: Element): Element[][] {
  const headSections: Element[][] = [];
  const bodySections: Element[][] = [];
  const footSections: Element[][] = [];
  const sectionTargets: Record<string, Element[][]> = {
    thead: headSections,
    tbody: bodySections,
    tfoot: footSections,
  };
  let looseBodyRows: Element[] = [];

  const flushLooseBodyRows = (): void => {
    if (looseBodyRows.length > 0) {
      bodySections.push(looseBodyRows);
      looseBodyRows = [];
    }
  };

  for (const child of table.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') {
      looseBodyRows.push(child);
      continue;
    }

    flushLooseBodyRows();

    const target = sectionTargets[tag];
    if (target) {
      const rows = collectSectionRows(child);
      if (rows.length > 0) {
        target.push(rows);
      }
    }
  }

  flushLooseBodyRows();

  return [...headSections, ...bodySections, ...footSections];
}

export function countDirectTableRows(table: Element): number {
  let count = 0;
  for (const section of extractTableSections(table)) {
    count += section.length;
  }
  return count;
}

function extractSectionMatrix(rows: readonly Element[]): string[][] {
  const grid: string[][] = [];
  const occupied: boolean[][] = [];
  const rowCount = rows.length;

  rows.forEach((row, rowIndex) => {
    const cells = Array.from(row.children).filter((el) => {
      const tag = el.tagName.toLowerCase();
      return tag === 'th' || tag === 'td';
    });
    if (cells.length === 0) {
      return;
    }

    grid[rowIndex] ??= [];
    const rowOccupied = (occupied[rowIndex] ??= []);
    let colIndex = 0;

    for (const cell of cells) {
      while (rowOccupied[colIndex]) {
        colIndex++;
      }

      const colSpan = parseColSpan(cell);
      const rowSpan = parseRowSpan(cell, rowCount - rowIndex);
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
  });

  return grid.filter((row): row is string[] => Array.isArray(row) && row.length > 0);
}

function extractTableMatrix(table: HTMLElement): string[][] {
  const sections = extractTableSections(table);
  if (sections.length === 0) {
    return [];
  }

  const allRows: string[][] = [];
  for (const section of sections) {
    allRows.push(...extractSectionMatrix(section));
  }
  return allRows;
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

export function convertTableToMarkdown(table: HTMLElement): string {
  const rawMatrix = extractTableMatrix(table);
  if (rawMatrix.length === 0) {
    return '';
  }
  const normalized = normalizeTableMatrix(rawMatrix);
  const compacted = compactTableColumns(normalized);
  const nonEmptyRows = compacted.filter((row) => row.some((cell) => cell !== ''));
  return renderGfmTable(nonEmptyRows);
}
