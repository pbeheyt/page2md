const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  let count = 0;
  for (const token of trimmed.split(/\s+/)) {
    if (WORD_CHAR_RE.test(token)) {
      count++;
    }
  }
  return count;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  let weight = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      weight += 0.25;
    } else if (code === 0x20 || code === 0x09) {
      weight += 0.2;
    } else if (code === 0x0a || code === 0x0d) {
      weight += 0.5;
    } else if (code < 0x80) {
      weight += 0.5;
    } else if (code <= 0x024f) {
      weight += 0.4;
    } else if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      weight += 1.2;
    } else {
      weight += 0.7;
    }
  }

  return Math.max(1, Math.round(weight));
}
