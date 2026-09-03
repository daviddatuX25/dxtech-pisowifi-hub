import { appConfig } from './config';
import { savePushSubscription } from './api';

export type NotificationAvailability = 'available' | 'permission-denied' | 'unsupported' | 'missing-key';

export function getNotificationAvailability(): NotificationAvailability {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'permission-denied';
  if (!appConfig.vapidPublicKey) return 'missing-key';
  return 'available';
}

function decodeVapidKey(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}${padding}`;
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

export async function enableNotifications(profileToken: string, permission?: NotificationPermission): Promise<{
  enabled: boolean;
  message: string;
}> {
  const availability = getNotificationAvailability();
  if (availability === 'unsupported') {
    return { enabled: false, message: 'Hindi pa supported ng browser na ito ang alerts (gumamit ng Chrome o Safari sa mobile).' };
  }
  if (availability === 'permission-denied') {
    return { enabled: false, message: 'Naka-block ang alerts sa iyong browser settings. I-unblock para makatanggap ng updates.' };
  }
  if (availability === 'missing-key') {
    return { enabled: false, message: 'Kasalukuyang ina-activate ang alerts key sa system.' };
  }

  let resolvedPermission = permission;
  if (!resolvedPermission) {
    try {
      resolvedPermission = await requestNotificationPermission();
    } catch {
      return { enabled: false, message: 'Hindi ma-access ang alert permission sa browser.' };
    }
  }

  if (resolvedPermission !== 'granted') {
    return { enabled: false, message: 'Hindi pinayagan ang notification permission. Magagamit mo pa rin ang room nang normal.' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(appConfig.vapidPublicKey).buffer as ArrayBuffer,
      });
    }

    await savePushSubscription(subscription.toJSON(), profileToken);
    return { enabled: true, message: 'Naka-enable na ang live alerts sa browser na ito! ✓' };
  } catch (err) {
    console.error('Push notification registration failed:', err);
    return { enabled: false, message: 'Hindi nakumpleto ang alert setup. Tiyaking naka-HTTPS o pinapayagan ang service workers.' };
  }
}
