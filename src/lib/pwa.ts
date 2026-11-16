import { apiFetch } from './api';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => null);
  }
  return swRegistrationPromise;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToWebPush(): Promise<{
  ok: boolean;
  mode: 'webpush' | 'local-fallback';
  message: string;
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      ok: false,
      mode: 'local-fallback',
      message: 'Questo browser non supporta le notifiche Web Push.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      mode: 'local-fallback',
      message: 'Permesso notifiche negato nelle impostazioni del browser.',
    };
  }

  const reg = await registerServiceWorker();
  const { publicKey } = await apiFetch<{ publicKey: string }>('/api/push/vapid-public-key');

  if (reg && 'pushManager' in reg) {
    try {
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));

      await apiFetch('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      return {
        ok: true,
        mode: 'webpush',
        message: 'Notifiche Web Push attivate (-60 min inizio lezione e +15 min chiusura appello).',
      };
    } catch {
      // Fallback per ambienti di pre-produzione/anteprima senza push service esterno
    }
  }

  // Registra sottoscrizione locale di pre-produzione per ricevere avvisi tramite Service Worker + WebSocket
  await apiFetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: {
        endpoint: `${window.location.origin}/local-push-preview`,
        keys: { p256dh: 'local-preview', auth: 'local-preview' },
      },
    }),
  });

  return {
    ok: true,
    mode: 'local-fallback',
    message:
      'Promemoria push attivati in modalità pre-produzione (-60 min turno e +15 min appello).',
  };
}

export async function unsubscribeFromWebPush(): Promise<void> {
  const reg = await registerServiceWorker();
  if (reg && 'pushManager' in reg) {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {
      // ignore
    }
  }
  await apiFetch('/api/push/subscribe', { method: 'DELETE' });
}

export async function triggerLocalBrowserNotification(title: string, body: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await registerServiceWorker();
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
      return;
    }
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch {
    // ignore
  }
}
