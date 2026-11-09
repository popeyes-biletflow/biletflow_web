import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKZT } from '../../services/events';
import { formatEventDateTime } from '../../services/tickets';
import {
  fromLocalInput, organizerApi, toLocalInput,
  type OrganizerTicketType, type TicketTypeInput,
} from '../../services/organizer';
import { Notice, type NoticeState } from '../Notice';
import { inputClass } from './EventEditor';

interface Props {
  token: string;
  eventId: string;
  types: OrganizerTicketType[];
  readOnly: boolean;
  paidSalesActive: boolean;
  onChange: (types: OrganizerTicketType[]) => void;
}

interface Form {
  name: string;
  description: string;
  free: boolean;
  price: string;
  quantity: string;
  saleStarts: string;
  saleEnds: string;
  maxPerOrder: string;
}

const emptyForm: Form = {
  name: '', description: '', free: true, price: '', quantity: '', saleStarts: '', saleEnds: '', maxPerOrder: '1',
};

const toForm = (tt: OrganizerTicketType): Form => ({
  name: tt.name ?? '',
  description: tt.description ?? '',
  free: !(tt.price && tt.price > 0),
  price: tt.price && tt.price > 0 ? String(tt.price) : '',
  quantity: tt.quantity === null ? '' : String(tt.quantity),
  saleStarts: toLocalInput(tt.sale_starts_at),
  saleEnds: toLocalInput(tt.sale_ends_at),
  maxPerOrder: tt.max_per_order ? String(tt.max_per_order) : '',
});

