function captureSelectionRanges(doc: Document): Range[] {
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return [];
  }
  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    ranges.push(selection.getRangeAt(i).cloneRange());
  }
  return ranges;
}

function restoreSelectionRanges(doc: Document, ranges: readonly Range[]): void {
  const selection = doc.defaultView?.getSelection();
  if (!selection || ranges.length === 0) {
    return;
  }
  selection.removeAllRanges();
  for (const range of ranges) {
    selection.addRange(range);
  }
}

function copyViaTextarea(text: string, doc: Document): boolean {
  if (!(doc.documentElement instanceof HTMLElement) || !doc.body) {
    return false;
  }

  const previousActive =
    doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const savedRanges = captureSelectionRanges(doc);

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  doc.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return doc.execCommand('copy');
  } finally {
    textarea.remove();
    restoreSelectionRanges(doc, savedRanges);
    previousActive?.focus({ preventScroll: true });
  }
}

export async function copyToClipboard(
  text: string,
  doc: Document = document
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('[page2md] Async clipboard write failed, using DOM fallback:', error);
    }
  }

  return copyViaTextarea(text, doc);
}
