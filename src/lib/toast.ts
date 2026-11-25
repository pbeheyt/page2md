const TOAST_HOST_ID = 'page2md-toast-host';
const TOAST_DURATION_MS = 2200;

export function showToast(message: string, variant: 'success' | 'error' = 'success'): void {
  const existing = document.getElementById(TOAST_HOST_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = TOAST_HOST_ID;
  host.style.position = 'fixed';
  host.style.bottom = '16px';
  host.style.right = '16px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      padding: 10px 14px;
      border-radius: 8px;
      color: #fafafa;
      background: ${variant === 'error' ? '#b91c1c' : '#18181b'};
      border: 1px solid ${variant === 'error' ? '#ef4444' : '#3f3f46'};
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 150ms ease, transform 150ms ease;
    }
    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;

  const box = document.createElement('div');
  box.className = 'toast';
  box.textContent = message;

  shadow.appendChild(style);
  shadow.appendChild(box);
  (document.body ?? document.documentElement).appendChild(host);

  requestAnimationFrame(() => {
    box.classList.add('visible');
  });

  setTimeout(() => {
    box.classList.remove('visible');
    setTimeout(() => host.remove(), 180);
  }, TOAST_DURATION_MS);
}
