import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { ConversationView, MessageView, MetaConfig, PublicUser } from '../lib/types.js';
import { navigate } from '../lib/router.js';
import { useResource } from '../lib/useResource.js';
import { t } from '../lib/i18n.js';
import { ChatBubble } from '../components/ChatBubble.js';
import { EmptyState } from '../components/EmptyState.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface ChatPageProps {
  api: ApiClient;
  user: PublicUser;
  config: MetaConfig | null;
  conversationId?: string;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  CONVERSATION_CLOSED: t('chat.closed'),
  CONTACT_SHARING_BLOCKED: t('chat.blocked'),
  MESSAGE_TOO_LONG: t('errors.MESSAGE_TOO_LONG'),
  NOT_CONVERSATION_PARTY: t('errors.FORBIDDEN'),
};

/**
 * Chat (E9-10). Two modes on one route: the conversation list, and a thread with quick
 * replies plus the contact card. Polling is a plain interval because the socket is a later
 * task; the incremental endpoint takes `after` so a poll only carries new messages.
 */
export function ChatPage({ api, user, config, conversationId }: ChatPageProps): JSX.Element {
  if (!conversationId) return <ConversationList api={api} />;
  return <Thread api={api} user={user} config={config} conversationId={conversationId} />;
}

function ConversationList({ api }: { api: ApiClient }): JSX.Element {
  const load = useCallback(
    () => api.get<{ items: ConversationView[] }>('/v1/chat/conversations', { limit: 20 }),
    [api],
  );
  const { data, loading, error } = useResource(load, [api]);

  return (
    <div>
      <PageTitle title={t('chat.listTitle')} />
      {loading ? (
        <Skeleton rows={2} />
      ) : error ? (
        <Notice tone="error">{errorMessage(error, errorMap)}</Notice>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('chat.empty')} body={t('chat.emptyBody')} icon="chat" />
      ) : (
        <div className="flex flex-col gap-2">
          {data?.items.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className="card flex items-start justify-between gap-2 text-start"
              onClick={() => navigate(`/chat/${conversation.id}`)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {conversation.peer.displayName ?? t('chat.peer')}
                </p>
                <p className="truncate text-xs text-muted">
                  {conversation.lastMessage?.body ?? '—'}
                </p>
              </div>
              {conversation.unreadCount > 0 ? (
                <span className="rounded-pill bg-brand px-2 text-xs text-brandInk tnum">
                  {conversation.unreadCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Thread({
  api,
  user,
  config,
  conversationId,
}: {
  api: ApiClient;
  user: PublicUser;
  config: MetaConfig | null;
  conversationId: string;
}): JSX.Element {
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>(config?.quickReplies ?? []);
  const lastAt = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const merge = useCallback((incoming: MessageView[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const seen = new Set(current.map((message) => message.id));
      const merged = [...current, ...incoming.filter((message) => !seen.has(message.id))];
      lastAt.current = merged.at(-1)?.createdAt ?? lastAt.current;
      return merged;
    });
  }, []);

  const poll = useCallback(async () => {
    const query: Record<string, unknown> = { limit: 100 };
    if (lastAt.current) query.after = lastAt.current;
    const page = await api.get<{ items: MessageView[] }>(
      `/v1/conversations/${conversationId}/messages`,
      query,
    );
    merge(page.items);
  }, [api, conversationId, merge]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<ConversationView>(`/v1/conversations/${conversationId}`)
      .then((result) => {
        if (!cancelled) setConversation(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, errorMap));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void api
      .get<{ items: string[] }>('/v1/chat/quick-replies')
      .then((result) => {
        if (!cancelled) setQuickReplies(result.items);
      })
      .catch(() => undefined);
    void poll()
      .then(() => api.post(`/v1/conversations/${conversationId}/read`))
      .catch(() => undefined);
    const timer = setInterval(() => {
      void poll().catch(() => undefined);
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, conversationId, poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async (body: string): Promise<void> => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<MessageView>(`/v1/conversations/${conversationId}/messages`, {
        body: text,
      });
      merge([created]);
      setDraft('');
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  const shareContact = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await api.post<MessageView>(`/v1/conversations/${conversationId}/contact`);
      merge([created]);
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={3} />;

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <PageTitle title={conversation?.peer.displayName ?? t('chat.title')} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {conversation && !conversation.contactAllowed ? (
        <Notice tone="info">{t('chat.masked')}</Notice>
      ) : null}

      <div className="flex-1 overflow-y-auto pb-3">
        {messages.length === 0 ? (
          <EmptyState title={t('chat.empty')} icon="chat" />
        ) : (
          messages.map((message) => (
            <ChatBubble
              key={message.id}
              mine={message.senderId === user.id}
              kind={message.kind === 'CONTACT' ? 'CONTACT' : 'TEXT'}
              text={message.body}
              createdAt={message.createdAt}
            />
          ))
        )}
        <div ref={bottom} />
      </div>

      {conversation?.closedAt ? (
        <Notice tone="warning">{t('chat.closed')}</Notice>
      ) : (
        <>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {quickReplies.slice(0, 6).map((reply) => (
              <button
                key={reply}
                type="button"
                className="chip shrink-0"
                disabled={busy}
                onClick={() => void send(reply)}
              >
                {reply}
              </button>
            ))}
          </div>
          {conversation?.contactAllowed ? (
            <button
              type="button"
              className="btn mb-2 w-full"
              disabled={busy}
              onClick={() => void shareContact()}
            >
              {t('chat.sendContact')}
            </button>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <input
              className="input flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('chat.placeholder')}
              maxLength={config?.maxMessageLength ?? 2000}
              aria-label={t('chat.placeholder')}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
              {t('chat.send')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
