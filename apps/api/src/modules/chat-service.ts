import {
  AppError,
  maskPhoneNumbers,
  type MessageKind,
  type ReservationStatus,
} from '@benzin/shared';
import type { Clock, Conversation, Message, Order, Reservation, User } from '../domain/entities.js';
import {
  NOOP_CHAT_EVENTS,
  type ChatEventPublisher,
  type NotificationEmitter,
  type Repositories,
} from '../ports.js';
import type { SettingsService } from './settings-service.js';

/** Reservations that still give the taker access to the thread (task E5-01). */
const PARTICIPANT_STATUSES: readonly ReservationStatus[] = [
  'PENDING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'AUTO_COMPLETED',
  'DISPUTED',
];

/** Statuses in which the two parties may still write to each other. */
const WRITABLE_ORDER_STATUSES = new Set(['RESERVED', 'CONFIRMED', 'DISPUTED']);

/** Only an accepted trade unlocks raw phone numbers (task E5-02). */
const CONTACT_ALLOWED_ORDER_STATUSES = new Set(['CONFIRMED', 'DISPUTED']);

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  readAt: string | null;
  /** True when the server replaced a phone number in this message (E5-02). */
  contactMasked?: boolean;
}

export interface ConversationView {
  id: string;
  orderId: string;
  createdAt: string;
  closedAt: string | null;
  writable: boolean;
  contactAllowed: boolean;
  peer: { id: string; displayName: string | null };
  unreadCount: number;
  lastMessage: { body: string; kind: MessageKind; senderId: string; createdAt: string } | null;
}

export const toMessageView = (message: Message, contactMasked?: boolean): MessageView => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  kind: message.kind,
  body: message.body,
  createdAt: message.createdAt.toISOString(),
  readAt: message.readAt?.toISOString() ?? null,
  ...(contactMasked === undefined ? {} : { contactMasked }),
});

const partyLabel = (isOwner: boolean): string => (isOwner ? 'صاحب سفارش' : 'خریدار');

interface ChatContext {
  conversation: Conversation;
  order: Order;
  reservations: Reservation[];
  isOwner: boolean;
}

/**
 * Order chat (tasks E5-01/E5-02). One thread per order, shared by the order owner and
 * whoever currently holds a reservation on it.
 *
 * Access rules are enforced here, not in the routes:
 *  - the owner may open the thread at any time;
 *  - a taker only while their reservation is live or was completed;
 *  - everyone else gets 403 NOT_CONVERSATION_PARTY (no 404 leak about the order).
 */
export class ChatService {
  constructor(
    private readonly repos: Pick<
      Repositories,
      'orders' | 'reservations' | 'conversations' | 'messages' | 'users' | 'audit'
    >,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly notifier: NotificationEmitter,
    private readonly events: ChatEventPublisher = NOOP_CHAT_EVENTS,
  ) {}

