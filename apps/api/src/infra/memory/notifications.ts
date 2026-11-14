import { randomUUID } from 'node:crypto';
import type { NotificationRecord } from '../../domain/entities.js';
import type { NewNotification, NotificationRepository } from '../../ports.js';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory inbox (task E5-03). Mirrors `notifications_user_unread_idx` by filtering. */
export class MemoryNotificationRepository implements NotificationRepository {
  private readonly byId = new Map<string, NotificationRecord>();

  async create(input: NewNotification, at: Date): Promise<NotificationRecord> {
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: input.userId,
      channel: input.channel,
      kind: input.kind,
      titleFa: input.titleFa,
      bodyFa: input.bodyFa,
      payload: input.payload,
      readAt: null,
      sentAt: input.sentAt,
      createdAt: at,
    };
    this.byId.set(notification.id, clone(notification));
    return clone(notification);
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const notification = this.byId.get(id);
    return notification ? clone(notification) : null;
  }

  async listByUser(
    userId: string,
    options: { limit: number; unreadOnly: boolean },
  ): Promise<NotificationRecord[]> {
    return [...this.byId.values()]
      .filter((notification) => notification.userId === userId)
      .filter((notification) => !options.unreadOnly || notification.readAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit)
      .map(clone);
  }

  async countUnread(userId: string): Promise<number> {
    let unread = 0;
    for (const notification of this.byId.values()) {
      if (notification.userId === userId && notification.readAt === null) unread += 1;
    }
    return unread;
  }

  async markRead(id: string, userId: string, at: Date): Promise<NotificationRecord | null> {
    const notification = this.byId.get(id);
    if (!notification || notification.userId !== userId) return null;
    notification.readAt ??= at;
    return clone(notification);
  }

  async markAllRead(userId: string, at: Date): Promise<number> {
    let changed = 0;
    for (const notification of this.byId.values()) {
      if (notification.userId !== userId || notification.readAt !== null) continue;
      notification.readAt = at;
      changed += 1;
    }
    return changed;
  }
}
