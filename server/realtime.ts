import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { extractTokensFromCookieHeader, verifyAuthToken } from './auth.js';
import type { AuthUser, RealtimeEvent } from '../shared/types.js';

interface ClientMeta {
  ws: WebSocket;
  user: AuthUser;
}

const clients = new Set<ClientMeta>();

// Entità economiche/amministrative che NON vengono mai notificate ai client STAFF (RLS WebSocket)
const ADMIN_ONLY_ENTITIES = new Set(['packages', 'students', 'audit', 'settings', 'inquiries']);

export function attachRealtimeServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      // Lascia gestire ad altri listener (es. Vite HMR in sviluppo)
      return;
    }

    const candidates: string[] = [];
    const qTok = url.searchParams.get('token');
    if (qTok) candidates.push(qTok);
    candidates.push(...extractTokensFromCookieHeader(req.headers.cookie));

    let user: AuthUser | null = null;
    for (const tok of candidates) {
      const verified = verifyAuthToken(tok);
      if (verified) {
        user = verified;
        break;
      }
    }

    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const meta: ClientMeta = { ws, user };
      clients.add(meta);

      const welcome: RealtimeEvent = {
        type: 'CONNECTED',
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(welcome));

      ws.on('close', () => {
        clients.delete(meta);
      });
      ws.on('error', () => {
        clients.delete(meta);
      });
    });
  });

  // Heartbeat ogni 30s per mantenere attive le connessioni dietro proxy
  const interval = setInterval(() => {
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      } else {
        clients.delete(client);
      }
    }
  }, 30_000);
  interval.unref();

  return wss;
}

export function broadcastSync(
  entity: NonNullable<RealtimeEvent['entity']>,
  action: string,
  options: { lessonSlotId?: string; adminOnlyMessage?: string; staffSafeMessage?: string } = {}
): void {
  const timestamp = new Date().toISOString();

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;

    if (client.user.role === 'STAFF' && ADMIN_ONLY_ENTITIES.has(entity)) {
      continue;
    }

    const payload: RealtimeEvent = {
      type: 'SYNC',
      entity,
      action,
      lesson_slot_id: options.lessonSlotId,
      message:
        client.user.role === 'ADMIN'
          ? options.adminOnlyMessage ?? options.staffSafeMessage
          : options.staffSafeMessage,
      timestamp,
    };

    try {
      client.ws.send(JSON.stringify(payload));
    } catch {
      // ignore closed socket
    }
  }
}

export function sendRealtimePushAlert(
  userId: string,
  message: string,
  lessonSlotId?: string
): void {
  const payload: RealtimeEvent = {
    type: 'PUSH_ALERT',
    message,
    lesson_slot_id: lessonSlotId,
    timestamp: new Date().toISOString(),
  };
  const encoded = JSON.stringify(payload);
  for (const client of clients) {
    if (client.user.id === userId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(encoded);
      } catch {
        // ignore
      }
    }
  }
}

export function getConnectedClientsCount(): number {
  return clients.size;
}