export function TicketTypeManager({ token, eventId, types, readOnly, paidSalesActive, onChange }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<OrganizerTicketType | 'new' | null>(types.length === 0 ? 'new' : null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function startNew(free: boolean) {
    setForm({ ...emptyForm, free });
    setEditing('new');
    setNotice(null);
  }

  function startEdit(tt: OrganizerTicketType) {
    setForm(toForm(tt));
    setEditing(tt);
    setNotice(null);
  }

  function validate(): string[] {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push(t('ticketTypes.errors.name'));
    if (!form.free && !(Number(form.price) > 0)) errors.push(t('ticketTypes.errors.price'));
    if (form.quantity && Number(form.quantity) < 0) errors.push(t('ticketTypes.errors.quantity'));
    if (editing && editing !== 'new' && form.quantity && Number(form.quantity) < editing.sold) {
      errors.push(t('ticketTypes.errors.belowSold', { sold: editing.sold }));
    }
    if (form.maxPerOrder && Number(form.maxPerOrder) < 1) errors.push(t('ticketTypes.errors.maxPerOrder'));
    if (form.saleStarts && form.saleEnds && form.saleEnds <= form.saleStarts) errors.push(t('ticketTypes.errors.saleWindow'));
    return errors;
  }

  async function reload(text: string) {
    onChange(await organizerApi.ticketTypes(token, eventId));
    setNotice({ kind: 'success', text });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (errors.length) {
      setNotice({ kind: 'error', text: t('editor.fixErrors'), items: errors });
      return;
    }
    const body: TicketTypeInput = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: form.free ? 0 : Math.round(Number(form.price)),
      quantity: form.quantity ? Number(form.quantity) : null,
      sale_starts_at: fromLocalInput(form.saleStarts),
      sale_ends_at: fromLocalInput(form.saleEnds),
      max_per_order: form.maxPerOrder ? Number(form.maxPerOrder) : null,
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        await organizerApi.createTicketType(token, eventId, body);
        await reload(t('ticketTypes.created', { name: body.name }));
      } else if (editing) {
        await organizerApi.updateTicketType(token, editing.id, body);
        await reload(t('ticketTypes.updated', { name: body.name }));
      }
      setEditing(null);
    } catch (err) {
      setNotice({ kind: 'error', text: t('ticketTypes.saveFailed', { reason: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(tt: OrganizerTicketType) {
    setBusy(true);
    try {
      await organizerApi.updateTicketType(token, tt.id, { is_hidden: !tt.is_hidden });
      await reload(tt.is_hidden ? t('ticketTypes.shown', { name: tt.name }) : t('ticketTypes.hidden', { name: tt.name }));
    } catch (err) {
      setNotice({ kind: 'error', text: t('ticketTypes.saveFailed', { reason: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  const saleWindow = (tt: OrganizerTicketType) => {
    if (!tt.sale_starts_at && !tt.sale_ends_at) return t('ticketTypes.alwaysOnSale');
    return [
      tt.sale_starts_at && t('ticketTypes.from', { date: formatEventDateTime(tt.sale_starts_at) }),
      tt.sale_ends_at && t('ticketTypes.until', { date: formatEventDateTime(tt.sale_ends_at) }),
    ].filter(Boolean).join(' · ');
  };

  return (
    <div className="space-y-4">
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {types.length === 0 && !editing && <p className="text-sm text-gray-500">{t('ticketTypes.empty')}</p>}

      {types.length > 0 && (
        <ul className="divide-y rounded-lg border border-gray-200">
          {types.map((tt) => {
            const paid = (tt.price ?? 0) > 0;
            return (
              <li key={tt.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${tt.is_hidden ? 'bg-gray-50' : ''}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{tt.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${paid ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {paid ? t('ticketTypes.paid') : t('ticketTypes.free')}
                    </span>
                    {tt.is_hidden && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">{t('ticketTypes.hiddenBadge')}</span>}
                    {paid && !paidSalesActive && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{t('ticketTypes.awaitingActivation')}</span>
                    )}
                  </div>
                  {tt.description && <p className="mt-1 text-sm text-gray-600">{tt.description}</p>}
                  <p className="mt-1 text-xs text-gray-500">
                    {t('ticketTypes.soldOf', { sold: tt.sold, total: tt.quantity ?? '∞' })}
                    {' · '}{t('ticketTypes.maxPerOrderShort', { count: tt.max_per_order ?? 1 })}
                    {' · '}{saleWindow(tt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <strong className="whitespace-nowrap">{paid ? formatKZT(tt.price ?? 0) : t('common.free')}</strong>
                  {!readOnly && (
                    <>
                      <button type="button" onClick={() => startEdit(tt)} disabled={busy} className="text-xs font-semibold text-blue-600">{t('common.edit')}</button>
                      <button type="button" onClick={() => toggleHidden(tt)} disabled={busy} className="text-xs font-semibold text-gray-600">
                        {tt.is_hidden ? t('ticketTypes.unhide') : t('ticketTypes.hide')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && !editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => startNew(true)} className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
            + {t('ticketTypes.addFree')}
          </button>
          <button type="button" onClick={() => startNew(false)} className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50">
            + {t('ticketTypes.addPaid')}
          </button>
        </div>
      )}

      {!readOnly && editing && (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <h4 className="font-semibold">{editing === 'new' ? t('ticketTypes.newTitle') : t('ticketTypes.editTitle', { name: editing.name })}</h4>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">{t('ticketTypes.name')} *
              <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
            </label>
            <div className="text-sm">
              {t('ticketTypes.pricing')}
              <div className="mt-1 flex gap-2">
                <label className={`flex-1 cursor-pointer rounded-md border px-3 py-2 ${form.free ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300 bg-white'}`}>
                  <input type="radio" name="pricing" checked={form.free} onChange={() => set('free', true)} className="mr-2" />{t('ticketTypes.free')}
                </label>
                <label className={`flex-1 cursor-pointer rounded-md border px-3 py-2 ${!form.free ? 'border-amber-500 bg-amber-50' : 'border-gray-300 bg-white'}`}>
                  <input type="radio" name="pricing" checked={!form.free} onChange={() => set('free', false)} className="mr-2" />{t('ticketTypes.paid')}
                </label>
              </div>
            </div>
            <label className="text-sm sm:col-span-2">{t('ticketTypes.description')}
              <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} className={inputClass} />
            </label>
            {!form.free && (
              <label className="text-sm">{t('ticketTypes.price')} *
                <input type="number" min={1} step={1} value={form.price} onChange={(e) => set('price', e.target.value)} className={inputClass} />
                {Number(form.price) > 0 && <span className="mt-1 block text-xs text-gray-500">{formatKZT(Number(form.price))}</span>}
              </label>
            )}
            <label className="text-sm">{t('ticketTypes.quantity')}
              <input type="number" min={0} placeholder="∞" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className={inputClass} />
            </label>
            <label className="text-sm">{t('ticketTypes.maxPerOrder')}
              <input type="number" min={1} value={form.maxPerOrder} onChange={(e) => set('maxPerOrder', e.target.value)} className={inputClass} />
            </label>
            <label className="text-sm">{t('ticketTypes.saleStarts')}
              <input type="datetime-local" value={form.saleStarts} onChange={(e) => set('saleStarts', e.target.value)} className={inputClass} />
            </label>
            <label className="text-sm">{t('ticketTypes.saleEnds')}
              <input type="datetime-local" value={form.saleEnds} onChange={(e) => set('saleEnds', e.target.value)} className={inputClass} />
            </label>
          </fieldset>
          {!form.free && !paidSalesActive && <p className="text-xs text-amber-800">{t('ticketTypes.paidHint')}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? t('common.saving') : editing === 'new' ? t('ticketTypes.create') : t('common.save')}
            </button>
            <button type="button" onClick={() => { setEditing(null); setNotice(null); }} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
