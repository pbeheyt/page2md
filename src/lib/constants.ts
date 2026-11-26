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

export const CODE_LANG_ATTRIBUTES = ['class', 'data-lang', 'data-language'] as const;

export const MAX_DOM_DEPTH = 128;
