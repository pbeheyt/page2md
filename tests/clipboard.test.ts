import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '@/lib/clipboard';

const originalClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('utilise navigator.clipboard.writeText quand disponible', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const ok = await copyToClipboard('hello markdown', document);
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello markdown');
  });

  it('bascule sur textarea en nettoyant le DOM et en restaurant la sélection si writeText échoue', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Document is not focused')),
      },
    });

    document.body.innerHTML = '<p id="target">Texte sélectionné</p>';
    const textNode = document.getElementById('target')!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    document.execCommand = vi.fn().mockReturnValue(true);

    const ok = await copyToClipboard('copied text', document);
    expect(ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('Texte');
  });

  it('retourne false sans lever d’exception sur un document XML non-HTML', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    const xmlDoc = new DOMParser().parseFromString('<root><item>1</item></root>', 'application/xml');
    const ok = await copyToClipboard('xml text', xmlDoc);
    expect(ok).toBe(false);
  });
});
