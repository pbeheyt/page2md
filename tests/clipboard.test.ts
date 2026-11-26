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

  it('bascule sur textarea en restaurant le focus avant la sélection si writeText échoue', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Document is not focused')),
      },
    });

    document.body.innerHTML = '<button id="btn">Action</button><p id="target">Texte sélectionné</p>';
    const button = document.getElementById('btn') as HTMLButtonElement;
    button.focus();

    const textNode = document.getElementById('target')!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const order: string[] = [];
    const origFocus = button.focus.bind(button);
    vi.spyOn(button, 'focus').mockImplementation((options?: FocusOptions) => {
      order.push('focus');
      origFocus(options);
    });
    const origAddRange = selection.addRange.bind(selection);
    vi.spyOn(selection, 'addRange').mockImplementation((r: Range) => {
      order.push('addRange');
      origAddRange(r);
    });

    document.execCommand = vi.fn().mockReturnValue(true);

    const ok = await copyToClipboard('copied text', document);
    expect(ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('Texte');
    expect(order).toEqual(['focus', 'addRange']);
  });

  it('préserve la sélection d’un <input> et intercepte l’événement copy pour bloquer les listeners hôtes', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    document.body.innerHTML = '<input id="field" value="Bonjour monde" />';
    const input = document.getElementById('field') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 7);

    const hostListener = vi.fn();
    document.addEventListener('copy', hostListener);

    let writtenPayload = '';
    document.execCommand = vi.fn().mockImplementation(() => {
      const textarea = document.querySelector('textarea')!;
      const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(copyEvent, 'clipboardData', {
        value: {
          setData: (_type: string, data: string) => {
            writtenPayload = data;
          },
        },
      });
      textarea.dispatchEvent(copyEvent);
      return true;
    });

    const ok = await copyToClipboard('# Markdown propre', document);
    document.removeEventListener('copy', hostListener);

    expect(ok).toBe(true);
    expect(writtenPayload).toBe('# Markdown propre');
    expect(hostListener).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(7);
  });

  it('retourne false sans lever d’exception si execCommand échoue ou sur un document XML', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyToClipboard('fail text', document)).toBe(false);

    const xmlDoc = new DOMParser().parseFromString('<root><item>1</item></root>', 'application/xml');
    expect(await copyToClipboard('xml text', xmlDoc)).toBe(false);
  });
});
