import { useCallback, useState } from 'react';
import { formatJalaliDate, formatJalaliDateTime, toPersianDigits } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { DeviceView, PublicUser, ReputationSummary, SubscriptionView } from '../lib/types.js';
import { validateDisplayName } from '../lib/profile.js';
import { navigate } from '../lib/router.js';
import { useResource } from '../lib/useResource.js';
import { t } from '../lib/i18n.js';
import { ConfirmSheet } from '../components/ConfirmSheet.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface ProfilePageProps {
  api: ApiClient;
  user: PublicUser;
  /** Keeps the cached session in sync after a rename. */
  onUser: (user: PublicUser) => void;
  onLogout: () => void;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  UNAUTHORIZED: t('errors.UNAUTHORIZED'),
};

/** Profile & reputation (E9-12): who I am, how I look to others, and how to sign out. */
export function ProfilePage({ api, user, onUser, onLogout }: ProfilePageProps): JSX.Element {
  const [sheet, setSheet] = useState<'logout' | 'logoutAll' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(user.displayName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    const [reputation, devices, subscription] = await Promise.all([
      api.get<ReputationSummary>('/v1/me/reputation'),
      api.get<{ items: DeviceView[] }>('/v1/me/devices').catch(() => ({ items: [] })),
      api
        .get<{ subscription: SubscriptionView | null }>('/v1/me/subscription')
        .catch(() => ({ subscription: null })),
    ]);
    return { reputation, devices: devices.items, subscription: subscription.subscription };
  }, [api]);

  const { data, loading, error: loadError } = useResource(load, [api]);

  /** E1-05: only the display name is editable; it is what the counterpart sees. */
  const saveName = async (): Promise<void> => {
    const result = validateDisplayName(name, {
      tooShort: t('profile.nameTooShort'),
      tooLong: t('profile.nameTooLong'),
      phoneLike: t('profile.namePhoneLike'),
    });
    setNameError(result.error);
    setNameSaved(false);
    if (result.error) return;
    setSavingName(true);
    setError(null);
    try {
      const updated = await api.patch<PublicUser>('/v1/me', { displayName: result.displayName });
      onUser(updated);
      setName(updated.displayName ?? '');
      setNameSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setSavingName(false);
    }
  };

  const logout = async (all: boolean): Promise<void> => {
    setSheet(null);
    setBusy(true);
    setError(null);
    try {
      if (all) await api.post('/v1/auth/logout-all');
      onLogout();
      navigate('/login', { replace: true });
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle title={t('profile.title')} lead={user.displayName ?? undefined} />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loadError ? <Notice tone="error">{errorMessage(loadError, errorMap)}</Notice> : null}

      <div className="card mb-3">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{t('profile.phone')}</dt>
          <dd className="text-end tnum" dir="ltr">
            {toPersianDigits(user.phone)}
          </dd>
          <dt className="text-muted">{t('profile.roleLabel')}</dt>
          <dd className="text-end">{user.role}</dd>
          {user.createdAt ? (
            <>
              <dt className="text-muted">{t('common.now')}</dt>
              <dd className="text-end tnum">{formatJalaliDate(user.createdAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="card mb-3">
        <label className="label" htmlFor="profile-name">
          {t('profile.displayName')}
        </label>
        <div className="flex items-end gap-2">
          <input
            id="profile-name"
            className="input flex-1"
            value={name}
            maxLength={60}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'profile-name-error' : 'profile-name-hint'}
            onChange={(event) => {
              setName(event.target.value);
              setNameSaved(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveName();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingName}
            onClick={() => void saveName()}
          >
            {savingName ? t('profile.saving') : t('profile.save')}
          </button>
        </div>
        {nameError ? (
          <p id="profile-name-error" role="alert" className="mt-1 text-xs text-danger">
            {nameError}
          </p>
        ) : (
          <p id="profile-name-hint" className="mt-1 text-xs text-muted">
            {t('profile.displayNameHint')}
          </p>
        )}
        {nameSaved ? <Notice tone="success">{t('profile.saved')}</Notice> : null}
      </div>

      {loading ? (
        <Skeleton rows={2} />
      ) : data ? (
        <>
          <div className="card mb-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold">{t('profile.reputation')}</h2>
              <span className="chip">{data.reputation.levelFa}</span>
            </div>
            <p className="mb-2 text-3xl font-bold tnum">
              {toPersianDigits(data.reputation.score)}
              <span className="ms-1 text-sm font-normal text-muted">{t('profile.score')}</span>
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">{t('profile.completed')}</dt>
              <dd className="text-end tnum">{toPersianDigits(data.reputation.completedTrades)}</dd>
              <dt className="text-muted">{t('profile.cancelled')}</dt>
              <dd className="text-end tnum">{toPersianDigits(data.reputation.cancelledTrades)}</dd>
              <dt className="text-muted">{t('profile.disputes')}</dt>
              <dd className="text-end tnum">{toPersianDigits(data.reputation.disputes)}</dd>
              <dt className="text-muted">{t('profile.rating')}</dt>
              <dd className="text-end tnum">
                {data.reputation.averageStars === null
                  ? t('profile.noRating')
                  : toPersianDigits(data.reputation.averageStars)}
              </dd>
            </dl>
          </div>

          <button
            type="button"
            className="card mb-2 flex w-full items-center justify-between text-start"
            onClick={() => navigate('/plans')}
          >
            <span className="text-sm font-medium">{t('profile.subscription')}</span>
            <span className="text-xs text-muted">
              {data.subscription
                ? `${data.subscription.planNameFa} · ${toPersianDigits(data.subscription.daysRemaining)}`
                : t('profile.noSubscription')}
            </span>
          </button>

          <div className="mb-3 flex gap-2">
            <button type="button" className="btn flex-1" onClick={() => navigate('/orders')}>
              {t('profile.myOrders')}
            </button>
            <button type="button" className="btn flex-1" onClick={() => navigate('/notifications')}>
              {t('profile.notifications')}
            </button>
          </div>

          {data.devices.length > 0 ? (
            <div className="card mb-3">
              <h2 className="mb-2 text-sm font-bold">{t('profile.devices')}</h2>
              <ul className="flex flex-col gap-2 text-xs">
                {data.devices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{device.platform}</span>
                    <span className="text-muted tnum">
                      {formatJalaliDateTime(device.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-danger w-full"
          disabled={busy}
          onClick={() => setSheet('logout')}
        >
          {t('profile.logout')}
        </button>
        <button
          type="button"
          className="btn btn-ghost w-full"
          disabled={busy}
          onClick={() => setSheet('logoutAll')}
        >
          {t('profile.logoutAll')}
        </button>
      </div>

      <ConfirmSheet
        open={sheet !== null}
        title={t('profile.confirmLogout')}
        body={sheet === 'logoutAll' ? t('profile.logoutAll') : undefined}
        confirmLabel={t('profile.logout')}
        tone="danger"
        busy={busy}
        onConfirm={() => void logout(sheet === 'logoutAll')}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}
