const MAX_CLEAN_URL_LENGTH = 250;

const COMMON_TRACKING_PARAMS =
  'utm_[a-z0-9_]+|fbclid|gclid|yclid|mc_cid|mc_eid';

const LINK_TRACKING_PARAM_RE = new RegExp(
  `^(?:${COMMON_TRACKING_PARAMS}|ref_|pf_rd_[a-z0-9_]+|pd_rd_[a-z0-9_]+|_encoding|sprefix|crid|dib|dib_tag|hsa_cr_id|aref|smid|psc)$`,
  'i'
);

const DOC_TRACKING_PARAM_RE = new RegExp(`^(?:${COMMON_TRACKING_PARAMS})$`, 'i');

const SAFE_HTTP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

function stripControlChars(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function encodeMarkdownUrlChars(url: string): string {
  return url
    .replace(/\s/g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
}

function stripQueryParams(url: URL, pattern: RegExp): string {
  for (const key of Array.from(url.searchParams.keys())) {
    if (pattern.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

function parseSafeHttpUrl(rawUrl: string, baseUrl?: string): URL | null {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (!SAFE_HTTP_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.debug('[page2md] Invalid URL skipped:', error);
    return null;
  }
}

export function resolveSafeHttpUrl(rawHref: string, baseUrl?: string): string | null {
  const trimmed = stripControlChars(rawHref);
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  return parseSafeHttpUrl(trimmed, baseUrl)?.href ?? null;
}

export function cleanLinkHref(rawHref: string, baseUrl?: string): string | null {
  const trimmed = stripControlChars(rawHref);
  if (!trimmed || trimmed.startsWith('#') || trimmed.endsWith('/#')) {
    return null;
  }

  let cleaned: string;
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);

  if (hasExplicitScheme || baseUrl) {
    const parsed = parseSafeHttpUrl(trimmed, baseUrl);
    if (!parsed) {
      return null;
    }
    cleaned = stripQueryParams(parsed, LINK_TRACKING_PARAM_RE);
  } else {
    cleaned = trimmed;
  }

  if (cleaned.endsWith('/#') || cleaned.length > MAX_CLEAN_URL_LENGTH) {
    return null;
  }

  return encodeMarkdownUrlChars(cleaned);
}

export function cleanDocumentUrl(rawUrl: string): string {
  const trimmed = stripControlChars(rawUrl);
  if (!trimmed) {
    return '';
  }
  const parsed = parseSafeHttpUrl(trimmed);
  return parsed ? stripQueryParams(parsed, DOC_TRACKING_PARAM_RE) : trimmed;
}
