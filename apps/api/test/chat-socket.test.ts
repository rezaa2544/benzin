import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  auth,
  createTestContext,
  login,
  freshPhone,
  startTrade,
  type TestContext,
} from './helpers.js';

interface Frame {
  type: string;
  code?: string;
  conversationId?: string;
  payload?: { message: { body: string; kind: string } };
}

const open = async (baseUrl: string): Promise<WebSocket> => {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/v1/chat/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
};

const nextFrame = (socket: WebSocket, timeoutMs = 3_000): Promise<Frame> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no frame received')), timeoutMs);
    socket.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)) as Frame);
    });
  });

const sendFrame = (socket: WebSocket, frame: unknown): void => socket.send(JSON.stringify(frame));

describe('chat websocket', () => {
  let ctx: TestContext;
  let baseUrl: string;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    ctx = await createTestContext();
    baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    await ctx.close();
  });

  it('authenticates, subscribes and receives new messages live', async () => {
    const trade = await startTrade(ctx);

    const socket = await open(baseUrl);
    sockets.push(socket);
    sendFrame(socket, { type: 'auth', token: trade.owner.token });
    const authenticated = await nextFrame(socket);
    expect(authenticated).toEqual({ type: 'authenticated', userId: trade.owner.userId });

    sendFrame(socket, { type: 'subscribe', conversationId: trade.conversationId });
    const subscribed = await nextFrame(socket);
    expect(subscribed).toEqual({ type: 'subscribed', conversationId: trade.conversationId });

    const received = nextFrame(socket);
    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(trade.taker.token),
      payload: { body: 'رسیدم دم پمپ' },
    });
    expect(sent.statusCode).toBe(201);

    const event = await received;
    expect(event.type).toBe('message.created');
    expect(event.conversationId).toBe(trade.conversationId);
    expect(event.payload?.message.body).toBe('رسیدم دم پمپ');
    expect(event.payload?.message.kind).toBe('TEXT');
  });

  it('refuses unauthenticated subscriptions', async () => {
    const socket = await open(baseUrl);
    sockets.push(socket);

    sendFrame(socket, { type: 'subscribe', conversationId: crypto.randomUUID() });
    const frame = await nextFrame(socket);
    expect(frame.type).toBe('error');
    expect(frame.code).toBe('UNAUTHORIZED');
  });

  it('refuses to subscribe a stranger to someone else’s thread', async () => {
    const trade = await startTrade(ctx);
    const outsider = (await login(ctx, freshPhone())).token;

    const socket = await open(baseUrl);
    sockets.push(socket);
    sendFrame(socket, { type: 'auth', token: outsider });
    expect((await nextFrame(socket)).type).toBe('authenticated');

    sendFrame(socket, { type: 'subscribe', conversationId: trade.conversationId });
    const frame = await nextFrame(socket);
    expect(frame.type).toBe('error');
    expect(frame.code).toBe('NOT_CONVERSATION_PARTY');
  });

  it('rejects a malformed token and closes the socket', async () => {
    const socket = await open(baseUrl);
    sockets.push(socket);

    sendFrame(socket, { type: 'auth', token: 'not-a-jwt' });
    const frame = await nextFrame(socket);
    expect(frame).toEqual({ type: 'error', code: 'UNAUTHORIZED' });

    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    expect(await closed).toBe(4401);
  });

  it('answers unknown frames without dropping the session', async () => {
    const trade = await startTrade(ctx);
    const socket = await open(baseUrl);
    sockets.push(socket);

    sendFrame(socket, { type: 'auth', token: trade.taker.token });
    await nextFrame(socket);

    socket.send('not json');
    expect((await nextFrame(socket)).code).toBe('INVALID_FRAME');

    sendFrame(socket, { type: 'ping' });
    expect((await nextFrame(socket)).code).toBe('UNKNOWN_FRAME');

    sendFrame(socket, { type: 'subscribe', conversationId: trade.conversationId });
    expect((await nextFrame(socket)).type).toBe('subscribed');
  });
});
