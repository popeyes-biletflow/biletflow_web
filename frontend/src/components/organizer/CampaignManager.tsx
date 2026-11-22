import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeCanvas } from 'qrcode.react';
import { formatKZT } from '../../services/events';
import { formatEventDateTime } from '../../services/tickets';
import {
  campaignUpgradeAvailable, fromLocalInput, organizerApi,
  type Campaign, type CampaignInput, type DiscountType, type OrganizerEvent, type OrganizerTicketType,
} from '../../services/organizer';
import { Notice, type NoticeState } from '../Notice';
import { inputClass } from './EventEditor';

interface Props {
  token: string;
  event: OrganizerEvent;
  types: OrganizerTicketType[];
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

const badge: Record<NonNullable<Campaign['state']>, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-blue-100 text-blue-800',
  expired: 'bg-gray-200 text-gray-700',
  disabled: 'bg-red-100 text-red-700',
};

const emptyForm = { name: '', code: '', type: 'percent' as DiscountType, value: '', tier: '', maxUses: '', starts: '', ends: '' };

export function CampaignManager({ token, event, types }: Props) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let live = true;
    organizerApi.campaigns(token, event.id)
      .then((res) => { if (live) { setCampaigns(res.campaigns); setLoadFailed(false); } })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [token, event.id, reloadKey]);

  useEffect(() => { campaignUpgradeAvailable().then(setUpgrade); }, []);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const visibleTypes = types.filter((x) => !x.is_hidden);
  const tierName = (id?: string | null) => types.find((x) => x.id === id)?.name ?? t('campaigns.allTiers');

  function validate(): string[] {
    const errors: string[] = [];
    const value = Number(form.value);
    if (!form.name.trim()) errors.push(t('campaigns.errors.name'));
    if (!CODE_PATTERN.test(form.code)) errors.push(t('campaigns.errors.code'));
    if (!Number.isInteger(value) || value < 1 || (form.type === 'percent' && value > 100)) {
      errors.push(form.type === 'percent' ? t('campaigns.errors.percent') : t('campaigns.errors.fixed'));
    }
    if (!Number.isInteger(Number(form.maxUses)) || Number(form.maxUses) < 1) errors.push(t('campaigns.errors.maxUses'));
    if (!form.ends) errors.push(t('campaigns.errors.ends'));
    else if (form.starts && form.ends <= form.starts) errors.push(t('campaigns.errors.window'));
    return errors;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (errors.length) {
      setNotice({ kind: 'error', text: t('campaigns.fixErrors'), items: errors });
      return;
    }
    const value = Number(form.value);
    const body: CampaignInput = {
      event_id: event.id,
      name: form.name.trim(),
      code: form.code.trim(),
      max_uses: Number(form.maxUses),
      ends_at: fromLocalInput(form.ends)!,
      starts_at: fromLocalInput(form.starts),
      ...(form.type === 'percent' ? { discount_percent: value } : {}),
      ...(upgrade ? { discount_type: form.type, discount_value: value, ticket_type_id: form.tier || null } : {}),
    };
    setBusy(true);
    setNotice(null);
    try {
      await organizerApi.createCampaign(token, body);
      setForm(emptyForm);
      setNotice({ kind: 'success', text: t('campaigns.created', { code: body.code.toUpperCase() }) });
      load();
    } catch (err) {
      setNotice({ kind: 'error', text: t('campaigns.createFailed', { reason: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: Campaign) {
    setBusy(true);
    setNotice(null);
    try {
      await organizerApi.setCampaignDisabled(token, c.campaign_id, !c.is_disabled);
      load();
    } catch (err) {
      setNotice({ kind: 'error', text: t('campaigns.toggleFailed', { reason: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setNotice({ kind: 'success', text: t('campaigns.copied') });
    } catch {
      setNotice({ kind: 'error', text: t('campaigns.copyFailed', { link }) });
    }
  }

  function downloadQr(c: Campaign) {
    const canvas = document.getElementById(`qr-${c.campaign_id}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `campaign-${c.code.toLowerCase()}.png`;
    a.click();
  }

  const discountText = (c: Campaign) => {
    const kind = c.discount_type ?? 'percent';
    const value = c.discount_value ?? c.discount_percent ?? 0;
    return kind === 'fixed_kzt' ? formatKZT(value) : `${value}%`;
  };

  return (
    <div className="space-y-6">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {!upgrade && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('campaigns.upgradePending')}</p>}

      <section>
        <h3 className="mb-3 font-semibold">{t('campaigns.listTitle')}</h3>
        {loadFailed && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {t('campaigns.loadFailed')} <button onClick={load} className="font-semibold underline">{t('common.retry')}</button>
          </p>
        )}
        {!loadFailed && campaigns === null && <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>}
        {campaigns?.length === 0 && <p className="text-sm text-gray-500">{t('campaigns.empty')}</p>}
        <ul className="space-y-3">
          {campaigns?.map((c) => (
            <li key={c.campaign_id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">{c.code}</span>
                {c.state && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[c.state]}`}>{t(`campaigns.state.${c.state}`)}</span>}
                <span className="ml-auto font-semibold">−{discountText(c)}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {tierName(c.ticket_type_id)}
                {c.starts_at && ` · ${formatEventDateTime(c.starts_at, event.timezone ?? 'Asia/Almaty')}`}
                {c.ends_at && ` → ${formatEventDateTime(c.ends_at, event.timezone ?? 'Asia/Almaty')}`}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <div><dt className="text-xs text-gray-500">{t('campaigns.stats.scans')}</dt><dd>{c.qr_scans}</dd></div>
                <div><dt className="text-xs text-gray-500">{t('campaigns.stats.redemptions')}</dt><dd>{c.orders} / {c.max_uses}</dd></div>
                <div><dt className="text-xs text-gray-500">{t('campaigns.stats.tickets')}</dt><dd>{c.tickets_sold}</dd></div>
                <div><dt className="text-xs text-gray-500">{t('campaigns.stats.discount')}</dt><dd>{formatKZT(c.discount_total_kzt)}</dd></div>
                <div><dt className="text-xs text-gray-500">{t('campaigns.stats.net')}</dt><dd>{formatKZT(c.net_revenue_kzt)}</dd></div>
              </dl>
              {c.qr_link && (
                <div className="mt-3 space-y-2">
                  <p className="break-all text-xs text-gray-600">
                    {t('campaigns.destination', { link: c.qr_link, target: `${window.location.origin}/events/${c.event_id}?promo=${c.code}` })}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <button onClick={() => copy(c.qr_link!)} className="text-blue-600">{t('campaigns.copyLink')}</button>
                    <button onClick={() => setQrFor(qrFor === c.campaign_id ? null : c.campaign_id)} className="text-blue-600" aria-expanded={qrFor === c.campaign_id}>
                      {t('campaigns.showQr')}
                    </button>
                    {upgrade && (
                      <button onClick={() => toggle(c)} disabled={busy} className={c.is_disabled ? 'text-emerald-700' : 'text-red-600'}>
                        {c.is_disabled ? t('campaigns.enable') : t('campaigns.disable')}
                      </button>
                    )}
                  </div>
                  {qrFor === c.campaign_id && (
                    <div className="flex items-end gap-3">
                      <QRCodeCanvas id={`qr-${c.campaign_id}`} value={c.qr_link} size={192} marginSize={2} />
                      <button onClick={() => downloadQr(c)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50">
                        {t('campaigns.downloadQr')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={create} noValidate className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
        <h3 className="font-semibold">{t('campaigns.newTitle')}</h3>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">{t('campaigns.name')} *
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} className={inputClass} />
          </label>
          <label className="text-sm">{t('campaigns.code')} *
            <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} maxLength={32} className={`${inputClass} font-mono`} />
          </label>
          <div className="text-sm">
            {t('campaigns.discountType')}
            <div className="mt-1 flex gap-2">
              {(['percent', 'fixed_kzt'] as DiscountType[]).map((k) => (
                <label key={k} className={`flex-1 rounded-md border px-3 py-2 ${form.type === k ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'} ${k === 'fixed_kzt' && !upgrade ? 'opacity-50' : 'cursor-pointer'}`}>
                  <input type="radio" name="discount-type" className="mr-2" checked={form.type === k}
                    disabled={k === 'fixed_kzt' && !upgrade} onChange={() => set('type', k)} />
                  {t(`campaigns.type.${k}`)}
                </label>
              ))}
            </div>
          </div>
          <label className="text-sm">{form.type === 'percent' ? t('campaigns.percent') : t('campaigns.fixed')} *
            <input type="number" min={1} max={form.type === 'percent' ? 100 : undefined} value={form.value} onChange={(e) => set('value', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">{t('campaigns.scope')}
            <select value={form.tier} onChange={(e) => set('tier', e.target.value)} disabled={!upgrade} className={inputClass}>
              <option value="">{t('campaigns.allTiers')}</option>
              {visibleTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="text-sm">{t('campaigns.maxUses')} *
            <input type="number" min={1} value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">{t('campaigns.starts')}
            <input type="datetime-local" value={form.starts} onChange={(e) => set('starts', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">{t('campaigns.ends')} *
            <input type="datetime-local" value={form.ends} onChange={(e) => set('ends', e.target.value)} className={inputClass} />
          </label>
        </fieldset>
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t('common.saving') : t('campaigns.create')}
        </button>
      </form>
    </div>
  );
}
