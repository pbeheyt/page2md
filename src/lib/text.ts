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
