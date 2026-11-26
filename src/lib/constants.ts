export const NON_CONTENT_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'template',
  'object',
  'embed',
  'audio',
  'video',
  'link',
] as const;

export const NON_CONTENT_TAG_SET: ReadonlySet<string> = new Set(NON_CONTENT_TAGS);

export const MATH_PLACEHOLDER_ATTR = 'data-page2md-math';

export type MathDisplayMode = 'inline' | 'block';

export const CODE_LANG_ATTRIBUTES = ['class', 'data-lang', 'data-language'] as const;

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

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
