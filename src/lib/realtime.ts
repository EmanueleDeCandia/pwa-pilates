import { useEffect, useRef, useState } from 'react';
import { getStoredToken } from './api';
import { triggerLocalBrowserNotification } from './pwa';
import type { RealtimeEvent } from '../../shared/types';

export function useRealtimeSync(
  sessionKey: string | null,
  onEvent: (event: RealtimeEvent) => void
): { connected: boolean; lastSyncAt: string | null } {
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!sessionKey || typeof window === 'undefined') {
      setConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredToken();
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      const url = `${protocol}//${window.location.host}/ws${query}`;

      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        setLastSyncAt(new Date().toISOString());
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(String(msg.data)) as RealtimeEvent;
          setLastSyncAt(event.timestamp || new Date().toISOString());
          if (event.type === 'PUSH_ALERT' && event.message) {
            triggerLocalBrowserNotification('Atelier Élan — Promemoria', event.message);
          }
          if (event.type === 'SYNC' || event.type === 'PUSH_ALERT') {
            handlerRef.current(event);
          }
        } catch {
          // ignore malformed payload
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(12_000, 1200 * Math.pow(1.6, attempt++));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [sessionKey]);

  return { connected, lastSyncAt };
}
