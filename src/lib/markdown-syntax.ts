export const ATTACHING_PUNCTUATION_RE = /^[,.;:!?)\]%»”’]/;
export const OPENING_PUNCTUATION_END_RE = /[([«“‘/'’]$/;
export const SIGN_PREFIX_CHAR_RE = /^[+-]$/;
export const WORD_OR_DIGIT_START_RE = /^[0-9A-Za-zÀ-ÿ]/;
export const DECIMAL_TAIL_RE = /\d[.,]$/;
export const ANCHOR_ONLY_LABEL_RE = /^(?:#|¶|§|🔗)$/;

export function computeBacktickFence(text: string, minLength: number): string {
  let maxRun = 0;
  for (const match of text.matchAll(/`+/g)) {
    if (match[0].length > maxRun) {
      maxRun = match[0].length;
    }
  }
  return '`'.repeat(Math.max(minLength, maxRun + 1));
}
