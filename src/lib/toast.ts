export type ToastVariant = 'success' | 'error';

const TOAST_HOST_ID = 'page2md-toast-host';
const TOAST_TEARDOWN_SYMBOL = Symbol.for('page2md.toastTeardown');
const TOAST_DURATION_MS = 2200;
const TOAST_TRANSITION_MS = 150;
const TOAST_REMOVE_DELAY_MS = 180;

interface ToastVariantConfig {
  background: string;
  border: string;
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

const TOAST_VARIANT_STYLES: Readonly<Record<ToastVariant, ToastVariantConfig>> = {
  success: {
    background: '#18181b',
    border: '#3f3f46',
    role: 'status',
    ariaLive: 'polite',
  },
  error: {
    background: '#b91c1c',
    border: '#ef4444',
    role: 'alert',
    ariaLive: 'assertive',
  },
};

interface ToastHostElement extends HTMLDivElement {
  [TOAST_TEARDOWN_SYMBOL]?: () => void;
}

function removeExistingToast(doc: Document): void {
  const existing = doc.getElementById(TOAST_HOST_ID) as ToastHostElement | null;
  if (!existing) {
    return;
  }
  existing[TOAST_TEARDOWN_SYMBOL]?.();
  existing.remove();
}

function buildToastCss(variantConfig: ToastVariantConfig): string {
  return `
    :host {
      all: initial !important;
      position: fixed !important;
      bottom: 16px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    }
    .toast {
      all: initial;
      display: block;
      box-sizing: border-box;
      max-width: calc(100vw - 32px);
      overflow-wrap: break-word;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      letter-spacing: normal;
      text-transform: none;
      white-space: normal;
      padding: 10px 14px;
      border-radius: 8px;
      color: #fafafa;
      background: ${variantConfig.background};
      border: 1px solid ${variantConfig.border};
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      opacity: 0;
      transform: translateY(6px);
      transition: opacity ${TOAST_TRANSITION_MS}ms ease, transform ${TOAST_TRANSITION_MS}ms ease;
    }
    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        transition: none;
        transform: none;
      }
    }
  `;
}

function attachToastStyles(shadow: ShadowRoot, doc: Document, css: string): void {
  const styleSheetCtor =
    doc.defaultView?.CSSStyleSheet ??
    (typeof CSSStyleSheet !== 'undefined' ? CSSStyleSheet : undefined);

  if (typeof styleSheetCtor === 'function' && 'adoptedStyleSheets' in shadow) {
    try {
      const sheet = new styleSheetCtor();
      if (typeof sheet.replaceSync === 'function') {
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return;
      }
    } catch {
      void 0;
    }
  }

  const style = doc.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
}

function createToastHost(
  doc: Document,
  message: string,
  variantConfig: ToastVariantConfig
): { host: ToastHostElement; box: HTMLDivElement } {
  const host = doc.createElement('div') as ToastHostElement;
  host.id = TOAST_HOST_ID;

  const shadow = host.attachShadow({ mode: 'closed' });
  attachToastStyles(shadow, doc, buildToastCss(variantConfig));

  const box = doc.createElement('div');
  box.className = 'toast';
  box.setAttribute('role', variantConfig.role);
  box.setAttribute('aria-live', variantConfig.ariaLive);
  box.textContent = message;

  shadow.appendChild(box);
  return { host, box };
}

function scheduleToastLifecycle(
  host: ToastHostElement,
  box: HTMLDivElement,
  doc: Document
): void {
  const win = doc.defaultView;
  const raf =
    win && typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : null;
  const caf =
    win && typeof win.cancelAnimationFrame === 'function'
      ? win.cancelAnimationFrame.bind(win)
      : typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : null;

  let outerRafId: number | null = null;
  let innerRafId: number | null = null;
  let hideTimerId: ReturnType<typeof setTimeout> | null = null;
  let removeTimerId: ReturnType<typeof setTimeout> | null = null;

  const teardown = (): void => {
    if (outerRafId !== null && caf) {
      caf(outerRafId);
      outerRafId = null;
    }
    if (innerRafId !== null && caf) {
      caf(innerRafId);
      innerRafId = null;
    }
    if (hideTimerId !== null) {
      clearTimeout(hideTimerId);
      hideTimerId = null;
    }
    if (removeTimerId !== null) {
      clearTimeout(removeTimerId);
      removeTimerId = null;
    }
  };

  host[TOAST_TEARDOWN_SYMBOL] = teardown;

  if (raf) {
    outerRafId = raf(() => {
      outerRafId = null;
      innerRafId = raf(() => {
        innerRafId = null;
        box.classList.add('visible');
      });
    });
  } else {
    box.classList.add('visible');
  }

  hideTimerId = setTimeout(() => {
    hideTimerId = null;
    box.classList.remove('visible');
    removeTimerId = setTimeout(() => {
      removeTimerId = null;
      teardown();
      host.remove();
    }, TOAST_REMOVE_DELAY_MS);
  }, TOAST_DURATION_MS);
}

export function showToast(
  message: string,
  variant: ToastVariant = 'success',
  doc: Document = document
): void {
  if (!(doc.documentElement instanceof HTMLElement)) {
    return;
  }

  removeExistingToast(doc);

  const variantConfig = TOAST_VARIANT_STYLES[variant];
  const { host, box } = createToastHost(doc, message, variantConfig);

  doc.documentElement.appendChild(host);
  scheduleToastLifecycle(host, box, doc);
}
