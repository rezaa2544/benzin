import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isAppError } from '@benzin/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { User } from '../domain/entities.js';
import type { ChatEvent, ChatEventPublisher } from '../ports.js';
import type { AuthService } from '../modules/auth-service.js';
import type { ChatService } from '../modules/chat-service.js';

/** Path of the realtime chat channel (task E5-01). */
export const CHAT_SOCKET_PATH = '/v1/chat/ws';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;

interface ClientState {
  socket: WebSocket;
  user: User | null;
  conversationId: string | null;
  alive: boolean;
  authTimer: NodeJS.Timeout | null;
}

export interface ChatSocketHandle {
  /** Fan-out used by ChatService after it stored a message. */
  publisher: ChatEventPublisher;
  clients(): number;
  close(): Promise<void>;
}

const send = (socket: WebSocket, payload: unknown): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
};

/**
 * WebSocket gateway for chat.
 *
 * The first frame must be `{"type":"auth","token":"<access token>"}` — tokens never
 * travel in the query string, so they cannot leak into proxy or access logs. After that
 * the client subscribes to one conversation and receives `message.created` events.
 * Authorisation reuses ChatService, so socket and HTTP follow the same party rules.
 */
export function attachChatSocket(
  app: FastifyInstance,
  auth: AuthService,
  chat: ChatService,
): ChatSocketHandle {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientState>();

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname = '';
    try {
      pathname = new URL(request.url ?? '/', 'http://socket.local').pathname;
    } catch {
      return;
    }
    if (pathname !== CHAT_SOCKET_PATH) return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  };

  app.server.on('upgrade', onUpgrade);

  wss.on('connection', (socket: WebSocket) => {
    const authTimer = setTimeout(() => {
      send(socket, { type: 'error', code: 'AUTH_TIMEOUT' });
      socket.close(4401, 'auth timeout');
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();
    const state: ClientState = {
      socket,
      user: null,
      conversationId: null,
      alive: true,
      authTimer,
    };
    clients.set(socket, state);

    socket.on('pong', () => {
      state.alive = true;
    });

    socket.on('message', (raw) => {
      void (async () => {
        let frame: { type?: unknown; token?: unknown; conversationId?: unknown };
        try {
          frame = JSON.parse(String(raw)) as typeof frame;
        } catch {
          send(socket, { type: 'error', code: 'INVALID_FRAME' });
          return;
        }

        if (frame.type === 'auth') {
          if (state.user) {
            send(socket, { type: 'error', code: 'ALREADY_AUTHENTICATED' });
            return;
          }
          if (typeof frame.token !== 'string') {
            send(socket, { type: 'error', code: 'UNAUTHORIZED' });
            return;
          }
          try {
            state.user = await auth.authenticate(frame.token);
            if (state.authTimer) clearTimeout(state.authTimer);
            state.authTimer = null;
            send(socket, { type: 'authenticated', userId: state.user.id });
          } catch {
            send(socket, { type: 'error', code: 'UNAUTHORIZED' });
            socket.close(4401, 'unauthorized');
          }
          return;
        }

        if (frame.type === 'subscribe') {
          if (!state.user) {
            send(socket, { type: 'error', code: 'UNAUTHORIZED' });
            return;
          }
          if (typeof frame.conversationId !== 'string') {
            send(socket, { type: 'error', code: 'VALIDATION_ERROR' });
            return;
          }
          try {
            // Same authorisation as GET /v1/conversations/:id.
            await chat.get(state.user, frame.conversationId);
            state.conversationId = frame.conversationId;
            send(socket, { type: 'subscribed', conversationId: frame.conversationId });
          } catch (error) {
            send(socket, {
              type: 'error',
              code: isAppError(error) ? error.code : 'NOT_CONVERSATION_PARTY',
            });
          }
          return;
        }

        send(socket, { type: 'error', code: 'UNKNOWN_FRAME' });
      })();
    });

    socket.on('close', () => {
      if (state.authTimer) clearTimeout(state.authTimer);
      clients.delete(socket);
    });

    socket.on('error', () => {
      clients.delete(socket);
    });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, state] of clients) {
      if (!state.alive) {
        socket.terminate();
        clients.delete(socket);
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    publisher: {
      publish(event: ChatEvent) {
        for (const state of clients.values()) {
          if (state.conversationId !== event.conversationId) continue;
          send(state.socket, event);
        }
      },
    },
    clients: () => clients.size,
    close: async () => {
      clearInterval(heartbeat);
      app.server.off('upgrade', onUpgrade);
      for (const socket of clients.keys()) socket.terminate();
      clients.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
