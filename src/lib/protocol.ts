import type { ExtractMode, ExtractedDocument } from '@/lib/extractor';

export const RUNNER_SYMBOL_KEY = 'page2md.runCopy';

export interface CopyResult {
  ok: boolean;
  reason?: 'empty' | 'clipboard_error' | 'unsupported_document';
  source?: ExtractedDocument['source'];
  wordCount?: number;
}

export type Page2MdRunner = (mode: ExtractMode) => Promise<CopyResult>;
