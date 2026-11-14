import { randomUUID } from 'node:crypto';
import type { Conversation, Message } from '../../domain/entities.js';
import type {
  ConversationRepository,
  MessageRepository,
  NewMessage,
  OrderRepository,
  ReservationRepository,
} from '../../ports.js';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * In-memory chat stores (tasks E5-01/E5-02). One conversation per order — the unique
 * index `conversations_order_idx` in Postgres is mirrored here by the map key.
 */
export class MemoryConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();
  private readonly byOrder = new Map<string, string>();

  constructor(
    private readonly orders: OrderRepository,
    private readonly reservations: ReservationRepository,
  ) {}

  async findById(id: string): Promise<Conversation | null> {
    const conversation = this.byId.get(id);
    return conversation ? clone(conversation) : null;
  }

  async findByOrder(orderId: string): Promise<Conversation | null> {
    const id = this.byOrder.get(orderId);
    return id ? this.findById(id) : null;
  }

  async ensureForOrder(orderId: string, at: Date): Promise<Conversation> {
    const existing = await this.findByOrder(orderId);
    if (existing) return existing;
    const conversation: Conversation = {
      id: randomUUID(),
      orderId,
      createdAt: at,
      closedAt: null,
    };
    this.byId.set(conversation.id, clone(conversation));
    this.byOrder.set(orderId, conversation.id);
    return clone(conversation);
  }

  async close(id: string, at: Date): Promise<Conversation | null> {
    const conversation = this.byId.get(id);
    if (!conversation) return null;
    conversation.closedAt ??= at;
    return clone(conversation);
  }

  async listByParticipant(userId: string, limit: number): Promise<Conversation[]> {
    const orderIds = new Set<string>();
    for (const order of await this.orders.listByOwner(userId, limit)) orderIds.add(order.id);
    for (const reservation of await this.reservations.listByTaker(userId, limit)) {
      orderIds.add(reservation.orderId);
    }
    return [...this.byId.values()]
      .filter((conversation) => orderIds.has(conversation.orderId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }
}

export class MemoryMessageRepository implements MessageRepository {
  private readonly byId = new Map<string, Message>();
  private readonly byClientId = new Map<string, string>();

  private key(conversationId: string, clientMessageId: string): string {
    return `${conversationId}:${clientMessageId}`;
  }

  async append(input: NewMessage, at: Date): Promise<Message | null> {
    if (input.clientMessageId) {
      const existing = this.byClientId.get(this.key(input.conversationId, input.clientMessageId));
      if (existing) return null;
    }
    const message: Message = {
      id: randomUUID(),
      conversationId: input.conversationId,
      senderId: input.senderId,
      kind: input.kind,
      body: input.body,
      clientMessageId: input.clientMessageId,
      readAt: null,
      createdAt: at,
    };
    this.byId.set(message.id, clone(message));
    if (message.clientMessageId) {
      this.byClientId.set(this.key(message.conversationId, message.clientMessageId), message.id);
    }
    return clone(message);
  }

  async findByClientId(conversationId: string, clientMessageId: string): Promise<Message | null> {
    const id = this.byClientId.get(this.key(conversationId, clientMessageId));
    if (!id) return null;
    const message = this.byId.get(id);
    return message ? clone(message) : null;
  }

  async listByConversation(
    conversationId: string,
    options: { after: Date | null; limit: number },
  ): Promise<Message[]> {
    return [...this.byId.values()]
      .filter((message) => message.conversationId === conversationId)
      .filter(
        (message) =>
          options.after === null || message.createdAt.getTime() > options.after.getTime(),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, options.limit)
      .map(clone);
  }

  async lastMessage(conversationId: string): Promise<Message | null> {
    const messages = await this.listByConversation(conversationId, { after: null, limit: 5000 });
    return messages.at(-1) ?? null;
  }

  async markRead(conversationId: string, readerId: string, at: Date): Promise<number> {
    let changed = 0;
    for (const message of this.byId.values()) {
      if (message.conversationId !== conversationId) continue;
      if (message.senderId === readerId || message.readAt) continue;
      message.readAt = at;
      changed += 1;
    }
    return changed;
  }

  async countUnread(conversationId: string, readerId: string): Promise<number> {
    let unread = 0;
    for (const message of this.byId.values()) {
      if (message.conversationId !== conversationId) continue;
      if (message.senderId === readerId || message.readAt) continue;
      unread += 1;
    }
    return unread;
  }
}
