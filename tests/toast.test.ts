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
});
