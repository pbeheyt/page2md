import type { ExtractMode, ExtractedDocument } from '@/lib/extractor';

export const RUNNER_SYMBOL_KEY = 'page2md.runCopy';

export interface CopyResult {
  ok: boolean;
  reason?: 'empty' | 'clipboard_error' | 'unsupported_document' | 'unexpected_error' | 'busy';
  source?: ExtractedDocument['source'];
  wordCount?: number;
  tokenEstimate?: number;
}

export type RunnerInvocationResult =
  | { status: 'missing' }
  | { status: 'ok'; result: CopyResult }
  | { status: 'error'; message: string };

export type Page2MdRunner = (mode: ExtractMode) => Promise<CopyResult>;
