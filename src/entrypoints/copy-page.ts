import { extractDocumentContent, type ExtractMode } from '@/lib/extractor';
import { countWords, formatDocumentAsMarkdown } from '@/lib/markdown';
import { showToast } from '@/lib/toast';

declare global {
  interface Window {
    __page2mdMode?: ExtractMode;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

export default defineUnlistedScript(() => {
  const mode: ExtractMode = window.__page2mdMode ?? 'auto';
  delete window.__page2mdMode;

  void (async () => {
    const extracted = extractDocumentContent(document, mode);
    const markdown = formatDocumentAsMarkdown(extracted);

    if (!markdown) {
      showToast('Aucun contenu exploitable trouvé sur cette page.', 'error');
      return;
    }

    const copied = await copyToClipboard(markdown);
    if (!copied) {
      showToast('Impossible d’écrire dans le presse-papier.', 'error');
      return;
    }

    const words = countWords(markdown);
    const scope = extracted.source === 'selection' ? 'Sélection copiée' : 'Page copiée';
    showToast(`${scope} · ~${words} mots`);
  })();
});
