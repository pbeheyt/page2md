import { describe, expect, it } from 'vitest';
import { cleanDocumentUrl, cleanLinkHref, resolveSafeHttpUrl } from '@/lib/url';

describe('url utilities', () => {
  it('résout les URLs http(s) et bloque les protocoles dangereux même obfusqués', () => {
    expect(resolveSafeHttpUrl('/docs/api', 'https://example.com/a/b')).toBe(
      'https://example.com/docs/api'
    );
    expect(resolveSafeHttpUrl('java\tscript:alert(1)', 'https://example.com')).toBeNull();
    expect(resolveSafeHttpUrl('javascript:void(0)', 'https://example.com')).toBeNull();
    expect(resolveSafeHttpUrl('data:text/html,<h1>x</h1>', 'https://example.com')).toBeNull();
    expect(resolveSafeHttpUrl('blob:https://example.com/123', 'https://example.com')).toBeNull();
    expect(resolveSafeHttpUrl('#section', 'https://example.com')).toBeNull();
  });

  it('nettoie les paramètres de tracking, encode les espaces et rejette les trackers >250 car.', () => {
    expect(
      cleanLinkHref('https://example.com/my doc.pdf?utm_source=x&fbclid=1&id=7')
    ).toBe('https://example.com/my%20doc.pdf?id=7');
    expect(cleanLinkHref('https://example.com/item?qid=42&sr=1')).toBe(
      'https://example.com/item?qid=42&sr=1'
    );
    expect(cleanLinkHref(`https://ads.example.com/?p=${'x'.repeat(260)}`)).toBeNull();
    expect(cleanLinkHref('https://example.com/#')).toBeNull();
  });

  it('nettoie doc.url des paramètres UTM sans tronquer les URLs longues légitimes', () => {
    const longPath = `https://example.com/${'segment/'.repeat(40)}page?utm_medium=social&ref=keep`;
    expect(cleanDocumentUrl(longPath)).toBe(
      `https://example.com/${'segment/'.repeat(40)}page?ref=keep`
    );
  });
});
