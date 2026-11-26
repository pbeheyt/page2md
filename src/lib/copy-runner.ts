import { copyToClipboard } from '@/lib/clipboard';
import {
  extractDocumentContent,
  type ExtractMode,
  type ExtractedDocument,
} from '@/lib/extractor';
import { countWords, formatDocumentAsMarkdown } from '@/lib/markdown';
import type { CopyResult } from '@/lib/protocol';
import { showToast, type ToastVariant } from '@/lib/toast';

const activeCopyDocuments = new WeakSet<Document>();

function estimateTokens(markdown: string): number {
  return Math.max(1, Math.round(markdown.length / 4));
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const k = (tokens / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return `~${k}k tokens`;
  }
  const unit = tokens > 1 ? 'tokens' : 'token';
  return `~${tokens} ${unit}`;
}

function formatCopySuccessMessage(
  source: ExtractedDocument['source'],
  wordCount: number,
  tokenEstimate: number
): string {
  const scope = source === 'selection' ? 'Sélection copiée' : 'Page copiée';
  const unit = wordCount > 1 ? 'mots' : 'mot';
  return `${scope} · ~${wordCount} ${unit} · ${formatTokenCount(tokenEstimate)}`;
}

function safeShowToast(message: string, variant: ToastVariant, doc: Document): void {
  try {
    showToast(message, variant, doc);
  } catch (error) {
    console.warn('[page2md] Unable to display toast:', error);
  }
}

export async function runCopy(
  mode: ExtractMode,
  doc: Document = document
): Promise<CopyResult> {
  if (!(doc.documentElement instanceof HTMLElement)) {
    return { ok: false, reason: 'unsupported_document' };
  }

  if (activeCopyDocuments.has(doc)) {
    return { ok: false, reason: 'busy' };
  }

  activeCopyDocuments.add(doc);

  try {
    const extracted = extractDocumentContent(doc, mode);
    const markdown = formatDocumentAsMarkdown(extracted);

    if (!markdown) {
      safeShowToast('Aucun contenu exploitable trouvé sur cette page.', 'error', doc);
      return { ok: false, reason: 'empty', source: extracted.source };
    }

    const copied = await copyToClipboard(markdown, doc);
    if (!copied) {
      safeShowToast('Impossible d’écrire dans le presse-papier.', 'error', doc);
      return { ok: false, reason: 'clipboard_error', source: extracted.source };
    }

    const wordCount = countWords(markdown);
    const tokenEstimate = estimateTokens(markdown);
    safeShowToast(
      formatCopySuccessMessage(extracted.source, wordCount, tokenEstimate),
      'success',
      doc
    );
    return { ok: true, source: extracted.source, wordCount, tokenEstimate };
  } catch (error) {
    console.warn('[page2md] Unexpected copy error:', error);
    safeShowToast('Erreur lors de la copie en Markdown.', 'error', doc);
    return { ok: false, reason: 'unexpected_error' };
  } finally {
    activeCopyDocuments.delete(doc);
  }
}
