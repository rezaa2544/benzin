import { AppError, renderNotification, type NotificationKind } from '@benzin/shared';
import type { Clock, NotificationRecord, User } from '../domain/entities.js';
import type { NotificationEmitter, Repositories, SmsSender } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  channel: 'IN_APP' | 'SMS' | 'PUSH';
  titleFa: string;
  bodyFa: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export const toNotificationView = (notification: NotificationRecord): NotificationView => ({
  id: notification.id,
  kind: notification.kind,
  channel: notification.channel,
  titleFa: notification.titleFa,
  bodyFa: notification.bodyFa,
  payload: notification.payload,
  readAt: notification.readAt?.toISOString() ?? null,
  createdAt: notification.createdAt.toISOString(),
});

/**
 * In-app inbox plus the SMS fan-out (task E5-03).
 *
 * Every domain event goes through `emit`, which renders the Persian template from
 * `packages/shared/src/notifications.ts` (E5-04) — the API never concatenates copy.
 * One row is stored per event; the SMS attempt is recorded in the audit log so a
 * provider outage never blocks or duplicates the inbox entry (ASSUMPTION A18).
 */
export class NotificationService implements NotificationEmitter {
  constructor(
    private readonly repos: Pick<Repositories, 'notifications' | 'users' | 'audit'>,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
    private readonly clock: Clock,
  ) {}

  async emit(input: {
    userId: string;
    kind: NotificationKind;
    params: Record<string, string | number>;
    payload?: Record<string, unknown>;
  }): Promise<NotificationRecord> {
    const rendered = renderNotification(input.kind, input.params);
    const now = this.clock.now();
    const notification = await this.repos.notifications.create(
      {
        userId: input.userId,
        channel: 'IN_APP',
        kind: rendered.kind,
        titleFa: rendered.titleFa,
        bodyFa: rendered.bodyFa,
        payload: { ...(input.payload ?? {}), kind: rendered.kind },
        sentAt: now,
      },
      now,
    );

    if (rendered.smsBodyFa !== null) {
      const config = await this.settings.get();
      if (config['notification.sms_enabled']) {
        const user = await this.repos.users.findById(input.userId);
        if (user) await this.sendSms(user, notification, rendered.smsBodyFa);
      }
    }

    return notification;
  }

  private async sendSms(user: User, notification: NotificationRecord, body: string): Promise<void> {
    try {
      await this.sms.send(user.phone, body);
      await this.repos.audit.append({
        actorId: null,
        action: 'notification.sms_sent',
        entity: 'notification',
        entityId: notification.id,
        metadata: { kind: notification.kind, phone: user.phone, chars: body.length },
      });
    } catch (error) {
      // A dead provider must never break the trade flow; the inbox row already exists.
      await this.repos.audit.append({
        actorId: null,
        action: 'notification.sms_failed',
        entity: 'notification',
        entityId: notification.id,
        metadata: {
          kind: notification.kind,
          phone: user.phone,
          error: error instanceof Error ? error.message : 'unknown',
        },
      });
    }
  }

  async list(
    user: User,
    options: { limit: number; unreadOnly: boolean },
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    const items = await this.repos.notifications.listByUser(user.id, options);
    return {
      items: items.map(toNotificationView),
      unreadCount: await this.repos.notifications.countUnread(user.id),
    };
  }

  async unreadCount(user: User): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.repos.notifications.countUnread(user.id) };
  }

  async markRead(user: User, id: string): Promise<NotificationView> {
    const notification = await this.repos.notifications.markRead(id, user.id, this.clock.now());
    if (!notification) {
      throw AppError.notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
    }
    return toNotificationView(notification);
  }

  async markAllRead(user: User): Promise<{ read: number; unreadCount: number }> {
    const read = await this.repos.notifications.markAllRead(user.id, this.clock.now());
    return { read, unreadCount: await this.repos.notifications.countUnread(user.id) };
  }
}
