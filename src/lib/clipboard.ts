interface InputSelectionState {
  element: HTMLInputElement | HTMLTextAreaElement;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
}

function captureInputSelection(activeEl: HTMLElement | null): InputSelectionState | null {
  if (!(activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement)) {
    return null;
  }
  try {
    return {
      element: activeEl,
      start: activeEl.selectionStart,
      end: activeEl.selectionEnd,
      direction: activeEl.selectionDirection,
    };
  } catch {
    return null;
  }
}

function restoreInputSelection(state: InputSelectionState | null): void {
  if (!state || !state.element.isConnected || state.start === null || state.end === null) {
    return;
  }
  state.element.setSelectionRange(state.start, state.end, state.direction ?? undefined);
}

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
  const savedInputSelection = captureInputSelection(previousActive);
  const savedRanges = savedInputSelection ? [] : captureSelectionRanges(doc);

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  const handleCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) {
      return;
    }
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  textarea.addEventListener('copy', handleCopy);
  doc.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return doc.execCommand('copy');
  } finally {
    textarea.removeEventListener('copy', handleCopy);
    textarea.remove();
    try {
      if (previousActive?.isConnected) {
        previousActive.focus({ preventScroll: true });
      }
      if (savedInputSelection) {
        restoreInputSelection(savedInputSelection);
      } else {
        restoreSelectionRanges(doc, savedRanges);
      }
    } catch (error) {
      console.debug('[page2md] Focus/selection restore skipped:', error);
    }
  }
}

export async function copyToClipboard(
  text: string,
  doc: Document = document
): Promise<boolean> {
  const clipboard =
    doc.defaultView?.navigator?.clipboard ??
    (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('[page2md] Async clipboard write failed, using DOM fallback:', error);
    }
  }

  return copyViaTextarea(text, doc);
}
