import { animate } from 'motion';
import { icon, Icons } from './icons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  timerId?: number;
}

let containerEl: HTMLElement | null = null;
const activeToasts = new Map<string, HTMLElement>();

function ensureContainer(): HTMLElement {
  if (!containerEl || !document.body.contains(containerEl)) {
    containerEl = document.createElement('aside');
    containerEl.className = 'toast-container-top-right';
    containerEl.setAttribute('aria-live', 'polite');
    containerEl.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

export function showToast(message: string, type: ToastType = 'success', duration = 4500): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const container = ensureContainer();

  const toastCard = document.createElement('div');
  toastCard.className = `toast-card toast-${type}`;
  toastCard.id = id;
  toastCard.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const iconSvg = type === 'success' ? icon(Icons.CheckCircle2, 'toast-icon', 18)
    : type === 'error' ? icon(Icons.AlertTriangle, 'toast-icon', 18)
    : type === 'warning' ? icon(Icons.AlertCircle, 'toast-icon', 18)
    : icon(Icons.Info, 'toast-icon', 18);

  toastCard.innerHTML = `
    <span class="toast-indicator">${iconSvg}</span>
    <div class="toast-content">${message}</div>
    <button type="button" class="toast-close" aria-label="Close notification" data-toast-close="${id}">
      ${icon(Icons.X, 'toast-close-icon', 14)}
    </button>
  `;

  // Prepend so latest appears on top
  container.insertBefore(toastCard, container.firstChild);
  activeToasts.set(id, toastCard);

  // Entrance animation using motion
  try {
    animate(toastCard, {
      opacity: [0, 1],
      transform: ['translateX(40px) scale(0.95)', 'translateX(0px) scale(1)'],
    }, {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1],
    });
  } catch {
    // Fallback if motion is not supported
  }

  const dismiss = () => {
    const el = activeToasts.get(id);
    if (!el) return;
    activeToasts.delete(id);
    try {
      const anim = animate(el, {
        opacity: [1, 0],
        transform: ['translateX(0px)', 'translateX(30px) scale(0.95)'],
      }, {
        duration: 0.22,
        ease: 'easeIn',
      });
      anim.then(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    } catch {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };

  const closeBtn = toastCard.querySelector<HTMLButtonElement>('[data-toast-close]');
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });

  if (duration > 0) {
    window.setTimeout(dismiss, duration);
  }

  return id;
}

export const toast = {
  success: (msg: string, dur?: number) => showToast(msg, 'success', dur),
  error: (msg: string, dur?: number) => showToast(msg, 'error', dur || 6000),
  info: (msg: string, dur?: number) => showToast(msg, 'info', dur),
  warning: (msg: string, dur?: number) => showToast(msg, 'warning', dur || 5000),
};
