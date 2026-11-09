import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice, type NoticeState } from '../Notice';
import {
  fromLocalInput, organizerApi, toLocalInput,
  type EventInput, type OrganizerEvent, type Visibility,
} from '../../services/organizer';

interface Props {
  token: string;
  event: OrganizerEvent | null; // null = new event
  onSaved: (e: OrganizerEvent, created: boolean) => void;
}

export const inputClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50';

const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'private'];

export function EventEditor({ token, event, onSaved }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [capacity, setCapacity] = useState('');
  const [regOpens, setRegOpens] = useState('');
  const [regCloses, setRegCloses] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    setTitle(event?.title ?? '');
    setDescription(event?.description ?? '');
    setCategory(event?.category ?? '');
    setStartsAt(toLocalInput(event?.starts_at ?? null));
    setEndsAt(toLocalInput(event?.ends_at ?? null));
    setVenueName(event?.venue_name ?? '');
    setVenueAddress(event?.venue_address ?? '');
    setImageUrl(event?.image_url ?? '');
    setVisibility(event?.visibility ?? 'public');
    setCapacity(event?.capacity ? String(event.capacity) : '');
    setRegOpens(toLocalInput(event?.registration_opens_at ?? null));
    setRegCloses(toLocalInput(event?.registration_closes_at ?? null));
  }, [event]);

  const cancelled = event?.status === 'cancelled';

  function validate(): string[] {
    const errors: string[] = [];
    if (!title.trim()) errors.push(t('editor.errors.title'));
    if (!startsAt) errors.push(t('editor.errors.startsAt'));
    if (endsAt && startsAt && endsAt <= startsAt) errors.push(t('editor.errors.endsAt'));
    if (regOpens && regCloses && regCloses <= regOpens) errors.push(t('editor.errors.registration'));
    if (capacity && Number(capacity) < 1) errors.push(t('editor.errors.capacity'));
    return errors;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (errors.length) {
      setNotice({ kind: 'error', text: t('editor.fixErrors'), items: errors });
      return;
    }
    const body: EventInput = {
      title: title.trim(),
      description: description || null,
      category: category || null,
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
      timezone: 'Asia/Almaty',
      venue_name: venueName || null,
      venue_address: venueAddress || null,
      image_url: imageUrl || null,
      visibility,
      capacity: capacity ? Number(capacity) : null,
      registration_opens_at: fromLocalInput(regOpens),
      registration_closes_at: fromLocalInput(regCloses),
    };
    setBusy(true);
    setNotice(null);
    try {
      const saved = event
        ? await organizerApi.updateEvent(token, event.id, body)
        : await organizerApi.createEvent(token, body);
      setNotice({ kind: 'success', text: event ? t('editor.saved') : t('editor.created') });
      onSaved(saved, !event);
    } catch (err) {
      setNotice({ kind: 'error', text: t('editor.saveFailed', { reason: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {cancelled && <Notice notice={{ kind: 'info', text: t('editor.cancelledReadOnly') }} />}

      <fieldset disabled={cancelled || busy} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">{t('editor.title')} *
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.startsAt')} *
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.endsAt')}
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.venueName')} *
          <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.venueAddress')}
          <input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.category')}
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.imageUrl')}
          <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm sm:col-span-2">{t('editor.description')}
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </label>
      </fieldset>

      <fieldset disabled={cancelled || busy} className="grid gap-4 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">{t('editor.accessTitle')}</legend>
        <div className="sm:col-span-2">
          <p className="text-sm">{t('editor.visibility')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {VISIBILITIES.map((v) => (
              <label key={v} className={`cursor-pointer rounded-lg border p-3 text-sm ${visibility === v ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                  {t(`visibility.${v}`)}
                </span>
                <span className="mt-1 block text-xs text-gray-500">{t(`visibility.${v}Hint`)}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="text-sm">{t('editor.registrationOpens')}
          <input type="datetime-local" value={regOpens} onChange={(e) => setRegOpens(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.registrationCloses')}
          <input type="datetime-local" value={regCloses} onChange={(e) => setRegCloses(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm">{t('editor.capacity')}
          <input type="number" min={1} placeholder="∞" value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputClass} />
          <span className="mt-1 block text-xs text-gray-500">{t('editor.capacityHint')}</span>
        </label>
        <p className="self-end text-xs text-gray-500">{t('editor.timezoneHint')}</p>
      </fieldset>

      {!cancelled && (
        <button disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? t('common.saving') : event ? t('editor.save') : t('editor.createDraft')}
        </button>
      )}
    </form>
  );
}