  private async context(actor: User, conversationId: string): Promise<ChatContext> {
    const conversation = await this.repos.conversations.findById(conversationId);
    if (!conversation) {
      throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    const order = await this.repos.orders.findById(conversation.orderId);
    if (!order) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    const reservations = await this.repos.reservations.listByOrder(order.id, 50);
    const isOwner = order.ownerId === actor.id;
    const isTaker = reservations.some(
      (reservation) =>
        reservation.takerId === actor.id && PARTICIPANT_STATUSES.includes(reservation.status),
    );
    if (!isOwner && !isTaker) {
      throw AppError.forbidden('NOT_CONVERSATION_PARTY', 'Not a party to this conversation');
    }
    return { conversation, order, reservations, isOwner };
  }

  private peerId(context: ChatContext, actor: User): string | null {
    if (context.order.ownerId !== actor.id) return context.order.ownerId;
    const taker = context.reservations.find((reservation) =>
      PARTICIPANT_STATUSES.includes(reservation.status),
    );
    return taker?.takerId ?? null;
  }

  private async view(context: ChatContext, actor: User): Promise<ConversationView> {
    const peerId = this.peerId(context, actor);
    const peer = peerId ? await this.repos.users.findById(peerId) : null;
    const last = await this.repos.messages.lastMessage(context.conversation.id);
    return {
      id: context.conversation.id,
      orderId: context.order.id,
      createdAt: context.conversation.createdAt.toISOString(),
      closedAt: context.conversation.closedAt?.toISOString() ?? null,
      writable: this.isWritable(context) && context.conversation.closedAt === null,
      contactAllowed: CONTACT_ALLOWED_ORDER_STATUSES.has(context.order.status),
      peer: { id: peer?.id ?? '', displayName: peer?.displayName ?? null },
      unreadCount: await this.repos.messages.countUnread(context.conversation.id, actor.id),
      lastMessage: last
        ? {
            body: last.body,
            kind: last.kind,
            senderId: last.senderId,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
    };
  }

  private isWritable(context: ChatContext): boolean {
    return WRITABLE_ORDER_STATUSES.has(context.order.status);
  }

  /** Opens (or returns) the thread of an order; only trade parties may call it. */
  async openForOrder(actor: User, orderId: string): Promise<ConversationView> {
    const order = await this.repos.orders.findById(orderId);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    const reservations = await this.repos.reservations.listByOrder(orderId, 50);
    const isOwner = order.ownerId === actor.id;
    const isTaker = reservations.some(
      (reservation) =>
        reservation.takerId === actor.id && PARTICIPANT_STATUSES.includes(reservation.status),
    );
    if (!isOwner && !isTaker) {
      throw AppError.forbidden('NOT_CONVERSATION_PARTY', 'Not a party to this order');
    }
    const conversation = await this.repos.conversations.ensureForOrder(orderId, this.clock.now());
    return this.view({ conversation, order, reservations, isOwner }, actor);
  }

  async get(actor: User, conversationId: string): Promise<ConversationView> {
    return this.view(await this.context(actor, conversationId), actor);
  }

  async listMine(actor: User, limit = 20): Promise<{ items: ConversationView[] }> {
    const conversations = await this.repos.conversations.listByParticipant(actor.id, limit);
    const items: ConversationView[] = [];
    for (const conversation of conversations) {
      const context = await this.context(actor, conversation.id);
      items.push(await this.view(context, actor));
    }
    return { items };
  }

  /**
   * Sends a message. Ordering rules:
   *  - the length cap comes from `chat.max_message_length`, not from the route schema;
   *  - a retried `clientMessageId` returns the stored message instead of duplicating it;
   *  - before the owner accepts, phone numbers are masked (E5-02).
   */
  async send(
    actor: User,
    conversationId: string,
    input: { body: string; clientMessageId?: string },
  ): Promise<MessageView> {
    const context = await this.context(actor, conversationId);
    if (context.conversation.closedAt !== null || !this.isWritable(context)) {
      // Persist the closure so later reads agree with the error (A19).
      await this.repos.conversations.close(context.conversation.id, this.clock.now());
      throw new AppError('CONVERSATION_CLOSED', 409, 'This conversation is closed', {
        orderStatus: context.order.status,
      });
    }
    const config = await this.settings.get();
    const maxLength = config['chat.max_message_length'];
    if (input.body.length > maxLength) {
      throw new AppError('MESSAGE_TOO_LONG', 422, 'Message is too long', { maxLength });
    }

    if (input.clientMessageId) {
      const existing = await this.repos.messages.findByClientId(
        conversationId,
        input.clientMessageId,
      );
      if (existing) return toMessageView(existing);
    }

    const contactAllowed = CONTACT_ALLOWED_ORDER_STATUSES.has(context.order.status);
    const masked = contactAllowed ? null : maskPhoneNumbers(input.body);
    const message = await this.repos.messages.append(
      {
        conversationId,
        senderId: actor.id,
        kind: 'TEXT',
        body: masked ? masked.body : input.body,
        clientMessageId: input.clientMessageId ?? null,
      },
      this.clock.now(),
    );
    if (!message) {
      const existing = input.clientMessageId
        ? await this.repos.messages.findByClientId(conversationId, input.clientMessageId)
        : null;
      if (existing) return toMessageView(existing);
      throw AppError.conflict('CONFLICT', 'Message already stored');
    }

    await this.repos.audit.append({
      actorId: actor.id,
      action: 'chat.message_sent',
      entity: 'conversation',
      entityId: conversationId,
      metadata: {
        orderId: context.order.id,
        contactMasked: masked ? masked.maskedCount : 0,
      },
    });

    this.events.publish({
      type: 'message.created',
      conversationId,
      payload: { message: toMessageView(message, masked ? masked.maskedCount > 0 : false) },
    });

    const peerId = this.peerId(context, actor);
    if (peerId) {
      await this.notifier.emit({
        userId: peerId,
        kind: 'CHAT_MESSAGE',
        params: { by: partyLabel(context.isOwner), litres: context.order.litres },
        payload: { conversationId, orderId: context.order.id, messageId: message.id },
      });
    }

    return toMessageView(message, masked ? masked.maskedCount > 0 : false);
  }

  /**
   * E5-02: a deliberate contact card. Allowed only once the owner accepted, and only
   * for the actor's own number — never the peer's (that stays a `/contact` reveal).
   */
  async shareContact(actor: User, conversationId: string): Promise<MessageView> {
    const context = await this.context(actor, conversationId);
    if (context.conversation.closedAt !== null || !this.isWritable(context)) {
      throw new AppError('CONVERSATION_CLOSED', 409, 'This conversation is closed');
    }
    if (!CONTACT_ALLOWED_ORDER_STATUSES.has(context.order.status)) {
      throw new AppError(
        'CONTACT_SHARING_BLOCKED',
        409,
        'Phone numbers unlock after the owner accepts',
        { orderStatus: context.order.status },
      );
    }
    const message = await this.repos.messages.append(
      {
        conversationId,
        senderId: actor.id,
        kind: 'CONTACT',
        body: actor.phone,
        clientMessageId: null,
      },
      this.clock.now(),
    );
    if (!message) throw AppError.conflict('CONFLICT', 'Message already stored');

    await this.repos.audit.append({
      actorId: actor.id,
      action: 'chat.contact_shared',
      entity: 'conversation',
      entityId: conversationId,
      metadata: { orderId: context.order.id },
    });

    this.events.publish({
      type: 'message.created',
      conversationId,
      payload: { message: toMessageView(message) },
    });

    const peerId = this.peerId(context, actor);
    if (peerId) {
      await this.notifier.emit({
        userId: peerId,
        kind: 'CONTACT_SHARED',
        params: { by: partyLabel(context.isOwner) },
        payload: { conversationId, orderId: context.order.id },
      });
    }
    return toMessageView(message);
  }

  async messages(
    actor: User,
    conversationId: string,
    query: { after?: string; limit: number },
  ): Promise<{ items: MessageView[]; nextCursor: string | null }> {
    await this.context(actor, conversationId);
    const after = query.after ? new Date(query.after) : null;
    const items = await this.repos.messages.listByConversation(conversationId, {
      after,
      limit: query.limit,
    });
    return {
      items: items.map((message) => toMessageView(message)),
      nextCursor: items.at(-1)?.createdAt.toISOString() ?? null,
    };
  }

  async markRead(actor: User, conversationId: string): Promise<{ read: number; unread: number }> {
    await this.context(actor, conversationId);
    const read = await this.repos.messages.markRead(conversationId, actor.id, this.clock.now());
    return {
      read,
      unread: await this.repos.messages.countUnread(conversationId, actor.id),
    };
  }

  /** Persian quick replies the client renders above the composer (E5-01). */
  async quickReplies(): Promise<{ items: string[] }> {
    const config = await this.settings.get();
    return { items: [...config['chat.quick_replies']] };
  }
}
