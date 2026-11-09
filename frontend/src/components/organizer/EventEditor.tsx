import { useEffect, useState } from 'react';
import { formatKZT } from '../../services/events';
import {
  fromLocalInput, organizerApi, toLocalInput,
  type OrganizerEvent, type OrganizerTicketType,
} from '../../services/organizer';

interface Props {
  token: string;
  event: OrganizerEvent | null; // null = создаём новое
  onSaved: (e: OrganizerEvent) => void;
  onClose: () => void;
}

const inputClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

export function EventEditor({ token, event, onSaved, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [capacity, setCapacity] = useState('');

  const [types, setTypes] = useState<OrganizerTicketType[]>([]);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('0');
  const [newQty, setNewQty] = useState('');

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // заполняем форму когда выбрали событие
  useEffect(() => {
    setError('');
    setMessage('');
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

    if (event) {
      organizerApi.ticketTypes(token, event.id).then(setTypes).catch((e) => setError(e.message));
    } else {
      setTypes([]);
    }
  }, [event, token]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = {
      title: title.trim(),
      description: description || null,
      category: category || null,
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
      timezone: 'Asia/Almaty',
      venue_name: venueName || null,
      venue_address: venueAddress || null,
      image_url: imageUrl || null,
      visibility: visibility as 'public' | 'unlisted' | 'private',
      capacity: capacity ? Number(capacity) : null,
    };
    try {
      let saved;
      if (event) {
        saved = await organizerApi.updateEvent(token, event.id, body);
        setMessage('Сохранено');
      } else {
        saved = await organizerApi.createEvent(token, body);
        setMessage('Черновик создан, теперь добавьте типы билетов');
      }
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    try {
      await organizerApi.createTicketType(token, event.id, {
        name: newName.trim(),
        price: Number(newPrice) || 0,
        quantity: newQty ? Number(newQty) : null,
      });
      setNewName('');
      setNewPrice('0');
      setNewQty('');
      setTypes(await organizerApi.ticketTypes(token, event.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleHidden(t: OrganizerTicketType) {
    if (!event) return;
    try {
      await organizerApi.updateTicketType(token, t.id, { is_hidden: !t.is_hidden });
      setTypes(await organizerApi.ticketTypes(token, event.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function activate() {
    if (!event) return;
    try {
      const res = await organizerApi.activatePaidSales(token, event.id);
      setMessage('Платные продажи активированы (симуляция)');
      onSaved({ ...event, paid_sales_status: res.paid_sales_status as OrganizerEvent['paid_sales_status'] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const hasPaid = types.some((t) => (t.price ?? 0) > 0);
  const cancelled = event?.status === 'cancelled';

  return (
    <section className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex justify-between">
        <h3 className="text-lg font-semibold">{event ? `Событие: ${event.title}` : 'Новое событие'}</h3>
        <button onClick={onClose} className="text-xl text-gray-400">&times;</button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Название *
          <input required value={title} onChange={(e) => setTitle(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Начало (Астана) *
          <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Окончание
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Площадка *
          <input value={venueName} onChange={(e) => setVenueName(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Адрес
          <input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Категория
          <input value={category} onChange={(e) => setCategory(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Вместимость
          <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm">Видимость
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} disabled={cancelled} className={inputClass}>
            <option value="public">Публичное</option>
            <option value="unlisted">По ссылке</option>
            <option value="private">Приватное</option>
          </select>
        </label>
        <label className="text-sm">Ссылка на картинку
          <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <label className="text-sm sm:col-span-2">Описание
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={cancelled} className={inputClass} />
        </label>
        <div className="sm:col-span-2">
          <button
            disabled={cancelled || !title || !startsAt}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {event ? 'Сохранить' : 'Создать черновик'}
          </button>
        </div>
      </form>

      {event && (
        <div className="space-y-3 border-t pt-5">
          <h4 className="font-semibold">Типы билетов</h4>

          {types.length === 0 && <p className="text-sm text-gray-500">Нужен хотя бы один тип билета, чтобы опубликовать событие.</p>}

          {types.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th>Название</th><th className="text-right">Цена</th><th className="text-right">Продано / всего</th><th></th></tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="py-2">{t.name} {t.is_hidden && <span className="text-xs text-gray-500">(скрыт)</span>}</td>
                    <td className="text-right">{(t.price ?? 0) > 0 ? formatKZT(t.price ?? 0) : 'Бесплатно'}</td>
                    <td className="text-right">{t.sold} / {t.quantity ?? '∞'}</td>
                    <td className="text-right">
                      <button onClick={() => toggleHidden(t)} disabled={cancelled} className="text-xs font-semibold text-gray-600">
                        {t.is_hidden ? 'Показать' : 'Скрыть'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!cancelled && (
            <form onSubmit={addType} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
              <label className="text-xs">Название
                <input required value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
              </label>
              <label className="text-xs">Цена, ₸
                <input type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className={inputClass} />
              </label>
              <label className="text-xs">Кол-во
                <input type="number" min={0} placeholder="∞" value={newQty} onChange={(e) => setNewQty(e.target.value)} className={inputClass} />
              </label>
              <button disabled={!newName.trim()} className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Добавить
              </button>
            </form>
          )}

          {hasPaid && !cancelled && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-semibold">
                Платные продажи:{' '}
                {event.paid_sales_status === 'ACTIVE' ? 'активны' : event.paid_sales_status === 'SUSPENDED' ? 'приостановлены админом' : 'не активированы'}
              </p>
              {event.paid_sales_status !== 'ACTIVE' && event.paid_sales_status !== 'SUSPENDED' && (
                <>
                  <p className="mt-1 text-amber-800">
                    Нужны платный билет, реквизиты в профиле и согласие с условиями. Оплата сбора — симуляция.
                  </p>
                  <button onClick={activate} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
                    Принять условия и активировать
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
