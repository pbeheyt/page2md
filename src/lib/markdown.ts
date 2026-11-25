import TurndownService from 'turndown';
import type { ExtractedDocument } from '@/lib/extractor';

function extractCodeLanguage(node: Element): string {
  const codeEl = node.querySelector('code') ?? node;
  const className = codeEl.getAttribute('class') ?? '';
  const match = className.match(/(?:language-|lang-)([a-z0-9_+-]+)/i);
  return match?.[1]?.toLowerCase() ?? '';
}

function extractCellText(cell: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const value = (node.nodeValue ?? '').trim();
      if (value) {
        parts.push(value);
      }
      return;
    }
    if (node.nodeType === 1) {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }
    }
  };
  walk(cell);
  return parts.join(' ').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function convertTableToMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) {
    return '';
  }

  const parsedRows = rows
    .map((row) =>
      Array.from(row.querySelectorAll('th, td')).map(extractCellText)
    )
    .filter((cells) => cells.length > 0);

  if (parsedRows.length === 0) {
    return '';
  }

  const colCount = Math.max(...parsedRows.map((r) => r.length));
  const normalized = parsedRows.map((row) => {
    const padded = [...row];
    while (padded.length < colCount) {
      padded.push('');
    }
    return padded;
  });

  const nonEmptyCols: number[] = [];
  for (let col = 0; col < colCount; col++) {
    if (normalized.some((row) => (row[col] ?? '') !== '')) {
      nonEmptyCols.push(col);
    }
  }
  if (nonEmptyCols.length === 0) {
    return '';
  }

  const compacted = normalized.map((row) =>
    nonEmptyCols.map((col) => row[col] ?? '')
  );

  const header = compacted[0]!;
  const separator = Array.from({ length: nonEmptyCols.length }, () => '---');
  const body = compacted.slice(1);

  return [
    formatTableRow(header),
    formatTableRow(separator),
    ...body.map(formatTableRow),
  ].join('\n');
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  service.remove(['script', 'style', 'noscript', 'iframe']);

  service.addRule('dropImages', {
    filter: 'img',
    replacement: () => '',
  });

  service.addRule('dropSvg', {
    filter: (node) => node.nodeName.toLowerCase() === 'svg',
    replacement: () => '',
  });

  service.addRule('fencedCodeWithLang', {
    filter: (node) =>
      node.nodeName === 'PRE' && Boolean(node.querySelector('code')),
    replacement: (_content, node) => {
      const el = node as Element;
      const lang = extractCodeLanguage(el);
      const code = (el.querySelector('code')?.textContent ?? '').replace(/\n$/, '');
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    },
  });

  service.addRule('gfmTable', {
    filter: 'table',
    replacement: (_content, node) => {
      const md = convertTableToMarkdown(node as Element);
      return md ? `\n\n${md}\n\n` : '';
    },
  });

  service.addRule('dropEmptyLinks', {
    filter: (node) =>
      node.nodeName === 'A' && !(node.textContent ?? '').trim(),
    replacement: () => '',
  });

  return service;
}

export function htmlToCleanMarkdown(html: string): string {
  if (!html.trim()) {
    return '';
  }
  const turndown = createTurndown();
  return turndown
    .turndown(html)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatDocumentAsMarkdown(doc: ExtractedDocument): string {
  const body = htmlToCleanMarkdown(doc.html);
  if (!body) {
    return '';
  }

  const headerLines: string[] = [];
  if (doc.title) {
    headerLines.push(`# ${doc.title}`);
  }
  if (doc.url) {
    headerLines.push(`Source : ${doc.url}`);
  }

  return headerLines.length > 0 ? `${headerLines.join('\n')}\n\n${body}` : body;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}
