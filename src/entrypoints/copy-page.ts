import { copyToClipboard } from '@/lib/clipboard';
import {
  extractDocumentContent,
  type ExtractMode,
  type ExtractedDocument,
} from '@/lib/extractor';
import { countWords, formatDocumentAsMarkdown } from '@/lib/markdown';
import {
  RUNNER_SYMBOL_KEY,
  type CopyResult,
  type Page2MdRunner,
} from '@/lib/protocol';
import { showToast } from '@/lib/toast';

function formatCopySuccessMessage(
  source: ExtractedDocument['source'],
  wordCount: number
): string {
  const scope = source === 'selection' ? 'Sélection copiée' : 'Page copiée';
  const unit = wordCount > 1 ? 'mots' : 'mot';
  return `${scope} · ~${wordCount} ${unit}`;
}

async function runCopy(mode: ExtractMode): Promise<CopyResult> {
  if (!(document.documentElement instanceof HTMLElement)) {
    return { ok: false, reason: 'unsupported_document' };
  }

  const extracted = extractDocumentContent(document, mode);
  const markdown = formatDocumentAsMarkdown(extracted);

  if (!markdown) {
    showToast('Aucun contenu exploitable trouvé sur cette page.', 'error');
    return { ok: false, reason: 'empty', source: extracted.source };
  }

  const copied = await copyToClipboard(markdown, document);
  if (!copied) {
    showToast('Impossible d’écrire dans le presse-papier.', 'error');
    return { ok: false, reason: 'clipboard_error', source: extracted.source };
  }

  const wordCount = countWords(markdown);
  showToast(formatCopySuccessMessage(extracted.source, wordCount));
  return { ok: true, source: extracted.source, wordCount };
}

export default defineUnlistedScript({
  main() {
    const runner: Page2MdRunner = runCopy;
    Reflect.set(globalThis, Symbol.for(RUNNER_SYMBOL_KEY), runner);
  },
});
