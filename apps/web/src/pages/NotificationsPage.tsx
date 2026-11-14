import { useCallback, useState } from 'react';
import { formatJalaliDateTime } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { NotificationList, NotificationView } from '../lib/types.js';
import { useResource } from '../lib/useResource.js';
import { t, tf } from '../lib/i18n.js';
import { EmptyState } from '../components/EmptyState.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface NotificationsPageProps {
  api: ApiClient;
  onUnreadChange?: (count: number) => void;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  UNAUTHORIZED: t('errors.UNAUTHORIZED'),
};

/** Notification centre (E9-14): unread filter, mark-one and mark-all. */
export function NotificationsPage({ api, onUnreadChange }: NotificationsPageProps): JSX.Element {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationView[] | null>(null);

  const load = useCallback(async () => {
    const page = await api.get<NotificationList>('/v1/notifications', {
      limit: 50,
      unreadOnly: unreadOnly ? 'true' : 'false',
    });
    setItems(page.items);
    onUnreadChange?.(page.unreadCount);
    return page;
  }, [api, unreadOnly, onUnreadChange]);

  const { data, loading, error, reload } = useResource(load, [api, unreadOnly]);

  const markOne = async (notification: NotificationView): Promise<void> => {
    if (notification.readAt) return;
    try {
      await api.post(`/v1/notifications/${notification.id}/read`);
      reload();
    } catch {
      /* the list reload is best effort; the badge keeps its last value */
    }
  };

  const markAll = async (): Promise<void> => {
    try {
      await api.post('/v1/notifications/read-all');
      reload();
    } catch {
      /* same */
    }
  };

  const list = items ?? data?.items ?? [];

  return (
    <div>
      <PageTitle
        title={t('notifications.title')}
        action={
          <button type="button" className="btn btn-ghost text-xs" onClick={() => void markAll()}>
            {t('notifications.readAll')}
          </button>
        }
      />

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={`chip ${unreadOnly ? '' : 'bg-brandSoft text-brand'}`}
          aria-pressed={!unreadOnly}
          onClick={() => setUnreadOnly(false)}
        >
          {t('notifications.all')}
        </button>
        <button
          type="button"
          className={`chip ${unreadOnly ? 'bg-brandSoft text-brand' : ''}`}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(true)}
        >
          {t('notifications.unreadOnly')}
        </button>
        {data && data.unreadCount > 0 ? (
          <span className="chip tnum">
            {tf('notifications.unread', { count: data.unreadCount })}
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton rows={3} />
      ) : error ? (
        <Notice tone="error">{errorMessage(error, errorMap)}</Notice>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('notifications.empty')}
          body={t('notifications.emptyBody')}
          icon="bell"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => void markOne(notification)}
                className={`card w-full text-start ${notification.readAt ? 'opacity-60' : ''}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{notification.titleFa}</span>
                  {notification.readAt ? null : (
                    <span className="h-2 w-2 shrink-0 rounded-pill bg-brand" aria-hidden="true" />
                  )}
                </div>
                <p className="text-xs text-muted">{notification.bodyFa}</p>
                <span className="mt-1 block text-[0.6875rem] text-muted tnum">
                  {formatJalaliDateTime(notification.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
