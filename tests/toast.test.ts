import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '@/lib/toast';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    window.clearTimeout(id);
  });
});

afterEach(() => {
  document.getElementById('page2md-toast-host')?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('showToast', () => {
  it('monte le toast sur documentElement et le retire automatiquement après expiration', () => {
    showToast('Page copiée · ~12 mots', 'success', document);

    const host = document.getElementById('page2md-toast-host');
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(document.documentElement);

    vi.advanceTimersByTime(2500);
    expect(document.getElementById('page2md-toast-host')).toBeNull();
  });

  it('remplace un toast existant en annulant ses timers précédents', () => {
    showToast('Premier toast', 'success', document);
    vi.advanceTimersByTime(1500);

    showToast('Second toast', 'error', document);
    vi.advanceTimersByTime(1000);

    expect(document.getElementById('page2md-toast-host')).not.toBeNull();

    vi.advanceTimersByTime(1500);
    expect(document.getElementById('page2md-toast-host')).toBeNull();
  });

  it('est un no-op sûr sur un document XML non-HTML', () => {
    const xmlDoc = new DOMParser().parseFromString('<root />', 'application/xml');
    expect(() => showToast('Test', 'error', xmlDoc)).not.toThrow();
    expect(xmlDoc.getElementById('page2md-toast-host')).toBeNull();
  });

  it('bascule sur <style> si adoptedStyleSheets lève une erreur et configure role/aria-live', () => {
    let capturedShadow: ShadowRoot | null = null;
    const originalAttachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit
    ) {
      const shadow = originalAttachShadow.call(this, init);
      Object.defineProperty(shadow, 'adoptedStyleSheets', {
        configurable: true,
        get: () => [],
        set: () => {
          throw new Error('Xray wrapper error');
        },
      });
      capturedShadow = shadow;
      return shadow;
    });

    vi.stubGlobal(
      'CSSStyleSheet',
      class FakeStyleSheet {
        replaceSync(): void {}
      }
    );

    expect(() => showToast('Erreur critique', 'error', document)).not.toThrow();
    expect(capturedShadow).not.toBeNull();

    const styleEl = capturedShadow!.querySelector('style');
    expect(styleEl?.textContent).toContain('max-width: calc(100vw - 32px)');

    const box = capturedShadow!.querySelector('.toast');
    expect(box?.getAttribute('role')).toBe('alert');
    expect(box?.getAttribute('aria-live')).toBe('assertive');
    expect(box?.classList.contains('visible')).toBe(false);

    vi.advanceTimersByTime(40);
    expect(box?.classList.contains('visible')).toBe(true);

    vi.advanceTimersByTime(2200);
    expect(box?.classList.contains('visible')).toBe(false);
  });
});
