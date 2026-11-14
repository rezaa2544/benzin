import { formatJalaliTime, type MessageKind } from '@benzin/shared';
import { t } from '../lib/i18n.js';

export interface ChatBubbleProps {
  text: string;
  createdAt: string;
  mine?: boolean;
  kind?: MessageKind;
  phone?: string;
}

/**
 * One chat line. SYSTEM messages become a centred pill, a CONTACT card shows the number
 * the sender deliberately shared, and everything else is a normal bubble aligned by side.
 */
export function ChatBubble({
  text,
  createdAt,
  mine = false,
  kind = 'TEXT',
  phone,
}: ChatBubbleProps): JSX.Element {
  if (kind === 'SYSTEM') {
    return (
      <div className="my-2 flex justify-center">
        <span className="chip max-w-[90%] text-center">{text}</span>
      </div>
    );
  }

  if (kind === 'CONTACT') {
    return (
      <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
        <div className="card max-w-[80%] border-brand/40 bg-brandSoft p-3">
          <span className="text-xs text-muted">{t('chat.contactCard')}</span>
          <p dir="ltr" className="tnum text-base font-bold text-brand">
            {phone ?? text}
          </p>
          <span className="mt-1 block text-[0.6875rem] text-muted tnum">
            {formatJalaliTime(createdAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${
          mine ? 'bg-brand text-brandInk' : 'bg-surface2 text-ink'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        <span className={`mt-1 block text-[0.6875rem] tnum ${mine ? 'opacity-80' : 'text-muted'}`}>
          {formatJalaliTime(createdAt)}
          {mine ? ` · ${t('common.you')}` : ''}
        </span>
      </div>
    </div>
  );
}
