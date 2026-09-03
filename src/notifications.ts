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
    return { enabled: false, message: 'Hindi supported ng browser ang alerts.' };
  }
  if (availability === 'permission-denied') {
    return { enabled: false, message: 'Naka-block ang alerts sa browser. Magagamit mo pa rin ang room.' };
  }
  if (availability === 'missing-key') {
    return { enabled: false, message: 'Hindi pa naka-set up ang alerts. Magagamit mo pa rin ang room.' };
  }

  const resolvedPermission = permission || await requestNotificationPermission();
  if (resolvedPermission !== 'granted') {
    return { enabled: false, message: 'Hindi na-enable ang alerts. Magagamit mo pa rin ang room.' };
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(appConfig.vapidPublicKey).buffer as ArrayBuffer,
  });

  await savePushSubscription(subscription.toJSON(), profileToken);
  return { enabled: true, message: 'Naka-enable na ang alerts sa browser na ito.' };
}
