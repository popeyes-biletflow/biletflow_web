import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKZT, HttpError } from '../../services/events';
import {
  CHECKLIST_KEYS, organizerApi,
  type Checklist, type ChecklistKey, type OrganizerEvent, type OrganizerTicketType, type Profile,
} from '../../services/organizer';
import { Notice, type NoticeState } from '../Notice';
import { inputClass } from './EventEditor';

const ACTIVATION_FEE_KZT = 5000;

interface Props {
  token: string;
  event: OrganizerEvent;
  types: OrganizerTicketType[];
  onActivated: () => void;
  onGoToTickets: () => void;
}

type ItemState = 'passed' | 'missing' | 'pending';

export function PaidSalesActivation({ token, event, types, onActivated, onGoToTickets }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [payout, setPayout] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    organizerApi.profile(token)
      .then((p) => { setProfile(p); setPayout(p.payout_info ?? ''); })
      .catch((e) => setNotice({ kind: 'error', text: t('activation.profileFailed', { reason: e.message }) }));
  }, [token, t]);

  const active = event.paid_sales_status === 'ACTIVE';
  const suspended = event.paid_sales_status === 'SUSPENDED';
  const hasPaidType = types.some((tt) => (tt.price ?? 0) > 0);
  const hasPayout = Boolean(profile?.payout_info?.trim());

  const local: Record<ChecklistKey, ItemState> = {
    at_least_one_paid_ticket_type: hasPaidType ? 'passed' : 'missing',
    valid_payout_account: hasPayout ? 'passed' : 'missing',
    identity_verified: 'passed',
    activation_fee_paid: active ? 'passed' : 'pending',
    paid_event_terms_accepted: active || terms ? 'passed' : 'missing',
  };

  const state = (key: ChecklistKey): ItemState => (active ? 'passed' : local[key]);

  const missing = CHECKLIST_KEYS.filter((k) => state(k) === 'missing');

  async function savePayout() {
    if (!payout.trim()) {
      setNotice({ kind: 'error', text: t('activation.payoutRequired') });
      return;
    }
    setBusy(true);
    try {
      setProfile(await organizerApi.savePayout(token, payout.trim()));
      setNotice({ kind: 'success', text: t('activation.payoutSaved') });
    } catch (e) {
      setNotice({ kind: 'error', text: t('activation.payoutFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await organizerApi.activatePaidSales(token, event.id, terms);
      setNotice({
        kind: 'success',
        text: res.status === 'already_active' ? t('activation.alreadyActive') : t('activation.success', { fee: formatKZT(res.activation_fee_kzt ?? ACTIVATION_FEE_KZT) }),
      });
      onActivated();
    } catch (e) {
      const detail = e instanceof HttpError ? (e.detail as { checklist?: Checklist } | undefined) : undefined;
      if (detail?.checklist) {
        const failed = CHECKLIST_KEYS.filter((k) => detail.checklist?.[k] && !detail.checklist[k]?.passed);
        setNotice({ kind: 'error', text: t('activation.failed'), items: failed.map((k) => t(`activation.missing.${k}`)) });
      } else {
        setNotice({ kind: 'error', text: t('activation.requestFailed', { reason: (e as Error).message }) });
      }
    } finally {
      setBusy(false);
    }
  }

  const icon: Record<ItemState, string> = { passed: '✓', missing: '✕', pending: '•' };
  const color: Record<ItemState, string> = {
    passed: 'bg-emerald-100 text-emerald-700',
    missing: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="space-y-5">
      <div className={`rounded-lg border p-4 ${active ? 'border-emerald-200 bg-emerald-50' : suspended ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="font-semibold">
          {active ? t('activation.statusActive') : suspended ? t('activation.statusSuspended') : t('activation.statusInactive')}
        </p>
        <p className="mt-1 text-sm text-gray-700">
          {active ? t('activation.activeHint') : suspended ? t('activation.suspendedHint') : t('activation.inactiveHint')}
        </p>
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      <ol className="divide-y rounded-lg border border-gray-200">
        {CHECKLIST_KEYS.map((key) => {
          const s = state(key);
          return (
            <li key={key} className="flex gap-3 p-4">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${color[s]}`} aria-hidden>{icon[s]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`activation.items.${key}`)}</p>
                <p className={`text-sm ${s === 'missing' ? 'text-red-700' : 'text-gray-500'}`}>
                  {s === 'missing' ? t(`activation.missing.${key}`) : t(`activation.ok.${key}`, { fee: formatKZT(ACTIVATION_FEE_KZT) })}
                </p>

                {key === 'at_least_one_paid_ticket_type' && s === 'missing' && (
                  <button onClick={onGoToTickets} className="mt-2 text-sm font-semibold text-blue-600">{t('activation.addPaidType')}</button>
                )}

                {key === 'valid_payout_account' && !active && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={payout}
                      onChange={(e) => setPayout(e.target.value)}
                      placeholder="KZ00 0000 0000 0000 0000"
                      aria-label={t('activation.payoutLabel')}
                      className={`${inputClass} mt-0 font-mono sm:max-w-sm`}
                    />
                    <button onClick={savePayout} disabled={busy || payout.trim() === (profile?.payout_info ?? '')}
                      className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {t('activation.savePayout')}
                    </button>
                  </div>
                )}

                {key === 'paid_event_terms_accepted' && !active && (
                  <label className="mt-2 flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
                    <span>{t('activation.termsText', { fee: formatKZT(ACTIVATION_FEE_KZT) })}</span>
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!active && !suspended && (
        <div className="space-y-2">
          {missing.length > 0 && (
            <p className="text-sm text-red-700">{t('activation.stillMissing', { count: missing.length })}</p>
          )}
          <button onClick={activate} disabled={busy}
            className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {busy ? t('activation.activating') : t('activation.activate', { fee: formatKZT(ACTIVATION_FEE_KZT) })}
          </button>
          <p className="text-xs text-gray-500">{t('activation.simulatedNote')}</p>
        </div>
      )}
    </div>
  );
}
