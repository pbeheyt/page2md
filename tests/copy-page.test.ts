import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCopy } from '@/lib/copy-runner';
import * as clipboardModule from '@/lib/clipboard';
import * as extractorModule from '@/lib/extractor';
import * as toastModule from '@/lib/toast';

beforeEach(() => {
  document.title = 'Article Test';
  document.body.innerHTML = '<main><h1>Article Test</h1><p>Un contenu clair et structuré pour tester la copie.</p></main>';
});

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('page2md-toast-host')?.remove();
  vi.restoreAllMocks();
});

describe('runCopy', () => {
  it('extrait, copie le Markdown et affiche un toast de succès', async () => {
    const copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true);
    const toastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => undefined);

    const result = await runCopy('page', document);

    expect(result.ok).toBe(true);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(copySpy).toHaveBeenCalledOnce();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Page copiée · ~\d+ mots? · ~[\d,]+k? tokens?/),
      'success',
      document
    );
  });

  it('retourne unsupported_document sur un document XML', async () => {
    const xmlDoc = new DOMParser().parseFromString('<root />', 'application/xml');
    const result = await runCopy('page', xmlDoc);
    expect(result).toEqual({ ok: false, reason: 'unsupported_document' });
  });

  it('retourne empty et affiche un toast erreur quand le contenu est vide', async () => {
    document.body.innerHTML = '<div></div>';
    const toastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => undefined);

    const result = await runCopy('page', document);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
    expect(toastSpy).toHaveBeenCalledWith(
      'Aucun contenu exploitable trouvé sur cette page.',
      'error',
      document
    );
  });

  it('capture toute exception inattendue et protège contre un crash de showToast', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(extractorModule, 'extractDocumentContent').mockImplementation(() => {
      throw new Error('DOM explosion');
    });
    vi.spyOn(toastModule, 'showToast').mockImplementation(() => {
      throw new Error('Toast blocked');
    });

    const result = await runCopy('page', document);
    expect(result).toEqual({ ok: false, reason: 'unexpected_error' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ignore un appel concurrent sur le même document pendant une copie en cours', async () => {
    let resolveClipboard!: (ok: boolean) => void;
    vi.spyOn(clipboardModule, 'copyToClipboard').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveClipboard = resolve;
        })
    );
    vi.spyOn(toastModule, 'showToast').mockImplementation(() => undefined);

    const first = runCopy('page', document);
    const second = await runCopy('page', document);
    expect(second).toEqual({ ok: false, reason: 'busy' });

    resolveClipboard(true);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });
});
